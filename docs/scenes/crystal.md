# Crystal Wall (`crystal`)

A camera flies down an endless corridor of near-black, chamfered slab panels
seen through a hexagonal three-mirror (p6m) kaleidoscope fold, their edges
lit white with a sparse share glowing red, a soft ice-blue light washing the
core on alternating bars. Beats swell the frame's brightness and push the
camera's travel speed; drops light a fan of spokes; a slow mood cycle decides
how much of a beat's light goes to the red strips versus the white edges.
Draft scene (in `DRAFT_SCENE_IDS`, `src/render/scenes/index.ts`), shipped on
`main` via a single merged PR.

## Where the code is

- `src/render/scenes/crystal/index.ts` — the `Scene` implementation
  (`createCrystalSceneImpl`), the `SETTINGS` array, and the three hand-rolled
  GL programs (march / blur / composite) it builds and runs each frame, since
  a multi-pass scene can't go through `fullscreenScene.ts`'s single-pass
  helper. Re-exports the driver's pure functions/types so
  `tests/crystal.test.ts` and `tests/autoTune.test.ts` only need to import
  this one module.
- `src/render/scenes/crystal/glsl.ts` — the three shader bodies as plain
  strings (no template-literal backticks inside them): `MARCH_FRAG_BODY`
  (the p6m fold, the wedge-point-to-ray conversion, the SDF primitives —
  `sdBoxCh`, `sdHexPrism`, `sdCapsule` — and the corridor's `mapFull`),
  `BLUR_FRAG` and `COMPOSITE_BODY`. Its header explains why the fold turns
  the wedge coordinate into a ray rather than a 2D drawing position, and
  names which pieces are carried over from the pre-v4 2D build (`hexLocal`/
  `polar`) versus written fresh for this scene.
- `src/render/scenes/crystal/driver.ts` — the pure sequencer
  (`advanceCrystal`, `createCrystalState`, `layerEnvelope`, `hash01`,
  `ZOOM_MID`/`ZOOM_AMP`): a wandering log-zoom/pan camera, a morph clock, a
  slow mood cycle, and four smooth light layers (`blobs`/`fan`/`red`/
  `edges`) that fade up on bar wraps, drops and beats and fade down on their
  own — plus the two accumulators the 3D rebuild added, `travel` (distance
  flown down the corridor) and `roll` (camera roll). Nothing in it is
  discrete except the light-layer *triggers*; the values it emits never jump.
- `tests/crystal.test.ts` — pins `layerEnvelope`'s attack/hold/release shape
  and, centrally, drives `advanceCrystal` through beats/bars/a drop and
  asserts the output never moves like a cut.
- Shared systems it plugs into: `resolveSceneSetting`/`autoTune.ts` for every
  setting's Auto behaviour; `sceneCommon.ts`'s `uploadCommonUniforms`/
  `COMMON_UNIFORMS_GLSL`/`SAMPLE_BANDS_GLSL`; `ctx.quality.bloomPasses` (the
  quality governor) to gate the bloom pass off entirely at the floor tier;
  `anim.onset`/`anim.dropOnset` rather than `frame.*` for triggers, because
  the render cap can skip the tick a feature fired on (see `renderLatch.ts`).
  The bloom chain itself (two-level separable Gaussian, ping-pong FBOs,
  sampler-location cache) is copied from `powder.ts`'s pattern — there is no
  shared bloom helper between the two scenes, by design (each scene owns its
  own GL code).

## References

Studied from the YouTube VJ compilation `_RsNDsibqgc`
(https://www.youtube.com/watch?v=_RsNDsibqgc), first around t=1011s, via the
`/ref` measurement loop (`.claude/commands/ref.md`). The clip is a silent VJ
loop — its audio carries no usable beat, so only the picture and its cut/fade
timing were measured; no audio-sync claim was made from it. Bundles, to be
measured in these `/ref` bundles (their media never goes in this repo):

- `tools/.cache/refs/vjwall-1011/` — the primary bundle, a 40 s window at
  1011s decoded at 15 fps with every-frame bursts around each detected
  transition.
- `tools/.cache/refs/vj-0810/`, `tools/.cache/refs/vj-1027/`,
  `tools/.cache/refs/vj-1472/` — three 10 s windows decoded at every
  source frame (30 fps), used to resolve cut-vs-fade timing precisely.

What was studied: the reference reads as a rendered 3D scene, not a flat
graphic — black, chamfered angular panels with their edges lit white, a
sparse share of edges lit red instead, a softly lit region near the axis,
depth fog fading everything to black, heavy bloom, and roughly six-fold
mirror symmetry from the camera's kaleidoscope rig, all in motion because a
camera flies through the space (never a static tile). The bright "ice" look
in some passages is the same geometry under a stronger, softer light,
readable as more defocused than the darker passages. Taken from it: the
three-mirror fold topology, the black-panel-with-lit-edge material language,
the red/white edge split, the depth fog and bloom, and the general cadence of
smooth, continuous camera motion rather than hard scene cuts. Not taken
directly: any specific panel geometry (the corridor's slabs, hex-prism core,
nut and rod are original SDF work, not traced from a frame) — see "Decisions
and pivots" for why an early flat 2D reading of this same reference was
rejected.

## Measurements

Dated 2026-09-19, from the `/ref` reports on the four bundles above (numbers
are one measurement run each, not standing specs):

- **`vjwall-1011` (40 s @ 1011s):** 2-fold rotational symmetry (r 0.98) and
  mirror symmetry across roughly six axes (r 0.98); mean brightness 0.09,
  68% dark frames, saturation 0.42; palette dominated by near-black and dark
  grey shares with a small blue-grey/azure share; motion reads as near-zero
  net zoom (mean −0.002 log-scale/s) with rotation drifting slowly
  (mean +4.4°/s) — i.e. the picture holds its scale and turns gently rather
  than punching in or out. Per visual regime: lit-object shape classes are
  dominated by "bar" and "blob" with a smaller share of "panel"/"hex ring"/
  "disc"; hue is azure-dominant (87–100% of lit area) with a red share
  (11–56%) that grows in the brighter regimes; outline stroke width holds
  around 3.8 px near the frame centre and thins or drops out toward the
  edge in several regimes; glow e-fold radius and core luminance both rise
  in the brighter regimes. Across all five regimes, object flow reads as the
  camera receding/flying backward (25–37% of tracked objects moving
  outward) rather than a flat pan.
- **`vjwall-1011` cut/fade timing:** 86 changes flagged at 15 fps over 40 s
  (median hold 33 ms) — resolved by the every-frame bursts into real
  transitions spread over 0.5–1.7 s each, none with a single frame carrying
  more than ~12% of the change; i.e. what a coarse detector sees as a burst
  of hard cuts is a cluster of smooth fades.
- **`vj-1027` (10 s @ 1027s), every-frame:** 2 hard cuts, 10 fades spread
  over 1–4 frames (33–133 ms, median 2 frames) — after the `refburst.py` fix
  described below, versus 24 "hard cuts" the unfixed counter had reported
  on the same window. Mean brightness 0.11, 56% dark frames.
- **Ours, post-v4:** per the PR body — 59 fps at quality high on Metal with
  the quality governor idle (`tools/tune-probe.mjs`'s own run reads 6 fps,
  which is its SwiftShader software renderer, not a GPU number); 90
  consecutive frames of the scene's own output run through the same
  fade-vs-cut metric used on the reference showed one smooth change with no
  frame above 2% of it, confirming the driver never produces a same-frame
  jump.

## Decisions and pivots

- **2026-09-19, v1 — one 2D texture + a flare.** First pass at the reference;
  judged far from the source material and dropped.
- **2026-09-19, v2 — hard-cut framings on beats, with black gap frames and
  strobe.** Read as the opposite of the reference, which shows smooth
  morphing between states, not cutting. Root cause: `tools/refburst.py`'s
  cut counter treated every frame over a histogram threshold as its own hard
  cut, so a 3-frame fade in the source printed as three separate "hard cuts"
  — the `vjwall-1011` window was reported at 86 "cuts" in 40 s from mostly
  multi-frame fades, and the design was built from that inflated count
  instead of the actual frames. Fixed in the same PR: `find_events` now
  groups a run of consecutive change frames into one event, calls it a hard
  cut only when one frame in the run carries a large share of the change
  *and* moves enough of the picture, and reports a change whose brighter
  side stays dark as "a change in the dark" rather than a cut; fades are
  reported with their span. On the `vj-1027` window this took the finding
  from 24 hard cuts to 2 hard cuts plus 10 fades.
- **2026-09-19, v3 — a continuous driver, but still a flat 2D SDF line
  drawing** (star/plate/chevron/web shapes) under the p6m fold. The timing
  was now right, but the picture still read as wrong — a fold that mirrors
  2D drawing coordinates can't produce shading, depth fog or a chamfer, no
  matter how the strokes are tuned.
- **2026-09-19, v4 (shipped) — rebuilt as a raymarched 3D scene.** Opening a
  full-size frame from the `vj-1027` bundle made clear the reference is a
  *rendered 3D scene*, not a vector drawing: black chamfered panels with
  lit edges, fog and bloom, mirrored by the kaleidoscope rig. The fix kept
  v3's fold math (`hexLocal`/`polar`) but turned the folded wedge point into
  a ray instead of a drawing position — a real three-mirror kaleidoscope
  tiles one wedge of a 3D object cell, so the object behind the fold needed
  to be a real one. The ray marches into a z-repeating corridor of tilted
  chamfered slab panels (three per cell, mirroring into nesting zigzag star
  rings), a hollow hex-prism core, hex-nut rings and a thin rod, each cell
  hash-rotated and hash-flagged for which edges glow red. v3's driver was
  kept verbatim and extended with `travel`/`roll` camera accumulators. Landed
  as PR #95, merged the same day.
- **2026-09-19, shading fixes on the way to v4's final look** (same PR): the
  edge-glow distance measure used `min(rim, cap)` on a hex-prism cap, which
  is zero everywhere on the cap and lit whole faces instead of edges — fixed
  to `max`; a uniform haze term added to every ray read as a grey veil
  rather than air, and was replaced with lighting the faces themselves; a
  solid object sitting on the camera axis filled the frame with one flat
  face, fixed by hollowing it and starting the march past a near plane;
  writing unscaled HDR values into an RGBA8 target clipped before the bloom
  pass could read them, fixed by halving on write and doubling on read;
  Reinhard tone-mapping stacked on an exponential with heavy glow weights
  produced dull whites and lifted blacks, settled on one shoulder plus a
  black point; mixing white and red edge colors under the ice light produced
  pink, fixed by dimming the red rather than blending toward white; the edge
  stroke width is scaled by ray distance so it holds a constant width on
  screen rather than thinning with depth.

## Tuning notes

- `SETTINGS` groups: **Form** (`tiling` — lattice cell scale; `density` —
  how much crystal fills a corridor cell, with a lower Auto value than its
  manual default so Auto keeps the corridor emptier), **Motion** (`zoom`,
  labelled "Travel" — camera wander speed, Auto keyed to tempo + loudness;
  `speed` — how fast the camera flies/rolls forward, Auto keyed to tempo +
  loudness; `pulse` — beat brightness pop and light-layer push, reads
  `feature.onset`; `flare` — overall light-layer strength, reads
  `anim.dropOnset`, Auto keyed to dynamics + loudness; `hold` — how long a
  lit layer holds before decaying, Auto keyed negatively to tempo so faster
  tracks hold shorter), **Look** (`glow` — bloom halo strength, Auto keyed to
  brightness; `neon` — red-strip strength, Auto keyed to loudness and
  negatively to brightness; `ground`, labelled "Fog" — corridor visibility
  falloff, Auto keyed to brightness).
- Internal (not exposed) tuning constants worth knowing when probing
  performance or the blur look: `MARCH_SCALE` (pass-1 raymarch target
  resolution as a fraction of the drawing buffer — its own comment says to
  drop it, alongside `MAX_MARCH_STEPS` in `glsl.ts`, if
  `tools/tune-probe.mjs` reports under 50 fps at quality high) and
  `BLUR_STRIDE` (bloom blur tap stride in source texels — tuned separately
  from Powder's own `BLUR_STRIDE` since the two scenes' blur passes run at
  different relative resolutions).
- Bloom is skipped entirely when `ctx.quality.bloomPasses` is 0 (the floor
  quality tier) or when the Glow setting resolves near zero — the composite
  pass forces both glow contributions to exactly 0 in that case rather than
  sampling glow targets that were never rendered into this frame.
- Under a lit ("ice") layer the composite blends toward the blurred bloom
  levels and away from the sharp pass (`uSharpW`/`uGA`/`uGB` in
  `render()`), so the picture visibly defocuses — matching the reference's
  bright regimes, which read as softer than its dark ones.
- `tools/tune-probe.mjs` runs on a software (SwiftShader) renderer — its fps
  reading is not a GPU number; verify real frame rate with a
  hardware-accelerated headless run instead (a Metal-flag Playwright/Chromium
  launch was used to get the 59 fps quality-high figure above).
- Judge the look with before/after screenshot sheets and a side-by-side
  comparison against reference frames rather than by eye alone — that is how
  the shading bugs above were found and confirmed fixed.

## Known issues and next steps

- The ice light still reads as lit faces rather than the reference's fully
  soft, textured blobs.
- The reference's panels carry finer surface decoration than the scene's
  slabs, which are plain chamfered boxes.
- No dedicated `noiseHash.ts`-lattice noise is used here (the corridor's
  per-cell variation comes from `hash11`/`hash01`, not a hashed noise
  lattice), so the mobile-seam concerns that header covers don't apply to
  this scene.

## Materials

- `crystal/vjwall-1011/` — measurements kept from the `/ref` bundle `vjwall-1011` (primary): report, data, and our own shots.
- `crystal/vj-0810/` — measurements kept from the `/ref` bundle `vj-0810`: report, data, and our own shots.
- `crystal/vj-1027/` — measurements kept from the `/ref` bundle `vj-1027` (also holds contact sheets of our earlier and v4 builds): report, data, and our own shots.
- `crystal/vj-1472/` — measurements kept from the `/ref` bundle `vj-1472`: report, data, and our own shots.
The reference media for these bundles (video, frames, audio, the images built from them) stays out of this repo: in the local `tools/.cache/refs/<bundle>/` cache and the private archive (`tools/ref-archive.py`).

## Resume here

- Dev link: `npm run dev`, then
  `/?audio=synthetic&bpm=120#/v/crystal` (query before the hash).
- To re-measure or extend the reference: the `/ref` workflow
  (`.claude/commands/ref.md`) regenerates a bundle's `report.md`;
  `tools/refburst.py`'s `find_events` (event-grouped, magnitude-gated cut
  detection, with fades reported by span) is the fix to rely on for any
  future cut-vs-fade read from this or another silent VJ reference — don't
  trust a raw histogram-threshold frame count.
- Before trusting a look change, shoot a before/after sheet and a
  side-by-side comparison against the reference frames rather than judging
  from the live view alone; that workflow caught the edge/haze/black-point
  shading bugs above.
- Gotcha: this scene's history shows `scenes/index.ts` and
  `tuning/VOCAB.md` (append-only lists) as the files most likely to conflict
  on a rebase against a fast-moving `main` — resolve by keeping both sides'
  entries unless one side is an import-path change that collides with
  another scene's new import.
- Gotcha: `tools/tune-probe.mjs`'s fps reading is from a software renderer
  and understates real performance by an order of magnitude — don't tune
  `MARCH_SCALE`/`MAX_MARCH_STEPS` against it directly.

## History

- `#95` / `40fb25e` (2026-09-19, merged) — "Crystal Wall: a raymarched 3D
  crystal corridor seen through a kaleidoscope, from a measured LED-wall VJ
  loop (/ref); ref tools tell a fade from a cut." One squashed commit
  carrying the scene's full v1–v4 history (see "Decisions and pivots")
  plus the `tools/refburst.py` cut/fade fix. Still listed in
  `DRAFT_SCENE_IDS` on `main`.
