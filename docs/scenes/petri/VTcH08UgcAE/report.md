# ref bundle: VTcH08UgcAE

`tools/.cache/refs/_downloads/VTcH08UgcAE.mp4` — 0.0+30.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- no hard cuts at 30 fps in 30 s: every transition below is a fade or a motion
- 2 strobe stretch(es), flashes every 0.40 s (2.5 Hz), at t 10.5, 13.9
- 8 single transitions at t 0.9, 9.5, 12.3, 12.5, 13.1, 13.3, 17.1, 20.1
- zoom direction changes at beat #4 (r4, 2.0s, -1.7σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 34% of the clip, 5.07s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 8 lit objects on 720×720 (lit floor 0.18, lit 5.5% of pixels): 3 blob, 3 bar, 1 disc, 1 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.19 over 4 substantial objects: 1.907 half-heights at r 0.3, 0.517 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 1.697, r0.6-1.0 → —, r>1 → —
- rings at r ≈ 0.38 (×4), 0.60 (×2); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 13.2 px, halo/core 0.27 at 4 px; core lum 0.41, ground lum 0.048
- hues (by lit area): azure 210° 75%, cyan 180° 25%; ground `#010b2f`, centre/edge ground brightness 1.12
- flow (77 object tracks, 43% moving outward → mixed directions): radial speed ∝ r^-0.37 (not a zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:-0.01, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.92 at r<0.45 vs 1.91 at r≥0.45; 40% of elongated objects lie along the radial direction

### Regime 2 — 22% of the clip, 22.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 14 lit objects on 720×720 (lit floor 0.18, lit 6.9% of pixels): 9 blob, 3 bar, 1 disc, 1 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.85 over 7 substantial objects: 3.446 half-heights at r 0.3, 0.450 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → 1.180, r>1 → 0.351
- rings at r ≈ 0.67 (×6), 1.34 (×6); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 14.4 px, halo/core 0.36 at 4 px; core lum 0.45, ground lum 0.054
- hues (by lit area): cyan 180° 54%, green 120° 23%, red 0° 9%, rose 330° 5%; ground `#060c32`, centre/edge ground brightness 1.05
- flow (120 object tracks, 25% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.85 (a fly-through along the axis) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:+0.00, 0.87:-0.01, 1.22:-0.02; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 1.99 at r≥0.45; 33% of elongated objects lie along the radial direction

### Regime 3 — 20% of the clip, 16.27s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 22 lit objects on 720×720 (lit floor 0.18, lit 11.8% of pixels): 9 bar, 8 blob, 5 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.38 over 11 substantial objects: 0.904 half-heights at r 0.3, 0.594 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.951, r0.6-1.0 → 0.580, r>1 → 0.260
- rings at r ≈ 0.42 (×6), 0.95 (×11); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 9.3 px, halo/core 0.39 at 4 px; core lum 0.41, ground lum 0.069
- hues (by lit area): cyan 180° 72%, azure 210° 28%; ground `#001234`, centre/edge ground brightness 1.84
- flow (186 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^-1.03 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.14, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.98 at r<0.45 vs 2.62 at r≥0.45; 59% of elongated objects lie along the radial direction

### Regime 4 — 12% of the clip, 11.07s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 27 lit objects on 720×720 (lit floor 0.18, lit 14.0% of pixels): 13 bar, 10 blob, 3 disc, 1 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.83 over 14 substantial objects: 2.708 half-heights at r 0.3, 0.363 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 1.508, r0.6-1.0 → 0.999, r>1 → 0.387
- rings at r ≈ 0.53 (×4), 1.06 (×17); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 19.6 px, halo/core 0.39 at 4 px; core lum 0.51, ground lum 0.057
- hues (by lit area): azure 210° 51%, cyan 180° 44%; ground `#030e32`, centre/edge ground brightness 0.86
- flow (200 object tracks, 36% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.64 (not a zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:-0.14, 0.61:-0.13, 0.87:+0.00, 1.22:+0.00; rotation -0.8°/s (+ = counter-clockwise on screen)
- streak: median elongation 5.85 at r<0.45 vs 2.83 at r≥0.45; 46% of elongated objects lie along the radial direction

### Regime 5 — 12% of the clip, 14.80s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 39 lit objects on 720×720 (lit floor 0.19, lit 15.8% of pixels): 22 bar, 11 blob, 6 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-3.39 over 6 gates: 2.163 half-heights at r 0.3, 0.052 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.114, r0.3-0.6 → 1.013, r0.6-1.0 → 0.816, r>1 → 0.316
- rings at r ≈ 0.84 (×11), 1.19 (×14); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 9.5 px, halo/core 0.39 at 4 px; core lum 0.54, ground lum 0.095
- hues (by lit area): cyan 180° 49%, azure 210° 25%, orange 30° 14%, red 0° 11%; ground `#06193a`, centre/edge ground brightness 1.07
- flow (279 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.34 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:—, 0.39:+0.01, 0.61:-0.01, 0.87:-0.02, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.29 at r<0.45 vs 3.26 at r≥0.45; 57% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.87s (beat #2 r2, novelty 2.0); also every 10 s (no audio to place by) — no hard cut but brightness swings 0.08–0.19 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **7.97–10.97s** — transition at 9.47s (beat #19 r1, novelty 7.3) — no hard cut; brightness 0.14–0.22, colour change 0.026/frame (cut ≥ 0.2) — `bursts/007.97/timing.png` (every frame), `bursts/007.97/detail.png` (large), `bursts/007.97/motion.png` (paths / skeleton / t±1 in RGB)
- **10.22–13.22s** — strobe 10.47–11.27s, flashes every 0.40s; also transition at 13.07s (beat #26 r2, novelty 4.0); also transition at 12.27s (beat #25 r1, novelty 2.8); also transition at 12.47s (beat #25 r1, novelty 2.4); also every 10 s (no audio to place by) — no hard cut; brightness 0.14–0.20, colour change 0.023/frame (cut ≥ 0.2) — `bursts/010.22/timing.png` (every frame), `bursts/010.22/detail.png` (large), `bursts/010.22/motion.png` (paths / skeleton / t±1 in RGB)
- **11.77–14.77s** — transition at 13.27s (beat #27 r1, novelty 5.9) — no hard cut; brightness 0.16–0.24, colour change 0.031/frame (cut ≥ 0.2) — `bursts/011.77/timing.png` (every frame), `bursts/011.77/detail.png` (large), `bursts/011.77/motion.png` (paths / skeleton / t±1 in RGB)
- **13.62–16.62s** — strobe 13.87–15.47s, flashes every 0.40s — no hard cut but brightness swings 0.13–0.24 — `bursts/013.62/timing.png` (every frame), `bursts/013.62/detail.png` (large), `bursts/013.62/motion.png` (paths / skeleton / t±1 in RGB)
- **15.57–18.57s** — transition at 17.07s (beat #34 r2, novelty 1.6) — no hard cut; brightness 0.11–0.16, colour change 0.017/frame (cut ≥ 0.2) — `bursts/015.57/timing.png` (every frame), `bursts/015.57/detail.png` (large), `bursts/015.57/motion.png` (paths / skeleton / t±1 in RGB)
- **18.57–21.57s** — transition at 20.07s (beat #40 r8, novelty 1.7); also every 10 s (no audio to place by) — no hard cut; brightness 0.09–0.13, colour change 0.015/frame (cut ≥ 0.2) — `bursts/018.57/timing.png` (every frame), `bursts/018.57/detail.png` (large), `bursts/018.57/motion.png` (paths / skeleton / t±1 in RGB)
- **27.00–30.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.06–0.11, colour change 0.011/frame (cut ≥ 0.2) — `bursts/027.00/timing.png` (every frame), `bursts/027.00/detail.png` (large), `bursts/027.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#030d32`×0.76 `#0d4d6f`×0.12 `#5b263c`×0.06 `#98c3eb`×0.03 `#d9675c`×0.03
- mirror symmetry, ~1 axis (r 0.34); centre brightness 0.13 vs edge 0.12; mean brightness 0.12, dark frames 24%; saturation 0.91
- motion: zoom mean -0.007 (|zoom| 0.120) log-scale/s, rotation mean -1.5° (|rot| 3.3°)/s, frame-to-frame activity 0.009

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 4 | +0.60 | +0.68 | +0.56 | +0.05 | +0.15 |
| 8 | 4 | +0.31 | +0.39 | -0.33 | +0.19 | -0.04 |
| 4 | 7 | +0.66 | +0.95 | +0.11 | +0.02 | +0.35 |
| 2 | 15 | +0.43 | +0.76 | +0.09 | +0.28 | +0.67 |
| 1 | 30 | +0.39 | +0.45 | +0.04 | +0.73 | +0.30 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.87 | #2 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 9.47 | #19 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut |
| 10.47 | #21 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 11.27s: 3 flashes every 0.40s = 0.80 beat (no simple fraction of a beat → own timer), starts on beat r1, no onset |
| 12.27 | #25 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 12.47 | #25 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 13.07 | #26 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 13.27 | #27 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 13.87 | #28 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 15.47s: 5 flashes every 0.40s = 0.80 beat (no simple fraction of a beat → own timer), starts off beat r4, no onset |
| 17.07 | #34 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 20.07 | #40 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): sat +0.9σ, zoom -1.7σ, abszoom +2.1σ
- beat #8 (r8, 4.00s): zoom -1.0σ, abszoom -1.2σ
- beat #16 (r16, 8.00s): bright +1.6σ, sat -1.1σ
- beat #20 (r4, 10.00s): bright -1.1σ, sat +1.7σ, act -1.1σ, rot -1.9σ
- beat #24 (r8, 12.00s): rot +2.8σ
- beat #32 (r16, 16.00s): act -1.2σ
- beat #40 (r8, 20.00s): zoom +0.9σ
- beat #48 (r16, 24.00s): rot -1.4σ
- beat #52 (r4, 26.00s): rot +2.3σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 14 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (flash): transition at 0.87s (beat #2 r2, novelty 2.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/007.97/timing.png` … — burst 7.97–10.97s (continuous): transition at 9.47s (beat #19 r1, novelty 7.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.22/timing.png` … — burst 10.22–13.22s (continuous): strobe 10.47–11.27s, flashes every 0.40s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.77/timing.png` … — burst 11.77–14.77s (continuous): transition at 13.27s (beat #27 r1, novelty 5.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/013.62/timing.png` … — burst 13.62–16.62s (flash): strobe 13.87–15.47s, flashes every 0.40s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.57/timing.png` … — burst 15.57–18.57s (continuous): transition at 17.07s (beat #34 r2, novelty 1.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/018.57/timing.png` … — burst 18.57–21.57s (continuous): transition at 20.07s (beat #40 r8, novelty 1.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/027.00/timing.png` … — burst 27.00–30.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py VTcH08UgcAE --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank2-3.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `sheets/rank1-5.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
