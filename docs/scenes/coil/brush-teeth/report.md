# ref bundle: brush-teeth

`brush-teeth.mp4 (v.redd.it/6nyfgxzb3voh1, 720p)` — 0.0+60.0s. no usable audio (no audio stream).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (no audio stream): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 1 hard cuts in 60 s, densest second 1 cuts at 11s; one cut; 6 fades over 1–3 frames (33–100 ms, median 1) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 15 single transitions at t 1.7, 11.3, 11.9, 12.7, 18.1, 21.0, 26.9, 29.7, 36.8, 46.7, 49.5, 50.1, 55.9, 56.4, 57.9
- zoom direction changes at beat #28 (r4, 14.0s, -1.8σ)
- zoom direction changes at beat #96 (r16, 48.0s, +1.6σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 34% of the clip, 53.20s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 756 lit objects on 720×720 (lit floor 0.59, lit 36.6% of pixels): 323 bar, 244 blob, 107 disc, 81 panel, 1 ring; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.00 over 189 gates: 0.046 half-heights at r 0.3, 0.046 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.138, r0.3-0.6 → 0.200, r0.6-1.0 → 0.404, r>1 → 0.212
- rings at r ≈ 0.95 (×279); 2-fold (score 0.99); on the axes 18%, on the diagonals 10%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 27.5 px, halo/core 0.63 at 4 px; core lum 0.80, ground lum 0.000
- hues (by lit area): blue 240° 72%, azure 210° 14%, violet 270° 9%; ground `#000000`, centre/edge ground brightness 1.00
- flow (4949 object tracks, 52% moving outward → mixed directions): radial speed ∝ r^0.33 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.01, 0.39:+0.00, 0.61:+0.00, 0.87:+0.01, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.61 at r<0.45 vs 2.7 at r≥0.45; 43% of elongated objects lie along the radial direction

### Regime 2 — 34% of the clip, 27.33s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 292 lit objects on 720×720 (lit floor 0.57, lit 44.5% of pixels): 123 blob, 95 bar, 54 disc, 18 panel, 1 hex ring, 1 ring; outlines 1%, fills 99%; 67% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.28 over 73 gates: 0.082 half-heights at r 0.3, 0.060 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.381, r0.3-0.6 → 0.344, r0.6-1.0 → 0.548, r>1 → 0.447
- rings at r ≈ 0.24 (×15), 0.60 (×98), 0.95 (×88); 2-fold (score 0.95); on the axes 34%, on the diagonals 43%
- stroke (outlines): None px at r<0.45, 3.8 px at r≥0.45; glow e-fold 31.0 px, halo/core 0.52 at 4 px; core lum 0.86, ground lum 0.000
- hues (by lit area): blue 240° 38%, azure 210° 27%, violet 270° 21%, rose 330° 8%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1394 object tracks, 36% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.30 (not a zoom) 0.20 half-heights/s at r 0.5; by r → 0.07:-0.14, 0.21:-0.20, 0.39:-0.09, 0.61:+0.01, 0.87:-0.25, 1.22:-0.29; rotation +5.8°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.0 at r<0.45 vs 2.24 at r≥0.45; 39% of elongated objects lie along the radial direction

### Regime 3 — 17% of the clip, 54.93s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 239 lit objects on 720×720 (lit floor 0.52, lit 43.1% of pixels): 90 blob, 89 bar, 46 disc, 14 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.12 over 60 gates: 0.061 half-heights at r 0.3, 0.070 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.106, r0.3-0.6 → 0.570, r0.6-1.0 → 0.907, r>1 → 0.272
- rings at r ≈ 0.13 (×18), 0.34 (×16), 1.19 (×98); 2-fold (score 0.97); on the axes 10%, on the diagonals 17%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 12.2 px, halo/core 0.28 at 4 px; core lum 0.80, ground lum 0.327
- hues (by lit area): blue 240° 90%, violet 270° 8%; ground `#b23659`, centre/edge ground brightness 1.00
- flow (1633 object tracks, 54% moving outward → mixed directions): radial speed ∝ r^0.30 (not a zoom) 0.09 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:-0.05, 0.39:-0.01, 0.61:+0.01, 0.87:+0.00, 1.22:+0.03; rotation +0.3°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.37 at r<0.45 vs 2.37 at r≥0.45; 55% of elongated objects lie along the radial direction

### Regime 4 — 12% of the clip, 38.73s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 710 lit objects on 720×720 (lit floor 0.70, lit 8.5% of pixels): 261 bar, 219 blob, 176 disc, 53 panel, 1 hex ring; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.15 over 230 gates: 0.031 half-heights at r 0.3, 0.026 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.451, r0.3-0.6 → 0.057, r0.6-1.0 → 0.121, r>1 → 0.090
- rings at r ≈ 0.38 (×80), 0.84 (×329); 8-fold (score 0.93); on the axes 33%, on the diagonals 30%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core 0.71 at 4 px; core lum 0.80, ground lum 0.000
- hues (by lit area): blue 240° 47%, violet 270° 37%, magenta 300° 14%; ground `#000000`, centre/edge ground brightness 1.00
- flow (4626 object tracks, 41% moving outward → mixed directions): radial speed ∝ r^-0.20 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.12, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.97 at r<0.45 vs 2.47 at r≥0.45; 40% of elongated objects lie along the radial direction

### Regime 5 — 3% of the clip, 17.93s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 889 lit objects on 720×720 (lit floor 0.74, lit 10.6% of pixels): 381 bar, 332 blob, 139 disc, 35 panel, 1 ring, 1 hex ring; outlines 0%, fills 100%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.28 over 176 gates: 0.031 half-heights at r 0.3, 0.023 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.068, r0.3-0.6 → 0.092, r0.6-1.0 → 0.097, r>1 → 0.070
- rings at r ≈ 0.38 (×75), 0.95 (×407); 8-fold (score 0.91); on the axes 33%, on the diagonals 28%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core 0.74 at 4 px; core lum 0.84, ground lum 0.000
- hues (by lit area): blue 240° 50%, violet 270° 39%, magenta 300° 10%; ground `#000000`, centre/edge ground brightness 1.00
- flow (6255 object tracks, 44% moving outward → mixed directions): radial speed ∝ r^0.13 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:-0.00, 0.21:-0.01, 0.39:-0.03, 0.61:+0.00, 0.87:-0.01, 1.22:-0.01; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.11 at r<0.45 vs 2.62 at r≥0.45; 35% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **9.83–12.83s** — transition at 11.33s (beat #23 r1, novelty 4.7); also transition at 11.93s (beat #24 r8, novelty 4.0); also transition at 12.67s (beat #25 r1, novelty 3.6); also every 10 s (no audio to place by) — 1 hard cut at 11.26s; brightness 0.60–0.73 — `bursts/009.83/timing.png` (every frame), `bursts/009.83/detail.png` (large), `bursts/009.83/motion.png` (paths / skeleton / t±1 in RGB)
- **16.63–19.63s** — transition at 18.13s (beat #36 r4, novelty 6.4) — no hard cut; 1 fade over 3–3 frames (100–100 ms, median 3); brightness 0.58–0.67 — `bursts/016.63/timing.png` (every frame), `bursts/016.63/detail.png` (large), `bursts/016.63/motion.png` (paths / skeleton / t±1 in RGB)
- **28.17–31.17s** — transition at 29.67s (beat #59 r1, novelty 3.5) — no hard cut; brightness 0.62–0.71, colour change 0.075/frame (cut ≥ 0.2) — `bursts/028.17/timing.png` (every frame), `bursts/028.17/detail.png` (large), `bursts/028.17/motion.png` (paths / skeleton / t±1 in RGB)
- **35.30–38.30s** — transition at 36.80s (beat #74 r2, novelty 2.5) — no hard cut; brightness 0.59–0.67, colour change 0.057/frame (cut ≥ 0.2) — `bursts/035.30/timing.png` (every frame), `bursts/035.30/detail.png` (large), `bursts/035.30/motion.png` (paths / skeleton / t±1 in RGB)
- **45.17–48.17s** — transition at 46.67s (beat #93 r1, novelty 2.4) — no hard cut; brightness 0.63–0.70, colour change 0.068/frame (cut ≥ 0.2) — `bursts/045.17/timing.png` (every frame), `bursts/045.17/detail.png` (large), `bursts/045.17/motion.png` (paths / skeleton / t±1 in RGB)
- **48.03–51.03s** — transition at 49.53s (beat #99 r1, novelty 2.9); also transition at 50.13s (beat #100 r4, novelty 2.5) — no hard cut but brightness swings 0.59–0.71 — `bursts/048.03/timing.png` (every frame), `bursts/048.03/detail.png` (large), `bursts/048.03/motion.png` (paths / skeleton / t±1 in RGB)
- **54.90–57.90s** — transition at 56.40s (beat #113 r1, novelty 5.2); also transition at 55.87s (beat #112 r16, novelty 3.4) — no hard cut; 3 fades over 1–3 frames (33–100 ms, median 1); brightness 0.57–0.65 — `bursts/054.90/timing.png` (every frame), `bursts/054.90/detail.png` (large), `bursts/054.90/motion.png` (paths / skeleton / t±1 in RGB)
- **56.43–59.43s** — transition at 57.93s (beat #116 r4, novelty 5.1); also every 10 s (no audio to place by) — no hard cut; 3 fades over 1–1 frames (33–33 ms, median 1); brightness 0.58–0.67 — `bursts/056.43/timing.png` (every frame), `bursts/056.43/detail.png` (large), `bursts/056.43/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#b28dab`×0.30 `#bab9d8`×0.22 `#e7e2ef`×0.17 `#bc445c`×0.17 `#557ccd`×0.14
- 2-fold rotational symmetry (r 0.99); mirror symmetry, ~2 axes (r 0.70); centre brightness 0.65 vs edge 0.65; mean brightness 0.65, dark frames 0%; saturation 0.31
- motion: zoom mean +0.210 (|zoom| 0.679) log-scale/s, rotation mean +7.0° (|rot| 31.4°)/s, frame-to-frame activity 0.119

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 8 | -0.11 | +0.25 | +0.19 | +0.53 | -0.40 |
| 8 | 7 | +0.23 | +0.78 | +0.58 | +0.60 | +0.45 |
| 4 | 15 | +0.11 | +1.13 | +0.38 | +0.34 | +0.42 |
| 2 | 30 | +0.14 | +0.12 | +0.23 | +0.46 | +0.09 |
| 1 | 60 | +0.15 | +0.47 | +0.20 | +0.07 | +0.33 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.67 | #3 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 11.33 | #23 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 11.93 | #24 | -67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset, blackout |
| 12.67 | #25 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 18.13 | #36 | +133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r4), no onset, looks like a cut, → probably not audio-driven |
| 21.00 | #42 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 26.93 | #54 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 29.67 | #59 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, flash, → probably not audio-driven |
| 36.80 | #74 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, looks like a cut, → probably not audio-driven |
| 46.67 | #93 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, blackout, → probably not audio-driven |
| 49.53 | #99 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, blackout |
| 50.13 | #100 | +133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r4), no onset, → probably not audio-driven |
| 55.87 | #112 | -133 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r16), no onset, looks like a cut, → probably not audio-driven |
| 56.40 | #113 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 57.93 | #116 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): sat +1.5σ
- beat #20 (r4, 10.00s): act +1.0σ, zoom +1.0σ, abszoom +1.1σ
- beat #28 (r4, 14.00s): zoom -1.8σ, abszoom -1.0σ
- beat #32 (r16, 16.00s): zoom +0.8σ, abszoom +0.9σ
- beat #36 (r4, 18.00s): sat -1.4σ, act -0.9σ
- beat #40 (r8, 20.00s): sat +1.9σ, act +1.1σ, zoom +0.8σ
- beat #44 (r4, 22.00s): bright +1.1σ, sat -0.9σ
- beat #52 (r4, 26.00s): abszoom +1.2σ
- beat #56 (r8, 28.00s): zoom +1.2σ, abszoom -1.4σ
- beat #60 (r4, 30.00s): rot -1.0σ
- beat #64 (r16, 32.00s): bright -1.4σ, rot +1.5σ
- beat #68 (r4, 34.00s): abszoom -0.9σ, rot -0.9σ
- beat #72 (r8, 36.00s): bright -1.1σ, abszoom -1.4σ, rot +1.0σ
- beat #80 (r16, 40.00s): bright +1.6σ, act +1.0σ
- beat #84 (r4, 42.00s): abszoom -0.9σ
- beat #88 (r8, 44.00s): sat +0.9σ, act +1.1σ, zoom +0.9σ, abszoom +1.9σ
- beat #96 (r16, 48.00s): zoom +1.6σ, abszoom +0.9σ, rot +1.0σ
- beat #100 (r4, 50.00s): bright -1.4σ, zoom -1.1σ, rot -1.3σ
- beat #108 (r4, 54.00s): sat +0.9σ
- beat #112 (r16, 56.00s): sat -2.9σ, act -1.9σ
- beat #116 (r4, 58.00s): bright +1.2σ, sat +1.1σ

## Files

- `slitscan.png` — the whole clip, 15 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/009.83/timing.png` … — burst 9.83–12.83s (cut): transition at 11.33s (beat #23 r1, novelty 4.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/016.63/timing.png` … — burst 16.63–19.63s (fades): transition at 18.13s (beat #36 r4, novelty 6.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/028.17/timing.png` … — burst 28.17–31.17s (continuous): transition at 29.67s (beat #59 r1, novelty 3.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/035.30/timing.png` … — burst 35.30–38.30s (continuous): transition at 36.80s (beat #74 r2, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/045.17/timing.png` … — burst 45.17–48.17s (continuous): transition at 46.67s (beat #93 r1, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/048.03/timing.png` … — burst 48.03–51.03s (flash): transition at 49.53s (beat #99 r1, novelty 2.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/054.90/timing.png` … — burst 54.90–57.90s (fades): transition at 56.40s (beat #113 r1, novelty 5.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/056.43/timing.png` … — burst 56.43–59.43s (fades): transition at 57.93s (beat #116 r4, novelty 5.1). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py brush-teeth --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
