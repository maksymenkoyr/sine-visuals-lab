# ref bundle: entropic-collapse

`tools/.cache/refs/_downloads/entropic-collapse.mp4` — 0.0+86.4s. no usable audio (no audio stream).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (no audio stream): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 86 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 57 single transitions at t 14.2, 16.0, 16.8, 17.6, 18.3, 19.1, 19.9, 20.7, 21.5, 22.3, 23.0, 23.8, 24.6, 25.3, 26.1, 26.9, 27.7, 28.3, 29.1, 29.9, 30.7, 44.2, 44.9, 45.7, 46.4, 47.3, 48.0, 48.8, 49.2, 49.7, 50.7, 51.5, 52.5, 53.3, 54.3, 55.3, 56.3, 57.3, 58.2, 59.2, 60.3, 61.3, 62.3, 63.3, 64.3, 65.3, 66.4, 67.3, 68.2, 69.1, 69.9, 70.8, 71.7, 72.5, 73.3, 74.0, 74.8

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 30% of the clip, 75.93s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 55 lit objects on 870×720 (lit floor 0.18, lit 4.5% of pixels): 18 bar, 15 disc, 9 ring, 7 blob, 3 hex ring, 3 panel; outlines 22%, fills 78%; 17% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.99 over 29 gates: 0.115 half-heights at r 0.3, 0.039 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.828, r0.3-0.6 → 0.069, r0.6-1.0 → —, r>1 → 0.064
- rings at r ≈ 0.53 (×8), 1.50 (×35); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 3.2 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 1.3 px, halo/core 0.03 at 4 px; core lum 0.64, ground lum 0.003
- hues (by lit area): rose 330° 86%, azure 210° 10%; ground `#000000`, centre/edge ground brightness 1.00
- flow (582 object tracks, 15% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.27 (not a zoom) 0.03 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:-0.05, 0.39:+0.00, 0.61:+0.00, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.38 at r<0.45 vs 2.02 at r≥0.45; 17% of elongated objects lie along the radial direction

### Regime 2 — 24% of the clip, 16.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 96 lit objects on 870×720 (lit floor 0.18, lit 6.1% of pixels): 42 bar, 21 blob, 16 disc, 7 ring, 6 panel, 3 hex ring, 1 frame; outlines 11%, fills 89%; 9% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.64 over 33 gates: 0.068 half-heights at r 0.3, 0.034 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.233, r0.3-0.6 → 0.064, r0.6-1.0 → 0.072, r>1 → 0.099
- rings at r ≈ 0.38 (×19), 0.53 (×22), 1.50 (×36); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 2.7 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 5.6 px, halo/core 0.21 at 4 px; core lum 0.56, ground lum 0.003
- hues (by lit area): rose 330° 94%; ground `#000000`, centre/edge ground brightness 1.00
- flow (469 object tracks, 28% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.65 (not a zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.04, 0.39:+0.01, 0.61:+0.01, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.26 at r<0.45 vs 2.29 at r≥0.45; 35% of elongated objects lie along the radial direction

### Regime 3 — 21% of the clip, 74.80s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 83 lit objects on 870×720 (lit floor 0.18, lit 4.2% of pixels): 31 bar, 17 disc, 16 blob, 9 ring, 6 panel, 3 hex ring, 1 frame; outlines 16%, fills 84%; 15% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.33 over 36 gates: 0.040 half-heights at r 0.3, 0.028 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.422, r0.3-0.6 → 0.067, r0.6-1.0 → 0.078, r>1 → 0.056
- rings at r ≈ 0.12 (×8), 0.53 (×15), 1.50 (×37); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 3.7 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 5.7 px, halo/core 0.23 at 4 px; core lum 0.62, ground lum 0.003
- hues (by lit area): rose 330° 83%, azure 210° 14%; ground `#000000`, centre/edge ground brightness 1.00
- flow (567 object tracks, 24% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.32 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:+0.15, 0.39:+0.00, 0.61:+0.00, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.99 at r<0.45 vs 2.29 at r≥0.45; 15% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 8.00s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 191 lit objects on 870×720 (lit floor 0.18, lit 4.2% of pixels): 130 bar, 21 blob, 20 disc, 8 ring, 8 panel, 4 hex ring; outlines 6%, fills 94%; 17% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.05 over 40 gates: 0.125 half-heights at r 0.3, 0.039 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.887, r0.3-0.6 → 0.177, r0.6-1.0 → 0.073, r>1 → 0.099
- rings at r ≈ 0.75 (×49), 1.50 (×37); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 6.0 px, halo/core 0.07 at 4 px; core lum 0.33, ground lum 0.002
- hues (by lit area): magenta 300° 76%, red 0° 7%, azure 210° 6%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1297 object tracks, 26% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.01 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 9.59 at r<0.45 vs 13.0 at r≥0.45; 40% of elongated objects lie along the radial direction

### Regime 5 — 11% of the clip, 57.53s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 116 lit objects on 870×720 (lit floor 0.18, lit 5.1% of pixels): 54 bar, 24 blob, 22 disc, 9 ring, 5 panel, 1 hex ring, 1 frame; outlines 9%, fills 91%; 9% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.17 over 37 gates: 0.034 half-heights at r 0.3, 0.028 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.297, r0.3-0.6 → 0.089, r0.6-1.0 → 0.052, r>1 → 0.060
- rings at r ≈ 0.60 (×31), 1.50 (×37); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 2.7 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 3.7 px, halo/core 0.15 at 4 px; core lum 0.60, ground lum 0.003
- hues (by lit area): magenta 300° 90%; ground `#000000`, centre/edge ground brightness 1.00
- flow (619 object tracks, 15% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.21 (not a zoom) 0.15 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.07, 0.39:-0.13, 0.61:-0.18, 0.87:-0.20, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.08 at r<0.45 vs 2.75 at r≥0.45; 54% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **26.17–29.17s** — transition at 27.67s (beat #55 r1, novelty 4.4); also transition at 26.87s (beat #54 r2, novelty 3.3); also transition at 28.33s (beat #57 r1, novelty 2.6); also transition at 29.13s (beat #58 r2, novelty 1.7) — no hard cut; brightness 0.04–0.07, colour change 0.015/frame (cut ≥ 0.2) — `bursts/026.17/timing.png` (every frame), `bursts/026.17/detail.png` (large), `bursts/026.17/motion.png` (paths / skeleton / t±1 in RGB)
- **44.90–47.90s** — transition at 46.40s (beat #93 r1, novelty 5.5); also transition at 44.93s (beat #90 r2, novelty 3.1); also transition at 45.67s (beat #91 r1, novelty 2.6) — no hard cut; brightness 0.04–0.07, colour change 0.018/frame (cut ≥ 0.2) — `bursts/044.90/timing.png` (every frame), `bursts/044.90/detail.png` (large), `bursts/044.90/motion.png` (paths / skeleton / t±1 in RGB)
- **46.50–49.50s** — transition at 48.00s (beat #96 r16, novelty 5.6); also transition at 47.27s (beat #95 r1, novelty 4.2); also transition at 48.80s (beat #98 r2, novelty 3.9); also transition at 49.20s (beat #98 r2, novelty 2.2) — no hard cut; brightness 0.04–0.07, colour change 0.018/frame (cut ≥ 0.2) — `bursts/046.50/timing.png` (every frame), `bursts/046.50/detail.png` (large), `bursts/046.50/motion.png` (paths / skeleton / t±1 in RGB)
- **50.03–53.03s** — transition at 51.53s (beat #103 r1, novelty 4.5); also transition at 50.67s (beat #101 r1, novelty 4.3); also transition at 52.47s (beat #105 r1, novelty 3.9); also every 10 s (no audio to place by) — no hard cut; brightness 0.04–0.07, colour change 0.018/frame (cut ≥ 0.2) — `bursts/050.03/timing.png` (every frame), `bursts/050.03/detail.png` (large), `bursts/050.03/motion.png` (paths / skeleton / t±1 in RGB)
- **51.83–54.83s** — transition at 53.33s (beat #107 r1, novelty 4.5); also transition at 54.27s (beat #109 r1, novelty 3.4) — no hard cut; brightness 0.04–0.07, colour change 0.017/frame (cut ≥ 0.2) — `bursts/051.83/timing.png` (every frame), `bursts/051.83/detail.png` (large), `bursts/051.83/motion.png` (paths / skeleton / t±1 in RGB)
- **54.83–57.83s** — transition at 56.33s (beat #113 r1, novelty 5.2); also transition at 57.27s (beat #115 r1, novelty 4.0); also transition at 55.33s (beat #111 r1, novelty 3.5) — no hard cut; brightness 0.04–0.07, colour change 0.017/frame (cut ≥ 0.2) — `bursts/054.83/timing.png` (every frame), `bursts/054.83/detail.png` (large), `bursts/054.83/motion.png` (paths / skeleton / t±1 in RGB)
- **62.83–65.83s** — transition at 64.33s (beat #129 r1, novelty 4.8); also transition at 65.33s (beat #131 r1, novelty 4.1); also transition at 63.33s (beat #127 r1, novelty 3.9) — no hard cut; brightness 0.04–0.07, colour change 0.017/frame (cut ≥ 0.2) — `bursts/062.83/timing.png` (every frame), `bursts/062.83/detail.png` (large), `bursts/062.83/motion.png` (paths / skeleton / t±1 in RGB)
- **66.70–69.70s** — transition at 68.20s (beat #136 r8, novelty 4.7); also transition at 67.27s (beat #135 r1, novelty 4.3); also transition at 69.07s (beat #138 r2, novelty 4.1) — no hard cut; brightness 0.04–0.07, colour change 0.018/frame (cut ≥ 0.2) — `bursts/066.70/timing.png` (every frame), `bursts/066.70/detail.png` (large), `bursts/066.70/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#010100`×0.88 `#2c161b`×0.05 `#612b4b`×0.03 `#d2d1d2`×0.02 `#907f8b`×0.02
- 12-fold rotational symmetry (r 0.53); mirror symmetry, ~1 axis (r 0.86); centre brightness 0.46 vs edge 0.02; mean brightness 0.06, dark frames 98%; saturation 0.47
- motion: zoom mean +0.140 (|zoom| 0.357) log-scale/s, rotation mean +0.8° (|rot| 4.2°)/s, frame-to-frame activity 0.011

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 11 | +0.21 | +0.35 | +0.09 | +0.74 | +0.06 |
| 8 | 11 | +0.38 | +0.58 | +0.30 | +0.80 | +0.00 |
| 4 | 22 | +0.35 | +0.67 | +0.33 | +0.67 | +0.09 |
| 2 | 43 | +0.30 | +0.52 | +0.34 | +0.45 | +0.06 |
| 1 | 86 | +0.31 | +0.58 | +0.25 | +0.85 | +0.21 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 14.20 | #28 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 16.00 | #32 | +0 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset, blackout |
| 16.80 | #34 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, blackout, → probably not audio-driven |
| 17.60 | #35 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, blackout, → probably not audio-driven |
| 18.33 | #37 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 19.13 | #38 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, blackout, → probably not audio-driven |
| 19.93 | #40 | -67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset, blackout |
| 20.67 | #41 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 21.47 | #43 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut, blackout |
| 22.27 | #45 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 23.00 | #46 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, blackout |
| 23.80 | #48 | -200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r16), no onset, blackout, → probably not audio-driven |
| 24.60 | #49 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, blackout, → probably not audio-driven |
| 25.33 | #51 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 26.07 | #52 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, blackout |
| 26.87 | #54 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, blackout, → probably not audio-driven |
| 27.67 | #55 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 28.33 | #57 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 29.13 | #58 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, blackout, → probably not audio-driven |
| 29.87 | #60 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, blackout, → probably not audio-driven |
| 30.67 | #61 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 44.20 | #88 | +200 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r8), no onset, blackout, → probably not audio-driven |
| 44.93 | #90 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, blackout |
| 45.67 | #91 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 46.40 | #93 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 47.27 | #95 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 48.00 | #96 | +0 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset, looks like a cut, blackout |
| 48.80 | #98 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, blackout, → probably not audio-driven |
| 49.20 | #98 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 49.73 | #99 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 50.67 | #101 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 51.53 | #103 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut, blackout |
| 52.47 | #105 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, blackout |
| 53.33 | #107 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 54.27 | #109 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 55.33 | #111 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 56.33 | #113 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 57.27 | #115 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 58.20 | #116 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, blackout, → probably not audio-driven |
| 59.20 | #118 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, looks like a cut, blackout, → probably not audio-driven |
| 60.27 | #121 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 61.33 | #123 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 62.33 | #125 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 63.33 | #127 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 64.33 | #129 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 65.33 | #131 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 66.40 | #133 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut, blackout |
| 67.27 | #135 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 68.20 | #136 | +200 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r8), no onset, blackout, → probably not audio-driven |
| 69.07 | #138 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, blackout |
| 69.93 | #140 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, blackout |
| 70.80 | #142 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, blackout, → probably not audio-driven |
| 71.67 | #143 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 72.47 | #145 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, blackout |
| 73.27 | #147 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 74.00 | #148 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 74.80 | #150 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, blackout, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #56 (r8, 28.00s): abszoom -0.9σ
- beat #88 (r8, 44.00s): zoom -1.0σ
- beat #96 (r16, 48.00s): rot -1.1σ
- beat #100 (r4, 50.00s): abszoom +1.3σ
- beat #124 (r4, 62.00s): rot -0.8σ
- beat #128 (r16, 64.00s): rot +1.3σ

## Files

- `slitscan.png` — the whole clip, 15 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/026.17/timing.png` … — burst 26.17–29.17s (continuous): transition at 27.67s (beat #55 r1, novelty 4.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/044.90/timing.png` … — burst 44.90–47.90s (continuous): transition at 46.40s (beat #93 r1, novelty 5.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/046.50/timing.png` … — burst 46.50–49.50s (continuous): transition at 48.00s (beat #96 r16, novelty 5.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/050.03/timing.png` … — burst 50.03–53.03s (continuous): transition at 51.53s (beat #103 r1, novelty 4.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/051.83/timing.png` … — burst 51.83–54.83s (continuous): transition at 53.33s (beat #107 r1, novelty 4.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/054.83/timing.png` … — burst 54.83–57.83s (continuous): transition at 56.33s (beat #113 r1, novelty 5.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/062.83/timing.png` … — burst 62.83–65.83s (continuous): transition at 64.33s (beat #129 r1, novelty 4.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/066.70/timing.png` … — burst 66.70–69.70s (continuous): transition at 68.20s (beat #136 r8, novelty 4.7). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py entropic-collapse --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8-1.png`
- `sheets/rank8-2.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank4-3.png`
- `sheets/rank4-4.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank2-3.png`
- `sheets/rank2-4.png`
- `sheets/rank2-5.png`
- `sheets/rank2-6.png`
- `sheets/rank2-7.png`
- `sheets/rank2-8.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `sheets/rank1-5.png`
- `sheets/rank1-6.png`
- `sheets/rank1-7.png`
- `sheets/rank1-8.png`
- `sheets/rank1-9.png`
- `sheets/rank1-10.png`
- `sheets/rank1-11.png`
- `sheets/rank1-12.png`
- `sheets/rank1-13.png`
- `sheets/rank1-14.png`
- `sheets/rank1-15.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
