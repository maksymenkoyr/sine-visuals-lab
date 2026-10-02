# Sky (`sky`)

Looking straight up at a soft sky: fluid-sim clouds drift on their own,
while the music plays through illusions of the viewer's own eye — streaks
of floaters a wandering brush stamps on each beat, a pale ring of light
that glints through them on each beat, and Haidinger's brush turning over
the centre of view. The sky runs a 24-hour day with no night. Featured,
registered right after Physarum 2 and absent from `draftIds` in
`src/render/scenes/index.ts`.

## Where the code is

- `src/render/scenes/sky/sky.ts` — the whole scene: `SETTINGS`, the display
  shader (`buildDisplayFrag`), and the pure, tested helpers the render loop
  drives it with. The file header walks through every part.
  - Clouds: `DRIFTER_SEEDS` sources placed by `driftCenter`, gated on and
    off by `drifterPuff`; the shader's `cloudBumpedAt` is the one cloud
    field that both the cloud pass and the floaters' keep-off check read.
  - Floater stamps: `stepBrush` (the wandering spawn point), 
    `pickSwarmCenter` (nudges a stamp to the clearest spot near the
    brush), `spawnFloaters`, `floaterCountFromEnergy`, `createWavePool`
    (per-stamp `life`), `waveLifeSec`, `floaterGain`; in the shader
    `streakDensity`, `floaterPath`, `floaterStrand` and `floaterProfile`,
    sized by `FLOATER_SCALE`.
  - Beat light waves: `sweepSlot` and the shader's `lightWaveAt`.
  - Day cycle: `dayRatePerSec`, `advanceDayOffset`, `nightSpeedup`,
    `sunElevation`; in the shader `dayWeights` and `dayMix` over the
    `DAY_KEY_E` keys.
  - Haidinger's brush: `advanceBrushPhase`.
- `src/render/scenes/fluidSim.ts` — the stable-fluids solver, shared with Neon
  Fluid. Sky passes `SKY_SPLAT_SLOTS` as its `splatSlots` and `edge: false`.
- `tests/sky.test.ts`; the solver's pure helpers are tested in
  `tests/fluid.test.ts`.
- Shared systems: `beatListener.ts` (one shared `beat` listener — its
  edge feeds both the floater stamp and the light sweep); `sceneCommon.ts`'s common
  uniforms and `ROOM_UV_GLSL` (clouds use room space; the eye illusions use
  this device's own screen).

## References

No `/ref` video. The scene was built from still images the user pasted into
the build session, with sources not recorded, kept with our screenshots and
measurement scripts in the local bundle `tools/.cache/refs/sky-stills/`
(see its `README.md`). All were studied for look and structure only:

- Photos of eye floaters (bundle `ref/01`, `03`, `06`) — the floater look.
  `06` was decisive: a floater is a hollow, see-through tube with a bright
  rim and a dark fringe, and the dots are the same profile as a disk.
- Real-sky photos (`ref/02`, `04`, `05`) — cloud coverage, the hazy pastel
  palette, and internal shading contrast.
- Two web-page graphics of text-grid streaks (`ref/07`, `08`) — a slanted,
  stair-stepped streak of `>` with `_` along its fringe and an `o` hotspot.
  Their *arrangement* became how floater waves are laid out; the look stayed
  our floaters (see Decisions, 2026-09-24).
- Concept origin: the "Open Sky Illusions" preview artifact built at the
  start of the session, with seven candidate sky-gazing illusions. The user
  picked three: blue field entoptic phenomenon (later cut), floaters and
  Haidinger's brush.
- A product landing page's gradient background (the Codex page), pasted
  2026-09-27 as "the colour palette I like; the darkest it gets should be
  around there". Studied for its colour palette only; it set the Horizon
  glow key. Local bundle `sky-palette-ref`.
- A phone photo of fair-weather cumulus on a deep blue sky, pasted
  2026-09-28 with "too many settings right now". Studied for cloud
  structure (count, sizes, heaped outlines, lit tops over grey bases) and
  the midday blue. Local bundle `sky-cumulus-ref`.

## Measurements

- 2026-09-22 — open-sky photo (`ref/02`): 40.2% of pixels above lum 180,
  core ~242. Ours after the threshold fix: 40.4% above lum 200, core 248.5.
- 2026-09-23 — hazy cumulus (`ref/05`): lum p1 = 150, internal std ~24,
  shadow fold RGB ≈ (156,151,172), highlight ≈ (255,255,254). Ours: std
  ~13.9, accepted since run-to-run noise is large.
- 2026-09-23 — our dye density inside cloud (debug render): median ~0.8,
  p90 ~1.65, about 3× Storm's. So the shadow weights were recalibrated
  (0.85/0.52) rather than reusing Storm's (1.9/1.15), which collapsed
  shadow to ~0.
- 2026-09-23 — floater cross-section (`ref/06`, sky lum ~172): dark fringe
  −15..−20, rim +10..+15, interior +2..+4. Tube ≈ 0.034 of screen height
  wide (rim ≈ 0.007, fringe ≈ 0.008), strands 0.25–0.35 long, dot radius
  ~0.03. Ours after the rebuild: fringe −10%, rim +8%, interior +2%, with
  rim-to-rim 0.026 thinned to match 0.017.
- 2026-09-24 — text grid (`ref/07`, `08`): column pitch 19 px, row pitch
  26 px on a 740 px-tall frame (0.0257 × 0.0351 of height). Glyph RGB
  ≈ (225,232,253) on (160,183,249). `>` is ~11×10 px with a ~2.5 px
  stroke, `o` ~12 px, `_` ~12 px with a ~7 px gap.
- 2026-09-24 — sky colour. The pre-change sky was hue 220°. The first
  pink-purple pass (zenith 239°, horizon 274°) was too purple. Final:
  zenith 234°, horizon 257°, brightness 0.67 → 0.61.
- 2026-09-24 — `?audio=synthetic` over ~8 s: 16 broadband onsets, 0
  low/mid/high onsets.
- 2026-09-24 — a drifted day spends under 10% of its time in the skipped
  night (`nightSpeedup`, pinned by a test).
- 2026-09-27 — darker, narrower sky (`SKY_SPREAD` 0.6, `SKY_LEVEL` 0.86).
  Mean colour of the top and bottom tenth of a 1280×800 frame, Day drift 0,
  clouds included. Early evening (Time of day 0.71): hue 226° → 315°
  became 229° → 261°, lightness 0.49 / 0.81 became 0.42 / 0.71. Sunset
  (0.745): 242° → 8° became 259° → 357°, bottom saturation 0.89 → 0.53.
  Midday barely moves (217° / 214° either way).
- 2026-09-27 — sun pushed out (`SUN_DISTANCE` 1.4). By the shader's own
  glow terms at the default Time of day (0.71), the nearest frame edge
  was 0.16 from the sun (halo 0.68, core 0.24 of full strength) and is
  now 0.54 (halo 0.27, core ~0). At noon the sun moved from on the top
  edge to 0.2 above it. Bottom-tenth lightness at golden hour (0.745)
  went 0.67 → 0.63.
- 2026-09-27 — palette reference (`sky-palette-ref`, background only,
  text and the app window masked, `measure_palette.py`): hue p5..p95
  224°..244°. Luma p10 / p25 / p50 / p75 / p90 = 0.30 / 0.53 / 0.64 /
  0.76 / 0.86, darkest 5% (0.108, 0.137, 0.322). k-means palette, dark to
  light: (0.152, 0.179, 0.395), (0.420, 0.445, 0.690), (0.468, 0.524,
  0.883), (0.604, 0.636, 0.885), (0.710, 0.747, 0.941), (0.847, 0.861,
  0.970).
- 2026-09-27 — our new floor (Time of day 0.9), measured the same way:
  hue 227°..235°. Luma 0.31 / 0.35 / 0.56 / 0.75 / 0.88. Palette (0.255,
  0.304, 0.690), (0.354, 0.397, 0.742), (0.471, 0.507, 0.805), (0.608,
  0.631, 0.869), (0.735, 0.754, 0.950), (0.871, 0.888, 0.998). The light
  and mid tones match. The dark end stops at luma 0.31 (the reference's
  corners reach 0.14), and the gradient keeps more of the frame near the
  zenith, so the median is 0.56 vs 0.64. Before this, the floor's top was
  navy, about (0.21, 0.17, 0.29).
- 2026-09-28 — cumulus photo (`sky-cumulus-ref`, `measure_clouds.py`,
  cloudness from blue-minus-red): coverage 32.8%, 8 clouds ≥ 0.3% of the
  frame plus 7 smaller pieces, the biggest holding 27% of the cloud area,
  size (equivalent diameter / sqrt(frame area)) p50 0.21, outline
  crinkliness 3.1 (the haze between clouds counts). Clear sky top (0.231,
  0.366, 0.590), bottom (0.332, 0.508, 0.700). Cloud luma p5 / p50 / p95
  0.77 / 0.84 / 0.90.
- 2026-09-28 — ours before the rework, same portrait frame at noon: one
  smoky hook-shaped mass, 3 clouds, the biggest holding 93%, crinkliness
  2.3, and a pale horizon with no clear sky in the bottom fifth.
- 2026-09-28 — ours after the cumulus round (reverted the same day, see
  Decisions), two samples 20 s apart: coverage 27–28%, 7–8
  clouds plus fragments, the biggest 24–33%, size p50 0.17–0.22,
  crinkliness 1.5–1.6. Clear sky top (0.231, 0.368, 0.593), bottom
  (0.328, 0.501, 0.697). Cloud luma p5 / p50 / p95 0.85 / 0.95 / 0.96.
- 2026-09-28 — frame rate, real GPU, 2560×1600: 120 fps before (the
  display cap), 48 with the cumulus round's edge noise, 120 again once
  clear sky skipped it.

## Decisions and pivots

- 2026-09-22 — Concept: a real gas sim for clouds, with the music carried
  by sky-gazing optical illusions. v1 had blue field dots, floaters and
  Haidinger's brush (#133, `36608e4`).
- 2026-09-23 — Blue field dots cut; they read as noise. A gain/gamma
  density remap couldn't make a cloud edge (a smooth remap of a smooth
  field stays smooth), so it became a real `smoothstep` threshold.
  Floaters became curved strokes (`19477e3`).
- 2026-09-23 — Storm's two-tap shadow ported to 2D for internal folds,
  and a ring floater variant added (`512bbd4`).
- 2026-09-23 — "Floaters look horrible, can't you compare to the image?"
  The size and aspect statistics had missed that the path was a zigzag:
  independently hashed kinks per point. The path is now heading-integrated
  (`c16982b`).
- 2026-09-23 — The new floater photo showed hollow refractive tubes, so
  floaters were rebuilt as a signed-distance profile that modulates the
  sky multiplicatively (`5825e44`), then shrunk (`34dab4e`).
- 2026-09-23 — Clouds were "one big blob". Ten small spread drifters
  replaced three centre-hugging ones, and the sim's 4-slot splat cap
  (sources past 4 silently dropped) was raised to 12 (`35d9416`).
- 2026-09-23 — Floaters now appear only in waves, as drifting swarms
  that keep off the clouds (`8c88b80`). Floaters form and dissolve one by
  one, and strands are aligned (`4bbc04f`).
- 2026-09-24 — Waves fire on treble, and the text-grid refs arrived. I
  first built literal `>`/`_`/`o` glyphs; the user asked to keep the tube
  floaters and only arrange them like the symbols (`b1dc34a`). Then 2.5×
  smaller (`0e4e094`).
- 2026-09-24 — Darker sky with a slight pink-purple cast, and stronger
  floaters. A rainbow beat wave across the whole sky was rejected: waves
  go only through the floaters (`bf9f548`, `6750ed7`).
- 2026-09-24 — Day cycle, done for quality: key colours on sun elevation,
  a sun halo, sun-lit clouds, stars. The first pass included night
  (`6750ed7`).
- 2026-09-24 — Light waves as thin, dim, fast radial rings in the sky's
  own tints, not a rainbow band. Floater visibility and sustain settings
  added (`535ce65`).
- 2026-09-24 — "Skip night sky": elevation floored at the horizon-glow
  key, drift speeds through those hours, stars removed (`1ad78c0`).
- 2026-09-26 — Patch bay: nine settings carry a `drive` jack, every one
  Scene-default so the look at default didn't move (checked against
  before/after headless screenshots). `waveStrength`'s jack owns the floater
  wave trigger *and* grade (`drives.fired()`/`drives.value()` around the
  treble listener, which still advances every tick so its hold clock keeps
  running — physarum's `beatSeeder` note); `lightWaves`' owns the beat sweep
  the same way; `brushOpacity`'s Scene composite is the shader's own
  `(1.0 - 0.4 * uEnergy)` dim; the remaining six are "steady" ports on the
  ambient amounts (Cloud cover, Flow speed, Turbulence, Floaters, Cloud
  brightness, Floater visibility). Section drops still fire their own wave
  as a scene layer beside the drive (moire's blackout precedent), and
  `waveFrequency`/`floaterSustain`/`timeOfDay`/`dayDrift` deliberately carry
  no jack — hold, lifetime and day-timeline params, per drives.ts's
  boundary; `sky.test.ts` pins both the jack list and the exclusions.
- 2026-09-26 — Wave strength made the master spawn param. Both amounts at
  0.00 still spawned full-size floaters: render() never read them, the
  shader's swell `mix(1.0 - uWaveStrength, 1.0, amp)` *collapsed to full
  size* at amount 0 (lower slider = fatter light tick), and Floaters was
  floored at 0.1. Now `spawnWaveStrength` gates both spawn paths (treble/
  wired and the drop layer) on wave amount × floater product × graded
  strength > 0 — the same product the shader's new off-gate checks, so a
  live wave dies the instant either slider hits 0 — and
  `streakDensity` scales the swell by `uWaveStrength / WAVE_STRENGTH_REF`
  (REF interpolated from the setting's own default, so at the default the
  factor is exactly 1.0 and the shipped look is unchanged). Stronger signal
  → bigger wave at every slider position now, not just near the top.
- 2026-09-26 — Floater rework: one param plus a brush. The two size dials
  (Floaters × Wave strength) read as confusion, so Wave strength and Wave
  frequency were retired outright and spawn became a single mechanism: the
  invisible floater brush (`stepBrush`, stride = the new **Brush move**
  setting) steps on each spawn event and stamps a streak where it stands
  (`pickSwarmCenter` now scores candidates in a ring around the brush,
  cloud drifters only, so a trail accumulates; the shader cloud fade stays
  the second net). **Floaters** owns everything else: its drive gates the
  event (Scene = the shared beat listener, one stamp per beat), grades the
  count (`floaterCountFromEnergy`, loudness-riding), and 0 stops both
  spawning and live drawing (`spawnFloaters` + the shader off-gate, same
  product both sides). The section-drop wave layer went with Wave
  strength; the `streakDensity` swell/anchor curve collapsed to
  `density × amp`. Headless proof: wire Floaters to a Beat grid, watch the
  trail advance, force the amount to 0, watch it vanish.
- 2026-09-27 — Back to the public repo. Sky had gone to the private
  paid-scenes repo on 2026-09-25 (possible paid scene); the user moved it
  back, so it's a free AGPL scene again, at `src/render/scenes/sky/`, with
  its record here instead of the private `RECORD.md`. A review on real
  music and synthetic audio (real GPU, ~57 fps) turned up the list under
  Known issues.
- 2026-09-27 — Featured rather than a draft, on the user's call, in the
  same round that featured Physarum 2 and moved Physarum and Slats behind
  the draft toggle (#173). Replayed onto `main` from #170, whose branch
  predated Physarum 2's registration and no longer merged cleanly.
- 2026-09-27 — "Sky a bit darker, and the spectre narrower." Read as the
  sky's colour range, which ran navy to coral at sunset. Two whole-sky
  trims now apply after the day keys and the sun's glow: `SKY_SPREAD`
  pulls each sky pixel's hue and saturation toward the gradient's mid
  colour while keeping its brightness, and `SKY_LEVEL` dims it. Clouds are
  untouched, so they stand out a little more. The gradient's bounds became
  named constants (`SKY_GRADIENT_LO`/`HI`), so every value the new Sky
  tuning bench sets has a name in `sky.ts`. The bench (Materials) runs
  the real `skyFluidSim.ts` under a port of the sky and cloud passes, with
  compare and variations; the user picks the final look there.
- 2026-09-27 — "I want the sun further from the frame." The sun's path
  hugged the frame (on the top edge at noon, just past the right edge by
  early evening), so its halo and core washed a corner. `SUN_DISTANCE`
  scales the whole path outward from the frame's centre; the bench has
  it as its Sun distance slider.
- 2026-09-27 — "I like the colour palette here; something around there
  should be the darkest it gets", with a pasted indigo-periwinkle-lavender
  gradient. The darkest state is the Horizon glow key, which the sky holds
  from sunset to sunrise. It went from navy over coral to that palette:
  zenith and horizon solved through the sky trims (`solve_key.py`) for a
  saturated indigo top and a lavender-white bottom, lavender-white clouds
  over periwinkle shade, and a lavender sun glow in place of orange.
  Golden hour stays the one warm key. Its top is now as dark as the
  floor's (luma ~0.31), and the floor reads more vivid than the default
  early evening, which the narrowing left a greyish lavender.
- 2026-09-28 — "Too many settings right now", with a photo of scattered
  fair-weather cumulus. Read as: fewer bench controls, and clouds like
  that. Side by side ours was one smoky hook; the rounds that followed:
  - Smoke tails came from the drifters' push shearing each puff; a weak
    push (`DRIFTER_FORCE` 10 → 1) and more viscosity keep puffs compact.
  - Smooth potato outlines: value noise only wobbles an edge. The edge is
    now carved by a cellular "puff" noise (`puffNoise`), subtracted rather
    than multiplied, so it bites the thin edge into round bulges and
    leaves dense interiors whole. The noise runs in the dye texture's
    square texels; in plain uv it was stretched by the frame's aspect.
  - Shading taps read the carved field, so each bulge shades the one below.
  - Clumping was the puff timing, not the flow: at any moment the sources
    that happen to be puffing can sit together and merge. More, smaller
    sources (`SPLAT_SLOTS` 12 → 20) with longer on-phases spread them.
  - The midday key was solved to the photo's blue, compensating the noon
    sun halo, and `SUN_DISTANCE` went 1.4 → 1.7 so the halo stops lifting
    the top.
  - The new edge cost the frame rate (120 → 48 fps); clear sky now skips
    it, which is exact, since it can't reach any threshold there.
  The bench dropped to six controls up front (Sky brightness, Colour range,
  Sun distance, Cloud amount, Cloud size, Bumpiness), the rest folded
  under More controls; its presets and "Before today" went.
- 2026-09-28 — "In the end you definitely made it worse." The cumulus
  round's scene changes are reverted: `sky.ts` and `skyFluidSim.ts` are
  back to the palette-matched commit (soft fluid clouds, 12 slots, the
  strong push, midday key and `SUN_DISTANCE` 1.4 as before). Every round
  was judged on the photo's portrait frame, where the numbers converged;
  on the wide desktop frame the result was small hard-edged blobs that
  looked pasted on, and none of the matched numbers said so. The soft
  airy clouds with wispy tails were the better look. The six-control
  bench stayed, pointing at the restored clouds. Lesson: judge a look
  change on the frame the user watches, side by side with the previous
  version, not only against the reference.
- 2026-09-28 — Drive-defaults audit: "if a parameter doesn't have a driver
  it should not affect the scene; wire it appropriately to what they were
  using as default, rather than turning it off by default" (one of four
  featured scenes audited — see caustics.md, physarum2.md, chladni.md for
  the others). Cloud cover, Flow speed, Turbulence, Cloud brightness and
  Floater visibility had each shipped as a "steady" Scene-default jack that
  only ever reacted once someone patched a source; each now defaults to a
  real signal (Section intensity, All level, Bass level, Mid level, Treble
  level) lifted on top of its own slider (`liftByDrive`/`skyLift`, identity
  at drive 0, `SKY_DRIVE_LIFT` 0.5) instead of a bare `slider * drive`,
  which dropped every one of them to its floor the instant its jack was
  unplugged. Brush opacity's "dims with energy" Scene composite became a
  plain All level default with the dim factor itself moved outside the
  drive macro (`1.0 - 0.4 * brushOpacityDrive(uEnergy)`) — the same look at
  default, but the old `brushOpacityDrive(1.0 - 0.4 * uEnergy)` zeroed the
  whole factor, brush gone entirely, once unplugged. Checked headless
  (synthetic 120 BPM, t=8 s and 10 s, before vs after): at default the soft
  clouds read the same, a touch fuller as the music lifts them; with all six
  jacks unplugged the old build collapsed to faint wisps, the new one shows
  the sliders' own full clouds. The streak-wind
  formula dropped its own `flowSpeedDrive(1.0)` factor outright: Flow
  speed's drive already moves the fluid (through the sim's dt/force), so
  reading it a second time in the wind formula made every streak jump the
  instant any source was patched in. Floaters and Light waves were left
  alone — real composites, not disguised constants.
- 2026-10-02 — Review pass: Sky's private copy of the fluid solver is gone.
  `sky/skyFluidSim.ts` differed from `fluidSim.ts` only in the splat slot
  count, so the count became `createFluidSim`'s `splatSlots` option
  (`SKY_SPLAT_SLOTS` here; `sky.test.ts` checks `DRIFTER_SEEDS` fits) and Sky
  imports the shared module. Sky also passes `edge: false`: it only samples
  `dyeTexture()`, so the Sobel edge pass and its mip rebuild no longer run
  every frame. Checked with `tools/gpu-bench.mjs` dumps of frames 30 and 75
  before and after: 0 pixels changed. The sim solver itself is now shared
  territory (no scene's version moves when it changes).

## Tuning notes

- Scene-default stamps ride the broadband onset detector, which the
  synthetic feed barely trips, so for headless floater screenshots wire the
  Floaters jack to a **Beat grid** source instead (fires off the beat
  clock), and Reset to scene default afterwards. Real music needs nothing.
- The default Time of day (just after 0.7) lands on the early-evening key,
  the look the user approved before the day cycle existed. A test pins it.
- Floater visibility's default is 1.2× the tuned tube contrast. At the
  current `FLOATER_SCALE` the tubes are only a few pixels wide, so the
  profile floors its bands at `FLOATER_MIN_PX`.
- Light-wave glints are deliberately faint and fast; if they're lost on
  real music, raise Light waves before touching the shader.
- No `/tune sky` pass yet, and no real-GPU look.
- Sky colours and cloud shapes are tuned on the Sky tuning bench
  (Materials): the same sim and shader maths, six controls up front and
  the rest under More controls, looks saved to its `looks` collection. Its display shader is a hand
  port, so after changing the sky or cloud passes in `buildDisplayFrag`,
  re-port them in `bench.html` and rebuild with `build_bench.mjs`.

## Known issues and next steps

- Review, 2026-09-27 (headless, real GPU, synthetic 120 BPM and Billie
  Jean through the fake mic):
  - At the default Day drift the approved early-evening key lasts under
    half a minute: the sky reaches sunset about 25 s after the scene
    opens, then runs through twilight at `NIGHT_SPEEDUP`. Over a 30 s
    capture the whole palette went from periwinkle to navy over coral.
    Either Day drift defaults to 0, or the drift should be far slower
    (`dayRatePerSec`).
  - Floaters sit on a fixed screen grid (`FLOATER_CELL`), so a drifting
    streak moves by cells switching on and off. The streak drifts right
    (`STREAK_DRIFT`) whatever the clouds are doing, so the two layers
    don't share a wind.
  - The two beat-driven effects besides the stamps are hard to see:
    light-wave glints only light pixels inside tubes a few pixels wide,
    and Haidinger's brush wasn't visible in any frame at default opacity.
    On real music the stamps are the only visible reaction.
  - Wiring a pulsing source to Floaters (from code, not seen): the shader
    reads `uFloaterDensity * floaterDensityDrive(1.0)` every frame for
    both streak size and the off-gate, so every live streak shrinks and
    vanishes between pulses rather than only the spawn following them.
  - With a long Floater sustain, one stamp per beat outruns
    `MAX_WAVE_BURSTS`, and the oldest live streak is cut off mid-life.

- The brush trail, the Scene count-by-loudness curve and light-wave glint
  brightness haven't been checked on real music yet; Brush move's stride
  scale (`BRUSH_STRIDE_MAX`) and `floaterCountFromEnergy`'s grade are the
  two knobs to tune first.
- `/tune sky`; `minQuality` is unset, and there's no floor-tier stress
  test.
- Haidinger's brush turns at a fixed real-time rate, not tempo-locked (an
  open choice).
- Re-patching Floaters or Light waves bypasses the beat listener's hold
  (the one-per-beat cadence belongs to the Scene default only — the
  listener still advances, unused, so its clock stays warm for switching
  back). Same behavior as every other scene's `fired()` drive.
- Free-slip sim walls are kept; a wrap boundary is a possible follow-up.

## Materials

- `docs/scenes/sky/` — the concept artifact's source and the session
  scripts (screenshot series, day sweep, reference measurers); its
  `README.md` lists them.
- Sky tuning bench — [artifact](https://claude.ai/artifact/LDfRvM66zaudcP1svR8px7),
  source in `docs/scenes/sky/artifacts/sky-bench/`, built by
  `docs/scenes/sky/scripts/build_bench.mjs` (inlines the real sim).
  Saved looks: `ArtifactData` list of its `looks` collection; each
  look's `params` uses the bench's own keys, which its "Code for sky.ts"
  panel maps to constant names.
- The pasted reference stills, our screenshots and the measurement outputs
  are the local bundle `sky-stills` (`tools/.cache/refs/sky-stills/` of the
  checkout that built the scene, `.claude/worktrees/sky-scene/`). It isn't
  in the private archive yet: `python3 tools/ref-archive.py sky-stills
  --from .claude/worktrees/sky-scene/tools/.cache/refs`.
- The palette reference is the local bundle `sky-palette-ref`
  (`tools/.cache/refs/sky-palette-ref/` of `.claude/worktrees/sky-public/`),
  not archived yet: `python3 tools/ref-archive.py sky-palette-ref --from
  .claude/worktrees/sky-public/tools/.cache/refs`. `measure_palette.py`
  measured it and `solve_key.py` turned the targets into key values (both
  in `docs/scenes/sky/scripts/`).
- The cumulus photo is the local bundle `sky-cumulus-ref` (same place, not
  archived yet: `python3 tools/ref-archive.py sky-cumulus-ref --from
  .claude/worktrees/sky-public/tools/.cache/refs`). `measure_clouds.py`
  measures it and our renders the same way; `set_consts.py` sets named
  constants in `sky.ts` for a tuning round. The round they served was
  reverted (Decisions, 2026-09-28); the scripts stay for the next one.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/sky`. Use a mic or
  real audio source for Scene-default stamps (or wire Floaters to a Beat
  grid, per Tuning notes).
- The `tools/.cache/refs/sky-stills/scripts/` scripts:
  - `shot_series.mjs` logs real elapsed time per shot. SwiftShader runs at
    a few fps and each screenshot takes ~2 s, so a "13 s" shot is really
    ~18 s.
  - `shot_day.mjs` sweeps Time of day through `__viz.setParams` (it needs
    `scene: "sky"`).
  - `contact.py` tiles the shots into one sheet.
  - `floater_cross_section.py` and `grid_measure.py` re-measure the
    references.
- Gotchas that cost time:
  - A backtick in a GLSL comment ends the shader's template string.
  - Restart the dev server after a rebase or long edit runs, since stale
    HMR routing lands on the gallery.
  - The `settingGroups` test requires each settings group to be one
    contiguous run.
  - Timers built from accumulated dt run slow at low frame rates. Time
    waves from `anim.timeSec`.
  - Check an anchor-to-anchor splice doesn't swallow a neighbouring
    function; that dropped `streakDensity` once.
  - Measure thin objects with a brightness cross-section and look at the
    reference and the render side by side. Aggregate statistics validated
    the wrong shape twice.

## History

- `36608e4` — v1: fluid-sim clouds, blue field, floaters, Haidinger's brush.
- `19477e3` — dots cut; curved floaters; a real cloud threshold.
- `512bbd4` — two-tap cloud shading; ring floaters.
- `c16982b` — smooth heading-integrated floater paths.
- `5825e44` — hollow refractive-tube floaters.
- `34dab4e` — floaters ~0.45× smaller.
- `35d9416` — clouds spread as airy puffs; splat slots 4 → 12.
- `8c88b80` — waves only, as swarms that keep off the clouds.
- `4bbc04f` — staggered form/dissolve; aligned strands.
- `b1dc34a` — treble-driven waves laid out like a text-grid streak.
- `0e4e094` — floaters 2.5× smaller (`FLOATER_SCALE`).
- `bf9f548` — darker pink-purple sky, stronger floaters, beat light waves.
- `6750ed7` — day cycle; light waves through floaters only.
- `535ce65` — radial pale light waves; visibility and sustain settings.
- `1ad78c0` — no night sky.
- `8212846` — skyFluidSim rationale after Neon Fluid landed on main.
- #133 — draft PR.
- `dd4ce18` — patch-bay drives: nine Scene-default ports.
- `52e8819` — Wave strength is the master spawn param (0 = no waves).
- `f717614` — one Floaters param + the wandering brush (Wave strength and
  Wave frequency retired).
- Moved back from the private repo to `src/render/scenes/sky/` (#170,
  replayed onto `main` and featured in this PR).
- Darker, narrower sky (`SKY_SPREAD`, `SKY_LEVEL`); Sky tuning bench;
  sun further out (`SUN_DISTANCE`); palette-matched darkest key; a
  cumulus round from a photo, reverted; bench cut to six controls.
