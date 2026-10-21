# ref bundle: -TaRL--y9Xc

`tools/.cache/refs/_downloads/-TaRL--y9Xc.mp4` — 30.0+30.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 30 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 20 single transitions at t 2.7, 3.3, 4.9, 5.8, 8.7, 9.3, 10.9, 11.6, 14.7, 15.3, 16.9, 17.8, 20.7, 22.9, 23.8, 25.9, 26.8, 27.3, 28.9, 29.8
- zooms in continuously (+0.335 log-scale/s, i.e. ×1.40 per second)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 32% of the clip, 16.93s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 4172 lit objects on 1280×720 (lit floor 0.18, lit 11.2% of pixels): 2638 blob, 1319 disc, 183 panel, 32 bar; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.05 over 1501 gates: 0.012 half-heights at r 0.3, 0.013 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.015, r0.3-0.6 → 0.014, r0.6-1.0 → 0.015, r>1 → 0.015
- rings at r ≈ 0.34 (×249), 0.95 (×1191), 1.50 (×1128); 2-fold (score 0.93); on the axes 41%, on the diagonals 19%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 12.4 px, halo/core 0.25 at 4 px; core lum 0.52, ground lum 0.026
- hues (by lit area): magenta 300° 89%, rose 330° 9%; ground `#0f030e`, centre/edge ground brightness 2.74
- flow (4644 object tracks, 45% moving outward → mixed directions): radial speed ∝ r^1.06 (a flat zoom) 0.14 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.03; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.14 at r<0.45 vs 1.14 at r≥0.45; 32% of elongated objects lie along the radial direction

### Regime 2 — 19% of the clip, 21.93s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 3966 lit objects on 1280×720 (lit floor 0.18, lit 10.6% of pixels): 2556 blob, 1226 disc, 155 panel, 29 bar; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.02 over 1381 gates: 0.013 half-heights at r 0.3, 0.013 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.014, r0.3-0.6 → 0.014, r0.6-1.0 → 0.015, r>1 → 0.015
- rings at r ≈ 0.75 (×766), 1.50 (×1105); 2-fold (score 0.97); on the axes 43%, on the diagonals 16%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 14.1 px, halo/core 0.24 at 4 px; core lum 0.50, ground lum 0.024
- hues (by lit area): magenta 300° 90%, rose 330° 9%; ground `#0e020d`, centre/edge ground brightness 2.09
- flow (3737 object tracks, 48% moving outward → mixed directions): radial speed ∝ r^0.93 (a flat zoom) 0.15 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.05; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.14 at r<0.45 vs 1.14 at r≥0.45; 28% of elongated objects lie along the radial direction

### Regime 3 — 19% of the clip, 20.93s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 3334 lit objects on 1280×720 (lit floor 0.18, lit 8.9% of pixels): 2128 blob, 1028 disc, 158 panel, 20 bar; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.00 over 1186 gates: 0.013 half-heights at r 0.3, 0.013 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.015, r0.3-0.6 → 0.014, r0.6-1.0 → 0.014, r>1 → 0.015
- rings at r ≈ 0.47 (×365), 0.95 (×990); 2-fold (score 0.91); on the axes 39%, on the diagonals 19%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 13.2 px, halo/core 0.24 at 4 px; core lum 0.49, ground lum 0.021
- hues (by lit area): magenta 300° 89%, rose 330° 8%; ground `#0c020c`, centre/edge ground brightness 1.00
- flow (4222 object tracks, 44% moving outward → mixed directions): radial speed ∝ r^0.81 (a flat zoom) 0.14 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.14 at r<0.45 vs 1.14 at r≥0.45; 37% of elongated objects lie along the radial direction

### Regime 4 — 16% of the clip, 1.80s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 3956 lit objects on 1280×720 (lit floor 0.18, lit 10.8% of pixels): 2657 blob, 1106 disc, 176 panel, 17 bar; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.02 over 1282 gates: 0.013 half-heights at r 0.3, 0.013 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.015, r0.3-0.6 → 0.014, r0.6-1.0 → 0.015, r>1 → 0.015
- rings at r ≈ 0.34 (×231), 0.95 (×1115), 1.50 (×1022); 2-fold (score 0.93); on the axes 41%, on the diagonals 18%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 12.6 px, halo/core 0.24 at 4 px; core lum 0.51, ground lum 0.025
- hues (by lit area): magenta 300° 91%, rose 330° 8%; ground `#0f020e`, centre/edge ground brightness 1.00
- flow (4199 object tracks, 47% moving outward → mixed directions): radial speed ∝ r^0.98 (a flat zoom) 0.13 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.05; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.14 at r<0.45 vs 1.14 at r≥0.45; 31% of elongated objects lie along the radial direction

### Regime 5 — 14% of the clip, 15.53s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 4115 lit objects on 1280×720 (lit floor 0.18, lit 10.9% of pixels): 2694 blob, 1217 disc, 180 panel, 24 bar; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.02 over 1397 gates: 0.013 half-heights at r 0.3, 0.013 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.014, r0.3-0.6 → 0.015, r0.6-1.0 → 0.015, r>1 → 0.015
- rings at r ≈ 0.47 (×396), 1.34 (×1159); 2-fold (score 0.95); on the axes 46%, on the diagonals 16%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 12.7 px, halo/core 0.24 at 4 px; core lum 0.50, ground lum 0.027
- hues (by lit area): magenta 300° 86%, rose 330° 13%; ground `#10030f`, centre/edge ground brightness 1.00
- flow (4575 object tracks, 47% moving outward → mixed directions): radial speed ∝ r^1.02 (a flat zoom) 0.13 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.03; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.14 at r<0.45 vs 1.14 at r≥0.45; 30% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **1.17–4.17s** — transition at 2.67s (beat #5 r1, novelty 2.5); also transition at 3.27s (beat #7 r1, novelty 1.6); also every 10 s (no audio to place by) — no hard cut; brightness 0.12–0.17, colour change 0.021/frame (cut ≥ 0.2) — `bursts/001.17/timing.png` (every frame), `bursts/001.17/detail.png` (large), `bursts/001.17/motion.png` (paths / skeleton / t±1 in RGB)
- **4.30–7.30s** — transition at 5.80s (beat #12 r4, novelty 2.5); also transition at 4.87s (beat #10 r2, novelty 2.1) — no hard cut; brightness 0.12–0.17, colour change 0.022/frame (cut ≥ 0.2) — `bursts/004.30/timing.png` (every frame), `bursts/004.30/detail.png` (large), `bursts/004.30/motion.png` (paths / skeleton / t±1 in RGB)
- **7.17–10.17s** — transition at 8.67s (beat #17 r1, novelty 2.4); also transition at 9.27s (beat #19 r1, novelty 1.9) — no hard cut; brightness 0.12–0.17, colour change 0.022/frame (cut ≥ 0.2) — `bursts/007.17/timing.png` (every frame), `bursts/007.17/detail.png` (large), `bursts/007.17/motion.png` (paths / skeleton / t±1 in RGB)
- **10.10–13.10s** — transition at 11.60s (beat #23 r1, novelty 2.6); also transition at 10.87s (beat #22 r2, novelty 2.4); also every 10 s (no audio to place by) — no hard cut; brightness 0.12–0.17, colour change 0.022/frame (cut ≥ 0.2) — `bursts/010.10/timing.png` (every frame), `bursts/010.10/detail.png` (large), `bursts/010.10/motion.png` (paths / skeleton / t±1 in RGB)
- **16.30–19.30s** — transition at 17.80s (beat #36 r4, novelty 2.9); also transition at 16.87s (beat #34 r2, novelty 2.2) — no hard cut; brightness 0.12–0.17, colour change 0.022/frame (cut ≥ 0.2) — `bursts/016.30/timing.png` (every frame), `bursts/016.30/detail.png` (large), `bursts/016.30/motion.png` (paths / skeleton / t±1 in RGB)
- **22.30–25.30s** — transition at 23.80s (beat #48 r16, novelty 2.5); also transition at 22.87s (beat #46 r2, novelty 2.1) — no hard cut; brightness 0.12–0.17, colour change 0.022/frame (cut ≥ 0.2) — `bursts/022.30/timing.png` (every frame), `bursts/022.30/detail.png` (large), `bursts/022.30/motion.png` (paths / skeleton / t±1 in RGB)
- **25.30–28.30s** — transition at 26.80s (beat #54 r2, novelty 2.2); also transition at 25.87s (beat #52 r4, novelty 1.7) — no hard cut; brightness 0.12–0.17, colour change 0.022/frame (cut ≥ 0.2) — `bursts/025.30/timing.png` (every frame), `bursts/025.30/detail.png` (large), `bursts/025.30/motion.png` (paths / skeleton / t±1 in RGB)
- **27.00–30.00s** — transition at 29.80s (beat #59 r1, novelty 2.4); also transition at 28.87s (beat #58 r2, novelty 2.2); also transition at 27.27s (beat #55 r1, novelty 2.0); also every 10 s (no audio to place by) — no hard cut; brightness 0.12–0.17, colour change 0.022/frame (cut ≥ 0.2) — `bursts/027.00/timing.png` (every frame), `bursts/027.00/detail.png` (large), `bursts/027.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#160414`×0.33 `#340c2e`×0.30 `#5e1953`×0.17 `#963a8b`×0.13 `#cc73c5`×0.07
- mirror symmetry, ~1 axis (r 0.32); centre brightness 0.27 vs edge 0.17; mean brightness 0.19, dark frames 0%; saturation 0.74
- motion: zoom mean +0.335 (|zoom| 0.335) log-scale/s, rotation mean +0.0° (|rot| 1.1°)/s, frame-to-frame activity 0.030

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 4 | +0.72 | +0.89 | -0.25 | +0.98 | +1.23 |
| 8 | 4 | +0.55 | +0.57 | +0.23 | +0.76 | +1.38 |
| 4 | 7 | +0.73 | +0.50 | +0.35 | +1.06 | +1.80 |
| 2 | 15 | +0.79 | +0.84 | +0.15 | +1.08 | +1.16 |
| 1 | 30 | +0.48 | +0.94 | +0.32 | +0.92 | -0.16 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 2.67 | #5 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 3.27 | #7 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 4.87 | #10 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 5.80 | #12 | -200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r4), no onset, → probably not audio-driven |
| 8.67 | #17 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 9.27 | #19 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 10.87 | #22 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 11.60 | #23 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut, blackout |
| 14.73 | #29 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 15.27 | #31 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 16.87 | #34 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 17.80 | #36 | -200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r4), no onset, → probably not audio-driven |
| 20.67 | #41 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 22.87 | #46 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 23.80 | #48 | -200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r16), no onset, → probably not audio-driven |
| 25.87 | #52 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 26.80 | #54 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, → probably not audio-driven |
| 27.27 | #55 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 28.87 | #58 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 29.80 | #59 | +300 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.60 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #8 (r8, 4.00s): bright +1.7σ, sat -0.9σ, act +1.2σ, rot +0.9σ
- beat #12 (r4, 6.00s): bright -1.3σ, act -1.5σ, rot -1.4σ
- beat #20 (r4, 10.00s): bright +1.7σ, sat -0.8σ, act +1.2σ, rot +0.8σ
- beat #24 (r8, 12.00s): bright -1.3σ, sat +0.8σ, act -1.5σ, rot -1.4σ
- beat #32 (r16, 16.00s): bright +1.7σ, sat -0.8σ, act +1.2σ, rot +0.8σ
- beat #36 (r4, 18.00s): bright -1.3σ, act -1.5σ, rot -1.5σ
- beat #44 (r4, 22.00s): bright +1.7σ, sat -0.9σ, act +1.2σ, rot +0.9σ
- beat #48 (r16, 24.00s): bright -1.3σ, sat +0.8σ, act -1.5σ, rot -1.5σ
- beat #56 (r8, 28.00s): bright +1.7σ, sat -0.9σ, act +1.2σ, rot +0.8σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/001.17/timing.png` … — burst 1.17–4.17s (continuous): transition at 2.67s (beat #5 r1, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/004.30/timing.png` … — burst 4.30–7.30s (continuous): transition at 5.80s (beat #12 r4, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/007.17/timing.png` … — burst 7.17–10.17s (continuous): transition at 8.67s (beat #17 r1, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.10/timing.png` … — burst 10.10–13.10s (continuous): transition at 11.60s (beat #23 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/016.30/timing.png` … — burst 16.30–19.30s (continuous): transition at 17.80s (beat #36 r4, novelty 2.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.30/timing.png` … — burst 22.30–25.30s (continuous): transition at 23.80s (beat #48 r16, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/025.30/timing.png` … — burst 25.30–28.30s (continuous): transition at 26.80s (beat #54 r2, novelty 2.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/027.00/timing.png` … — burst 27.00–30.00s (continuous): transition at 29.80s (beat #59 r1, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py -TaRL--y9Xc --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
