# Physarum 2 (`physarum2`)

A second slime-mould scene: SPECIES_COUNT independent strains, each with its
own motion profile and its own trail channel, sensing every strain's trail at
once through a weighted sum (the `att<i><j>` settings, defaulting to
ATTRACT_ROWS) — strongly its own, weakly or negatively everyone else's. That
mutual avoidance is what separates the four networks into distinct,
interlocking coloured territories rather than one shared mesh. Draft, on this
branch (not yet on main).

## Where the code is

`src/render/scenes/physarum2.ts` — the header comment is the primary source
for the whole simulation design (strain/attraction-table packing, the
per-step fixed-rate stepper, the RGBA=strain trail, evaporation precision,
the composite's exposure/gamma, and — since 2026-09-27 — the per-strain
settings and the "Uniform budget" note on how they reach the shader without
their own uniforms). Registered as `physarum2Scene` via `registerScene` in
`src/render/scenes/index.ts` (first line of registration, newest-draft-first
convention), and listed in that file's `draftIds`.

Reuses `packUnit` and `createBeatSeeder` from `physarum.ts` (the same 16-bit
packing round trip and the same beat-rise detector with its own refractory),
and `grainTextureSide` from `chladni.ts` for the agent-state texture sizing.
The GLSL packing/hash/room-mapping helpers are copied into this file's own
`PHYSARUM2_GLSL` shared block rather than exported from `physarum.ts`, so
that file's behaviour is untouched. Exported pure helpers —
`physarum2TrailSide`, `stepAccumulator`, `hueRotateRGB`, the
sensor/turn/stride slider<->physical mapping pairs — are covered by
`tests/physarum2.test.ts` without a GL context, along with structural checks
on `STRAINS`/`ATTRACT_ROWS` and the NEUTRAL auto-tune invariant.

`STRAINS` is the per-strain identity table (code, base colour, fixed sensor
angle); `nutrient<k>`/`excite<k>`/`sensor<k>`/`turn<k>`/`stride<k>`/`stain<k>`
(`src/render/sceneItems.ts`'s `defineItems`, family `"strain"`) and the full
`att<i><j>` affinity matrix (`defineItemPairs`) replace the old shared "Band
feed"/"Surge" pair and the fixed `SPECIES`/`PALETTE` constants — every strain
now has its own controls and its own Receives patch. `scene.panel` (one
`PanelSection` naming the `itemBoxes` widget — `src/ui/widgets/itemBoxes.ts`)
renders them as specimen boxes + the selected strain's rows + an Affinity
block (plain-word rows, a compact SVG web, named presets) inside the device
menu's Scene card, ahead of the remaining flat rows (Network scale, Trail
decay, Hostility [renamed from Rivalry, same key `rivalry`], Crawl speed,
Beat seeding, Exposure, Palette tint, Beat flash), each of the latter still
carrying its own `auto` weights as before.

This is also `src/render/sceneItems.ts`/`src/ui/widgets/registry.ts`'s first
real caller — see those files' own headers for the item/panel framework
itself (generic, reusable by any scene), and `tests/sceneItems.test.ts` /
`tests/sceneKeys.test.ts` for its tests.

**Phase 3 (2026-09-27):** live pure-culture previews inside each specimen
box, POP/TERR/VIG readouts, a population bar, Rebalance and the pipette —
`src/render/scenes/physarum2Preview.ts` (a pure, DOM-free port of the
"Physarum Lab" prototype's `createStrainPreview`) driven by
`src/ui/widgets/previews.ts` (a preview-source registry, id "physarum2")
through `resolveStrainEffective` (physarum2.ts, exported — the one
strain-motion mapping the GPU packing and every box's preview both call, so
a box can't drift from what the strain actually does in the main dish).
`scene.ts`'s new optional `Scene.probe()`/`Scene.command()` (phone-local,
never reaching the TV) are how `src/ui/widgets/itemBoxes.ts` reads
population/territory and sends `"inject"`/`"rebalance"` — see physarum2.ts's
own file header for the territory GPU downsample/readback, the population
bookkeeping, and the screen->field mapping the pipette uses. Two settings
were added for it: `seedSpread` ("Spread", replacing the old fixed
`SEED_CLUSTER_RADIUS`) and `seedFrom` ("Auto-inject from"); `seed` itself was
relabelled "Dose". See `tests/physarum2Preview.test.ts` and the Phase 3
additions to `tests/physarum2.test.ts`.

## References

https://github.com/fogleman/physarum (MIT) — studied for the multi-species/
attraction-table idea and the general shape of a per-step diffuse/decay +
sense/turn/move + deposit loop; https://sagejenson.com/physarum — studied for
the same algorithm description. Neither the species/attraction-table numbers
in `SPECIES`/`ATTRACT_ROWS` nor the render palette are taken from Fogleman's
own published values — they're this scene's own hand-picked variant (CLAUDE.md:
"just make one of the variants," not randomised). No `/ref` video bundle; no
code was ported (CLAUDE.md's standing rule — written independently from the
published description, the same spirit as `physarum.ts`'s own Jones citation
and `powder.ts`'s curl noise).

## Decisions and pivots

- 2026-09-26: scene added complete in one pass — species/attraction-table
  sim, per-step fixed-rate stepper (`stepAccumulator`), clustered beat
  reseeding, additive gamma composite, registered as a draft. Built from a
  detailed plan; the initial headless screenshots showed the beat-reseed
  disc saturating to solid white (the default reseed fraction concentrated
  roughly 15% of all agents into a disc covering only ~1% of the trail map)
  and the whole picture reading over-bright with too little black
  background. Fixed by lowering the "seed" setting's default and step
  (0.15 -> 0.03, step 0.05 -> 0.01, since this setting is far more sensitive
  per unit than physarum.ts's own field-wide reseed) and pulling back
  `DEPOSIT`/`GLOW_MIN`/`GLOW_MAX` — see Tuning notes.
- 2026-09-26 (review pass): 0.03 into a radius-0.06 disc still landed as a
  conspicuous white blob a few seconds in; spread it to radius 0.12 at a
  0.01 default so a beat sprouts a faint mixed-colour colony instead.
  Also compared Network scale 0.15 against the 0.5 default: finer scale
  breaks the short-sensor violet species into isolated dots, so the
  default stays.
- 2026-09-26: "Beat surge" relabelled "Surge" (its drive can pick any
  source). User asked for a 4x bigger Surge range: `SURGE_GAIN` 1.5 -> 6.0,
  with the default 0.4 -> 0.1, step 0.05 -> 0.01 and auto weights quartered
  (pulse 0.25 -> 0.06, attack 0.2 -> 0.05), so the default look is unchanged
  and full slider is a 7x step on a hit instead of 2.5x.
- 2026-09-26/27: user asked for "much more interactive and visual" controls
  where each population gets its own drivers, and for an architecture that
  lets any scene have unique custom controls. Prototyped first as a
  clickable artifact ("Physarum Lab", see Materials). v1's 4x4 number grid
  for the attraction table was judged unclear; v2 went lab-themed and
  gamified: a culture dish with a pipette, one specimen box per population
  running a live pure culture, a relationship web with plain-word rows
  (Flees / Avoids / Ignores / Follows / Loves), named experiments, a lab log.
  Framing decided with the user: not four species but four *strains* of
  *Physarum polycephalum* (strains fuse with kin and keep apart from
  incompatible ones, which is what the attraction table models), labelled
  with isolate codes plus an editable nickname. Manual pipette injection
  converts agents to the selected strain, with a Rebalance button.
  Pure-culture previews collapsed to one blob on a small torus; a
  0.5%-per-step random respawn keeps each a live network (measured with a
  node harness: densest 2% of cells fell from 76% to about 12% of the trail
  for the widest-turning strain). Implementation (declarative items +
  widget registry, then per-strain settings here) is planned but not built.
- 2026-09-27: Phases 1+2 of the plan implemented — the approved v3 prototype
  structure (Strains group: four specimen boxes with a placeholder preview
  area, the selected strain's Nutrient/Sensor range/Turn angle/Speed/
  Excitability/Stain as real device-menu rows, an Affinity block below with
  Flees/Avoids/Ignores/Follows/Loves segmented rows, a compact SVG web and
  the five named experiment presets copied from the prototype). Framework
  landed as `src/render/sceneItems.ts` (`defineItems`/`defineItemPairs`/
  `composeSettings`) and `src/ui/widgets/` (`registry.ts`'s `WidgetCtx`,
  `itemBoxes.ts`, `relationRows.ts`, `relationWeb.ts`), wired into
  `src/ui/deviceMenu.ts`'s `renderSceneSettings`. Removed the old shared
  `feed`/`beatSurge` settings and the fixed `SPECIES`/`PALETTE` tables;
  `STRAINS` plus the generated per-strain settings are now the source of
  truth, resolved in JS each frame (drives.value/resolveSceneSetting) and
  packed into `uSpecies`/`uAttractRow`/new `uStrainSurge`/`uStrainFeed`/
  `uStrainColor` uniforms — see the file header's "Uniform budget". Sensor
  range/Turn angle/Speed default to the *inverse* of the old fixed SPECIES
  motion (round-trip asserted in tests), so the default look is unchanged;
  confirmed by headless before/after screenshots at t=10s/20s (same
  palette/density/character; the sim is stochastic so not pixel-identical).
  Selecting another box or an Affinity word triggers a full Scene-card
  rebuild (`WidgetCtx.rerender()`) rather than patching the widget's own
  DOM — reuses deviceMenu's existing jack/cable/pin teardown for free
  instead of a second bookkeeping path; cheap at this scene's row count.
  Live per-strain previews, territory/population readouts and the manual
  pipette are Phase 3, not built yet — the box's preview area is just a
  sized, empty placeholder. Also fixed a latent `tests/sceneKeys.test.ts`
  (new) blocker: importing anything that pulls in `controlsTheme.ts`'s
  `?url` font import failed under Vitest in a git-worktree checkout (the
  symlinked `node_modules` resolves outside the worktree root, and Vite
  denies serving it) — `vitest.config.ts` now sets
  `resolve.preserveSymlinks: true`. No scene record existed yet for this
  under `docs/scenes/physarum2/` beyond the prototype artifacts noted in
  Materials below; this session added no new `/ref` material.
- 2026-09-27 (Phase 3): live specimen boxes, readouts, pipette, Rebalance.
  Refactored the per-strain resolve step first — `resolveStrainEffective`
  (physarum2.ts) is now the one function both `resolveStrains` (the GPU
  packing) and every specimen box's preview call, folding Excitability's
  surge multiplier straight into the packed step distance so `uStrainSurge`/
  `strainSurgeFor` could come out of SIM_FRAG entirely (one fewer uniform,
  one fewer place the two paths could drift apart). `physarum2Preview.ts`
  ports the prototype's `createStrainPreview` faithfully (same
  `RESPAWN_PER_STEP` comment, same 3x3-blur-times-0.9-decay kernel) but takes
  `StrainPreviewMotion` as a plain argument instead of computing it itself,
  so it stays pure/DOM-free and independently testable; `previews.ts`
  (new registry) is what converts `resolveStrainEffective`'s reference-texel
  output into the preview's own cell units, via one constant
  (`REF_TEXELS_PER_PREVIEW_CELL = 4`, picked by eye against a headless
  screenshot — a box's grain now visibly matches each STRAINS entry's own
  one-line character comment: PP-A1 reads as flowing strands, PP-B2 as a
  reticulated mesh, PP-C3 as coarse spots, PP-D4 as fine fuzz).
  `itemBoxes.ts`'s preview canvas uses the exact two-canvas smoothing trick
  the prototype's own `draw()` used (offscreen native-resolution
  `putImageData`, then `drawImage` onto the visible, CSS-scaled canvas) and
  steps (not draws) only every other device-menu tick — measured headless at
  `?quality=low`, panel closed vs the Scene card open with all four
  previews ticking: mean/median frame time were within noise of each other
  (~8.3 ms both ways over 480 frames; p95 identical at ~9.2 ms), so no
  further quality-tier scaling was needed.
  Territory reads a 16x16 box-downsample of the trail (a small dedicated
  `TERRITORY_FRAG` pass — no reliance on GPU mipmap LOD selection, which is
  harder to reason about on a REPEAT-wrapped NPOT texture) through a
  `PIXEL_PACK_BUFFER` + `fenceSync`, polled with a zero-timeout
  `clientWaitSync` every render() so a readback never blocks the render
  loop; a new one only kicks off at most every 500 ms and only while
  `probe()` has actually been called in the last 2 s. Population is tracked
  with no readback at all: `applyInjection`'s
  `pop_k <- pop_k*(1-d) + (k==strain?d:0)` matches, in expectation, what the
  GPU's uniform-random inject pass actually does. The pipette's tap-to-field
  mapping (`screenToFieldUv`) is a pure JS twin of the composite shader's own
  `roomAspect()`/`coverUv()`, plus `uncoverUv` as its exact algebraic
  inverse — headless-verified end to end: arming the pipette, selecting
  PP-C3 and 5 real taps at the same screen point moved its population from
  25% to 29% (matching the "Dose" default of 0.01/tap by hand-calculation)
  and left a visible teal colony at the tap point; Rebalance returned every
  strain to exactly 25%. `seed` was relabelled "Dose" (it now also reads as
  the pipette's own injected share, not just the beat's), and its old fixed
  `SEED_CLUSTER_RADIUS` became the "Spread" setting (`seedSpread`) so the
  pipette and the automatic beat reseed share one live control; a new
  "Auto-inject from" enum (`seedFrom`) restricts which strain the *automatic*
  trigger may move agents from (never converting species, unlike the
  pipette — matching the prototype's own rule). The 3-line lab-log ticker
  from the prototype was skipped (the brief allowed it: "skip if it
  clutters") — the POP/TERR/VIG readouts plus the population bar already
  cover what it would have narrated.

## Tuning notes

Judge the look by whether black background still dominates and the four
strains read as distinct, interlocking territories rather than one washed-out
mass — `DEPOSIT`, `GLOW_MIN`/`GLOW_MAX` and "Dose"'s default all trade off
against this (see the file header's budget comments on each). "Dose" (key
`seed`) is unusually sensitive: because reseeded/injected agents land in one
small disc ("Spread", `seedSpread` — replacing the old fixed
`SEED_CLUSTER_RADIUS`) rather than scattering across the whole field the way
`physarum.ts`'s own beat seeding does, a share that would look subtle
field-wide saturates that disc solid white instead — this is why its `step`
is finer (0.01) than every other setting here. The pipette (Phase 3) reads
this exact same setting as its own injection share, so the same sensitivity
applies there too. Tuned so far only against the synthetic feed at
`bpm=120`; not yet judged against real music through a mic.

## Known issues and next steps

- Not yet checked against real music from a mic — synthetic-feed tuning only.
- The reseed burst's brightness/size still trades off against `DEPOSIT` and
  `GLOW_MIN`/`GLOW_MAX`; a future pass might want its own exposure term
  instead of sharing the composite's global exposure, if a louder track needs
  a bigger burst than the ambient network can take without blowing out.
- Fixed one attraction-matrix variant as the default ("Rivals"), per the
  plan's scope — a future session could explore alternate defaults (a
  `variant`-style setting, following Kaleidoscope's `Style` pattern) if more
  looks are wanted from this same mechanism.
- The nutrient/excite/sensor/turn/stride/stain settings carry no `auto`
  table (unlike the global Form/Motion/Look/Post rows) — a scene-wide Auto
  toggle currently leaves every strain's own controls manual. Not asked for
  in this round; worth a look if per-strain auto-tuning is wanted later.
- Not checked against a scene-wide Look save/apply round trip with the new
  per-strain keys — Looks ignore unknown keys by design (a Look saved before
  this change simply won't touch any strain control), but no explicit test
  covers a Look captured *after* this change surviving a reload.
- Vigour (VIG) comes from `probe()`'s `vig<k>`: the signal actually feeding
  the strain's Nutrient in `resolveStrains`, scene default included. The
  first Phase 3 build read `WidgetCtx.driveValue` instead, which is 0 until a
  source is patched in, so VIG sat at 0.00 on defaults; fixed in review
  (2026-09-27). The Nutrient row's own sparkline still follows the panel-wide
  convention of showing only a patched source.
- Territory's 16x16 downsample uses a real box filter (a small dedicated
  `TERRITORY_FRAG` pass, not GPU-generated mipmaps) precisely to avoid
  relying on LOD auto-selection on a REPEAT-wrapped NPOT texture — not
  measured against an alternative approach, so if it ever shows up in a
  profile, mipmaps are the next thing to try.
- Pipette armed-state is a single in-memory map keyed by (scene, family) —
  correct for Physarum 2 today, but a hypothetical second itemBoxes-based
  scene would need its own distinct family name to avoid sharing the
  "armed" bit (Physarum 2's own family is already "strain", so this is only
  a risk for a future scene that reuses that exact name).
- No 3-line lab-log ticker (leader-change-with-hysteresis, last
  inject/rebalance events) — the plan allowed skipping it if it clutters;
  the POP/TERR/VIG readouts and the population bar cover the same ground
  without a fourth thing to read.

## Materials

- Artifact "Physarum Lab" (controls prototype, private):
  https://claude.ai/artifact/UhgRTMw36hB6mFBccP7ada — source in
  `physarum2/artifacts/`: `lab.src.html`, `strainPreview.js` (the shared
  strain-motion mapping and pure-culture preview), `engine.js` (fake-music
  engine from the drives prototypes); `node build.mjs` writes the page,
  `node look.mjs [--click]` screenshots it at wide and phone width.
- No `/ref` bundle. Headless shots for tuning:
  `docs/scenes/_shared/scripts/shot.mjs --scene physarum2 --bpm 120
  --settings '{…}'` (the session's scratch variant only differed in taking a
  list of capture times).
- Phase 3's own headless checks (session scratch, not in this repo): a
  panel-screenshot script (wide/phone, `#menuBtn` + scroll-to-Scene), a
  pipette script (real press to select a strain and arm the pipette, real
  taps on `#gl` at a known point, reads each box's own POP readout text
  before/after), and a frame-time script (`requestAnimationFrame` deltas
  in-page, panel closed vs the Scene card open) — the measurements these
  produced are in the Decisions and pivots entry above.

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/physarum2`. Pure logic
(`physarum2TrailSide`, `stepAccumulator`, `hueRotateRGB`,
`resolveStrainEffective`, the sensor/turn/stride/seedSpread slider<->physical
mappings, `equalPopulation`/`applyInjection`, `classifyTerritory`,
`roomAspectJs`/`coverUvJs`/`uncoverUvJs`/`screenToFieldUv`) and the
STRAINS/ATTRACT_ROWS shape are exercised by `tests/physarum2.test.ts`,
including the NEUTRAL auto-tune invariant and the "defaults reproduce the old
fixed motion" round trip; `physarum2Preview.ts`'s own sim (determinism, the
respawn floor/ceiling claim) is `tests/physarum2Preview.test.ts`;
`tests/sceneItems.test.ts`/`tests/sceneKeys.test.ts` cover the generic
item/panel framework this scene is the first caller of. All three phases of
the lab-controls plan are built now — what's left is Known issues above
(mic-verified tuning, per-strain Auto, the skipped ticker) rather than a
missing phase. A headless Playwright screenshot (see
`docs/scenes/_shared/scripts/shot.mjs` for the pattern this followed) is the
fastest way to judge a tuning change without a mic; for the panel itself,
`#menuBtn` opens it and a real mouse down/wait/up (not a scripted `.click()`)
is what actually exercises a box, Affinity word, Rebalance or Pipette press.
The pipette's own canvas listener lives on `#gl` directly and outlives a
panel close (only a Scene-card rebuild disposes it — `ctx.onDispose`), so a
headless check can arm it, close the panel for an unobstructed tap, then
reopen to read the readouts back. A `vite.shot.config.ts` wrapper
(`server.fs.allow` for the main checkout, so `@fontsource` woff2s don't 403
behind this worktree's symlinked `node_modules`) is the untracked fix for the
panel rendering in system fonts headlessly — see headless-app-driving.md.

## History

- Added on branch `worktree-physarum2` (2026-09-26): scene, tests, docs record,
  registered as a draft. Not yet merged to main / opened as a PR.
- 2026-09-27: Phases 1+2 of the lab-controls plan (see Decisions and pivots
  above) — per-strain settings, the Strains/Affinity panel, and the generic
  `sceneItems.ts`/`src/ui/widgets/` framework it's built on. Still on
  `worktree-physarum2`, still not merged to main.
- 2026-09-27: Phase 3 (see Decisions and pivots above) — live specimen-box
  previews, POP/TERR/VIG readouts, the population bar, Rebalance and the
  pipette, plus `seedSpread`/`seedFrom` and the "Dose" relabel. Still on
  `worktree-physarum2`, still not merged to main (PR #153).
