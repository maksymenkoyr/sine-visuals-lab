# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Storm scene** — `src/render/scenes/storm.ts`, branch `worktree-storm-scene`
  (worktree at `.claude/worktrees/storm-scene`), draft PR #41.
  A volumetric raymarched cumulus (density = baked lobe shape × tileable 3D
  noise, both as 3D textures) lit from inside by a JS-side strike pool on
  every beat; `minQuality: "low"`, registered as a draft tile. A `Mode`
  picker (`MODES`) switches Gas / Particles / Both, and `Particle style`
  (`PARTICLE_STYLES`) picks the point behaviour — Cloud, Swarm (dragged into
  each bolt), Sparks (embers thrown off the strikes). Started as a
  `gl.POINTS` particle cloud, rewritten to a gas volume on request in the
  same session, then the particles came back as modes. Verified headlessly at high/low quality, in the gallery, and
  with the auto→manual probe sign-off; `tests/storm.test.ts` covers the pure
  helpers and both `ALL_SETTINGS` invariant suites include it. **Not yet
  judged on real music.**
- **Dev mode: D hotkey to set current value as default** — PR #40, branch
  `worktree-dev-default-hotkey` (worktree locked).
- **Chladni scene** — PR #38 (draft), branch `worktree-chladni-scene`
  (worktree locked).
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — PR #22 (draft),
  branch `worktree-mesh-grid-terrain`; the most likely to collide with `main`.
- **Always-on dev controls** — branch `worktree-agent-ae8a69d86e9c44e97`, no PR.
- **Tuning: point-at-dials workflow** — branch `worktree-tuning-spotlight`,
  no PR, far behind `main`.
- **docs/architecture.md diagram-first rewrite** — branch `worktree-docs-index`,
  no PR; #18 touched that file underneath it, so it needs a small rebase.
- Landed on `main` since the last snapshot: #36 (Dancers scene — the first
  bundled data file in the repo, see `docs/adding-a-scene.md`), #37, #39.

## Open questions

- **One-shot beat flags don't survive the render-rate cap.** `app.ts`/`tv.ts`
  advance the anim clock every rAF tick but gate `scene.render()` through
  `framePace.ts`, so on a 120Hz display `frame.beat`, `anim.lowOnset` and
  `anim.dropOnset` that land on a skipped tick never reach any scene, and
  `anim.dtSec` is the tick interval rather than the time since the scene last
  drew. Storm sidesteps both (it edge-detects rises in the pulse envelopes and
  measures its own dt — see its header); Caustics' ripple pool still reads the
  one-shots and `anim.dtSec`, so it likely drops rings and ages them at half
  speed on ProMotion hardware. Fix belongs in the loop (latch one-shots until
  a render consumes them, or pass a render-dt), not per scene.
- Dancers: which handover reads better on real music — crossfade or inertial?
  Both ship behind the `Handover` setting; keep one. The cheap renderers are
  still untested on an actual TV.
- Storm's drop burst and strike gain were set by eye against the synthetic
  feed; a pass with real music and the `/tune` loop is still owed.
- Does a *partial* auto-gain amount earn its place on a real room, or do people
  only land on 0 or 100? If the latter, a broadband-adaptive third mode is the
  better middle ground than a per-band blend.
- `tuning/params.json` ships with `"autoPin": true`, so every setting probes
  as `pinned` in DEV until `__viz.setParams({ autoPin: false })` — intended,
  or a leftover from a tuning session?

## Next up

- Review and land the Storm draft PR; then decide whether it graduates out of
  `DRAFT_SCENE_IDS`.
- Fix the one-shot/render-cap issue above in `app.ts`/`tv.ts`, then drop
  Storm's local workaround note once it's redundant.
- Watch Dancers and Storm on real music.
- Land or close #40, #38, #22; rebase `worktree-docs-index`.
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider):
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375
