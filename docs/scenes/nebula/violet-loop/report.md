# ref bundle: violet-loop

`tools/.cache/refs/_downloads/hKckckhpbYY.mp4` — 0.0+200.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 200 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 3 strobe stretch(es), flashes every 0.36 s (2.8 Hz), at t 4.9, 77.7, 179.1
- 93 single transitions at t 0.2, 0.9, 2.2, 3.1, 3.9, 4.3, 9.5, 10.0, 13.0, 16.9, 17.2, 17.9, 18.6, 19.1, 20.1, 20.5, 21.1, 21.9, 22.2, 24.0, 25.4, 26.1, 36.1, 40.9, 45.6, 45.9, 47.5, 48.6, 48.9, 50.3, 50.5, 51.9, 53.3, 53.9, 54.3, 55.2, 56.1, 56.6, 57.3, 57.9, 58.7, 59.3, 59.9, 61.2, 61.9, 62.6, 63.6, 64.6, 64.9, 65.9, 66.5, 68.9, 69.3, 70.5, 71.5, 72.9, 74.2, 75.5, 75.9, 77.0, 79.5, 81.9, 83.0, 83.9, 166.9, 167.2, 172.5, 173.5, 173.9, 174.9, 175.9, 177.2, 177.6, 180.9, 181.6, 183.1, 184.9, 185.3, 186.2, 186.5, 187.1, 188.9, 189.5, 190.3, 190.9, 193.5, 193.9, 195.1, 195.5, 196.3, 196.9, 198.3, 198.5
- zoom direction changes at beat #16 (r16, 8.0s, +2.5σ)
- zoom direction changes at beat #160 (r16, 80.0s, +1.9σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 25% of the clip, 68.07s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 181 lit objects on 1280×720 (lit floor 0.21, lit 10.9% of pixels): 71 bar, 63 blob, 39 disc, 7 panel, 1 hex ring; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.12 over 47 gates: 0.032 half-heights at r 0.3, 0.028 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.258, r0.3-0.6 → 0.110, r0.6-1.0 → 0.140, r>1 → 0.207
- rings at r ≈ 0.38 (×15), 0.95 (×47), 1.68 (×47); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, 6.6 px at r≥0.45; glow e-fold 10.8 px, halo/core 0.33 at 4 px; core lum 0.51, ground lum 0.089
- hues (by lit area): magenta 300° 69%, violet 270° 28%; ground `#211035`, centre/edge ground brightness 1.00
- flow (836 object tracks, 53% moving outward → mixed directions): radial speed ∝ r^0.56 (not a zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.01, 0.61:+0.01, 0.87:+0.00, 1.22:+0.04; rotation -0.6°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.29 at r<0.45 vs 2.5 at r≥0.45; 75% of elongated objects lie along the radial direction

### Regime 2 — 23% of the clip, 91.73s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 125 lit objects on 1280×720 (lit floor 0.19, lit 10.0% of pixels): 58 blob, 43 bar, 19 disc, 3 panel, 2 hex ring; outlines 2%, fills 98%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.02 over 24 gates: 0.160 half-heights at r 0.3, 0.052 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 1.281, r0.3-0.6 → 0.118, r0.6-1.0 → 0.190, r>1 → 0.251
- rings at r ≈ 0.60 (×11), 0.95 (×36), 1.68 (×48); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 6.6 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 10.7 px, halo/core 0.33 at 4 px; core lum 0.50, ground lum 0.073
- hues (by lit area): magenta 300° 38%, violet 270° 32%, rose 330° 28%; ground `#1a0e25`, centre/edge ground brightness 0.88
- flow (639 object tracks, 65% moving outward → objects fly toward the camera): radial speed ∝ r^0.41 (not a zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.07, 0.39:+0.01, 0.61:+0.04, 0.87:+0.06, 1.22:+0.10; rotation -1.1°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.14 at r<0.45 vs 2.54 at r≥0.45; 67% of elongated objects lie along the radial direction

### Regime 3 — 18% of the clip, 192.00s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 178 lit objects on 1280×720 (lit floor 0.20, lit 12.0% of pixels): 76 bar, 74 blob, 21 disc, 6 panel, 1 frame; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.53 over 28 gates: 0.086 half-heights at r 0.3, 0.048 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.051, r0.3-0.6 → 0.130, r0.6-1.0 → 0.186, r>1 → 0.255
- rings at r ≈ 0.47 (×17), 1.06 (×51), 1.50 (×53); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 4.6 px at r<0.45, None px at r≥0.45; glow e-fold 10.5 px, halo/core 0.32 at 4 px; core lum 0.49, ground lum 0.073
- hues (by lit area): magenta 300° 65%, violet 270° 18%, rose 330° 13%; ground `#1a0f1f`, centre/edge ground brightness 1.00
- flow (732 object tracks, 62% moving outward → objects fly toward the camera): radial speed ∝ r^0.92 (a flat zoom) 0.03 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.06, 0.39:+0.00, 0.61:+0.00, 0.87:+0.01, 1.22:+0.03; rotation +0.6°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.57 at r<0.45 vs 2.64 at r≥0.45; 71% of elongated objects lie along the radial direction

### Regime 4 — 17% of the clip, 155.13s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 132 lit objects on 1280×720 (lit floor 0.18, lit 8.1% of pixels): 59 bar, 47 blob, 20 disc, 5 panel, 1 frame; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.59 over 26 gates: 0.019 half-heights at r 0.3, 0.036 at r 0.9 → in between
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.033, r0.6-1.0 → 0.314, r>1 → 0.175
- rings at r ≈ 1.19 (×57); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, 3.8 px at r≥0.45; glow e-fold 11.6 px, halo/core 0.34 at 4 px; core lum 0.50, ground lum 0.052
- hues (by lit area): magenta 300° 72%, rose 330° 15%, violet 270° 12%; ground `#130a1a`, centre/edge ground brightness 1.29
- flow (458 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.42 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:-0.04, 0.87:-0.04, 1.22:-0.01; rotation +0.3°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.16 at r<0.45 vs 2.83 at r≥0.45; 76% of elongated objects lie along the radial direction

### Regime 5 — 16% of the clip, 39.20s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 129 lit objects on 1280×720 (lit floor 0.23, lit 9.2% of pixels): 67 bar, 45 blob, 12 disc, 5 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.03 over 17 gates: 0.037 half-heights at r 0.3, 0.038 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.101, r0.3-0.6 → 0.608, r0.6-1.0 → 0.369, r>1 → 0.332
- rings at r ≈ 0.84 (×38), 1.19 (×39); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 21.8 px, halo/core 0.23 at 4 px; core lum 0.46, ground lum 0.114
- hues (by lit area): violet 270° 74%, magenta 300° 25%; ground `#281547`, centre/edge ground brightness 1.00
- flow (759 object tracks, 52% moving outward → mixed directions): radial speed ∝ r^0.56 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.03, 0.61:+0.00, 0.87:+0.00, 1.22:+0.02; rotation +0.5°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.96 at r<0.45 vs 3.11 at r≥0.45; 75% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **4.62–7.62s** — strobe 4.87–5.60s, flashes every 0.37s — no hard cut; brightness 0.24–0.24, colour change 0.012/frame (cut ≥ 0.2) — `bursts/004.62/timing.png` (every frame), `bursts/004.62/detail.png` (large), `bursts/004.62/motion.png` (paths / skeleton / t±1 in RGB)
- **15.70–18.70s** — transition at 17.20s (beat #34 r2, novelty 3.9); also transition at 17.93s (beat #36 r4, novelty 3.3); also transition at 16.87s (beat #34 r2, novelty 2.4); also transition at 18.60s (beat #37 r1, novelty 2.4) — no hard cut; brightness 0.24–0.24, colour change 0.013/frame (cut ≥ 0.2) — `bursts/015.70/timing.png` (every frame), `bursts/015.70/detail.png` (large), `bursts/015.70/motion.png` (paths / skeleton / t±1 in RGB)
- **19.63–22.63s** — transition at 21.13s (beat #42 r2, novelty 14.3); also transition at 20.53s (beat #41 r1, novelty 6.4); also transition at 21.87s (beat #44 r4, novelty 5.7); also transition at 20.07s (beat #40 r8, novelty 2.4); also transition at 22.20s (beat #44 r4, novelty 1.9); also every 10 s (no audio to place by) — no hard cut; brightness 0.24–0.26, colour change 0.014/frame (cut ≥ 0.2) — `bursts/019.63/timing.png` (every frame), `bursts/019.63/detail.png` (large), `bursts/019.63/motion.png` (paths / skeleton / t±1 in RGB)
- **22.50–25.50s** — transition at 24.00s (beat #48 r16, novelty 7.4); also transition at 25.40s (beat #51 r1, novelty 1.9) — no hard cut; brightness 0.22–0.25, colour change 0.012/frame (cut ≥ 0.2) — `bursts/022.50/timing.png` (every frame), `bursts/022.50/detail.png` (large), `bursts/022.50/motion.png` (paths / skeleton / t±1 in RGB)
- **57.23–60.23s** — transition at 58.73s (beat #117 r1, novelty 3.9); also transition at 57.93s (beat #116 r4, novelty 3.7); also transition at 57.27s (beat #115 r1, novelty 3.5); also transition at 59.27s (beat #119 r1, novelty 2.9); also transition at 59.87s (beat #120 r8, novelty 2.3) — no hard cut; brightness 0.24–0.24, colour change 0.013/frame (cut ≥ 0.2) — `bursts/057.23/timing.png` (every frame), `bursts/057.23/detail.png` (large), `bursts/057.23/motion.png` (paths / skeleton / t±1 in RGB)
- **62.10–65.10s** — transition at 63.60s (beat #127 r1, novelty 4.1); also transition at 62.60s (beat #125 r1, novelty 2.9); also transition at 64.60s (beat #129 r1, novelty 2.5); also transition at 64.87s (beat #130 r2, novelty 2.5) — no hard cut; brightness 0.23–0.24, colour change 0.012/frame (cut ≥ 0.2) — `bursts/062.10/timing.png` (every frame), `bursts/062.10/detail.png` (large), `bursts/062.10/motion.png` (paths / skeleton / t±1 in RGB)
- **77.42–80.42s** — strobe 77.67–78.27s, flashes every 0.30s; also transition at 79.53s (beat #159 r1, novelty 1.8) — no hard cut; brightness 0.16–0.17, colour change 0.011/frame (cut ≥ 0.2) — `bursts/077.42/timing.png` (every frame), `bursts/077.42/detail.png` (large), `bursts/077.42/motion.png` (paths / skeleton / t±1 in RGB)
- **178.82–181.82s** — strobe 179.07–180.27s, flashes every 0.40s; also transition at 180.93s (beat #362 r2, novelty 3.3); also transition at 181.60s (beat #363 r1, novelty 3.0); also every 10 s (no audio to place by) — no hard cut; brightness 0.21–0.22, colour change 0.013/frame (cut ≥ 0.2) — `bursts/178.82/timing.png` (every frame), `bursts/178.82/detail.png` (large), `bursts/178.82/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#190e25`×0.37 `#351b58`×0.23 `#51327d`×0.20 `#7957a0`×0.14 `#bc8fbd`×0.06
- mirror symmetry, ~1 axis (r 0.32); centre brightness 0.23 vs edge 0.21; mean brightness 0.21, dark frames 0%; saturation 0.58
- motion: zoom mean +0.004 (|zoom| 0.022) log-scale/s, rotation mean +0.4° (|rot| 0.8°)/s, frame-to-frame activity 0.007

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 25 | +0.69 | +0.87 | -0.05 | -0.06 | +0.29 |
| 8 | 25 | +0.78 | +1.22 | +0.04 | +0.44 | +0.29 |
| 4 | 50 | +0.77 | +0.98 | +0.02 | +0.46 | +0.28 |
| 2 | 100 | +0.83 | +1.15 | +0.01 | +0.39 | +0.25 |
| 1 | 200 | +0.75 | +0.81 | +0.01 | +0.37 | +0.27 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.20 | #0 | +200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r16), no onset, → probably not audio-driven |
| 0.93 | #2 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 2.20 | #4 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 3.07 | #6 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 3.93 | #8 | -67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 4.27 | #9 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 4.87 | #10 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 5.60s: 3 flashes every 0.37s = 0.73 beat (no simple fraction of a beat → own timer), starts off beat r2, no onset |
| 9.53 | #19 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 10.00 | #20 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, looks like a cut |
| 13.00 | #26 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, looks like a cut |
| 16.87 | #34 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 17.20 | #34 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 17.93 | #36 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 18.60 | #37 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 19.07 | #38 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 20.07 | #40 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 20.53 | #41 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 21.13 | #42 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, looks like a cut, → probably not audio-driven |
| 21.87 | #44 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 22.20 | #44 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 24.00 | #48 | +0 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset, looks like a cut |
| 25.40 | #51 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, → probably not audio-driven |
| 26.07 | #52 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 36.07 | #72 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 40.93 | #82 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 45.60 | #91 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 45.87 | #92 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 47.53 | #95 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 48.60 | #97 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 48.87 | #98 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 50.27 | #101 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 50.53 | #101 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 51.93 | #104 | -67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 53.27 | #107 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 53.87 | #108 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 54.27 | #109 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 55.20 | #110 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 56.07 | #112 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 56.60 | #113 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 57.27 | #115 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 57.93 | #116 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 58.73 | #117 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 59.27 | #119 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 59.87 | #120 | -133 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r8), no onset, → probably not audio-driven |
| 61.20 | #122 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 61.93 | #124 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 62.60 | #125 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 63.60 | #127 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 64.60 | #129 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 64.87 | #130 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 65.93 | #132 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 66.47 | #133 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 68.93 | #138 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 69.27 | #139 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 70.47 | #141 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 71.53 | #143 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 72.87 | #146 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 74.20 | #148 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 75.47 | #151 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 75.87 | #152 | -133 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r8), no onset, → probably not audio-driven |
| 77.00 | #154 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 77.67 | #155 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 78.27s: 3 flashes every 0.30s = 0.60 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset |
| 79.53 | #159 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 81.87 | #164 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 83.00 | #166 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 83.87 | #168 | -133 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r8), no onset, → probably not audio-driven |
| 166.87 | #334 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 167.20 | #334 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 172.53 | #345 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 173.53 | #347 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 173.93 | #348 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 174.87 | #350 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 175.87 | #352 | -133 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r16), no onset, → probably not audio-driven |
| 177.20 | #354 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 177.60 | #355 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 179.07 | #358 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 180.27s: 4 flashes every 0.40s = 0.80 beat (no simple fraction of a beat → own timer), starts on beat r2, no onset |
| 180.93 | #362 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 181.60 | #363 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 183.13 | #366 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, → probably not audio-driven |
| 184.87 | #370 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 185.27 | #371 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 186.20 | #372 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 186.53 | #373 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 187.07 | #374 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 188.87 | #378 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, looks like a cut, → probably not audio-driven |
| 189.53 | #379 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 190.27 | #381 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 190.93 | #382 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 193.53 | #387 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 193.93 | #388 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 195.07 | #390 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 195.53 | #391 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 196.27 | #393 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 196.87 | #394 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 198.27 | #397 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 198.53 | #397 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #8 (r8, 4.00s): abszoom +1.0σ
- beat #12 (r4, 6.00s): abszoom +1.2σ
- beat #16 (r16, 8.00s): zoom +2.5σ, abszoom -1.0σ
- beat #20 (r4, 10.00s): abszoom -1.1σ
- beat #40 (r8, 20.00s): act +1.0σ
- beat #44 (r4, 22.00s): act -2.2σ
- beat #48 (r16, 24.00s): act -1.0σ, abszoom -1.1σ
- beat #96 (r16, 48.00s): abszoom +1.2σ
- beat #152 (r8, 76.00s): abszoom +0.9σ
- beat #156 (r4, 78.00s): zoom -1.0σ, abszoom +1.7σ
- beat #160 (r16, 80.00s): zoom +1.9σ, abszoom -2.0σ
- beat #164 (r4, 82.00s): abszoom +1.0σ
- beat #168 (r8, 84.00s): abszoom -1.2σ
- beat #212 (r4, 106.00s): abszoom +1.0σ
- beat #220 (r4, 110.00s): zoom +0.8σ, abszoom -1.3σ
- beat #252 (r4, 126.00s): abszoom +1.0σ
- beat #336 (r16, 168.00s): zoom +0.8σ, abszoom +0.8σ
- beat #360 (r8, 180.00s): zoom +1.0σ, abszoom -1.5σ

## Files

- `slitscan.png` — the whole clip, 7.5 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/004.62/timing.png` … — burst 4.62–7.62s (continuous): strobe 4.87–5.60s, flashes every 0.37s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.70/timing.png` … — burst 15.70–18.70s (continuous): transition at 17.20s (beat #34 r2, novelty 3.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/019.63/timing.png` … — burst 19.63–22.63s (continuous): transition at 21.13s (beat #42 r2, novelty 14.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.50/timing.png` … — burst 22.50–25.50s (continuous): transition at 24.00s (beat #48 r16, novelty 7.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/057.23/timing.png` … — burst 57.23–60.23s (continuous): transition at 58.73s (beat #117 r1, novelty 3.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/062.10/timing.png` … — burst 62.10–65.10s (continuous): transition at 63.60s (beat #127 r1, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/077.42/timing.png` … — burst 77.42–80.42s (continuous): strobe 77.67–78.27s, flashes every 0.30s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/178.82/timing.png` … — burst 178.82–181.82s (continuous): strobe 179.07–180.27s, flashes every 0.40s. timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py violet-loop --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16-1.png`
- `sheets/rank16-2.png`
- `sheets/rank16-3.png`
- `sheets/rank8-1.png`
- `sheets/rank8-2.png`
- `sheets/rank8-3.png`
- `sheets/rank8-4.png`
- `sheets/rank8-5.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank4-3.png`
- `sheets/rank4-4.png`
- `sheets/rank4-5.png`
- `sheets/rank4-6.png`
- `sheets/rank4-7.png`
- `sheets/rank4-8.png`
- `sheets/rank4-9.png`
- `sheets/rank4-10.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank2-3.png`
- `sheets/rank2-4.png`
- `sheets/rank2-5.png`
- `sheets/rank2-6.png`
- `sheets/rank2-7.png`
- `sheets/rank2-8.png`
- `sheets/rank2-9.png`
- `sheets/rank2-10.png`
- `sheets/rank2-11.png`
- `sheets/rank2-12.png`
- `sheets/rank2-13.png`
- `sheets/rank2-14.png`
- `sheets/rank2-15.png`
- `sheets/rank2-16.png`
- `sheets/rank2-17.png`
- `sheets/rank2-18.png`
- `sheets/rank2-19.png`
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
- `sheets/rank1-16.png`
- `sheets/rank1-17.png`
- `sheets/rank1-18.png`
- `sheets/rank1-19.png`
- `sheets/rank1-20.png`
- `sheets/rank1-21.png`
- `sheets/rank1-22.png`
- `sheets/rank1-23.png`
- `sheets/rank1-24.png`
- `sheets/rank1-25.png`
- `sheets/rank1-26.png`
- `sheets/rank1-27.png`
- `sheets/rank1-28.png`
- `sheets/rank1-29.png`
- `sheets/rank1-30.png`
- `sheets/rank1-31.png`
- `sheets/rank1-32.png`
- `sheets/rank1-33.png`
- `sheets/rank1-34.png`
- `sheets/rank1-35.png`
- `sheets/rank1-36.png`
- `sheets/rank1-37.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
