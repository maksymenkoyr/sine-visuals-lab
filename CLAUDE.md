# CLAUDE.md

A browser-based, real-time WebGL2 audio visualizer with a phone→TV pairing mode.
Two entry points: `index.html` → `src/app.ts` (phone/controller + gallery) and
`tv.html` → `src/tv.ts` (the paired display). See `README.md` for the pitch and
`docs/index.md` for how the pieces fit together.

## Git workflow

### Before starting work

Check whether the change already exists: run
`git fetch && git log origin/main --oneline -20` and grep for the relevant
symbol on `origin/main` before implementing a fix. Parallel sessions often land
the same change.

### Branching

Never edit files while on `main`. Before any code change, create or switch to a
git worktree branch (`git worktree add ../<repo>-<topic> -b <topic>`), do all
work there, then open a PR. If you notice you've started editing on main, stop
and move the work before continuing.

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

## Testing

### Verification before claiming done

For every visualization/UI change: run `npm run typecheck`, the full test suite,
and capture headless Playwright before/after screenshots. Only report success
after all three pass; include the screenshot paths in your summary.

## Read this before touching X

| Touching... | Read first |
|---|---|
| Any broad question — architecture, adding a scene, tuning, what's in flight | `docs/index.md` — the documentation map |
| The wire format between phone and TV | `src/net/protocol.ts` header — includes the legacy-decode sunset condition |
| Why a setting resolves the way it does under Auto | `src/render/autoTune.ts` and `src/render/musicProfile.ts` headers |
| The settings/uniform system itself | `src/render/sceneSettings.ts` header |
| Making a setting audio-reactive (what it reacts to: a hit, a grid tick, a level, a drawn frequency line) | `src/render/drives.ts` header — a scene reads `<key>Drive(…)`, never a signal directly |
| The saved-look share-code format | `src/render/sceneLooks.ts` header — links in the wild outlive the schema |
| The build target (`es2017`) | `vite.config.ts`, the comment at the `target:` line |
| A scene that hashes a noise lattice, or adds a growing phase to a noise coordinate | `src/render/noiseHash.ts` header — the mobile seams fix, and the two halves every scene must take together |
| Any existing scene | `docs/scenes/<id>.md` — its record: references, measurements, every decision and pivot, what's still off, how to resume |
| A paid scene, or anything under `src/render/scenes/private/` | `src/render/scenes/privateScenes.ts` header — the contract, and why that folder never reaches this repo or the deployed site |

## Standing rules not worth their own doc

- Licensed AGPL-3.0-or-later. New dependencies must be permissively licensed
  (MIT, BSD, Apache-2.0, ISC, OFL or similar) — never GPL, LGPL or AGPL, which
  would bind the separately sold scenes combined with this code; the why is in
  `CONTRIBUTING.md`. Any third-party code bundled into the client build gets an
  entry in `THIRD-PARTY-NOTICES.md`.
- Don't port third-party implementations into a scene — write it as independent
  work. (See the git history around "Rewrite Mesh Grid as independent work.")
- When working on a visualization, start `npm run dev` and hand the user a
  direct link to that scene — not the gallery root. The dev server prints the
  link to the scene in flight at startup — the one whose files git says are
  modified, untracked, or changed on this branch — so copy that line
  (`vite-scene-links-plugin.ts` owns the detection and what counts as "in
  flight"). Any query (`?audio=synthetic&bpm=…`, `?quality=…`) goes *before*
  the hash — `src/app.ts` reads `location.search`, and a query placed after
  the hash silently lands on the gallery.
- Once a detailed plan exists, execute it with Sonnet whenever possible (an
  agent with `model: "sonnet"`). Keep the stronger model for planning and review.
- Paid scenes are closed. Their code lives in the private scenes repo,
  checked out at the gitignored `src/render/scenes/private/`
  (`privateScenes.ts` explains the hook). Never copy, commit or push a paid
  scene's code, record or references into this public repo, a public
  branch, or a public PR. Its record is `private/<id>/RECORD.md`, not
  `docs/scenes/<id>.md`.
- Every free scene has a record at `docs/scenes/<id>.md`, following
  `docs/scenes/_template.md`: everything someone picking the scene back up
  would need. Create it with the scene (`/new-scene`), and update it in the
  same PR as any change to the scene; `/ref`, `/tune` and `/wrap` say what to
  add. A record spans code, references and history, so it has no single
  owning file (rule 1). Its "Measurements" and dated "Decisions and pivots"
  entries are dated records, so specific numbers are fine there (rule 2's
  corollary, like `docs/status.md`); elsewhere in it, name the symbol. It's
  public: references are credited as inspiration or study, and downloaded
  reference media (frames, clips, audio, comparison sheets) never goes in
  this repo — a record names the `/ref` bundle instead
  (`tools/ref-archive.py` keeps bundles in a private archive).
- Everything a scene was built with is kept, and its record's "Materials"
  section says where. The split is by whose it is:
  - **Ours goes in the repo, under `docs/scenes/<id>/`:**
    - the measurements kept from each `/ref` bundle, via
      `tools/ref-keep.py` (it knows which files are ours);
    - working scripts, in `scripts/` — or `tools/` if general. A script
      that only ever lived in a session's scratch folder is lost when that
      folder is cleaned;
    - the source of any artifact made for the scene, in `artifacts/`, with
      reference images replaced by a placeholder.
  - **The reference's own material** (videos, frames, audio, pasted stills,
    images built from them) stays in the local `/ref` cache and the private
    archive. Anything used outside `/ref` — a pasted still, frames pulled by
    hand — still goes under `tools/.cache/refs/<name>/`, so it's kept with
    the rest.

  `/wrap` checks nothing the session used is left unsaved.

  A scene that's sold separately (not under the AGPL) is the exception: its
  code, record and materials all live in the private repo it ships from, and
  nothing about it — record, measurements, screenshots, artifacts — goes in
  this public repo.

## Communication style

### Answering questions

When I ask 'why', 'what does X mean', or 'explain X', answer in plain prose
grounded in the actual code first. Do NOT produce plans, HTML artifacts, visual
pages, or multi-step designs unless I explicitly ask for them. Name the concrete
file/function and the one mechanism that causes the behaviour, then stop and
wait.

## Architecture conventions

### Scope discipline

When a requested effect overlaps an existing system (e.g. Sparkle, governor,
brightness dial), integrate into that system rather than adding a standalone
parallel effect. Ask one clarifying question if unsure which system owns the
behaviour.

## Git & PRs

This repo has a fast-moving `main` and concurrent sessions. Always branch from
freshly fetched `origin/main`, rebase (not merge) before opening a PR, and
re-check for divergence right before pushing. Never rewrite shared history
without explicit confirmation.

## Session close

Run `/wrap` to regenerate `docs/status.md` and, if a tuning session happened,
append to `tuning/VOCAB.md`.
