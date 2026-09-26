# Physarum 2 (`physarum2`)

A second slime-mould scene: SPECIES_COUNT independent species, each with its
own motion profile and its own trail channel, sensing every species' trail at
once through a fixed weighted sum (ATTRACT_ROWS) — strongly its own, weakly
or negatively everyone else's. That mutual avoidance is what separates the
four networks into distinct, interlocking coloured territories rather than
one shared mesh. Draft, on this branch (not yet on main).

## Where the code is

`src/render/scenes/physarum2.ts` — the header comment is the primary source
for the whole simulation design (species/attraction-table packing, the
per-step fixed-rate stepper, the RGBA=species trail, evaporation precision,
the composite's exposure/gamma). Registered as `physarum2Scene` via
`registerScene` in `src/render/scenes/index.ts` (first line of registration,
newest-draft-first convention), and listed in that file's `draftIds`.

Reuses `packUnit` and `createBeatSeeder` from `physarum.ts` (the same 16-bit
packing round trip and the same beat-rise detector with its own refractory),
and `grainTextureSide` from `chladni.ts` for the agent-state texture sizing.
The GLSL packing/hash/room-mapping helpers are copied into this file's own
`PHYSARUM2_GLSL` shared block rather than exported from `physarum.ts`, so
that file's behaviour is untouched. Exported pure helpers —
`physarum2TrailSide`, `stepAccumulator` — are covered by
`tests/physarum2.test.ts` without a GL context, along with structural checks
on `SPECIES`/`ATTRACT_ROWS`/`PALETTE` and the NEUTRAL auto-tune invariant.
`SETTINGS` carries the Form/Motion/Look/Post controls (Network scale, Trail
decay, Rivalry, Crawl speed, Surge, Beat seeding, Band feed, Exposure,
Palette tint, Beat flash), each with its own `auto` weights.

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

## Tuning notes

Judge the look by whether black background still dominates and the four
species read as distinct, interlocking territories rather than one washed-out
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
- Fixed one variant only, per the plan's scope — a future session could
  explore alternate `SPECIES`/`ATTRACT_ROWS` combinations (a `variant`-style
  setting, following Kaleidoscope's `Style` pattern) if more looks are
  wanted from this same mechanism.

## Materials

- No `/ref` bundle or artifacts. Headless shots for tuning:
  `docs/scenes/_shared/scripts/shot.mjs --scene physarum2 --bpm 120
  --settings '{…}'` (the session's scratch variant only differed in taking a
  list of capture times).

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/physarum2`. Pure logic
(`physarum2TrailSide`, `stepAccumulator`) and the SPECIES/ATTRACT_ROWS/PALETTE
shape are exercised by `tests/physarum2.test.ts`, including the NEUTRAL
auto-tune invariant. A headless Playwright screenshot (see
`docs/scenes/_shared/scripts/shot.mjs` for the pattern this followed) is the
fastest way to judge a tuning change without a mic.

## History

- Added on branch `worktree-physarum2` (2026-09-26): scene, tests, docs record,
  registered as a draft. Not yet merged to main / opened as a PR.
