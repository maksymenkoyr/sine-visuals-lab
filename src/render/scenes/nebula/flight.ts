/**
 * Nebula's camera, on the JS side: where it is in the gas, which way it
 * looks, how far the view has rolled, how far the colours have wandered,
 * and how far the gas has drifted on its own.
 *
 * The gas is a volume texture that repeats every `PERIOD` world units
 * across the flight and every `PERIOD_Z` along it (volume.ts, glsl.ts).
 * The camera flies along +z on a path that weaves in x and y, a sum of
 * the sines in `PATH_X` / `PATH_Y`. Their wavelengths
 * share no common period with the volume or with each other, so the flight
 * never comes back to the same view. glsl.ts carves a tunnel of open space
 * around the same path (radius from `PATH_R`), which keeps the camera in
 * the voids between the gas the way the reference's camera stays.
 *
 * The distance flown grows for the whole session, so it stays here in
 * float64. The shader only gets the camera's position reduced into one
 * volume period, and each path sine's phase reduced into one turn.
 * src/render/noiseHash.ts's header says why nothing growing may reach a
 * noise coordinate.
 */

/** World units per repeat of the gas across the flight (x, y) and along it (z). The gas is
 *  stretched along the flight, so its repeat is longer there; PERIOD_Z must be a whole multiple of
 *  PERIOD (stars.ts repeats every PERIOD on all three axes), and everything glsl.ts samples repeats
 *  a whole number of times per period, so wrapping the camera by them never shows. */
export const PERIOD = 10;
export const PERIOD_Z = 30;

export interface PathSine {
  amp: number;
  wavelength: number;
  phase: number;
}

// The path's weave, in world units. Wavelengths are mutually irrational on
// purpose: a rational pair would bring the same view back every lap.
export const PATH_X: readonly PathSine[] = [
  { amp: 0.9, wavelength: 23.7, phase: 0.4 },
  { amp: 0.35, wavelength: 9.13, phase: 2.1 },
];
export const PATH_Y: readonly PathSine[] = [
  { amp: 0.7, wavelength: 31.3, phase: 1.3 },
  { amp: 0.3, wavelength: 11.9, phase: 4.0 },
];
/** The tunnel's radius swells and narrows along the path, so gas sometimes crosses the view ahead. */
export const PATH_R: readonly PathSine[] = [
  { amp: 0.45, wavelength: 17.3, phase: 0.0 },
  { amp: 0.25, wavelength: 6.71, phase: 1.7 },
];

/** How far ahead on the path the camera looks, in world units: longer smooths the heading. */
const LOOK_AHEAD = 2.5;

// The roll swings back and forth rather than spinning: the reference's
// measured roll rate wanders between about -1.2 and +2.8 degrees per second
// (docs/scenes/nebula.md). Amplitudes in radians at Roll 1; wavelengths in
// world units flown, so a faster flight rolls faster too.
const ROLL: readonly PathSine[] = [
  { amp: 0.42, wavelength: 13.1, phase: 0.0 },
  { amp: 0.08, wavelength: 5.27, phase: 2.6 },
];

// The colour wander, in degrees at Colour drift 1, over seconds of wall
// time: the reference's grade wanders the whole hue wheel and back over
// its two hours, about 100 degrees in the first ten minutes
// (docs/scenes/nebula.md).
const HUE_WANDER: readonly PathSine[] = [
  { amp: 100, wavelength: 4000, phase: 0.0 },
  { amp: 80, wavelength: 6100, phase: 0.0 },
];

// The gas's own motion at Gas drift 1: its churn clock in radians per second, and how far the whole
// cloud streams across the flight in world units per second (x, y). The flow stays well under the
// flight's own pace (index.ts's BASE_SPEED) so at the default the reference's fly-through still leads.
const CHURN_RATE = 0.05;
const FLOW: readonly [number, number] = [0.04, 0.015];

const TAU = Math.PI * 2;

export interface Flight {
  /** Distance flown along z, in world units. */
  travel: number;
  /** Seconds of colour wander, advanced by wall time scaled by Colour drift. */
  hueClock: number;
  /** A slow clock for the gas's own churn, in radians, kept in [0, 2π). */
  churn: number;
  /** How far the whole cloud has streamed across the flight, x and y, kept in [0, PERIOD). */
  flowX: number;
  flowY: number;
}

export function createFlight(): Flight {
  return { travel: 0, hueClock: 0, churn: 0, flowX: 0, flowY: 0 };
}

/** Moves the camera on by one frame: `speed` world units per second along
 *  the path, the colour clock by `hueRate` seconds per second, and the gas's
 *  churn and flow by `gasDrift` times their rates at Gas drift 1. */
export function advanceFlight(f: Flight, dtSec: number, speed: number, hueRate: number, gasDrift: number): void {
  f.travel += dtSec * speed;
  f.hueClock += dtSec * hueRate;
  f.churn = (f.churn + dtSec * CHURN_RATE * gasDrift) % TAU;
  f.flowX = wrap(f.flowX + dtSec * FLOW[0] * gasDrift, PERIOD);
  f.flowY = wrap(f.flowY + dtSec * FLOW[1] * gasDrift, PERIOD);
}

function wrap(x: number, period: number): number {
  const w = x - Math.floor(x / period) * period;
  // Bound for a Float32Array: a value that rounds up to the period in fp32 is the same point as 0.
  return Math.fround(w) >= period ? 0 : w;
}

function sinePhase(s: PathSine, z: number): number {
  return wrap((TAU * z) / s.wavelength + s.phase, TAU);
}

function sum(sines: readonly PathSine[], z: number): number {
  let v = 0;
  for (const s of sines) v += s.amp * Math.sin(sinePhase(s, z));
  return v;
}

/** The path's centre at distance `z`, x and y. */
function pathAt(z: number): [number, number] {
  return [sum(PATH_X, z), sum(PATH_Y, z)];
}

/** The colour wander this frame, in degrees. */
export function hueWander(f: Flight): number {
  return sum(HUE_WANDER, f.hueClock);
}

/**
 * The camera this frame, packed as vec4s for glsl.ts's `uCam`:
 * [0] position reduced into one repeat (PERIOD, PERIOD, PERIOD_Z); [1] right, [2] up,
 * [3] forward (unit vectors). `out` must hold 16 floats.
 */
export function cameraUniforms(f: Flight, turn: number, out = new Float32Array(16)): Float32Array {
  const [x, y] = pathAt(f.travel);
  const [ax, ay] = pathAt(f.travel + LOOK_AHEAD);
  let fx = ax - x;
  let fy = ay - y;
  let fz = LOOK_AHEAD;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // Right = worldUp × forward, then up = forward × right; the roll turns both about forward.
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  rz /= rl;
  let ux = fy * rz - fz * ry;
  let uy = fz * rx - fx * rz;
  let uz = fx * ry - fy * rx;
  const roll = turn * sum(ROLL, f.travel);
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const r2 = [c * rx + s * ux, c * ry + s * uy, c * rz + s * uz];
  [ux, uy, uz] = [c * ux - s * rx, c * uy - s * ry, c * uz - s * rz];
  [rx, ry, rz] = r2;
  out.set([wrap(x, PERIOD), wrap(y, PERIOD), wrap(f.travel, PERIOD_Z), 0], 0);
  out.set([rx, ry, rz, 0], 4);
  out.set([ux, uy, uz, 0], 8);
  out.set([fx, fy, fz, 0], 12);
  return out;
}

/**
 * Each path sine's phase at the camera, for glsl.ts's `uPath`: [0] the two
 * x sines then the two y sines, [1] the two radius sines. The shader adds
 * each sine's own 2π·dz/wavelength for a sample `dz` ahead, so it can trace
 * the path near the camera without ever seeing the distance flown.
 */
export function pathUniforms(f: Flight, out = new Float32Array(8)): Float32Array {
  const z = f.travel;
  out.set([sinePhase(PATH_X[0], z), sinePhase(PATH_X[1], z), sinePhase(PATH_Y[0], z), sinePhase(PATH_Y[1], z)], 0);
  out.set([sinePhase(PATH_R[0], z), sinePhase(PATH_R[1], z), 0, 0], 4);
  return out;
}
