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
- Every issue you file gets a difficulty label (`high dif`, `mid dif`,
  `low dif`) and, when a person is needed at some
  point or likely (over 30%), `human`. `docs/issue-labels.md` has the rules;
  a hook refuses `gh issue create` without a difficulty label.
- When a change is settled (I asked for it, straight away or after we
  discussed it) and you're sure its plan would be half the change or less,
  don't write the change: put the plan in a `haiku-coder` agent's prompt and
  let it write it. Clear cases: new files or modules with their tests, one
  edit repeated across many places. This holds for anything written to
  files: code, tests, docs, bulk edits. The agent reads this file, so the
  plan names each file and edit and the checks to run. Read its diff against
  the plan before `/ship`. If you're unsure, or the result has to be judged
  as you go (tuning by eye), write it yourself.
- Finish every change with `/ship`, and close a session with `/wrap`.

Before touching one of these, read what is listed:

- Any broad question — architecture, adding a scene, tuning, what's in flight → `docs/index.md`
- The binary feature-frame format (host to screens) → `src/net/protocol.ts` header
- The room, pairing, the phone controller, or the TV's look → `src/net/roomMessages.ts` header (the JSON message vocabulary) and `server/roomRules.ts` header (who may join and send); `src/net/lookSync.ts` header for how the look stays in step
- Why a setting resolves the way it does under Auto → `src/render/autoTune.ts` and `src/render/musicProfile.ts` headers
- The settings/uniform system itself → `src/render/sceneSettings.ts` header
- A scene's per-item settings or a custom widget in its Scene card → `src/render/sceneItems.ts` header, then `src/ui/widgets/registry.ts` header
- Making a setting audio-reactive → `src/render/drives.ts` header — a scene reads `<key>Drive(…)`, never a signal directly
- Any word the panel shows for signals, jacks, wires or reactive settings → `docs/vocabulary.md`
- Anything the site records about its visitors, or `PRIVACY.md` → `server/usage.ts` header; `server/roomRules.ts` and `server/roomCore.ts` headers for what a claimed room keeps
- The pop-out output window, Cue/Play, or a localStorage store that changes how a scene looks → `src/net/outputSync.ts` header — such a store must register with `src/net/syncedStores.ts` to reach the output or a room's TV
- The Cue/Play keys, or a setting that must not glide (`glide: false`) → `src/ui/outputKeys.ts` header, then `src/net/outputGlide.ts` header
- The saved-look share-code format → `src/render/sceneLooks.ts` header — links in the wild outlive the schema
- The build target (`es2017`) → `vite.config.ts`, the comment at `target:`
- A scene that hashes a noise lattice, or grows a phase on a noise coordinate → `src/render/noiseHash.ts` header
- The tempo tracker (`src/audio/features.ts`, `src/audio/tempoAnalyzer.ts`, `src/render/beatClock.ts`, `src/render/tempoSettle.ts`, `src/render/metronome.ts`) → `tests/tempoEval.test.ts` header — run `npm run eval:tempo` before and after
- The version label, the Stable/Insiders channels, or releasing → `src/version.ts` header
- A scene's own version → `tools/sceneVersionLib.mjs` header
- A `?url` import, or any file the page fetches from its own origin after load → `src/pinnedAssets.ts` header
