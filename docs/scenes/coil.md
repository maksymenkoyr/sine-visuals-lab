# Coil (`coil`)

A coil of red/white/blue paste bands on a lavender ground: one silhouette
stacked into itself by the shell-coiling rule (each copy smaller and turned a
little), streaming outward from the centre, over a background that is the
previous frame shrunk by half, turned a quarter and tiled — so every earlier
frame recurses into it. The music sets how fast the paste flows, when the coil
falls back, and when it resets to a new small shape. Draft scene.

## Where the code is

- `src/render/scenes/coil/coilMotion.ts` — the pure state, pinned by
  `tests/coil.test.ts`: `stepCoil`/`createCoilState` (flow phase `F`, outer
  log-size `L` chasing `Ltarget`, the reset morph, global spin),
  `rollShape`/`ShapeParams` (the rolled silhouette), `L_BIG`/`L_SMALL`/
  `GROW_BASE_PER_SEC`/`RESET_DURATION_SEC`, and `COIL_RAMP` (the one stripe-ramp
  table) with `coilPaletteRGB` evaluating it, `coilTargetSize` and
  `newShapeDivisor`.
- `src/render/scenes/coil/glsl.ts` — `COIL_MODEL_GLSL` (`coilSdf` = the
  silhouette as a union of lobes, `copySdf` = one copy of the stack,
  `findVisibleCopy` = the per-pixel march + bisection for the smallest copy
  containing the pixel, `paletteRamp`), `buildSceneFrag` (coil on top of the
  tiled previous frame, faded by `FEEDBACK_FADE` toward `GROUND_RGB`),
  `BLIT_FRAG`, `BASE_PERIOD`.
- `src/render/scenes/coil/index.ts` — the `Scene` (id `"coil"`), `SETTINGS`,
  the ping-pong target pair (`makeTarget`/`ensureTargets`, sized by
  `TARGET_SCALE` per quality), and `render()`: resolve settings + drives into
  `stepCoil`'s inputs, draw the scene pass into the write target, mipmap it,
  blit it to the screen, swap. New shape divides its grid edge by
  `NEW_SHAPE_GRID_DIVISOR` because the beat grid's coarsest stop is two bars.
- Plugs into: drives (`drives.value`/`drives.fired` for Flow, Push, Breathe,
  New shape, Spin), the app palette (`uPalA..D`, for Colours), quality
  (`uMaxSteps` for the march).

## References

- **"Brush your teeth"** by u/matigekunst, r/creativecoding, 2026-09-11
  (<https://www.reddit.com/r/creativecoding/comments/1wdbnl9/brush_your_teeth/>),
  720×720, 30 fps, 60 s, silent. Studied for its technique and timing: the
  author's own comment says the spiral is the technique from their earlier
  video and "the fractal background is just a tiling of the spiral inside a
  feedback loop". Measured whole in the `/ref` bundle `brush-teeth`
  (`tools/.cache/refs/brush-teeth/`).
- **"The Museum of all Shells"**, Matige KunstIntelligentie, 2021-02-09
  (<https://youtu.be/KaSRNsXjTfc>), the "old video" the author points to. Its
  one piece of geometry (around 1:10–1:20) is Raup's shell-coiling model —
  a generating curve repeated along a logarithmic spiral with Flare / Verm /
  Spire parameters — which is the rule this scene's stack follows. Studied
  for the idea only; nothing was taken from its frames.

## Measurements

2026-09-28, reference only (it has no audio, so no "ours hears" column):

- **Feedback** (`coil/scripts/measure_feedback.py`): background of frame t
  = frame t−1 scaled ×0.5, rotated 90° (270° and mirrors fit equally — the
  shape is 2-fold symmetric), tiled 2×2 with tile centres at the quarter
  points. Best fit at every probe where background shows: lag 1 frame,
  scale 0.5 (candidates 0.4–0.6), error 0.047 vs 0.073 for a flat ground at
  20.0 s, 0.024 vs 0.037 at 38.7 s. At 5 s and 45 s the coil covers the
  frame and nothing fits better than flat.
- **Palette** (`coil/scripts/measure_cycle.py`, k-means on big-shape frames):
  ground `#aa85bb`; stripes red `#c42d50` 14 %, pink `#d57b95` 12 %, blue
  `#5d8cdc` 15 %, pale lilac `#bebad7` 26 %, white `#e8e6f2` 23 %,
  `#815690` 9 % (the red/blue mix at band edges). Each band: a sharp red
  line fading through pink to white, then a sharp blue line fading through
  lilac to white.
- **Cycle** (same script, share of plain-ground pixels): full resets to a
  small shape at 18.5, 37.0, 56.3 s (ground share 0.2 → 0.85; radius
  ≈ 0.15–0.3 half-heights); between them the coil overfills the frame and
  falls back part-way every 4–7 s (big spans 1.5–4.5, 8–14, 25.5–32,
  44.5–50.5 s).
- **Report** (`brush-teeth/report.md`): 1 hard cut in 60 s (11.26 s), fades
  of 1–3 frames at the resets; zoom mean +0.21, |zoom| 0.68 log-scale/s
  (net +12.6 over the clip — the outward stream); rotation mean +7 °/s,
  typical +7…+14 °/s with spikes of −79 and +55 °/s near 31 s and 49 s;
  2-fold rotational symmetry 0.99. The lit-object detector's counts don't
  describe this picture (it reads the bands as hundreds of bars and blobs) —
  use the images, not those lines.
- Burst `016.63` (the 18 s reset, every frame): the outer copies peel away
  while the silhouette spins down over ~0.8 s to a small bow-tie, which then
  grows; the bands stream outward from the centre throughout.

## Decisions and pivots

- 2026-09-28 — Sync hypotheses from the `brush-teeth` bundle (the reference
  is silent, so each is a timer there, mapped to a drive here):
  1. feedback tiling — continuous, every frame, no trigger;
  2. outward stream — continuous → flow speed on the bass level plus a push
     per hit;
  3. breathing (fall back part-way every 4–7 s) → the beat grid every 2 bars;
  4. reset to a small new shape every ~19 s, a ~0.8 s spin-down with no cut
     → the beat grid every 8 bars, as an uninterruptible morph;
  5. rotation +7…+14 °/s continuous → a spin drive on a level;
  6. the one hard cut → not reproduced.
- 2026-09-28 — The coil is modelled as Raup's stack (copy ℓ = silhouette
  scaled e^ℓ, turned twist·ℓ, smaller copies on top) searched per pixel,
  not a Droste/log-polar remap: the ref's reset shows a finite silhouette
  with a clear outer edge and cut arm ends, which a self-similar remap
  can't produce, and the band layout (nested outlines pinching into the
  centre, spiralling when twisted) is exactly what a stack of nested copies
  draws.
- 2026-09-28 — First build (Sonnet from the plan), then four fixes from
  headless GPU shots beside the reference's frames:
  1. the background tiling used the spun coil coordinate, so the grid turned
     with the coil, and it sampled the whole previous frame instead of its
     central square — tiles now sit in screen space;
  2. growth rode the flow rate only (floored at a crawl on quiet input)
     while each Breathe edge subtracted a fixed drop, so the coil never
     filled the frame — growth now has its own base rate (the ref's
     |zoom|), and Breathe falls back *to* a size rather than *by* an amount;
  3. the ground came out `#ccb0c8` instead of `#aa85bb`: once the coil has
     filled a frame, every later tile is a copy of stripes, which average to
     a pale pink-lilac that never goes away. The ref must fade each
     generation toward the ground — `measure_feedback.py` fits
     cur = ground + a·(tiled prev − ground) at a = 0.59–0.79 (about 0.6 on
     mostly-ground frames, 0.7–0.8 mid-cycle); the scene uses 0.7;
  4. colour weights: with thin sharp lines the red/blue share was 1–4 %
     against the ref's 13–19 % (`palette_share.py`); solid red and blue runs
     before each fade now give 12–13 % red and 18 % blue on big frames. The
     stripe period was halved (the first estimate drew half the ref's bands).
- 2026-10-02 — review fixes. (1) The offscreen targets clamped width and
  height to `MAX_TARGET_DIM` independently, so any canvas wider than the
  cap (1920x1080 at high) drew at the wrong aspect and the blit stretched
  it; `coilTargetSize` now applies one factor to both axes. (2) The
  per-pixel march is skipped outside a bounding radius (no copy reaches
  past it; most of the frame just after a reset), and the four lobe
  directions share one cos/sin of the base angle; same picture to within
  1/255 on a handful of pixels. (3) New shape only gated on/off above the
  0.02 floor; `newShapeDivisor` now scales the grid-tick count with the
  slider (right = more resets, the default amount keeps today's cadence).
  (4) `glsl.ts`'s `paletteRamp` is generated from `COIL_RAMP`, the table
  the palette test evaluates, instead of being copied by hand.

## Tuning notes

- Judge on a square window beside `frames/look_4.jpg` (small-shape moment)
  and a big-shape frame from the ref, not by the numbers alone.
  `coil/scripts/palette_share.py` compares colour weights of any frames
  against the ref's clusters; ground share is the quickest "did the
  background come back" check.
- Round-6 shots (2026-09-28, synthetic 120 bpm): ground 0.55 on small-shape
  frames (ref 0.73 at `look_4`), 0.12–0.14 on big ones (ref 0.03–0.07);
  red 0.12–0.13, blue 0.18 (ref 0.13–0.18, 0.15–0.19); white 0.03–0.08 (ref
  0.11–0.33).
- At synthetic 120 bpm, resets land about 13 s apart and breaths every 4 s
  (ref ≈ 19 s and 4–7 s). The first reset comes early: the New-shape pulse
  counter starts mid-cycle.

## Known issues and next steps

- The ref's big frames have more structure: overlapping lobes, tubes
  coiling inward as separate arms (its 11 s frame), a fine grainy texture in
  the whites, and a little relief shading. Ours are smooth single
  silhouettes. Next: bias `rollShape` toward the offset-lobe (`verm`) coils
  and try a subtle shade from the stack's gradient.
- White is under-weighted against the ref (see Tuning notes).
- New shape's first reset fires early (pulse counter not phase-aligned to
  the grid's own 8-bar cycle).
- Not yet heard on real music: the sync mapping (Flow on the bass level,
  Breathe/New shape on the grid, Spin on the treble) is a hypothesis from a
  silent reference. `ref-shoot` needs the bundle's audio, which this
  reference doesn't have — the comparison so far is headless GPU shots on
  synthetic audio.
- No `minQuality`; the march count and target size scale with quality, but
  it hasn't been benchmarked on a low-end device.

## Materials

- `coil/scripts/measure_feedback.py` — fits lag / scale / rotation / tiling
  of the feedback background against the reference video.
- `coil/scripts/measure_cycle.py` — reset times, silhouette radius over time,
  stripe palette.
- `coil/scripts/palette_share.py` — share of pixels nearest each of the ref's
  measured colours, for ref frames and our screenshots side by side.
- `coil/brush-teeth/` — our half of the `/ref` bundle (report, data, and our
  round-6 shots in `ours-coil/`), saved with `tools/ref-keep.py`.
- The reference media (the clip, its frames) is not in this repo: it's in the
  local `/ref` cache and the private archive (`tools/ref-archive.py`). The
  clip was fetched from `v.redd.it` (reddit.com itself blocks scripted
  fetches; its RSS feed has the comments).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/coil` for headless
  checks (the dev server prints the plain link when coil's files are in
  flight).
- Headless shots need the real GPU: Chromium with `channel: "chromium"` and
  `--enable-gpu --use-angle=metal --enable-gpu-rasterization
  --ignore-gpu-blocklist`. SwiftShader runs ~13 fps and skews every timer.
  Shoot a square viewport — the ref is 720×720, and on a landscape window
  the tile grid just continues sideways.
- The bundle is `brush-teeth` (`tools/.cache/refs/brush-teeth/`, archived
  with `tools/ref-archive.py`). It's silent, so `ref-hear`/`ref-shoot` don't
  apply. The clip came from `v.redd.it/6nyfgxzb3voh1/CMAF_720.mp4` — reddit.com
  blocks scripted fetches, but its `.rss` feed has the comments.
- Homebrew's ffmpeg/ffprobe were broken on the measuring machine (missing
  libx265); `uvx --from static-ffmpeg static_ffmpeg_paths` gives working
  binaries to put first on PATH for `ref-scan.py`.

## History

<!-- HISTORY: PR number once opened -->
