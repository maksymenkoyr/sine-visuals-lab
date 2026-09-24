# Particles (`particles`)

A jittered cell-noise field of soft glowing dots: a 3x3-cell neighborhood
sampled per pixel, each cell's dot driven by its own band of the spectrum
and drifting on a small flow field. Small, original scene; a draft (in
`DRAFT_SCENE_IDS`), on `main` since the initial commit.

## Where the code is

- `src/render/scenes/particles.ts` — the whole scene is one fragment shader
  body (`FRAG`) passed to `createFullscreenScene()`
  (`src/render/fullscreenScene.ts`). No `settings`, no `extraUniforms`, no
  per-scene helper module.
- Shader-local helpers: `hash21`/`hash22` (per-cell jitter) and `flow()` (a
  small sine-based drift field applied to each cell's dot center).
- Uses the shared GLSL from `src/render/sceneCommon.ts`: `roomUv()`,
  `sampleBands()`, plus the common uniform set (`uDetail`, `uEnergy`,
  `uBeatPulse`, `uTime`, `uResolution`) and `palette()` from
  `src/render/palette.ts`.
- `uDetail` scales cell density (`cellsScale`) — the low-quality path is
  simply a coarser cell grid, not a separate code path.
- No dedicated test file.

## References

None — original design.

## Decisions and pivots

- 2026-08-27 (`5fe4b3c`, initial commit) — scene added.
- 2026-08-29 (`4b8d342`, #31) — mechanical rename only: `uQuality` →
  `uDetail` as part of the repo-wide quality/tier renaming; no visual
  change.

## Tuning notes

No `SceneSetting`s — every knob is a shader literal: cell density range
(`cellsScale`, driven by `uDetail`), dot radius base/gain (`r = 0.05 + band
* 0.16 + bass * ...`), the glow falloff exponent, and the palette drift
rate (`t = rnd.x + uTime * 0.04 + ...`). Judge the look by whether each
cell's dot reads as a distinct glowing point rather than blurring into its
neighbors at high band energy, and whether `uBeatPulse` gives the bass-band
dots a visible kick without flooding the frame white. `uDetail` is the only
quality-tier lever — there's no separate branch to check at low tiers
beyond the coarser grid.

## Known issues and next steps

None recorded — no open PR or issue references this scene
beyond its creation.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/particles` (query
  before the hash).
- No settings and no test file — tuning means editing the shader literals
  directly and reloading.

## History

- `5fe4b3c` (2026-08-27) — initial commit adds the scene.
- `4b8d342` (2026-08-29, #31) — `uQuality` → `uDetail` rename (repo-wide,
  no scene-specific change).
