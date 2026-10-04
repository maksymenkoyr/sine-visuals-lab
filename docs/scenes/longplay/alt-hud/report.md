# ref bundle: alt-hud

`tools/.cache/refs/_downloads/kMJVNerOtRI.mp4` — 4470.0+40.0s. tempo **129.2 bpm** (beat 0.464s), 60 beats, phrase phase = beat 12 (estimated, margin 1.92σ); sections at beats 4, 12, 30, 44.
Ours heard through `spectrum`: 4770 probe samples, 292 onsets vs the reference's 267.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- no beat-rank preference: the picture reacts about the same on every beat (activity z -0.57..+0.51)
- activity moves against low (r -0.45, no lag)
- cut moves against low (r -0.38, +400 ms)
- CUTS at 30 fps: 95 hard cuts in 40 s, densest second 13 cuts at 39s; holds between cuts 67–3833 ms (median 67); 111 fades over 1–4 frames (33–133 ms, median 1) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 20 single transitions: 2 on a beat with an onset, 11 off-beat with no onset (timer/scripted) — ours: onset fired at 18/20 of them
- picture changes regime at 1/4 audio section boundaries — ours: `section` shows no rise near any of them
- brightness flashes on onsets: rises z +0.32 within one 66 ms frame, settles in ~266 ms (25 strong onsets averaged)
- activity flashes on onsets: rises z +0.35 in ~800 ms, does not settle within 0.8 s (25 strong onsets averaged)
- activity is continuous across the beat (contrast 0.18σ)
- brightness is continuous across the beat (contrast 0.18σ)
- zoom speed is continuous across the beat (contrast 0.22σ)
- ours: tempo at ×1 for 73% of the clip, ×½ 0%, ×2 0%, elsewhere 27% (median 131.0 vs reference 129.2); our onset lands within 60 ms of 89% of the reference's onsets, and 81% of ours sit on one of theirs; lag -8 ms ±11

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 42% of the clip, 28.27s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 89 lit objects on 1280×720 (lit floor 0.18, lit 2.4% of pixels): 46 bar, 24 blob, 8 hex ring, 7 panel, 4 disc; outlines 9%, fills 91%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.85 over 19 gates: 0.184 half-heights at r 0.3, 0.468 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.123, r0.3-0.6 → 0.836, r0.6-1.0 → 0.620, r>1 → —
- rings at r ≈ 0.19 (×19), 0.42 (×22), 0.75 (×20); 8-fold (score 0.76); on the axes 30%, on the diagonals 45%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core 0.01 at 4 px; core lum 0.57, ground lum 0.000
- hues (by lit area): red 0° 57%, rose 330° 42%; ground `#000000`, centre/edge ground brightness 63.90
- flow (411 object tracks, 51% moving outward → mixed directions): radial speed ∝ r^1.57 (a fly-through along the axis) 0.09 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.16, 0.87:+0.19, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.89 at r<0.45 vs 2.34 at r≥0.45; 16% of elongated objects lie along the radial direction

### Regime 2 — 27% of the clip, 9.87s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 92 lit objects on 1280×720 (lit floor 0.18, lit 8.3% of pixels): 48 bar, 16 blob, 9 panel, 9 hex ring, 6 disc, 3 ring, 1 frame; outlines 16%, fills 84%; 33% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.22 over 27 gates: 0.113 half-heights at r 0.3, 0.089 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.079, r0.3-0.6 → 0.343, r0.6-1.0 → 0.144, r>1 → 0.271
- rings at r ≈ 0.24 (×11), 0.42 (×13), 0.95 (×40); 8-fold (score 0.80); on the axes 23%, on the diagonals 32%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 1.9 px, halo/core 0.04 at 4 px; core lum 0.58, ground lum 0.000
- hues (by lit area): red 0° 87%, rose 330° 13%; ground `#000000`, centre/edge ground brightness 5.40
- flow (381 object tracks, 59% moving outward → mixed directions): radial speed ∝ r^1.55 (a fly-through along the axis) 0.09 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.01, 0.39:+0.00, 0.61:—, 0.87:+0.34, 1.22:+0.23; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.33 at r<0.45 vs 3.29 at r≥0.45; 33% of elongated objects lie along the radial direction

### Regime 3 — 14% of the clip, 15.00s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 195 lit objects on 1280×720 (lit floor 0.18, lit 19.2% of pixels): 114 bar, 47 blob, 13 disc, 11 panel, 6 hex ring, 4 ring; outlines 5%, fills 95%; 70% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.23 over 34 gates: 0.580 half-heights at r 0.3, 0.151 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.070, r0.3-0.6 → 0.359, r0.6-1.0 → 0.271, r>1 → 0.183
- rings at r ≈ 0.19 (×11), 0.60 (×78), 0.84 (×24), 1.19 (×41); 8-fold (score 0.70); on the axes 35%, on the diagonals 33%
- stroke (outlines): 1.9 px at r<0.45, 2.8 px at r≥0.45; glow e-fold 9.6 px, halo/core 0.15 at 4 px; core lum 0.61, ground lum 0.000
- hues (by lit area): red 0° 92%, orange 30° 5%; ground `#000000`, centre/edge ground brightness 67.99
- flow (389 object tracks, 75% moving outward → objects fly toward the camera): radial speed ∝ r^1.62 (a fly-through along the axis) 0.12 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.01, 0.39:+0.02, 0.61:+0.15, 0.87:+0.35, 1.22:+0.45; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.54 at r<0.45 vs 3.83 at r≥0.45; 23% of elongated objects lie along the radial direction

### Regime 4 — 13% of the clip, 39.67s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 108 lit objects on 1280×720 (lit floor 0.18, lit 18.4% of pixels): 57 bar, 28 blob, 12 panel, 6 hex ring, 3 ring, 2 disc; outlines 9%, fills 91%; 60% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.27 over 20 gates: 0.279 half-heights at r 0.3, 0.208 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.089, r0.3-0.6 → 0.345, r0.6-1.0 → 0.433, r>1 → 2.027
- rings at r ≈ 0.19 (×9), 0.42 (×12), 0.95 (×56); 8-fold (score 0.73); on the axes 34%, on the diagonals 34%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 1.5 px, halo/core 0.02 at 4 px; core lum 0.54, ground lum 0.001
- hues (by lit area): red 0° 83%, rose 330° 16%; ground `#000000`, centre/edge ground brightness 296.26
- flow (131 object tracks, 34% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.72 (a flat zoom) 0.13 half-heights/s at r 0.5; by r → 0.07:-0.10, 0.21:+0.01, 0.39:+0.05, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.6 at r<0.45 vs 3.2 at r≥0.45; 32% of elongated objects lie along the radial direction

### Regime 5 — 4% of the clip, 39.60s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 27 lit objects on 1280×720 (lit floor 0.18, lit 3.3% of pixels): 17 bar, 5 panel, 2 ring, 2 blob, 1 disc; outlines 7%, fills 93%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.77 over 11 substantial objects: 0.050 half-heights at r 0.3, 0.116 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.047, r0.3-0.6 → 0.088, r0.6-1.0 → —, r>1 → 0.211
- rings at r ≈ 0.17 (×3), 0.24 (×2), 0.42 (×13), 1.06 (×4); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 3.8 px at r<0.45, None px at r≥0.45; glow e-fold 4.5 px, halo/core 0.05 at 4 px; core lum 0.20, ground lum 0.001
- hues (by lit area): red 0° 100%; ground `#000000`, centre/edge ground brightness 2.51
- flow (120 object tracks, 54% moving outward → mixed directions): radial speed ∝ r^0.97 (a flat zoom) 0.10 half-heights/s at r 0.5; by r → 0.07:-0.10, 0.21:+0.01, 0.39:+0.05, 0.61:+0.18, 0.87:+0.02, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.41 at r<0.45 vs 6.63 at r≥0.45; 18% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **4.83–7.83s** — transition at 6.33s (beat #11 r1, novelty 3.8) — 10 hard cuts, holds 67–1267 ms (median 67); 11 fades over 1–3 frames (33–100 ms, median 2); brightness 0.00–0.32 — `bursts/004.83/timing.png` (every frame), `bursts/004.83/detail.png` (large), `bursts/004.83/motion.png` (paths / skeleton / t±1 in RGB)
- **11.17–14.17s** — transition at 12.67s (beat #25 r1, novelty 3.3); also transition at 11.33s (beat #22 r2, novelty 1.7) — 5 hard cuts, holds 67–833 ms (median 117); 17 fades over 1–3 frames (33–100 ms, median 1); brightness 0.01–0.23 — `bursts/011.17/timing.png` (every frame), `bursts/011.17/detail.png` (large), `bursts/011.17/motion.png` (paths / skeleton / t±1 in RGB)
- **17.90–20.90s** — transition at 19.40s (beat #39 r1, novelty 2.4) — 7 hard cuts, holds 67–200 ms (median 117); 11 fades over 1–3 frames (33–100 ms, median 1); brightness 0.01–0.28 — `bursts/017.90/timing.png` (every frame), `bursts/017.90/detail.png` (large), `bursts/017.90/motion.png` (paths / skeleton / t±1 in RGB)
- **24.37–27.37s** — transition at 25.87s (beat #53 r1, novelty 2.6); also transition at 25.00s (beat #52 r8, novelty 2.1) — 6 hard cuts, holds 67–200 ms (median 67); 11 fades over 1–4 frames (33–133 ms, median 1); brightness 0.01–0.26 — `bursts/024.37/timing.png` (every frame), `bursts/024.37/detail.png` (large), `bursts/024.37/motion.png` (paths / skeleton / t±1 in RGB)
- **27.30–30.30s** — transition at 28.80s (beat #59 r1, novelty 2.6); also transition at 30.00s (beat #59 r1, novelty 2.3) — 3 hard cuts, holds 1300–1300 ms (median 1300); 6 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.23 — `bursts/027.30/timing.png` (every frame), `bursts/027.30/detail.png` (large), `bursts/027.30/motion.png` (paths / skeleton / t±1 in RGB)
- **31.17–34.17s** — transition at 32.67s (beat #59 r1, novelty 4.2); also transition at 31.20s (beat #59 r1, novelty 1.6) — 15 hard cuts, holds 67–967 ms (median 67); 9 fades over 1–3 frames (33–100 ms, median 1); brightness 0.01–0.29 — `bursts/031.17/timing.png` (every frame), `bursts/031.17/detail.png` (large), `bursts/031.17/motion.png` (paths / skeleton / t±1 in RGB)
- **33.57–36.57s** — transition at 35.07s (beat #59 r1, novelty 5.5); also transition at 36.27s (beat #59 r1, novelty 4.1); also transition at 33.80s (beat #59 r1, novelty 2.1) — 10 hard cuts, holds 67–1100 ms (median 67); 10 fades over 1–1 frames (33–33 ms, median 1); brightness 0.00–0.21 — `bursts/033.57/timing.png` (every frame), `bursts/033.57/detail.png` (large), `bursts/033.57/motion.png` (paths / skeleton / t±1 in RGB)
- **35.90–38.90s** — transition at 37.40s (beat #59 r1, novelty 5.3); also transition at 38.73s (beat #59 r1, novelty 5.2); also transition at 39.20s (beat #59 r1, novelty 4.5) — 20 hard cuts, holds 67–967 ms (median 67); 11 fades over 1–3 frames (33–100 ms, median 1); brightness 0.00–0.23 — `bursts/035.90/timing.png` (every frame), `bursts/035.90/detail.png` (large), `bursts/035.90/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#010000`×0.83 `#f89090`×0.08 `#d71d40`×0.04 `#5d0e16`×0.04 `#420977`×0.01
- 9-fold rotational symmetry (r 0.33); mirror symmetry, ~3 axes (r 0.63); centre brightness 0.08 vs edge 0.11; mean brightness 0.10, dark frames 50%; saturation 0.24
- motion: zoom mean +0.367 (|zoom| 0.422) log-scale/s, rotation mean -9.3° (|rot| 10.0°)/s, frame-to-frame activity 0.094

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 3 | -0.57 | -0.83 | -0.58 | -0.17 | -0.20 | 3/3 |
| 8 | 4 | -0.11 | +0.07 | +0.12 | +0.01 | -0.20 | 4/4 |
| 4 | 8 | +0.51 | +0.64 | +0.86 | -0.08 | -0.20 | 8/8 |
| 2 | 15 | +0.16 | +0.13 | +0.34 | +0.12 | -0.21 | 15/15 |
| 1 | 30 | +0.27 | +0.33 | +0.43 | +0.05 | -0.20 | 30/30 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- activity ~ low: r -0.45 at +0 ms
- cut ~ low: r -0.38 at +400 ms
- cut ~ mid: r -0.31 at +66 ms
- cut ~ rms: r -0.31 at +66 ms
- activity ~ rms: r -0.27 at +66 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 2.73 | #3 | -30 | 1 | +0.3 | +0.1 | +1.5 | +1.5 | on beat (r1), no onset, mid jumps, high jumps, ours: onset yes, bpm 121 |
| 6.33 | #11 | -122 | 1 | -0.5 | -0.5 | -0.5 | -1.0 | off-beat (-0.26 beat from r1), no onset, high drops, flash, → probably not audio-driven, ours: onset no, bpm 129 |
| 10.07 | #19 | -11 | 1 | +4.7 | +0.4 | +0.5 | +0.5 | on beat (r1), hard onset, flash, ours: onset yes, bpm 131 |
| 11.33 | #22 | -137 | 2 | +0.1 | -0.1 | -0.3 | +0.1 | off-beat (-0.30 beat from r2), no onset, → probably not audio-driven, ours: onset yes, bpm 131 |
| 12.67 | #25 | -174 | 1 | +2.6 | -0.6 | +0.1 | +0.1 | off-beat (-0.37 beat from r1), hard onset, blackout, ours: onset yes, bpm 131 |
| 15.07 | #30 | -50 | 2 | +3.3 | +0.3 | +0.4 | +1.6 | on beat (r2), hard onset, high jumps, section boundary, flash, ours: onset yes, bpm 131 |
| 19.40 | #39 | +151 | 1 | -0.2 | +0.0 | +0.7 | -0.5 | off-beat (+0.32 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 131 |
| 23.93 | #49 | +110 | 1 | -0.1 | +0.4 | -0.4 | -1.2 | off-beat (+0.24 beat from r1), no onset, high drops, blackout, → probably not audio-driven, ours: onset yes, bpm 131 |
| 25.00 | #52 | -194 | 8 | +0.9 | +0.1 | +0.3 | +0.2 | off-beat (-0.42 beat from r8), onset, flash, ours: onset yes, bpm 131 |
| 25.87 | #53 | +209 | 1 | -0.0 | +0.8 | -0.7 | -0.2 | off-beat (+0.45 beat from r1), no onset, blackout, → probably not audio-driven, ours: onset yes, bpm 131 |
| 28.80 | #59 | +402 | 1 | +2.5 | -0.9 | +0.5 | +1.0 | off-beat (+0.87 beat from r1), hard onset, high jumps, ours: onset yes, bpm 131 |
| 30.00 | #59 | +1602 | 1 | +0.6 | -0.5 | -0.4 | -0.1 | off-beat (+3.45 beat from r1), no onset, flash, → probably not audio-driven, ours: onset yes, bpm 131 |
| 31.20 | #59 | +2802 | 1 | +1.6 | +0.2 | -0.0 | +0.2 | off-beat (+6.03 beat from r1), hard onset, flash, ours: onset no, bpm 131 |
| 32.67 | #59 | +4269 | 1 | +0.1 | +0.6 | +0.3 | -0.1 | off-beat (+9.19 beat from r1), no onset, blackout, → probably not audio-driven, ours: onset yes, bpm 130 |
| 33.80 | #59 | +5402 | 1 | -0.0 | +1.1 | +0.2 | +0.0 | off-beat (+11.63 beat from r1), no onset, low jumps, → probably not audio-driven, ours: onset yes, bpm 176 |
| 35.07 | #59 | +6669 | 1 | -0.2 | -0.5 | -0.2 | -0.0 | off-beat (+14.36 beat from r1), no onset, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 176 |
| 36.27 | #59 | +7869 | 1 | -0.1 | +0.7 | -0.6 | -0.1 | off-beat (+16.94 beat from r1), no onset, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 157 |
| 37.40 | #59 | +9002 | 1 | -0.3 | +0.2 | -0.8 | -0.3 | off-beat (+19.38 beat from r1), no onset, looks like a cut, flash, → probably not audio-driven, ours: onset yes, bpm 156 |
| 38.73 | #59 | +10335 | 1 | +1.6 | -1.3 | +1.7 | -0.2 | off-beat (+22.26 beat from r1), hard onset, low drops, mid jumps, flash, ours: onset yes, bpm 156 |
| 39.20 | #59 | +10802 | 1 | +2.0 | +1.6 | -0.6 | +0.0 | off-beat (+23.26 beat from r1), hard onset, low jumps, flash, ours: onset yes, bpm 131 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #8 (r4, 5.08s): bright +1.8σ, sat +1.5σ, act +1.6σ
- beat #12 (r16, 6.90s): sat -1.5σ, act -1.4σ
- beat #16 (r4, 8.71s): sat +1.0σ
- beat #20 (r8, 10.54s): sat -0.8σ
- beat #24 (r4, 12.38s): bright -1.0σ
- beat #36 (r8, 17.88s): sat -1.0σ
- beat #40 (r4, 19.69s): bright -1.1σ
- beat #48 (r4, 23.36s): sat +1.3σ
- beat #52 (r8, 25.19s): act +1.1σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #0 | 1.30 | 4 | +1.3 | +0.6 | -0.4 | +0.2 | +1.7 | yes | 167 |
| #4 S | 3.30 | 8 | +1.4 | +0.9 | -1.0 | -0.8 | -0.5 | yes | 121 |
| #8 | 5.09 | 4 | -0.0 | -1.1 | -0.5 | +1.4 | +1.2 | yes | 120 |
| #12 S | 6.90 | 16 | +1.1 | +1.6 | +0.5 | -0.6 | -0.8 | yes | 129 |
| #16 | 8.71 | 4 | +3.0 | +0.5 | +0.2 | +0.3 | +1.1 | yes | 129 |
| #20 | 10.54 | 8 | +3.8 | +0.4 | +0.3 | -0.3 | -0.2 | yes | 131 |
| #24 | 12.38 | 4 | +1.1 | +0.5 | +0.4 | +2.1 | +1.6 | yes | 131 |
| #28 | 14.21 | 16 | +4.3 | +0.9 | +0.3 | -0.2 | -0.7 | yes | 131 |
| #30 S | 15.12 | 2 | +3.3 | +0.1 | +0.4 | +1.6 | +1.8 | yes | 131 |
| #32 | 16.05 | 4 | +2.1 | -0.2 | +0.4 | -1.1 | -0.2 | yes | 131 |
| #36 | 17.88 | 8 | +2.4 | +0.3 | +0.5 | -0.9 | -0.7 | yes | 131 |
| #40 | 19.69 | 4 | +1.1 | +0.1 | +0.6 | +1.8 | +0.5 | yes | 131 |
| #44 S | 21.55 | 16 | +2.2 | +0.8 | +0.6 | -0.9 | -0.4 | yes | 131 |
| #48 | 23.36 | 4 | +0.5 | +0.5 | +0.6 | -0.6 | -0.2 | yes | 131 |
| #52 | 25.19 | 8 | +3.3 | +0.3 | +0.5 | +1.6 | +1.7 | yes | 131 |
| #56 | 27.03 | 4 | +0.5 | +0.3 | +0.7 | +0.1 | -0.7 | yes | 131 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 14 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/004.83/timing.png` … — burst 4.83–7.83s (cuts): transition at 6.33s (beat #11 r1, novelty 3.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.17/timing.png` … — burst 11.17–14.17s (cuts): transition at 12.67s (beat #25 r1, novelty 3.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/017.90/timing.png` … — burst 17.90–20.90s (cuts): transition at 19.40s (beat #39 r1, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/024.37/timing.png` … — burst 24.37–27.37s (cuts): transition at 25.87s (beat #53 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/027.30/timing.png` … — burst 27.30–30.30s (cuts): transition at 28.80s (beat #59 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/031.17/timing.png` … — burst 31.17–34.17s (cuts): transition at 32.67s (beat #59 r1, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/033.57/timing.png` … — burst 33.57–36.57s (cuts): transition at 35.07s (beat #59 r1, novelty 5.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/035.90/timing.png` … — burst 35.90–38.90s (cuts): transition at 37.40s (beat #59 r1, novelty 5.3). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py alt-hud --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- `sheets/rank1-6.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
