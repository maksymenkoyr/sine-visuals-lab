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
- **The performance series, measured.** The review is in
  `docs/performance.md`, under the 2026-10-15 dated finding.
  - Merged: #532 media on demand, #533 shader programs kept, #534 GLSL
    stripper, #535 dev-server watch, #537 Missed frames, #538 panel draws
    on the scene's frames, #539 size budget, #541 pop-out in its own
    process.
  - Results: a visit dropped from 5.3 to 0.64 MB, first draw comes 25–50 ms
    sooner, and the pop-out's missed frames under a busy main window went
    from 120 to 0 per 8 s.
  - #538 also brings the main thread with the panel open from 56% to 43%
    busy.
  - This wrap's PR tightens `size-budget.json` to today's sizes and adds the
    probe scripts in `docs/perf/scripts/`. #530, merged just after, added
    about 10 kB gzip to the TV and output pages.
- **Other open PRs:**
  - #558 "modifier" for the middle column's nodes
  - #544 gate smoothness (waits on the Gate Smoothness Lab pick)
  - #515 row hints
  - #500 synced stores
  - #498 handoff wording
  - #479 `setI`, already on main through #481
  - #467 panel a11y
  - #458 issue difficulty
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
- Since #538, on 120 Hz screens Physarum 2's strain-box previews step 30
  times a second instead of 60, as 60 Hz screens already did. Keep that, or
  use a time budget that doubles their cost on 60 Hz screens?
- Since #541, a Record take needs the main window visible, so DJ software
  covering the browser ends it. Build #542 (record inside the pop-out)?
- #536: is lazy-loading each scene's code worth doing? In a prototype on slow
  4G with 4× CPU, the TV's first paint went from 2.73 to 1.06 s. #530, which
  it needed first, has merged.
- Close #479?

## Next up

- Once the look is accepted: make Fast the default. A further saving is to
  blit only the panel columns' areas instead of the whole frame.
- #540, now unblocked by #531: `/ship` compares a render change's GPU cost
  by each scene's tenth-percentile frame.
- Take an `npm run perf` snapshot of main with #538 and #530, with Chrome
  closed.
- The next costs, by size:
  - With the panel open, the main thread is still 40–55% busy. The Picture
    readback stall and the leash gauge come first.
  - The slowest scene switches: Storm's cloud bake (about 320 ms) and
    Physarum 2's init (about 180 ms).
  - The heap grows from 5.7 to 10.3 MB over a full tour, both before and
    after the series.
- #552 scene revisit freezes, #553 the Hats/Lead split running when nothing
  reads it, #555 the resource map in `npm run perf`.
- Merge #477, then rerun Opus/high solo once on version 10 to see the
  ready-with-fixes state and what the record-only review fixes.
- The `fflate` package is missing from the local install (typecheck fails on
  `src/render/sceneLooks.ts`); `npm ci` fixes it.
- Merge #399: the SessionStart hook then removes worktrees whose PRs merged,
  in the background every session (`npm run prune-worktrees` is the dry run;
  add `-- --yes` to remove). Its first run on 2026-10-08 removed 43.
