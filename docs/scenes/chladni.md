# Chladni (`chladni`)

A simulated sand-on-vibrating-plate figure: a square or full-screen plate
whose resonant modes are each driven by the music's energy at that mode's
own resonant frequency, with a bed of sand grains that bounce on the
antinodes and settle on the nodal lines. The classic Chladni figures aren't
drawn — they emerge from grain motion and re-form grain by grain as a
different mode takes over. Featured, on main.

## Where the code is

- `src/render/scenes/chladni.ts` — the whole scene. The file header is the
  richest source: the plate model, the sand simulation (why it's a bounce
  random-walk rather than a slide), and the RGBA8 fixed-point grain-position
  packing (`packPos`/`unpackPos`) chosen for WebGL2-everywhere compatibility
  (no `EXT_color_buffer_float` dependency), which the header contrasts with
  `cymatics.ts` (an analytic circular-plate sum with no state).
- Pure, tested helpers: `buildModeTable`/`MODE_TABLE` (the (n, m) mode
  lattice up to `MAX_ORDER`), `modeFrequencyHz`/`bandPosition` (mode-to-band
  mapping), `createPlateResponse` (the per-mode resonance/ring/attack model
  that picks `ACTIVE_MODES` strongest modes each frame), `grainTextureSide`,
  `grainGain`, `drawnGrainCount` (the fixed-sand-budget logic — see
  "Known issues" for why it exists).
- Three GLSL programs sharing `CHLADNI_GLSL` (the plate function, its
  gradient, and the position packing) so they can't drift apart: `SIM_FRAG`
  (steps grain positions), `BG_FRAG` (the plate surface + glow), `POINT_VERT`
  / `POINT_FRAG` (one point-sprite per grain, faceted 3/4-sided shards, not
  discs).
- `tests/chladni.test.ts` covers the mode table ordering/symmetry, resonance
  mapping, ring timing, grain-texture sizing, `grainGain`, and
  `drawnGrainCount`'s coverage cap.
- Plugs into `autoTune.ts`/`sceneSettings.ts` the normal way (`resolveSceneSetting`,
  `auto` weights per setting); does not use the Drives system (PR #130) or
  `noiseHash.ts` — its own `hash21`/`hash22` in `CHLADNI_GLSL` are unrelated
  to the noiseHash mobile-seams fix.

## References

None — original design. The plate model is the standard square-plate mode
shape (a textbook eigenfunction approximation, not sourced from a video),
and the sand behaviour is designed directly against that physics rather than
measured from a reference clip.

## Measurements

- 2026-08-30 (#38): headless Playwright checks at `high` and `floor` quality
  — grains converge onto nodal lines within about 2 seconds of a mode
  change, and figures visibly change with the music at 120 and 150 BPM.
- 2026-08-30 (#47): after re-anchoring `grainGain` to the high-quality
  tier's grain count and raising its clamp ceiling, `high` and `low`
  quality presets read comparably bright headlessly.

## Decisions and pivots

- 2026-08-30 (#38): first landed as a draft with a stylised mode selector
  (spectral centroid picks one table index, held, beat-gated switch,
  "drop" leap) — then, within the same PR, replaced with the physical
  model that shipped: every mode is its own damped resonance excited by
  band energy in a window around its frequency, several modes summed by
  weighted response (`createPlateResponse`). The mode selector's
  crossfade-between-discrete-choices approach read as scripted; letting the
  plate's own per-mode ringing dynamics pick the blend was judged truer to
  a real plate and was kept.
- 2026-08-30 (#47): promoted out of the draft roster to the front of the
  gallery. Grains switched from round discs to faceted 3/4-sided shards
  (real sand is angular) sized to keep the same on-screen area as the discs
  they replaced. Brightness constants and the Vibration-to-drive curve were
  raised so the scene reads strong at default settings without relying on
  input auto-gain.
- 2026-08-30 (#54): a fixed grain count rendered at a large Grain size was
  found to paint over itself past roughly 55% plate coverage, flattening
  both the sand bed and the figure under it into a solid patch (worse on
  high-DPI canvases). Fixed by treating the bed as a fixed amount of sand
  (`drawnGrainCount`, capped at `MAX_BED_COVERAGE`) rather than a fixed
  grain count — bigger grains, fewer drawn — while the sim still steps
  every grain so the drawn subset stays a stable prefix. Grains past a few
  pixels across also gained per-facet shading and a darkened rim so
  overlapping shards read as grit instead of merging into flat colour.
- 2026-08-31 (#58): the faceted-grain distance field had `cos(k)` and
  `cos(theta')` swapped, which drew a circle through the origin instead of
  a polygon boundary — grains rendered as circles, not the intended
  triangles/squares. Fixed, with the anti-aliased rim width corrected to
  match the steeper gradient of the corrected field.
- 2026-09-03 (#69): setting `group` labels (Form / Motion / Look) joined
  the shared setting-group vocabulary introduced across all scenes; no
  Chladni-specific behaviour change.

## Tuning notes

- Pattern complexity sets the plate's effective size (`FUNDAMENTAL_HZ_SMALL`
  to `FUNDAMENTAL_HZ_LARGE`), which slides every mode's resonant frequency
  across the band ladder together — judge it by whether the figures reached
  are coarse (small plate, needs treble) or fine (large plate, fine
  lattices ring already in the mids).
- Resonance trades window width (`WINDOW_BANDS_DAMPED`/`WINDOW_BANDS_SHARP`)
  and response sharpening (`SHARPEN_DAMPED`/`SHARPEN_SHARP`) — low blurs
  neighbouring modes together, high lets one mode win cleanly; judge on a
  dense mix, where low Resonance should read muddier.
- Ring sets release time (`ringSeconds`, `RING_SEC_MIN`..`RING_SEC_MAX`)
  with a fixed attack fraction (`ATTACK_FRACTION`) — fast/percussive music
  wants a shorter ring so figures don't smear between hits.
- Vibration (`shake`) is on a sub-linear (`pow(uShake, 1.5)`) curve so its
  low half is a usable whisper while the top still throws sand hard; judge
  by whether nodal lines stay crisp even at max Vibration (a washout
  regression to watch for, per #47's test plan).
- Settling pull is a Form setting, not Motion — it governs how crisply the
  figure ultimately resolves rather than something watched moving in real
  time.
- Quality tiers change grain count (`ctx.quality.maxParticles`) only;
  `grainGain` compensates so sparser beds (`floor`/`low`) read about as
  bright as the `high` tier reference count (`REFERENCE_GRAINS`).
- The auto→manual sign-off pattern used at ship time: drag one setting,
  confirm every weighted setting reads `auto` and the dragged one flips to
  `manual` — see PR #38's verification notes.

## Known issues and next steps

- Grains never collide (no notion of grain radius), so `drawnGrainCount`'s
  fixed-sand-budget approach is a workaround for a fixed grain count
  painting over itself at large Grain size, not a physical fix — it's
  documented as the accepted trade-off in the file header, not an open bug.
- No further follow-ups are recorded beyond the pivots above; the scene has
  had no changes since #69 (2026-09-03) besides the shared setting-group
  vocabulary pass.

## Resume here

- Dev link: `npm run dev`, then `/?audio=synthetic&bpm=120#/v/chladni`
  (swap `bpm` and try `?quality=floor`/`?quality=high` before the hash to
  compare grain-count tiers).
- A reusable auto→manual probe pattern was used during development: clear
  pins, set `autoPin:false`, print every setting's probe mode, drag the
  Vibration slider, print again, and confirm the dragged setting alone
  flips to `manual`. Not checked into the repo; reconstruct via
  `window.__viz.setParams` and the settings panel if needed again.
- Gotcha: use `frame.time` deltas for sim `dt`, not `anim.dtSec` — the file
  header explains why (`anim`'s clock advances every rAF tick while
  `render()` is frame-pace-capped, so `dtSec` under-counts wall time).

## History

- `#38` / `ae6aeb1` (2026-08-30) — Chladni scene lands as a draft; pivots
  within the same PR from a stylised mode selector to the physical
  per-mode ringing-response model.
- `#47` / `c6515ee` (2026-08-30) — promoted to featured; angular faceted
  grains; brighter defaults.
- `#54` / `62e3cd9` (2026-08-30) — grain-bed coverage cap and per-facet
  shading for chunky grains.
- `#58` / `6409da9` (2026-08-31) — fix grains rendering as circles instead
  of polygons.
- `#69` / `88aab06` (2026-09-03) — setting groups join the shared
  cross-scene vocabulary.
