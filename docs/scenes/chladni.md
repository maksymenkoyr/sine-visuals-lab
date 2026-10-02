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
  that picks `ACTIVE_MODES` strongest modes each frame, each mode excited
  by its band energy less `SURPRISE_SHARE` of that energy's own running
  average over `BASELINE_SEC`), `grainTextureSide`,
  `grainGain`, `drawnGrainCount` (the fixed-sand-budget logic — see
  "Known issues" for why it exists).
- Three GLSL programs sharing `CHLADNI_GLSL` (the plate function, its
  gradient, and the position packing) so they can't drift apart: `SIM_FRAG`
  (steps grain positions), `BG_FRAG` (the plate surface + glow), `POINT_VERT`
  / `POINT_FRAG` (one point-sprite per grain, faceted 3/4-sided shards, not
  discs).
- `tests/chladni.test.ts` covers the mode table ordering/symmetry, resonance
  mapping, ring timing, grain-texture sizing, `grainGain`, and
  `drawnGrainCount`'s coverage cap and Sand amount scaling.
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

- 2026-10-02: offline probe of the real `FeatureExtractor` into
  `createPlateResponse` at default settings, on a synthetic bass/chords/lead/
  drums track. It ran clean, and through `tests/tempoEval/micChain.ts` with
  auto-gain on Auto (which went fully adaptive for the mic). Share of frames
  where (1,2) was the strongest mode, before → after: through the mic
  76% → 32% (distinct figures 10 → 18); through the mic with Resonance and
  Ring maxed 84% → 40%; clean with auto-gain off 73% → 45%. Mic noise with no
  music in it already gave (1,2) 98% before. Headless shots 7.5 s apart at
  `?audio=synthetic&bpm=120`: before held one lattice the whole time, after
  moved between figures with the lines still crisp.

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
- 2026-09-26 (#148): added the Sand amount setting (`sandAmount`), a Form dial
  after Grain size. It scales the drawn grain prefix inside
  `drawnGrainCount`'s `amount` parameter rather than reallocating the grain
  textures, so thinning is free and grains never pop in re-seeded; the
  simulation still steps every grain (see the file header's fixed-budget
  paragraph). Zero deliberately means a bare plate (drawn count zero, legal
  for `gl.drawArrays`). `grainGain` stays keyed to the quality-tier count —
  by decision less sand reads sparser at unchanged per-grain brightness
  rather than being auto-compensated brighter, leaving Grain brightness as
  the taste dial.
- 2026-09-26 (#148, review): the first cut only thinned the drawn prefix of
  the tier's pool and topped out at 1, where the coverage cap already
  bound at default Grain size — so the dial read as cosmetic. Now the grain
  pool is `SAND_AMOUNT_MAX` times the tier count, the sim is scissored to
  the rows the drawn prefix occupies (real sand, and less sand is cheaper),
  and the coverage cap scales with the amount above 1 so extra sand piles
  onto the figure. Measured headless at 1280×720, synthetic 120 BPM: mean
  luma 37 at 1, 102 at 5 right after raising (fresh sand scattered), and
  after ~10 s at 5 the nodal lines are thick solid bands instead of dust.
- 2026-09-28 — Audited for the drive-defaults rule ("if a parameter doesn't
  have a driver it should not affect the scene" — one of four featured
  scenes checked, see sky.md/caustics.md/physarum2.md for the others):
  clean, no change. Every jack already carries a real default (`shake`/
  `fieldGlow` → All level, `kick`/`beatFlash` → Bass hit/Beat, `highGlow` →
  Scene: treble level + hits, a genuine composite) and every coupling is
  already identity at drive 0 (`shake*(0.25+2.4*d)`, the `(0.3+d)` glow
  floor, every other term a pure additive reaction amount), so unplugging a
  jack already just stops the reaction — nothing else changes.
- 2026-10-02 — Treble-glow cost fix, same picture: a glint's sprite is
  enlarged by the halo margin, so most of its fragments are halo ring that
  contributes no grain (the polygon distance `rn` is never smaller than the
  disc radius `r`, so the grain's coverage is exactly 0 from `r` = 0.5 out),
  yet each ran the whole grain shader. `POINT_VERT` now computes the grain's
  colour, brightness and halo tint once per grain (`vCol`, `vHaloCol`) and
  `POINT_FRAG` returns early outside the grain's radius with only the halo.
  Checked on a seeded `tools/gpu-bench.mjs` render with Treble glow at 1:
  at most 1/255 difference on a handful of pixels, and the point pass at
  3024x1890 about halved.

- 2026-10-02: reported as "fixates on one figure, more with the mic, and
  maxing the settings doesn't help". Cause: `createPlateResponse` picked
  modes by absolute band energy, and the bands carry a constant bass-heavy
  tilt that doesn't come from the music. Through a mic, auto-gain goes fully
  adaptive (`autoGainForSpan` in `src/audio/autoGain.ts`), and that per-band
  normalization (`FeatureExtractor.update`) reads steady mic hiss high in the
  one-FFT-bin bass bands and low in the wide treble ones. That's because a
  one-bin band's dB reading jitters far more on noise, so its window opens
  wide and its value sits near the top. The lowest mode, (1,2), sat under
  those bands and won almost every frame. Resonance and Ring only made the
  winner win harder, and Pattern complexity only changed which low mode sat
  there. Clean audio with auto-gain off has a milder version of the same
  lean, from music's real bass-heavy balance. Fixed in the scene: each mode
  is now excited by how far its energy rises above its own running average,
  so any constant tilt cancels out, while a held tone keeps
  `1 - SURPRISE_SHARE` of its level and still holds its figure. Fixing the
  tilt at its source in `features.ts` (a noise margin over each band's
  measured jitter) was tried and flattened mic noise across the ladder. But
  `bandEnergy`'s bass pulse groups and the beat clock read the same bands,
  and the tempo eval moved in both directions, so it was left for its own
  tuning pass (see "Known issues").

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
- `BASELINE_SEC`/`SURPRISE_SHARE` decide how strongly a constant spectral
  tilt is cancelled. Raising the share cancels more of it but trades away how
  firmly a held tone keeps its figure, and figures change more often. Judge
  through a room mic with auto-gain on Auto, where the tilt is worst.
- Sand amount (`sandAmount`) and Grain size both set the bed through
  `drawnGrainCount` — amount scales the budget first, the coverage cap
  (`MAX_BED_COVERAGE`, grown by the amount above 1) binds second — and neither touches `grainGain`, so
  a reduced bed reads sparser at unchanged per-grain brightness; judge it
  against Grain brightness, which is the dial that compensates by taste.
- The auto→manual sign-off pattern used at ship time: drag one setting,
  confirm every weighted setting reads `auto` and the dragged one flips to
  `manual` — see PR #38's verification notes.

## Known issues and next steps

- Under a room mic with full auto-gain, the shared bands still read steady
  noise as bass-heavy (see the 2026-10-02 decision). This scene now cancels
  that, but every other scene that reads `bands` still sees it. The fix
  belongs in `src/audio/features.ts` and needs `npm run eval:tempo` before
  and after.

- Grains never collide (no notion of grain radius), so `drawnGrainCount`'s
  fixed-sand-budget approach is a workaround for a fixed grain count
  painting over itself at large Grain size, not a physical fix — it's
  documented as the accepted trade-off in the file header, not an open bug.
- The grain pool is allocated at `SAND_AMOUNT_MAX` times the tier count
  whatever the setting (texture memory, not sim cost — the sim is scissored);
  drawing the top of the range on the `high` tier is heavy on weak GPUs.
- No further follow-ups are recorded beyond the pivots above.

## Materials

- No `/ref` bundle and no artifacts; the original design was built against
  the plate physics rather than a reference clip.
- Working scripts: `docs/scenes/chladni/scripts/` — `sand-amount-shot.mjs`
  (headless before/after shots of the Sand amount setting via
  `window.__viz.setParams`) and `figure-sequence-shot.mjs` (a timed run of
  shots, to compare whether the plate moves between figures or sits on one).
  Captured screenshots are session output, not
  kept in the repo.

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
- `#148` / `4a2208f` (2026-09-26) — Sand amount setting: scales the drawn
  grain bed; 0 leaves the plate bare.
