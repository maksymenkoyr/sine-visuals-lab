# ref bundle: alt-circuit

`tools/.cache/refs/_downloads/kMJVNerOtRI.mp4` — 3270.0+30.0s. tempo **129.2 bpm** (beat 0.464s), 64 beats, phrase phase = beat 4 (estimated, margin 0.02σ); sections at beats 21, 23, 52, 54.
Ours heard through `spectrum`: 3569 probe samples, 216 onsets vs the reference's 200.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- no beat-rank preference: the picture reacts about the same on every beat (activity z +0.17..+0.58)
- activity follows high (r +0.36, +466 ms)
- brightness follows high (r +0.27, no lag)
- NO HARD CUTS at 30 fps in 30 s; 3 fades over 1–1 frames (33–33 ms, median 1): every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 19 single transitions: 7 on a beat with an onset, 6 off-beat with no onset (timer/scripted) — ours: onset fired at 19/19 of them
- picture changes regime at 3/4 audio section boundaries — ours: `section` shows no rise near any of them
- zoom direction changes at beat #8 (r4, 4.0s, +1.4σ)
- zoom direction changes at beat #20 (r16, 9.7s, +1.4σ)
- brightness does not flash on onsets (rise z +0.06 over 28 strong onsets)
- activity does not flash on onsets (rise z -0.04 over 28 strong onsets)
- activity is continuous across the beat (contrast 0.24σ)
- brightness is continuous across the beat (contrast 0.15σ)
- zoom speed is continuous across the beat (contrast 0.26σ)
- ours: tempo at ×1 for 86% of the clip, ×½ 0%, ×2 0%, elsewhere 14% (median 130.1 vs reference 129.2); our onset lands within 60 ms of 95% of the reference's onsets, and 88% of ours sit on one of theirs; lag -7 ms ±10

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 33% of the clip, 13.47s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 921 lit objects on 1280×720 (lit floor 0.18, lit 5.9% of pixels): 729 bar, 128 blob, 46 disc, 13 panel, 4 hex ring, 1 ring; outlines 2%, fills 98%; 6% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.28 over 64 gates: 0.023 half-heights at r 0.3, 0.032 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.050, r0.3-0.6 → 0.138, r0.6-1.0 → 0.206, r>1 → 0.149
- rings at r ≈ 0.75 (×307), 1.34 (×238); 2-fold (score 0.96); on the axes 44%, on the diagonals 18%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 11.0 px, halo/core 0.05 at 4 px; core lum 0.56, ground lum 0.025
- hues (by lit area): blue 240° 92%, azure 210° 6%; ground `#010149`, centre/edge ground brightness 1.97
- flow (5759 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.68 (a flat zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.5 at r<0.45 vs 7.96 at r≥0.45; 61% of elongated objects lie along the radial direction

### Regime 2 — 21% of the clip, 2.40s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 909 lit objects on 1280×720 (lit floor 0.18, lit 5.7% of pixels): 672 bar, 137 blob, 80 disc, 13 panel, 6 hex ring, 1 ring; outlines 2%, fills 98%; 20% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.05 over 100 gates: 0.027 half-heights at r 0.3, 0.029 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.040, r0.3-0.6 → 0.158, r0.6-1.0 → 0.155, r>1 → 0.133
- rings at r ≈ 0.67 (×230), 1.19 (×256); 2-fold (score 0.92); on the axes 42%, on the diagonals 17%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 9.4 px, halo/core 0.05 at 4 px; core lum 0.60, ground lum 0.009
- hues (by lit area): blue 240° 86%, azure 210° 9%; ground `#010017`, centre/edge ground brightness 4.45
- flow (4547 object tracks, 47% moving outward → mixed directions): radial speed ∝ r^0.59 (not a zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.01; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.0 at r<0.45 vs 6.09 at r≥0.45; 64% of elongated objects lie along the radial direction

### Regime 3 — 18% of the clip, 23.00s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 1241 lit objects on 1280×720 (lit floor 0.18, lit 7.7% of pixels): 864 bar, 232 blob, 99 disc, 43 panel, 2 hex ring, 1 ring; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.17 over 145 gates: 0.028 half-heights at r 0.3, 0.034 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.078, r0.3-0.6 → 0.077, r0.6-1.0 → 0.193, r>1 → 0.214
- rings at r ≈ 1.06 (×462); 2-fold (score 0.98); on the axes 40%, on the diagonals 20%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 8.7 px, halo/core 0.05 at 4 px; core lum 0.48, ground lum 0.028
- hues (by lit area): blue 240° 99%; ground `#030148`, centre/edge ground brightness 1.67
- flow (3672 object tracks, 48% moving outward → mixed directions): radial speed ∝ r^1.30 (a flat zoom) 0.09 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.01, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.0 at r<0.45 vs 5.21 at r≥0.45; 53% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 15.20s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 1339 lit objects on 1280×720 (lit floor 0.18, lit 8.9% of pixels): 901 bar, 258 blob, 132 disc, 38 panel, 8 hex ring, 2 ring; outlines 2%, fills 98%; 13% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.00 over 180 gates: 0.031 half-heights at r 0.3, 0.032 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.091, r0.3-0.6 → 0.107, r0.6-1.0 → 0.179, r>1 → 0.137
- rings at r ≈ 0.84 (×455), 1.50 (×371); 2-fold (score 0.98); on the axes 46%, on the diagonals 18%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 26.1 px, halo/core 0.09 at 4 px; core lum 0.47, ground lum 0.010
- hues (by lit area): blue 240° 97%; ground `#010018`, centre/edge ground brightness 6.61
- flow (5197 object tracks, 45% moving outward → mixed directions): radial speed ∝ r^0.89 (a flat zoom) 0.10 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.15 at r<0.45 vs 4.92 at r≥0.45; 61% of elongated objects lie along the radial direction

### Regime 5 — 13% of the clip, 27.40s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 596 lit objects on 1280×720 (lit floor 0.18, lit 19.1% of pixels): 365 bar, 132 blob, 71 disc, 10 hex ring, 9 panel, 6 frame, 3 ring; outlines 8%, fills 92%; 21% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.02 over 99 gates: 0.054 half-heights at r 0.3, 0.055 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.089, r0.3-0.6 → 0.099, r0.6-1.0 → 0.238, r>1 → 0.326
- rings at r ≈ 0.67 (×92), 1.06 (×164), 1.68 (×177); 2-fold (score 0.97); on the axes 41%, on the diagonals 16%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 7.7 px, halo/core 0.03 at 4 px; core lum 0.67, ground lum 0.034
- hues (by lit area): azure 210° 63%, cyan 180° 28%, blue 240° 7%; ground `#040159`, centre/edge ground brightness 2.27
- flow (3182 object tracks, 35% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.39 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.02, 0.39:-0.01, 0.61:-0.02, 0.87:-0.01, 1.22:-0.02; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.51 at r<0.45 vs 4.0 at r≥0.45; 54% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **1.71–4.71s** — phrase start, beat #4 (2.21s) — no hard cut; brightness 0.06–0.07, colour change 0.016/frame (cut ≥ 0.2) — `bursts/001.71/timing.png` (every frame), `bursts/001.71/detail.png` (large), `bursts/001.71/motion.png` (paths / skeleton / t±1 in RGB)
- **13.43–16.43s** — transition at 14.93s (beat #31 r1, novelty 1.8) — no hard cut; brightness 0.07–0.10, colour change 0.034/frame (cut ≥ 0.2) — `bursts/013.43/timing.png` (every frame), `bursts/013.43/detail.png` (large), `bursts/013.43/motion.png` (paths / skeleton / t±1 in RGB)
- **15.63–18.63s** — transition at 17.13s (beat #36 r16, novelty 2.2); also transition at 16.47s (beat #34 r2, novelty 1.6); also transition at 18.20s (beat #38 r2, novelty 1.5); also phrase start, beat #36 (17.18s) — no hard cut; brightness 0.07–0.11, colour change 0.043/frame (cut ≥ 0.2) — `bursts/015.63/timing.png` (every frame), `bursts/015.63/detail.png` (large), `bursts/015.63/motion.png` (paths / skeleton / t±1 in RGB)
- **18.23–21.23s** — transition at 19.73s (beat #41 r1, novelty 3.3); also transition at 19.00s (beat #40 r4, novelty 3.0); also transition at 20.53s (beat #43 r1, novelty 2.6) — no hard cut; brightness 0.06–0.10, colour change 0.048/frame (cut ≥ 0.2) — `bursts/018.23/timing.png` (every frame), `bursts/018.23/detail.png` (large), `bursts/018.23/motion.png` (paths / skeleton / t±1 in RGB)
- **20.77–23.77s** — transition at 22.27s (beat #47 r1, novelty 3.4); also transition at 21.33s (beat #45 r1, novelty 3.1) — no hard cut; brightness 0.06–0.10, colour change 0.055/frame (cut ≥ 0.2) — `bursts/020.77/timing.png` (every frame), `bursts/020.77/detail.png` (large), `bursts/020.77/motion.png` (paths / skeleton / t±1 in RGB)
- **22.50–25.50s** — transition at 24.00s (beat #51 r1, novelty 5.1); also transition at 24.73s (beat #52 r16, novelty 3.4); also transition at 23.20s (beat #49 r1, novelty 3.4) — no hard cut; brightness 0.06–0.13, colour change 0.062/frame (cut ≥ 0.2) — `bursts/022.50/timing.png` (every frame), `bursts/022.50/detail.png` (large), `bursts/022.50/motion.png` (paths / skeleton / t±1 in RGB)
- **24.03–27.03s** — transition at 25.53s (beat #54 r2, novelty 4.8); also transition at 26.33s (beat #56 r4, novelty 4.7); also phrase start, beat #52 (24.59s) — no hard cut but brightness swings 0.06–0.20 — `bursts/024.03/timing.png` (every frame), `bursts/024.03/detail.png` (large), `bursts/024.03/motion.png` (paths / skeleton / t±1 in RGB)
- **26.43–29.43s** — transition at 27.93s (beat #59 r1, novelty 6.7); also transition at 28.93s (beat #62 r2, novelty 5.1); also transition at 29.80s (beat #63 r1, novelty 4.9); also transition at 28.67s (beat #61 r1, novelty 4.6); also transition at 27.00s (beat #57 r1, novelty 4.3) — no hard cut; brightness 0.15–0.22, colour change 0.087/frame (cut ≥ 0.2) — `bursts/026.43/timing.png` (every frame), `bursts/026.43/detail.png` (large), `bursts/026.43/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#010112`×0.36 `#0705d6`×0.32 `#060779`×0.20 `#3544e1`×0.07 `#62a7f3`×0.04
- mirror symmetry, ~1 axis (r 0.41); centre brightness 0.08 vs edge 0.13; mean brightness 0.12, dark frames 4%; saturation 0.89
- motion: zoom mean +0.003 (|zoom| 0.010) log-scale/s, rotation mean +0.0° (|rot| 0.3°)/s, frame-to-frame activity 0.021

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 4 | +0.47 | +0.49 | +0.12 | +0.72 | +1.13 | 4/4 |
| 8 | 4 | +0.17 | +0.13 | +0.65 | +0.79 | +0.40 | 4/4 |
| 4 | 8 | +0.19 | +0.22 | -0.12 | +0.53 | +1.08 | 7/7 |
| 2 | 16 | +0.33 | +0.34 | +0.29 | +0.98 | +0.46 | 16/16 |
| 1 | 32 | +0.58 | +0.55 | +0.34 | +0.64 | +0.73 | 32/32 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- activity ~ high: r +0.36 at +466 ms
- brightness ~ high: r +0.27 at +0 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 14.93 | #31 | +49 | 1 | -0.3 | -1.4 | +0.0 | +0.3 | on beat (r1), no onset, low drops, ours: onset yes, bpm 130 |
| 16.47 | #34 | +189 | 2 | +0.3 | +1.2 | -2.2 | -1.1 | off-beat (+0.41 beat from r2), no onset, low jumps, mid drops, high drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 17.13 | #36 | -49 | 16 | +1.9 | -2.4 | +0.7 | +2.4 | on beat (r16), hard onset, low drops, high jumps, ours: onset yes, bpm 130 |
| 18.20 | #38 | +88 | 2 | +0.9 | -0.3 | -1.8 | -1.3 | on beat (r2), onset, mid drops, high drops, ours: onset yes, bpm 130 |
| 19.00 | #40 | -40 | 4 | +2.7 | -1.6 | +2.0 | +0.4 | on beat (r4), hard onset, low drops, mid jumps, ours: onset yes, bpm 130 |
| 19.73 | #41 | +229 | 1 | +1.3 | +1.3 | -1.1 | -1.0 | off-beat (+0.49 beat from r1), onset, low jumps, mid drops, high drops, flash, ours: onset yes, bpm 130 |
| 20.53 | #43 | +100 | 1 | -0.3 | -0.5 | +0.8 | -1.6 | on beat (r1), no onset, high drops, ours: onset yes, bpm 130 |
| 21.33 | #45 | -6 | 1 | +2.9 | -0.1 | +1.3 | -0.6 | on beat (r1), hard onset, mid jumps, ours: onset yes, bpm 130 |
| 22.27 | #47 | -1 | 1 | +2.5 | -0.5 | +0.6 | -0.1 | on beat (r1), hard onset, ours: onset yes, bpm 130 |
| 23.20 | #49 | +3 | 1 | +1.6 | -0.1 | +1.1 | -0.6 | on beat (r1), hard onset, mid jumps, ours: onset yes, bpm 130 |
| 24.00 | #51 | -126 | 1 | +1.0 | -2.5 | -1.6 | -0.0 | off-beat (-0.27 beat from r1), onset, low drops, mid drops, looks like a cut, ours: onset yes, bpm 130 |
| 24.73 | #52 | +143 | 16 | -0.4 | +1.3 | +2.5 | -0.3 | off-beat (+0.31 beat from r16), no onset, low jumps, mid jumps, section boundary, → probably not audio-driven, ours: onset yes, bpm 130 |
| 25.53 | #54 | +38 | 2 | -0.5 | -1.6 | -0.4 | +0.3 | on beat (r2), no onset, low drops, section boundary, looks like a cut, ours: onset yes, bpm 130 |
| 26.33 | #56 | -91 | 4 | +0.3 | -2.0 | -0.0 | +1.4 | on beat (r4), no onset, low drops, high jumps, ours: onset yes, bpm 130 |
| 27.00 | #57 | +111 | 1 | +0.1 | -0.3 | +1.8 | -0.6 | off-beat (+0.24 beat from r1), no onset, mid jumps, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 27.93 | #59 | +139 | 1 | +0.0 | +1.2 | +2.7 | -0.3 | off-beat (+0.30 beat from r1), no onset, low jumps, mid jumps, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 130 |
| 28.67 | #61 | +36 | 1 | +1.7 | -3.1 | +0.7 | +2.7 | on beat (r1), hard onset, low drops, high jumps, ours: onset yes, bpm 130 |
| 28.93 | #62 | -138 | 2 | +0.6 | +2.3 | -2.1 | -1.5 | off-beat (-0.30 beat from r2), no onset, low jumps, mid drops, high drops, blackout, → probably not audio-driven, ours: onset yes, bpm 130 |
| 29.80 | #63 | +264 | 1 | -0.1 | +0.1 | +0.8 | +0.6 | off-beat (+0.57 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 130 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #8 (r4, 4.04s): zoom +1.4σ, rot -2.2σ
- beat #12 (r8, 5.88s): abszoom -1.1σ
- beat #16 (r4, 7.73s): zoom +0.8σ, abszoom +1.5σ, rot +1.4σ
- beat #20 (r16, 9.71s): zoom +1.4σ, abszoom +2.2σ, rot +0.8σ
- beat #24 (r4, 11.66s): rot -1.9σ
- beat #28 (r8, 13.51s): zoom +0.8σ, abszoom +1.2σ
- beat #32 (r4, 15.35s): rot +1.6σ
- beat #36 (r16, 17.18s): rot -1.0σ
- beat #40 (r4, 19.04s): abszoom -0.8σ
- beat #48 (r4, 22.73s): zoom +0.9σ, abszoom +1.1σ
- beat #52 (r16, 24.59s): zoom -1.2σ, rot -1.4σ
- beat #56 (r4, 26.42s): bright +1.3σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #0 | 0.35 | 4 | +0.3 | +0.1 | -1.0 | -1.0 | -0.8 | — | — |
| #4 | 2.21 | 16 | +1.5 | +0.4 | -0.6 | -0.4 | -0.6 | yes | 134 |
| #8 | 4.04 | 4 | +0.5 | +0.5 | -0.5 | -0.5 | -0.6 | yes | 173 |
| #12 | 5.87 | 8 | +2.5 | +0.2 | -1.0 | -0.3 | -0.6 | yes | 173 |
| #16 | 7.73 | 4 | +2.3 | +0.4 | -0.6 | -0.9 | -0.5 | yes | 130 |
| #20 | 9.71 | 16 | +1.3 | +0.6 | -0.2 | -0.5 | -0.6 | yes | 130 |
| #21 S | 10.17 | 1 | -0.0 | +0.3 | +0.1 | -0.1 | -0.5 | yes | 130 |
| #23 S | 11.19 | 1 | +2.7 | -0.1 | +0.2 | -0.6 | -0.4 | yes | 130 |
| #24 | 11.66 | 4 | +3.5 | -0.1 | +0.5 | -0.1 | -0.1 | yes | 130 |
| #28 | 13.51 | 8 | +2.7 | -0.2 | +0.8 | -0.6 | -0.5 | yes | 130 |
| #32 | 15.35 | 4 | +1.3 | -0.3 | +0.6 | +0.7 | +0.8 | yes | 130 |
| #36 | 17.18 | 16 | +1.9 | -0.1 | +0.6 | +1.7 | +0.7 | yes | 130 |
| #40 | 19.04 | 4 | +2.7 | -0.2 | +0.6 | +1.9 | +1.3 | yes | 130 |
| #44 | 20.87 | 8 | +2.0 | -0.5 | +0.4 | +0.1 | +0.4 | yes | 130 |
| #48 | 22.73 | 4 | +3.1 | -0.1 | +0.3 | +0.1 | +0.1 | yes | 130 |
| #52 S | 24.59 | 16 | +1.6 | -2.0 | +1.0 | +1.3 | +2.6 | yes | 130 |
| #54 S | 25.50 | 2 | +1.3 | -0.5 | +0.8 | +1.8 | +3.9 | yes | 130 |
| #56 | 26.42 | 4 | +0.3 | -0.2 | +0.8 | +2.3 | +2.7 | yes | 130 |
| #60 | 28.17 | 8 | +0.9 | +0.4 | +0.4 | +1.5 | +1.4 | yes | 130 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/001.71/timing.png` … — burst 1.71–4.71s (continuous): phrase start, beat #4 (2.21s). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/013.43/timing.png` … — burst 13.43–16.43s (continuous): transition at 14.93s (beat #31 r1, novelty 1.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.63/timing.png` … — burst 15.63–18.63s (continuous): transition at 17.13s (beat #36 r16, novelty 2.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/018.23/timing.png` … — burst 18.23–21.23s (continuous): transition at 19.73s (beat #41 r1, novelty 3.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.77/timing.png` … — burst 20.77–23.77s (continuous): transition at 22.27s (beat #47 r1, novelty 3.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.50/timing.png` … — burst 22.50–25.50s (continuous): transition at 24.00s (beat #51 r1, novelty 5.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/024.03/timing.png` … — burst 24.03–27.03s (flash): transition at 25.53s (beat #54 r2, novelty 4.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/026.43/timing.png` … — burst 26.43–29.43s (continuous): transition at 27.93s (beat #59 r1, novelty 6.7). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py alt-circuit --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
