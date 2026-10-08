# ref bundle: alt-wings

`tools/.cache/refs/_downloads/kMJVNerOtRI.mp4` — 2100.0+40.0s. tempo **129.2 bpm** (beat 0.464s), 86 beats, phrase phase = beat 10 (estimated, margin 1.11σ); sections at beats 23, 40, 51, 55, 67.
Ours heard through `spectrum`: 4777 probe samples, 271 onsets vs the reference's 227.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- brightness reacts most at phrase starts (rank 16 z +0.47 vs rank 4 +0.01) — ours: onset fires on 5/5 of those beats
- activity moves against low (r -0.20, +400 ms)
- brightness moves against low (r -0.29, +200 ms)
- sat moves against high (r -0.27, -333 ms)
- NO HARD CUTS at 30 fps in 40 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 1 strobe stretch(es), flashes every 0.23 s ≈ 0.50 beat (≈ 0.5 beat within the ±0.14-beat resolution of 15 fps); 0/1 start on a beat, at t 34.7
- 18 single transitions: 5 on a beat with an onset, 5 off-beat with no onset (timer/scripted) — ours: onset fired at 15/18 of them
- picture changes regime at 0/5 audio section boundaries — ours: `section` shows no rise near any of them
- zoom direction changes at beat #2 (r8, 1.0s, -1.8σ)
- brightness does not flash on onsets (rise z +0.14 over 23 strong onsets)
- activity does not flash on onsets (rise z +0.25 over 23 strong onsets)
- activity is continuous across the beat (contrast 0.22σ)
- brightness is continuous across the beat (contrast 0.15σ)
- zoom speed is continuous across the beat (contrast 0.23σ)
- ours: tempo at ×1 for 3% of the clip, ×½ 0%, ×2 0%, elsewhere 97% (median 173.1 vs reference 129.2); our onset lands within 60 ms of 94% of the reference's onsets, and 79% of ours sit on one of theirs; lag -1 ms ±11

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 48% of the clip, 25.20s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 538 lit objects on 1280×720 (lit floor 0.18, lit 4.7% of pixels): 222 disc, 171 blob, 132 bar, 8 panel, 4 hex ring, 1 ring; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.01 over 235 gates: 0.030 half-heights at r 0.3, 0.030 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.062, r0.6-1.0 → 0.076, r>1 → 0.072
- rings at r ≈ 1.50 (×320); 2-fold (score 0.96); on the axes 78%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 30.4 px, halo/core 0.17 at 4 px; core lum 0.29, ground lum 0.012
- hues (by lit area): magenta 300° 76%, violet 270° 24%; ground `#06010a`, centre/edge ground brightness 1.45
- flow (1979 object tracks, 23% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.64 (a fly-through along the axis) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 30.0 at r<0.45 vs 2.16 at r≥0.45; 18% of elongated objects lie along the radial direction

### Regime 2 — 16% of the clip, 7.33s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 1110 lit objects on 1280×720 (lit floor 0.18, lit 8.0% of pixels): 430 bar, 362 blob, 296 disc, 19 panel, 3 hex ring; outlines 0%, fills 100%; 33% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.01 over 318 gates: 0.030 half-heights at r 0.3, 0.030 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.123, r0.3-0.6 → 0.144, r0.6-1.0 → 0.101, r>1 → 0.067
- rings at r ≈ 1.34 (×520); 2-fold (score 0.96); on the axes 42%, on the diagonals 19%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 14.5 px, halo/core 0.20 at 4 px; core lum 0.26, ground lum 0.003
- hues (by lit area): magenta 300° 86%, violet 270° 11%; ground `#010001`, centre/edge ground brightness 1.00
- flow (4044 object tracks, 23% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.72 (a flat zoom) 0.23 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.64 at r<0.45 vs 2.33 at r≥0.45; 32% of elongated objects lie along the radial direction

### Regime 3 — 15% of the clip, 15.87s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 1475 lit objects on 1280×720 (lit floor 0.18, lit 11.1% of pixels): 496 disc, 485 bar, 473 blob, 16 panel, 3 ring, 2 hex ring; outlines 0%, fills 100%; 40% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.08 over 517 gates: 0.027 half-heights at r 0.3, 0.030 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.082, r0.3-0.6 → 0.080, r0.6-1.0 → 0.068, r>1 → 0.069
- rings at r ≈ 1.34 (×672); 2-fold (score 0.99); on the axes 41%, on the diagonals 12%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 11.7 px, halo/core 0.17 at 4 px; core lum 0.28, ground lum 0.003
- hues (by lit area): magenta 300° 90%, violet 270° 9%; ground `#010003`, centre/edge ground brightness 1.00
- flow (5363 object tracks, 20% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.80 (a flat zoom) 0.25 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.79 at r<0.45 vs 2.3 at r≥0.45; 23% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 35.13s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 1768 lit objects on 1280×720 (lit floor 0.18, lit 16.6% of pixels): 661 bar, 541 disc, 534 blob, 30 panel, 2 hex ring; outlines 0%, fills 100%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.06 over 573 gates: 0.029 half-heights at r 0.3, 0.032 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.090, r0.3-0.6 → 0.114, r0.6-1.0 → 0.100, r>1 → 0.084
- rings at r ≈ 0.42 (×114), 1.19 (×719); 2-fold (score 0.98); on the axes 46%, on the diagonals 11%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 12.5 px, halo/core 0.18 at 4 px; core lum 0.30, ground lum 0.009
- hues (by lit area): magenta 300° 88%, violet 270° 11%; ground `#060009`, centre/edge ground brightness 1.00
- flow (7553 object tracks, 19% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.83 (a flat zoom) 0.17 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.3 at r<0.45 vs 2.41 at r≥0.45; 23% of elongated objects lie along the radial direction

### Regime 5 — 7% of the clip, 0.93s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 110 lit objects on 1280×720 (lit floor 0.18, lit 1.4% of pixels): 64 disc, 22 blob, 22 bar, 1 ring, 1 hex ring; outlines 2%, fills 98%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.14 over 66 gates: 0.021 half-heights at r 0.3, 0.025 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → 0.051
- rings at r ≈ 1.50 (×92); 2-fold (score 0.60); on the axes 25%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 3.4 px, halo/core 0.05 at 4 px; core lum 0.32, ground lum 0.000
- hues (by lit area): magenta 300° 57%, violet 270° 42%; ground `#000000`, centre/edge ground brightness 0.00
- flow (480 object tracks, 23% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.86 (a fly-through along the axis) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:—, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 2.13 at r≥0.45; 25% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **5.03–8.03s** — transition at 6.53s (beat #14 r4, novelty 4.0); also transition at 6.07s (beat #13 r1, novelty 3.8); also phrase start, beat #10 (4.71s) — no hard cut; brightness 0.04–0.07, colour change 0.014/frame (cut ≥ 0.2) — `bursts/005.03/timing.png` (every frame), `bursts/005.03/detail.png` (large), `bursts/005.03/motion.png` (paths / skeleton / t±1 in RGB)
- **6.57–9.57s** — transition at 8.07s (beat #17 r1, novelty 2.0) — no hard cut; brightness 0.01–0.07, colour change 0.007/frame (cut ≥ 0.2) — `bursts/006.57/timing.png` (every frame), `bursts/006.57/detail.png` (large), `bursts/006.57/motion.png` (paths / skeleton / t±1 in RGB)
- **14.57–17.57s** — transition at 16.07s (beat #34 r8, novelty 6.4); also transition at 15.40s (beat #33 r1, novelty 2.5); also transition at 16.60s (beat #36 r2, novelty 2.0) — no hard cut; brightness 0.05–0.08, colour change 0.013/frame (cut ≥ 0.2) — `bursts/014.57/timing.png` (every frame), `bursts/014.57/detail.png` (large), `bursts/014.57/motion.png` (paths / skeleton / t±1 in RGB)
- **16.57–19.57s** — transition at 18.07s (beat #39 r1, novelty 5.1); also transition at 19.53s (beat #42 r16, novelty 4.0); also transition at 18.93s (beat #41 r1, novelty 2.4) — no hard cut; brightness 0.07–0.09, colour change 0.014/frame (cut ≥ 0.2) — `bursts/016.57/timing.png` (every frame), `bursts/016.57/detail.png` (large), `bursts/016.57/motion.png` (paths / skeleton / t±1 in RGB)
- **28.57–31.57s** — transition at 30.07s (beat #65 r1, novelty 2.4) — no hard cut; brightness 0.04–0.07, colour change 0.010/frame (cut ≥ 0.2) — `bursts/028.57/timing.png` (every frame), `bursts/028.57/detail.png` (large), `bursts/028.57/motion.png` (paths / skeleton / t±1 in RGB)
- **32.57–35.57s** — transition at 34.07s (beat #73 r1, novelty 6.6); also transition at 33.40s (beat #72 r2, novelty 5.0) — no hard cut; brightness 0.02–0.12, colour change 0.018/frame (cut ≥ 0.2) — `bursts/032.57/timing.png` (every frame), `bursts/032.57/detail.png` (large), `bursts/032.57/motion.png` (paths / skeleton / t±1 in RGB)
- **34.42–37.42s** — strobe 34.67–35.13s, flashes every 0.23s; also transition at 37.20s (beat #80 r2, novelty 6.7); also transition at 36.07s (beat #78 r4, novelty 5.0); also transition at 36.47s (beat #79 r1, novelty 2.7); also phrase start, beat #74 (34.37s) — no hard cut; brightness 0.10–0.11, colour change 0.017/frame (cut ≥ 0.2) — `bursts/034.42/timing.png` (every frame), `bursts/034.42/detail.png` (large), `bursts/034.42/motion.png` (paths / skeleton / t±1 in RGB)
- **36.57–39.57s** — transition at 38.07s (beat #82 r8, novelty 5.7); also transition at 38.53s (beat #83 r1, novelty 5.0) — no hard cut; brightness 0.05–0.11, colour change 0.015/frame (cut ≥ 0.2) — `bursts/036.57/timing.png` (every frame), `bursts/036.57/detail.png` (large), `bursts/036.57/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#010003`×0.44 `#0f0314`×0.24 `#210e25`×0.17 `#361f3b`×0.11 `#553a5a`×0.04
- mirror symmetry, ~1 axis (r 0.85); centre brightness 0.06 vs edge 0.06; mean brightness 0.06, dark frames 75%; saturation 0.65
- motion: zoom mean -0.007 (|zoom| 0.081) log-scale/s, rotation mean +0.2° (|rot| 1.4°)/s, frame-to-frame activity 0.018

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 5 | +0.57 | +0.80 | +0.47 | +0.01 | -0.10 | 5/5 |
| 8 | 6 | +0.36 | +1.46 | +0.02 | +0.49 | +0.52 | 5/6 |
| 4 | 10 | +0.22 | +0.40 | +0.01 | +0.17 | -0.05 | 9/10 |
| 2 | 22 | +0.11 | +0.55 | +0.01 | +0.55 | +0.64 | 18/21 |
| 1 | 43 | +0.15 | +0.71 | +0.05 | +0.15 | +0.29 | 31/43 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- brightness ~ low: r -0.29 at +200 ms
- sat ~ high: r -0.27 at -333 ms
- brightness ~ rms: r -0.21 at -66 ms
- activity ~ low: r -0.20 at +400 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 4.07 | #9 | -183 | 1 | +0.1 | -0.0 | +0.8 | +1.0 | off-beat (-0.39 beat from r1), no onset, high jumps, → probably not audio-driven, ours: onset yes, bpm 174 |
| 6.07 | #13 | -40 | 1 | +1.7 | +0.1 | -0.7 | +0.1 | on beat (r1), hard onset, looks like a cut, ours: onset yes, bpm 173 |
| 6.53 | #14 | -38 | 4 | +1.4 | +0.2 | -0.2 | -1.3 | on beat (r4), onset, high drops, ours: onset yes, bpm 173 |
| 8.07 | #17 | +125 | 1 | +0.0 | -0.1 | -2.0 | -1.3 | off-beat (+0.27 beat from r1), no onset, mid drops, high drops, → probably not audio-driven, ours: onset yes, bpm 173 |
| 15.40 | #33 | +28 | 1 | -0.4 | -0.1 | -0.5 | -0.9 | on beat (r1), no onset, ours: onset no, bpm 173 |
| 16.07 | #34 | +231 | 8 | -0.1 | +0.1 | -1.4 | -0.8 | off-beat (+0.50 beat from r8), no onset, mid drops, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 173 |
| 16.60 | #36 | -142 | 2 | -0.1 | +0.6 | +0.6 | -0.2 | off-beat (-0.30 beat from r2), no onset, → probably not audio-driven, ours: onset yes, bpm 110 |
| 18.07 | #39 | -45 | 1 | +0.7 | +0.3 | +2.6 | +2.5 | on beat (r1), onset, mid jumps, high jumps, looks like a cut, ours: onset yes, bpm 142 |
| 18.93 | #41 | -107 | 1 | +1.6 | -0.7 | -1.9 | -1.7 | off-beat (-0.23 beat from r1), hard onset, mid drops, high drops, ours: onset yes, bpm 173 |
| 19.53 | #42 | +29 | 16 | +0.5 | -0.0 | +1.4 | +1.4 | on beat (r16), no onset, mid jumps, high jumps, ours: onset yes, bpm 173 |
| 30.07 | #65 | -50 | 1 | +0.1 | -0.0 | -0.1 | -0.2 | on beat (r1), no onset, ours: onset yes, bpm 117 |
| 33.40 | #72 | +33 | 2 | +1.1 | +0.0 | -0.7 | -0.9 | on beat (r2), onset, looks like a cut, ours: onset yes, bpm 171 |
| 34.07 | #73 | +166 | 1 | +0.4 | -0.2 | -1.0 | -0.5 | off-beat (+0.36 beat from r1), no onset, mid drops, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 172 |
| 34.67 | #75 | -163 | 1 | +1.6 | -0.0 | +0.4 | +0.7 | STROBE to 35.13s: 3 flashes every 0.23s = 0.50 beat (≈ 0.5 beat within the ±0.14-beat resolution of 15 fps), starts off beat r1, hard onset, ours: onset yes, bpm 173 |
| 36.07 | #78 | -156 | 4 | +1.1 | -0.1 | -0.1 | -0.8 | off-beat (-0.34 beat from r4), onset, looks like a cut, ours: onset yes, bpm 174 |
| 36.47 | #79 | -198 | 1 | +0.8 | -0.0 | -0.7 | +0.6 | off-beat (-0.43 beat from r1), onset, ours: onset yes, bpm 174 |
| 37.20 | #80 | +71 | 2 | +1.1 | -0.0 | +0.4 | +0.3 | on beat (r2), onset, looks like a cut, ours: onset yes, bpm 173 |
| 38.07 | #82 | +9 | 8 | +0.6 | -0.0 | +0.5 | +0.2 | on beat (r8), no onset, looks like a cut, ours: onset no, bpm 174 |
| 38.53 | #83 | +11 | 1 | +0.5 | +0.2 | -0.0 | -0.2 | on beat (r1), no onset, looks like a cut, ours: onset no, bpm 174 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #2 (r8, 1.02s): sat -0.8σ, zoom -1.8σ, abszoom +1.8σ
- beat #6 (r4, 2.88s): bright +1.4σ, sat +2.6σ, act +1.3σ, abszoom -3.0σ, rot -1.7σ
- beat #18 (r8, 8.41s): act -1.0σ
- beat #30 (r4, 13.98s): act +1.0σ
- beat #42 (r16, 19.50s): bright -1.4σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #2 | 1.02 | 8 | +2.8 | +1.6 | +0.3 | -1.2 | -0.6 | yes | 117 |
| #6 | 2.88 | 4 | +3.3 | +1.5 | +0.6 | +1.8 | -0.2 | yes | 174 |
| #10 | 4.71 | 16 | +0.6 | +1.5 | +0.1 | +0.7 | +0.8 | yes | 173 |
| #14 | 6.57 | 4 | +1.4 | +1.6 | +0.3 | +1.5 | +2.9 | yes | 173 |
| #18 | 8.41 | 8 | +4.2 | +1.5 | +0.4 | +0.3 | -0.4 | yes | 173 |
| #22 | 10.26 | 4 | +1.9 | +1.2 | +0.6 | -1.0 | -0.8 | yes | 173 |
| #23 S | 10.73 | 1 | +3.2 | +0.9 | +0.7 | -1.1 | -0.8 | yes | 173 |
| #26 | 12.14 | 16 | +0.8 | -0.4 | -0.5 | -1.0 | -0.6 | yes | 173 |
| #30 | 13.98 | 4 | +0.2 | -0.6 | -0.1 | -0.1 | +0.0 | yes | 173 |
| #34 | 15.84 | 8 | +0.4 | -0.6 | -0.4 | +1.8 | +3.8 | yes | 173 |
| #38 | 17.65 | 4 | +4.3 | +0.5 | +0.1 | +0.9 | +1.2 | yes | 142 |
| #40 S | 18.58 | 2 | +3.8 | -0.7 | +0.7 | +0.8 | +0.5 | yes | 173 |
| #42 | 19.50 | 16 | +0.5 | -0.8 | -0.4 | +2.8 | +2.2 | yes | 173 |
| #46 | 21.36 | 4 | +0.1 | -0.8 | -0.3 | -0.9 | -0.1 | yes | 173 |
| #50 | 23.20 | 8 | +2.5 | -0.7 | -0.8 | -0.3 | +0.7 | yes | 172 |
| #51 S | 23.64 | 1 | +0.1 | -0.2 | +0.0 | -0.4 | +0.4 | yes | 128 |
| #54 | 25.01 | 4 | +5.4 | +0.7 | -0.2 | -0.7 | +0.9 | yes | 158 |
| #55 S | 25.50 | 1 | +0.9 | -0.3 | +0.8 | -0.7 | +0.3 | no | 120 |
| #58 | 26.89 | 16 | +0.6 | -0.7 | -0.4 | -0.7 | +1.2 | yes | 166 |
| #62 | 28.75 | 4 | -0.0 | -0.8 | -0.1 | -0.1 | +0.2 | yes | 166 |
| #66 | 30.58 | 8 | +1.3 | -0.8 | -0.2 | -0.1 | +1.2 | yes | 118 |
| #67 S | 31.02 | 1 | +0.1 | -0.6 | +0.1 | -0.1 | -0.3 | yes | 118 |
| #70 | 32.42 | 4 | +2.6 | -0.0 | +0.3 | -1.1 | -0.5 | yes | 140 |
| #74 | 34.37 | 16 | +0.9 | -0.8 | +0.2 | +1.1 | +0.3 | yes | 172 |
| #78 | 36.22 | 4 | +1.1 | -0.8 | +0.4 | +1.9 | +1.8 | no | 174 |
| #82 | 38.06 | 8 | +1.7 | -0.6 | +0.7 | +2.1 | +4.1 | no | 174 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 15 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/005.03/timing.png` … — burst 5.03–8.03s (continuous): transition at 6.53s (beat #14 r4, novelty 4.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.57/timing.png` … — burst 6.57–9.57s (continuous): transition at 8.07s (beat #17 r1, novelty 2.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/014.57/timing.png` … — burst 14.57–17.57s (continuous): transition at 16.07s (beat #34 r8, novelty 6.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/016.57/timing.png` … — burst 16.57–19.57s (continuous): transition at 18.07s (beat #39 r1, novelty 5.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/028.57/timing.png` … — burst 28.57–31.57s (continuous): transition at 30.07s (beat #65 r1, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/032.57/timing.png` … — burst 32.57–35.57s (continuous): transition at 34.07s (beat #73 r1, novelty 6.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/034.42/timing.png` … — burst 34.42–37.42s (continuous): strobe 34.67–35.13s, flashes every 0.23s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/036.57/timing.png` … — burst 36.57–39.57s (continuous): transition at 38.07s (beat #82 r8, novelty 5.7). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py alt-wings --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
