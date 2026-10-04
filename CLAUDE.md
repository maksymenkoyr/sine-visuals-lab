A browser-based, real-time WebGL2 audio visualizer.

- Before starting, grep `origin/main` for the change and read the description
  of any related open PR (its diff only if the overlap is still unclear).
- Explain code in a comment at the top of its file. Write a doc in `docs/`
  only for an explanation that spans several files.
- In comments and docs, don't copy numbers or lists from the code: name the
  variable that holds them ("the dials in `MUSIC_DIALS`", not "the seven
  dials"). Dated notes (`docs/status.md`, a scene record's measurements and
  dated decisions) are the exception.
- Keep answers short: at most five plain lines, deeper only into the part I
  pick. When I ask why or what something means, answer and stop: no edits,
  plans or artifacts unless I ask.
- If a label, UX wording or the intended look could reasonably mean two
  things, ask one short question before building.
- The repo is AGPL-3.0-or-later. New dependencies must be permissively
  licensed (MIT, BSD, Apache-2.0, ISC, OFL or similar), never GPL, LGPL or
  AGPL; `CONTRIBUTING.md` says why. Any third-party code bundled into the
  client gets an entry in `THIRD-PARTY-NOTICES.md`.
- Don't port third-party implementations into a scene; write it as
  independent work.
- Every free scene has a record, `docs/scenes/<id>.md`, started from
  `docs/scenes/_template.md`. Read it before touching the scene, update it in
  the same PR as any change to the scene, and keep what the scene was built
  with as its "Materials" section says. Records are public: credit references
  as inspiration or study, and never put downloaded reference media in this
  repo.
- Paid scenes are closed. Their code, record and materials live in the
  private scenes repo, checked out at the gitignored
  `src/render/scenes/private/` (the contract: the
  `src/render/scenes/privateScenes.ts` header). Nothing about them — code,
  record, references, screenshots — goes into this repo, a public branch or a
  public PR.
- Work solo unless a task would make one context read far more than it needs.
  When delegating to a subagent or a workflow `agent()`, give it the cheapest
  `model` and `effort` that fits:

  | Task | Model, effort |
  |---|---|
  | Find files, sweep greps, list call sites, read logs | Haiku, low |
  | Edits spelled out exactly (rename, move, apply a listed change) | Haiku, low |
  | Execute a written plan, write tests, fix typecheck errors | Sonnet, medium |
  | Headless screenshot runs, measurement scripts | Sonnet, low |
  | First pass of a review (finding candidates) | Sonnet, medium |
  | Plans, architecture, verifying findings, final review | Opus, high |
  | Look and shader work judged by eye, DSP and tempo | Opus |
- `/exec-cheap` runs only when the user types it: never suggest it or route
  work to it, and never use it for paid scenes.
- Finish every change with `/ship`, and close a session with `/wrap`.

| Before touching | Read first |
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
| The tempo tracker (`src/audio/features.ts`, `src/audio/tempoAnalyzer.ts`, `src/render/beatClock.ts`, `src/render/tempoSettle.ts`, `src/render/metronome.ts`) | `tests/tempoEval.test.ts` header — run `npm run eval:tempo` before and after |
| The version label, the Stable/Insiders channels, or releasing | `src/version.ts` header |
| A scene's own version | `tools/sceneVersionLib.mjs` header |
| A `?url` import, or any file the page fetches from its own origin after load | `src/pinnedAssets.ts` header |
