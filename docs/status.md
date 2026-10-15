# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-15_

## In flight

- **Performance series, all drafts, each measured.** The approach: keep full
  detail (Energy saving stays Off by default, #26), so cut wasted work instead
  of lowering resolution.
  - #532: scene media is fetched when its scene first mounts, from
    never-renamed `public/media/` paths. A gallery visit drops from 5.35 to
    0.74 MB. A show (the pop-out, a room with another device) still pins
    everything up front.
  - #533: a mount's shader programs compile together and are kept for the
    next mount. A revisit's frame stall drops from 25–43 ms to 10 ms.
  - #534: a build-only GLSL comment and indentation stripper. First-load JS
    is 14% smaller for index and 20% for tv and output.
  - #535: the dev server stops watching `.claude/` worktrees, so it no longer
    reloads pages when an agent edits a worktree.
  - #537: the Power card gains Missed frames and Longest gap, for this window
    and the pop-out.
  - #538: the panel draws on the scene's frames, and only what is on screen.
    Caustics with the panel open: main-thread busy 34% → 16%.
  - #539: `npm run check` gets a bundle-size budget, enforced on PRs and
    warning-only on a push to main.
  - #541: the pop-out opens `noopener`, in its own renderer process. Output
    frames missed under main-window stalls drop from 76 to 0 per 8 s.
- **Other open PRs:**
  - #531 `npm run perf`; its `compare` crash is fixed there.
  - #530 scene registry glob.
  - #515 row hints; #500, #496 synced stores.
  - #498 handoff wording.
  - #479 `setI`, already on main through #481 (close it?).
  - #471 status and agent trials.
  - #467 panel a11y; #458 issue difficulty; #441 legal fixes.
  - #400 Echoes; #378 real-song tuning; #335 Physarum 2 sort.
  - #236 Cast mode; #160 Magnet slider; #74 architecture doc.

## Open questions

- #538: on 120 Hz screens, Physarum 2's strain-box previews now step 30 times
  a second instead of 60, the pace 60 Hz screens already had. Keep that, or
  use a time budget that doubles their cost on 60 Hz screens?
- #541: a Record take now needs the main window visible, so DJ software
  covering the browser ends it. Accept that, or build #542 (record inside the
  pop-out) first?
- #536: is lazy-loading each scene's code worth doing? On slow 4G with 4× CPU
  the TV's first paint goes from 2.73 to 1.06 s. It should follow #530.
- Whichever of #532, #534 and #539 lands last tightens `size-budget.json`.

## Next up

- Once #531 merges, build #540 (`/ship` compares GPU cost by each scene's
  tenth-percentile frame).
- Two first-visit CPU costs that aren't shaders: Storm's cloud bake (about
  320 ms) and Physarum 2's init (50–120 ms).
- With the panel open, the Picture readback stall is still the largest
  main-thread cost while the Master card is in view.
