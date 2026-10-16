# ref bundle: hebt-ab

`tools/.cache/refs/_downloads/hebt-ab.mp4` — 0.0+50.0s. no usable audio (no audio stream).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (no audio stream): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 50 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 2 strobe stretch(es), flashes every 0.35 s (2.9 Hz), at t 24.5, 33.6
- 32 single transitions at t 16.1, 18.1, 20.7, 21.5, 22.3, 23.5, 25.9, 26.5, 27.1, 28.1, 28.7, 29.9, 30.2, 31.5, 31.8, 32.8, 35.4, 37.2, 38.3, 38.8, 39.8, 40.1, 40.9, 42.0, 42.9, 43.7, 44.1, 44.8, 46.5, 46.9, 47.6, 49.3
- zooms in continuously (+0.081 log-scale/s, i.e. ×1.08 per second)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 56% of the clip, 38.53s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 1143 lit objects on 720×720 (lit floor 0.18, lit 21.4% of pixels): 686 bar, 338 blob, 85 disc, 33 panel, 1 frame; outlines 0%, fills 100%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.12 over 118 gates: 0.014 half-heights at r 0.3, 0.015 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.018, r0.3-0.6 → 0.038, r0.6-1.0 → 0.064, r>1 → 0.092
- rings at r ≈ 0.84 (×497); 8-fold (score 0.96); on the axes 32%, on the diagonals 27%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 2.2 px, halo/core 0.02 at 4 px; core lum 0.74, ground lum 0.000
- hues (by lit area): white 0° 100%; ground `#000000`, centre/edge ground brightness 1.00
- flow (8648 object tracks, 94% moving outward → objects fly toward the camera): radial speed ∝ r^0.74 (a flat zoom) 0.11 half-heights/s at r 0.5; by r → 0.07:+0.04, 0.21:+0.07, 0.39:+0.09, 0.61:+0.12, 0.87:+0.15, 1.22:+0.15; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.25 at r<0.45 vs 6.18 at r≥0.45; 43% of elongated objects lie along the radial direction

### Regime 2 — 13% of the clip, 17.13s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 1189 lit objects on 720×720 (lit floor 0.18, lit 21.2% of pixels): 750 bar, 347 blob, 78 disc, 13 panel, 1 frame; outlines 0%, fills 100%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.00 over 90 gates: 0.015 half-heights at r 0.3, 0.015 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.018, r0.3-0.6 → 0.038, r0.6-1.0 → 0.065, r>1 → 0.084
- rings at r ≈ 0.84 (×508); 8-fold (score 0.97); on the axes 32%, on the diagonals 28%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 2.2 px, halo/core 0.02 at 4 px; core lum 0.74, ground lum 0.000
- hues (by lit area): white 0° 100%; ground `#000000`, centre/edge ground brightness 1.00
- flow (9149 object tracks, 92% moving outward → objects fly toward the camera): radial speed ∝ r^1.01 (a flat zoom) 0.09 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.04, 0.39:+0.07, 0.61:+0.11, 0.87:+0.13, 1.22:+0.15; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.21 at r<0.45 vs 6.82 at r≥0.45; 44% of elongated objects lie along the radial direction

### Regime 3 — 12% of the clip, 11.80s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 1205 lit objects on 720×720 (lit floor 0.18, lit 20.2% of pixels): 803 bar, 299 blob, 73 disc, 29 panel, 1 frame; outlines 0%, fills 100%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.02 over 102 gates: 0.015 half-heights at r 0.3, 0.015 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.053, r0.3-0.6 → 0.042, r0.6-1.0 → 0.072, r>1 → 0.106
- rings at r ≈ 0.84 (×508); 8-fold (score 0.96); on the axes 28%, on the diagonals 28%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 1.8 px, halo/core 0.01 at 4 px; core lum 0.74, ground lum 0.000
- hues (by lit area): white 0° 100%; ground `#000000`, centre/edge ground brightness 1.00
- flow (9399 object tracks, 88% moving outward → objects fly toward the camera): radial speed ∝ r^1.21 (a flat zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.04, 0.61:+0.08, 0.87:+0.11, 1.22:+0.12; rotation +0.1°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.25 at r<0.45 vs 7.97 at r≥0.45; 48% of elongated objects lie along the radial direction

### Regime 4 — 10% of the clip, 6.33s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 1091 lit objects on 720×720 (lit floor 0.18, lit 17.7% of pixels): 853 bar, 166 blob, 56 disc, 15 panel, 1 frame; outlines 0%, fills 100%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.26 over 71 gates: 0.020 half-heights at r 0.3, 0.015 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.261, r0.3-0.6 → 0.158, r0.6-1.0 → 0.060, r>1 → 0.081
- rings at r ≈ 0.84 (×601); 8-fold (score 0.95); on the axes 30%, on the diagonals 28%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.01 at 4 px; core lum 0.74, ground lum 0.000
- hues (by lit area): white 0° 100%; ground `#000000`, centre/edge ground brightness 1.00
- flow (9048 object tracks, 75% moving outward → objects fly toward the camera): radial speed ∝ r^0.98 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:-0.01, 0.21:-0.03, 0.39:-0.03, 0.61:+0.00, 0.87:+0.07, 1.22:+0.10; rotation +0.1°/s (+ = counter-clockwise on screen)
- streak: median elongation 57.66 at r<0.45 vs 8.43 at r≥0.45; 43% of elongated objects lie along the radial direction

### Regime 5 — 8% of the clip, 1.87s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 119 lit objects on 720×720 (lit floor 0.18, lit 11.6% of pixels): 103 bar, 10 blob, 5 disc, 1 frame; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-2.33 over 59 substantial objects: 1.588 half-heights at r 0.3, 0.122 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.521, r0.3-0.6 → —, r0.6-1.0 → 0.453, r>1 → 0.111
- rings at r ≈ 0.75 (×23), 1.06 (×89); 2-fold (score 0.93); on the axes 5%, on the diagonals 12%
- stroke (outlines): 3.8 px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 0.81, ground lum 0.000
- hues (by lit area): white 0° 100%; ground `#000000`, centre/edge ground brightness 0.00
- flow (987 object tracks, 37% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.28 (not a zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:-0.09, 0.21:-0.02, 0.39:-0.01, 0.61:+0.01, 0.87:+0.00, 1.22:-0.04; rotation +0.8°/s (+ = counter-clockwise on screen)
- streak: median elongation 78.25 at r<0.45 vs 16.86 at r≥0.45; 47% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **16.57–19.57s** — transition at 18.07s (beat #36 r4, novelty 2.4) — no hard cut; brightness 0.21–0.21, colour change 0.008/frame (cut ≥ 0.2) — `bursts/016.57/timing.png` (every frame), `bursts/016.57/detail.png` (large), `bursts/016.57/motion.png` (paths / skeleton / t±1 in RGB)
- **19.17–22.17s** — transition at 20.67s (beat #41 r1, novelty 2.6); also transition at 21.47s (beat #43 r1, novelty 1.9); also every 10 s (no audio to place by) — no hard cut; brightness 0.20–0.21, colour change 0.009/frame (cut ≥ 0.2) — `bursts/019.17/timing.png` (every frame), `bursts/019.17/detail.png` (large), `bursts/019.17/motion.png` (paths / skeleton / t±1 in RGB)
- **24.22–27.22s** — strobe 24.47–25.20s, flashes every 0.37s; also transition at 26.47s (beat #53 r1, novelty 3.8); also transition at 25.93s (beat #52 r4, novelty 1.8); also transition at 27.07s (beat #54 r2, novelty 1.8) — no hard cut; brightness 0.21–0.22, colour change 0.010/frame (cut ≥ 0.2) — `bursts/024.22/timing.png` (every frame), `bursts/024.22/detail.png` (large), `bursts/024.22/motion.png` (paths / skeleton / t±1 in RGB)
- **30.30–33.30s** — transition at 31.80s (beat #64 r16, novelty 2.4); also transition at 32.80s (beat #66 r2, novelty 1.9); also transition at 31.47s (beat #63 r1, novelty 1.9); also every 10 s (no audio to place by) — no hard cut; brightness 0.21–0.22, colour change 0.009/frame (cut ≥ 0.2) — `bursts/030.30/timing.png` (every frame), `bursts/030.30/detail.png` (large), `bursts/030.30/motion.png` (paths / skeleton / t±1 in RGB)
- **33.35–36.35s** — strobe 33.60–34.27s, flashes every 0.33s; also transition at 35.40s (beat #71 r1, novelty 1.7) — no hard cut; brightness 0.21–0.22, colour change 0.010/frame (cut ≥ 0.2) — `bursts/033.35/timing.png` (every frame), `bursts/033.35/detail.png` (large), `bursts/033.35/motion.png` (paths / skeleton / t±1 in RGB)
- **35.70–38.70s** — transition at 37.20s (beat #74 r2, novelty 2.8); also transition at 38.27s (beat #77 r1, novelty 1.7) — no hard cut; brightness 0.21–0.22, colour change 0.009/frame (cut ≥ 0.2) — `bursts/035.70/timing.png` (every frame), `bursts/035.70/detail.png` (large), `bursts/035.70/motion.png` (paths / skeleton / t±1 in RGB)
- **41.37–44.37s** — transition at 42.87s (beat #86 r2, novelty 4.0); also transition at 42.00s (beat #84 r4, novelty 3.1); also transition at 43.73s (beat #87 r1, novelty 1.8); also transition at 44.07s (beat #88 r8, novelty 1.8); also every 10 s (no audio to place by) — no hard cut; brightness 0.21–0.22, colour change 0.010/frame (cut ≥ 0.2) — `bursts/041.37/timing.png` (every frame), `bursts/041.37/detail.png` (large), `bursts/041.37/motion.png` (paths / skeleton / t±1 in RGB)
- **46.10–49.10s** — transition at 47.60s (beat #95 r1, novelty 3.0); also transition at 46.87s (beat #94 r2, novelty 3.0); also transition at 46.53s (beat #93 r1, novelty 2.9); also transition at 49.27s (beat #99 r1, novelty 2.0) — no hard cut; brightness 0.21–0.22, colour change 0.009/frame (cut ≥ 0.2) — `bursts/046.10/timing.png` (every frame), `bursts/046.10/detail.png` (large), `bursts/046.10/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#030303`×0.62 `#2e2e2e`×0.17 `#a1a1a1`×0.08 `#f4f4f4`×0.07 `#5f5f5f`×0.06
- no radial symmetry (rotational r 0.11, mirror r 0.14); centre brightness 0.37 vs edge 0.18; mean brightness 0.19, dark frames 1%; saturation 0.00
- motion: zoom mean +0.081 (|zoom| 0.084) log-scale/s, rotation mean -0.0° (|rot| 0.3°)/s, frame-to-frame activity 0.079

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 7 | -0.01 | +1.43 | -0.27 | +0.08 | +2.29 |
| 8 | 6 | +0.08 | +0.82 | -0.00 | +0.01 | +0.02 |
| 4 | 12 | +0.08 | +1.09 | -0.03 | +0.05 | +0.14 |
| 2 | 25 | +0.02 | +0.81 | +0.04 | +0.09 | +0.35 |
| 1 | 50 | +0.03 | +0.84 | +0.03 | +0.07 | +0.14 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 16.07 | #32 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 18.07 | #36 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 20.67 | #41 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 21.47 | #43 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 22.27 | #45 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 23.47 | #47 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 24.47 | #49 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 25.20s: 3 flashes every 0.37s = 0.73 beat (no simple fraction of a beat → own timer), starts on beat r1, no onset |
| 25.93 | #52 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 26.47 | #53 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 27.07 | #54 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 28.07 | #56 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 28.73 | #57 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 29.87 | #60 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 30.20 | #60 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 31.47 | #63 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 31.80 | #64 | -200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r16), no onset, → probably not audio-driven |
| 32.80 | #66 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, → probably not audio-driven |
| 33.60 | #67 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 34.27s: 3 flashes every 0.33s = 0.67 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset |
| 35.40 | #71 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, → probably not audio-driven |
| 37.20 | #74 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 38.27 | #77 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 38.80 | #78 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, → probably not audio-driven |
| 39.80 | #80 | -200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r16), no onset, → probably not audio-driven |
| 40.13 | #80 | +133 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r16), no onset, → probably not audio-driven |
| 40.87 | #82 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 42.00 | #84 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 42.87 | #86 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, looks like a cut, → probably not audio-driven |
| 43.73 | #87 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 44.07 | #88 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 44.80 | #90 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, → probably not audio-driven |
| 46.53 | #93 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 46.87 | #94 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 47.60 | #95 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 49.27 | #99 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/016.57/timing.png` … — burst 16.57–19.57s (continuous): transition at 18.07s (beat #36 r4, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/019.17/timing.png` … — burst 19.17–22.17s (continuous): transition at 20.67s (beat #41 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/024.22/timing.png` … — burst 24.22–27.22s (continuous): strobe 24.47–25.20s, flashes every 0.37s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/030.30/timing.png` … — burst 30.30–33.30s (continuous): transition at 31.80s (beat #64 r16, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/033.35/timing.png` … — burst 33.35–36.35s (continuous): strobe 33.60–34.27s, flashes every 0.33s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/035.70/timing.png` … — burst 35.70–38.70s (continuous): transition at 37.20s (beat #74 r2, novelty 2.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/041.37/timing.png` … — burst 41.37–44.37s (continuous): transition at 42.87s (beat #86 r2, novelty 4.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/046.10/timing.png` … — burst 46.10–49.10s (continuous): transition at 47.60s (beat #95 r1, novelty 3.0). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py hebt-ab --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8-1.png`
- `sheets/rank8-2.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank4-3.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank2-3.png`
- `sheets/rank2-4.png`
- `sheets/rank2-5.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `sheets/rank1-5.png`
- `sheets/rank1-6.png`
- `sheets/rank1-7.png`
- `sheets/rank1-8.png`
- `sheets/rank1-9.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
