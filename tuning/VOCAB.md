# Tuning vocabulary

Running notes on what your words have meant in terms of actual params, so a
later session doesn't start from zero. Add an entry whenever a phrase
resolves into a concrete change; keep it short — the value is the mapping,
not the prose.

Format: `"phrase" -> scene: setting/param, direction, ~magnitude`

See `docs/tuning.md` for the workflow this feeds into.
"lightning that lights the cloud, not a bolt you see" -> storm: strike gain in POINT_VERT, kept modest (peak ~2x, not ~5x) so a flash decays instead of holding white; "a drop shouldn't go nuclear" -> storm: drop burst amplitude in render(), down ~20% per strike, three strikes in different lobes rather than one overdriven one
"not particles — a 3D gas/cloud simulation" -> storm: rewritten as a raymarched volume (density field + 3D noise texture), lightning as in-scattered light; "moodier, storm-cloud not daytime cumulus" -> storm: ambient default down (0.4→0.25), strike up (0.6→0.75), reach up (0.5→0.65)
"add some particles mode / more particle modes" -> storm: Mode enum (Gas/Particles/Both) + Particle style enum (Cloud/Swarm/Sparks); "sparks stay in a ball" -> storm: spark launch speed up ~2.5x, gravity up ~2x (POINT_VERT Sparks branch); "swarm whites out on the beat" -> storm: point strike gain down (mix 0.5..2.0 -> 0.3..1.2), swarm dragged brightness down
"cloud made of mesh / digital texture, strike visibly on the beat, shape that changes" -> storm v3: Mode leads with Mesh (surface-nets wireframe lattice) + Voxel (quantized march); visible bolt polyline per strike (buildBoltPath); cloudShape slider morphs baked shape variants, auto {density, dynamics}; Swarm/Sparks cut ("particles go crazy on swarm")
