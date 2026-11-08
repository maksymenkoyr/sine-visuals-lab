# Mandelbox Flight (`mandelbox`)

A flight into a box-folded 3D fractal, the Mandelbox: rim-lit cells over two
turning hues on black, about half the places on the fractal's own mirror
lines, so they open as a kaleidoscope or a mirrored vault. The music's
loudness sets the pace of the flight and of the colours, so silence holds
still; kicks and claps flash the rims; a drop moves on to a new place. In
development, not yet on main.

## Where the code is

- `src/render/scenes/mandelbox/card.ts`: `SETTINGS`, `card`, `gallery`.
- `src/render/scenes/mandelbox/index.ts`: the scene. Two draws: the march
  into a target no taller than `MARCH_HEIGHT` for the quality preset, then
  the scale-up that dissolves from `hold`, the last place's final frame
  (`moveOn`). The reactions: Push (`stepPace` on the `push` drive), Rim flash
  (`drives.fired("flash")`, sized), Dissolve (`drives.fired("dissolve")`,
  flat). `BASE_RATE` and `HUE_PERIOD_SEC` hold the measured motion and
  colour pace; `FIRST_SEED` picks the opening place.
- `src/render/scenes/mandelbox/flight.ts`: the fractal on the CPU in float64
  (`de`, `foldScale`); the place search (`createPlaceSearch`,
  `stepPlaceSearch`, `viewScore`, the kinds in `AXES` and `KIND_SHARES`);
  the flight (`createFlight`, `advanceFlight`, `foldsAt`, `ZOOM_MAX`,
  `DE_FLOOR`); the pace (`stepPace`).
- `src/render/scenes/mandelbox/glsl.ts`: `MARCH_BODY` (the march, rims from
  the distance field's Laplacian, occlusion, constant-brightness `tint`, the
  grade) and `OUT_BODY`.
- `tests/mandelboxFlight.test.ts`: the fractal's symmetry, the kinds of
  place per Mirror option, a search sliced into frames finding the same
  place, the zoom law, the floor, and the pace in silence and on a song.
- Shared systems: drives (`src/render/drives.ts`) for the three reactions;
  `sceneCommon.ts`'s uniforms and `roomUv()`.

## References

- https://youtu.be/2T33hxbt_5E: a three-hour ambient 3D-fractal video by
  Trippy Everything, one 60-minute loop played three times. Studied as
  inspiration for the kind of image (a raymarched Mandelbox-family fractal,
  lit at the edges), its motion (a steady push in), its colour drift, its
  mirrored stretches and its dissolves, and for the finding that its picture
  follows nothing in its music. Measured 2026-11-07 in two passes: the whole
  loop at low resolution (`mandelbox/scripts/hour.py`, `hour2.py`,
  `hour3.py`, `huerate.py`) and the `/ref` bundle `fractal-loop-2T33`
  (`tools/.cache/refs/fractal-loop-2T33/`) on its 27:00–29:00, where an
  unmirrored stretch cuts into a mirrored one.

## Measurements

2026-11-07, the reference:

- Loop: frames at t and t + 3600 s correlate at 1.00 (64×36 structure).
- No shot cuts: the picture's structure correlates 0.47 with itself 4 s
  later and about 0 after 30–60 s. 9 hard cuts in the hour, 8 plus the loop
  wrap; renders change by dissolves (a 1.5 s one at 75 s in the bundle).
- Motion: zoom +0.073 log-scale/s (×1.08/s), rotation about 0; radial speed
  ∝ r^0.9 (a flat zoom) in two of the five regimes.
- Colour: the chroma-weighted hue of lit pixels turns the same way in 74% of
  minutes, at a median of one turn per 52 s within a minute; 107 net turns
  in the hour (one per 35 s), the rest made up by jumps at dissolves.
- Mirror: left-right mirrored 45% of the hour, in three runs (12:03–15:13,
  27:53–32:56, 40:15–60:00); never top to bottom over the hour; 2-fold
  symmetry 0.95–1.00 in every regime of the bundle, 43% of objects on the
  axes.
- Picture: ground near #000; strokes about 1.9 px; glow e-fold 3.5–10.6 px;
  per-regime brightness 0.09–0.48, median 0.18; lit (> 0.18) median 0.33;
  saturation median 0.48; share at the darkest level median 0.56
  (`scripts/lumastats.py`).
- Sync: how fast the picture changes against loudness or onset flux,
  r 0.10–0.18 at every lag (a circular-shift null reaches 0.13);
  brightness r −0.07; no cut within 5 s of an audio event; 0 of 19
  transitions on a beat with an onset. Ours on the same clip: tempo never
  locked (reference 117.5 bpm), `section` didn't rise at its 7 audio
  boundaries.

2026-11-08, ours:

- Brightness, 12 places over the colour wheel (`scripts/mbx-lab.html`):
  mean median 0.14 (0.09–0.39), lit median 0.27, saturation median 0.46.
  Under Levitating, a frame every 5 s: mean 0.13–0.22, lit median 0.31,
  darkest-level share median 0.565.
- Push in, beside the reference at its beats (`tools/ref-shoot.mjs`): the
  opening place's centre grew ×2.5 in 13.5 s, against the ×2.7 its rate
  gives.
- `tools/tune-real.mjs mandelbox`, Levitating then silence, M1 Pro, high:

  | source | change med | change p95 | hits/min | kick/min | clap/min | hats/min | chord/min | drops/min | energy | fps |
  |---|---|---|---|---|---|---|---|---|---|---|
  | song | 11.86 | 19.02 | 318 | 110 | 26 | 204 | 86 | 0 | 0.66 | 120 |
  | silence | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 120 |

- Place search: 1–3 ms a place on the M1 Pro (`scripts/search-bench.mjs`).

## Decisions and pivots

- 2026-11-07: asked "can we create something like in this video". Measured
  first; the reference reacts to nothing, so the reactions are this scene's
  own. A live sketch with a proposal (Materials) got the owner's go on
  2026-11-08.
- 2026-11-08: the proposal's "a new song section moves to a new place" ships
  as "a drop moves to a new place". The analyser has no section-boundary
  edge, and `section` didn't rise at the reference's boundaries; Drop is the
  nearest edge it has, and the wire can be moved.
- 2026-11-08: mirrored places sit on the fractal's own symmetry axes and
  planes; the sketch's post-effect mirror is gone. Beside the reference, the
  first build showed a flat carpet of cells where the reference shows
  centred vaults, symmetric to the pixel with no seam.
- 2026-11-08: the flight closes a share of the free distance straight ahead
  each second, not of the gap to the nearest wall, which zoomed several
  times slower than the reference wherever the view looked down an opening.
  A place's centre ray must hit something: one that escaped flew the camera
  out of the fractal, faster and faster, into a black screen (found with a
  per-second log of the flight). A place ends after `ZOOM_MAX` of zoom.
- 2026-11-08: folds grow with depth (`foldsAt`): at a fixed count a deep
  view's walls turned to smooth, cauliflower-like bumps.
- 2026-11-08: tints keep one brightness round the colour wheel (`tint`, from
  YIQ), and faces are dim with bright rims. A plain hue's brightness swings
  about tenfold from blue to green, and the reference is lit at the edges.
- 2026-11-08: the colours drift at the reference's within-minute pace, and
  each new place arrives with its own jump, as the reference's renders do.
- 2026-11-08: Rim flash toned down after it held the frame half white on a
  song with a kick and a clap every beat.

## Tuning notes

- Roundness sets the fold scale (`foldScale`); boxier views come from lower
  values, not yet compared with the reference's box panels.
- Mirror's Per place mix is `KIND_SHARES`; On keeps to axes and planes, Off
  to free places.
- Judge the look with `scripts/mbx-lab.html` at fixed seeds and hues, and
  `scripts/lumastats.py` against the reference's medians above; judge the
  reactions with `tools/tune-real.mjs`, which must show a still picture in
  silence.
- Quality presets change only the march target's height and step count
  (`MARCH_HEIGHT`, `MARCH_STEPS`); only high has been measured.

## Known issues and next steps

- The reference's cells are boxier, whiter panels; at the default Roundness
  ours lean toward bubble lattices.
- Axis places look alike: each axis is one family of views along a line.
- The camera never steers: a place ends when its zoom is spent, where the
  reference's camera may turn through openings.
- No preset below high measured yet (`tools/gpu-bench.mjs`); a TV may need a
  `minQuality`.
- A section-boundary edge in `src/audio/` would allow the move to a new place
  on a new section, as first proposed.
- The Drop reaction hasn't been seen live: no drop landed in the 30 s
  tune-real window.

## Materials

- `mandelbox/fractal-loop-2T33/`: our half of the `/ref` bundle, saved with
  `tools/ref-keep.py` (report, beat and series data, what our analyser heard,
  the whole-loop pass's `hour/hour.json`, our shots at the reference's beats
  in `ours-mandelbox/`, shrunk). `look.json`'s per-object detections (2 MB)
  are left to the private archive.
- `mandelbox/scripts/`: the whole-loop pass (`hour.py`, `hour2.py`,
  `hour3.py`), the colour turn rate (`huerate.py`), brightness in the
  report's terms (`lumastats.py`), cutting a window of a long YouTube
  reference with its audio and sampling frames across it (`cutwin.sh`,
  `survey.sh`), rendering chosen places with the scene's own code through the
  dev server (`mbx-lab.html`, `lab-shot.mjs`), the place search's cost
  (`search-bench.mjs`), and shooting the sketch (`sketch-shot.mjs`).
- `mandelbox/artifacts/mandelbox-flight.html`: the source of the live sketch
  "Mandelbox Flight", https://claude.ai/artifact/561CAdeMLCFJ2bDs8aX6Bb (our
  own code, no reference images).
- The reference media: the local cache `tools/.cache/refs/fractal-loop-2T33/`
  and `tools/.cache/refs/_downloads/fractal-loop-2T33.mp4`, and the private
  archive (`tools/ref-archive.py`).

## Resume here

- `npm run dev`, then `/#/v/mandelbox` (or `/?audio=synthetic&bpm=120#/v/mandelbox`).
- Beside the reference: `node tools/ref-shoot.mjs tools/.cache/refs/fractal-loop-2T33 --scene mandelbox --port <port>`.
- Real audio: `node tools/tune-real.mjs mandelbox --wav tools/.cache/tempo-tracks/levitating/audio.wav --port <port>`.
- Chosen places: `node docs/scenes/mandelbox/scripts/lab-shot.mjs <port> <outdir> '[{"name":"a","seed":2,"hue":0.5,"fly":30}]'`.
- Gotchas: a black picture in flight means the camera has no target (log
  `flight.gap` and `flight.ahead` once a second); a setting's `u<Key>` must
  not collide with `EXTRA_UNIFORMS` (`uFlash` is the setting, `uFlashNow` the
  envelope); a Park–Miller search seeded small needs its warm-up draws.

## History

- First version: the scene, its record and materials, on branch
  `worktree-fractal-ref`.
