# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-06_

## In flight

- **Tempo + party mic** — draft #384, `plans/tempo-and-mic.md`. Research
  only, no code yet. The simulated mic barely hurts the 6 real songs; what
  hurts is a tempo detector that changes its answer with mic volume, room
  echo that adds fake hits, and a detector that only hears kick and snare.
  Six phases, starting with the user's party recordings as a test set.
- **Other open PRs:** drafts #383 Room QR opens full screen, #379 Sweep,
  #378 real-song tuning check, #377 Fractal Grid, #376 Echoes, #367 Long
  Play views, #366 Chladni plates, #335 Physarum 2 agent sort, #236 Output
  Cast mode, #74 architecture doc; #160 Magnet slider (ready).

## Open questions

- The true tempo of each party video: known songs or set BPM, or tapped by
  ear? (`plans/tempo-and-mic.md`, blocks phase 1's scoring.)
- In a loud room, should Auto do what the user does by hand (Expansion up,
  Sensitivity near 1×, Smoothing low), at the cost of more twitch on crowd
  noise? (Blocks phase 4.)
- Carry a DJ set's tempo from one song into the next? (Blocks part of
  phase 6.)

## Next up

- Merge #384, then the user sends the party videos and starts a new session
  with `/handoff tempo-and-mic` (phase 1).
- Merge #399: the SessionStart hook then removes worktrees whose PRs merged,
  in the background every session (`npm run prune-worktrees` is the dry run;
  add `-- --yes` to remove). Its first run on 2026-10-08 removed 43.
