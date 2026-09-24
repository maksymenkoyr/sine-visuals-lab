# Spectrum (`spectrum`)

A mirrored bar-graph ribbon: band levels bounce off a horizontal center
line into a symmetric shape, with a glow trail and a faint background
grid. One of the launch scenes; a draft on main (in `DRAFT_SCENE_IDS`), not iterated since.

## Where the code is

- `src/render/scenes/spectrum.ts` — the entire scene is a single fragment
  shader body passed to `createFullscreenScene` (`src/render/fullscreenScene.ts`),
  the shared helper that wires up the common uniforms, palette, and
  `roomUv`/`sampleBands` GLSL for any scene that's just a fullscreen shader
  with no extra JS-side state.
- No scene-specific settings (`SETTINGS`/`SceneSetting[]`) and no
  `extraUniforms` — the whole look is driven by the common uniform set
  (`uBands`/`sampleBands`, `uTime`, `uBeatPhase`, `uBeatPulse`,
  `uPalA..D`/`palette()`, `uResolution`) documented in `sceneCommon.ts`.
- No dedicated test file; only exercised through the generic scene-registry
  tests (`tests/sceneSettings.test.ts`, `tests/sceneLinks.test.ts`, etc.)
  since it declares no settings of its own.

## References

None — original design.

## Decisions and pivots

- 2026-08-27 (`5fe4b3c`) — shipped in the initial commit as one of the
  launch scenes.
- 2026-08-29 (`#31`, `4b8d342`) — mechanical only: the quality proxy was
  renamed `uQuality` → `uDetail` project-wide; not scene-specific to
  Spectrum (this scene doesn't reference it directly).

## Tuning notes

- No settings panel of its own — there is nothing scene-specific to tune;
  behavior follows the common uniforms (palette, beat pulse/phase, band
  levels) that every scene shares.
- The bar height is `sampleBands(mx)` where `mx` is the mirrored, aspect-
  independent horizontal coordinate; the glow term is a simple exponential
  falloff from the bar edge, and the background grid lines are drawn from
  `fract(uv.x * …)` — cheap, no quality gating (`minQuality` unset).

## Known issues and next steps

- Never had a dedicated tuning or reference pass; if it's promoted out of
  "simple launch scene" status, it has no `auto`-tuned settings to draw on
  and no measured reference to compare against.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/spectrum`.
- No `/ref` bundle exists for this scene and no scene-specific settings to
  probe — start from the header/FRAG in `spectrum.ts` directly.

## History

- `5fe4b3c` — shipped in the initial commit.
- `#31` / `4b8d342` — project-wide `uQuality` → `uDetail` rename (no
  behavior change here).
