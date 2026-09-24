# Tunnel (`tunnel`)

A raymarched cylindrical tunnel: the radius of the tube wobbles per-angle
with the spectrum, the camera flies forward at a speed tied to `uBpm`, and
hits are colored by palette + a glow accumulated along the march. Small,
original scene; a draft (in `DRAFT_SCENE_IDS`), on `main` since the initial
commit. Gated to `minQuality: "low"` — it's a raymarch, so it needs at
least the low-quality step budget to look right.

## Where the code is

- `src/render/scenes/tunnel.ts` — one fragment shader body (`FRAG`) passed
  to `createFullscreenScene()` with `{ minQuality: "low" }`. No `settings`,
  no `extraUniforms`, no per-scene helper module.
- The march loop is capped at `MAX_STEPS` (a `const int` in the shader) but
  actually steps `min(MAX_STEPS, uMaxSteps)`, so the real per-frame budget
  is `uMaxSteps` (quality.raymarchSteps, from the common uniform set in
  `sceneCommon.ts`).
- Tube radius comes from `sampleBands()` keyed by the ray's angle around the
  tunnel axis (`atan(p.y, p.x)`), plus a `sin` wobble phase-locked to
  `uBeatPhase`. Forward speed is `1.2 + uBpm * 0.004`.
- Uses `palette()` (`src/render/palette.ts`) for both the hit color and the
  glow accumulated along misses.
- No dedicated test file.

## References

None — original design.

## Decisions and pivots

- 2026-08-27 (`5fe4b3c`, initial commit) — scene added, already gated to
  `minTier: "low"` (later renamed).
- 2026-08-29 (`4b8d342`, #31) — mechanical rename only: `minTier` →
  `minQuality`; no visual change.

## Tuning notes

No `SceneSetting`s — every knob is a shader literal: the glow accumulation
gain (`0.015 / (dist + 0.015)`), the hit threshold (`dist < 0.015`), the
step-advance factor (`dist * 0.55`), and the far-plane cutoff (`t > 50.0`).
`uMaxSteps` (driven by the render quality tier) is the main lever a viewer
actually experiences — too few steps and the tube wall goes soft/undefined
before the march terminates. `uDetail` scales glow strength directly.
Camera speed rides `uBpm`, so it's one of the few scenes where tempo alone
(not just beat pulses) visibly changes the scene without any audio-band
input. Judge the look by whether the tube wall stays crisp (no visible
banding from too-few steps) at the default quality tier, and whether the
wobble reads as spectrum content rather than pure noise.

## Known issues and next steps

None recorded — no open PR or issue references this scene
beyond its creation. The `minQuality: "low"` gate is a known constraint,
not a bug: see ferrofluid.ts's header comment, which points to tunnel.ts as
the precedent for gating a raymarched scene out of floor-tier quality.

## Materials

- Nothing beyond the code: no `/ref` bundle, saved scripts or artifacts.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/tunnel` (query before
  the hash). Try `?bpm=` at both ends of a plausible range to check the
  camera-speed-to-bpm mapping.
- No settings and no test file — tuning means editing the shader literals
  directly and reloading. To see the raymarch step budget's effect,
  compare at different `?quality=` values.

## History

- `5fe4b3c` (2026-08-27) — initial commit adds the scene, gated to
  `minTier: "low"`.
- `4b8d342` (2026-08-29, #31) — `minTier` → `minQuality` rename (repo-wide,
  no scene-specific change).
