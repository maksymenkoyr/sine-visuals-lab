# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-24_

## In flight

- **Audio engine (v5)**: the analysis built in `~/projects/audio-subsystem/v5`
  replaces the app's own. Parent #675, label `audio engine`.
  - Draft #674 (branch `worktree-audio-engine-v5`) is the first half:
    - `src/audio/engine/` is in, identical frame for frame to v5;
    - every capture runs it, and its reading (`FeatureFrame.engine`) reaches
      the pop-out, the wire and a TV;
    - nothing reads it yet, so the picture is unchanged.
  - Parts: #677 hits and Bass/Mid/Treble, #678 beats and tempo plus removing
    the old trackers, #679 bench score, #680 `docs/audio-engine.md`.
- **Ready:** #669 (Meters: the Sound card).
- **Drafts:**
  - #676 Insiders blank page
  - #648 Mic Auto room-path gate (overlaps #677's gate rule)
  - #666, #652, #651 new scenes
  - #647 token labels
  - #646 usage source
  - #641 scene pages
  - #599 Caustics rings
  - #569 rate limits
  - #500 synced stores
  - #479 `setI`
- **Mic calibration (#577)** and the 1.0.0 road (#616) are unchanged since
  2026-10-21.

## Open questions

- The engine's design calls, on #675:
  - keep the silence gate on engine hits?
  - should Lock mean "a steady pulse is playing"?
  - should the metronome adopt v5's downbeats?
  - merge #674 before #677, or together?

## Next up

- `/handoff #675` builds #677 first.
