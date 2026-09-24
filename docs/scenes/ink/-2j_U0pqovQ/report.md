# ref bundle: -2j_U0pqovQ

`tools/.cache/refs/_downloads/-2j_U0pqovQ.mp4` — 0.0+30.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- no hard cuts at 30 fps in 30 s: every transition below is a fade or a motion
- 7 single transitions at t 0.9, 2.1, 3.3, 14.1, 15.4, 16.9, 17.5
- zoom direction changes at beat #28 (r4, 14.0s, +1.2σ)
- zoom direction changes at beat #32 (r16, 16.0s, -2.3σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 38% of the clip, 25.13s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.11, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.922
- hues (by lit area): ; ground `#ebeaeb`, centre/edge ground brightness 0.39
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 2 — 26% of the clip, 3.87s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.03, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.900
- hues (by lit area): ; ground `#e4e5e6`, centre/edge ground brightness 0.44
- flow (1718 object tracks, 42% moving outward → mixed directions): radial speed ∝ r^0.96 (a flat zoom) 0.18 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:-0.00, 0.87:-0.05, 1.22:-0.06; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 3 — 16% of the clip, 21.47s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.04, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.901
- hues (by lit area): ; ground `#e9e4e4`, centre/edge ground brightness 0.34
- flow (1212 object tracks, 44% moving outward → mixed directions): radial speed ∝ r^1.35 (a flat zoom) 0.12 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.02, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 4 — 11% of the clip, 0.60s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.03, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.877
- hues (by lit area): ; ground `#dedfe0`, centre/edge ground brightness 0.46
- flow (890 object tracks, 31% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.47 (not a zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.00, 0.39:+0.00, 0.61:-0.02, 0.87:-0.03, 1.22:-0.05; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 5 — 9% of the clip, 16.80s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 253 lit objects on 1280×720 (lit floor 0.97, lit 21.4% of pixels): 150 bar, 51 blob, 26 panel, 23 disc, 3 hex ring; outlines 1%, fills 99%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.44 over 52 gates: 0.150 half-heights at r 0.3, 0.093 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 1.983, r0.3-0.6 → 0.595, r0.6-1.0 → 0.923, r>1 → 0.694
- rings at r ≈ 0.75 (×81), 0.95 (×75); 2-fold (score 0.91); on the axes 42%, on the diagonals 38%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core -53.15 at 4 px; core lum 1.00, ground lum 0.986
- hues (by lit area): white 0° 100%; ground `#fcfbfb`, centre/edge ground brightness 0.12
- flow (468 object tracks, 38% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.69 (a flat zoom) 0.12 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.04, 0.39:+0.00, 0.61:-0.03, 0.87:-0.06, 1.22:-0.09; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.96 at r<0.45 vs 4.04 at r≥0.45; 39% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.57–3.57s** — transition at 2.07s (beat #4 r4, novelty 1.9); also transition at 3.27s (beat #7 r1, novelty 1.9); also transition at 0.87s (beat #2 r2, novelty 1.8); also every 10 s (no audio to place by) — no hard cut; brightness 0.87–0.89, colour change 0.010/frame (cut ≥ 0.2) — `bursts/000.57/timing.png` (every frame), `bursts/000.57/detail.png` (large), `bursts/000.57/motion.png` (paths / skeleton / t±1 in RGB)
- **10.00–13.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.91–0.92, colour change 0.005/frame (cut ≥ 0.2) — `bursts/010.00/timing.png` (every frame), `bursts/010.00/detail.png` (large), `bursts/010.00/motion.png` (paths / skeleton / t±1 in RGB)
- **13.90–16.90s** — transition at 15.40s (beat #31 r1, novelty 10.4); also transition at 16.87s (beat #34 r2, novelty 5.0); also transition at 14.07s (beat #28 r4, novelty 1.9) — no hard cut; brightness 0.85–0.93, colour change 0.016/frame (cut ≥ 0.2) — `bursts/013.90/timing.png` (every frame), `bursts/013.90/detail.png` (large), `bursts/013.90/motion.png` (paths / skeleton / t±1 in RGB)
- **15.97–18.97s** — transition at 17.47s (beat #35 r1, novelty 3.2) — no hard cut; brightness 0.84–0.88, colour change 0.013/frame (cut ≥ 0.2) — `bursts/015.97/timing.png` (every frame), `bursts/015.97/detail.png` (large), `bursts/015.97/motion.png` (paths / skeleton / t±1 in RGB)
- **20.00–23.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.88–0.91, colour change 0.008/frame (cut ≥ 0.2) — `bursts/020.00/timing.png` (every frame), `bursts/020.00/detail.png` (large), `bursts/020.00/motion.png` (paths / skeleton / t±1 in RGB)
- **27.00–30.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.89–0.92, colour change 0.006/frame (cut ≥ 0.2) — `bursts/027.00/timing.png` (every frame), `bursts/027.00/detail.png` (large), `bursts/027.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#fafafa`×0.83 `#c6c0c1`×0.07 `#1c1f1e`×0.05 `#776f6e`×0.04 `#811616`×0.01
- no radial symmetry (rotational r 0.04, mirror r 0.22); centre brightness 0.21 vs edge 0.91; mean brightness 0.84, dark frames 0%; saturation 0.04
- motion: zoom mean -0.005 (|zoom| 0.058) log-scale/s, rotation mean -0.1° (|rot| 0.7°)/s, frame-to-frame activity 0.034

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 4 | +0.76 | +0.47 | -0.48 | +0.61 | +1.08 |
| 8 | 4 | +0.08 | +0.30 | +0.24 | +0.21 | +0.02 |
| 4 | 7 | +0.25 | +0.58 | +0.09 | +0.26 | +0.19 |
| 2 | 15 | +0.28 | +0.35 | +0.08 | +0.27 | +0.24 |
| 1 | 30 | +0.42 | +0.66 | +0.08 | +0.28 | +0.50 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.87 | #2 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 2.07 | #4 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 3.27 | #7 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 14.07 | #28 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 15.40 | #31 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut, blackout |
| 16.87 | #34 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 17.47 | #35 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #28 (r4, 14.00s): sat +0.9σ, act +1.0σ, zoom +1.2σ, abszoom +1.7σ
- beat #32 (r16, 16.00s): bright -1.0σ, zoom -2.3σ, rot -2.3σ
- beat #36 (r4, 18.00s): sat -1.4σ, act -1.0σ, rot +0.9σ
- beat #44 (r4, 22.00s): rot -1.0σ
- beat #52 (r4, 26.00s): bright -0.9σ
- beat #56 (r8, 28.00s): bright +1.1σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 15 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.57/timing.png` … — burst 0.57–3.57s (continuous): transition at 2.07s (beat #4 r4, novelty 1.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.00/timing.png` … — burst 10.00–13.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/013.90/timing.png` … — burst 13.90–16.90s (continuous): transition at 15.40s (beat #31 r1, novelty 10.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.97/timing.png` … — burst 15.97–18.97s (continuous): transition at 17.47s (beat #35 r1, novelty 3.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.00/timing.png` … — burst 20.00–23.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/027.00/timing.png` … — burst 27.00–30.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py -2j_U0pqovQ --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
