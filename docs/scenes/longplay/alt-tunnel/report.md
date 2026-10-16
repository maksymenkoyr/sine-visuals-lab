# ref bundle: alt-tunnel

`tools/.cache/refs/_downloads/kMJVNerOtRI.mp4` — 380.0+40.0s. tempo **129.2 bpm** (beat 0.464s), 65 beats, phrase phase = beat 0 (estimated, margin 0.15σ); sections at beats 6, 18, 30.
Ours heard through `spectrum`: 4786 probe samples, 292 onsets vs the reference's 280.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- activity pops harder on bar/phrase beats (z +0.52 on rank ≥4 vs +0.02 on rank ≤2) — ours: onset fires on 16/17 of those beats
- brightness reacts most at phrase starts (rank 16 z +0.44 vs rank 4 -0.12) — ours: onset fires on 5/5 of those beats
- zoom moves against rms (r -0.20, +466 ms)
- abszoom follows high (r +0.22, no lag)
- absrot follows high (r +0.22, no lag)
- CUTS at 30 fps: 60 hard cuts in 40 s, densest second 6 cuts at 6s; holds between cuts 67–5533 ms (median 300); 84 fades over 1–2 frames (33–67 ms, median 1) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 4 strobe stretch(es), flashes every 0.44 s ≈ 0.96 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps); 0/4 start on a beat, at t 4.5, 14.1, 25.7, 33.9
- 19 single transitions: 2 on a beat with an onset, 11 off-beat with no onset (timer/scripted) — ours: onset fired at 14/19 of them
- picture changes regime at 0/3 audio section boundaries — ours: `section` shows no rise near any of them
- brightness flashes on onsets: rises z +0.40 in ~533 ms, settles within one frame (30 strong onsets averaged)
- activity does not flash on onsets (rise z +0.29 over 30 strong onsets)
- activity is pulsed, peaking on the off-beat (contrast 1.24σ across the beat)
- brightness is pulsed, peaking on the off-beat (contrast 1.27σ across the beat)
- zoom speed is pulsed, peaking at phase 0.25 (contrast 1.16σ across the beat)
- zooms in continuously (+1.908 log-scale/s, i.e. ×6.74 per second)
- rotates clockwise continuously (-126.9°/s)
- ours: tempo at ×1 for 100% of the clip, ×½ 0%, ×2 0%, elsewhere 0% (median 130.0 vs reference 129.2); our onset lands within 60 ms of 92% of the reference's onsets, and 89% of ours sit on one of theirs; lag +19 ms ±15

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 70% of the clip, 29.40s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 15 lit objects on 1280×720 (lit floor 0.18, lit 0.2% of pixels): 11 bar, 2 panel, 1 blob, 1 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-2.05 over 8 substantial objects: 1.167 half-heights at r 0.3, 0.122 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → 0.343, r>1 → 0.279
- rings at r ≈ 0.84 (×10); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 1.5 px, halo/core 0.05 at 4 px; core lum 0.27, ground lum 0.000
- hues (by lit area): red 0° 96%; ground `#000000`, centre/edge ground brightness 0.44
- flow (48 object tracks, 8% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^2.30 (a fly-through along the axis) 0.01 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:—, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 5.14 at r≥0.45; 28% of elongated objects lie along the radial direction

### Regime 2 — 15% of the clip, 33.47s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 32 lit objects on 1280×720 (lit floor 0.18, lit 0.2% of pixels): 28 bar, 2 blob, 2 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.11 over 16 substantial objects: 0.208 half-heights at r 0.3, 0.234 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.267, r0.3-0.6 → 0.339, r0.6-1.0 → 0.258, r>1 → 0.022
- rings at r ≈ 0.19 (×5), 0.75 (×16); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 8.9 px, halo/core 0.24 at 4 px; core lum 0.19, ground lum 0.002
- hues (by lit area): red 0° 100%; ground `#020000`, centre/edge ground brightness 6.65
- flow (53 object tracks, 0% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.31 (not a zoom) 0.00 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 51.5 at r<0.45 vs 28.0 at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 3 — 9% of the clip, 13.20s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 40 lit objects on 1280×720 (lit floor 0.18, lit 5.0% of pixels): 33 bar, 4 blob, 2 panel, 1 disc; outlines 5%, fills 95%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.28 over 20 substantial objects: 0.393 half-heights at r 0.3, 0.096 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 45.671, r0.3-0.6 → 3.262, r0.6-1.0 → 0.062, r>1 → 0.097
- rings at r ≈ 0.17 (×3), 0.47 (×8), 1.50 (×14); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 6.7 px at r<0.45, None px at r≥0.45; glow e-fold 6.0 px, halo/core 0.16 at 4 px; core lum 0.68, ground lum 0.000
- hues (by lit area): yellow 60° 56%, orange 30° 40%; ground `#000000`, centre/edge ground brightness 0.04
- flow (45 object tracks, 4% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.60 (not a zoom) 0.00 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 8.16 at r<0.45 vs 9.07 at r≥0.45; 24% of elongated objects lie along the radial direction

### Regime 4 — 4% of the clip, 22.80s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 58 lit objects on 1280×720 (lit floor 0.18, lit 14.1% of pixels): 46 bar, 6 blob, 3 frame, 2 disc, 1 panel; outlines 7%, fills 93%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.02 over 27 substantial objects: 0.271 half-heights at r 0.3, 0.265 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 4.064, r0.3-0.6 → 1.505, r0.6-1.0 → 0.839, r>1 → 0.549
- rings at r ≈ 0.09 (×4), 0.17 (×3), 0.47 (×9), 0.95 (×10), 1.50 (×18); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 6.7 px at r<0.45, None px at r≥0.45; glow e-fold 6.8 px, halo/core 0.21 at 4 px; core lum 0.69, ground lum 0.000
- hues (by lit area): yellow 60° 56%, orange 30° 41%; ground `#000000`, centre/edge ground brightness 1.76
- flow (41 object tracks, 12% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.07 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 6.42 at r<0.45 vs 5.5 at r≥0.45; 9% of elongated objects lie along the radial direction

### Regime 5 — 2% of the clip, 24.13s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 43 lit objects on 1280×720 (lit floor 0.18, lit 14.8% of pixels): 20 bar, 14 blob, 4 disc, 3 frame, 2 panel; outlines 9%, fills 91%; 75% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.06 over 8 gates: 0.150 half-heights at r 0.3, 0.159 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 12.652, r0.3-0.6 → 1.270, r0.6-1.0 → 0.151, r>1 → —
- rings at r ≈ 0.24 (×8), 0.34 (×6), 0.53 (×9), 0.84 (×9); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 5.7 px at r<0.45, None px at r≥0.45; glow e-fold 6.3 px, halo/core 0.21 at 4 px; core lum 0.70, ground lum 0.000
- hues (by lit area): yellow 60° 95%; ground `#000000`, centre/edge ground brightness 6.22
- flow (42 object tracks, 24% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.30 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:-0.02, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.95 at r<0.45 vs 2.85 at r≥0.45; 18% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **4.22–7.22s** — strobe 4.47–5.80s, flashes every 0.44s; also transition at 6.73s (beat #3 r1, novelty 6.3); also transition at 6.33s (beat #2 r2, novelty 3.4); also phrase start, beat #0 (5.48s) — 9 hard cuts, holds 67–767 ms (median 133); 6 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.30 — `bursts/004.22/timing.png` (every frame), `bursts/004.22/detail.png` (large), `bursts/004.22/motion.png` (paths / skeleton / t±1 in RGB)
- **9.83–12.83s** — transition at 11.33s (beat #13 r1, novelty 2.6); also transition at 12.27s (beat #15 r1, novelty 1.6) — no hard cut; 9 fades over 1–1 frames (33–33 ms, median 1); brightness 0.00–0.08 — `bursts/009.83/timing.png` (every frame), `bursts/009.83/detail.png` (large), `bursts/009.83/motion.png` (paths / skeleton / t±1 in RGB)
- **11.70–14.70s** — transition at 13.20s (beat #17 r1, novelty 2.6); also phrase start, beat #16 (12.84s) — 4 hard cuts, holds 100–933 ms (median 367); 13 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.16 — `bursts/011.70/timing.png` (every frame), `bursts/011.70/detail.png` (large), `bursts/011.70/motion.png` (paths / skeleton / t±1 in RGB)
- **13.88–16.88s** — strobe 14.13–15.00s, flashes every 0.43s; also transition at 15.93s (beat #23 r1, novelty 5.5); also transition at 16.87s (beat #25 r1, novelty 2.3); also transition at 15.53s (beat #22 r2, novelty 1.6) — 9 hard cuts, holds 67–800 ms (median 250); 6 fades over 1–1 frames (33–33 ms, median 1); brightness 0.00–0.28 — `bursts/013.88/timing.png` (every frame), `bursts/013.88/detail.png` (large), `bursts/013.88/motion.png` (paths / skeleton / t±1 in RGB)
- **20.90–23.90s** — transition at 22.40s (beat #37 r1, novelty 5.2); also transition at 22.87s (beat #38 r2, novelty 3.5); also transition at 23.80s (beat #40 r8, novelty 2.7); also phrase start, beat #32 (20.22s) — 5 hard cuts, holds 67–900 ms (median 250); 9 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.15 — `bursts/020.90/timing.png` (every frame), `bursts/020.90/detail.png` (large), `bursts/020.90/motion.png` (paths / skeleton / t±1 in RGB)
- **22.70–25.70s** — transition at 24.20s (beat #41 r1, novelty 4.7); also transition at 25.13s (beat #43 r1, novelty 3.2) — 7 hard cuts, holds 67–900 ms (median 433); 10 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.15 — `bursts/022.70/timing.png` (every frame), `bursts/022.70/detail.png` (large), `bursts/022.70/motion.png` (paths / skeleton / t±1 in RGB)
- **25.42–28.42s** — strobe 25.67–27.93s, flashes every 0.45s — 11 hard cuts, holds 67–433 ms (median 233); 9 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.28 — `bursts/025.42/timing.png` (every frame), `bursts/025.42/detail.png` (large), `bursts/025.42/motion.png` (paths / skeleton / t±1 in RGB)
- **33.68–36.68s** — strobe 33.93–37.07s, flashes every 0.45s; also phrase start, beat #64 (35.02s) — 8 hard cuts, holds 67–467 ms (median 367); 11 fades over 1–2 frames (33–67 ms, median 1); brightness 0.00–0.29 — `bursts/033.68/timing.png` (every frame), `bursts/033.68/detail.png` (large), `bursts/033.68/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#000000`×0.91 `#be0b04`×0.04 `#d0b619`×0.02 `#d1d0c9`×0.01 `#620808`×0.01
- mirror symmetry, ~1 axis (r 0.72); centre brightness 0.04 vs edge 0.03; mean brightness 0.03, dark frames 89%; saturation 0.08
- motion: zoom mean +1.908 (|zoom| 2.213) log-scale/s, rotation mean -126.9° (|rot| 141.6°)/s, frame-to-frame activity 0.037

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 5 | +0.91 | +0.59 | +0.44 | +0.50 | +0.87 | 5/5 |
| 8 | 4 | +0.50 | +0.52 | +0.64 | +0.85 | +0.76 | 4/4 |
| 4 | 8 | +0.15 | +0.23 | -0.12 | +0.85 | +0.87 | 7/8 |
| 2 | 16 | +0.02 | +0.09 | +0.02 | +0.85 | +0.87 | 16/16 |
| 1 | 32 | +0.01 | +0.22 | -0.07 | +0.85 | +0.85 | 32/32 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- abszoom ~ high: r +0.22 at +0 ms
- absrot ~ high: r +0.22 at +0 ms
- abszoom ~ rms: r +0.21 at +266 ms
- zoom ~ rms: r -0.20 at +466 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 2.13 | #0 | -3347 | 16 | -0.1 | -0.0 | -1.2 | +0.8 | off-beat (-7.21 beat from r16), no onset, mid drops, → probably not audio-driven, ours: onset yes, bpm 128 |
| 4.47 | #0 | -1013 | 16 | +0.8 | -0.4 | +1.9 | +1.8 | STROBE to 5.80s: 4 flashes every 0.44s = 0.96 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps), starts off beat r16, onset, mid jumps, high jumps, ours: onset no, bpm 129 |
| 6.33 | #2 | -52 | 2 | +0.8 | +0.5 | +0.5 | +0.4 | on beat (r2), onset, ours: onset yes, bpm 129 |
| 6.73 | #3 | -117 | 1 | -0.5 | +0.3 | -2.3 | -0.1 | off-beat (-0.25 beat from r1), no onset, mid drops, → probably not audio-driven, ours: onset no, bpm 129 |
| 7.67 | #5 | -112 | 1 | -0.4 | +0.3 | -1.1 | +0.1 | off-beat (-0.24 beat from r1), no onset, mid drops, → probably not audio-driven, ours: onset no, bpm 130 |
| 8.60 | #7 | -84 | 1 | -0.4 | -0.0 | -1.3 | +2.8 | on beat (r1), no onset, mid drops, high jumps, ours: onset no, bpm 130 |
| 9.53 | #9 | -80 | 1 | -0.2 | -0.2 | -0.9 | +3.3 | on beat (r1), no onset, high jumps, ours: onset yes, bpm 130 |
| 11.33 | #13 | -137 | 1 | -0.3 | +0.1 | -0.4 | -1.5 | off-beat (-0.30 beat from r1), no onset, high drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 12.27 | #15 | -110 | 1 | -0.6 | +0.0 | -2.3 | -0.9 | off-beat (-0.24 beat from r1), no onset, mid drops, → probably not audio-driven, ours: onset no, bpm 130 |
| 13.20 | #17 | -105 | 1 | +0.3 | +0.0 | -2.4 | -0.3 | off-beat (-0.23 beat from r1), no onset, mid drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 14.13 | #19 | -100 | 1 | +0.1 | -0.1 | -0.8 | +1.1 | STROBE to 15.00s: 3 flashes every 0.43s = 0.93 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps), starts off beat r1, no onset, high jumps, ours: onset no, bpm 130 |
| 15.53 | #22 | -70 | 2 | +2.1 | -0.3 | -0.6 | +1.2 | on beat (r2), hard onset, high jumps, ours: onset yes, bpm 130 |
| 15.93 | #23 | -135 | 1 | +1.6 | +0.3 | -1.1 | -1.5 | off-beat (-0.29 beat from r1), hard onset, mid drops, high drops, ours: onset yes, bpm 130 |
| 16.87 | #25 | -130 | 1 | -0.2 | +0.3 | -2.3 | -2.8 | off-beat (-0.28 beat from r1), no onset, mid drops, high drops, → probably not audio-driven, ours: onset no, bpm 130 |
| 22.40 | #37 | -147 | 1 | +0.6 | +0.1 | +0.1 | -2.1 | off-beat (-0.32 beat from r1), no onset, high drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 22.87 | #38 | -144 | 2 | -0.1 | +0.1 | +0.8 | -2.1 | off-beat (-0.31 beat from r2), no onset, high drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 23.80 | #40 | -140 | 8 | -0.1 | +0.1 | -0.9 | -2.1 | off-beat (-0.30 beat from r8), no onset, high drops, → probably not audio-driven, ours: onset yes, bpm 130 |
| 24.20 | #41 | -204 | 1 | -0.3 | +0.6 | -0.9 | +0.1 | off-beat (-0.44 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 130 |
| 25.13 | #43 | -176 | 1 | +2.4 | +0.6 | -1.2 | +0.8 | off-beat (-0.38 beat from r1), hard onset, mid drops, ours: onset yes, bpm 130 |
| 25.67 | #44 | -107 | 4 | +1.0 | +0.2 | -1.1 | +0.4 | STROBE to 27.93s: 6 flashes every 0.45s = 0.98 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps), starts off beat r4, onset, mid drops, ours: onset yes, bpm 130 |
| 31.60 | #57 | -188 | 1 | +1.6 | +0.5 | -0.7 | -0.4 | off-beat (-0.41 beat from r1), hard onset, ours: onset yes, bpm 130 |
| 32.53 | #59 | -160 | 1 | +1.1 | +0.5 | -1.2 | -0.6 | off-beat (-0.35 beat from r1), onset, mid drops, ours: onset yes, bpm 130 |
| 33.93 | #62 | -154 | 2 | +0.8 | +0.3 | +0.5 | -1.6 | STROBE to 37.07s: 8 flashes every 0.45s = 0.96 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps), starts off beat r2, onset, high drops, ours: onset yes, bpm 130 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 7.31s): bright -0.8σ
- beat #48 (r16, 27.63s): act -0.8σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #0 | 5.48 | 16 | +0.2 | +0.2 | -0.8 | +1.6 | +0.8 | yes | 129 |
| #4 | 7.31 | 4 | +0.1 | +0.3 | -0.1 | +1.4 | +1.8 | yes | 129 |
| #6 S | 8.22 | 2 | -0.5 | +0.3 | -0.2 | +0.1 | +1.1 | yes | 130 |
| #8 | 9.15 | 8 | +0.5 | +0.4 | -0.1 | +0.2 | -0.1 | yes | 130 |
| #12 | 11.01 | 4 | +3.9 | +0.1 | -0.5 | +0.3 | +0.1 | no | 130 |
| #16 | 12.84 | 16 | +1.7 | +0.2 | -0.6 | +0.5 | +0.5 | yes | 130 |
| #18 S | 13.77 | 2 | +0.6 | +0.3 | +0.7 | +0.1 | +0.5 | yes | 130 |
| #20 | 14.70 | 4 | +1.1 | +0.3 | +0.3 | +2.4 | +1.2 | yes | 130 |
| #24 | 16.53 | 8 | +3.2 | +0.4 | -0.5 | -0.6 | -0.3 | yes | 130 |
| #28 | 18.39 | 4 | +3.6 | +0.3 | -0.2 | -0.4 | -0.5 | yes | 130 |
| #30 S | 19.32 | 2 | +1.4 | +0.2 | -0.4 | -0.2 | -0.3 | yes | 130 |
| #32 | 20.22 | 16 | +2.1 | +0.4 | +0.2 | -0.1 | -0.0 | yes | 130 |
| #36 | 22.08 | 4 | +1.3 | +0.4 | +0.2 | -0.3 | -0.3 | yes | 130 |
| #40 | 23.94 | 8 | +2.9 | +0.1 | +0.4 | +3.3 | +3.2 | yes | 130 |
| #44 | 25.77 | 4 | +1.2 | +0.2 | +0.2 | +2.3 | +1.7 | yes | 130 |
| #48 | 27.63 | 16 | +0.7 | +0.3 | +0.2 | +0.8 | +1.9 | yes | 130 |
| #52 | 29.47 | 4 | +2.9 | +0.3 | +0.2 | -0.3 | +0.0 | yes | 130 |
| #56 | 31.32 | 8 | +2.3 | +0.3 | +0.7 | -0.4 | -0.3 | yes | 130 |
| #60 | 33.16 | 4 | +1.2 | +0.4 | +0.7 | +1.4 | +1.3 | yes | 130 |
| #64 | 35.02 | 16 | +0.6 | +0.3 | +0.2 | +3.5 | +3.0 | yes | 130 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 14 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/004.22/timing.png` … — burst 4.22–7.22s (cuts): strobe 4.47–5.80s, flashes every 0.44s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/009.83/timing.png` … — burst 9.83–12.83s (fades): transition at 11.33s (beat #13 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.70/timing.png` … — burst 11.70–14.70s (cuts): transition at 13.20s (beat #17 r1, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/013.88/timing.png` … — burst 13.88–16.88s (cuts): strobe 14.13–15.00s, flashes every 0.43s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.90/timing.png` … — burst 20.90–23.90s (cuts): transition at 22.40s (beat #37 r1, novelty 5.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.70/timing.png` … — burst 22.70–25.70s (cuts): transition at 24.20s (beat #41 r1, novelty 4.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/025.42/timing.png` … — burst 25.42–28.42s (cuts): strobe 25.67–27.93s, flashes every 0.45s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/033.68/timing.png` … — burst 33.68–36.68s (cuts): strobe 33.93–37.07s, flashes every 0.45s. timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py alt-tunnel --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png` ← the rank that reacts hardest
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
