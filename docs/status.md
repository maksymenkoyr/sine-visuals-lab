# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-06_

## In flight

- **Release notes** — draft #396: `/release` writes a plain-words release
  story with pictures into the release PR; it opens the GitHub Release (the
  generated list folds under it) and is where `/video-release-stable` starts.
  Also fixes the generated list, which showed every commit since PRs began
  landing as merge commits. The 0.3.0 notes are drafted (twelve pictures shot
  from Insiders, nothing uploaded) in a private preview artifact,
  claude.ai/artifact/MSZD7camR95HSvs5CHfBsp, whose `notes.md` is the source.
- **Scenes:** #395 Sweep Shape drift and Morph; #377 Fractal Grid; #376
  Echoes; #367 Long Play Pro views and Lift; #366 Chladni Toss, plates and
  sand colour; #335 Physarum 2 agent sort.
- **App:** #387 typed slider values; #385 owner-only Play in a room; #236
  Cast mode; #160 magnet slider.
- **Plans and docs:** #384 tempo and mic plan; #378 real-song tuning check;
  #74 architecture doc.

## Open questions

- 0.3.0 notes: are the pictures, the headline and the six highlights right?
  Approving them means uploading the pictures to the Insiders pre-release and
  opening the release PR.
- Physarum 2's defaults barely pulse with real music — make the user's
  look's drives the defaults? (Physarum 2 record, Known issues.)

## Next up

- Merge #396, then `/release` for 0.3.0 from the drafted notes; after the
  release, `/video-release-stable`.
- Prune worktrees whose PRs merged (check each with `gh pr view`).
