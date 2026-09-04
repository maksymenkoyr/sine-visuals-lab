# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Neon Fluid scene, v5 (this session)** — branch `worktree-neon-fluid`,
  draft PR #76. v5 (after two real-music rounds): gains cut to roughly a tenth
  of v4, puffs on bass onsets only (`PUFF_MIN_GAP`), one-flow fold warps, a
  Symmetry group (`foldSpread` unsqueezes the radial wedges, `foldSpin`,
  `foldBreathe`, `foldDrift`). v4: Mirror became `symmetry` with an Auto default that drifts
  between the quadrant folds (`advanceFold`), the Currents sparkle rides the
  sim velocity, a hue-preserving tone map with `neon`/`hotWhite`, and a Light
  group (`dropFlash`, `shockwave`, `buildGlow`, `beatFlash`). v3: `MIRROR_OPTIONS`
  grew (Top-bottom = the reference geometry, Radial folds via `simUv`) and
  treble sparkle became its own settings group (Electric threads in a
  Negative tint). Before that, after the user compared a frame against the reference short
  ("sharper edges, more reactive to music"), the scene was reworked: the
  dye grid doubled and advected with a two-pass clamped MacCormack step, an
  explicit viscosity pass (new `viscosity` setting) replaced the old inline
  smoothing, and emission moved from a continuous push into beat-timed
  puffs (`puffEnv`/`advancePuff` in `src/render/scenes/fluid.ts`) — each
  beat is one thin dye ring that stretches into a filament, so the striations
  read the beat history. New `warp` setting speeds the sim with loudness;
  the line brightens on beats and the hue ramp follows the spectral
  centroid. Typecheck and the full suite green; headless-verified at every
  quality tier, all three `mirror` modes, the gallery tile, a slow-tempo
  fallback, and the byte-format fallback. Implementation delegated to two
  Sonnet subagents from the approved plan; the look was then tuned from
  screenshots in the main session (see the fluid lines at the end of
  `tuning/VOCAB.md`). Still branched from `d7412c4`; `main` has since taken
  Storm (#41) and the audio source picker (#71) — expect a trivial rebase.
- **Powder scene** — PR #77; **Plume scene** — draft PR #75; **Docs
  architecture rewrite** — draft PR #74; **Auto dial ranking / tempoLock** —
  draft PR #73; **Business & legal docs** — PR #72; **stage-1 wrap status**
  — PR #70.

## Open questions

- Neon Fluid's Top-bottom mode rolls into one big spiral at the emitter and leaves
  the right of the screen empty even with `TB_PUSH_SCALE`; the reference fills
  the width. Different emitter placement, or a sustained push there?
- Neon Fluid's `Off` and `Left-right` mirror modes work but are busier than
  Kaleidoscope (the same emitter unfolded over the whole screen). Give them
  their own emitter placement, or accept Kaleidoscope as the identity?
- The byte fallback renders but its 8-bit dye makes the thin rings jagged.
  Acceptable for old TV runtimes, or worth a coarser ring there?
- Several open PRs (#70, #72, #74, #76, #77) each rewrite `docs/status.md`;
  whichever merges last wins. Merge them in one sitting.

## Next up

- `/tune fluid` against real music — the gains were cut to a fifth after the
  user's first real-music run ("had to move all sliders to the bottom"), but
  every constant was still tuned on
  `?audio=synthetic` only; the Currents gate needs real treble (synthetic has
  almost none) and the Light group needs a real drop; the beat puffs need a real onset
  stream.
- Rebase `worktree-neon-fluid` onto `main`, mark PR #76 ready.
- Review/merge PRs #70, #72, #73, #74, #75, #77.
