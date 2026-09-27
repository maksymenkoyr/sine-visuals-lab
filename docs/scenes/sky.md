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
- `src/render/scenes/sky/skyFluidSim.ts` — the stable-fluids solver, a copy of
  Neon Fluid's `fluidSim.ts` that differs only in `SPLAT_SLOTS` (see Known
  issues).
- `tests/sky.test.ts` and `tests/skyFluidSim.test.ts`.
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

- Fold `skyFluidSim.ts` into `fluidSim.ts`, with the splat slot count as a
  parameter. Sky needs 12, Neon Fluid uses 4; the files are otherwise
  identical.
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
- The pasted reference stills, our screenshots and the measurement outputs
  are the local bundle `sky-stills` (`tools/.cache/refs/sky-stills/` of the
  checkout that built the scene, `.claude/worktrees/sky-scene/`). It isn't
  in the private archive yet: `python3 tools/ref-archive.py sky-stills
  --from .claude/worktrees/sky-scene/tools/.cache/refs`.

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
