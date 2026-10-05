# Fractal Grid (`fractalgrid`)

The Mandelbrot set drawn as graph paper: white lines on black, every bulb
filled with a square grid of its own that bends and crowds into fans,
circles and petals where the orbit slows down, and turns solid white where
the lines crowd past a pixel. The camera dives into the root of one bulb and
back out to the whole set, again and again. The music sets how fast it
dives; the grid steps on bass hits, folds on the bar, lines thicken on the
beat and a drop inverts the picture for a few bars. Draft scene.

## Where the code is

- `src/render/scenes/fractalgrid/motion.ts` — the pure clocks, pinned by
  `tests/fractalgrid.test.ts`: `stepDive`/`createDiveState`/`DiveState`
  (dive phase, target, grid offset, fold, inversion), `diveLogZoom` (the
  raised-cosine round trip), `foldPosition` (the fold's ping-pong over
  `FOLD_SPAN`), `DIVE_TARGETS` built from `cardioidRoot`/`twoBulbRoot` with a
  depth each, `targetDepth`/`MAX_DEPTH`, and the whole-set framing
  `HOME_X`/`HOME_HALF_W`/`HOME_HALF_H`.
- `src/render/scenes/fractalgrid/index.ts` — the `Scene` via
  `createFullscreenScene`: `SETTINGS`, `FRAG` (camera, the iteration with
  dz/dc, `lineCover`'s box-filtered lines, the escaped points' edge line,
  invert and Colours), and `extraUniforms`, which resolves settings and
  drives into `stepDive`'s inputs once a frame. `MIN_LINE_PX` is the floor
  that makes crowded lines read white; `ITER_CAP` times the quality proxy
  `uDetail` caps Iterations.
- Plugs into: drives (`drives.value`/`drives.fired` for Dive speed, Step,
  Fold, Line weight and Invert), the room palette roles (`uPalGround`,
  `palRamp`, for Colours), and the quality proxy `uDetail`.

## References

- **"Mandelgrid"** by u/ReplacementFresh3915, r/creativecoding, posted
  2025-12-16 (<https://www.reddit.com/r/creativecoding/comments/1pnvb6p/mandelgrid/>),
  1080×1920, 30 fps, 59 s, silent. The author didn't say how it was made.
  Studied for its look and camera, all 59 s, in the `/ref` bundle
  `mandelgrid` (`tools/.cache/refs/mandelgrid/`). The technique here was
  worked out from the measurements, not taken from the post; no code was
  published with it.

## Measurements

2026-10-05, reference only (no audio, so no "ours hears" column):

- **Ground and ink**: ground `#000000` in every regime, lines near-white
  (core luminance 0.81–0.96). No colour; reflook's "spring 150°" hue is noise
  on near-grey.
- **Stroke**: 1.9–2.3 px where the whole set is in view, 4.6 px and 11–12 px
  in the zoomed regimes: line width grows with the cell, i.e. a share of the
  cell, not a pixel width. Where cells shrink below a pixel the picture goes
  white (the cusp's core, the set's edge), so lines have a pixel floor too.
- **Camera**: |zoom| 1.03 log-scale/s on average, rotation about 0°/s per
  regime. The clip starts deep on the main cusp on a plain square grid,
  zooms out through grey aliasing noise (~1.8–2.4 s) into the cusp's fan
  (3 s), a circle-and-spiral flower (6.7 s), mostly white with black leaves
  (11–20 s), a thick net (24 s), gridded bulbs (26.6 s), the whole set
  (~41–46 s), and dives back into the cusp.
- **"Cuts" and the strobe**: the scan counted 19 hard cuts and a 3.1 Hz
  strobe (9.1–12.1 s). The every-frame burst at 8.88 s shows the set's edge
  holding still while white bands sweep across in 3–4 frames: grid lines
  several screens wide passing, not edits.
- **Ours** (2026-10-05, 960×540 headless, defaults): the whole set, the
  cusp's fan and the circle flowers along the cusp's filament all match the
  reference's frames at 40.8 s, 26.6 s and 6.7–9.8 s by eye; portrait
  (540×960) frames like the reference's own.
- **Where each root is still busy**: shots of every target at 2, 3.5, 5 and
  6.5 e-folds below the whole set (Dive depth at 9 for the shots): the cusp
  stays rich down to 9 e-folds; every other root is richest at 3.5–5 and
  turns into a few giant cells by 6.5. That gave each `DIVE_TARGETS` entry
  its own depth.
- **GPU** (`tools/gpu-bench.mjs --app --dpr 2`, 3024×1890): 12.7 ms per
  frame at the whole set, 14.3–15.6 ms deep in a dive, against Caustics
  14.6 ms and Crystal 28.8 ms in the same session.

## Decisions and pivots

- 2026-10-05 — The grid is drawn on z after a fixed number of iterations,
  not on a converged coordinate: only an unconverged orbit gives the
  reference's circles and petals at the cusp and roots. Lines are a share of
  a cell with a `MIN_LINE_PX` floor (both measured, above), box-filtered over
  the footprint dz/dc gives, so dense regions average to white instead of
  the reference's aliasing noise.
- 2026-10-05 — Escaped points get a thin edge line from the distance
  estimate: the reference's filaments read as white curves.
- 2026-10-05 — Sync hypotheses (the reference is silent, so none of its
  motion is musical; every coupling is ours):
  - zoom is continuous at ~1 e-fold/s → Dive speed, wired to Bass level,
    at 1 e-fold/s with nothing plugged in. Ours can see it.
  - the "cuts"/strobe are grid lines sweeping → Step: the grid moves a
    share of a cell on each Bass hit. Ours can see it.
  - no spin → none.
  - ours only: Fold on the 1-bar grid (each bulb's grid slides to the next
    point of its cycle), Line weight on any beat, Invert on a drop.
  Not compared at the same beats with `ref-shoot`: with no audio there are
  no beats to line up.
- 2026-10-05 — Dive targets are bulb roots, where the orbit is parabolic and
  a fixed iteration count leaves it mid-way; diving exactly at a root at
  the cusp's depth went flat for every other root, hence a depth per target
  and Dive depth as a scale on all of them.
- 2026-10-05 — Tried an early stop for orbits that settle on a fixed point
  or a 2-cycle (lossless: max 20/255 on 0.8 % of pixels). Checking every
  step cut the whole-set view to 8.1 ms but slowed deep dives to 19 ms;
  checking every 8th step was slower still (26.7 ms against 14.5 ms). The
  plain loop already sits in the app's range, so it was dropped.

## Tuning notes

- Defaults were judged by eye against the reference's frames, on the
  synthetic feed only; never heard on real music yet.
- The synthetic feed's bass is low, so the camera averaged ~0.6 e-fold/s
  there; real music should sit nearer Dive speed's figure.
- Folds fall back to raw hits until the tempo tracker locks (the beat
  grid's own rule), so the first seconds fold more often.
- Floor quality caps Iterations through `uDetail`, which changes the grids
  near edges (fewer iterations leave them more warped).

## Known issues and next steps

- Dive depth stops where 32-bit floats run out; the reference's opening is
  deeper on the cusp. Perturbation (a high-precision reference orbit on the
  CPU, deltas on the GPU) would lift that.
- Every dive returns to the whole set; the reference also travels between
  regions at depth.
- Check on real music: Dive speed's floor and gain, and whether Step on
  every bass hit is too busy.

## Materials

- `fractalgrid/mandelgrid/` — our half of the `/ref` bundle (report, numbers,
  look data), saved with `tools/ref-keep.py`.
- `fractalgrid/scripts/shot.mjs` — headless shots on the real GPU, with
  pinned settings and dive states (its header has the DEV hook it needs);
  `tile.py` sheets them; `diff.py` compares two runs shot by shot.
- The reference video and the full bundle: the local `/ref` cache
  (`tools/.cache/refs/mandelgrid/`, the clip in `_downloads/`), and the
  private archive if `tools/ref-archive.py` is run.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/fractalgrid`.
- Pin the camera to look at one depth: paste the hook from
  `scripts/shot.mjs`'s header, then for example
  `node docs/scenes/fractalgrid/scripts/shot.mjs out/a --settings '{"dive":0}' --state '{"phase":0.3,"targetIndex":1}'`.
- `/ref` bundle `mandelgrid`; the reference was fetched with `uvx yt-dlp`
  from the post URL (reddit.com itself blocks scripts).
- Gotchas: a setting keyed `detail` would collide with the common `uDetail`
  uniform; a per-step check in the loop costs more than it saves where
  orbits never settle (the dives).

## History

- First version, 2026-10-05: the scene, its motion module and tests, and
  this record.
