/**
 * Ember's display pass: turns the fluid sim's red dye (fluidSim.ts, run full
 * screen) into fire. The dye is read three ways, all from the one texture:
 * once sharp, once through a near ring of taps (the soft body and its
 * gradient, which lights the rims where a lobe meets the dark) and once
 * through a far ring (the glow that bleeds out around the fire). The rings'
 * taps are what the reference's softness comes from: a separate blur
 * target would cost a full extra pass for the same picture.
 *
 * Only the display is here; the sim's own passes, units and codecs are
 * fluidSim.ts's, read through its `simIoGlsl` decode functions.
 */

import { simIoGlsl, type SimFormat } from "../fluidSim.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL } from "../../sceneCommon.ts";

/** Taps per blur ring. */
const RING_TAPS = 8;

export function buildDisplayFrag(format: SimFormat, settingsGlsl: string, driveGlsl: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsGlsl}
${driveGlsl}
${ROOM_UV_GLSL}
${simIoGlsl(format)}
uniform sampler2D uDye;
uniform float uHeatAmt; // Heat after its drive, from index.ts

const int RING_TAPS = ${RING_TAPS};
const float TAU = 6.2831853;
// Ring radii in screen heights: the near ring softens the body to the
// reference's blur, the far one is the halo.
const float NEAR_R = 0.016;
const float FAR_R = 0.045;
// Dye density to brightness; the sim caps density at DYE_MAX.
const float BODY_GAIN = 0.75;
const float RIM_GAIN = 0.35;
const float HALO_GAIN = 0.6;

float dens(vec2 uv) { return max(decodeDye(texture(uDye, uv)).x, 0.0); }

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 toUv = vec2(1.0 / aspect, 1.0);

  float d0 = dens(uv);
  float nearSum = 0.0;
  float farSum = 0.0;
  vec2 grad = vec2(0.0);
  for (int k = 0; k < RING_TAPS; k++) {
    float a = TAU * float(k) / float(RING_TAPS);
    vec2 dir = vec2(cos(a), sin(a));
    float n = dens(uv + dir * NEAR_R * toUv);
    nearSum += n;
    grad += dir * n;
    // The far ring is turned half a tap so the two rings don't line up.
    float b = a + TAU * 0.5 / float(RING_TAPS);
    farSum += dens(uv + vec2(cos(b), sin(b)) * FAR_R * toUv);
  }
  float soft = mix(d0, nearSum / float(RING_TAPS), 0.55);
  float halo = farSum / float(RING_TAPS);
  // Density change across the near ring: large where a lobe's edge meets the dark.
  float edge = length(grad) * (2.0 / float(RING_TAPS));

  // Hotter low in the fire and where the dye is thickest, as in the
  // reference, whose brightest red sits near the base.
  float heatUp = mix(1.3, 0.75, clamp(uv.y, 0.0, 1.0));
  float body = 1.0 - exp(-soft * BODY_GAIN * uHeatAmt * heatUp);
  body += 0.35 * smoothstep(1.4, 3.0, soft) * uHeatAmt;
  float rim = smoothstep(0.05, 0.6, edge) * smoothstep(0.02, 0.25, soft);
  // The halo is a dim smoke around the fire: on the body's own curve, and
  // only where the body itself is dimmer, so it never brightens the fire.
  float smoke = (1.0 - exp(-halo * BODY_GAIN * uHeatAmt)) * HALO_GAIN * uGlow;
  float lum = max(body, smoke) + rim * RIM_GAIN * uRidge;

  float L = 1.0 - exp(-1.6 * lum);
  vec3 own = max(vec3(1.0, 0.03, 0.012) * L, vec3(0.027, 0.0, 0.0));
  vec3 room = mix(uPalGround, palRamp(L), clamp(L * 4.0, 0.0, 1.0));
  outColor = vec4(mix(own, room, uRoomColor), 1.0);
}
`;
}
