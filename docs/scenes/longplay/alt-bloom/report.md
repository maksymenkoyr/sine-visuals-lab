# ref bundle: alt-bloom

`tools/.cache/refs/_downloads/kMJVNerOtRI.mp4` — 1925.0+40.0s. tempo **129.2 bpm** (beat 0.464s), 56 beats, phrase phase = beat 12 (estimated, margin 1.52σ); sections at beats 3, 5, 11, 35.
Ours heard through `spectrum`: 4769 probe samples, 217 onsets vs the reference's 143.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- no beat-rank preference: the picture reacts about the same on every beat (activity z -0.70..+1.19)
- no visual metric tracks a band continuously (all |r| < 0.2) — the sync, if any, is event-based
- CUTS at 30 fps: 63 hard cuts in 40 s, densest second 6 cuts at 14s; holds between cuts 67–4967 ms (median 333); 149 fades over 1–8 frames (33–267 ms, median 1) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 2 strobe stretch(es), flashes every 0.37 s ≈ 0.80 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps); 0/2 start on a beat, at t 2.7, 12.0
- 25 single transitions: 5 on a beat with an onset, 14 off-beat with no onset (timer/scripted) — ours: onset fired at 19/25 of them
- picture changes regime at 1/4 audio section boundaries — ours: `section` shows no rise near any of them
- brightness does not flash on onsets (rise z +0.21 over 17 strong onsets)
- activity flashes on onsets: rises z +0.47 in ~400 ms, settles within one frame (17 strong onsets averaged)
- activity is continuous across the beat (contrast 0.25σ)
- brightness is continuous across the beat (contrast 0.14σ)
- zoom speed is pulsed, peaking on the off-beat (contrast 0.65σ across the beat)
- ours: tempo at ×1 for 82% of the clip, ×½ 0%, ×2 0%, elsewhere 18% (median 130.1 vs reference 129.2); our onset lands within 60 ms of 88% of the reference's onsets, and 57% of ours sit on one of theirs; lag -6 ms ±13

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 33% of the clip, 36.20s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 91 lit objects on 1280×720 (lit floor 0.18, lit 5.5% of pixels): 43 blob, 30 disc, 16 bar, 1 frame, 1 panel; outlines 2%, fills 98%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.10 over 31 gates: 0.026 half-heights at r 0.3, 0.024 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.036, r0.3-0.6 → 0.064, r0.6-1.0 → 0.026, r>1 → 0.034
- rings at r ≈ 0.27 (×17), 0.42 (×14), 0.60 (×9), 1.68 (×31); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 6.7 px at r<0.45, None px at r≥0.45; glow e-fold 12.2 px, halo/core 0.20 at 4 px; core lum 0.61, ground lum 0.010
- hues (by lit area): magenta 300° 95%; ground `#090003`, centre/edge ground brightness 15.96
- flow (211 object tracks, 32% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.96 (a flat zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:-0.01, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.84 at r<0.45 vs 1.85 at r≥0.45; 26% of elongated objects lie along the radial direction

### Regime 2 — 24% of the clip, 30.00s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 722 lit objects on 1280×720 (lit floor 0.18, lit 18.5% of pixels): 319 blob, 266 disc, 114 bar, 20 panel, 2 hex ring, 1 ring; outlines 0%, fills 100%; 33% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.13 over 289 gates: 0.030 half-heights at r 0.3, 0.034 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.068, r0.3-0.6 → 0.076, r0.6-1.0 → 0.086, r>1 → 0.083
- rings at r ≈ 0.67 (×127), 1.68 (×246); 2-fold (score 0.94); on the axes 47%, on the diagonals 12%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 12.4 px, halo/core 0.15 at 4 px; core lum 0.59, ground lum 0.015
- hues (by lit area): rose 330° 74%, magenta 300° 17%, red 0° 9%; ground `#0f0002`, centre/edge ground brightness 1.00
- flow (3540 object tracks, 24% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.04 (a flat zoom) 0.12 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.49 at r<0.45 vs 1.73 at r≥0.45; 24% of elongated objects lie along the radial direction

### Regime 3 — 19% of the clip, 17.00s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 29 lit objects on 1280×720 (lit floor 0.18, lit 1.7% of pixels): 13 disc, 8 blob, 5 bar, 1 hex ring, 1 frame, 1 panel; outlines 7%, fills 93%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.42 over 14 gates: 0.058 half-heights at r 0.3, 0.037 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.044, r0.6-1.0 → —, r>1 → 0.053
- rings at r ≈ 1.68 (×22); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 3.8 px at r<0.45, None px at r≥0.45; glow e-fold 16.6 px, halo/core 0.16 at 4 px; core lum 0.65, ground lum 0.005
- hues (by lit area): violet 270° 85%, red 0° 14%; ground `#030004`, centre/edge ground brightness 1.00
- flow (157 object tracks, 53% moving outward → mixed directions): radial speed ∝ r^1.17 (a flat zoom) 0.12 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:+0.00, 0.61:+0.01, 0.87:+0.18, 1.22:+0.03; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.36 at r<0.45 vs 1.93 at r≥0.45; 50% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 33.27s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 289 lit objects on 1280×720 (lit floor 0.18, lit 9.4% of pixels): 99 blob, 95 disc, 84 bar, 9 panel, 2 ring; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.03 over 105 gates: 0.031 half-heights at r 0.3, 0.030 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.056, r0.3-0.6 → 0.063, r0.6-1.0 → 0.133, r>1 → 0.059
- rings at r ≈ 0.84 (×95), 1.34 (×20); 8-fold (score 0.84); on the axes 24%, on the diagonals 34%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 16.2 px, halo/core 0.42 at 4 px; core lum 0.61, ground lum 0.040
- hues (by lit area): magenta 300° 54%, azure 210° 17%, violet 270° 16%, rose 330° 7%; ground `#140048`, centre/edge ground brightness 4.04
- flow (364 object tracks, 25% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.19 (a flat zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.02, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.29 at r<0.45 vs 2.13 at r≥0.45; 27% of elongated objects lie along the radial direction

### Regime 5 — 10% of the clip, 21.93s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 741 lit objects on 1280×720 (lit floor 0.21, lit 21.6% of pixels): 376 blob, 248 disc, 102 bar, 14 panel, 1 hex ring; outlines 0%, fills 100%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.09 over 263 gates: 0.030 half-heights at r 0.3, 0.033 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.055, r0.3-0.6 → 0.101, r0.6-1.0 → 0.071, r>1 → 0.092
- rings at r ≈ 1.50 (×333); 2-fold (score 0.98); on the axes 49%, on the diagonals 9%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 20.5 px, halo/core 0.46 at 4 px; core lum 0.64, ground lum 0.071
- hues (by lit area): magenta 300° 51%, azure 210° 17%, violet 270° 11%, blue 240° 9%; ground `#36042d`, centre/edge ground brightness 0.57
- flow (2453 object tracks, 30% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.70 (a fly-through along the axis) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.75 at r<0.45 vs 1.9 at r≥0.45; 28% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.23–3.23s** — transition at 1.73s (beat #0 r4, novelty 6.7); also transition at 2.13s (beat #0 r4, novelty 5.2); also transition at 1.20s (beat #0 r4, novelty 4.3); also transition at 0.67s (beat #0 r4, novelty 2.4) — 10 hard cuts, holds 67–767 ms (median 67); 23 fades over 1–8 frames (33–267 ms, median 1); brightness 0.03–0.50 — `bursts/000.23/timing.png` (every frame), `bursts/000.23/detail.png` (large), `bursts/000.23/motion.png` (paths / skeleton / t±1 in RGB)
- **2.42–5.42s** — strobe 2.67–3.53s, flashes every 0.43s; also transition at 4.07s (beat #0 r4, novelty 2.0) — no hard cut; 18 fades over 1–8 frames (33–267 ms, median 1); brightness 0.03–0.27 — `bursts/002.42/timing.png` (every frame), `bursts/002.42/detail.png` (large), `bursts/002.42/motion.png` (paths / skeleton / t±1 in RGB)
- **9.57–12.57s** — transition at 11.07s (beat #10 r2, novelty 5.1); also transition at 10.13s (beat #8 r4, novelty 1.6) — 7 hard cuts, holds 133–633 ms (median 316); 16 fades over 1–2 frames (33–67 ms, median 1); brightness 0.05–0.49 — `bursts/009.57/timing.png` (every frame), `bursts/009.57/detail.png` (large), `bursts/009.57/motion.png` (paths / skeleton / t±1 in RGB)
- **11.75–14.75s** — strobe 12.00–12.93s, flashes every 0.31s; also phrase start, beat #12 (11.77s) — 8 hard cuts, holds 67–933 ms (median 233); 15 fades over 1–1 frames (33–33 ms, median 1); brightness 0.11–0.39 — `bursts/011.75/timing.png` (every frame), `bursts/011.75/detail.png` (large), `bursts/011.75/motion.png` (paths / skeleton / t±1 in RGB)
- **13.30–16.30s** — transition at 14.80s (beat #19 r1, novelty 4.1) — 9 hard cuts, holds 67–667 ms (median 150); 7 fades over 1–1 frames (33–33 ms, median 1); brightness 0.03–0.28 — `bursts/013.30/timing.png` (every frame), `bursts/013.30/detail.png` (large), `bursts/013.30/motion.png` (paths / skeleton / t±1 in RGB)
- **18.97–21.97s** — transition at 20.47s (beat #31 r1, novelty 4.2); also transition at 21.47s (beat #33 r1, novelty 1.9); also phrase start, beat #28 (19.13s) — 6 hard cuts, holds 67–633 ms (median 333); 10 fades over 1–2 frames (33–67 ms, median 1); brightness 0.04–0.40 — `bursts/018.97/timing.png` (every frame), `bursts/018.97/detail.png` (large), `bursts/018.97/motion.png` (paths / skeleton / t±1 in RGB)
- **24.77–27.77s** — transition at 26.27s (beat #43 r1, novelty 3.4); also phrase start, beat #44 (26.75s) — 1 hard cut at 26.17s; 12 fades over 1–1 frames (33–33 ms, median 1); brightness 0.02–0.21 — `bursts/024.77/timing.png` (every frame), `bursts/024.77/detail.png` (large), `bursts/024.77/motion.png` (paths / skeleton / t±1 in RGB)
- **30.37–33.37s** — transition at 31.87s (beat #55 r1, novelty 3.2) — 4 hard cuts, holds 67–933 ms (median 900); 13 fades over 1–1 frames (33–33 ms, median 1); brightness 0.14–0.49 — `bursts/030.37/timing.png` (every frame), `bursts/030.37/detail.png` (large), `bursts/030.37/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#0c0107`×0.60 `#9d0d28`×0.16 `#0903ae`×0.12 `#bf8fba`×0.10 `#2b88c4`×0.02
- mirror symmetry, ~1 axis (r 0.38); centre brightness 0.25 vs edge 0.17; mean brightness 0.18, dark frames 22%; saturation 0.66
- motion: zoom mean +0.108 (|zoom| 0.171) log-scale/s, rotation mean -0.4° (|rot| 2.1°)/s, frame-to-frame activity 0.067

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 3 | -0.70 | -0.11 | -0.55 | +0.42 | +1.00 | 3/3 |
| 8 | 4 | +0.35 | +0.02 | +0.29 | +0.54 | +0.03 | 4/4 |
| 4 | 7 | +0.41 | +0.45 | -0.11 | +0.76 | +1.14 | 6/7 |
| 2 | 14 | +1.19 | +0.96 | +0.48 | +0.64 | +1.03 | 11/14 |
| 1 | 28 | +0.71 | +0.51 | +0.55 | +0.47 | +0.30 | 26/28 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.67 | #0 | -5556 | 4 | -0.2 | -0.1 | -0.1 | +0.2 | off-beat (-11.96 beat from r4), no onset, → probably not audio-driven, ours: onset yes, bpm 158 |
| 1.20 | #0 | -5023 | 4 | +0.7 | -0.2 | +0.6 | +0.0 | off-beat (-10.82 beat from r4), no onset, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 161 |
| 1.73 | #0 | -4490 | 4 | +0.8 | +0.1 | -0.8 | -0.3 | off-beat (-9.67 beat from r4), onset, looks like a cut, ours: onset yes, bpm 161 |
| 2.13 | #0 | -4090 | 4 | -0.2 | +0.1 | +1.2 | -0.1 | off-beat (-8.81 beat from r4), no onset, mid jumps, → probably not audio-driven, ours: onset yes, bpm 161 |
| 2.67 | #0 | -3556 | 4 | +0.4 | +0.6 | +1.1 | +0.6 | STROBE to 3.53s: 3 flashes every 0.43s = 0.93 beat (≈ 1 beat within the ±0.14-beat resolution of 15 fps), starts off beat r4, no onset, mid jumps, ours: onset yes, bpm 166 |
| 4.07 | #0 | -2156 | 4 | +0.0 | -0.1 | -0.3 | +0.3 | off-beat (-4.64 beat from r4), no onset, → probably not audio-driven, ours: onset yes, bpm 168 |
| 6.40 | #0 | +177 | 4 | -0.2 | +0.5 | -0.5 | -0.4 | off-beat (+0.38 beat from r4), no onset, → probably not audio-driven, ours: onset no, bpm 168 |
| 7.47 | #3 | -126 | 1 | -0.3 | -0.0 | -0.5 | -0.1 | off-beat (-0.27 beat from r1), no onset, section boundary, → probably not audio-driven, ours: onset no, bpm 168 |
| 9.13 | #6 | +147 | 2 | -0.3 | -0.3 | +0.5 | +0.3 | off-beat (+0.32 beat from r2), no onset, flash, → probably not audio-driven, ours: onset yes, bpm 125 |
| 10.13 | #8 | +218 | 4 | -0.3 | -0.1 | -0.2 | -0.2 | off-beat (+0.47 beat from r4), no onset, → probably not audio-driven, ours: onset yes, bpm 127 |
| 11.07 | #10 | +223 | 2 | -0.1 | -0.3 | -0.6 | -0.9 | off-beat (+0.48 beat from r2), no onset, section boundary, flash, → probably not audio-driven, ours: onset no, bpm 128 |
| 12.00 | #13 | -214 | 1 | +0.6 | -0.4 | -0.1 | +0.3 | STROBE to 12.93s: 4 flashes every 0.31s = 0.67 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset, looks like a cut, flash, ours: onset yes, bpm 129 |
| 14.80 | #19 | -200 | 1 | +0.6 | -0.3 | +1.5 | +0.3 | off-beat (-0.43 beat from r1), no onset, mid jumps, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 16.73 | #23 | -101 | 1 | +0.0 | -0.8 | +0.8 | +0.3 | off-beat (-0.22 beat from r1), no onset, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 18.60 | #27 | -92 | 1 | +2.8 | -0.3 | +1.9 | +2.5 | on beat (r1), hard onset, mid jumps, high jumps, flash, ours: onset yes, bpm 130 |
| 20.47 | #31 | -60 | 1 | +2.9 | -0.2 | +2.6 | +2.3 | on beat (r1), hard onset, mid jumps, high jumps, flash, ours: onset yes, bpm 130 |
| 21.47 | #33 | +11 | 1 | +4.7 | +0.4 | -0.8 | +0.9 | on beat (r1), hard onset, ours: onset yes, bpm 130 |
| 22.40 | #35 | +16 | 1 | +0.5 | +0.5 | -0.9 | +0.1 | on beat (r1), no onset, section boundary, flash, ours: onset yes, bpm 130 |
| 23.33 | #37 | -49 | 1 | -0.2 | +0.0 | -0.4 | -0.1 | on beat (r1), no onset, ours: onset yes, bpm 130 |
| 23.93 | #38 | +40 | 2 | +0.2 | -0.2 | +0.2 | +0.4 | on beat (r2), no onset, ours: onset no, bpm 130 |
| 24.27 | #39 | -138 | 1 | -0.3 | +0.4 | -0.9 | -0.3 | off-beat (-0.30 beat from r1), no onset, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 26.27 | #43 | -42 | 1 | +0.6 | -0.1 | +0.4 | +1.2 | on beat (r1), no onset, high jumps, ours: onset yes, bpm 130 |
| 28.07 | #47 | -76 | 1 | +4.5 | -0.1 | -0.2 | +1.1 | on beat (r1), hard onset, high jumps, flash, ours: onset no, bpm 130 |
| 29.67 | #50 | +131 | 2 | -0.2 | -0.3 | +1.2 | -0.3 | off-beat (+0.28 beat from r2), no onset, mid jumps, → probably not audio-driven, ours: onset yes, bpm 130 |
| 31.87 | #55 | +32 | 1 | +1.5 | -0.4 | +0.8 | -0.2 | on beat (r1), hard onset, flash, ours: onset yes, bpm 130 |
| 33.73 | #55 | +1899 | 1 | -0.1 | -0.2 | -0.1 | +0.0 | off-beat (+4.09 beat from r1), no onset, flash, → probably not audio-driven, ours: onset yes, bpm 130 |
| 35.60 | #55 | +3765 | 1 | +1.3 | +0.0 | +0.2 | +0.4 | off-beat (+8.11 beat from r1), onset, flash, ours: onset no, bpm 130 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #0 (r4, 6.22s): act +1.1σ, zoom +1.1σ, abszoom +0.8σ
- beat #4 (r8, 8.06s): sat -1.2σ, act -1.3σ
- beat #12 (r16, 11.77s): sat +1.3σ
- beat #16 (r4, 13.61s): zoom +1.1σ, abszoom +0.9σ
- beat #20 (r8, 15.44s): bright -1.7σ, sat -1.6σ, act -2.0σ, zoom -0.9σ
- beat #24 (r4, 17.30s): sat -1.1σ
- beat #36 (r8, 22.87s): bright -1.4σ
- beat #40 (r4, 24.91s): bright -1.0σ
- beat #48 (r4, 28.61s): act +1.2σ, zoom +0.9σ, abszoom +1.1σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #0 | 6.22 | 4 | +0.3 | -2.3 | +0.5 | +2.6 | -0.1 | no | 168 |
| #3 S | 7.59 | 1 | -0.3 | -3.0 | -1.9 | +1.4 | +0.1 | no | 168 |
| #4 | 8.06 | 8 | +5.3 | -0.7 | -0.1 | -0.6 | -0.6 | yes | 168 |
| #5 S | 8.52 | 1 | -0.1 | +0.5 | +0.8 | -1.2 | -0.9 | yes | 166 |
| #8 | 9.91 | 4 | -0.1 | +0.4 | +0.7 | +0.9 | +2.7 | yes | 127 |
| #11 S | 11.31 | 1 | +0.4 | +0.5 | -0.8 | +0.5 | +0.7 | yes | 129 |
| #12 | 11.77 | 16 | +0.2 | +0.5 | -1.3 | +0.5 | +2.1 | yes | 129 |
| #16 | 13.61 | 4 | +6.4 | +0.7 | -1.4 | -0.1 | +1.2 | yes | 130 |
| #20 | 15.44 | 8 | +2.6 | +0.6 | -1.3 | +0.5 | +0.3 | yes | 130 |
| #24 | 17.30 | 4 | +0.8 | +0.6 | -0.7 | -1.1 | -0.6 | yes | 130 |
| #28 | 19.13 | 16 | +4.2 | +0.6 | -1.2 | -0.5 | -0.0 | yes | 130 |
| #32 | 20.99 | 4 | +5.5 | +0.5 | -0.7 | +0.6 | +0.9 | yes | 130 |
| #35 S | 22.38 | 1 | +0.5 | +0.4 | +0.6 | +1.4 | +1.0 | yes | 130 |
| #36 | 22.87 | 8 | +0.1 | +0.4 | +0.8 | +0.7 | +0.4 | yes | 130 |
| #40 | 24.91 | 4 | +0.6 | +0.4 | +0.4 | -0.3 | +0.4 | yes | 130 |
| #44 | 26.75 | 16 | +0.3 | +0.5 | -0.2 | -0.9 | -0.1 | yes | 130 |
| #48 | 28.61 | 4 | +4.5 | +0.3 | -0.4 | +0.4 | +0.2 | yes | 130 |
| #52 | 30.46 | 8 | +1.9 | +0.6 | +0.0 | +1.0 | +0.2 | yes | 130 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 14 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.23/timing.png` … — burst 0.23–3.23s (cuts): transition at 1.73s (beat #0 r4, novelty 6.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.42/timing.png` … — burst 2.42–5.42s (fades): strobe 2.67–3.53s, flashes every 0.43s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/009.57/timing.png` … — burst 9.57–12.57s (cuts): transition at 11.07s (beat #10 r2, novelty 5.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.75/timing.png` … — burst 11.75–14.75s (cuts): strobe 12.00–12.93s, flashes every 0.31s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/013.30/timing.png` … — burst 13.30–16.30s (cuts): transition at 14.80s (beat #19 r1, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/018.97/timing.png` … — burst 18.97–21.97s (cuts): transition at 20.47s (beat #31 r1, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/024.77/timing.png` … — burst 24.77–27.77s (cut): transition at 26.27s (beat #43 r1, novelty 3.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/030.37/timing.png` … — burst 30.37–33.37s (cuts): transition at 31.87s (beat #55 r1, novelty 3.2). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py alt-bloom --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
