# Caustics (`caustics`)

The bright wandering filaments you see on the floor of a sunlit pool — domain-warped
value noise sharpened into thin ridges, with a beat ripple, treble sparkle and a
spray-injection layer riding on top. Ships from the initial commit and is on main
(not a draft).

## Where the code is

- `src/render/scenes/caustics.ts` — the scene module (`createFullscreenScene`,
  `SETTINGS`, the `FRAG` template, and an `extraUniforms` closure that advances the
  drift phase, Speed pump's own accumulator, loudness-swell calibration and
  Beat ripple's own emitter/profile every frame).
- Its response math is factored into small pure functions exported specifically so
  `tests/caustics.test.ts` can pin them directly: `focusSharp`, `fogRestingSharp`,
  `fogFloorCut`, `causticDensityScale`, `driftRatePerSec`, `advanceLoudSwell`,
  `loudSwellDrive`, `advancePump`, `driftFlows`, and the `sparkle*` helpers.
- `src/render/scenes/rippleEmitter.ts` — Beat ripple's own continuous ring
  emitter: `advanceEmission` conditions the driver's own rise each frame into
  a launched ring amount, `createRippleEmitter` keeps every ring in flight as
  a plain `{ageSec, amp}` ring-buffer entry, and `buildProfile` sums them into
  the 1D radial crest/slope profile `caustics.ts` uploads as `uRippleCrest`/
  `uRippleSlope`; see its header for why (and for what it replaced: a fixed
  trigger-launched ring pool, then briefly a real 2D wave simulation).
  `tests/rippleEmitter.test.ts` pins the emission and profile behaviour
  directly.
- Imports `NOISE_HASH_GLSL`, `NOISE_MASK`, `NOISE_PERIOD`, `wrapFlow` from
  `src/render/noiseHash.ts` — the shared mobile-safe lattice hash (see Decisions
  below; this scene is the reason that module exists).
- Reads the latched one-shot edges on `AnimFrame` (`renderLatch.ts`) rather than
  raw `FeatureFrame` edges; nothing in it reads the phase-locked beat/bar clock
  (`beatClock.ts`) any more — the bar-locked breathe that was its last consumer
  is gone (see Decisions).
  `uDropReactivity`/`dropDrive` reads `sectionIntensity.ts`'s slow-tracked
  "which part of the song is this" signal.
- Its reactive settings pick their sources through the per-setting drive picker
  (`SceneSetting.drive`, `src/render/drives.ts`); only Spectral hue still declares
  `reads` (`src/render/signals.ts`), since that coupling lives in the shader's own
  hue phase rather than in a drive value.
- The onset edges this scene reads (`anim.onset`, `anim.lowOnset`, `anim.dropOnset`)
  are gated upstream by `src/audio/silenceGate.ts`; no code in this file implements
  the gate itself.

## References

None — original design. Part of the initial commit, predating the `/ref`
reference-measurement workflow used by later scenes.

## Decisions and pivots

- 2026-08-27 — Initial commit ships Caustics as one of the first scenes.
- 2026-08-27 (`db884a0`) — Fix Focus Snap: decouple resting sharpness from the
  slider, not just the on-beat peak.
- 2026-08-28 (#6) — Focus Snap reworked so `uFocus` bends the beat-pulse response
  curve instead of rescaling sharp's own ceiling (every setting now converges to the
  same peak). That exposed a rainbow "pixel ladder" fringe at high sharpness —
  confirmed by contact-sheet comparisons at focus 0.1 vs 1 to be hue-phase wrapping,
  not luminance banding — fixed with a lower shared sharpness ceiling, a screen-space
  (fwidth) cap on the ridge's `pow()` exponent, easing the domain warp at peak focus,
  and damping the palette's cosine hue modulation where it moves faster than a pixel
  can resolve. Landed alongside an unrelated quality-governor fix (ordinary rAF
  jitter was being misread as GPU overload).
- 2026-08-29 (#28) — Treble sparkle split into a macro over five sub-params
  (brightness, density, grain, warp, spread, sustain), each defaulting to reproduce
  the constant it replaced exactly.
- 2026-08-29 (#34) — Beat ripple reworked to refract the pattern by a ring's radial
  *slope* rather than its height, and to pool multiple rings in flight instead of
  round-robin erasing one still a third as bright as when it started.
- 2026-08-30 (#50) — Focus Snap fixed to actually scale the on-beat peak.
- 2026-08-30 (#51) — Live spectral centroid signal added; drives Spectral hue.
- 2026-08-30 (#48) — Signal-links framework added (`signals.ts`,
  `SceneSetting.reads`); Caustics' `ripple`/`rippleSrc` settings are its first
  consumer, exposing which live signal drives Beat ripple, and the threshold
  `rippleSrc` switches on, as clickable pills in the meters panel.
- 2026-08-30 (#56) — Focus snap decoupled from the resting look entirely: Fog now
  owns the resting sharpness and dark-water floor cut, Focus purely multiplies how
  much a beat pushes above it; Caustic density (noise-sampling frequency) added.
- 2026-08-30 (#55) — `renderLatch.ts` added after Caustics' beat ripple was found
  silently dropping rings on any display outrunning the render-rate cap (a one-shot
  `AnimFrame` edge only ever lasted one tick, so roughly half never reached
  `scene.render()`); Caustics switched to the latched `anim.onset`. The bug surfaced
  while building the Storm scene, but the dropped rings were Caustics' own.
- 2026-09-01 (#59) — Kick surge gets a bounded position jolt (`advanceKickJolt`) on
  top of its rate surge, so a bass hit reads as a strike rather than only a glide.
- 2026-09-01 (#61) — Beat surge becomes a real damped impulse (`advanceLurch`)
  instead of a rate multiplier (a multiplied rate only ever produced a smooth ramp,
  never a hit). Beat churn added as a third, independent beat channel that reshapes
  the filaments (`uChurnDrive`) instead of moving the phase.
- 2026-09-02 (#63) — Loudness surge made to actually track measured loudness:
  `advanceLoudSwell` calibrates its own slow-contracting envelope of
  `FeatureFrame.level`, deliberately not `frame.energy` (the AGC-normalized signal
  re-adapts on a much faster window and would erase the quiet-vs-loud contrast this
  dial exists to show).
- 2026-09-02 (#65) — Spray injection (droplets atomizing off the glint field),
  Sparkle distortion and a finer Sparkle grain floor added.
- 2026-09-12 (#102) — Caustics found to be the first scene to show a mobile-only
  seam/dashed-line bug: the value-noise hash lost precision as the accumulated drift
  phase grew, and mobile GPU compilers disagreed on a shared-corner hash well before
  desktop degraded. Fixed by wrapping every drift offset modulo a fixed period on the
  JS side and hashing the integer lattice cell on the GPU side.
- 2026-09-21 (#121) — That fix extracted into the shared `src/render/noiseHash.ts`
  so Ink Synth (the second scene to hit the same bug) could reuse it; Caustics now
  imports the shared hash instead of owning the fix.
- 2026-09-18 (#115, merged) — Caustics reacting to mic hiss in a near-silent room was
  the report that motivated the global silence gate: a level-based dimmer now
  multiplies the onset-firing comparison upstream, in `features.ts`/`bandEnergy.ts`,
  so `anim.onset`/`anim.lowOnset`/`anim.dropOnset` — read here by Beat ripple, Beat
  surge, Beat churn and Kick surge — go quiet with the room instead of firing on
  hiss. No code in this file changed; the gate lives entirely upstream.
- 2026-09-25 (`337ee13`) — Every `default:` in `SETTINGS` baked from the tuned
  manual values via Option+D (`src/tuning/bakeDefaults.ts`), replacing the round
  defaults that reproduced the constants they replaced exactly. The
  `auto:`/`drive:`/`macro:` tables were untouched.
- 2026-09-26 — Follow-up to the bake: the Focus snap regression guard in
  `tests/autoTune.test.ts` asserted absolute bands that only held for the
  pre-bake default, so it now bounds the *displacement* from `spec.default` —
  the weights are the invariant, defaults move with each bake — and the setting
  comments that still claimed their pre-bake values were reworded to describe
  the dial's mapping instead.
- 2026-09-26 — Beat ripple under a driver that keeps hitting: reported as rings
  that relaunch and never reach the edge of the screen until the signal drops,
  then all "let go" at once. Cause: `createRipplePool` always recycled the
  oldest of 8 slots, and a ring needs ~2.8s to cross to the far corner, so
  anything past ~3 hits/s (busy onsets, a 1/8 grid source on the `ripple`
  drive) pulled rings back to the centre mid-screen — at 5 hits/s no ring got
  past radius ~1.8 of the ~3.06 corner. Now the pool has 16 slots and only
  reuses a slot whose ring is past `RIPPLE_EXIT_RADIUS`; when every ring is
  still crossing, a hit folds into the youngest ring (raising its amplitude,
  so a drop still lands) instead of restarting one. Pinned by the "driver
  that keeps hitting" test in `tests/caustics.test.ts`.
- 2026-09-26 — Two follow-ups from the same "driver that keeps hitting"
  screenshot, once the pool fix above stopped losing rings but a busy mix
  still stacked them densely enough to read as noise instead of individual
  strikes: (1) `drives.fired()` (`src/render/drives.ts`) only understood
  hit-kind sources — a level-kind catalogue source or Beat ripple's own
  drawn line silently fell back to `sceneDefaultFired`, ignoring whatever the
  user had actually picked. Fixed with `src/render/valueTrigger.ts`, a small
  pure Schmitt-trigger module (`createValueTrigger`/`stepValueTrigger`):
  hysteresis (two marks, not one) so a signal hovering at a fixed threshold
  can't chatter, plus a held re-fire (once per beat when locked, else every
  `HELD_REFIRE_FALLBACK_SEC`) so a sustained level source doesn't fire once
  and go dark. `drives.ts`'s `SourceState` now keeps one `ValueTrigger` per
  source, and `fired()` grew an optional `upper` param (the fire mark) that a
  scene can pass through from its own setting. (2) Added `rippleSpacing`
  (Motion group, default 0.7 beats, 0 = no limit) — a floor between ordinary
  rings, sized via `resolveHold` (`beatListener.ts`) the same way Beat
  listener sizes its own hold — and `rippleThreshold` (default
  `VALUE_TRIGGER_UPPER_DEFAULT` = 0.6) — the fire mark a level/line source on
  the ripple drive now reads through. A drop's ring stays exempt from the
  spacing floor (it always rings) but still resets the spacing clock, so an
  ordinary beat right after a drop respects the gap like any other; `fired()`
  is still called every tick regardless of the gap, since it's what consumes
  a grid source's pending edge or advances a level/line source's own trigger.
- 2026-09-27 — Beat ripple rebuilt as a real wave simulation (a "ripple
  tank") after the user found the trigger-launched ring pool above — even
  fixed twice in the previous entries — still behaves badly under any real
  driver that keeps moving (a busy zigzag of hits was the reported case) and
  pointed at a ripple-tank simulator as the feel they actually want: a
  surface that just carries whatever disturbs it, rather than a fleet of
  independently-timed pre-shaped rings competing for a fixed number of
  slots. Replaced: `createRipplePool`, `rippleEnvelope`,
  `MAX_RIPPLES`/`RIPPLE_SPEED`/`RIPPLE_WIDTH`/`RIPPLE_DECAY_PER_SEC`/
  `RIPPLE_ATTACK_SEC`/`RIPPLE_DROP_AMP`/`RIPPLE_SLOPE_NORM`/`RIPPLE_REFRACT`/
  `RIPPLE_EXIT_RADIUS`, the `uRippleRadius`/`uRippleStrength` uniform arrays
  and `FRAG`'s ring-summing loop, and the `rippleSpacing`/`rippleThreshold`
  settings (the previous two entries' own pacing/threshold fixes on top of
  the pool — both are moot once the surface itself absorbs a busy driver
  instead of needing a minimum gap between discrete triggers). New: a
  general GPU simulation-pass hook on `createFullscreenScene`
  (`fullscreenScene.ts`'s `simulation` option — `init`/`step`/`dispose`,
  the framework rebinding the display program/framebuffer/viewport and
  binding `step`'s returned textures afterward), and
  `src/render/scenes/rippleTank.ts`: an explicit leapfrog 2D wave
  simulation (independently derived from the textbook wave equation, not
  ported from Falstad's or any other ripple-tank implementation —
  `AGENTS.md`'s standing rule), state packed as two 16-bit fixed-point
  scalars (current and previous height) across one RGBA8 texel the same
  way `chladni.ts`'s `packPos`/`unpackPos` pack a position pair, and an
  outer sponge band (`spongeDampAt`) that absorbs a wave before the grid's
  always-hard Neumann wall — scaled by the new `waveEdges` setting (Edge
  reflection) so the tank can also read as a bounded, interfering tank
  instead of open water. The driver reaching the tank is a *displacement*
  source: `advanceRippleHighpass` keeps a slow (~0.8s) average of the
  driver signal and feeds the deviation from it, so a steady, unchanging
  driver raises no wave — only a swing does, the way a finger held still in
  real water doesn't ring it. New settings (Motion group, right after
  `ripple`): `waveSpeed` (Wave speed), `waveFade` (Wave fade), `waveEdges`
  (Edge reflection), `waveDrop` (Drop size, the source's own gaussian
  radius). The `ripple` slider itself still scales the tank's overall
  strength, but now on the JS side (scales the *source* driving the sim,
  so 0 = genuinely flat water) rather than scaling the display read of an
  already-computed ring, which stays a bare read of the tank's height/
  gradient (`RIPPLE_REFRACT_K`/`RIPPLE_CREST_GAIN` in `caustics.ts`) — the
  two must never both scale by `uRipple` at once. `RIPPLE_DROP_KICK`
  (renamed from `RIPPLE_DROP_AMP`) is now a one-shot addition to the tank's
  source delta on a drop, decoupled from the tracked driver value so it
  can't produce a matching reverse kick the following frame. Verified with
  a headless Playwright screenshot forcing `ripple:1` with every other
  Motion setting zeroed (see Resume here) — concentric waves visibly
  refracting the caustic filaments, evolving frame to frame, no shader
  compile error.
- 2026-09-27 — The first wave-tank display gains (`RIPPLE_REFRACT_K` 0.25,
  crest gain 0.7) shattered the caustics into fine noise even at the default
  Ripple strength: the slope is in dh/duv, which a few-cell wave makes large.
  Measured with `stepTankCPU` (high grid 512×288, 60 fps, 120 bpm beat pulse
  high-passed, Ripple 0.23, defaults for the wave settings, sampled over
  seconds 4–8): |dh/duv| median 3.1, p90 11.5, p99 29, max 150 (at the
  source); height p90 0.13, p99 0.41, max 2.0. So 0.25 displaced the pattern
  by 7–37 p-space units where the old ring peaked at 0.3. Now
  `RIPPLE_REFRACT_K` 0.012 with a tanh ceiling `RIPPLE_REFRACT_MAX` 0.4
  (p99 ≈ 0.28 displacement), crest `RIPPLE_CREST_GAIN` 1.4 under
  `RIPPLE_CREST_MAX` 0.35 (p99 ≈ 0.18). Headless default-settings frame:
  filaments intact, waves bending them as they pass.
- 2026-09-27 — The wave tank tested against the user's own eye: "nah that's
  not it" — running, it didn't look like the same thing the old rings did,
  and they asked for something between the old pool and the tank rather than
  either extreme. Landed on a continuous ring *emitter*
  (`src/render/scenes/rippleEmitter.ts`) that keeps the old pool's exact ring
  look — the same gaussian crest/slope profile, the mirrored term, the
  short-attack/exponential-decay envelope (`rippleEnvelope` is back, doing
  the same job it did before the tank existed) — but launches ring height in
  proportion to how much the driver *rose* each frame (`advanceEmission`)
  instead of on a yes/no trigger: a clean, isolated hit still reads as
  exactly one full old-style ring, a busy driver naturally ducks itself (each
  rise only launches a ring for however far the signal climbed since it last
  fell back, so a fast run of hits reads as lighter, denser rings rather than
  a machine-gun of full ones), and a slow swell or a held level emits nothing
  at all — the tank's own "only a change should ring the water" property,
  carried over without a separate slow-average high-pass: `advanceRippleHighpass`/
  `RippleHighpassState` are gone, folded into `advanceEmission`'s own
  deadbanded rise detector, tuned on a much shorter timescale (rejecting a
  single tick's own jitter, not a whole section's worth of level). Every ring
  in flight is still a `{ageSec, amp}` entry, but now in an actual ring
  buffer (`createRippleEmitter`) rather than a fixed-size pool with
  youngest-ring-eviction logic, and the per-pixel read is a 1D radial profile
  built on the CPU each frame (`buildProfile`, sampled over
  `PROFILE_MAX_RADIUS`) and uploaded as `uRippleCrest`/`uRippleSlope` float
  arrays, rather than a per-slot uniform array `FRAG` loops over itself.
  Removed entirely: the wave tank (`rippleTank.ts`, `tests/rippleTank.test.ts`),
  `fullscreenScene.ts`'s general `simulation` GPU-pass hook (nothing else had
  picked it up, so it reverted to its pre-tank shape), and the `waveEdges`/
  `waveDrop` (Edge reflection/Drop size) settings — an emitted ring only ever
  travels outward from the centre, so neither a wall to bounce off nor a
  separate source radius applies any more. New: `ringWidth` (Ring width),
  the one shape control a centre-seated emitter still needs, mapped to the
  same gaussian tightness the old pool's fixed `RIPPLE_WIDTH` was.
  `waveSpeed`/`waveFade` (Wave speed/Wave fade) carry over unchanged by name
  and default but now map onto the emitted rings' own travel speed/decay
  (`rippleSpeedFor`/`rippleDecayFor`) instead of the tank's steps/sec and
  per-step damping. `uRipple` (the Beat ripple slider) scales the *display*
  again — crest brightening and slope-based refraction in `FRAG` — not a
  launched ring's own amplitude, the split the very first pool used, reversed
  back from the tank's "scale the source" design. A soft knee (`RIPPLE_CEIL_KNEE`/
  `RIPPLE_CEIL_MAX` in `caustics.ts`) bounds many overlapping rings' summed
  crest/slope without touching a single ring's own peak, so one hit still
  looks bit-for-bit like the old pool's.
- 2026-09-27 — The emitter still looked right only with a hit followed by
  clean silence; with anything between hits "noise kind of resets it each
  time". Cause, which every ripple design so far shared: the input is a hit
  envelope (`max(anim.lowPulse, anim.beatPulse)` by default), and the hit
  detectors fire on hats, ghost notes and small transients too, so each one
  sent a fresh ring from the centre that buried the real hit's ring. Fix, in
  `advanceEmission`: rings are sized by *salience* — how far a rise stands
  above a floor (the running average of background rises, those below
  `SALIENCE_BACKGROUND_FRACTION` of the peak) relative to a peak tracker (see
  the `SALIENCE_*` constants' comment in `rippleEmitter.ts`). Measured on the
  synthetic case in `tests/rippleEmitter.test.ts` (kicks of 1.0 every 0.5 s,
  background hits 0.2–0.4 every 0.1 s, after 4 s): every kick emitted 1.00;
  background hits emitted 0 in most cases, the loudest 0.22. Equal kicks with
  nothing between stay at full rings indefinitely (a hit near the peak never
  raises the floor), and after 8 s of quiet a 0.3 hit that was background
  before rings > 0.7 again.
- 2026-09-27 — The salience bar is now visible: Beat ripple's "What it
  receives" graph in the panel (shown when a source is patched in) draws
  dotted "rings above" / "full ring" lines (`salienceMarks`) and a cyan tick
  under every ring actually sent, taller for a stronger ring. The scene
  publishes them each frame through `src/render/settingMarks.ts`, a small
  general channel any scene can use for its own settings' graphs; the lines
  are heights for a rise from rest (a hit landing on a still-decaying pulse
  tops out higher on the graph than its rise).
- 2026-09-27 — The user couldn't read that graph with a level-type source
  plugged in: the signal sat around 0.8–0.96 while the "full ring" line sat
  at ~0.35 (a jump size from zero, not a height on the curve), "rings above"
  was missing, and rings came in clusters. Cause: salience compared each
  frame's step on its own; a smooth source climbs a little every frame, each
  step below `SALIENCE_EVENT_MIN`, so the trackers never learned it (bar stuck
  at 0) and every climbing frame sent its own small ring. Now
  `advanceEmission` measures a whole *climb* from the last dip: the ring
  grows as the climb crosses the bar and nears the full-ring height, and the
  finished climb teaches the trackers. `salienceMarks` returns real heights —
  last dip (or the signal, between climbs) plus bar / full ring — and the
  panel draws them as traces riding the signal. In
  `tests/rippleEmitter.test.ts`, a level at 0.75 with alternating 0.25 and 0.06
  bumps: every big bump sends one ring (> 0.7), small ones < 0.15, the same at
  30 and 120 fps; a ring never starts below the drawn line. With a clean hit
  source and no background the bar is 0, so "rings above" sits on the signal
  itself: any climb rings.
- 2026-09-27 — Graph still hard to read with two sources added together: the
  result went past 1 and was flattened against the top, the lines went off
  the chart, and two dotted lines plus a bar row were too much to decode. Now
  the chart autoscales to what it shows, Beat ripple publishes one line
  ("reach to ring"; the full-ring line is gone), each ring is a cyan dot on
  the bump that sent it (sized by strength), and a one-line key under the
  graph names both. The panel's native `title` tooltips were dropped too
  (`setHint` in `deviceMenu.ts`): they repeated the bottom hint line's text.
- 2026-09-27 — The dotted line is an adaptive threshold: the floor tracker is
  a noise-floor estimate and the line sits a margin above it. Made
  adjustable as `ringThreshold` (Ring threshold), through `ringThresholdBar`:
  the margin runs 1×–3× the floor, and above the default a fixed minimum
  grows too (so it still bites on a clean source whose floor is 0). The
  default, `RING_THRESHOLD_DEFAULT`, is exactly the old fixed bar (1.5×, no
  minimum). Headless check with Any hit + Loudness patched in: at 0.8 the line
  sits well above the signal and only the kicks ring; at the default the
  quieter hits still send small rings.
- 2026-09-27 — Moved at the user's request from a separate scene setting to
  a slider right under Beat ripple's graph: `SceneSetting.drive.threshold`
  declares it, `driveStore.ts`'s `getDriveThreshold`/`setDriveThreshold` save
  it with the patch (Reset to scene default clears it), and the scene reads
  `drives.threshold("ripple")`. The user had seen no difference from the old
  row; a real mouse drag of the new slider from 0.25 to 1 (Any hit + Loudness
  patched in) raised the dotted line and removed every small ring, leaving
  the kicks — the big hits still ring at any setting, since they are the
  standouts it's measuring against.
- 2026-09-27 — The row's own sparkline showed only the input (`valueOf`),
  clipped at 1 and broken into gaps wherever the loudest source changed
  colour, so it didn't reflect the filtering at all. Now, for a setting whose
  scene reports reactions, it draws the input dimmed with a cyan dot per ring
  sent; it autoscales and joins its colour segments. `settingMarks.ts`
  reactions are now kept per reader ("graph", "row") so the two views don't
  steal each other's rings.
- 2026-09-27 — Ring threshold gets an Off switch (`advanceEmission`'s
  `threshold: number | null`): every climb rings, sized only by how far it
  climbed, no standing out required; `salienceMarks` returns no line while
  off, so the panel draws no dotted line but the ring itself still shows as a
  reaction. The same idea is generalised to every other drive setting:
  `drives.ts` now tracks a per-setting adaptive noise gate for any patched
  setting whose spec doesn't declare its own `SceneSetting.drive.threshold` —
  a floor/peak tracker plus a slider-picked line, off by default, applied as
  a soft knee to `value()`/`uniformPair()`/`valueOf()` and a hard cut to
  `fired()`. Beat ripple keeps its own scene-handled gate exactly as it
  always has; `drives.ts`'s header explains why a setting is never gated both
  ways. `driveStore.ts`'s `getDriveThresholdState`/`setDriveThresholdOn`
  replace the old plain getter/setter so every drive setting's threshold row
  (`deviceMenu.ts`'s `buildThresholdRow`) can carry an on/off state, not just
  a value. Reaction dots on both the graph and the row's own sparkline now
  scale by the square root of their strength rather than linearly, so a range
  of hit sizes actually reads as a range — before, they looked like only two
  or three discrete sizes because a hit-kind source's default height is flat:
  Graded reads the catalogue's own decaying pulse, but the hit *itself*
  always jumps to exactly 1, so a ring landed at full, at whatever a recent
  pulse had decayed to, or not at all. Patching a source's height to Loud, or
  raising the Hit strength card's Dimension, is what actually varies a hit's
  own size before it ever reaches a ring.
- 2026-09-26 — "Tempo breathe" becomes "Breathe": the once-per-bar, tempo-locked
  zoom — and this scene's last read of `beatClock.ts` — was removed, and the dial
  turned into a patch destination whose zoom follows whatever source is wired to
  it (`breatheDrive(0.0)` in FRAG, inert at the Scene default), with its auto
  weights dropped so it is a taste dial like Caustic density rather than something
  the music profile redecides.
- 2026-09-26: slider-direction audit (AGENTS.md "Sliders: right = more").
  Descriptions corrected: Fog is hazier/softer ridges as it rises, and
  Sparkle grain is coarser glints as it rises. The old text said the
  reverse.
- 2026-09-27 — Ring style added (Bump/Wave/Merge, `ringStyle`): a fast driver
  landed rings closer together than a ring's own width, so their
  (always-positive) Bump crests piled into a rising, nearly flat plateau —
  the *slope* that actually refracts the filaments cancelled out in the
  interior of that pile-up, so a busy passage read as "the centre brightens"
  rather than "rings are travelling outward". Wave answers this at the shape
  level: each ring is now a crest plus a trailing trough (a second, identically-
  shaped gaussian subtracted at a fixed offset, both halves mirrored through
  r=0 the same way Bump's own crest is) so the ring is net-zero height and a
  dense train can't accumulate a rising plateau — it keeps reading as
  alternating rings instead. Merge answers it at the emission level instead,
  with no shape change: emissions landing within about one ring-width's own
  travel time fold into a single, capped-amplitude ring, so a fast driver
  reads as fewer, heavier rings rather than more, lighter ones. Both are
  genuine, different fixes for the same complaint (rippleEmitter.ts's own
  `RingStyle` section has the exact maths and the tradeoff each one costs —
  Wave's own young-ring transient in particular). Bump is unchanged and stays
  the default; the three are meant to be compared live, not immediately
  ranked.
- 2026-09-27 — Beat wave (`anim.beatWave`, a drive source everywhere else in
  the panel too) gained an optional every-N-beats divider
  (`DriveSource.every`: 1/2/4/8/16, drives.ts's own doc) so its swing can take
  a whole bar (or two) instead of always one beat; absent/1 is today's plain
  reading, bit-identical.

- 2026-09-27 — Wave, as first built, didn't fix the fast-driver case: a
  steady train of identical rings sums to a plateau, and a crest-minus-trough
  shape built from the same soft gaussians is that plateau minus a shifted
  copy of itself — still flat once the train is steady (the Wave dense-train
  test passed on the build-up region). Headless at 240 bpm, Wave rendered
  close to the no-ripple frame. The real cause in every style is ring width
  versus the gap between rings: the ripple left in a gaussian train falls off
  as exp(−2π²σ²/gap²), so rings need σ ≤ about a quarter of the gap — which
  the default Ring width already misses at an ordinary 120 bpm. Added
  auto-narrowing (`advanceRingRate`/`autoNarrowWidthW`, rippleEmitter.ts's
  Auto-narrowing comment): the ring width is capped at a fraction of the
  current gap, never wider than Ring width, back to full width after a
  pause; Merge keeps the plain width. In `tests/rippleEmitter.test.ts` a 3.7
  rings/s train goes from ≤1 slope sign change over r∈[1, 2.5] to ≥6, with
  >5× the peak-to-peak slope; hits every 2 s keep Ring width. Stills at 240
  bpm still don't show ring spacing legibly, like every Caustics still — to
  be judged live.
- 2026-09-27 — Beat surge, Kick surge and Loudness surge collapsed into two
  dials: Speed boost and Speed pump. Beat surge and Kick surge were the same
  motion (a rate surge plus an additive phase impulse) on two different
  hit sources, and the per-setting drive picker already lets one dial
  choose which hit it reacts to — a second dial for "the other hit" no
  longer earned its keep. Beat surge in particular had also stopped
  working as advertised: it read `drives.fired()`, a boolean edge, so
  wiring it to a level or line source silently kept firing only on
  onsets rather than reading that source's level. The user asked for two
  motions instead: an instant, level-following speed increase ("direct
  increase to drift speed based on current level of energy") and a
  push that decays back to the Drift-speed base rather than tracking its
  input directly ("energy would pump up drift speed but it would slowly be
  going back to the one set by drift... like push acceleration in a car").
  Speed boost (`driftLevel`) is `LEVEL_GAIN * driftLevel * levelValue` added
  straight onto the rate — `levelValue` is this scene's own calibrated
  loudness (`advanceLoudSwell`) by default, same reasoning as the old
  Loudness surge, just linear instead of a geometric swing about a neutral
  pivot. Speed pump (`driftPump`) replaced `advanceLurch`/`advanceKickJolt` with a
  single accumulator (`advancePump`): a hit accelerates a velocity
  (`PUMP_ACCEL`) that decays exponentially (`PUMP_RELEASE_SEC`) and is
  capped (`PUMP_VEL_CAP`), added onto the rate the same additive way. Both
  terms are additive rather than multiplicative on the Drift-speed base —
  the reason either one still moves the pool with Drift speed at 0 — so
  `DRIFT_RATE_MAX` is now a generous backstop the additive model can't
  reach on its own rather than a value the design tries to walk up to.
  Beat churn's own envelope decay constant was renamed from
  `LURCH_DECAY_PER_SEC` to `CHURN_DECAY_PER_SEC` (same value) now that it's
  no longer shared with a lurch; its behavior is unchanged.
- 2026-09-27 — Beat churn removed: it spiked `warpAmt` (the domain warp) on
  every onset with its own ~110ms decay, reshaping the whole field each beat —
  "too chaotic" against the rest of Motion's beat-locked dials, and a
  duplicate of `uTurbulence`'s existing warpAmt channel besides (Mid
  turbulence already reshapes the filaments, and its drive picker already
  lets it react to Any hit instead of only the mid band). Wire Turbulence to
  a hit source for the same beat-locked reshaping in its place.
  `CHURN_DECAY_PER_SEC`/`CHURN_GAIN`/`uChurnDrive`/`churnPulse` are gone with
  it.
- 2026-09-27 — Drift speed, Speed boost and Speed pump grouped into a shared
  colour family (`SceneSetting.family`, a new generic device-menu mechanism —
  see `sceneSettings.ts`, `controlsTheme.ts`'s `FAMILY_ACCENTS` and
  `deviceMenu.ts`'s `renderSceneSettings`) so the three read visibly as one
  thing — "all that is about drift speed" — in the panel instead of three
  unrelated Motion rows. A first cut added a left rail, an indent and a
  caption; the user asked for just the colour ("colour is enough"), so the
  rows sit flush and only their accent changes.

## Tuning notes

- Fog sets the resting sharpness and dark-water floor cut (0 = crisp threads on
  black water, 1 = hazy, glowing wash); Focus is a pure multiplier on top of it,
  driven by the beat pulse — 0 means no snap at all, and dragging Focus never moves
  the resting look (`fogRestingSharp`, `focusSharp`).
- `FOCUS_SHARP_MAX` and the `fwidth`-based per-ridge exponent cap in `FRAG` exist
  specifically to keep the ridge's `pow()` short of a step function — past that
  point it "pixel-ladders" into a rainbow-fringed stair-step, worst exactly where
  the domain warp bunches several octaves' contours together and exactly on a beat
  (when sharp jumps). A maxed Focus snap against a maxed Mid turbulence is the case
  to eyeball for it.
- Speed boost reads `advanceLoudSwell`'s own slow-contracting (tens-of-seconds)
  calibration of `FeatureFrame.level`, not `frame.energy`, so it settles into the
  room or playback's own observed range instead of re-normalizing away the very
  quiet-vs-loud contrast it exists to show.
- Beat ripple's drive picker still chooses what feeds the emitter (Scene default
  is bass hits or any broadband beat, continuous; picking a single catalogue
  source instead reads that source's own level/pulse) — but there's no longer a
  separate fire-mark threshold to tune, the way `rippleThreshold` used to be:
  `advanceEmission` reads whatever the picked source's continuous reading does
  and launches a ring for its own rise, busy or not (see the 2026-09-27
  Decisions entries).
- Speed boost and Speed pump are both additive on top of the Drift-speed base
  (`driftRatePerSec`), not multipliers on it, which is why either one still
  moves the pool with Drift speed itself parked at 0.
- Drift speed's default reproduces the scene's original wander speed exactly (see
  the `driftRatePerSec` regression test, which exists because an earlier version of
  this constant doubled up an attenuation already baked into the flow term and ran
  roughly 6.7x too slow).
- The silence gate's default marks (upstream, in `silenceGate.ts`) were tuned
  against the reported hiss case, not measured on a real mic — if Caustics still
  under- or over-reacts in a quiet room, that is the gate to retune, not this scene.
- Beat ripple's emitter (`rippleEmitter.ts`): `RIPPLE_REFRACT`/`RIPPLE_CEIL_KNEE`/
  `RIPPLE_CEIL_MAX` in `caustics.ts` set how visible the profile reads on
  screen (a single full-strength ring is designed to peak at exactly the
  ceiling's own knee, so it's unaffected by the ceiling at all), and
  `advanceEmission`'s own `EMISSION_SMOOTH_TAU_SEC`/`RISE_DEADBAND_PER_SEC`
  set how much of a real hit's height survives conditioning and how slow a
  swell has to be before it's ignored entirely (see that function's own
  comment — its constants are picked against `anim.beatPulse`'s actual decay
  rate, `BEAT_PULSE_DECAY_PER_SEC` in `animClock.ts`, not a round number).
  Judge a single beat the way the old pool was judged — one clear expanding
  ring, not a flash — but also check a *busy* driver (many onsets in a row,
  or a drawn line): it should read as lighter, denser rings that duck each
  other, never a stutter or an unbroken stack of full-strength ones. The
  headless recipe in Resume here isolates the ripple from every other
  reactive setting for exactly this judgment.

- Breathe is a patch destination: its row's dial is only the zoom's depth, and the
  row does nothing at all until a source is wired to it (see `breatheDrive(0.0)`'s
  comment in FRAG and the `breathe` entry in SETTINGS).


## Known issues and next steps

- Nothing in this file hand-rolls trigger/hold/decay logic any more: Kick
  surge and Beat churn were removed on main (Speed pump replaced them), and
  Beat ripple is a continuous emitter (`rippleEmitter.ts`), not a trigger
  design, so the shared beat-listener migration no longer applies here.
- Two older pull-request prototypes this scene's audio coupling grew from — the
  "Flash from level" crossfade and the "Sparkle from line" drive — landed as
  discrete alternative sources on those rows' own pickers rather than as separate
  dials, and the signal-links-to-drive-picker migration they were bundled with
  landed too (the `reads` entry left on Spectral hue is deliberate, not pending —
  see Where the code is). The one concern from that era still open is the sparkle
  brightness ceiling possibly not being enough for the most aggressive setting
  some material wants; it has only ever been checked on the synthetic feed
  (see below).
- Only the synthetic audio feed has been used to check the sparkle/flash tuning
  above; there has been no measured real-music pass. The ring emitter's own
  constants (see Tuning notes) are likewise screenshot-tuned against synthetic
  audio only, not a measured real-music pass.
- Ring style's Wave option has a real cost for an isolated hit: while a ring
  is younger than roughly its own trough-shift distance (`WAVE_TROUGH_SHIFT_SIGMAS`
  in `rippleEmitter.ts`), its apparent strength swings well off its settled
  value — even reading near-zero for an instant — before matching Bump's own
  peak from then on (that file's own comment has the numbers). Invisible in
  the dense trains Wave exists for; plainly visible on a single, well-spaced
  beat. Still open: whether that reads as an acceptable "developing ripple"
  look or needs a smaller shift (at the cost of the dense-train case) once the
  user has compared the three styles live.

## Materials

- Artifact: [Caustics Patch Bay](https://claude.ai/artifact/5mPSRq9Btjf373FDtsQ8kt). Source saved as `caustics/artifacts/caustics-patch-bay.html`.
- Artifact: [Caustics Signal Recipe](https://claude.ai/artifact/WDRpyQyRzbFAXS58YQaLZX). Source saved as `caustics/artifacts/caustics-signal-recipe.html`.
- Both artifacts are clickable prototypes for choosing what each reactive setting listens to — the UI behind the drives work (PR #130).
- Artifact: [How Beat Ripple Listens](https://claude.ai/artifact/8ZJgP3mSY8Me4U9epRgwB5). Source saved as `caustics/artifacts/beat-ripple-listens.html`. A plain-language, accessible explainer of the current Beat ripple: a live demo (four kinds of made-up music) running a copy of `advanceEmission`'s rules with the same constants, drawing the panel's graph and the water side by side, plus a key, the four steps and a short Q&A. If `advanceEmission` or its `SALIENCE_*` constants change, the copy in that page has to change with them.
- Artifact: [Caustics Ripple Pool](https://claude.ai/artifact/XHPGPwgvy7RvTWuk3ihrnF). Source saved as `caustics/artifacts/caustics-ripple-pool.html`. Old vs new ring pool live under a hit-rate slider, why level/line sources used to silently ignore `fired()`, and a demo of the hysteresis signal→trigger converter shipped as `src/render/valueTrigger.ts` (this file's second 2026-09-26 entry above). Superseded as a picture of Beat ripple itself by the wave-tank rewrite and then the continuous ring emitter (both 2026-09-27 Decisions entries; every version it compares is now history) — the current emitter (`rippleEmitter.ts`) restores most of what that artifact's "old" side showed, now launched continuously off the driver's own rise instead of a yes/no trigger. `valueTrigger.ts` is unaffected and still used elsewhere.
- `caustics/scripts/` — the session scripts used to screenshot, probe or measure the scene, rescued from working sessions; each header says what it's for and how to run it, and they may need adjusting to the current code.

## Resume here

- `npm run dev`, then open the scene directly:
  `/?audio=synthetic&bpm=120#/v/caustics` (any query goes before the hash).
- `tests/caustics.test.ts` pins the drift-rate, focus-snap and loudness-swell
  invariants directly; Beat ripple's own emission and profile invariants
  (`advanceEmission`, `rippleEnvelope`, `createRippleEmitter`, `buildProfile`)
  are `tests/rippleEmitter.test.ts`'s job now — run both before touching any
  of the exported pure functions rather than eyeballing the shader.
- A headless render check for Beat ripple specifically: force `ripple:1` and
  zero every other Motion setting via `window.__viz.setParams` (a Playwright
  script following this pattern is what this file's 2026-09-27 Decisions entries
  were verified with) — a black frame means a shader compile error, printed at
  the top of the page's console/pageerror output.
- Any new drift/flow offset added to a noise coordinate in `FRAG` must get a
  matching, wrapped entry in `driftFlows` on the JS side, or it reintroduces the
  mobile seam bug `src/render/noiseHash.ts`'s header documents — the two halves only
  work together.
- Audio-coupling work against this scene can arrive in several places at once
  (hit strength, line sources, the patch bay); check each one's merge state
  before trusting a description of "current" behavior against it.

## History

- `db884a0` (2026-08-27) — Fix Focus Snap: decouple resting sharpness from the slider
- #6 / `b44000d` (2026-08-28) — Focus Snap peak-scaling rework; pixel-ladder and governor fixes
- #28 / `ef3497a` (2026-08-29) — Treble sparkle split into a macro over five sub-params
- #34 / `5edb296` (2026-08-29) — Beat ripple refracts like a real ring, pools instead of erasing
- #48 / `740dedb` (2026-08-30) — Signal-links framework; Caustics is the first consumer
- #50 / `9b52b66` (2026-08-30) — Focus Snap actually scales the on-beat peak
- #51 / `50403ca` (2026-08-30) — Live spectral centroid signal
- #55 / `076fdc8` (2026-08-30) — `renderLatch.ts` fixes dropped beat ripples across skipped render ticks
- #56 / `e39b0c3` (2026-08-30) — Focus snap decoupled from resting state; Fog and Caustic density added
- #59 / `44b7513` (2026-09-01) — Kick surge gets a position jolt
- #61 / `d446710` (2026-09-01) — Beat surge becomes a real lurch; Beat churn added
- #63 / `2054a81` (2026-09-02) — Loudness surge made actually reactive
- #65 / `4ed6414` (2026-09-02) — Spray injection, Sparkle distortion, finer Sparkle grain
- #102 / `919db8c` (2026-09-12) — Fix mobile seams and dashed lines (bounded noise hash)
- #115 (merged 2026-09-18) — Silence gate (global; Caustics was the motivating report)
- #121 / `fb13048` (2026-09-21) — Mobile-seam fix extracted into shared `noiseHash.ts`
- #118 (merged 2026-09-19) — hit history and the shared `beatListener.ts`; Caustics itself doesn't use the listener yet
- #127 / `30e3240`, #130 / `4bc9175`, #136 / `eee37a8` (merged) — graded hit
  strength, the per-setting drive picker, and the multi-source patch bay —
  Caustics' reactive settings now pick their sources through the picker
- #147 (2026-09-26) — Tempo breathe → Breathe: a wirable, inert-until-patched
  zoom (see Decisions)
- #154 (2026-09-27) — Beat ripple: rings always reach the edge, then a continuous ring emitter (`rippleEmitter.ts`) sized by salience, with its threshold drawn on the panel graph (`settingMarks.ts`); level/line drive sources fire through `valueTrigger.ts` (see Decisions)
