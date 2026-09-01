# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Controls panel: History/Centroid/Scope traces drawing as dashed under
  load** — branch `worktree-trace-strip-dash-fix`, draft PR #60. Root cause:
  `createTraceStrip`'s `push()` and the Scope waveform's `pushWave()`
  (`src/ui/audioMeters.ts`) derive their ring-buffer column duration from CSS
  pixel width, independent of the render-rate cap — so once a scene drops
  below roughly 35fps (History/Centroid) or 60fps (Scope), one `push()`
  closes several columns at once, and every column but the first used to
  commit empty. Fixed by holding the sample that closed a burst across all of
  them, blank only past a `COLUMN_CARRY_MS` stall bound. Typecheck/tests
  green; History and Centroid live-verified continuous under CPU-throttled
  Playwright (both showed the dashing before the fix, at the same throttle).
  Scope not live-verified — synthetic feed hides that card; needs a real/
  fake-device mic capture session to exercise.
- **Caustics: Kick surge gets a position jolt** — branch
  `worktree-caustics-kick-surge` (worktree locked), draft PR #59. `driftKick`
  used to only feed the drift-phase rate term, which integrates a kick into a
  smooth ramp indistinguishable from a higher Drift speed, and was gated
  behind Drift speed itself. Now a bounded, slewed phase offset driven
  directly by `lowPulse`. Tests (595 incl. 7 new) and headless verification
  green per the PR description.
- **Storm scene** — branch `worktree-storm-scene` (worktree locked), draft
  PR #41, mid-tuning ("Storm v4: morph controls, spectrum map, lighting
  pass" per `tuning/VOCAB.md`'s latest entries). 8 commits ahead of `main`,
  20 behind — will need a rebase before merge.
- **Always-on dev controls** — branch `worktree-agent-ae8a69d86e9c44e97`
  (worktree idle, not locked), 1 commit ahead of `main`, 23 behind, no PR
  opened yet.
- **`caustics-beat-lurch` worktree** (locked) is at the same commit as
  `main` — no work done there yet; either a session about to start or a
  stale lock worth releasing if nothing's using it.

### Old scratch branches — check before reviving

`band-faders`, `fix-vc-toggle-alignment`, `focus-snap-ladder-fix`,
`governor-fix-and-caustics-followup`, `lp-merge`, `quality-preset-setting`,
`worktree-audio-visualization+auto-gain-toggle`, `worktree-band-tilt`,
`worktree-collapse-panel-cards`, `worktree-shortcut-s-panel-toggle`,
`worktree-docs-index`, `worktree-tuning-spotlight` are all 29-53 commits
behind `main` (a week or more old), each just 1-15 commits ahead. `main` has
since gained a spectrum-strip fader redesign, quality presets, and panel-fold
work through other PRs, so several of these read like earlier attempts at
the same thing — diff each against current `main` before reviving rather
than assuming it's still needed. `worktree-docs-index` in particular rewrote
`docs/architecture.md` to be the doc map; `docs/index.md` has since landed
on `main` separately (`b750f4b`) as "the vault entry point and single
doc-list owner", which may make that branch's premise redundant.

## Open questions

- Does the Scope waveform's carry fix (this session) actually clear the
  centre-line notches under load, the way History/Centroid were confirmed
  to? Needs a manual check with a real or `--use-fake-device-for-media-stream`
  mic session, not synthetic feed.
- `worktree-docs-index`: revive (rebase the architecture.md rewrite onto
  current `main`) or drop as superseded by `docs/index.md`?
- The dozen old scratch branches above: prune, or is anything in them still
  wanted?

## Next up

- Review/merge draft PR #60 (this session's trace/waveform fix).
- Review draft PR #59 (Caustics Kick surge) — tests and headless check
  already green.
- Continue Storm tuning on PR #41, then rebase onto current `main`.
- Decide the fate of the idle `worktree-agent-ae8a69d86e9c44e97` branch and
  the old scratch branches listed above.
