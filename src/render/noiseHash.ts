// A value-noise hash that renders the same on every GPU, however long the
// page has been open — the one place that knowledge lives; scenes that hash
// a lattice import it rather than restating a `fract(sin(...))` of their own.
//
// The classic hash — fract() of a large product of the cell coordinate —
// loses its low bits as the coordinate grows, and every drifting scene grows
// it: an accumulated phase (uFlowPhase, or a scene's own) is added to the
// noise coordinate, so the hash's input climbs with session length. On
// desktop GPUs that only degrades into cell-aligned blocks after hours, but
// mobile GPU compilers reorder and fuse the arithmetic, so the hash of a
// corner shared by two neighbouring cells stops agreeing between them well
// before that — the field breaks along cell boundaries into straight,
// screen-aligned seams for an unwarped octave and curved ones for warped
// octaves, and any fwidth()-based anti-aliasing lights every seam up as a
// dashed line. Caustics was the first scene to show it (commit "Fix
// Caustics seams and dashed lines on mobile"), Ink the second.
//
// The fix is in two halves that only work together, and every scene that
// uses one must use the other:
//
// - NOISE_HASH_GLSL hashes the *integer* cell index with 32-bit integer
//   ops, masked to a power-of-two period (NOISE_MASK), so the result is
//   exact on every GPU and the field is periodic in NOISE_PERIOD cells.
// - wrapFlow reduces every offset the shader adds to a noise coordinate
//   modulo NOISE_PERIOD on the JS side, in float64, so the GPU never sees
//   the raw, ever-growing phase. Because the field is periodic in exactly
//   that period, the wrap is invisible by construction. An offset applied
//   *inside* an fbm octave loop (after the octave's own scale/rotation) has
//   to be wrapped per octave, in that octave's lattice frame — see
//   noiseFlows in scenes/ink.ts for the shape of that.
//
// The phase itself never wraps; only what reaches the GPU does.

/** Period, in noise cells, of every field hashed with NOISE_HASH_GLSL. Must
 *  be a power of two — hashCell masks the cell index with NOISE_MASK. Sized
 *  so the largest value a shader ever adds to a noise coordinate stays far
 *  below where fp32 loses sub-pixel resolution, while a repeat stays out of
 *  reach: the coarsest octave of any scene here has cells a good fraction of
 *  the screen tall, so the pattern only recurs after the drift has carried
 *  it many screens past its start, and octaves drift at different multiples
 *  of the same phase, so they don't even line up again together. */
export const NOISE_PERIOD = 256;
export const NOISE_MASK = NOISE_PERIOD - 1;
if (!Number.isInteger(Math.log2(NOISE_PERIOD))) {
  throw new Error("noiseHash: NOISE_PERIOD must be a power of two");
}

/** x reduced into [0, NOISE_PERIOD), in float64 — the JS side is the one
 *  place the raw phase can be reduced without precision loss. The result is
 *  bound for a Float32Array upload, so a value that would round up to the
 *  period in fp32 is returned as 0 — the same lattice point. */
export function wrapFlow(x: number): number {
  const w = x - Math.floor(x / NOISE_PERIOD) * NOISE_PERIOD;
  return Math.fround(w) >= NOISE_PERIOD ? 0 : w;
}

/** GLSL for the lattice hash — paste at the top of a fragment body. It
 *  starts with `precision highp int;` because the fragment stage's default
 *  int precision is mediump, which may be 16 bits on mobile, and the hash
 *  needs real 32-bit ops.
 *
 *  `cell` is an integer-valued lattice coordinate (floor of the noise
 *  coordinate), `mask` the lattice's period minus one (a power of two, so
 *  the bitwise AND is the wrap; two's complement makes it wrap negatives
 *  too — NOISE_MASK for a field on the shared period, or a scene's own
 *  power-of-two mask for a finer lattice), and `seed` picks an independent
 *  stream. hashCell returns a float uniform in [0, 1) with the top bits of
 *  the hash, so it is exactly representable; hash2Cell two of them. */
export const NOISE_HASH_GLSL = `
precision highp int;

uint uhash(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

uint cellBits(vec2 cell, int mask, uint seed) {
  ivec2 c = ivec2(cell) & ivec2(mask);
  return uhash(uint(c.x) ^ (uint(c.y) << 16u) ^ (seed * 0x9e3779b9u));
}

// 24 significant bits -> exactly representable, uniform in [0, 1).
float hashCell(vec2 cell, int mask, uint seed) {
  return float(cellBits(cell, mask, seed) >> 8u) * (1.0 / 16777216.0);
}

vec2 hash2Cell(vec2 cell, int mask, uint seed) {
  uint h = cellBits(cell, mask, seed);
  return vec2(float(h >> 8u), float(uhash(h) >> 8u)) * (1.0 / 16777216.0);
}
`;

/** GLSL for a one-shot float hash — paste at the top of a fragment body when
 *  a scene needs `hash21`/`hash22`/`hash31`/`hash33` (a corner-of-a-lattice
 *  hash, not a drifting one) rather than NOISE_HASH_GLSL's cell hash. Use
 *  this one for an ordinary value-noise lattice with no accumulated phase in
 *  its coordinate (no `uFlowPhase`-style drift); reach for NOISE_HASH_GLSL
 *  and wrapFlow instead the moment a scene adds a growing phase to the noise
 *  coordinate — see this file's header for why.
 *
 *  Where NOISE_HASH_GLSL hashes an already-integer cell index, this one
 *  hashes the *bit pattern* of the float input directly (`floatBitsToUint`),
 *  so it takes a plain lattice coordinate with no separate floor/mask step.
 *  Per-component cost matters here more than for `cellBits` above: a scene
 *  calls this from inside an 8-corner trilinear lookup (vnoise's hash31) or
 *  a per-pixel sim step, so it runs several times per particle per frame —
 *  powder.ts's particle sim is where a first cut of this (a full lowbias32
 *  pass *per component* before combining) was measured costing whole frames
 *  on a software-rasterised (SwiftShader) run. `fhBits` below spends only
 *  the first two of `fhMix`'s five steps decorrelating each component before
 *  they're combined, then the combined value gets the full five-step mix —
 *  cheap per component, still collision-free across a swept-integer stress
 *  test at negative and positive coordinates alike (see this file's test).
 *  It mixes with the same lowbias32 constants as `uhash` above, but through
 *  its own helper (`fhMix`, not `uhash`) so a scene that pastes both this
 *  and NOISE_HASH_GLSL never gets a duplicate-symbol error. `floor()` can
 *  produce -0.0, which hashes differently from +0.0 under `floatBitsToUint`
 *  even though the two compare equal, so every input is canonicalised
 *  (`fhZero`) first. */
export const FLOAT_HASH_GLSL = `
precision highp int;

// lowbias32 (public domain / Unlicense) — same mix as NOISE_HASH_GLSL's
// uhash, renamed so the two can coexist in one shader.
uint fhMix(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

// -0.0 and +0.0 compare equal but hash differently through floatBitsToUint;
// floor() can hand back -0.0, so every hash input is canonicalised here.
float fhZero(float x) { return x == 0.0 ? 0.0 : x; }

// Cheap per-component decorrelation (fhMix's first two steps only) before
// combining — see the header on why a full mix per component isn't worth it.
uint fhBits(float x) {
  uint h = floatBitsToUint(fhZero(x));
  h ^= h >> 16u;
  h *= 0x7feb352du;
  return h;
}

// 24 significant bits -> exactly representable, uniform in [0, 1).
float fhUnit(uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }

float hash21(vec2 p) {
  return fhUnit(fhMix(fhBits(p.x) ^ (fhBits(p.y) * 0x9e3779b9u)));
}

vec2 hash22(vec2 p) {
  uint h = fhMix(fhBits(p.x) ^ (fhBits(p.y) * 0x9e3779b9u));
  return vec2(fhUnit(h), fhUnit(fhMix(h)));
}

float hash31(vec3 p) {
  uint h = fhBits(p.x) ^ (fhBits(p.y) * 0x9e3779b9u) ^ (fhBits(p.z) * 0x85ebca6bu);
  return fhUnit(fhMix(h));
}

vec3 hash33(vec3 p) {
  uint h0 = fhMix(fhBits(p.x) ^ (fhBits(p.y) * 0x9e3779b9u) ^ (fhBits(p.z) * 0x85ebca6bu));
  uint h1 = fhMix(h0);
  uint h2 = fhMix(h1);
  return vec3(fhUnit(h0), fhUnit(h1), fhUnit(h2));
}
`;
