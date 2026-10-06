# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-04_

## In flight

- **Release promo** — draft #313 (`worktree-promo-demo-first`). The v0.2.0
  video: `~/Movies/sine-visuals-lab-v0.2.0-promo/`, 31.9 s. The PR makes
  `tools/promo` produce it: scene takes hear the song through a fake mic,
  demos first, pop-out/Cue/Play and the room drawn as a laptop with lit keys
  over its second screen, the list card scrolling low in the frame, no fades.
  `/release-promo` (`.claude/commands/release-promo.md`, its "Scenario")
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

- Merge #313, then run `/release-promo` after the next Stable release — it
  takes the release, reuses the last song and look unless given new ones,
  and starts from the changelog.
- Prune worktrees whose PRs merged: `npm run prune-worktrees -- --yes`
  (dry run without `--yes`); once it's on main the SessionStart hook runs it
  in the background every session.
