# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-04_

## In flight

- **Release promo** — draft #313 (`worktree-promo-demo-first`). The v0.2.0
  video the user signed off: `~/Movies/sine-visuals-lab-v0.2.0-promo/`, 30 s.
  The PR makes `tools/promo` produce it: scene takes hear the song through a
  fake mic, demos first, the list card scrolling low in the frame, the room
  shown as laptop over TV. `.claude/commands/promo.md` "The agreed video"
  records every call the user made, so the next run comes out the same.
- **Other open PRs:** #317 CLAUDE.md review (draft); #307 Toon Rave "Energy"
  label; #236 Output Cast mode (draft); #160 magnet slider; #74 architecture
  doc (draft).

## Open questions

- Physarum 2's defaults barely pulse with real music (beat pulse 1.08 vs 1.48
  for the user's look, whose drives are Speed boost/pump, Seed and Flash on
  the beat and low onset) — make those drives the defaults? (Physarum 2
  record, Known issues.)
- The video was not posted; posting it needs the song's rights (a Primate
  bootleg).

## Next up

- Merge #313, then run `/promo` for the next Stable release (ask for the
  song and a Looks share link first).
- Prune worktrees whose PRs merged (47 besides `main`; check each one's PR
  with `gh pr view`).
