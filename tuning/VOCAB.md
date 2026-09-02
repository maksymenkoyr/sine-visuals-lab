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
"cloud made of mesh / digital texture, strike visibly on the beat, shape that changes" -> storm v3: Mode leads with Mesh (surface-nets wireframe lattice) + Voxel (quantized march); visible bolt polyline per strike (buildBoltPath, since v6 buildBoltTree); cloudShape slider morphs baked shape variants, auto {density, dynamics}; Swarm/Sparks cut ("particles go crazy on swarm")
"control how fast gas morphs + connect to beat" -> storm: morphSpeed (Off stop at 0) + morphBeat (capped per-beat phase kick); "different parts of cloud = different spectrum, lighting from it" -> storm: spectrumMap Screen/Cloud + spectrumGlow on ambient only; "lighting look nicer" -> storm: HG scattering + differential strike shadow + flashTint violet fringe + hue-preserving tonemap
"in between the reference video and what we have; particles like the video" -> storm v5: Filaments mode (curl-flow strand tangle over a dimmed half-step gas underlay), new default; strand crawl/impulse on the Flow slider, auto {tempo, pulse}; "cloud with very low light that lights up on strike" -> storm: ambient floor slides to near-black below the default (bit-identical above it), strike light left ambient-independent; "different gases" -> storm: Gas enum (Cumulus identity / Wisp / Smoke / Nebula) as uniform-only recipes over frequency, stretch, erosion, extinction, powder, tint
"no gas around the filaments; lightning longer, thicker, branching" -> storm v6: FIL_GLOW underlay deleted (Filaments = pure strands + bolt bloom); buildBoltTree (main channel + branches + one fork level) drawn as a tapered camera-facing ribbon, STRIKE_LEN_MIN/MAX up, thickness/branch prominence ride the bolt slider; "parts of claude dark, light up on beat/trigger, lighten up with lightning" -> storm v6: sections slider ("Dark sections", default well above half), warped Lloyd-relaxed Voronoi cells + per-cell envelopes (beat rises = random cells, mid/high rises = gentler single cells, strikes light their channel cells), gain on resting light only, auto {dynamics, attack}
