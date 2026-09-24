# Storm (`storm`)

A morphing storm cloud struck by lightning on every beat: a jagged branched
bolt fires on the beat in every mode, and the cloud itself is lit from
inside by the same strike. Five render modes (`MODES`) share one strike
pool and one shape — Filaments (hair-thin curl-noise strands, the default),
Mesh (a wireframe surface-nets lattice), Gas (the raymarched volumetric
cloud), Voxel (the same march quantized/posterized), Points (a calm additive
point cloud). Draft scene, on main.

## Where the code is

- `src/render/scenes/storm.ts` — the whole scene (~3800 lines). The file
  header is the primary source: cloud density model (baked lobe silhouettes
  eroded by tileable perlin-worley 3D noise), the strike pool and bolt-tree
  geometry, the per-mode geometry passes, `gasType` recipes (`GAS_RECIPES`),
  the Voronoi "dark sections" system (`cellIndexAt`/`sectionGain`), and the
  morph-phase accumulator (`advanceMorphPhase`) that walks the cloud across
  its baked shape variants (`SHAPE_VARIANTS`).
- Shares `PALETTE_GLSL`, `COMMON_UNIFORMS_GLSL`, `ROOM_UV_GLSL`,
  `SAMPLE_BANDS_GLSL` from `sceneCommon.ts` and `resolveSceneSetting` from
  `autoTune.ts` like other scenes; does not import `noiseHash.ts` (its own
  3D noise volumes are baked textures, not a live-hashed lattice, so the
  mobile-seam bug that fix addresses doesn't apply here).
- Pure, tested helpers in `tests/storm.test.ts`: `buildLobes`/`buildLobeSets`,
  `buildNoiseVolume`, `buildShapeVolume`, `buildFlowVolume` (Filaments'
  curl field), `buildSurfaceNet` (Mesh), `buildCloud`/`filamentStrandCount`
  (Points/Filaments budgets), `buildBoltTree` and the `BOLT_*` sizing
  constants (the branched-ribbon bolt geometry), `createStrikePool`,
  `advanceMorphPhase`, `buildCellSites`/`cellIndexAt`/`cellWarp`/
  `createCellGlow`/`CELL_DECAY_TAU` (dark sections), `createRng`.
- `mode` (`SETTINGS`, key `"mode"`) selects among `MODES`; other groups cover
  shape/morph, spectrum-to-light mapping (`spectrumMap`: Off/Screen/Cloud),
  gas type, ambient floor, bolt look, flow (Filaments-only), and `sections`.

### The render-cap one-shot workaround (still present, now redundant)

The scene's header documents its own local fix for a loop-level bug found
while building it: beats are detected as *rises* in `anim.beatPulse` /
`lowPulse` / `dropPulse` rather than read from the one-shot flags
(`frame.onset`, `anim.lowOnset`, `anim.dropOnset`), and the strike pool ages
itself on the scene's own measured render interval rather than `anim.dtSec`
— because at the time, `app.ts`/`tv.ts` advanced the anim clock every rAF
tick while `scene.render()` was rate-capped (`framePace.ts`), so a one-shot
landing on a skipped tick never reached any scene, and `dtSec` was the tick
interval, not the time since the scene last drew. That loop-level bug is now
fixed generally by `src/render/renderLatch.ts` (`accumulate()`/`consume()`,
landed alongside the `frame.beat` → `frame.onset` rename and the flux-trigger
change), which latches every one-shot across skipped ticks and hands the
scene a real render-dt. **Storm's own header says its local pulse-rise/own-dt
workaround is "redundant in principle" now that renderLatch.ts exists** — it
still behaves correctly (a pulse that has risen since the last draw can't be
missed, whichever tick it rose on) and was deliberately kept rather than
removed at the time, pending the scene settling. As of this record it has
not been simplified onto the shared latch.

## References

Studied, not copied, across two look references:
- v3 (the shipped Mesh/Voxel/Gas/Points shape): general digital-VJ
  wireframe/voxel taste, not a single traced video.
- v5's Filaments mode and its near-dark "ember" ambient floor: a
  TouchDesigner curl-noise particle-strand short, watched frame by frame
  (no `/ref` bundle — the scene predates that workflow; frames were
  pulled ad hoc with `yt-dlp`/`ffmpeg`).

## Decisions and pivots

- 2026-08-30 (#41, v1) — first attempt: a `gl.POINTS` cloud of particles lit
  by lightning. Read as not photoreal enough; replaced with a volumetric
  raymarch (baked lobe-shape × perlin-worley 3D noise textures).
- 2026-08-30 (#41, v2) — added a Mode picker (Gas/Particles/Both) and
  Cloud/Swarm/Sparks particle styles. Swarm was rejected outright; direction
  shifted toward a "digital" look (mesh or texture) with a visible,
  beat-connected strike and a shape that changes on a parameter.
- 2026-08-30 (#41, v3, shipped as the initial merge) — Mode leads with
  **Mesh** (surface-nets wireframe lattice, `buildSurfaceNet`) and
  **Voxel** (quantized/posterized march); Gas and a calm Points mode kept;
  Swarm/Sparks removed. Every strike draws a jagged bolt polyline
  (`buildBoltPath`) riding `uBeatPulse`. `cloudShape` morphs among baked
  shape variants via `shapePhaseWeights`. `minQuality: "low"`. Three
  candidate optimizations (baked-fbm channel, live-strike loop guard,
  shape-only early-out) were implemented, measured with a readPixels
  GPU-cost harness at 4K/8K, found to be no-wins (the march is step-bound,
  not fetch-bound) and reverted.
- 2026-08-30 (#41) — the render-cap one-shot bug (see above) was discovered
  during this build and worked around locally; the general fix
  (`renderLatch.ts`) was flagged as still owed at the loop level.
- 2026-08-31 (#41, v4) — `morphSpeed`/`morphBeat` given a proper accumulated
  phase (not elapsed time scaled by a live rate — the same trap
  `caustics.ts`'s `driftPhase` avoids); `spectrumMap` (Off/Screen/Cloud) and
  `spectrumGlow` added, verified by luminance-thirds analysis; lighting pass
  gained Henyey-Greenstein forward scattering, a differential one-tap strike
  shadow, and a shared `flashTint` ramp (white core → storm blue → violet
  fringe) across every mode.
- 2026-09-01 (#41, v5) — built against the TouchDesigner reference short:
  **Filaments** mode added and made default (`buildFlowVolume`, a baked
  tileable curl field; strands drawn as additive `gl.LINES`, masked by the
  shape volume so morphing eats the tangle with no CPU rebuild; a dimmed
  gas underlay stood in for bloom). Every resting-light floor now slides to
  near-black below the `ambient` setting's default (`AMBIENT_LIFT_GLSL`,
  bit-identical at/above default) while strike light stays independent of
  it, so a strike reveals an otherwise near-invisible "ember" cloud.
  `gasType` enum added (`GAS_RECIPES`: Cumulus identity, Wisp, Smoke,
  Nebula) — uniform-only recipes so Cumulus stays bit-identical to pre-v5
  defaults.
- 2026-09-02 (#41, v6) — direct feedback on v5: the Filaments gas underlay
  was removed entirely (pure strands over the flat background, full bolt
  bloom, like Mesh/Points); bolts became **branched ribbons**
  (`buildBoltTree`: a longer main channel plus jagged side branches and one
  fork level, drawn as a single tapered `TRIANGLE_STRIP`, `bolt` slider now
  also driving width/branchiness); a new **dark sections** system
  (`sections` slider) partitions the cloud into a warped, Lloyd-relaxed
  Voronoi (`cellIndexAt`/`SECTION_GLSL`) whose cells light on beat rises,
  mid/high rises, and along each strike's own channel, gain applied to
  resting light only so the flash itself stays section-independent.
- 2026-09-02 (post-v6 fix, `aa06431`) — user-reported "something is weird
  with how lightning reacts to sounds" traced to `sectionIntensity.ts`, not
  this scene: `dropOnset` was a level (true on every tick a rise exceeded a
  rate threshold) rather than the one-shot edge its own doc promised, so a
  verse→chorus swell on real music held it true for many consecutive
  frames and Storm's forced `STRIKE_DROP_BURST` (which bypasses the
  refractory by design) fired repeatedly, machine-gunning bolts and
  slamming every dark section lit at once. The synthetic feed's steady
  energy never entered that regime, which is why headless verification
  missed it. Fixed at the source with a latched edge and release
  hysteresis (`wasAbove`, the same idiom `bandEnergy.ts` uses); Caustics
  and Dancers, which also consume `dropOnset` per-event, benefited from the
  same fix.
- 2026-09-03 (#69) — setting groups joined the shared cross-scene
  `SettingGroup` vocabulary; no behavior change.

## Tuning notes

- Judge Filaments (the default) at rest first — a near-dark ember cloud —
  then on a strike, which should visibly reveal mass that wasn't apparent
  before; `ambient` near 0 is the intended "revealed by lightning" look,
  matching the TouchDesigner reference's faint resting puffs.
- The bolt tree's `bolt` slider spans a bare thin channel to a thick forked
  tree; branch geometry is always generated and only faded by width and
  brightness, so the vertex budget is paid even at `bolt = 0`.
- `sections` reads weakest in Filaments below roughly the low third of its
  range, since Filaments' resting light is faint to begin with; cells are
  fixed in cloud space, so the swirl carries a lit region across the frame
  rather than the section itself moving.
- `gasType`'s Cumulus entry is arithmetic identity, not a value that merely
  happens to match — the deliberate zero-cost default. `flow` only applies
  to Filaments.
- Verification history leaned on beat-synced headless screenshots (Playwright)
  and synthetic audio; the post-v6 `dropOnset` bug specifically was invisible
  to synthetic-feed testing because the synthetic feed's steady energy never
  produces the sustained-rise condition real section swells do — any future
  "reacts strangely to real music" report on this scene should be checked
  against the shared envelope trackers (`sectionIntensity.ts`, `bandEnergy.ts`)
  before assuming a bug local to `storm.ts`.

## Known issues and next steps

- The render-cap one-shot workaround described above is still present and
  correct but redundant now that `renderLatch.ts` exists; simplifying Storm
  onto the shared latch was deferred until the scene settles and has not
  been done.
- Known rough edges carried from v5/v6: Voxel + the Wisp gas type reads
  sparse through the posterizer; Points has no ember effect at
  `ambient = 0` (its resting-light term was already floorless, predating
  the v5 ambient-lift work); a long bolt occasionally extends just outside
  the visible cloud silhouette (the bounding ellipsoid is wider than the
  lobes; kept deliberately — it reads as lightning leaving the cloud).
- Not yet judged on real music as of the PR — tuning was done by eye
  against `?audio=synthetic`; the post-v6 `dropOnset` fix was itself found
  from a real-music report, so a further real-music pass is worth
  prioritizing over synthetic-only tuning here.
- Deferred by explicit scope decision during v5: true transform-feedback
  particle advection for Filaments, and a repo-wide bloom pass (Storm fakes
  bloom locally with a tighter second in-scattered lobe and, in v5, briefly,
  a dimmed gas underlay since removed in v6).

## Resume here

- `npm run dev`, then open the scene directly:
  `/?audio=synthetic&bpm=120#/v/storm` (query before the hash).
- Beat-synced screenshots need to land on-beat, not just at a fixed delay
  after start — burst at a fixed interval drifts against the beat; wait for
  a beat-fired signal in-page and capture at a few small delays after it.
- `tests/storm.test.ts` exercises the pure helpers (lobes, noise/flow/shape
  volume builders, bolt-tree geometry, strike pool, morph phase, cell
  sites/glow) without a GL context — check it before touching any exported
  constant.
- `flow` and `meshGrid`'s own `flow` setting key collided in
  `tests/overrides.test.ts` once Storm added its own `flow` slider (v5) —
  that test now keys one scene id per row; keep that in mind before adding
  another cross-scene-colliding setting key.
- Any real-music report of "reacts strangely to sound" should first be
  checked against `sectionIntensity.ts`/`bandEnergy.ts` (see the post-v6 fix
  above) before assuming the bug is local to this file.

## History

- `#41` / `368fac2` (2026-09-02, merged) — Storm scene: a digital storm
  cloud — Mesh/Voxel/Gas/Points, struck by beat lightning. Contains the full
  v1→v6 iteration and the post-v6 `dropOnset` latch fix, squashed into one
  merge.
- `#69` / `88aab06` (2026-09-03) — setting groups joined the shared
  cross-scene vocabulary.
