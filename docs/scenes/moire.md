# Moiré (`moire`)

A light paper ground carrying two horizontal line gratings of one shared
period; where a slow noise field displaces the second grating into
anti-phase with the first, the gaps fill in and a soft dark "cloud" appears.
Feed it music and the clouds pulse, flicker, briefly invert on drops, and
stretch into wandering streaks. Draft, on main.

## Where the code is

`src/render/scenes/moire.ts` exports `moireScene`, built on
`createFullscreenScene`. All simulation state lives in JS, advanced by pure
functions the shader only samples as uniforms:

- `advanceFlicker` / `FlickerState` — steps `uSeed` at a fixed Hz (or glides
  continuously at rate 0), driving the fast-reseeding half of the noise field.
- `introRamp` — a one-shot ramp on the scene's own elapsed time.
- `advanceBlackout` / `BlackoutState` — the half-period phase jump on a bass
  hit or drop.
- `advanceCurtain` / `CurtainState` — the quiet-passage reveal that lifts the
  grating off the frame's bottom edge.
- `advanceWander` / `WanderState` / `WanderInputs` / `WanderOutput` — eases
  the noise domain's rotation, anisotropic stretch, second-octave detail
  weight and line tilt toward re-picked targets; re-picks on `dropOnset`, on
  a bar-wrap cadence while tempo-locked, or on a fallback timer otherwise.

The fragment shader hashes its own lattice (`hash12`/`vnoise`/`fbm`, written
from scratch per CLAUDE.md's independent-implementation rule) and draws both
gratings in screen pixels off `gl_FragCoord`, so the reference's fixed line
spacing holds at any canvas size; the noise domain instead samples room-space
`p` so cloud size stays a room property. `grating()` anti-aliases both edges
of the periodic ink band via distance-to-band-centre, not a one-sided
`smoothstep` — see the header comment on why a one-sided fade produced hard
vertical seams on any non-horizontal line. `uBlackout`/`uCurtain`/`uStretch`/
`uWander` are the raw slider uniforms `sceneSettings.ts` auto-declares but the
shader never reads directly; it reads the JS-processed signals
(`uBlackoutPhase`, `uCurtainLevel`, `uStretchNow`, `uAngle`, `uDetailMix`,
`uTilt`) instead — the same split `caustics.ts`'s `uDrift`/`uDriftPhase` uses.

Tests: `tests/moire.test.ts` covers `advanceFlicker`, `introRamp`,
`advanceBlackout`, `advanceCurtain`, `advanceWander`, and the NEUTRAL-dials-
reproduce-defaults invariant via `computeAutoTarget`.

## References

Studied from thedotisblack's "Moiré Pattern Art | Horizontal lines with
noise" (Creative coding, Processing) on YouTube (`oiIxQ_JxbZo`), specifically
its second chapter (0:55–2:16, "Part 2"). The first scan mistakenly covered
the video's first 30 seconds (a different chapter); that pass is kept in the
`/ref` bundle `tools/.cache/refs/oiIxQ_JxbZo/` but wasn't the basis
for this build. The chapter actually studied is the bundle
`tools/.cache/refs/moire-p2/`. Scan-line measurement (the usual
`reflook` object detector found nothing useful on this light ground) read
off the underlying mechanism: two same-period horizontal gratings, one
displaced from the other by a smoothly varying, frame-by-frame re-rolling
noise field. The source has no audio-reactivity of its own (Processing
timers over ambient music), so every audio mapping in this file is an
original design choice, not something measured from the reference.

## Measurements

2026-09-12 (initial build, 1280x720, defaults, after the intro ramp),
reference vs. ours: line period/dark run 8.0px / 4-5px vs. 7.6px / 4-5px;
dark share 0.55-0.70 vs. 0.65-0.72; blurred field min/max/mean 0.17/0.51/0.35
vs. 0.20/0.45/0.30-0.36; cloud std 0.10 vs. 0.075-0.08; cloud
half-correlation length 0.3-0.6 half-heights vs. 0.31-0.44; consecutive-frame
correlation 0.1-0.3 (reference) vs. -0.4-0.1 at flicker 30 / 1.0 at flicker 0.

2026-09-18 (Round 2, after the wander fix), reference vs. ours: elongation
ratio over roughly a minute 1.1-2.6 vs. 1.2-3.4 at defaults; long-axis
orientation wanders through all angles in the reference vs. nine distinct 15
degree bins in 54s for ours; a streaky frame's across x along extent
0.12 x 0.22 half-heights vs. 0.11 x 0.33 at Streak 4 / Wander 1; tonality
(blurred min/max, cloud std) 0.17/0.51, 0.10 vs. 0.16-0.21/0.44-0.51,
0.07-0.085.

Reference audio/picture correspondence on the `moire-p2` chapter: our onsets
landed within 60ms of 82% of librosa's; tempo locked at 2x the reference's
estimate (163 vs 86 bpm); `sectionIntensity` never rose at the measured
section boundaries — recorded as runtime beat-clock/section limitations, not
worked around in this scene.

## Decisions and pivots

- 2026-09-12: initial build from the `moire-p2` bundle (PR #104, folded into
  the same PR as the round-2 work below by merge time). Depth tuned to
  roughly 2.6 periods after an early ~1.6-period pass read as pale clouds —
  anti-phase needs the phase to wrap across a cloud's width, not just touch
  it on thin contours. `INK_B` (the displaced grating) set lighter than
  `INK_A` so anti-phase fill reads mid-grey, matching the reference's
  measured floor, rather than ink-on-ink black. Noise octave count held at
  two, the second down-weighted, after a third octave drew a thicket of thin
  contours the reference doesn't show. A precision bug — the seed stepping
  into the thousands ran `fract()` in the hash out of mantissa and produced
  hard lattice seams — was fixed by wrapping the seed and folding lattice
  corners before hashing.
- 2026-09-16 to 2026-09-18: feedback that the field read as monotonous,
  alongside a reference frame showing narrow diagonal streaks on slightly
  tilted lines. Re-measuring the chapter's middle found the noise field is
  anisotropic and its long axis rotates through every direction over tens of
  seconds, with a small constant line tilt — none of which the initial build
  reproduced (isotropic, fixed orientation). Added `advanceWander` (rotation,
  anisotropic stretch, detail weight, tilt, all eased toward re-picked
  targets) and the Streak/Wander settings (PR #104). Most of the elongation
  was tuned to compress the across-streak axis rather than lengthen the
  along axis (`STRETCH_ACROSS_SHARE`), after an along-biased first pass gave
  a few broad streaks where the reference shows several narrow ones. The
  seam bug initially blamed on hash precision turned out to have a second,
  more direct cause: `grating()` only anti-aliased the ink band's trailing
  edge, so any non-horizontal line (the wobble, later the tilt) stair-
  stepped in unison across the frame; both edges are now softened via
  distance-to-band-centre.

## Tuning notes

Depth needs to reach several periods, not one, before broad anti-phase
regions can form — see `depth`'s own setting description and the `Warp
depth` decision above. `wander` at 0 freezes the anisotropy exactly where it
sits (useful for isolating whether a seam or artifact is depth-related vs.
wander-related); with `wander` at 0 from scene start the field stays at
rest (isotropic), so `stretch`/`Streak` alone shows nothing until wander is
on. `flicker` at 0 switches the fast noise component from stepped re-rolls
to a continuous glide rather than freezing the picture. Judge the look
against the measured bands above: dark share, cloud std, and the streaky
frame's across/along ratio are the numbers that matter most.

## Known issues and next steps

Tempo lock ran at 2x the reference on the measurement track, and
`sectionIntensity` didn't rise at the reference's section boundaries — both
are beat-clock/section limitations noted as runtime to-dos rather than
worked around locally in this scene.

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/moire`. `__viz.setParams`
ignores a bare `settings` object — it needs `scene` alongside it, or the
override silently no-ops (this bit both `tools/ref-shoot.mjs --settings` and
an ad hoc probe script before the former was fixed in PR #104). A worktree
checkout can't see the main checkout's `tools/.cache` — pass the main
checkout's bundle path explicitly when shooting comparisons from a worktree.
A depth-0 (or otherwise single-term-disabled) shot is the fast way to
localise a shader seam/artifact to one term.

## History

- `#104` (2026-09-18, merged) — Moiré rebuilt from the measured `moire-p2`
  reference (id `moire`); previous draft kept as `moire2`; Round 2 wander/
  streak/tilt work and the seam-anti-aliasing fix landed in the same PR.
