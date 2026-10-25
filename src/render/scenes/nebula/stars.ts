/**
 * Nebula's stars: `STAR_COUNT` points in one volume repeat (flight.ts's PERIOD), drawn as GL points
 * over the scaled-up gas, so the cost is one vertex per star rather than a per-pixel search. Drawing
 * them per pixel measured 8.5 ms a frame at Retina size; points keep them sharp at any resolution too.
 *
 * The sky, in plain words:
 * - Positions come from three populations: a uniform field of faint dust, Plummer-profile clusters
 *   whose sizes follow the observed cluster mass function, and a thin exponential disk band.
 * - Brightness is a power law of one draw, so most stars are faint and a few are bright; a star's
 *   apparent brightness falls with the square of its distance, and the nearest ones are capped.
 * - Temperature picks a pale blackbody tint, hot to cool.
 * - The core clips at a set brightness, and the light above that becomes a soft halo and four faint
 *   spikes, so a bright star reads as a bigger star rather than a white blob.
 * - Gas between the camera and a star dims and reddens it gradually, blue first, rather than cutting
 *   it off at one depth. The gas's optical depth climbs over EXT_RAMP to the depth where the gas turns
 *   opaque (glsl.ts's header), read from the gas target's alpha.
 *
 * Each star is wrapped to the repeat nearest the camera: ahead of it in z (stars behind are never
 * seen), and around it in x and y, drawn once per neighbouring repeat (`TILES`) so the far edges of the
 * view, wider than one repeat, still have stars. Screen blending over the gas matches the tone map's
 * (1 - a)·e^-b closely enough for points.
 */

import { PERIOD } from "./flight.ts";

/** Stars per repeat. Most are faint dust, so the count is high and only a small share read as bright. */
export const STAR_COUNT = 18000;
/** Floats per star in the buffer: position, brightness draw, temperature draw, cut draw, then padding. */
export const STAR_STRIDE = 8;
/** Neighbouring repeats drawn in x and y, per side: (2·TILES + 1)² instances. */
const TILES = 1;
export const STAR_INSTANCES = (2 * TILES + 1) * (2 * TILES + 1);
/** A star's core radius as a share of the screen's height, written in pixels at the reference's 720p. */
const STAR_SIZE = 1.4 / 720;
/** Stars fade in from this distance and out toward the march's reach. */
const NEAR = 0.4;
const FAR = 8.0;

/** Share of stars spread evenly through the repeat: the faint dust between the clusters. */
const FIELD_SHARE = 0.45;
/** Share of stars that belong to a cluster. The rest lie in the disk band. */
const CLUSTER_SHARE = 0.3;
/** Clusters per repeat. */
const CLUSTERS = 24;
/** Plummer radius range, drawn log-uniform so small tight clusters and large loose ones both occur. */
const CLUSTER_A_MIN = 0.15;
const CLUSTER_A_MAX = 0.8;
/** Cluster masses follow dN/dM ∝ M^-2, the observed cluster mass function, cut off at this mass. */
const CLUSTER_MASS_SPAN = 30;
/** The Plummer profile's far tail is redrawn beyond this many radii, so one cluster's tail cannot scatter stars across the repeat. */
const PLUMMER_CUT = 5;
/** The disk band's centre, halfway up the repeat. */
const DISK_Y = PERIOD * 0.5;
/** Scale height of the disk's exponential vertical profile, like a galactic disk's. */
const DISK_H = 0.8;

/** The faintest star's brightness at D_REF: the power law's floor, so the field is mostly dim. */
const LMIN = 0.12;
/** Brightness ceiling, so the nearest bright star cannot blow out the frame. */
const L_CAP = 40;
/** Distance at which a star shows its drawn brightness; nearer stars brighten as 1/d². */
const D_REF = 4.0;
/** Floor on d² for that brightening, so a star passing the camera stays bounded. */
const NEAR_D2 = 1.0;
/** World units over which the gas's optical depth climbs to the opaque depth's. */
const EXT_RAMP = 1.0;
/** Per-channel extinction relative to green: gas takes blue first, so distant stars redden. */
const REDDEN = [0.65, 1.0, 1.53] as const;
/** Strength of the halo and spikes: the owner's pick from the live side-by-side. */
const BLOOM = 0.6;
/**
 * Cores are drawn on a stretched curve, as astrophotos are: on the linear one most of the field
 * fell below visibility at 720p and the voids read empty. Halo and spikes keep the linear brightness.
 */
const CORE_GAMMA = 0.5;
/** Gain on the stretched core, so the faintest drawn stars sit just above the void's floor. */
const CORE_GAIN = 1.5;

const f = (x: number, d = 4) => x.toFixed(d);

/**
 * Star data for one repeat: a position in [0, PERIOD)³ and three draws in [0, 1) (brightness,
 * temperature, cut), `STAR_STRIDE` floats a star. Deterministic.
 */
export function buildStars(count = STAR_COUNT, seed = 0x9e3779b9): Float32Array {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const wrap = (v: number) => ((v % PERIOD) + PERIOD) % PERIOD;

  const clusters: { x: number; y: number; z: number; a: number }[] = [];
  const massCum: number[] = [];
  let massSum = 0;
  for (let c = 0; c < CLUSTERS; c++) {
    const x = rand() * PERIOD;
    const y = rand() * PERIOD;
    const z = rand() * PERIOD;
    const a = CLUSTER_A_MIN * (CLUSTER_A_MAX / CLUSTER_A_MIN) ** rand();
    const mass = 1 / (1 - rand() * (1 - 1 / CLUSTER_MASS_SPAN));
    massSum += mass;
    massCum.push(massSum);
    clusters.push({ x, y, z, a });
  }

  // Inverse CDF of the Plummer profile: the radius that encloses a uniform share of the mass.
  const plummerOffset = (a: number): [number, number, number] => {
    let r: number;
    do {
      r = a / Math.sqrt(rand() ** (-2 / 3) - 1);
    } while (!Number.isFinite(r) || r > PLUMMER_CUT * a);
    const cz = 2 * rand() - 1;
    const phi = 2 * Math.PI * rand();
    const sn = Math.sqrt(1 - cz * cz);
    return [r * sn * Math.cos(phi), r * sn * Math.sin(phi), r * cz];
  };

  const out = new Float32Array(count * STAR_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    const u = rand();
    let x: number;
    let y: number;
    let z: number;
    if (u < FIELD_SHARE) {
      x = rand() * PERIOD;
      y = rand() * PERIOD;
      z = rand() * PERIOD;
    } else if (u < FIELD_SHARE + CLUSTER_SHARE) {
      const pick = rand() * massSum;
      let k = 0;
      while (k < CLUSTERS - 1 && massCum[k] < pick) k++;
      const c = clusters[k];
      const [dx, dy, dz] = plummerOffset(c.a);
      x = c.x + dx;
      y = c.y + dy;
      z = c.z + dz;
    } else {
      const sign = rand() < 0.5 ? -1 : 1;
      x = rand() * PERIOD;
      z = rand() * PERIOD;
      y = DISK_Y + sign * -DISK_H * Math.log(1 - rand());
    }
    out[o] = wrap(x);
    out[o + 1] = wrap(y);
    out[o + 2] = wrap(z);
    out[o + 3] = rand();
    out[o + 4] = rand();
    out[o + 5] = rand();
  }
  return out;
}

/**
 * Pale blackbody tints, hot to cool. The stops weight the visible mix toward yellow-white and orange.
 */
const BLACKBODY_GLSL = `vec3 blackbody(float x) {
  const vec3 C[7] = vec3[7](vec3(0.62, 0.71, 1.0), vec3(0.72, 0.80, 1.0), vec3(0.86, 0.89, 1.0),
    vec3(1.0, 0.97, 0.93), vec3(1.0, 0.91, 0.80), vec3(1.0, 0.80, 0.60), vec3(1.0, 0.66, 0.42));
  float k = x < 0.1 ? x / 0.1 : x < 0.3 ? 1.0 + (x - 0.1) / 0.2 : x < 0.45 ? 2.0 + (x - 0.3) / 0.15
    : x < 0.65 ? 3.0 + (x - 0.45) / 0.2 : x < 0.9 ? 4.0 + (x - 0.65) / 0.25 : 5.0 + (x - 0.9) / 0.1;
  k = min(k, 5.999);
  int i = int(floor(k));
  return mix(C[i], C[i + 1], fract(k));
}`;

/** The vertex shader needs FOV_TAN and T_MAX from glsl.ts, which index.ts passes in, and OCCLUDE for the gas's opaque depth. */
export function starVert(fovTan: number, tMax: number, occlude: number): string {
  return `#version 300 es
precision highp float;
layout(location = 0) in vec4 aStar;
layout(location = 1) in vec4 aLook;
uniform vec4 uCam[4];
uniform vec2 uResolution;
uniform vec4 uViewport;
uniform sampler2D uGasTex;
uniform float uStars;
uniform float uMaxPt;
out vec3 vColor;
out float vCore, vR, vHalo, vSpike, vSpikeL, vSize;

${BLACKBODY_GLSL}

void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 1.0;
  vColor = vec3(0.0);
  vCore = 0.0;
  vSize = 1.0;
}

void main() {
  int side = ${2 * TILES + 1};
  vec2 tile = vec2(float(gl_InstanceID % side - ${TILES}), float(gl_InstanceID / side - ${TILES}));
  vec3 rel = aStar.xyz - uCam[0].xyz;
  rel.z = mod(rel.z, ${f(PERIOD)});
  rel.xy = mod(rel.xy + ${f(PERIOD / 2)}, ${f(PERIOD)}) - ${f(PERIOD / 2)} + tile * ${f(PERIOD)};
  float z = dot(rel, uCam[3].xyz);
  float dist = length(rel);
  // The cut draw is independent of brightness, so raising Stars fills the field in at every brightness
  // rather than adding the bright stars last.
  float shown = step(aLook.y, 0.5 * uStars);
  if (z < 0.05 || shown == 0.0) {
    cull();
    return;
  }
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(dot(rel, uCam[1].xyz), dot(rel, uCam[2].xyz)) / (z * ${f(2 * fovTan)});
  vec2 room = vec2(p.x / aspect, p.y) + 0.5;
  vec2 uv = (room - uViewport.xy) / uViewport.zw;
  float tOcc = textureLod(uGasTex, uv, 0.0).a * ${f(tMax)};
  float b = min(${f(LMIN)} * pow(max(1.0 - aStar.w, 1e-4), -2.0 / 3.0), ${f(L_CAP)})
    * ${f(D_REF * D_REF)} / max(dist * dist, ${f(NEAR_D2)});
  float fade = smoothstep(${f(NEAR)}, ${f(NEAR + 1.0)}, dist) * smoothstep(${f(FAR)}, ${f(FAR * 0.5)}, dist);
  float tau = ${f(-Math.log(occlude))} * max(dist - tOcc + ${f(EXT_RAMP)}, 0.0) / ${f(EXT_RAMP)};
  vec3 ext = exp(-tau * vec3(${f(REDDEN[0])}, ${f(REDDEN[1])}, ${f(REDDEN[2])}));
  float core = ${f(CORE_GAIN)} * pow(b, ${f(CORE_GAMMA)});
  if (core * fade * ext.r < 0.004) {
    cull();
    return;
  }
  vec3 col = mix(vec3(1.0), blackbody(aLook.x), 0.3 + 0.7 * smoothstep(0.05, 0.8, b)) * ext;
  float bb = b * fade;
  float r0 = ${f(STAR_SIZE, 6)} * uResolution.y / uViewport.w;
  float r = r0 * (0.8 + 0.35 * sqrt(min(bb, 6.0)));
  vCore = min(core, 1.2);
  vHalo = ${f(BLOOM)} * 0.05 * max(b - 0.3, 0.0);
  vSpike = ${f(BLOOM)} * 0.18 * smoothstep(0.8, 4.0, bb) * min(b, 4.0);
  vSpikeL = r0 * 4.0 * sqrt(min(b, 9.0));
  float hx = vHalo * fade > 0.004 ? 4.0 * r * log(vHalo * fade / 0.004) : 0.0;
  float sx = vSpike * fade > 0.004 ? vSpikeL * log(vSpike * fade / 0.004) : 0.0;
  vR = r;
  vSize = max(2.0, min(uMaxPt, 2.0 * max(3.0 * r, max(hx, sx))));
  vColor = col * fade;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = vSize;
}
`;
}

export const STAR_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vCore, vR, vHalo, vSpike, vSpikeL, vSize;
out vec4 outColor;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(d, d);
  float v = vCore * exp(-r2 / (vR * vR)) + vHalo * exp(-sqrt(r2) / (4.0 * vR));
  if (vSpike > 0.0) {
    float t = 0.5 * vR * vR;
    v += vSpike * (exp(-d.y * d.y / t) * exp(-abs(d.x) / vSpikeL) + exp(-d.x * d.x / t) * exp(-abs(d.y) / vSpikeL));
  }
  vec2 e = abs(d) / (0.5 * vSize);
  v *= 1.0 - smoothstep(0.75, 1.0, max(e.x, e.y));
  outColor = vec4(vColor * v, 1.0);
}
`;
