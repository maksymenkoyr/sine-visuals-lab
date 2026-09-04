# CLAUDE.md

A browser-based, real-time WebGL2 audio visualizer with a phone→TV pairing mode.
Two entry points: `index.html` → `src/app.ts` (phone/controller + gallery) and
`tv.html` → `src/tv.ts` (the paired display). See `README.md` for the pitch and
`docs/index.md` for how the pieces fit together.

## Two rules for keeping this documentation honest

**1. A doc only exists for knowledge with no single owning file.** If a fact has
one obvious home — a file whose job is exactly that thing — it belongs in that
file's header comment, not in `docs/`. Before adding a new doc, check whether an
existing file header already owns the knowledge; if so, extend that comment and
link to it instead.

**2. Never write down anything countable.** Not a count, not a table of values —
name the symbol instead ("the dials in `MUSIC_DIALS`", not "the seven dials").
A sentence that names a symbol can't go stale silently: renaming the symbol
surfaces every reference, and the reader sees the real count by looking. This is
why nothing here is generated — there's nothing generated to keep in sync.

Corollary: if you're about to write a specific number, param name, or list that
lives in code, stop and name the file/symbol instead. `docs/status.md` is the one
exception — it's a snapshot regenerated wholesale each session (see `/wrap`), not
a standing claim, so specifics there are expected to age out immediately.

## Commands that gate a change

- `npm run typecheck` — `tsc -b` for both the root and `server/` tsconfigs. Run
  this before considering any TS change done.
- `npm run test` — Vitest, one file per pure module under `tests/`.
- `npm run dev` — visualizer + controller over HTTPS (required for mic access).
- `npm run dev:worker` — the Cloudflare Worker backend, for phone/TV pairing.

`npm run typecheck` and `npm run test` also run in CI on every pull request, and
gate the deploy that a push to `main` triggers — see
`.github/workflows/deploy.yml`.

## Read this before touching X

| Touching... | Read first |
|---|---|
| Any broad question — architecture, adding a scene, tuning, what's in flight | `docs/index.md` — the documentation map |
| The wire format between phone and TV | `src/net/protocol.ts` header — includes the legacy-decode sunset condition |
| Why a setting resolves the way it does under Auto | `src/render/autoTune.ts` and `src/render/musicProfile.ts` headers |
| The settings/uniform system itself | `src/render/sceneSettings.ts` header |
| The saved-look share-code format | `src/render/sceneLooks.ts` header — links in the wild outlive the schema |
| The build target (`es2017`) | `vite.config.ts`, the comment at the `target:` line |

## Standing rules not worth their own doc

- Licensed AGPL-3.0-or-later. New dependencies must be AGPL-compatible, and any
  third-party code bundled into the client build gets an entry in
  `THIRD-PARTY-NOTICES.md`.
- Don't port third-party implementations into a scene — write it as independent
  work. (See the git history around "Rewrite Mesh Grid as independent work.")
- When working on a visualization, start `npm run dev` and hand the user a
  direct link to that scene — `https://localhost:<port>/#/v/<sceneId>` — not the
  gallery root. The scene id is the `id` field on the `Scene` object in
  `src/render/scenes/`. Any query (`?audio=synthetic&bpm=…`, `?quality=…`) goes
  *before* the hash — `src/app.ts` reads `location.search`, and a query placed
  after the hash silently lands on the gallery.

## Git & PRs

This repo has a fast-moving `main` and concurrent sessions. Always branch from
freshly fetched `origin/main`, rebase (not merge) before opening a PR, and
re-check for divergence right before pushing. Never rewrite shared history
without explicit confirmation.

## Session close

Run `/wrap` to regenerate `docs/status.md` and, if a tuning session happened,
append to `tuning/VOCAB.md`.
