# Tessera (`tessera`)

A static 3D lattice of small hollow boxes standing on a sphere, whose lengths
pulse with the spectrum every frame while the camera dollies on the pole axis
between "outside the ball" (a scalloped dome) and "right above the pole" (a
starburst of box walls converging on a white pole box) — one geometry, the
camera makes the regimes. Draft scene, merged to main.

## Where the code is

- `src/render/scenes/tessera/lattice.ts` — the pure math, mirrored in
  `glsl.ts`'s vertex shader and pinned by `tests/tessera.test.ts`:
  `latticeLayout` (constant-arc-length ring spacing so box count grows with
  radius, keeping boxes roughly equal-sized out to the pole rather than
  shrinking to slivers), `instanceRingSlot`/the `gl_InstanceID` decode
  (the last instance is a fixed white pole box, not part of the grid),
  `cameraBasis`/`camDistanceForDolly`/`effectiveDolly`/`focalFromFovDeg`
  (a pole-axis-only camera — distance and roll about a fixed forward, no
  yaw/pitch setting exists), `advanceHueClock`/`createHueClockState`
  (holds in quiet passages, sweeps in loud ones, rides `anim.barPhase` once
  `anim.tempoLock` is high and the rate is already fast), `screenBallRadius`,
  `shellVisibility`, `BALL_RADIUS`/`SHELL_RADIUS`/`MAX_RINGS`.
- `src/render/scenes/tessera/glsl.ts` — `boxVert`/`boxFrag` (an
  inner/outer-face test giving dark tube interiors with lit mouth-frame
  rims; `BOX_VERTS` covers the long-wall faces plus end-cap-strip faces —
  the end caps exist because a box viewed close to end-on, which is
  most of the lattice near the pole-axis camera, would otherwise vanish
  edge-on), `bgFrag` (the dim backdrop shell), `BLUR_FRAG`/`compositeFrag`,
  `BLOOM_THRESHOLD`, `BLUR_STRIDE_X`/`BLUR_STRIDE_Y`.
- `src/render/scenes/tessera/index.ts` — the `Scene` (id `"tessera"`),
  `SETTINGS` (Form: Pitch/Folds/Swirl/Fill/Wall/Base length/Length
  reactivity/Jitter; Motion: Spin/Drift/Hue rate; Look: Pastel/Iridescence/
  Rim/Axis cross/Backdrop shell), and `render()` following `shards/index.ts`'s
  idioms: an empty VAO decoded entirely from `gl_InstanceID`/`gl_VertexID`
  (no per-instance upload, the same trick as `ambience.ts`'s `DOT_VERT`), a
  full-res sharp target with its own depth renderbuffer plus a half-res
  two-pass blur for the halo, hand-cached sampler locations, and the
  GL-state restore block at the end (the gallery shares one context across
  every scene's tile).
- `tests/tessera.test.ts` — layout and instance decode, lobe/hue symmetry,
  the dolly cycle, the hue clock, the camera projection.
- Each ring reads a spectrum band continuously off `uBands` (pole = lows,
  limb = highs, via `sampleBands` on the ring's own `theta`/`RING_THETA_MAX`
  fraction) — no onset flash anywhere, matching the reference's continuous,
  no-beat-rank-preference activity.

## References

Studied from a YouTube short, video id `lZaThcqs-dk`
(https://www.youtube.com/watch?v=lZaThcqs-dk), 30 s measured via `/ref`.
`/ref` bundle: `tools/.cache/refs/lZaThcqs-dk/`.

What was taken from it: a static lattice of small hollow boxes over a sphere,
seen from the pole axis, whose lengths (not positions) change frame to frame;
a continuous camera push/pull that alone produces the dome-vs-starburst
regime change; no onset flash, no beat-rank preference, no regime change at
audio-section boundaries; a slow, roughly bar-synced hue sweep late in the
clip.

## Measurements

The persisted bundle report (`tools/.cache/refs/lZaThcqs-dk/report.md`)
captures the *first* scan, made before this PR's temporal `/ref` tooling
(slit-scan, full-rate bursts, motion tiles) existed; a rescan during the PR
using those tools corrected its reading (see Decisions and pivots). The
first scan's per-frame picture composition still stands, only its motion
interpretation was revised:

- 4 visual regimes across the 30 s clip (37%/27%/18%/16%/2% by share), each
  read on a 360×640 frame: 154–495 lit objects per frame, mostly blob/bar/
  panel/disc; lit-pixel share 20–45%; ground pure black (`#000000`) in every
  regime; hue dominated by yellow 60° (37–91% depending on regime), with
  orange/chartreuse/spring/blue/cyan minorities in later regimes; 2-fold
  rotational symmetry (r 0.92–0.99) and 3 mirror axes at r 0.31 (weak);
  object flow direction varies by regime (outward in one, camera-approach in
  another, backward-receding in a third) — later read as an artifact of the
  camera push/pull rather than distinct flow regimes.
- No beat-rank preference (activity z -0.18..+0.07 across ranks); a weak
  cut-vs-high-band correlation (r +0.20, +266 ms) was the only one clearing
  the noise threshold; activity/brightness/zoom-speed all read continuous
  across the beat (contrast 0.08–0.43σ, well below a "pulsed" reading); one
  strobe stretch at t≈26.0s (0.27 s period, ≈0.5 beat); 7 single transitions,
  none on an onset-carrying beat; 0/3 audio section boundaries produced a
  picture-regime change.
- Our analyser fired onsets on 24/26 rank-1 beats and 13/13 rank-2 beats in
  this sample run; tempo tracked at ×1 for 74% of the clip (median 120.1 vs.
  reference 117.5).
- PR #111 recorded that near-view brightness, lit fraction and saturation
  were tuned to match values measured from the reference frames, and that a
  same-beat comparison sheet (`tools/ref-shoot.mjs`) was generated into the
  bundle's own `ours-tessera/` subfolder.

## Decisions and pivots

- **First build (rejected):** modelled the reference as flat 2D tiles
  flowing inward toward the centre. Judged far from the source material and
  its motion unconvincing as physics. The scan behind this build predated the
  temporal `/ref` tools, so its "flat pattern" size law and streak
  elongation readings were actually box ends and walls seen in perspective,
  not a flow.
- **2026-09-20, PR #111 (merged, `8d8f089`):** wholesale rebuild after a
  rescan with the current `/ref` tooling. The mean-projection view kept crisp
  spokes and an axis cross while the frame-difference view showed fringing
  only at box ends: positions are fixed, only box lengths (and the sweeping
  hue) change frame to frame — nothing flows inward. Shipped as a static
  instanced lattice with per-ring band-driven length, a pole-axis dolly
  camera, and a hue clock riding section intensity / bar phase.
- **Round 2 (same PR):** the first lattice held a constant slot count per
  ring, which shrinks boxes to slivers near the pole (the `sin(theta)`
  azimuthal-pitch factor) and leaves outer rings sparse — read as "thin
  wiry radial spokes, a black hole around the pole". Measured that the
  reference's own angular box count *grows* with radius (roughly 24/40/60/84
  boxes at increasing screen radii). Fixed via `latticeLayout`'s
  constant-arc-length spacing; camera/box sizing (`CAM_NEAR`, `lenBase`/
  `lenAudio`, Fill) shrank to match the now much smaller, more numerous
  boxes.
- **Round 5 (same PR, tuning):** `pitch` default raised so the resting
  (silent) lobe shells stay visibly 8-scalloped even without audio; `fill`
  default lowered below the visually-expected value because neighbouring
  boxes' own dark interior faces were crowding out and dimming each other's
  bright rims at oblique angles; `wall` default raised to 0.35 so a box's
  mouth reads as a narrow dark slit in a bright bar (matching burst
  captures) rather than a wide dark hole in a thin frame.

## Tuning notes

- The reference has no onset flash and no beat-rank preference — resist the
  urge to add a beat-triggered pulse; the shipped drive (continuous
  per-ring band length, lobe-shaped, small per-frame end jitter) already
  matches the measured continuity.
- `hueRate` scales with loudness/dynamics but locks to one wheel-turn per
  bar once `anim.tempoLock` is high and the rate is already in its fast
  regime — this is `advanceHueClock`'s job, not a setting to fight.
- `drift` (boolean) runs the camera dolly as a free-running cycle instead of
  holding at the `Dolly`-equivalent static setting — both the dolly and
  `spin` (camera roll) are timers in the reference, never audio-locked (0/3
  section-boundary regime changes measured).
- `fill` and `wall` interact: raising `fill` too far crowds neighbouring
  boxes' dark interior faces into each other at oblique (mid/far) viewing
  angles, dimming the picture; the shipped default trades some of the
  "expected" density for readability.

## Known issues and next steps

- Tube walls read thinner than the reference's — the reference's mouths are
  a thin dark slit in a bright bar; the current build's mouths are wider and
  dark enough to visibly darken the mid/far views.
- The far view lacks the reference's overlapping scalloped petal shells;
  the current build reads as a tiled ball with hue sectors instead.
- The reference's boxes are smaller and more numerous up close, with longer
  trailing walls, than the current lattice produces.

## Resume here

- Dev link: `npm run dev`, then `/?audio=synthetic&bpm=118#/v/tessera` (118
  bpm rounds the reference's measured 117.5).
- `tools/ref-shoot.mjs` reproduces the same-beat comparison sheet against
  `tools/.cache/refs/lZaThcqs-dk/`; a prior run's output sits in that
  bundle's own `ours-tessera/` subfolder.
- `tests/tessera.test.ts` pins the lattice layout/decode, lobe/hue symmetry,
  dolly cycle, hue clock and camera projection — check it before touching
  `lattice.ts`.
- Gotcha: the bundle's persisted `report.md` reflects the pre-rebuild scan
  (flat-pattern / streak readings that turned out to be perspective
  artifacts, not flow) — a rescan with slit-scan/burst/motion-tile analysis
  during the PR is what actually confirmed "lattice fixed, only box lengths
  change"; don't re-derive conclusions from the persisted report's size-law
  or flow lines without re-running the temporal tools.

## History

- `8d8f089` / PR #111 (merged 2026-09-20) — "Tessera: draft scene from the
  measured short lZaThcqs-dk (a 3D lattice of hollow boxes on a sphere)".
  Single squashed commit covering the flat-tile rejection, the lattice
  rebuild, and the round 2/round 5 tuning passes.
