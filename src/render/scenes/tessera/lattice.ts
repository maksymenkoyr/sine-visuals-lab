// Tessera's pure side: the lattice (instance -> ring/slot -> world position),
// the pole-axis camera, the dolly timeline and the hue clock. No GL in here;
// index.ts owns drawing and glsl.ts mirrors this arithmetic in the vertex
// shader (gl_InstanceID decode, e1/e2 tangent frame, lobe/sectorHue) so a
// test here pins what the shader draws. See index.ts's file header for the
// measured picture this rebuild answers to (tools/.cache/refs/lZaThcqs-dk).
//
// The lattice: latitude rings from the pole outward at CONSTANT ARC-LENGTH
// spacing (latticeLayout below) -- round 2's fix. A constant slot count per
// ring (the original round-1 lattice) shrinks boxes to slivers near the pole
// (the sin(theta) azimuthal-pitch factor) and leaves them sparse near the
// equator; the reference's own angular box count instead GROWS with radius
// (measured ~24/40/60/84 boxes around rings at screen radii 0.2/0.3/0.45/0.6
// -- swift-weaving-parnas.md's brief). latticeLayout keeps the azimuthal
// pitch at each ring close to the fixed *meridional* pitch instead, so the
// lattice reads as a dense, roughly isotropic field of small boxes at any
// radius, not radial spokes.
//
// A box stands on the sphere normal N at each (ring, slot); its tangent
// frame is (e1 = d/dphi, e2 = d/dtheta), both unit and orthogonal to N by
// construction (they're the partials of a unit sphere parametrization). The
// last instance (ringStart[ringCount]) is a fixed white pole box, not part
// of the ring/slot grid -- instanceRingSlot returns null for it.
//
// The camera never leaves the pole axis (no yaw/pitch setting exists), so
// its basis is just a distance and a roll about the fixed forward=(0,-1,0):
// far simpler than a generic orbit camera (see shards/layout.ts's
// cameraBasis for that shape).

// 4 walls (long faces, open tube sides) + 4 end-cap-strip faces (a thin rim
// at the open end only, see glsl.ts) x 2 triangles x 3 verts. Round 2: the
// walls alone are flat quads whose own plane contains the length axis, so a
// box viewed close to end-on (most of the lattice in the near/starburst
// view, since the camera sits on the pole axis every box points roughly
// toward) would otherwise vanish edge-on -- the end-cap strips are what give
// every tube a visible "bright rectangular outline" from that angle, not
// just a cosmetic touch.
export const BOX_VERTS = 48;

/** World radius of the main ball's sphere, half-heights. Not a setting --
 *  the Dolly/FOV settings are what change the ball's apparent screen size. */
export const BALL_RADIUS = 1.0;
/** World radius of the dim backdrop shell (index.ts's second instanced
 *  draw) -- comfortably beyond the ball's own typical visual edge so it
 *  reads as a separate outer layer, not a continuation of the ball's own
 *  boxes, but well inside CAM_FAR (round 2: CAM_FAR shrank a great deal to
 *  match the now much smaller boxes -- the old SHELL_RADIUS of 2.6 left
 *  only a sliver of margin to the new, closer far camera, so the shell's own
 *  screen size ballooned past the ball's instead of sitting behind it). */
export const SHELL_RADIUS = 1.5;
/** How much of a wall's own length, from the open end inward, is pulled
 *  toward near-white. */
export const END_RIM_FRACTION = 0.06;
/** Flat shade for a face's INNER side (the facing test in boxVert -- round
 *  3's per-face constant, not a Lambert angle-to-camera term) -- never fully
 *  black, a faint ambient floor. */
export const INTERIOR_SHADE = 0.1;
/** Flat shade for a long wall's OUTER face (the facing test says the camera
 *  sits on the wall's own outward-normal side). The reference's faces are
 *  flat luminous colour on their lit side (frames/look_1.jpg,
 *  bursts/022.83). Round 5: both wall types now read at the same full
 *  shade -- the round-3 azimuth/meridian split (1.0 vs 0.8, "for a little of
 *  the reference's own per-face variation") is no longer worth the cost: the
 *  azimuth-facing walls (0/1) turn out to carry almost none of the mid/far
 *  view's own screen coverage on their own (their own across-extent,
 *  e2-based, foreshortens toward the view axis near the camera's own
 *  horizon -- see CAM_FAR's comment), so nearly everything the mid/far view
 *  actually shows is a meridian wall (2/3); dimming those on top of that
 *  scarcity was crushing those views far more than any azimuth/meridian
 *  variation was worth. */
export const WALL_SHADE_AZIMUTH = 1.0;
export const WALL_SHADE_MERIDIAN = 1.0;

/** The fixed white pole box: half-width/depth and length, half-heights --
 *  small and solid, sized against the round-2 near camera (see CAM_NEAR's
 *  comment) to read as roughly 0.07 half-heights wide on screen when close,
 *  the measured size of the reference's own centre box. */
export const POLE_HALF = 0.025;
export const POLE_LEN = 0.06;

/** Ring latitude range: rings run from just off the pole out to just past
 *  the equator, so the limb is still covered with boxes when the camera is
 *  far (the ball reads as a dome, not a flat disc with a bald edge). */
export const RING_THETA_MAX = (100 * Math.PI) / 180;

/** latticeLayout's azimuthal pitch, as a multiple of the fixed meridional
 *  pitch -- round 2: a ring's slot count is picked so its own azimuthal
 *  spacing (arc length) comes out close to `pitch * SLOT_PITCH_RATIO`
 *  rather than equal to the meridional pitch itself, because the boxes are
 *  visually wider than they are deep (Fill applies the same fraction to
 *  both, but a ring's neighbours-in-phi need a bit more breathing room than
 *  its neighbours-in-theta to avoid the azimuthal direction reading denser
 *  than the meridional one). */
export const SLOT_PITCH_RATIO = 0.62;
/** Hard cap on ring count -- also the GLSL side's array size for
 *  uRingStart/uRingSlots (glsl.ts's LATTICE_CONST_GLSL), so the vertex
 *  shader's ring-decode loop has a compile-time bound (GLSL ES 3.00 needs
 *  one). Never reached at the Pitch setting's own min (0.05 rad still only
 *  needs RING_THETA_MAX/0.05 ~= 35 rings... capped here at 32, which just
 *  clips the outermost ring or two at the slider's extreme -- harmless). */
export const MAX_RINGS = 32;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Slot j's azimuth for a ring with `slotCount` slots. */
export function slotPhi(slot: number, slotCount: number): number {
  return (2 * Math.PI * slot) / Math.max(1, slotCount);
}

/** The lattice's ring/slot decomposition at a given Pitch and Fold -- pure,
 *  so both index.ts (uploading uRingStart/uRingSlots/uRingCount) and the
 *  vertex shader's identical integer arithmetic answer to one spec. Ring k
 *  (k >= 1, 1-indexed distance from the pole) sits at theta_k = k * pitch
 *  radians (the sphere has R = 1); its slot count is picked so the ring's
 *  own azimuthal arc-length pitch (2*pi*sin(theta_k)/slots_k) comes out
 *  close to pitch*SLOT_PITCH_RATIO -- i.e. constant ARC-LENGTH spacing, not
 *  a constant slot count -- and is always a multiple of `fold` so the
 *  fold-fold lobe/hue symmetry holds on every ring. Stops at RING_THETA_MAX
 *  or MAX_RINGS, whichever comes first. */
export interface LatticeLayout {
  /** Number of rings actually laid out (<= MAX_RINGS). */
  ringCount: number;
  /** Ring i's polar angle theta_k, k = i+1 (radians, R = 1). */
  theta: number[];
  /** Ring i's slot count -- always a multiple of `fold`. */
  slots: number[];
  /** Ring i's starting instance index, length ringCount+1;
   *  ringStart[ringCount] is the total ring-instance count (excludes the
   *  trailing pole instance). */
  ringStart: number[];
  /** Total instance count, INCLUDING the trailing pole instance
   *  (= ringStart[ringCount] + 1). */
  total: number;
}

export function latticeLayout(pitch: number, fold: number): LatticeLayout {
  const p = Math.max(1e-4, pitch);
  const f = Math.max(1, Math.round(fold));
  const theta: number[] = [];
  const slots: number[] = [];
  const ringStart: number[] = [0];
  for (let k = 1; k <= MAX_RINGS; k++) {
    const th = k * p;
    if (th > RING_THETA_MAX) break;
    const raw = (2 * Math.PI * Math.sin(th)) / (p * SLOT_PITCH_RATIO) / f;
    const count = f * Math.max(1, Math.round(raw));
    theta.push(th);
    slots.push(count);
    ringStart.push(ringStart[ringStart.length - 1] + count);
  }
  const ringCount = theta.length;
  const total = ringStart[ringCount] + 1;
  return { ringCount, theta, slots, ringStart, total };
}

/** Decodes a gl_InstanceID into (ring, slot) against a given layout, or null
 *  for the trailing pole instance (id === layout.ringStart[ringCount]) or
 *  anything past it. Mirrors the vertex shader's bounded loop over
 *  uRingStart. */
export function instanceRingSlot(instanceId: number, layout: LatticeLayout): { ring: number; slot: number } | null {
  const total = layout.ringStart[layout.ringCount];
  if (instanceId < 0 || instanceId >= total) return null;
  for (let i = 0; i < layout.ringCount; i++) {
    if (instanceId >= layout.ringStart[i] && instanceId < layout.ringStart[i + 1]) {
      return { ring: i, slot: instanceId - layout.ringStart[i] };
    }
  }
  return null;
}

/** How far a ring's own per-ring twist (see sectorArg) advances for one unit
 *  of theta -- picked so that at roughly the Pitch setting's own scale the
 *  twist between neighbouring rings (theta step ~= pitch) comes out to about
 *  `swirl` turns-of-argument per ring, the same size step the old discrete
 *  `swirl * ringIndex` formula gave (round 1). Away from that scale the
 *  per-ring step scales with the actual ring density instead, which just
 *  makes a denser lattice swirl a little tighter -- never discontinuous,
 *  since theta itself is continuous. */
export const SWIRL_SCALE = 11.76;

/** The shared angular argument behind both the length lobe and the hue
 *  sector: fold-fold modulation in phi, shifted continuously with latitude
 *  by swirl so the petals (and the sectors they colour) spiral outward
 *  smoothly at any Pitch (round 2: was swirl * ringIndex, discontinuous the
 *  moment Pitch changed the ring spacing). */
export function sectorArg(phi: number, theta: number, fold: number, swirl: number): number {
  return fold * phi + swirl * theta * SWIRL_SCALE;
}

/** Round 5's "petal shells" fix: at LOBE_SHARPNESS = 1 (no sharpening) the
 *  lobe is a plain 0..1 cosine, which reads as a soft, shallow undulation --
 *  the reference's own dome (bursts/003.03, bursts/011.02) is 8 clearly
 *  DISTINCT scalloped shells even in silence, so the lobe needs a real dark
 *  gap between petals and a crisp tip, not just a gentle wave. Exponentiating
 *  a 0..1 value pulls the mid-range down toward the trough while leaving the
 *  peak (1) and trough (0) fixed, narrowing each petal's own bright tip
 *  without touching its bounds -- see lobeValue. */
export const LOBE_SHARPNESS = 1.5;
/** Round 5: the length lobe used to be pure audio gain (silent = flat
 *  sphere, no petals at all) -- the reference's own scalloped shells are
 *  visible with NO onset flash (the plan's own "no beat-rank preference"
 *  finding), so the petal shape has to live in the REST length too. A box's
 *  length blends between this floor (a petal's own dark-gap length, as a
 *  fraction of lenBase) and lenBase itself by lobe01 -- see boxVert/index.ts
 *  header's length formula -- so the dome is visibly 8 shells even at
 *  lenAudio=0 or dead silence. */
export const LOBE_REST_MIN = 0.35;

/** Lobe gain for a box's length -- the scalloped petals, sharpened to 0..1
 *  (LOBE_SHARPNESS) so the tips are distinct and the troughs bottom out at
 *  exactly 0, never negative (round 5: the old 0.5+0.6*cos undershoot below
 *  0 was clamped away downstream anyway, so a clean 0..1 range is simpler to
 *  reason about now that this same value also blends the REST length, not
 *  only the audio gain -- see LOBE_REST_MIN). Symmetric under phi -> phi+pi
 *  whenever fold is even (cos(A + fold*pi) === cos(A)), which is what gives
 *  the measured 2-fold rotational symmetry "for free" -- pow() preserves
 *  that symmetry since it's monotonic on the non-negative range cos() is
 *  clamped to first. */
export function lobeValue(phi: number, theta: number, fold: number, swirl: number, lobePhase = 0): number {
  const raw = 0.5 + 0.5 * Math.cos(sectorArg(phi, theta, fold, swirl) + lobePhase);
  return Math.pow(Math.max(0, raw), LOBE_SHARPNESS);
}

/** Which of the two complementary hue stops (0 or 0.5) a box's sector gets --
 *  tied to the same sectorArg as the length lobe, so each petal is one solid
 *  hue and neighbouring petals alternate, exactly like the reference. */
export function sectorHue(phi: number, theta: number, fold: number, swirl: number): number {
  const sector = Math.floor(sectorArg(phi, theta, fold, swirl) / (2 * Math.PI));
  const parity = ((sector % 2) + 2) % 2;
  return parity * 0.5;
}

/** Deterministic spatial+time hash, same family as every other scene's
 *  hash21 (fract(sin(dot(...))*43758.5453)), just three scalar inputs. */
export function hashLattice(i: number, j: number, k: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + 13.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---- camera ---------------------------------------------------------------

export interface CameraBasis {
  pos: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
}

/** The camera sits on the pole axis (+Y) at `dist`, looking down at the
 *  origin (fwd = -Y always -- no yaw/pitch setting exists), rolled about
 *  that axis by `rollRad`. right0=(1,0,0)/up0=(0,0,1)/fwd=(0,-1,0) is
 *  already a right-handed orthonormal triple (cross(right0,up0) === fwd),
 *  so roll is just a 2D rotation of right0/up0 in their own plane. */
export function cameraBasis(dist: number, rollRad: number): CameraBasis {
  const c = Math.cos(rollRad);
  const s = Math.sin(rollRad);
  const right: [number, number, number] = [c, 0, s];
  const up: [number, number, number] = [-s, 0, c];
  return { pos: [0, dist, 0], right, up, fwd: [0, -1, 0] };
}

/** Perspective projection matching glsl.ts's BOX_VERT exactly: NDC xy (no
 *  near/far remap needed for the tests below, which only read x/y and the
 *  raw view depth z). `focal` is focalFromFovDeg(fov); `aspect` is the
 *  device aspect (roomAspect() in the shader). */
export function project(
  world: readonly [number, number, number],
  cam: CameraBasis,
  focal: number,
  aspect: number,
): { x: number; y: number; z: number } {
  const rel: [number, number, number] = [world[0] - cam.pos[0], world[1] - cam.pos[1], world[2] - cam.pos[2]];
  const dot = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vx = dot(rel, cam.right);
  const vy = dot(rel, cam.up);
  const vz = dot(rel, cam.fwd);
  return { x: (vx * focal) / aspect / vz, y: (vy * focal) / vz, z: vz };
}

/** Vertical field of view (degrees) -> the GLSL projection's focal length. */
export function focalFromFovDeg(fovDeg: number): number {
  return 1 / Math.tan((fovDeg * Math.PI) / 180 / 2);
}

/** Closed-form on-screen silhouette radius (NDC y units = half-heights) of a
 *  sphere of world radius `radius` seen from distance `dist` -- the
 *  tangent-point projection, exact (not a small-angle approximation). */
export function screenBallRadius(dist: number, radius: number, focal: number): number {
  const d = Math.sqrt(Math.max(dist * dist - radius * radius, 1e-9));
  return (focal * radius) / d;
}

// ---- dolly ------------------------------------------------------------

/** Distance the camera sits at when Dolly=0 -- the closest the starburst
 *  view gets. Round 2: with the constant-pitch lattice the boxes are small
 *  relative to the sphere (lenBase/lenAudio both shrank), so the near camera
 *  sits close to the ball itself -- a height above the ball surface of
 *  ~0.75 R at FOV 90 deg (swift-weaving-parnas.md's brief), rather than
 *  round 1's ~1.15 R margin sized for boxes whose own length used to be the
 *  dominant dimension. Perspective at this height still makes a near-pole
 *  ring's grazing-angle walls trail out toward the frame edge, which is
 *  what actually fills the near view (not the bare sphere's own silhouette --
 *  see screenBallRadius's near-view test, which measures the boxes'
 *  effective radius, not BALL_RADIUS alone). */
export const CAM_NEAR = 1.75;
/** Distance at Dolly=1. screenBallRadius() only measures the bare sphere
 *  (BALL_RADIUS) -- the boxes' own length extends visibly past it, so the
 *  picture's actual apparent edge sits further out than that formula alone
 *  would suggest; this is picked from screenshots against the measured
 *  ~0.45 half-height dome (bursts/003.03/detail.png), not the bare-sphere
 *  number alone. */
export const CAM_FAR = 2.9;

/** Dolly 0..1 -> camera distance, eased (smoothstep) rather than linear so
 *  the middle of the range doesn't feel rushed relative to the holds at
 *  either end. */
export function camDistanceForDolly(dolly: number): number {
  const t = smoothstep01(0, 1, clamp01(dolly));
  return CAM_NEAR + (CAM_FAR - CAM_NEAR) * t;
}

// Drift's scripted timeline -- a slow wall-clock cycle, not audio-driven
// (the plan's hypothesis 3: dolly/spin read as timers, uncorrelated with any
// audio boundary). Named legs approximate the measured out-and-in cadence
// (see index.ts header): far->near over DOLLY_OUT_SEC, hold near for
// DOLLY_HOLD_NEAR_SEC, near->far over DOLLY_IN_SEC, hold far for
// DOLLY_HOLD_FAR_SEC -- about one round trip per DOLLY_PERIOD_SEC.
export const DOLLY_OUT_SEC = 5;
export const DOLLY_HOLD_NEAR_SEC = 15;
export const DOLLY_IN_SEC = 5;
export const DOLLY_HOLD_FAR_SEC = 3;
export const DOLLY_PERIOD_SEC = DOLLY_OUT_SEC + DOLLY_HOLD_NEAR_SEC + DOLLY_IN_SEC + DOLLY_HOLD_FAR_SEC;

/** 0 (near) .. 1 (far) over the free-running timeline above, looping. Pure
 *  and exported for tests; the caller (render()) adds it to the Dolly
 *  setting while Drift is on, so the manual slider stays the base a user can
 *  still nudge (see effectiveDolly). */
export function dollyCycle(tSec: number): number {
  let t = tSec % DOLLY_PERIOD_SEC;
  if (t < 0) t += DOLLY_PERIOD_SEC;
  if (t < DOLLY_OUT_SEC) return 1 - smoothstep01(0, 1, t / DOLLY_OUT_SEC);
  t -= DOLLY_OUT_SEC;
  if (t < DOLLY_HOLD_NEAR_SEC) return 0;
  t -= DOLLY_HOLD_NEAR_SEC;
  if (t < DOLLY_IN_SEC) return smoothstep01(0, 1, t / DOLLY_IN_SEC);
  return 1;
}

/** The Dolly value actually driving the camera this frame: the manual
 *  setting, plus (while Drift is on) the free-running cycle above -- see
 *  the file header's "added to the dolly setting". Clamped to [0,1]. */
export function effectiveDolly(dollySetting: number, driftOn: boolean, tSec: number): number {
  return clamp01(dollySetting + (driftOn ? dollyCycle(tSec) : 0));
}

/** How much the dim backdrop shell should show: near 0 close in (it's
 *  crowded out by the near ball filling the frame), fading up as the camera
 *  pulls back toward CAM_FAR. Pure so index.ts's render() can call it
 *  without any GL state. */
export function shellVisibility(camDist: number): number {
  const lo = CAM_NEAR + (CAM_FAR - CAM_NEAR) * 0.3;
  const hi = CAM_NEAR + (CAM_FAR - CAM_NEAR) * 0.7;
  return smoothstep01(lo, hi, camDist);
}

// ---- hue clock ----------------------------------------------------------

/** Below this rate (turns/sec) the clock is in its "slow" regime even while
 *  tempo is locked -- only a genuinely fast rate (a loud/dynamic passage)
 *  switches to following bar wraps. See advanceHueClock. */
export const HUE_FAST_RATE = 0.2;
/** anim.tempoLock at or above this counts as "locked" for the hue clock. */
export const HUE_LOCK_THRESHOLD = 0.5;
/** How fast the displayed hue slews toward its target -- fast enough that a
 *  bar-wrap's +1 step (see advanceHueClock) reads as a quick sweep, not a
 *  cut, matching the measured continuous colour sweep rather than a hue
 *  jump on the beat. */
export const HUE_SLEW_RATE = 1.2;

export interface HueClockState {
  /** Turns (not wrapped to [0,1) -- palette() is cyclic in its cosine, so a
   *  growing real number is exactly as valid as a wrapped one, and never
   *  wrapping means no seam to slew across). */
  value: number;
  target: number;
  prevBarPhase: number;
}

export function createHueClockState(): HueClockState {
  return { value: 0, target: 0, prevBarPhase: 0 };
}

/** Advances the hue clock in place and returns its new value (turns). Rate =
 *  hueRate * sectionIntensity, so a quiet passage's rate sits near 0 and the
 *  clock holds; once tempo is locked AND that rate has reached the fast
 *  regime, the target instead steps by exactly 1 turn on every bar wrap
 *  (anim.barPhase), matching the measured ~one turn per bar. Either way
 *  `value` only ever slews toward `target` (slewToward's one-pole shape), so
 *  switching between the two regimes never jumps -- only the target's own
 *  motion changes. */
export function advanceHueClock(
  state: HueClockState,
  dtSec: number,
  sectionIntensity: number,
  tempoLock: number,
  barPhase: number,
  hueRate: number,
): number {
  const dt = Math.max(0, dtSec);
  const rate = Math.max(0, hueRate) * Math.max(0, sectionIntensity);
  const wrapped = barPhase < state.prevBarPhase - 0.5;
  state.prevBarPhase = barPhase;
  if (tempoLock >= HUE_LOCK_THRESHOLD && rate >= HUE_FAST_RATE) {
    if (wrapped) state.target += 1;
  } else {
    state.target += rate * dt;
  }
  state.value += (state.target - state.value) * Math.min(1, HUE_SLEW_RATE * dt);
  return state.value;
}
