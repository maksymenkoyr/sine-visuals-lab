# ref bundle: mandelgrid

`tools/.cache/refs/_downloads/mandelgrid.mp4` — 0.0+59.0s. no usable audio (no audio stream).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (no audio stream): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 19 hard cuts in 59 s, densest second 5 cuts at 12s; holds between cuts 67–4633 ms (median 200); 9 fades over 2–3 frames (67–100 ms, median 2) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 1 strobe stretch(es), flashes every 0.33 s (3.1 Hz), at t 9.1
- 8 single transitions at t 2.0, 2.5, 8.3, 12.7, 20.9, 21.9, 22.5, 30.8

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 34% of the clip, 40.80s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 16 lit objects on 1080×1920 (lit floor 0.18, lit 9.0% of pixels): 7 disc, 6 blob, 2 frame, 1 hex ring; outlines 19%, fills 81%; 67% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-3.05 over 10 gates: 0.151 half-heights at r 0.3, 0.005 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.074, r0.6-1.0 → —, r>1 → —
- rings at r ≈ 0.34 (×3), 0.47 (×11); 3-fold (score 0.69); on the axes 6%, on the diagonals 62%
- stroke (outlines): 2.3 px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 0.87, ground lum 0.000
- hues (by lit area): spring 150° 100%; ground `#000000`, centre/edge ground brightness 0.00
- flow (98 object tracks, 20% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.20 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.00, 0.39:-0.00, 0.61:-0.00, 0.87:—, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.66 at r<0.45 vs 1.65 at r≥0.45; 56% of elongated objects lie along the radial direction

### Regime 2 — 25% of the clip, 26.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 22 lit objects on 1080×1920 (lit floor 0.18, lit 24.3% of pixels): 12 blob, 6 bar, 2 disc, 1 frame, 1 panel; outlines 5%, fills 95%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.31 over 10 substantial objects: 0.024 half-heights at r 0.3, 0.034 at r 0.9 → in between
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.027, r0.3-0.6 → 0.056, r0.6-1.0 → 0.375, r>1 → 0.016
- rings at r ≈ 0.21 (×7), 0.30 (×3), 0.60 (×4), 0.75 (×3), 1.06 (×2); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 4.6 px at r<0.45, None px at r≥0.45; glow e-fold 1.3 px, halo/core 0.01 at 4 px; core lum 0.86, ground lum 0.000
- hues (by lit area): spring 150° 100%; ground `#000000`, centre/edge ground brightness 0.44
- flow (43 object tracks, 65% moving outward → objects fly toward the camera): radial speed ∝ r^-4.20 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:—, 0.61:+0.01, 0.87:+0.01, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.99 at r<0.45 vs 2.2 at r≥0.45; 37% of elongated objects lie along the radial direction

### Regime 3 — 21% of the clip, 6.67s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 2 lit objects on 1080×1920 (lit floor 0.18, lit 19.2% of pixels): 1 bar, 1 ring; outlines 50%, fills 50%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 12.0 px at r<0.45, None px at r≥0.45; glow e-fold 18.3 px, halo/core 0.07 at 4 px; core lum 0.96, ground lum 0.000
- hues (by lit area): spring 150° 96%; ground `#000000`, centre/edge ground brightness 0.00
- streak: median elongation 1.83 at r<0.45 vs 4.99 at r≥0.45; 50% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 13.67s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 0 lit objects on 1080×1920 (lit floor 1.11, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.820
- hues (by lit area): ; ground `#d0d1d1`, centre/edge ground brightness 1.28
- flow (32 object tracks, 16% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.60 (not a zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:-0.00, 0.61:—, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 5 — 7% of the clip, 3.00s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 117 lit objects on 1080×1920 (lit floor 0.18, lit 32.9% of pixels): 61 disc, 32 blob, 19 bar, 3 ring, 1 frame, 1 panel; outlines 3%, fills 97%; 25% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.16 over 65 gates: 0.016 half-heights at r 0.3, 0.019 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.023, r0.3-0.6 → 0.038, r0.6-1.0 → 0.038, r>1 → —
- rings at r ≈ 0.17 (×19), 0.34 (×20), 0.60 (×46); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core -851.30 at 4 px; core lum 0.81, ground lum 0.921
- hues (by lit area): spring 150° 100%; ground `#e7ebed`, centre/edge ground brightness 1.00
- flow (1631 object tracks, 34% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.41 (not a zoom) 0.40 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:+0.00, 0.39:+0.00, 0.61:-0.04, 0.87:-0.03, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.76 at r<0.45 vs 1.95 at r≥0.45; 59% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.50–3.50s** — transition at 2.00s (beat #4 r4, novelty 10.3); also transition at 2.53s (beat #5 r1, novelty 1.7); also every 10 s (no audio to place by) — 3 hard cuts, holds 67–233 ms (median 150); 3 fades over 2–3 frames (67–100 ms, median 2); brightness 0.02–0.73 — `bursts/000.50/timing.png` (every frame), `bursts/000.50/detail.png` (large), `bursts/000.50/motion.png` (paths / skeleton / t±1 in RGB)
- **6.77–9.77s** — transition at 8.27s (beat #17 r1, novelty 4.0) — 6 hard cuts, holds 67–667 ms (median 100); 1 fade over 2–2 frames (67–67 ms, median 2); brightness 0.03–0.46 — `bursts/006.77/timing.png` (every frame), `bursts/006.77/detail.png` (large), `bursts/006.77/motion.png` (paths / skeleton / t±1 in RGB)
- **8.88–11.88s** — strobe 9.13–12.07s, flashes every 0.33s; also every 10 s (no audio to place by) — 10 hard cuts, holds 67–833 ms (median 100); 7 fades over 2–3 frames (67–100 ms, median 2); brightness 0.03–0.65 — `bursts/008.88/timing.png` (every frame), `bursts/008.88/detail.png` (large), `bursts/008.88/motion.png` (paths / skeleton / t±1 in RGB)
- **11.23–14.23s** — transition at 12.73s (beat #25 r1, novelty 3.8) — 8 hard cuts, holds 67–767 ms (median 100); 3 fades over 2–3 frames (67–100 ms, median 2); brightness 0.13–0.84 — `bursts/011.23/timing.png` (every frame), `bursts/011.23/detail.png` (large), `bursts/011.23/motion.png` (paths / skeleton / t±1 in RGB)
- **19.37–22.37s** — transition at 20.87s (beat #42 r2, novelty 2.1) — no hard cut but brightness swings 0.15–0.80 — `bursts/019.37/timing.png` (every frame), `bursts/019.37/detail.png` (large), `bursts/019.37/motion.png` (paths / skeleton / t±1 in RGB)
- **21.03–24.03s** — transition at 22.53s (beat #45 r1, novelty 2.2); also transition at 21.87s (beat #44 r4, novelty 1.9); also every 10 s (no audio to place by) — no hard cut but brightness swings 0.13–0.41 — `bursts/021.03/timing.png` (every frame), `bursts/021.03/detail.png` (large), `bursts/021.03/motion.png` (paths / skeleton / t±1 in RGB)
- **29.30–32.30s** — transition at 30.80s (beat #62 r2, novelty 1.6); also every 10 s (no audio to place by) — no hard cut but brightness swings 0.17–0.37 — `bursts/029.30/timing.png` (every frame), `bursts/029.30/detail.png` (large), `bursts/029.30/motion.png` (paths / skeleton / t±1 in RGB)
- **40.00–43.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.07–0.10, colour change 0.010/frame (cut ≥ 0.2) — `bursts/040.00/timing.png` (every frame), `bursts/040.00/detail.png` (large), `bursts/040.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#010001`×0.70 `#fbfcfb`×0.16 `#8e9a99`×0.05 `#c1cecd`×0.04 `#495254`×0.04
- mirror symmetry, ~1 axis (r 0.53); centre brightness 0.39 vs edge 0.28; mean brightness 0.30, dark frames 8%; saturation 0.11
- motion: zoom mean +0.250 (|zoom| 1.034) log-scale/s, rotation mean -7.7° (|rot| 43.4°)/s, frame-to-frame activity 0.141

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 8 | +0.09 | +0.33 | -0.14 | +0.33 | +0.48 |
| 8 | 7 | +0.99 | +0.62 | +0.29 | +0.28 | +0.56 |
| 4 | 15 | +0.32 | +0.76 | +0.12 | +0.52 | +0.47 |
| 2 | 29 | +0.32 | +0.24 | +0.09 | +0.55 | +0.62 |
| 1 | 59 | +0.34 | +0.39 | +0.08 | +0.47 | +0.50 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 2.00 | #4 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, looks like a cut |
| 2.53 | #5 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 8.27 | #17 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 9.13 | #18 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 12.07s: 10 flashes every 0.33s = 0.65 beat (no simple fraction of a beat → own timer), starts off beat r2, no onset |
| 12.73 | #25 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 20.87 | #42 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 21.87 | #44 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 22.53 | #45 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 30.80 | #62 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): bright +2.0σ, sat -1.0σ, zoom +1.1σ, abszoom -1.4σ
- beat #8 (r8, 4.00s): sat -2.7σ, act +0.9σ, rot +1.1σ
- beat #12 (r4, 6.00s): abszoom -0.9σ
- beat #16 (r16, 8.00s): rot -1.0σ
- beat #20 (r4, 10.00s): rot -1.2σ
- beat #24 (r8, 12.00s): bright +1.2σ
- beat #40 (r8, 20.00s): bright -1.0σ, act +0.9σ
- beat #44 (r4, 22.00s): rot +0.9σ
- beat #56 (r8, 28.00s): abszoom -1.3σ
- beat #60 (r4, 30.00s): act +0.8σ
- beat #64 (r16, 32.00s): zoom +0.9σ, abszoom +1.1σ
- beat #68 (r4, 34.00s): abszoom -1.3σ

## Files

- `slitscan.png` — the whole clip, 15 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.50/timing.png` … — burst 0.50–3.50s (cuts): transition at 2.00s (beat #4 r4, novelty 10.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.77/timing.png` … — burst 6.77–9.77s (cuts): transition at 8.27s (beat #17 r1, novelty 4.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/008.88/timing.png` … — burst 8.88–11.88s (cuts): strobe 9.13–12.07s, flashes every 0.33s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.23/timing.png` … — burst 11.23–14.23s (cuts): transition at 12.73s (beat #25 r1, novelty 3.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/019.37/timing.png` … — burst 19.37–22.37s (flash): transition at 20.87s (beat #42 r2, novelty 2.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/021.03/timing.png` … — burst 21.03–24.03s (flash): transition at 22.53s (beat #45 r1, novelty 2.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/029.30/timing.png` … — burst 29.30–32.30s (flash): transition at 30.80s (beat #62 r2, novelty 1.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/040.00/timing.png` … — burst 40.00–43.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py mandelgrid --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- `sheets/rank1-10.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
