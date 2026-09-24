# ref bundle: rBwFHMb8Lh0

`tools/.cache/refs/_downloads/rBwFHMb8Lh0.mp4` — 0.0+45.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- no hard cuts at 30 fps in 45 s: every transition below is a fade or a motion
- 10 single transitions at t 5.1, 8.3, 13.5, 16.7, 21.8, 25.1, 30.1, 33.4, 38.5, 41.7
- zoom direction changes at beat #24 (r8, 12.0s, +1.4σ)
- zoom direction changes at beat #56 (r8, 28.0s, +1.9σ)
- rotates clockwise continuously (-0.1°/s)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 28% of the clip, 22.60s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 56 lit objects on 1280×720 (lit floor 0.31, lit 26.6% of pixels): 20 bar, 11 blob, 11 disc, 6 panel, 4 hex ring, 4 ring; outlines 14%, fills 86%; 75% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.62 over 25 gates: 0.614 half-heights at r 0.3, 0.310 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.300, r0.3-0.6 → 0.938, r0.6-1.0 → 0.336, r>1 → 0.753
- rings at r ≈ 0.60 (×4), 0.95 (×17), 1.68 (×21); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, 10.6 px at r≥0.45; glow e-fold 36.2 px, halo/core 0.10 at 4 px; core lum 0.74, ground lum 0.237
- hues (by lit area): blue 240° 100%; ground `#6b320e`, centre/edge ground brightness 0.83
- flow (330 object tracks, 47% moving outward → mixed directions): radial speed ∝ r^-0.01 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.00, 0.39:-0.03, 0.61:+0.01, 0.87:-0.00, 1.22:+0.00; rotation -0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.77 at r<0.45 vs 2.11 at r≥0.45; 43% of elongated objects lie along the radial direction

### Regime 2 — 27% of the clip, 20.53s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 71 lit objects on 1280×720 (lit floor 0.29, lit 26.1% of pixels): 22 bar, 17 blob, 17 disc, 15 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.01 over 32 gates: 0.210 half-heights at r 0.3, 0.208 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.939, r0.6-1.0 → 0.860, r>1 → 0.479
- rings at r ≈ 0.60 (×6), 1.19 (×24), 1.68 (×27); 2-fold (score 0.69); on the axes 39%, on the diagonals 13%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 14.8 px, halo/core 0.09 at 4 px; core lum 0.74, ground lum 0.232
- hues (by lit area): blue 240° 100%; ground `#673115`, centre/edge ground brightness 0.93
- flow (342 object tracks, 51% moving outward → mixed directions): radial speed ∝ r^0.03 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.00, 0.39:—, 0.61:+0.00, 0.87:+0.01, 1.22:+0.00; rotation -0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.17 at r<0.45 vs 2.45 at r≥0.45; 47% of elongated objects lie along the radial direction

### Regime 3 — 17% of the clip, 31.60s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 70 lit objects on 1280×720 (lit floor 0.31, lit 29.0% of pixels): 26 bar, 24 blob, 11 disc, 9 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.17 over 20 gates: 0.170 half-heights at r 0.3, 0.141 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 1.448, r0.6-1.0 → 1.006, r>1 → 0.346
- rings at r ≈ 1.68 (×27); 2-fold (score 0.64); on the axes 47%, on the diagonals 13%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 3.5 px, halo/core 0.04 at 4 px; core lum 0.74, ground lum 0.284
- hues (by lit area): blue 240° 100%; ground `#7e3d14`, centre/edge ground brightness 0.96
- flow (286 object tracks, 49% moving outward → mixed directions): radial speed ∝ r^0.25 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:+0.00, 0.61:-0.00, 0.87:-0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.59 at r<0.45 vs 2.27 at r≥0.45; 39% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 10.40s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 65 lit objects on 1280×720 (lit floor 0.31, lit 27.9% of pixels): 28 blob, 19 disc, 13 bar, 5 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.11 over 24 gates: 0.353 half-heights at r 0.3, 0.312 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.514, r0.3-0.6 → 0.331, r0.6-1.0 → 0.523, r>1 → 0.443
- rings at r ≈ 0.47 (×4), 1.06 (×21), 1.68 (×20); 2-fold (score 0.77); on the axes 40%, on the diagonals 18%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 25.5 px, halo/core 0.18 at 4 px; core lum 0.75, ground lum 0.191
- hues (by lit area): blue 240° 100%; ground `#562815`, centre/edge ground brightness 1.39
- flow (506 object tracks, 45% moving outward → mixed directions): radial speed ∝ r^0.13 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.01, 0.61:+0.00, 0.87:-0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.69 at r<0.45 vs 1.65 at r≥0.45; 36% of elongated objects lie along the radial direction

### Regime 5 — 12% of the clip, 9.13s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 53 lit objects on 1280×720 (lit floor 0.31, lit 27.2% of pixels): 19 disc, 12 blob, 7 bar, 7 panel, 6 hex ring, 2 frame; outlines 15%, fills 85%; 12% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.09 over 34 gates: 0.273 half-heights at r 0.3, 0.301 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.737, r0.3-0.6 → —, r0.6-1.0 → 0.747, r>1 → 0.470
- rings at r ≈ 1.06 (×14), 1.68 (×17); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 11.2 px at r<0.45, 11.5 px at r≥0.45; glow e-fold 29.4 px, halo/core 0.13 at 4 px; core lum 0.74, ground lum 0.220
- hues (by lit area): blue 240° 100%; ground `#602e21`, centre/edge ground brightness 1.31
- flow (437 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^0.32 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.00, 0.39:-0.00, 0.61:+0.00, 0.87:-0.00, 1.22:-0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.51 at r<0.45 vs 1.56 at r≥0.45; 30% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **3.63–6.63s** — transition at 5.13s (beat #10 r2, novelty 4.1) — no hard cut; brightness 0.39–0.40, colour change 0.016/frame (cut ≥ 0.2) — `bursts/003.63/timing.png` (every frame), `bursts/003.63/detail.png` (large), `bursts/003.63/motion.png` (paths / skeleton / t±1 in RGB)
- **6.83–9.83s** — transition at 8.33s (beat #17 r1, novelty 2.5) — no hard cut; brightness 0.40–0.41, colour change 0.016/frame (cut ≥ 0.2) — `bursts/006.83/timing.png` (every frame), `bursts/006.83/detail.png` (large), `bursts/006.83/motion.png` (paths / skeleton / t±1 in RGB)
- **11.97–14.97s** — transition at 13.47s (beat #27 r1, novelty 4.2) — no hard cut; brightness 0.41–0.42, colour change 0.016/frame (cut ≥ 0.2) — `bursts/011.97/timing.png` (every frame), `bursts/011.97/detail.png` (large), `bursts/011.97/motion.png` (paths / skeleton / t±1 in RGB)
- **15.23–18.23s** — transition at 16.73s (beat #33 r1, novelty 2.8) — no hard cut; brightness 0.38–0.41, colour change 0.017/frame (cut ≥ 0.2) — `bursts/015.23/timing.png` (every frame), `bursts/015.23/detail.png` (large), `bursts/015.23/motion.png` (paths / skeleton / t±1 in RGB)
- **20.30–23.30s** — transition at 21.80s (beat #44 r4, novelty 4.2); also every 10 s (no audio to place by) — no hard cut; brightness 0.39–0.40, colour change 0.016/frame (cut ≥ 0.2) — `bursts/020.30/timing.png` (every frame), `bursts/020.30/detail.png` (large), `bursts/020.30/motion.png` (paths / skeleton / t±1 in RGB)
- **23.57–26.57s** — transition at 25.07s (beat #50 r2, novelty 2.7) — no hard cut; brightness 0.40–0.41, colour change 0.015/frame (cut ≥ 0.2) — `bursts/023.57/timing.png` (every frame), `bursts/023.57/detail.png` (large), `bursts/023.57/motion.png` (paths / skeleton / t±1 in RGB)
- **28.63–31.63s** — transition at 30.13s (beat #60 r4, novelty 4.7); also every 10 s (no audio to place by) — no hard cut; brightness 0.42–0.42, colour change 0.016/frame (cut ≥ 0.2) — `bursts/028.63/timing.png` (every frame), `bursts/028.63/detail.png` (large), `bursts/028.63/motion.png` (paths / skeleton / t±1 in RGB)
- **36.97–39.97s** — transition at 38.47s (beat #77 r1, novelty 4.1) — no hard cut; brightness 0.38–0.40, colour change 0.017/frame (cut ≥ 0.2) — `bursts/036.97/timing.png` (every frame), `bursts/036.97/detail.png` (large), `bursts/036.97/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#8c4617`×0.32 `#c5c4de`×0.23 `#302b91`×0.16 `#431e27`×0.16 `#7b78c3`×0.13
- mirror symmetry, ~1 axis (r 0.42); centre brightness 0.41 vs edge 0.41; mean brightness 0.41, dark frames 0%; saturation 0.58
- motion: zoom mean -0.002 (|zoom| 0.004) log-scale/s, rotation mean -0.1° (|rot| 0.1°)/s, frame-to-frame activity 0.008

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 6 | +0.46 | +0.56 | +0.19 | +0.23 | +0.85 |
| 8 | 6 | +1.07 | -0.05 | +0.00 | -0.08 | +0.98 |
| 4 | 11 | +0.61 | +1.15 | -0.00 | +0.47 | +0.81 |
| 2 | 22 | +0.69 | +0.80 | +0.02 | +0.33 | +0.81 |
| 1 | 45 | +0.70 | +0.57 | +0.05 | +0.31 | +0.78 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 5.13 | #10 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, → probably not audio-driven |
| 8.33 | #17 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 13.47 | #27 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 16.73 | #33 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 21.80 | #44 | -200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r4), no onset, → probably not audio-driven |
| 25.07 | #50 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 30.13 | #60 | +133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r4), no onset, → probably not audio-driven |
| 33.40 | #67 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, → probably not audio-driven |
| 38.47 | #77 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 41.73 | #83 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #24 (r8, 12.00s): zoom +1.4σ, abszoom +1.0σ
- beat #32 (r16, 16.00s): bright -0.9σ, sat +0.9σ
- beat #56 (r8, 28.00s): zoom +1.9σ, abszoom -1.8σ
- beat #88 (r8, 44.00s): zoom +0.8σ, abszoom -1.3σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/003.63/timing.png` … — burst 3.63–6.63s (continuous): transition at 5.13s (beat #10 r2, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.83/timing.png` … — burst 6.83–9.83s (continuous): transition at 8.33s (beat #17 r1, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.97/timing.png` … — burst 11.97–14.97s (continuous): transition at 13.47s (beat #27 r1, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.23/timing.png` … — burst 15.23–18.23s (continuous): transition at 16.73s (beat #33 r1, novelty 2.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.30/timing.png` … — burst 20.30–23.30s (continuous): transition at 21.80s (beat #44 r4, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/023.57/timing.png` … — burst 23.57–26.57s (continuous): transition at 25.07s (beat #50 r2, novelty 2.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/028.63/timing.png` … — burst 28.63–31.63s (continuous): transition at 30.13s (beat #60 r4, novelty 4.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/036.97/timing.png` … — burst 36.97–39.97s (continuous): transition at 38.47s (beat #77 r1, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py rBwFHMb8Lh0 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
