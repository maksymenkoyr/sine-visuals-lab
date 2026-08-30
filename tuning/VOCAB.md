# Tuning vocabulary

Running notes on what your words have meant in terms of actual params, so a
later session doesn't start from zero. Add an entry whenever a phrase
resolves into a concrete change; keep it short — the value is the mapping,
not the prose.

Format: `"phrase" -> scene: setting/param, direction, ~magnitude`

See `docs/tuning.md` for the workflow this feeds into.
"lightning that lights the cloud, not a bolt you see" -> storm: strike gain in POINT_VERT, kept modest (peak ~2x, not ~5x) so a flash decays instead of holding white; "a drop shouldn't go nuclear" -> storm: drop burst amplitude in render(), down ~20% per strike, three strikes in different lobes rather than one overdriven one
"not particles — a 3D gas/cloud simulation" -> storm: rewritten as a raymarched volume (density field + 3D noise texture), lightning as in-scattered light; "moodier, storm-cloud not daytime cumulus" -> storm: ambient default down (0.4→0.25), strike up (0.6→0.75), reach up (0.5→0.65)
