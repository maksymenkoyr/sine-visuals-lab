import { NUM_BANDS } from "../audio/types.ts";

/**
 * Wire format for a feature frame, little-endian:
 *   [0]      msg type (1 = feature frame)
 *   [1..24]  bands, Uint8 each (0..1 -> 0..255)
 *   [25]     energy, Uint8
 *   [26]     flags (bit0 = onset)
 *   [27..28] onsetPhase, Uint16 (0..1 -> 0..65535) — no consumer reads this
 *            today (FeatureFrame.onsetPhase's own doc has the story); kept
 *            on the wire only because dropping it means a version bump —
 *            see the legacy-decode note below for what that costs.
 *   [29..30] bpm * 10, Uint16
 *   [31]     level, Uint8 (0..1 -> 0..255)
 *   [32..39] roomTimeMs, Float64
 * = 40 bytes. The DO relay never parses this — it's a client-only concern.
 *
 * decodeFeatureFrame also accepts the legacy 39-byte layout (no `level`
 * byte, roomTimeMs at [31..38]) and defaults `level` to 0.5 — so a renderer
 * that hasn't picked up this change yet still decodes frames from a host
 * that has, instead of going black. Drop that fallback once mixed-version
 * pairing is no longer a concern. 0.5 is also exactly advanceLoudSwell's
 * neutral reading (see render/scenes/caustics.ts), so a legacy sender makes
 * Caustics' Loudness surge a quiet no-op rather than a wrong one — a safe
 * degradation, not a bug, and it can't be told apart from a genuine mid
 * loudness reading, so there's nothing to special-case here.
 *
 * Field names here (`onset`/`onsetPhase`) are TS-side only — the format is
 * purely positional/length-discriminated (see LEGACY_FRAME_BYTES), so
 * renaming a field never touches the bytes on the wire or breaks a paired
 * device running older code.
 */
const MSG_FEATURE_FRAME = 1;
const FRAME_BYTES = 1 + NUM_BANDS + 1 + 1 + 2 + 2 + 1 + 8;
const LEGACY_FRAME_BYTES = FRAME_BYTES - 1;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface EncodableFrame {
  bands: Float32Array; // length NUM_BANDS, [0,1]
  energy: number;
  onset: boolean;
  bpm: number;
  onsetPhase: number;
  level: number;
}

export function encodeFeatureFrame(frame: EncodableFrame, roomTimeMs: number): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_BYTES);
  const view = new DataView(buf);
  let o = 0;
  view.setUint8(o, MSG_FEATURE_FRAME);
  o += 1;
  for (let i = 0; i < NUM_BANDS; i++, o += 1) {
    view.setUint8(o, Math.round(clamp01(frame.bands[i]) * 255));
  }
  view.setUint8(o, Math.round(clamp01(frame.energy) * 255));
  o += 1;
  view.setUint8(o, frame.onset ? 1 : 0);
  o += 1;
  view.setUint16(o, Math.round(clamp01(frame.onsetPhase) * 65535), true);
  o += 2;
  view.setUint16(o, Math.min(65535, Math.round(Math.max(0, frame.bpm) * 10)), true);
  o += 2;
  view.setUint8(o, Math.round(clamp01(frame.level) * 255));
  o += 1;
  view.setFloat64(o, roomTimeMs, true);
  return buf;
}

export interface DecodedFrame {
  bands: Float32Array;
  energy: number;
  onset: boolean;
  bpm: number;
  onsetPhase: number;
  level: number;
  roomTimeMs: number;
}

export function decodeFeatureFrame(buf: ArrayBuffer): DecodedFrame | null {
  const legacy = buf.byteLength === LEGACY_FRAME_BYTES;
  if (!legacy && buf.byteLength !== FRAME_BYTES) return null;
  const view = new DataView(buf);
  let o = 0;
  if (view.getUint8(o) !== MSG_FEATURE_FRAME) return null;
  o += 1;

  const bands = new Float32Array(NUM_BANDS);
  for (let i = 0; i < NUM_BANDS; i++, o += 1) bands[i] = view.getUint8(o) / 255;

  const energy = view.getUint8(o) / 255;
  o += 1;
  const onset = view.getUint8(o) !== 0;
  o += 1;
  const onsetPhase = view.getUint16(o, true) / 65535;
  o += 2;
  const bpm = view.getUint16(o, true) / 10;
  o += 2;
  // A legacy sender never wrote a level byte — hold the profile's loudness
  // dial neutral rather than guess.
  const level = legacy ? 0.5 : view.getUint8(o) / 255;
  if (!legacy) o += 1;
  const roomTimeMs = view.getFloat64(o, true);

  return { bands, energy, onset, bpm, onsetPhase, level, roomTimeMs };
}
