# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-16_

## In flight

- **Panel blur Fast** — draft #562 (issue #561). A third Panel blur look:
  the renderer draws the panel's glass from a small copy of the frame, so
  the browser stops re-filtering the canvas under every card. On stays the
  default.
  - GPU-process CPU per frame falls to about Off's level headless. In a
    visible window, Caustics runs at 104 fps with Fast, 76 with On and 120
    with the blur off.
  - Comparison page for the look call:
    https://claude.ai/artifact/23ak4UAyf8hPe1xfSxZdN3
- **The rest of the performance work (#549):**
  - #560 batches the Picture meter's readbacks (#550).
  - #551 closed: the panel blur was its whole cost, now #561.
  - #552–#556 not started.
  - #546 (draft) is the 2026-10-15 series review and size-budget tightening;
    it also rewrites this file.
- **Other open PRs:**
  - #558 "modifier" for the middle column's nodes
  - #544 gate smoothness (waits on the Gate Smoothness Lab pick)
  - #515 row hints
  - #500 synced stores
  - #498 handoff wording
  - #479 `setI`, already on main through #481
  - #467 panel a11y
  - #458 issue difficulty
  - #433 worktree pruning
  - #400 Echoes
  - #378 real-song tuning
  - #335 Physarum 2 sort
  - #236 Cast mode
  - #160 Magnet slider (ready)
  - #74 architecture doc

## Open questions

- Fast (#562): is the look close enough to replace On? Is "Fast", between
  Off and On, the right chip? It also wants a fast trackpad flick on a real
  display, which the headless checks can't give.
- Since #538, Physarum 2's strain-box previews step 30 times a second on
  120 Hz screens too. Keep that, or spend a time budget that doubles their
  cost on 60 Hz screens?
- Since #541, a Record take needs the main window visible. Build #542
  (record inside the pop-out)?
- #536: lazy-load each scene's code? It took the TV's first paint from 2.73
  to 1.06 s on slow 4G in a prototype.
- Close #479?

## Next up

- Once the look is accepted: make Fast the default. A further saving is to
  blit only the panel columns' areas instead of the whole frame.
- #540: `/ship` compares a render change's GPU cost per scene.
- An `npm run perf` snapshot of main with Chrome closed.
- #552 scene revisit freezes, #553 the Hats/Lead split running when nothing
  reads it, #555 the resource map in `npm run perf`.
- 177 worktrees are on disk; #433's pruning would clear the merged ones.
