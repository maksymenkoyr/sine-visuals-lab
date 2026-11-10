# Mandelbox Flight (`mandelbox`)

A flight into a box-folded 3D fractal, the Mandelbox: rim-lit cells over two
turning hues on black, about half the places on the fractal's own mirror
lines, so they open as a kaleidoscope or a mirrored vault. The music's
loudness sets the pace of the flight and of the colours, so silence holds
still; kicks and claps flash the rims; a drop moves on to a new place. In
development, in draft PR #842.

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
  inspiration for the kind of image (a raymarched fractal lit at the edges,
  of the Mandelbox family by eye; its formula isn't identified), its motion
  (a steady push in), its colour drift, its mirrored stretches and its
  dissolves, and for the finding that its picture follows nothing in its
  music. Measured 2026-11-07 in two passes: the whole
  loop at low resolution (`mandelbox/scripts/hour.py`, `hour2.py`,
  `hour3.py`, `huerate.py`) and the `/ref` bundle `fractal-loop-2T33`
  (`tools/.cache/refs/fractal-loop-2T33/`) on its 27:00–29:00, where an
  unmirrored stretch cuts into a mirrored one.

## Measurements

2026-11-07, the reference. Every number was measured by the script named,
unless its line says it was read by eye or inferred:

- Loop: frames at t and t + 3600 s correlate at 1.00 (64×36 structure,
  `scripts/hour2.py`).
- Changes of look: the picture's structure correlates 0.47 with itself 4 s
  later and about 0 after 30–60 s; 9 hard cuts in the hour, 8 plus the loop
  wrap (`scripts/hour2.py`). Dissolves were never counted: one was seen by
  eye, about 1.5 s long at 75 s in the bundle. How long a look lasts isn't
  known.
- Motion, from the bundle's 120 s window only (27:00–29:00, whole frame,
  `tools/ref-scan.py`): zoom mean +0.073 log-scale/s (×1.08/s) and median
  +0.048 (×1.05/s; the window's cut and dissolve inflate the mean, from its
  `series.tsv`), rotation about 0, frame-to-frame activity 0.053; radial
  speed ∝ r^0.9 (a flat zoom) in two of its five regimes.
- Colour: the chroma-weighted hue of lit pixels turns the same way in 74% of
  minutes, at a median of one turn per 52 s within a minute; 107 net turns
  in the hour, one per 35 s (`scripts/huerate.py`). What makes up the gap
  between the two isn't measured.
- Mirror: left-right mirrored (correlation above 0.9 at 64×36) 45% of the
  hour, in three runs (12:03–15:13, 27:53–32:56, 40:15–60:00); never top to
  bottom over the hour (`scripts/hour2.py`). Only one of the three runs
  starts within 6 s of a hard cut (27:53, against a cut at 27:58). 2-fold
  symmetry 0.95–1.00 in every regime of the bundle, including stretches the
  hour pass didn't call mirrored, 43% of objects on the axes (`report.md`).
  Neither says how the symmetry was made.
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

- Brightness, 2026-11-10, with the final tints: seeds 1–12 at the default
  settings, each place's opening view, hues cycling 0, 0.25, 0.5, 0.75
  (`scripts/lab-shot.mjs`, then `scripts/lumastats.py`): mean median 0.14
  (0.09–0.40), lit median 0.28, saturation median 0.42, darkest-level share
  median 0.625. The three axis places among them are the darkest
  (0.09–0.10). Under Levitating, a frame every 5 s, measured 2026-11-08
  before the last tint trim: mean 0.13–0.22, lit median 0.31, darkest-level
  share median 0.565.
- Push in, beside the reference at its beats (`tools/ref-shoot.mjs`): the
  opening place's centre grew ×2.5 in 13.5 s, against the ×2.7 its rate
  gives. Read by eye off a contact sheet, before later flight changes.
- `tools/tune-real.mjs mandelbox`, Levitating then silence, M1 Pro, high,
  in a 960×540 window (so the march ran 540 tall, under its cap):

  | source | change med | change p95 | hits/min | kick/min | clap/min | hats/min | chord/min | drops/min | energy | fps |
  |---|---|---|---|---|---|---|---|---|---|---|
  | song | 11.86 | 19.02 | 318 | 110 | 26 | 204 | 86 | 0 | 0.66 | 120 |
  | silence | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 120 |

- Place search: 1–3 ms a place on the M1 Pro (`scripts/search-bench.mjs`).

2026-11-10, ours, the checks the first version skipped (headless Chromium on
the M1 Pro's GPU, the dev server):

- Modes: with auto-pin off, every setting probes `manual` at 90 and 140 bpm
  of synthetic audio; the scene has no `auto` tables.
- Settings, through `__viz.setParams`: Mirror On, Mirror Off and Roundness
  0.2 each moved on to a new place. Left-right correlation at 64×36 (the
  estimator `scripts/hour2.py` used on the reference): Mirror Off 0.00, the
  one Mirror On place 0.94–0.95. In `scripts/mbx-lab.html`, 20 Mirror On
  views (seeds 1–10, at the start and 20 s in) read 0.63–0.89, median 0.74;
  see Known issues. On silence with Push 0 (a steady pace of 1, nothing to
  flash or move on), over 3 s: Flight speed 0 held an axis place still
  (structure 1.000, against 0.126 at speed 1), but a free place kept its
  roll (0.93); with Colour drift 0 as well, the frame didn't change at all
  (0.00%, against 1.02% at drift 1); Rims 0 took the near-white share from
  5.4% to 0.0% and the mean brightness from 0.185 to 0.043.
- Panel: Push shows its wire to Level, Rim flash to Kick + Clap, Dissolve to
  Drop.
- Gallery: the In development tile draws (brightness 0.11 at rest, 0.13
  under the pointer); entering the scene, leaving and entering again drew
  each time (0.12–0.14), with no page or console errors.
- Drop, on the cached songs (each a 60 s clip), the probe's drop jumps
  beside a temporary log of each new place: Tarantula, Levitating, Seven
  Nation Army and Still D.R.E. fired none. Billie Jean fired three: at
  26.2 s and 46.8 s a new place followed within 0.02 s (the old ones had
  shown 26.8 and 20.6 s); at 55.3 s the place had shown 2.2 s, and the
  `DROP_WAIT_SEC` wait ran out before `MIN_PLACE_SEC`, so it stayed, as
  designed. Around the World's two drops, at 26.8 and 51.4 s, each moved on
  at once too. `tools/tune-real.mjs mandelbox --from 30 --seconds 60` on
  Billie Jean, high, in a 960×540 window (the clip ends at 60 s, so the
  song row holds 30 s of song and 30 s of silence):

  | source | change med | change p95 | hits/min | kick/min | clap/min | hats/min | chord/min | drops/min | energy | fps |
  |---|---|---|---|---|---|---|---|---|---|---|
  | song | 12.08 | 21.84 | 290 | 67 | 6 | 131 | 55 | 2 | 0.37 | 119 |
  | silence | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 120 |

- GPU time per frame at full screen, `tools/gpu-bench.mjs --app --dpr 2
  --quality <preset>` (a 1512×945 window at twice the pixels, the M1 Pro,
  synthetic audio, Crystal interleaved). On Metal a timer query around one
  draw times the whole frame, so each figure is a frame, not a sum of
  passes. `--wait 3` times a place's start. By 45 s the synthetic feed's
  drops (one per `SECTION_PERIOD_SEC`, src/audio/synthetic.ts) have moved on
  twice, so `--wait 45` timed the third place, whose straight path grazes a
  wall: its gap falls to a hundredth of the way ahead within 5 s (replayed
  in node), and rays down the opening creep along the wall until they run
  out of steps. The costliest state measured:

  | preset | canvas | march | a place's start | the third place, 6–10 s in |
  |---|---|---|---|---|
  | high | 3024×1890 | 1152×720 | 6.2 ms, 60 fps | 21.8 ms, 38 fps |
  | mid | 2268×1418 | 864×540 | 5.3 ms, 60 fps | 9.9 ms, 60 fps |
  | low | 1512×945 | 648×405 | 3.0 ms, 60 fps | 4.5 ms, 60 fps |
  | floor | 1512×945 | 518×324 | 2.5 ms, 30 fps | 5.3 ms, 30 fps |

  Crystal in the same runs: 20.5–20.6 ms at high (40 fps), 5.6–5.7 ms at low
  (60 fps); 4.0–4.1 ms at low in a later run, so these readings vary by
  about a third between runs. Depth alone costs little: on silence with
  Push 0, the opening place 45 s in (15 folds against 10 at its start) took
  6.9, 5.4, 4.0 and 3.0 ms at high, mid, low and floor. Mandelbox at floor
  costs no more per frame than Crystal at low, so it has no `minQuality`:
  the writer's rule from #829, since no TV was at hand to measure.
- Whole-frame motion, one clip each (`scripts/record-clip.mjs`: Levitating,
  Push 0 so the pace holds at 1, 1280×720, the app's Record button; then
  `tools/ref-scan.py --dur 60`), beside the reference's 120 s window measured
  the same way, in log-scale per second:

  | clip | motion line's zoom mean | zoom median | one place's median | activity |
  |---|---|---|---|---|
  | the reference, 27:00–29:00 | +0.073 | +0.048 | | 0.053 |
  | ours, `BASE_RATE` 0.073 | +0.046 | +0.035 | +0.035 (0–57 s) | 0.049 |
  | ours, `BASE_RATE` 0.1 | +0.101 | +0.048 | +0.051 (0–40 s) | 0.051 |

  The means count transitions and black frames as zoom: the reference's
  window holds a cut and a dissolve, the first clip's last 3 s a dissolve,
  and the second clip a dissolve and then 2 s of black (Known issues). The
  medians follow the steady push in, and the one-place medians leave out
  every change of place.
- `tools/tune-real.mjs mandelbox` at `BASE_RATE` 0.1, Levitating then
  silence, high, in a 960×540 window:

  | source | change med | change p95 | hits/min | kick/min | clap/min | hats/min | chord/min | drops/min | energy | fps |
  |---|---|---|---|---|---|---|---|---|---|---|
  | song | 14.63 | 21.88 | 336 | 118 | 20 | 200 | 80 | 0 | 0.66 | 120 |
  | silence | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | 120 |

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
  centred vaults, and places on the symmetry lines looked much closer to it
  than a wall seen across (by eye). Symmetry alone can't tell a camera on a
  mirror plane from a mirror applied afterwards, so how the reference was
  made isn't known; no one has looked for a seam.
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
  each new place arrives with its own jump (`hueJump`): a guess at what
  makes up the reference's faster net turn rate, never measured across one
  of its dissolves.
- 2026-11-08: Rim flash toned down after it held the frame half white on a
  song with a kick and a clap every beat.
- 2026-11-10 (#829): `BASE_RATE` from 0.073 to 0.1, so that our whole
  frame's median zoom matches the reference's (Measurements). The first
  version had set it to the reference's mean zoom, but its window's cut and
  dissolve inflate that mean, and our whole frame read slower than our
  target's rate. #829 said to scale by the ratio of the two motion lines
  (×1.59, to 0.116); their means count transitions as zoom, so this took
  the ratio of the medians (×1.37) instead: the owner's call to confirm. A
  place now runs about 45 s at a steady pace, not about a minute.

## Tuning notes

- Roundness sets the fold scale (`foldScale`); boxier views come from lower
  values, not yet compared with the reference's box panels.
- Mirror's Per place mix is `KIND_SHARES`; On keeps to axes and planes, Off
  to free places.
- Judge the look with `scripts/mbx-lab.html` at fixed seeds and hues, and
  `scripts/lumastats.py` against the reference's medians above; judge the
  reactions with `tools/tune-real.mjs`, which must show a still picture in
  silence.
- Quality presets change the march target's height and step count
  (`MARCH_HEIGHT`, `MARCH_STEPS`); the app also shrinks the canvas below
  high and caps floor's frame rate. Every preset's cost is in Measurements.
- To force a preset in a headless run, store it as the Quality choice
  (`vibe.quality`), as `tools/gpu-bench.mjs --quality` does: `?quality=`
  alone yields to the stored choice, High on a fresh profile.

## Known issues and next steps

- The reference's cells are boxier, whiter panels; at the default Roundness
  ours lean toward bubble lattices.
- Axis places look alike: each axis is one family of views along a line.
- The camera never steers: a place ends when its zoom is spent, where the
  reference's camera may turn through openings.
- Mirror On's views aren't mirrored to the pixel, though the fractal is:
  `MARCH_BODY` finds the normal and the rims from four probes at the corners
  of a tetrahedron about 2 px across, which isn't mirror-symmetric, at a
  scale where the fractal has detail, and its light comes from the upper
  right. In a lab copy (2026-11-10, the 20 views above), six probes along
  the axes took the median correlation from 0.74 to 0.97, and a light with
  no sideways part as well to 1.000. A change to the look: the owner's call,
  with #830.
- At Flight speed 0 a free place keeps rolling, by up to `ROLL_MAX`: the roll
  follows the pace, not Flight speed.
- Places whose straight path grazes a wall, found by replaying the flight
  in node at a pace of 1 (2026-11-10, the first 10 places at the default
  settings, in order from `FIRST_SEED`); the view test only judges a place's
  first view:
  - Two of them reach `DE_FLOOR` within seconds (after 3.2 and 6.5 s at the
    old `BASE_RATE`), where the others run 45–62 s. Seen live on Billie Jean
    and Around the World: the third place lasted 6.4 and 6.8 s.
  - The second place's gap falls to a ninetieth of the way ahead about 3 s
    in, the march's reach, so the picture goes black for about 2 s; then it
    faces a wall a few gaps away, dim and nearly still, for over half a
    minute (seen in the second motion clip). It is the second place every
    viewer meets.
- Colour drift's description says the colours go round about every
  half-minute; at 1 they take `HUE_PERIOD_SEC` a turn, about a minute.
- At high, full screen on the M1 Pro, a place whose path grazes a wall
  costs 21.8 ms a frame (38 fps), 3.5 times a place's start: the same short
  places as above. Mid and below hold their frame rate.
- A section-boundary edge in `src/audio/` would allow the move to a new place
  on a new section, as first proposed.

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
  (`search-bench.mjs`), shooting the sketch (`sketch-shot.mjs`), and
  recording a clip of ours with a song at a steady pace, for
  `tools/ref-scan.py` to measure its motion (`record-clip.mjs`).
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
- Whole-frame motion: `node docs/scenes/mandelbox/scripts/record-clip.mjs <port> <song.wav> <out.webm>`, then `uv run tools/ref-scan.py <out.webm> --name ours-mandelbox-clip --dur 60` with a working ffmpeg first on `PATH`.
- GPU cost per preset: `node tools/gpu-bench.mjs --port <port> --app --scene mandelbox --dpr 2 --quality <preset> [--wait 45]`.
- Gotchas: a black picture in flight means the camera has no target (log
  `flight.gap` and `flight.ahead` once a second); a setting's `u<Key>` must
  not collide with `EXTRA_UNIFORMS` (`uFlash` is the setting, `uFlashNow` the
  envelope); a Park–Miller search seeded small needs its warm-up draws.

## History

- #826 (draft, closed): the first version, its record and materials.
- #842 (draft, supersedes #826 after a rebase): #829, the checks the first
  version skipped, the record saying only what was measured, and
  `BASE_RATE` 0.1.
