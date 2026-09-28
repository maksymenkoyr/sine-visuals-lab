# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Physarum 2: Pairs pads + Touch** — draft #176, branch
  `worktree-affinity-ui`. Touch is a second pair table (strains feed or eat
  each other's trails, `touch<i><j>`). Affinity is now its own card: Pairs
  pads with plain `− A → B +` axes and numbers only, rows that wake, pin and
  solo like the rest of the panel, previews that move with the music,
  Random / Nudge / Back / presets. Typecheck and tests green, `padcheck.mjs`
  30/30. `main` merged in (its `deviceMenu.ts` conflict with #178 resolved);
  mergeable, still a draft.
- **Physarum 2 per-strain settings** — the user finds them unusable.
  Prototype "Strain Console"
  (https://claude.ai/artifact/Y32bYpyxHC5otWgG967f7D, source
  `docs/scenes/physarum2/artifacts/strain-console.html`); nothing built.
  The Physarum 2 record's "Resume here" is the starting point.
- **Other open PRs:** #184 Caustics ripple colour family; #183 Scope
  Waveform jack (draft); #181 doc-check; #180 drive defaults audit (draft);
  #171 no screen capture on phones; #160 magnet slider; #103 mic latency
  line; #74 architecture doc (draft); #73 Auto dial ranking (draft). #70 is a
  stale status snapshot — close it.

## Open questions

- Strain Console: Lanes or Knobs? Which of Sensor angle, Trail life and
  Share become real per-strain settings?
- Pairs pads: add a one-line legend ("+ steers toward that trail, − steers
  away" / "+ adds to that trail, − erases part of it")?
- Physarum 2's Gardens preset washes toward white; "Dose" is still easy to
  misread; the spatial re-sort (≈ 3.5× cheaper steps) is unbuilt; neither
  Physarum scene has been judged on real music through a mic.

## Next up

- Mark #176 ready once CI is green and the user has tried it.
- Build the per-strain layout the user picks from the Strain Console.
- Close #70; prune worktrees whose PRs merged (31 besides `main`; check each
  one's PR with `gh pr view`).
