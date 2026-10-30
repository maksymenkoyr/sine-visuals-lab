import { type EngineReading, HIT_KINDS, HIT_STRENGTH_MAX, NUM_BANDS, SONG_EDGES, SONG_LEVELS, type SongFrame } from "../audio/types.ts";

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
 * raw samples since the frame before. Nothing on a follower reads it now that
 * the panel has no Input check card. A sender with no mic samples (the
 * synthetic feed) leaves the tail off. The tail sits after
 * roomTimeMs so the 40 bytes before it are exactly the layout without it.
 * The DO relay never parses this — it's a client-only concern.
 *   [42]     hats, Uint8 (0..1 -> 0..255)
 *   [43]     lead, Uint8
 * = 44 bytes: the two stem levels (src/audio/stemSplit.ts), which only the
 * device hearing the sound can measure, so they travel here instead of being
 * worked out from the bands. A frame without them decodes hats and lead as 0.
 *   [44..46] engine low, mid, high, Uint8 (0..1 -> 0..255)
 *   [47..49] kick, snare, hat hit strength, Uint8 (0..HIT_STRENGTH_MAX -> 0..255; 0 = no hit)
 *   [50]     surge, Uint8 (0..HIT_STRENGTH_MAX -> 0..255)
 *   [51]     engine flags: bit0 music, bits1-2 surge kind (HIT_KINDS index),
 *            bit3 blocked, bit4 wave absent, bit5 gate off (FeatureFrame.gateOff;
 *            a sender from before it never sets it, so its followers gate as
 *            they always did)
 *   [52]     confidence, Uint8
 *   [53]     downbeat confidence, Uint8
 *   [54..55] beat ago, Uint16 ms: how long before this frame the tracker's
 *            latest beat fell
 *   [56..57] downbeat ago, Uint16 ms
 *   [58]     tracker updates, Uint8, wrapping
 * = ENGINE_FRAME_BYTES: the audio engine's reading (src/audio/types.ts's
 * EngineReading), which is what a follower builds its levels, hits and beat
 * clock from. The beat times travel as an age against this frame's own time,
 * so they come out on whatever timeline the follower reads frames on.
 * Every frame with a reading carries the wave and stem tails before it, to
 * keep the layout positional; a sender with a reading but no waveform sets
 * bit4 and the follower drops the wave it wrote as a placeholder. A follower
 * running a decoder from before the engine tail reads the prefix it knows and
 * ignores the rest (it shows a flat Waveform row for such a sender). A frame
 * without the tail decodes `engine` as null, which a follower's anim clock
 * treats as nothing heard: no levels, no hits, no beat. That is a
 * mixed-version pairing during a deploy, and lasts until the sender reloads;
 * retire this paragraph with the legacy-decode fallback below.
 *   [59]     song edges: bit0 kick, bit1 clap, bit2 hat, bit3 chord
 *   [60..66] song levels, Uint8 each (0..1 -> 0..255), in the order of
 *            SONG_LEVELS: clap, hat, chord, keys, loudness, drop, playing
 * = SONG_FRAME_BYTES: the song layer's reading (src/audio/types.ts's
 * SongFrame). It is written only on a frame that also has an engine reading,
 * and a frame shorter than SONG_FRAME_BYTES decodes `song` as null. Like the
 * engine's hits, the edges are latched by the wire decimator so each crosses
 * once. A follower whose decoder stops at the engine tail ignores these bytes.
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
 * bytes, so it drops a longer frame and shows its "waiting" state until it
 * reloads. decodeFeatureFrame reads the known prefix of anything longer than
 * FRAME_BYTES, so each later tail costs an older waveform-era decoder nothing.
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
const STEM_FRAME_BYTES = FRAME_BYTES + 2;
const ENGINE_FRAME_BYTES = STEM_FRAME_BYTES + 15;
const SONG_FRAME_BYTES = ENGINE_FRAME_BYTES + 1 + SONG_LEVELS.length;

const MUSIC_BIT = 1;
const SURGE_KIND_SHIFT = 1;
const BLOCKED_BIT = 8;
const NO_WAVE_BIT = 16;
const GATE_OFF_BIT = 32;
const AGO_MAX_MS = 65535;

/** The min and max of a stretch of raw mic samples, each in [-1,1]. */
export interface WaveEnvelope {
  min: number;
  max: number;
}

/**
 * EngineReading as it travels: the beat and bar start as ages before the
 * frame's own time (`beatAgoMs`, `downbeatAgoMs`) instead of times on the
 * sender's clock.
 */
export interface WireEngine extends Omit<EngineReading, "beatTime" | "downbeatTime"> {
  beatAgoMs: number;
  downbeatAgoMs: number;
}

/** `r` as it travels with a frame read at `frameTimeSec` (the clock `r`'s times are on). */
export function toWireEngine(r: EngineReading, frameTimeSec: number): WireEngine {
  return {
    low: r.low,
    mid: r.mid,
    high: r.high,
    kick: r.kick,
    snare: r.snare,
    hat: r.hat,
    surge: r.surge,
    surgeKind: r.surgeKind,
    blocked: r.blocked,
    music: r.music,
    confidence: r.confidence,
    downbeatConfidence: r.downbeatConfidence,
    updates: r.updates,
    beatAgoMs: Math.max(0, (frameTimeSec - r.beatTime) * 1000),
    downbeatAgoMs: Math.max(0, (frameTimeSec - r.downbeatTime) * 1000),
  };
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

function unit8(x: number): number {
  return Math.round(clamp01(Number.isFinite(x) ? x : 0) * 255);
}

/** A hit strength's byte: 0 stays 0 (no hit), and a hit never rounds down onto
 *  its threshold (strength 1), where the follower's gate would drop it. */
function strength8(x: number): number {
  if (!(x > 0)) return 0;
  return Math.max(Math.ceil(255 / HIT_STRENGTH_MAX), Math.round((Math.min(x, HIT_STRENGTH_MAX) / HIT_STRENGTH_MAX) * 255));
}

function ago16(ms: number): number {
  return Math.min(AGO_MAX_MS, Math.round(Math.max(0, Number.isFinite(ms) ? ms : AGO_MAX_MS)));
}

export interface EncodableFrame {
  /** The frame's own time, on the clock its engine reading's times are on;
   *  read only with a reading. */
  time?: number;
  bands: Float32Array; // length NUM_BANDS, [0,1]
  energy: number;
  onset: boolean;
  pulseOnset: boolean;
  bpm: number;
  onsetPhase: number;
  level: number;
  hats: number;
  lead: number;
  /** FeatureFrame.gateOff; travels only with an engine tail. */
  gateOff?: boolean;
  /** Absent or null sends no engine tail. */
  engine?: EngineReading | null;
  /** Absent or null sends no song tail; it also needs an engine reading. */
  song?: SongFrame | null;
}

/** `wave`, when given, becomes the frame's tail, followed by the stem levels
 *  and, when the frame has one, the engine reading (see the header); with
 *  neither, the 40-byte frame. */
export function encodeFeatureFrame(frame: EncodableFrame, roomTimeMs: number, wave: WaveEnvelope | null = null): ArrayBuffer {
  const engine = frame.engine ?? null;
  const song = engine ? (frame.song ?? null) : null;
  const buf = new ArrayBuffer(song ? SONG_FRAME_BYTES : engine ? ENGINE_FRAME_BYTES : wave ? STEM_FRAME_BYTES : BASE_FRAME_BYTES);
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
  if (wave || engine) {
    view.setInt8(o, wave ? encodeWaveSample(wave.min) : 0);
    view.setInt8(o + 1, wave ? encodeWaveSample(wave.max) : 0);
    view.setUint8(o + 2, Math.round(clamp01(frame.hats) * 255));
    view.setUint8(o + 3, Math.round(clamp01(frame.lead) * 255));
    o += 4;
  }
  if (engine) {
    const w = toWireEngine(engine, frame.time ?? 0);
    view.setUint8(o, unit8(w.low));
    view.setUint8(o + 1, unit8(w.mid));
    view.setUint8(o + 2, unit8(w.high));
    view.setUint8(o + 3, strength8(w.kick));
    view.setUint8(o + 4, strength8(w.snare));
    view.setUint8(o + 5, strength8(w.hat));
    view.setUint8(o + 6, unit8(w.surge / HIT_STRENGTH_MAX));
    const kind = Math.max(0, HIT_KINDS.indexOf(w.surgeKind));
    view.setUint8(
      o + 7,
      (w.music ? MUSIC_BIT : 0) | (kind << SURGE_KIND_SHIFT) | (w.blocked ? BLOCKED_BIT : 0) | (wave ? 0 : NO_WAVE_BIT) | (frame.gateOff ? GATE_OFF_BIT : 0),
    );
    view.setUint8(o + 8, unit8(w.confidence));
    view.setUint8(o + 9, unit8(w.downbeatConfidence));
    view.setUint16(o + 10, ago16(w.beatAgoMs), true);
    view.setUint16(o + 12, ago16(w.downbeatAgoMs), true);
    view.setUint8(o + 14, w.updates & 255);
    o += 15;
  }
  if (song) {
    let edges = 0;
    for (let i = 0; i < SONG_EDGES.length; i++) if (song[SONG_EDGES[i]]) edges |= 1 << i;
    view.setUint8(o, edges);
    for (let i = 0; i < SONG_LEVELS.length; i++) view.setUint8(o + 1 + i, unit8(song[SONG_LEVELS[i]]));
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
  /** 0 when the frame carries no stem tail. */
  hats: number;
  lead: number;
  roomTimeMs: number;
  /** The sender's waveform since its previous frame; null when it sent none. */
  wave: WaveEnvelope | null;
  /** The sender's engine reading; null when the frame carries none. */
  engine: WireEngine | null;
  /** FeatureFrame.gateOff; false without an engine tail. */
  gateOff: boolean;
  /** The sender's song reading; null when the frame carries none. */
  song: SongFrame | null;
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
  const stems = buf.byteLength >= STEM_FRAME_BYTES;
  const hats = stems ? view.getUint8(o + 2) / 255 : 0;
  const lead = stems ? view.getUint8(o + 3) / 255 : 0;
  let engine: WireEngine | null = null;
  let waveAbsent = false;
  let gateOff = false;
  if (buf.byteLength >= ENGINE_FRAME_BYTES) {
    const e = o + 4;
    const eflags = view.getUint8(e + 7);
    waveAbsent = (eflags & NO_WAVE_BIT) !== 0;
    gateOff = (eflags & GATE_OFF_BIT) !== 0;
    engine = {
      low: view.getUint8(e) / 255,
      mid: view.getUint8(e + 1) / 255,
      high: view.getUint8(e + 2) / 255,
      kick: (view.getUint8(e + 3) / 255) * HIT_STRENGTH_MAX,
      snare: (view.getUint8(e + 4) / 255) * HIT_STRENGTH_MAX,
      hat: (view.getUint8(e + 5) / 255) * HIT_STRENGTH_MAX,
      surge: (view.getUint8(e + 6) / 255) * HIT_STRENGTH_MAX,
      surgeKind: HIT_KINDS[(eflags >> SURGE_KIND_SHIFT) & 3] ?? "kick",
      blocked: (eflags & BLOCKED_BIT) !== 0,
      music: (eflags & MUSIC_BIT) !== 0,
      confidence: view.getUint8(e + 8) / 255,
      downbeatConfidence: view.getUint8(e + 9) / 255,
      beatAgoMs: view.getUint16(e + 10, true),
      downbeatAgoMs: view.getUint16(e + 12, true),
      updates: view.getUint8(e + 14),
    };
  }
  let song: SongFrame | null = null;
  if (buf.byteLength >= SONG_FRAME_BYTES) {
    const e = ENGINE_FRAME_BYTES;
    const edges = view.getUint8(e);
    const level = (i: number): number => view.getUint8(e + 1 + i) / 255;
    song = {
      kick: (edges & 1) !== 0,
      clap: (edges & 2) !== 0,
      hat: (edges & 4) !== 0,
      chord: (edges & 8) !== 0,
      clapLevel: level(0),
      hatLevel: level(1),
      chordLevel: level(2),
      keys: level(3),
      loudness: level(4),
      dropLevel: level(5),
      playing: level(6),
    };
  }
  const wave =
    buf.byteLength >= FRAME_BYTES && !waveAbsent ? { min: decodeWaveSample(view.getInt8(o)), max: decodeWaveSample(view.getInt8(o + 1)) } : null;

  return { bands, energy, onset, pulseOnset, bpm, onsetPhase, level, hats, lead, roomTimeMs, wave, engine, gateOff, song };
}
