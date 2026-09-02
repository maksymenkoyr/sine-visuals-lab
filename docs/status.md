# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Stage-1 public release shipped (2026-09-02).** The project is now **Sine
  Visuals Lab**: repo renamed to `maksymenkoyr/sine-visuals-lab` and made
  public, live at sinevisualslab.com (PR #67 wired the custom domain). PRs
  #64/#66/#68 landed the legal set: `CLA.md` (Apache-ICLA-derived, signed via
  CLA Assistant, PR-comment fallback), `CONTRIBUTING.md`, `PRIVACY.md`
  (claims verified against `src/net/protocol.ts` and `server/room.ts`),
  README trademark carve-out, and the AGPL §13 source links in the gallery
  header and TV corner — both fed from `src/brand.ts`, the single home of
  `PRODUCT_NAME`/`SOURCE_URL`. Verified live in the deployed bundle.
- **Branch protection on `main`**: PRs required (zero approvals — solo),
  the `ship` CI job required, force-pushes/deletions blocked, admins exempt.
- **CLA Assistant linked**, gist text identical to `CLA.md` on `main` — but
  its status check has not run yet (every existing PR predates the linking).
- **Storm scene** — draft PR #41, the only open PR; long-running tuning
  branch (`worktree-storm-scene`), far behind `main`, needs a rebase before
  merge.
- A dozen old scratch branches/worktrees linger (see `git worktree list`);
  several predate merged redesigns — diff against `main` before reviving.

## Open questions

- CLA Assistant's check name (likely `license/cla`) is unconfirmed until its
  first run — required-checks list can't include it yet.
- Old scratch branches and idle worktrees: prune, or is anything still wanted?

## Next up

- On the next PR opened: confirm the CLA Assistant check runs, then add it to
  `main`'s required status checks (Settings → Branches).
- User-side stage-1 leftovers: none — domain, org name, and repo are done.
- Stage 2 (deferred until a paying user appears): merchant-of-record or
  entity, hosted-instance ToS, real privacy policy, trademark filing
  (classes 9/41/42). The CLA collected from day one is what keeps
  dual-licensing open.
- Storm PR #41: continue tuning, rebase, land.
