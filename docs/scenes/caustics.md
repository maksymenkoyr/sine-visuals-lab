# Caustics (`caustics`)

The bright wandering filaments you see on the floor of a sunlit pool — domain-warped
value noise sharpened into thin ridges, with a beat ripple, treble sparkle and a
spray-injection layer riding on top. Ships from the initial commit and is on main
(not a draft).

## Where the code is

- `src/render/scenes/caustics.ts` — the scene module (`createFullscreenScene`,
  `SETTINGS`, the `FRAG` template, and an `extraUniforms` closure that advances the
  drift phase, the beat lurch, beat churn, kick jolt, loudness-swell calibration and
  the ripple pool every frame).
- Its response math is factored into small pure functions exported specifically so
  `tests/caustics.test.ts` can pin them directly: `focusSharp`, `fogRestingSharp`,
  `fogFloorCut`, `causticDensityScale`, `driftRatePerSec`, `loudSpeedFactor`,
  `advanceLoudSwell`, `loudSwellDrive`, `advanceLurch`, `advanceKickJolt`,
  `rippleEnvelope`, `createRipplePool`, `driftFlows`, and the `sparkle*` helpers.
- Imports `NOISE_HASH_GLSL`, `NOISE_MASK`, `NOISE_PERIOD`, `wrapFlow` from
  `src/render/noiseHash.ts` — the shared mobile-safe lattice hash (see Decisions
  below; this scene is the reason that module exists).
- Reads the phase-locked beat/bar clock (`beatClock.ts`) and the latched one-shot
  edges on `AnimFrame` (`renderLatch.ts`) rather than raw `FeatureFrame` edges.
  `uDropReactivity`/`dropDrive` reads `sectionIntensity.ts`'s slow-tracked
  "which part of the song is this" signal.
- Its reactive settings still use the signal-links framework
  (`SceneSetting.reads`, `src/render/signals.ts`) rather than the newer per-setting
  drive picker — see Known issues for the pending migration.
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

## Tuning notes

- Fog sets the resting sharpness and dark-water floor cut (0 = crisp threads on
  black water, 1 = hazy, glowing wash); Focus is a pure multiplier on top of it,
  driven by the beat pulse — 0 means no snap at all, and dragging Focus never moves
  the resting look (`fogRestingSharp`, `focusSharp`).
- `FOCUS_SHARP_MAX` and the `fwidth`-based per-ridge exponent cap in `FRAG` exist
  specifically to keep the ridge's `pow()` short of a step function — past that
  point it "pixel-ladders" into a rainbow-fringed stair-step, worst exactly where
  the domain warp bunches several octaves' contours together and exactly on a beat
  (when sharp jumps). A maxed Focus snap against a maxed Beat churn is the case to
  eyeball for it.
- Loudness surge reads `advanceLoudSwell`'s own slow-contracting (tens-of-seconds)
  calibration of `FeatureFrame.level`, not `frame.energy`, so it settles into the
  room or playback's own observed range instead of re-normalizing away the very
  quiet-vs-loud contrast it exists to show.
- Ripple source switches Beat ripple between "bass hits only" and "bass hits plus
  any broadband beat" at a fixed threshold — useful for restricting rings on a busy
  mix so they don't machine-gun.
- Drift speed's default reproduces the scene's original wander speed exactly (see
  the `driftRatePerSec` regression test, which exists because an earlier version of
  this constant doubled up an attenuation already baked into the flow term and ran
  roughly 6.7x too slow).
- The silence gate's default marks (upstream, in `silenceGate.ts`) were tuned
  against the reported hiss case, not measured on a real mic — if Caustics still
  under- or over-reacts in a quiet room, that is the gate to retune, not this scene.

## Known issues and next steps

- Beat ripple, Kick surge and Beat churn still hand-roll their own trigger/hold/
  decay logic in this file rather than using the shared beat-listener module that
  later scenes are meant to converge on; migrating them was flagged as a follow-up
  but is not done.
- Two related pull requests were open and not yet merged as of this writing, and
  describe behavior not present in the current code on `main`:
  - A "Flash from level" crossfade (Beat flash driven by the continuous energy level
    instead of only the beat pulse, so a sustained wall of noise still reads as a
    hit) and a "Sparkle from line" drive (Treble sparkle driven by a user-drawn
    per-band sensitivity line) were prototyped specifically for this scene, along
    with a note that the sparkle brightness ceiling may still not be enough for the
    most aggressive setting some material wants.
  - A broader migration of every reactive-amount setting in this file off the
    signal-links `reads`/`activeWhen` mechanism onto a newer per-setting drive
    picker was planned, listing this scene among those to convert; the `reads`
    entries on the ripple, ripple-source and spectral-hue settings are the
    pre-migration mechanism, still in place.
  Check the state of any in-flight work touching this scene before assuming either
  is live.
- Only the synthetic audio feed has been used to check the sparkle/flash tuning
  above; there has been no measured real-music pass.

## Materials

- Artifact: [Caustics Patch Bay](https://claude.ai/artifact/5mPSRq9Btjf373FDtsQ8kt). Source saved as `caustics/artifacts/caustics-patch-bay.html`.
- Artifact: [Caustics Signal Recipe](https://claude.ai/artifact/WDRpyQyRzbFAXS58YQaLZX). Source saved as `caustics/artifacts/caustics-signal-recipe.html`.
- Both artifacts are clickable prototypes for choosing what each reactive setting listens to — the UI behind the drives work (PR #130).
- `caustics/scripts/` — the session scripts used to screenshot, probe or measure the scene, rescued from working sessions; each header says what it's for and how to run it, and they may need adjusting to the current code.

## Resume here

- `npm run dev`, then open the scene directly:
  `/?audio=synthetic&bpm=120#/v/caustics` (any query goes before the hash).
- `tests/caustics.test.ts` pins the drift-rate, focus-snap, loudness-swell and
  ripple-envelope invariants directly — run against it before touching any of the
  exported pure functions rather than eyeballing the shader.
- Any new drift/flow offset added to a noise coordinate in `FRAG` must get a
  matching, wrapped entry in `driftFlows` on the JS side, or it reintroduces the
  mobile seam bug `src/render/noiseHash.ts`'s header documents — the two halves only
  work together.
- Several pull requests can be in flight against this scene's audio coupling at
  once (hit strength, line drive, the drive-picker migration); check each one's
  merge state before trusting a description of "current" behavior against it.

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
- #127, #130 — open, not merged as of this writing; see Known issues
