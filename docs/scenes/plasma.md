# Plasma (`plasma`)

A crimson field of folded, marbled noise with thin neon contour lines tracing
its plateaus and the rims of its dark holes, a violet haze in some of the
darks, churning in place with no pan, zoom, spin or cut. Loudness speeds the
churn, bass deepens the folds, a kick sends every line sweeping across the
field and back, and hits flash the lines. In development, not yet on main.

## Where the code is

- `src/render/scenes/plasma.card.ts` — the card: the settings (`SETTINGS`), the
  `gallery` record and `loadBody`.
- `src/render/scenes/plasma.ts` — the body, one fragment shader on
  `createFullscreenScene`. Its header says how the picture is built.
  - `fieldFbm` reads one warped field three ways: its first `SOFT_OCTAVES`
    (which zones are lit), its first `LINE_OCTAVES` (where the lines run) and
    all of them (the value). The fine octaves take only `FINE_WARP` of the warp
    and are scaled by the lace mask (`detail`).
  - The tone curve is a histogram match: `TONE_Z`/`TONE_V`, a monotone cubic
    (`monotoneTangents`, `plasmaTone` in JS, `tone` in GLSL).
  - `crimson` turns a value into the measured colour.
  - The lines: evenly spaced levels of the line field (`LINE_DENSITY`,
    `LINE_PHASE`), a screen-space width (`LINE_EFOLD_HH`) with a cut tail, and
    a brightness that wanders along each line.
  - Motion, all in JS and wrapped (`noiseHash.ts`'s header): `plasmaDrifts`
    (warp octaves drifting in their own lattice frames) and `boilDepths` (the
    field's time axis, faster per finer octave). `START_PHASE_SPAN` starts each
    mount at a random phase.
  - Envelopes: `advanceChurn`, `advanceSweep` (two stages, so a line travels
    rather than jumps), `advanceFlash`.
- `tests/plasma.test.ts` covers the pure helpers.
- Shared systems:
  - `noiseHash.ts`: `NOISE_HASH_GLSL` and `wrapFlow`.
  - The drives (`drives.ts`): `rush` ← Level, `swell` ← Bass level, `sweep`
    ← Kick (a hit driver, "sweep") and `flash` ← Any hit (a hit driver, "flash").
  - The room palette, when Colour is Room.

## References

- "1-Hour Hypnotic Crimson Energy Loop | No Copyright Video Asset (No Music)",
  Animated Code Screensavers, https://youtu.be/ibpvpMLUSz4 — studied for its
  look and its motion.
  - What was measured:
    - 2:00–3:00 at 720p60, in the `/ref` bundle `ibpvpMLUSz4`;
    - the whole hour at 144p, for a loop and for colour drift;
    - two 4K frames (2:30, 2:45), for the line profile.
  - It is silent by design (its title and description say so), so no sync was
    taken from it. Every reaction here is our own, picked by the owner.

## Measurements

2026-11-07, the reference (bundle `ibpvpMLUSz4` and the scripts in
`plasma/scripts/`):

- No loop in the hour: the best match to the first frame anywhere is r 0.41.
- No colour drift: lit pixels are red/rose all hour, frame-mean value
  0.16–0.19 per minute.
- No hard cuts in 60 s at 30 fps (colour change ≈ 0.007/frame; a cut is ≥ 0.2).
  The scan's 2 "strobes" and 26 "transitions" are noise on a smooth field; the
  slit-scan shows none.
- The big layout never moves. The hour's mean frame keeps 26 % of the
  per-frame variance, and frame correlation never falls below ≈ 0.19 at any
  lag from 20 s to 2 min.
- Colour: green ≈ 0, blue/red ≈ 0.23 in the middle values, rising to ≈ 0.4
  in the darks and 0.31 at the top.
- Rims face no side: the mean resultant length of dark→bright flank
  directions is 0.007–0.014 (a light would show a preferred side). They are
  level sets of the field, not glints.
- Flow: curl ≈ divergence (0.32 vs 0.36 /s). A fluid sim's would be
  divergence-free, which is why this was built as procedural domain warping.

2026-11-08, reference beside ours. Default settings in silence. Stills come
from 16 fresh mounts (16 layouts), motion from a 30 s clip. Everything is
measured at 640×360 unless noted.

| what | reference | ours |
|---|---|---|
| value percentiles 5/25/50/75/95/99 | 0.118 / 0.275 / 0.357 / 0.463 / 0.753 / 0.929 | 0.102 / 0.263 / 0.349 / 0.478 / 0.757 / 0.875 |
| share below 0.10 / 0.15 | 3.7 % / 7.7 % | 4.7 % / 9.0 % |
| violet share (blue > 0.45 red) | 6.0 % | 5.6 % |
| lit hues, red / rose | 83.5 % / 16 % | 88 % / 12 % |
| thin bright lines (value − blur > 0.10) | 4.7 % | 4.7 % |
| rims at 1280×720: ridge share, width at half height, core value | 1.6 %, 3 px, 0.97 | 1.5 %, 3 px, 0.85–0.91 |
| small dark holes per frame (value < 0.12) | 20 | 25 |
| power by octave, 2–4 … 128–256 cycles per width | 28 / 23 / 17 / 16 / 11 / 5 / 2 % | 34 / 26 / 15 / 10 / 7 / 6 / 2 % |
| local detail spread p10 / p50 / p90 (× mean), cv | 0.32 / 0.85 / 1.95, 0.63 | 0.47 / 0.90 / 1.68, 0.49 |
| frame correlation 0.5 / 1 / 2 / 3 / 5 / 8 s | 0.85 / 0.71 / 0.56 / 0.48 / 0.38 / 0.30 | 0.90 / 0.81 / 0.68 / 0.60 / 0.49 / 0.37 |
| the same, coarse scale | 0.98 / 0.94 / 0.86 / 0.78 / 0.65 / 0.54 | 0.98 / 0.95 / 0.87 / 0.79 / 0.68 / 0.53 |
| flow speed p50 / p90 (half-heights/s) | 0.022 / 0.045 | 0.022 / 0.051 |
| local flow coherence | 0.65 | 0.70 |
| global shift, zoom, spin | none | none by construction |
| frame-mean value over time | 0.382 ± 0.012 | 0.358 ± 0.014 |

2026-11-08, `tools/tune-real.mjs plasma` (around-the-world, then silence; 30
s from 4 s; change = % of full scale per 100 ms):

| source | change med | change p95 | hits/min | kick/min | clap/min | hats/min | chord/min | drops/min | energy |
|---|---|---|---|---|---|---|---|---|---|
| song | 4.07 | 6.13 | 420 | 112 | 44 | 288 | 134 | 0 | 0.61 |
| silence | 0.94 | 1.09 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 |

Song p95 / silence p95 = 5.6×. The silence row is the designed churn.

2026-11-08, the Auto sign-off (`plasma/scripts/automodes.mjs`, synthetic 124
bpm, dev pin cleared):
- on a fresh profile every setting probes `manual` at its default;
- with Auto on, the nine with an auto table probe `auto`, and Violet and
  Colour stay `manual`.

## Decisions and pivots

- 2026-11-07: `/ref` showed a silent hour that never repeats, under a big
  layout that never moves. Nothing to sync to: the reference's churn is a timer.
  The owner chose a new scene over a look inside Cosmic Cloud (draft #666),
  and all four reactions offered: loudness speeds the churn, kicks sweep the
  lines, hits flash the lines, bass deepens the folds.
- 2026-11-07: the same kind of process as the reference: procedural domain
  warping, not a fluid sim (no lit side to the rims, curl ≈ divergence).
- 2026-11-07/08, the look, over 36 measured rounds:
  - A separate coarse field made soft blobs; the big layout comes from the
    warped field itself.
  - Lines everywhere drew a contour map. Lines tied to brightness looked like
    crumpled foil. Lines on all six octaves broke into glitter. They now run
    on a four-octave reading, kept to lit regions and the rims of their holes.
  - The lace mask first scaled each fine octave's mean, which tied lace to
    brightness. It now scales only the swing.
  - The tone curve is a histogram match over 16 fresh mounts: one mount's
    layout moves the percentiles by a few hundredths.
  - A plain exponential line profile lifted whole lit zones through its tail.
    The tail is cut now.
  - The full warp on the fine octaves made parallel wrinkles. They take only
    part of it.
- 2026-11-08, motion: the reference's layout never changes. Ours boils its
  base octave slowly, so the layout changes over minutes, and each mount
  starts at a random phase, so a visit doesn't always open on the same
  picture.

## Tuning notes

- Judge a still over many mounts (`shoot.mjs --mounts 16`), never one: the
  layout moves slowly, and one view's percentiles are off by a few hundredths.
- The tone knots must be re-fitted whenever the octaves, warps or frequency
  change:
  - temporarily output the raw field from the shader;
  - shoot 16 mounts;
  - put `TONE_Z` at our field's quantiles for the reference's value breakpoints.
  The same raw render gives `FIELD_SPREAD`, `SOFT_SPREAD`, `LINE_SPREAD` and
  `FINE_RESIDUAL_SPREAD`.
- `LINE_DENSITY` and `LINE_PHASE` decide where the levels sit: one on the rim
  of the dark holes, one across the mid-crimson ground, one on the lit zones.

## Known issues and next steps

- The look waits for the owner's verdict, side by side with the reference.
- Middle-sized detail turns over a little slower than the reference's (0.81
  vs 0.71 at 1 s).
- Our lines are rounder, more even outlines than the reference's ragged ones,
  and run redder (rose share 12 % vs 16 %). The reference has rare
  lavender-white filaments (0.01 % of pixels); ours has none.
- Sweep and Flash are not yet checked frame by frame on a real kick. The song
  row above only shows the picture moving 5.6× more than in silence.

## Materials

- `plasma/ibpvpMLUSz4/` — our half of the `/ref` bundle: the report, its data,
  and our own stills and the song and silence sheets (`ours-plasma/`). Saved
  with `tools/ref-keep.py`.
- `plasma/scripts/`:
  - `measure.py` — the one measure run on the reference and on ours: colour,
    scale, detail spread, motion, flow;
  - `rims.py`, `rimdir.py` — the line profile, and whether rims face a side;
  - `static.py`, `loopsearch.py` — the hour's static share and loop search;
  - `shoot.mjs` — stills over fresh mounts, or a clip recorded in-page;
  - `automodes.mjs` — the Auto sign-off;
  - `tile.py`, `zoom.py` — side-by-side sheets.
- The reference media is never in this repo. It sits in the local cache
  (`tools/.cache/refs/ibpvpMLUSz4/` and `_downloads/ibpvpMLUSz4.mp4`) and goes
  to the private archive with `tools/ref-archive.py`.

## Resume here

- `npm run dev`, then `/#/v/plasma`: in silence it shows the reference's look;
  with a song, the reactions.
- Stills: `node docs/scenes/plasma/scripts/shoot.mjs <out> --repo <checkout>
  --port <p> --wav <silent wav> --mounts 16 --frames 1`. Then `uv run --with
  numpy --with opencv-python-headless python -I
  docs/scenes/plasma/scripts/measure.py <ffmpeg> <png>…`.
- Motion: `--clip 30` instead, then measure the `.webm`.
- Homebrew's ffmpeg broke on an x265 upgrade on the measuring machine. The
  fix was a static ffmpeg first on `PATH`, plus a small `ffprobe` stand-in
  that answers only the one probe `tools/ref-scan.py` makes.

## History

- `5a44717f` — first cut, work in progress.
- `65814552` — the look matched by histogram, lines on a smoother field,
  motion at the reference's pace, tests.
