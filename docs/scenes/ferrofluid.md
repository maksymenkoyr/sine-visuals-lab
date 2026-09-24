# Ferrofluid (`ferrofluid`)

A raymarched black-chrome blob that grows spikes toward 24 fixed directions
(one per band, spread via the golden angle), each spike's height driven by
that band's energy, lit with Fresnel + specular for an oil-slick sheen.
Small, original scene; a draft (in `DRAFT_SCENE_IDS`), on `main` since the
initial commit. Its own header comment calls it out as the most expensive
of the small fullscreen scenes, gated to `minQuality: "mid"`.

## Where the code is

- `src/render/scenes/ferrofluid.ts` — one fragment shader body (`FRAG`)
  passed to `createFullscreenScene()` with `{ minQuality: "mid" }`. No
  `settings`, no `extraUniforms`, no per-scene helper module.
- `modeDir(i)` places each of 24 band directions on a sphere via the golden
  angle. `sdBlob(p)` is the signed-distance field: a unit sphere minus a sum
  of per-direction lobes (`pow(dot(n, dir), 3.5) * band`), minus a small
  `uBeatPulse`-driven bulge. `calcNormal` is a standard SDF central-difference
  normal.
- The march loop steps `min(MAX_STEPS, uMaxSteps)`, same pattern as
  `tunnel.ts` — the real per-frame step budget is `uMaxSteps` from the
  common uniform set (`sceneCommon.ts`).
- The header comment is explicit that `uMaxSteps` alone under-protects a
  scene this expensive: `minQuality: "mid"` also gates it out of the
  gallery/scene picker entirely on floor-tier devices, rather than relying
  on a lower step count to degrade gracefully.
- Uses `palette()` (`src/render/palette.ts`) for the base color, keyed by
  Fresnel + a slow time drift.
- No dedicated test file.

## References

None — original design.

## Decisions and pivots

- 2026-08-27 (`5fe4b3c`, initial commit) — scene added, already gated to
  `minTier: "mid"` (later renamed).
- 2026-08-29 (`4b8d342`, #31) — mechanical rename only: `minTier` →
  `minQuality`; no visual change.

## Tuning notes

No `SceneSetting`s — every knob is a shader literal: the per-band lobe
exponent and gain (`pow(dot(n, dir), 3.5) * band * 0.85`), the beat bulge
(`uBeatPulse * 0.05`), the march step-advance factor (`d * 0.8`), the
far-plane cutoff (`t > 8.0`), and the specular exponent (`pow(..., 40.0)`).
`modeDir`'s golden-angle spread is the one thing that determines *where*
each band's spike appears on the sphere — changing the band-to-direction
mapping changes which part of the blob reacts to bass vs. treble. Judge the
look by whether the surface reads as a smooth, continuous blob with sharp
spikes only where a band is genuinely loud (not a spiky ball at rest), and
whether the Fresnel rim stays bright without blowing the whole silhouette
to white. Because it's gated to `minQuality: "mid"`, always check the look
at that tier, not just the default/high tier.

## Known issues and next steps

None recorded — no open PR or issue references this scene
beyond its creation. The quality gate is a known, deliberate constraint
(see the header comment), not an open issue.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/ferrofluid` (query
  before the hash). Use `?quality=mid` (or higher) since the scene is
  gated below that.
- No settings and no test file — tuning means editing the shader literals
  directly and reloading.

## History

- `5fe4b3c` (2026-08-27) — initial commit adds the scene, gated to
  `minTier: "mid"`.
- `4b8d342` (2026-08-29, #31) — `minTier` → `minQuality` rename (repo-wide,
  no scene-specific change).
