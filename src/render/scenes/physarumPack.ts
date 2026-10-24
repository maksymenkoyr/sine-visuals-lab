// What Physarum and Physarum 2 share: the 16-bit packing of a unit value into
// two bytes, and the shortest gap between two seed-epoch steps. Pure, no GL, so
// neither body pulls the other's code in to reach them.

/** Shortest gap between two epoch steps, so one beat can't advance the seed
 *  epoch twice — see the file header. */
export const SEED_RISE_REFRACTORY_SEC = 0.1;

/** 16-bit fixed point over [0, range) — the one-sided generalisation of
 *  chladni's/powder's packAxis pair (their range is symmetric about zero;
 *  this scene's position and heading both start at zero) so both share one
 *  round trip. The GLSL in PHYSARUM_GLSL mirrors this exactly; exported here
 *  so the round trip is checkable without a GL context. */
export function packUnit(v: number, range: number): [number, number] {
  const clamped = Math.max(0, Math.min(range, Number.isFinite(v) ? v : 0));
  const u = Math.round((clamped / range) * 65535);
  return [u >> 8, u & 255];
}
