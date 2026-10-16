# ref bundle: alt-ocean

`tools/.cache/refs/_downloads/kMJVNerOtRI.mp4` — 2190.0+40.0s. tempo **129.2 bpm** (beat 0.464s), 84 beats, phrase phase = beat 2 (estimated, margin 0.19σ); sections at beats 2, 11, 21, 35, 46.
Ours heard through `spectrum`: 4771 probe samples, 341 onsets vs the reference's 340.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- brightness reacts most at phrase starts (rank 16 z +0.26 vs rank 4 -0.18) — ours: onset fires on 6/6 of those beats
- zoom speed reacts most at phrase starts (rank 16 z +0.88 vs rank 4 +0.29) — ours: onset fires on 6/6 of those beats
- colour change reacts most at phrase starts (rank 16 z +1.35 vs rank 4 +0.71) — ours: onset fires on 6/6 of those beats
- activity moves against high (r -0.20, +400 ms)
- NO HARD CUTS at 30 fps in 40 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 2 strobe stretch(es), flashes every 0.37 s ≈ 0.79 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps); 1/2 start on a beat, at t 0.3, 2.0
- 18 single transitions: 2 on a beat with an onset, 5 off-beat with no onset (timer/scripted) — ours: onset fired at 18/18 of them
- picture changes regime at 3/5 audio section boundaries — ours: `section` shows no rise near any of them
- zoom direction changes at beat #18 (r16, 9.3s, +1.3σ)
- brightness does not flash on onsets (rise z +0.01 over 34 strong onsets)
- activity does not flash on onsets (rise z +0.15 over 34 strong onsets)
- activity is continuous across the beat (contrast 0.29σ)
- brightness is continuous across the beat (contrast 0.19σ)
- zoom speed is continuous across the beat (contrast 0.23σ)
- ours: tempo at ×1 for 98% of the clip, ×½ 0%, ×2 0%, elsewhere 2% (median 130.1 vs reference 129.2); our onset lands within 60 ms of 99% of the reference's onsets, and 99% of ours sit on one of theirs; lag -6 ms ±7

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 40% of the clip, 17.40s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 580 lit objects on 1280×720 (lit floor 0.18, lit 3.9% of pixels): 533 bar, 28 blob, 17 disc, 2 panel; outlines 1%, fills 99%; 33% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.03 over 19 gates: 0.027 half-heights at r 0.3, 0.026 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.200, r0.3-0.6 → 0.125, r0.6-1.0 → 0.129, r>1 → 0.100
- rings at r ≈ 1.06 (×192), 1.68 (×121); 2-fold (score 0.74); on the axes 32%, on the diagonals 19%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 2.1 px, halo/core 0.02 at 4 px; core lum 0.67, ground lum 0.001
- hues (by lit area): blue 240° 71%, violet 270° 20%, azure 210° 8%; ground `#000001`, centre/edge ground brightness 2.72
- flow (2483 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^0.50 (not a zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:+0.02, 0.21:+0.00, 0.39:+0.00, 0.61:+0.01, 0.87:+0.00, 1.22:-0.01; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 5.68 at r<0.45 vs 6.71 at r≥0.45; 50% of elongated objects lie along the radial direction

### Regime 2 — 26% of the clip, 12.73s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 598 lit objects on 1280×720 (lit floor 0.18, lit 4.7% of pixels): 547 bar, 34 blob, 12 disc, 5 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.18 over 17 gates: 0.045 half-heights at r 0.3, 0.037 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.102, r0.3-0.6 → 0.155, r0.6-1.0 → 0.144, r>1 → 0.117
- rings at r ≈ 0.75 (×142), 0.95 (×136), 1.50 (×154); 2-fold (score 0.87); on the axes 35%, on the diagonals 19%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 2.4 px, halo/core 0.03 at 4 px; core lum 0.70, ground lum 0.002
- hues (by lit area): blue 240° 81%, violet 270° 12%, azure 210° 6%; ground `#000004`, centre/edge ground brightness 5.83
- flow (2527 object tracks, 46% moving outward → mixed directions): radial speed ∝ r^0.35 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:-0.06, 0.21:+0.05, 0.39:+0.00, 0.61:+0.00, 0.87:-0.01, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 6.21 at r<0.45 vs 7.04 at r≥0.45; 50% of elongated objects lie along the radial direction

### Regime 3 — 12% of the clip, 24.73s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 347 lit objects on 1280×720 (lit floor 0.18, lit 2.6% of pixels): 318 bar, 15 blob, 11 disc, 3 panel; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.42 over 14 gates: 0.061 half-heights at r 0.3, 0.038 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.077, r0.3-0.6 → 0.168, r0.6-1.0 → 0.148, r>1 → 0.111
- rings at r ≈ 0.67 (×69), 1.06 (×110); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 2.1 px, halo/core 0.03 at 4 px; core lum 0.68, ground lum 0.000
- hues (by lit area): blue 240° 77%, azure 210° 15%, violet 270° 8%; ground `#000000`, centre/edge ground brightness 0.85
- flow (1507 object tracks, 44% moving outward → mixed directions): radial speed ∝ r^0.50 (not a zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:-0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 6.39 at r<0.45 vs 7.53 at r≥0.45; 56% of elongated objects lie along the radial direction

### Regime 4 — 12% of the clip, 3.60s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 819 lit objects on 1280×720 (lit floor 0.18, lit 14.4% of pixels): 625 bar, 126 blob, 58 disc, 8 panel, 1 frame, 1 hex ring; outlines 1%, fills 99%; 44% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.05 over 67 gates: 0.028 half-heights at r 0.3, 0.029 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.109, r0.3-0.6 → 0.084, r0.6-1.0 → 0.148, r>1 → 0.122
- rings at r ≈ 1.06 (×235), 1.50 (×287); 2-fold (score 0.90); on the axes 32%, on the diagonals 15%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 1.7 px, halo/core 0.02 at 4 px; core lum 0.62, ground lum 0.001
- hues (by lit area): blue 240° 94%, azure 210° 6%; ground `#000001`, centre/edge ground brightness 2.26
- flow (2595 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.03 (a flat zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:-0.00, 0.21:+0.00, 0.39:-0.01, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.09 at r<0.45 vs 4.65 at r≥0.45; 52% of elongated objects lie along the radial direction

### Regime 5 — 10% of the clip, 38.13s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 821 lit objects on 1280×720 (lit floor 0.18, lit 6.8% of pixels): 702 bar, 73 blob, 32 disc, 11 panel, 2 hex ring, 1 ring; outlines 1%, fills 99%; 38% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.13 over 46 gates: 0.036 half-heights at r 0.3, 0.032 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.189, r0.3-0.6 → 0.117, r0.6-1.0 → 0.117, r>1 → 0.135
- rings at r ≈ 0.27 (×57), 0.95 (×209), 1.50 (×186); 2-fold (score 0.83); on the axes 46%, on the diagonals 16%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 3.9 px, halo/core 0.04 at 4 px; core lum 0.65, ground lum 0.003
- hues (by lit area): blue 240° 81%, azure 210° 18%; ground `#000006`, centre/edge ground brightness 4.02
- flow (2961 object tracks, 40% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.48 (not a zoom) 0.09 half-heights/s at r 0.5; by r → 0.07:-0.01, 0.21:+0.00, 0.39:+0.00, 0.61:-0.01, 0.87:-0.01, 1.22:-0.02; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.7 at r<0.45 vs 5.89 at r≥0.45; 56% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.02–3.02s** — strobe 0.27–1.13s, flashes every 0.43s — no hard cut; brightness 0.14–0.16, colour change 0.021/frame (cut ≥ 0.2) — `bursts/000.02/timing.png` (every frame), `bursts/000.02/detail.png` (large), `bursts/000.02/motion.png` (paths / skeleton / t±1 in RGB)
- **1.75–4.75s** — strobe 2.00–3.20s, flashes every 0.30s; also transition at 3.80s (beat #6 r4, novelty 3.9); also transition at 4.33s (beat #7 r1, novelty 2.9); also transition at 4.60s (beat #8 r2, novelty 2.5); also phrase start, beat #2 (1.93s) — no hard cut; brightness 0.08–0.15, colour change 0.020/frame (cut ≥ 0.2) — `bursts/001.75/timing.png` (every frame), `bursts/001.75/detail.png` (large), `bursts/001.75/motion.png` (paths / skeleton / t±1 in RGB)
- **3.70–6.70s** — transition at 5.20s (beat #9 r1, novelty 3.3); also transition at 5.60s (beat #10 r8, novelty 1.7) — no hard cut; brightness 0.05–0.12, colour change 0.016/frame (cut ≥ 0.2) — `bursts/003.70/timing.png` (every frame), `bursts/003.70/detail.png` (large), `bursts/003.70/motion.png` (paths / skeleton / t±1 in RGB)
- **10.30–13.30s** — transition at 11.80s (beat #23 r1, novelty 2.1); also transition at 12.20s (beat #24 r2, novelty 1.9); also transition at 10.80s (beat #21 r1, novelty 1.7); also phrase start, beat #18 (9.31s) — no hard cut; brightness 0.04–0.06, colour change 0.020/frame (cut ≥ 0.2) — `bursts/010.30/timing.png` (every frame), `bursts/010.30/detail.png` (large), `bursts/010.30/motion.png` (paths / skeleton / t±1 in RGB)
- **20.03–23.03s** — transition at 21.53s (beat #44 r2, novelty 1.9); also transition at 22.07s (beat #46 r4, novelty 1.6) — no hard cut; brightness 0.03–0.05, colour change 0.017/frame (cut ≥ 0.2) — `bursts/020.03/timing.png` (every frame), `bursts/020.03/detail.png` (large), `bursts/020.03/motion.png` (paths / skeleton / t±1 in RGB)
- **29.70–32.70s** — transition at 31.20s (beat #65 r1, novelty 2.6); also transition at 32.20s (beat #68 r2, novelty 1.6); also phrase start, beat #66 (31.46s) — no hard cut; brightness 0.03–0.05, colour change 0.021/frame (cut ≥ 0.2) — `bursts/029.70/timing.png` (every frame), `bursts/029.70/detail.png` (large), `bursts/029.70/motion.png` (paths / skeleton / t±1 in RGB)
- **35.37–38.37s** — transition at 36.87s (beat #78 r4, novelty 2.1) — no hard cut; brightness 0.05–0.07, colour change 0.019/frame (cut ≥ 0.2) — `bursts/035.37/timing.png` (every frame), `bursts/035.37/detail.png` (large), `bursts/035.37/motion.png` (paths / skeleton / t±1 in RGB)
- **37.00–40.00s** — transition at 39.27s (beat #83 r1, novelty 3.7); also transition at 39.80s (beat #83 r1, novelty 3.2); also transition at 38.87s (beat #82 r16, novelty 2.4); also phrase start, beat #82 (38.85s) — no hard cut; brightness 0.06–0.09, colour change 0.022/frame (cut ≥ 0.2) — `bursts/037.00/timing.png` (every frame), `bursts/037.00/detail.png` (large), `bursts/037.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#000004`×0.74 `#090949`×0.11 `#1f1d8e`×0.07 `#6063aa`×0.05 `#9ea0dd`×0.03
- mirror symmetry, ~1 axis (r 0.33); centre brightness 0.10 vs edge 0.06; mean brightness 0.07, dark frames 77%; saturation 0.58
- motion: zoom mean -0.009 (|zoom| 0.022) log-scale/s, rotation mean +0.2° (|rot| 0.9°)/s, frame-to-frame activity 0.016

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 6 | +0.76 | +1.35 | +0.26 | +0.88 | +0.29 | 6/6 |
| 8 | 5 | +0.15 | +1.02 | -0.27 | +0.09 | +0.98 | 5/5 |
| 4 | 10 | -0.02 | +0.71 | -0.18 | +0.29 | +0.41 | 10/10 |
| 2 | 21 | +0.23 | +1.01 | +0.06 | +0.23 | +0.29 | 21/21 |
| 1 | 42 | +0.16 | +0.80 | -0.02 | +0.38 | +0.44 | 42/42 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- activity ~ high: r -0.20 at +400 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.27 | #0 | -732 | 2 | +0.2 | -0.4 | +0.9 | -0.4 | STROBE to 1.13s: 3 flashes every 0.43s = 0.93 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps), starts off beat r2, no onset |
| 2.00 | #2 | +73 | 16 | +2.6 | +1.5 | +1.2 | +1.1 | STROBE to 3.20s: 5 flashes every 0.30s = 0.65 beat (no simple fraction of a beat → own timer), starts on beat r16, hard onset, low jumps, mid jumps, high jumps, section boundary, ours: onset yes, bpm 86 |
| 3.80 | #6 | +15 | 4 | -0.3 | +2.1 | +0.2 | +0.6 | on beat (r4), no onset, low jumps, ours: onset yes, bpm 130 |
| 4.33 | #7 | +107 | 1 | +1.3 | -0.6 | -3.4 | -1.8 | off-beat (+0.23 beat from r1), onset, mid drops, high drops, ours: onset yes, bpm 130 |
| 4.60 | #8 | -90 | 2 | +0.6 | -2.4 | +1.9 | +1.6 | on beat (r2), no onset, low drops, mid jumps, high jumps, ours: onset yes, bpm 130 |
| 5.20 | #9 | +45 | 1 | +1.1 | +1.4 | +1.2 | +1.4 | on beat (r1), onset, low jumps, mid jumps, high jumps, ours: onset yes, bpm 130 |
| 5.60 | #10 | -19 | 8 | +0.4 | +1.3 | +1.1 | +0.5 | on beat (r8), no onset, low jumps, mid jumps, ours: onset yes, bpm 130 |
| 10.80 | #21 | +96 | 1 | +0.1 | +0.3 | -4.1 | -2.4 | on beat (r1), no onset, mid drops, high drops, section boundary, ours: onset yes, bpm 130 |
| 11.80 | #23 | +190 | 1 | +1.5 | -0.7 | +2.0 | +3.4 | off-beat (+0.41 beat from r1), onset, mid jumps, high jumps, ours: onset yes, bpm 130 |
| 12.20 | #24 | +126 | 2 | +0.4 | -1.6 | -2.3 | -0.9 | off-beat (+0.27 beat from r2), no onset, low drops, mid drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 21.53 | #44 | +217 | 2 | +0.6 | -0.4 | -1.9 | -1.5 | off-beat (+0.47 beat from r2), no onset, mid drops, high drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 22.07 | #46 | -155 | 4 | +0.7 | +2.6 | +0.6 | -0.1 | off-beat (-0.33 beat from r4), onset, low jumps, section boundary, ours: onset yes, bpm 130 |
| 31.20 | #65 | +201 | 1 | +0.8 | +0.1 | +0.7 | -0.8 | off-beat (+0.43 beat from r1), onset, ours: onset yes, bpm 130 |
| 32.20 | #68 | -192 | 2 | +0.9 | -0.5 | +1.7 | +2.7 | off-beat (-0.41 beat from r2), onset, mid jumps, high jumps, ours: onset yes, bpm 130 |
| 33.40 | #70 | +103 | 4 | -0.5 | -0.2 | -4.3 | -4.5 | off-beat (+0.22 beat from r4), no onset, mid drops, high drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 34.20 | #72 | -26 | 2 | +0.3 | +1.2 | -1.4 | +0.1 | on beat (r2), no onset, low jumps, mid drops, ours: onset yes, bpm 130 |
| 36.87 | #78 | -123 | 4 | -0.2 | -1.1 | +1.1 | -0.4 | off-beat (-0.26 beat from r4), no onset, low drops, mid jumps, → probably not audio-driven, ours: onset yes, bpm 130 |
| 38.87 | #82 | +20 | 16 | -0.1 | +0.1 | +0.8 | +2.0 | on beat (r16), no onset, high jumps, ours: onset yes, bpm 130 |
| 39.27 | #83 | -45 | 1 | +1.9 | +1.4 | +0.1 | +1.3 | on beat (r1), hard onset, low jumps, high jumps, ours: onset yes, bpm 130 |
| 39.80 | #83 | +489 | 1 | -0.2 | +2.3 | -0.7 | -0.8 | off-beat (+1.05 beat from r1), no onset, low jumps, → probably not audio-driven, ours: onset yes, bpm 130 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #2 (r16, 1.93s): abszoom -0.8σ
- beat #10 (r8, 5.62s): sat -1.0σ, zoom -1.0σ
- beat #14 (r4, 7.48s): abszoom +0.9σ
- beat #18 (r16, 9.31s): zoom +1.3σ, abszoom -1.3σ
- beat #22 (r4, 11.15s): rot +1.2σ
- beat #26 (r8, 13.00s): zoom +1.0σ, abszoom -1.2σ, rot -1.2σ
- beat #34 (r16, 16.70s): rot +1.5σ
- beat #38 (r4, 18.55s): abszoom +0.8σ
- beat #46 (r4, 22.22s): rot -0.9σ
- beat #50 (r16, 24.08s): sat -0.9σ
- beat #54 (r4, 25.91s): abszoom +0.9σ, rot -1.5σ
- beat #58 (r8, 27.77s): rot +1.6σ
- beat #62 (r4, 29.61s): sat +1.2σ, abszoom +0.8σ, rot -0.9σ
- beat #70 (r4, 33.30s): zoom +0.9σ
- beat #78 (r4, 36.99s): zoom +1.0σ, abszoom -1.4σ
- beat #82 (r16, 38.85s): rot -1.0σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #2 S | 1.93 | 16 | +2.6 | -0.0 | +0.3 | +5.3 | +2.1 | yes | 130 |
| #6 | 3.78 | 4 | +1.4 | -0.2 | -0.5 | +2.5 | +2.3 | yes | 130 |
| #10 | 5.62 | 8 | +0.4 | -0.2 | +0.4 | +1.9 | +1.9 | yes | 130 |
| #11 S | 6.08 | 1 | +1.2 | -0.5 | +0.3 | +0.6 | +2.0 | yes | 130 |
| #14 | 7.48 | 4 | +1.7 | +0.4 | +0.1 | -0.3 | -1.0 | yes | 130 |
| #18 | 9.31 | 16 | +0.6 | -0.3 | +0.6 | +0.0 | +1.3 | yes | 130 |
| #21 S | 10.70 | 1 | +0.1 | -0.3 | -0.9 | +0.7 | +1.7 | yes | 130 |
| #22 | 11.15 | 4 | +0.1 | +0.3 | -0.4 | +0.2 | +0.8 | yes | 130 |
| #26 | 13.00 | 8 | +3.6 | +0.2 | +0.2 | -0.1 | +1.9 | yes | 130 |
| #30 | 14.84 | 4 | +1.8 | -0.1 | -0.1 | -0.3 | +0.2 | yes | 130 |
| #34 | 16.70 | 16 | +0.5 | -0.6 | +0.3 | -0.6 | +1.2 | yes | 130 |
| #35 S | 17.16 | 1 | +0.9 | -0.8 | -0.3 | -0.5 | +0.4 | yes | 130 |
| #38 | 18.55 | 4 | +1.9 | +0.0 | +0.0 | -0.3 | -0.2 | yes | 130 |
| #42 | 20.39 | 8 | +0.9 | -0.1 | +0.7 | +0.0 | +0.3 | yes | 130 |
| #46 S | 22.22 | 4 | +0.7 | +0.1 | +0.2 | -0.4 | -0.2 | yes | 130 |
| #50 | 24.08 | 16 | +0.2 | -0.4 | +0.6 | -0.8 | +0.0 | yes | 130 |
| #54 | 25.91 | 4 | +1.9 | +0.1 | -0.1 | -0.9 | -0.3 | yes | 130 |
| #58 | 27.77 | 8 | +0.6 | +0.5 | +0.4 | -0.8 | -0.4 | yes | 130 |
| #62 | 29.61 | 4 | +1.4 | -0.3 | -0.0 | -0.5 | +1.8 | yes | 130 |
| #66 | 31.46 | 16 | +3.4 | -0.2 | +0.2 | +0.2 | +1.8 | yes | 130 |
| #70 | 33.30 | 4 | +1.5 | +0.5 | -0.5 | -0.2 | +1.9 | yes | 130 |
| #74 | 35.16 | 8 | +0.8 | -0.3 | +0.3 | -0.2 | +1.3 | yes | 130 |
| #78 | 36.99 | 4 | +1.8 | -0.7 | +0.2 | +0.3 | +1.9 | yes | 130 |
| #82 | 38.85 | 16 | +0.6 | +0.4 | +0.4 | +0.5 | +3.0 | yes | 130 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 14 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.02/timing.png` … — burst 0.02–3.02s (continuous): strobe 0.27–1.13s, flashes every 0.43s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/001.75/timing.png` … — burst 1.75–4.75s (continuous): strobe 2.00–3.20s, flashes every 0.30s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/003.70/timing.png` … — burst 3.70–6.70s (continuous): transition at 5.20s (beat #9 r1, novelty 3.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.30/timing.png` … — burst 10.30–13.30s (continuous): transition at 11.80s (beat #23 r1, novelty 2.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.03/timing.png` … — burst 20.03–23.03s (continuous): transition at 21.53s (beat #44 r2, novelty 1.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/029.70/timing.png` … — burst 29.70–32.70s (continuous): transition at 31.20s (beat #65 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/035.37/timing.png` … — burst 35.37–38.37s (continuous): transition at 36.87s (beat #78 r4, novelty 2.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/037.00/timing.png` … — burst 37.00–40.00s (continuous): transition at 39.27s (beat #83 r1, novelty 3.7). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py alt-ocean --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png` ← the rank that reacts hardest
- `sheets/rank8.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank2-3.png`
- `sheets/rank2-4.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `sheets/rank1-5.png`
- `sheets/rank1-6.png`
- `sheets/rank1-7.png`
- `sheets/rank1-8.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
