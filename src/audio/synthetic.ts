import { NUM_BANDS, type FeatureFrame } from "./types.ts";

export interface SyntheticOpts {
  /** Tempo of the synthetic groove. Different tiles should use different
   *  values so they never lock into visual unison. */
  bpm?: number;
  /** Shifts this feed's beat grid independently of `bpm`, for the same reason. */
  phaseOffsetSec?: number;
}

export interface SyntheticFeed {
  /** Deterministic in `timeSec` — same input always produces the same frame. */
  frame(timeSec: number): FeatureFrame;
}

// Small deterministic integer hash (xorshift-style mix), used in place of
// Math.random() so the same (band, bar) pair always yields the same
// pseudo-random timbre — no seeded-RNG state to carry around.
function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const KICK_BANDS = [0, 1, 2, 3];
const BASS_BANDS = [3, 4, 5, 6, 7];
const MID_BANDS = [8, 9, 10, 11, 12, 13, 14, 15];
const HIGH_BANDS = [16, 17, 18, 19, 20, 21, 22, 23];
const NOISE_FLOOR = 0.04;

// A slow verse<->chorus amplitude arc, layered on top of the beat-scale
// envelopes below. Without this, every band's variation was beat-to-beat
// only — energy and level swung in lockstep with the metronome but carried
// no longer, quieter/louder arc across a stretch of audio, so a feature
// driven by real dynamic range (Caustics' Loudness surge, see
// render/scenes/caustics.ts's advanceLoudSwell) had nothing to calibrate
// against on this feed: it would settle near neutral forever regardless of
// whether the feature actually worked. Long enough (multiple bars at typical
// tempos) to read as a section change, not a tremolo.
const SECTION_PERIOD_SEC = 26;
const SECTION_DEPTH = 0.7; // 0 = no section dynamics, 1 = quiet section hits pure noise floor

/** Produces a plausible ~120bpm FeatureFrame with no real audio input, so
 *  gallery preview tiles look alive before the mic is ever granted. Once
 *  real audio starts flowing, callers just stop calling this and switch to
 *  the live FeatureFrame — there's no state here to tear down. */
export function createSyntheticFeed(opts: SyntheticOpts = {}): SyntheticFeed {
  const bpm = opts.bpm ?? 120;
  const period = 60 / bpm;
  const phaseOffset = opts.phaseOffsetSec ?? 0;
  const bands = new Float32Array(NUM_BANDS);

  let lastBeatIndex = -1;

  return {
    frame(timeSec: number): FeatureFrame {
      const t = timeSec + phaseOffset;
      const beatIndex = Math.floor(t / period);
      const beatPhase = t / period - beatIndex;
      const beat = beatIndex > lastBeatIndex;
      if (beat) lastBeatIndex = beatIndex;

      const bar = beatIndex >> 2;
      const kickEnv = Math.exp(-beatPhase * 14);
      const bassEnv = Math.exp(-beatPhase * 4);
      const bassPattern = 0.5 + 0.5 * hash01(bar, beatIndex & 3);
      const eighthPhase = (t / (period / 2)) % 1;
      const midEnv = Math.exp(-eighthPhase * 8);
      const hatEnv = beatPhase > 0.5 ? Math.exp(-(beatPhase - 0.5) * 20) : 0;
      const shimmer = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.07);

      // 0 at a section trough (quiet verse), 1 at its peak (chorus/drop) —
      // smooth both ways, unrelated to the beat grid above so it reads as a
      // section change rather than another beat-locked pulse.
      const sectionPhase = (t / SECTION_PERIOD_SEC) % 1;
      const sectionSwell = 0.5 - 0.5 * Math.cos(sectionPhase * 2 * Math.PI);
      const sectionGain = 1 - SECTION_DEPTH * (1 - sectionSwell);

      for (let b = 0; b < NUM_BANDS; b++) {
        let v = NOISE_FLOOR;
        if (KICK_BANDS.includes(b)) v += kickEnv * 0.9 * sectionGain;
        if (BASS_BANDS.includes(b)) v += bassEnv * bassPattern * 0.7 * sectionGain;
        if (MID_BANDS.includes(b)) v += midEnv * hash01(b, bar) * 0.6 * sectionGain;
        if (HIGH_BANDS.includes(b)) v += (hatEnv * 0.5 + shimmer * hash01(b, 99) * 0.25) * sectionGain;
        bands[b] = clamp01(v);
      }

      let energy = 0;
      for (let b = 0; b < NUM_BANDS; b++) energy += bands[b];
      energy = clamp01(energy / NUM_BANDS + 0.15);

      // No real mic here, so there's no separate raw-vs-AGC'd distinction to
      // fake — but unlike energy (per-band normalized, beat-scale), level is
      // meant to be an absolute loudness reading, so it rides sectionSwell
      // directly rather than reusing energy's shape: a clean, wide
      // quiet->loud arc independent of exactly which bands happen to be
      // firing on a given tick.
      const level = clamp01(0.15 + 0.8 * sectionSwell);

      // beat/beatPhase above are genuinely a synthetic metronome's beat grid
      // (they drive the kick/bass/hat envelopes too) — onset/onsetPhase is
      // just what FeatureFrame calls that same edge/phase pair.
      return { time: timeSec, bands, energy, onset: beat, bpm, onsetPhase: beatPhase, level };
    },
  };
}
