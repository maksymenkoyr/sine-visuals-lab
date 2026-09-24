# ref bundle: marble

`tools/.cache/refs/_downloads/-2j_U0pqovQ.mp4` — 50.0+30.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- no hard cuts at 30 fps in 30 s: every transition below is a fade or a motion
- 7 single transitions at t 9.5, 10.3, 11.3, 13.3, 13.9, 14.9, 17.1

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 36% of the clip, 23.60s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 872 lit objects on 1280×720 (lit floor 1.00, lit 12.6% of pixels): 691 bar, 75 blob, 56 disc, 34 panel, 10 hex ring, 4 ring, 2 frame; outlines 5%, fills 95%; 39% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.29 over 106 gates: 0.046 half-heights at r 0.3, 0.062 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.112, r0.3-0.6 → 0.139, r0.6-1.0 → 0.192, r>1 → 0.367
- rings at r ≈ 0.84 (×292), 1.50 (×88); 2-fold (score 0.99); on the axes 46%, on the diagonals 32%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core -52.54 at 4 px; core lum 1.00, ground lum 0.990
- hues (by lit area): white 0° 100%; ground `#fcfcfc`, centre/edge ground brightness 0.04
- flow (923 object tracks, 61% moving outward → objects fly toward the camera): radial speed ∝ r^1.09 (a flat zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.02, 0.39:+0.02, 0.61:+0.06, 0.87:+0.04, 1.22:+0.08; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.88 at r<0.45 vs 5.24 at r≥0.45; 59% of elongated objects lie along the radial direction

### Regime 2 — 21% of the clip, 2.67s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.12, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.917
- hues (by lit area): ; ground `#eae9ea`, centre/edge ground brightness 0.27
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 3 — 16% of the clip, 12.27s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 124 lit objects on 1280×720 (lit floor 0.50, lit 30.6% of pixels): 84 bar, 21 blob, 11 panel, 8 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.83 over 19 gates: 0.121 half-heights at r 0.3, 0.300 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.484, r0.3-0.6 → 0.474, r0.6-1.0 → 1.460, r>1 → 0.912
- rings at r ≈ 0.47 (×17), 0.95 (×47); 2-fold (score 0.68); on the axes 42%, on the diagonals 25%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -29.67 at 4 px; core lum 0.98, ground lum 0.960
- hues (by lit area): chartreuse 90° 88%, violet 270° 8%; ground `#f4f4f7`, centre/edge ground brightness 0.06
- flow (448 object tracks, 34% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.43 (a flat zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.01, 0.61:-0.05, 0.87:-0.08, 1.22:-0.13; rotation +0.1°/s (+ = counter-clockwise on screen)
- streak: median elongation 10.66 at r<0.45 vs 3.9 at r≥0.45; 43% of elongated objects lie along the radial direction

### Regime 4 — 15% of the clip, 6.67s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 123 lit objects on 1280×720 (lit floor 0.48, lit 35.7% of pixels): 96 bar, 19 panel, 5 blob, 3 disc; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.01 over 22 gates: 1.180 half-heights at r 0.3, 0.387 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 1.343, r0.6-1.0 → 1.226, r>1 → 1.158
- rings at r ≈ 0.38 (×10), 0.95 (×49); 2-fold (score 0.79); on the axes 38%, on the diagonals 24%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core -15.20 at 4 px; core lum 0.98, ground lum 0.939
- hues (by lit area): cyan 180° 100%; ground `#efeff0`, centre/edge ground brightness 0.02
- flow (482 object tracks, 51% moving outward → mixed directions): radial speed ∝ r^0.73 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.07, 0.39:-0.01, 0.61:+0.00, 0.87:-0.00, 1.22:+0.04; rotation +0.3°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.19 at r<0.45 vs 5.95 at r≥0.45; 52% of elongated objects lie along the radial direction

### Regime 5 — 12% of the clip, 15.40s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 295 lit objects on 1280×720 (lit floor 0.71, lit 29.2% of pixels): 174 bar, 65 blob, 37 panel, 16 disc, 2 ring, 1 frame; outlines 1%, fills 99%; 75% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.55 over 56 gates: 0.271 half-heights at r 0.3, 0.149 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.423, r0.3-0.6 → 0.358, r0.6-1.0 → 1.600, r>1 → 0.302
- rings at r ≈ 0.60 (×75), 0.95 (×70), 1.50 (×50); 2-fold (score 0.92); on the axes 51%, on the diagonals 24%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core -600.37 at 4 px; core lum 0.97, ground lum 0.984
- hues (by lit area): blue 240° 68%, violet 270° 31%; ground `#fafafb`, centre/edge ground brightness 0.05
- flow (1268 object tracks, 32% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.96 (a flat zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:-0.01, 0.39:-0.02, 0.61:-0.05, 0.87:-0.07, 1.22:-0.12; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.42 at r<0.45 vs 3.72 at r≥0.45; 47% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.90–0.92, colour change 0.004/frame (cut ≥ 0.2) — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **7.97–10.97s** — transition at 9.47s (beat #19 r1, novelty 1.9) — no hard cut; brightness 0.77–0.81, colour change 0.009/frame (cut ≥ 0.2) — `bursts/007.97/timing.png` (every frame), `bursts/007.97/detail.png` (large), `bursts/007.97/motion.png` (paths / skeleton / t±1 in RGB)
- **9.77–12.77s** — transition at 11.27s (beat #23 r1, novelty 6.0); also transition at 10.27s (beat #21 r1, novelty 3.1); also every 10 s (no audio to place by) — no hard cut; brightness 0.74–0.81, colour change 0.011/frame (cut ≥ 0.2) — `bursts/009.77/timing.png` (every frame), `bursts/009.77/detail.png` (large), `bursts/009.77/motion.png` (paths / skeleton / t±1 in RGB)
- **11.83–14.83s** — transition at 13.33s (beat #27 r1, novelty 2.6) — no hard cut; brightness 0.77–0.80, colour change 0.015/frame (cut ≥ 0.2) — `bursts/011.83/timing.png` (every frame), `bursts/011.83/detail.png` (large), `bursts/011.83/motion.png` (paths / skeleton / t±1 in RGB)
- **13.37–16.37s** — transition at 14.87s (beat #30 r2, novelty 6.7); also transition at 13.87s (beat #28 r4, novelty 4.3) — no hard cut; brightness 0.77–0.82, colour change 0.018/frame (cut ≥ 0.2) — `bursts/013.37/timing.png` (every frame), `bursts/013.37/detail.png` (large), `bursts/013.37/motion.png` (paths / skeleton / t±1 in RGB)
- **15.57–18.57s** — transition at 17.07s (beat #34 r2, novelty 3.0) — no hard cut; brightness 0.81–0.86, colour change 0.014/frame (cut ≥ 0.2) — `bursts/015.57/timing.png` (every frame), `bursts/015.57/detail.png` (large), `bursts/015.57/motion.png` (paths / skeleton / t±1 in RGB)
- **20.00–23.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.85–0.88, colour change 0.008/frame (cut ≥ 0.2) — `bursts/020.00/timing.png` (every frame), `bursts/020.00/detail.png` (large), `bursts/020.00/motion.png` (paths / skeleton / t±1 in RGB)
- **27.00–30.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.89–0.91, colour change 0.006/frame (cut ≥ 0.2) — `bursts/027.00/timing.png` (every frame), `bursts/027.00/detail.png` (large), `bursts/027.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#fbfafb`×0.78 `#14111a`×0.09 `#b1b0bb`×0.08 `#62606a`×0.04 `#2e27a1`×0.01
- no radial symmetry (rotational r 0.01, mirror r 0.22); centre brightness 0.12 vs edge 0.83; mean brightness 0.75, dark frames 0%; saturation 0.07
- motion: zoom mean +0.002 (|zoom| 0.037) log-scale/s, rotation mean -0.3° (|rot| 0.8°)/s, frame-to-frame activity 0.040

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 4 | +0.10 | +0.20 | +0.07 | +0.13 | +0.05 |
| 8 | 4 | +0.07 | +0.04 | +0.24 | +0.99 | +0.19 |
| 4 | 7 | +0.38 | +0.60 | -0.05 | +0.14 | +0.35 |
| 2 | 15 | +0.34 | +0.55 | +0.02 | +0.38 | +0.43 |
| 1 | 30 | +0.38 | +0.61 | +0.04 | +0.56 | +0.27 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 9.47 | #19 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 10.27 | #21 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 11.27 | #23 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 13.33 | #27 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 13.87 | #28 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, looks like a cut, → probably not audio-driven |
| 14.87 | #30 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, looks like a cut, → probably not audio-driven |
| 17.07 | #34 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #8 (r8, 4.00s): bright -1.2σ
- beat #20 (r4, 10.00s): zoom -0.9σ, abszoom -0.9σ
- beat #24 (r8, 12.00s): act -0.9σ, abszoom +0.9σ
- beat #36 (r4, 18.00s): sat -0.9σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/007.97/timing.png` … — burst 7.97–10.97s (continuous): transition at 9.47s (beat #19 r1, novelty 1.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/009.77/timing.png` … — burst 9.77–12.77s (continuous): transition at 11.27s (beat #23 r1, novelty 6.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.83/timing.png` … — burst 11.83–14.83s (continuous): transition at 13.33s (beat #27 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/013.37/timing.png` … — burst 13.37–16.37s (continuous): transition at 14.87s (beat #30 r2, novelty 6.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.57/timing.png` … — burst 15.57–18.57s (continuous): transition at 17.07s (beat #34 r2, novelty 3.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.00/timing.png` … — burst 20.00–23.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/027.00/timing.png` … — burst 27.00–30.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py marble --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
