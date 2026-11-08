# ref bundle: ibpvpMLUSz4

`tools/.cache/refs/_downloads/ibpvpMLUSz4.mp4` — 0.0+60.0s. no usable audio (no audio stream).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (no audio stream): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 60 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 2 strobe stretch(es), flashes every 0.35 s (2.9 Hz), at t 4.3, 29.7
- 26 single transitions at t 0.2, 1.9, 3.5, 6.5, 11.9, 14.5, 16.3, 16.5, 18.1, 24.1, 25.7, 32.7, 35.9, 42.5, 42.7, 45.9, 48.1, 49.3, 50.3, 50.5, 51.3, 51.7, 54.1, 55.1, 55.9, 56.3
- zoom direction changes at beat #4 (r4, 2.0s, +1.4σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 34% of the clip, 55.60s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 231 lit objects on 1280×720 (lit floor 0.18, lit 3.9% of pixels): 109 blob, 74 bar, 38 disc, 8 panel, 2 hex ring; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.18 over 48 gates: 0.061 half-heights at r 0.3, 0.050 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.081, r0.3-0.6 → 0.084, r0.6-1.0 → 0.162, r>1 → 0.131
- rings at r ≈ 0.38 (×17), 0.95 (×74), 1.68 (×33); 4-fold (score 0.61); on the axes 17%, on the diagonals 36%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 11.2 px, halo/core 0.30 at 4 px; core lum 0.25, ground lum 0.065
- hues (by lit area): red 0° 63%, rose 330° 37%; ground `#450013`, centre/edge ground brightness 1.55
- flow (1177 object tracks, 45% moving outward → mixed directions): radial speed ∝ r^0.17 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:-0.01, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.12 at r<0.45 vs 2.45 at r≥0.45; 35% of elongated objects lie along the radial direction

### Regime 2 — 26% of the clip, 16.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 204 lit objects on 1280×720 (lit floor 0.18, lit 4.8% of pixels): 98 blob, 51 disc, 48 bar, 3 panel, 3 hex ring, 1 ring; outlines 2%, fills 98%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.01 over 58 gates: 0.060 half-heights at r 0.3, 0.060 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.152, r0.3-0.6 → 0.159, r0.6-1.0 → 0.193, r>1 → 0.162
- rings at r ≈ 0.34 (×14), 1.19 (×61); 2-fold (score 0.69); on the axes 45%, on the diagonals 11%
- stroke (outlines): None px at r<0.45, 2.7 px at r≥0.45; glow e-fold 9.5 px, halo/core 0.26 at 4 px; core lum 0.25, ground lum 0.072
- hues (by lit area): red 0° 64%, rose 330° 35%; ground `#4c0113`, centre/edge ground brightness 1.00
- flow (1179 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^0.05 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.04, 0.21:+0.00, 0.39:+0.00, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.95 at r<0.45 vs 2.18 at r≥0.45; 46% of elongated objects lie along the radial direction

### Regime 3 — 17% of the clip, 27.27s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 201 lit objects on 1280×720 (lit floor 0.18, lit 4.4% of pixels): 77 blob, 58 disc, 56 bar, 8 panel, 2 hex ring; outlines 1%, fills 99%; 67% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.16 over 68 gates: 0.069 half-heights at r 0.3, 0.057 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.184, r0.3-0.6 → 0.275, r0.6-1.0 → 0.184, r>1 → 0.166
- rings at r ≈ 0.27 (×10), 1.34 (×68); 8-fold (score 0.61); on the axes 36%, on the diagonals 27%
- stroke (outlines): None px at r<0.45, 2.7 px at r≥0.45; glow e-fold 10.2 px, halo/core 0.23 at 4 px; core lum 0.24, ground lum 0.071
- hues (by lit area): red 0° 77%, rose 330° 23%; ground `#4b0012`, centre/edge ground brightness 0.70
- flow (1314 object tracks, 41% moving outward → mixed directions): radial speed ∝ r^-0.08 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.73 at r<0.45 vs 2.05 at r≥0.45; 38% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 16.87s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 212 lit objects on 1280×720 (lit floor 0.18, lit 4.8% of pixels): 107 blob, 61 bar, 39 disc, 3 panel, 2 ring; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.07 over 44 gates: 0.065 half-heights at r 0.3, 0.061 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.195, r0.3-0.6 → 0.163, r0.6-1.0 → 0.146, r>1 → 0.147
- rings at r ≈ 0.30 (×14), 0.47 (×16), 1.34 (×67); 2-fold (score 0.64); on the axes 49%, on the diagonals 13%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 9.3 px, halo/core 0.26 at 4 px; core lum 0.25, ground lum 0.072
- hues (by lit area): red 0° 60%, rose 330° 40%; ground `#4c0113`, centre/edge ground brightness 0.65
- flow (1197 object tracks, 41% moving outward → mixed directions): radial speed ∝ r^0.12 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.04, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.18 at r<0.45 vs 2.19 at r≥0.45; 41% of elongated objects lie along the radial direction

### Regime 5 — 9% of the clip, 22.13s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 205 lit objects on 1280×720 (lit floor 0.18, lit 4.8% of pixels): 98 blob, 58 bar, 38 disc, 9 panel, 1 ring, 1 hex ring; outlines 1%, fills 99%; 33% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.37 over 49 gates: 0.084 half-heights at r 0.3, 0.056 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.157, r0.3-0.6 → 0.319, r0.6-1.0 → 0.141, r>1 → 0.165
- rings at r ≈ 0.84 (×46), 1.50 (×63); 2-fold (score 0.67); on the axes 51%, on the diagonals 14%
- stroke (outlines): 2.7 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 8.4 px, halo/core 0.21 at 4 px; core lum 0.24, ground lum 0.076
- hues (by lit area): red 0° 69%, rose 330° 31%; ground `#500113`, centre/edge ground brightness 0.48
- flow (1196 object tracks, 40% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.11 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:-0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.41 at r<0.45 vs 2.16 at r≥0.45; 45% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **2.03–5.03s** — transition at 3.53s (beat #7 r1, novelty 2.5) — no hard cut; brightness 0.09–0.10, colour change 0.008/frame (cut ≥ 0.2) — `bursts/002.03/timing.png` (every frame), `bursts/002.03/detail.png` (large), `bursts/002.03/motion.png` (paths / skeleton / t±1 in RGB)
- **4.08–7.08s** — strobe 4.33–4.93s, flashes every 0.30s; also transition at 6.53s (beat #13 r1, novelty 1.9) — no hard cut; brightness 0.10–0.10, colour change 0.007/frame (cut ≥ 0.2) — `bursts/004.08/timing.png` (every frame), `bursts/004.08/detail.png` (large), `bursts/004.08/motion.png` (paths / skeleton / t±1 in RGB)
- **14.97–17.97s** — transition at 16.47s (beat #33 r1, novelty 2.3); also transition at 16.27s (beat #33 r1, novelty 1.5) — no hard cut; brightness 0.10–0.10, colour change 0.007/frame (cut ≥ 0.2) — `bursts/014.97/timing.png` (every frame), `bursts/014.97/detail.png` (large), `bursts/014.97/motion.png` (paths / skeleton / t±1 in RGB)
- **22.57–25.57s** — transition at 24.07s (beat #48 r16, novelty 2.4) — no hard cut; brightness 0.09–0.09, colour change 0.006/frame (cut ≥ 0.2) — `bursts/022.57/timing.png` (every frame), `bursts/022.57/detail.png` (large), `bursts/022.57/motion.png` (paths / skeleton / t±1 in RGB)
- **29.42–32.42s** — strobe 29.67–31.27s, flashes every 0.40s; also every 10 s (no audio to place by) — no hard cut; brightness 0.09–0.10, colour change 0.008/frame (cut ≥ 0.2) — `bursts/029.42/timing.png` (every frame), `bursts/029.42/detail.png` (large), `bursts/029.42/motion.png` (paths / skeleton / t±1 in RGB)
- **31.17–34.17s** — transition at 32.67s (beat #65 r1, novelty 2.5) — no hard cut; brightness 0.10–0.10, colour change 0.006/frame (cut ≥ 0.2) — `bursts/031.17/timing.png` (every frame), `bursts/031.17/detail.png` (large), `bursts/031.17/motion.png` (paths / skeleton / t±1 in RGB)
- **46.57–49.57s** — transition at 48.07s (beat #96 r16, novelty 2.7); also transition at 49.27s (beat #99 r1, novelty 1.9) — no hard cut; brightness 0.09–0.09, colour change 0.007/frame (cut ≥ 0.2) — `bursts/046.57/timing.png` (every frame), `bursts/046.57/detail.png` (large), `bursts/046.57/motion.png` (paths / skeleton / t±1 in RGB)
- **50.23–53.23s** — transition at 51.73s (beat #103 r1, novelty 2.2); also transition at 50.53s (beat #101 r1, novelty 2.0); also transition at 51.27s (beat #103 r1, novelty 1.8); also transition at 50.33s (beat #101 r1, novelty 1.7); also every 10 s (no audio to place by) — no hard cut; brightness 0.09–0.09, colour change 0.007/frame (cut ≥ 0.2) — `bursts/050.23/timing.png` (every frame), `bursts/050.23/detail.png` (large), `bursts/050.23/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#560013`×0.45 `#2a000b`×0.22 `#7a021d`×0.20 `#a8072a`×0.09 `#dd1042`×0.04
- no radial symmetry (rotational r 0.16, mirror r 0.26); centre brightness 0.17 vs edge 0.14; mean brightness 0.14, dark frames 0%; saturation 0.98
- motion: zoom mean -0.000 (|zoom| 0.010) log-scale/s, rotation mean +0.0° (|rot| 0.6°)/s, frame-to-frame activity 0.005

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 8 | +1.24 | +1.60 | +0.32 | +0.41 | +0.04 |
| 8 | 7 | +1.48 | +0.78 | +0.05 | +0.59 | +0.23 |
| 4 | 15 | +1.48 | +1.29 | -0.01 | +0.30 | +0.51 |
| 2 | 30 | +1.24 | +1.12 | +0.10 | +0.41 | +0.43 |
| 1 | 60 | +1.39 | +1.04 | +0.09 | +0.45 | +0.41 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.20 | #0 | +200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r16), no onset, → probably not audio-driven |
| 1.93 | #4 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 3.53 | #7 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 4.33 | #9 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 4.93s: 3 flashes every 0.30s = 0.60 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset |
| 6.53 | #13 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 11.87 | #24 | -133 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r8), no onset, → probably not audio-driven |
| 14.47 | #29 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 16.27 | #33 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 16.47 | #33 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 18.07 | #36 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 24.07 | #48 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 25.73 | #51 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 29.67 | #59 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 31.27s: 5 flashes every 0.40s = 0.80 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset |
| 32.67 | #65 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 35.87 | #72 | -133 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r8), no onset, → probably not audio-driven |
| 42.47 | #85 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 42.67 | #85 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 45.87 | #92 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 48.07 | #96 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 49.27 | #99 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 50.33 | #101 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 50.53 | #101 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 51.27 | #103 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 51.73 | #103 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 54.07 | #108 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 55.13 | #110 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, → probably not audio-driven |
| 55.93 | #112 | -67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 56.33 | #113 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): zoom +1.4σ
- beat #8 (r8, 4.00s): rot -1.0σ
- beat #12 (r4, 6.00s): rot -0.8σ
- beat #16 (r16, 8.00s): rot +1.1σ
- beat #24 (r8, 12.00s): rot +0.8σ
- beat #40 (r8, 20.00s): bright -1.0σ
- beat #44 (r4, 22.00s): rot -1.7σ
- beat #48 (r16, 24.00s): sat +0.8σ
- beat #68 (r4, 34.00s): zoom +0.8σ
- beat #76 (r4, 38.00s): rot -1.7σ
- beat #84 (r4, 42.00s): zoom +0.8σ, abszoom -0.8σ

## Files

- `slitscan.png` — the whole clip, 15 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/002.03/timing.png` … — burst 2.03–5.03s (continuous): transition at 3.53s (beat #7 r1, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/004.08/timing.png` … — burst 4.08–7.08s (continuous): strobe 4.33–4.93s, flashes every 0.30s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/014.97/timing.png` … — burst 14.97–17.97s (continuous): transition at 16.47s (beat #33 r1, novelty 2.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.57/timing.png` … — burst 22.57–25.57s (continuous): transition at 24.07s (beat #48 r16, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/029.42/timing.png` … — burst 29.42–32.42s (continuous): strobe 29.67–31.27s, flashes every 0.40s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/031.17/timing.png` … — burst 31.17–34.17s (continuous): transition at 32.67s (beat #65 r1, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/046.57/timing.png` … — burst 46.57–49.57s (continuous): transition at 48.07s (beat #96 r16, novelty 2.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/050.23/timing.png` … — burst 50.23–53.23s (continuous): transition at 51.73s (beat #103 r1, novelty 2.2). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py ibpvpMLUSz4 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- `sheets/rank2-6.png`
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
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
