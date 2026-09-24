# Shards (`shards`)

A close cluster of flat-colour, extruded triangular plates — big panels, thin
blades, small fragments — on a star field, hard-cutting to a new arrangement
on a beat. Between cuts the plates extend along their own axes and the camera
rolls slowly clockwise. On main, registered as a draft scene.

## Where the code is

- `src/render/scenes/shards/layout.ts` — the pure side, tested by
  `tests/shards.test.ts`: `buildCluster`/`makeShard` (seeded cluster from a
  `ClusterOptions`), `randomCamera`/`cameraBasis`, the cut chooser (`CUT`,
  `pickCut`), `advanceShards` (applies a cut, grows shards, spins/dollies the
  camera), and the prism index arithmetic (`faceOf`/`cornerOf`) mirrored in
  the shader so a test can pin it.
- `src/render/scenes/shards/glsl.ts` — the material: one attribute-less
  instanced triangular prism (corner from `gl_VertexID`, shard from
  `gl_InstanceID` via `uShardA`–`uShardD`), flat per-face colour with a tip
  gradient, dark extrusion sides, a pixel-measured rim, the star-field
  ground, the bloom blur and composite.
- `src/render/scenes/shards/index.ts` — the `Scene`: settings (`SETTINGS`),
  the full-res sharp target with its own depth renderbuffer plus the
  half-res blur pair, `CUT_LISTENER` wiring, `options()` building an
  `AdvanceOptions` from resolved settings each frame.
- Plugs into `src/render/beatListener.ts` for its cut trigger (`CUT_LISTENER`,
  `cutSource`) — the shared trigger+hold+refractory module, of which Shards
  was the first migration — and into `src/render/autoTune.ts`
  (`resolveSceneSetting`) for Density/Extend/Spin/Bloom's `auto` weights. Its
  bloom chain and empty-VAO instancing pattern follow the idioms set by
  `powder.ts` and `ambience.ts`; Tessera's lattice/camera code later followed
  Shards' own idioms in turn.

## References

Studied from a 4.5 s YouTube short (`AcUcijyvpVc`), measured with `/ref`
rather than eyeballed. `/ref` bundle:
`tools/.cache/refs/AcUcijyvpVc/`. What was taken: the measured object mix
(panel/blade/fragment shapes and proportions), the palette (yellow-dominant,
with rose/violet/blue/green and pale spikes), the cut cadence and its three
flavours (new cluster + camera, camera jump, recolour in place), and the
between-cut motion (axis-extension tracking the low band, slow clockwise
roll).

## Measurements

From `report.md` in the bundle above (2026-09-09, 4.5 s clip, tempo 161.5
bpm, 13 beats):

- No beat-rank preference in the reference: activity reacts about the same
  on every beat (z -1.02..+1.29 across ranks).
- 11 hard cuts in the 4 s window measured at 30 fps, holds 33–1433 ms
  (median 167 ms); the 1.47–4.47 s burst counted 7 cuts at 33–567 ms
  (median 233 ms).
- Activity follows the low band with no lag (r +0.36); brightness moves
  against low at +400 ms (r -0.60); rot moves against onset at +333 ms
  (r -0.32); camera roll measured at -2.4 to -2.7°/s (clockwise on screen)
  in both picture regimes.
- No reaction at the 0/1 audio section boundary; `section` in our analysis
  showed no rise near it either.
- Regime 1 (69% of the clip): 22 lit objects (9 bar, 7 blob, 6 panel), hues
  yellow 64% / violet 20% / rose 12%. Regime 2 (31%, the backdrop regime):
  16 objects including 1 ring, hues shift toward orange 88%, ground
  brightens from near-black to `#500d23`.
- Our onset detector landed within 60 ms of 93% of the reference's onsets
  (92% of ours matched one of theirs), but the track carries roughly twice
  as many onsets as beats (hi-hats between beats) — the reason a raw
  per-onset cut read as too busy. Tempo lock never held the reference's
  161.5 bpm across the shoot/hear runs used to build the scene (111–176 bpm
  observed).
- `ref-shoot` compare at the reference's rank-1 beats: arrangements held
  across the −80/0/+160 ms window and changed on the beats; look matched on
  colour mix and material (yellow/rose/blue plates, pale spikes, dark sides,
  rims) at PR #105's sign-off.

## Decisions and pivots

- **2026-09-09 (design, PR #97, closed without merging):** first build —
  one triangular-prism primitive, attribute-less instancing, seeded cluster
  with panels/blades/fragments, a per-onset cut under a hand-rolled
  `minHoldSec()`/`FREE_RUN_SEC` (0.7 beat once tempo-locked, 0.25 s
  fallback, plus a free-run fallback cut after a few seconds of silence).
  The compare sheet from `ref-shoot` forced four fixes before landing:
  Density's auto-tuned creep was rebuilding the cluster every frame, so
  `FORM_REBUILD_STEP` was added — only a drag past that threshold rebuilds
  in place, an auto-tuned drift waits for the next cut; plates seen edge-on
  read as black bars, fixed with `faceCamera()` (`FACE_MIX`); bloom of the
  whole frame onto itself washed the palette toward lemon, fixed with
  `BLOOM_THRESHOLD` plus a `(1 − lum)` halo weighting; a backdrop plate
  placed at the cluster origin sliced through it, fixed by `placeBackdrop()`
  moving it behind the origin, square to the camera. Blade side faces were
  also found reading as dark poles and given the face colour instead of navy.
- **2026-09-12 (PR #105, merged):** the same design re-landed clean as the
  scene's actual first commit on main (`#97`'s branch had diverged; closed
  separately once `#105` shipped the same work). Registered first among the
  draft scenes.
- **2026-09-19 (PR #118, merged):** `beatListener.ts` introduced as the one
  shared trigger+hold+refractory module, with Shards as its first migration.
  `shouldCut`, `minHoldSec`, `FREE_RUN_SEC`, `holdT` and `sinceArrange` were
  removed; `CUT_LISTENER` + `cutSource(mode)` replace them, and the free-run
  fallback cut was dropped by design — a listener with no trigger simply
  never fires again, so silence now freezes the picture instead of cutting
  on a timer. Net behaviour change: a fired recolour now also starts the
  hold, so arrangements land very slightly less often. Cut mode's signal
  pills (`feature.onset` / `anim.lowOnset`) were added on the same PR so the
  Cut on row shows which trigger the current choice rides.

## Tuning notes

- Cut on (`cutMode`) has three positions: Every beat and Bars both read the
  broadband beat edge (Bars only cuts once a bar once tempo lock holds,
  otherwise it falls back to the raw beat — see `beatListener.ts`'s
  `sourceEdge`); Bass hits reads the low band instead, for a track whose
  broadband onset is too busy. The reference matches Every beat.
  `CUT_LISTENER`'s hold is a beat-fraction hold once `lockMin` is cleared,
  falling back to a flat seconds-based hold otherwise, floored by
  `CUT_REFRACTORY_SEC`. `FORM_REBUILD_STEP` is the threshold past which a
  Form slider (Density/Spread/Blades) drag rebuilds the cluster immediately
  rather than waiting for the next cut.
  Density's `auto` weight is deliberately the only heavy one (see
  `SETTINGS`), which is exactly what forced the `FORM_REBUILD_STEP` fix.
- Judge the look by regime: most of the time it should read like Regime 1
  (dark ground, yellow-dominant lit cluster); occasional backdrop cuts
  should read like Regime 2 (a lit dark-magenta ground plate behind the
  cluster, warmer palette). If bloom looks like it's washing the whole frame
  toward one hue, check `BLOOM_THRESHOLD` before touching Bloom itself.
- At floor quality (`ctx.quality.bloomPasses === 0`), the scene skips the
  sharp/blur/composite chain entirely and draws straight to the default
  framebuffer — cheaper, but no halo.
- Real-music validation has only gone as far as the reference's own 4.5 s
  clip and the synthetic/headless shoot runs from PR #105 and #118's
  checks; no longer real-song run has been logged.

## Known issues and next steps

- Camera distance occasionally lands close enough that one plate fills the
  frame (dolly/distance ranges in `layout.ts`'s `randomCamera` and
  `index.ts`'s `distance` setting are candidates to revisit).
- Reference rims glow a little more than ours at the measured e-fold.
- The "brightest right after the cut, then recede" hypothesis (`frontLargest`
  placing the largest panel nearest the camera, `dollyRate` receding it) is
  modelled but was never independently verified against the reference.
- No validation run has gone beyond the reference's 4.5 s clip on a real
  song.
- PR #130 ("Drives: every reactive setting picks what it reacts to") is open
  on main and is a global change across every scene's reactive settings —
  worth checking whether it touches Shards' `auto` weights or `cutMode`
  wiring once it lands.

## Materials

- `shards/AcUcijyvpVc/` — measurements kept from the `/ref` bundle `AcUcijyvpVc`: report, data, and our own shots.
The reference media for these bundles (video, frames, audio, the images built from them) stays out of this repo: in the local `tools/.cache/refs/<bundle>/` cache and the private archive (`tools/ref-archive.py`).

## Resume here

- Dev link: `npm run dev`, then `/?audio=synthetic&bpm=120#/v/shards` (add
  `&bpm=161` to sit closer to the reference's tempo).
- Re-run the reference comparison with `/ref`'s shoot step
  (`tools/ref-shoot.mjs`) against the `AcUcijyvpVc` bundle to re-check the
  compare sheet the four PR #105 fixes were built from.
- Gotcha carried from the design log: a raw per-frame read of a Form
  setting must go through `resolveSceneSetting`, never a direct getter — a
  raw read re-stomps an auto-tuned slider back to manual (see
  `index.ts`'s `options()` comment and `autoTune.ts`).
- Gotcha: `anim.onset` reaching a scene is already gridded once the user
  picks a Beat-grid stop (`gridPulse.ts`) — Shards never reads the beat
  clock itself, it only reacts to whatever edge `beatListener.ts` hands it.

## History

- `#97` (closed, not merged) — first build and the four `ref-shoot`-driven
  fixes (`FORM_REBUILD_STEP`, `faceCamera`, `BLOOM_THRESHOLD`,
  `placeBackdrop`); superseded by `#105` before merging.
- `#105` (`40bc5f0`, merged 2026-09-12) — Shards scene lands on main:
  extruded flat-colour prisms hard-cutting on every beat, from `/ref` on
  `AcUcijyvpVc`. Registered first among the draft scenes.
- `#118` (`75f6fd1`, merged 2026-09-19) — introduces `beatListener.ts` as
  the shared trigger+hold+refractory module; migrates Shards' cut onto it
  (`CUT_LISTENER`, `cutSource`), removing the free-run fallback so the scene
  stops cutting in silence; adds Cut-on signal pills.
