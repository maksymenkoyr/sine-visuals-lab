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
  average over `BASELINE_SEC`, and giving last frame's top mode
  `holdMargin`'s head start), `grainTextureSide`,
  `grainGain`, `drawnGrainCount` (the fixed-sand-budget logic — see
  "Known issues" for why it exists), and the grain-weight helpers
  `grainWeightAt`/`grainSizeFactor`/`grainSizeMoment`, which mirror
  `grainWeight`/`grainSizeFactor` in `CHLADNI_GLSL`.
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

- 2026-10-04 (grain weight): headless shots at 1280×720 on the Metal GPU,
  synthetic 120 BPM, 10 s per bed. Mean luma / share of brightness in the
  brightest 10% of pixels: fine powder (weight 0, mix 0) 19 / 0.50, the
  powder gathered in compact heaps on the antinodes; heavy grit (1, 0) 35 /
  0.53, crisp lines; full mix (0.5, 1) 49 / 0.45, grit lines with pale dust
  in the cells. Default bed, four frames 4 s apart before → after: top-10%
  share 0.32–0.59 → 0.32–0.49, mean luma 30–63 → 46–68 — the spread is the
  figure changing, not the change.

- 2026-10-04 (sand zones): `scripts/sand-zones-measure.mjs`, the sim rule on
  the CPU at a steady drive, four figures, 3000 grains from a scattered bed.
  Grain travel in 1 s, in nodal cells: 0.006 at drive 0.1, 0.022 at 0.2,
  0.049 at 0.4, 0.103 at 0.8. Share of grains on the lines after 1 s / 4 s
  (scattered sand alone gives 0.16): 0.20 / 0.47 at 0.8, 0.23 / 0.75 at 1.0,
  0.48 / 0.98 at 1.5, 0.71 / 1.00 at 2.0. So the figure holds below about
  0.2 (`FREEZE_REF`), and half a scattered bed is on the lines within a
  second, two beats, from about 1.5 (`SNAP_REF`). The "Curve to Sand"
  explainer artifact had put the snap edge at 0.8, about half of what the
  real rule does; at the default Vibration the plate mostly sits in the
  drift zone, with kicks reaching toward the snap edge.

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

- 2026-10-04 (figure hold): `docs/scenes/chladni/scripts/figure-hold-measure.test.ts`,
  the tempo-eval synthetic tracks clean and through `micChain`, real
  `FeatureExtractor` into `createPlateResponse` at default settings.
  Turnover (share of the plate's mode blend that changes per second) / clarity
  (mean top-mode weight), clean tracks at hold 0 → 0.5 → 1: 0.61–0.88 / 0.27–0.30
  → 0.37–0.59 / 0.52–0.58 → 0.10–0.24 / 0.84–0.91; through the mic 0.23–0.62 /
  0.35–0.41 → 0.15–0.53 / 0.63–0.71 → 0.03–0.12 / 0.90–0.96. Hold 0.25 barely
  moves turnover and lifts clarity by about 0.1. Resonance and Ring maxed at
  hold 0, for comparison: clean turnover 0.41–0.63, through the mic 0.27–0.56
  (Resonance 1 alone raised it through the mic, up to 0.76). Two candidates for
  a "more change" side, measured as a mid-default slider and dropped: a running
  average shortened to 1 s, and `SURPRISE_SHARE` raised toward 1, with and
  without the shorter average — figure changes per minute stayed within the
  run-to-run spread of the default on every track. Headless shots at 2.5 s
  intervals (synthetic 120 BPM): hold 0 moved between blended figures, 0.5 kept
  one figure with finer detail coming and going, 1 held one clean figure
  through the whole run.
- 2026-10-04, promo footage (PR #313, `tools/promo/motion.py`, Stable 0.2.0
  defaults, 720×1280): on `?audio=synthetic` the plate held one simple figure
  for 32 beats and only the palette changed — motion 1.67 (mean frame-to-frame
  grey change), beat pulse 1.15. Fed a 175 BPM drum & bass track through the
  fake mic it kept re-forming into new figures: motion 3.89, sync to the song's
  onset strength 0.56 at a 20 ms lag, pulse 1.27 (64 beats after the drop). The
  user had called the synthetic footage "bad … low dynamic movement"; never
  judge or film Chladni on the synthetic feed — it has no spectrum to follow.

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
- 2026-10-05 — Treble glow renamed **Glow**, and it starts on two real
  wires instead of a built-in. The user's rule: a setting is either
  connected or not. The built-in drew dimmed ghost wires to Treble level and
  Treble hit, with a live graph but no plugged jack, which read as neither.
  `drive.default` may now be a patch (`defaultDriveSetting` in
  `src/render/drives.ts`), so Glow defaults to Treble level + Treble hit,
  `add`, weighted by `GLOW_LEVEL_WEIGHT`/`GLOW_HIT_WEIGHT` — the same sum
  `POINT_VERT`'s `vGlow` used, so the default picture is unchanged (a test
  in `tests/drives.test.ts` checks the sum). Glow now follows Master
  Expansion like every other wired setting. Audit of the rest: Vibration,
  Bass kick, Plate glow and Flash already start on one real wire; no other
  setting has a built-in. One reaction still has no wire: the spectrum picks
  the figure (`createPlateResponse` reads `frame.bands` directly). It is the
  scene's core, so it stays as is.
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

- 2026-10-02 — colour moves to the room palette's ramp role (`palRamp()`,
  `src/render/palette.ts`). Grains were `palette(0.1 + 0.4 * vAmp)` and the
  plate glow `palette(0.55 + 0.2 * a)`. Those points on the cosine curve are
  bright in Neon but dark in others: under Acid the sand came out dark
  maroon and nearly disappeared into the plate. Grains now take the ramp's
  bright half (`palRamp(0.55 + 0.45 * vAmp)`: settled sand mid-ramp, thrown
  grains at its brightest end) and the glow its middle
  (`palRamp(0.35 + 0.3 * a)`). Every palette's ramp rises in lightness
  (`tests/palette.test.ts`), so the sand reads in all of them. Under Neon the
  sand stays pink, running to near-white when thrown instead of to blue.
- 2026-10-03 — Beat flash renamed **Flash** and made harder (the user asked
  for it to "go harder"). The key stays `beatFlash`, so saved looks and share
  codes still load. Grain brightness at full Flash went from ×1.8 to ×3, and
  the default from 0.3 to 0.5. The plate used to get only a ×1.3 gain, which
  on a near-black plate showed as nothing, so it now also lifts toward the
  palette's middle (`palRamp(0.5)`). Measured headless at 1280×720, synthetic
  120 BPM, default settings, a 24-frame burst: frame mean luma swung
  42→52 (1.24×, mostly the sand pattern changing) before and 46→68 (1.48×)
  after, with on-beat frames reading white-hot.

- 2026-10-04 — Grain weight and Size mix (Form, after Sand amount), asked for
  as "simulation of size/weight of sand grain" to make the plate complete.
  Each grain's weight comes from the same per-grain hash that used to only
  jitter its drawn size, so how big a grain looks and how it moves are one
  property. Heavier grains hop further, lift at a lower plate acceleration
  and walk to the lines more readily; light grains are carried by a drift up
  the gradient of the plate's squared motion — the air streaming that heaps
  fine powder on the antinodes (Faraday, 1831) — so a mixed bed sorts itself.
  All weight factors are 1 at `WEIGHT_REF`, the default, which is the plate
  as it was; the default Size mix reproduces the old ±25% size scatter. The
  streaming fades out by `GRAIN_HEAVY`, below the default weight, so the
  default bed is sand with only its lightest grains slightly carried.
  `drawnGrainCount` takes the bed's mean squared size (`grainSizeMoment`), so
  a powder bed draws more grains under the coverage cap than a grit bed.

- 2026-10-04 (same PR, review): "all these 3 affecting colour in a weird
  way" — Sand amount, Grain weight and Size mix all washed the sand toward
  grey-white. Cause: a grain's colour was keyed to the plate's amplitude
  where it lies (`amp(p)`), on the assumption that anything on an antinode
  is being thrown, so all three dials changed the colour by changing how much
  sand rests on the antinodes: powder heaps there, a light bed is all
  powder, extra sand sits there unsorted. On top of that, the first cut drew
  powder chalkier, and glinting grains (additive, white-tinted halos) grew in
  number with Sand amount. Now the colour follows how far the grain is
  really hopping (`GRAIN_MOTION_GLSL`, shared with the sim, full at
  `MOTION_FULL`), the powder chalk is gone, and the glint share is divided
  by the Sand amount above 1. Mean saturation of the lit sand over three
  frames, Sand 3.09 / weight 0.27 / mix 0.08: 0.15 (71% of it grey) →
  0.46–0.54, against 0.36–0.58 for the default bed.

- 2026-10-04 (sand zones): from the "Curve to Sand" explainer
  (https://claude.ai/artifact/XCYfqi5nXgW9Mvjmont5fD), the user asked whether
  the drift zone can actually be changed, and for it in the UI. It can: the
  zones come from the sim rule (the lift knee sets where sand starts moving,
  the pull bias where it snaps). The two edges are now settings, Freeze edge
  and Snap edge, applied as a piecewise-linear remap of the plate's drive
  (`zoneDrive`, `src/render/scenes/chladniSand.ts`) inside `plateDrive`, so
  the bounce, pull, air streaming and grain colour all agree. A remap rather
  than moving `LIFT_THRESHOLD` and the pull bias directly, because each of
  those moves both edges at once (motion scales with the knee at a fixed
  drive-to-knee ratio). The remap is the identity at the default edges, so the
  default plate is unchanged. Settling pull is gone: it only moved the snap
  edge, which is now Snap edge (extend, don't duplicate); its 0.5 default is
  baked into `PULL_BIAS`, and its Auto lean toward a steady beat went with
  it. The edges are manual, because the gauge shows the stored values and
  Auto would make it lie. The Scene card shows them as the Sand zones gauge
  (`src/ui/widgets/sandZones.ts`): the drive on a fixed square-root axis
  (linear left the freeze band too thin to read), the three bands, the two
  edges as draggable handles (keyboard sliders too), the plate's drive now as
  a needle (`probe()`), and a strip of grains stepped by the same rule at each
  drive, which re-scatters every few seconds so an edge move shows at once.
- 2026-10-04 (figure hold): the user asked what drives figure changes, then
  whether their sensitivity can be regulated. **Figure hold** (Form, after
  Ring): last frame's top mode counts `holdMargin` times its response, so a
  new figure has to ring clearly stronger to take over. A margin rather than a
  minimum time on the plate, so a big change still lands at once and nothing
  moves on a timer. Squared across the slider (`HOLD_CURVE`), because the
  linear first pass held nearly every track still from halfway up. One-way, default
  0 = the plate as it was: the first build was a mid-default "Figure change"
  slider whose right half shortened the running average, and it measured flat
  (see Measurements) — the plain model already changes as often as the music
  gives it reason to. It also makes the figure cleaner (the top mode takes a
  bigger share of the blend), which overlaps Resonance, but Resonance doesn't
  slow the turnover. Manual, no `auto`: how restless the plate looks is taste,
  not a property of the track. Counting top-mode switches was the wrong
  measure: at hold 0 on broadband music the top flickers every few frames
  inside a near-even four-way blend that hardly changes, and a small hold
  turned that into fewer but visible switches.
- 2026-10-04: the Sand zones gauge takes its width from
  `src/ui/onScreen.ts`'s `watchSize` instead of reading `clientWidth` every
  tick (a forced layout per read; found while chasing Physarum 2's panel
  lag). No visible change.

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
- Freeze edge and Snap edge set where the sand holds, drifts and snaps; judge
  them on the Sand zones gauge against the needle while music plays. A low
  Snap edge makes every kick re-form the figure crisply; a high Freeze edge
  lets quiet passages hold one figure.
- Quality tiers change grain count (`ctx.quality.maxParticles`) only;
  `grainGain` compensates so sparser beds (`floor`/`low`) read about as
  bright as the `high` tier reference count (`REFERENCE_GRAINS`).
- Figure hold (`figureHold`, `holdMargin`, `HOLD_MARGIN_MAX`, `HOLD_CURVE`)
  is how long a figure stays, independent of the spectrum. Judge it on a long
  stretch of real music: at the top a figure should still give way to a new
  section, not stick through a whole track.
- `BASELINE_SEC`/`SURPRISE_SHARE` decide how strongly a constant spectral
  tilt is cancelled. Raising the share cancels more of it but trades away how
  firmly a held tone keeps its figure, and figures change more often. Judge
  through a room mic with auto-gain on Auto, where the tilt is worst.
- Sand amount (`sandAmount`) and Grain size both set the bed through
  `drawnGrainCount` — amount scales the budget first, the coverage cap
  (`MAX_BED_COVERAGE`, grown by the amount above 1) binds second — and neither touches `grainGain`, so
  a reduced bed reads sparser at unchanged per-grain brightness; judge it
  against Grain brightness, which is the dial that compensates by taste.
- Grain weight and Size mix are manual (no `auto`), like Grain size. The
  streaming speed is `STREAM_RATE`; the hop, lift and pull slopes are
  `HOP_PER_WEIGHT`, `LIFT_PER_WEIGHT` and `pullScale` in `SIM_FRAG`. Judge
  powder at weight 0, mix 0 (heaps should sit still on the antinodes, not
  smear between them) and a sorted bed at weight 0.5, mix 1.
- The auto→manual sign-off pattern used at ship time: drag one setting,
  confirm every weighted setting reads `auto` and the dragged one flips to
  `manual` — see PR #38's verification notes.

## Known issues and next steps

- Under a room mic with full auto-gain, the shared bands still read steady
  noise as bass-heavy (see the 2026-10-02 decision). This scene now cancels
  that, but every other scene that reads `bands` still sees it. The fix
  belongs in `src/audio/features.ts` and needs `npm run eval:tempo` before
  and after.

- Grains never collide (they have a size and weight now, but no radius in
  the sim), so `drawnGrainCount`'s
  fixed-sand-budget approach is a workaround for a fixed grain count
  painting over itself at large Grain size, not a physical fix — it's
  documented as the accepted trade-off in the file header, not an open bug.
- The grain pool is allocated at `SAND_AMOUNT_MAX` times the tier count
  whatever the setting (texture memory, not sim cost — the sim is scissored);
  drawing the top of the range on the `high` tier is heavy on weak GPUs.
- Faraday heaps on a real plate circulate (powder rolls up and over the
  heap); here they only gather. A swirl around each heap is the next step if
  powder should look alive rather than parked.

## Materials

- No `/ref` bundle; the original design was built against the plate physics
  rather than a reference clip.
- Artifacts: `docs/scenes/chladni/artifacts/sand-zones-gauge.html`, the
  source of the "Sand Zones Gauge" explainer
  (https://claude.ai/artifact/TGUaybdbJWeeo5K4DeyfC3). It covers how the drive
  is built, what the edges do to it, and why the sand has three ranges, with
  live demos on a copy of `chladniSand.ts`'s numbers. Self-contained; open it
  in a browser.
- Working scripts: `docs/scenes/chladni/scripts/` — `sand-amount-shot.mjs`
  (headless before/after shots of the Sand amount setting via
  `window.__viz.setParams`) and `figure-sequence-shot.mjs` (a timed run of
  shots, to compare whether the plate moves between figures or sits on one)
  and `grain-weight-shot.mjs` (Metal-GPU shots of named Grain weight / Size
  mix beds after each has sorted; on a checkout without those settings every
  shot is the default bed, the "before" side) and `sand-zones-measure.mjs`
  (the sim rule on the CPU at steady drives, where `FREEZE_REF` and
  `SNAP_REF` come from) and `figure-hold-measure.test.ts` (figure turnover and
  clarity across Figure hold on the tempo-eval tracks; copy into `tests/` to
  run).
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
- `#312` (2026-10-04) — Sand zones: Freeze edge and Snap edge
  settings with a draggable gauge in the Scene card; Settling pull removed.
- 2026-10-04 (draft) — Figure hold: how much stronger a new figure must ring
  to take the plate.
- 2026-10-05 (draft) — Treble glow renamed Glow; it starts on two real wires
  (Treble level + Treble hit) instead of a built-in.
