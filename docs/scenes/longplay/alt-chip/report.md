# ref bundle: alt-chip

`tools/.cache/refs/_downloads/kMJVNerOtRI.mp4` — 3070.0+40.0s. tempo **129.2 bpm** (beat 0.464s), 82 beats, phrase phase = beat 5 (estimated, margin 1.61σ); sections at beats 1, 5, 36, 53, 72.
Ours heard through `spectrum`: 4767 probe samples, 296 onsets vs the reference's 302.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- brightness reacts most at phrase starts (rank 16 z +1.51 vs rank 4 +0.53) — ours: onset fires on 5/5 of those beats
- colour change reacts most at phrase starts (rank 16 z +1.06 vs rank 4 +0.14) — ours: onset fires on 5/5 of those beats
- no visual metric tracks a band continuously (all |r| < 0.2) — the sync, if any, is event-based
- CUTS at 30 fps: 118 hard cuts in 40 s, densest second 10 cuts at 10s; holds between cuts 67–2467 ms (median 67); 122 fades over 1–4 frames (33–133 ms, median 1) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 19 single transitions: 5 on a beat with an onset, 7 off-beat with no onset (timer/scripted) — ours: onset fired at 18/19 of them
- picture changes regime at 1/5 audio section boundaries — ours: `section` shows no rise near any of them
- zoom direction changes at beat #1 (r4, 2.6s, +1.7σ)
- zoom direction changes at beat #13 (r8, 8.2s, +1.4σ)
- brightness does not flash on onsets (rise z +0.15 over 31 strong onsets)
- activity does not flash on onsets (rise z +0.00 over 31 strong onsets)
- activity is continuous across the beat (contrast 0.08σ)
- brightness is continuous across the beat (contrast 0.20σ)
- zoom speed is continuous across the beat (contrast 0.11σ)
- zooms in continuously (+1.617 log-scale/s, i.e. ×5.04 per second)
- rotates clockwise continuously (-96.6°/s)
- ours: tempo at ×1 for 100% of the clip, ×½ 0%, ×2 0%, elsewhere 0% (median 130.0 vs reference 129.2); our onset lands within 60 ms of 90% of the reference's onsets, and 92% of ours sit on one of theirs; lag -11 ms ±11

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 56% of the clip, 29.93s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 38 lit objects on 1280×720 (lit floor 0.18, lit 0.9% of pixels): 16 blob, 14 bar, 4 panel, 4 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.05 over 8 gates: 0.015 half-heights at r 0.3, 0.005 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.142, r0.3-0.6 → 0.367, r0.6-1.0 → —, r>1 → —
- rings at r ≈ 0.12 (×7), 0.17 (×12), 0.34 (×2); 4-fold (score 0.87); on the axes 45%, on the diagonals 32%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.01 at 4 px; core lum 0.66, ground lum 0.000
- hues (by lit area): cyan 180° 91%, azure 210° 9%; ground `#000000`, centre/edge ground brightness 0.10
- flow (142 object tracks, 16% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.32 (not a zoom) 0.14 half-heights/s at r 0.5; by r → 0.07:+0.03, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:—, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.56 at r<0.45 vs None at r≥0.45; 13% of elongated objects lie along the radial direction

### Regime 2 — 17% of the clip, 16.87s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.000
- hues (by lit area): ; ground `#000000`, centre/edge ground brightness 0.00
- flow (198 object tracks, 32% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.94 (a fly-through along the axis) 0.40 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 3 — 11% of the clip, 39.33s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 220 lit objects on 1280×720 (lit floor 0.18, lit 13.7% of pixels): 111 bar, 63 blob, 35 disc, 9 panel, 2 frame; outlines 2%, fills 98%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^1.01 over 44 gates: 0.015 half-heights at r 0.3, 0.045 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.102, r0.6-1.0 → 0.125, r>1 → 0.490
- rings at r ≈ 0.84 (×156); 8-fold (score 0.91); on the axes 33%, on the diagonals 30%
- stroke (outlines): 5.7 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 29.6 px, halo/core 0.09 at 4 px; core lum 0.71, ground lum 0.012
- hues (by lit area): rose 330° 30%, violet 270° 23%, red 0° 23%, magenta 300° 20%; ground `#030203`, centre/edge ground brightness 2605.30
- flow (792 object tracks, 49% moving outward → mixed directions): radial speed ∝ r^0.09 (not a zoom) 0.30 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:-0.01, 0.39:+0.21, 0.61:+0.11, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.43 at r<0.45 vs 3.02 at r≥0.45; 51% of elongated objects lie along the radial direction

### Regime 4 — 9% of the clip, 4.73s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 20 lit objects on 1280×720 (lit floor 0.18, lit 0.2% of pixels): 12 blob, 6 bar, 2 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.10 over 10 substantial objects: 0.053 half-heights at r 0.3, 0.047 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.090, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ 0.21 (×7); 4-fold (score 0.60); on the axes 25%, on the diagonals 20%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 3.7 px, halo/core 0.11 at 4 px; core lum 0.26, ground lum 0.000
- hues (by lit area): azure 210° 53%, blue 240° 23%, cyan 180° 14%, spring 150° 8%; ground `#000000`, centre/edge ground brightness 23.44
- flow (124 object tracks, 56% moving outward → mixed directions): radial speed ∝ r^0.84 (a flat zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:-0.04, 0.21:+0.03, 0.39:+0.06, 0.61:+0.00, 0.87:+0.01, 1.22:+0.01; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.25 at r<0.45 vs None at r≥0.45; 12% of elongated objects lie along the radial direction

### Regime 5 — 7% of the clip, 31.00s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 308 lit objects on 1280×720 (lit floor 0.18, lit 19.4% of pixels): 159 bar, 98 blob, 31 disc, 10 panel, 5 hex ring, 4 frame, 1 ring; outlines 3%, fills 97%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.91 over 48 gates: 0.156 half-heights at r 0.3, 0.057 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.528, r0.3-0.6 → 0.099, r0.6-1.0 → 0.368, r>1 → 0.149
- rings at r ≈ 1.19 (×179); 2-fold (score 0.95); on the axes 50%, on the diagonals 17%
- stroke (outlines): 5.2 px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core 0.08 at 4 px; core lum 0.74, ground lum 0.076
- hues (by lit area): violet 270° 35%, rose 330° 27%, red 0° 19%, magenta 300° 13%; ground `#141216`, centre/edge ground brightness 461.60
- flow (566 object tracks, 26% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.15 (not a zoom) 0.19 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.17 at r<0.45 vs 3.25 at r≥0.45; 57% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **9.17–12.17s** — transition at 10.67s (beat #18 r1, novelty 4.7); also transition at 10.47s (beat #18 r1, novelty 3.5) — 10 hard cuts, holds 67–167 ms (median 67); 11 fades over 1–3 frames (33–100 ms, median 1); brightness 0.00–0.24 — `bursts/009.17/timing.png` (every frame), `bursts/009.17/detail.png` (large), `bursts/009.17/motion.png` (paths / skeleton / t±1 in RGB)
- **12.17–15.17s** — transition at 13.67s (beat #25 r4, novelty 4.6); also phrase start, beat #21 (11.87s) — 10 hard cuts, holds 67–167 ms (median 67); 6 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.21 — `bursts/012.17/timing.png` (every frame), `bursts/012.17/detail.png` (large), `bursts/012.17/motion.png` (paths / skeleton / t±1 in RGB)
- **15.03–18.03s** — transition at 16.53s (beat #31 r2, novelty 5.1) — 8 hard cuts, holds 67–167 ms (median 67); 11 fades over 1–4 frames (33–133 ms, median 1); brightness 0.00–0.26 — `bursts/015.03/timing.png` (every frame), `bursts/015.03/detail.png` (large), `bursts/015.03/motion.png` (paths / skeleton / t±1 in RGB)
- **17.97–20.97s** — transition at 19.47s (beat #37 r16, novelty 5.4); also transition at 19.07s (beat #37 r16, novelty 2.4); also phrase start, beat #37 (19.25s) — 10 hard cuts, holds 67–300 ms (median 67); 9 fades over 1–2 frames (33–67 ms, median 2); brightness 0.00–0.27 — `bursts/017.97/timing.png` (every frame), `bursts/017.97/detail.png` (large), `bursts/017.97/motion.png` (paths / skeleton / t±1 in RGB)
- **20.97–23.97s** — transition at 22.47s (beat #44 r1, novelty 6.7); also transition at 22.67s (beat #44 r1, novelty 2.5) — 13 hard cuts, holds 67–167 ms (median 67); 12 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.31 — `bursts/020.97/timing.png` (every frame), `bursts/020.97/detail.png` (large), `bursts/020.97/motion.png` (paths / skeleton / t±1 in RGB)
- **23.90–26.90s** — transition at 25.40s (beat #50 r1, novelty 6.0); also transition at 25.07s (beat #50 r1, novelty 3.6) — 9 hard cuts, holds 67–167 ms (median 67); 9 fades over 1–3 frames (33–100 ms, median 1); brightness 0.00–0.27 — `bursts/023.90/timing.png` (every frame), `bursts/023.90/detail.png` (large), `bursts/023.90/motion.png` (paths / skeleton / t±1 in RGB)
- **26.77–29.77s** — transition at 28.27s (beat #57 r4, novelty 6.4); also transition at 28.07s (beat #56 r1, novelty 4.9); also phrase start, beat #53 (26.63s) — 11 hard cuts, holds 67–167 ms (median 67); 13 fades over 1–3 frames (33–100 ms, median 1); brightness 0.00–0.32 — `bursts/026.77/timing.png` (every frame), `bursts/026.77/detail.png` (large), `bursts/026.77/motion.png` (paths / skeleton / t±1 in RGB)
- **29.70–32.70s** — transition at 31.20s (beat #63 r2, novelty 4.9) — 9 hard cuts, holds 67–167 ms (median 67); 10 fades over 1–3 frames (33–100 ms, median 1); brightness 0.00–0.28 — `bursts/029.70/timing.png` (every frame), `bursts/029.70/detail.png` (large), `bursts/029.70/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#010000`×0.90 `#e2d1ee`×0.04 `#bc0a0c`×0.03 `#682c4a`×0.02 `#d18b77`×0.01
- mirror symmetry, ~1 axis (r 0.61); centre brightness 0.27 vs edge 0.06; mean brightness 0.08, dark frames 71%; saturation 0.15
- motion: zoom mean +1.617 (|zoom| 1.917) log-scale/s, rotation mean -96.6° (|rot| 115.5°)/s, frame-to-frame activity 0.115

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 5 | +1.12 | +1.06 | +1.51 | +0.28 | -0.13 | 5/5 |
| 8 | 5 | -0.24 | -0.17 | +0.08 | +0.31 | +0.32 | 5/5 |
| 4 | 11 | +0.20 | +0.14 | +0.53 | +0.22 | +0.43 | 11/11 |
| 2 | 20 | +0.36 | +0.30 | +0.66 | +0.31 | +0.39 | 20/20 |
| 1 | 41 | +0.27 | +0.30 | +0.51 | +0.23 | +0.27 | 38/41 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.80 | #0 | -383 | 1 | +0.7 | -0.2 | +0.5 | -0.4 | off-beat (-0.82 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 130 |
| 4.87 | #6 | -79 | 1 | -0.2 | +0.0 | -0.7 | +1.5 | on beat (r1), no onset, high jumps, ours: onset yes, bpm 130 |
| 7.80 | #12 | +68 | 1 | +0.8 | -0.5 | +1.2 | +0.0 | on beat (r1), onset, mid jumps, flash, ours: onset yes, bpm 130 |
| 10.47 | #18 | -29 | 1 | +0.1 | -0.1 | +0.7 | +0.5 | on beat (r1), no onset, ours: onset yes, bpm 130 |
| 10.67 | #18 | +171 | 1 | +0.6 | +0.1 | +0.6 | -0.6 | off-beat (+0.37 beat from r1), no onset, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 13.67 | #25 | -56 | 4 | +1.7 | -0.0 | +0.3 | +1.6 | on beat (r4), hard onset, high jumps, flash, ours: onset yes, bpm 130 |
| 16.53 | #31 | +47 | 2 | +0.6 | -0.5 | +1.0 | +0.5 | on beat (r2), no onset, flash, ours: onset yes, bpm 130 |
| 19.07 | #37 | -183 | 16 | -0.2 | +1.1 | -1.2 | -0.2 | off-beat (-0.39 beat from r16), no onset, low jumps, mid drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 19.47 | #37 | +217 | 16 | +0.6 | +0.2 | -1.6 | -1.3 | off-beat (+0.47 beat from r16), no onset, mid drops, high drops, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 22.47 | #44 | -10 | 1 | +1.9 | -0.3 | +0.0 | -0.0 | on beat (r1), hard onset, looks like a cut, ours: onset yes, bpm 130 |
| 22.67 | #44 | +190 | 1 | +0.1 | +0.5 | +1.4 | -0.1 | off-beat (+0.41 beat from r1), no onset, mid jumps, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 25.07 | #50 | -197 | 1 | +2.3 | +0.1 | -0.2 | -0.2 | off-beat (-0.42 beat from r1), hard onset, ours: onset yes, bpm 130 |
| 25.40 | #50 | +137 | 1 | +2.5 | -0.3 | +1.5 | -0.6 | off-beat (+0.29 beat from r1), hard onset, mid jumps, looks like a cut, flash, ours: onset yes, bpm 130 |
| 28.07 | #56 | +40 | 1 | +1.1 | -1.6 | +0.6 | +1.1 | on beat (r1), onset, low drops, high jumps, ours: onset yes, bpm 130 |
| 28.27 | #57 | -224 | 4 | +2.3 | +1.3 | -2.3 | -1.0 | off-beat (-0.48 beat from r4), hard onset, low jumps, mid drops, looks like a cut, flash, ours: onset yes, bpm 130 |
| 31.20 | #63 | -54 | 2 | +2.8 | -1.2 | +1.4 | +2.0 | on beat (r2), hard onset, low drops, mid jumps, high jumps, looks like a cut, blackout, ours: onset yes, bpm 130 |
| 34.13 | #69 | +116 | 16 | +0.0 | -0.3 | +1.0 | -0.9 | off-beat (+0.25 beat from r16), no onset, → probably not audio-driven, ours: onset no, bpm 130 |
| 37.13 | #76 | -135 | 1 | +0.2 | +0.5 | -2.3 | -1.1 | off-beat (-0.29 beat from r1), no onset, mid drops, high drops, blackout, → probably not audio-driven, ours: onset yes, bpm 130 |
| 39.00 | #80 | -102 | 1 | +1.2 | -1.0 | -1.5 | +2.2 | off-beat (-0.22 beat from r1), onset, mid drops, high jumps, flash, ours: onset yes, bpm 130 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #1 (r4, 2.65s): act -0.9σ, zoom +1.7σ, abszoom +1.9σ, rot -1.6σ
- beat #9 (r4, 6.34s): zoom -1.1σ, rot +1.2σ
- beat #13 (r8, 8.17s): bright -0.9σ, sat -0.9σ, act -1.7σ, zoom +1.4σ, abszoom +1.4σ, rot -1.3σ
- beat #17 (r4, 10.03s): bright +0.8σ, act +1.6σ, zoom -1.2σ, abszoom -1.1σ, rot +1.3σ
- beat #25 (r4, 13.72s): bright -0.9σ, act -1.4σ, zoom -1.2σ, abszoom -1.0σ, rot +1.0σ
- beat #29 (r8, 15.56s): act +1.5σ
- beat #33 (r4, 17.41s): act -1.1σ
- beat #41 (r4, 21.11s): act +0.9σ
- beat #45 (r8, 22.94s): bright -1.1σ, sat -1.0σ, act -2.3σ
- beat #49 (r4, 24.80s): bright +0.9σ, sat +1.1σ, act +1.9σ, zoom -1.2σ, abszoom -1.4σ, rot +1.1σ
- beat #57 (r4, 28.49s): bright -1.0σ, sat -0.8σ, act -2.0σ
- beat #61 (r8, 30.32s): bright +1.4σ, sat +1.3σ, act +1.4σ
- beat #65 (r4, 32.18s): sat -1.0σ
- beat #73 (r4, 35.88s): bright +1.1σ
- beat #77 (r8, 37.73s): bright -1.7σ, sat -2.1σ, act -1.1σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #1 S | 2.65 | 4 | +0.5 | -3.5 | +1.2 | -0.8 | -0.7 | yes | 130 |
| #5 S | 4.48 | 16 | +0.6 | +0.4 | +1.1 | +1.8 | +1.4 | yes | 130 |
| #9 | 6.34 | 4 | +1.6 | +0.4 | +1.1 | -0.8 | -0.7 | yes | 130 |
| #13 | 8.17 | 8 | +0.8 | +0.5 | +0.9 | -0.4 | -0.3 | yes | 130 |
| #17 | 10.03 | 4 | +0.4 | +0.4 | +1.0 | +0.6 | +0.4 | yes | 130 |
| #21 | 11.87 | 16 | +1.7 | +0.6 | +0.8 | -0.5 | -0.6 | yes | 130 |
| #25 | 13.72 | 4 | +1.7 | +0.5 | +0.7 | +2.1 | +2.5 | yes | 130 |
| #29 | 15.56 | 8 | +0.4 | +0.3 | +0.8 | +0.1 | +0.0 | yes | 130 |
| #33 | 17.41 | 4 | +0.4 | +0.4 | +0.7 | -0.6 | -0.7 | yes | 130 |
| #36 S | 18.78 | 1 | +0.9 | +0.5 | +0.2 | +1.1 | +0.6 | yes | 130 |
| #37 | 19.25 | 16 | +0.8 | +0.6 | +0.1 | +2.7 | +2.7 | yes | 130 |
| #41 | 21.11 | 4 | +1.0 | +0.4 | -0.1 | -0.3 | -0.3 | yes | 130 |
| #45 | 22.94 | 8 | +2.6 | +0.2 | -0.3 | -0.1 | -0.1 | yes | 130 |
| #49 | 24.80 | 4 | +1.7 | +0.2 | -1.1 | +1.7 | +1.0 | yes | 130 |
| #53 S | 26.63 | 16 | +1.5 | -0.1 | -0.9 | -0.7 | -0.6 | yes | 130 |
| #57 | 28.49 | 4 | +1.5 | -0.2 | -0.7 | +1.8 | +3.1 | yes | 130 |
| #61 | 30.33 | 8 | +3.2 | -0.4 | -1.2 | +0.2 | +0.2 | yes | 130 |
| #65 | 32.18 | 4 | +2.2 | -0.6 | -0.7 | -0.8 | -0.6 | yes | 130 |
| #69 | 34.02 | 16 | +1.0 | -0.6 | -0.2 | +2.3 | +2.4 | yes | 130 |
| #72 S | 35.41 | 1 | +3.6 | -0.7 | -0.5 | -0.5 | -0.8 | yes | 130 |
| #73 | 35.87 | 4 | +3.8 | -0.6 | -0.2 | -0.7 | -0.7 | yes | 130 |
| #77 | 37.73 | 8 | +2.9 | -0.5 | -0.1 | -0.7 | -0.6 | yes | 130 |
| #81 | 39.57 | 4 | +1.4 | -0.4 | -0.2 | +1.0 | +0.0 | yes | 130 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/009.17/timing.png` … — burst 9.17–12.17s (cuts): transition at 10.67s (beat #18 r1, novelty 4.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.17/timing.png` … — burst 12.17–15.17s (cuts): transition at 13.67s (beat #25 r4, novelty 4.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.03/timing.png` … — burst 15.03–18.03s (cuts): transition at 16.53s (beat #31 r2, novelty 5.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/017.97/timing.png` … — burst 17.97–20.97s (cuts): transition at 19.47s (beat #37 r16, novelty 5.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.97/timing.png` … — burst 20.97–23.97s (cuts): transition at 22.47s (beat #44 r1, novelty 6.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/023.90/timing.png` … — burst 23.90–26.90s (cuts): transition at 25.40s (beat #50 r1, novelty 6.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/026.77/timing.png` … — burst 26.77–29.77s (cuts): transition at 28.27s (beat #57 r4, novelty 6.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/029.70/timing.png` … — burst 29.70–32.70s (cuts): transition at 31.20s (beat #63 r2, novelty 4.9). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py alt-chip --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png` ← the rank that reacts hardest
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
