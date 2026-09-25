import { biquad, type BiquadCoefficients } from "../../src/audio/lufs.ts";

/**
 * Offline, dependency-free music synthesis for the tempo-tracker eval
 * harness (see tests/tempoEval.test.ts and run.ts). Every track is a mono
 * Float32Array at SR, built by additively rendering a handful of drum-machine
 * -style instruments (kick/snare/clap/hat/bass/pad) at scripted times, plus
 * the ground truth (tempo/beats) the eval scores the real tracker against.
 * Deterministic: every noisy instrument draws from a seeded RNG, never
 * Math.random, so a run is bit-for-bit repeatable.
 *
 * A few instrument details the plan that produced this file didn't pin down
 * exactly (a percussion "decay Xs" target level, a hip-hop/DnB sub bass's
 * exact pitch/duration) are filled in with a documented, reasonable choice
 * at each call site — they only need to sound percussive and land on the
 * scripted onset times; the tracker under test never sees anything but the
 * resulting spectrum.
 */

export const SR = 48000;

export interface TempoSegment {
  from: number;
  to: number;
  bpm: number;
}

export interface Track {
  name: string;
  mono: Float32Array;
  tempo: TempoSegment[];
  beats: number[];
}

// ---- seeded RNG (same small LCG shape tests/features.test.ts already uses) ----
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// ---- RBJ biquad design (Audio EQ Cookbook), reusing lufs.ts's own direct-
// form filter (biquad()) to actually apply the coefficients over a buffer.
const Q_DEFAULT = Math.SQRT1_2; // Butterworth — used wherever the plan gives no Q

function rbjBiquad(type: "lowpass" | "highpass" | "bandpass", freqHz: number, q: number, sr: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * freqHz) / sr;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === "lowpass") {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else if (type === "highpass") {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else {
    // Constant 0dB peak gain bandpass.
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  }
  return { b: [b0 / a0, b1 / a0, b2 / a0], a: [1, a1 / a0, a2 / a0] };
}

function whiteNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  return out;
}

function sawWave(phase: number): number {
  const p = (((phase / (2 * Math.PI)) % 1) + 1) % 1;
  return 2 * p - 1;
}

function triangleWave(phase: number): number {
  const p = (((phase / (2 * Math.PI)) % 1) + 1) % 1;
  return 4 * Math.abs(p - 0.5) - 1;
}

// A percussion envelope: linear attack to 1, then exponential decay reaching
// floorDb by decaySec after the attack ends. The plan pins kick's own target
// explicitly (-80dB by 0.38s, passed in below); every other instrument's
// plain "decay Xs" is read against DECAY_FLOOR_DB, a single shared
// convention, since the plan doesn't give each one its own target and the
// exact floor has no bearing on the tracker behaviour this harness measures
// — only the transient's onset shape and rough duration do.
const DECAY_FLOOR_DB = -60;

function envelope(t: number, attackSec: number, decaySec: number, floorDb = DECAY_FLOOR_DB): number {
  if (t < 0) return 0;
  if (t < attackSec) return attackSec > 0 ? t / attackSec : 1;
  const k = ((-floorDb / 20) * Math.LN10) / decaySec;
  return Math.exp(-k * (t - attackSec));
}

function addSamples(out: Float32Array, startSample: number, samples: Float32Array): void {
  for (let i = 0; i < samples.length; i++) {
    const idx = startSample + i;
    if (idx >= 0 && idx < out.length) out[idx] += samples[i];
  }
}

// ---- Instruments -----------------------------------------------------

const KICK_SWEEP_SEC = 0.11;
const KICK_F0 = 150;
const KICK_F1 = 45;
const KICK_ATTACK_SEC = 0.002;
const KICK_DECAY_SEC = 0.38;
const KICK_DECAY_FLOOR_DB = -80;
const KICK_TONE_GAIN = 0.95;
const KICK_CLICK_SEC = 0.012;
const KICK_CLICK_HP_HZ = 2500;
const KICK_CLICK_GAIN = 0.08;
const KICK_RENDER_TAIL_SEC = 0.5; // comfortably past the -80dB point (see envelope())

function kick(out: Float32Array, sr: number, t: number, v: number, rand: () => number): void {
  const startSample = Math.round(t * sr);
  const toneLen = Math.round((KICK_ATTACK_SEC + KICK_RENDER_TAIL_SEC) * sr);
  const tone = new Float32Array(toneLen);
  let phase = 0;
  for (let i = 0; i < toneLen; i++) {
    const lt = i / sr;
    const sweepT = Math.min(lt, KICK_SWEEP_SEC);
    const freq = KICK_F0 * Math.pow(KICK_F1 / KICK_F0, sweepT / KICK_SWEEP_SEC);
    phase += (2 * Math.PI * freq) / sr;
    tone[i] = Math.sin(phase) * envelope(lt, KICK_ATTACK_SEC, KICK_DECAY_SEC, KICK_DECAY_FLOOR_DB) * KICK_TONE_GAIN * v;
  }
  addSamples(out, startSample, tone);

  const clickLen = Math.round(KICK_CLICK_SEC * sr);
  const click = biquad(whiteNoise(clickLen, rand), rbjBiquad("highpass", KICK_CLICK_HP_HZ, Q_DEFAULT, sr));
  for (let i = 0; i < click.length; i++) click[i] *= KICK_CLICK_GAIN * v;
  addSamples(out, startSample, click);
}

const SNARE_NOISE_BP_HZ = 1900;
const SNARE_NOISE_BP_Q = 0.8;
const SNARE_NOISE_GAIN = 0.5;
const SNARE_NOISE_DECAY_SEC = 0.17;
const SNARE_TONE_F0 = 200;
const SNARE_TONE_F1 = 160;
const SNARE_TONE_GAIN = 0.3;
const SNARE_TONE_DECAY_SEC = 0.09;
const SNARE_RENDER_TAIL_SEC = 0.35;

function snare(out: Float32Array, sr: number, t: number, v: number, rand: () => number): void {
  const startSample = Math.round(t * sr);
  const len = Math.round(SNARE_RENDER_TAIL_SEC * sr);

  const noise = biquad(whiteNoise(len, rand), rbjBiquad("bandpass", SNARE_NOISE_BP_HZ, SNARE_NOISE_BP_Q, sr));
  for (let i = 0; i < noise.length; i++) noise[i] *= envelope(i / sr, 0, SNARE_NOISE_DECAY_SEC) * SNARE_NOISE_GAIN * v;
  addSamples(out, startSample, noise);

  const tone = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const lt = i / sr;
    const sweepT = Math.min(lt, SNARE_TONE_DECAY_SEC);
    const freq = SNARE_TONE_F0 * Math.pow(SNARE_TONE_F1 / SNARE_TONE_F0, sweepT / SNARE_TONE_DECAY_SEC);
    phase += (2 * Math.PI * freq) / sr;
    tone[i] = triangleWave(phase) * envelope(lt, 0, SNARE_TONE_DECAY_SEC) * SNARE_TONE_GAIN * v;
  }
  addSamples(out, startSample, tone);
}

const CLAP_BP_HZ = 1300;
const CLAP_BP_Q = 1.1;
const CLAP_OFFSETS_SEC = [0, 0.011, 0.022];
const CLAP_SHORT_DECAY_SEC = 0.012;
const CLAP_SHORT_GAIN = 0.35;
const CLAP_LONG_DECAY_SEC = 0.16;
const CLAP_LONG_GAIN = 0.4;
const CLAP_RENDER_TAIL_SEC = 0.3;

function clap(out: Float32Array, sr: number, t: number, v: number, rand: () => number): void {
  for (let burst = 0; burst < CLAP_OFFSETS_SEC.length; burst++) {
    const isLast = burst === CLAP_OFFSETS_SEC.length - 1;
    const decaySec = isLast ? CLAP_LONG_DECAY_SEC : CLAP_SHORT_DECAY_SEC;
    const gain = isLast ? CLAP_LONG_GAIN : CLAP_SHORT_GAIN;
    const startSample = Math.round((t + CLAP_OFFSETS_SEC[burst]!) * sr);
    const len = Math.round(CLAP_RENDER_TAIL_SEC * sr);
    const noise = biquad(whiteNoise(len, rand), rbjBiquad("bandpass", CLAP_BP_HZ, CLAP_BP_Q, sr));
    for (let i = 0; i < noise.length; i++) noise[i] *= envelope(i / sr, 0, decaySec) * gain * v;
    addSamples(out, startSample, noise);
  }
}

const HAT_HP_HZ = 7500;
const HAT_CLOSED_GAIN = 0.16;
const HAT_CLOSED_DECAY_SEC = 0.035;
const HAT_OPEN_GAIN = 0.14;
const HAT_OPEN_DECAY_SEC = 0.2;
const HAT_RENDER_TAIL_SEC = 0.35;

function hat(out: Float32Array, sr: number, t: number, v: number, rand: () => number, open: boolean): void {
  const decaySec = open ? HAT_OPEN_DECAY_SEC : HAT_CLOSED_DECAY_SEC;
  const gain = open ? HAT_OPEN_GAIN : HAT_CLOSED_GAIN;
  const startSample = Math.round(t * sr);
  const len = Math.round(HAT_RENDER_TAIL_SEC * sr);
  const noise = biquad(whiteNoise(len, rand), rbjBiquad("highpass", HAT_HP_HZ, Q_DEFAULT, sr));
  for (let i = 0; i < noise.length; i++) noise[i] *= envelope(i / sr, 0, decaySec) * gain * v;
  addSamples(out, startSample, noise);
}

const BASS_LP_HZ = 320;
const BASS_LP_Q = 4;
const BASS_GAIN = 0.22;
const BASS_ATTACK_SEC = 0.006;
const BASS_RENDER_TAIL_SEC = 0.15; // past dur's own decay tail

function bass(out: Float32Array, sr: number, t: number, freq: number, dur: number, v: number): void {
  const startSample = Math.round(t * sr);
  const len = Math.round((dur + BASS_RENDER_TAIL_SEC) * sr);
  const raw = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    phase += (2 * Math.PI * freq) / sr;
    raw[i] = sawWave(phase);
  }
  const filtered = biquad(raw, rbjBiquad("lowpass", BASS_LP_HZ, BASS_LP_Q, sr));
  for (let i = 0; i < filtered.length; i++) filtered[i] *= envelope(i / sr, BASS_ATTACK_SEC, dur) * BASS_GAIN * v;
  addSamples(out, startSample, filtered);
}

function padEnvelope(t: number, dur: number, attackSec: number, releaseSec: number): number {
  if (t < 0 || t > dur) return 0;
  if (t < attackSec) return attackSec > 0 ? t / attackSec : 1;
  const releaseStart = dur - releaseSec;
  if (t < releaseStart) return 1;
  return releaseSec > 0 ? Math.max(0, (dur - t) / releaseSec) : 0;
}

const PAD_DETUNE_CENTS = 6;
const PAD_LP_HZ = 1500;
const PAD_ATTACK_SEC = 0.35;
const PAD_RELEASE_SEC = 0.25;
const PAD_VOICE_GAIN = 0.035;

function pad(out: Float32Array, sr: number, t: number, freqs: number[], dur: number, v: number): void {
  const startSample = Math.round(t * sr);
  const len = Math.round(dur * sr);
  const raw = new Float32Array(len);
  const detuneRatio = Math.pow(2, PAD_DETUNE_CENTS / 1200);
  for (const freq of freqs) {
    for (const voiceFreq of [freq / detuneRatio, freq * detuneRatio]) {
      let phase = 0;
      for (let i = 0; i < len; i++) {
        phase += (2 * Math.PI * voiceFreq) / sr;
        raw[i] += sawWave(phase) * PAD_VOICE_GAIN * v;
      }
    }
  }
  const filtered = biquad(raw, rbjBiquad("lowpass", PAD_LP_HZ, Q_DEFAULT, sr));
  for (let i = 0; i < filtered.length; i++) filtered[i] *= padEnvelope(i / sr, dur, PAD_ATTACK_SEC, PAD_RELEASE_SEC);
  addSamples(out, startSample, filtered);
}

// ---- Tracks -----------------------------------------------------------

const ROOT = [55, 43.65, 65.41, 49];
const CHORDS = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [196, 261.63, 329.63],
  [196, 246.94, 293.66],
];

// Bass note duration under a kick, as a fraction of that beat's own length —
// house's own spec pins this at 0.45; hiphop/dnb's kick+bass reuse the same
// fraction (the plan doesn't give them their own), just at a lower root
// octave for a sub-bass rather than house's plucked ROOT*2.
const KICK_BASS_DUR_FRAC = 0.45;

function allocBuffer(durationSec: number): Float32Array {
  return new Float32Array(Math.round(durationSec * SR));
}

function finish(buf: Float32Array): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * 0.6);
  return buf;
}

function house(): Track {
  const bpm = 124;
  const beatSec = 60 / bpm;
  const stepSec = beatSec / 4;
  const bars = 20;
  const stepsTotal = bars * 16;
  const musicEndSec = stepsTotal * stepSec;
  const buf = allocBuffer(musicEndSec + 5);
  const rand = makeRng(1001);
  const beats: number[] = [];

  for (let s = 0; s < stepsTotal; s++) {
    const t = s * stepSec;
    const bar = Math.floor(s / 16);
    const st = s % 16;
    const inBreakdown = bar >= 8 && bar < 12;

    if (st === 0) pad(buf, SR, t, CHORDS[bar % 4]!, beatSec * 4, inBreakdown ? 1.5 : 0.7);

    if (!inBreakdown) {
      if (st % 4 === 0) kick(buf, SR, t, 1, rand);
      if (st === 4 || st === 12) clap(buf, SR, t, 1, rand);
      if (st % 4 === 2) {
        hat(buf, SR, t, 1, rand, true);
        bass(buf, SR, t, ROOT[bar % 4]! * 2, beatSec * KICK_BASS_DUR_FRAC, 1);
      } else if (st % 4 === 1 || st % 4 === 3) {
        hat(buf, SR, t, 0.5, rand, false);
      }
      if (st % 4 === 0) beats.push(t);
    }
  }

  const tempo: TempoSegment[] = [
    { from: 0, to: 8 * 16 * stepSec, bpm },
    { from: 12 * 16 * stepSec, to: 20 * 16 * stepSec, bpm },
  ];
  return { name: "house", mono: finish(buf), tempo, beats };
}

function hiphop(): Track {
  const bpm = 90;
  const beatSec = 60 / bpm;
  const stepSec = beatSec / 4;
  const bars = 12;
  const stepsTotal = bars * 16;
  const musicEndSec = stepsTotal * stepSec;
  const buf = allocBuffer(musicEndSec + 1);
  const rand = makeRng(1002);
  const beats: number[] = [];

  for (let s = 0; s < stepsTotal; s++) {
    const t = s * stepSec;
    const bar = Math.floor(s / 16);
    const st = s % 16;

    if (st === 0 || st === 7 || st === 10) {
      kick(buf, SR, t, 1, rand);
      bass(buf, SR, t, ROOT[bar % 4]!, beatSec * KICK_BASS_DUR_FRAC, 1);
    }
    if (st === 4 || st === 12) snare(buf, SR, t, 1, rand);
    if (st % 2 === 0) {
      if (st % 4 === 0) hat(buf, SR, t, 0.7, rand, false);
      else hat(buf, SR, t + 0.1 * beatSec, 0.45, rand, false); // swing delay
    }
    if (st === 15) hat(buf, SR, t, 0.25, rand, false); // ghost hat

    if (st === 0 && bar % 2 === 0) pad(buf, SR, t, CHORDS[Math.floor(bar / 2) % CHORDS.length]!, beatSec * 8, 0.7);
    if (st % 4 === 0) beats.push(t);
  }

  const tempo: TempoSegment[] = [{ from: 0, to: musicEndSec, bpm }];
  return { name: "hiphop", mono: finish(buf), tempo, beats };
}

function dnb(): Track {
  const bpm = 174;
  const beatSec = 60 / bpm;
  const stepSec = beatSec / 4;
  const bars = 16;
  const stepsTotal = bars * 16;
  const musicEndSec = stepsTotal * stepSec;
  const buf = allocBuffer(musicEndSec + 1);
  const rand = makeRng(1003);
  const beats: number[] = [];

  for (let s = 0; s < stepsTotal; s++) {
    const t = s * stepSec;
    const bar = Math.floor(s / 16);
    const st = s % 16;

    if (st === 0 || st === 10) kick(buf, SR, t, 1, rand);
    if (st === 4 || st === 12) snare(buf, SR, t, 1, rand);
    hat(buf, SR, t, st % 2 === 0 ? 0.6 : 0.25, rand, false);
    if (st === 0) bass(buf, SR, t, ROOT[bar % 4]!, beatSec * 3.5, 1.2);
    if (st === 0 && bar % 2 === 0) pad(buf, SR, t, CHORDS[Math.floor(bar / 2) % CHORDS.length]!, beatSec * 8, 0.7);
    if (st % 4 === 0) beats.push(t);
  }

  const tempo: TempoSegment[] = [{ from: 0, to: musicEndSec, bpm }];
  return { name: "dnb", mono: finish(buf), tempo, beats };
}

function rampBpmAt(beat: number): number {
  return 110 + 20 * Math.min(1, beat / 64);
}

function ramp(): Track {
  const bars = 20;
  const stepsTotal = bars * 16;
  const rand = makeRng(1004);
  // stepTimes[s] is step s's own time; the extra trailing entry is the time
  // one step past the last one, i.e. the track's musical end.
  const stepTimes = new Float64Array(stepsTotal + 1);
  let t = 0;
  for (let s = 0; s <= stepsTotal; s++) {
    stepTimes[s] = t;
    if (s === stepsTotal) break;
    t += 0.25 * (60 / rampBpmAt(s / 4));
  }
  const musicEndSec = stepTimes[stepsTotal]!;
  const buf = allocBuffer(musicEndSec + 2);
  const beats: number[] = [];
  const tempo: TempoSegment[] = [];

  for (let s = 0; s < stepsTotal; s++) {
    const tS = stepTimes[s]!;
    const bar = Math.floor(s / 16);
    const st = s % 16;
    const localBpm = rampBpmAt(s / 4);
    const localBeatSec = 60 / localBpm;

    if (st === 0) pad(buf, SR, tS, CHORDS[bar % 4]!, localBeatSec * 4, 0.7);
    if (st % 4 === 0) kick(buf, SR, tS, 1, rand);
    if (st === 4 || st === 12) clap(buf, SR, tS, 1, rand);
    if (st % 4 === 2) {
      hat(buf, SR, tS, 1, rand, true);
      bass(buf, SR, tS, ROOT[bar % 4]! * 2, localBeatSec * KICK_BASS_DUR_FRAC, 1);
    } else if (st % 4 === 1 || st % 4 === 3) {
      hat(buf, SR, tS, 0.5, rand, false);
    }
    if (st % 4 === 0) {
      beats.push(tS);
      const segTo = stepTimes[Math.min(stepsTotal, s + 4)]!;
      tempo.push({ from: tS, to: segTo, bpm: localBpm });
    }
  }

  return { name: "ramp", mono: finish(buf), tempo, beats };
}

const RANDOM_DURATION_SEC = 30;
const RANDOM_GAP_MIN_SEC = 0.12;
const RANDOM_GAP_MAX_SEC = 0.67;

function randomTrack(): Track {
  const buf = allocBuffer(RANDOM_DURATION_SEC);
  const rand = makeRng(1005);
  let t = 0.3; // small lead-in before the first hit
  while (t < RANDOM_DURATION_SEC) {
    const kind = Math.floor(rand() * 3);
    if (kind === 0) kick(buf, SR, t, 1, rand);
    else if (kind === 1) snare(buf, SR, t, 1, rand);
    else hat(buf, SR, t, 0.6, rand, false);
    t += RANDOM_GAP_MIN_SEC + rand() * (RANDOM_GAP_MAX_SEC - RANDOM_GAP_MIN_SEC);
  }
  for (let padStart = 0; padStart < RANDOM_DURATION_SEC; padStart += 3) {
    pad(buf, SR, padStart, CHORDS[(padStart / 3) % CHORDS.length]!, 3, 0.7);
  }

  return { name: "random", mono: finish(buf), tempo: [], beats: [] };
}

export function buildTracks(): Track[] {
  return [house(), hiphop(), dnb(), ramp(), randomTrack()];
}
