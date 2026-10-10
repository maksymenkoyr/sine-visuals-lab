# Neon Gates (`gates`)

A tunnel of neon wireframe gates — hexagonal prisms, box frames, rods and
panels pointed at the vanishing point — mirrored across the screen axes,
spinning and flying past the camera with motion blur and bloom. On a bar
boundary the tunnel morphs into another look over exactly one bar; on a beat
(or bass hit, high, bar — the Lightning on setting) a coloured current runs
through the gate lines. On main, registered as a draft scene.

## Where the code is

- `src/render/scenes/gates/layout.ts` — the pure side, tested by
  `tests/gates.test.ts`: `LOOKS` (one spec per measured regime of the
  reference, as data), `buildLook` (seeded placement of objects for a look;
  prefix-stable, so a Density increase keeps the smaller layout's objects),
  the segment index arithmetic (`segmentOf`) mirrored in the shader, the
  morph geometry (`pairLayouts`, `morphLayout`, `morphSegment`, over one
  shared slot topology — `ringVertex`/`shapePresence` redescribe every shape
  on it so a hexagon can interpolate into a rectangle into a rod), and the
  lightning path maths (`arcPathStart`, `arcLitSpan`). Topology and path
  arithmetic exist twice, here and in `glsl.ts`, kept in step by hand; the
  tests pin the TS side.
- `src/render/scenes/gates/glsl.ts` — the picture: one attribute-less
  instanced primitive, a tube segment swept through the shutter (instance =
  object, mirror copy, segment, from `gl_InstanceID`), the lightning strike
  evaluated per fragment, the blur chain and the composite. Its header
  explains the stroke, haze and the sweep taps.
- `src/render/scenes/gates/index.ts` — the `Scene`: `SETTINGS`, the
  scheduler `advanceGates` (pure, exported: *when* a morph starts, the
  one-bar morph clock `GateState.morph`, the beat clock behind the strike),
  the arc mapping functions (`arcSource`, `arc*For`, `pickArcColour`), and
  the render targets — a full-resolution RGBA8 sharp target plus two blur
  levels that follow `quality.bloomPasses`.
- Plugs into `src/render/beatListener.ts` (the strike trigger, `arcSource`,
  the same pattern Shards' cut source uses), `src/render/autoTune.ts`
  (`resolveSceneSetting` for the `auto` weights), `src/render/noiseHash.ts`
  (`hashCell` for the zigzag noise, since the strike seed grows for the life
  of the session). The bloom chain follows `powder.ts`, the empty-VAO
  instancing `ambience.ts`.

## References

The VJ loop "Neon Groove Vibes" (`4PsXO3JsQdg`), studied through `/ref`;
the bundle is `neon-groove` (`tools/.cache/refs/neon-groove/`, measurements
kept in `docs/scenes/gates/neon-groove/`). It is silent by design (every
audio format decodes to digital silence, and its description says so) and a
short loop repeated for hours, so it gave the look and the cut cadence and no
audio sync. What was taken: the measured picture (regime blocks in the
bundle's "Picture, measured" section), not a copy of its frames.

## Measurements

From the bundle's `report.md` and PR #90's verification (2026-09-05/06 and
2026-09-25):

- Reference: spin about +35–36°/s counter-clockwise in every regime, never
  reversing; the camera flies backward in most regimes and forward in one;
  hexagons are 3D prisms, frames boxes with depth, bars rods along the axis;
  stroke about 2 px at the centre and about 8 px at the edge (720p); glow
  e-fold 13–42 px per regime; two hues plus an accent per regime over a
  bloom-tinted ground; mirror symmetry across the screen axes with 22–61 % of
  objects exactly on an axis.
- Ours, measured with the reference's own detector (`reflook.measure_frame`
  on screenshots): strokes 1.9 px at the centre and 5–7 px at the edge, glow
  e-fold 13–18 px, core luminance 0.3–0.6, ground luminance 0.03–0.15,
  two-tone hues, 2-fold — inside the reference's ranges. Still short: the
  wide-bloom regimes (33–42 px) and the reference's object count.
- 2026-09-25, real Metal GPU at 1728x1117@2x: Lightning at default ran 35.9
  fps and Lightning 1 ran 22.7 fps before the per-segment liveness fix, and
  58.0 / 59.3 fps after (Lightning 0: 59.8 → 60.0).

## Decisions and pivots

- **2026-09-05 (draft, PR #90):** first build, designed from thumbnails: a
  fold plus depth-slot SDF billboards, about 12°/s spin flipping on each cut,
  forward-only camera. The user said it was far from the video.
- **2026-09-06 (rebuild from the measured picture):** `tools/reflook.py`
  overturned the draft on every axis (spin, camera direction, 3D prisms,
  stroke, glow, hues, mirror symmetry — see Measurements). Rebuilt as real
  3D: looks as data (`LOOKS`, `buildLook`), instanced swept tube segments
  with geometric motion blur (project now and a shutter ago, taps along the
  sweep), a perspective camera with per-look direction (`LOOKS[].dir`), the
  bloom chain; spin never reverses (pinned in a test). Six screenshot rounds
  tuned it: far objects piling to white at the vanishing point got a depth
  haze, near objects filling the frame got a core cap and near fade, discrete
  sweep taps showing as ladders became an adaptive tap count, and the tinted
  grounds were scaled down so bloom tints the frame instead.
- **2026-09-23 (morph instead of cut, at the user's request):** hard cuts plus
  a black Blackouts frame read as a glitch against real music. `advanceGates`
  still picks *when* (bar-wrap odds from Change rate, every
  `BARS_PER_PHRASE` bars, a drop, a free-running timer with no tempo lock) but
  a look change now starts `GateState.morph`, eased over exactly `MORPH_BARS`;
  `begin()` is a no-op while a morph runs, which is what makes it
  uninterruptible. The half-bar-cut rule and the Blackouts setting were
  removed. A Density, Shape mix or quality change also morphs in place
  instead of cutting (`GateState.rebuild`). Per-object brightness jitter moved from a shader hash
  into `LookLayout.gain`, since morphing re-pairs array slots.
- **2026-09-23 (same day):** Beat flash became the shared pattern
  (`uBeatPulse` scaled by its setting, as Caustics and Chladni do) in place
  of a hand-rolled flash accumulator; Build-up glow added with the formula
  Fluid's own setting uses.
- **2026-09-23 (same day, Lightning):** the user wanted something stronger
  than Beat flash, a current running through the lines themselves. The strike
  folds into one flat varying so the fragment shader needs no setting uniform
  of its own, and `pickArcColour` steps a colour table by the beat count,
  skipping the hue nearest the look's primary.
- **2026-09-25 (perf fix, PR #90):** while a strike was live every segment's
  quad grew by the zigzag's reach, so the strike cost a frame rate for most of
  every beat. Per-segment liveness in the vertex shader (`arcLitSpan`
  mirrors it), fragment early-outs and one zigzag strand at low detail
  brought all measured cases back to within about 5 % of the Lightning-0
  rate. Strike strength doubled the same day at the user's request, and five
  controls (sustain, thickness, crackle, speed, source) replaced the
  compile-time strike constants.
- **2026-09-30 (#231):** the Gate density setting opted out of the Cue/Play
  glide (`glide: false`), since it changes the object count.
- 2026-10-11 — Sampler units and the int uniforms (`uObjCount`, `uCopies`) now go through `GLProgram.setI`; the file's own location cache and its clears are gone. Nothing visible changed: headless before/after shots look the same. (#349)

## Tuning notes

- Judge the picture against the reference's regime frames and by the
  reference's own detector, not by the numbers alone.
- A live strike's visible window is shorter than a beat period, so a
  fixed-interval screenshot burst can miss it; poll `__viz.probe().beat.fired`
  and shoot at fixed delays after the edge (`scripts/gates5-strike.mjs`).
- Between beats, and always at Lightning 0, the picture and cost are what they
  were before the strike existed.
- Lightning on = Bass was not visually distinguishable from Beat in a short
  synthetic run; it is covered by `arcSource`'s unit tests and
  `beatListener.ts`'s source tests instead.

## Known issues and next steps

- The reference has many more, smaller fragments and heavier wide bloom on its
  gold and beams regimes.
- No run against real music of the morph or the strike has been recorded; only
  `?audio=synthetic`.
- The look of the FRAME-to-PRISM slot mapping, and where a born or dying
  object appears when two looks' layouts differ a lot, were flagged for a
  tuning pass and never eyeballed on real music.
- The phrase phase is bars counted from scene start: the runtime has no
  downbeat or phrase estimate.
- The gallery tile and the main view share scheduler state.

## Materials

- `docs/scenes/gates/neon-groove/` — measurements kept from the `/ref` bundle
  `neon-groove`: report, data, and our own shots (`ours-gates/`).
- Artifact: [Neon Gates Source Data](https://claude.ai/artifact/9jPhBNzXyU6csCwtikan6A),
  source in `docs/scenes/gates/artifacts/neon-gates-source-data.html` (its
  reference images replaced by a placeholder).
- `docs/scenes/gates/scripts/` — the session scripts (settled stills, morph
  contact sheet, strike bursts and frame rate, gallery shots); each header
  says what it does, and they may need adjusting to the current code.
- The reference media (the video and its frames) stays in the local `/ref`
  cache and the private archive (`tools/ref-archive.py`), never in this repo.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=126#/v/gates`.
- The scripts above for shots; `reflook.measure_frame` (`tools/reflook.py`)
  measures a screenshot the way the reference was measured.
- Gotchas: topology and path arithmetic live in both `layout.ts` and
  `glsl.ts` with no codegen, so change them together; settings in the Look
  group must stay one contiguous run (`tests/settingGroups.test.ts`); an
  all-black frame means a shader compile error.

## History

- #90 (24b7e2c, 2026-09-25) — adds the scene: the measured-picture rebuild,
  one-bar morphs, Beat flash and Build-up glow, Lightning with its perf fix
  and five controls.
- #137 (39c5086, 2026-09-25) — keeps the scene's materials under
  `docs/scenes/gates/`.
- #231 (4e39e9c, 2026-09-30) — Gate density opts out of the output glide.
