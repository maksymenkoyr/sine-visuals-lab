/**
 * Portal's picture, as one fragment body (createFullscreenScene's `fragBody`).
 * Layer by layer, back to front:
 *
 * - The room is near black. The only steady light is the ring at the end of
 *   the tunnel, a thin hot line around a dark centre.
 * - The flood: a red light thrown down the tunnel, a halo around the ring
 *   and rays that fan out from it. It is `uFloodLvl` (the flood look) plus
 *   part of the blast, and it is the light the shards are seen against.
 * - The tunnel shards: the view is cut into a log-polar grid in depth and angle, and
 *   some cells hold a rotated box. Depth moves with the camera (`uTunnelZ`),
 *   so the shards fly past. Shards sit in front of the flood, darken it, and
 *   have a lit edge in the flood's colour, the rest colour, or (accent shards
 *   only) the green accent colour with a streak that runs along them.
 * - The accent spark: one green point on the ring, placed by the accent
 *   look's seed.
 * - Blast debris: a fixed number of dark chips flung out from the ring with
 *   an orange edge, fading over the blast's life. Skipped when no blast is
 *   lit.
 * - The portal's inside is dimmed, so the ring reads as an edge.
 * - The ring: a thin core and a soft glow, orange in a flood, shifting to
 *   hot white-yellow under a blast.
 * - Then tone mapping and a light vignette.
 *
 * Every TS number that reaches the shader goes through `.toFixed(3)` here, and
 * the integer loop bound through `${DEBRIS}`, so GLSL never sees an int where
 * it wants a float. The depth cell and the shake and seed inputs are reduced
 * modulo a fixed period before any sin() sees them, so the shader's trig keeps
 * its precision however long a session runs (see the comments at those lines).
 */

/** The ring's radius in the room's aspect-corrected units. */
const RING_R = 0.17;
/** How many angle cells the tunnel is cut into around the ring. */
const ANG_CELLS = 22.0;
/** How many depth cells the camera passes per unit of flight. */
const FLIGHT_CELLS = 6.0;
/** The share of cells that hold a shard. */
const SHARD_SHARE = 0.55;
/** Debris chips per blast. */
const DEBRIS = 24;
/** The depth-cell hash repeats every this many cells; the period is far past what a viewer sees. */
const DEPTH_WRAP = 4096.0;
/** The blast shake's hash repeats every this many shake ticks. */
const SHAKE_WRAP = 4096.0;

export const FRAG = `
vec2 hash2(float n) {
  return fract(sin(vec2(n, n + 1.0)) * vec2(43758.5453, 22578.1459));
}
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  vec2 p = roomUv(vUv) - 0.5;
  p.x *= uResolution.x / uResolution.y;

  // Centre: a slow sway, plus a small shake while a blast is lit.
  vec2 c = vec2(0.0, 0.05)
    + 0.025 * vec2(sin(uTime * 0.31), cos(uTime * 0.23))
    + uBlastLvl * 0.012 * (hash2(mod(floor(uTime * 30.0), ${SHAKE_WRAP.toFixed(3)})) - 0.5);
  vec2 q = p - c;
  float r = length(q);
  float a = atan(q.y, q.x);

  // Tunnel shards: a grid in depth and angle, one optional box per cell.
  // Log-polar, so a cell is as deep as it is wide at every radius: shards keep
  // their shape and grow toward the edge, the way a tunnel's walls do.
  float v = a / 6.28318 * ${ANG_CELLS.toFixed(3)};
  float depth = -log(max(r, 0.02)) * ${ANG_CELLS.toFixed(3)} / 6.28318;
  vec2 g = vec2(v, depth + uTunnelZ * ${FLIGHT_CELLS.toFixed(3)});
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(vec2(cell.x, mod(cell.y, ${DEPTH_WRAP.toFixed(3)})));
  float exists = step(${(1 - SHARD_SHARE).toFixed(3)}, h);
  float h2 = fract(h * 31.7);
  float isAccent = step(h2, 0.4);
  float sang = h * 6.28;
  float ca = cos(sang);
  float sa = sin(sang);
  vec2 fr = vec2(ca * f.x + sa * f.y, -sa * f.x + ca * f.y);
  vec2 hs = vec2(0.2 + 0.2 * fract(h * 7.1), 0.08 + 0.12 * fract(h * 13.3));
  float sd = sdBox(fr, hs);
  float body = (1.0 - smoothstep(-0.02, 0.02, sd)) * exists;
  float edge = exp(-abs(sd) * 40.0) * exists;
  float vis = smoothstep(${RING_R.toFixed(3)} * 1.05, ${RING_R.toFixed(3)} * 1.8, r);

  // Flood light, behind the shards.
  vec3 col = vec3(0.012, 0.013, 0.016);
  float fl = uFloodLvl * uFlood + 0.6 * uBlastLvl * uBlast;
  float beyond = max(r - ${RING_R.toFixed(3)}, 0.0);
  float halo = exp(-beyond * 2.4);
  float ray = pow(0.5 + 0.5 * sin(a * 37.0 + 3.0 * sin(a * 11.0 + uTime * 0.2)), 6.0)
    * exp(-beyond * 1.3)
    * smoothstep(${RING_R.toFixed(3)}, ${RING_R.toFixed(3)} * 1.3, r);
  col += vec3(1.0, 0.13, 0.04) * fl * (0.7 * halo + 0.9 * ray + 0.15);

  // Shards: darken the flood, then light their edges.
  col *= 1.0 - body * vis * 0.88;
  col += vec3(0.35, 0.42, 0.48) * uRest * edge * vis * 0.6;
  col += vec3(1.0, 0.3 + 0.35 * uBlastLvl * uBlast, 0.12) * fl * edge * vis * 1.2;
  float streak = smoothstep(0.6, 1.0, fract(f.x * 1.0 + uAccentAge * 5.0 + h * 3.0));
  col += vec3(0.2, 1.0, 0.6) * uAccentLvl * uAccent * (edge * 0.9 + streak * body * 0.5) * vis * isAccent;

  // Accent spark: one green point on the ring.
  float sp = uAccentSeed * 2.4;
  col += vec3(0.4, 1.0, 0.7) * uAccentLvl * uAccent
    * exp(-length(q - ${RING_R.toFixed(3)} * vec2(cos(sp), sin(sp))) * 30.0);

  // Blast debris: dark chips with an orange edge, flung out from the ring.
  if (uBlastLvl * uBlast > 0.002) {
    float fade = max(0.0, 1.0 - uBlastAge / 0.7);
    for (int i = 0; i < ${DEBRIS}; i++) {
      vec2 seed = hash2(float(i) + uBlastSeed * 17.0);
      float dang = seed.x * 6.28318;
      vec2 dir = vec2(cos(dang), sin(dang));
      float speed = 0.5 + seed.y * 1.4;
      vec2 ctr = dir * (${RING_R.toFixed(3)} * 0.6 + uBlastAge * speed);
      float s = (0.01 + 0.025 * fract(seed.x * 9.0)) * (1.0 + uBlastAge * 3.0);
      float rot = seed.y * 6.0 + uBlastAge * (seed.x - 0.5) * 6.0;
      vec2 dq = q - ctr;
      dq = vec2(cos(rot) * dq.x + sin(rot) * dq.y, -sin(rot) * dq.x + cos(rot) * dq.y);
      float db = sdBox(dq, vec2(s));
      float dbody = 1.0 - smoothstep(-0.02, 0.02, db);
      float dedge = exp(-abs(db) * 40.0);
      col *= 1.0 - dbody * 0.9 * fade;
      col += vec3(1.0, 0.55, 0.15) * dedge * fade;
    }
  }

  // Inside the portal is dim, so the ring reads as the edge of it.
  col *= mix(0.12, 1.0, smoothstep(${RING_R.toFixed(3)} * 0.97, ${RING_R.toFixed(3)} * 1.01, r));

  // The ring.
  float d = abs(r - ${RING_R.toFixed(3)});
  float bl = uBlastLvl * uBlast;
  float w = 0.0035 + 0.006 * bl;
  float core = exp(-d * d / (w * w));
  float glow = exp(-d / (0.012 + 0.03 * bl)) * 0.55;
  vec3 ringCol = mix(vec3(1.0, 0.29, 0.11), vec3(1.0, 0.78, 0.4), clamp(bl, 0.0, 1.0));
  col += ringCol * (core + glow) * uRingGlow * (0.8 + 0.4 * fl + 1.0 * bl);

  col = 1.0 - exp(-col * 1.3);
  col *= 1.0 - 0.35 * dot(p, p);
  outColor = vec4(col, 1.0);
}
`;
