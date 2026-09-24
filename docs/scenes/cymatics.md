# Cymatics (`cymatics`)

Chladni-style standing-wave plate patterns: each audio band is treated as
one circular-plate mode (radial order from the band's position in the
ladder, angular order from its index mod 4) and summed into a scalar
wavefield, rendered as sand settling where the field is near zero plus a
hairline stroke on the zero-crossings. A direct rendering of the spectrum
as physical geometry, not a reactive effect layered on top. Small, original
scene; a draft (in `DRAFT_SCENE_IDS`), on `main` since the initial commit.

## Where the code is

- `src/render/scenes/cymatics.ts` — one fragment shader body (`FRAG`)
  passed to `createFullscreenScene()`. No `settings`, no `extraUniforms`,
  no per-scene helper module.
- `wavefield(p)` is the core: loops the band ladder (all of `uBands`),
  derives each band's radial order `m` and angular order `n` from its
  index, and sums `band * radial * angular` where `radial = cos(m·π·r) ·
  exp(-r/2)` and `angular = cos(n·a + phase)`. `uDetail < 0.5` strides every
  other band to cut cost at low quality.
- The render step turns the wavefield into two textures: `still` (a
  `smoothstep` mask near `w ≈ 0`, thresholded by a per-pixel hash for grain)
  and `line` (`fwidth`-antialiased zero-crossing stroke).
- Uses `roomUv()`, `sampleBands()` is not used here (reads `uBands`
  directly), and `palette()` from `src/render/palette.ts`, hued by radius.
- No dedicated test file.

## References

None — original design; the header comment names the technique it's
modeling (Chladni plate modes) but no video or image was studied.

## Decisions and pivots

- 2026-08-27 (`5fe4b3c`, initial commit) — scene added.
- 2026-08-29 (`4b8d342`, #31) — mechanical rename only: `uQuality` →
  `uDetail` as part of the repo-wide quality/tier renaming; no visual
  change.

## Tuning notes

No `SceneSetting`s — every knob is a shader literal: the plate's radial
falloff (`exp(-0.5 * r)`), the sand threshold band
(`0.0, 0.09 + 0.05 * uEnergy`), the grain sample density (`p * 400.0`), the
line-width multiplier on `fwidth(w)`, and the disc edge (`smoothstep(1.05,
0.98, r)`). The band-to-mode mapping (`m = 1 + floor(i/4)`, `n = (i mod 4) *
2`) is the whole design — changing it changes which bands drive coarse vs.
fine lobes. Judge the look by whether the sand pattern reads as discrete
plate lobes (not mush) across a normal spectrum, and whether the hairline
stroke stays crisp at the zero-crossings without shimmering (that's what
the `fwidth`-based line width is for).

## Known issues and next steps

None recorded — no open PR or issue references this scene
beyond its creation.

## Materials

- Nothing beyond the code: no `/ref` bundle, saved scripts or artifacts.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/cymatics` (query before
  the hash).
- No settings and no test file — tuning means editing the shader literals
  directly and reloading. Note there's a separate, later scene `chladni.ts`
  (id `chladni`) in the gallery — same physical idea, a different
  implementation; don't confuse the two when searching history or PRs.

## History

- `5fe4b3c` (2026-08-27) — initial commit adds the scene.
- `4b8d342` (2026-08-29, #31) — `uQuality` → `uDetail` rename (repo-wide,
  no scene-specific change).
