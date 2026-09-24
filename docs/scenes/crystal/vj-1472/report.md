# ref bundle: vj-1472

`tools/.cache/refs/_downloads/_RsNDsibqgc.mp4` — 1472.0+10.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 10 hard cuts in 10 s, densest second 5 cuts at 1s; holds between cuts 33–4600 ms (median 67) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 7 single transitions at t 1.3, 2.9, 4.3, 5.1, 7.3, 8.2, 9.7

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 73% of the clip, 0.33s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 94 lit objects on 1280×720 (lit floor 0.18, lit 0.7% of pixels): 88 bar, 5 panel, 1 blob; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.20 over 48 substantial objects: 0.177 half-heights at r 0.3, 0.143 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.060, r0.6-1.0 → 1.576, r>1 → 0.073
- rings at r ≈ 0.53 (×12), 0.95 (×44), 1.68 (×22); 2-fold (score 1.00); on the axes 40%, on the diagonals 17%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 4.8 px, halo/core 0.07 at 4 px; core lum 0.35, ground lum 0.024
- hues (by lit area): red 0° 97%; ground `#060507`, centre/edge ground brightness 1.11
- flow (433 object tracks, 14% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.51 (not a zoom) 0.73 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:—, 0.61:+0.00, 0.87:+0.00, 1.22:-0.37; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 8.11 at r≥0.45; 12% of elongated objects lie along the radial direction

### Regime 2 — 27% of the clip, 7.80s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 93 lit objects on 1280×720 (lit floor 0.20, lit 7.5% of pixels): 40 bar, 35 blob, 14 disc, 4 hex ring; outlines 4%, fills 96%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^1.73 over 18 gates: 0.011 half-heights at r 0.3, 0.072 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.388, r0.6-1.0 → 0.082, r>1 → 0.311
- rings at r ≈ 0.38 (×7), 0.60 (×18), 0.84 (×26), 1.68 (×23); 2-fold (score 0.88); on the axes 45%, on the diagonals 25%
- stroke (outlines): None px at r<0.45, 3.8 px at r≥0.45; glow e-fold 13.4 px, halo/core 0.23 at 4 px; core lum 0.51, ground lum 0.133
- hues (by lit area): azure 210° 100%; ground `#1d2228`, centre/edge ground brightness 0.65
- flow (708 object tracks, 46% moving outward → mixed directions): radial speed ∝ r^0.69 (a flat zoom) 0.14 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:+0.05, 0.61:+0.00, 0.87:+0.00, 1.22:+0.12; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.91 at r<0.45 vs 2.71 at r≥0.45; 51% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–10.00s** — requested — 11 hard cuts, holds 33–4533 ms (median 67); brightness 0.01–0.48 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **3.63–6.63s** — transition at 5.13s (beat #10 r2, novelty 2.3); also transition at 4.27s (beat #9 r1, novelty 2.0) — 2 hard cuts, holds 33–33 ms (median 33); brightness 0.02–0.36 — `bursts/003.63/timing.png` (every frame), `bursts/003.63/detail.png` (large), `bursts/003.63/motion.png` (paths / skeleton / t±1 in RGB)
- **7.00–10.00s** — transition at 9.73s (beat #19 r1, novelty 3.7); also transition at 7.33s (beat #15 r1, novelty 3.1); also transition at 8.20s (beat #16 r16, novelty 1.9); also every 10 s (no audio to place by) — 3 hard cuts, holds 33–67 ms (median 50); brightness 0.01–0.33 — `bursts/007.00/timing.png` (every frame), `bursts/007.00/detail.png` (large), `bursts/007.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#060507`×0.75 `#252026`×0.10 `#485c68`×0.08 `#89acbf`×0.07 `#ab1f21`×0.01
- 2-fold rotational symmetry (r 0.98); mirror symmetry, ~6 axes (r 0.99); centre brightness 0.06 vs edge 0.11; mean brightness 0.10, dark frames 55%; saturation 0.35
- motion: zoom mean +0.149 (|zoom| 1.072) log-scale/s, rotation mean -2.6° (|rot| 67.9°)/s, frame-to-frame activity 0.056

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 2 | +0.97 | +0.71 | +0.79 | +0.48 | +0.67 |
| 8 | 1 | +1.94 | +1.01 | +0.53 | +0.28 | +1.87 |
| 4 | 2 | -0.22 | -0.46 | -0.28 | -0.03 | +1.05 |
| 2 | 5 | +0.25 | +0.88 | +0.10 | +1.31 | +1.13 |
| 1 | 10 | +0.55 | +0.67 | +0.20 | +0.74 | +0.88 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.33 | #3 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, flash, → probably not audio-driven |
| 2.87 | #6 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, looks like a cut, blackout, → probably not audio-driven |
| 4.27 | #9 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 5.13 | #10 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, looks like a cut, blackout, → probably not audio-driven |
| 7.33 | #15 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 8.20 | #16 | +200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r16), no onset, blackout, → probably not audio-driven |
| 9.73 | #19 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, flash, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): bright -1.2σ, sat +1.4σ
- beat #8 (r8, 4.00s): bright +1.3σ, act +1.1σ, rot +0.8σ
- beat #12 (r4, 6.00s): sat +1.7σ, abszoom +0.9σ
- beat #16 (r16, 8.00s): bright -0.9σ, sat -1.6σ, act -1.4σ, zoom +1.1σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 13 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–10.00s (cuts): requested. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/003.63/timing.png` … — burst 3.63–6.63s (cuts): transition at 5.13s (beat #10 r2, novelty 2.3). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/007.00/timing.png` … — burst 7.00–10.00s (cuts): transition at 9.73s (beat #19 r1, novelty 3.7). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py vj-1472 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png` ← the rank that reacts hardest
- `sheets/rank4.png`
- `sheets/rank2.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
