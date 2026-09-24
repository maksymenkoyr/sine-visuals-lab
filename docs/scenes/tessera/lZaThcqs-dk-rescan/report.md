# ref bundle: lZaThcqs-dk

`tools/.cache/refs/_downloads/lZaThcqs-dk.mp4` — 0.0+30.0s. tempo **117.5 bpm** (beat 0.511s), 53 beats, phrase phase = beat 6 (estimated, margin 0.87σ); sections at beats 20, 28, 43.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- no beat-rank preference: the picture reacts about the same on every beat (activity z -0.18..+0.07)
- cut follows high (r +0.20, +266 ms)
- CUTS at 30 fps: 162 hard cuts in 30 s, densest second 25 cuts at 25s; holds between cuts 33–1400 ms (median 33) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 1 strobe stretch(es), flashes every 0.27 s ≈ 0.52 beat (≈ 0.5 beat within the ±0.13-beat resolution of 15 fps); 1/1 start on a beat, at t 26.0
- 7 single transitions: 0 on a beat with an onset, 3 off-beat with no onset (timer/scripted)
- picture changes regime at 0/3 audio section boundaries
- brightness does not flash on onsets (rise z +0.04 over 20 strong onsets)
- activity does not flash on onsets (rise z +0.05 over 20 strong onsets)
- activity is continuous across the beat (contrast 0.08σ)
- brightness is continuous across the beat (contrast 0.14σ)
- zoom speed is continuous across the beat (contrast 0.43σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 37% of the clip, 16.60s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 154 lit objects on 360×640 (lit floor 0.45, lit 34.5% of pixels): 71 blob, 57 bar, 20 panel, 6 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.20 over 26 gates: 0.021 half-heights at r 0.3, 0.017 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.063, r0.3-0.6 → 0.159, r0.6-1.0 → 0.125, r>1 → 0.139
- rings at r ≈ 0.42 (×35), 0.75 (×48); 2-fold (score 0.95); on the axes 19%, on the diagonals 36%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 48.6 px, halo/core 0.53 at 4 px; core lum 0.62, ground lum 0.000
- hues (by lit area): yellow 60° 91%; ground `#000000`, centre/edge ground brightness 1.00
- flow (884 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^0.36 (not a zoom) 0.56 half-heights/s at r 0.5; by r → 0.07:-0.06, 0.21:+0.44, 0.39:-0.08, 0.61:-0.25, 0.87:-0.62, 1.22:-0.49; rotation -21.8°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.3 at r<0.45 vs 2.33 at r≥0.45; 67% of elongated objects lie along the radial direction

### Regime 2 — 27% of the clip, 9.20s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 313 lit objects on 360×640 (lit floor 0.20, lit 24.1% of pixels): 180 blob, 64 bar, 40 disc, 27 panel, 1 ring, 1 frame; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.21 over 69 gates: 0.035 half-heights at r 0.3, 0.044 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.187, r0.3-0.6 → 0.215, r0.6-1.0 → 0.131, r>1 → 0.069
- rings at r ≈ 0.17 (×16), 0.27 (×32), 0.47 (×88), 0.75 (×116); 2-fold (score 0.96); on the axes 16%, on the diagonals 42%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 19.1 px, halo/core 0.41 at 4 px; core lum 0.42, ground lum 0.000
- hues (by lit area): yellow 60° 75%, chartreuse 90° 10%, spring 150° 6%; ground `#000000`, centre/edge ground brightness 1.00
- flow (3095 object tracks, 79% moving outward → objects fly toward the camera): radial speed ∝ r^0.06 (not a zoom) 0.17 half-heights/s at r 0.5; by r → 0.07:+0.08, 0.21:+0.05, 0.39:+0.07, 0.61:+0.11, 0.87:+0.17, 1.22:-0.07; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.5 at r<0.45 vs 1.73 at r≥0.45; 40% of elongated objects lie along the radial direction

### Regime 3 — 18% of the clip, 0.67s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 495 lit objects on 360×640 (lit floor 0.24, lit 23.6% of pixels): 259 blob, 94 disc, 90 bar, 52 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.16 over 146 gates: 0.029 half-heights at r 0.3, 0.035 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.099, r0.3-0.6 → 0.086, r0.6-1.0 → 0.117, r>1 → 0.069
- rings at r ≈ 0.53 (×147); 2-fold (score 0.99); on the axes 19%, on the diagonals 34%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 8.4 px, halo/core 0.42 at 4 px; core lum 0.46, ground lum 0.002
- hues (by lit area): yellow 60° 37%, orange 30° 26%, blue 240° 14%, cyan 180° 6%; ground `#000007`, centre/edge ground brightness 1.00
- flow (3193 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.51 (not a zoom) 0.66 half-heights/s at r 0.5; by r → 0.07:+0.24, 0.21:+0.04, 0.39:-0.32, 0.61:-0.73, 0.87:-0.35, 1.22:-0.97; rotation -2.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.92 at r<0.45 vs 2.0 at r≥0.45; 52% of elongated objects lie along the radial direction

### Regime 4 — 16% of the clip, 20.00s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 309 lit objects on 360×640 (lit floor 0.38, lit 33.4% of pixels): 175 blob, 58 disc, 53 bar, 20 panel, 3 hex ring; outlines 1%, fills 99%; 75% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.16 over 81 gates: 0.043 half-heights at r 0.3, 0.051 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.142, r0.3-0.6 → 0.192, r0.6-1.0 → 0.185, r>1 → 0.333
- rings at r ≈ 0.19 (×26), 0.60 (×103), 0.95 (×49); 2-fold (score 0.99); on the axes 23%, on the diagonals 44%
- stroke (outlines): 2.7 px at r<0.45, 3.8 px at r≥0.45; glow e-fold 106.0 px, halo/core 0.45 at 4 px; core lum 0.58, ground lum 0.000
- hues (by lit area): orange 30° 64%, yellow 60° 22%, red 0° 9%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1320 object tracks, 33% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.62 (a flat zoom) 0.64 half-heights/s at r 0.5; by r → 0.07:-0.05, 0.21:-0.17, 0.39:-0.34, 0.61:-0.47, 0.87:-0.74, 1.22:-0.84; rotation -18.5°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.13 at r<0.45 vs 1.85 at r≥0.45; 78% of elongated objects lie along the radial direction

### Regime 5 — 2% of the clip, 7.80s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 222 lit objects on 360×640 (lit floor 0.18, lit 14.0% of pixels): 125 blob, 40 bar, 35 disc, 22 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.12 over 55 gates: 0.022 half-heights at r 0.3, 0.025 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.180, r0.3-0.6 → 0.084, r0.6-1.0 → 0.217, r>1 → 0.037
- rings at r ≈ 0.08 (×15), 0.13 (×12), 0.24 (×32), 0.47 (×71), 0.84 (×34); 2-fold (score 1.00); on the axes 25%, on the diagonals 41%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 2.0 px, halo/core 0.13 at 4 px; core lum 0.34, ground lum 0.038
- hues (by lit area): orange 30° 51%, azure 210° 26%, red 0° 8%, yellow 60° 5%; ground `#1b0125`, centre/edge ground brightness 1.00
- flow (2122 object tracks, 56% moving outward → mixed directions): radial speed ∝ r^-0.29 (not a zoom) 0.10 half-heights/s at r 0.5; by r → 0.07:-0.02, 0.21:-0.10, 0.39:+0.02, 0.61:+0.02, 0.87:+0.16, 1.22:-0.95; rotation -0.2°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.18 at r<0.45 vs 1.68 at r≥0.45; 56% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **3.03–6.03s** — phrase start, beat #6 (3.53s) — no hard cut; brightness 0.18–0.26, colour change 0.047/frame (cut ≥ 0.2) — `bursts/003.03/timing.png` (every frame), `bursts/003.03/detail.png` (large), `bursts/003.03/motion.png` (paths / skeleton / t±1 in RGB)
- **11.02–14.02s** — phrase start, beat #22 (11.52s) — no hard cut but brightness swings 0.26–0.48 — `bursts/011.02/timing.png` (every frame), `bursts/011.02/detail.png` (large), `bursts/011.02/motion.png` (paths / skeleton / t±1 in RGB)
- **18.57–21.57s** — transition at 20.07s (beat #39 r1, novelty 2.4); also phrase start, beat #38 (19.53s) — 14 hard cuts, holds 33–467 ms (median 133); brightness 0.34–0.48 — `bursts/018.57/timing.png` (every frame), `bursts/018.57/detail.png` (large), `bursts/018.57/motion.png` (paths / skeleton / t±1 in RGB)
- **20.77–23.77s** — transition at 22.27s (beat #43 r1, novelty 3.7) — 32 hard cuts, holds 33–367 ms (median 67); brightness 0.31–0.53 — `bursts/020.77/timing.png` (every frame), `bursts/020.77/detail.png` (large), `bursts/020.77/motion.png` (paths / skeleton / t±1 in RGB)
- **22.83–25.83s** — transition at 24.33s (beat #48 r2, novelty 3.6); also transition at 24.67s (beat #48 r2, novelty 3.6) — 61 hard cuts, holds 33–133 ms (median 33); brightness 0.29–0.49 — `bursts/022.83/timing.png` (every frame), `bursts/022.83/detail.png` (large), `bursts/022.83/motion.png` (paths / skeleton / t±1 in RGB)
- **25.75–28.75s** — strobe 26.00–26.53s, flashes every 0.27s; also transition at 27.27s (beat #52 r2, novelty 3.8); also transition at 28.93s (beat #52 r2, novelty 3.8); also transition at 28.47s (beat #52 r2, novelty 2.8) — 71 hard cuts, holds 33–133 ms (median 33); brightness 0.22–0.44 — `bursts/025.75/timing.png` (every frame), `bursts/025.75/detail.png` (large), `bursts/025.75/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#4b4131`×0.29 `#6e665c`×0.26 `#180f0f`×0.21 `#93919b`×0.13 `#a29d59`×0.12
- 2-fold rotational symmetry (r 0.92); mirror symmetry, ~3 axes (r 0.31); centre brightness 0.50 vs edge 0.37; mean brightness 0.38, dark frames 0%; saturation 0.40
- motion: zoom mean +0.001 (|zoom| 0.675) log-scale/s, rotation mean -18.9° (|rot| 27.3°)/s, frame-to-frame activity 0.118

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 3 | -0.18 | +0.08 | +0.27 | +0.07 | -0.37 |
| 8 | 3 | -0.10 | +0.89 | -0.39 | +1.07 | +0.55 |
| 4 | 7 | +0.01 | +0.35 | +0.12 | +1.03 | +0.44 |
| 2 | 14 | +0.07 | +0.58 | +0.36 | +0.67 | -0.07 |
| 1 | 26 | +0.05 | +0.37 | +0.23 | +0.61 | +0.40 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- cut ~ high: r +0.20 at +266 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 20.07 | #39 | +51 | 1 | +0.4 | -0.9 | -1.2 | -0.8 | on beat (r1), no onset, mid drops |
| 22.27 | #43 | +231 | 1 | +1.9 | +1.1 | +2.1 | +1.0 | off-beat (+0.45 beat from r1), hard onset, low jumps, mid jumps, high jumps, section boundary |
| 24.33 | #48 | -187 | 2 | +0.9 | +1.2 | +0.3 | +1.0 | off-beat (-0.37 beat from r2), onset, low jumps |
| 24.67 | #48 | +146 | 2 | -0.1 | -0.7 | +0.9 | +2.0 | off-beat (+0.29 beat from r2), no onset, high jumps, looks like a cut, → probably not audio-driven |
| 26.00 | #51 | -30 | 1 | -0.1 | +0.2 | -3.1 | -0.8 | STROBE to 26.53s: 3 flashes every 0.27s = 0.52 beat (≈ 0.5 beat within the ±0.13-beat resolution of 15 fps), starts on beat r1, no onset, mid drops |
| 27.27 | #52 | +749 | 2 | +0.6 | +0.7 | +1.3 | +0.2 | off-beat (+1.47 beat from r2), no onset, mid jumps, → probably not audio-driven |
| 28.47 | #52 | +1949 | 2 | +1.3 | +0.4 | -0.8 | -0.9 | off-beat (+3.82 beat from r2), onset |
| 28.93 | #52 | +2416 | 2 | -0.5 | +1.2 | +0.9 | +0.6 | off-beat (+4.73 beat from r2), no onset, low jumps, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #14 (r8, 7.52s): sat +0.8σ
- beat #18 (r4, 9.52s): bright +1.1σ
- beat #38 (r16, 19.53s): sat +2.0σ
- beat #42 (r4, 21.52s): sat +1.1σ
- beat #46 (r8, 23.52s): sat +1.8σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z |
|---|---|---|---|---|---|---|---|
| #2 | 1.51 | 4 | +2.8 | -0.2 | -0.1 | +0.1 | +0.0 |
| #6 | 3.53 | 16 | +2.6 | -0.2 | -0.0 | -0.6 | -0.6 |
| #10 | 5.53 | 4 | +3.7 | -0.6 | -0.3 | -1.2 | -0.8 |
| #14 | 7.52 | 8 | +4.2 | +0.4 | +0.0 | -1.9 | +0.2 |
| #18 | 9.52 | 4 | +0.8 | -0.2 | -0.0 | -1.3 | -0.6 |
| #20 S | 10.52 | 2 | +1.0 | -0.5 | -0.4 | -1.0 | -0.7 |
| #22 | 11.52 | 16 | +1.2 | -1.0 | -0.1 | -0.7 | +0.5 |
| #26 | 13.51 | 4 | +1.8 | +0.2 | -0.0 | -0.0 | -0.3 |
| #28 S | 14.51 | 2 | +2.1 | -0.8 | -0.6 | +0.3 | -0.1 |
| #30 | 15.51 | 8 | +2.1 | -0.1 | -0.3 | +0.5 | -0.1 |
| #34 | 17.53 | 4 | +2.8 | +0.2 | +0.1 | +0.8 | -0.2 |
| #38 | 19.53 | 16 | +2.9 | -0.0 | -0.0 | +0.9 | +0.3 |
| #42 | 21.52 | 4 | +2.8 | -0.7 | +0.1 | +0.6 | +2.3 |
| #43 S | 22.04 | 1 | +0.0 | +0.1 | -0.3 | +1.2 | +2.7 |
| #46 | 23.52 | 8 | +2.8 | +0.2 | +0.5 | +1.1 | +2.5 |
| #50 | 25.52 | 4 | +0.7 | -0.4 | +0.1 | +1.3 | +2.0 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/003.03/timing.png` … — burst 3.03–6.03s (continuous): phrase start, beat #6 (3.53s). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.02/timing.png` … — burst 11.02–14.02s (flash): phrase start, beat #22 (11.52s). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/018.57/timing.png` … — burst 18.57–21.57s (cuts): transition at 20.07s (beat #39 r1, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.77/timing.png` … — burst 20.77–23.77s (cuts): transition at 22.27s (beat #43 r1, novelty 3.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.83/timing.png` … — burst 22.83–25.83s (cuts): transition at 24.33s (beat #48 r2, novelty 3.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/025.75/timing.png` … — burst 25.75–28.75s (cuts): strobe 26.00–26.53s, flashes every 0.27s. timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py lZaThcqs-dk --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
