/**
 * Nebula's stars: `STAR_COUNT` points scattered through one volume repeat
 * (flight.ts's PERIOD), drawn as GL points over the scaled-up gas, so the
 * cost is a few thousand vertices rather than a per-pixel search. Drawing
 * them per pixel measured 8.5 ms a frame at Retina size; points keep them
 * sharp at any resolution too.
 *
 * Each star is wrapped to the repeat nearest the camera: ahead of it in z
 * (stars behind are never seen), and around it in x and y, drawn once per
 * neighbouring repeat (`TILES`) so the far edges of the view, wider than
 * one repeat, still have stars. A star reads the gas target's alpha, the
 * depth where the gas turns opaque (glsl.ts's header), under its own screen
 * position and fades out if it lies behind that depth. Screen blending over
 * the gas matches the tone map's (1 - a)·e^-b closely enough for points.
 */

import { PERIOD } from "./flight.ts";

export const STAR_COUNT = 6000;
/** Neighbouring repeats drawn in x and y, per side: (2·TILES + 1)² instances. */
const TILES = 1;
export const STAR_INSTANCES = (2 * TILES + 1) * (2 * TILES + 1);
/** A star's gaussian radius as a share of the screen's height, written in pixels at the reference's 720p. */
const STAR_SIZE = 1.4 / 720;
/** Stars fade in from this distance and out toward the march's reach. */
const NEAR = 0.4;
const FAR = 8.0;

const f = (x: number, d = 4) => x.toFixed(d);

/** Star positions in [0, PERIOD)³ and a brightness draw in [0, 1), four floats each. Deterministic. */
export function buildStars(count = STAR_COUNT, seed = 0x9e3779b9): Float32Array {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i += 4) {
    out[i] = rand() * PERIOD;
    out[i + 1] = rand() * PERIOD;
    out[i + 2] = rand() * PERIOD;
    out[i + 3] = rand();
  }
  return out;
}

/** The vertex shader needs FOV_TAN and T_MAX from glsl.ts, which index.ts passes in. */
export function starVert(fovTan: number, tMax: number): string {
  return `#version 300 es
precision highp float;
layout(location = 0) in vec4 aStar;
uniform vec4 uCam[4];
uniform vec2 uResolution;
uniform vec4 uViewport;
uniform sampler2D uGasTex;
uniform float uStars;
out vec3 vColor;

void main() {
  int side = ${2 * TILES + 1};
  vec2 tile = vec2(float(gl_InstanceID % side - ${TILES}), float(gl_InstanceID / side - ${TILES}));
  vec3 rel = aStar.xyz - uCam[0].xyz;
  rel.z = mod(rel.z, ${f(PERIOD)});
  rel.xy = mod(rel.xy + ${f(PERIOD / 2)}, ${f(PERIOD)}) - ${f(PERIOD / 2)} + tile * ${f(PERIOD)};
  float z = dot(rel, uCam[3].xyz);
  float dist = length(rel);
  // The brightness draw doubles as the cut for the Stars setting: raising it shows the stars whose
  // draw falls under it, so the field fills in rather than every star brightening at once.
  float shown = step(aStar.w, 0.5 * uStars);
  if (z < 0.05 || shown == 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vColor = vec3(0.0);
    return;
  }
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(dot(rel, uCam[1].xyz), dot(rel, uCam[2].xyz)) / (z * ${f(2 * fovTan)});
  vec2 room = vec2(p.x / aspect, p.y) + 0.5;
  vec2 uv = (room - uViewport.xy) / uViewport.zw;
  float tOcc = textureLod(uGasTex, uv, 0.0).a * ${f(tMax)};
  float lum = aStar.w / max(0.5 * uStars, 1e-3);
  float fade = smoothstep(${f(NEAR)}, ${f(NEAR + 1.0)}, dist) * smoothstep(${f(FAR)}, ${f(FAR * 0.5)}, dist)
    * smoothstep(tOcc + 0.4, tOcc - 0.4, dist);
  vColor = mix(vec3(0.70, 0.85, 1.00), vec3(1.0), lum) * fade * (1.0 + 3.0 * (1.0 - lum) * (1.0 - lum));
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  // Three gaussian radii either side, in device pixels: the room is uViewport.w of this canvas tall.
  gl_PointSize = max(2.0, 6.0 * ${f(STAR_SIZE, 6)} * uResolution.y / uViewport.w);
}
`;
}

export const STAR_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * 6.0;
  outColor = vec4(vColor * exp(-dot(d, d)), 1.0);
}
`;
