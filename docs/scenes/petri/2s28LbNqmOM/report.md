# ref bundle: 2s28LbNqmOM

`tools/.cache/refs/_downloads/2s28LbNqmOM.mp4` — 0.0+19.3s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 15 hard cuts in 19 s, densest second 5 cuts at 14s; holds between cuts 33–7400 ms (median 133) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 1 strobe stretch(es), flashes every 0.33 s (3.0 Hz), at t 5.5
- 6 single transitions at t 0.4, 2.9, 13.5, 14.1, 14.7, 17.5
- zoom direction changes at beat #12 (r4, 6.0s, +1.3σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 59% of the clip, 9.07s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 106 lit objects on 1280×720 (lit floor 0.48, lit 11.1% of pixels): 75 blob, 16 disc, 11 bar, 4 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.01 over 20 gates: 0.163 half-heights at r 0.3, 0.165 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.207, r0.3-0.6 → 0.246, r0.6-1.0 → 0.181, r>1 → 0.195
- rings at r ≈ 0.38 (×6), 0.53 (×8), 1.50 (×36); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -0.68 at 4 px; core lum 0.61, ground lum 0.467
- hues (by lit area): white 0° 100%; ground `#777777`, centre/edge ground brightness 1.00
- flow (1115 object tracks, 48% moving outward → mixed directions): radial speed ∝ r^-0.44 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.07, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.71 at r<0.45 vs 2.16 at r≥0.45; 54% of elongated objects lie along the radial direction

### Regime 2 — 30% of the clip, 3.60s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 118 lit objects on 1280×720 (lit floor 0.51, lit 18.9% of pixels): 56 bar, 46 blob, 10 disc, 6 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.04 over 16 gates: 0.073 half-heights at r 0.3, 0.076 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.730, r0.3-0.6 → 0.450, r0.6-1.0 → 0.698, r>1 → 0.532
- rings at r ≈ 0.67 (×12), 1.68 (×44); 2-fold (score 0.74); on the axes 49%, on the diagonals 8%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -0.17 at 4 px; core lum 0.64, ground lum 0.465
- hues (by lit area): white 0° 100%; ground `#767676`, centre/edge ground brightness 0.78
- flow (928 object tracks, 41% moving outward → mixed directions): radial speed ∝ r^-0.36 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.06 at r<0.45 vs 2.91 at r≥0.45; 36% of elongated objects lie along the radial direction

### Regime 3 — 10% of the clip, 14.27s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 33 lit objects on 1280×720 (lit floor 0.40, lit 4.2% of pixels): 23 bar, 6 blob, 3 panel, 1 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.51 over 17 substantial objects: 0.639 half-heights at r 0.3, 0.365 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.786, r0.6-1.0 → 0.668, r>1 → 0.402
- rings at r ≈ 0.75 (×11), 1.34 (×9); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -0.10 at 4 px; core lum 0.56, ground lum 0.373
- hues (by lit area): white 0° 100%; ground `#5f5f5f`, centre/edge ground brightness 0.81
- flow (154 object tracks, 35% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.23 (a flat zoom) 0.13 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:-0.45, 0.61:-0.04, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 5.62 at r≥0.45; 65% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.40s (beat #1 r1, novelty 5.0); also transition at 2.93s (beat #6 r2, novelty 1.6); also every 10 s (no audio to place by) — 3 hard cuts, holds 167–433 ms (median 300); brightness 0.33–0.51 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **5.22–8.22s** — strobe 5.47–6.13s, flashes every 0.33s — 4 hard cuts, holds 33–200 ms (median 33); brightness 0.31–0.54 — `bursts/005.22/timing.png` (every frame), `bursts/005.22/detail.png` (large), `bursts/005.22/motion.png` (paths / skeleton / t±1 in RGB)
- **10.00–13.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.41–0.46, colour change 0.024/frame (cut ≥ 0.2) — `bursts/010.00/timing.png` (every frame), `bursts/010.00/detail.png` (large), `bursts/010.00/motion.png` (paths / skeleton / t±1 in RGB)
- **12.57–15.57s** — transition at 14.07s (beat #28 r4, novelty 7.8); also transition at 13.47s (beat #27 r1, novelty 5.0); also transition at 14.73s (beat #29 r1, novelty 3.3) — 6 hard cuts, holds 33–633 ms (median 133); brightness 0.35–0.53 — `bursts/012.57/timing.png` (every frame), `bursts/012.57/detail.png` (large), `bursts/012.57/motion.png` (paths / skeleton / t±1 in RGB)
- **15.97–18.97s** — transition at 17.47s (beat #35 r1, novelty 1.8) — no hard cut but brightness swings 0.40–0.51 — `bursts/015.97/timing.png` (every frame), `bursts/015.97/detail.png` (large), `bursts/015.97/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#707070`×0.37 `#8d8d8d`×0.23 `#5a5a5a`×0.23 `#3d3d3d`×0.09 `#b5b5b5`×0.08
- no radial symmetry (rotational r 0.12, mirror r 0.22); centre brightness 0.38 vs edge 0.40; mean brightness 0.40, dark frames 0%; saturation 0.00
- motion: zoom mean -0.033 (|zoom| 0.153) log-scale/s, rotation mean -0.7° (|rot| 6.1°)/s, frame-to-frame activity 0.030

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 3 | +1.01 | +0.31 | +0.34 | +1.24 | +0.64 |
| 8 | 2 | -0.50 | -0.12 | +0.35 | -0.24 | -0.22 |
| 4 | 5 | +0.79 | +2.43 | +0.03 | +0.31 | +0.20 |
| 2 | 10 | -0.01 | +0.40 | +0.28 | -0.15 | -0.11 |
| 1 | 19 | +0.53 | +0.75 | +0.39 | +0.46 | +0.15 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.40 | #1 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, blackout |
| 2.93 | #6 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 5.47 | #11 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 6.13s: 3 flashes every 0.33s = 0.67 beat (no simple fraction of a beat → own timer), starts on beat r1, no onset |
| 13.47 | #27 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, flash |
| 14.07 | #28 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, looks like a cut, blackout |
| 14.73 | #29 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, flash, → probably not audio-driven |
| 17.47 | #35 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, flash |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): bright +0.9σ
- beat #12 (r4, 6.00s): bright -1.6σ, act -1.0σ, zoom +1.3σ, abszoom -1.8σ
- beat #28 (r4, 14.00s): bright -1.6σ, act -1.3σ, zoom +1.0σ, abszoom -0.9σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 12 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (cuts): transition at 0.40s (beat #1 r1, novelty 5.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/005.22/timing.png` … — burst 5.22–8.22s (cuts): strobe 5.47–6.13s, flashes every 0.33s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.00/timing.png` … — burst 10.00–13.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.57/timing.png` … — burst 12.57–15.57s (cuts): transition at 14.07s (beat #28 r4, novelty 7.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.97/timing.png` … — burst 15.97–18.97s (flash): transition at 17.47s (beat #35 r1, novelty 1.8). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py 2s28LbNqmOM --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png` ← the rank that reacts hardest
- `sheets/rank8.png`
- `sheets/rank4.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
