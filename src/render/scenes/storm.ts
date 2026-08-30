import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// A storm cloud built from a real 3D point cloud, lit from the inside by
// lightning on every beat — the intra-cloud kind, where you rarely see the
// bolt itself, only the cloud flashing around it: a hard attack, a couple of
// return-stroke flickers, then an afterglow that fades.
//
// How it's built:
//
//  - The cloud is a static VBO of particles sampled once at init from a
//    handful of overlapping gaussian lobes (buildCloud), squashed in y so it
//    reads as cumulus rather than a sphere. Each particle picks its lobe by
//    weighted random draw, so any prefix of the buffer is a representative
//    subsample — that's what lets Cloud density simply shrink the draw
//    count without dropping whole lobes.
//  - Particle count comes from `ctx.quality.maxParticles`, clamped by
//    particleCountForQuality, and is baked at init: switching the quality
//    preset mid-run doesn't remount a scene, so the new count only lands on
//    the next scene switch (same caveat meshGrid.ts's grid size has). Point
//    size, by contrast, follows renderScale live through uResolution, and
//    uCountBoost inflates sparse clouds (floor preset, gallery tiles) so they
//    still read as a cloud rather than dust.
//  - Lightning is a JS-side pool of strikes (createStrikePool), each a short
//    line segment inside the cloud that acts as a light source. Per-slot
//    strength follows strikeEnvelope — the flicker/afterglow shaping happens
//    on the CPU — and the vertex shader only does the spatial part: distance
//    from the particle to each active segment, a broad falloff (Flash reach)
//    plus a tight hot core that whites out the particles right on the bolt.
//    Lighting is computed in cloud space *before* the swirl rotation and
//    bass swell, the same space the strikes are stored in.
//  - A background pass runs first and paints every pixel: nothing else in
//    the shared gallery context clears colour. It carries a faint haze glow
//    per strike (projected through the same CAMERA_GLSL as the points, so
//    there is exactly one copy of the projection) so the space between
//    particles flashes too, plus a soft whole-frame flash on a drop.
//  - Particles are additive (gl.ONE, gl.ONE) with no depth test, so the
//    flash saturates to white on purpose — there is no offscreen pass to
//    tonemap through. Base particle brightness is kept low to leave headroom.
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
const ID = "storm";

const MAX_STRIKES = 8;
const MAX_PARTICLES = 120_000;
const MIN_PARTICLES = 4_000;
const LOBE_COUNT = 9;
// Samples that fall outside the bounding ellipsoid are redrawn this many
// times before being pulled back to the surface — pulling on the first miss
// piled every gaussian tail onto the ellipsoid and drew a hard, dense rim.
const SAMPLE_RETRIES = 8;
// Bounding ellipsoid half-extents of the cloud, in cloud-space units. The
// camera (CAMERA_GLSL) is placed so this fills a comfortable share of the
// frame with room for the bass swell.
const CLOUD_EXTENT_X = 1.6;
const CLOUD_EXTENT_Y = 0.8;
const CLOUD_EXTENT_Z = 1.2;
const STRIKE_REFRACTORY_SEC = 0.06;
const STRIKE_DROP_BURST = 3;
const STRIKE_LEN_MIN = 0.3;
const STRIKE_LEN_MAX = 0.6;
const CAM_DIST = 3.2;
const CAM_FOV_DEG = 50;

// Every table below reproduces its plain `default` when all dials sit at
// NEUTRAL (musicProfile.ts) — nothing is hand-biased. `pulse` is kept small
// throughout: it floors near 0.9 on any locked-tempo track (see the Focus
// snap comment in caustics.ts), so a large pulse weight is really a constant
// offset in disguise.
const SETTINGS: SceneSetting[] = [
  {
    key: "strike",
    label: "Strike intensity",
    description: "How hard each beat's lightning lights the cloud",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
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
    default: 0.5,
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
    description: "Share of the particle budget drawn",
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
    default: 0.4,
    auto: { loudness: 0.3, brightness: 0.2 },
  },
  {
    key: "grain",
    label: "Particle size",
    description: "Size of each particle sprite",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    advanced: true,
  },
  {
    key: "spark",
    label: "Treble sparks",
    description: "Scattered particles that glint on hats and treble hits",
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
  /** Gaussian radius of the lobe. */
  r: number;
  /** Sampling weight, proportional to r^3 (volume), so big lobes get their
   *  share of particles and the cloud reads as one mass. */
  w: number;
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
    // Centres sit well inside the ellipsoid so the gaussian tails, not the
    // centres, define the silhouette.
    const c = clampToEllipsoid([
      (rng() * 2 - 1) * CLOUD_EXTENT_X * 0.85,
      (rng() * 2 - 1) * CLOUD_EXTENT_Y * 0.6,
      (rng() * 2 - 1) * CLOUD_EXTENT_Z * 0.85,
    ], 0.8);
    const r = 0.25 + rng() * 0.25;
    lobes.push({ cx: c[0], cy: c[1], cz: c[2], r, w: r * r * r });
  }
  return lobes;
}

/** Picks a lobe by its volume weight (particles: big lobes get their share
 *  of the budget) or uniformly (strikes: every lobe gets its turn, instead of
 *  the biggest one taking most of the lightning). */
function pickLobe(rng: () => number, lobes: Lobe[], uniform = false): Lobe {
  if (uniform) return lobes[Math.min(lobes.length - 1, Math.floor(rng() * lobes.length))];
  let total = 0;
  for (const l of lobes) total += l.w;
  let x = rng() * total;
  for (const l of lobes) {
    x -= l.w;
    if (x <= 0) return l;
  }
  return lobes[lobes.length - 1];
}

/** Samples the particle cloud. Positions are xyz triples in cloud space;
 *  seeds are per-particle [0,1) values the shader uses for size, churn phase
 *  and sparkle selection. Deterministic for a given seed. */
export function buildCloud(count: number, seed = 1): { positions: Float32Array; seeds: Float32Array; lobes: Lobe[] } {
  const rng = createRng(seed);
  const lobes = buildLobes(rng);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const l = pickLobe(rng, lobes);
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

/** A strike's line segment: A inside a lobe, B a short random distance away,
 *  both kept inside the cloud so the light source is always buried in
 *  particles. Returned as [ax, ay, az, bx, by, bz]. */
export function sampleStrikeSegment(rng: () => number, lobes: Lobe[]): [number, number, number, number, number, number] {
  const l = pickLobe(rng, lobes, true);
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
  let sinceLast = 1e6;
  return {
    /** Segment start per slot, xyz triples in cloud space. */
    posA,
    /** Segment end per slot. */
    posB,
    /** Current light strength per slot: amplitude x strikeEnvelope(age). */
    strength,
    /** Fires a strike in whichever slot has been fading the longest — never
     *  the youngest, so a beat can't cut off the flash the last one started.
     *  Strength is set immediately so the attack lands on this very frame.
     *  Returns false (and does nothing) inside the refractory window after
     *  the previous strike unless `force` — that's what folds a low onset and
     *  a broadband beat on adjacent frames into one strike. */
    trigger(amplitude = 1, force = false): boolean {
      if (!force && sinceLast < STRIKE_REFRACTORY_SEC) return false;
      sinceLast = 0;
      let slot = 0;
      for (let i = 1; i < MAX_STRIKES; i++) if (age[i] > age[slot]) slot = i;
      age[slot] = 0;
      amp[slot] = amplitude;
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

// The one projection both passes share: cloud space -> view space (swirl,
// tilt, bass swell) -> room-space NDC. The Panorama slice remap by uViewport
// is applied by each caller (meshGrid.ts does the same in NDC).
const CAMERA_GLSL = `
#define CAM_DIST ${CAM_DIST.toFixed(2)}
#define FOCAL_Y ${(1 / Math.tan((CAM_FOV_DEG * Math.PI) / 360)).toFixed(5)}
#define TILT 0.22

vec3 cloudToView(vec3 p) {
  p *= 1.0 + 0.25 * uSwell * uLow;
  float a = uFlowPhase * uSwirl * 0.35;
  float ca = cos(a), sa = sin(a);
  p = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  float ct = cos(TILT), st = sin(TILT);
  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  // Camera on +z looking at the origin.
  return vec3(p.x, p.y, max(CAM_DIST - p.z, 0.5));
}

float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}

vec2 viewToRoomNdc(vec3 v) {
  return vec2(v.x * FOCAL_Y / roomAspect(), v.y * FOCAL_Y) / v.z;
}
`;

const POINT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aSeed;
out vec3 vColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
uniform float uCountBoost;
${PALETTE_GLSL}
${CAMERA_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}
#define EXTENT_Y ${CLOUD_EXTENT_Y.toFixed(2)}

float hash11(float x) {
  return fract(sin(x * 127.1) * 43758.5453);
}

float distToSegment(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

void main() {
  float seed = aSeed;
  float t = uTime;
  // Slow internal churn so the cloud never sits perfectly still.
  vec3 p = aPos + 0.05 * vec3(
    sin(t * 0.7 + seed * 31.0),
    sin(t * 0.9 + seed * 17.0),
    sin(t * 0.6 + seed * 23.0));

  // Lightning: distance to each live bolt, in cloud space. A broad body
  // (Flash reach) plus a tight hot core right on the segment.
  float reachR = mix(0.15, 0.6, uReach);
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
  light *= mix(0.5, 2.0, uStrike);

  vec3 view = cloudToView(p);

  // Resting glow: brighter toward the top of the cloud, as if skylit, and
  // dimmer with distance so the far side reads as behind the near side.
  float heightShade = 0.55 + 0.45 * clamp((aPos.y + EXTENT_Y) / (2.0 * EXTENT_Y), 0.0, 1.0);
  float depthShade = mix(1.0, 0.5, smoothstep(CAM_DIST - 1.2, CAM_DIST + 1.2, view.z));
  float ambient = uAmbient * (0.5 + uEnergy) * heightShade * depthShade * (0.7 + 0.3 * hash11(seed * 3.7));

  // Treble sparks: a scattered few particles glint on high-band hits.
  float spark = uSpark * uHighPulse * step(0.96, hash11(seed * 7.1 + floor(t * 10.0)));

  vec3 base = mix(vec3(0.32, 0.34, 0.5), palette(0.6 + 0.1 * seed, uPalA, uPalB, uPalC, uPalD), 0.5) * 0.4;
  vec3 boltTint = mix(vec3(0.72, 0.82, 1.0), palette(0.15, uPalA, uPalB, uPalC, uPalD), 0.3);
  vec3 bolt = mix(boltTint, vec3(1.0), clamp(light, 0.0, 1.0));
  vColor = base * ambient + bolt * light + vec3(1.0) * spark;

  vec2 ndc = viewToRoomNdc(view);
  vec2 uv01 = ndc * 0.5 + 0.5;
  uv01 = (uv01 - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(uv01 * 2.0 - 1.0, 0.0, 1.0);

  // Sized in device pixels against a 1080p reference so the cloud reads the
  // same in a gallery tile and at 4K; uCountBoost keeps sparse clouds dense.
  // The floor is where the soft disc in POINT_FRAG still covers whole
  // pixels — below it a gallery tile's sprites thin out to almost nothing.
  float px = mix(2.0, 10.0, uGrain) * (uResolution.y / 1080.0) * uCountBoost * (CAM_DIST / view.z) * (0.6 + 0.8 * seed);
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

const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${CAMERA_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}

float distToSegment2(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = roomAspect();
  // Aspect-corrected room NDC so distances are isotropic.
  vec2 q = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);

  // Near-black sky, a touch lighter toward the bottom, tinted by the palette.
  vec3 sky = mix(vec3(0.02, 0.02, 0.035), palette(0.55, uPalA, uPalB, uPalC, uPalD) * 0.06, 0.5);
  vec3 col = sky * (1.1 - 0.5 * uv.y);

  // A faint haze at the cloud's centre so it reads as a volume, not dust.
  vec2 centre = viewToRoomNdc(cloudToView(vec3(0.0))) * vec2(aspect, 1.0);
  float hazeR = length((q - centre) / vec2(1.1, 0.6));
  col += palette(0.6, uPalA, uPalB, uPalC, uPalD) * 0.06 * uAmbient * (0.5 + uEnergy) * exp(-hazeR * hazeR * 1.5);

  // Each live strike lights the haze around its projected bolt.
  vec3 boltTint = mix(vec3(0.72, 0.82, 1.0), palette(0.15, uPalA, uPalB, uPalC, uPalD), 0.3);
  float sigma = mix(0.12, 0.35, uReach);
  float glow = 0.0;
  for (int i = 0; i < MAX_STRIKES; i++) {
    float s = uStrikeStrength[i];
    if (s <= 0.001) continue;
    vec3 va = cloudToView(uStrikeA[i]);
    vec3 vb = cloudToView(uStrikeB[i]);
    vec2 a = viewToRoomNdc(va) * vec2(aspect, 1.0);
    vec2 b = viewToRoomNdc(vb) * vec2(aspect, 1.0);
    float d = distToSegment2(q, a, b);
    float sig = sigma * CAM_DIST / (0.5 * (va.z + vb.z));
    glow += s * exp(-(d * d) / (sig * sig));
  }
  col += boltTint * glow * 0.25 * mix(0.5, 2.0, uStrike);

  // Whole-frame flash on a drop.
  col += boltTint * 0.12 * uDropPulse * uDropStorm;

  outColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------

export const stormScene: Scene = (() => {
  let bgProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let pointProg: GLProgram | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  let posBuf: WebGLBuffer | null = null;
  let seedBuf: WebGLBuffer | null = null;
  let count = 0;
  let pool: ReturnType<typeof createStrikePool> | null = null;
  // Last-drawn pulse levels and clock, for the rise detection and render-dt
  // measurement the file header explains.
  let prevBeatPulse = 0;
  let prevLowPulse = 0;
  let prevDropPulse = 0;
  let lastTimeSec: number | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  // The CPU-side cloud is reused across mounts of the same count — init runs
  // on every gallery<->viz transition, so sampling 120k particles each time
  // would be a visible hitch.
  let cached: { count: number; cloud: ReturnType<typeof buildCloud> } | null = null;
  function cloudFor(n: number) {
    if (!cached || cached.count !== n) cached = { count: n, cloud: buildCloud(n) };
    return cached.cloud;
  }

  function uploadStrikes(prog: GLProgram, p: ReturnType<typeof createStrikePool>) {
    prog.setV3v("uStrikeA", p.posA);
    prog.setV3v("uStrikeB", p.posB);
    prog.setFv("uStrikeStrength", p.strength);
  }

  return {
    id: ID,
    name: "Storm",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg = createProgram(gl, BG_FRAG);
      quadVao = createFullscreenQuad(gl);
      pointProg = createProgram(gl, POINT_FRAG, POINT_VERT);

      count = particleCountForQuality(ctx.quality.maxParticles);
      const cloud = cloudFor(count);

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
      gl.bindVertexArray(null);

      pool = createStrikePool(cloud.lobes);
      prevBeatPulse = 0;
      prevLowPulse = 0;
      prevDropPulse = 0;
      lastTimeSec = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!bgProg || !quadVao || !pointProg || !pointVao || !pool) return;
      const { gl } = ctx;

      // resolveSceneSetting (not getSceneSetting) — the raw manual value
      // would silently re-stomp an auto-tuned slider back to manual every
      // frame (see autoTune.ts and the same note in meshGrid.ts).
      const afterglow = resolveSceneSetting(ID, settingFor("afterglow"));
      const flicker = resolveSceneSetting(ID, settingFor("flicker"));
      const density = resolveSceneSetting(ID, settingFor("density"));
      const dropStorm = resolveSceneSetting(ID, settingFor("dropStorm"));

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
        for (let i = 0; i < STRIKE_DROP_BURST; i++) pool.trigger(0.8 + 0.6 * dropStorm, true);
      } else if (lowRose || beatRose) {
        pool.trigger(0.7 + 0.5 * (lowRose ? anim.lowPulse : 0));
      }

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      bgProg.use();
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      uploadStrikes(bgProg, pool);
      drawFullscreenQuad(gl, quadVao);

      pointProg.use();
      uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      uploadStrikes(pointProg, pool);
      pointProg.setF("uCountBoost", Math.min(3, Math.max(1, Math.sqrt(MAX_PARTICLES / count))));

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, Math.floor(count * Math.max(0.05, density)));
      gl.bindVertexArray(null);

      // The gallery renders every scene into one shared context each tick —
      // must not leak the additive blend onto the next tile.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg?.dispose();
      pointProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      if (posBuf) gl.deleteBuffer(posBuf);
      if (seedBuf) gl.deleteBuffer(seedBuf);
      bgProg = null;
      pointProg = null;
      quadVao = null;
      pointVao = null;
      posBuf = null;
      seedBuf = null;
      pool = null;
      count = 0;
      prevBeatPulse = 0;
      prevLowPulse = 0;
      prevDropPulse = 0;
      lastTimeSec = null;
    },
  };
})();
