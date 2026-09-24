# Neon Fluid (`fluid`)

A 2D incompressible dye simulation rendered as a thin neon edge line over
near-black, mirrored so one simulated quadrant becomes a full-screen
symmetric plume — coloured by screen position (blue to cyan to yellow to
orange to red) with a purple emitter tag. Music drives the emitter through a
beat-synced puff clock, sparkle/lightning overlays, and a drifting fold
symmetry. Draft, on main.

## Where the code is

Three files, imported only by each other and not shared with any other
scene (`ferrofluid.ts`, despite the similar name, is an unrelated raymarched
blob scene with no connection to this sim):

- `src/render/scenes/fluidSim.ts` — the GL simulation itself: semi-Lagrangian
  advection, an explicit viscosity pass, vorticity confinement, Jacobi
  pressure projection, two-pass clamped MacCormack dye advection, and a
  Sobel edge pass with a mip chain for the halo. Free-slip walls via
  ghost-cell reflection on every boundary. Half-float targets with an RGBA8
  codec fallback (`detectSimFormat`). Exports `createFluidSim`,
  `simResolutionFor`, `sameSimSize`, `simIoGlsl`, the `SPLAT_SLOTS`/`Splat`
  type, and the `MIRROR_*`/`FOLD_WEDGES_*` constants the display shader
  folds against. Knows nothing about scenes or settings.
- `src/render/scenes/fluidBolts.ts` — the lightning bolt layer
  (`createFluidBolts`), drawn in screen space (not sim space — see
  Decisions) with mirror copies fired explicitly via `boltMirrors`.
- `src/render/scenes/fluid.ts` — the `Scene`: the emitter/splat schedule
  (`EmitterInputs`, `splatEnvelope`, `emitterState`), the beat puff clock
  (`createPuffState`/`advancePuff`, envelope shaped like `caustics.ts`'s
  `rippleEnvelope`), the fold-drift state for Auto symmetry
  (`createFoldState`/`advanceFold`, drifting across `FOLD_FAMILY` quadrant
  folds), the strobe state machine (`createStrobeState`/`triggerStrobe`/
  `advanceStrobe`/`strobeFrame`, `STROBE_PATTERN`), all `SETTINGS`
  (`symmetry`, `foldCount`, `foldSpread`, `foldSpin`, `foldBreathe`,
  `foldDrift`, `emitStrength`, `beatKick`, `curl`, `viscosity`,
  `dissipation`, `dyeFlow`, `warp`, `edgeGlow`, `hueShift`, `lineSoft`,
  `neon`, `hotWhite`, `sparkle`, `sparkleStyle`, `sparkleTint`,
  `sparkleNegative`, `sparkleSize`, `sparkleSoft`, `sparkleSpeed`,
  `sparkleSpread`, `currentDensity`, `dropFlash`, `shockwave`, `buildGlow`,
  `beatFlash`, `strobe`), and the display shader that colours the sim,
  layers the Currents/Grain/Lightning sparkle styles, and applies the neon
  tone map. `dt` is computed from `frame.time` deltas rather than
  `anim.dtSec`, same reasoning as `chladni.ts`. The fluid math (stable-fluids
  scheme, vorticity confinement per Fedkiw et al.) is written independently
  from the textbook, not ported from any third-party fluid-sim codebase, per
  CLAUDE.md's standing rule. Tests: `tests/fluid.test.ts`.

## References

Studied from a fluid-sim short, "Let Go and Drift Into Calm" (channel Fluid
Harmony, youtube.com/shorts/dTAVIIs_NRY): a 2D fluid sim shown as neon
outlines, mirrored, coloured by screen x, with a purple emitter at centre.
This scene predates the `/ref` bundle workflow — reference frames were
pulled directly with `yt-dlp` and `ffmpeg` rather than through a
`tools/.cache/refs/<id>/` bundle, so there's no bundle for it.

## Decisions and pivots

All rounds below landed in the single PR #76 (opened as a draft, merged
2026-09-23).

- v1: initial stable-fluids sim with free-slip walls, a coarse velocity
  grid, tag fade faster than dye, soft-thresholded Sobel edge.
- v2: feedback that the original reference has sharper edges and reacts
  more to the music. Diagnosis: the reference's evenly spaced parallel
  filaments are a pulsed dye source stretched by a smooth flow, not a
  continuous jet — one change (beat-timed puffs) fixed both complaints. Dye
  advection moved to two-pass clamped MacCormack (a single-pass variant that
  re-samples the source field at the forward position measures zero error
  under uniform velocity and is silently plain semi-Lagrangian — the
  predictor must write its own target and the corrector re-samples that);
  this alone turned soft bands into 1-2px lines. The emitter became large,
  weak and impulsive rather than a strong steady jet, so a vortex ring rolls
  up on its own partway across rather than only at the wall. An explicit
  viscosity pass replaced inline smoothing. A byte-format fallback bug
  (multiplicative fades stalling on 8-bit values, so the emitter tag never
  decayed and everything went purple) was fixed with a dithered encode.
- v3: `MIRROR_OPTIONS` grew from three modes to five (Off, Left-right,
  Top-bottom, Kaleidoscope, Radial 6/8/12) — Top-bottom matches the
  reference's own geometry (emitter at the left edge, off the horizontal
  seam). Radial modes fold the screen into a wedge at display time and reuse
  the Kaleidoscope quadrant, so sim cost doesn't change with mirror mode.
  Sparkle became its own settings group (style, colour, contrast, fineness,
  softness, flicker, spill); the Negative spark tint is renormalised to the
  line's own brightness, since the raw inverse of a bright neon colour is
  dark.
- v4: Symmetry gained an Auto default — a fold-drift state crossfades
  between the quadrant-family folds under a slow rotation and breathing
  zoom, holding each fold for a loudness-shortened duration or until a drop.
  Currents sparkle style replaced Electric with dashes riding the sim's own
  velocity, gated by treble and by density (dye alone is only dense on the
  fresh ring, so the mask needed to accept the packed-line halo too, since
  the Sobel edge is zero inside a dense core). A hue-preserving neon tone
  map (`neon`/`hotWhite`) fixed a white blowout. A Light settings group
  (`dropFlash`, `shockwave`, `buildGlow`, `beatFlash`) was added.
- v5: after two rounds of real-music feedback that the scene read as too
  intense — the synthetic test feed carries roughly a third the energy and
  almost no treble of real material, so most gains were tuned roughly ten
  times too hot for real music — every music-driven gain was cut to about a
  tenth of its v4 value, and puffs were moved to fire on bass onsets only
  with a minimum gap, since the broadband onset stream otherwise fires on
  every hi-hat. Fold transitions were changed to warp the sampling
  coordinate between two folds (`simUv`/`foldMixEased`) rather than
  crossfade two rendered images, so the flow reads as one continuous stream
  instead of a double exposure. The Symmetry group's sliders
  (`foldSpread`/`foldSpin`/`foldBreathe`/`foldDrift`) were split out, with
  `foldSpread` distinguishing a true mirrored slice (0) from the original
  quadrant-squeezed-into-a-wedge look (which had read as an unwanted
  "stretch").
- v6: fixed `foldCount`/Mirror count not applying under Auto (Auto drifted
  its own wedge count independently, so the slider looked dead at its
  default) — `foldCount` now drives the Radial fold's wedge count in every
  mode, Auto included. Added the Lightning sparkle style: Storm's bolt
  generator and strike envelope were lifted into a shared `src/render/bolt.ts`
  module for reuse, and `fluidBolts.ts` drew the bolts into a sim-space
  layer. Added the strobe (white/red/black flash on a lightning strike).
- v7: the sim-space bolt layer from v6 turned out to be invisible in
  practice — any Radial/Kaleidoscope fold chops a sim-space layer into
  hairline slivers inside one wedge. Fixed by moving bolts to screen space
  (`fluidBolts.ts`'s current form): near-vertical lines threaded through a
  point near the emitter, unclamped so they can enter from off-screen, with
  the fold's mirror copies fired explicitly via `boltMirrors` instead of
  being sampled through the fold. This is the general lesson: anything that
  must read as a screen-scale stroke belongs in screen space, not sim space,
  under a fold. Added an "anime" bolt look (flat hard-edged white core over
  a saturated glow, a minimum ribbon width so thin branches don't alias into
  dotted lines, the tree re-jagged every few frames while bright, strength
  cut hard to zero below a threshold instead of fading into grey ghosts) and
  a coarse mip of the bolt layer multiplying line/halo brightness so the dye
  flares in its own colour around a strike. Strobe was rebuilt as
  `STROBE_PATTERN` stepped per render frame (hard single-frame cuts, several
  white then red then black) rather than a smooth ramp.

## Tuning notes

All constants were originally tuned on synthetic audio; a further real-music
pass (`/tune fluid`) is still the next step per the PR's own notes, beyond
the v5 gain cut already made from real-music feedback. Off and Left-right
mirror modes read busier than Kaleidoscope. Changing quality tier — including
the governor doing so live — reallocates and resets the fluid sim; a
resampling resize instead of a hard reset is a known follow-up, not yet
built.

## Known issues and next steps

Changing quality tier resets the sim rather than resampling it. Top-bottom
mirror mode's plume rolls into one large spiral near the emitter rather than
crossing the full screen width, even after the v3 push-scale tuning aimed at
that geometry. A further real-music tuning pass is open.

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/fluid`. When sweeping a
tuning constant, Vite HMR picks up a source edit without a full reload, so a
constant can be adjusted and the dev view re-checked without restarting.
Check that dye advection is genuinely two-pass MacCormack (predictor writing
to its own target, corrector re-sampling that) before trusting any "closer
to the reference" comparison — a single-pass variant silently degrades to
plain semi-Lagrangian and measures as zero error under uniform velocity,
which can hide the regression. When adding any screen-scale visual element
under a fold (a bolt, a flash), build it in screen space with mirror copies
fired explicitly, not sampled through the fold in sim space — see the v6/v7
pivot above.

## History

- `#76` (2026-09-23, merged; iterated 2026-09-03 through 2026-09-05 as
  v1-v7) — Neon Fluid added: a stable-fluids dye sim drawn as mirrored neon
  outlines, through the MacCormack/beat-puff, mirror-mode, Auto-symmetry,
  Currents/neon-tone-map, and screen-space-lightning pivots described above.
