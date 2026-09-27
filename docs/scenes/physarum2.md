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

## Tuning notes

Judge the look by whether black background still dominates and the four
strains read as distinct, interlocking territories rather than one washed-out
mass — `DEPOSIT`, `GLOW_MIN`/`GLOW_MAX` and the "seed" setting's default all
trade off against this (see the file header's budget comments on each). The
"seed" setting is unusually sensitive: because reseeded agents land in one
small disc (`SEED_CLUSTER_RADIUS`) rather than scattering across the whole
field the way `physarum.ts`'s own beat seeding does, a share that would look
subtle field-wide saturates that disc solid white instead — this is why its
`step` is finer (0.01) than every other setting here. Tuned so far only
against the synthetic feed at `bpm=120`; not yet judged against real music
through a mic.

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
- Phase 3 (live per-strain previews inside each specimen box, territory/
  population readouts, the manual pipette) is not built — the boxes only
  show a code, colour and an empty placeholder swatch today.
- The nutrient/excite/sensor/turn/stride/stain settings carry no `auto`
  table (unlike the global Form/Motion/Look/Post rows) — a scene-wide Auto
  toggle currently leaves every strain's own controls manual. Not asked for
  in this round; worth a look if per-strain auto-tuning is wanted later.
- Not checked against a scene-wide Look save/apply round trip with the new
  per-strain keys — Looks ignore unknown keys by design (a Look saved before
  this change simply won't touch any strain control), but no explicit test
  covers a Look captured *after* this change surviving a reload.

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

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/physarum2`. Pure logic
(`physarum2TrailSide`, `stepAccumulator`, `hueRotateRGB`, the sensor/turn/
stride slider<->physical mappings) and the STRAINS/ATTRACT_ROWS shape are
exercised by `tests/physarum2.test.ts`, including the NEUTRAL auto-tune
invariant and the "defaults reproduce the old fixed motion" round trip;
`tests/sceneItems.test.ts`/`tests/sceneKeys.test.ts` cover the generic
item/panel framework this scene is the first caller of. Next up here is
Phase 3 (see Known issues): `src/render/scenes/physarum2Preview.ts` (a pure
CPU sim reading the same mapping functions this file exports) feeding a live
preview into each specimen box, plus the manual pipette — the plan at
`~/.claude/plans/make-this-much-more-wondrous-pearl.md` (session-local, not
in this repo) has the fuller sketch. A headless Playwright screenshot (see
`docs/scenes/_shared/scripts/shot.mjs` for the pattern this followed) is the
fastest way to judge a tuning change without a mic; for the panel itself,
`#menuBtn` opens it and a real mouse down/wait/up (not a scripted `.click()`)
is what actually exercises a box or Affinity-word press.

## History

- Added on branch `worktree-physarum2` (2026-09-26): scene, tests, docs record,
  registered as a draft. Not yet merged to main / opened as a PR.
- 2026-09-27: Phases 1+2 of the lab-controls plan (see Decisions and pivots
  above) — per-strain settings, the Strains/Affinity panel, and the generic
  `sceneItems.ts`/`src/ui/widgets/` framework it's built on. Still on
  `worktree-physarum2`, still not merged to main.
