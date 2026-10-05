# ref bundle: livecode-wall

`tools/.cache/refs/_downloads/livecode-wall.mp4` — 0.0+59.0s. tempo **112.3 bpm** (beat 0.534s), 110 beats, phrase phase = beat 5 (estimated, margin 1.04σ); sections at beats 20, 23, 37, 41, 82, 95, 100.
Ours heard through `spectrum`: 7058 probe samples, 294 onsets vs the reference's 207.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- brightness reacts most at phrase starts (rank 16 z +0.43 vs rank 4 -0.13) — ours: onset fires on 5/7 of those beats
- activity follows mid (r +0.24, -466 ms)
- cut follows rms (r +0.22, -66 ms)
- sat moves against rms (r -0.20, -333 ms)
- NO HARD CUTS at 30 fps in 59 s; 28 fades over 1–4 frames (33–133 ms, median 1): every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 2 strobe stretch(es), flashes every 0.39 s ≈ 0.73 beat (no simple fraction of a beat → own timer); 0/2 start on a beat, at t 6.3, 9.6
- 18 single transitions: 4 on a beat with an onset, 9 off-beat with no onset (timer/scripted) — ours: onset fired at 11/18 of them
- picture changes regime at 3/7 audio section boundaries — ours: `section` shows no rise near any of them
- zoom direction changes at beat #49 (r4, 26.9s, -1.3σ)
- brightness does not flash on onsets (rise z -0.00 over 32 strong onsets)
- activity does not flash on onsets (rise z +0.19 over 32 strong onsets)
- activity is continuous across the beat (contrast 0.26σ)
- brightness is continuous across the beat (contrast 0.06σ)
- zoom speed is continuous across the beat (contrast 0.25σ)
- ours: tempo at ×1 for 17% of the clip, ×½ 0%, ×2 0%, elsewhere 83% (median 134.7 vs reference 112.3); our onset lands within 60 ms of 68% of the reference's onsets, and 49% of ours sit on one of theirs; lag +12 ms ±30

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 30% of the clip, 32.33s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 153 lit objects on 400×400 (lit floor 0.42, lit 7.0% of pixels): 80 disc, 45 blob, 18 bar, 4 hex ring, 3 ring, 2 panel, 1 frame; outlines 5%, fills 95%; 12% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.64 over 90 gates: 0.056 half-heights at r 0.3, 0.028 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.035, r0.6-1.0 → 0.063, r>1 → 0.052
- rings at r ≈ 0.95 (×91); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 2.7 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 25.2 px, halo/core 0.34 at 4 px; core lum 0.57, ground lum 0.316
- hues (by lit area): yellow 60° 73%, chartreuse 90° 18%, orange 30° 10%; ground `#485255`, centre/edge ground brightness 1.27
- flow (1837 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.31 (not a zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:-0.12, 0.21:-0.00, 0.39:+0.00, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.45 at r<0.45 vs 1.48 at r≥0.45; 23% of elongated objects lie along the radial direction

### Regime 2 — 28% of the clip, 22.73s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 177 lit objects on 400×400 (lit floor 0.36, lit 7.6% of pixels): 92 disc, 43 blob, 24 bar, 8 hex ring, 5 ring, 4 panel, 1 frame; outlines 8%, fills 92%; 7% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.51 over 110 gates: 0.049 half-heights at r 0.3, 0.028 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 1.105, r0.3-0.6 → 0.071, r0.6-1.0 → 0.049, r>1 → 0.055
- rings at r ≈ 0.34 (×17), 0.95 (×93); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 2.1 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 35.2 px, halo/core 0.24 at 4 px; core lum 0.52, ground lum 0.243
- hues (by lit area): yellow 60° 67%, chartreuse 90° 33%; ground `#354042`, centre/edge ground brightness 1.34
- flow (1973 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.14 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:+0.04, 0.21:+0.05, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.52 at r<0.45 vs 1.53 at r≥0.45; 23% of elongated objects lie along the radial direction

### Regime 3 — 21% of the clip, 15.40s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 178 lit objects on 400×400 (lit floor 0.32, lit 7.1% of pixels): 88 disc, 62 blob, 14 bar, 7 panel, 7 hex ring; outlines 4%, fills 96%; 12% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.31 over 102 gates: 0.043 half-heights at r 0.3, 0.030 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.084, r0.6-1.0 → 0.055, r>1 → 0.055
- rings at r ≈ 0.34 (×12), 0.95 (×87); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 30.5 px, halo/core 0.24 at 4 px; core lum 0.47, ground lum 0.215
- hues (by lit area): yellow 60° 85%, chartreuse 90° 12%; ground `#2f383a`, centre/edge ground brightness 1.00
- flow (1874 object tracks, 24% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.37 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:+0.07, 0.21:+0.02, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.63 at r<0.45 vs 1.71 at r≥0.45; 27% of elongated objects lie along the radial direction

### Regime 4 — 18% of the clip, 51.93s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 92 lit objects on 400×400 (lit floor 0.25, lit 4.1% of pixels): 50 disc, 28 blob, 9 bar, 2 hex ring, 2 panel, 1 frame; outlines 3%, fills 97%; 33% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.97 over 55 gates: 0.105 half-heights at r 0.3, 0.036 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.153, r0.6-1.0 → 0.060, r>1 → 0.057
- rings at r ≈ 1.06 (×53); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 26.2 px, halo/core 0.23 at 4 px; core lum 0.42, ground lum 0.145
- hues (by lit area): yellow 60° 95%; ground `#212528`, centre/edge ground brightness 1.00
- flow (1049 object tracks, 28% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-1.67 (not a zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:+0.08, 0.21:—, 0.39:+0.10, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.15 at r<0.45 vs 1.71 at r≥0.45; 23% of elongated objects lie along the radial direction

### Regime 5 — 2% of the clip, 6.27s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 128 lit objects on 400×400 (lit floor 0.52, lit 3.9% of pixels): 42 blob, 40 disc, 35 bar, 6 panel, 3 hex ring, 1 frame, 1 ring; outlines 4%, fills 96%; 20% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.89 over 51 gates: 0.058 half-heights at r 0.3, 0.022 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 1.034, r0.3-0.6 → 0.095, r0.6-1.0 → 0.037, r>1 → 0.042
- rings at r ≈ 0.34 (×14), 0.95 (×65); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 49.4 px, halo/core 0.15 at 4 px; core lum 0.61, ground lum 0.420
- hues (by lit area): yellow 60° 85%, chartreuse 90° 15%; ground `#626c73`, centre/edge ground brightness 1.03
- flow (1778 object tracks, 35% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.20 (not a zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:+0.06, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.67 at r<0.45 vs 1.79 at r≥0.45; 22% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **1.23–4.23s** — transition at 2.73s (beat #5 r16, novelty 7.6); also phrase start, beat #5 (2.86s) — no hard cut; 3 fades over 1–1 frames (33–33 ms, median 1); brightness 0.11–0.34 — `bursts/001.23/timing.png` (every frame), `bursts/001.23/detail.png` (large), `bursts/001.23/motion.png` (paths / skeleton / t±1 in RGB)
- **6.08–9.08s** — strobe 6.33–8.13s, flashes every 0.36s — no hard cut; 3 fades over 1–1 frames (33–33 ms, median 1); brightness 0.17–0.50 — `bursts/006.08/timing.png` (every frame), `bursts/006.08/detail.png` (large), `bursts/006.08/motion.png` (paths / skeleton / t±1 in RGB)
- **9.35–12.35s** — strobe 9.60–11.27s, flashes every 0.42s — no hard cut; 11 fades over 1–4 frames (33–133 ms, median 3); brightness 0.22–0.61 — `bursts/009.35/timing.png` (every frame), `bursts/009.35/detail.png` (large), `bursts/009.35/motion.png` (paths / skeleton / t±1 in RGB)
- **15.50–18.50s** — transition at 17.00s (beat #31 r2, novelty 2.9); also transition at 16.47s (beat #30 r1, novelty 1.9) — no hard cut; 2 fades over 1–1 frames (33–33 ms, median 1); brightness 0.16–0.32 — `bursts/015.50/timing.png` (every frame), `bursts/015.50/detail.png` (large), `bursts/015.50/motion.png` (paths / skeleton / t±1 in RGB)
- **19.37–22.37s** — transition at 20.87s (beat #38 r1, novelty 3.5); also phrase start, beat #37 (20.20s) — no hard cut; 1 fade over 1–1 frames (33–33 ms, median 1); brightness 0.14–0.31 — `bursts/019.37/timing.png` (every frame), `bursts/019.37/detail.png` (large), `bursts/019.37/motion.png` (paths / skeleton / t±1 in RGB)
- **26.50–29.50s** — transition at 28.00s (beat #51 r2, novelty 4.0) — no hard cut; 1 fade over 2–2 frames (67–67 ms, median 2); brightness 0.26–0.31 — `bursts/026.50/timing.png` (every frame), `bursts/026.50/detail.png` (large), `bursts/026.50/motion.png` (paths / skeleton / t±1 in RGB)
- **30.50–33.50s** — transition at 32.00s (beat #59 r2, novelty 3.1) — no hard cut; 1 fade over 2–2 frames (67–67 ms, median 2); brightness 0.26–0.44 — `bursts/030.50/timing.png` (every frame), `bursts/030.50/detail.png` (large), `bursts/030.50/motion.png` (paths / skeleton / t±1 in RGB)
- **50.70–53.70s** — transition at 52.20s (beat #97 r4, novelty 14.0); also transition at 50.73s (beat #94 r1, novelty 3.4) — no hard cut; 1 fade over 4–4 frames (133–133 ms, median 4); brightness 0.16–0.38 — `bursts/050.70/timing.png` (every frame), `bursts/050.70/detail.png` (large), `bursts/050.70/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#3f494a`×0.32 `#262e2d`×0.27 `#535c60`×0.23 `#6d7575`×0.13 `#939896`×0.05
- 12-fold rotational symmetry (r 0.34); mirror symmetry, ~1 axis (r 0.37); centre brightness 0.32 vs edge 0.28; mean brightness 0.29, dark frames 0%; saturation 0.17
- motion: zoom mean +0.001 (|zoom| 0.075) log-scale/s, rotation mean -0.1° (|rot| 6.2°)/s, frame-to-frame activity 0.014

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 7 | +0.50 | +0.56 | +0.43 | +0.04 | -0.03 | 5/7 |
| 8 | 7 | +0.79 | +1.10 | +1.04 | +0.06 | +0.27 | 6/7 |
| 4 | 14 | +0.15 | +0.37 | -0.13 | +0.09 | +0.70 | 10/14 |
| 2 | 27 | +0.17 | +0.44 | +0.06 | +0.09 | -0.11 | 19/27 |
| 1 | 55 | +0.20 | +0.22 | +0.06 | +0.09 | -0.04 | 34/54 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- activity ~ mid: r +0.24 at -466 ms
- activity ~ rms: r +0.24 at -466 ms
- cut ~ rms: r +0.22 at -66 ms
- cut ~ mid: r +0.20 at -466 ms
- sat ~ rms: r -0.20 at -333 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 2.73 | #5 | -123 | 16 | +0.8 | +0.5 | +0.0 | -0.1 | off-beat (-0.23 beat from r16), onset, flash, ours: onset yes, bpm 99 |
| 4.87 | #9 | -102 | 4 | +0.1 | +0.1 | -0.3 | -0.0 | off-beat (-0.19 beat from r4), no onset, → probably not audio-driven, ours: onset no, bpm 99 |
| 6.33 | #12 | -215 | 1 | -0.3 | -0.0 | +0.8 | -2.5 | STROBE to 8.13s: 6 flashes every 0.36s = 0.67 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset, high drops, ours: onset yes, bpm 99 |
| 9.60 | #18 | -292 | 1 | +0.0 | +0.8 | -0.5 | +0.0 | STROBE to 11.27s: 5 flashes every 0.42s = 0.78 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset, flash, ours: onset yes, bpm 133 |
| 12.47 | #23 | -119 | 2 | -0.3 | +0.9 | -0.3 | +0.0 | off-beat (-0.22 beat from r2), no onset, section boundary, → probably not audio-driven, ours: onset yes, bpm 122 |
| 13.47 | #25 | -140 | 4 | +1.7 | +0.8 | -0.0 | +0.1 | off-beat (-0.26 beat from r4), hard onset, ours: onset yes, bpm 122 |
| 14.47 | #27 | -232 | 2 | -0.1 | -2.2 | +0.6 | -0.2 | off-beat (-0.43 beat from r2), no onset, low drops, → probably not audio-driven, ours: onset no, bpm 122 |
| 16.47 | #30 | +189 | 1 | -0.3 | +0.8 | +0.2 | -0.2 | off-beat (+0.35 beat from r1), no onset, → probably not audio-driven, ours: onset yes, bpm 161 |
| 17.00 | #31 | +189 | 2 | -0.2 | -0.7 | -0.5 | +3.4 | off-beat (+0.35 beat from r2), no onset, high jumps, looks like a cut, → probably not audio-driven, ours: onset yes, bpm 160 |
| 20.87 | #38 | +131 | 1 | +1.5 | +1.6 | -1.3 | -0.0 | off-beat (+0.25 beat from r1), hard onset, low jumps, mid drops, flash, ours: onset yes, bpm 161 |
| 24.87 | #45 | +230 | 8 | +0.4 | -0.5 | +1.0 | -0.0 | off-beat (+0.43 beat from r8), no onset, mid jumps, → probably not audio-driven, ours: onset yes, bpm 161 |
| 28.00 | #51 | +20 | 2 | +5.2 | +0.2 | +0.8 | +1.8 | on beat (r2), hard onset, high jumps, looks like a cut, ours: onset yes, bpm 148 |
| 32.00 | #59 | -253 | 2 | +0.2 | -0.5 | -0.0 | +0.1 | off-beat (-0.47 beat from r2), no onset, → probably not audio-driven, ours: onset no, bpm 139 |
| 39.73 | #73 | +50 | 4 | +4.2 | +0.3 | +0.1 | +0.3 | on beat (r4), hard onset, ours: onset yes, bpm 108 |
| 43.93 | #81 | +24 | 4 | +2.4 | +0.2 | -0.7 | +0.3 | on beat (r4), hard onset, ours: onset yes, bpm 109 |
| 46.00 | #85 | +117 | 16 | +1.6 | +1.9 | +0.2 | +0.6 | off-beat (+0.22 beat from r16), hard onset, low jumps, ours: onset no, bpm 148 |
| 47.07 | #87 | +139 | 2 | -0.0 | -1.9 | -1.1 | -0.7 | off-beat (+0.26 beat from r2), no onset, low drops, mid drops, → probably not audio-driven, ours: onset no, bpm 98 |
| 50.73 | #94 | -72 | 1 | +0.9 | -0.8 | +0.5 | -0.4 | on beat (r1), onset, blackout, ours: onset no, bpm 99 |
| 52.20 | #97 | -207 | 4 | -0.1 | -1.1 | +0.1 | +1.4 | off-beat (-0.39 beat from r4), no onset, low drops, high jumps, looks like a cut, flash, → probably not audio-driven, ours: onset no, bpm 152 |
| 58.27 | #108 | -85 | 1 | +0.4 | +1.2 | +0.7 | -0.1 | on beat (r1), no onset, low jumps, ours: onset yes, bpm 130 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #5 (r16, 2.86s): bright +2.1σ
- beat #9 (r4, 4.97s): bright +1.0σ, sat -1.2σ
- beat #17 (r4, 9.22s): bright +2.2σ, sat -1.6σ, act +2.9σ
- beat #21 (r16, 11.49s): act -1.2σ
- beat #25 (r4, 13.61s): bright -1.1σ, sat +1.9σ, act -1.0σ
- beat #41 (r4, 22.41s): rot +1.0σ
- beat #45 (r8, 24.64s): sat +0.8σ
- beat #49 (r4, 26.91s): zoom -1.3σ, abszoom +1.5σ, rot +3.0σ
- beat #61 (r8, 33.30s): bright +0.8σ
- beat #73 (r4, 39.68s): bright -1.1σ, sat +1.1σ
- beat #81 (r4, 43.91s): bright -0.9σ, sat +0.9σ
- beat #85 (r16, 45.88s): bright +1.1σ, sat -0.9σ
- beat #93 (r8, 50.27s): act +1.0σ, zoom -0.8σ, abszoom +1.0σ
- beat #97 (r4, 52.41s): bright +1.7σ, sat -1.1σ, act -1.7σ, zoom +1.0σ

## Bar and phrase beats

S = audio section boundary, C = the uploader's chapter boundary.

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #1 | 0.72 | 4 | +2.3 | -1.1 | +1.5 | -0.7 | -0.6 | yes | 181 |
| #5 | 2.86 | 16 | +2.9 | -0.7 | -0.5 | +1.7 | +2.2 | yes | 99 |
| #9 | 4.97 | 4 | +0.2 | +0.1 | -0.6 | +0.6 | +0.9 | yes | 99 |
| #13 | 7.08 | 8 | +0.3 | -0.1 | +0.2 | +2.5 | +2.5 | yes | 135 |
| #17 | 9.22 | 4 | +2.1 | -0.5 | -0.6 | +0.9 | +1.0 | no | 133 |
| #20 S | 10.96 | 1 | -0.2 | -0.1 | -0.6 | +1.6 | +1.0 | yes | 153 |
| #21 | 11.49 | 16 | +0.6 | -1.0 | -0.5 | +6.0 | +4.1 | yes | 152 |
| #23 S | 12.59 | 2 | +0.5 | -0.7 | -0.6 | +1.9 | +1.0 | yes | 122 |
| #25 | 13.61 | 4 | +1.2 | +0.7 | -0.5 | +0.5 | +0.9 | yes | 122 |
| #29 | 15.77 | 8 | +0.2 | +0.7 | +0.3 | +0.4 | +1.1 | yes | 161 |
| #33 | 17.86 | 4 | +1.4 | -0.8 | +0.5 | -0.8 | -0.7 | no | 160 |
| #37 S | 20.20 | 16 | +3.3 | -0.8 | -0.0 | -0.7 | -0.6 | yes | 161 |
| #41 S | 22.41 | 4 | +0.4 | +0.1 | -0.5 | +0.2 | +0.0 | no | 161 |
| #45 | 24.64 | 8 | +0.4 | -0.5 | -0.6 | +1.0 | +2.2 | no | 161 |
| #49 | 26.91 | 4 | +0.8 | +0.5 | -0.6 | +0.7 | -0.3 | yes | 148 |
| #53 | 29.05 | 16 | +1.1 | +0.5 | +2.4 | -0.3 | -0.4 | no | 148 |
| #57 | 31.18 | 4 | +0.1 | +0.2 | -0.0 | +0.5 | +0.2 | yes | 140 |
| #61 | 33.30 | 8 | +1.6 | +1.0 | -0.5 | +0.1 | +0.1 | yes | 140 |
| #65 | 35.41 | 4 | +2.8 | -0.4 | +0.1 | +0.1 | +0.3 | yes | 129 |
| #69 | 37.55 | 16 | +1.1 | +1.1 | -0.3 | -0.1 | -0.6 | no | 108 |
| #73 | 39.68 | 4 | +4.2 | -0.1 | -0.3 | +0.6 | +2.6 | yes | 108 |
| #77 | 41.77 | 8 | +2.7 | +1.2 | -0.5 | -0.2 | +0.7 | yes | 108 |
| #81 | 43.91 | 4 | +2.4 | +0.7 | -0.3 | +0.9 | +1.6 | yes | 109 |
| #82 S | 44.37 | 1 | +0.1 | +1.1 | -0.6 | -0.2 | +0.1 | no | 148 |
| #85 | 45.88 | 16 | +1.6 | +0.3 | -0.4 | +0.8 | +1.2 | yes | 148 |
| #89 | 47.97 | 4 | +1.9 | -0.5 | -0.3 | +0.0 | +0.2 | no | 98 |
| #93 | 50.27 | 8 | +2.3 | +1.6 | -0.2 | +0.9 | +0.3 | yes | 99 |
| #95 S | 51.27 | 2 | +1.6 | -0.5 | +1.6 | +1.0 | +0.6 | yes | 153 |
| #97 | 52.41 | 4 | +3.1 | +0.6 | +0.9 | -0.2 | +0.0 | yes | 152 |
| #100 S | 53.99 | 1 | -0.0 | -1.9 | -0.4 | -0.6 | -0.3 | no | 115 |
| #101 | 54.54 | 16 | +2.5 | +1.4 | -0.2 | -0.5 | -0.4 | yes | 115 |
| #105 | 56.66 | 4 | +7.2 | -0.1 | -0.2 | +0.0 | +0.3 | yes | 140 |
| #109 | 58.96 | 8 | +1.2 | +2.1 | -0.2 | +4.6 | +6.0 | yes | 130 |

## Files

- `slitscan.png` — the whole clip, 15 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/001.23/timing.png` … — burst 1.23–4.23s (fades): transition at 2.73s (beat #5 r16, novelty 7.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.08/timing.png` … — burst 6.08–9.08s (fades): strobe 6.33–8.13s, flashes every 0.36s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/009.35/timing.png` … — burst 9.35–12.35s (fades): strobe 9.60–11.27s, flashes every 0.42s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.50/timing.png` … — burst 15.50–18.50s (fades): transition at 17.00s (beat #31 r2, novelty 2.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/019.37/timing.png` … — burst 19.37–22.37s (fades): transition at 20.87s (beat #38 r1, novelty 3.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/026.50/timing.png` … — burst 26.50–29.50s (fades): transition at 28.00s (beat #51 r2, novelty 4.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/030.50/timing.png` … — burst 30.50–33.50s (fades): transition at 32.00s (beat #59 r2, novelty 3.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/050.70/timing.png` … — burst 50.70–53.70s (fades): transition at 52.20s (beat #97 r4, novelty 14.0). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py livecode-wall --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
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
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
