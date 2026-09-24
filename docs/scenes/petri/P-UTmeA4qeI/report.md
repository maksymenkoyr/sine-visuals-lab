# ref bundle: P-UTmeA4qeI

`tools/.cache/refs/_downloads/P-UTmeA4qeI.mp4` — 0.0+30.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- no hard cuts at 30 fps in 30 s: every transition below is a fade or a motion
- 2 strobe stretch(es), flashes every 0.33 s (3.0 Hz), at t 0.7, 8.4
- 12 single transitions at t 2.3, 2.9, 4.3, 5.7, 6.5, 7.7, 10.7, 14.3, 22.0, 22.3, 25.1, 26.9
- zoom direction changes at beat #4 (r4, 2.0s, +1.3σ)
- rotates clockwise continuously (-0.5°/s)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 28% of the clip, 27.20s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 165 lit objects on 720×720 (lit floor 0.23, lit 28.3% of pixels): 89 blob, 38 bar, 22 disc, 16 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.24 over 38 gates: 0.071 half-heights at r 0.3, 0.054 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.222, r0.3-0.6 → 0.626, r0.6-1.0 → 0.338, r>1 → 0.271
- rings at r ≈ 0.95 (×65); 2-fold (score 0.89); on the axes 36%, on the diagonals 15%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 11.9 px, halo/core 0.24 at 4 px; core lum 0.63, ground lum 0.122
- hues (by lit area): yellow 60° 68%, orange 30° 18%, chartreuse 90° 12%; ground `#241d1b`, centre/edge ground brightness 0.39
- flow (1240 object tracks, 45% moving outward → mixed directions): radial speed ∝ r^-0.03 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:-0.01, 0.21:+0.00, 0.39:-0.02, 0.61:-0.00, 0.87:+0.01, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.63 at r<0.45 vs 2.0 at r≥0.45; 47% of elongated objects lie along the radial direction

### Regime 2 — 26% of the clip, 19.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 179 lit objects on 720×720 (lit floor 0.21, lit 32.9% of pixels): 96 blob, 49 bar, 21 disc, 13 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.15 over 34 gates: 0.051 half-heights at r 0.3, 0.043 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.221, r0.3-0.6 → 0.251, r0.6-1.0 → 0.499, r>1 → 0.332
- rings at r ≈ 0.34 (×12), 0.95 (×71); 2-fold (score 0.91); on the axes 34%, on the diagonals 23%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 17.5 px, halo/core 0.20 at 4 px; core lum 0.60, ground lum 0.068
- hues (by lit area): yellow 60° 74%, orange 30° 23%; ground `#121015`, centre/edge ground brightness 1.00
- flow (1441 object tracks, 46% moving outward → mixed directions): radial speed ∝ r^0.18 (not a zoom) 0.03 half-heights/s at r 0.5; by r → 0.07:-0.02, 0.21:-0.01, 0.39:-0.00, 0.61:+0.01, 0.87:-0.00, 1.22:-0.01; rotation -0.4°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.11 at r<0.45 vs 1.97 at r≥0.45; 53% of elongated objects lie along the radial direction

### Regime 3 — 21% of the clip, 10.00s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 206 lit objects on 720×720 (lit floor 0.20, lit 34.6% of pixels): 128 blob, 36 bar, 29 disc, 13 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.19 over 42 gates: 0.066 half-heights at r 0.3, 0.081 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.326, r0.3-0.6 → 0.214, r0.6-1.0 → 0.325, r>1 → 0.240
- rings at r ≈ 0.95 (×83); 8-fold (score 0.82); on the axes 28%, on the diagonals 28%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 19.0 px, halo/core 0.28 at 4 px; core lum 0.59, ground lum 0.000
- hues (by lit area): yellow 60° 78%, orange 30° 17%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1634 object tracks, 52% moving outward → mixed directions): radial speed ∝ r^0.42 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:-0.04, 0.21:-0.01, 0.39:+0.01, 0.61:+0.01, 0.87:+0.00, 1.22:+0.00; rotation -0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.64 at r<0.45 vs 1.93 at r≥0.45; 47% of elongated objects lie along the radial direction

### Regime 4 — 20% of the clip, 7.87s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 296 lit objects on 720×720 (lit floor 0.21, lit 37.4% of pixels): 184 blob, 54 disc, 41 bar, 17 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.35 over 71 gates: 0.090 half-heights at r 0.3, 0.062 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.213, r0.3-0.6 → 0.279, r0.6-1.0 → 0.333, r>1 → 0.217
- rings at r ≈ 0.95 (×118); 8-fold (score 0.87); on the axes 31%, on the diagonals 25%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 17.2 px, halo/core 0.25 at 4 px; core lum 0.59, ground lum 0.000
- hues (by lit area): orange 30° 70%, yellow 60° 30%; ground `#000000`, centre/edge ground brightness 1.00
- flow (2302 object tracks, 50% moving outward → mixed directions): radial speed ∝ r^0.15 (not a zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:+0.00, 0.39:+0.01, 0.61:+0.00, 0.87:+0.00, 1.22:-0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.81 at r<0.45 vs 1.74 at r≥0.45; 46% of elongated objects lie along the radial direction

### Regime 5 — 5% of the clip, 0.47s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 153 lit objects on 720×720 (lit floor 0.20, lit 19.7% of pixels): 78 blob, 36 bar, 27 disc, 10 panel, 1 hex ring, 1 ring; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.50 over 39 gates: 0.030 half-heights at r 0.3, 0.051 at r 0.9 → in between
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.039, r0.3-0.6 → 0.118, r0.6-1.0 → 0.158, r>1 → 0.269
- rings at r ≈ 0.47 (×12), 1.06 (×75); 5-fold (score 0.75); on the axes 35%, on the diagonals 25%
- stroke (outlines): None px at r<0.45, 6.0 px at r≥0.45; glow e-fold 2.9 px, halo/core 0.19 at 4 px; core lum 0.59, ground lum 0.083
- hues (by lit area): yellow 60° 92%; ground `#111520`, centre/edge ground brightness 1.25
- flow (1019 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^-0.22 (not a zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.04, 0.39:+0.00, 0.61:-0.01, 0.87:+0.00, 1.22:-0.00; rotation +0.2°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.71 at r<0.45 vs 1.91 at r≥0.45; 41% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.42–3.42s** — strobe 0.67–1.47s, flashes every 0.27s; also transition at 2.27s (beat #5 r1, novelty 2.6); also transition at 2.87s (beat #6 r2, novelty 2.4); also every 10 s (no audio to place by) — no hard cut but brightness swings 0.22–0.34 — `bursts/000.42/timing.png` (every frame), `bursts/000.42/detail.png` (large), `bursts/000.42/motion.png` (paths / skeleton / t±1 in RGB)
- **2.77–5.77s** — transition at 4.27s (beat #9 r1, novelty 3.0); also transition at 5.67s (beat #11 r1, novelty 2.0) — no hard cut; brightness 0.33–0.35, colour change 0.024/frame (cut ≥ 0.2) — `bursts/002.77/timing.png` (every frame), `bursts/002.77/detail.png` (large), `bursts/002.77/motion.png` (paths / skeleton / t±1 in RGB)
- **4.97–7.97s** — transition at 6.47s (beat #13 r1, novelty 2.5); also transition at 7.67s (beat #15 r1, novelty 1.9) — no hard cut; brightness 0.33–0.35, colour change 0.022/frame (cut ≥ 0.2) — `bursts/004.97/timing.png` (every frame), `bursts/004.97/detail.png` (large), `bursts/004.97/motion.png` (paths / skeleton / t±1 in RGB)
- **8.15–11.15s** — strobe 8.40–9.20s, flashes every 0.40s; also transition at 10.67s (beat #21 r1, novelty 1.7) — no hard cut; brightness 0.30–0.35, colour change 0.024/frame (cut ≥ 0.2) — `bursts/008.15/timing.png` (every frame), `bursts/008.15/detail.png` (large), `bursts/008.15/motion.png` (paths / skeleton / t±1 in RGB)
- **12.77–15.77s** — transition at 14.27s (beat #29 r1, novelty 1.6) — no hard cut; brightness 0.31–0.33, colour change 0.022/frame (cut ≥ 0.2) — `bursts/012.77/timing.png` (every frame), `bursts/012.77/detail.png` (large), `bursts/012.77/motion.png` (paths / skeleton / t±1 in RGB)
- **20.77–23.77s** — transition at 22.27s (beat #45 r1, novelty 4.9); also transition at 22.00s (beat #44 r4, novelty 4.1); also every 10 s (no audio to place by) — no hard cut; brightness 0.30–0.36, colour change 0.025/frame (cut ≥ 0.2) — `bursts/020.77/timing.png` (every frame), `bursts/020.77/detail.png` (large), `bursts/020.77/motion.png` (paths / skeleton / t±1 in RGB)
- **23.57–26.57s** — transition at 25.07s (beat #50 r2, novelty 3.0) — no hard cut; brightness 0.34–0.37, colour change 0.025/frame (cut ≥ 0.2) — `bursts/023.57/timing.png` (every frame), `bursts/023.57/detail.png` (large), `bursts/023.57/motion.png` (paths / skeleton / t±1 in RGB)
- **25.37–28.37s** — transition at 26.87s (beat #54 r2, novelty 2.8) — no hard cut; brightness 0.34–0.37, colour change 0.025/frame (cut ≥ 0.2) — `bursts/025.37/timing.png` (every frame), `bursts/025.37/detail.png` (large), `bursts/025.37/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#170f0d`×0.33 `#443527`×0.22 `#9e936e`×0.19 `#6d6148`×0.18 `#d9d1aa`×0.08
- no radial symmetry (rotational r 0.09, mirror r 0.26); centre brightness 0.29 vs edge 0.34; mean brightness 0.33, dark frames 0%; saturation 0.43
- motion: zoom mean -0.007 (|zoom| 0.024) log-scale/s, rotation mean -0.5° (|rot| 0.9°)/s, frame-to-frame activity 0.055

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 4 | +0.06 | +0.51 | -0.93 | +0.69 | +1.98 |
| 8 | 4 | +0.72 | +1.69 | +0.25 | +1.33 | +0.14 |
| 4 | 7 | +0.96 | +1.54 | +0.03 | +0.57 | +0.41 |
| 2 | 15 | +0.68 | +0.82 | +0.17 | +0.46 | +0.84 |
| 1 | 30 | +0.41 | +0.88 | +0.16 | +0.54 | +0.37 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.67 | #1 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 1.47s: 4 flashes every 0.27s = 0.53 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset, flash |
| 2.27 | #5 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 2.87 | #6 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 4.27 | #9 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 5.67 | #11 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 6.47 | #13 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 7.67 | #15 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 8.40 | #17 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 9.20s: 3 flashes every 0.40s = 0.80 beat (no simple fraction of a beat → own timer), starts on beat r1, no onset |
| 10.67 | #21 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 14.27 | #29 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 22.00 | #44 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, looks like a cut |
| 22.27 | #45 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, flash, → probably not audio-driven |
| 25.07 | #50 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 26.87 | #54 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, looks like a cut, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): bright +1.5σ, zoom +1.3σ
- beat #12 (r4, 6.00s): rot +1.0σ
- beat #16 (r16, 8.00s): rot -1.5σ
- beat #20 (r4, 10.00s): sat -0.9σ, abszoom -0.9σ, rot -0.9σ
- beat #28 (r4, 14.00s): rot +1.5σ
- beat #36 (r4, 18.00s): sat +1.1σ
- beat #44 (r4, 22.00s): act +1.0σ
- beat #56 (r8, 28.00s): rot +0.9σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 14 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.42/timing.png` … — burst 0.42–3.42s (flash): strobe 0.67–1.47s, flashes every 0.27s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.77/timing.png` … — burst 2.77–5.77s (continuous): transition at 4.27s (beat #9 r1, novelty 3.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/004.97/timing.png` … — burst 4.97–7.97s (continuous): transition at 6.47s (beat #13 r1, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/008.15/timing.png` … — burst 8.15–11.15s (continuous): strobe 8.40–9.20s, flashes every 0.40s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.77/timing.png` … — burst 12.77–15.77s (continuous): transition at 14.27s (beat #29 r1, novelty 1.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.77/timing.png` … — burst 20.77–23.77s (continuous): transition at 22.27s (beat #45 r1, novelty 4.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/023.57/timing.png` … — burst 23.57–26.57s (continuous): transition at 25.07s (beat #50 r2, novelty 3.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/025.37/timing.png` … — burst 25.37–28.37s (continuous): transition at 26.87s (beat #54 r2, novelty 2.8). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py P-UTmeA4qeI --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
