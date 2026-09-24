# Ink Synth (`ink`)

Black ink on white paper, drawn as thousands of fine contour lines that hug a
cross along the screen axes, curl into spirals along the arms, and merge
into a solid core; a pure primary colour shows only where the three colour
channels disagree, near the core. Draft, on main.

## Where the code is

`src/render/scenes/ink.ts`, built on `createFullscreenScene`. Its shape
mirrors the reference's own description (a random tree of (x,y)->(r,g,b)
functions animated by interpolating parameter vectors): one fragment shader
plus a single parameter vector `uParams`, laid out by `PARAM` (with
`VORTEX_COUNT` swirl warps of `VORTEX_STRIDE` floats each occupying its
head) and eased between random rolls. The pure JS helpers —
`rollParams`, `blendParams`, `createParamDrift`, `advanceStretch`,
`noiseFlows`, `sinPhases` — are exported for `tests/ink.test.ts`. Settings:
`ink`, `arms`, `swirl`, `ribbon`, `lineDensity`, `flow`, `morph`, `stretch`,
`bassSwell`, `colorSplit`, `paper`, `negative`.

Noise: the marbling warps and the organic stroke term use value noise built
on `NOISE_HASH_GLSL`/`NOISE_MASK`/`wrapFlow` from `../noiseHash.ts` — a
module this scene shares with `caustics.ts` (see that module's header for
the mobile-seam mechanism both scenes must avoid). `FBM_OCTAVES`,
`FBM_LACUNARITY`, `FBM_ROT_COS`/`FBM_ROT_SIN` and `NOISE_FLOW_RATES` capture
the shader's fbm exactly so `noiseFlows` can carry each call site's flow
offset through the identical per-octave transform on the JS side before
wrapping it into the lattice period — this is what keeps the ever-growing
flow phase (`uFlowPhase x flow`) from ever reaching the shader as a raw,
precision-losing value; the sine terms take the same precaution via
`uSinPhase`/`sinPhases`.

## References

Studied from a silent "video synthesis" loop on YouTube (channel
"VideoSynthExperiment", `-2j_U0pqovQ`), `/ref` bundle
`tools/.cache/refs/-2j_U0pqovQ/`. The clip is silent by design, so no
audio-sync behaviour was measured from it; every trigger in this scene is an
original mapping chosen so that silence reproduces the reference's resting
look. A follow-up scan of a later window of the same video (roughly 50-80s
into the clip, where the picture sweeps into a broad marbled-ribbon regime
rather than the fine ruled regime the first 0-30s window showed) is its own
bundle, `tools/.cache/refs/marble/`, and is the source for the
`ribbon` setting and its associated stroke rebuild.

## Measurements

2026-09-08, fine-ruled regime (first 0-30s window, 1280x720, r in
half-heights), reference vs. ours (silent frames): dark fraction by radius
band r<0.15 / 0.15-0.3 / 0.3-0.6 / 0.6-1.0 — 0.95/0.7/0.25/0.05 vs.
0.96/0.69/0.23/0.03; on-axis vs. diagonal dark fraction (r 0.6-1.2) 2-15x vs.
>10x; line period/stroke (px at 720p) 4-12 / 1-6 vs. 4-14 / 2-7, both
thinner outward; saturated pixels <1.5% pure primaries vs. 0.3-1.3% one
primary at a time; ground `#fafafa` vs. `#fafafa`.

2026-09-08, marbled-ribbon regime (~58.5s window): dark fraction
1.0/0.91/0.58/0.26/0.09 by radius band; diagonals nearly as inked as axes
(0.16 vs. 0.23); stroke 5-10px at period 10-19px; 0.4% saturated pixels
(blue); mean luminance 0.79.

## Decisions and pivots

- 2026-09-08 to 2026-09-18: initial build (PR #96, merged 2026-09-18). The
  ink-cross density law, contour-line spacing, and per-channel colour split
  were derived from the fine-ruled-regime measurements above. A feedback
  pass comparing to a later frame of the same video ("more swirl/distortion,
  curving watery, colour") revealed the loop sweeps between that fine-ruled
  regime and a broader marbled-ribbon regime the first scan window had
  missed; the `marble` bundle and its measurements (above) came from that
  second scan. The `ribbon` setting and its parameter (`PARAM.marble`) were
  added to reach toward the ribbon regime, but a first attempt still read as
  bent parallel-stripe families rather than the reference's smooth liquid
  ribbons.
- Still within the same lead-up to PR #96: the parallel-stripe look was
  traced to a structural cause — contours of a single axis function — and
  fixed by reading the field through two nested fbm domain warps plus an
  added organic fbm term, with per-channel contour phase drawing rainbow
  fringes matching the reference. The result reads as marbling but remained
  finer and wigglier than the reference's smoothest ribbons — recorded as an
  open taste gap rather than resolved.
- 2026-09-21 (PR #121): a phone render showed Ink Synth's marbling warps
  cutting into shifted polygons — straight and slanted seams with contour
  lines displaced on either side, the same failure Caustics had shown
  earlier (its own PR #102). Root cause: the ever-growing flow phase was
  added directly to the noise coordinates in the shader, and the resulting
  large-value hash lost precision on some mobile GPU compilers, so two
  neighbouring cells' shared corner hash stopped agreeing. Fixed by
  extracting the bounded integer-lattice hash into the shared
  `src/render/noiseHash.ts` module (used unchanged by both Caustics and Ink)
  and reading each fbm call site's flow offset from a JS-precomputed,
  already-wrapped `uNoiseFlow`/`uSinPhase` instead of letting the raw phase
  reach the shader.

## Tuning notes

Every weighted setting is intended to sit on `auto` by default; `paper` and
`negative` are manual by design. Dragging `swirl` flips it to manual, as
expected of any tunable slider. Low quality preset renders should stay clean
— lines are designed to fade below a couple of screen pixels of period
rather than alias. The scene's defaults reproduce the reference's resting
(silent) look by construction, which is also why NEUTRAL auto-tune dials
reproduce the shipped defaults.

## Known issues and next steps

The `ribbon`-driven marbled look still reads as finer and more wiggly than
the reference's smoothest liquid ribbons — an acknowledged, unresolved taste
gap rather than a bug. The mobile seam class of bug (large flow-phase values
reaching a noise hash) is fixed here and in Caustics via the shared
`noiseHash.ts`; any new scene that hashes a noise lattice or adds a growing
phase to a noise coordinate should take both halves of that fix — see
`src/render/noiseHash.ts`'s header.

## Materials

- `ink/-2j_U0pqovQ/` — measurements kept from the `/ref` bundle `-2j_U0pqovQ` (the fine ruled-line window): report, data, and our own shots.
- `ink/marble/` — measurements kept from the `/ref` bundle `marble` (the marbled-ribbon window): report, data, and our own shots.
- Artifact: [Ink Synth Dossier](https://claude.ai/artifact/Vji9mqUL3qUpdzZfr7viBq). Source saved as `ink/artifacts/ink-synth-dossier.html`, with its reference images replaced by a placeholder.
The reference media for these bundles (video, frames, audio, the images built from them) stays out of this repo: in the local `tools/.cache/refs/<bundle>/` cache and the private archive (`tools/ref-archive.py`).

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/ink`. The reference video
is silent, so use `tools/ref-shoot.mjs` with the bundle's own (silent) audio
file to check the true resting look — the browser's fake-mic tone otherwise
locks tempo detection at a nonzero bpm and the shot won't be silent. A
mobile-seam regression check exists as a headless harness that compiles the
old and new Ink shader and renders both at a large flow phase — the seam
only reproduces on a real mobile GPU compiler, not SwiftShader, so a phone
capture is the real verification, not a desktop headless screenshot.

## History

- `#96` (2026-09-18, merged) — Ink Synth added: contour-line ink cross with
  bar-start parameter rolls, from `/ref` on the silent video-synthesis loop;
  includes the mid-PR pivot to the `ribbon`/marbled-ribbon regime and its
  stroke rebuild.
- `#121` (2026-09-21, merged) — fixed mobile rendering seams by sharing
  Caustics' bounded noise hash via the new `src/render/noiseHash.ts`.
