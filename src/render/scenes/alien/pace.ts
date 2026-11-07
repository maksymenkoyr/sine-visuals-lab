/**
 * How many moves a dance makes in one loop of its clip, measured from the
 * clip's own frames. reel.ts plays every dance at one pace with it
 * (`pacedSeconds`, DANCE_PACE_HZ): a loop lasts as long as its moves take at
 * that pace, whatever tempo the dance was captured at.
 *
 * The captured tempos (`nativeBpm`, tools/clip-convert.mjs's estimate from
 * joint speed) don't say how fast a dance looks: played at one tempo, the
 * dances were no more even than as captured. Nor does any one measure of the
 * motion: the three below rank the dances differently, and evening out one of
 * them left the other two about as spread as before. Their geometric mean
 * evened out all three (the scene record's Measurements, 2026-11-07), so a
 * dance's moves are that mean of:
 *   - accents: peaks in the summed speed of the hands, feet and head;
 *   - that speed's spectral centroid, in cycles per loop;
 *   - the RMS frequency of those points about where they sit on average
 *     (their speed over their spread), in cycles per loop.
 * Each is counted in the clip's own frames and beats, never in seconds, so a
 * dance's moves don't change with the tempo it was captured at.
 *
 * Pure and DOM/GL-free — tests/alien.test.ts measures the shipped library.
 */
import { sampleClip, type Clip } from "../dancers/clipFormat.ts";
import { B, CH_LIFT, boneTail, createPose, createRigWorld, forwardKinematics, groundToFloor } from "../dancers/rig.ts";

const TIPS = [B.L_hand, B.R_hand, B.L_foot, B.R_foot, B.head];
const STRIDE = TIPS.length * 3;

// The accent rule. Smoothing over a fraction of a beat keeps one footfall's
// double bump one accent, and the gap keeps a shaky plateau from counting
// twice. Picked once, not tuned: the other two measures temper it.
const ACCENT_SMOOTH_BEATS = 1 / 8;
const ACCENT_GAP_BEATS = 1 / 4;
/** How far above the loop's median speed a peak must reach, as a share of the way to ACCENT_TOP's percentile. */
const ACCENT_RISE = 0.25;
const ACCENT_TOP = 0.9;
/** The centroid counts swings up to a sixteenth note: faster ones are capture
 *  jitter, and counted, they made the noisiest clips measure the fastest. */
const CENTROID_MAX_PER_BEAT = 4;

/** A dance's moves per loop (the header's geometric mean); 0 for a clip that doesn't move. */
export function danceMoves(clip: Clip): number {
  const n = clip.frames;
  if (n < 4 || !(clip.beats > 0)) return 0;
  const tips = trackTips(clip);
  const speed = new Float64Array(n);
  let step2 = 0;
  for (let i = 0; i < n; i++) {
    const a = i * STRIDE;
    const b = ((i + 1) % n) * STRIDE;
    let sum = 0;
    for (let k = 0; k < STRIDE; k += 3) {
      const dx = tips[b + k] - tips[a + k];
      const dy = tips[b + k + 1] - tips[a + k + 1];
      const dz = tips[b + k + 2] - tips[a + k + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      step2 += d2;
      sum += Math.sqrt(d2);
    }
    speed[i] = sum;
  }
  const moves = Math.cbrt(accents(speed, n / clip.beats) * centroid(speed, CENTROID_MAX_PER_BEAT * clip.beats) * swingRate(tips, n, step2));
  return Number.isFinite(moves) ? moves : 0;
}

/** Every tip's place on every frame, as the renderer poses him: n × STRIDE. */
function trackTips(clip: Clip): Float64Array {
  const n = clip.frames;
  const pose = createPose();
  const world = createRigWorld();
  const tip = new Float32Array(3);
  const out = new Float64Array(n * STRIDE);
  for (let i = 0; i < n; i++) {
    sampleClip(clip, i / n, pose);
    forwardKinematics(pose, world);
    groundToFloor(world, pose[CH_LIFT]);
    for (let t = 0; t < TIPS.length; t++) {
      boneTail(world, TIPS[t], tip, 0);
      out[i * STRIDE + t * 3] = tip[0];
      out[i * STRIDE + t * 3 + 1] = tip[1];
      out[i * STRIDE + t * 3 + 2] = tip[2];
    }
  }
  return out;
}

function accents(speed: Float64Array, framesPerBeat: number): number {
  const n = speed.length;
  const w = Math.max(1, Math.round(framesPerBeat * ACCENT_SMOOTH_BEATS));
  const gap = Math.max(1, Math.round(framesPerBeat * ACCENT_GAP_BEATS));
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -w; j <= w; j++) sum += speed[(i + j + n) % n];
    smooth[i] = sum / (2 * w + 1);
  }
  const sorted = Float64Array.from(smooth).sort();
  const median = sorted[Math.floor(n / 2)];
  const floor = median + ACCENT_RISE * (sorted[Math.floor(n * ACCENT_TOP)] - median);
  let count = 0;
  let first = -1;
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = smooth[i];
    if (v > floor && v > smooth[(i - 1 + n) % n] && v >= smooth[(i + 1) % n] && i - last >= gap) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  }
  // The loop is seamless, so the last peak and the first may sit within one gap across the seam.
  if (count > 1 && first + n - last < gap) count--;
  return count;
}

/** The spectral centroid of the speed's swing about its mean, in cycles per loop, up to `maxCycles`. */
function centroid(speed: Float64Array, maxCycles: number): number {
  const n = speed.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += speed[i] / n;
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let m = 0; m < n; m++) {
    cos[m] = Math.cos((2 * Math.PI * m) / n);
    sin[m] = Math.sin((2 * Math.PI * m) / n);
  }
  let weighted = 0;
  let total = 0;
  for (let k = 1; 2 * k < n && k <= maxCycles; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const m = (k * i) % n;
      re += (speed[i] - mean) * cos[m];
      im -= (speed[i] - mean) * sin[m];
    }
    const power = re * re + im * im;
    weighted += k * power;
    total += power;
  }
  return total > 0 ? weighted / total : 0;
}

/** The tips' RMS frequency about their mean places, in cycles per loop: `step2` is their summed squared step from one frame to the next. */
function swingRate(tips: Float64Array, n: number, step2: number): number {
  const mean = new Float64Array(STRIDE);
  for (let i = 0; i < n; i++) for (let k = 0; k < STRIDE; k++) mean[k] += tips[i * STRIDE + k] / n;
  let spread2 = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < STRIDE; k++) {
      const d = tips[i * STRIDE + k] - mean[k];
      spread2 += d * d;
    }
  }
  return spread2 > 0 ? (n * Math.sqrt(step2 / spread2)) / (2 * Math.PI) : 0;
}
