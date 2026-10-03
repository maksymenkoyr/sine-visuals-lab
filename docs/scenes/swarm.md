# Entropic Collapse (`swarm`)

A few hundred particles, each with a position and a phase, drawn as a graph of
thin additive lines between near neighbours on pure black. They fall from a
scattered net into one body: a dense white core of in-sync particles that
breathes on the beat, inside a thin ring of out-of-sync "drifter" particles
coloured by how far their phase is from the core's. A hit scrambles phases (the
core loosens, then re-syncs), loudness adds phase jitter, and a drop throws the
whole swarm back out so it collapses again. Draft; on its own branch, not yet
on main.

## Where the code is

- `src/render/scenes/swarm/swarmSim.ts` is the whole simulation, pure (no GL,
  no DOM): `createSwarm`, `stepSwarm`, `scatterPhases` (a hit), `rescatter` (a
  drop), `collapseTrap` (the collapse ramp), `collectEdges`/`phaseOffsets`
  (what the draw reads) and `swarmMetrics`. Its header says the model;
  `DEFAULT_SWARM_PARAMS` holds the tuned constants.
- `src/render/scenes/swarm/index.ts` is the scene: `SETTINGS`, the drive reads
  (`drives.value` for Breath and Heat, `drives.fired` for Scatter and
  Re-collapse), the fixed-step loop, framing, `TIER_PARTICLES`.
- `src/render/scenes/swarm/glsl.ts` is the two programs (instanced edge quads,
  instanced node sprites) and the phase ramp.
- `tests/swarmSim.test.ts` pins the look's invariants (a locked share, the rim
  radius, the core contracting on the beat) and the determinism, momentum and
  hit behaviour.
- Plugs into: drives (`src/render/drives.ts`), the quality preset for the
  default particle count (`src/render/quality.ts`). No float target, no bloom:
  the tone curve lives in the blend (see the glsl.ts header).

## References

<!-- TODO(opus): references + measurements -->

## Measurements

<!-- TODO(opus): references + measurements -->

## Decisions and pivots

<!-- TODO(opus): references + measurements -->

- 2026-10-03: ported from the numpy prototype (kept in the `entropic-collapse`
  `/ref` bundle's `scripts/proto.py`, mode 3) unchanged, with pair forces made
  equal and opposite so the pair loop runs over i < j. The prototype's instant
  trap collapses in about 2 s, so the trap now ramps up over several seconds
  (`collapseTrap`) -- the reference's collapse is far slower.
- 2026-10-03: no float render target exists in this repo (RGBA8 only, see
  `chladni.ts`'s header), so lines draw straight to the screen with a screen
  blend (ONE, ONE_MINUS_SRC_COLOR) on `1 - exp(-TONE * c)`, which accumulates
  exactly like a soft tone curve.
- 2026-10-03: Scatter's default fell from the plan's 0.35 to 0.12. On the
  synthetic 128 bpm feed a hit lands every half second, the lock average takes
  about that long to follow, so 0.35 kept every phase scrambled and the core
  never formed (a uniform pink disc); 0.1 keeps a clear core.
- Breath's default drive is the plain Beat wave, one swing per beat.
  `DriveSource.every` cannot be set from a setting's own `drive.default`, so the
  reference's slower breath (about two beats) is a pick in the panel for now.

## Tuning notes

- The settings that shape the picture: Sync (phase coupling, how much of the
  swarm locks), Drifters (spread of natural rates, the rim's thickness),
  Breath, Scatter, Heat, Damping.
- Particles follows the quality preset until moved (`TIER_PARTICLES`); the
  sim cost grows with the square of the count, so keep an eye on the high
  counts on weak machines.
- Judge the collapse from a fresh load: the first seconds are the scattered
  net falling in. Judge Scatter and Breath on a steady beat from t > 10 s.

## Known issues and next steps

- Edge colours and brightness (`EDGE_ALPHA`, `NODE_ALPHA`, the ramp) are the
  prototype's starting values, not yet matched to the reference.
- The edge buffer holds a capped number of edges per particle; a very dense
  core at high Reach drops the rest silently.
- Re-collapse on a drop has not been seen on a real track yet (the synthetic
  feed rarely produces a drop).

## Materials

- The physics prototype `proto.py` and its contact sheets live in the local
  `/ref` bundle `tools/.cache/refs/entropic-collapse/` (scripts and measured
  numbers are to be kept with `tools/ref-keep.py` under
  `docs/scenes/swarm/`).

## Resume here

- `npm run dev`, then `https://localhost:<port>/?audio=synthetic&bpm=128#/v/swarm`.
- Headless shots: Playwright with the Metal flags from the headless-driving
  notes; `?quality=` forces a preset. SwiftShader runs about 13 fps, which is
  below the sim's four-steps-a-frame cap, so use the Metal flags to see the
  real collapse timing.

## History

- Draft added on branch `worktree-swarm-scene` (sim, scene, tests).
