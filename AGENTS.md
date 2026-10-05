# AGENTS.md

The working rules for this repo.

A browser-based, real-time WebGL2 audio visualizer. Entry points: `index.html` →
`src/app.ts` (laptop host, phone controller and gallery) and `tv.html` →
`src/tv.ts` (paired display).
`docs/index.md` is the map of how the pieces fit.

## Git

- Never edit on `main`. Work on a worktree branch and land it through a PR.
- Before starting, fetch and check whether `origin/main` already has the change
  (its recent log, and a grep for the symbol), and whether an open PR already
  covers it (`gh pr list`). If one looks related, read its description
  first (its diff only if the overlap is still unclear). Parallel
  sessions often land the same fix.
- Branch from freshly fetched `origin/main`. Rebase (never merge) before opening
  a PR, and check again for divergence right before pushing. Never rewrite
  shared history without explicit confirmation.

## Done means

- Any TS change: `npm run typecheck` (root and `server/`) and `npm run test`.
- Any visualization or UI change also needs headless Playwright screenshots
  from before and after, and their paths in your summary. Put a couple of
  them in the PR body: `npm run pr-shots -- before.png after.png` prints the
  markdown (never for a paid scene).
- A bug isn't fixed until every other place the same behaviour shows up has
  been checked too.
- CI runs the same two gates on every PR and before every deploy. The channels
  and releasing are explained in the `src/version.ts` header.

## Two rules for keeping documentation honest

- Explain code in a comment at the top of its file. Write a doc in `docs/`
  only for an explanation that spans several files.
- In comments and docs, don't copy numbers or lists from the code: name the
  variable that holds them ("the dials in `MUSIC_DIALS`", not "the seven
  dials"). Dated notes (`docs/status.md`, a scene record's measurements and
  dated decisions) are the exception.

## Read this before touching X

| Touching... | Read first |
|---|---|
| Any broad question — architecture, adding a scene, tuning, what's in flight | `docs/index.md` |
| The binary feature-frame format (host to screens) | `src/net/protocol.ts` header |
| The room, pairing, the phone controller, or the TV's look | `src/net/roomMessages.ts` header (the JSON message vocabulary) and `server/roomRules.ts` header (who may join and send); `src/net/lookSync.ts` header for how the look stays in step |
| Why a setting resolves the way it does under Auto | `src/render/autoTune.ts` and `src/render/musicProfile.ts` headers |
| The settings/uniform system itself | `src/render/sceneSettings.ts` header |
| A scene's per-item settings or a custom widget in its Scene card | `src/render/sceneItems.ts` header, then `src/ui/widgets/registry.ts` header |
| Making a setting audio-reactive | `src/render/drives.ts` header — a scene reads `<key>Drive(…)`, never a signal directly |
| Any word the panel shows for signals, jacks, wires or reactive settings | `docs/vocabulary.md` |
| Anything the site records about its visitors, or `PRIVACY.md` | `server/usage.ts` header; `server/roomRules.ts` and `server/roomCore.ts` headers for what a claimed room keeps |
| The pop-out output window, Cue/Play, or a localStorage store that changes how a scene looks | `src/net/outputSync.ts` header — such a store must register with `src/net/syncedStores.ts` to reach the output or a room's TV |
| The Cue/Play keys, or a setting that must not glide (`glide: false`) | `src/ui/outputKeys.ts` header, then `src/net/outputGlide.ts` header |
| The saved-look share-code format | `src/render/sceneLooks.ts` header — links in the wild outlive the schema |
| The build target (`es2017`) | `vite.config.ts`, the comment at `target:` |
| A scene that hashes a noise lattice, or grows a phase on a noise coordinate | `src/render/noiseHash.ts` header |
| Any existing scene | `docs/scenes/<id>.md`, its record |
| The tempo tracker (`src/audio/features.ts`, `src/audio/tempoAnalyzer.ts`, `src/render/beatClock.ts`, `src/render/tempoSettle.ts`, `src/render/metronome.ts`) | `tests/tempoEval.test.ts` header — run `npm run eval:tempo` before and after |
| A paid scene, or anything under `src/render/scenes/private/` | `src/render/scenes/privateScenes.ts` header |
| The version label, the Stable/Insiders channels, or releasing | `src/version.ts` header |
| A scene's own version | `tools/sceneVersionLib.mjs` header |
| A `?url` import, or any file the page fetches from its own origin after load | `src/pinnedAssets.ts` header |

## Standing rules

- **Short answers.** Keep answers short: at most five plain lines, deeper
  only into the part I pick. When I ask why or what something means, answer
  and stop: no edits, plans or artifacts unless I ask.
- **Ask about wording and look.** If a label, UX wording or the intended look
  could reasonably mean two things, ask one short question before building.
- **Sketches before builds.** When a design ask leaves the look or the
  interaction open, first show two or three rough sketches in one artifact
  that differ in idea, not styling, and build (prototype or code) only the
  one the user picks.
- **Real audio signs off reactions.** Never sign off how a scene reacts on
  synthetic audio alone: run `tools/tune-real.mjs` (a real song, then
  silence) and report its table.
- **Scene links.** When working on a visualization, run `npm run dev` and
  give the user the link to that scene that the dev server prints at startup,
  not the gallery root. Any query goes *before* the hash; one placed after the
  hash lands on the gallery.
- **Licensing.** The repo is AGPL-3.0-or-later. New dependencies must be
  permissively licensed (MIT, BSD, Apache-2.0, ISC, OFL or similar), never
  GPL, LGPL or AGPL; `CONTRIBUTING.md` says why. Any third-party code bundled
  into the client gets an entry in `THIRD-PARTY-NOTICES.md`.
- **Independent work.** Don't port third-party implementations into a
  scene; write the scene as independent work.
- **Scene records.** Every free scene has a record, `docs/scenes/<id>.md`,
  started from `docs/scenes/_template.md`. Update it in the same PR as any
  change to the scene, and keep what the scene was built with as its
  "Materials" section says. Records are public: credit references as
  inspiration or study, and never put downloaded reference media in this
  repo.
- **Paid scenes are closed.** Their code, record and materials live in the
  private scenes repo, checked out at the gitignored
  `src/render/scenes/private/`. Nothing about them — code, record,
  references, screenshots — goes into this repo, a public branch or a public
  PR.