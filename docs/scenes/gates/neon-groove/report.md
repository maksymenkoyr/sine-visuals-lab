# ref bundle: neon-groove

`tools/.cache/_downloads/4PsXO3JsQdg_120-240.mp4` — 0.0+45.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- 34 single transitions at t 0.3, 2.5, 3.7, 6.0, 6.5, 7.5, 8.0, 10.2, 11.4, 13.7, 14.2, 15.2, 15.7, 17.9, 19.1, 21.3, 21.9, 22.9, 23.3, 25.5, 26.7, 29.0, 29.5, 30.5, 31.0, 33.2, 34.4, 36.7, 37.2, 38.2, 38.7, 40.9, 42.1, 44.3
- rotates counter-clockwise continuously (+46.1°/s)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 30% of the clip, 42.73s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 188 lit objects on 1280×720 (lit floor 0.18, lit 4.9% of pixels): 93 bar, 64 blob, 24 disc, 7 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.02 over 31 gates: 0.047 half-heights at r 0.3, 0.048 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.269, r0.3-0.6 → 0.184, r0.6-1.0 → 0.120, r>1 → 0.248
- rings at r ≈ 0.21 (×14), 0.38 (×43), 0.60 (×69), 0.95 (×27); 4-fold (score 0.94); on the axes 36%, on the diagonals 30%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 13.4 px, halo/core 0.19 at 4 px; core lum 0.46, ground lum 0.020
- hues (by lit area): red 0° 35%, orange 30° 28%, cyan 180° 19%, azure 210° 8%; ground `#030509`, centre/edge ground brightness 1.00
- flow (441 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.24 (not a zoom) 0.49 half-heights/s at r 0.5; by r → 0.07:-0.09, 0.21:+0.45, 0.39:-0.27, 0.61:-0.35, 0.87:-0.38, 1.22:-0.52; rotation +35.8°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.62 at r<0.45 vs 3.09 at r≥0.45; 60% of elongated objects lie along the radial direction

### Regime 2 — 28% of the clip, 35.87s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 120 lit objects on 1280×720 (lit floor 0.18, lit 5.0% of pixels): 72 bar, 27 blob, 16 disc, 4 panel, 1 ring; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.89 over 21 gates: 0.062 half-heights at r 0.3, 0.165 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.142, r0.3-0.6 → 0.132, r0.6-1.0 → 0.610, r>1 → 0.278
- rings at r ≈ 0.07 (×6), 0.12 (×15), 0.34 (×26), 0.53 (×28), 1.06 (×20); 2-fold (score 0.97); on the axes 22%, on the diagonals 24%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 33.4 px, halo/core 0.27 at 4 px; core lum 0.48, ground lum 0.034
- hues (by lit area): azure 210° 50%, cyan 180° 45%; ground `#000a0f`, centre/edge ground brightness 1.00
- flow (375 object tracks, 39% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.13 (a flat zoom) 0.32 half-heights/s at r 0.5; by r → 0.07:+0.02, 0.21:+0.00, 0.39:+0.05, 0.61:+0.00, 0.87:-0.37, 1.22:+0.00; rotation +35.3°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.82 at r<0.45 vs 4.36 at r≥0.45; 50% of elongated objects lie along the radial direction

### Regime 3 — 17% of the clip, 6.40s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 51 lit objects on 1280×720 (lit floor 0.24, lit 5.9% of pixels): 22 bar, 14 blob, 9 disc, 3 panel, 3 hex ring; outlines 6%, fills 94%; 67% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^1.55 over 14 gates: 0.026 half-heights at r 0.3, 0.143 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.031, r0.3-0.6 → 0.028, r0.6-1.0 → 0.479, r>1 → 0.575
- rings at r ≈ 0.08 (×4), 0.12 (×4), 0.30 (×7), 0.53 (×13), 0.75 (×8), 1.06 (×7), 1.50 (×5); 2-fold (score 0.96); on the axes 61%, on the diagonals 33%
- stroke (outlines): 1.9 px at r<0.45, 7.6 px at r≥0.45; glow e-fold 24.2 px, halo/core 0.43 at 4 px; core lum 0.80, ground lum 0.202
- hues (by lit area): cyan 180° 69%, azure 210° 30%; ground `#01432a`, centre/edge ground brightness 0.66
- flow (177 object tracks, 36% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.99 (a flat zoom) 0.22 half-heights/s at r 0.5; by r → 0.07:-0.00, 0.21:+0.04, 0.39:-0.10, 0.61:-0.07, 0.87:-0.50, 1.22:-0.64; rotation +35.7°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.98 at r<0.45 vs 2.13 at r≥0.45; 50% of elongated objects lie along the radial direction

### Regime 4 — 17% of the clip, 17.67s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 199 lit objects on 1280×720 (lit floor 0.18, lit 7.0% of pixels): 106 bar, 59 blob, 22 disc, 11 hex ring, 1 ring; outlines 6%, fills 94%; 67% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.13 over 30 gates: 0.081 half-heights at r 0.3, 0.093 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.094, r0.3-0.6 → 0.174, r0.6-1.0 → 0.104, r>1 → 0.336
- rings at r ≈ 0.13 (×11), 0.42 (×42), 0.67 (×63), 1.06 (×17); 2-fold (score 0.97); on the axes 32%, on the diagonals 26%
- stroke (outlines): 1.9 px at r<0.45, 8.2 px at r≥0.45; glow e-fold 26.1 px, halo/core 0.27 at 4 px; core lum 0.62, ground lum 0.060
- hues (by lit area): azure 210° 54%, cyan 180° 28%, rose 330° 5%; ground `#001217`, centre/edge ground brightness 1.00
- flow (578 object tracks, 53% moving outward → mixed directions): radial speed ∝ r^0.65 (a flat zoom) 0.16 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:+0.09, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.13; rotation +34.4°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.36 at r<0.45 vs 3.04 at r≥0.45; 34% of elongated objects lie along the radial direction

### Regime 5 — 7% of the clip, 7.93s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 200 lit objects on 1280×720 (lit floor 0.29, lit 8.9% of pixels): 86 blob, 80 bar, 29 disc, 5 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.12 over 31 gates: 0.038 half-heights at r 0.3, 0.033 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.399, r0.3-0.6 → 0.099, r0.6-1.0 → 0.060, r>1 → 0.905
- rings at r ≈ 0.17 (×11), 0.30 (×35), 0.60 (×40), 0.95 (×56), 1.50 (×20); 2-fold (score 0.98); on the axes 37%, on the diagonals 28%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 42.3 px, halo/core 0.45 at 4 px; core lum 0.80, ground lum 0.191
- hues (by lit area): yellow 60° 73%, orange 30° 18%; ground `#582900`, centre/edge ground brightness 1.00
- flow (505 object tracks, 68% moving outward → objects fly toward the camera): radial speed ∝ r^1.19 (a flat zoom) 0.15 half-heights/s at r 0.5; by r → 0.07:+0.03, 0.21:+0.03, 0.39:+0.06, 0.61:+0.10, 0.87:+0.31, 1.22:+0.46; rotation +36.3°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.4 at r<0.45 vs 2.88 at r≥0.45; 35% of elongated objects lie along the radial direction

## Look, as statistics

- palette (share of pixels): `#060e11`×0.58 `#076466`×0.19 `#5e351c`×0.10 `#42cad7`×0.09 `#c2894a`×0.05
- 2-fold rotational symmetry (r 0.99); mirror symmetry, ~4 axes (r 0.94); centre brightness 0.20 vs edge 0.12; mean brightness 0.13, dark frames 45%; saturation 0.82
- motion: zoom mean -0.254 (|zoom| 1.393) log-scale/s, rotation mean +46.1° (|rot| 47.5°)/s, frame-to-frame activity 0.112

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 6 | +0.13 | +0.32 | +0.10 | -0.05 | +0.69 |
| 8 | 6 | -0.18 | +0.04 | -0.28 | +1.04 | +0.57 |
| 4 | 11 | +1.06 | +1.18 | +1.37 | +0.42 | +1.57 |
| 2 | 22 | +0.54 | +0.68 | +0.59 | +0.63 | +1.09 |
| 1 | 45 | +0.84 | +0.89 | +0.79 | +0.80 | +0.79 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.33 | #1 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 2.53 | #5 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 3.73 | #7 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 6.00 | #12 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 6.53 | #13 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 7.53 | #15 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, blackout |
| 8.00 | #16 | +0 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 10.20 | #20 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 11.40 | #23 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 13.67 | #27 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 14.20 | #28 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 15.20 | #30 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, blackout, → probably not audio-driven |
| 15.67 | #31 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 17.87 | #36 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 19.07 | #38 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 21.33 | #43 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 21.87 | #44 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 22.87 | #46 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, blackout, → probably not audio-driven |
| 23.33 | #47 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 25.53 | #51 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 26.73 | #53 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 29.00 | #58 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 29.53 | #59 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 30.53 | #61 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, blackout |
| 31.00 | #62 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 33.20 | #66 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 34.40 | #69 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, → probably not audio-driven |
| 36.67 | #73 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 37.20 | #74 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 38.20 | #76 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, blackout, → probably not audio-driven |
| 38.67 | #77 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 40.87 | #82 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 42.07 | #84 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 44.33 | #89 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): bright +1.2σ, act +1.2σ
- beat #8 (r8, 4.00s): sat -1.2σ
- beat #12 (r4, 6.00s): bright +0.8σ
- beat #16 (r16, 8.00s): bright -0.8σ
- beat #20 (r4, 10.00s): bright +1.2σ, act +1.3σ
- beat #28 (r4, 14.00s): sat +0.9σ
- beat #32 (r16, 16.00s): bright -1.4σ, sat +1.0σ, act -1.6σ
- beat #36 (r4, 18.00s): rot -1.1σ
- beat #40 (r8, 20.00s): sat -0.9σ, abszoom -1.0σ
- beat #48 (r16, 24.00s): bright -0.8σ, act -1.4σ
- beat #52 (r4, 26.00s): sat +0.9σ, zoom -0.9σ
- beat #56 (r8, 28.00s): abszoom -1.6σ
- beat #64 (r16, 32.00s): act -0.9σ
- beat #68 (r4, 34.00s): bright -0.9σ
- beat #72 (r8, 36.00s): abszoom -1.0σ
- beat #76 (r4, 38.00s): act +0.8σ
- beat #84 (r4, 42.00s): rot +1.0σ
- beat #88 (r8, 44.00s): bright +1.0σ, act +0.9σ

## Files

- `keyframes.png` — 14 tiles: regimes, transition before/after, phrase starts. Open this first.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
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
