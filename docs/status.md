# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Tuning spotlight** — branch `worktree-tuning-spotlight` (this worktree),
  one commit ahead of `main` and five behind it. Adds the focus/scrub/write-back
  channel, `draft` settings, `?tune=` slots, and fixes the synthetic-audio URL
  (the documented form put the query after the hash, so it never worked).
  Typecheck, tests and build pass as it stands; it has not been driven through a
  live session yet.
- Three other unmerged branches, each one commit ahead of `main`:
  `worktree-listening-post` and `worktree-audio-visualization+auto-gain-toggle`
  (both locked worktrees), and `worktree-docs-index` (a diagram-first rewrite of
  `docs/architecture.md`).

## Open questions

- **`main`'s controls-panel rewrite stands between the spotlight and a merge.**
  The Viz Controls redesign rewrote `src/ui/deviceMenu.ts` wholesale and now
  builds rows through a `createControlRow` factory. `DeviceMenuDeps`,
  `renderSceneSettings` and `sceneRowHandles` all survived, but the spotlight's
  focus ring, dimming, draft partition and scrub routing were written against
  the old inline row construction — they need re-applying to the factory, not
  merging textually. Every unmerged branch above touches this same file.
- **`rippleWidth` (`src/render/scenes/caustics.ts`) is still a draft.** It was
  promoted from a shader constant as the worked example for
  promote → scrub → keep/draft/bake, but nothing has scrubbed it: no session has
  run against it and no params file carries a value. It stays a draft until one
  does — resolving it either way now would be guessing at the thing the loop
  exists to answer.
- `tuning/VOCAB.md` is still empty, and stays that way until a session resolves
  a phrase into a value. The write-back path exists to fill it; nothing has
  driven it yet.

## Next up

- Rebase `worktree-tuning-spotlight` onto `main`, re-apply the menu changes to
  `createControlRow`, then open the PR.
- Run one live session against `rippleWidth` — that is both the end-to-end check
  of the spotlight and the first `tuning/VOCAB.md` entry.
- Delete the local branches `focus-snap-ladder-fix` and
  `governor-fix-and-caustics-followup`: their content shipped to `main` with the
  governor/caustics-ladder PR, so they are leftovers, not work in progress.
