# ref bundle: liquid-waves-Qj80

`tools/.cache/refs/_downloads/Qj80Mie5N0c.mp4` — 0.0+40.0s. no usable audio (no audio stream).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (no audio stream): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 40 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 21 single transitions at t 1.5, 3.9, 4.8, 6.1, 10.5, 12.3, 13.3, 13.6, 18.2, 19.4, 19.8, 21.2, 22.0, 27.3, 28.4, 28.7, 30.1, 35.1, 36.1, 36.8, 38.3
- zoom direction changes at beat #32 (r16, 16.0s, -1.2σ)
- zoom direction changes at beat #68 (r4, 34.0s, -1.4σ)
- zoom direction changes at beat #72 (r8, 36.0s, +1.2σ)
- rotates counter-clockwise continuously (+0.7°/s)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 24% of the clip, 36.87s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 409 lit objects on 1280×720 (lit floor 0.30, lit 35.8% of pixels): 248 bar, 91 blob, 31 disc, 27 panel, 8 hex ring, 2 ring, 2 frame; outlines 3%, fills 97%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.40 over 70 gates: 0.255 half-heights at r 0.3, 0.164 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.139, r0.3-0.6 → 0.392, r0.6-1.0 → 0.532, r>1 → 0.437
- rings at r ≈ 0.38 (×30), 1.50 (×128); 2-fold (score 0.88); on the axes 44%, on the diagonals 14%
- stroke (outlines): 3.8 px at r<0.45, 4.6 px at r≥0.45; glow e-fold 16.6 px, halo/core 0.36 at 4 px; core lum 0.60, ground lum 0.000
- hues (by lit area): spring 150° 82%, green 120° 14%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1523 object tracks, 47% moving outward → mixed directions): radial speed ∝ r^0.01 (not a zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:+0.00, 0.39:-0.00, 0.61:+0.01, 0.87:-0.02, 1.22:+0.00; rotation +0.1°/s (+ = counter-clockwise on screen)
- streak: median elongation 5.63 at r<0.45 vs 3.75 at r≥0.45; 37% of elongated objects lie along the radial direction

### Regime 2 — 23% of the clip, 8.73s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 414 lit objects on 1280×720 (lit floor 0.29, lit 34.7% of pixels): 255 bar, 86 blob, 41 disc, 25 panel, 6 hex ring, 1 frame; outlines 2%, fills 98%; 88% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.36 over 73 gates: 0.185 half-heights at r 0.3, 0.124 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.307, r0.3-0.6 → 0.577, r0.6-1.0 → 0.578, r>1 → 0.415
- rings at r ≈ 1.50 (×132); 2-fold (score 0.94); on the axes 46%, on the diagonals 13%
- stroke (outlines): None px at r<0.45, 4.2 px at r≥0.45; glow e-fold 22.8 px, halo/core 0.36 at 4 px; core lum 0.58, ground lum 0.000
- hues (by lit area): spring 150° 88%, green 120° 9%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1521 object tracks, 52% moving outward → mixed directions): radial speed ∝ r^-0.05 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.04, 0.39:-0.01, 0.61:+0.01, 0.87:+0.00, 1.22:+0.01; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 6.0 at r<0.45 vs 3.98 at r≥0.45; 34% of elongated objects lie along the radial direction

### Regime 3 — 20% of the clip, 14.53s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 401 lit objects on 1280×720 (lit floor 0.29, lit 35.1% of pixels): 225 bar, 80 blob, 44 panel, 35 disc, 10 hex ring, 4 frame, 3 ring; outlines 4%, fills 96%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.35 over 96 gates: 0.209 half-heights at r 0.3, 0.142 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.656, r0.3-0.6 → 0.271, r0.6-1.0 → 0.346, r>1 → 0.357
- rings at r ≈ 0.42 (×27), 0.95 (×101), 1.50 (×122); 2-fold (score 0.93); on the axes 42%, on the diagonals 15%
- stroke (outlines): 3.8 px at r<0.45, 4.6 px at r≥0.45; glow e-fold 21.1 px, halo/core 0.35 at 4 px; core lum 0.59, ground lum 0.000
- hues (by lit area): spring 150° 89%, green 120° 8%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1582 object tracks, 50% moving outward → mixed directions): radial speed ∝ r^0.05 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.01, 0.21:-0.01, 0.39:+0.03, 0.61:+0.00, 0.87:+0.00, 1.22:+0.01; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.0 at r<0.45 vs 3.55 at r≥0.45; 36% of elongated objects lie along the radial direction

### Regime 4 — 18% of the clip, 2.80s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 384 lit objects on 1280×720 (lit floor 0.29, lit 35.2% of pixels): 241 bar, 74 blob, 32 panel, 26 disc, 6 hex ring, 3 frame, 2 ring; outlines 3%, fills 97%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.13 over 69 gates: 0.181 half-heights at r 0.3, 0.157 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.104, r0.3-0.6 → 0.356, r0.6-1.0 → 0.403, r>1 → 0.446
- rings at r ≈ 0.34 (×29), 0.67 (×47), 1.68 (×114); 2-fold (score 0.89); on the axes 40%, on the diagonals 14%
- stroke (outlines): 3.8 px at r<0.45, 4.6 px at r≥0.45; glow e-fold 21.8 px, halo/core 0.36 at 4 px; core lum 0.59, ground lum 0.000
- hues (by lit area): spring 150° 84%, green 120° 12%; ground `#000000`, centre/edge ground brightness 1.00
- flow (1465 object tracks, 43% moving outward → mixed directions): radial speed ∝ r^0.15 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:-0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 6.58 at r<0.45 vs 3.57 at r≥0.45; 34% of elongated objects lie along the radial direction

### Regime 5 — 15% of the clip, 0.40s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 384 lit objects on 1280×720 (lit floor 0.29, lit 35.2% of pixels): 226 bar, 91 blob, 32 panel, 23 disc, 8 hex ring, 2 ring, 2 frame; outlines 3%, fills 97%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.59 over 66 gates: 0.348 half-heights at r 0.3, 0.181 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.912, r0.3-0.6 → 0.436, r0.6-1.0 → 0.346, r>1 → 0.443
- rings at r ≈ 0.95 (×96), 1.68 (×105); 2-fold (score 0.93); on the axes 41%, on the diagonals 15%
- stroke (outlines): 4.2 px at r<0.45, 3.8 px at r≥0.45; glow e-fold 3.3 px, halo/core 0.14 at 4 px; core lum 0.59, ground lum 0.140
- hues (by lit area): spring 150° 87%, green 120° 10%; ground `#033004`, centre/edge ground brightness 1.00
- flow (1393 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^-0.53 (not a zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:-0.04, 0.21:+0.03, 0.39:-0.04, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.95 at r<0.45 vs 3.58 at r≥0.45; 41% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.03–3.03s** — transition at 1.53s (beat #3 r1, novelty 2.5); also every 10 s (no audio to place by) — no hard cut; brightness 0.35–0.37, colour change 0.016/frame (cut ≥ 0.2) — `bursts/000.03/timing.png` (every frame), `bursts/000.03/detail.png` (large), `bursts/000.03/motion.png` (paths / skeleton / t±1 in RGB)
- **2.43–5.43s** — transition at 3.93s (beat #8 r8, novelty 2.5); also transition at 4.80s (beat #10 r2, novelty 2.4) — no hard cut; brightness 0.36–0.38, colour change 0.019/frame (cut ≥ 0.2) — `bursts/002.43/timing.png` (every frame), `bursts/002.43/detail.png` (large), `bursts/002.43/motion.png` (paths / skeleton / t±1 in RGB)
- **4.57–7.57s** — transition at 6.07s (beat #12 r4, novelty 2.4) — no hard cut; brightness 0.35–0.38, colour change 0.017/frame (cut ≥ 0.2) — `bursts/004.57/timing.png` (every frame), `bursts/004.57/detail.png` (large), `bursts/004.57/motion.png` (paths / skeleton / t±1 in RGB)
- **11.77–14.77s** — transition at 13.27s (beat #27 r1, novelty 3.6); also transition at 13.60s (beat #27 r1, novelty 3.1); also transition at 12.33s (beat #25 r1, novelty 2.7) — no hard cut; brightness 0.36–0.38, colour change 0.018/frame (cut ≥ 0.2) — `bursts/011.77/timing.png` (every frame), `bursts/011.77/detail.png` (large), `bursts/011.77/motion.png` (paths / skeleton / t±1 in RGB)
- **16.70–19.70s** — transition at 18.20s (beat #36 r4, novelty 2.4); also transition at 19.40s (beat #39 r1, novelty 1.6) — no hard cut; brightness 0.35–0.37, colour change 0.017/frame (cut ≥ 0.2) — `bursts/016.70/timing.png` (every frame), `bursts/016.70/detail.png` (large), `bursts/016.70/motion.png` (paths / skeleton / t±1 in RGB)
- **18.30–21.30s** — transition at 19.80s (beat #40 r8, novelty 2.4); also transition at 21.20s (beat #42 r2, novelty 2.1) — no hard cut; brightness 0.35–0.38, colour change 0.018/frame (cut ≥ 0.2) — `bursts/018.30/timing.png` (every frame), `bursts/018.30/detail.png` (large), `bursts/018.30/motion.png` (paths / skeleton / t±1 in RGB)
- **28.57–31.57s** — transition at 30.07s (beat #60 r4, novelty 4.1); also transition at 28.73s (beat #57 r1, novelty 2.9); also every 10 s (no audio to place by) — no hard cut; brightness 0.36–0.38, colour change 0.019/frame (cut ≥ 0.2) — `bursts/028.57/timing.png` (every frame), `bursts/028.57/detail.png` (large), `bursts/028.57/motion.png` (paths / skeleton / t±1 in RGB)
- **34.57–37.57s** — transition at 36.07s (beat #72 r8, novelty 2.6); also transition at 36.80s (beat #74 r2, novelty 2.3); also transition at 35.07s (beat #70 r2, novelty 1.7) — no hard cut; brightness 0.35–0.38, colour change 0.019/frame (cut ≥ 0.2) — `bursts/034.57/timing.png` (every frame), `bursts/034.57/detail.png` (large), `bursts/034.57/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#01371d`×0.34 `#076642`×0.22 `#059e18`×0.21 `#0adc2d`×0.14 `#0dc3a3`×0.09
- no radial symmetry (rotational r 0.13, mirror r 0.20); centre brightness 0.31 vs edge 0.32; mean brightness 0.32, dark frames 0%; saturation 0.95
- motion: zoom mean -0.011 (|zoom| 0.022) log-scale/s, rotation mean +0.7° (|rot| 0.7°)/s, frame-to-frame activity 0.025

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 5 | -1.01 | +0.91 | -0.69 | -0.34 | +0.28 |
| 8 | 5 | +1.18 | +1.34 | +0.71 | +0.08 | -0.44 |
| 4 | 10 | +0.35 | +1.32 | +0.35 | +0.38 | +0.42 |
| 2 | 20 | +0.22 | +0.86 | +0.14 | +0.12 | +0.22 |
| 1 | 40 | +0.17 | +0.98 | +0.15 | +0.15 | +0.22 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.53 | #3 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 3.93 | #8 | -67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 4.80 | #10 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, → probably not audio-driven |
| 6.07 | #12 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 10.53 | #21 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 12.33 | #25 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 13.27 | #27 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 13.60 | #27 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut |
| 18.20 | #36 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 19.40 | #39 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, → probably not audio-driven |
| 19.80 | #40 | -200 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r8), no onset, → probably not audio-driven |
| 21.20 | #42 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 22.00 | #44 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 27.27 | #55 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 28.40 | #57 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, → probably not audio-driven |
| 28.73 | #57 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 30.07 | #60 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 35.07 | #70 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 36.07 | #72 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 36.80 | #74 | -200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r2), no onset, flash, → probably not audio-driven |
| 38.33 | #77 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): rot -1.5σ
- beat #8 (r8, 4.00s): sat -1.0σ
- beat #12 (r4, 6.00s): bright -0.9σ, sat +0.8σ, act -1.1σ
- beat #20 (r4, 10.00s): sat +0.9σ
- beat #24 (r8, 12.00s): bright -0.9σ, sat +1.0σ, act +1.0σ
- beat #28 (r4, 14.00s): act -1.8σ
- beat #32 (r16, 16.00s): act +0.9σ, zoom -1.2σ
- beat #36 (r4, 18.00s): sat +1.6σ, abszoom +0.9σ
- beat #40 (r8, 20.00s): bright +1.9σ, abszoom -1.0σ, rot -1.1σ
- beat #44 (r4, 22.00s): bright +1.1σ, act -1.0σ
- beat #48 (r16, 24.00s): rot +1.1σ
- beat #52 (r4, 26.00s): bright +1.2σ, sat +1.2σ
- beat #56 (r8, 28.00s): act +0.8σ, rot -0.9σ
- beat #60 (r4, 30.00s): bright +1.5σ, sat +2.0σ
- beat #64 (r16, 32.00s): sat -1.0σ, abszoom -0.9σ
- beat #68 (r4, 34.00s): zoom -1.4σ, abszoom +1.9σ, rot +1.4σ
- beat #72 (r8, 36.00s): bright +1.0σ, sat +1.5σ, zoom +1.2σ, abszoom -1.7σ, rot -1.3σ
- beat #76 (r4, 38.00s): bright -1.4σ, sat -1.0σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.03/timing.png` … — burst 0.03–3.03s (continuous): transition at 1.53s (beat #3 r1, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.43/timing.png` … — burst 2.43–5.43s (continuous): transition at 3.93s (beat #8 r8, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/004.57/timing.png` … — burst 4.57–7.57s (continuous): transition at 6.07s (beat #12 r4, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/011.77/timing.png` … — burst 11.77–14.77s (continuous): transition at 13.27s (beat #27 r1, novelty 3.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/016.70/timing.png` … — burst 16.70–19.70s (continuous): transition at 18.20s (beat #36 r4, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/018.30/timing.png` … — burst 18.30–21.30s (continuous): transition at 19.80s (beat #40 r8, novelty 2.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/028.57/timing.png` … — burst 28.57–31.57s (continuous): transition at 30.07s (beat #60 r4, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/034.57/timing.png` … — burst 34.57–37.57s (continuous): transition at 36.07s (beat #72 r8, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py liquid-waves-Qj80 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png` ← the rank that reacts hardest
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
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
