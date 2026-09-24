# ref bundle: vj-1027

`tools/.cache/refs/_downloads/_RsNDsibqgc.mp4` — 1027.0+10.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 2 hard cuts in 10 s, densest second 1 cuts at 2s; holds between cuts 2733–2733 ms (median 2733); 10 fades over 1–4 frames (33–133 ms, median 2) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 6 single transitions at t 0.6, 1.7, 2.5, 5.6, 6.3, 7.6

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 85% of the clip, 1.07s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 181 lit objects on 1280×720 (lit floor 0.18, lit 10.0% of pixels): 76 bar, 67 blob, 20 disc, 16 panel, 1 ring, 1 hex ring; outlines 4%, fills 96%; 38% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.47 over 37 gates: 0.049 half-heights at r 0.3, 0.083 at r 0.9 → in between
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.099, r0.3-0.6 → 0.099, r0.6-1.0 → 0.102, r>1 → 0.225
- rings at r ≈ 0.24 (×28), 0.84 (×31), 1.68 (×69); 2-fold (score 0.96); on the axes 45%, on the diagonals 10%
- stroke (outlines): 3.8 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 23.6 px, halo/core 0.10 at 4 px; core lum 0.38, ground lum 0.022
- hues (by lit area): azure 210° 87%, red 0° 11%; ground `#080406`, centre/edge ground brightness 1.00
- flow (664 object tracks, 30% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.05 (not a zoom) 0.49 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:-0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.55 at r<0.45 vs 2.64 at r≥0.45; 47% of elongated objects lie along the radial direction

### Regime 2 — 15% of the clip, 2.00s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 131 lit objects on 1280×720 (lit floor 0.20, lit 14.9% of pixels): 60 blob, 34 disc, 33 bar, 3 panel, 1 hex ring; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.67 over 36 gates: 0.027 half-heights at r 0.3, 0.057 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.032, r0.6-1.0 → 0.267, r>1 → 0.277
- rings at r ≈ 0.60 (×14), 0.75 (×13), 1.68 (×59); 2-fold (score 0.94); on the axes 56%, on the diagonals 8%
- stroke (outlines): 3.8 px at r<0.45, None px at r≥0.45; glow e-fold 28.6 px, halo/core 0.51 at 4 px; core lum 0.57, ground lum 0.056
- hues (by lit area): azure 210° 100%; ground `#0c0e10`, centre/edge ground brightness 4.42
- flow (365 object tracks, 53% moving outward → mixed directions): radial speed ∝ r^2.23 (a fly-through along the axis) 0.01 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:+0.00, 0.87:+0.00, 1.22:+0.02; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.04 at r<0.45 vs 1.82 at r≥0.45; 37% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.60s (beat #1 r1, novelty 5.0); also transition at 1.67s (beat #3 r1, novelty 2.7); also transition at 2.53s (beat #5 r1, novelty 2.5); also every 10 s (no audio to place by) — 1 hard cut at 2.63s; 5 fades over 1–4 frames (33–133 ms, median 2); brightness 0.01–0.45 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **4.10–7.10s** — transition at 5.60s (beat #11 r1, novelty 2.5) — 1 hard cut at 5.37s; 2 fades over 1–2 frames (33–67 ms, median 1); brightness 0.02–0.45 — `bursts/004.10/timing.png` (every frame), `bursts/004.10/detail.png` (large), `bursts/004.10/motion.png` (paths / skeleton / t±1 in RGB)
- **6.10–9.10s** — transition at 7.60s (beat #15 r1, novelty 6.9); also transition at 6.27s (beat #13 r1, novelty 2.4); also every 10 s (no audio to place by) — no hard cut; 5 fades over 1–4 frames (33–133 ms, median 2); brightness 0.01–0.45 — `bursts/006.10/timing.png` (every frame), `bursts/006.10/detail.png` (large), `bursts/006.10/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#070508`×0.68 `#1f2126`×0.20 `#485761`×0.06 `#899baa`×0.04 `#891216`×0.02
- 2-fold rotational symmetry (r 0.99); mirror symmetry, ~6 axes (r 0.99); centre brightness 0.07 vs edge 0.12; mean brightness 0.11, dark frames 56%; saturation 0.44
- motion: zoom mean -0.147 (|zoom| 1.608) log-scale/s, rotation mean +6.5° (|rot| 83.3°)/s, frame-to-frame activity 0.074

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 2 | -0.97 | -0.88 | -0.68 | +1.61 | +1.60 |
| 8 | 1 | +0.20 | -0.17 | -0.31 | +0.88 | +1.26 |
| 4 | 2 | +1.13 | +1.33 | +2.64 | +1.05 | +0.42 |
| 2 | 5 | +0.10 | +0.16 | -0.21 | +0.49 | +0.66 |
| 1 | 10 | +1.31 | +1.59 | +0.69 | +0.56 | +0.60 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.60 | #1 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut, blackout |
| 1.67 | #3 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, flash, → probably not audio-driven |
| 2.53 | #5 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 5.60 | #11 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 6.27 | #13 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, blackout, → probably not audio-driven |
| 7.60 | #15 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset, looks like a cut, blackout |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #12 (r4, 6.00s): sat -0.8σ
- beat #16 (r16, 8.00s): act -1.3σ, zoom -1.1σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 13 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (cut): transition at 0.60s (beat #1 r1, novelty 5.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/004.10/timing.png` … — burst 4.10–7.10s (cut): transition at 5.60s (beat #11 r1, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.10/timing.png` … — burst 6.10–9.10s (fades): transition at 7.60s (beat #15 r1, novelty 6.9). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py vj-1027 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png`
- `sheets/rank4.png`
- `sheets/rank2.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
