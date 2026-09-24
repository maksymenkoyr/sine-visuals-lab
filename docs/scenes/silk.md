# Silk (`silk`)

A mirror kaleidoscope (D8, D6 in places) of translucent glowing ribbon
filaments on near-black, with fine parallel echo lines trailing each
ribbon, a dark centre hole that breathes wider and tighter, and continuous
slow morph and zoom — never a hard cut. Draft scene, merged on main.

## Where the code is

- `src/render/scenes/silk/index.ts` — the `Scene` (id `"silk"`, name
  "Silk"), `SETTINGS`, the sharp/tail/blur/composite render targets, and
  `render()`, which feeds `driver.ts`'s state into `glsl.ts`'s
  `SHARP_BODY`/`TAIL_BODY`/`BLUR_FRAG`/`COMPOSITE_BODY`.
- `src/render/scenes/silk/driver.ts` — pure sequencer: `createSilkState`/
  `advanceSilk`, `fillEchoFlows` (per-echo, per-octave flow offsets via
  `noiseHash.ts`'s `wrapFlow`), the regime travel/hold machinery
  (`REGIME_TRAVEL_SEC`, `MIN_BARS_BETWEEN`, `UNLOCKED_BAR_BEATS` bar-detect
  idiom copied from `crystal/driver.ts`), and the tail's 8-bit decay-floor
  math (`stepsToZero`/`tailDecayStep`).
- `src/render/scenes/silk/glsl.ts` — the K-echo strand field
  (`strandField`, `FIELD_OCTAVES` for the domain-warp octaves), the presence/
  sparsity gate and its wide-fold variant (`foldPointWide`), threads, the
  web overlay, the `silkRamp` 5-stop hue ramp, and the weighted-hue
  accumulation (`accumulate(inout I, inout C, inout W, w, hue)`) that
  replaced a plain per-channel screen blend.
- `tests/silk.test.ts` — tests on `driver.ts`: the 8-bit decay-floor
  proof, determinism, no-NaN over long runs, hole/foldMix/zoom/web fields
  never jumping like a cut (including at a large simulated dt), no
  brightness flash on an onset, bar/phrase/drop regime-timing.
- Shared systems: `noiseHash.ts`'s `wrapFlow` (every echo's flow offset is
  wrapped per-octave, not reused with a scale factor, to avoid a
  256→0-wrap discontinuity); `src/render/palette.ts`'s `uPalA..uPalD`
  common uniforms, read only when the `tint` setting picks the app
  palette over the ramp; `sceneCommon.ts`'s `COMMON_UNIFORMS_GLSL`/
  `ROOM_UV_GLSL`. Does not import Kaleidoscope's fold code — scenes don't
  import each other, so the mod+abs fold idea is independently written.

## References

Studied from the YouTube short `vKJu9mfeDS8`
(https://www.youtube.com/shorts/vKJu9mfeDS8), measured via `/ref`:
a D8 (D6 in places) mirror kaleidoscope of translucent glowing teal/cyan
ribbon shapes on near-black, fine parallel echo lines (video-feedback
trails), a dark centre hole that breathes, continuous slow morph/zoom with
no hard cuts in 30 s at 30 fps. `/ref` bundle: `tools/.cache/refs/vKJu9mfeDS8/`.

What was taken from it: the layered, stacked-echo look and the no-cut,
continuously-morphing timing; the ribbon colour and density were later
pushed well past the measured picture on request (see Decisions, Round 3).

## Measurements

From `tools/.cache/refs/vKJu9mfeDS8/report.md`, 2026-09-23 (tempo 123.0
bpm, 59 beats, 3539 probe samples / 185 reference onsets):

- No hard cuts in 30 s — every change is a fade or a travel.
- Brightness does not flash on onsets (rise z +0.04 over 25 strong
  onsets); saturation follows low/mid continuously (r +0.72, no lag);
  activity follows mid (r +0.33, -66 ms).
- Colour change pops harder on bar/phrase beats (z +0.94 on rank ≥4 vs
  +0.53 on rank ≤2) and hardest at phrase starts (rank-16 z +1.21 vs
  rank-4 +0.70); picture changes regime at 3 of 4 audio section
  boundaries.
- One strobe stretch at t≈12.1 s, ≈0.48 beat period — not reproduced (the
  every-frame burst around it shows no real flash, judged not real).
- Our tempo lock mismatched the reference on this clip: median 148 bpm
  (173–181 early on) vs. the reference's 123, a non-integer ratio; our
  `anim.dropOnset`/`sectionIntensity` never rose at this clip's own
  section boundaries.
- Round 3 tuning probe (`ref-scan.py`'s saturation formula, `(max-min)/
  (max+eps)` per pixel, on a beat-sweep sample): ours ≈0.62 mean vs. the
  reference's 0.71 — closer than the pre-Round-3 washed state, not chased
  to an exact match since that round's brief was more colour, not a
  closer match.
- fps cost of Round 3's extra octave/threads/web: 63→59 at quality high,
  no governor step-down.

## Decisions and pivots

- **2026-09-23, PR #131 (single squashed commit `fd21602`):** first build.
  Scene-vs-style question resolved by asking directly: built as its own
  scene rather than a Kaleidoscope style, because the echo trails need
  persistent per-frame state that Kaleidoscope's stateless fullscreen pass
  doesn't carry, and Kaleidoscope's own "zoom" already means nested child
  mandalas (see the Kaleidoscope scene record's "split by pipeline, not by
  look" rule).
- Design choice: K echoes computed **directly** from one domain-warped
  noise field at a smaller/larger scale and an earlier morph-clock point,
  rather than resampled out of a real feedback texture — repeated
  bilinear resampling would blur the reference's ~3px echo-line spacing
  into mush within roughly 20 steps (the same problem the Tessera scene
  hit with its own feedback buffer). Only the diffuse haze beyond the
  crisp echoes is a real one-frame-lagged feedback texture.
- Two bugs fixed before the first screenshot round: the presence/sparsity
  gate sampled noise through the kaleidoscope fold, which confines every
  pixel to a narrow angular wedge and collapses the noise's realised range
  — read as an all-or-nothing switch until a wide-fold variant re-expanded
  the angle before sampling; and a swell-driven amber accent washed the
  whole annulus mask instead of tinting only lit line pixels.
- **Round 2 (same PR, feedback that the picture read as far from the
  source material):** the initial
  audio-driven compare showed a thin wireframe outline against the
  reference's dense, layered field. Cause: combining the K echoes with
  `max` kept only the single brightest echo per pixel instead of letting
  near-identical rescaled echoes stack. Fixed with a screen/lighten blend
  at both combine points, and broadened the warm/amber presence from a
  rare bar-swell spike to a continuous regime-driven mix.
- **Round 3 (same PR, feedback: more complexity, more colour — an explicit
  push past the measured picture, not a re-match):** added Threads (fine
  lines trailing each ribbon, spaced by the local field gradient), Web (a
  faint star-polygon/rosette line per echo reaching past the silk's own
  annulus into the corners), a fourth field octave (fixing a latent seam
  where the old 2-octave field scaled an already-wrapped flow offset
  instead of giving every octave its own wrapped offset), and a cyclic
  5-stop hue ramp plus a `tint` setting that lets a share of ribbons draw
  from the app's own colour palette instead — the same integration pattern
  Moiré/Petri/Slats/Kaleidoscope's own `tint` settings use, rather than a
  Silk-only colour list.
- Fixed along the way: the added stacking under Round 3 pushed one colour
  channel to clip while others kept climbing, washing bright areas toward
  grey — replaced the per-channel screen blend with a weighted-hue
  accumulation (intensity still screen-blends toward 1; colour is a
  running weighted mean that can't exceed any single layer's own
  saturation), and raised the composite's saturation floor to match.

## Tuning notes

- Judge continuity, not stills: the reference's whole point is no hard
  cut, so scrub through a bar/regime change rather than comparing two
  screenshots.
- `threads=0` and `web=0` reproduce the Round 2 (pre-Round-3) look
  exactly — useful for isolating whether a regression is in the base
  field or in one of the Round 3 additions.
- `tint=1` pulls ribbon colour from the app's active palette instead of
  `silkRamp` — confirm which is active before judging a colour complaint.
- `colors`/`tint` were deliberately pushed past the reference's measured
  cyan-dominant hues on request; pull them back down for a strict
  reference-match pass.
- The regime's hole-size multiplier range reads as wider than the
  reference, which stays more consistently "full" across the same window
  — a candidate first cut if the picture reads as too empty at times.

## Known issues and next steps

- Tempo/section-boundary sync is recorded as a `beatClock`/
  `sectionIntensity` to-do outside this scene, not faked here — the
  `hold` setting is explicitly this scene's own bar-counted timer.
- Colour and hole-size range sit past/wider than the measured picture by
  request; a follow-up `/tune` pass would want to check them against
  `tools/.cache/refs/vKJu9mfeDS8/report.md` again.

## Materials

- `silk/vKJu9mfeDS8/` — measurements kept from the `/ref` bundle `vKJu9mfeDS8`: report, data, and our own shots.
The reference media for these bundles (video, frames, audio, the images built from them) stays out of this repo: in the local `tools/.cache/refs/<bundle>/` cache and the private archive (`tools/ref-archive.py`).

## Resume here

- Dev link: `npm run dev`, then `/?audio=synthetic&bpm=123#/v/silk` (123
  bpm matches the reference's measured tempo).
- `tools/ref-shoot.mjs` takes a `--size WxH` option (added for this scene,
  since the reference is 9:16 portrait against the tool's landscape
  default) — use it to regenerate `compare.png` against the reference's
  own beats.
- `tests/silk.test.ts` pins the decay-floor and no-cut-jump contracts —
  check it before touching `driver.ts`'s regime-travel or tail math.
- Gotcha: backticks inside a GLSL comment inside a `glsl.ts` template
  literal break the TS parser — keep GLSL comments backtick-free.

## History

- `#131` (2026-09-23, merged, single commit `fd21602`) — Silk: draft scene
  from the measured short vKJu9mfeDS8 (video-feedback mirror kaleidoscope),
  including the Round 2 density fix and Round 3 threads/web/colour push
  folded into the same PR.
