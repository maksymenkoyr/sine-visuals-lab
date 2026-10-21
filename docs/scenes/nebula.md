# Nebula (`nebula`)

A slow flight through a glowing violet gas cloud: hot blue rims on the
gas's edges with a rose-to-orange fringe outside them, fibres inside, sparse
stars, and a gentle clockwise turn. The music brightens the cloud (Glow),
flares its rims white on hits (Flare) and speeds the flight and the turn up
as a section builds (Surge); in silence it only drifts. Draft, on its first
PR.

## Where the code is

- `src/render/scenes/nebula/index.ts` — the scene module: `SETTINGS`, the
  drive reads, and the flight constants (`BASE_FLIGHT`, `BASE_TURN`,
  `SURGE_GAIN`).
- `src/render/scenes/nebula/flight.ts` — the camera on the JS side: `Flight`,
  `advanceFlight`, and `layerUniforms`, which hands the shader each gas
  plane's depth and seed, far to near. The flight distance never reaches the
  GPU (noiseHash.ts's header says why).
- `src/render/scenes/nebula/glsl.ts` — `FRAG`: `LAYERS` noise planes
  composited back to front; `gasField`/`warpField` are the fbm, and the rim,
  fringe, fibre and star constants sit at the top of the file. Uses
  `FLOAT_HASH_GLSL` from noiseHash.ts.
- `tests/nebulaFlight.test.ts` — plane order, bounded uniforms, rebirth.
- Drives (src/render/drives.ts): `glow` on `anim.energy`, `flare` on
  `anim.lowOnset` (read as a level in GLSL), `surge` on
  `anim.sectionIntensity` (read in JS through `drives.value`).

## References

- "Electric Space 4K Screensaver: Glowing Violet Filament Drift" —
  https://youtu.be/hKckckhpbYY (a 2-hour silent Blender render, no
  chapters). Studied 60–100 s of it for the look (palette, rim and glow
  widths, how much of the frame is lit, stars) and the motion (slow zoom-in,
  slow clockwise turn, wisps lying along the radius). The video is silent by
  design, so it says nothing about sync: every reaction here is this
  scene's own design. The picture is an independent shader; nothing of the
  render was used beyond the measured numbers. `/ref` bundle:
  `violet-filament`.

## Measurements

2026-10-21, `violet-filament` (60–100 s of the video), reference vs ours.

- Audio: silent (`NO USABLE AUDIO`); no hard cuts at 30 fps in 40 s; the two
  STROBE lines are false: brightness held 0.21–0.22 through both.
- Motion (report): zoom +0.005 log-scale/s mean; rotation −0.6 to −1.6°/s
  (clockwise) per regime; radial flow ∝ r^0.45–1.23 at 0.04–0.05
  half-heights/s at r 0.5 (a flat zoom, not a tunnel); 63–73% of elongated
  objects lie along the radius. Ours: a plane lives `LAYERS / BASE_FLIGHT`
  s, the turn is `BASE_TURN`, and `STREAK_POW` stretches shapes radially.
- Picture (report): glow e-fold 7–13 px at 720p; lit 9–11.5% of pixels;
  ground `#1a0d26`–`#231135`; lit hues magenta 300° 43–74%, violet 270°
  24–53%, rose 330° up to 25%.
- Frame statistics (`scripts/stats.py`, 640×360): reference frames luma
  0.18–0.23, p50 0.11–0.17, p90 0.37–0.47, >0.6 1.2–4.4%, saturation
  0.54–0.61, lit hue 270–278°. Ours at rest (ref-shoot, silence): luma
  0.17–0.20, p50 0.11–0.16, p90 0.34–0.37, >0.6 0.9–1.3%, saturation
  0.59–0.62, lit hue 253–259°. Ours under synthetic 124 bpm: luma
  0.19–0.22, p90 0.40–0.45.
- `tools/tune-real.mjs` (Levitating, 30 s from 4 s, final first-PR code):
  song change median 4.39 / p95 6.96, 352 hits/min; silence 0.91 / 1.15,
  0 hits; p95 ratio 6.0×. 60 fps at 1280×720 on the M1 Pro (high).

## Decisions and pivots

- 2026-10-21 — Sync hypotheses from the scan: no trigger at all (silent
  reference); continuous drift only; no cuts; no strobes. So the reactions
  were designed, and the owner chose them from a proposal: loudness → Glow,
  hits → Flare, sections → Surge.
- 2026-10-21 — Stacked noise planes instead of a raymarched volume: the
  reference measures as a flat zoom, and planes give the parallax at a
  fraction of the GPU cost.
- 2026-10-21 — Rims tried as `fwidth`-sized iso-lines: read as a
  topographic map and speckled on the high octaves. Replaced by a rim width
  that grows with the plane's scale, plus light that fades slowly into the
  cloud (lit volume, not a line).
- 2026-10-21 — First brightness match was made under synthetic audio, where
  Glow and Flare lift the picture; at rest it fell short of the reference's
  highlights, so the rims and edge bands were raised and `GLOW_GAIN` cut so
  a loud song brightens the cloud without filling the voids.

## Tuning notes

- Judge the look at rest (silence) against the reference first, then on a
  real song; synthetic kicks keep Flare firing and whiten every rim.
- Gas sets how much of the view is cloud; around its default the reference's
  share of dark open space holds.
- Colour turn rotates every colour about the grey axis; 0 is the reference's
  violet.

## Known issues and next steps

- Shape: the reference has big volumetric masses with white-blue glare and
  strong red streaks along their edges; ours reads flatter — glowing sheets
  with line rims ("jellyfish"). Next: brighter, larger hot regions where
  several planes' edges overlap, and a red streak band along the hottest
  edges.
- Lit hue sits ~15° bluer than the reference's.
- The flight starts from the same seeds on every mount, so the opening is
  always the same patch of cloud.
- No `auto` weight tables yet; every setting is manual.

## Materials

- `nebula/violet-filament/` — the `/ref` report, its data and our ref-shoot
  frames, kept with `tools/ref-keep.py`.
- `nebula/scripts/shot.mjs` — screenshots of the scene on the real GPU with
  synthetic audio; `stats.py` — luma/saturation/hue statistics of frames;
  `pair.py` — reference over ours tiles.
- The reference video, frames and comparison sheets: the local `/ref` cache
  and the private archive (`tools/ref-archive.py violet-filament`).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/nebula`.
- `node docs/scenes/nebula/scripts/shot.mjs <prefix> --port P` for shots;
  `uv run --with pillow --with numpy python docs/scenes/nebula/scripts/stats.py --crop <png>…`
  to compare with the reference numbers above.
- `node tools/ref-shoot.mjs tools/.cache/refs/violet-filament --scene nebula --port P --min-rank 8 --max-beats 6`
  for the side-by-side at rest; `node tools/tune-real.mjs nebula --wav <song.wav> --port P`
  for song vs silence.
- The scan needed the Homebrew ffmpeg fix (`DYLD_LIBRARY_PATH` at the old
  x265 keg) and a hand merge of yt-dlp's separate video and audio files.

## History

- First PR (2026-10-21): the scene, its record and the flight test.
