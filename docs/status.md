# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Neon Fluid scene (this session)** — branch `worktree-neon-fluid`, draft
  PR opened at session close. A stable-fluids dye sim rendered as neon
  outlines, four-way mirrored, coloured by screen x, recreating a YouTube
  short. Sim in `src/render/scenes/fluidSim.ts`, scene in
  `src/render/scenes/fluid.ts`, registered as a draft scene. Typecheck and
  the full suite green; headless-verified at every quality tier, all three
  `mirror` modes, the gallery tile, the auto→manual probe sign-off, and the
  byte-format fallback. Implementation was delegated to Sonnet subagents from
  an approved plan; the look was tuned in-session from screenshots against
  the reference thumbnails. Branched from `d7412c4`; `main` has since taken
  Storm (#41) and the audio source picker (#71), so expect a trivial rebase
  (touches only new files plus one-line registrations).
- **Plume scene** — draft PR #75 (`worktree-plume-scene`, locked), a
  parallel session today.
- **Docs architecture rewrite** — draft PR #74 (`worktree-docs-architecture`).
- **Auto dial ranking / tempoLock** — draft PR #73 (`worktree-auto-dial-ranking`, locked).
- **Business & legal docs** — PR #72 (`docs-business`); **stage-1 wrap
  status** — PR #70 (`wrap-status`). Both open, non-draft.
- Worktrees with no PR: `powder-scene` (locked, still at `d7412c4` — a
  session that hasn't committed yet), `bake-defaults`, `docs-index`,
  `setting-groups`, `tuning-spotlight`, `agent-ae8a69d86e9c44e97`. The old
  scratch branches listed in the previous snapshot are unchanged — diff
  against `main` before reviving.

## Open questions

- Neon Fluid's `Off` and `Left-right` mirror modes work but read softer than
  Kaleidoscope (bigger structures on screen, same physics). Give them their
  own emitter/splat layout, or leave Kaleidoscope as the scene's identity?
- Several of today's PRs (#70, #72, #74, this one) each rewrite
  `docs/status.md`; whichever merges last wins. Fine for a snapshot, but
  merge them in one sitting.

## Next up

- Review the Neon Fluid draft PR; then `/tune fluid` against real music —
  the constants were tuned on `?audio=synthetic` only.
- Rebase `worktree-neon-fluid` onto `main` once #41/#71 settle.
- Review/merge PRs #70, #72, #73, #74, #75.
