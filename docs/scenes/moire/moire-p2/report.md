# ref bundle: moire-p2

`tools/.cache/refs/_downloads/oiIxQ_JxbZo.mp4` — 55.0+81.0s. tempo **86.1 bpm** (beat 0.697s), 111 beats, phrase phase = beat 15 (estimated, margin 1.37σ); sections at beats 32, 40, 66, 68, 80, 87, 97.
Ours heard through `spectrum`: 9691 probe samples, 482 onsets vs the reference's 317.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- no beat-rank preference: the picture reacts about the same on every beat (activity z +0.22..+0.59)
- absrot follows rms (r +0.32, +200 ms)
- activity follows low (r +0.22, -266 ms)
- brightness moves against rms (r -0.45, +200 ms)
- CUTS at 30 fps: 574 hard cuts in 81 s, densest second 21 cuts at 17s; holds between cuts 33–1733 ms (median 67) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 6 strobe stretch(es), flashes every 0.49 s ≈ 0.71 beat (no simple fraction of a beat → own timer); 3/6 start on a beat, at t 10.3, 13.0, 14.7, 19.9, 30.7, 54.7
- 39 single transitions: 9 on a beat with an onset, 19 off-beat with no onset (timer/scripted) — ours: onset fired at 26/38 of them
- picture changes regime at 2/7 audio section boundaries — ours: `section` shows no rise near any of them
- brightness does not flash on onsets (rise z +0.09 over 41 strong onsets)
- activity does not flash on onsets (rise z +0.23 over 41 strong onsets)
- activity is continuous across the beat (contrast 0.22σ)
- brightness is continuous across the beat (contrast 0.08σ)
- zoom speed is continuous across the beat (contrast 0.22σ)
- ours: tempo at ×1 for 0% of the clip, ×½ 0%, ×2 45%, elsewhere 55% (median 163.2 vs reference 86.1); our onset lands within 60 ms of 82% of the reference's onsets, and 54% of ours sit on one of theirs; lag -17 ms ±22

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 51% of the clip, 33.00s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 323 lit objects on 1280×720 (lit floor 0.27, lit 29.9% of pixels): 321 bar, 2 blob; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.16 over 163 substantial objects: 5.212 half-heights at r 0.3, 1.458 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → 2.600, r>1 → 1.328
- rings at r ≈ 0.75 (×76), 1.19 (×110), 1.68 (×117); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.22 at 4 px; core lum 0.77, ground lum 0.000
- hues (by lit area): white 0° 100%; ground `#000000`, centre/edge ground brightness 1.00
- flow (753 object tracks, 51% moving outward → mixed directions): radial speed ∝ r^-0.17 (not a zoom) 0.90 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.38, 0.39:-1.19, 0.61:+0.71, 0.87:+0.28, 1.22:-0.33; rotation -0.3°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 12.75 at r≥0.45; 66% of elongated objects lie along the radial direction

### Regime 2 — 26% of the clip, 6.67s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 90 lit objects on 1280×720 (lit floor 0.27, lit 42.9% of pixels): 90 bar; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.00 over 45 substantial objects: 3.498 half-heights at r 0.3, 3.489 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 3.606, r0.3-0.6 → 3.589, r0.6-1.0 → 3.538, r>1 → 3.165
- rings at r ≈ 0.84 (×24); 2-fold (score 0.82); on the axes 1%, on the diagonals 93%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.32 at 4 px; core lum 0.88, ground lum 0.000
- hues (by lit area): white 0° 100%; ground `#000000`, centre/edge ground brightness 1.00
- flow (334 object tracks, 49% moving outward → mixed directions): radial speed ∝ r^-0.87 (not a zoom) 0.09 half-heights/s at r 0.5; by r → 0.07:+1.06, 0.21:-0.02, 0.39:-0.01, 0.61:+0.00, 0.87:+0.00, 1.22:-0.24; rotation -1.1°/s (+ = counter-clockwise on screen)
- streak: median elongation 210.19 at r<0.45 vs 190.83 at r≥0.45; 2% of elongated objects lie along the radial direction

### Regime 3 — 12% of the clip, 76.00s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.05, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.840
- hues (by lit area): ; ground `#d6d6d6`, centre/edge ground brightness 1.14
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 4 — 8% of the clip, 67.47s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 54 lit objects on 1280×720 (lit floor 0.28, lit 26.1% of pixels): 54 bar; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.11 over 27 substantial objects: 3.888 half-heights at r 0.3, 3.434 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 3.580, r0.3-0.6 → 3.558, r0.6-1.0 → 3.545, r>1 → 20.009
- rings at r ≈ 0.17 (×13), 0.84 (×12), 1.34 (×3); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -16.34 at 4 px; core lum 0.88, ground lum 0.933
- hues (by lit area): white 0° 100%; ground `#eeeeee`, centre/edge ground brightness 1.00
- flow (171 object tracks, 37% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.30 (not a zoom) 0.29 half-heights/s at r 0.5; by r → 0.07:+0.70, 0.21:-0.09, 0.39:-0.10, 0.61:-0.11, 0.87:-0.05, 1.22:-0.67; rotation -18.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 80.19 at r<0.45 vs 75.81 at r≥0.45; 20% of elongated objects lie along the radial direction

### Regime 5 — 3% of the clip, 49.60s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 1010 lit objects on 1280×720 (lit floor 0.27, lit 8.2% of pixels): 996 bar, 14 blob; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.60 over 505 substantial objects: 0.269 half-heights at r 0.3, 0.139 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.077, r0.3-0.6 → 0.186, r0.6-1.0 → 0.212, r>1 → 0.147
- rings at r ≈ 1.68 (×459); 2-fold (score 0.87); on the axes 52%, on the diagonals 13%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.01 at 4 px; core lum 0.61, ground lum 0.148
- hues (by lit area): white 0° 100%; ground `#252525`, centre/edge ground brightness 1.00
- flow (3763 object tracks, 50% moving outward → mixed directions): radial speed ∝ r^0.27 (not a zoom) 0.87 half-heights/s at r 0.5; by r → 0.07:+0.30, 0.21:+0.33, 0.39:+0.64, 0.61:+0.48, 0.87:+0.01, 1.22:-0.03; rotation -0.6°/s (+ = counter-clockwise on screen)
- streak: median elongation 15.15 at r<0.45 vs 16.25 at r≥0.45; 62% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.27s (beat #0 r1, novelty 5.5) — 35 hard cuts, holds 33–1100 ms (median 33); brightness 0.10–0.94 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **10.08–13.08s** — strobe 10.33–11.93s, flashes every 0.53s — 68 hard cuts, holds 33–100 ms (median 33); brightness 0.23–0.67 — `bursts/010.08/timing.png` (every frame), `bursts/010.08/detail.png` (large), `bursts/010.08/motion.png` (paths / skeleton / t±1 in RGB)
- **12.75–15.75s** — strobe 13.00–13.87s, flashes every 0.43s — 65 hard cuts, holds 33–133 ms (median 33); brightness 0.22–0.68 — `bursts/012.75/timing.png` (every frame), `bursts/012.75/detail.png` (large), `bursts/012.75/motion.png` (paths / skeleton / t±1 in RGB)
- **14.42–17.42s** — strobe 14.67–16.27s, flashes every 0.53s; also transition at 17.13s (beat #19 r4, novelty 2.5); also phrase start, beat #15 (14.23s) — 69 hard cuts, holds 33–100 ms (median 33); brightness 0.23–0.67 — `bursts/014.42/timing.png` (every frame), `bursts/014.42/detail.png` (large), `bursts/014.42/motion.png` (paths / skeleton / t±1 in RGB)
- **17.50–20.50s** — transition at 19.00s (beat #22 r1, novelty 4.2); also transition at 18.20s (beat #21 r2, novelty 3.9) — 65 hard cuts, holds 33–167 ms (median 33); brightness 0.21–0.64 — `bursts/017.50/timing.png` (every frame), `bursts/017.50/detail.png` (large), `bursts/017.50/motion.png` (paths / skeleton / t±1 in RGB)
- **19.62–22.62s** — strobe 19.87–21.20s, flashes every 0.44s; also transition at 22.40s (beat #27 r4, novelty 4.2); also transition at 22.07s (beat #26 r1, novelty 2.8) — 59 hard cuts, holds 33–167 ms (median 33); brightness 0.21–0.62 — `bursts/019.62/timing.png` (every frame), `bursts/019.62/detail.png` (large), `bursts/019.62/motion.png` (paths / skeleton / t±1 in RGB)
- **30.48–33.48s** — strobe 30.73–31.87s, flashes every 0.57s; also transition at 33.20s (beat #42 r1, novelty 1.6) — 51 hard cuts, holds 33–200 ms (median 33); brightness 0.23–0.53 — `bursts/030.48/timing.png` (every frame), `bursts/030.48/detail.png` (large), `bursts/030.48/motion.png` (paths / skeleton / t±1 in RGB)
- **54.42–57.42s** — strobe 54.67–56.40s, flashes every 0.43s; also transition at 57.40s (beat #77 r2, novelty 2.1) — 39 hard cuts, holds 33–400 ms (median 50); brightness 0.10–0.48 — `bursts/054.42/timing.png` (every frame), `bursts/054.42/detail.png` (large), `bursts/054.42/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#282828`×0.41 `#e8e8e8`×0.23 `#535353`×0.14 `#818181`×0.12 `#b4b4b4`×0.11
- mirror symmetry, ~1 axis (r 0.62); centre brightness 0.44 vs edge 0.45; mean brightness 0.45, dark frames 0%; saturation 0.00
- motion: zoom mean -0.040 (|zoom| 1.363) log-scale/s, rotation mean -0.4° (|rot| 89.9°)/s, frame-to-frame activity 0.124

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 6 | +0.59 | +0.79 | +0.06 | +0.63 | +0.74 | 4/6 |
| 8 | 7 | +0.58 | +0.80 | +0.26 | +0.84 | +0.78 | 6/7 |
| 4 | 14 | +0.22 | +0.97 | +0.12 | +0.76 | +0.58 | 12/14 |
| 2 | 28 | +0.45 | +0.93 | +0.24 | +0.69 | +0.58 | 22/28 |
| 1 | 56 | +0.49 | +0.66 | +0.20 | +0.80 | +0.72 | 41/56 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- brightness ~ rms: r -0.45 at +200 ms
- absrot ~ rms: r +0.32 at +200 ms
- activity ~ low: r +0.22 at -266 ms
- brightness ~ mid: r -0.22 at -133 ms
- brightness ~ high: r -0.22 at -66 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.27 | #0 | -3495 | 1 | -0.3 | -1.1 | +0.1 | -0.4 | off-beat (-5.02 beat from r1), no onset, low drops, looks like a cut, → probably not audio-driven |
| 5.73 | #3 | -118 | 4 | +0.1 | -0.4 | +0.5 | -0.1 | off-beat (-0.17 beat from r4), no onset, → probably not audio-driven, ours: onset no, bpm 162 |
| 6.47 | #4 | -81 | 1 | +1.0 | -1.0 | +3.7 | +2.5 | on beat (r1), onset, low drops, mid jumps, high jumps, ours: onset yes, bpm 161 |
| 7.00 | #5 | -245 | 2 | +0.5 | -2.2 | +2.1 | +1.3 | off-beat (-0.35 beat from r2), no onset, low drops, mid jumps, high jumps, → probably not audio-driven, ours: onset no, bpm 161 |
| 7.87 | #6 | -75 | 1 | +4.0 | -1.2 | +2.8 | +2.6 | on beat (r1), hard onset, low drops, mid jumps, high jumps, ours: onset yes, bpm 161 |
| 8.60 | #7 | -38 | 8 | +0.5 | +3.1 | -1.5 | -2.9 | on beat (r8), no onset, low jumps, mid drops, high drops, ours: onset yes, bpm 161 |
| 9.40 | #8 | +66 | 1 | +6.3 | -0.9 | +1.6 | +0.7 | on beat (r1), hard onset, mid jumps, ours: onset yes, bpm 162 |
| 10.33 | #9 | +279 | 2 | +0.5 | +0.1 | -0.2 | -0.3 | STROBE to 11.93s: 4 flashes every 0.53s = 0.77 beat (no simple fraction of a beat → own timer), starts off beat r2, no onset, ours: onset no, bpm 162 |
| 13.00 | #13 | +183 | 2 | -0.3 | -0.8 | +0.3 | -0.3 | STROBE to 13.87s: 3 flashes every 0.43s = 0.62 beat (no simple fraction of a beat → own timer), starts off beat r2, no onset, ours: onset yes, bpm 163 |
| 14.67 | #16 | -241 | 1 | +1.0 | +1.9 | -2.0 | -1.5 | STROBE to 16.27s: 4 flashes every 0.53s = 0.77 beat (no simple fraction of a beat → own timer), starts off beat r1, onset, low jumps, mid drops, high drops, looks like a cut, ours: onset yes, bpm 161 |
| 17.13 | #19 | +136 | 4 | +0.5 | -0.5 | -1.6 | +0.4 | off-beat (+0.20 beat from r4), no onset, mid drops, → probably not audio-driven, ours: onset yes, bpm 162 |
| 18.20 | #21 | -121 | 2 | +0.4 | -2.2 | +1.2 | +0.7 | off-beat (-0.17 beat from r2), no onset, low drops, mid jumps, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 163 |
| 19.00 | #22 | -17 | 1 | +1.7 | -1.5 | +2.5 | +2.3 | on beat (r1), hard onset, low drops, mid jumps, high jumps, ours: onset no, bpm 163 |
| 19.87 | #23 | +60 | 8 | +1.9 | +2.6 | -2.1 | -2.4 | STROBE to 21.20s: 4 flashes every 0.44s = 0.64 beat (no simple fraction of a beat → own timer), starts on beat r8, hard onset, low jumps, mid drops, high drops, ours: onset no, bpm 163 |
| 22.07 | #26 | +170 | 1 | -0.2 | -0.4 | +0.4 | -0.4 | off-beat (+0.24 beat from r1), no onset, → probably not audio-driven, ours: onset no, bpm 151 |
| 22.40 | #27 | -193 | 4 | -0.5 | -0.3 | -0.1 | -0.3 | off-beat (-0.28 beat from r4), no onset, → probably not audio-driven, ours: onset yes, bpm 151 |
| 23.27 | #28 | -23 | 1 | +0.8 | -1.2 | +1.4 | +1.1 | on beat (r1), onset, low drops, mid jumps, high jumps, ours: onset yes, bpm 151 |
| 23.80 | #29 | -47 | 2 | +0.5 | -1.1 | +0.5 | +0.7 | on beat (r2), no onset, low drops, ours: onset yes, bpm 151 |
| 25.20 | #31 | -17 | 16 | -0.4 | +2.7 | -2.7 | -2.0 | on beat (r16), no onset, low jumps, mid drops, high drops, flash, ours: onset no, bpm 150 |
| 26.13 | #32 | +220 | 1 | +0.4 | +1.1 | -1.8 | -1.9 | off-beat (+0.32 beat from r1), no onset, low jumps, mid drops, high drops, section boundary, → probably not audio-driven, ours: onset yes, bpm 150 |
| 26.87 | #33 | +233 | 2 | +0.8 | -1.6 | +1.8 | +1.7 | off-beat (+0.34 beat from r2), onset, low drops, mid jumps, high jumps, ours: onset yes, bpm 150 |
| 28.20 | #35 | +174 | 4 | +0.4 | -0.6 | +1.7 | +1.9 | off-beat (+0.25 beat from r4), no onset, mid jumps, high jumps, → probably not audio-driven, ours: onset yes, bpm 150 |
| 29.40 | #37 | +27 | 2 | -0.4 | -1.0 | -1.6 | -2.1 | on beat (r2), no onset, mid drops, high drops, ours: onset no, bpm 150 |
| 29.80 | #38 | -293 | 1 | +1.4 | -1.5 | -0.8 | -0.4 | off-beat (-0.42 beat from r1), onset, low drops, ours: onset yes, bpm 166 |
| 30.73 | #39 | -80 | 8 | +0.1 | +2.6 | +0.2 | -0.9 | STROBE to 31.87s: 3 flashes every 0.57s = 0.81 beat (no simple fraction of a beat → own timer), starts on beat r8, no onset, low jumps, ours: onset yes, bpm 165 |
| 33.20 | #42 | +297 | 1 | +0.4 | -0.1 | -0.2 | +0.5 | off-beat (+0.43 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 144 |
| 34.47 | #44 | +171 | 1 | -0.4 | +0.4 | -0.6 | -0.6 | off-beat (+0.25 beat from r1), no onset, → probably not audio-driven, ours: onset no, bpm 144 |
| 35.00 | #45 | +8 | 2 | +1.1 | +0.4 | -0.7 | -0.7 | on beat (r2), onset, ours: onset yes, bpm 144 |
| 37.27 | #48 | +184 | 1 | -0.3 | +0.4 | +0.2 | -2.0 | off-beat (+0.26 beat from r1), no onset, high drops, → probably not audio-driven, ours: onset no, bpm 172 |
| 39.47 | #51 | +225 | 4 | +0.1 | -0.1 | +1.5 | +1.8 | off-beat (+0.32 beat from r4), no onset, mid jumps, high jumps, → probably not audio-driven, ours: onset yes, bpm 173 |
| 46.53 | #61 | +279 | 2 | +0.4 | -0.3 | +0.5 | -0.1 | off-beat (+0.40 beat from r2), no onset, looks like a cut, → probably not audio-driven, ours: onset no, bpm 146 |
| 48.07 | #64 | -277 | 1 | -0.3 | +0.1 | -0.8 | -1.5 | off-beat (-0.40 beat from r1), no onset, high drops, → probably not audio-driven, ours: onset yes, bpm 148 |
| 49.07 | #65 | +26 | 2 | -0.2 | +0.6 | -1.1 | -0.6 | on beat (r2), no onset, mid drops, ours: onset yes, bpm 121 |
| 50.87 | #68 | -240 | 1 | +0.6 | +0.2 | -0.5 | -1.7 | off-beat (-0.35 beat from r1), no onset, high drops, section boundary, → probably not audio-driven, ours: onset yes, bpm 121 |
| 51.20 | #68 | +93 | 1 | +3.2 | -0.1 | +0.9 | -0.1 | on beat (r1), hard onset, section boundary, ours: onset no, bpm 120 |
| 52.47 | #70 | -57 | 1 | +4.1 | -0.3 | +0.8 | +2.0 | on beat (r1), hard onset, high jumps, ours: onset yes, bpm 120 |
| 52.93 | #71 | -287 | 8 | +0.4 | +0.1 | +0.6 | +1.8 | off-beat (-0.41 beat from r8), no onset, high jumps, → probably not audio-driven, ours: onset yes, bpm 120 |
| 54.67 | #73 | +53 | 2 | +0.1 | +0.4 | -1.2 | -1.6 | STROBE to 56.40s: 5 flashes every 0.43s = 0.62 beat (no simple fraction of a beat → own timer), starts on beat r2, no onset, mid drops, high drops, blackout, ours: onset yes, bpm 172 |
| 57.40 | #77 | -255 | 2 | +1.7 | -0.2 | +0.3 | +1.1 | off-beat (-0.37 beat from r2), hard onset, high jumps, ours: onset yes, bpm 172 |
| 58.47 | #78 | +92 | 1 | +0.6 | +0.1 | -1.6 | -2.3 | on beat (r1), no onset, mid drops, high drops, ours: onset no, bpm 172 |
| 58.87 | #79 | -182 | 16 | +0.1 | -0.4 | +1.1 | +0.5 | off-beat (-0.26 beat from r16), no onset, mid jumps, → probably not audio-driven, ours: onset yes, bpm 172 |
| 59.73 | #80 | +12 | 1 | +1.2 | -0.2 | -0.0 | +0.2 | on beat (r1), onset, section boundary, ours: onset yes, bpm 173 |
| 60.60 | #81 | +158 | 2 | +0.0 | -0.1 | -0.1 | +0.1 | off-beat (+0.23 beat from r2), no onset, → probably not audio-driven, ours: onset no, bpm 174 |
| 61.80 | #83 | -35 | 4 | -0.2 | +0.4 | -0.3 | -0.2 | on beat (r4), no onset, ours: onset yes, bpm 176 |
| 63.53 | #86 | -368 | 1 | +6.0 | -0.1 | -0.1 | -0.2 | off-beat (-0.53 beat from r1), hard onset, ours: onset yes, bpm 174 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #67 (r4, 50.43s): act +0.9σ
- beat #79 (r16, 59.05s): abszoom -0.8σ

## Bar and phrase beats

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #3 | 5.85 | 4 | +0.6 | -0.1 | -0.2 | +0.8 | +1.8 | yes | 162 |
| #7 | 8.64 | 8 | +0.7 | -0.2 | -0.3 | +1.7 | +1.6 | yes | 161 |
| #11 | 11.42 | 4 | +0.3 | +0.1 | +0.2 | +2.0 | +3.5 | no | 162 |
| #15 | 14.23 | 16 | +0.9 | +0.0 | -0.9 | +1.2 | +2.7 | no | 162 |
| #19 | 17.00 | 4 | +1.0 | -0.4 | -0.0 | +1.0 | +2.6 | yes | 162 |
| #23 | 19.81 | 8 | +1.9 | -0.0 | -0.5 | +1.3 | +2.0 | no | 163 |
| #27 | 22.59 | 4 | +3.0 | -0.1 | -0.0 | +1.3 | +2.3 | yes | 151 |
| #31 | 25.22 | 16 | +0.9 | +0.1 | +0.5 | +1.5 | +2.9 | no | 150 |
| #32 S | 25.91 | 1 | +1.3 | +0.0 | +1.6 | +1.8 | +2.3 | yes | 150 |
| #35 | 28.03 | 4 | +0.4 | -0.2 | +0.2 | +0.8 | +1.1 | yes | 150 |
| #39 | 30.81 | 8 | +0.1 | +0.5 | -0.5 | +1.1 | +1.4 | yes | 165 |
| #40 S | 31.49 | 1 | +0.1 | +0.8 | -0.5 | +0.8 | +0.3 | yes | 165 |
| #43 | 33.60 | 4 | +1.7 | +0.6 | -0.1 | +1.2 | +0.7 | yes | 144 |
| #47 | 36.39 | 16 | -0.1 | +0.6 | +0.1 | +0.6 | +0.3 | yes | 144 |
| #51 | 39.24 | 4 | +0.4 | +0.6 | -0.1 | +1.0 | +0.6 | yes | 173 |
| #55 | 42.05 | 8 | +0.7 | +0.7 | +0.1 | +0.6 | -0.6 | yes | 174 |
| #59 | 44.86 | 4 | +0.7 | +0.6 | -0.6 | +0.7 | -0.6 | yes | 144 |
| #63 | 47.65 | 16 | +0.2 | +0.7 | -0.1 | +0.8 | -0.1 | yes | 147 |
| #66 S | 49.74 | 1 | +1.6 | +0.9 | +0.9 | -0.6 | -0.1 | no | 121 |
| #67 | 50.43 | 4 | +0.8 | +0.8 | -0.4 | -0.5 | +0.9 | yes | 120 |
| #68 S | 51.11 | 1 | +3.2 | +0.7 | +0.1 | +1.2 | +1.4 | no | 120 |
| #71 | 53.22 | 8 | +0.3 | +0.8 | -0.0 | +1.2 | +0.7 | yes | 120 |
| #75 | 56.08 | 4 | +2.1 | +0.6 | +0.0 | +1.0 | +4.6 | yes | 172 |
| #79 | 59.05 | 16 | +0.1 | +0.5 | +0.8 | +0.3 | +0.6 | yes | 173 |
| #80 S | 59.72 | 1 | +1.2 | +0.5 | +0.8 | +0.9 | +1.5 | yes | 173 |
| #83 | 61.83 | 4 | -0.2 | +0.2 | +0.9 | +0.6 | +2.2 | yes | 176 |
| #87 S | 64.62 | 8 | +0.1 | -0.3 | -0.6 | +0.5 | +1.8 | yes | 172 |
| #91 | 67.41 | 4 | +1.0 | -0.1 | +0.3 | -0.1 | -0.4 | yes | 172 |
| #95 | 70.19 | 16 | +3.3 | -0.8 | -0.6 | -0.3 | -0.2 | yes | 172 |
| #97 S | 71.61 | 2 | +1.4 | +0.3 | -1.0 | -1.4 | -0.1 | yes | 172 |
| #99 | 73.00 | 4 | +1.2 | +0.0 | -0.1 | -1.8 | -0.3 | no | 172 |
| #103 | 75.79 | 8 | +3.2 | -0.0 | -0.6 | -1.9 | -0.9 | yes | 172 |
| #107 | 78.58 | 4 | +1.6 | -0.2 | -1.4 | -1.9 | -0.9 | yes | 172 |

## Files

- `slitscan.png` — the whole clip, 15 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (cuts): transition at 0.27s (beat #0 r1, novelty 5.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.08/timing.png` … — burst 10.08–13.08s (cuts): strobe 10.33–11.93s, flashes every 0.53s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.75/timing.png` … — burst 12.75–15.75s (cuts): strobe 13.00–13.87s, flashes every 0.43s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/014.42/timing.png` … — burst 14.42–17.42s (cuts): strobe 14.67–16.27s, flashes every 0.53s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/017.50/timing.png` … — burst 17.50–20.50s (cuts): transition at 19.00s (beat #22 r1, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/019.62/timing.png` … — burst 19.62–22.62s (cuts): strobe 19.87–21.20s, flashes every 0.44s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/030.48/timing.png` … — burst 30.48–33.48s (cuts): strobe 30.73–31.87s, flashes every 0.57s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/054.42/timing.png` … — burst 54.42–57.42s (cuts): strobe 54.67–56.40s, flashes every 0.43s. timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py moire-p2 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png` ← the rank that reacts hardest
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
- `sheets/rank1-11.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
