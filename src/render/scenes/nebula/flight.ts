/**
 * Nebula's camera, on the JS side: how far it has flown and how far it has
 * turned, and from that, where each gas plane sits this frame.
 *
 * The gas is LAYERS flat planes spaced evenly in depth. As the camera flies,
 * every plane drifts from the far end to the near end; when one passes the
 * camera it is reborn at the far end with a new random patch of gas (a new
 * seed), so the flight never repeats and never runs out. The flight distance
 * grows for the whole session, so it stays here in float64: the shader only
 * gets each plane's depth in [0, 1) and a seed reduced into the noise
 * period (src/render/noiseHash.ts's header says why nothing growing may
 * reach a noise coordinate).
 *
 * Planes are handed over far to near, because glsl.ts composites them back
 * to front.
 */

import { NOISE_PERIOD } from "../../noiseHash.ts";

/** How many gas planes the camera flies through. glsl.ts's loop bound reads it. */
export const LAYERS = 7;

export interface Flight {
  /** Distance flown, in planes: one unit is one plane passing the camera. */
  travel: number;
  /** The whole view's turn, in radians. */
  turn: number;
  /** A slow clock for the gas's own churn, in radians, kept in [0, 2π). */
  churn: number;
}

export function createFlight(): Flight {
  return { travel: 0, turn: 0, churn: 0 };
}

const TAU = Math.PI * 2;

/** Moves the camera on by one frame: `rate` planes per second forward,
 *  `turnRate` radians per second around the view axis, `churnRate` radians
 *  per second on the churn clock. */
export function advanceFlight(f: Flight, dtSec: number, rate: number, turnRate: number, churnRate: number): void {
  f.travel += dtSec * rate;
  f.turn = (f.turn + dtSec * turnRate) % TAU;
  f.churn = (f.churn + dtSec * churnRate) % TAU;
}

// A plane's seed only has to look random and differ from one rebirth to the
// next; Math.imul keeps the mix in exact 32-bit integers for any cycle count.
function seedBits(cycle: number, layer: number): number {
  let h = (Math.imul(cycle | 0, 0x9e3779b1) ^ Math.imul(layer + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Every plane's state this frame, packed far to near as vec4s for glsl.ts's
 * `uLayer` array: (depth in [0, 1), 0 far and 1 at the camera; seed x and
 * seed y, an offset into the noise field in [0, NOISE_PERIOD); and a turn of
 * its own in [0, 2π), so neighbouring planes don't share one grain).
 */
export function layerUniforms(f: Flight, out = new Float32Array(LAYERS * 4)): Float32Array {
  const planes: { z: number; cycle: number; layer: number }[] = [];
  for (let i = 0; i < LAYERS; i++) {
    const u = (i + f.travel) / LAYERS;
    const cycle = Math.floor(u);
    planes.push({ z: u - cycle, cycle, layer: i });
  }
  planes.sort((a, b) => a.z - b.z);
  planes.forEach((p, k) => {
    const h = seedBits(p.cycle, p.layer);
    const h2 = seedBits(h, p.layer + LAYERS);
    out[k * 4] = p.z;
    out[k * 4 + 1] = ((h & 0xffff) / 0x10000) * NOISE_PERIOD;
    out[k * 4 + 2] = ((h >>> 16) / 0x10000) * NOISE_PERIOD;
    out[k * 4 + 3] = (h2 / 0x100000000) * TAU;
  });
  return out;
}
