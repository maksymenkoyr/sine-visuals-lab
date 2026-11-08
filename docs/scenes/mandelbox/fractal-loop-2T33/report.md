# ref bundle: fractal-loop-2T33

`tools/.cache/refs/_downloads/fractal-loop-2T33.mp4` — 0.0+120.0s. tempo **117.5 bpm** (beat 0.511s), 215 beats, phrase phase = beat 10 (estimated, margin 0.97σ); sections at beats 11, 63, 91, 104, 141, 159, 194.
Ours heard through `spectrum`: 14371 probe samples, 185 onsets vs the reference's 323.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- colour change reacts most at phrase starts (rank 16 z +0.97 vs rank 4 +0.56) — ours: onset fires on 6/13 of those beats
- no visual metric tracks a band continuously (all |r| < 0.2) — the sync, if any, is event-based
- NO HARD CUTS at 30 fps in 120 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 1 strobe stretch(es), flashes every 0.47 s ≈ 0.91 beat (≈ 1 beat within the ±0.13-beat resolution of 15 fps); 0/1 start on a beat, at t 75.3
- 19 single transitions: 0 on a beat with an onset, 11 off-beat with no onset (timer/scripted) — ours: onset fired at 4/19 of them
- picture changes regime at 2/7 audio section boundaries — ours: `section` shows no rise near any of them
- zoom direction changes at beat #26 (r16, 13.1s, +1.4σ)
- zoom direction changes at beat #134 (r4, 66.8s, +1.7σ)
- zoom direction changes at beat #138 (r16, 68.8s, -2.7σ)
- brightness does not flash on onsets (rise z +0.03 over 62 strong onsets)
- activity does not flash on onsets (rise z +0.06 over 62 strong onsets)
- activity is continuous across the beat (contrast 0.05σ)
- brightness is continuous across the beat (contrast 0.07σ)
- zoom speed is continuous across the beat (contrast 0.13σ)
- zooms in continuously (+0.073 log-scale/s, i.e. ×1.08 per second)
- ours: tempo at ×1 for 0% of the clip, ×½ 0%, ×2 0%, elsewhere 100% (median None vs reference 117.5); our onset lands within 60 ms of 48% of the reference's onsets, and 82% of ours sit on one of theirs; lag +22 ms ±16

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 28% of the clip, 36.67s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 1904 lit objects on 1280×720 (lit floor 0.18, lit 18.1% of pixels): 733 disc, 707 blob, 411 bar, 32 panel, 13 hex ring, 7 ring, 1 frame; outlines 1%, fills 99%; 12% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.01 over 786 gates: 0.030 half-heights at r 0.3, 0.029 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.062, r0.3-0.6 → 0.081, r0.6-1.0 → 0.071, r>1 → 0.068
- rings at r ≈ 1.50 (×548); 2-fold (score 1.00); on the axes 43%, on the diagonals 14%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 3.5 px, halo/core 0.07 at 4 px; core lum 0.60, ground lum 0.003
- hues (by lit area): rose 330° 79%, red 0° 12%; ground `#010001`, centre/edge ground brightness 1.00
- flow (8804 object tracks, 61% moving outward → objects fly toward the camera): radial speed ∝ r^0.37 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.02, 0.39:+0.02, 0.61:+0.03, 0.87:+0.03, 1.22:+0.04; rotation +0.2°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.0 at r<0.45 vs 2.03 at r≥0.45; 40% of elongated objects lie along the radial direction

### Regime 2 — 23% of the clip, 56.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 633 lit objects on 1280×720 (lit floor 0.25, lit 40.7% of pixels): 273 blob, 223 bar, 105 disc, 20 panel, 6 ring, 5 hex ring, 1 frame; outlines 2%, fills 98%; 53% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.00 over 137 gates: 0.054 half-heights at r 0.3, 0.054 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.186, r0.6-1.0 → 0.164, r>1 → 0.136
- rings at r ≈ 0.95 (×128), 1.50 (×249); 2-fold (score 0.96); on the axes 43%, on the diagonals 15%
- stroke (outlines): 4.6 px at r<0.45, 2.7 px at r≥0.45; glow e-fold 10.6 px, halo/core 0.21 at 4 px; core lum 0.82, ground lum 0.000
- hues (by lit area): spring 150° 77%, green 120° 9%, cyan 180° 5%; ground `#000000`, centre/edge ground brightness 1.00
- flow (2517 object tracks, 82% moving outward → objects fly toward the camera): radial speed ∝ r^0.91 (a flat zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.04, 0.39:+0.01, 0.61:+0.07, 0.87:+0.10, 1.22:+0.14; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.1 at r<0.45 vs 2.4 at r≥0.45; 33% of elongated objects lie along the radial direction

### Regime 3 — 22% of the clip, 83.00s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 1024 lit objects on 1280×720 (lit floor 0.18, lit 10.2% of pixels): 417 blob, 359 disc, 217 bar, 23 panel, 5 hex ring, 3 ring; outlines 1%, fills 99%; 20% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.02 over 390 gates: 0.030 half-heights at r 0.3, 0.029 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.068, r0.3-0.6 → 0.122, r0.6-1.0 → 0.057, r>1 → 0.068
- rings at r ≈ 0.42 (×66), 0.84 (×230), 1.19 (×278); 2-fold (score 0.95); on the axes 41%, on the diagonals 18%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core 0.01 at 4 px; core lum 0.44, ground lum 0.027
- hues (by lit area): blue 240° 85%; ground `#050611`, centre/edge ground brightness 1.00
- flow (5107 object tracks, 30% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.23 (not a zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:-0.04, 0.21:-0.03, 0.39:-0.02, 0.61:-0.01, 0.87:-0.00, 1.22:-0.03; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.15 at r<0.45 vs 2.01 at r≥0.45; 49% of elongated objects lie along the radial direction

### Regime 4 — 16% of the clip, 21.40s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 1594 lit objects on 1280×720 (lit floor 0.18, lit 29.7% of pixels): 622 blob, 557 disc, 371 bar, 20 panel, 15 hex ring, 8 ring, 1 frame; outlines 2%, fills 98%; 28% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.02 over 601 gates: 0.035 half-heights at r 0.3, 0.035 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.129, r0.3-0.6 → 0.126, r0.6-1.0 → 0.127, r>1 → 0.092
- rings at r ≈ 1.50 (×618); 2-fold (score 0.99); on the axes 44%, on the diagonals 12%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 5.2 px, halo/core 0.12 at 4 px; core lum 0.66, ground lum 0.000
- hues (by lit area): azure 210° 43%, blue 240° 33%, cyan 180° 15%, violet 270° 5%; ground `#000000`, centre/edge ground brightness 1.00
- flow (5860 object tracks, 78% moving outward → objects fly toward the camera): radial speed ∝ r^0.88 (a flat zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.03, 0.61:+0.10, 0.87:+0.11, 1.22:+0.12; rotation -0.2°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.01 at r<0.45 vs 2.04 at r≥0.45; 35% of elongated objects lie along the radial direction

### Regime 5 — 12% of the clip, 94.87s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 1273 lit objects on 1280×720 (lit floor 0.18, lit 15.9% of pixels): 495 blob, 454 disc, 296 bar, 22 panel, 3 hex ring, 2 ring, 1 frame; outlines 1%, fills 99%; 62% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.08 over 481 gates: 0.034 half-heights at r 0.3, 0.031 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.113, r0.3-0.6 → 0.098, r0.6-1.0 → 0.069, r>1 → 0.079
- rings at r ≈ 1.06 (×386), 1.50 (×398); 2-fold (score 0.98); on the axes 38%, on the diagonals 15%
- stroke (outlines): 2.3 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 7.4 px, halo/core 0.12 at 4 px; core lum 0.49, ground lum 0.002
- hues (by lit area): rose 330° 45%, blue 240° 25%, magenta 300° 21%, violet 270° 9%; ground `#000002`, centre/edge ground brightness 1.00
- flow (6778 object tracks, 44% moving outward → mixed directions): radial speed ∝ r^-0.09 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.02, 0.39:-0.01, 0.61:-0.01, 0.87:+0.00, 1.22:-0.01; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.99 at r<0.45 vs 2.08 at r≥0.45; 41% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **21.03–24.03s** — transition at 22.53s (beat #45 r1, novelty 3.4); also transition at 21.07s (beat #42 r16, novelty 2.9); also phrase start, beat #42 (20.87s) — no hard cut but brightness swings 0.25–0.37 — `bursts/021.03/timing.png` (every frame), `bursts/021.03/detail.png` (large), `bursts/021.03/motion.png` (paths / skeleton / t±1 in RGB)
- **23.03–26.03s** — transition at 24.53s (beat #49 r1, novelty 3.4) — no hard cut but brightness swings 0.14–0.30 — `bursts/023.03/timing.png` (every frame), `bursts/023.03/detail.png` (large), `bursts/023.03/motion.png` (paths / skeleton / t±1 in RGB)
- **47.50–50.50s** — transition at 49.00s (beat #98 r8, novelty 3.6) — no hard cut but brightness swings 0.35–0.53 — `bursts/047.50/timing.png` (every frame), `bursts/047.50/detail.png` (large), `bursts/047.50/motion.png` (paths / skeleton / t±1 in RGB)
- **54.43–57.43s** — transition at 55.93s (beat #112 r2, novelty 3.9) — no hard cut; brightness 0.42–0.48, colour change 0.041/frame (cut ≥ 0.2) — `bursts/054.43/timing.png` (every frame), `bursts/054.43/detail.png` (large), `bursts/054.43/motion.png` (paths / skeleton / t±1 in RGB)
- **59.83–62.83s** — transition at 61.33s (beat #123 r1, novelty 2.9); also transition at 60.00s (beat #121 r1, novelty 2.1); also phrase start, beat #122 (60.65s) — no hard cut; brightness 0.41–0.47, colour change 0.039/frame (cut ≥ 0.2) — `bursts/059.83/timing.png` (every frame), `bursts/059.83/detail.png` (large), `bursts/059.83/motion.png` (paths / skeleton / t±1 in RGB)
- **66.70–69.70s** — transition at 68.20s (beat #137 r1, novelty 5.5) — no hard cut; brightness 0.51–0.53, colour change 0.038/frame (cut ≥ 0.2) — `bursts/066.70/timing.png` (every frame), `bursts/066.70/detail.png` (large), `bursts/066.70/motion.png` (paths / skeleton / t±1 in RGB)
- **69.57–72.57s** — transition at 71.07s (beat #143 r1, novelty 3.8); also phrase start, beat #138 (68.82s) — no hard cut; brightness 0.51–0.53, colour change 0.033/frame (cut ≥ 0.2) — `bursts/069.57/timing.png` (every frame), `bursts/069.57/detail.png` (large), `bursts/069.57/motion.png` (paths / skeleton / t±1 in RGB)
- **75.02–78.02s** — strobe 75.27–76.20s, flashes every 0.47s; also phrase start, beat #154 (76.70s) — no hard cut but brightness swings 0.19–0.38 — `bursts/075.02/timing.png` (every frame), `bursts/075.02/detail.png` (large), `bursts/075.02/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#07060b`×0.40 `#2a2932`×0.21 `#58595e`×0.16 `#8d9794`×0.13 `#d3dfd5`×0.10
- mirror symmetry, ~1 axis (r 1.00); centre brightness 0.27 vs edge 0.24; mean brightness 0.24, dark frames 9%; saturation 0.47
- motion: zoom mean +0.073 (|zoom| 0.081) log-scale/s, rotation mean -0.1° (|rot| 0.4°)/s, frame-to-frame activity 0.053

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 13 | +0.09 | +0.97 | -0.04 | -0.01 | +0.11 | 6/13 |
| 8 | 14 | +0.01 | +0.55 | +0.03 | -0.19 | +0.77 | 9/14 |
| 4 | 27 | -0.06 | +0.56 | -0.04 | +0.13 | +0.11 | 7/27 |
| 2 | 54 | -0.02 | +0.47 | +0.00 | -0.09 | +0.08 | 21/54 |
| 1 | 107 | -0.02 | +0.58 | -0.01 | -0.04 | +0.19 | 29/107 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 5.47 | #10 | +80 | 16 | +0.4 | +0.4 | +0.6 | -1.3 | on beat (r16), no onset, high drops, ours: onset yes, bpm 0 |
| 18.53 | #37 | +143 | 1 | +0.9 | +0.2 | +0.1 | +0.2 | off-beat (+0.28 beat from r1), onset, looks like a cut, ours: onset no, bpm 0 |
| 19.00 | #38 | +145 | 4 | +1.4 | -0.3 | -0.4 | -0.5 | off-beat (+0.28 beat from r4), onset, ours: onset no, bpm 0 |
| 21.07 | #42 | +192 | 16 | -0.3 | -1.5 | +0.3 | -0.3 | off-beat (+0.38 beat from r16), no onset, low drops, → probably not audio-driven, ours: onset no, bpm 0 |
| 22.53 | #45 | +149 | 1 | -0.0 | +0.3 | +0.5 | +0.1 | off-beat (+0.29 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 0 |
| 24.53 | #49 | +106 | 1 | +1.9 | -0.4 | -1.1 | -1.1 | off-beat (+0.21 beat from r1), hard onset, mid drops, high drops, looks like a cut, ours: onset no, bpm 0 |
| 26.80 | #54 | -205 | 4 | +0.1 | +1.1 | -0.1 | -0.1 | off-beat (-0.40 beat from r4), no onset, low jumps, → probably not audio-driven, ours: onset no, bpm 0 |
| 29.60 | #59 | +180 | 1 | +0.7 | -1.7 | -0.7 | +0.2 | off-beat (+0.35 beat from r1), onset, low drops, ours: onset no, bpm 0 |
| 31.00 | #62 | +1 | 4 | +0.4 | +0.0 | -0.2 | -0.2 | on beat (r4), no onset, ours: onset no, bpm 0 |
| 45.00 | #90 | +185 | 16 | +0.2 | +0.2 | +0.1 | -0.2 | off-beat (+0.36 beat from r16), no onset, looks like a cut, → probably not audio-driven, ours: onset no, bpm 0 |
| 49.00 | #98 | +168 | 8 | +3.6 | +0.0 | -0.2 | +0.0 | off-beat (+0.33 beat from r8), hard onset, looks like a cut, ours: onset yes, bpm 0 |
| 55.93 | #112 | +182 | 2 | -0.5 | +0.2 | -0.3 | -1.3 | off-beat (+0.36 beat from r2), no onset, high drops, looks like a cut, → probably not audio-driven, ours: onset no, bpm 0 |
| 58.40 | #118 | -207 | 4 | +0.0 | -0.4 | -0.3 | -0.2 | off-beat (-0.41 beat from r4), no onset, → probably not audio-driven, ours: onset no, bpm 0 |
| 60.00 | #121 | -163 | 1 | -0.4 | -0.3 | +0.4 | -1.5 | off-beat (-0.32 beat from r1), no onset, high drops, → probably not audio-driven, ours: onset no, bpm 0 |
| 61.33 | #123 | +195 | 1 | -0.1 | +0.4 | +0.6 | +0.0 | off-beat (+0.38 beat from r1), no onset, looks like a cut, → probably not audio-driven, ours: onset no, bpm 0 |
| 68.20 | #137 | -136 | 1 | +1.8 | +0.0 | +0.5 | +0.1 | off-beat (-0.27 beat from r1), hard onset, ours: onset no, bpm 0 |
| 71.07 | #143 | -242 | 1 | -0.3 | +0.4 | -0.3 | +0.4 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 0 |
| 75.27 | #151 | +104 | 1 | -0.2 | +1.6 | -1.0 | -0.0 | STROBE to 76.20s: 3 flashes every 0.47s = 0.91 beat (≈ 1 beat within the ±0.13-beat resolution of 15 fps), starts off beat r1, no onset, low jumps, looks like a cut, ours: onset no, bpm 0 |
| 110.33 | #214 | +3104 | 4 | +0.0 | +1.2 | +0.1 | +0.1 | off-beat (+6.08 beat from r4), no onset, low jumps, → probably not audio-driven, ours: onset no, bpm 0 |
| 114.73 | #214 | +7504 | 4 | +0.6 | -1.2 | -0.7 | -0.4 | off-beat (+14.69 beat from r4), no onset, low drops, → probably not audio-driven, ours: onset no, bpm 0 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #6 (r4, 3.48s): sat +1.0σ
- beat #10 (r16, 5.39s): sat -1.2σ, act +0.9σ
- beat #22 (r4, 11.17s): sat -1.5σ, act -0.8σ
- beat #26 (r16, 13.12s): sat +1.5σ, act +1.1σ, zoom +1.4σ, abszoom +1.4σ
- beat #30 (r4, 15.02s): abszoom -0.8σ
- beat #38 (r4, 18.86s): bright +1.1σ, sat -2.1σ
- beat #46 (r4, 22.85s): sat +0.9σ
- beat #50 (r8, 25.05s): rot -1.5σ
- beat #54 (r4, 27.00s): sat +0.9σ, act -1.4σ
- beat #58 (r16, 28.91s): sat -1.0σ, act +1.2σ, rot -1.6σ
- beat #66 (r8, 32.97s): rot +1.5σ
- beat #70 (r4, 34.97s): rot +1.8σ
- beat #74 (r16, 36.99s): sat -0.8σ
- beat #90 (r16, 44.81s): rot -0.9σ
- beat #98 (r8, 48.83s): rot +1.6σ
- beat #134 (r4, 66.80s): act +1.3σ, zoom +1.7σ, abszoom +1.9σ
- beat #138 (r16, 68.82s): act -1.6σ, zoom -2.7σ, abszoom -2.9σ
- beat #150 (r4, 74.67s): sat -0.9σ
- beat #210 (r8, 105.14s): zoom +0.8σ, abszoom +0.9σ
- beat #214 (r4, 107.23s): zoom +1.2σ, abszoom +1.2σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #2 | 1.56 | 8 | +1.0 | +0.2 | +1.4 | -0.5 | +1.1 | yes | 0 |
| #6 | 3.48 | 4 | +1.0 | +1.0 | +0.2 | -1.1 | -0.5 | no | 0 |
| #10 | 5.39 | 16 | +0.7 | +0.1 | +0.9 | +0.6 | +1.4 | yes | 0 |
| #11 S | 5.85 | 1 | +0.7 | +1.0 | +0.8 | +0.7 | +0.1 | yes | 0 |
| #14 | 7.31 | 4 | +1.9 | +1.0 | +0.5 | -0.3 | -0.5 | no | 0 |
| #18 | 9.24 | 8 | +3.1 | +1.1 | +1.0 | +0.2 | +0.1 | yes | 0 |
| #22 | 11.17 | 4 | +0.7 | +0.5 | +0.1 | -1.0 | -0.6 | no | 0 |
| #26 | 13.12 | 16 | +1.7 | +0.4 | +0.2 | +0.1 | +0.6 | yes | 0 |
| #30 | 15.02 | 4 | +0.7 | -0.1 | -0.3 | -0.9 | +0.1 | no | 0 |
| #34 | 16.93 | 8 | +0.8 | -0.5 | +0.2 | -0.7 | -0.0 | no | 0 |
| #38 | 18.85 | 4 | +1.4 | -0.3 | -0.1 | +0.1 | +2.2 | no | 0 |
| #42 | 20.87 | 16 | +2.2 | -0.1 | -0.3 | +0.6 | +3.6 | no | 0 |
| #46 | 22.85 | 4 | +0.9 | -0.6 | -0.1 | +1.6 | +1.5 | no | 0 |
| #50 | 25.05 | 8 | +3.7 | -0.0 | +0.8 | +0.1 | +0.0 | yes | 0 |
| #54 | 27.00 | 4 | +6.4 | -0.2 | +0.6 | -0.3 | +0.9 | yes | 0 |
| #58 | 28.91 | 16 | +2.4 | +0.3 | +0.7 | -0.6 | -0.5 | yes | 0 |
| #62 | 31.00 | 4 | +0.4 | +0.8 | +1.0 | +1.0 | +1.3 | no | 0 |
| #63 S | 31.51 | 1 | +0.1 | +0.8 | +1.1 | +0.4 | +1.0 | no | 0 |
| #66 | 32.97 | 8 | -0.1 | +1.2 | +1.1 | -0.3 | +1.0 | yes | 0 |
| #70 | 34.97 | 4 | +0.3 | +1.3 | +1.7 | -0.4 | +1.6 | yes | 0 |
| #74 | 36.99 | 16 | +3.1 | -0.6 | +1.7 | -0.0 | +0.6 | yes | 0 |
| #78 | 38.99 | 4 | +1.2 | +0.1 | +0.8 | +0.3 | +2.2 | no | 0 |
| #82 | 40.98 | 8 | +0.7 | +0.2 | +1.4 | +0.5 | +1.0 | yes | 0 |
| #86 | 42.89 | 4 | +6.9 | +1.2 | +1.3 | +0.2 | +1.2 | yes | 0 |
| #90 | 44.81 | 16 | +2.5 | +0.9 | +1.4 | +0.7 | +3.6 | yes | 0 |
| #91 S | 45.33 | 1 | +4.5 | +1.1 | +0.8 | +0.7 | +0.7 | no | 0 |
| #94 | 46.83 | 4 | +0.3 | +1.6 | +0.4 | +0.6 | +0.4 | no | 0 |
| #98 | 48.83 | 8 | +0.8 | +1.5 | +0.3 | +1.8 | +3.2 | no | 0 |
| #102 | 50.87 | 4 | +0.7 | +1.2 | +0.6 | +0.2 | +1.8 | no | 0 |
| #104 S | 51.90 | 2 | +0.7 | -0.7 | +0.4 | +0.1 | +2.0 | no | 0 |
| #106 | 52.90 | 16 | +0.5 | -0.2 | +0.1 | +0.4 | +3.0 | yes | 0 |
| #110 | 54.78 | 4 | +0.3 | -0.6 | +0.0 | +1.2 | +1.4 | no | 0 |
| #114 | 56.66 | 8 | +2.9 | -0.8 | +0.4 | +1.0 | +2.1 | yes | 0 |
| #118 | 58.61 | 4 | +1.0 | -1.1 | +0.6 | +0.2 | +2.5 | no | 0 |
| #122 | 60.65 | 16 | +0.2 | -0.5 | -0.1 | -0.0 | +1.4 | no | 0 |
| #126 | 62.76 | 4 | +1.5 | -0.8 | +0.2 | +0.7 | +2.0 | yes | 0 |
| #130 | 64.88 | 8 | +4.7 | -0.8 | -0.0 | +0.9 | +1.1 | yes | 0 |
| #134 | 66.80 | 4 | +4.0 | -2.3 | -0.4 | +2.3 | +1.7 | yes | 0 |
| #138 | 68.82 | 16 | +0.4 | -2.8 | -0.6 | +3.2 | +1.8 | no | 0 |
| #141 S | 70.31 | 1 | +0.8 | -1.2 | -0.7 | +1.8 | +1.1 | no | 0 |
| #142 | 70.80 | 4 | +2.0 | -2.5 | -0.9 | +1.9 | +1.5 | no | 0 |
| #146 | 72.68 | 8 | +0.2 | -0.7 | -0.8 | +0.9 | +0.8 | yes | 0 |
| #150 | 74.68 | 4 | +0.9 | -0.9 | -1.2 | -0.8 | +2.0 | yes | 0 |
| #154 | 76.70 | 16 | +0.3 | -1.4 | -1.4 | -0.3 | +0.2 | no | 0 |
| #158 | 78.79 | 4 | -0.1 | -1.2 | -1.4 | -0.7 | -0.9 | no | 0 |
| #159 S | 79.27 | 1 | +0.2 | -0.5 | -1.4 | -0.8 | -0.8 | yes | 0 |
| #162 | 80.78 | 8 | -0.1 | +0.1 | -1.4 | -1.2 | -0.8 | yes | 0 |
| #166 | 82.87 | 4 | +0.7 | +0.3 | -1.4 | -1.2 | -1.1 | no | 0 |
| #170 | 84.89 | 16 | +0.1 | +0.0 | -1.4 | -1.3 | -0.8 | no | 0 |
| #174 | 86.98 | 4 | -0.2 | -0.6 | -1.4 | -1.4 | -0.9 | no | 0 |
| #178 | 89.00 | 8 | +0.7 | -0.7 | -1.4 | -1.2 | -0.8 | no | 0 |
| #182 | 91.00 | 4 | +0.0 | +1.5 | -1.4 | -1.2 | -0.5 | no | 0 |
| #186 | 93.07 | 16 | +2.2 | +1.5 | -1.4 | -1.1 | -0.5 | no | 0 |
| #190 | 95.06 | 4 | +0.2 | +1.0 | -1.4 | -1.1 | -0.3 | no | 0 |
| #194 S | 97.01 | 8 | +0.0 | +1.0 | -1.3 | -1.4 | -0.9 | no | 0 |
| #198 | 99.01 | 4 | +0.3 | +1.0 | -1.2 | -1.1 | -0.9 | no | 0 |
| #202 | 100.96 | 16 | -0.1 | -0.0 | -1.1 | -1.0 | -1.1 | no | 0 |
| #206 | 103.05 | 4 | +0.2 | -0.9 | -0.8 | -0.4 | -0.9 | no | 0 |
| #210 | 105.14 | 8 | +1.0 | +0.5 | -0.7 | +0.1 | +0.3 | no | 0 |
| #214 | 107.23 | 4 | +0.5 | +0.1 | -0.2 | +0.4 | -0.1 | yes | 0 |

## Files

- `slitscan.png` — the whole clip, 10 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/021.03/timing.png` … — burst 21.03–24.03s (flash): transition at 22.53s (beat #45 r1, novelty 3.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/023.03/timing.png` … — burst 23.03–26.03s (flash): transition at 24.53s (beat #49 r1, novelty 3.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/047.50/timing.png` … — burst 47.50–50.50s (flash): transition at 49.00s (beat #98 r8, novelty 3.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/054.43/timing.png` … — burst 54.43–57.43s (continuous): transition at 55.93s (beat #112 r2, novelty 3.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/059.83/timing.png` … — burst 59.83–62.83s (continuous): transition at 61.33s (beat #123 r1, novelty 2.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/066.70/timing.png` … — burst 66.70–69.70s (continuous): transition at 68.20s (beat #137 r1, novelty 5.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/069.57/timing.png` … — burst 69.57–72.57s (continuous): transition at 71.07s (beat #143 r1, novelty 3.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/075.02/timing.png` … — burst 75.02–78.02s (flash): strobe 75.27–76.20s, flashes every 0.47s. timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py fractal-loop-2T33 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16-1.png`
- `sheets/rank16-2.png`
- `sheets/rank8-1.png`
- `sheets/rank8-2.png`
- `sheets/rank8-3.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank4-3.png`
- `sheets/rank4-4.png`
- `sheets/rank4-5.png`
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
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
