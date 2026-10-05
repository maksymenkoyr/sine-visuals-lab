# ref bundle: colorem

`tools/.cache/refs/_downloads/colorem.mp4` — 0.0+20.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 7 hard cuts in 20 s, densest second 1 cuts at 4s; holds between cuts 1967–4000 ms (median 2000); 1 fade over 1–1 frames (33–33 ms, median 1) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 7 single transitions at t 4.0, 8.1, 10.0, 12.1, 14.0, 16.1, 18.1
- zoom direction changes at beat #28 (r4, 14.0s, -2.6σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 72% of the clip, 0.07s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 5 lit objects on 720×720 (lit floor 0.99, lit 0.0% of pixels): 3 bar, 1 disc, 1 blob; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → 0.029
- rings at r ≈ 1.06 (×5); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -1.10 at 4 px; core lum 1.00, ground lum 0.802
- hues (by lit area): white 0° 100%; ground `#caccd5`, centre/edge ground brightness 0.61
- flow (33 object tracks, 0% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed (no fit) ; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:—, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 10.0 at r≥0.45; 25% of elongated objects lie along the radial direction

### Regime 2 — 18% of the clip, 18.13s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 48 lit objects on 720×720 (lit floor 0.38, lit 43.3% of pixels): 41 bar, 3 blob, 2 panel, 2 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.30 over 24 substantial objects: 2.484 half-heights at r 0.3, 1.778 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 2.835, r0.3-0.6 → 3.586, r0.6-1.0 → 2.135, r>1 → 1.014
- rings at r ≈ 0.34 (×6), 0.95 (×24); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 56.7 px, halo/core 0.25 at 4 px; core lum 0.66, ground lum 0.118
- hues (by lit area): orange 30° 73%, red 0° 22%; ground `#500e1e`, centre/edge ground brightness 1.00
- flow (338 object tracks, 68% moving outward → objects fly toward the camera): radial speed ∝ r^-0.17 (not a zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.05, 0.39:-0.01, 0.61:+0.02, 0.87:+0.04, 1.22:+0.05; rotation +3.5°/s (+ = counter-clockwise on screen)
- streak: median elongation 13.73 at r<0.45 vs 6.65 at r≥0.45; 13% of elongated objects lie along the radial direction

### Regime 3 — 10% of the clip, 9.27s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 10 lit objects on 720×720 (lit floor 0.74, lit 4.2% of pixels): 5 bar, 2 disc, 1 hex ring, 1 ring, 1 panel; outlines 20%, fills 80%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.86 over 5 substantial objects: 0.730 half-heights at r 0.3, 0.282 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.983, r0.6-1.0 → —, r>1 → 0.188
- rings at r ≈ 0.38 (×5), 1.19 (×4); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 7.4 px at r<0.45, 1.9 px at r≥0.45; glow e-fold None px, halo/core -6.42 at 4 px; core lum 0.75, ground lum 0.727
- hues (by lit area): yellow 60° 66%, chartreuse 90° 17%, azure 210° 9%, orange 30° 8%; ground `#b3b9cb`, centre/edge ground brightness 0.74
- flow (66 object tracks, 23% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.89 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:-0.01, 0.21:—, 0.39:-0.01, 0.61:—, 0.87:—, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.64 at r<0.45 vs 5.85 at r≥0.45; 20% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.80–0.85, colour change 0.011/frame (cut ≥ 0.2) — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **2.50–5.50s** — transition at 4.00s (beat #8 r8, novelty 2.2) — 1 hard cut at 4.00s; brightness 0.79–0.84 — `bursts/002.50/timing.png` (every frame), `bursts/002.50/detail.png` (large), `bursts/002.50/motion.png` (paths / skeleton / t±1 in RGB)
- **6.57–9.57s** — transition at 8.07s (beat #16 r16, novelty 5.7) — 1 hard cut at 8.00s; brightness 0.68–0.86 — `bursts/006.57/timing.png` (every frame), `bursts/006.57/detail.png` (large), `bursts/006.57/motion.png` (paths / skeleton / t±1 in RGB)
- **8.50–11.50s** — transition at 10.00s (beat #20 r4, novelty 6.3) — 1 hard cut at 10.00s; brightness 0.66–0.76 — `bursts/008.50/timing.png` (every frame), `bursts/008.50/detail.png` (large), `bursts/008.50/motion.png` (paths / skeleton / t±1 in RGB)
- **10.57–13.57s** — transition at 12.07s (beat #24 r8, novelty 1.8); also every 10 s (no audio to place by) — 1 hard cut at 12.00s; brightness 0.75–0.85 — `bursts/010.57/timing.png` (every frame), `bursts/010.57/detail.png` (large), `bursts/010.57/motion.png` (paths / skeleton / t±1 in RGB)
- **12.50–15.50s** — transition at 14.00s (beat #28 r4, novelty 3.5) — 1 hard cut at 13.97s; brightness 0.75–0.85 — `bursts/012.50/timing.png` (every frame), `bursts/012.50/detail.png` (large), `bursts/012.50/motion.png` (paths / skeleton / t±1 in RGB)
- **14.57–17.57s** — transition at 16.07s (beat #32 r16, novelty 7.2) — 1 hard cut at 15.97s; brightness 0.52–0.78 — `bursts/014.57/timing.png` (every frame), `bursts/014.57/detail.png` (large), `bursts/014.57/motion.png` (paths / skeleton / t±1 in RGB)
- **16.57–19.57s** — transition at 18.07s (beat #36 r4, novelty 9.7); also every 10 s (no audio to place by) — 1 hard cut at 17.97s; brightness 0.45–0.83 — `bursts/016.57/timing.png` (every frame), `bursts/016.57/detail.png` (large), `bursts/016.57/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#dcdde0`×0.52 `#c0bfd5`×0.28 `#c9714f`×0.10 `#5665b1`×0.08 `#31213b`×0.03
- 12-fold rotational symmetry (r 0.36); mirror symmetry, ~1 axis (r 0.59); centre brightness 0.61 vs edge 0.77; mean brightness 0.75, dark frames 0%; saturation 0.19
- motion: zoom mean -0.035 (|zoom| 0.381) log-scale/s, rotation mean -4.6° (|rot| 11.5°)/s, frame-to-frame activity 0.016

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 3 | +3.27 | +5.24 | -0.45 | +1.46 | +3.26 |
| 8 | 3 | +2.84 | +1.60 | +0.76 | +1.91 | +6.62 |
| 4 | 5 | +4.69 | +4.02 | -0.05 | +3.24 | +4.49 |
| 2 | 10 | -0.09 | -0.02 | +0.03 | +0.20 | -0.10 |
| 1 | 20 | -0.12 | -0.11 | +0.04 | +0.23 | -0.15 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 4.00 | #8 | +0 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 8.07 | #16 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset, blackout |
| 10.00 | #20 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, looks like a cut |
| 12.07 | #24 | +67 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 14.00 | #28 | +0 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 16.07 | #32 | +67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset, blackout |
| 18.07 | #36 | +67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset, blackout |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #8 (r8, 4.00s): abszoom -1.9σ
- beat #16 (r16, 8.00s): bright -1.1σ
- beat #24 (r8, 12.00s): rot -0.8σ
- beat #28 (r4, 14.00s): zoom -2.6σ, abszoom +1.9σ
- beat #32 (r16, 16.00s): bright -1.7σ, sat +1.3σ
- beat #36 (r4, 18.00s): bright -2.2σ, sat +2.3σ, act +1.5σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 11 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.50/timing.png` … — burst 2.50–5.50s (cut): transition at 4.00s (beat #8 r8, novelty 2.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.57/timing.png` … — burst 6.57–9.57s (cut): transition at 8.07s (beat #16 r16, novelty 5.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/008.50/timing.png` … — burst 8.50–11.50s (cut): transition at 10.00s (beat #20 r4, novelty 6.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.57/timing.png` … — burst 10.57–13.57s (cut): transition at 12.07s (beat #24 r8, novelty 1.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.50/timing.png` … — burst 12.50–15.50s (cut): transition at 14.00s (beat #28 r4, novelty 3.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/014.57/timing.png` … — burst 14.57–17.57s (cut): transition at 16.07s (beat #32 r16, novelty 7.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/016.57/timing.png` … — burst 16.57–19.57s (cut): transition at 18.07s (beat #36 r4, novelty 9.7). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py colorem --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png`
- `sheets/rank4.png` ← the rank that reacts hardest
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
