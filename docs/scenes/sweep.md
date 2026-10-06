# Sweep (`sweep`)

One shape drawn as a stack of copies, each copy's place, size and turn blended
from a tail end to a head end along a path, coloured by its place in the stack
on a cyclic palette, outlined, the oldest ones blurred and faded, the head on
top, on a light ground. The music moves the head along its path, scrolls the
colours through the stack and re-rolls the path each phrase; every other knob
has a jack to wire, and a Presets row at the top of the Scene card brings
back each piece of the reel. Draft scene (draft PR #379).

## Where the code is

- `src/render/scenes/sweep/stack.ts` — the pure model, pinned by
  `tests/sweep.test.ts`: `PALETTES` (+ `ROOM_PALETTE`), `SHAPES`,
  `OUTLINE_STYLES`, `rollPath`/`PathRoll` (what a seed decides),
  `stackGeometry` (Travel, Bend, Aim → the Bézier), `span` (Spread, Trail),
  `endScales` (Size, Taper), `boundarySpeed` (the bound the shader's copy skip
  relies on), `headOf`, `newPathDivisor`, and `SW`/`packFrame` (the one vec4
  array the shader reads).
- `src/render/scenes/sweep/glsl.ts` — `SWEEP_FRAG_BODY`: `shapeSdf`,
  `cubeFace`, `pal5`/`roomPal`, the per-stack front-to-back copy loop with its
  skip, the outline styles, Steps, and the Multiply layer combine.
- `src/render/scenes/sweep/index.ts` — `SETTINGS`, the `LIFT` coupling every
  jack uses, the `EMPTY` jack default, `SPEED_GAIN`/`FLOW_GAIN`,
  `NEW_PATH_GRID_DIVISOR`, the path seed plus local re-rolls, and
  `Scene.panel`.
- `src/render/scenes/sweep/pieces.ts` — `PIECES`, the reel's pieces as knob
  values (each with its reel time, path seed and hint), and `presetValues`
  (everything a Presets pill writes: every setting but `KEPT_BY_PIECES` at
  its default, then the piece's own).
- `src/ui/widgets/presetPills.ts` — the Presets section: one pill per piece,
  written through the slider path, the matching pill pressed. Generic: any
  scene can hand it presets.
- `src/ui/widgets/sweepPath.ts` — the Path section: the New path row and a
  New path button that writes the path seed setting.
- Shared systems: drives (`src/render/drives.ts` — its header's rule 1 now
  allows a jack that starts unplugged, for this scene), `noiseHash.ts` (the
  dither), the room palette roles (the Room palette).

## References

- "Colorem" by Fabio Catapano (u/fcatapano), a generative series featured on
  Behance, posted to r/creativecoding — studied as inspiration for its
  generator, palettes and edge treatment:
  https://www.reddit.com/r/creativecoding/comments/rn2yty/behance_featured_my_generative_series_colorem/
  The post's video is a silent 20 s 720×720 reel of ten pieces, 2 s each.
  Bundle `colorem` (`tools/.cache/refs/colorem/`, video in
  `tools/.cache/refs/_downloads/colorem.mp4`).

## Measurements

2026-10-05, all on the `colorem` bundle; scripts under `sweep/scripts/`.

- Cadence: a hard cut every 2.000 s (the bundle's `act` spikes at 2, 4 … 18 s;
  its CUTS finding saw 7 of the 9 — light-ground cuts). Audio −91 dB: no sync
  to measure.
- Grounds and palettes per piece (`measure_pieces.py`, k-means): the source of
  `PALETTES`. Moving heads travel about 0.13 half-heights/s.
- The generator (`deconstruct.py`, `slit.py`): old copies drift 0.14–0.58
  px/frame against 2–4 px/frame for the head, and slit-scans along each head's
  path show copies fanning out between a still tail and a moving head
  (Contours, Rings), colours scrolling through a still stack (Rings, Smear) and
  moving stripes (Flame). Every piece is one stack at different knob values.
- Overlaps multiply (`finetouch.py`): Panels' blue × purple predicts `#12357c`,
  the overlap is `#184192` (error 25 against 81 for a plain see-through
  blend); Cubes' overlap `#2d0a10` (43 vs 157); Rings (20 vs 79). Each overlap
  is darker than both colours.
- No lens colour split: R/B against G ≤ 0.5 px on Panels; the edge fringes are
  the copies just behind the head. No grain, no vignette.
- Copy spacing along Contours: even (median gap ratio 1.00).
- Contours' band profile (`edgeprofile.py`): a white highlight about 6 px, a
  dark line about 3 px (luma 60–70), then a fill grading violet → teal → pale
  over about 25 px — the Bevel outline and Rim.
- Cost, 1080p, each piece's values (`PIECES`): loop iterations per pixel
  (a debug build writes the count as colour), copy skip off → on, mean / per
  8×4 block max: Smear 14.8/15.1 → 3.4/3.6, Contours 5.4/5.5 → 1.6/1.7, Halo
  1.7 → 0.9, Drip 11.8 → 2.7, Rings 6.8/7.2 → 3.3/3.6, Candy 8.4 → 2.8, Panels
  10.2/10.6 → 3.1/3.3, Cubes 23.3/23.7 → 5.6/5.9, Haze 18.6 → 15.1, Flame
  51.7/52.1 → 23.6/24.2. Frames with and without the skip match pixel for
  pixel. GPU ms before the skip: 1.2–3.1 for most pieces, Haze 4.9, Flame
  11.6 (caustics 4.2 in the same run); after it, timings were too noisy to
  read — the user's Chrome shares the GPU.

## Decisions and pivots

- 2026-10-05, v1: eight recipes behind a Look picker, a new piece each phrase,
  head speed from energy, name Sweep (the user's picks). Speed has no floor.
- 2026-10-05, the user: "some split is kind of synthetic … deconstruct them".
  The measurements above showed one generator, so the Look picker became its
  own knobs (shape, stretch, copies, size, taper, twist, pair; travel, bend,
  aim, spread, trail; palette, shift, bands, head, rim, sheen, faces; opacity,
  multiply, outline and its style and reach; blur, head blur, fade, steps).
  The mosaic and stripe pieces, left out of v1, are now reachable (Steps; a
  dense Drop stack on Flame).
- 2026-10-05, the user: every control connectable to a driver, buttons where
  driving isn't straightforward; jacks with no natural signal start empty
  (their pick over a default wire each). drives.ts's rule 1 was amended to
  allow it. New path is a button writing a seed setting — it reaches the
  output and a room's TV and is kept in a Look; Shape and Palette stay chip
  pickers.
- Re-analysis for polish: Multiply between the stacks and onto the ground, the
  Bevel outline, the Room palette as a real option.
- The copy skip (`boundarySpeed`): same picture, 2–4× fewer iterations.
- 2026-10-06: #368 landed Level (`feature.level`, 0 in silence); Speed and
  Colour flow moved onto it from All level and Mid level, which read mic hiss.
- A setting keyed `bands` compiled to `uBands`, the common band array — the
  shader failed and the app fell back to Spectrum. Renamed `bandCount`;
  `tests/sweep.test.ts` checks no setting uniform collides with a common one.
- 2026-10-06, the user: a few presets on top, based on the reel. The reel's
  pieces became a Presets row, the first section of the Scene card, one pill
  per piece. A press sets every knob (the piece's values, the rest at their
  defaults) and the piece's path seed, keeps New path's cadence and every
  wire, and rebuilds the card like a Look apply. `pieces.json` moved into
  `pieces.ts` so the pills and the shoot scripts read one list. Opacity and
  Outline reach got a finer step so Panels' and Smear's values sit on it.

## Tuning notes

- Each reel piece's knob values are in `pieces.ts` (`PIECES`), the Presets
  pills; `lookcodes.ts` prints a Look link for each (`?look=…#/v/sweep` after
  the app's address). They are starting points: Smear is the furthest off.
- Speed and Colour flow read Level, so silence holds the picture still;
  synthetic audio always reads loud — check silence with a hiss wav on a
  fake mic.
- Quality: copies scale down on weaker presets (`uDetail`); blur and outlines
  keep the look.

## Known issues and next steps

- Smear's two lobes (teal head, ink trail) aren't reproduced.
- A `/tune` pass on real music; per-piece values are by eye.
- Haze and Flame are the costliest pieces; heavy Blur defeats the copy skip.
- The reference media isn't archived yet (`ref-archive.py` is blocked from a
  worktree session).

## Materials

- `sweep/colorem/` — our half of the bundle (report, data), from
  `tools/ref-keep.py`.
- `sweep/scripts/`: `measure_pieces.py` (per-piece grounds, palettes, sizes),
  `deconstruct.py` and `slit.py` (the generator), `finetouch.py` and
  `edgeprofile.py` (blend, colour split, spacing, band profile), `crops.py`
  (native-resolution crops), `lookcodes.ts` (each piece's Look link, or with
  `--json` the pieces as the next two scripts read them), `shoot_pieces.mjs`
  + `pair_pieces.py` (ours beside
  the reel; the paired sheet holds reference frames, so it stays in the local
  cache).
- The reference media: the local `/ref` cache; the private archive once
  `tools/ref-archive.py colorem` has run.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/sweep`.
- Compare against the reel: `lookcodes.ts --json` into a file outside the
  repo, `shoot_pieces.mjs` with it, then `pair_pieces.py`.
- Cost: `tools/gpu-bench.mjs` reads Sweep at its defaults; to bench a piece,
  swap its values in as defaults for the run. With other GPU work on the
  machine, count loop iterations instead of timing.
- Gotchas: a setting key must not compile to a common uniform's name; the
  worktree shell guard rejects heredocs and runtime-computed paths — write a
  script file instead.

## History

- #370 — v1: eight recipes and a Look picker; then v2: one generator, its
  knobs wireable, the Path widget, the copy skip.
- #379 — v2 again (#370's branch couldn't take the rebase), then the Presets
  row: the reel's pieces as pills at the top of the card.
