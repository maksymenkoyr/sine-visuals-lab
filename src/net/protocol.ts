import { NUM_BANDS } from "../audio/types.ts";

/**
 * Wire format for a feature frame, little-endian:
 *   [0]      msg type (1 = feature frame)
 *   [1..24]  bands, Uint8 each (0..1 -> 0..255)
 *   [25]     energy, Uint8
 *   [26]     flags (bit0 = onset, bit1 = pulseOnset)
 *   [27..28] onsetPhase, Uint16 (0..1 -> 0..65535) — no consumer reads this
 *            today (FeatureFrame.onsetPhase's own doc has the story); kept
 *            on the wire only because dropping it means a version bump —
 *            see the legacy-decode note below for what that costs.
 *   [29..30] bpm * 10, Uint16
 *   [31]     level, Uint8 (0..1 -> 0..255)
 *   [32..39] roomTimeMs, Float64
 * = 40 bytes, then an optional tail:
 *   [40]     wave min, Int8 (companded, see encodeWaveSample)
 *   [41]     wave max, Int8
 * = 42 bytes when the sender has a waveform: the min and max of its mic's
 * raw samples since the frame before, which a following phone or iPad draws
 * as the Dynamics card's Waveform row (src/ui/audioMeters.ts). A sender with
 * no mic samples (the synthetic feed) leaves the tail off, and the follower
 * hides that row as it would with no waveform at all. The tail sits after
 * roomTimeMs so the 40 bytes before it are exactly the layout without it.
 * The DO relay never parses this — it's a client-only concern.
 *
 * bit1 (pulseOnset) was added after bit0 shipped — decodeFeatureFrame ORs it
 * with `onset` on decode (`(flags & 2) !== 0 || onset`) so a sender that
 * predates bit1 (never sets it, always 0) still decodes as pulseOnset =
 * onset, today's behavior, rather than a pulse that never fires. The other
 * direction, a renderer still on the OLD decoder reading a frame from a
 * sender that already sends bit1: `flags !== 0` reads any pulse-only frame
 * (bit1 set, bit0 clear) as `onset` too, i.e. that renderer loses the
 * silence gate for visual hits — a hit the gate should have dimmed fires
 * anyway — until it reloads. Harmless otherwise (bit0's own meaning is
 * unchanged), and not worth a special case: retire this paragraph together
 * with the legacy-decode fallback below once mixed-version pairing is no
 * longer a concern.
 *
 * A page still on a decoder from before the wave tail takes only 39 or 40
 * bytes, so it drops a 42-byte frame and shows its "waiting" state until it
 * reloads. decodeFeatureFrame reads the known prefix of anything longer than
 * FRAME_BYTES, so a tail added after this one only costs the waveform-era
 * decoders that one reload, not a black screen.
 *
 * decodeFeatureFrame also accepts the legacy 39-byte layout (no `level`
 * byte, roomTimeMs at [31..38]) and defaults `level` to 0.5 — so a renderer
 * that hasn't picked up this change yet still decodes frames from a host
 * that has, instead of going black. Drop that fallback once mixed-version
 * pairing is no longer a concern. 0.5 is also exactly advanceLoudSwell's
 * neutral reading (see render/scenes/caustics.ts), so a legacy sender makes
 * Caustics' Speed boost a quiet no-op rather than a wrong one — a safe
 * degradation, not a bug, and it can't be told apart from a genuine mid
 * loudness reading, so there's nothing to special-case here.
 *
 * The room speaks JSON beside this frame (clock sync, the roster, the look
 * document, pairing). Those messages are additive and unversioned — a client
 * ignores a type it doesn't know — and src/net/roomMessages.ts owns them; none
 * of it changes the binary rules above. The relay still never parses a frame,
 * but it does drop one longer than LOOK_LIMITS.maxBinaryBytes
 * (server/lookDoc.ts), so a layout that grows must raise that cap in the same
 * change or the host's frames silently stop arriving.
 *
 * Field names here (`onset`/`onsetPhase`/`pulseOnset`) are TS-side only —
 * the format is purely positional/length-discriminated (see
 * LEGACY_FRAME_BYTES), so renaming a field never touches the bytes on the
 * wire or breaks a paired device running older code.
 */
const MSG_FEATURE_FRAME = 1;
const BASE_FRAME_BYTES = 1 + NUM_BANDS + 1 + 1 + 2 + 2 + 1 + 8;
const LEGACY_FRAME_BYTES = BASE_FRAME_BYTES - 1;
const FRAME_BYTES = BASE_FRAME_BYTES + 2;

/** The min and max of a stretch of raw mic samples, each in [-1,1]. */
export interface WaveEnvelope {
  min: number;
  max: number;
}

// A square-root curve, not a linear one: the Waveform row zooms to the
// loudest column on screen (down to its own WAVE_RANGE_FLOOR), so a quiet
// room needs most of an Int8's steps near zero. Full scale still lands within
// a step of the row's clip threshold, so a follower's CLIP matches the host's.
function encodeWaveSample(x: number): number {
  const c = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
  return Math.round(Math.sign(c) * Math.sqrt(Math.abs(c)) * 127);
}

function decodeWaveSample(q: number): number {
  const a = q / 127;
  return Math.sign(a) * a * a;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface EncodableFrame {
  bands: Float32Array; // length NUM_BANDS, [0,1]
  energy: number;
  onset: boolean;
  pulseOnset: boolean;
  bpm: number;
  onsetPhase: number;
  level: number;
}

/** `wave`, when given, becomes the frame's tail (see the header); null sends
 *  the 40-byte frame. */
export function encodeFeatureFrame(frame: EncodableFrame, roomTimeMs: number, wave: WaveEnvelope | null = null): ArrayBuffer {
  const buf = new ArrayBuffer(wave ? FRAME_BYTES : BASE_FRAME_BYTES);
  const view = new DataView(buf);
  let o = 0;
  view.setUint8(o, MSG_FEATURE_FRAME);
  o += 1;
  for (let i = 0; i < NUM_BANDS; i++, o += 1) {
    view.setUint8(o, Math.round(clamp01(frame.bands[i]) * 255));
  }
  view.setUint8(o, Math.round(clamp01(frame.energy) * 255));
  o += 1;
  view.setUint8(o, (frame.onset ? 1 : 0) | (frame.pulseOnset ? 2 : 0));
  o += 1;
  view.setUint16(o, Math.round(clamp01(frame.onsetPhase) * 65535), true);
  o += 2;
  view.setUint16(o, Math.min(65535, Math.round(Math.max(0, frame.bpm) * 10)), true);
  o += 2;
  view.setUint8(o, Math.round(clamp01(frame.level) * 255));
  o += 1;
  view.setFloat64(o, roomTimeMs, true);
  o += 8;
  if (wave) {
    view.setInt8(o, encodeWaveSample(wave.min));
    view.setInt8(o + 1, encodeWaveSample(wave.max));
  }
  return buf;
}

export interface DecodedFrame {
  bands: Float32Array;
  energy: number;
  onset: boolean;
  pulseOnset: boolean;
  bpm: number;
  onsetPhase: number;
  level: number;
  roomTimeMs: number;
  /** The sender's waveform since its previous frame; null when it sent none. */
  wave: WaveEnvelope | null;
}

export function decodeFeatureFrame(buf: ArrayBuffer): DecodedFrame | null {
  const legacy = buf.byteLength === LEGACY_FRAME_BYTES;
  if (!legacy && buf.byteLength !== BASE_FRAME_BYTES && buf.byteLength < FRAME_BYTES) return null;
  const view = new DataView(buf);
  let o = 0;
  if (view.getUint8(o) !== MSG_FEATURE_FRAME) return null;
  o += 1;

  const bands = new Float32Array(NUM_BANDS);
  for (let i = 0; i < NUM_BANDS; i++, o += 1) bands[i] = view.getUint8(o) / 255;

  const energy = view.getUint8(o) / 255;
  o += 1;
  const flags = view.getUint8(o);
  const onset = (flags & 1) !== 0;
  // A sender that predates bit1 never sets it — OR with `onset` so it still
  // decodes as pulseOnset = onset, today's behavior, rather than a pulse
  // that never fires. See this file's header for the full mixed-version
  // story.
  const pulseOnset = (flags & 2) !== 0 || onset;
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
  // A NaN or infinite timestamp would wedge the jitter buffer (NaN compares
  // false everywhere, so it is never pruned; Infinity prunes all history).
  // No honest sender writes one.
  if (!Number.isFinite(roomTimeMs)) return null;
  o += 8;
  const wave =
    buf.byteLength >= FRAME_BYTES ? { min: decodeWaveSample(view.getInt8(o)), max: decodeWaveSample(view.getInt8(o + 1)) } : null;

  return { bands, energy, onset, pulseOnset, bpm, onsetPhase, level, roomTimeMs, wave };
}
