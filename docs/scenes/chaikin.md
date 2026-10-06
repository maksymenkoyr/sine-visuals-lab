# Chaikin Curves (`chaikin`)

A field of black, round-cornered Voronoi cells on white, a white dot on every
seed and faint grey lines between neighbouring seeds, flying outward from a
white core. It opens on one big cell; births fill in from a ring that closes
on the centre while the zoom starts. The music sets how fast the cells fly
(Speed), seeds a pulse of extra cells near the centre on each bass hit
(Births), pulls the field back into one big cell on a drop (Relaunch) and
brightens the lines with the treble (Lines). On top of the zoom the cells
move in two layers, each with its own amount: Swell rolls water waves across
the field, locked to the bar and rising with the level, and Fireflies gives
every cell its own clock that pops it, pulled into step by its neighbours, by
the level and by the drop. In development, on main.

## Where the code is

- `src/render/scenes/chaikin/launch.ts` — the clock, pure and pinned by
  `tests/chaikin.test.ts`: `stepLaunch`/`createLaunchState` (zoom `z`,
  launch clock `tau`, the relaunch ease, the kick ring buffer), `frontAt`
  (the birth front, floored at `FRONT_FLOOR`), `zoomIntro` (the zoom's ramp
  over the opening), `latticeU` (the lattice's radial coordinate, asinh of r
  over `CORE_R`), `splitZoom` (the zoom cut into whole rows plus a fraction,
  in float64) and `kickDeltaZ`. Its header says why the lattice isn't plain
  ln r.
- `src/render/scenes/chaikin/seeds.ts` — every seed, laid out on the CPU
  each frame into a float array: `fillSeeds` (cells, births as a power
  weight, kick children via `childAlive`), `rowsFor` (rows that reach the
  screen's corner), and the texture layout (`TEX_W`, `PHASE_COL`,
  `MAX_ROWS`, `ROW_LO`). Hashes with the same integer hash as
  `noiseHash.ts`, on integer rows wrapped at `ROW_PERIOD`. A frame's `move`
  callback offsets each seed and changes its weight, under the soft caps
  `MAX_SHIFT` and `MAX_WEIGHT`.
- `src/render/scenes/chaikin/motion.ts` — the two motion layers, pinned by
  `tests/chaikin.test.ts`: Swell (`swellBar`, the eased bar clock;
  `swellFrame`, the wave trains of `SWELL_WAVES`; `addSwell`, one seed's
  move) and Fireflies (`stepFireflies`, Kuramoto phases in a ring of rows
  keyed by global row; `addPop`; `fireOrder`, how in step they are). Its
  header has the formulas and why they're shaped that way.
- `src/render/scenes/chaikin/glsl.ts` — `CHAIKIN_FRAG`: reads candidates
  back with `texelFetch` (`eachCandidate`, written out once per pass), then
  three passes — `nearest` (power distance), `survey` (two nearest
  bisectors, dots, line candidates), `verify` (only near a corner or a line:
  is the corner real, is the line's bisector an edge, via `clipEdge`).
  Rounded corners are a tangent circle; the white core is two fades
  (`CORE_PX0`/`CORE_PX1` by pixel size, `CORE_FADE_IN`/`CORE_FADE_OUT` by a
  cell's seed radius).
- `src/render/scenes/chaikin/index.ts` — the `Scene` (`chaikinScene`),
  `CHAIKIN_SETTINGS`, `step` (settings and drives into `stepLaunch`),
  `kidSpan` (where the shader should look for children), and the seed
  texture (`ensureTexture`, `beforeDraw` uploads it once a frame). `step`
  also reads the motion settings and drives; `beforeDraw` steps the
  fireflies once a frame and hands `fillSeeds` the `moveSeed` callback. The
  probe reports the fireflies' `sync` (`fireOrder`).
- Plugs into: drives (`drives.fired`/`drives.value` for Births, Relaunch,
  Speed, Swell, Pull and Drop sync; `linesDrive` in GLSL for Lines), the palette roles (`uPalGround`,
  `palRamp`, `uPalAccent`, for Colours), and `createFullscreenScene`'s
  `beforeDraw`/`onDispose` hooks, added for this scene's texture.

## References

- **"Dann hebt er ab und…"** by u/BennyPendentes, r/creativecoding, 2020
  (<https://www.reddit.com/r/creativecoding/comments/j6ol1a/>, video
  <https://v.redd.it/yukhonazgnr51>), 720×720, 30 fps, 50 s, silent. The
  author made it in Processing from a Voronoi diagram, its Delaunay
  triangulation and Chaikin's corner cutting. Studied for its look and its
  motion — the opening on one cell, births closing on the centre, the zoom
  — and measured whole in the `/ref` bundle `hebt-ab`
  (`tools/.cache/refs/hebt-ab/`). Written independently: no code from the
  author, and the corners are rounded by a tangent circle rather than
  Chaikin's algorithm. Being silent, it sets no sync: every reaction here
  is a design choice on top of its measured motion.

## Measurements

2026-10-05, the reference (`hebt-ab` scripts, r in half-heights):

- Black cells; the white ground shows as edges about 2 px wide at 720
  (constant in pixels, no glow); corners rounded by about 10% of a cell;
  white seed dots about 3 px; grey Delaunay lines about 1 px at
  luminance 0.3.
- Steady state: sqrt(cell area) about 0.14·r (area/r² 0.020, CV 0.40 —
  between Poisson 0.53 and a relaxed pattern); about 520 cells visible; a
  white blob at the core; no spin; no cuts (the scan's transitions and
  "strobes" are noise).
- Opening: one cell at t = 0; the central cell's radius falls from 0.95 to
  0.013 by 24 s, about 0.175 per second in ln r; births in a band at about
  twice the central radius; the zoom (d ln r/dt) is 0 until about 5 s, ramps
  over 8–20 s, then cruises at about 0.2 (0.25 near the core, 0.14 at the
  edge).
- Radial speed by r (report.md, regime 1): 0.07 → +0.04, 0.21 → +0.07,
  0.39 → +0.09, 0.61 → +0.12, 0.87 → +0.15 half-heights/s — faster near the
  core than a pure zoom, which is what U = asinh(r / r0) gives (r0 0.155
  predicts 0.034, 0.052, 0.084, 0.126).

2026-10-06, ours against it (`hebt-ab/scripts/cells.py` on a 720×720
recording, `scripts/record.mjs`, synthetic 124 BPM, Births 0; `cells-ref.json`
and `ours-chaikin/cells-ours.json`):

| | ref | ours |
|---|---|---|
| dark cell sqrt-area, r 0.15–0.3 | 0.033 | 0.030 |
| r 0.3–0.5 | 0.059 | 0.053 |
| r 0.5–0.7 | 0.087 | 0.081 |
| r 0.7–0.9 | 0.112 | 0.108 |
| r > 0.9 | 0.115 | 0.121 |
| cells counted (steady) | ~520 | ~650 |
| k = radial speed / r (steady) | 0.17–0.18 | 0.14–0.19 |

- Ring brightness (`scripts/rings.py`, one steady frame each, ref vs ours):
  mean 0.361/0.397 (r 0.15–0.3), 0.241/0.237 (0.3–0.5), 0.175/0.149
  (0.5–0.7), 0.144/0.115 (0.7–0.95). With 2 px edges ours carried 1.4–1.7×
  the reference's white in every ring and 20% more light in the middle; the
  reference's JPEG blurs its edges into grey, so the mean is the fair
  number.
- GPU cost, `node tools/gpu-bench.mjs --app --dpr 2` (3024×1890), Caustics
  10.9–12.6 ms on the same runs: seeds built in the shader into an array
  filled at a running index, 26 ms in the opening; rebuilt in full every
  pass, 41 ms; per-row shared hash/exp/sin-cos inside one pass loop, 55–62
  ms; slots with literal indices, 21 ms opening / 32 ms steady (children
  alone 16 ms); seeds from the CPU in a texture, 8.5 ms opening / 12.6 ms
  steady.

2026-10-06, the motion layers:

- In the prototype page (`chaikin/artifacts/motion-lab.html`, its own
  synthetic 16-bar song: intro, groove, build, drop), seed offsets as RMS in
  cells over a whole song, Speed 0 and Births 0 so only the motion moves:
  Swell 0.16 in the intro, 0.20 groove, 0.21 build, 0.27 drop, flat across
  the beat; Fireflies' pops smeared across the beat in the intro (0.07–0.12
  in every eighth), bunched toward the beat in the groove and build, and all
  on it after the drop (0.18–0.20 at the beat, 0.00 between).
- At every motion at full strength, a shader searching two columns each side
  instead of one changed at most ~200 white pixels a frame at 1148×646 (a
  wedge's shape here and there), so `MAX_SHIFT` 0.6 fits the scene's
  search; the white wedges at junctions are the tangent-circle rounding of
  acute corners, which squeezed cells make more often, not missed seeds.
- In the app (synthetic audio, 124 BPM, 1280×720, Metal): fps the same with
  both layers on or off (~60, headless vsync); the fireflies' sync
  (`fireOrder`) 0.15–0.30 on that steady audio, never a full lock without a
  drop. CPU for the seed layout (`fillSeeds` and the fireflies' step), per
  frame in Chromium: 0.05 → 0.32 ms at Cells 44 and 0.20 → 1.29 ms at Cells
  96 with both layers on.

## Decisions and pivots

- 2026-10-05: measured with `/ref`; the user picked "build as proposed" and
  the name. Design agreed: per-pixel Voronoi on a jittered lattice in
  (ln r, θ) so cell size grows with r for free, a per-row phase against
  spokes, a birth front that closes on the centre, rounded corners, lines
  only between real neighbours, a white core where cells get too small; the
  four reactions as real wires (Speed ← All level, Births ← Bass hit,
  Relaunch ← Drop, Lines ← Treble level).
- 2026-10-06: rounded corners first as a smooth minimum over all bisectors;
  on the many-sided central cell it eroded the whole outline into a thick
  white ring. Replaced by a circle tangent to the two nearest bisectors,
  applied only when the corner is real (where they meet satisfies every
  other half-plane) — without that check, phantom corners drew white
  wedges inside cells.
- 2026-10-06: kick children shattered the central cell in the opening; a
  child is now alive only past the birth front too.
- 2026-10-06: the core fade first keyed on the nearest-neighbour distance,
  which a child or a half-born seed shrinks — grey-filled cells mid-field
  and a black dot in the core. Keyed on the lattice's cell size instead.
- 2026-10-06: plain ln r made the core too big and smooth and froze the
  cells there, where the reference's leave the core fast; switched the
  lattice to U = asinh(r / `CORE_R`) — ln-like far out, linear inside — which
  also removed the pixel-based front floor. Near the centre a cell is
  narrower in angle than in radius, so a pixel's three-column search can
  miss its true neighbours (black specks); cells whose seed is inside the
  core fade to white whole, which also gives the reference's ragged blob.
- 2026-10-06: performance (Measurements, GPU cost): moved seed generation to
  the CPU and a float texture; the shader re-fetches candidates each pass
  instead of holding them.
- 2026-10-06: calibrated against the reference with its own scripts: edges
  2 px → 1.5 px at 720 and lines slightly wider and brighter (ring
  brightness), `CORE_R` 0.155 → 0.2 and cruise zoom 0.2 → 0.24 (radial
  speed with typical synthetic levels), children's life shortened so each
  kick reads as a pulse instead of a constant swell.
- 2026-10-06: the user asked for the cells to move — "some kind of bounce,
  waving … complexed and synced" — with controls and quick prototypes. Four
  were built in one page on a JS copy of the scene (Materials): Shockwave (a
  damped spring on a ring each kick sends out), Drum skin (circular-membrane
  Bessel modes struck by kick, snare and hats), Ocean swell (Gerstner waves
  locked to the bar) and Fireflies (Kuramoto oscillators). The user picked
  Ocean swell ("great") and Fireflies ("amazing"), as layers that can run
  together, each with its own amount, both on by default.
- 2026-10-06, from the prototype's measurements: the swell's height first
  ignored the music (flat through the song), so it now rides All level; the
  fireflies first locked fully in every section, so the pull went from
  linear in the level to its square and the Beat lock default came down —
  scattered in a quiet intro, in step after the drop. Pull reads its drive
  with a rest of 1, so with nothing plugged in the slider alone sets it, and
  Swell's rest leaves the slider's own height. Arms and Travel are whole
  numbers and kept off the Master Scale (`masterScale: false`), or the
  waves would tear at the angle's seam and stop repeating on the bar.

## Tuning notes

- Judge the opening (first ~25 s after the scene opens) and the steady state
  separately; the opening replays after every Relaunch.
- Births: the visible reaction is the core swelling and relaxing with each
  bass hit; at 1 the band stays dense through a fast kick pattern. Compare
  with Births 0 to see it.
- Relaunch: synthetic audio rarely makes a drop; to see it, wire Relaunch to
  a two-bar beat grid (`scripts/shot.mjs --drives`, its header has the JSON).
- Speed rides All level over a floor, so a quiet passage still drifts.
- Cells changes the lattice itself, so moving it reshuffles the pattern
  rather than resizing it.
- Swell and Fireflies: compare against both at 0 to see what they add, and
  set Speed 0 to watch them without the zoom. Swell repeats on every bar, so
  judge it over a few bars; its Punch shows best near 1. Fireflies tell their
  story over a song: watch a quiet passage drift apart and a drop pull them
  together. In full step every cell's weight rises at once, which moves no
  walls, so a fully synced field only breathes outward.

## Known issues and next steps

- Only checked on synthetic audio; not yet on a real track or a real drop.
- The outer rings read 15–20% darker than the reference (its lines look
  more numerous and brighter); the innermost ring 10% brighter.
- Around the end of the opening (τ ≈ 20–24 s) the last of the central cell
  sits in the core as a small black blotch among half-born cells — the
  reference does much the same, but ours is less tidy.
- Near the centre the lattice is anisotropic and hidden by the core fade. An
  isotropic alternative — rows with their own column counts, cells dividing
  as they fly out — would match the reference's mid-radius sizes without
  the fade, at the cost of seeds changing identity.
- Not yet run on a phone; the seed texture is RGBA32F, uploaded every frame.
  The fireflies' step is the heaviest CPU part, worst at high Cells.
- The motion layers are checked on synthetic audio only, and the app's
  synthetic audio has no drop, so Drop sync was seen only in the prototype.
- With motion on, white wedges at acute corners show more often (Measurements).
  If they read as glitches on a real screen, a smaller corner radius on cells
  being squeezed would be the next thing to try.
- Not taken from the prototype: Shockwave and Drum skin (the page still has
  them, with formulas).

## Materials

- `chaikin/hebt-ab/` — our half of the `/ref` bundle, saved with
  `tools/ref-keep.py`: the report and data (`report.md`, `look.json`,
  `series.tsv`, `audio.json`), the reference's cell measurements
  (`cells-ref.json`), the bundle's measuring scripts (`scripts/`: `cells.py`,
  `early.py`, `births.py`, `geom.py`, `crops.py`), and our shots and
  measurements (`ours-chaikin/`: the opening and steady state, and
  `cells-ours.json`).
- `chaikin/scripts/` — `shot.mjs` (headless frames, `--drives` to seed a
  wiring), `record.mjs` (a square recording for `cells.py`),
  `probe-auto.mjs` (the auto/manual sign-off), `rings.py` (ring
  brightness).
- `chaikin/artifacts/motion-lab.html` — the motion prototype page
  (2026-10-06): the scene's shader and a JS copy of its seed layout and
  clock, four motions with their dials and formulas, a synthetic 16-bar song
  with a Web Audio drum kit on the same clock. Opens straight from disk; it
  was also published as a private claude.ai artifact.
- The reference media (the video, frames, bursts, sheets): only in the local
  `/ref` cache, `tools/.cache/refs/hebt-ab/` and `_downloads/hebt-ab.mp4`.
  Not yet in the private archive (`python3 tools/ref-archive.py hebt-ab`).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/chaikin`.
- Frames: `node docs/scenes/chaikin/scripts/shot.mjs <prefix> --port P
  --at 1,5,9,15,22,34`; GPU cost: `node tools/gpu-bench.mjs --port P --app
  --scene chaikin --dpr 2 --wait 30` (`--wait` past the opening, which costs
  less than the steady state).
- Re-measure: `scripts/record.mjs` then `uv run
  docs/scenes/chaikin/hebt-ab/scripts/cells.py <webm> 3 out.json`; set
  `--settings '{"births":0,"swell":0,"fireflies":0}'` to compare with the
  silent reference, which has none of the motion.
- Gotchas: a `Float32Array` stores `Math.min(LIFE, age)` as slightly under
  `LIFE`, so compare before storing (the kick ring buffer never retired
  until that was fixed); seed data built inside the shader was the slow
  part, not the Voronoi arithmetic — keep it in the texture.

## History

- #380 (draft): the scene, its clock, seed texture, record and materials.
- (this PR): the Swell and Fireflies motion layers, from the motion
  prototype page.
