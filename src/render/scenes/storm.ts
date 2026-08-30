import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// A storm cloud as a real volume — a density field the fragment shader
// marches through — lit from the inside by lightning on every beat: the
// intra-cloud kind, where you rarely see the bolt itself, only the cloud
// flashing around it, with a hard attack, a couple of return-stroke flickers,
// then an afterglow that fades.
//
// How it's built:
//
//  - The whole scene is one fullscreen pass. For each fragment, a ray is
//    built in the camera's own space and pushed back into *cloud space*
//    (unrotate() undoes CAMERA_GLSL's swirl/tilt and the bass swell), so the
//    density field, the strikes and the march all live in the one space the
//    strike pool stores its segments in. CAMERA_GLSL therefore holds both
//    directions of the same transform and nothing else projects.
//  - The density is the classic two-part cloud: a silhouette (shapeAt — a
//    smooth union of the lobes, each with its underside falling off faster
//    than its top, so the mass reads as cumulus on a flat base rather than a
//    heap of balls) eroded by fbm read from a tileable 3D RG8 noise texture
//    (buildNoiseVolume). R is value-noise fbm, G is inverted Worley;
//    Schneider's perlin-worley remap of one against the other is what turns
//    filaments into rounded billows. The noise volume tiles, so REPEAT wrap
//    makes the texture coordinate a plain scale of the cloud-space position.
//  - The silhouette is *baked* into its own 3D texture at init rather than
//    evaluated per step: it is entirely static in cloud space (the lobes
//    never move, and the bass swell scales the space, not the field), and
//    running the lobe loop per step — three times over, counting the shadow
//    taps — cost more than everything else in the march put together.
//  - shapeAt fades into the bounding ellipsoid the march is clipped to
//    (BOUND_*), so the silhouette is never cut flat by the march bound. The
//    bound is per-axis: wide enough in x/z to hold the outermost lobe's
//    reach, tall enough in y for the tallest, and always inside CAM_DIST even
//    at full swell so the camera never starts the march inside it.
//  - Lightning is a JS-side pool of strikes (createStrikePool), each a short
//    line segment buried in the cloud that acts as a light source. Per-slot
//    strength follows strikeEnvelope — the flicker/afterglow shaping happens
//    on the CPU — and the shader only does the spatial part per march step:
//    distance to each live segment gives a broad in-scattered glow (Flash
//    reach) plus a tight emissive core, the bolt itself, which mostly stays
//    buried but streaks through where the gas above it is thin.
//  - Everything accumulates front-to-back with `T` as remaining transmittance
//    (early-out at T < 0.02) over a background of sky gradient plus a faint
//    per-strike haze — weak now, since the volume itself carries the flash.
//    The composite is tonemapped (1 - exp(-c)) instead of clipped, so a big
//    flash saturates gracefully rather than holding flat white the way the
//    additive point pass below does (it has no tonemap behind it, which is
//    why its own gains are kept modest).
//  - Cost is bounded by uMaxSteps (MAX_STEPS is the compile-time cap) and by
//    two cheap gates: a step whose silhouette is ~0 costs one fetch and then
//    strides on at double length, and lighting is skipped where the density
//    is negligible. Octave count and the number of shadow taps come off
//    uDetail, so the low preset marches a genuinely cheaper cloud.
//  - Beat trigger: a low-band onset or a broadband beat fires one strike; the
//    pool's refractory window folds the two into a single strike when they
//    land on adjacent frames (they usually do). A drop fires a burst of
//    STRIKE_DROP_BURST strikes that bypass the refractory.
//  - Beats are detected as *rises* in anim.beatPulse / lowPulse / dropPulse
//    rather than from the one-shot flags (frame.beat, anim.lowOnset,
//    anim.dropOnset), and the pool is aged by this scene's own render
//    interval rather than anim.dtSec. Both for the same reason: app.ts/tv.ts
//    advance the anim clock on every rAF tick but rate-cap scene.render()
//    (framePace.ts), so on a 120Hz display a one-shot that lands on a
//    skipped tick never reaches render(), and anim.dtSec is the tick
//    interval, not the time since this scene last drew. A pulse that has
//    risen since the last draw can't be missed, whichever tick it rose on.
//
// Modes (the `mode` setting, options MODES): the volume above is only one of
// them. Gas is the march alone; Particles skips it (uMode reaches VOLUME_FRAG,
// which then returns just the background — sky, per-strike haze, drop flash —
// so the pass stays a handful of instructions) and draws a point cloud
// instead; Both draws the volume and then the points additively over it, at
// half the draw count so the gas underneath stays readable.
//
// The point cloud is a static VBO sampled at init from the same lobes the
// silhouette was baked from (buildCloud, seeded with CLOUD_SEED so the two
// agree), with a per-particle seed and a strike slot (`aSlot` = i %
// MAX_STRIKES). Any prefix of the buffer is a representative subsample — that
// is what lets Cloud density simply shrink the draw count. The budget comes
// from ctx.quality.maxParticles through particleCountForQuality and is baked
// at init (switching preset mid-run only lands on the next scene switch, the
// same caveat meshGrid.ts's grid size has); uCountBoost inflates sparse
// clouds so a gallery tile still reads as a cloud rather than dust.
//
// What a particle does is the `particleStyle` setting (options
// PARTICLE_STYLES), branched on in POINT_VERT:
//
//  - Cloud: the particles *are* the cloud — static lobe-sampled positions
//    with a slow sinusoidal churn, an ambient skylit base colour, the same
//    per-strike broad-body-plus-hot-core lighting the march does, and treble
//    sparks.
//  - Swarm: not a cloud but a flow. Each particle orbits the cloud volume
//    (radius, height and phase from its seed, turning at a rate off Swirl
//    speed and the tempo) with an analytic curl-ish wander on top, and every
//    live strike *pulls* it: an inverse-square-ish attraction toward the
//    closest point on the bolt, strong enough that a full-strength strike
//    drags the nearby swarm most of the way onto it over the flash. The pull
//    also brightens and whitens the particle, so the swarm streaks into the
//    lightning.
//  - Sparks: embers thrown off the bolts. Each particle belongs to one strike
//    slot and lives only while that slot's strike is young — createStrikePool
//    stamps `birth` per slot and render() uploads uStrikeBirth/uStrikeAmp, so
//    the shader ballistically integrates the ember from a random point on
//    that segment (launch direction and speed off the seed, drag, gravity)
//    and puts it off-screen outside its lifetime. Dead particles cost nothing
//    beyond a vertex, so this style draws its whole buffer up to
//    SPARK_MAX_DRAW rather than a density prefix.
const ID = "storm";

const MAX_STRIKES = 8;
const LOBE_COUNT = 9;
// The particle budget, and the ceiling on how many embers one strike throws
// (every particle in a slot is born at once, so the sparks draw is capped
// well below MAX_PARTICLES to keep the burst affordable).
const MAX_PARTICLES = 120_000;
const MIN_PARTICLES = 4_000;
const SPARK_MAX_DRAW = 40_000;
// Samples that fall outside the bounding ellipsoid are redrawn this many
// times before being pulled back to the surface — pulling on the first miss
// piled every gaussian tail onto the ellipsoid and drew a hard, dense rim.
const SAMPLE_RETRIES = 8;
/** The `mode` setting's options, in value order. */
const MODES: readonly string[] = ["Gas", "Particles", "Both"];
const MODE_GAS = 0;
const MODE_PARTICLES = 1;
/** The `particleStyle` setting's options, in value order — see POINT_VERT. */
const PARTICLE_STYLES: readonly string[] = ["Cloud", "Swarm", "Sparks"];
const STYLE_SPARKS = 2;
// Bounding ellipsoid half-extents of the cloud, in cloud-space units — where
// the lobe centres are allowed to sit and where the strikes are kept. The
// camera (CAMERA_GLSL) is placed so this fills a comfortable share of the
// frame with room for the bass swell.
const CLOUD_EXTENT_X = 1.6;
const CLOUD_EXTENT_Y = 0.8;
const CLOUD_EXTENT_Z = 1.2;
// The march bound: the lobes' density reaches past CLOUD_EXTENT_*, so the
// clipped volume has to be larger or the silhouette would be sliced flat.
// Per-axis rather than one margin: y needs the most headroom (the extent is
// smallest there but a lobe's reach is the same in every direction), while
// x/z stay comfortably inside CAM_DIST even at full swell, so the camera is
// never inside the bound.
const BOUND_X = CLOUD_EXTENT_X * 1.35;
const BOUND_Y = CLOUD_EXTENT_Y * 1.7;
const BOUND_Z = CLOUD_EXTENT_Z * 1.45;
const STRIKE_REFRACTORY_SEC = 0.06;
const STRIKE_DROP_BURST = 3;
const STRIKE_LEN_MIN = 0.3;
const STRIKE_LEN_MAX = 0.6;
const CAM_DIST = 3.2;
const CAM_FOV_DEG = 50;
// Compile-time cap on the march; the live count is uMaxSteps (quality.ts).
const MAX_STEPS = 72;
// Cloud-space frequency of the noise volume's base octave: the texture tiles
// over one unit of texture coordinate, so this is "one repeat every 1/f
// cloud units" — kept long enough that the repeat isn't legible across a
// cloud only a few units wide.
const BASE_FREQ = 0.55;
// Edge of the noise volume, in texels. 64^3 RG8 is 512 KB — small enough to
// build on the CPU at init and upload once.
const NOISE_SIZE = 64;
// Edge of the baked shape volume (see shapeAt): the field is smooth over
// roughly a lobe radius, so this only has to be fine enough that trilinear
// filtering doesn't facet it.
const SHAPE_SIZE = 64;
// How far past its radius a lobe's density reaches, and how wide the smooth
// union between two lobes is — both in the same cloud-space units as Lobe.r.
const SHAPE_REACH = 1.9;
const SHAPE_BLEND = 0.35;
// Lattices the two channels are built from. Each count wraps over the whole
// volume (see buildNoiseVolume), which is what makes the texture tileable.
const NOISE_VALUE_CELLS = [4, 8, 16];
const NOISE_VALUE_AMPS = [0.5, 0.3, 0.2];
const NOISE_WORLEY_CELLS = [4, 8];
const NOISE_WORLEY_AMPS = [0.65, 0.35];
// Fixes the lobe layout across mounts, so switching in and out of the
// gallery doesn't reshuffle the cloud.
const CLOUD_SEED = 1;

// Every table below reproduces its plain `default` when all dials sit at
// NEUTRAL (musicProfile.ts) — nothing is hand-biased. `pulse` is kept small
// throughout: it floors near 0.9 on any locked-tempo track (see the Focus
// snap comment in caustics.ts), so a large pulse weight is really a constant
// offset in disguise.
const SETTINGS: SceneSetting[] = [
  // "Look" leads so the two pickers sit at the top of the device menu: they
  // decide what the rest of the settings are even acting on.
  {
    key: "mode",
    label: "Mode",
    description: "Gas is the raymarched cloud; Particles is a point cloud instead; Both draws the points over the gas.",
    group: "Look",
    type: "enum",
    options: MODES,
    min: 0,
    max: MODES.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "particleStyle",
    label: "Particle style",
    description: "Cloud is the gas made of points; Swarm flows and is dragged into each bolt; Sparks are embers thrown off the strikes.",
    group: "Look",
    type: "enum",
    options: PARTICLE_STYLES,
    min: 0,
    max: PARTICLE_STYLES.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "strike",
    label: "Strike intensity",
    description: "How hard each beat's lightning lights the cloud",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.75,
    auto: { attack: 0.3, pulse: 0.15 },
  },
  {
    key: "reach",
    label: "Flash reach",
    description: "How far into the cloud a strike's light carries",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.65,
    auto: { density: -0.2, dynamics: 0.2 },
  },
  {
    key: "flicker",
    label: "Flicker",
    description: "Return strokes: how many times a strike re-flashes before it fades",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { attack: 0.25 },
  },
  {
    key: "afterglow",
    label: "Afterglow",
    description: "How long a strike keeps glowing after the flash",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: -0.3, pulse: 0.15 },
  },
  {
    key: "density",
    label: "Cloud density",
    description: "How thick the gas is — and, in the particle modes, how many particles are drawn",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { density: 0.3 },
  },
  {
    key: "swirl",
    label: "Swirl speed",
    description: "How fast the cloud turns",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.35, pulse: 0.15 },
  },
  {
    key: "swell",
    label: "Bass swell",
    description: "How much the low band puffs the cloud up",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: -0.35 },
  },
  {
    key: "ambient",
    label: "Ambient glow",
    description: "Resting brightness of the cloud between strikes",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    auto: { loudness: 0.3, brightness: 0.2 },
  },
  {
    // Keyed `grain`, not `detail`: settingUniformName would make that
    // `uDetail`, which COMMON_UNIFORMS_GLSL already owns as the quality proxy
    // — two declarations of the same name is a shader compile error.
    key: "grain",
    label: "Detail",
    description: "How hard the noise erodes the cloud into separate billows, and how big each particle sprite is",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    advanced: true,
  },
  {
    key: "spark",
    label: "Treble wisps",
    description: "Fine detail the high band frays into the cloud's edges",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { brightness: 0.35 },
  },
  {
    key: "dropStorm",
    label: "Drop reactivity",
    description: "Size of the lightning burst on a detected drop",
    group: "Dynamics",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { dynamics: 0.45 },
  },
];

const settingByKey = new Map(SETTINGS.map((s) => [s.key, s]));
function settingFor(key: string): SceneSetting {
  const spec = settingByKey.get(key);
  if (!spec) throw new Error(`storm: unknown setting "${key}"`);
  return spec;
}

// ---------------------------------------------------------------------------
// Pure helpers — no GL at import time, exported for tests/storm.test.ts.

/** mulberry32: a small deterministic PRNG so the cloud (and tests) are
 *  reproducible for a given seed. Returns values in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deterministic [0,1) hash of a (seed, index) pair — what strikeEnvelope
 *  uses to place return strokes, so a given strike flickers the same way on
 *  every tick rather than jittering. */
function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface Lobe {
  cx: number;
  cy: number;
  cz: number;
  /** Radius of the lobe: the shader's shape() reaches somewhat past this. */
  r: number;
}

/** Pushes a point back inside the bounding ellipsoid (scaled by `margin`)
 *  along the ray from its centre. Points already inside are untouched. */
function clampToEllipsoid(p: [number, number, number], margin = 1): [number, number, number] {
  const ex = CLOUD_EXTENT_X * margin;
  const ey = CLOUD_EXTENT_Y * margin;
  const ez = CLOUD_EXTENT_Z * margin;
  const e = (p[0] / ex) ** 2 + (p[1] / ey) ** 2 + (p[2] / ez) ** 2;
  if (e <= 1) return p;
  const s = 1 / Math.sqrt(e);
  return [p[0] * s, p[1] * s, p[2] * s];
}

/** True when a point lies within the bounding ellipsoid (with a hair of
 *  tolerance for float rounding). */
export function insideCloud(x: number, y: number, z: number): boolean {
  return (x / CLOUD_EXTENT_X) ** 2 + (y / CLOUD_EXTENT_Y) ** 2 + (z / CLOUD_EXTENT_Z) ** 2 <= 1 + 1e-6;
}

export function buildLobes(rng: () => number, count = LOBE_COUNT): Lobe[] {
  const lobes: Lobe[] = [];
  for (let i = 0; i < count; i++) {
    // Centres sit well inside the ellipsoid so the lobes' own falloff, not
    // the centres, defines the silhouette.
    const c = clampToEllipsoid([
      (rng() * 2 - 1) * CLOUD_EXTENT_X * 0.85,
      (rng() * 2 - 1) * CLOUD_EXTENT_Y * 0.6,
      (rng() * 2 - 1) * CLOUD_EXTENT_Z * 0.85,
    ], 0.8);
    const r = 0.25 + rng() * 0.25;
    lobes.push({ cx: c[0], cy: c[1], cz: c[2], r });
  }
  return lobes;
}

/** Picks a lobe uniformly — every lobe gets its turn at hosting a strike,
 *  instead of the biggest one taking most of the lightning. */
function pickLobe(rng: () => number, lobes: Lobe[]): Lobe {
  return lobes[Math.min(lobes.length - 1, Math.floor(rng() * lobes.length))];
}

/** Picks a lobe by volume (r^3), so a big lobe gets its share of the particle
 *  budget and the point cloud reads as one mass rather than a ring of equal
 *  puffs. Strikes use the uniform pickLobe instead. */
function pickLobeByVolume(rng: () => number, lobes: Lobe[]): Lobe {
  let total = 0;
  for (const l of lobes) total += l.r ** 3;
  let x = rng() * total;
  for (const l of lobes) {
    x -= l.r ** 3;
    if (x <= 0) return l;
  }
  return lobes[lobes.length - 1];
}

/** Samples the particle cloud. Positions are xyz triples in cloud space;
 *  seeds are per-particle [0,1) values the shader uses for size, churn phase,
 *  orbit, ember launch and sparkle selection. Deterministic for a given seed,
 *  and — because buildLobes is the first thing drawn from the seeded rng, as
 *  in cloudVolumes() — the lobes it returns for CLOUD_SEED are exactly the
 *  ones the silhouette volume was baked from, so points and gas share a
 *  cloud. Particles are laid down in no lobe order, so any prefix of the
 *  buffer is a representative subsample and Cloud density can just shorten
 *  the draw. */
export function buildCloud(count: number, seed = CLOUD_SEED): {
  positions: Float32Array;
  seeds: Float32Array;
  lobes: Lobe[];
} {
  const rng = createRng(seed);
  const lobes = buildLobes(rng);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const l = pickLobeByVolume(rng, lobes);
    let p: [number, number, number] = [0, 0, 0];
    for (let attempt = 0; attempt <= SAMPLE_RETRIES; attempt++) {
      p = [l.cx + l.r * gaussian(rng), l.cy + l.r * 0.7 * gaussian(rng), l.cz + l.r * gaussian(rng)];
      if (insideCloud(p[0], p[1], p[2])) break;
    }
    p = clampToEllipsoid(p);
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
    seeds[i] = rng();
  }
  return { positions, seeds, lobes };
}

/** The particle budget this scene actually allocates for a quality preset's
 *  `maxParticles`: enough that the floor preset still reads as a cloud, and
 *  capped where additive fill rate stops paying for itself. */
export function particleCountForQuality(maxParticles: number): number {
  return Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, Math.floor(maxParticles)));
}

// --- The noise volume -------------------------------------------------------
//
// Two channels, both tileable: R is value-noise fbm ("where is there gas at
// all"), G is inverted Worley ("where are the billow cores"). The shader
// pairs them with Schneider's remap so the value noise's filaments are
// rounded into puffs. Tileability comes from every lattice wrapping modulo
// its own cell count over the [0,1) volume: the field is periodic with period
// 1, so texel `size` is texel 0 and REPEAT wrap has no seam.

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** cells^3 random lattice values, in x-fastest order. */
function valueLattice(rng: () => number, cells: number): Float32Array {
  const table = new Float32Array(cells * cells * cells);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  return table;
}

/** One jittered feature point per cell, as an in-cell [0,1) offset triple. */
function worleyPoints(rng: () => number, cells: number): Float32Array {
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rng();
  return pts;
}

/** Trilinear value noise at (x,y,z) in [0,1), wrapping at the volume edge. */
function sampleValue(table: Float32Array, cells: number, x: number, y: number, z: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const fz = z * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = smootherstep(fx - ix);
  const ty = smootherstep(fy - iy);
  const tz = smootherstep(fz - iz);
  const x0 = wrapIndex(ix, cells);
  const x1 = wrapIndex(ix + 1, cells);
  const y0 = wrapIndex(iy, cells);
  const y1 = wrapIndex(iy + 1, cells);
  const z0 = wrapIndex(iz, cells);
  const z1 = wrapIndex(iz + 1, cells);
  const at = (xi: number, yi: number, zi: number) => table[(zi * cells + yi) * cells + xi];
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const c00 = mix(at(x0, y0, z0), at(x1, y0, z0), tx);
  const c10 = mix(at(x0, y1, z0), at(x1, y1, z0), tx);
  const c01 = mix(at(x0, y0, z1), at(x1, y0, z1), tx);
  const c11 = mix(at(x0, y1, z1), at(x1, y1, z1), tx);
  return mix(mix(c00, c10, ty), mix(c01, c11, ty), tz);
}

/** Distance to the nearest feature point, in cell units, clamped to 1 —
 *  searched over the 27 neighbouring cells with wrapped indices so the field
 *  is periodic. */
function sampleWorley(pts: Float32Array, cells: number, x: number, y: number, z: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const fz = z * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  let best = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const o = ((wrapIndex(cz, cells) * cells + wrapIndex(cy, cells)) * cells + wrapIndex(cx, cells)) * 3;
        const ex = cx + pts[o] - fx;
        const ey = cy + pts[o + 1] - fy;
        const ez = cz + pts[o + 2] - fz;
        const e = ex * ex + ey * ey + ez * ez;
        if (e < best) best = e;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}

/** The 3D noise volume, `size`^3 texels of RG8 in x-fastest order (the layout
 *  texImage3D wants). Deterministic for a given seed; pure and node-safe so
 *  tests/storm.test.ts can check it without a GL context. */
export function buildNoiseVolume(size: number = NOISE_SIZE, seed = 1): Uint8Array {
  const rng = createRng(seed);
  const valueTables = NOISE_VALUE_CELLS.map((cells) => valueLattice(rng, cells));
  const worleyTables = NOISE_WORLEY_CELLS.map((cells) => worleyPoints(rng, cells));
  const data = new Uint8Array(size * size * size * 2);
  let o = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        let value = 0;
        for (let k = 0; k < NOISE_VALUE_CELLS.length; k++) {
          value += NOISE_VALUE_AMPS[k] * sampleValue(valueTables[k], NOISE_VALUE_CELLS[k], u, v, w);
        }
        let puff = 0;
        for (let k = 0; k < NOISE_WORLEY_CELLS.length; k++) {
          puff += NOISE_WORLEY_AMPS[k] * (1 - sampleWorley(worleyTables[k], NOISE_WORLEY_CELLS[k], u, v, w));
        }
        data[o++] = Math.max(0, Math.min(255, Math.round(value * 255)));
        data[o++] = Math.max(0, Math.min(255, Math.round(puff * 255)));
      }
    }
  }
  return data;
}

// --- The shape field -------------------------------------------------------
//
// The analytic silhouette, baked once into a 3D texture. It is entirely
// static in cloud space — the lobes never move, and the bass swell is a
// transform of the space rather than of the field — so evaluating the lobe
// loop per march step (three times over, counting the shadow taps) was the
// single most expensive thing this scene did. One texel fetch replaces it.

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The cloud's analytic silhouette at a point in cloud space, in 0..1:
 *  a smooth union of the lobes, each stretched so its underside falls off
 *  faster than its top (cumulus sits on a flat-ish base, rather than reading
 *  as a ball), faded out into the bounding ellipsoid the shader marches. */
export function shapeAt(lobes: Lobe[], x: number, y: number, z: number): number {
  let s = 0;
  for (const l of lobes) {
    const dx = x - l.cx;
    const dz = z - l.cz;
    let dy = y - l.cy;
    if (dy < 0) dy /= 0.6;
    const r = l.r * SHAPE_REACH;
    const si = 1 - (dx * dx + dy * dy + dz * dz) / (r * r);
    // Smooth union, not a plain max: a hard max leaves each lobe reading as
    // its own ball, while the blend swells the seam between two lobes into
    // one mass the way neighbouring cumulus turrets merge.
    const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (si - s)) / SHAPE_BLEND));
    s = s + (si - s) * h + SHAPE_BLEND * h * (1 - h);
  }
  const e = Math.sqrt((x / BOUND_X) ** 2 + (y / BOUND_Y) ** 2 + (z / BOUND_Z) ** 2);
  return Math.min(1, Math.max(0, s)) * (1 - smoothstep01(0.72, 1, e));
}

/** shapeAt sampled over the bounding box as `size`^3 texels of R8, x-fastest.
 *  Texel centres land on ((i + 0.5) / size * 2 - 1) * BOUND, which is exactly
 *  what the shader's `p / (2 * BOUND) + 0.5` lookup addresses. Every texel on
 *  a box face is outside the ellipsoid and so reads 0, which is what makes
 *  CLAMP_TO_EDGE safe. */
export function buildShapeVolume(size: number, lobes: Lobe[]): Uint8Array {
  const data = new Uint8Array(size * size * size);
  let o = 0;
  for (let k = 0; k < size; k++) {
    const z = (((k + 0.5) / size) * 2 - 1) * BOUND_Z;
    for (let j = 0; j < size; j++) {
      const y = (((j + 0.5) / size) * 2 - 1) * BOUND_Y;
      for (let i = 0; i < size; i++) {
        const x = (((i + 0.5) / size) * 2 - 1) * BOUND_X;
        data[o++] = Math.round(shapeAt(lobes, x, y, z) * 255);
      }
    }
  }
  return data;
}

/** A strike's line segment: A inside a lobe, B a short random distance away,
 *  both kept inside the cloud so the light source is always buried in gas.
 *  Returned as [ax, ay, az, bx, by, bz]. */
export function sampleStrikeSegment(rng: () => number, lobes: Lobe[]): [number, number, number, number, number, number] {
  const l = pickLobe(rng, lobes);
  const a = clampToEllipsoid([
    l.cx + l.r * 0.5 * gaussian(rng),
    l.cy + l.r * 0.35 * gaussian(rng),
    l.cz + l.r * 0.5 * gaussian(rng),
  ], 0.9);
  let dx = gaussian(rng);
  let dy = gaussian(rng);
  let dz = gaussian(rng);
  const n = Math.hypot(dx, dy, dz) || 1;
  dx /= n;
  dy /= n;
  dz /= n;
  const len = STRIKE_LEN_MIN + rng() * (STRIKE_LEN_MAX - STRIKE_LEN_MIN);
  let b: [number, number, number] = [a[0] + dx * len, a[1] + dy * len, a[2] + dz * len];
  // If the far end pokes out of the cloud, run the bolt the other way first;
  // only if both ways exit does it get pulled back to the surface.
  if (!insideCloud(b[0], b[1], b[2])) {
    const flipped: [number, number, number] = [a[0] - dx * len, a[1] - dy * len, a[2] - dz * len];
    b = insideCloud(flipped[0], flipped[1], flipped[2]) ? flipped : clampToEllipsoid(b);
  }
  return [a[0], a[1], a[2], b[0], b[1], b[2]];
}

/** Brightness of a strike `ageSec` after it fired: 1 at the instant of the
 *  strike, an exponential decay whose rate Afterglow sets, plus a train of
 *  return strokes (re-flashes ~50–90 ms apart, each weaker than the last)
 *  whose count Flicker sets. `seed` fixes where a given strike's strokes
 *  land so the pattern is stable across ticks. */
export function strikeEnvelope(ageSec: number, seed: number, afterglow: number, flicker: number): number {
  if (!(ageSec >= 0)) return 0;
  const glow = Math.min(1, Math.max(0, afterglow));
  const flick = Math.min(1, Math.max(0, flicker));
  const decay = 14 - 9 * glow; // mix(14, 5, afterglow) per second
  let v = Math.exp(-ageSec * decay);
  const strokes = Math.round(flick * 3);
  let t = 0;
  for (let k = 0; k < strokes; k++) {
    t += 0.05 + 0.04 * hash01(seed, k);
    if (ageSec >= t) v += (0.3 + 0.4 * flick) * Math.pow(0.75, k) * Math.exp(-(ageSec - t) * decay * 1.3);
  }
  return Math.min(v, 1.5);
}

/** Pool of strikes in flight. Endpoints and per-slot strength are kept in
 *  flat arrays shaped for uniform3fv/uniform1fv so render() uploads them as
 *  is. Exported for tests/storm.test.ts. */
export function createStrikePool(lobes: Lobe[], rng: () => number = Math.random) {
  const age = new Float32Array(MAX_STRIKES).fill(1e6); // huge = never triggered, fully faded
  const amp = new Float32Array(MAX_STRIKES); // 0 = inactive
  const seed = new Float32Array(MAX_STRIKES);
  const posA = new Float32Array(MAX_STRIKES * 3);
  const posB = new Float32Array(MAX_STRIKES * 3);
  const strength = new Float32Array(MAX_STRIKES);
  // Wall-clock (anim.timeSec) instant each slot last fired, for the Sparks
  // style: the shader ages its embers against uTime directly rather than
  // against `age` here, so it needs the absolute birth, not the elapsed time.
  // -1e6 = never fired, which puts every ember well past its lifetime.
  const birth = new Float32Array(MAX_STRIKES).fill(-1e6);
  let sinceLast = 1e6;
  return {
    /** Segment start per slot, xyz triples in cloud space. */
    posA,
    /** Segment end per slot. */
    posB,
    /** Current light strength per slot: amplitude x strikeEnvelope(age). */
    strength,
    /** Amplitude each slot fired at, un-enveloped. 0 = never fired. */
    amp,
    /** anim.timeSec each slot fired at; -1e6 for a slot that never has. */
    birth,
    /** Fires a strike in whichever slot has been fading the longest — never
     *  the youngest, so a beat can't cut off the flash the last one started.
     *  Strength is set immediately so the attack lands on this very frame.
     *  Returns false (and does nothing) inside the refractory window after
     *  the previous strike unless `force` — that's what folds a low onset and
     *  a broadband beat on adjacent frames into one strike. `nowSec` is the
     *  clock the Sparks style ages embers against (anim.timeSec). */
    trigger(amplitude = 1, force = false, nowSec = 0): boolean {
      if (!force && sinceLast < STRIKE_REFRACTORY_SEC) return false;
      sinceLast = 0;
      let slot = 0;
      for (let i = 1; i < MAX_STRIKES; i++) if (age[i] > age[slot]) slot = i;
      age[slot] = 0;
      amp[slot] = amplitude;
      birth[slot] = nowSec;
      seed[slot] = rng() * 1000;
      const seg = sampleStrikeSegment(rng, lobes);
      posA[slot * 3] = seg[0];
      posA[slot * 3 + 1] = seg[1];
      posA[slot * 3 + 2] = seg[2];
      posB[slot * 3] = seg[3];
      posB[slot * 3 + 1] = seg[4];
      posB[slot * 3 + 2] = seg[5];
      strength[slot] = amplitude;
      return true;
    },
    tick(dtSec: number, afterglow: number, flicker: number): void {
      sinceLast += dtSec;
      for (let i = 0; i < MAX_STRIKES; i++) {
        age[i] += dtSec;
        strength[i] = amp[i] > 0 ? amp[i] * strikeEnvelope(age[i], seed[i], afterglow, flicker) : 0;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Shaders

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

const STRIKE_UNIFORMS_GLSL = `
uniform vec3 uStrikeA[${MAX_STRIKES}];
uniform vec3 uStrikeB[${MAX_STRIKES}];
uniform float uStrikeStrength[${MAX_STRIKES}];
`;

// Only the Sparks style reads these, so they live apart from the strike
// uniforms every pass wants: the absolute instant each slot fired and the
// amplitude it fired at, both un-enveloped (an ember has its own lifetime,
// which outlasts strikeEnvelope's flash).
const SPARK_UNIFORMS_GLSL = `
uniform float uStrikeBirth[${MAX_STRIKES}];
uniform float uStrikeAmp[${MAX_STRIKES}];
`;

// The one camera in this scene, in both directions. Forward (cloudToView +
// viewToRoomNdc) is what projects a strike's endpoints for the background
// haze; unrotate() is its inverse, which is what the volume actually marches
// through — a ray is built in the camera's own space and pushed back into
// cloud space, so the density field, the strikes and the march all share the
// space the strike pool stores its segments in.
//
// The bass swell is a uniform scale of cloud space against a fixed camera, so
// in cloud space it only moves the ray origin: the gas, its noise detail and
// the bolts all inflate together, exactly as they did when this scene drew
// points.
const CAMERA_GLSL = `
#define CAM_DIST ${CAM_DIST.toFixed(2)}
#define FOCAL_Y ${(1 / Math.tan((CAM_FOV_DEG * Math.PI) / 360)).toFixed(5)}
#define TILT 0.22

float swellScale() {
  return 1.0 + 0.25 * uSwell * uLow;
}

vec3 rotY(vec3 p, float ca, float sa) {
  return vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
}

vec3 rotX(vec3 p, float ct, float st) {
  return vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
}

vec3 cloudToView(vec3 p) {
  p *= swellScale();
  float a = uFlowPhase * uSwirl * 0.35;
  p = rotY(p, cos(a), sin(a));
  p = rotX(p, cos(TILT), sin(TILT));
  // Camera on +z looking at the origin.
  return vec3(p.x, p.y, max(CAM_DIST - p.z, 0.5));
}

// Undoes cloudToView's swirl and tilt. A point additionally divides by
// swellScale(); a direction doesn't need to, since it gets normalized.
vec3 unrotate(vec3 q) {
  float a = uFlowPhase * uSwirl * 0.35;
  q = rotX(q, cos(TILT), -sin(TILT));
  return rotY(q, cos(a), -sin(a));
}

float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}

vec2 viewToRoomNdc(vec3 v) {
  return vec2(v.x * FOCAL_Y / roomAspect(), v.y * FOCAL_Y) / v.z;
}
`;

const VOLUME_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
uniform highp sampler3D uNoise; // R: value fbm, G: inverted worley — tiled
uniform highp sampler3D uShape; // the baked silhouette (shapeAt), over BOUND
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${CAMERA_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}
#define MAX_STEPS ${MAX_STEPS}
#define MAX_OCTAVES ${NOISE_VALUE_CELLS.length}
#define BASE_FREQ ${BASE_FREQ.toFixed(4)}

// Half-extents of the ellipsoid the march is clipped to, and where shape()
// fades out — see BOUND_X/Y/Z in storm.ts for why they differ per axis.
const vec3 BOUND = vec3(${BOUND_X.toFixed(4)}, ${BOUND_Y.toFixed(4)}, ${BOUND_Z.toFixed(4)});
// A hidden sun, above and slightly behind the viewer's right shoulder —
// written out normalized so it stays a plain constant.
const vec3 SUN_DIR = vec3(0.32148, 0.91852, 0.21106);

float remap(float v, float lo, float hi, float nlo, float nhi) {
  return nlo + (v - lo) * (nhi - nlo) / max(hi - lo, 1e-5);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float distToSegment(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

vec3 boltColor() {
  return mix(vec3(0.72, 0.82, 1.0), palette(0.15, uPalA, uPalB, uPalC, uPalD), 0.3);
}

// The analytic silhouette, read from the volume shapeAt() was baked into.
// One fetch: evaluating the lobe loop here instead cost more than the rest of
// the march put together, and the field is static in cloud space anyway.
// CLAMP_TO_EDGE is safe because every texel on a box face reads 0.
float shape(vec3 p) {
  return texture(uShape, p / (2.0 * BOUND) + 0.5).r;
}

// Where the noise is read: the whole field drifts slowly downwind and churns
// against itself, so the gas rolls even with Swirl at zero.
vec3 flowSpace(vec3 p) {
  vec3 q = p + vec3(uFlowPhase * 0.06, 0.0, uFlowPhase * 0.03);
  return q + 0.08 * sin(q.zxy * 2.0 + uTime * 0.3);
}

float erosionAmount() {
  return mix(0.1, 0.7, uGrain);
}

// The fbm sum sits close to its mean by construction; stretching it around
// 0.5 is what turns a soft grey haze into separate billows.
float contrast(float v) {
  return clamp((v - 0.5) * 1.7 + 0.5, 0.0, 1.0);
}

// Schneider's perlin-worley: the inverted worley channel raises the value
// noise's floor into rounded billow cores instead of wispy filaments.
float puffMask(vec2 n) {
  return clamp(remap(n.r, 1.0 - n.g, 1.0, 0.0, 1.0), 0.0, 1.0);
}

// Full density: octave 0 doubles as the puff mask, so the fetch count is
// exactly the octave count (plus one more while Treble wisps are audible).
float density(vec3 p, float sh, int octaves) {
  vec3 q = flowSpace(p);
  vec2 n0 = texture(uNoise, q * BASE_FREQ).rg;
  float f = 0.5 * n0.r;
  float norm = 0.5;
  float amp = 0.25;
  float freq = BASE_FREQ * 2.7;
  for (int o = 1; o < MAX_OCTAVES; o++) {
    if (o >= octaves) break;
    f += amp * texture(uNoise, q * freq).r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.7;
  }
  f = contrast(f / norm);

  float d = clamp(remap(sh * mix(0.35, 1.0, puffMask(n0)), erosionAmount() * (1.0 - f), 1.0, 0.0, 1.0), 0.0, 1.0);

  // Treble wisps: one high-frequency octave shaved off the rim, so hats and
  // cymbals fray the cloud's edge rather than lighting it.
  float wisp = uSpark * uHigh;
  if (wisp > 0.01) {
    float w = texture(uNoise, q * (BASE_FREQ * 8.0)).g;
    d = clamp(d - wisp * 0.4 * (1.0 - w) * (1.0 - sh), 0.0, 1.0);
  }
  return d;
}

// One-fetch density, for the shadow taps toward the sun — the difference
// against density() is invisible once it has been through exp().
float densityCheap(vec3 p) {
  float sh = shape(p);
  if (sh <= 0.002) return 0.0;
  vec2 n0 = texture(uNoise, flowSpace(p) * BASE_FREQ).rg;
  return clamp(remap(sh * mix(0.35, 1.0, puffMask(n0)), erosionAmount() * (1.0 - contrast(n0.r)), 1.0, 0.0, 1.0), 0.0, 1.0);
}

// Sky behind the volume: a near-black gradient plus a faint haze around each
// live bolt, projected through the forward camera. Deliberately weak — the
// volume itself carries most of the flash now.
vec3 background(vec2 uv, float aspect) {
  vec2 q = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);
  vec3 sky = mix(vec3(0.02, 0.02, 0.035), palette(0.55, uPalA, uPalB, uPalC, uPalD) * 0.06, 0.5);
  vec3 col = sky * (1.1 - 0.5 * uv.y);

  float sigma = mix(0.12, 0.35, uReach);
  float glow = 0.0;
  for (int i = 0; i < MAX_STRIKES; i++) {
    float s = uStrikeStrength[i];
    if (s <= 0.001) continue;
    vec3 va = cloudToView(uStrikeA[i]);
    vec3 vb = cloudToView(uStrikeB[i]);
    vec2 a = viewToRoomNdc(va) * vec2(aspect, 1.0);
    vec2 b = viewToRoomNdc(vb) * vec2(aspect, 1.0);
    vec2 ab = b - a;
    float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(q - (a + ab * t));
    float sig = sigma * CAM_DIST / (0.5 * (va.z + vb.z));
    glow += s * exp(-(d * d) / (sig * sig));
  }
  return col + boltColor() * glow * 0.12 * mix(0.5, 2.0, uStrike);
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = roomAspect();
  vec3 bg = background(uv, aspect);

  // Particles mode: no march at all. The point pass draws the cloud, so all
  // this pass owes it is something to draw over — sky, the haze around each
  // live bolt, and the drop flash. Every pixel is still written (nothing else
  // in the shared gallery context clears colour).
  if (int(uMode + 0.5) == ${MODE_PARTICLES}) {
    vec3 flat_ = bg + boltColor() * 0.1 * uDropPulse * uDropStorm;
    outColor = vec4(1.0 - exp(-flat_ * 1.25), 1.0);
    return;
  }

  // The ray, built in the camera's own space and pushed back into cloud
  // space: the exact inverse of cloudToView (see CAMERA_GLSL).
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 rdCam = normalize(vec3(ndc.x * aspect / FOCAL_Y, ndc.y / FOCAL_Y, -1.0));
  vec3 ro = unrotate(vec3(0.0, 0.0, CAM_DIST)) / swellScale();
  vec3 rd = normalize(unrotate(rdCam));

  // Ray vs the bounding ellipsoid, solved in the space where it is a unit
  // sphere. Half-b form: t = (-B +/- sqrt(B*B - A*C)) / A.
  vec3 eo = ro / BOUND;
  vec3 ed = rd / BOUND;
  float A = dot(ed, ed);
  float B = dot(eo, ed);
  float C = dot(eo, eo) - 1.0;
  float disc = B * B - A * C;

  vec3 col = bg;
  float T = 1.0;
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float tNear = (-B - sq) / A;
    float tFar = (-B + sq) / A;
    if (tFar > 0.0) {
      tNear = max(tNear, 0.0);
      int steps = int(min(float(MAX_STEPS), max(8.0, uMaxSteps)));
      float stepLen = (tFar - tNear) / float(steps);
      // Jitter the first sample by a fraction of a step, or the march bands
      // the cloud into visible shells.
      float t = tNear + hash12(gl_FragCoord.xy + fract(uTime) * 137.0) * stepLen;

      int octaves = uDetail < 0.5 ? 2 : MAX_OCTAVES;
      float sigma = mix(3.0, 10.0, uDensity);
      float reachR = mix(0.15, 0.6, uReach);
      float gain = mix(0.5, 2.0, uStrike);
      vec3 tint = boltColor();
      vec3 skyTop = mix(vec3(0.42, 0.48, 0.62), palette(0.55, uPalA, uPalB, uPalC, uPalD), 0.35);
      vec3 acc = vec3(0.0);

      for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= steps) break;
        vec3 p = ro + rd * t;
        t += stepLen;

        // Empty space costs one fetch and then strides twice as far: most of
        // the bounding ellipsoid is air, and the density is ~0 for a while
        // either side of the shape's edge, so the coarser sampling there is
        // invisible (and the per-pixel jitter scatters what little shows).
        float sh = shape(p);
        if (sh <= 0.002) { t += stepLen; continue; }

        // The bolt's own emission and the light it scatters into the gas.
        // Computed before the density gate below: the plasma emits whether or
        // not there is gas at this sample, so a bolt crossing a hole the
        // erosion punched still reads as a streak instead of vanishing.
        float glow = 0.0;
        float core = 0.0;
        for (int k = 0; k < MAX_STRIKES; k++) {
          float s = uStrikeStrength[k];
          if (s <= 0.001) continue;
          float dist = distToSegment(p, uStrikeA[k], uStrikeB[k]);
          float dr = dist / reachR;
          glow += s / (1.0 + dr * dr);
          core += s * 2.0 * exp(-dist * dist / 0.004);
        }

        float d = density(p, sh, octaves);
        if (d > 0.002) {
          float a = 1.0 - exp(-d * sigma * stepLen);
          float s1 = densityCheap(p + SUN_DIR * 0.15);
          float s2 = uDetail < 0.5 ? 0.0 : densityCheap(p + SUN_DIR * 0.4);
          float shadow = exp(-1.5 * (s1 + s2));
          // Powder: thin gas scatters less back toward the camera, which is
          // what keeps the wispy rim from reading as bright as the core.
          float powder = 1.0 - exp(-d * 2.0);
          vec3 sun = vec3(1.0, 0.95, 0.9) * shadow * 0.9 * mix(0.35, 1.0, uAmbient) * mix(1.0, powder, 0.35);
          float heightFrac = clamp((p.y + BOUND.y) / (2.0 * BOUND.y), 0.0, 1.0);
          vec3 ambient = skyTop * mix(0.35, 1.0, heightFrac) * uAmbient * (0.5 + uEnergy);
          acc += T * a * (sun + ambient + tint * glow * gain);
          T *= 1.0 - a;
        }
        acc += T * tint * core * gain * stepLen * 4.0;
        if (T < 0.02) break;
      }
      col = bg * T + acc;
    }
  }

  // Whole-frame flash on a drop, in front of the volume rather than behind it.
  col += boltColor() * 0.1 * uDropPulse * uDropStorm;

  // Soft shoulder instead of a hard clip: a strike can push the cloud far
  // past 1.0 and still resolve as light rather than a flat white hole.
  outColor = vec4(1.0 - exp(-col * 1.25), 1.0);
}
`;

// The point cloud. One program for all three styles: uParticleStyle is a
// uniform, so the branch is coherent across the whole draw and costs nothing
// beyond the instructions of the branch actually taken.
const POINT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aSeed;
layout(location = 2) in float aSlot; // which strike slot this particle belongs to (Sparks)
out vec3 vColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
${SPARK_UNIFORMS_GLSL}
uniform float uCountBoost;
${PALETTE_GLSL}
${CAMERA_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}
#define EXTENT_X ${CLOUD_EXTENT_X.toFixed(2)}
#define EXTENT_Y ${CLOUD_EXTENT_Y.toFixed(2)}
#define EXTENT_Z ${CLOUD_EXTENT_Z.toFixed(2)}
#define STYLE_SWARM 1
#define STYLE_SPARKS ${STYLE_SPARKS}
#define TAU 6.2831853
// How much of the way onto the bolt a full-strength strike drags a Swarm
// particle sitting right on top of it. Below 1, so the swarm streaks toward
// the lightning over the flash without collapsing onto the segment.
#define PULL_K 0.5

float hash11(float x) {
  return fract(sin(x * 127.1) * 43758.5453);
}

vec3 closestOnSegment(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return a + ab * t;
}

float distToSegment(vec3 p, vec3 a, vec3 b) {
  return length(p - closestOnSegment(p, a, b));
}

void main() {
  float seed = aSeed;
  float t = uTime;
  int style = int(uParticleStyle + 0.5);

  float reachR = mix(0.15, 0.6, uReach);
  float gain = mix(0.3, 1.2, uStrike);
  vec3 boltTint = mix(vec3(0.72, 0.82, 1.0), palette(0.15, uPalA, uPalB, uPalC, uPalD), 0.3);

  vec3 p = aPos;
  vec3 color = vec3(0.0);
  float sizeScale = 1.0;

  if (style == STYLE_SPARKS) {
    // Embers thrown off one bolt. Everything is a function of this slot's
    // birth instant and the particle's own seed, so no state is kept: a
    // particle whose slot is idle (or whose ember has burnt out) is pushed
    // off-screen at zero size and costs nothing past this branch.
    int slot = int(aSlot + 0.5);
    float age = t - uStrikeBirth[slot];
    float life = mix(0.6, 1.4, hash11(seed * 2.9));
    if (age < 0.0 || age > life) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec3 origin = mix(uStrikeA[slot], uStrikeB[slot], hash11(seed * 1.7));
    // A uniform direction on the sphere, then biased up and away from the
    // cloud's axis so the embers arc out of the bolt instead of raining
    // straight back into it.
    float th = hash11(seed * 4.1) * TAU;
    float zc = hash11(seed * 6.7) * 2.0 - 1.0;
    float rc = sqrt(max(0.0, 1.0 - zc * zc));
    vec3 dir = normalize(
      vec3(rc * cos(th), zc, rc * sin(th))
      + vec3(0.0, 0.55, 0.0)
      + 0.45 * normalize(origin + vec3(1e-3)));
    vec3 vel = dir * mix(1.5, 4.0, hash11(seed * 8.3));
    // Ballistic with drag: the closed form of v' = -3v, plus gravity.
    p = origin + vel * (1.0 - exp(-2.0 * age)) / 2.0 - vec3(0.0, 2.5 * age * age * 0.5, 0.0);

    float fade = 1.0 - age / life;
    float twinkle = 0.6 + 0.4 * hash11(seed + floor(t * 30.0));
    float bright = uStrikeAmp[slot] * fade * fade * twinkle;
    // White-blue at the bolt, cooling to a warm ember as it falls.
    vec3 ember = mix(vec3(1.0, 0.5, 0.16), palette(0.08, uPalA, uPalB, uPalC, uPalD), 0.35);
    color = mix(boltTint * 1.5, ember, clamp((age / life) * 1.6, 0.0, 1.0)) * bright * gain;
    sizeScale = mix(1.0, 0.35, age / life);
  } else if (style == STYLE_SWARM) {
    // Not a cloud: every particle orbits the volume on its own radius,
    // height and phase, at a rate off Swirl speed and the tempo.
    // sqrt of a uniform draw, with the height tapered off by the radius, so
    // the swarm fills the cloud's own ellipsoid rather than reading as a
    // cylinder standing side-on to the camera.
    float rad = sqrt(mix(0.03, 1.0, hash11(seed * 5.3)));
    float rate = (0.35 + 1.1 * uSwirl) * (0.6 + 0.4 * clamp(uBpm / 120.0, 0.3, 2.0));
    float a = hash11(seed * 2.3) * TAU + t * rate;
    vec3 q = vec3(
      cos(a) * EXTENT_X * rad,
      (hash11(seed * 9.1) * 2.0 - 1.0) * EXTENT_Y * sqrt(max(0.0, 1.0 - rad * rad * 0.9)),
      sin(a) * EXTENT_Z * rad);
    // Curl-ish wander: sines of position and time, so neighbours drift
    // together as a flow rather than jittering apart as noise.
    q += 0.22 * vec3(
      sin(q.z * 2.3 + t * 0.8 + seed * 11.0),
      sin(q.x * 2.7 - t * 0.6 + seed * 7.0),
      sin(q.y * 3.1 + t * 0.7 + seed * 5.0));
    q += 0.1 * sin(q.yzx * 4.1 + t * 1.3);

    // Live strikes drag the swarm: an inverse-square-ish attraction toward
    // the closest point on each bolt, alongside the usual strike light.
    float pullR = mix(0.5, 1.2, uReach);
    vec3 pull = vec3(0.0);
    float light = 0.0;
    for (int i = 0; i < MAX_STRIKES; i++) {
      float s = uStrikeStrength[i];
      if (s <= 0.001) continue;
      vec3 toBolt = closestOnSegment(q, uStrikeA[i], uStrikeB[i]) - q;
      float d2 = dot(toBolt, toBolt);
      pull += toBolt * (s * PULL_K / (1.0 + d2 / (pullR * pullR)));
      float dr = sqrt(d2) / reachR;
      // Body glow only — no hot core: the pull already piles the swarm onto
      // the bolt, and a core term on top of that pile reads as a white slab.
      light += s * 0.5 / (1.0 + dr * dr);
    }
    p = q + pull;
    light *= gain;
    float dragged = clamp(length(pull) * 1.0, 0.0, 1.0);

    vec3 base = mix(palette(0.55 + 0.2 * seed, uPalA, uPalB, uPalC, uPalD), vec3(0.55, 0.65, 1.0), 0.25) * 0.45;
    float ambient = uAmbient * (0.5 + uEnergy) * (0.55 + 0.45 * hash11(seed * 3.7));
    float spark = uSpark * uHighPulse * step(0.96, hash11(seed * 7.1 + floor(t * 10.0)));
    color = base * ambient
      + mix(boltTint, vec3(1.0), dragged) * (light + dragged * 0.4)
      + vec3(1.0) * spark;
  } else {
    // Cloud: the particles are the gas. Slow internal churn so it never sits
    // perfectly still, then the same broad-body-plus-hot-core strike light
    // the march computes per step.
    p = aPos + 0.05 * vec3(
      sin(t * 0.7 + seed * 31.0),
      sin(t * 0.9 + seed * 17.0),
      sin(t * 0.6 + seed * 23.0));

    float light = 0.0;
    for (int i = 0; i < MAX_STRIKES; i++) {
      float s = uStrikeStrength[i];
      if (s <= 0.001) continue;
      float d = distToSegment(p, uStrikeA[i], uStrikeB[i]);
      float dr = d / reachR;
      light += s * (1.0 / (1.0 + dr * dr) + 2.0 * exp(-d * d / 0.004));
    }
    // Gain is kept modest on purpose: the particles are additive with no
    // tonemap behind them, so a peak much above ~2 just holds pure white
    // until the envelope has decayed most of the way, then drops off a cliff.
    light *= gain;

    // Resting glow: brighter toward the top of the cloud, as if skylit, and
    // dimmer with distance so the far side reads as behind the near side.
    float heightShade = 0.55 + 0.45 * clamp((aPos.y + EXTENT_Y) / (2.0 * EXTENT_Y), 0.0, 1.0);
    float depthShade = mix(1.0, 0.5, smoothstep(CAM_DIST - 1.2, CAM_DIST + 1.2, cloudToView(p).z));
    float ambient = uAmbient * (0.5 + uEnergy) * heightShade * depthShade * (0.7 + 0.3 * hash11(seed * 3.7));
    // Treble sparks: a scattered few particles glint on high-band hits.
    float spark = uSpark * uHighPulse * step(0.96, hash11(seed * 7.1 + floor(t * 10.0)));

    vec3 base = mix(vec3(0.32, 0.34, 0.5), palette(0.6 + 0.1 * seed, uPalA, uPalB, uPalC, uPalD), 0.5) * 0.4;
    color = base * ambient + mix(boltTint, vec3(1.0), clamp(light, 0.0, 1.0)) * light + vec3(1.0) * spark;
  }

  vColor = color;

  vec3 view = cloudToView(p);
  vec2 ndc = viewToRoomNdc(view);
  vec2 uv01 = ndc * 0.5 + 0.5;
  uv01 = (uv01 - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(uv01 * 2.0 - 1.0, 0.0, 1.0);

  // Sized in device pixels against a 1080p reference so the cloud reads the
  // same in a gallery tile and at 4K; uCountBoost keeps sparse clouds dense.
  // The floor is where the soft disc in POINT_FRAG still covers whole
  // pixels — below it a gallery tile's sprites thin out to almost nothing.
  float px = mix(2.0, 10.0, uGrain) * (uResolution.y / 1080.0) * uCountBoost
    * (CAM_DIST / view.z) * (0.6 + 0.8 * seed) * sizeScale;
  gl_PointSize = clamp(px, 2.5, 40.0);
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;

void main() {
  float r = length(gl_PointCoord - 0.5);
  float mask = smoothstep(0.5, 0.1, r);
  outColor = vec4(vColor * mask, 1.0);
}
`;

// ---------------------------------------------------------------------------

// Both volumes are identical for every mount and neither is cheap to build
// (the noise alone is ~10^7 distance tests) — build them once per page, not
// once per gallery transition. init() runs on every gallery<->viz swap.
let cachedNoise: Uint8Array | null = null;
let cachedShape: { lobes: Lobe[]; data: Uint8Array } | null = null;
function noiseVolume(): Uint8Array {
  if (!cachedNoise) cachedNoise = buildNoiseVolume(NOISE_SIZE, CLOUD_SEED);
  return cachedNoise;
}
function cloudVolumes() {
  if (!cachedShape) {
    const lobes = buildLobes(createRng(CLOUD_SEED));
    cachedShape = { lobes, data: buildShapeVolume(SHAPE_SIZE, lobes) };
  }
  return cachedShape;
}

// The CPU-side point cloud is reused across mounts of the same count — init
// runs on every gallery<->viz transition, so sampling the whole budget each
// time would be a visible hitch.
let cachedCloud: { count: number; cloud: ReturnType<typeof buildCloud> } | null = null;
function cloudFor(n: number) {
  if (!cachedCloud || cachedCloud.count !== n) cachedCloud = { count: n, cloud: buildCloud(n) };
  return cachedCloud.cloud;
}

export const stormScene: Scene = (() => {
  let prog: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let noiseTex: WebGLTexture | null = null;
  let shapeTex: WebGLTexture | null = null;
  let pointProg: GLProgram | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  let posBuf: WebGLBuffer | null = null;
  let seedBuf: WebGLBuffer | null = null;
  let slotBuf: WebGLBuffer | null = null;
  let count = 0;
  let pool: ReturnType<typeof createStrikePool> | null = null;
  // Last-drawn pulse levels and clock, for the rise detection and render-dt
  // measurement the file header explains.
  let prevBeatPulse = 0;
  let prevLowPulse = 0;
  let prevDropPulse = 0;
  let lastTimeSec: number | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  return {
    id: ID,
    name: "Storm",
    // The floor preset's raymarch budget is too thin for a volume this deep —
    // it bands into shells rather than reading as gas.
    minQuality: "low",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      prog = createProgram(gl, VOLUME_FRAG);
      quadVao = createFullscreenQuad(gl);

      const { lobes, data: shapeData } = cloudVolumes();

      noiseTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RG8,
        NOISE_SIZE,
        NOISE_SIZE,
        NOISE_SIZE,
        0,
        gl.RG,
        gl.UNSIGNED_BYTE,
        noiseVolume(),
      );
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // REPEAT on all three axes is the whole point of building this volume
      // tileable: the texture coordinate is just a scale of the cloud-space
      // position, with no wrap handling in the shader.
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);

      shapeTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, shapeTex);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.R8,
        SHAPE_SIZE,
        SHAPE_SIZE,
        SHAPE_SIZE,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        shapeData,
      );
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

      // Sampler bindings are program state, so they only have to be set once.
      prog.use();
      gl.uniform1i(gl.getUniformLocation(prog.program, "uNoise"), 0);
      gl.uniform1i(gl.getUniformLocation(prog.program, "uShape"), 1);

      // The point cloud, sampled from the same lobes the shape volume was
      // baked from (buildCloud seeds buildLobes exactly as cloudVolumes does),
      // so in Both mode the points sit inside the gas rather than beside it.
      pointProg = createProgram(gl, POINT_FRAG, POINT_VERT);
      count = particleCountForQuality(ctx.quality.maxParticles);
      const cloud = cloudFor(count);
      const slots = new Float32Array(count);
      for (let i = 0; i < count; i++) slots[i] = i % MAX_STRIKES;

      pointVao = gl.createVertexArray();
      gl.bindVertexArray(pointVao);
      posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, cloud.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      seedBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
      gl.bufferData(gl.ARRAY_BUFFER, cloud.seeds, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
      slotBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, slotBuf);
      gl.bufferData(gl.ARRAY_BUFFER, slots, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      pool = createStrikePool(lobes);
      prevBeatPulse = 0;
      prevLowPulse = 0;
      prevDropPulse = 0;
      lastTimeSec = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!prog || !quadVao || !pool || !noiseTex || !shapeTex || !pointProg || !pointVao) return;
      const { gl } = ctx;

      // resolveSceneSetting (not getSceneSetting) — the raw manual value
      // would silently re-stomp an auto-tuned slider back to manual every
      // frame (see autoTune.ts and the same note in meshGrid.ts).
      const afterglow = resolveSceneSetting(ID, settingFor("afterglow"));
      const flicker = resolveSceneSetting(ID, settingFor("flicker"));
      const dropStorm = resolveSceneSetting(ID, settingFor("dropStorm"));
      const density = resolveSceneSetting(ID, settingFor("density"));
      const mode = Math.round(resolveSceneSetting(ID, settingFor("mode")));
      const style = Math.round(resolveSceneSetting(ID, settingFor("particleStyle")));

      // Time since this scene last drew — see the file header for why this
      // isn't anim.dtSec. Guards the first frame and any backwards jump.
      const dt = lastTimeSec === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTimeSec));
      lastTimeSec = anim.timeSec;

      // Age the pool first, then fire this frame's strikes, so a fresh strike
      // is uploaded at full strength on the very frame the beat landed.
      pool.tick(dt, afterglow, flicker);
      const beatRose = anim.beatPulse > prevBeatPulse + 1e-3 || frame.beat;
      const lowRose = anim.lowPulse > prevLowPulse + 1e-3 || anim.lowOnset;
      const dropRose = anim.dropPulse > prevDropPulse + 1e-3 || anim.dropOnset;
      prevBeatPulse = anim.beatPulse;
      prevLowPulse = anim.lowPulse;
      prevDropPulse = anim.dropPulse;
      if (dropRose) {
        // A drop is a burst of ordinary-strength strikes in different lobes
        // (a cloud-wide flash), not one overdriven strike — three at full
        // amplitude already saturate most of the cloud.
        for (let i = 0; i < STRIKE_DROP_BURST; i++) pool.trigger(0.8 + 0.6 * dropStorm, true, anim.timeSec);
      } else if (lowRose || beatRose) {
        pool.trigger(0.7 + 0.5 * (lowRose ? anim.lowPulse : 0), false, anim.timeSec);
      }

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      prog.use();
      uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      prog.setV3v("uStrikeA", pool.posA);
      prog.setV3v("uStrikeB", pool.posB);
      prog.setFv("uStrikeStrength", pool.strength);
      // Another scene in the shared gallery context may have bound something
      // else to these units since the last draw, so rebind both every frame.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, shapeTex);
      gl.activeTexture(gl.TEXTURE0);

      // The volume pass goes first in every mode: it paints every pixel (in
      // Particles mode it returns the background alone), so the points can be
      // laid over it additively with nothing to clear.
      drawFullscreenQuad(gl, quadVao);

      if (mode !== MODE_GAS) {
        pointProg.use();
        uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        pointProg.setV3v("uStrikeA", pool.posA);
        pointProg.setV3v("uStrikeB", pool.posB);
        pointProg.setFv("uStrikeStrength", pool.strength);
        pointProg.setFv("uStrikeBirth", pool.birth);
        pointProg.setFv("uStrikeAmp", pool.amp);
        pointProg.setF("uCountBoost", Math.min(3, Math.max(1, Math.sqrt(MAX_PARTICLES / count))));

        // Sparks draws its whole buffer (every particle belongs to a strike
        // slot, and one outside its lifetime is discarded in the vertex
        // shader), capped so a single strike's burst stays affordable. The
        // other styles draw a prefix, which is what Cloud density thins. Both
        // halves whatever that comes to, so the gas stays readable through
        // the points.
        const full = style === STYLE_SPARKS
          ? Math.min(count, SPARK_MAX_DRAW)
          : Math.floor(count * Math.max(0.05, density));
        const drawn = mode === MODE_PARTICLES ? full : Math.floor(full / 2);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(pointVao);
        gl.drawArrays(gl.POINTS, 0, drawn);
        gl.bindVertexArray(null);
      }

      // The gallery renders every scene into one shared context each tick —
      // leave the state every other scene expects to find.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      prog?.dispose();
      pointProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      if (posBuf) gl.deleteBuffer(posBuf);
      if (seedBuf) gl.deleteBuffer(seedBuf);
      if (slotBuf) gl.deleteBuffer(slotBuf);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, null);
      if (noiseTex) gl.deleteTexture(noiseTex);
      if (shapeTex) gl.deleteTexture(shapeTex);
      prog = null;
      quadVao = null;
      noiseTex = null;
      shapeTex = null;
      pointProg = null;
      pointVao = null;
      posBuf = null;
      seedBuf = null;
      slotBuf = null;
      count = 0;
      pool = null;
      prevBeatPulse = 0;
      prevLowPulse = 0;
      prevDropPulse = 0;
      lastTimeSec = null;
    },
  };
})();
