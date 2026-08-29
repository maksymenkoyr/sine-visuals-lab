# Tuning vocabulary

Running notes on what your words have meant in terms of actual params, so a
later session doesn't start from zero. Add an entry whenever a phrase
resolves into a concrete change; keep it short — the value is the mapping,
not the prose.

Format: `"phrase" -> scene: setting/param, direction, ~magnitude`

See `docs/tuning.md` for the workflow this feeds into.
"the grid should actually read / not a dark blob" -> mesh: rebuilt as terrain waterfall; HEIGHT_SCALE 10 -> 6 (ridges below the camera, reads as ground), 3-tap bin blur (no cliffs), dots 0.78 -> 0.3
"move the scene a bit behind" -> mesh: cameraDistance 8 -> 16 (was a constant; now Camera Distance / Height / Tilt sliders), ~2x
"still missing a param to just zoom out" -> mesh: zoom (new; focal-length scale with grid width pinned to the zoom-1 frustum, so <1 shrinks the terrain in frame instead of stretching it), 1 -> ~0.5 for a floating-slab read
"can we make circle switch" -> mesh: circle (new boolean; same grid mapped to a disc, newest ring outside, CIRCLE_TILT_DEG 24 so it reads as a disc from the low default camera)
