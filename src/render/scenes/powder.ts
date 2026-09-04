import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { NUM_BANDS } from "../../audio/types.ts";
import { grainTextureSide, REFERENCE_GRAINS } from "./chladni.ts";

// Coloured powder thrown into a dark room: a GPU particle sim with real
// momentum, lit like a club. Grains are *integrated*, not placed — every one
// carries a velocity, is dragged by air, pulled down by gravity, churned by a
// curl-noise wind, thrown by directed burst plumes on the bass, bounced off
// the floor and the walls, and gathered back toward the middle when the music
// goes quiet. Nothing springs to a home position, so a plume thrown on a kick
// keeps going for seconds, coasts, arcs over and rains down — which is the
// whole difference between this and a noise field that happens to look like
// dust. Blue-white for slow powder, coral red for fast ("hot") powder, a
// handful of chunky cubes riding the same plume on the biggest hits, and
// nothing else in the frame but the box room's faint walls.
//
// Contrast chladni.ts, the repo's other GPU particle sim: that one is a 2D
// bed of sand on a driven plate whose grains follow a field with no inertia
// at all; this one is a 3D volume with a perspective camera where inertia is
// the point.
//
// Packing. Particle state lives in a ping-pong pair of *four-attachment*
// RGBA8 render targets, MRT via gl.drawBuffers (WebGL2 guarantees at least
// four colour attachments and four draw buffers, no extension). RGBA8 is the
// only renderable format this repo will rely on — see chladni.ts's header for
// why EXT_color_buffer_float is deliberately unused — and one RGBA8 texel
// can't hold a 3D position at a useful precision, let alone a position and a
// velocity, so the state is split across four:
//   attachment 0 (uPosXY): R,G = x, B,A = y      (16-bit fixed point each)
//   attachment 1 (uPosZW): R,G = z, B = heat, A = settled age / SETTLE_AGE_MAX
//   attachment 2 (uVelXY): R,G = vx, B,A = vy    (16-bit each, over VEL_RANGE)
//   attachment 3 (uVelZW): R,G = vz, B = spin phase, A = spare
// packAxisR/unpackAxisR are generic over the range so positions and
// velocities share one round trip; they live in POWDER_GLSL, shared by the
// sim and both point programs, so the two ends can't drift.
//
// Chunks are stateless. The cubes a big hit throws are not simulated: a JS
// pool holds only the (t0, strength, seed, origin, axis) of the last few
// bursts, and the vertex shader evaluates each cube's whole ballistic arc
// analytically from its age — drag-damped launch plus gravity. Hundreds of
// cubes with no second simulation texture, no per-cube readback, and an exact
// fade-out at CHUNK_LIFE_SEC. The pool is pure JS and tested; the pass is
// skipped entirely while no burst is alive. Origin and axis come from the
// powder plume that fired at the same instant, so the cubes ride the plume
// instead of forming their own unrelated ring.
//
// The mass stays a mass. Turbulence strong enough to churn the powder also
// random-walks it, so with only the cage walls to stop it the whole bed ends
// up as an even haze pinned to the box in under a minute. A weak spring
// toward the middle everywhere plus a stiff one at the edge (CONFINE_BASE /
// CONFINE_ACCEL) is what holds a dense-middle, thin-edged cloud instead — and
// the bulk rotation is modelled as drag toward a rotating *air mass* rather
// than as a constant torque, which would otherwise feed in angular momentum
// forever and spin the cloud into a hard bright disc.
//
// Bloom is per-scene, not a repo-wide pass. The powder and chunk passes draw
// additively into a half-resolution RGBA8 target; two separable 9-tap blurs
// spread it; the composite adds the sharp buffer plus the blurred one over
// the room. Half res costs a quarter of the fill and is invisible on a cloud
// made of soft sprites. The composite rolls its highlights off with a
// per-channel Reinhard curve: additive powder clips its brightest channel
// first, so a hard clip turns the ice blue cyan and the hot plumes magenta —
// the scene loses exactly the pair of colours it is about. The targets are
// rebuilt whenever the drawing buffer
// changes size — the quality governor moves renderScale at runtime, so the
// stored size is compared every frame rather than trusted from init.
//
// Triggers are rises, not one-shots. anim.lowOnset/dropOnset are true for
// exactly one rAF tick, and render() is frame-pace-capped, so on a 120Hz
// display roughly half of them never reach a scene at all — see
// src/render/renderLatch.ts for the full story. Everything discrete here (the
// burst pool, the big-hit detector, the hue steps) fires on a *rise* in the
// corresponding decaying pulse instead, with the one-shot flag folded in as a
// bonus rather than the sole source. Same reason dt comes from frame.time
// deltas rather than anim.dtSec (chladni.ts's header covers that one).
//
// The noise is ours. hash31/hash33 are the 3D extension of chladni.ts's own
// hash21/hash22 (the same fract/dot family, same constants); vnoise is a
// plain trilinear value noise over eight hashed lattice corners; curl() is
// the curl of a three-channel vector potential built from vnoise, by central
// differences. Nothing here is ported from Ashima/Gustavson simplex or from
// any Shadertoy curl-noise implementation — see CLAUDE.md's standing rule.
const ID = "powder";

/** Half-width of the packed world range: every position axis is 16-bit fixed
 *  point over [-POS_RANGE, POS_RANGE]. Comfortably contains the containment
 *  cage below, so a particle can never wrap. */
const POS_RANGE = 2.0;
/** Same, for velocity: world units per second. A grain leaving the source at
 *  full strength starts just under this, and quadratic drag kills it fast, so
 *  nothing ever wants more headroom than this. */
const VEL_RANGE = 6.0;
/** Seconds of lying on the floor that saturate the 8-bit settled-age byte. */
const SETTLE_AGE_MAX = 4.0;

// The containment cage the sim bounces particles off — well inside the room
// box so powder never pokes through a wall.
const CAGE_HALF_X = 1.7;
const CAGE_FLOOR_Y = -1.1;
const CAGE_CEIL_Y = 1.7;
const CAGE_HALF_Z = 1.7;

// The room box, in world units. Deliberately larger than the cage and open
// past the camera in +z (ROOM_FRONT_Z sits behind the eye) so every ray from
// the eye exits through an interior face and every pixel gets painted.
const ROOM_HALF_X = 2.4;
const ROOM_FLOOR_Y = -1.6;
const ROOM_CEIL_Y = 2.2;
const ROOM_BACK_Z = -2.0;
const ROOM_FRONT_Z = 4.2;

// Camera: close enough that a full-strength plume fills the frame. The slow
// orbit is done by spinning the *cloud* about Y instead of the eye (see
// spin() in POWDER_GLSL) — the room then stays put, which is what the
// reference footage actually shows. The eye itself only moves for the kick
// push-in and the drop shake, both computed in JS and uploaded as uEye.
const EYE_Y = 0.35;
const EYE_Z = 3.0;
const FOV_DEG = 52;
const FOV_TAN = Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
/** curl() sums three octaves of finite-differenced value noise, whose raw
 *  magnitude is an accident of the lattice spacing and the difference step;
 *  this scales it so the turbulence term reads as world units per second
 *  squared and can be balanced against gravity by eye. */
const CURL_NORM = 0.15;
/** Distance the point-size slider is calibrated at — a grain at the middle of
 *  the room is `grainPx` pixels across, nearer ones bigger, farther smaller. */
const SIZE_DEPTH_REF = 3.0;

// --- The physics. Every constant here is in world units and seconds. ---
/** Linear and quadratic air drag. The pair is what makes this read as heavy
 *  powder rather than as sparks: a grain leaving the source at 5 units/s is
 *  down to walking pace inside a third of a second (quadratic term), then
 *  drifts for several more seconds (linear term). */
const DRAG_LIN = 0.25;
const DRAG_QUAD = 1.2;
/** Mild: powder hangs and settles slowly rather than dropping like gravel.
 *  Hot (fast) powder is buoyant on top of that, so a plume rises out of the
 *  mass instead of everything pooling into one bright fold at the bottom. */
const GRAVITY = 0.16;
const BUOYANCY = 0.12;
/** Pull back toward the middle, scaled by the quiet-time `calm` signal and by
 *  the Loud swell setting. In a breakdown this is what reforms the blob. */
const GATHER = 1.2;
/** Spatial frequency of the turbulence field. World units now, not tied to a
 *  cloud radius — the cloud has no radius any more. */
const TURB_FREQ = 0.8;
/** Burst plume: the gaussian radius the impulse falls off over, the peak
 *  acceleration at the source, and how long the push lasts. BURST_ACCEL is
 *  large because it acts for BURST_PUSH_SEC only and quadratic drag eats most
 *  of it — the net throw is about 1.4 units in the first second. */
const BURST_RADIUS = 0.9;
const BURST_ACCEL = 24;
/** How much of the impulse a grain sideways-on to the plume axis gets. Small:
 *  the difference between a directed plume and an expanding sphere shell. */
const BURST_SIDE = 0.08;
export const BURST_PUSH_SEC = 0.35;
/** The mushroom roll: a swirl about the plume axis that outlives the push. */
const VORTEX = 0.45;
const VORTEX_SEC = 1.0;
/** Restitution and tangential friction when a grain hits the floor, and
 *  restitution off the walls and ceiling. */
const FLOOR_BOUNCE = 0.25;
const FLOOR_FRICTION = 0.6;
const WALL_BOUNCE = 0.4;
/** Time constant the quiet-time gather signal is slewed with, so a breakdown
 *  gathers the powder in over a couple of seconds instead of snapping. */
const CALM_TAU = 1.5;
/** Soft confinement. The quiet-time gather is the *musical* pull to the
 *  middle; this is the physical one, and it is always on. Without it nothing
 *  bounds the mass during a loud section — turbulence random-walks every
 *  grain out to the cage over about ten seconds and the scene becomes an even
 *  haze of speckle pinned to the walls, which is the one silhouette it must
 *  never show. A weak spring toward the nearest of the wandering attractors
 *  (CONFINE_BASE) gives the mass a dense middle and a thin edge instead of
 *  the hollow bubble a bare wall produces, plus a gentle outer ramp between
 *  CONFINE_R0 and CONFINE_R1 (world units, scaled by the Cloud size slider
 *  and by a slowly drifting per-direction noise, so the silhouette is a
 *  multi-lobed, changing shape rather than a balloon with a bright skin). */
const CONFINE_BASE = 0.34;
const CONFINE_R0 = 0.6;
const CONFINE_R1 = 1.9;
const CONFINE_ACCEL = 1.7;
/** The mass has more than one middle. A single spring toward one point makes
 *  a round balloon whatever the turbulence does; two or three attractors,
 *  each drifting on its own slow orbit, keep the silhouette irregular and
 *  keep it changing. The centre sits above the origin so the mass hangs in
 *  the frame rather than pooling on the floor. */
export const MAX_ATTRACTORS = 3;
export const ATTRACTOR_RADIUS = 0.4;
export const ATTRACTOR_CENTRE_Y = 0.05;
/** Angular rates of the three orbits, rad/s. Mutually irrational-ish so the
 *  three never lock into one repeating figure. */
const ATTRACTOR_RATES = [0.11, 0.17, 0.23];

/** How hard the rotating air mass drags a grain toward its own velocity. Part
 *  of the drag budget, so DRAG_LIN carries less of it than it otherwise
 *  would. */
const SWIRL_GRIP = 0.5;

/** Burst pool geometry. Three live plumes is enough for a kick every beat at
 *  club tempo plus the two a drop fires, and it keeps the sim's inner loop
 *  short. */
export const MAX_BURSTS = 3;
export const BURST_LIFE_SEC = 2.0;
/** t0 of a dead slot: far enough in the past that `uTime - t0` is way past
 *  BURST_LIFE_SEC for any clock the scene will ever see. */
export const BURST_DEAD_T0 = -1e9;
/** How far from the middle a burst source may sit, and the smallest upward
 *  component its axis may have before normalising (so plumes lean up, and a
 *  kick never fires the powder straight into the floor). */
export const BURST_ORIGIN_RADIUS = 0.25;
const BURST_AXIS_UP_MIN = 0.3;

/** Cube burst pool geometry — see the file header for why the cubes are
 *  evaluated analytically rather than simulated. */
export const MAX_CHUNK_BURSTS = 4;
export const CHUNKS_PER_BURST = 96;
export const CHUNK_LIFE_SEC = 1.6;
export const CHUNK_DEAD_T0 = -1e9;

// Big-hit detector shape. The level-vs-baseline test alone has a dead zone
// on exactly the music the cubes are for: a slow baseline of `low` tracks
// the kicks themselves, so on a steady bass-heavy track `low` never gets far
// enough above its own average to fire (bandEnergy.ts's header warns about
// this). The onset pulse and the phrase-level loudness trend don't have that
// problem — a kick's lowPulse spikes regardless of how loud the last bar
// was, and sectionIntensity says whether we're in a chorus — so a loud
// section plus a strong pulse is the primary route and the level-vs-baseline
// test stays as a second one, for a track whose sections never resolve.
/** Time constant of the slow bass baseline the second route compares against. */
export const BIG_HIT_BASE_TAU = 2.0;
/** Minimum gap between two bass-triggered bursts. Long: in a loud section
 *  the cubes should fly on roughly every other bar, not every beat — and a
 *  bar is about 1.7 s at the tempo this was checked against, so anything
 *  near CHUNK_LIFE_SEC leaves cubes on screen continuously. */
export const BIG_HIT_REFRACTORY_SEC = 2.6;
/** How hard the kick itself has to hit, on the low-band onset pulse. */
export const BIG_HIT_PULSE_MIN = 0.55;
/** Phrase-level loudness at or above which a strong kick is enough on its own. */
export const BIG_HIT_SECTION_MIN = 0.75;
/** Second route: how far clear of its own slow baseline the bass level has
 *  to reach for a hit to count as big without a loud section behind it. */
export const BIG_HIT_MARGIN = 1.25;
export const BIG_HIT_FLOOR = 0.06;

/** The palette breathes around the reference's blue/red pair; it never walks
 *  away from it. An accumulating offset reads as generic hue cycling and, on
 *  a four-minute track, loses the two colours the scene is about — so the
 *  shift is a bounded excursion: a slow sine of amplitude HUE_AMPL, plus a
 *  one-off nudge on each drop that relaxes back to the sine with
 *  HUE_RELAX_TAU. Nothing here is cumulative. */
export const HUE_AMPL = 0.06;
export const HUE_BAR_RADIANS = 0.05;
export const HUE_DROP_EXCURSION = 0.05;
export const HUE_RELAX_TAU = 6.0;
/** Fraction of the shift the cubes take, so they stay recognisably coral
 *  while the powder swings further. */
export const CHUNK_HUE_FRACTION = 0.4;

/** Per-grain additive brightness scale. Additive blending over a couple of
 *  hundred thousand overlapping points blows out fast, so this is the one
 *  constant to move if the dense core clips to flat white or a dispersed
 *  cloud fades out. */
const POWDER_GAIN = 0.18;
/** Point-size multiplier for a sparse bed.
 *
 *  A floor-tier cloud is a fiftieth of a high-tier one, and at the high
 *  tier's point size that reads as a scatter of discrete dots rather than as
 *  powder. What decides whether sprites merge into smoke is *coverage* —
 *  count times sprite area — so holding the look across tiers means scaling
 *  the diameter as 1/sqrt(count): fewer, fatter, fainter puffs carrying the
 *  same total smoke. A fixed pixel boost can't do it; at 4k grains no
 *  addition small enough to leave the high tier alone is ever large enough
 *  to make the sprites overlap.
 *
 *  Because this already holds coverage constant, the powder pass does *not*
 *  also apply chladni's grainGain() — that compensates a sparse bed by
 *  brightening each grain instead, and doing both would blow the floor tier
 *  out to white. Capped, since a bed sparse enough to want more than this is
 *  going to look coarse whatever we do. */
export const SPARSE_SIZE_SCALE_CAP = 7;
export function sparseSizeScale(grainCount: number): number {
  return Math.min(SPARSE_SIZE_SCALE_CAP, Math.sqrt(REFERENCE_GRAINS / Math.max(1, grainCount)));
}

/** On-screen point diameter across the Grain size slider, at the reference
 *  resolution and the middle of the room, plus the ceiling a near particle
 *  may grow to. */
const GRAIN_PX_MIN = 2.0;
const GRAIN_PX_MAX = 5.0;
const POINT_PX_CAP = 7.0;
/** Resolution the sizes above are quoted at, and the floor the resolution
 *  scale is allowed to reach. It has to go well below the governor's own
 *  0.3 renderScale: the gallery renders every scene into a preview buffer
 *  smaller still, the glow target is half of that again, and pointSizing's
 *  own one-pixel clamp already stops the size going degenerate — the floor
 *  only exists to keep the arithmetic away from zero. */
const REFERENCE_HEIGHT_PX = 720;
const MIN_RES_SCALE = 0.1;

/** Where the composite's highlight roll-off asymptotes, and how much of the
 *  blurred layer the Bloom slider adds on top. The knee sits just above white
 *  so a dense fold needs several times nominal brightness before it flattens
 *  out, and the halo — not the sharp powder — carries the glow. */
const TONE_KNEE = 0.95;
const BLOOM_WEIGHT = 2.2;

/** Texel stride between blur taps, in half-res texels. Wider than 1 so a
 *  nine-tap kernel still throws a soft halo several screen pixels out. */
const BLUR_STRIDE = 1.8;

/** Shortest gap between two drops the scene will act on. A drop is one event
 *  — one pair of plumes, one shake, one hue step — however many frames the
 *  detector flags. */
const DROP_REFRACTORY_SEC = 1.5;

/** How long the drop shake lasts, and how far it may throw the eye. */
const SHAKE_SEC = 0.4;
const SHAKE_AMP = 0.1;

export interface PointSizing {
  /** gl_PointSize for a particle at the middle of the room, in buffer pixels. */
  sizePx: number;
  /** Ceiling gl_PointSize clamps to, so a near particle can still grow. */
  maxPx: number;
  /** Brightness multiplier that holds accumulated coverage constant. */
  gain: number;
}

/** Point size and the brightness correction that goes with it.
 *
 *  A fixed particle count drawn at a fixed pixel size into a *smaller* buffer
 *  piles the same powder into fewer pixels, so a scene like this blows out to
 *  flat white the moment the quality governor drops renderScale — which it
 *  does, to 0.3, well before it drops the preset. Sizes therefore scale with
 *  the buffer; where the one-pixel floor stops them from shrinking any
 *  further, `gain` gives back exactly the coverage the clamp added, as the
 *  square of how far the size was held above nominal. At the reference
 *  resolution nothing clamps and `gain` is exactly 1. */
export function pointSizing(grainPx: number, resScale: number, sizeScale: number): PointSizing {
  const nominal = grainPx * sizeScale * resScale;
  const maxPx = Math.max(1, POINT_PX_CAP * sizeScale * resScale);
  const sizePx = Math.min(Math.max(nominal, 1), maxPx);
  return { sizePx, maxPx, gain: (nominal / sizePx) ** 2 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** How strongly the powder should be drawn back to the middle right now: 1 in
 *  a silent breakdown, 0 under a loud, bass-heavy section. The caller slews
 *  it with CALM_TAU — see createPowderScene — so a section change gathers the
 *  cloud over a couple of seconds instead of snapping it in. */
export function calmTarget(sectionIntensity: number, low: number): number {
  const section = Number.isFinite(sectionIntensity) ? clamp01(sectionIntensity) : 0;
  const bass = Number.isFinite(low) ? clamp01(low * 1.5) : 0;
  return (1 - section) * (1 - bass);
}

/** Writes the MAX_ATTRACTORS orbit positions at time `tSec` into `out` as
 *  packed vec3s, ready for setV3v. Each attractor circles ATTRACTOR_CENTRE_Y
 *  at ATTRACTOR_RADIUS on its own rate, with a slower, shallower bob in y so
 *  the three are never coplanar. Pure and exported so the wandering shape is
 *  testable without a GL context. */
export function attractorPositions(tSec: number, out: Float32Array): Float32Array {
  const t = Number.isFinite(tSec) ? tSec : 0;
  for (let i = 0; i < MAX_ATTRACTORS; i++) {
    const ph = t * ATTRACTOR_RATES[i] + i * 2.4;
    out[i * 3] = Math.cos(ph) * ATTRACTOR_RADIUS;
    out[i * 3 + 1] = ATTRACTOR_CENTRE_Y + Math.sin(ph * 0.61) * ATTRACTOR_RADIUS * 0.45;
    out[i * 3 + 2] = Math.sin(ph) * ATTRACTOR_RADIUS;
  }
  return out;
}

/** A hash in [0,1) from one float. Deterministic and dependency-free — the
 *  burst pool has to be testable under node, so it can't reach for the GPU's
 *  hash and mustn't use Math.random for anything a test asserts on. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** One live powder plume: where it starts, which way it throws, how hard,
 *  when it fired, and whether this is the first frame it has been uploaded
 *  on (the sim re-emits grains from the source on exactly that frame). */
export interface Burst {
  originX: number;
  originY: number;
  originZ: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  strength: number;
  t0: number;
  fresh: boolean;
}

export interface BurstPool {
  /** Starts a plume, reusing a dead slot or displacing the oldest live one.
   *  `flip` mirrors the axis through the origin — how a drop fires two
   *  opposed plumes out of one source. */
  trigger(nowSec: number, strength: number, seed: number, flip?: boolean): void;
  /** Retires every burst older than BURST_LIFE_SEC. */
  tick(nowSec: number): void;
  /** How many bursts are currently live. */
  alive(): number;
  /** Uploads the pool, and clears every `fresh` flag: the re-emission the
   *  flag drives must happen on exactly one sim step. */
  upload(prog: GLProgram): void;
  /** The raw slots, for tests and the probe. */
  readonly bursts: readonly Burst[];
}

export function createBurstPool(): BurstPool {
  const bursts: Burst[] = [];
  for (let i = 0; i < MAX_BURSTS; i++) {
    bursts.push({
      originX: 0,
      originY: 0,
      originZ: 0,
      axisX: 0,
      axisY: 1,
      axisZ: 0,
      strength: 0,
      t0: BURST_DEAD_T0,
      fresh: false,
    });
  }
  const originBuf = new Float32Array(MAX_BURSTS * 3);
  const axisBuf = new Float32Array(MAX_BURSTS * 3);
  const strengthBuf = new Float32Array(MAX_BURSTS);
  const t0Buf = new Float32Array(MAX_BURSTS);
  const freshBuf = new Float32Array(MAX_BURSTS);

  return {
    bursts,
    trigger(nowSec, strength, seed, flip = false): void {
      let slot = 0;
      let oldest = Infinity;
      for (let i = 0; i < bursts.length; i++) {
        if (bursts[i].t0 === BURST_DEAD_T0) {
          slot = i;
          oldest = -Infinity;
          break;
        }
        if (bursts[i].t0 < oldest) {
          oldest = bursts[i].t0;
          slot = i;
        }
      }
      // Origin: a point inside a small ball around the middle, so successive
      // plumes come out of different places rather than all from dead centre.
      let ox = hash01(seed * 1.13 + 0.7) * 2 - 1;
      let oy = hash01(seed * 1.13 + 4.2) * 2 - 1;
      let oz = hash01(seed * 1.13 + 9.6) * 2 - 1;
      const oLen = Math.hypot(ox, oy, oz) || 1;
      const oScale = (BURST_ORIGIN_RADIUS * Math.min(1, oLen)) / oLen;
      ox *= oScale;
      oy *= oScale;
      oz *= oScale;
      // Axis: any direction with an upward bias, so the plume leans up the
      // way a handful of powder thrown into the air does.
      const ax = hash01(seed * 1.7 + 0.13) * 2 - 1;
      const ay = BURST_AXIS_UP_MIN + (1 - BURST_AXIS_UP_MIN) * hash01(seed * 1.7 + 3.71);
      const az = hash01(seed * 1.7 + 7.19) * 2 - 1;
      const aLen = Math.hypot(ax, ay, az) || 1;
      const s = (flip ? -1 : 1) / aLen;

      const b = bursts[slot];
      b.originX = ox;
      b.originY = oy;
      b.originZ = oz;
      b.axisX = ax * s;
      b.axisY = ay * s;
      b.axisZ = az * s;
      b.strength = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 0));
      b.t0 = nowSec;
      b.fresh = true;
    },
    tick(nowSec): void {
      for (const b of bursts) {
        if (b.t0 !== BURST_DEAD_T0 && nowSec - b.t0 > BURST_LIFE_SEC) {
          b.t0 = BURST_DEAD_T0;
          b.strength = 0;
          b.fresh = false;
        }
      }
    },
    alive(): number {
      let n = 0;
      for (const b of bursts) if (b.t0 !== BURST_DEAD_T0) n++;
      return n;
    },
    upload(prog): void {
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        originBuf[i * 3] = b.originX;
        originBuf[i * 3 + 1] = b.originY;
        originBuf[i * 3 + 2] = b.originZ;
        axisBuf[i * 3] = b.axisX;
        axisBuf[i * 3 + 1] = b.axisY;
        axisBuf[i * 3 + 2] = b.axisZ;
        strengthBuf[i] = b.strength;
        t0Buf[i] = b.t0;
        freshBuf[i] = b.fresh ? 1 : 0;
        b.fresh = false;
      }
      prog.setV3v("uBurstOrigin", originBuf);
      prog.setV3v("uBurstAxis", axisBuf);
      prog.setFv("uBurstStrength", strengthBuf);
      prog.setFv("uBurstT0", t0Buf);
      prog.setFv("uBurstFresh", freshBuf);
    },
  };
}

/** Fires on the hits worth throwing cubes for: any detected drop, or a bass
 *  hit well clear of its own slow baseline and outside the refractory
 *  window. */
export interface BigHitDetector {
  /** Steps the baseline and returns the burst strength in (0, 1] when this
   *  frame should fire, or 0 when it shouldn't. (A number rather than a bare
   *  boolean: the caller needs the strength anyway, and 0 is an unambiguous
   *  "didn't fire".) */
  advance(
    dt: number,
    low: number,
    lowPulse: number,
    sectionIntensity: number,
    lowRose: boolean,
    dropRose: boolean,
  ): number;
  /** The slow bass baseline, for tests and the probe. */
  readonly baseline: number;
}

export function createBigHitDetector(): BigHitDetector {
  let base = 0;
  // Start clear of the refractory window so the very first hit can fire.
  let sinceFire = BIG_HIT_REFRACTORY_SEC * 10;
  return {
    get baseline() {
      return base;
    },
    advance(dt, low, lowPulse, sectionIntensity, lowRose, dropRose): number {
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const level = Number.isFinite(low) ? low : 0;
      const pulse = Number.isFinite(lowPulse) ? lowPulse : 0;
      const section = Number.isFinite(sectionIntensity) ? sectionIntensity : 0;
      base += (level - base) * (1 - Math.exp(-d / BIG_HIT_BASE_TAU));
      sinceFire += d;
      if (dropRose) {
        sinceFire = 0;
        return 1;
      }
      const loudSection = section >= BIG_HIT_SECTION_MIN;
      const clearOfBaseline = level > base * BIG_HIT_MARGIN + BIG_HIT_FLOOR;
      if (
        lowRose &&
        sinceFire >= BIG_HIT_REFRACTORY_SEC &&
        pulse >= BIG_HIT_PULSE_MIN &&
        (loudSection || clearOfBaseline)
      ) {
        sinceFire = 0;
        return Math.max(0.45, Math.min(1, 0.45 + 0.55 * pulse));
      }
      return 0;
    },
  };
}

/** One live cube burst: when it started, how hard, the hash seed that decides
 *  its cubes' spread, and the powder plume's own origin and axis so the cubes
 *  fly out of the same place in the same direction. */
export interface ChunkBurst {
  t0: number;
  strength: number;
  seed: number;
  originX: number;
  originY: number;
  originZ: number;
  axisX: number;
  axisY: number;
  axisZ: number;
}

export interface ChunkPool {
  /** Starts a burst, reusing a dead slot or displacing the oldest live one.
   *  `origin`/`axis` come from the powder plume fired on the same frame. */
  trigger(
    nowSec: number,
    strength: number,
    seed: number,
    origin: readonly [number, number, number],
    axis: readonly [number, number, number],
  ): void;
  /** Retires every burst older than CHUNK_LIFE_SEC. */
  tick(nowSec: number): void;
  /** How many bursts are currently live. */
  alive(): number;
  /** Uploads the pool as uChunkT0/uChunkStrength/uChunkSeed plus the plume's
   *  uChunkOrigin/uChunkAxis. */
  upload(prog: GLProgram): void;
  /** The raw slots, for tests and the probe. */
  readonly bursts: readonly ChunkBurst[];
}

export function createChunkPool(): ChunkPool {
  const bursts: ChunkBurst[] = [];
  for (let i = 0; i < MAX_CHUNK_BURSTS; i++) {
    bursts.push({
      t0: CHUNK_DEAD_T0,
      strength: 0,
      seed: 0,
      originX: 0,
      originY: 0,
      originZ: 0,
      axisX: 0,
      axisY: 1,
      axisZ: 0,
    });
  }
  const t0Buf = new Float32Array(MAX_CHUNK_BURSTS);
  const strengthBuf = new Float32Array(MAX_CHUNK_BURSTS);
  const seedBuf = new Float32Array(MAX_CHUNK_BURSTS);
  const originBuf = new Float32Array(MAX_CHUNK_BURSTS * 3);
  const axisBuf = new Float32Array(MAX_CHUNK_BURSTS * 3);

  return {
    bursts,
    trigger(nowSec, strength, seed, origin, axis): void {
      let slot = 0;
      let oldest = Infinity;
      for (let i = 0; i < bursts.length; i++) {
        if (bursts[i].t0 === CHUNK_DEAD_T0) {
          slot = i;
          oldest = -Infinity;
          break;
        }
        if (bursts[i].t0 < oldest) {
          oldest = bursts[i].t0;
          slot = i;
        }
      }
      const b = bursts[slot];
      b.t0 = nowSec;
      b.strength = Math.max(0, strength);
      b.seed = seed;
      b.originX = origin[0];
      b.originY = origin[1];
      b.originZ = origin[2];
      b.axisX = axis[0];
      b.axisY = axis[1];
      b.axisZ = axis[2];
    },
    tick(nowSec): void {
      for (const b of bursts) {
        if (b.t0 !== CHUNK_DEAD_T0 && nowSec - b.t0 > CHUNK_LIFE_SEC) {
          b.t0 = CHUNK_DEAD_T0;
          b.strength = 0;
        }
      }
    },
    alive(): number {
      let n = 0;
      for (const b of bursts) if (b.t0 !== CHUNK_DEAD_T0) n++;
      return n;
    },
    upload(prog): void {
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        t0Buf[i] = b.t0;
        strengthBuf[i] = b.strength;
        seedBuf[i] = b.seed;
        originBuf[i * 3] = b.originX;
        originBuf[i * 3 + 1] = b.originY;
        originBuf[i * 3 + 2] = b.originZ;
        axisBuf[i * 3] = b.axisX;
        axisBuf[i * 3 + 1] = b.axisY;
        axisBuf[i * 3 + 2] = b.axisZ;
      }
      prog.setFv("uChunkT0", t0Buf);
      prog.setFv("uChunkStrength", strengthBuf);
      prog.setFv("uChunkSeed", seedBuf);
      prog.setV3v("uChunkOrigin", originBuf);
      prog.setV3v("uChunkAxis", axisBuf);
    },
  };
}

/** The colour clock: a bounded wobble of the blue/red pair around its own
 *  hue, not a walk away from it. The sine phase creeps forward a fixed angle
 *  per bar; a drop adds a one-off excursion that decays back. At Hue drift 0
 *  the shift is exactly zero and the scene keeps the reference's fixed
 *  blue/red. */
export interface HueDrift {
  /** Steps the clock and returns the current hue offset in turns.
   *  `barPhase` is anim.barPhase; a wrap in it counts as a bar. */
  advance(dt: number, barPhase: number, dropRose: boolean, drift: number): number;
  /** Phase of the slow sine, in radians, for tests and the probe. */
  readonly phase: number;
  /** The un-relaxed part a drop added, in turns. */
  readonly excursion: number;
  /** The current offset, in turns. */
  readonly value: number;
}

export function createHueDrift(): HueDrift {
  let phase = 0;
  let excursion = 0;
  let value = 0;
  let prevBarPhase = 0;
  return {
    get phase() {
      return phase;
    },
    get excursion() {
      return excursion;
    },
    get value() {
      return value;
    },
    advance(dt, barPhase, dropRose, drift): number {
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const scale = Number.isFinite(drift) ? clamp01(drift) : 0;
      const bp = Number.isFinite(barPhase) ? barPhase : prevBarPhase;
      // A bar boundary is a wrap in barPhase, not a threshold crossing: the
      // clock is phase-locked and can be nudged, so only the wrap is safe.
      if (bp < prevBarPhase - 0.5) phase += HUE_BAR_RADIANS;
      prevBarPhase = bp;
      excursion *= Math.exp(-d / HUE_RELAX_TAU);
      if (dropRose) excursion += HUE_DROP_EXCURSION;
      value = scale * (HUE_AMPL * Math.sin(phase) + excursion);
      return value;
    },
  };
}

const SETTINGS: SceneSetting[] = [
  {
    key: "size",
    label: "Cloud size",
    description: "How far each burst throws the powder — how much of the room it fills",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A loud, busy room fills the frame.
    auto: { loudness: 0.3, density: 0.15 },
  },
  {
    key: "breathe",
    label: "Loud swell",
    description: "How strongly a quiet passage gathers the powder back into one turning blob",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Quiet-verse / loud-chorus tracks are the ones worth breathing on.
    auto: { dynamics: 0.35 },
  },
  {
    key: "turbulence",
    label: "Turbulence",
    description: "How hard the air churns the powder — swirls, tendrils and wisps peeling off the mass",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Busy, fast mixes churn more.
    auto: { density: 0.25, tempo: 0.2 },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How fast the whole mass turns on its axis",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // The turn follows the tempo.
    auto: { tempo: 0.3 },
  },
  {
    key: "kick",
    label: "Bass kick",
    description: "Every bass hit throws a directed plume of powder out of the mass; it coasts, then falls",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Dark, bass-heavy mixes carry more kick presence to throw on.
    auto: { attack: 0.3, brightness: -0.2 },
  },
  {
    key: "chunks",
    label: "Chunk burst",
    description: "The hardest hits throw a spray of chunky red cubes along the plume",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Cubes read best on punchy, dynamic music.
    auto: { attack: 0.25, dynamics: 0.2 },
  },
  {
    key: "flash",
    label: "Beat flash",
    description: "Brightness punch on each beat, and the white flash on a drop",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // Same reasoning as chladni's and caustics' flash: punches read on
    // punchy, uncluttered material.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
  },
  {
    key: "heat",
    label: "Red heat",
    description: "How readily fast-moving powder glows hot red instead of ice blue",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // The red fraction grows with loud, dark mixes.
    auto: { loudness: 0.2, brightness: -0.2 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How bright each speck of powder is; overlapping specks add up",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // As chladni's grain brightness.
    auto: { loudness: 0.2 },
  },
  {
    key: "grain",
    label: "Grain size",
    description: "Size of each speck on screen — fine dust or coarse chalk",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "room",
    label: "Room",
    description: "How visible the dark box room behind the powder is",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "paletteMix",
    label: "Palette tint",
    description: "0 keeps the powder's own ice-blue and coral; 1 recolours it with the app palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    advanced: true,
  },
  {
    key: "bloom",
    label: "Bloom",
    description: "Soft halo around the powder — how much the cloud lights the room up",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // A loud room wants more haze in the air.
    auto: { loudness: 0.2 },
  },
  {
    key: "sparkle",
    label: "Sparkle",
    description: "A scattering of grains twinkling white on the hats and the highs",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    // Bright, snappy material is what has hats worth twinkling on.
    auto: { brightness: 0.4, attack: 0.15 },
  },
  {
    key: "hueDrift",
    label: "Hue drift",
    description: "How far the blue/red pair walks around the colour wheel as the track goes on",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A track that goes somewhere gets a palette that goes somewhere.
    auto: { dynamics: 0.2 },
  },
  {
    key: "camera",
    label: "Camera move",
    description: "Push-in on the kick, how fast the view orbits, and the shake on a drop",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Move the camera on music that has hits and a tempo to move to.
    auto: { pulse: 0.25, tempo: 0.15 },
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`powder: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Shared by the sim, room, powder and chunk programs so the packing, the
// noise and the camera can't drift apart between them.
const POWDER_GLSL = `
const float POS_RANGE = ${POS_RANGE.toFixed(4)};
const float VEL_RANGE = ${VEL_RANGE.toFixed(4)};
const float SETTLE_AGE_MAX = ${SETTLE_AGE_MAX.toFixed(4)};
const float CAGE_HALF_X = ${CAGE_HALF_X.toFixed(4)};
const float CAGE_FLOOR_Y = ${CAGE_FLOOR_Y.toFixed(4)};
const float CAGE_CEIL_Y = ${CAGE_CEIL_Y.toFixed(4)};
const float CAGE_HALF_Z = ${CAGE_HALF_Z.toFixed(4)};
const vec3 ROOM_MIN = vec3(${(-ROOM_HALF_X).toFixed(4)}, ${ROOM_FLOOR_Y.toFixed(4)}, ${ROOM_BACK_Z.toFixed(4)});
const vec3 ROOM_MAX = vec3(${ROOM_HALF_X.toFixed(4)}, ${ROOM_CEIL_Y.toFixed(4)}, ${ROOM_FRONT_Z.toFixed(4)});
const float FOV_TAN = ${FOV_TAN.toFixed(6)};
const float SIZE_DEPTH_REF = ${SIZE_DEPTH_REF.toFixed(4)};
const vec3 CONFINE_CENTRE = vec3(0.0, ${ATTRACTOR_CENTRE_Y.toFixed(4)}, 0.0);
const float CURL_NORM = ${CURL_NORM.toFixed(4)};

uniform float uYaw;  // cloud spin about Y, radians
uniform vec3 uEye;   // eye position, incl. the kick push-in and drop shake

// --- 16-bit fixed point per axis, generic over the range ---
float unpackAxisR(vec2 c, float range) {
  vec2 b = floor(c * 255.0 + 0.5);
  float v = (b.x * 256.0 + b.y) / 65535.0;
  return (v * 2.0 - 1.0) * range;
}

vec2 packAxisR(float p, float range) {
  float u = floor(clamp(p / range * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}

float unpackAxis(vec2 c) { return unpackAxisR(c, POS_RANGE); }
vec2 packAxis(float p) { return packAxisR(p, POS_RANGE); }

// --- hashes: the 3D extension of chladni.ts's hash21/hash22 ---
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * vec3(123.34, 456.21, 789.13));
  p += dot(p, p.yzx + 45.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  return vec3(hash31(p), hash31(p + 19.19), hash31(p + 37.71));
}

// --- value noise: trilinear over 8 hashed lattice corners ---
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 w = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y),
             mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y), w.z);
}

// Trilinear value noise averages eight independent uniforms, so vnoise's own
// distribution is bunched hard around 0.5 (sigma is well under 0.2). Anything
// that wants noise as a *shape* — here, the lumpy confinement boundary —
// needs it spread back out or the result is visually flat, so this widens it
// about the midpoint and clips the tails.
float vnoiseW(vec3 p) {
  return clamp((vnoise(p) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
}

// A three-channel vector potential; its curl is divergence-free, which is
// what makes the flow read as air rather than as a source/sink field.
vec3 psi(vec3 p) {
  return vec3(vnoise(p + vec3(11.3, 5.1, 2.7)),
              vnoise(p + vec3(3.9, 17.4, 8.2)),
              vnoise(p + vec3(6.6, 1.2, 23.5))) - 0.5;
}

vec3 curlOnce(vec3 p) {
  const float e = 0.05;
  vec3 dx = (psi(p + vec3(e, 0.0, 0.0)) - psi(p - vec3(e, 0.0, 0.0))) / (2.0 * e);
  vec3 dy = (psi(p + vec3(0.0, e, 0.0)) - psi(p - vec3(0.0, e, 0.0))) / (2.0 * e);
  vec3 dz = (psi(p + vec3(0.0, 0.0, e)) - psi(p - vec3(0.0, 0.0, e))) / (2.0 * e);
  return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
}

// Three octaves, weighted hard toward the largest. An even spread across the
// octaves reads as diffusion — every grain jitters and the mass turns into
// haze — whereas a dominant large scale means neighbouring grains are pushed
// the same way and the flow draws tendrils.
vec3 curl(vec3 p) {
  return (curlOnce(p)
        + 0.35 * curlOnce(p * 2.1 + 13.7)
        + 0.12 * curlOnce(p * 4.4 + 31.1)) * CURL_NORM;
}

// Hue rotation about the YIQ chroma plane — cheap, and it holds luminance, so
// walking the palette round the wheel never changes how bright the cloud is.
vec3 hueRotate(vec3 c, float turns) {
  // Negative: a positive drift walks the ice blue toward violet and the
  // coral toward orange, which stays in the scene's own family. The other
  // way round takes the blue to green inside a couple of drops.
  float a = -turns * 6.2831853;
  float u = cos(a), w = sin(a);
  mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYiq * c;
  yiq.yz = vec2(yiq.y * u - yiq.z * w, yiq.y * w + yiq.z * u);
  return max(toRgb * yiq, vec3(0.0));
}

// --- camera ---
void cameraBasis(out vec3 eye, out vec3 right, out vec3 up, out vec3 fwd) {
  eye = uEye;
  fwd = normalize(-eye);
  right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  up = cross(right, fwd);
}

// Aspect of the whole room-space canvas, not of this device's slice — at the
// full viewport {0,0,1,1} this is exactly uResolution.x / uResolution.y, and
// under Panorama it keeps every device projecting the same room.
float roomAspect() {
  return (uResolution.x * uViewport.w) / max(uResolution.y * uViewport.z, 1e-4);
}

/** World point -> (right, up, depth-in-front-of-eye). */
vec3 worldToView(vec3 p) {
  vec3 eye, right, up, fwd;
  cameraBasis(eye, right, up, fwd);
  vec3 d = p - eye;
  return vec3(dot(d, right), dot(d, up), dot(d, fwd));
}

/** View point -> room-space NDC in [-1,1]. Caller must reject v.z <= 0. */
vec2 viewToNdc(vec3 v) {
  return vec2(v.x / (FOV_TAN * roomAspect()), v.y / FOV_TAN) / max(v.z, 1e-3);
}

/** Camera ray for a room-space uv. */
vec3 roomRay(vec2 ruv) {
  vec3 eye, right, up, fwd;
  cameraBasis(eye, right, up, fwd);
  vec2 ndc = ruv * 2.0 - 1.0;
  return normalize(right * (ndc.x * FOV_TAN * roomAspect()) + up * (ndc.y * FOV_TAN) + fwd);
}

/** The slow orbit, applied to the cloud rather than to the eye. */
vec3 spin(vec3 p) {
  float c = cos(uYaw), s = sin(uYaw);
  return vec3(c * p.x + s * p.z, p.y, c * p.z - s * p.x);
}

/** Everything a burst throws scales together off the Cloud size slider. */
float sizeFactor() { return mix(0.6, 1.5, uSize); }
`;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outPosXY;
layout(location = 1) out vec4 outPosZW;
layout(location = 2) out vec4 outVelXY;
layout(location = 3) out vec4 outVelZW;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPosXY;
uniform sampler2D uPosZW;
uniform sampler2D uVelXY;
uniform sampler2D uVelZW;
uniform float uSimDt;
uniform float uCalm;
uniform vec3 uBurstOrigin[${MAX_BURSTS}];
uniform vec3 uBurstAxis[${MAX_BURSTS}];
uniform float uBurstStrength[${MAX_BURSTS}];
uniform float uBurstT0[${MAX_BURSTS}];
uniform float uBurstFresh[${MAX_BURSTS}];
uniform vec3 uAttractor[${MAX_ATTRACTORS}];
${POWDER_GLSL}

const float DRAG_LIN = ${DRAG_LIN.toFixed(4)};
const float DRAG_QUAD = ${DRAG_QUAD.toFixed(4)};
const float GRAVITY = ${GRAVITY.toFixed(4)};
const float GATHER = ${GATHER.toFixed(4)};
const float TURB_FREQ = ${TURB_FREQ.toFixed(4)};
const float BURST_RADIUS = ${BURST_RADIUS.toFixed(4)};
const float BURST_ACCEL = ${BURST_ACCEL.toFixed(4)};
const float BURST_SIDE = ${BURST_SIDE.toFixed(4)};
const float CONFINE_R0 = ${CONFINE_R0.toFixed(4)};
const float CONFINE_R1 = ${CONFINE_R1.toFixed(4)};
const float CONFINE_ACCEL = ${CONFINE_ACCEL.toFixed(4)};
const float CONFINE_BASE = ${CONFINE_BASE.toFixed(4)};
const float BUOYANCY = ${BUOYANCY.toFixed(4)};
const float SWIRL_GRIP = ${SWIRL_GRIP.toFixed(4)};
const float BURST_PUSH = ${BURST_PUSH_SEC.toFixed(4)};
const float BURST_LIFE = ${BURST_LIFE_SEC.toFixed(4)};
const float VORTEX = ${VORTEX.toFixed(4)};
const float VORTEX_SEC = ${VORTEX_SEC.toFixed(4)};
const float FLOOR_BOUNCE = ${FLOOR_BOUNCE.toFixed(4)};
const float FLOOR_FRICTION = ${FLOOR_FRICTION.toFixed(4)};
const float WALL_BOUNCE = ${WALL_BOUNCE.toFixed(4)};

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 cxy = texelFetch(uPosXY, texel, 0);
  vec4 czw = texelFetch(uPosZW, texel, 0);
  vec4 wxy = texelFetch(uVelXY, texel, 0);
  vec4 wzw = texelFetch(uVelZW, texel, 0);
  vec3 p = vec3(unpackAxis(cxy.rg), unpackAxis(cxy.ba), unpackAxis(czw.rg));
  vec3 v = vec3(unpackAxisR(wxy.rg, VEL_RANGE),
                unpackAxisR(wxy.ba, VEL_RANGE),
                unpackAxisR(wzw.rg, VEL_RANGE));
  float heat = czw.b;
  float settled = czw.a * SETTLE_AGE_MAX;
  float phase = wzw.b;

  vec2 seed = vec2(texel) * 0.173 + 7.31;
  float h = hash21(seed);
  float sizeFac = sizeFactor();

  // Re-emission. On the one frame a burst starts, a slice of the powder — a
  // fixed fraction of everything, and a much larger fraction of whatever is
  // lying on the floor — is teleported back to the source and thrown along
  // the plume axis. This is the reference's "handful thrown from a point"
  // motion, and it is also what keeps the cloud replenished: without it every
  // grain ends up on the floor after a minute of gravity.
  for (int i = 0; i < ${MAX_BURSTS}; i++) {
    if (uBurstFresh[i] < 0.5) continue;
    float st = uBurstStrength[i];
    float hh = hash21(seed * 1.37 + uBurstT0[i] * 0.017);
    float take = settled > 0.75 ? 0.45 : 0.11;
    if (hh < take * st) {
      // A ball, not a cube. hash33 straight out of the unit cube puts every
      // re-emitted grain inside an axis-aligned box, and since they are all
      // emitted hot the box shows on screen as a bright rectangle sitting in
      // the middle of the cloud — the single most visible artifact this scene
      // can produce. Normalising first, and stretching the ball along the
      // axis, makes the source read as a nozzle instead.
      // A cone, not a ball. Every re-emitted grain landing in one small
      // sphere puts a solid, saturated hot blob in the middle of the cloud
      // that never goes away — the burst refires twice a second, so it reads
      // as a little sun rather than as a source. Laying them down the axis
      // with a widening radius, and giving the ones further down the axis the
      // higher speed, makes the emission itself a plume the instant it fires.
      vec3 off = normalize(hash33(vec3(seed, uBurstT0[i])) * 2.0 - 1.0 + 1e-4);
      float spread = pow(hash21(seed * 2.9 + uBurstT0[i]), 0.3333);
      float along = hh / max(take * st, 1e-3);
      p = uBurstOrigin[i]
        + uBurstAxis[i] * (along * 1.1 * sizeFac)
        + off * (spread * (0.05 + 0.18 * along) * sizeFac);
      vec3 dir = normalize(uBurstAxis[i] + off * (0.16 + 0.30 * spread));
      v = dir * ((1.4 + 3.2 * along) * st * sizeFac);
      heat = 0.0;
      settled = 0.0;
    }
  }

  // Two substeps once the frame is long enough that a single explicit Euler
  // step through BURST_ACCEL would overshoot.
  int steps = uSimDt > 0.025 ? 2 : 1;
  float dt = uSimDt / float(steps);
  float turbAmp = uTurbulence * (0.85 + 2.6 * uEnergy);
  float gather = GATHER * uCalm * mix(0.35, 1.6, uBreathe);
  // The audio-warped drift is a straight translation in y; the uTime term
  // circles instead, because a second translation would advect the whole
  // field off in one direction over a long track rather than evolving it.
  vec3 flowOff = vec3(sin(uTime * 0.12) * 0.45, uFlowPhase * 0.15, cos(uTime * 0.12) * 0.45);
  float burstRadius = BURST_RADIUS * sizeFac;

  for (int s = 0; s < 2; s++) {
    if (s >= steps) break;

    // 1. Wind: curl noise as a *force*, so the air pushes grains around
    //    instead of teleporting them along a field line.
    vec3 a = curl(p * TURB_FREQ + flowOff) * turbAmp;
    // 2. The whole mass turns. Modelled as drag toward a *rotating air mass*
    //    rather than as a constant tangential force: a constant torque feeds
    //    angular momentum in forever and the cloud collapses into a bright,
    //    hard-edged accretion disc, which is not a thing powder does.
    a += (cross(vec3(0.0, 1.0, 0.0), p) * (0.15 + 0.6 * uSwirl) - v) * SWIRL_GRIP;
    // 3. Quiet-time gather, confinement, gravity and the hot grains' lift.
    //    The confinement has two halves. The spring pulls each grain toward
    //    the *nearest* wandering attractor, not toward one fixed centre, so
    //    the mass is a few merging lobes rather than a ball; the outer ramp
    //    is gentle and its radius is modulated by a slow noise over the
    //    direction, so the silhouette is lumpy and keeps changing instead of
    //    showing a hard bright skin at one radius.
    vec3 dc = p - CONFINE_CENTRE;
    float rad = length(dc);
    //    "Nearest attractor" would be a discontinuous field: grains on the
    //    boundary between two basins pile onto it and the mass turns into
    //    thin, blown-out sheets. An inverse-square-weighted blend is the same
    //    multi-lobed shape with no shock surface in it.
    vec3 pull = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < ${MAX_ATTRACTORS}; i++) {
      vec3 q = uAttractor[i];
      vec3 dq = p - q;
      float w = 1.0 / (0.35 + dot(dq, dq));
      pull += q * w;
      wsum += w;
    }
    vec3 nearest = pull / max(wsum, 1e-4);
    float rScale = 0.75 + 0.5 * vnoiseW(normalize(dc + 1e-5) * 1.4
                                        + vec3(0.0, uTime * 0.04, 0.0) + 11.0);
    a -= (p - nearest) * CONFINE_BASE;
    a -= dc * gather;
    a -= dc * (CONFINE_ACCEL * smoothstep(CONFINE_R0 * sizeFac * rScale,
                                          CONFINE_R1 * sizeFac * rScale, rad));
    a.y -= GRAVITY;
    a.y += BUOYANCY * heat;

    // 4. Burst plumes: a cone-weighted outward impulse from the source while
    //    the push lasts, plus a vortex ring about the axis that outlives it
    //    and rolls the head of the plume over.
    for (int i = 0; i < ${MAX_BURSTS}; i++) {
      float age = uTime - uBurstT0[i];
      if (age < 0.0 || age > BURST_LIFE) continue;
      float st = uBurstStrength[i];
      vec3 d = p - uBurstOrigin[i];
      float r = length(d);
      vec3 dir = d / max(r, 1e-3);
      if (age < BURST_PUSH) {
        float w = mix(BURST_SIDE, 1.0, pow(max(dot(dir, uBurstAxis[i]), 0.0), 3.0));
        float f = exp(-r * r / (2.0 * burstRadius * burstRadius));
        a += dir * (w * f * st * BURST_ACCEL * sizeFac * (0.5 + h) * (1.0 - age / BURST_PUSH));
      }
      // The roll-over at the head of the plume. Held to the neighbourhood of
      // the source by the same gaussian as the push: applied to the whole
      // cloud it stops being a mushroom and becomes a hard bright hoop, since
      // every grain at one radius from the axis ends up on the same orbit.
      if (age < VORTEX_SEC) {
        float fv = exp(-r * r / (2.0 * burstRadius * burstRadius));
        a += cross(uBurstAxis[i], d) / max(r * r + 0.3, 0.3) * (st * VORTEX * fv * exp(-age * 1.6));
      }
    }

    // 5. Drag, then integrate. Drag is applied as a decay on the existing
    //    velocity rather than as a force, so a long frame can never flip it.
    v *= exp(-(DRAG_LIN + DRAG_QUAD * length(v)) * dt);
    v += a * dt;
    float sp = length(v);
    if (sp > VEL_RANGE) v *= VEL_RANGE / sp;
    p += v * dt;

    // 6. Floor and walls. Powder that lands lies there — the floor collecting
    //    colour between drops is a feature, not a leak.
    if (p.y < CAGE_FLOOR_Y) {
      p.y = CAGE_FLOOR_Y;
      v.y = -FLOOR_BOUNCE * v.y;
      v.xz *= FLOOR_FRICTION;
      settled += dt;
    } else {
      settled = max(0.0, settled - dt * 2.0);
    }
    if (p.y > CAGE_CEIL_Y) { p.y = CAGE_CEIL_Y; v.y = -WALL_BOUNCE * abs(v.y); }
    if (p.x < -CAGE_HALF_X) { p.x = -CAGE_HALF_X; v.x = WALL_BOUNCE * abs(v.x); }
    if (p.x > CAGE_HALF_X) { p.x = CAGE_HALF_X; v.x = -WALL_BOUNCE * abs(v.x); }
    if (p.z < -CAGE_HALF_Z) { p.z = -CAGE_HALF_Z; v.z = WALL_BOUNCE * abs(v.z); }
    if (p.z > CAGE_HALF_Z) { p.z = CAGE_HALF_Z; v.z = -WALL_BOUNCE * abs(v.z); }

    // 7. Heat is speed. A plume is red at the tip and cools as it slows,
    //    which is the whole of the reference's colour story; uHeat only
    //    decides how readily speed reads as hot (see POINT_FRAG).
    float speedHeat = clamp(length(v) / 2.8, 0.0, 1.0);
    heat = max(heat * exp(-0.9 * dt), speedHeat);
    // Spin phase, in turns: fast grains twinkle faster.
    phase = fract(phase + length(v) * dt * 0.6366);
  }

  settled = min(settled, SETTLE_AGE_MAX);
  outPosXY = vec4(packAxis(p.x), packAxis(p.y));
  outPosZW = vec4(packAxis(p.z), clamp(heat, 0.0, 1.0), settled / SETTLE_AGE_MAX);
  outVelXY = vec4(packAxisR(v.x, VEL_RANGE), packAxisR(v.y, VEL_RANGE));
  outVelZW = vec4(packAxisR(v.z, VEL_RANGE), phase, 1.0);
}
`;

const ROOM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${POWDER_GLSL}

void main() {
  vec2 ruv = roomUv(vUv);
  vec3 ro = uEye;
  vec3 rd = roomRay(ruv);
  // Guard the slab test against an exactly axis-aligned ray.
  vec3 rdSafe = rd + vec3(lessThan(abs(rd), vec3(1e-5))) * 1e-5;
  vec3 inv = 1.0 / rdSafe;
  vec3 ta = (ROOM_MIN - ro) * inv;
  vec3 tb = (ROOM_MAX - ro) * inv;
  vec3 tFar = max(ta, tb);
  float tExit = min(min(tFar.x, tFar.y), tFar.z);
  vec3 hit = ro + rd * tExit;

  // Which of the six interior faces the ray leaves through.
  vec3 face = step(tFar, vec3(tExit + 1e-4));
  float onFloor = face.y * step(hit.y, ROOM_MIN.y + 0.01);

  // Back wall reads slightly lighter than the side walls; the floor is the
  // darkest surface in the room.
  float tone = mix(0.72, 1.0, face.z);
  tone = mix(tone, 0.60, face.y);
  tone = mix(tone, 0.42, onFloor);
  // A soft vertical gradient — light spills from the ceiling corner.
  tone *= 0.65 + 0.75 * smoothstep(ROOM_MIN.y, ROOM_MAX.y, hit.y);

  vec3 col = vec3(0.028, 0.036, 0.062) * tone;

  // Grainy wall texture at two scales.
  float grain = mix(vnoise(hit * 7.0), vnoise(hit * 29.0), 0.4);
  col *= mix(1.0, 0.4 + 1.2 * grain, 0.12);

  // A faint rim where two faces meet: the box's own corners, nothing else.
  // The rim is where the kick reads from the back of the room, so it takes a
  // far bigger punch than the walls do.
  vec3 toEdge = min(hit - ROOM_MIN, ROOM_MAX - hit) + face * 1e3;
  float edge = min(min(toEdge.x, toEdge.y), toEdge.z);
  float rim = 1.0 - smoothstep(0.0, 0.08, edge);
  col += vec3(0.030, 0.038, 0.055) * rim * (1.0 + uFlash * (2.0 * uLowPulse + 4.0 * uDropPulse));
  // The floor picks up the same punch, so a kick lights the room's ground.
  col += vec3(0.020, 0.026, 0.045) * onFloor * uFlash * (1.2 * uLowPulse + 3.0 * uDropPulse);

  // Distance fog toward black, and a vignette on the shared room canvas
  // (not on vUv, so a Panorama slice doesn't get its own dark corners).
  col *= 1.0 - 0.75 * smoothstep(2.5, 9.0, tExit);
  vec2 vc = (ruv - 0.5) * vec2(2.0, 1.6);
  col *= 1.0 - 0.55 * dot(vc, vc);

  col = max(col, vec3(0.0));
  col *= 0.15 + uRoom;
  col *= 1.0 + uFlash * (0.35 * uBeatPulse + 2.5 * uDropPulse);
  outColor = vec4(col, 1.0);
}
`;

const POINT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPosXY;
uniform sampler2D uPosZW;
uniform sampler2D uVelZW;
uniform float uSide;
uniform float uGrainPx;   // point diameter at SIZE_DEPTH_REF, buffer pixels
uniform float uMaxPointPx;
${POWDER_GLSL}
out float vHeat;
out float vDepthFade;
out float vSeed;
out float vPhase;
out float vFloor;

void main() {
  int side = int(uSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec4 cxy = texelFetch(uPosXY, texel, 0);
  vec4 czw = texelFetch(uPosZW, texel, 0);
  vec4 wzw = texelFetch(uVelZW, texel, 0);
  vec3 p = spin(vec3(unpackAxis(cxy.rg), unpackAxis(cxy.ba), unpackAxis(czw.rg)));
  vHeat = czw.b;
  vPhase = wzw.b;
  // Grains that have lain on the floor for a while: the carpet of colour the
  // room collects between drops. Dimmer and fatter, so it reads as a settled
  // layer rather than as live powder.
  vFloor = smoothstep(0.04, 0.7, czw.a * SETTLE_AGE_MAX);

  vec3 v = worldToView(p);
  if (v.z <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vDepthFade = 0.0;
    vSeed = 0.0;
    return;
  }

  vec2 ndc = viewToNdc(v);
  vec2 room = ndc * 0.5 + 0.5;
  vec2 dev = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);

  // No two specks alike: a fixed per-particle random, used for a brightness
  // jitter and for the one-in-twelve sparkle pick.
  vSeed = hash21(vec2(texel) * 0.731 + 3.17);
  vDepthFade = mix(1.0, 0.35, smoothstep(2.0, 5.2, v.z));

  // Size comes from JS (see pointSizing) so the brightness correction that
  // pairs with it can be computed from the same numbers; the kick swells it
  // for one decay so the punch reads from the back of the room.
  float grow = (1.0 + 0.25 * uLowPulse * uKick) * mix(1.0, 1.2, vFloor);
  gl_PointSize = clamp(uGrainPx * grow * SIZE_DEPTH_REF / max(v.z, 0.5), 1.0, uMaxPointPx * 2.0);
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vHeat;
in float vDepthFade;
in float vSeed;
in float vPhase;
in float vFloor;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uGrainGain;
uniform float uHueShift;
uniform float uDim;
${PALETTE_GLSL}
${POWDER_GLSL}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // A gaussian-ish falloff rather than a hard-edged blob: overlapping
  // sprites then sum into smoke instead of into speckle.
  float soft = exp(-r2 * 10.0);

  // A real ice blue, not a pale one: additive summing walks every colour
  // toward white, so the resting hue has to start well clear of it. Both ends
  // of the pair walk round the wheel together as the track goes on.
  vec3 cool = hueRotate(vec3(0.30, 0.55, 1.00), uHueShift);
  vec3 hot = hueRotate(vec3(1.00, 0.24, 0.16), uHueShift);
  // Red heat decides how much speed it takes to read as hot, not how much
  // heat there is — the sim's heat *is* the grain's own speed.
  // Sharp, and centred on (0.1, 0.55) at the Red heat default: a shallow
  // ramp mixes a little coral into a lot of blue everywhere, which reads as
  // brown-amber haze rather than as a hot plume inside a cold mass.
  float k = 1.6 - 1.5 * uHeat;
  float hotness = smoothstep(0.1 * k, 0.55 * k, vHeat);
  vec3 col = mix(cool, hot, hotness);
  col = mix(col, palette(0.3 + 0.5 * vHeat, uPalA, uPalB, uPalC, uPalD), uPaletteMix);

  // The coral is much darker than the ice blue at equal brightness; lift it
  // so a red plume reads as hot rather than as a hole in the cloud.
  float jitter = 0.85 + 0.3 * vSeed;
  float bright = uGrainGain * (0.35 + 0.9 * uGlow) * jitter * vDepthFade
               * (1.0 + 0.5 * hotness) * (1.0 + uFlash * uBeatPulse * 0.6)
               * mix(1.0, 0.06, vFloor) * uDim;
  vec3 rgb = col * (bright * soft);

  // One grain in twelve twinkles white on the hats, its own spin phase
  // deciding where in the flash it currently is.
  float pick = step(0.9167, vSeed);
  float twinkle = pick * uSparkle * (0.5 * uHigh + 1.5 * uHighPulse)
                * (0.5 + 0.5 * sin(vPhase * 6.2831853));
  rgb += vec3(1.0, 0.97, 0.92) * (twinkle * soft * uGrainGain * 3.5 * vDepthFade * uDim);

  outColor = vec4(rgb, 1.0);
}
`;

const CHUNK_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uChunkT0[${MAX_CHUNK_BURSTS}];
uniform float uChunkStrength[${MAX_CHUNK_BURSTS}];
uniform float uChunkSeed[${MAX_CHUNK_BURSTS}];
uniform vec3 uChunkOrigin[${MAX_CHUNK_BURSTS}];
uniform vec3 uChunkAxis[${MAX_CHUNK_BURSTS}];
${POWDER_GLSL}
uniform float uResScale;
out float vRot;
out float vFade;

const int PER_BURST = ${CHUNKS_PER_BURST};
const float LIFE = ${CHUNK_LIFE_SEC.toFixed(3)};
const float DRAG = 1.6;
const float CHUNK_GRAVITY = 1.7;

void main() {
  int burst = gl_VertexID / PER_BURST;
  int idx = gl_VertexID - burst * PER_BURST;
  float age = uTime - uChunkT0[burst];
  if (age < 0.0 || age > LIFE) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vRot = 0.0;
    vFade = 0.0;
    return;
  }

  float strength = uChunkStrength[burst];
  float sizeFac = sizeFactor();
  vec3 h = hash33(vec3(float(idx), uChunkSeed[burst], 1.7));
  // Cone-weighted about the powder plume's own axis, out of the powder
  // plume's own origin: the cubes ride the plume instead of forming their own
  // unrelated ring of red squares.
  vec3 dir = normalize(uChunkAxis[burst] + (h * 2.0 - 1.0) * 0.65);
  float v0 = (1.2 + 2.0 * h.x) * strength * sizeFac;
  // Drag-damped launch plus gravity, evaluated in closed form — see the
  // file header for why the cubes carry no state.
  vec3 pos = uChunkOrigin[burst]
           + dir * (0.06 + v0 * (1.0 - exp(-DRAG * age)) / DRAG)
           + vec3(0.0, -0.5 * CHUNK_GRAVITY * age * age, 0.0);
  pos.y = max(pos.y, CAGE_FLOOR_Y);

  vec3 v = worldToView(spin(pos));
  // A cube that flies past the camera would otherwise be drawn as one huge
  // near-field square; cull it well before it gets there.
  if (v.z <= 0.7) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vRot = 0.0;
    vFade = 0.0;
    return;
  }

  vec2 ndc = viewToNdc(v);
  vec2 room = ndc * 0.5 + 0.5;
  vec2 dev = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);

  vFade = 1.0 - smoothstep(0.6 * LIFE, LIFE, age);
  vRot = age * (3.0 + 4.0 * h.y);
  gl_PointSize = min(mix(9.0, 18.0, h.z) * SIZE_DEPTH_REF / max(v.z, 0.7), 26.0) * uResScale * vFade;
}
`;

const CHUNK_FRAG = `#version 300 es
precision highp float;
in float vRot;
in float vFade;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uHueShift;
uniform float uDim;
${PALETTE_GLSL}
${POWDER_GLSL}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  float box = max(abs(q.x), abs(q.y));
  if (box > 0.36) discard;
  // Two-tone "cube": opposite quadrants read as a lit and an unlit face,
  // with a darker rim so the chunk has an edge rather than a glow.
  float shade = 0.7 + 0.5 * step(0.0, q.x * q.y);
  shade *= 1.0 - 0.35 * smoothstep(0.28, 0.36, box);
  vec3 hot = hueRotate(vec3(1.00, 0.22, 0.16), uHueShift * ${CHUNK_HUE_FRACTION.toFixed(3)});
  vec3 col = mix(hot, palette(0.72, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  outColor = vec4(col * (1.3 * shade * vFade * 0.9 * uDim), 1.0);
}
`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;

void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270;
  c += (texture(uTex, vUv + uBlurStep).rgb + texture(uTex, vUv - uBlurStep).rgb) * 0.1945946;
  c += (texture(uTex, vUv + uBlurStep * 2.0).rgb + texture(uTex, vUv - uBlurStep * 2.0).rgb) * 0.1216216;
  c += (texture(uTex, vUv + uBlurStep * 3.0).rgb + texture(uTex, vUv - uBlurStep * 3.0).rgb) * 0.0540541;
  c += (texture(uTex, vUv + uBlurStep * 4.0).rgb + texture(uTex, vUv - uBlurStep * 4.0).rgb) * 0.0162162;
  outColor = vec4(c, 1.0);
}
`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uGlowTex;
uniform sampler2D uBlurTex;
uniform float uDim;
const float TONE_KNEE = ${TONE_KNEE.toFixed(3)};

void main() {
  vec3 sharpC = texture(uGlowTex, vUv).rgb;
  vec3 blurC = texture(uBlurTex, vUv).rgb;
  // Roll the powder's own highlights off rather than letting the 8-bit
  // framebuffer clip them. Hard clipping is not just a lost highlight here:
  // additive powder clips its brightest channel first, so an over-exposed
  // ice-blue cloud turns cyan and a hot plume turns magenta — the scene loses
  // the one pair of colours it is about. Per-channel Reinhard with a knee
  // just above white keeps the hue, and means a dense fold reads as bright
  // powder rather than as a hole punched in the cloud.
  vec3 col = sharpC / (1.0 + sharpC / TONE_KNEE);
  // The halo carries the glow, and the drop's flash rides on the halo and the
  // room only. Applied to the sharp layer as well it just blows the core into
  // a white hole for half a second.
  col += blurC * (uBloom * ${BLOOM_WEIGHT.toFixed(3)} * uDim * (1.0 + 2.5 * uDropPulse * uFlash));
  // One last shoulder on the sum. The knee above stops the powder alone from
  // clipping, but the halo lands on top of it, and an exponential shoulder
  // only reaches white asymptotically — so the densest fold reads as bright
  // powder with its hue intact instead of as a flat white hole.
  col = 1.0 - exp(-col);
  outColor = vec4(col, 1.0);
}
`;

/** Packs one axis into two bytes of `out` at `off`, matching packAxisR(). */
function writeAxis(out: Uint8Array, off: number, v: number, range: number): void {
  const clamped = Math.max(-range, Math.min(range, v));
  const u = Math.round(((clamped / range) * 0.5 + 0.5) * 65535);
  out[off] = u >> 8;
  out[off + 1] = u & 255;
}

interface SeedState {
  xy: Uint8Array;
  zw: Uint8Array;
  vxy: Uint8Array;
  vzw: Uint8Array;
}

/** Seeds the four state textures with a small ball of powder at rest, so the
 *  very first frame already reads as a cloud rather than as a cube of static
 *  the sim then has to sort out. */
function seedPositions(side: number): SeedState {
  const n = side * side;
  const xy = new Uint8Array(n * 4);
  const zw = new Uint8Array(n * 4);
  const vxy = new Uint8Array(n * 4);
  const vzw = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let d2 = 2;
    while (d2 > 1 || d2 < 1e-6) {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      d2 = x * x + y * y + z * z;
    }
    const r = 0.3;
    writeAxis(xy, i * 4, x * r, POS_RANGE);
    writeAxis(xy, i * 4 + 2, y * r, POS_RANGE);
    writeAxis(zw, i * 4, z * r, POS_RANGE);
    zw[i * 4 + 2] = 0;
    zw[i * 4 + 3] = 0;
    writeAxis(vxy, i * 4, 0, VEL_RANGE);
    writeAxis(vxy, i * 4 + 2, 0, VEL_RANGE);
    writeAxis(vzw, i * 4, 0, VEL_RANGE);
    vzw[i * 4 + 2] = (i * 37) & 255;
    vzw[i * 4 + 3] = 255;
  }
  return { xy, zw, vxy, vzw };
}

function createPowderScene(): Scene {
  let simProg: GLProgram | null = null;
  let roomProg: GLProgram | null = null;
  let pointProg: GLProgram | null = null;
  let chunkProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  // Four colour attachments per ping-pong slot — see the file header.
  const texXY: (WebGLTexture | null)[] = [null, null];
  const texZW: (WebGLTexture | null)[] = [null, null];
  const texVXY: (WebGLTexture | null)[] = [null, null];
  const texVZW: (WebGLTexture | null)[] = [null, null];
  const fbo: (WebGLFramebuffer | null)[] = [null, null];
  // Half-res bloom chain: the powder draws into glow, two separable blurs
  // bounce it through blurA into blurB.
  let glowTex: WebGLTexture | null = null;
  let blurTexA: WebGLTexture | null = null;
  let blurTexB: WebGLTexture | null = null;
  let glowFbo: WebGLFramebuffer | null = null;
  let blurFboA: WebGLFramebuffer | null = null;
  let blurFboB: WebGLFramebuffer | null = null;
  let glowW = 0;
  let glowH = 0;
  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  let read = 0;
  let side = 1;
  let grainCount = 0;
  let lastFrameTime: number | null = null;
  let prevLowPulse = 0;
  let prevDropPulse = 0;
  let yaw = 0;
  let calm = 1;
  let shakeLeft = 0;
  let sinceDrop = DROP_REFRACTORY_SEC;
  let bigHit: BigHitDetector | null = null;
  let bursts: BurstPool | null = null;
  let chunks: ChunkPool | null = null;
  let hue: HueDrift | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const eyeBuf = new Float32Array(3);
  const attractorBuf = new Float32Array(MAX_ATTRACTORS * 3);
  const chunkOrigin: [number, number, number] = [0, 0, 0];
  const chunkAxis: [number, number, number] = [0, 1, 0];

  /** Cached sampler locations. GLProgram has no integer setter — samplers are
   *  the one uniform kind that needs one — so the unit is set with
   *  gl.uniform1i against a location looked up once per (program, name). */
  function samplerLoc(
    gl: WebGL2RenderingContext,
    prog: GLProgram,
    key: string,
    name: string,
  ): WebGLUniformLocation | null {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  function makeStateTexture(gl: WebGL2RenderingContext, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** A half-res LINEAR/CLAMP colour target. LINEAR because the composite
   *  upsamples it 2x and the blur taps between texels. */
  function makeGlowTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function attachColour(gl: WebGL2RenderingContext, tex: WebGLTexture | null): WebGLFramebuffer | null {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`powder: bloom framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  function freeGlowTargets(gl: WebGL2RenderingContext): void {
    if (glowFbo) gl.deleteFramebuffer(glowFbo);
    if (blurFboA) gl.deleteFramebuffer(blurFboA);
    if (blurFboB) gl.deleteFramebuffer(blurFboB);
    if (glowTex) gl.deleteTexture(glowTex);
    if (blurTexA) gl.deleteTexture(blurTexA);
    if (blurTexB) gl.deleteTexture(blurTexB);
    glowFbo = null;
    blurFboA = null;
    blurFboB = null;
    glowTex = null;
    blurTexA = null;
    blurTexB = null;
    glowW = 0;
    glowH = 0;
  }

  /** Rebuilds the bloom chain when the drawing buffer changes size. The
   *  quality governor moves renderScale at runtime, so the stored size is
   *  compared every frame rather than trusted from init. */
  function ensureGlowTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth >> 1);
    const h = Math.max(1, gl.drawingBufferHeight >> 1);
    if (w === glowW && h === glowH && glowFbo) return;
    freeGlowTargets(gl);
    glowTex = makeGlowTexture(gl, w, h);
    blurTexA = makeGlowTexture(gl, w, h);
    blurTexB = makeGlowTexture(gl, w, h);
    glowFbo = attachColour(gl, glowTex);
    blurFboA = attachColour(gl, blurTexA);
    blurFboB = attachColour(gl, blurTexB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    glowW = w;
    glowH = h;
  }

  return {
    id: ID,
    name: "Powder",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      simProg = createProgram(gl, SIM_FRAG);
      roomProg = createProgram(gl, ROOM_FRAG);
      pointProg = createProgram(gl, POINT_FRAG, POINT_VERT);
      chunkProg = createProgram(gl, CHUNK_FRAG, CHUNK_VERT);
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);
      // Both point passes address their data by gl_VertexID and have no
      // vertex attributes at all, so they draw from an empty VAO rather than
      // the quad's 3-vertex buffer (which they'd read far past).
      pointVao = gl.createVertexArray();

      grainCount = Math.max(1, Math.floor(ctx.quality.maxParticles));
      side = grainTextureSide(grainCount);
      const seed = seedPositions(side);
      for (let i = 0; i < 2; i++) {
        texXY[i] = makeStateTexture(gl, seed.xy);
        texZW[i] = makeStateTexture(gl, seed.zw);
        texVXY[i] = makeStateTexture(gl, seed.vxy);
        texVZW[i] = makeStateTexture(gl, seed.vzw);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texXY[i], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texZW[i], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, texVXY[i], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, texVZW[i], 0);
        // drawBuffers is per-framebuffer state, so setting it here sticks for
        // the life of the FBO — the default framebuffer keeps its own.
        gl.drawBuffers([
          gl.COLOR_ATTACHMENT0,
          gl.COLOR_ATTACHMENT1,
          gl.COLOR_ATTACHMENT2,
          gl.COLOR_ATTACHMENT3,
        ]);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`powder: sim framebuffer incomplete (0x${status.toString(16)})`);
        }
        fbo[i] = f;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      ensureGlowTargets(gl);

      read = 0;
      lastFrameTime = null;
      prevLowPulse = 0;
      prevDropPulse = 0;
      yaw = 0;
      calm = 1;
      shakeLeft = 0;
      sinceDrop = DROP_REFRACTORY_SEC;
      bigHit = createBigHitDetector();
      bursts = createBurstPool();
      chunks = createChunkPool();
      hue = createHueDrift();
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!simProg || !roomProg || !pointProg || !chunkProg || !blurProg || !compositeProg) return;
      if (!quadVao || !pointVao) return;
      if (!bigHit || !bursts || !chunks || !hue) return;
      const { gl } = ctx;
      ensureGlowTargets(gl);

      // See the file header (and chladni.ts's) for why frame.time and not
      // anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // Rises, not one-shots — see the file header.
      const lowRose = anim.lowPulse > prevLowPulse + 1e-3 || anim.lowOnset;
      // anim.dropOnset is not the one-shot its name suggests — it is a level
      // test on how fast the section is rising (see sectionIntensity.ts), so
      // it stays true for tens of consecutive frames through one drop. Every
      // one of those would fire its own opposed pair of plumes, restart the
      // shake and step the hue, so the whole drop is collapsed to a single
      // event with a refractory window.
      sinceDrop += dt;
      const dropRaw = anim.dropPulse > prevDropPulse + 0.05 || anim.dropOnset;
      const dropRose = dropRaw && sinceDrop >= DROP_REFRACTORY_SEC;
      if (dropRose) sinceDrop = 0;
      prevLowPulse = anim.lowPulse;
      prevDropPulse = anim.dropPulse;

      const breatheS = resolveSceneSetting(ID, settingFor("breathe"));
      const kickS = resolveSceneSetting(ID, settingFor("kick"));
      const chunksS = resolveSceneSetting(ID, settingFor("chunks"));
      const grainS = resolveSceneSetting(ID, settingFor("grain"));
      const cameraS = resolveSceneSetting(ID, settingFor("camera"));
      const hueDriftS = resolveSceneSetting(ID, settingFor("hueDrift"));

      // Every on-screen size is measured against the buffer it is actually
      // drawn into, and the powder is drawn into the half-res glow target —
      // see pointSizing for why that matters.
      const resScale = Math.max(MIN_RES_SCALE, glowH / REFERENCE_HEIGHT_PX);

      // Quiet-time gather, slewed: a breakdown pulls the dispersed powder
      // back into a turning blob over a couple of seconds.
      calm += (calmTarget(anim.sectionIntensity, anim.low) - calm) * (1 - Math.exp(-dt / CALM_TAU));

      // A breakdown is a hush: the cloud and its halo drop to about 60%.
      const dim = 1 - 0.4 * (1 - clamp01(anim.sectionIntensity)) * breatheS;
      const hueShift = hue.advance(dt, anim.barPhase, dropRose, hueDriftS);

      // Plumes. A kick throws one; a drop throws two out of the same source
      // in opposite directions, which is what makes it read as a burst rather
      // than as a louder kick.
      bursts.tick(anim.timeSec);
      if (dropRose) {
        const s = Math.min(1, 1.3 * kickS);
        const seed = Math.random() * 100;
        bursts.trigger(anim.timeSec, s, seed);
        bursts.trigger(anim.timeSec, s, seed, true);
        shakeLeft = SHAKE_SEC;
      } else if (lowRose && kickS >= 0.05) {
        bursts.trigger(anim.timeSec, kickS * (0.5 + 0.7 * anim.lowPulse), Math.random() * 100);
      }

      // The detector's baseline is stepped every frame regardless, so turning
      // the cubes back on doesn't fire a stale burst from a cold baseline.
      const hitStrength = bigHit.advance(dt, anim.low, anim.lowPulse, anim.sectionIntensity, lowRose, dropRose);
      chunks.tick(anim.timeSec);
      if (chunksS >= 0.05 && hitStrength > 0) {
        // Whichever plume fired most recently is the one the cubes belong to.
        let newest = bursts.bursts[0];
        for (const b of bursts.bursts) if (b.t0 > newest.t0) newest = b;
        chunkOrigin[0] = newest.originX;
        chunkOrigin[1] = newest.originY;
        chunkOrigin[2] = newest.originZ;
        chunkAxis[0] = newest.axisX;
        chunkAxis[1] = newest.axisY;
        chunkAxis[2] = newest.axisZ;
        chunks.trigger(anim.timeSec, hitStrength * (0.5 + chunksS), Math.random() * 100, chunkOrigin, chunkAxis);
      }

      yaw = (yaw + (0.03 + 0.25 * cameraS) * dt) % (Math.PI * 2);

      // Camera: pushes in on the kick, shakes for SHAKE_SEC after a drop.
      const push = 1 - 0.06 * anim.lowPulse * cameraS;
      eyeBuf[0] = 0;
      eyeBuf[1] = EYE_Y * push;
      eyeBuf[2] = EYE_Z * push;
      if (shakeLeft > 0) {
        const amp = SHAKE_AMP * cameraS * anim.dropPulse * (shakeLeft / SHAKE_SEC);
        eyeBuf[0] += (Math.random() * 2 - 1) * amp;
        eyeBuf[1] += (Math.random() * 2 - 1) * amp;
        eyeBuf[2] += (Math.random() * 2 - 1) * amp * 0.5;
        shakeLeft = Math.max(0, shakeLeft - dt);
      }

      const common = (prog: GLProgram): void => {
        uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        prog.setF("uYaw", yaw);
        prog.setV3v("uEye", eyeBuf);
      };

      gl.disable(gl.BLEND);

      // 1. Sim pass: step every particle from fbo[read] into fbo[write].
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[write]);
      gl.viewport(0, 0, side, side);
      simProg.use();
      common(simProg);
      simProg.setF("uSimDt", dt);
      simProg.setF("uCalm", calm);
      simProg.setV3v("uAttractor", attractorPositions(anim.timeSec, attractorBuf));
      bursts.upload(simProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texXY[read]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texZW[read]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, texVXY[read]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, texVZW[read]);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uPosXY", "uPosXY"), 0);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uPosZW", "uPosZW"), 1);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uVelXY", "uVelXY"), 2);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uVelZW", "uVelZW"), 3);
      drawFullscreenQuad(gl, quadVao);
      read = write;

      // 2. Room, straight to the default framebuffer. Both hosts size the
      // viewport to the drawing buffer and only re-set it on resize; the
      // gallery preview sets it per frame. Either way the drawing buffer is
      // the right thing to restore to.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      roomProg.use();
      common(roomProg);
      drawFullscreenQuad(gl, quadVao);

      // 3. Powder and chunks, additive into the half-res glow target.
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFbo);
      gl.viewport(0, 0, glowW, glowH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      pointProg.use();
      common(pointProg);
      pointProg.setF("uSide", side);
      pointProg.setF("uHueShift", hueShift);
      pointProg.setF("uDim", dim);
      const grainPx = GRAIN_PX_MIN + (GRAIN_PX_MAX - GRAIN_PX_MIN) * grainS;
      const sizing = pointSizing(grainPx, resScale, sparseSizeScale(grainCount));
      pointProg.setF("uGrainPx", sizing.sizePx);
      pointProg.setF("uMaxPointPx", sizing.maxPx);
      // No grainGain() here — sparseSizeScale already holds a sparse bed's
      // coverage constant by area; brightening it as well would double up.
      pointProg.setF("uGrainGain", POWDER_GAIN * sizing.gain);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texXY[read]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texZW[read]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, texVZW[read]);
      gl.uniform1i(samplerLoc(gl, pointProg, "pt.uPosXY", "uPosXY"), 0);
      gl.uniform1i(samplerLoc(gl, pointProg, "pt.uPosZW", "uPosZW"), 1);
      gl.uniform1i(samplerLoc(gl, pointProg, "pt.uVelZW", "uVelZW"), 3);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, grainCount);

      // 4. Chunks — skipped entirely while nothing is flying.
      if (chunks.alive() > 0) {
        chunkProg.use();
        common(chunkProg);
        chunkProg.setF("uResScale", resScale);
        chunkProg.setF("uHueShift", hueShift);
        chunkProg.setF("uDim", dim);
        chunks.upload(chunkProg);
        gl.drawArrays(gl.POINTS, 0, MAX_CHUNK_BURSTS * CHUNKS_PER_BURST);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // 5. Two separable blurs, half-res throughout.
      blurProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(samplerLoc(gl, blurProg, "blur.uTex", "uTex"), 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboA);
      gl.bindTexture(gl.TEXTURE_2D, glowTex);
      blurProg.setV2("uBlurStep", BLUR_STRIDE / glowW, 0);
      drawFullscreenQuad(gl, quadVao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboB);
      gl.bindTexture(gl.TEXTURE_2D, blurTexA);
      blurProg.setV2("uBlurStep", 0, BLUR_STRIDE / glowH);
      drawFullscreenQuad(gl, quadVao);

      // 6. Composite the sharp powder plus its halo over the room.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      compositeProg.use();
      uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      compositeProg.setF("uDim", dim);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glowTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurTexB);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uGlowTex", "uGlowTex"), 0);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uBlurTex", "uBlurTex"), 1);
      drawFullscreenQuad(gl, quadVao);

      // 7. The gallery renders every scene into one shared context each tick
      // — must not leak blend state, a bound texture or a non-default active
      // texture unit onto the next tile.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      for (let unit = 3; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      simProg?.dispose();
      roomProg?.dispose();
      pointProg?.dispose();
      chunkProg?.dispose();
      blurProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      for (let i = 0; i < 2; i++) {
        if (fbo[i]) gl.deleteFramebuffer(fbo[i]);
        if (texXY[i]) gl.deleteTexture(texXY[i]);
        if (texZW[i]) gl.deleteTexture(texZW[i]);
        if (texVXY[i]) gl.deleteTexture(texVXY[i]);
        if (texVZW[i]) gl.deleteTexture(texVZW[i]);
        fbo[i] = null;
        texXY[i] = null;
        texZW[i] = null;
        texVXY[i] = null;
        texVZW[i] = null;
      }
      freeGlowTargets(gl);
      samplerLocs.clear();
      simProg = null;
      roomProg = null;
      pointProg = null;
      chunkProg = null;
      blurProg = null;
      compositeProg = null;
      quadVao = null;
      pointVao = null;
      lastFrameTime = null;
      prevLowPulse = 0;
      prevDropPulse = 0;
      yaw = 0;
      calm = 1;
      shakeLeft = 0;
      sinceDrop = DROP_REFRACTORY_SEC;
      bigHit = null;
      bursts = null;
      chunks = null;
      hue = null;
    },
  };
}

export const powderScene = createPowderScene();
