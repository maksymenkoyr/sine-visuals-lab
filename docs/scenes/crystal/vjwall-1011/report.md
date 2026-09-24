# ref bundle: vjwall-1011

`tools/.cache/refs/_downloads/_RsNDsibqgc.mp4` — 1011.0+40.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 86 hard cuts in 40 s, densest second 8 cuts at 16s; holds between cuts 33–3467 ms (median 33) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 20 single transitions at t 1.1, 4.9, 5.7, 6.9, 10.2, 13.3, 16.6, 17.7, 18.0, 18.5, 21.6, 22.3, 23.6, 26.6, 26.8, 29.9, 33.3, 34.3, 35.3, 38.9
- zoom direction changes at beat #12 (r4, 6.0s, +1.3σ)
- zoom direction changes at beat #20 (r4, 10.0s, -1.2σ)
- zoom direction changes at beat #24 (r8, 12.0s, +1.4σ)
- zoom direction changes at beat #32 (r16, 16.0s, -1.6σ)
- zoom direction changes at beat #60 (r4, 30.0s, -1.3σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 54% of the clip, 39.40s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 108 lit objects on 1280×720 (lit floor 0.18, lit 1.9% of pixels): 66 bar, 18 blob, 13 panel, 10 hex ring, 1 disc; outlines 9%, fills 91%; 20% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.15 over 23 gates: 0.096 half-heights at r 0.3, 0.081 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.032, r0.3-0.6 → 0.209, r0.6-1.0 → 0.086, r>1 → 0.134
- rings at r ≈ 0.34 (×9), 0.47 (×4), 0.75 (×24), 1.34 (×29); 2-fold (score 0.84); on the axes 39%, on the diagonals 14%
- stroke (outlines): 3.8 px at r<0.45, 3.8 px at r≥0.45; glow e-fold 13.2 px, halo/core 0.12 at 4 px; core lum 0.26, ground lum 0.023
- hues (by lit area): azure 210° 88%, red 0° 11%; ground `#070506`, centre/edge ground brightness 1.00
- flow (297 object tracks, 30% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.81 (a flat zoom) 0.38 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.19 at r<0.45 vs 4.56 at r≥0.45; 24% of elongated objects lie along the radial direction

### Regime 2 — 28% of the clip, 39.87s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 125 lit objects on 1280×720 (lit floor 0.18, lit 4.7% of pixels): 70 bar, 21 panel, 13 hex ring, 12 blob, 8 disc, 1 ring; outlines 11%, fills 89%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.21 over 42 gates: 0.104 half-heights at r 0.3, 0.131 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → 0.227, r>1 → 0.230
- rings at r ≈ 0.75 (×53), 1.50 (×46); 2-fold (score 1.00); on the axes 40%, on the diagonals 14%
- stroke (outlines): 3.8 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 6.2 px, halo/core 0.06 at 4 px; core lum 0.37, ground lum 0.024
- hues (by lit area): red 0° 56%, azure 210° 44%; ground `#080508`, centre/edge ground brightness 0.95
- flow (532 object tracks, 26% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.06 (not a zoom) 0.34 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:-0.03, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.06 at r<0.45 vs 3.58 at r≥0.45; 24% of elongated objects lie along the radial direction

### Regime 3 — 13% of the clip, 38.87s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 191 lit objects on 1280×720 (lit floor 0.25, lit 16.7% of pixels): 108 blob, 58 bar, 17 disc, 7 panel, 1 ring; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.16 over 24 gates: 0.044 half-heights at r 0.3, 0.052 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.119, r0.3-0.6 → 0.264, r0.6-1.0 → 0.170, r>1 → 0.187
- rings at r ≈ 0.19 (×18), 0.38 (×8), 0.53 (×14), 1.19 (×52), 1.68 (×53); 2-fold (score 0.93); on the axes 42%, on the diagonals 15%
- stroke (outlines): 3.8 px at r<0.45, None px at r≥0.45; glow e-fold 3.6 px, halo/core 0.20 at 4 px; core lum 0.61, ground lum 0.381
- hues (by lit area): azure 210° 100%; ground `#4c6572`, centre/edge ground brightness 0.21
- flow (188 object tracks, 37% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.68 (not a zoom) 0.21 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:—, 0.39:—, 0.61:+0.02, 0.87:-0.70, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.7 at r<0.45 vs 1.87 at r≥0.45; 32% of elongated objects lie along the radial direction

### Regime 4 — 3% of the clip, 17.67s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 195 lit objects on 1280×720 (lit floor 0.24, lit 18.3% of pixels): 84 blob, 66 bar, 31 disc, 14 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.39 over 45 gates: 0.030 half-heights at r 0.3, 0.047 at r 0.9 → in between
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.028, r0.3-0.6 → 0.057, r0.6-1.0 → 0.667, r>1 → 0.250
- rings at r ≈ 0.38 (×25), 1.68 (×66); 2-fold (score 0.97); on the axes 55%, on the diagonals 12%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 16.4 px, halo/core 0.63 at 4 px; core lum 0.61, ground lum 0.056
- hues (by lit area): azure 210° 100%; ground `#0b0e12`, centre/edge ground brightness 2.33
- flow (271 object tracks, 28% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.25 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.07, 0.87:-0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.92 at r<0.45 vs 2.45 at r≥0.45; 53% of elongated objects lie along the radial direction

### Regime 5 — 2% of the clip, 22.20s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 243 lit objects on 1280×720 (lit floor 0.29, lit 12.6% of pixels): 127 blob, 61 bar, 40 disc, 15 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.18 over 55 gates: 0.035 half-heights at r 0.3, 0.042 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.045, r0.3-0.6 → 0.222, r0.6-1.0 → 0.148, r>1 → 0.157
- rings at r ≈ 0.13 (×11), 0.95 (×68), 1.68 (×59); 2-fold (score 0.98); on the axes 40%, on the diagonals 16%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 14.4 px, halo/core 0.63 at 4 px; core lum 0.66, ground lum 0.221
- hues (by lit area): azure 210° 100%; ground `#2e3a43`, centre/edge ground brightness 0.56
- flow (320 object tracks, 33% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.43 (not a zoom) 0.09 half-heights/s at r 0.5; by r → 0.07:+0.32, 0.21:+0.00, 0.39:+0.00, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.61 at r<0.45 vs 1.97 at r≥0.45; 66% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 1.13s (beat #2 r2, novelty 6.5); also every 10 s (no audio to place by) — 9 hard cuts, holds 33–100 ms (median 33); brightness 0.01–0.48 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **5.43–8.43s** — transition at 6.93s (beat #14 r2, novelty 6.4); also transition at 5.73s (beat #11 r1, novelty 2.5) — 7 hard cuts, holds 33–67 ms (median 50); brightness 0.01–0.45 — `bursts/005.43/timing.png` (every frame), `bursts/005.43/detail.png` (large), `bursts/005.43/motion.png` (paths / skeleton / t±1 in RGB)
- **11.83–14.83s** — transition at 13.33s (beat #27 r1, novelty 4.4) — 5 hard cuts, holds 33–100 ms (median 33); brightness 0.01–0.30 — `bursts/011.83/timing.png` (every frame), `bursts/011.83/detail.png` (large), `bursts/011.83/motion.png` (paths / skeleton / t±1 in RGB)
- **15.10–18.10s** — transition at 16.60s (beat #33 r1, novelty 5.7); also transition at 17.67s (beat #35 r1, novelty 3.3); also transition at 18.00s (beat #36 r4, novelty 2.6) — 11 hard cuts, holds 33–1000 ms (median 33); brightness 0.01–0.45 — `bursts/015.10/timing.png` (every frame), `bursts/015.10/detail.png` (large), `bursts/015.10/motion.png` (paths / skeleton / t±1 in RGB)
- **22.10–25.10s** — transition at 23.60s (beat #47 r1, novelty 7.7); also transition at 22.27s (beat #45 r1, novelty 3.0) — 11 hard cuts, holds 33–1000 ms (median 33); brightness 0.01–0.45 — `bursts/022.10/timing.png` (every frame), `bursts/022.10/detail.png` (large), `bursts/022.10/motion.png` (paths / skeleton / t±1 in RGB)
- **28.43–31.43s** — transition at 29.93s (beat #60 r4, novelty 4.9) — 5 hard cuts, holds 33–67 ms (median 50); brightness 0.02–0.26 — `bursts/028.43/timing.png` (every frame), `bursts/028.43/detail.png` (large), `bursts/028.43/motion.png` (paths / skeleton / t±1 in RGB)
- **31.77–34.77s** — transition at 33.27s (beat #67 r1, novelty 6.4); also transition at 34.33s (beat #69 r1, novelty 2.7) — 7 hard cuts, holds 33–67 ms (median 50); brightness 0.01–0.45 — `bursts/031.77/timing.png` (every frame), `bursts/031.77/detail.png` (large), `bursts/031.77/motion.png` (paths / skeleton / t±1 in RGB)
- **37.00–40.00s** — transition at 38.93s (beat #78 r2, novelty 7.4); also every 10 s (no audio to place by) — 9 hard cuts, holds 33–100 ms (median 33); brightness 0.01–0.48 — `bursts/037.00/timing.png` (every frame), `bursts/037.00/detail.png` (large), `bursts/037.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#080608`×0.50 `#212429`×0.27 `#414e58`×0.12 `#8fb7ca`×0.06 `#637f8e`×0.05
- 2-fold rotational symmetry (r 0.98); mirror symmetry, ~6 axes (r 0.98); centre brightness 0.09 vs edge 0.08; mean brightness 0.09, dark frames 68%; saturation 0.42
- motion: zoom mean -0.002 (|zoom| 1.731) log-scale/s, rotation mean +4.4° (|rot| 76.5°)/s, frame-to-frame activity 0.057

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 5 | -0.22 | +0.02 | -0.32 | +1.08 | +1.35 |
| 8 | 5 | -0.22 | +0.04 | -0.41 | +0.26 | +1.09 |
| 4 | 10 | +0.65 | +0.53 | +0.88 | +0.84 | +0.92 |
| 2 | 20 | +0.42 | +0.87 | +0.46 | +0.48 | +1.00 |
| 1 | 40 | +0.67 | +0.64 | +0.38 | +0.81 | +0.53 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.13 | #2 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, looks like a cut, blackout, → probably not audio-driven |
| 4.87 | #10 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, flash, → probably not audio-driven |
| 5.73 | #11 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 6.93 | #14 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, looks like a cut, blackout |
| 10.20 | #20 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, blackout, → probably not audio-driven |
| 13.33 | #27 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, flash, → probably not audio-driven |
| 16.60 | #33 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 17.67 | #35 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, flash, → probably not audio-driven |
| 18.00 | #36 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, blackout |
| 18.53 | #37 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 21.60 | #43 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, blackout, → probably not audio-driven |
| 22.27 | #45 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 23.60 | #47 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 26.60 | #53 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, flash, → probably not audio-driven |
| 26.80 | #54 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, blackout, → probably not audio-driven |
| 29.93 | #60 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 33.27 | #67 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 34.33 | #69 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 35.27 | #71 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 38.93 | #78 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, looks like a cut, flash |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): act -0.8σ, zoom -0.9σ
- beat #8 (r8, 4.00s): bright +0.8σ, act +0.9σ
- beat #12 (r4, 6.00s): zoom +1.3σ
- beat #16 (r16, 8.00s): sat +1.3σ
- beat #20 (r4, 10.00s): zoom -1.2σ
- beat #24 (r8, 12.00s): sat -0.8σ, zoom +1.4σ
- beat #28 (r4, 14.00s): sat +2.2σ
- beat #32 (r16, 16.00s): bright +0.8σ, sat -0.8σ, act +1.2σ, zoom -1.6σ
- beat #44 (r4, 22.00s): sat -0.8σ
- beat #48 (r16, 24.00s): act -1.4σ, zoom -1.0σ
- beat #52 (r4, 26.00s): sat -2.4σ
- beat #56 (r8, 28.00s): sat +0.8σ, zoom +1.1σ
- beat #60 (r4, 30.00s): zoom -1.3σ
- beat #64 (r16, 32.00s): sat -1.1σ
- beat #68 (r4, 34.00s): zoom +1.1σ
- beat #72 (r8, 36.00s): bright -0.9σ, act -0.8σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 15 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (cuts): transition at 1.13s (beat #2 r2, novelty 6.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/005.43/timing.png` … — burst 5.43–8.43s (cuts): transition at 6.93s (beat #14 r2, novelty 6.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.83/timing.png` … — burst 11.83–14.83s (cuts): transition at 13.33s (beat #27 r1, novelty 4.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.10/timing.png` … — burst 15.10–18.10s (cuts): transition at 16.60s (beat #33 r1, novelty 5.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.10/timing.png` … — burst 22.10–25.10s (cuts): transition at 23.60s (beat #47 r1, novelty 7.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/028.43/timing.png` … — burst 28.43–31.43s (cuts): transition at 29.93s (beat #60 r4, novelty 4.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/031.77/timing.png` … — burst 31.77–34.77s (cuts): transition at 33.27s (beat #67 r1, novelty 6.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/037.00/timing.png` … — burst 37.00–40.00s (cuts): transition at 38.93s (beat #78 r2, novelty 7.4). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py vjwall-1011 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank2-3.png`
- `sheets/rank2-4.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `sheets/rank1-5.png`
- `sheets/rank1-6.png`
- `sheets/rank1-7.png`
- `sheets/rank1-8.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
