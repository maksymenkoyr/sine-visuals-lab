// Toon Rave's motion: the whole picture as a pure function of the cycle
// position. A port of the cartoon-rave prototype's `frame(T)` (docs/scenes/
// toonrave.md says where the prototype came from), generalised from its one
// 32-beat cycle to several lengths and camera-cut levels.
//
// frameAt(c, opts) returns a plain description of the picture -- a FrameState:
// rig matrices, fx opacities, which cel each part shows, the crowd's eye
// classes, the LED meters, the ray fade, the camera and the impact-frame
// amount. Nothing here reads wall time or Math.random, so the same `c` always
// gives the same picture. The Canvas2D drawer (svgDraw.ts) turns a FrameState
// into pixels; conductor.ts turns the app's beat clock into `c`.
//
// Time. `c` is the cycle position in beats, 0 <= c < cycleBeats, with the drop
// at c = 0 (c is wrapped, so frameAt(c) equals frameAt(c + cycleBeats)). The
// cycle has three parts, all in beats from the drop:
//   aftermath [0, 16)                  the drop's gags, as the prototype plays them
//   groove    [16, cycleBeats - 8)     the cast dances; the poses repeat on their
//                                      own periods (a blink every few bars, the
//                                      stick's two-beat arc), so a longer cycle
//                                      is a longer groove, not slower motion
//   build     [cycleBeats - 8, end)    crouch, leap, hover, strobe -- always the
//                                      last eight beats, whatever the length
// Inside the build every pose runs on `c - (cycleBeats - 8) + BUILD_AT`, so it
// is the prototype's beats 24..32 exactly; for cycleBeats = 32 the groove is the
// prototype's own [16, 24) and the whole function equals the prototype.
//
// "On twos". Characters and props read cq, c snapped down to a whole step of
// 1/stepsPerBeat(bpm) beat (about 12 fps, locked to the beat so a hit lands on
// its beat). Lights, lasers, rays, the button glow and the camera read the
// continuous c and move at display rate.
//
// Dance. MotionOpts.castC, when given, is the cast's own cycle position: the DJ,
// the guy and his hair, the kid, the raver and her stick, the crowd and the button
// they hit read their Timing from it, while the lights, rays, confetti and camera
// keep `c`; castC = c gives exactly the picture without it. MotionOpts.move, when
// given with a groove castC, stands in for the groove's own bounce curve: every
// groove pose that reads bounce(ph) reads move.b instead (the hair's lag reads
// move.lag, the crowd's offset rows move.off), so the cast dances the move Dance
// learned (dance.ts) at the speed Energy sets, through the same poses.
//
// Cuts. `cuts` 0 holds the wide shot all cycle. 1, 2 and 3 are the prototype's
// "Camera cuts" levels 0, 1 and 2 (see cutPlan): a new groove shot every 4, 2
// and 1 bars. The drop is always wide, and the same shot never appears twice in
// a row, including across the wrap. The picks vary per cycle through
// MotionOpts.cycle (the index of the cycle; the default 0 makes frameAt
// periodic); the hash that picks them is the prototype's.
//
// The impact frame. For c < IMPACT_BEATS after the drop the picture is the
// hero frame thresholded to two colours: `impact` is 1 there and `impactInvert`
// is true in its second half (the inverted pair), as the prototype's two
// filters impactA and impactB. The shake is the prototype's noise shake, kept
// apart from the camera: FrameState.camera has the shot's source rectangle and
// the shake offset separately, and cameraMatrix() composes them.
//
// The rig geometry at the bottom of this file (pivots, anchors, the hero
// matrices, the confetti seed, the lit LED pattern) is the drawing's own
// numbers, copied from the art builders in art/; tests/toonrave.test.ts holds
// the golden frames that would catch a drift between the two.

// --- types ----------------------------------------------------------------------------------
/** A 2D affine matrix [a b c d e f], in SVG order. */
export type Mat = [number, number, number, number, number, number];

/** The camera shots. */
export type ShotId = "wide" | "dj" | "djUp" | "button" | "raver" | "pomp" | "crowd";

export type Slot = "front" | "back";

/** The crowd rows' eye classes (ev0 = hero eyes, ev1 = calm, ev2 = wide). */
export type EyeClass = "ev0" | "ev1" | "ev2";

export interface MotionOpts {
  /** Beats per cycle: 32, 64 or 128 beats (8, 16 or 32 bars). */
  cycleBeats: 32 | 64 | 128;
  /** 0 holds the wide shot; 1, 2, 3 cut every 4, 2, 1 bars in the groove. */
  cuts: 0 | 1 | 2 | 3;
  /** Tempo, which only sets the size of an animation step (stepsPerBeat). */
  bpm: number;
  /** Index of the cycle, which varies the groove's shot picks. Default 0. */
  cycle?: number;
  /** Reduced motion: no shake, no impact frame, no strobes. Default false. */
  reduced?: boolean;
  /** The cast's own cycle position (see "Dance" above); wrapped into the cycle.
   *  Absent: `c`. */
  castC?: number;
  /** The groove's bounce values from the learned move (see "Dance" above), each
   *  -1 (stretched) .. 1 (squashed): `b` now, `lag` one step back, `off` half a
   *  beat along for the crowd's offset rows. Read by the poses' bounce branches,
   *  which also cover some of the gags: index.ts gives it only in the groove. */
  move?: GrooveMove;
}

export interface GrooveMove { b: number; lag: number; off: number }

export interface Camera {
  shot: ShotId;
  /** The shot's 16:9 source rectangle, in the 1600x900 art's units. */
  src: { x: number; y: number; w: number; h: number };
  /** The shake: a shift in art units and a rotation in degrees about the frame's centre. */
  shake: { x: number; y: number; rot: number };
}

/**
 * Everything the drawer needs for one picture. Keys of `x` are rig ids (the
 * markup's data-x), of `o` fx ids (data-o), of `cel` part names (data-cel is
 * "part:name"), of `cls` crowd rig ids, as in the prototype's markup.
 */
export interface FrameState {
  /** The cycle position the picture is for (wrapped into [0, cycleBeats)). */
  c: number;
  /** Rig matrices by rig id. */
  x: Record<string, Mat>;
  /** fx opacities by fx id, 0..1. */
  o: Record<string, number>;
  /** The cel shown per part. */
  cel: Record<string, string>;
  /** The crowd rows' eye classes, by rig id (crowd0..2). */
  cls: Record<string, EyeClass>;
  /** Which layer the DJ and the glowstick sit in: behind or in front of the button / raver. */
  slot: { dj: Slot; stick: Slot };
  /** The LED meters, [column][bar] lit or not. */
  led: boolean[][];
  /** The blast rays' fade, 0..1 (the rays' own turn is in x.rays); each ray group's opacity is its data-ray times this. */
  rayOp: number;
  camera: Camera;
  /** The impact frame's amount, 0..1 (it is 1 or 0). */
  impact: number;
  /** True in the impact frame's second half: the inverted colour pair. */
  impactInvert: boolean;
}

// --- constants --------------------------------------------------------------------------------
/** The art's size. */
export const FRAME_W = 1600;
export const FRAME_H = 900;
/** The hero frame holds from the impact until here (beats). */
export const HOLD = 0.5;
/** The impact frame lasts this long after the drop (beats; about 2 display frames). */
export const IMPACT_BEATS = 0.07;
/** Where the groove starts, and where the aftermath's gags are over (beats from the drop). */
export const GROOVE_AT = 16;
/** The build is this many beats long, at the end of the cycle. */
export const BUILD_BEATS = 8;
/** The prototype's beat 24: the build's position inside the pose code. */
const BUILD_AT = 24;
/** Animation steps per beat ("on twos", about 12 fps at 128 BPM). */
export const stepsPerBeat = (bpm: number): number => Math.max(4, Math.round(720 / bpm));

const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const seg = (c: number, a: number, b: number): number => clamp((c - a) / (b - a));
const smooth = (t: number): number => t * t * (3 - 2 * t);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const back = (t: number, s = 1.70158): number => { const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
const elastic = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * 2 * Math.PI / 3) + 1);
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const hash = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const vnoise = (x: number): number => { const i = Math.floor(x), f = smooth(x - i); return lerp(hash(i), hash(i + 1), f) * 2 - 1; };
const decay = (ph: number, k: number): number => Math.exp(-ph * k);

// --- matrices ----------------------------------------------------------------------------------
const MX = {
  I: [1, 0, 0, 1, 0, 0] as Mat,
  mul(A: Mat, B: Mat): Mat {
    return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  },
  chain(...Ms: Mat[]): Mat { return Ms.reduce((a, b) => MX.mul(a, b), MX.I); },
  T: (x: number, y: number): Mat => [1, 0, 0, 1, x, y],
  R(deg: number): Mat { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; },
  S: (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0],
  about(px: number, py: number, M: Mat): Mat { return MX.chain(MX.T(px, py), M, MX.T(-px, -py)); },
};

interface Pose { x?: number; y?: number; r?: number; sx?: number; sy?: number }
/** A pose about a pivot: translate (x,y), rotate r degrees, scale (sx,sy), all around (px,py). */
function poseM(px: number, py: number, p: Pose = {}): Mat {
  return MX.chain(MX.T(p.x || 0, p.y || 0), MX.about(px, py, MX.mul(MX.R(p.r || 0), MX.S(p.sx ?? 1, p.sy ?? 1))));
}

/**
 * The matrix of a camera: the shot's source rectangle fills the frame, then
 * the shake is applied on top. It is the identity for a full-frame source with
 * no shake (the hero frame).
 */
export function cameraMatrix(cam: Camera): Mat {
  const { src, shake } = cam;
  const s = FRAME_W / src.w;
  let M = MX.chain(MX.T(FRAME_W / 2, FRAME_H / 2), MX.S(s), MX.T(-(src.x + src.w / 2), -(src.y + src.h / 2)));
  if (shake.x !== 0 || shake.y !== 0 || shake.rot !== 0) {
    M = MX.chain(MX.T(shake.x, shake.y), MX.about(FRAME_W / 2, FRAME_H / 2, MX.R(shake.rot)), M);
  }
  return M;
}

// --- the groove's body curve ---------------------------------------------------------------------
/**
 * +1 squash on the beat, -1 stretch on the off-beat. Sampled on twos it snaps:
 * hit, rebound past the stretch (overshoot), hold, fall into the next beat.
 */
function bounce(ph: number): number {
  if (ph < 0.08) return 1;
  if (ph < 0.5) return lerp(1, -1, back(seg(ph, 0.08, 0.5), 2.2));
  return lerp(-1, 1, easeIn(seg(ph, 0.5, 1)));
}
/** Blast light: full at the drop, gone 5 beats later. The characters' pink rim lights follow it. */
const blastI = (c: number): number => (c < 1 ? 1 : 1 - smooth(seg(c, 1, 5)));

/**
 * The timing every pose reads: cq is the stepped position (inside the build,
 * shifted to the prototype's beats 24..32), `build` is true in the build,
 * where the groove's open-ended poses give way to the build's.
 */
interface Timing { cq: number; spb: number; build: boolean; reduced: boolean; move?: GrooveMove }

// --- the DJ -----------------------------------------------------------------------------------
const DJ_FEET = [455, 540], DJ_NECK = [420, 362], STAND_Y = 26;
interface DjPose { root: Pose; head: Pose; phones: number; legs: string; torso: string; eyes: string; slot: Slot }
function djPose(T: Timing): DjPose {
  const { cq, spb } = T, ph = mod(cq, 1), beat = Math.floor(cq);
  const P: DjPose = { root: {}, head: {}, phones: 0, legs: "stand", torso: "pumpL", eyes: "hero", slot: "back" };
  if (cq < HOLD) return { ...P, legs: "hero", torso: "hero", slot: "front" };
  if (cq < 2.25) { // bounces off the button and drops behind it, cackling
    const t = seg(cq, HOLD, 2.25);
    if (t < 0.3) { P.root = { y: -64 * easeOut(t / 0.3), r: -6 * t / 0.3 }; P.legs = "hero"; P.torso = "windup"; P.slot = "front"; }
    else if (t < 0.7) { const u = (t - 0.3) / 0.4; P.root = { y: lerp(-64, STAND_Y, easeIn(u)), r: -6 * (1 - u) }; P.legs = u > 0.4 ? "stand" : "hero"; P.torso = "pumpR"; }
    else { const u = 1 - seg(t, 0.7, 1); P.root = { y: STAND_Y + 6 * u, sy: 1 - 0.16 * u, sx: 1 + 0.12 * u }; P.torso = "pumpL"; }
    P.head = { r: (Math.floor(cq * spb) % 2 ? 5 : -5) * (1 - t) };
    P.eyes = t > 0.75 ? "blink" : "hero";
    return P;
  }
  if (!T.build) { // the groove
    const b = T.move ? T.move.b : bounce(ph), bl = T.move ? T.move.lag : bounce(mod(ph - 1 / spb, 1));
    P.root = { y: STAND_Y + (b > 0 ? 5 * b : 12 * b), sy: 1 - 0.05 * b, sx: 1 + 0.04 * b };
    P.head = { sy: 1 - 0.08 * b, sx: 1 + 0.05 * b, r: (beat % 2 ? 4 : -4) * (ph < 0.08 ? 1.4 : 1) };
    P.phones = bl < 0 ? 14 * bl : 5 * bl; // the headphones jump a step late
    P.torso = beat % 2 ? "pumpR" : "pumpL";
    if (Math.floor(cq / 4) % 2 && beat % 4 === 2 && ph > 0.3 && ph < 0.55) P.eyes = "blink";
    return P;
  }
  // the build: crouch, leap, hover in a wind-up squash that tightens to the drop
  P.torso = "windup";
  const pulse = cq < 28 ? decay(ph, 5) : decay(mod(cq * 2, 1), 5);
  if (cq < 26) {
    const u = easeOut(seg(cq, 24, 25));
    P.root = { y: STAND_Y + 14 * u, sy: 1 - 0.12 * u - 0.04 * pulse, sx: 1 + 0.08 * u };
    P.head = { sy: 1 - 0.06 * u, r: -3 * u };
  } else if (cq < 26.75) {
    const u = seg(cq, 26, 26.75), y = lerp(STAND_Y + 14, -50, back(u, 1.4));
    P.root = { y, sy: lerp(1.16, 1, u), sx: lerp(0.9, 1, u), r: -4 * u };
    P.legs = "hero"; P.slot = y < 10 ? "front" : "back";
  } else {
    const u = seg(cq, 26.75, 31.5), w = seg(cq, 31.5, 32);
    const shake = cq >= 28 && !T.reduced ? (Math.floor(cq * spb) % 2 ? 1 : -1) * (1.5 + 3.5 * seg(cq, 28, 32)) : 0;
    P.root = { x: shake, y: -50 - 44 * u - 10 * w - 6 * pulse, sy: 0.92 - 0.04 * pulse - 0.1 * w, sx: 1.06 + 0.04 * pulse + 0.08 * w, r: -4 - 4 * w + shake * 0.5 };
    P.head = { r: -4 - 6 * w, sy: 1 - 0.05 * pulse };
    P.legs = "hero"; P.slot = "front";
  }
  return P;
}

// --- the button -------------------------------------------------------------------------------
function domePose(T: Timing): Pose {
  const { cq } = T, ph = mod(cq, 1);
  if (cq < HOLD) return {};
  if (cq < 1.75) { const e = elastic(seg(cq, HOLD, 1.75)); return { sy: 1 + 0.15 * e, sx: 1 - 0.02 * e }; }
  if (!T.build) { const k = Math.max(0, T.move ? T.move.b : bounce(ph)); return { sy: 1.15 - 0.07 * k, sx: 0.98 + 0.04 * k }; }
  const p = cq < 28 ? decay(ph, 5) : decay(mod(cq * 2, 1), 5);
  return { sy: 1.15 + 0.08 * p, sx: 0.98 - 0.02 * p };
}

// --- the pompadour raver and his hairpiece -----------------------------------------------------
interface GuyPose { root: Pose; head: Pose; legs: string; torso: string; eyes: string; brows: string; mouth: string; bald: boolean }
function guyPose(T: Timing): GuyPose {
  const { cq, spb } = T, ph = mod(cq, 1), beat = Math.floor(cq);
  const P: GuyPose = { root: { r: 0 }, head: {}, legs: "stand", torso: "pumpA", eyes: "normal", brows: "calm", mouth: "smile", bald: cq < 16 };
  const groove = (amt = 1): void => {
    const b = T.move ? T.move.b : bounce(ph);
    P.root = { r: 0, y: amt * (b > 0 ? 3 * b : 7 * b), sy: 1 - 0.03 * b * amt };
    P.head = { y: 5 * Math.max(b, 0) * amt, sy: 1 - 0.05 * b * amt, r: (beat % 2 ? 3 : -3) * amt };
    P.torso = beat % 2 ? "pumpB" : "pumpA";
  };
  if (cq < HOLD) return { ...P, root: { r: 22 }, legs: "hero", torso: "hero", eyes: "hero", brows: "hero", mouth: "hero", bald: true };
  if (cq < 1) return { ...P, root: { r: 22 + 6 * seg(cq, HOLD, 1) }, legs: "hero", torso: "hero", eyes: "hero", brows: "hero", mouth: "hero", bald: true };
  if (cq < 2.25) {
    const t = seg(cq, 1, 2.25);
    P.root = { r: 28 * (1 - back(t, 1.6)), sy: t > 0.45 && t < 0.7 ? 0.9 : 1 };
    Object.assign(P, { legs: t < 0.4 ? "hero" : "stand", torso: "hero", eyes: "hero", brows: "hero", mouth: "hero" });
    return P;
  }
  if (cq < 4) { P.head = { r: Math.sin(cq * 9) * 3 }; return Object.assign(P, { torso: "hero", eyes: cq < 3 ? "hero" : "up", brows: "hero", mouth: "hero" }); }
  if (cq < 8) { groove(0.8); return Object.assign(P, { eyes: beat % 2 ? "up" : "normal", brows: "calm", mouth: "flat" }); }
  if (cq < 14) { groove(0.5); P.torso = "crouch"; return Object.assign(P, { eyes: "left", brows: "sad", mouth: "flat" }); } // sulks, arms down, so the gag stays clear
  if (cq < 16) { P.head = { r: -4 * seg(cq, 14, 16) }; return Object.assign(P, { torso: "hero", eyes: "up", brows: "hero", mouth: "hero" }); }
  if (cq < 17) {
    const u = 1 - seg(cq, 16, 16.5);
    P.root = { r: 0, sy: 1 - 0.1 * u, sx: 1 + 0.06 * u };
    return Object.assign(P, { torso: "pumpB", eyes: cq < 16.4 ? "blink" : "normal", brows: "calm", mouth: "smile" });
  }
  if (!T.build) { groove(1); if (Math.floor(cq / 4) % 2 === 0 && beat % 4 === 3 && ph > 0.4 && ph < 0.65) P.eyes = "blink"; return P; }
  const p = cq < 28 ? decay(ph, 5) : decay(mod(cq * 2, 1), 5), u = seg(cq, 24, 25);
  P.root = { r: 0, y: 10 * u + 3 * p, sy: 1 - 0.07 * u - 0.03 * p, sx: 1 + 0.04 * u };
  P.head = { r: Math.sin(cq * spb * 2.1) * 1.5 * seg(cq, 28, 32) };
  return Object.assign(P, { legs: "crouch", torso: "crouch", eyes: "hero", brows: "hero", mouth: "hero" });
}
function guyMatrices(P: GuyPose): { root: Mat; head: Mat } {
  return { root: guyM(P.root), head: poseM(GUY_NECK[0], GUY_NECK[1], P.head) };
}

// --- the flag kid -----------------------------------------------------------------------------
interface KidPose { cel: string; root: Pose }
function kidPose(T: Timing): KidPose {
  const { cq, spb } = T, ph = mod(cq, 1), beat = Math.floor(cq);
  if (cq < HOLD) return { cel: "hero", root: {} };
  if (cq < 2) return { cel: Math.floor(cq * spb) % 2 ? "flap" : "hero", root: { y: Math.floor(cq * spb) % 2 ? -2 : 0 } };
  if (cq < 2.75) {
    const u = seg(cq, 2, 2.75);
    return { cel: "standA", root: { y: -46 * Math.sin(Math.PI * Math.min(1, u * 1.25)), sy: u > 0.8 ? 0.84 : 1, sx: u > 0.8 ? 1.12 : 1 } };
  }
  if (!T.build) {
    const b = T.move ? T.move.b : bounce(ph), heavy = cq >= 8 && cq < 14 ? 0.55 : 1;
    const R: Pose = { y: heavy * (b > 0 ? 3 * b : 14 * b), sy: 1 - 0.07 * b * heavy, sx: 1 + 0.05 * b * heavy };
    if (cq >= 8 && cq < 9) { const u = 1 - elastic(seg(cq, 8, 9)); R.sy = 1 - 0.3 * u; R.sx = 1 + 0.2 * u; R.y = 0; }
    if (cq >= 14 && cq < 14.5) { R.sy = 0.86; R.sx = 1.1; R.y = 0; }
    return { cel: beat % 2 ? "standB" : "standA", root: R };
  }
  const p = cq < 28 ? decay(ph, 5) : decay(mod(cq * 2, 1), 5);
  return { cel: "crouch", root: { y: 2 * p, sy: 1 - 0.04 * p, x: Math.sin(cq * spb * 3.3) * 1.2 * seg(cq, 28, 32) } };
}
const kidM = (P: KidPose): Mat => MX.mul(MX.T(KID_ROOT[0], KID_ROOT[1]), poseM(KID_FEET[0], KID_FEET[1], P.root));

// --- the round raver and her glowstick ----------------------------------------------------------
interface RaverPose { root: Pose; torso: string; eyes: string; mouth: string; hair: string }
function raverPose(T: Timing): RaverPose {
  const { cq, spb } = T, ph = mod(cq, 1), beat = Math.floor(cq), step = Math.floor(cq * spb);
  const P: RaverPose = { root: { r: 4 }, torso: "hero", eyes: "hero", mouth: "smile", hair: "calmA" };
  if (cq < HOLD) return { ...P, root: { r: 8 }, hair: "hero", mouth: "hero" };
  if (cq < 2) return { ...P, root: { r: 8 + (step % 2 ? 0.8 : 0) }, hair: step % 2 ? "stream2" : "hero", mouth: "hero" };
  if (cq < 6) {
    const u = seg(cq, 2, 2.5);
    P.root = { r: lerp(8, 4, u), sy: u < 1 ? 1 - 0.05 * Math.sin(u * Math.PI) : 1 };
    P.hair = cq < 2.25 ? "calmB" : "calmA"; P.eyes = cq < 3 ? "hero" : "up"; P.mouth = "hero";
    return P;
  }
  if (cq < 8) { // caught it: a happy squeeze, stick held high
    const u = 1 - seg(cq, 6, 6.6);
    P.root = { r: 4, sy: 1 - 0.08 * u, sx: 1 + 0.05 * u, y: 6 * u };
    P.eyes = cq < 6.6 ? "blink" : "hero"; P.torso = "w2";
    P.hair = Math.floor(cq * 2) % 2 ? "calmB" : "calmA";
    return P;
  }
  if (!T.build) {
    const b = T.move ? T.move.b : bounce(ph), u = mod(cq, 2) / 2, tri = u < 0.5 ? u * 2 : 2 - u * 2;
    P.root = { r: 4 + 2 * b, y: b > 0 ? 4 * b : 9 * b };
    P.torso = "w" + Math.min(3, Math.floor(tri * 4));
    P.hair = Math.floor(cq * 2) % 2 ? "calmB" : "calmA";
    if (Math.floor(cq / 4) % 4 === 2 && beat % 4 === 1 && ph > 0.3 && ph < 0.55) P.eyes = "blink";
    return P;
  }
  const p = cq < 28 ? decay(ph, 5) : decay(mod(cq * 2, 1), 5);
  P.root = { r: 4 + Math.sin(cq * spb * 2.7) * 1.2 * seg(cq, 28, 32), y: 4 + 3 * p };
  return Object.assign(P, { torso: "w1", eyes: "pin", mouth: "hero", hair: "calmA" });
}

/** World matrix for the glowstick held in her mitten (inside her rig, scaled back to world size). */
function stickHeld(raverRoot: Mat, torso: string): Mat {
  const a = RAVER_MITTEN[torso]!;
  return MX.chain(raverRoot, MX.T(a[0], a[1]), MX.R(a[2]), MX.S(1 / 0.74), MX.T(46, 0));
}
type V2 = [number, number];
const qbez = (a: V2, b: V2, c: V2, t: number): V2 => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]];
const place = (p: V2, rot: number, s: number): Mat => MX.chain(MX.T(p[0], p[1]), MX.R(rot), MX.S(s));
const posOf = (M: Mat): V2 => [M[4], M[5]];
const rotOf = (M: Mat): number => Math.atan2(M[1], M[0]) * 180 / Math.PI;
const scaleOf = (M: Mat): number => Math.hypot(M[0], M[1]);

// --- the camera -------------------------------------------------------------------------------
/**
 * Shots are 16:9 crops of the 1600x900 frame (after the Dutch tilt): centre,
 * width, and a drift (push-in factor and centre travel over the shot).
 */
const SHOTS: Record<ShotId, { c: V2; w: number; zoom: number; move: V2 }> = {
  wide: { c: [800, 450], w: 1600, zoom: 0.05, move: [10, -6] },
  dj: { c: [356, 372], w: 860, zoom: 0.07, move: [12, 6] },
  djUp: { c: [440, 400], w: 1040, zoom: 0.12, move: [0, -20] },
  button: { c: [476, 586], w: 680, zoom: 0.08, move: [-8, 4] },
  raver: { c: [1270, 700], w: 720, zoom: 0.07, move: [-10, -6] },
  pomp: { c: [1080, 360], w: 800, zoom: 0.06, move: [14, -4] },
  crowd: { c: [860, 420], w: 580, zoom: 0.02, move: [560, -36] },
};

/** A cut: a shot from `at` beats (from the drop) until the next cut. */
export type Cut = [at: number, shot: ShotId];

/**
 * The edit for one cycle. `cycle` is the cycle's index (the groove's picks vary
 * per cycle). `cuts` 1, 2, 3 are the prototype's levels 0, 1, 2:
 *  - the aftermath cuts to the gags (level 1: the pompadour at beat 8; level 2:
 *    the raver, the crowd and the pompadour on bars 2 to 4);
 *  - the groove cuts every 16, 8 or 4 beats (4, 2, 1 bars), each pick
 *    avoiding the shot before it (level 2 alternates two lists);
 *  - the build is the prototype's, from its first beat.
 */
export function cutPlan(cycle: number, cuts: number, cycleBeats: number): Cut[] {
  if (cuts <= 0) return [[0, "wide"]];
  const level = cuts - 1, buildAt = cycleBeats - BUILD_BEATS;
  const pick = (n: number, list: ShotId[]): ShotId => list[Math.floor(hash(n * 7.13 + level) * list.length)]!;
  const plan: Cut[] = [[0, "wide"]];
  if (level === 1) plan.push([8, "pomp"]);
  else if (level === 2) plan.push([4, "raver"], [8, "crowd"], [12, "pomp"]);
  const period = [16, 8, 4][level]!;
  for (let t = GROOVE_AT, j = 0; t < buildAt; t += period, j++) {
    const list: ShotId[] = level === 2 ? (j % 2 === 0 ? ["dj", "wide", "raver"] : ["crowd", "dj", "pomp"]) : ["dj", "raver", "crowd"];
    const prev = plan[plan.length - 1]![1];
    plan.push([t, pick(cycle + 0.5 * j, list.filter((s) => s !== prev))]);
  }
  const B = buildAt;
  if (level === 0) plan.push([B, "button"], [B + 4, "djUp"]);
  else if (level === 1) plan.push([B, "button"], [B + 2, "crowd"], [B + 4, "raver"], [B + 6, "djUp"]);
  else plan.push([B, "button"], [B + 2, "pomp"], [B + 4, "crowd"], [B + 5, "raver"], [B + 6, "button"], [B + 7, "djUp"]);
  return plan;
}
function shotAt(c: number, plan: Cut[], cycleBeats: number): { name: ShotId; u: number } {
  let i = 0;
  while (i + 1 < plan.length && plan[i + 1]![0] <= c) i++;
  const start = plan[i]![0], end = i + 1 < plan.length ? plan[i + 1]![0] : cycleBeats;
  return { name: plan[i]![1], u: (c - start) / (end - start) };
}
function cropOf(name: ShotId, u: number): { x: number; y: number; w: number; h: number } {
  const S = SHOTS[name], e = smooth(clamp(u));
  const w = S.w * (1 - S.zoom * e), h = w * 9 / 16;
  let cx = S.c[0] + S.move[0] * e, cy = S.c[1] + S.move[1] * e;
  cx = clamp(cx, w / 2, FRAME_W - w / 2); cy = clamp(cy, h / 2, FRAME_H - h / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// --- the frame ----------------------------------------------------------------------------------
/** The picture at cycle position `cIn` (beats from the drop; wrapped into the cycle). */
export function frameAt(cIn: number, opts: MotionOpts): FrameState {
  const { cycleBeats, cuts, bpm } = opts;
  const k = opts.cycle ?? 0, reduced = opts.reduced === true;
  const buildAt = cycleBeats - BUILD_BEATS, shift = buildAt - BUILD_AT;
  const cNat = mod(cIn, cycleBeats), spb = stepsPerBeat(bpm);
  // the stepped clock in the pose code's own time (the shift is a whole number of
  // steps, so the stepped time is an exact step / spb)
  const timingAt = (cw: number): Timing => {
    const n = Math.floor(cw * spb + 1e-6), b = n / spb >= buildAt;
    return { cq: b ? (n - shift * spb) / spb : n / spb, spb, build: b, reduced };
  };
  // the continuous clock, in the pose code's own time
  const build = cNat >= buildAt, c = build ? cNat - shift : cNat;
  const T = timingAt(cNat);
  const { cq } = T;
  const ph = mod(c, 1), beatN = Math.floor(c);
  // the cast's timing: the cycle's, or its own cycle position when given
  const TC: Timing = opts.castC !== undefined ? { ...timingAt(mod(opts.castC, cycleBeats)), move: opts.move } : T;
  const cqc = TC.cq;
  const F: FrameState = {
    c: cNat, x: {}, o: {}, cel: {}, cls: {}, slot: { dj: "back", stick: "front" }, led: [], rayOp: 0,
    camera: { shot: "wide", src: { x: 0, y: 0, w: FRAME_W, h: FRAME_H }, shake: { x: 0, y: 0, rot: 0 } },
    impact: 0, impactInvert: false,
  };
  const hero = c < HOLD;
  const I = blastI(c);

  // blast, rays, impact FX
  F.rayOp = I > 0.002 ? I * (hero ? 1 : 0.82 + 0.18 * decay(ph, 4)) : 0;
  F.x.rays = MX.about(BX, BY, MX.R(hero ? 0 : (c - HOLD) * 1.4));
  F.o.glowCore = hero ? 1 : 1 - seg(c, HOLD, 3);
  const st = seg(c, HOLD, 1.5);
  F.o.star = hero ? 1 : 1 - st;
  F.x.star = MX.about(BX, BY - 30, MX.S(1 + 0.6 * easeOut(st)));
  const rg = seg(c, HOLD, 1.6);
  F.o.rings = hero ? 1 : 1 - rg;
  F.x.rings = MX.about(BX, BY - 10, MX.S(1 + 0.9 * easeOut(rg)));
  F.o.impactStars = cq < 0.9 ? 1 : 0;
  F.o.debrisLine = cq < HOLD ? 1 : 0;
  F.o.pompFx = cq < HOLD ? 1 : 0;
  F.x.dome = poseM(BX, BY + 18, domePose(TC));
  // the button glows and pulses through the build: each beat in bar 7, each half-beat in bar 8
  let glow = 0;
  if (c >= 2 && !build) glow = (0.08 + 0.22 * decay(ph, 6)) * seg(c, 2, 4);
  else if (build) glow = reduced ? 0.3 + 0.5 * seg(c, BUILD_AT, 32) : c < 28 ? 0.25 + 0.6 * decay(ph, 5) : 0.5 + 0.5 * decay(mod(c * 2, 1), 5);
  F.o.btnGlow = glow;

  // confetti: keeps flying out from the hero frame, drifts, falls, gone by bar 3
  CONFETTI.forEach((p, i) => {
    const t = cq - HOLD;
    if (cq >= 8) { F.o["cf" + i] = 0; return; }
    if (t <= 0) { F.x["cf" + i] = MX.I; F.o["cf" + i] = 1; return; }
    const v = 150 + 90 * hash(i), dist = v * (1 - Math.exp(-1.3 * t)) / 1.3;
    const dx = Math.cos(p.a) * dist + Math.sin(t * 2.6 + i) * 14 * Math.min(t, 1);
    const dy = Math.sin(p.a) * dist * 0.85 + 11 * t * t;
    F.x["cf" + i] = MX.mul(MX.T(dx, dy), MX.about(p.x, p.y, MX.R((hash(i + 7) - 0.5) * 260 * t)));
    F.o["cf" + i] = 1 - seg(cq, 6, 8);
  });

  // the DJ
  const D = djPose(TC);
  F.x.dj = poseM(DJ_FEET[0]!, DJ_FEET[1]!, D.root);
  F.x.djHead = poseM(DJ_NECK[0]!, DJ_NECK[1]!, D.head);
  F.x.djPhones = MX.T(0, D.phones || 0);
  F.cel.djLegs = D.legs; F.cel.djTorso = D.torso; F.cel.djEyes = D.eyes;
  F.slot.dj = D.slot;
  F.o.djRim = I;

  // the pompadour raver
  const G = guyPose(TC), GM = guyMatrices(G);
  F.x.guy = GM.root; F.x.guyHead = GM.head;
  Object.assign(F.cel, { guyLegs: G.legs, guyTorso: G.torso, guyEyes: G.eyes, guyBrows: G.brows, guyMouth: G.mouth });
  F.o.guyShine = G.bald ? 1 : 0; F.o.guyRim = I;

  // the kid
  const K = kidPose(TC), KM = kidM(K);
  F.x.kid = KM; F.cel.kid = K.cel; F.o.kidRim = I;

  // the hairpiece: blown off at the drop, lands on the kid, hops home before the build
  const onKid = (Tk: Timing): Mat => { const P = kidPose(Tk), a = KID_HEAD[P.cel] || KID_HEAD.standA!; return MX.chain(kidM(P), MX.T(a[0], a[1]), MX.R(-24), MX.S(0.5)); };
  const onGuy = (Tg: Timing, crook: number): Mat => { const M = guyMatrices(guyPose(Tg)); return MX.chain(M.root, M.head, MX.T(1152, 222), MX.R(crook), MX.S(0.9)); };
  const wob = -7 * (TC.move ? TC.move.lag : bounce(mod(cqc - 1 / spb, 1))); // the hair's lag: last step's bounce
  let pomp: Mat = HERO_POMP, pompShow = 1;
  if (cqc < HOLD) pomp = HERO_POMP;
  else if (cqc < 2.5) {
    const t = seg(cqc, HOLD, 2.5);
    pomp = place(qbez([1440, 300], [1590, -40], [1780, -320], easeIn(t) * 0.6 + t * 0.4), -18 + 720 * easeOut(t), 0.82);
  } else if (cqc < 5.5) pompShow = 0;
  else if (cqc < 8) {
    const t = seg(cqc, 5.5, 8), end = onKid({ ...TC, cq: 8 });
    pomp = place(qbez([1180, -200], [1080, 80], posOf(end), 0.65 * t + 0.35 * t * t), lerp(-560, rotOf(end), easeOut(t)), lerp(0.82, scaleOf(end), t));
  } else if (cqc < 14) pomp = MX.mul(onKid(TC), MX.R(wob * 0.8));
  else if (cqc < 16) {
    const a = onKid({ ...TC, cq: 14 }), b = onGuy({ ...TC, cq: 16 }, -18), t = seg(cqc, 14.5, 16);
    if (cqc < 14.5) pomp = MX.mul(a, MX.about(0, 20, MX.S(1.12, 0.78)));
    else {
      const pa = posOf(a), pb = posOf(b), p: V2 = [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t) - 130 * 4 * t * (1 - t)];
      pomp = place(p, lerp(rotOf(a), rotOf(b) + 360, smooth(t)), lerp(scaleOf(a), scaleOf(b), t));
    }
  } else {
    const crook = cqc < 17 ? -18 : lerp(-18, 0, back(seg(cqc, 17, 17.75), 2));
    pomp = MX.mul(onGuy(TC, crook), MX.R(!TC.build ? wob : 0));
  }
  F.x.pomp = pomp; F.o.pomp = pompShow;

  // the round raver and her stick
  const R = raverPose(TC), RM = raverM(R.root);
  F.x.raver = RM;
  Object.assign(F.cel, { raverTorso: R.torso, raverEyes: R.eyes, raverMouth: R.mouth, raverHair: R.hair });
  F.o.raverRim = I;
  let stick: Mat = HERO_STICK, stickShow = 1;
  F.slot.stick = "front";
  if (cqc < HOLD) stick = HERO_STICK;
  else if (cqc < 2.5) {
    const t = seg(cqc, HOLD, 2.5), h = posOf(HERO_STICK);
    stick = place(qbez(h, [1560, 220], [1720, -200], t), -40 + 900 * easeOut(t), 1);
  } else if (cqc < 5) stickShow = 0;
  else if (cqc < 6) {
    const t = seg(cqc, 5, 6), end = stickHeld(raverM(raverPose({ ...TC, cq: 6 }).root), "w2");
    stick = place(qbez([1250, -140], [1230, 300], posOf(end), easeIn(t)), lerp(500, rotOf(end), easeOut(t)), 1);
  } else { stick = stickHeld(RM, R.torso); F.slot.stick = "back"; }
  F.x.stick = stick; F.o.stick = stickShow;
  F.o.stickGlow = cqc < 6 ? 1 : 0.6 + 0.4 * decay(mod(cqc, 1), 4);

  // the crowd: rows bounce half a beat apart; blown back at the drop; crouch wide-eyed in the build
  for (let r = 0; r < 3; r++) {
    let x = 0, y = 0, ev: EyeClass = "ev1";
    if (cqc < HOLD) ev = "ev0";
    else if (cqc < 2) {
      const t = seg(cqc, HOLD, 2), amt = (t < 0.2 ? easeOut(t / 0.2) : 1 - elastic(seg(t, 0.2, 1))) * [1, 0.6, 0.35][r]!;
      x = 20 * amt; y = -12 * amt; ev = "ev0";
    } else if (!TC.build) {
      const b = TC.move ? (r % 2 ? TC.move.off : TC.move.b) : bounce(mod(cqc + (r % 2) * 0.5, 1));
      y = b > 0 ? 3 * b : 8 * b;
    } else {
      const p = cqc < 28 ? decay(mod(cqc, 1), 5) : decay(mod(cqc * 2, 1), 5);
      y = 6 + 8 * seg(cqc, BUILD_AT, 32) + 2 * p; ev = "ev2";
    }
    F.x["crowd" + r] = MX.T(x, y); F.cls["crowd" + r] = ev;
  }

  // ceiling lamps: chase one lamp in four per beat; strobe through the build; all on at the drop
  const lampB = (i: number): number => {
    if (c < 1) return 1;
    let g = 0.26 + 0.74 * (mod(i - beatN, 4) === 0 ? decay(ph, 3) : 0);
    if (c < 2) g = lerp(1, g, seg(c, 1, 2));
    if (build) {
      if (reduced) g = 0.3 + 0.6 * seg(c, BUILD_AT, 32);
      else g = 0.18 + 0.82 * (c < 28 ? decay(mod(c * 2, 1), 7) : decay(mod(c * 4, 1), 7) * (mod(i + Math.floor(c * 4), 2) ? 1 : 0.6));
    }
    return g;
  };
  for (let i = 0; i < LAMP_COUNT; i++) { const b = lampB(i); F.o["lampGlow" + i] = 0.7 * b; F.o["lampDim" + i] = (1 - b) * 0.78; }
  // floor pads and booth lenses
  for (let i = 0; i < 4; i++) {
    let p = 1;
    if (c >= 1) p = !build ? 0.35 + 0.65 * (i % 2 === beatN % 2 ? decay(ph, 3) : 0.1) : reduced ? 0.6 : 0.4 + 0.6 * decay(mod(c * 2, 1), 5);
    if (c >= 1 && c < 2) p = lerp(1, p, seg(c, 1, 2));
    F.o["pad" + i] = p;
    let l = 0;
    if (c >= 1) l = !build ? (mod(beatN, 4) === i ? 0.75 * (1 - decay(ph, 4)) : 0.75) : (reduced ? 0.4 : (mod(Math.floor(c * 4), 4) === i ? 0 : 0.7));
    F.o["lens" + i] = l;
  }
  // LED meters: jump on the beat, fall back; climb through the build; the still's pattern at the drop
  for (let j = 0; j < LEDS_HERO.length; j++) {
    if (c < 1) { F.led[j] = LEDS_HERO[j]!.slice(); continue; }
    let lv: number;
    if (!build) lv = (0.5 + 0.5 * hash(beatN * 3 + j + k * 97)) * decay(ph, 2.4);
    else lv = 0.3 + 0.7 * seg(c, BUILD_AT, 32) - (c >= 28 && !reduced ? 0.25 * hash(Math.floor(c * 4) + j * 11) : 0);
    const n = Math.round(clamp(lv) * 9);
    F.led[j] = LEDS_HERO[j]!.map((_, i) => i >= 9 - n);
  }
  F.cel.scope = c < 1 ? "hero" : "k" + mod(beatN, 3);
  F.cel.wave = c < 1 ? "hero" : "k" + mod(beatN, 4);
  const spin = ["hero", "k1", "k2", "k3"][mod(Math.floor(cq * spb), 4)]!;
  F.cel.groove0 = cq < HOLD ? "hero" : spin; F.cel.groove1 = cq < HOLD ? "hero" : spin;

  // lasers: sweep across the room, swapping direction every bar; lock onto the button in the build
  const lz = c < 4 ? 0 : seg(c, 4, 5);
  LASERS.forEach(([sx, sy], i) => {
    const bar = Math.floor(c / 4), u = mod(c, 4) / 4, e = smooth(bar % 2 ? 1 - u : u);
    let ang = i === 0 ? lerp(12, 70, e) : lerp(168, 112, e);
    if (build) {
      const tgt = Math.atan2(BY - 70 - sy, BX - sx) * 180 / Math.PI;
      ang = lerp(ang, tgt + (i ? 1 : -1) * (c < 28 ? 4 * Math.sin(c * Math.PI) : 0), smooth(seg(c, BUILD_AT, 26)));
    }
    F.x["laser" + i] = MX.chain(MX.T(sx, sy), MX.R(ang));
    let o = lz * (0.7 + 0.3 * decay(ph, 5));
    if (build && c >= 28 && !reduced) o *= mod(Math.floor(c * 4), 2) ? 1 : 0.45;
    F.o["laser" + i] = o;
  });

  // camera: the shot's source rectangle, the noise shake, and the impact frame (all on the continuous clock)
  const sh = shotAt(cNat, cutPlan(k, cuts, cycleBeats), cycleBeats);
  const cam = F.camera;
  cam.shot = sh.name;
  if (!(sh.name === "wide" && cNat < HOLD)) cam.src = cropOf(sh.name, sh.u);
  if (!reduced) {
    let A = 0;
    if (build) A = 9 * seg(c, BUILD_AT, 32) ** 2;
    else if (c >= HOLD && c < 1.6) A = 14 * (1 - seg(c, HOLD, 1.6)) ** 2;
    if (A > 0) {
      const n = c * 11;
      cam.shake = { x: vnoise(n) * A, y: vnoise(n + 37) * A, rot: vnoise(n + 71) * A * 0.07 };
    }
    if (cNat < IMPACT_BEATS) { F.impact = 1; F.impactInvert = cNat >= IMPACT_BEATS / 2; }
  }
  return F;
}

// --- the rig geometry ----------------------------------------------------------------------------
// The drawing's own numbers (see the header). BX/BY is the button's centre.
const BX = 470, BY = 588;
const LASERS: ReadonlyArray<readonly [number, number]> = [[150, 70], [1470, 60]];
const GUY_NECK: V2 = [1146, 470];
const KID_ROOT: V2 = [140, -4], KID_FEET: V2 = [820, 540];

// the pompadour raver's root matrix: the still's transform with pose overrides
function guyM(p: Pose = {}): Mat {
  return MX.chain(MX.T(p.x || 0, -10 + (p.y || 0)), MX.about(1150, 640, MX.S(0.9)), MX.about(1150, 560, MX.R(p.r ?? 22)), MX.about(1140, 650, MX.S(p.sx ?? 1, p.sy ?? 1)));
}
// the round raver's root matrix
function raverM(p: Pose = {}): Mat {
  return MX.chain(MX.T(1240 + (p.x || 0), 760 + (p.y || 0)), MX.S(0.74), MX.T(-1380, -690), MX.about(1380, 690, MX.mul(MX.R(p.r ?? 8), MX.S(p.sx ?? 1, p.sy ?? 1))));
}
// the hero matrices of the two props the still places with a transform
const HERO_POMP: Mat = MX.chain(MX.T(1440, 300), MX.R(-18), MX.S(0.82));
const HERO_STICK: Mat = MX.chain(MX.T(190, 70), MX.about(1250, 520, MX.R(-40)), MX.T(1255, 520));

// where the raver's mitten is per arm cel: [x, y, angle in degrees] at the arm's tip
const RAVER_MITTEN: Record<string, [number, number, number]> = (() => {
  const hx = 1380, hy = 690, sh: V2 = [1310, 840], out: Record<string, [number, number, number]> = {};
  const tip = (name: string, ex: number, ey: number): void => {
    const l = Math.hypot(ex - sh[0], ey - sh[1]);
    out[name] = [ex + (ex - sh[0]) / l * 13.5, ey + (ey - sh[1]) / l * 13.5, Math.atan2(ey - sh[1], ex - sh[0]) * 180 / Math.PI];
  };
  tip("hero", hx - 204, hy + 20);
  [-164, -149, -134, -119].forEach((a, i) => { const r = a * Math.PI / 180; tip("w" + i, sh[0] + Math.cos(r) * 188, sh[1] + Math.sin(r) * 188); });
  return out;
})();
// where the hairpiece sits on the kid's head per kid cel (the flag cels use standA's)
const KID_HEAD: Record<string, V2> = { standA: [822, 370], standB: [822, 370], crouch: [822, 384] };

// the lit LEDs in the still, [column][bar], read off the still's seeded draw
const LEDS_HERO: boolean[][] = ["011101100", "101110000", "011111101"].map((s) => s.split("").map((ch) => ch === "1"));
// the scallop lamps along the ceiling ring: x = -360, -264, ... while x < 2000
const LAMP_COUNT = Math.ceil((2000 + 360) / 96);

// confetti: the still's seeded scatter (its generator, in its draw order), one rig per kept piece
const CONFETTI: Array<{ x: number; y: number; a: number }> = (() => {
  let seed = 41;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const f1 = (n: number): number => Math.round(n * 10) / 10;
  const out: Array<{ x: number; y: number; a: number }> = [];
  for (let i = 0; i < 46; i++) {
    const a = (-150 + rnd() * 165) * Math.PI / 180, r = 240 + rnd() * 1200;
    const x = BX + Math.cos(a) * r, y = BY - 30 + Math.sin(a) * r * 0.85;
    if (x > 1600 || y > 900 || y < -10) continue;
    // the piece's colour, size and tilt draw from the same stream
    rnd(); rnd(); rnd(); rnd();
    out.push({ x: +f1(x), y: +f1(y), a });
  }
  return out;
})();
