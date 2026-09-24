# ref bundle: vKJu9mfeDS8

`tools/.cache/refs/_downloads/vKJu9mfeDS8.mp4` — 0.0+29.5s. tempo **123.0 bpm** (beat 0.488s), 59 beats, phrase phase = beat 7 (estimated, margin 1.1σ); sections at beats 25, 28, 40, 55.
Ours heard through `spectrum`: 3539 probe samples, 161 onsets vs the reference's 185.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- brightness pops harder on bar/phrase beats (z +0.51 on rank ≥4 vs +0.08 on rank ≤2) — ours: onset fires on 11/14 of those beats
- colour change pops harder on bar/phrase beats (z +0.94 on rank ≥4 vs +0.53 on rank ≤2) — ours: onset fires on 11/14 of those beats
- colour change reacts most at phrase starts (rank 16 z +1.21 vs rank 4 +0.70) — ours: onset fires on 3/4 of those beats
- activity follows mid (r +0.33, -66 ms)
- cut follows low (r +0.22, no lag)
- brightness follows mid (r +0.22, no lag)
- sat follows low (r +0.72, no lag)
- NO HARD CUTS at 30 fps in 30 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 1 strobe stretch(es), flashes every 0.23 s ≈ 0.48 beat (≈ 0.5 beat within the ±0.14-beat resolution of 15 fps); 0/1 start on a beat, at t 12.1
- 9 single transitions: 4 on a beat with an onset, 3 off-beat with no onset (timer/scripted) — ours: onset fired at 8/9 of them
- picture changes regime at 3/4 audio section boundaries — ours: `section` shows no rise near any of them
- zoom direction changes at beat #27 (r4, 13.8s, -2.6σ)
- brightness does not flash on onsets (rise z -0.06 over 25 strong onsets)
- activity does not flash on onsets (rise z +0.02 over 25 strong onsets)
- activity is continuous across the beat (contrast 0.12σ)
- brightness is continuous across the beat (contrast 0.12σ)
- zoom speed is continuous across the beat (contrast 0.26σ)
- ours: tempo at ×1 for 10% of the clip, ×½ 0%, ×2 0%, elsewhere 90% (median 147.8 vs reference 123.0); our onset lands within 60 ms of 68% of the reference's onsets, and 72% of ours sit on one of theirs; lag -7 ms ±32

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 40% of the clip, 10.67s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 178 lit objects on 360×640 (lit floor 0.18, lit 21.7% of pixels): 73 blob, 47 bar, 30 disc, 26 panel, 2 hex ring; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.61 over 58 gates: 0.034 half-heights at r 0.3, 0.017 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.040, r0.6-1.0 → 0.095, r>1 → 0.045
- rings at r ≈ 0.53 (×80), 0.75 (×69); 2-fold (score 0.99); on the axes 15%, on the diagonals 46%
- stroke (outlines): 3.8 px at r<0.45, 3.8 px at r≥0.45; glow e-fold 13.5 px, halo/core 0.28 at 4 px; core lum 0.52, ground lum 0.006
- hues (by lit area): cyan 180° 99%; ground `#000102`, centre/edge ground brightness 0.07
- flow (1967 object tracks, 32% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.14 (not a zoom) 0.19 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:+0.00, 0.61:+0.00, 0.87:-0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.23 at r<0.45 vs 2.04 at r≥0.45; 49% of elongated objects lie along the radial direction

### Regime 2 — 26% of the clip, 2.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 95 lit objects on 360×640 (lit floor 0.18, lit 11.0% of pixels): 46 bar, 26 blob, 17 panel, 5 disc, 1 frame; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^1.59 over 22 gates: 0.011 half-heights at r 0.3, 0.066 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.015, r0.3-0.6 → 0.089, r0.6-1.0 → 0.091, r>1 → 0.658
- rings at r ≈ 0.38 (×37), 0.60 (×31), 0.95 (×21); 2-fold (score 0.95); on the axes 19%, on the diagonals 46%
- stroke (outlines): 3.8 px at r<0.45, None px at r≥0.45; glow e-fold 8.3 px, halo/core 0.16 at 4 px; core lum 0.43, ground lum 0.050
- hues (by lit area): spring 150° 61%, cyan 180° 34%, azure 210° 5%; ground `#050e0f`, centre/edge ground brightness 1.00
- flow (888 object tracks, 67% moving outward → objects fly toward the camera): radial speed ∝ r^0.26 (not a zoom) 0.11 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:+0.02, 0.39:+0.09, 0.61:+0.28, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.68 at r<0.45 vs 2.42 at r≥0.45; 65% of elongated objects lie along the radial direction

### Regime 3 — 18% of the clip, 9.60s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 211 lit objects on 360×640 (lit floor 0.22, lit 25.1% of pixels): 84 blob, 73 bar, 29 disc, 25 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.05 over 54 gates: 0.030 half-heights at r 0.3, 0.032 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.143, r0.3-0.6 → 0.078, r0.6-1.0 → 0.093, r>1 → 0.038
- rings at r ≈ 0.47 (×85), 0.84 (×55); 2-fold (score 0.98); on the axes 20%, on the diagonals 41%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 16.8 px, halo/core 0.31 at 4 px; core lum 0.55, ground lum 0.025
- hues (by lit area): cyan 180° 94%, spring 150° 6%; ground `#030609`, centre/edge ground brightness 0.10
- flow (2234 object tracks, 73% moving outward → objects fly toward the camera): radial speed ∝ r^-0.58 (not a zoom) 0.25 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.11, 0.39:+0.15, 0.61:+0.17, 0.87:+0.10, 1.22:+0.03; rotation -0.2°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.16 at r<0.45 vs 2.47 at r≥0.45; 39% of elongated objects lie along the radial direction

### Regime 4 — 9% of the clip, 28.53s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 143 lit objects on 360×640 (lit floor 0.18, lit 13.9% of pixels): 72 bar, 29 blob, 25 panel, 15 disc, 2 ring; outlines 1%, fills 99%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^1.00 over 41 gates: 0.018 half-heights at r 0.3, 0.054 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.104, r0.3-0.6 → 0.102, r0.6-1.0 → 0.139, r>1 → —
- rings at r ≈ 0.38 (×14), 0.60 (×98); 8-fold (score 0.98); on the axes 18%, on the diagonals 31%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 3.6 px, halo/core 0.12 at 4 px; core lum 0.46, ground lum 0.007
- hues (by lit area): cyan 180° 92%, spring 150° 7%; ground `#010102`, centre/edge ground brightness 1.00
- flow (1760 object tracks, 27% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.31 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:-0.04, 0.21:-0.06, 0.39:-0.01, 0.61:-0.00, 0.87:—, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.27 at r<0.45 vs 3.0 at r≥0.45; 51% of elongated objects lie along the radial direction

### Regime 5 — 8% of the clip, 21.53s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 118 lit objects on 360×640 (lit floor 0.18, lit 7.9% of pixels): 53 bar, 40 blob, 20 panel, 4 disc, 1 frame; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.39 over 24 gates: 0.015 half-heights at r 0.3, 0.023 at r 0.9 → in between
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.143, r0.3-0.6 → 0.077, r0.6-1.0 → 0.218, r>1 → 0.444
- rings at r ≈ 0.84 (×70); 2-fold (score 0.93); on the axes 4%, on the diagonals 54%
- stroke (outlines): 2.7 px at r<0.45, None px at r≥0.45; glow e-fold 13.7 px, halo/core 0.27 at 4 px; core lum 0.29, ground lum 0.031
- hues (by lit area): cyan 180° 60%, spring 150° 39%; ground `#020908`, centre/edge ground brightness 0.48
- flow (1371 object tracks, 28% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.47 (not a zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:-0.01, 0.39:—, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.14 at r<0.45 vs 2.76 at r≥0.45; 53% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **2.50–5.50s** — transition at 4.00s (beat #6 r1, novelty 2.1); also phrase start, beat #7 (4.39s) — no hard cut but brightness swings 0.12–0.22 — `bursts/002.50/timing.png` (every frame), `bursts/002.50/detail.png` (large), `bursts/002.50/motion.png` (paths / skeleton / t±1 in RGB)
- **4.03–7.03s** — transition at 5.53s (beat #10 r1, novelty 1.6) — no hard cut; brightness 0.18–0.26, colour change 0.030/frame (cut ≥ 0.2) — `bursts/004.03/timing.png` (every frame), `bursts/004.03/detail.png` (large), `bursts/004.03/motion.png` (paths / skeleton / t±1 in RGB)
- **7.10–10.10s** — transition at 8.60s (beat #16 r1, novelty 3.5); also transition at 9.00s (beat #17 r2, novelty 3.2) — no hard cut but brightness swings 0.18–0.35 — `bursts/007.10/timing.png` (every frame), `bursts/007.10/detail.png` (large), `bursts/007.10/motion.png` (paths / skeleton / t±1 in RGB)
- **9.57–12.57s** — transition at 11.07s (beat #21 r2, novelty 2.7) — no hard cut but brightness swings 0.19–0.29 — `bursts/009.57/timing.png` (every frame), `bursts/009.57/detail.png` (large), `bursts/009.57/motion.png` (paths / skeleton / t±1 in RGB)
- **11.82–14.82s** — strobe 12.07–12.53s, flashes every 0.23s; also transition at 13.60s (beat #27 r4, novelty 4.6); also transition at 14.27s (beat #28 r1, novelty 3.3); also phrase start, beat #23 (11.96s) — no hard cut; brightness 0.18–0.27, colour change 0.055/frame (cut ≥ 0.2) — `bursts/011.82/timing.png` (every frame), `bursts/011.82/detail.png` (large), `bursts/011.82/motion.png` (paths / skeleton / t±1 in RGB)
- **15.03–18.03s** — transition at 16.53s (beat #33 r2, novelty 4.2) — no hard cut; brightness 0.19–0.22, colour change 0.043/frame (cut ≥ 0.2) — `bursts/015.03/timing.png` (every frame), `bursts/015.03/detail.png` (large), `bursts/015.03/motion.png` (paths / skeleton / t±1 in RGB)
- **17.50–20.50s** — transition at 19.00s (beat #38 r1, novelty 4.2) — no hard cut but brightness swings 0.13–0.24 — `bursts/017.50/timing.png` (every frame), `bursts/017.50/detail.png` (large), `bursts/017.50/motion.png` (paths / skeleton / t±1 in RGB)
- **19.10–22.10s** — phrase start, beat #39 (19.60s) — no hard cut but brightness swings 0.07–0.24 — `bursts/019.10/timing.png` (every frame), `bursts/019.10/detail.png` (large), `bursts/019.10/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#030c0b`×0.46 `#0d2c29`×0.27 `#1e594f`×0.14 `#309082`×0.09 `#41cfbd`×0.04
- 2-fold rotational symmetry (r 0.92); mirror symmetry, ~7 axes (r 0.91); centre brightness 0.20 vs edge 0.19; mean brightness 0.20, dark frames 7%; saturation 0.71
- motion: zoom mean -0.122 (|zoom| 0.406) log-scale/s, rotation mean +0.1° (|rot| 0.6°)/s, frame-to-frame activity 0.043

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 4 | +0.67 | +1.21 | +0.19 | +0.41 | +3.09 | 3/4 |
| 8 | 3 | +0.86 | +0.91 | +1.23 | +0.33 | +0.38 | 1/3 |
| 4 | 7 | +0.11 | +0.70 | +0.11 | +0.61 | -0.05 | 7/7 |
| 2 | 15 | +0.26 | +0.51 | +0.02 | +0.16 | -0.05 | 13/15 |
| 1 | 30 | +0.33 | +0.56 | +0.15 | +0.29 | +0.25 | 24/30 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- sat ~ low: r +0.72 at +0 ms
- sat ~ mid: r +0.72 at +0 ms
- sat ~ rms: r +0.67 at +0 ms
- sat ~ high: r +0.49 at +0 ms
- activity ~ mid: r +0.33 at -66 ms
- sat ~ onset: r +0.29 at +0 ms
- activity ~ low: r +0.25 at -66 ms
- cut ~ low: r +0.22 at +0 ms
- brightness ~ mid: r +0.22 at +0 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 4.00 | #6 | +53 | 1 | +1.4 | +0.4 | +0.6 | +0.1 | on beat (r1), onset, ours: onset yes, bpm 173 |
| 5.53 | #10 | -248 | 1 | -0.6 | +0.1 | +0.1 | +0.3 | off-beat (-0.51 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 174 |
| 8.60 | #16 | -131 | 1 | +1.0 | -0.1 | -0.0 | +0.6 | off-beat (-0.27 beat from r1), onset, ours: onset yes, bpm 177 |
| 9.00 | #17 | -195 | 2 | -0.3 | -0.5 | -0.4 | +0.0 | off-beat (-0.40 beat from r2), no onset, → probably not audio-driven, ours: onset yes, bpm 177 |
| 11.07 | #21 | +60 | 2 | +1.1 | -0.0 | +0.2 | +1.1 | on beat (r2), onset, high jumps, ours: onset yes, bpm 180 |
| 12.07 | #23 | +108 | 16 | +0.9 | +0.8 | -0.1 | -0.6 | STROBE to 12.53s: 3 flashes every 0.23s = 0.48 beat (≈ 0.5 beat within the ±0.14-beat resolution of 15 fps), starts off beat r16, onset, ours: onset no, bpm 180 |
| 13.60 | #27 | -169 | 4 | +0.7 | -0.1 | -0.5 | -0.3 | off-beat (-0.35 beat from r4), no onset, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 181 |
| 14.27 | #28 | +33 | 1 | +0.7 | +0.1 | +0.2 | +0.1 | on beat (r1), no onset, section boundary, ours: onset yes, bpm 180 |
| 16.53 | #33 | -69 | 2 | +3.3 | +0.9 | -0.2 | +0.2 | on beat (r2), hard onset, looks like a cut, ours: onset yes, bpm 127 |
| 19.00 | #38 | -87 | 1 | +0.9 | +0.0 | -0.4 | -0.0 | on beat (r1), onset, ours: onset no, bpm 128 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #3 (r4, 2.48s): bright +1.2σ, sat +1.0σ
- beat #7 (r16, 4.39s): act -0.9σ
- beat #15 (r8, 8.24s): bright +2.1σ, act +1.4σ, abszoom +0.8σ
- beat #19 (r4, 10.08s): bright -0.9σ, act -0.8σ
- beat #27 (r4, 13.77s): bright +1.3σ, zoom -2.6σ, abszoom +3.2σ
- beat #31 (r8, 15.67s): act +2.0σ
- beat #39 (r16, 19.60s): bright -0.9σ, act -2.7σ, rot -2.1σ
- beat #43 (r4, 21.59s): zoom -1.0σ, abszoom +1.3σ
- beat #55 (r16, 27.14s): sat -2.0σ, zoom -0.9σ, abszoom +1.1σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #3 | 2.48 | 4 | +0.9 | +0.2 | +0.1 | +0.7 | +1.0 | yes | 175 |
| #7 | 4.39 | 16 | +0.6 | +0.7 | +0.6 | +1.6 | -0.2 | yes | 173 |
| #11 | 6.27 | 4 | +1.6 | +0.7 | -0.8 | -0.2 | +0.1 | yes | 175 |
| #15 | 8.24 | 8 | +1.8 | +0.2 | -0.6 | +1.0 | +2.8 | yes | 177 |
| #19 | 10.08 | 4 | +0.7 | -0.2 | -0.2 | +0.7 | +1.4 | yes | 178 |
| #23 | 11.96 | 16 | +0.9 | -0.5 | +1.4 | +0.1 | +2.4 | no | 180 |
| #25 S | 12.86 | 2 | +1.0 | +1.0 | +0.7 | +0.9 | +1.9 | no | 181 |
| #27 | 13.77 | 4 | +1.1 | +0.7 | -0.4 | +0.3 | +2.6 | yes | 180 |
| #28 S | 14.23 | 1 | +0.7 | +0.5 | -0.4 | +0.6 | +3.6 | no | 180 |
| #31 | 15.67 | 8 | +1.3 | +0.6 | +0.9 | +1.8 | +0.3 | no | 127 |
| #35 | 17.60 | 4 | +2.8 | +0.1 | +0.7 | +1.1 | +1.0 | yes | 128 |
| #39 | 19.60 | 16 | +2.6 | -0.5 | +0.4 | +1.9 | +3.3 | yes | 128 |
| #40 S | 20.09 | 1 | +1.6 | +0.1 | +0.7 | -0.6 | +0.7 | yes | 128 |
| #43 | 21.59 | 4 | +1.4 | +0.2 | +0.9 | -1.2 | -0.5 | yes | 148 |
| #47 | 23.43 | 8 | +1.9 | +0.1 | +1.0 | -0.2 | -0.3 | no | 148 |
| #51 | 25.26 | 4 | +0.6 | +0.6 | +0.1 | -0.7 | -0.8 | yes | 138 |
| #55 S | 27.14 | 16 | +1.6 | -1.6 | -1.7 | -0.2 | -0.3 | yes | 138 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/002.50/timing.png` … — burst 2.50–5.50s (flash): transition at 4.00s (beat #6 r1, novelty 2.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/004.03/timing.png` … — burst 4.03–7.03s (continuous): transition at 5.53s (beat #10 r1, novelty 1.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/007.10/timing.png` … — burst 7.10–10.10s (flash): transition at 8.60s (beat #16 r1, novelty 3.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/009.57/timing.png` … — burst 9.57–12.57s (flash): transition at 11.07s (beat #21 r2, novelty 2.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.82/timing.png` … — burst 11.82–14.82s (continuous): strobe 12.07–12.53s, flashes every 0.23s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.03/timing.png` … — burst 15.03–18.03s (continuous): transition at 16.53s (beat #33 r2, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/017.50/timing.png` … — burst 17.50–20.50s (flash): transition at 19.00s (beat #38 r1, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/019.10/timing.png` … — burst 19.10–22.10s (flash): phrase start, beat #39 (19.60s). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py vKJu9mfeDS8 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png` ← the rank that reacts hardest
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
