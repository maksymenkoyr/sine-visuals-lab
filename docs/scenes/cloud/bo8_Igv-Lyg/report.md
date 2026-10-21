# ref bundle: bo8_Igv-Lyg

`tools/.cache/refs/_downloads/bo8_Igv-Lyg.mp4` — 120.0+40.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 40 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 24 single transitions at t 1.3, 3.5, 4.1, 4.6, 7.8, 8.1, 9.7, 11.3, 11.9, 14.1, 16.1, 17.3, 19.5, 20.1, 20.6, 23.7, 24.1, 27.9, 30.1, 33.3, 35.5, 36.1, 36.7, 39.8
- zoom direction changes at beat #28 (r4, 14.0s, -1.2σ)
- zoom direction changes at beat #60 (r4, 30.0s, -1.2σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 34% of the clip, 3.73s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.038
- hues (by lit area): ; ground `#000082`, centre/edge ground brightness 1.10
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 2 — 25% of the clip, 31.07s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.037
- hues (by lit area): ; ground `#00007f`, centre/edge ground brightness 0.75
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 3 — 24% of the clip, 34.53s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.037
- hues (by lit area): ; ground `#000080`, centre/edge ground brightness 0.99
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 4 — 15% of the clip, 7.40s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.036
- hues (by lit area): ; ground `#00007d`, centre/edge ground brightness 0.75
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 5 — 1% of the clip, 14.00s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.037
- hues (by lit area): ; ground `#000081`, centre/edge ground brightness 0.91
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **2.57–5.57s** — transition at 4.07s (beat #8 r8, novelty 4.1); also transition at 4.60s (beat #9 r1, novelty 2.6); also transition at 3.47s (beat #7 r1, novelty 1.9) — no hard cut; brightness 0.04–0.04, colour change 0.007/frame (cut ≥ 0.2) — `bursts/002.57/timing.png` (every frame), `bursts/002.57/detail.png` (large), `bursts/002.57/motion.png` (paths / skeleton / t±1 in RGB)
- **6.30–9.30s** — transition at 7.80s (beat #16 r16, novelty 4.5); also transition at 8.07s (beat #16 r16, novelty 2.9) — no hard cut; brightness 0.03–0.04, colour change 0.007/frame (cut ≥ 0.2) — `bursts/006.30/timing.png` (every frame), `bursts/006.30/detail.png` (large), `bursts/006.30/motion.png` (paths / skeleton / t±1 in RGB)
- **12.57–15.57s** — transition at 14.07s (beat #28 r4, novelty 5.2) — no hard cut; brightness 0.04–0.04, colour change 0.007/frame (cut ≥ 0.2) — `bursts/012.57/timing.png` (every frame), `bursts/012.57/detail.png` (large), `bursts/012.57/motion.png` (paths / skeleton / t±1 in RGB)
- **18.57–21.57s** — transition at 20.07s (beat #40 r8, novelty 4.1); also transition at 20.60s (beat #41 r1, novelty 2.6); also transition at 19.47s (beat #39 r1, novelty 1.9); also every 10 s (no audio to place by) — no hard cut; brightness 0.04–0.04, colour change 0.007/frame (cut ≥ 0.2) — `bursts/018.57/timing.png` (every frame), `bursts/018.57/detail.png` (large), `bursts/018.57/motion.png` (paths / skeleton / t±1 in RGB)
- **22.23–25.23s** — transition at 23.73s (beat #47 r1, novelty 4.6); also transition at 24.07s (beat #48 r16, novelty 2.1) — no hard cut; brightness 0.03–0.04, colour change 0.007/frame (cut ≥ 0.2) — `bursts/022.23/timing.png` (every frame), `bursts/022.23/detail.png` (large), `bursts/022.23/motion.png` (paths / skeleton / t±1 in RGB)
- **28.57–31.57s** — transition at 30.07s (beat #60 r4, novelty 4.1); also every 10 s (no audio to place by) — no hard cut; brightness 0.04–0.04, colour change 0.007/frame (cut ≥ 0.2) — `bursts/028.57/timing.png` (every frame), `bursts/028.57/detail.png` (large), `bursts/028.57/motion.png` (paths / skeleton / t±1 in RGB)
- **34.57–37.57s** — transition at 36.07s (beat #72 r8, novelty 4.5); also transition at 35.47s (beat #71 r1, novelty 2.0); also transition at 36.67s (beat #73 r1, novelty 1.8) — no hard cut; brightness 0.04–0.04, colour change 0.006/frame (cut ≥ 0.2) — `bursts/034.57/timing.png` (every frame), `bursts/034.57/detail.png` (large), `bursts/034.57/motion.png` (paths / skeleton / t±1 in RGB)
- **37.00–40.00s** — transition at 39.80s (beat #79 r1, novelty 4.8); also every 10 s (no audio to place by) — no hard cut; brightness 0.04–0.04, colour change 0.007/frame (cut ≥ 0.2) — `bursts/037.00/timing.png` (every frame), `bursts/037.00/detail.png` (large), `bursts/037.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#00005d`×0.22 `#00007e`×0.22 `#00003e`×0.21 `#0000a5`×0.19 `#0000d4`×0.17
- 12-fold rotational symmetry (r 0.30); mirror symmetry, ~1 axis (r 0.41); centre brightness 0.06 vs edge 0.06; mean brightness 0.06, dark frames 100%; saturation 1.00
- motion: zoom mean -0.000 (|zoom| 0.008) log-scale/s, rotation mean +0.0° (|rot| 0.4°)/s, frame-to-frame activity 0.001

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 5 | +0.74 | +2.89 | -1.60 | +1.45 | +1.40 |
| 8 | 5 | +4.17 | +1.16 | +1.32 | +0.41 | -0.69 |
| 4 | 10 | +1.70 | +1.30 | +0.13 | +1.70 | +0.51 |
| 2 | 20 | +0.29 | +0.36 | +0.13 | +0.54 | +0.56 |
| 1 | 40 | +0.44 | +1.02 | +0.09 | +0.56 | +0.67 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.33 | #3 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 3.47 | #7 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 4.07 | #8 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 4.60 | #9 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut |
| 7.80 | #16 | -200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r16), no onset, → probably not audio-driven |
| 8.07 | #16 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 9.73 | #19 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, → probably not audio-driven |
| 11.33 | #23 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 11.87 | #24 | -133 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r8), no onset, → probably not audio-driven |
| 14.07 | #28 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 16.07 | #32 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 17.33 | #35 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 19.47 | #39 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 20.07 | #40 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 20.60 | #41 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 23.73 | #47 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 24.07 | #48 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 27.87 | #56 | -133 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r8), no onset, → probably not audio-driven |
| 30.07 | #60 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 33.33 | #67 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 35.47 | #71 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 36.07 | #72 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 36.67 | #73 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 39.80 | #79 | +300 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.60 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): abszoom -1.1σ
- beat #8 (r8, 4.00s): bright +0.8σ, abszoom +1.0σ
- beat #12 (r4, 6.00s): bright -1.5σ, sat +1.1σ, zoom -1.1σ, abszoom +1.6σ, rot +1.0σ
- beat #16 (r16, 8.00s): zoom +1.0σ, abszoom -0.8σ
- beat #20 (r4, 10.00s): abszoom -1.0σ
- beat #24 (r8, 12.00s): bright +0.8σ, rot -1.0σ
- beat #28 (r4, 14.00s): bright -1.5σ, zoom -1.2σ, abszoom +1.6σ, rot +0.9σ
- beat #32 (r16, 16.00s): zoom +1.0σ, abszoom -0.9σ
- beat #36 (r4, 18.00s): abszoom -1.1σ
- beat #40 (r8, 20.00s): bright +0.8σ, abszoom +1.0σ
- beat #44 (r4, 22.00s): bright -1.5σ, sat +1.1σ, zoom -1.1σ, abszoom +1.6σ, rot +1.0σ
- beat #48 (r16, 24.00s): zoom +0.9σ, abszoom -0.8σ
- beat #52 (r4, 26.00s): abszoom -1.1σ
- beat #56 (r8, 28.00s): bright +0.8σ, rot -0.9σ
- beat #60 (r4, 30.00s): bright -1.5σ, zoom -1.2σ, abszoom +1.8σ, rot +1.2σ
- beat #64 (r16, 32.00s): sat -0.9σ, zoom +0.9σ
- beat #68 (r4, 34.00s): abszoom -1.1σ
- beat #72 (r8, 36.00s): bright +0.8σ, abszoom +0.9σ, rot -0.9σ
- beat #76 (r4, 38.00s): bright -1.5σ, zoom -1.2σ, abszoom +1.6σ, rot +1.0σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 15 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/002.57/timing.png` … — burst 2.57–5.57s (continuous): transition at 4.07s (beat #8 r8, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.30/timing.png` … — burst 6.30–9.30s (continuous): transition at 7.80s (beat #16 r16, novelty 4.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.57/timing.png` … — burst 12.57–15.57s (continuous): transition at 14.07s (beat #28 r4, novelty 5.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/018.57/timing.png` … — burst 18.57–21.57s (continuous): transition at 20.07s (beat #40 r8, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.23/timing.png` … — burst 22.23–25.23s (continuous): transition at 23.73s (beat #47 r1, novelty 4.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/028.57/timing.png` … — burst 28.57–31.57s (continuous): transition at 30.07s (beat #60 r4, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/034.57/timing.png` … — burst 34.57–37.57s (continuous): transition at 36.07s (beat #72 r8, novelty 4.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/037.00/timing.png` … — burst 37.00–40.00s (continuous): transition at 39.80s (beat #79 r1, novelty 4.8). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py bo8_Igv-Lyg --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
