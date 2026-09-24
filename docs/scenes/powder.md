# Powder (`powder`)

Coloured powder thrown into a dark room: a GPU particle cloud with real
momentum — grains carry velocity, are dragged by air, pulled by gravity,
churned by curl-noise wind, thrown by directed burst plumes on the bass,
bounced off the floor and walls, and gathered back toward the middle when
the music goes quiet. A handful of chunky cubes ride the biggest hits. Draft
scene (`DRAFT_SCENE_IDS`), on `origin/main`.

## Where the code is

- `src/render/scenes/powder.ts` — the whole scene. Its header is the primary
  source: the packing scheme across the four MRT RGBA8 attachments
  (`uPosXY`, `uPosZW`, `uVelXY`, `uVelZW`, via `packAxisR`/`unpackAxisR`),
  the stateless chunk-cube pool (a JS pool of `(t0, strength, seed, origin,
  axis)`, arcs evaluated analytically in the vertex shader), the confinement
  model (`CONFINE_BASE`/`CONFINE_ACCEL` — a weak everywhere-spring plus a
  stiff edge one, so the cloud doesn't diffuse into an even haze), the
  rotating-air-mass drag (not a constant torque, which would spin the cloud
  into a disc), and the per-scene half-resolution additive bloom with a
  per-channel Reinhard rolloff on composite.
- Contrasts itself explicitly against `chladni.ts` in its own header: Powder
  is a 3D volume with inertia, Chladni a 2D inertia-less field.
- Pure, tested helpers exported from `powder.ts`: `createBurstPool`,
  `createBigHitDetector`, `createChunkPool`, `createHueDrift`,
  `attractorPositions`, `pointSizing`, `sparseSizeScale`, `calmTarget`.
- Imports `grainTextureSide`/`REFERENCE_GRAINS` from `chladni.ts` (shared
  particle-texture sizing) and the room/common-uniform helpers from
  `sceneCommon.ts`.
- Triggers are rises in the decaying pulses (`anim.lowPulse`/`dropPulse`),
  not the one-shot onset flags alone — see the header's note on
  `src/render/renderLatch.ts` for why (frame-pace capping drops roughly half
  of a one-shot flag on a 120 Hz display).
- Tests: `tests/powder.test.ts` covers the pure helpers (packing, the burst
  pool, the big-hit detector, the chunk pool, hue drift, sizing).

## References

Studied from a UE4 "audio visualizer" short set to a Fatboy Slim remix
(YouTube video id `GwEVyS-JW2s`, channel leomediaart): a dense powder cloud
in a dark room, pale/ice-blue bulk, a hot coral-red core and patches, ragged
shells thrown outward on bass hits. Reference frames were pulled ad hoc with
`yt-dlp` and ffmpeg contact sheets, predating the repo's later
`/ref` bundle workflow, so no bundle name is recorded for it.

## Decisions and pivots

- **2026-09-03 (PR #75, closed, not merged) — Plume:** a first build from
  the same UE4 reference, on a separate branch (`worktree-plume-scene`),
  reached its own draft PR and typecheck/test-clean state but its PR was
  closed without merging. Plume extended Chladni's ping-pong RGBA8 state to
  3D position + velocity via three MRT attachments, and its central finding
  was that forces alone (curl noise + spring + damping) only make a uniform
  ball — divergence-free curl flow can't create structure, so
  **emission**-driven death/rebirth (`churn`) with a directional per-beat
  burst was what produced the reference's lobed splatter; it also settled
  on partially opaque premultiplied lit square sprites over additive points,
  since additive points wash out to fog in a dense core. This code never
  landed on main; Powder was built independently from it, from the same
  reference and some of the same lessons (emission over pure force,
  opaque/lit shading over additive), but with its own architecture — the two
  are not the same codebase, and Powder does not import from or extend
  `plume.ts`.
- **2026-09-04 (#77, merged) — Powder v1:** built from Chladni's ping-pong
  RGBA8 / MRT architecture directly (two attachments: xy + z-and-heat), no
  stored velocity — a JS "shove" impulse envelope plus a spring gave
  coast-then-settle instead. Independent curl/value noise (no third-party
  code ported). First pass read as a uniform grey fuzzball because the
  spring dominated the curl; the fix was a tapered pull with a free zone
  near each particle's home, curl made dominant, a low-frequency lobe warp
  on the rest position, and a coherent low-frequency heat field (rather than
  per-particle noise) for the hot/cold split — the single biggest visual
  change was widening the trilinear value noise so its low-amplitude output
  actually crossed visible thresholds. The big-hit detector's original
  level-vs-baseline test never fired on real music; replaced with a
  `lowPulse` rise gated on `sectionIntensity` inside a loud section, with a
  refractory window.
- **2026-09-04 — Powder v2/v3:** feedback that the reference's particle
  physics and club-scale complexity weren't coming through led to a rebuild
  of the state itself — a true velocity field across four RGBA8 MRT
  attachments (matching the header's `uPosXY`/`uPosZW`/`uVelXY`/`uVelZW`
  layout), with drag, curl force, directed plumes, vortex rings, gravity and
  buoyancy, floor/wall collisions and re-emission, and a soft lumpy
  confinement around wandering attractors (`attractorPositions`,
  `MAX_ATTRACTORS`) replacing a single spherical spring, which had produced
  a balloon with a bright skin. Added per-scene half-res bloom, camera
  push/shake, and a bounded hue-drift model (`createHueDrift`,
  `HUE_DROP_EXCURSION`, `HUE_RELAX_TAU`) after unbounded cumulative hue
  drift wandered the palette off in well under a minute.

## Tuning notes

- Shove/curl fall off with distance so a drop never slams the whole cloud
  into the confinement clamp — an earlier version of that clamp produced a
  visible square silhouette.
- The governor's low `renderScale` blew the cloud out to white at one point;
  sprite size is now derived from `drawingBufferHeight` relative to a fixed
  reference height rather than assumed constant.
- The big-hit refractory (`BIG_HIT_REFRACTORY_SEC`) and thresholds
  (`BIG_HIT_PULSE_MIN`, `BIG_HIT_SECTION_MIN`) were tuned against one
  140 BPM track; expect them to fire off-cadence on much slower material.
- Verify with a real fed-in track, not just synthetic audio — synthetic
  audio doesn't reliably exercise the big-hit / chunk-burst path.
- Sparse tiers grow sprite size (`sparseSizeScale`, `pointSizing`) rather
  than brightness to hold apparent coverage constant as particle count
  drops with quality tier.

## Known issues and next steps

- The first few seconds after load are the weakest stretch — the seeded
  ball needs to be stirred by the sim before lobes and hot patches separate
  out.
- Cube bursts spray in a fairly wide ring rather than the reference's more
  directional plume.
- No true post-process bloom pass exists in the repo; the additive
  half-res blur in `powder.ts` fakes it per-scene.
- Real-music judgement across more tracks (beyond the one used for the big
  hit detector) is still owed.
- Still a draft scene; not promoted to featured.

## Resume here

- `npm run dev`, then open the scene directly:
  `/?audio=synthetic&bpm=120#/v/powder` (query before the hash), or feed a
  real track through a fake mic to exercise the big-hit/chunk-burst path —
  synthetic audio alone under-exercises it.
- Useful probes: `?quality=floor` for the cheapest tier, and a beat-synced
  frame capture around a drop to check chunk bursts and hue excursion decay.
- Gotcha carried over from tuning: the quality governor changes
  `renderScale` at runtime, so anything sizing sprites off the drawing
  buffer must read it every frame, not cache it from init — `powder.ts`
  already does this; keep it that way in any follow-up.

## History

- `#75` (`ba8ab47`, 2026-09-03, **closed, not merged**) — Plume: an earlier,
  separate build from the same UE4 reference; superseded by Powder rather
  than merged.
- `#77` (`6cfdf04`, 2026-09-04) — Powder: GPU powder cloud, Chladni-derived
  MRT architecture, shove+spring v1 then a velocity-field v2/v3 rewrite,
  stateless chunk cubes, per-scene bloom. Merged as a draft scene.
