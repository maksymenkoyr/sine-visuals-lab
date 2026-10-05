// Chaikin Curves' clock: everything about *where the picture is in time*,
// kept free of GL so tests/chaikin.test.ts can drive it with plain numbers.
// index.ts resolves settings and drives into LaunchInput each frame and
// uploads what this returns; seeds.ts lays the seeds out from it.
//
// The lattice's radial coordinate is U = asinh(r / CORE_R) (r in
// half-heights): ln r plus a constant far from the centre, so cells there
// grow in proportion to r, but linear in r inside CORE_R, so near the centre
// cells stop shrinking and a shift of U carries them outward at a steady
// speed rather than freezing them. That is what the reference does: its
// cells near the core are bigger than a pure ln r lattice would make them,
// and they leave the core faster than a pure zoom would carry them
// (docs/scenes/chaikin.md's Measurements).
//
// - **Zoom `z`.** How far the lattice has flown outward, in U. Every seed's
//   screen U is its lattice U plus `z`. It grows without bound; `splitZoom`
//   cuts it into a whole number of lattice rows (wrapped to the hash period)
//   and a fraction, in float64, so the GPU never sees the raw value.
// - **Front.** A seed is alive only once it is past the front; inside it
//   there is one central cell. The reference opens on that one cell, then
//   births fill in from a ring about twice the central cell's radius while
//   the ring closes on the centre — in ln r, `front = FRONT_START −
//   FRONT_RATE·τ`, floored at FRONT_FLOOR, by which point every seed is
//   alive; `frontU` is the same front in U, what the shader compares seeds
//   against. `τ` is the launch clock: it starts at 0 when the scene mounts.
// - **Relaunch.** A drop eases the front back out toward FRONT_START over
//   RELAUNCH_SEC, swallowing the cells it passes into the central cell, and
//   resets `τ` to match where it stopped, so the intro replays from there.
//   The zoom rides `τ` (zoomIntro), so a full relaunch also stalls the zoom
//   and ramps it back up, as in the reference's opening.
//
// Kicks stamp a band of extra "child" seeds (seeds.ts's childAlive); this
// file keeps the last KICK_SLOTS of them as a ring buffer of where the zoom
// was when each landed, how old it is and how strong.
//
// Where each number comes from is in docs/scenes/chaikin.md's Measurements.

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Births start on a ring at r = 1.9 (twice the reference's first central
 *  cell radius of 0.95 half-heights), ln r. */
export const FRONT_START = Math.log(1.9);
/** How fast the front closes on the centre, in ln r per second (the
 *  reference's central cell shrinks at this rate for its first 24 s). */
export const FRONT_RATE = 0.175;
/** Where the lattice's U stops following ln r and turns linear in r. */
export const CORE_R = 0.2;
/** The front stops closing here (ln r): inside it the lattice has less than
 *  half a row left, so every seed is alive. */
export const FRONT_FLOOR = Math.log(0.01);
/** The zoom is still for the first ZOOM_RAMP_START seconds of `τ`, then
 *  ramps to full speed by ZOOM_RAMP_END. */
export const ZOOM_RAMP_START = 5;
export const ZOOM_RAMP_END = 20;
/** Cruise zoom at Speed 1 with a middling drive reading, U per second. */
export const K_CRUISE = 0.24;
/** k = K_CRUISE · speed · (SPEED_FLOOR + SPEED_GAIN · drive): the floor keeps
 *  the cells drifting in a quiet passage. */
export const SPEED_FLOOR = 0.35;
export const SPEED_GAIN = 0.9;
export const RELAUNCH_SEC = 0.6;
export const KICK_SLOTS = 8;
/** Shortest gap between two kick stamps — a bass roll mustn't fill every
 *  slot in one beat. */
export const KICK_MIN_GAP_SEC = 0.15;
/** A kick's children are gone this long after it lands. */
export const KICK_LIFE_SEC = 1.2;
/** Lattice rows wrap at this period for the hash (a power of two — seeds.ts
 *  masks the row index with ROW_PERIOD − 1). */
export const ROW_PERIOD = 65536;

export interface LaunchState {
  /** Zoom, in lattice U. float64; see splitZoom. */
  z: number;
  /** Launch clock, seconds since the (virtual) start of the intro. */
  tau: number;
  /** Relaunch ease: from/to front (ln r) and elapsed time; `relT < 0` = none. */
  relFrom: number;
  relTo: number;
  relT: number;
  kickZ: Float64Array;
  kickAge: Float32Array;
  kickAmp: Float32Array;
  kickNext: number;
  lastKickSec: number;
}

export function createLaunchState(): LaunchState {
  return {
    z: 0,
    tau: 0,
    relFrom: 0,
    relTo: 0,
    relT: -1,
    kickZ: new Float64Array(KICK_SLOTS),
    kickAge: new Float32Array(KICK_SLOTS).fill(KICK_LIFE_SEC),
    kickAmp: new Float32Array(KICK_SLOTS),
    kickNext: 0,
    lastKickSec: -1e9,
  };
}

/** The lattice coordinate of radius r. */
export function latticeU(r: number): number {
  return Math.asinh(r / CORE_R);
}

/** The front (ln r) at launch time `tau`, floored. */
export function frontAt(tau: number): number {
  return Math.max(FRONT_START - FRONT_RATE * tau, FRONT_FLOOR);
}

/** 0 → 1 as the launch clock passes the zoom ramp. */
export function zoomIntro(tau: number): number {
  return smoothstep(ZOOM_RAMP_START, ZOOM_RAMP_END, tau);
}

export interface LaunchInput {
  timeSec: number;
  dtSec: number;
  /** Speed setting (0 freezes the zoom). */
  speed: number;
  /** Speed's drive reading. */
  speedDrive: number;
  /** A drop fired this frame: how far back toward FRONT_START the front
   *  goes, 0..1; 0 or null = none. */
  relaunch: number | null;
  /** A kick fired this frame: how strong its band of children is, 0..1;
   *  0 or null = none. */
  kick: number | null;
}

export interface LaunchOutput {
  /** The front, ln r. */
  front: number;
  /** The front in lattice U — what the shader compares seeds against. */
  frontU: number;
  /** This frame's zoom rate, U per second. */
  k: number;
}

/** Advances the clock by one frame, mutating `s`. */
export function stepLaunch(s: LaunchState, inp: LaunchInput): LaunchOutput {
  const dt = Math.max(0, inp.dtSec);
  let front: number;
  if (s.relT >= 0) {
    s.relT += dt;
    const w = smoothstep(0, RELAUNCH_SEC, s.relT);
    front = s.relFrom + (s.relTo - s.relFrom) * w;
    if (s.relT >= RELAUNCH_SEC) s.relT = -1;
    s.tau = (FRONT_START - front) / FRONT_RATE;
  } else {
    s.tau += dt;
    front = frontAt(s.tau);
  }

  if (inp.relaunch && inp.relaunch > 0 && s.relT < 0) {
    s.relFrom = front;
    s.relTo = front + (FRONT_START - front) * Math.min(1, inp.relaunch);
    s.relT = 0;
  }

  const k = K_CRUISE * Math.max(0, inp.speed) * (SPEED_FLOOR + SPEED_GAIN * Math.max(0, inp.speedDrive)) * zoomIntro(s.tau);
  s.z += k * dt;

  for (let i = 0; i < KICK_SLOTS; i++) {
    // Compared before the store: the Float32Array rounds KICK_LIFE_SEC down.
    const age = s.kickAge[i] + dt;
    if (age >= KICK_LIFE_SEC) s.kickAmp[i] = 0;
    s.kickAge[i] = Math.min(KICK_LIFE_SEC, age);
  }
  if (inp.kick && inp.kick > 0 && inp.timeSec - s.lastKickSec >= KICK_MIN_GAP_SEC) {
    const i = s.kickNext;
    s.kickZ[i] = s.z;
    s.kickAge[i] = 0;
    s.kickAmp[i] = Math.min(1, inp.kick);
    s.kickNext = (i + 1) % KICK_SLOTS;
    s.lastKickSec = inp.timeSec;
  }

  return { front, frontU: latticeU(Math.exp(front)), k };
}

/** The zoom cut into lattice rows for the GPU: `row` is the whole number of
 *  rows wrapped to ROW_PERIOD (exact in fp32), `frac` the remainder in
 *  [0, 1). Computed in float64 so a session of any length keeps sub-pixel
 *  motion. */
export function splitZoom(z: number, delta: number): { row: number; frac: number } {
  const rows = z / delta;
  const whole = Math.floor(rows);
  let frac = rows - whole;
  if (Math.fround(frac) >= 1) frac = 0;
  const row = whole - Math.floor(whole / ROW_PERIOD) * ROW_PERIOD;
  return { row, frac };
}

/** Each kick slot's zoom distance since it landed (small, so fp32-safe). */
export function kickDeltaZ(s: LaunchState, out: Float32Array): Float32Array {
  for (let i = 0; i < KICK_SLOTS; i++) out[i] = s.kickAmp[i] > 0 ? s.z - s.kickZ[i] : 0;
  return out;
}
