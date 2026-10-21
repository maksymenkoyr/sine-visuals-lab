# Liquid Chrome (`chrome`)

A glossy green liquid surface drawn as tight contour ribbons that wrap into
eddies, with dark creases between the ribbons and cyan glints on their
flanks, boiling in place rather than scrolling. Loudness speeds the boil,
bass twists the ribbons into deeper eddies, and hits flash the glints.
Draft.

## Where the code is

- `src/render/scenes/chrome.ts`: one fragment shader on
  `createFullscreenScene`. Its header says how the picture is built.
  `cellField` is the height field (a smoothed distance to orbiting cell
  points, warped by two `fbm` sites), `bandProfile` turns it into rounded
  ridges, and the normal comes from `dFdx`/`dFdy` of the field times the
  band profile's slope.
- The JS side: `chromeFlows` (per-octave drift offsets, wrapped),
  `advanceChromePhase` (Flow times Rush's drive, integrated) and
  `advanceShine` (the hit envelope), tested in `tests/chrome.test.ts`.
- Shared systems: `noiseHash.ts` (`NOISE_HASH_GLSL` and `wrapFlow`; the
  shader never sees a growing phase, and the orbit angle is wrapped to one
  turn), the drives (`rush`, `swirl`, and `shine` as a hit driver), and the
  room palette when Colour is Room.

## References

- "LoopVibe 4K – Green & Blue Liquid Waves in 4K (2 Hours) – (No Audio)",
  LoopVibe 4K, https://youtu.be/Qj80Mie5N0c — studied for its look and
  motion: a liquid-chrome contour surface. The 60–120 s stretch of the video
  was measured in the `/ref` bundle `liquid-waves-Qj80` (scan from 0 s of
  that cut, 40 s long). The video has no audio by design (title and
  description), so it gave no sync to study; the music mapping here is our
  own.

## Measurements

2026-10-21, reference (`liquid-waves-Qj80` and the scripts in
`chrome/scripts/`) beside ours (default settings, 1280×720):

| what | reference | ours |
|---|---|---|
| loop | one 16.667 s loop repeated for 2 h (frame correlation 0.999 at that lag) | no loop; it runs on |
| hard cuts | none in 40 s at 30 fps; colour change ≈ 0.018/frame (cut ≥ 0.2) | none |
| global drift / zoom / spin | ≈ 1 px/s, zoom ≈ 0, spin +0.7°/s | none by construction |
| frame correlation vs time | 0.48 at 0.5 s, 0.08 at 1 s | ≈ 0.33 per ≈ 0.35 s, 0.12 at ≈ 0.7 s (124 bpm synthetic; Rush adds speed) |
| palette share (centre crop, `palette_share.py`): dark / teal / green / bright | 0.06–0.08 / 0.48 / 0.22 / 0.21–0.24 | 0.06 / 0.44 / 0.35 / 0.15 |
| mean luminance | 0.36–0.38 | 0.35–0.38 |
| symmetry | none (rotational r 0.13, mirror r 0.20) | none |

`tools/tune-real.mjs chrome` on around-the-world, then silence (30 s from
4 s, change in % of full scale per 100 ms):

| source | change med | change p95 | hits/min | energy |
|---|---|---|---|---|
| song | 16.74 | 19.69 | 284 | 0.61 |
| silence | 6.49 | 7.34 | 0 | 0.00 |

The silence row's change is the boil the scene has by design.

## Decisions and pivots

- 2026-10-21: chosen by the owner as a new free scene, not a look for Ink,
  with my proposed mapping: loudness → flow speed (Rush, `anim.energy`),
  bass → swirl depth (Swirl, `anim.low`), hits → glint flash (Shine,
  `feature.onset` hit driver).
- 2026-10-21, sync hypotheses: none; the reference is silent. Its 21
  "transitions" and 5 "regimes" in the report are noise and phases of one
  loop, not structure.
- 2026-10-21: plain fbm contours were rejected. Their spacing bunches into
  dense stripes wherever the field is steep, while the reference's ribbons
  keep an even width. Contours of a smoothed distance to cell points
  (`cellField`) have that even width: rings around each point that merge
  into parallel stripes between points.
- 2026-10-21: lighting moved from "brightness by how square the surface
  faces" to a one-sided key light, so each ribbon has a lit flank and a
  teal one. That brought the teal share from 0.22 to the reference's
  ≈ 0.48 range.
- 2026-10-21: the first real-song run showed the Shine flash barely above
  the boil (p95 14.6 vs median 13.2), so a hit now also widens the glints
  (`flash` in FRAG). After that, p95 rose to 19.7 against a median of 16.7.

## Tuning notes

- Lines sets the ribbon width; the reference's ribbon period is ≈ 14 px at
  720p, which is about the default.
- The reference's bright share (≈ 0.22) sits between two looks tried here:
  the key light more overhead gave 0.33, and the current one gives 0.15.
  The bright threshold in FRAG (`smoothstep(…, diff)` into `bright`) is
  the knob.
- `__viz.capture()` sheets (tune-real's `--sheet`) look flatter than
  `page.screenshot()`; judge the look from a screenshot.

## Known issues and next steps

- The reference's ribbons carry fine parallel grooves inside them; ours are
  smooth.
- Its eddy cores sometimes open into broad bright panels; ours stay ringed
  to the centre.
- Swirl reads `uLow` straight into the warp amount, so a hard bass swing
  bends the whole field at once. Watch whether that reads as a lurch on
  bass-heavy music.

## Materials

- `chrome/liquid-waves-Qj80/`: our half of the `/ref` bundle (report,
  `audio.json`, `look.json`, `series.tsv`, and our default shot under
  `ours-chrome/`), saved with `tools/ref-keep.py`.
- `chrome/scripts/`: `loop_period.py` (loop length and drift of a VJ
  loop), `palette_share.py` (dark/teal/green/bright shares of a frame),
  `frame_corr.py` (frame-vs-frame correlation over a burst of shots).
- The reference video cut (60–120 s) is only in the local cache,
  `tools/.cache/refs/_downloads/Qj80Mie5N0c.mp4`, and the private archive.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=124#/v/chrome`.
- Fetching the reference: `ref-scan.py <url>` pulls the whole 2 h video.
  Cut a section instead with `yt-dlp -g` and `ffmpeg -ss … -t … -c copy`,
  then scan the file.
- A `flow` setting already owns the `uFlow` uniform, which is why the
  drift array is `uDrift`.

## History

- #663 (2026-10-21): first version, built from the `/ref` measurements.
