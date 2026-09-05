# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Kaleidoscope scene** — `src/render/scenes/kaleidoscope.ts`, branch
  `worktree-kaleidoscope-scene`, draft PR #79 (this session). Mirror-tiled
  contour-band mandalas after a YouTube short; even-fold symmetry keeps the
  tiling seamless, the band footprint for ink/moiré is analytic (`fwidth`
  under-reads on mirror lines). Registered in `DRAFT_SCENE_IDS`; its settings
  are in `tests/autoTune.test.ts`'s invariant set. Verified headlessly at
  high/low quality, on beats, on a real track via fake mic, with the
  auto→manual probe sign-off and the gallery tile. User feedback round one:
  beat snap read as a redraw → now a damped surge + swell envelope
  (`advanceBeatSurge`). Same PR carries the **Beat grid** row (Rhythm card;
  `src/audio/beatGrid.ts`, `src/render/gridPulse.ts`): per-scene Hits/1/8/1/4/
  1/2/bar/2 bars, gridded off the phase-locked beat count, hits until the
  tracker locks. Not sent to the TV (same gap as Smoothing).
- **Kaleidoscope styles** — branch `worktree-kaleido-styles`, stacked on the
  scene branch, draft PR #83. The scene is now the folder
  `src/render/scenes/kaleido/` with a `style` enum: Mandala (richer: gaussian
  rosette rings, corner motif, bar-breathe petal split, counter-rotating rings
  behind an edge mask, twist), Portal, Prism and Burst, each after one of the
  user's reference shorts. Round two after the user rejected the first three:
  the reference videos were measured (frame registration against onsets —
  every one zooms in continuously, brightness pops per beat, Prism kicks the
  zoom on each beat, the Portal short is silent), and the styles rebuilt with
  a Zoom slider that is a real camera dive: the lattice grows as if Tiling
  were dragged and every mandala's core is a window onto the next lattice
  down (index.ts header, CORE_FRAC), so it never cuts; what streams inside a
  cell rides Flow. Prism folds on a hexagonal lattice. Style is
  the scene's **variant**: `SceneSetting.variant` / `variantDefaults` in
  `sceneSettings.ts` give every other setting a profile per option (values,
  auto state, defaults); Looks carry the variant and apply it first. The two
  fractal-zoom references are a separate scene still to plan.
- **Three sibling draft scenes from the same reference-video workflow**, each
  on its own worktree branch with a draft PR: Plume (#75), Neon Fluid (#76),
  Powder (#77). None has had a user verdict on real music yet.
- **Auto: unstick tempoLock, rank dials against the session** — draft PR #73
  (`worktree-auto-dial-ranking`).
- **docs/architecture.md rebuilt diagrams-first** — draft PR #74
  (`worktree-docs-architecture`).
- **Business/legal docs** — PR #72 (`docs-business`), open, not draft.
- **`wrap-status` PR #70** — an older status snapshot still open; this file
  supersedes it, so close that PR rather than merging it.
- Idle worktrees with no PR: `worktree-agent-ae8a69d86e9c44e97` (always-on
  dev controls), `worktree-auto-hint-description`, `bake-defaults`,
  `worktree-docs-index`, `worktree-setting-groups`, `worktree-tuning-spotlight`
  — several likely superseded by what has since landed on `main` (setting
  groups, hint descriptions); diff before reviving.

## Open questions

- Which of the four reference-video draft scenes (Kaleidoscope, Plume, Neon
  Fluid, Powder) are worth graduating out of `DRAFT_SCENE_IDS`, and which get
  dropped? Each needs a look on real music first.
- Beat grid: should its default move off Hits (to 1/4) once judged on real
  music, and should the TV receive it (a new DeviceCommand field)?
- Kaleidoscope: the hexagonal lattice is Prism-only today — worth a Form
  setting for the other styles? The texture styles paint a full rainbow
  tinted by the room palette (`RAINBOW_ROOM_MIX`) — does that read as
  ignoring the Palette card? Storm's Mode is the obvious next `variant`.
- Storm's local render-cap workaround predates `renderLatch.ts` and is now
  redundant in principle; simplify once nothing else is touching Storm.
- The stale scratch branches on origin (`band-faders`, `lp-merge`,
  `quality-preset-setting`, `worktree-band-tilt`, …): prune, or is anything
  in them still wanted?

## Next up

- Watch Kaleidoscope, Plume, Neon Fluid and Powder on real music; review and
  land or drop their draft PRs.
- Review draft PRs #73 and #74; merge or close PR #72; close PR #70.
- Decide the fate of the idle worktrees listed above.
