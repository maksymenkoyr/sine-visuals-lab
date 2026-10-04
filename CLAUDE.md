A browser-based, real-time WebGL2 audio visualizer.

- Before starting, grep `origin/main` for the change and read the description
  of any related open PR (its diff only if the overlap is still unclear).
- A doc exists only for knowledge with no single owning file. If a fact has an
  obvious home, a file whose job is exactly that thing, it goes in that file's
  header comment, not in `docs/`.
- Never write down anything countable: not a count, not a table of values, not
  a list that lives in code. Name the symbol instead ("the dials in
  `MUSIC_DIALS`", not "the seven dials"), so renaming it surfaces every
  reference. The exceptions are dated records: `docs/status.md` and a scene
  record's "Measurements" and dated "Decisions and pivots".
- Moving any slider right makes more of what its label names. If a value works
  the other way, rename the label to what grows ("Speed", not "Period") or
  invert the mapping.
- When I ask "why", "what does X mean" or "explain X", answer in plain prose
  grounded in the code: name the file/function and the one mechanism that
  causes the behaviour, then stop and wait. Don't edit code, and no plans,
  HTML artifacts or designs unless I ask for them.
- Open any plan, explanation or research answer with at most five plain lines.
  Go deeper only into the part I pick.
- If a label, UX wording or the intended look could reasonably mean two
  things, ask one short question before building. Otherwise make the obvious
  choice and say what you assumed.
- When a requested effect overlaps an existing system (Sparkle, the governor,
  the brightness dial…), build it into that system rather than adding a
  parallel one. If it's unclear which system owns it, ask one question.
- When working on a visualization, run `npm run dev` and give the user the
  link to that scene that the dev server prints at startup, not the gallery
  root. Any query goes *before* the hash; one placed after it lands on the
  gallery.
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
