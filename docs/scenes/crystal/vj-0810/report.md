# ref bundle: vj-0810

`tools/.cache/refs/_downloads/_RsNDsibqgc.mp4` — 810.0+10.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 9 hard cuts in 10 s, densest second 5 cuts at 0s; holds between cuts 33–2500 ms (median 50) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 5 single transitions at t 0.1, 1.7, 3.3, 4.3, 7.0

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 65% of the clip, 2.73s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 102 lit objects on 1280×720 (lit floor 0.18, lit 3.6% of pixels): 66 bar, 34 panel, 2 disc; outlines 4%, fills 96%; 25% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.52 over 36 gates: 0.391 half-heights at r 0.3, 0.220 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 0.082, r0.6-1.0 → 0.629, r>1 → 0.430
- rings at r ≈ 0.53 (×28), 1.19 (×33), 1.68 (×16); 2-fold (score 0.99); on the axes 40%, on the diagonals 12%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 20.5 px, halo/core 0.07 at 4 px; core lum 0.40, ground lum 0.023
- hues (by lit area): red 0° 56%, azure 210° 44%; ground `#060506`, centre/edge ground brightness 0.85
- flow (370 object tracks, 32% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.43 (a flat zoom) 0.23 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:+0.00, 0.87:+0.00, 1.22:+0.90; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs 3.83 at r≥0.45; 13% of elongated objects lie along the radial direction

### Regime 2 — 35% of the clip, 6.27s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 206 lit objects on 1280×720 (lit floor 0.18, lit 8.8% of pixels): 85 bar, 72 blob, 22 disc, 15 hex ring, 7 panel, 3 frame, 2 ring; outlines 10%, fills 90%; 10% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.14 over 49 gates: 0.091 half-heights at r 0.3, 0.077 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.166, r0.3-0.6 → 0.145, r0.6-1.0 → 0.345, r>1 → 0.184
- rings at r ≈ 0.30 (×12), 0.38 (×10), 1.19 (×79); 2-fold (score 0.95); on the axes 44%, on the diagonals 3%
- stroke (outlines): 4.6 px at r<0.45, 3.8 px at r≥0.45; glow e-fold 25.1 px, halo/core 0.20 at 4 px; core lum 0.44, ground lum 0.131
- hues (by lit area): azure 210° 100%; ground `#1d2228`, centre/edge ground brightness 0.24
- flow (729 object tracks, 26% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.70 (a flat zoom) 0.14 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.10, 0.39:-0.12, 0.61:+0.00, 0.87:+0.00, 1.22:-0.02; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.87 at r<0.45 vs 2.43 at r≥0.45; 48% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–10.00s** — requested — 9 hard cuts, holds 33–2500 ms (median 50); brightness 0.01–0.48 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **2.77–5.77s** — transition at 4.27s (beat #9 r1, novelty 4.9); also transition at 3.27s (beat #7 r1, novelty 2.0) — 3 hard cuts, holds 33–67 ms (median 50); brightness 0.01–0.33 — `bursts/002.77/timing.png` (every frame), `bursts/002.77/detail.png` (large), `bursts/002.77/motion.png` (paths / skeleton / t±1 in RGB)
- **5.50–8.50s** — transition at 7.00s (beat #14 r2, novelty 2.6) — no hard cut but brightness swings 0.01–0.20 — `bursts/005.50/timing.png` (every frame), `bursts/005.50/detail.png` (large), `bursts/005.50/motion.png` (paths / skeleton / t±1 in RGB)
- **7.00–10.00s** — every 10 s (no audio to place by) — no hard cut but brightness swings 0.01–0.28 — `bursts/007.00/timing.png` (every frame), `bursts/007.00/detail.png` (large), `bursts/007.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#070507`×0.59 `#22272d`×0.20 `#4c606d`×0.10 `#8baec2`×0.09 `#8a1316`×0.02
- 2-fold rotational symmetry (r 0.99); mirror symmetry, ~6 axes (r 0.99); centre brightness 0.05 vs edge 0.10; mean brightness 0.10, dark frames 51%; saturation 0.38
- motion: zoom mean +0.037 (|zoom| 1.225) log-scale/s, rotation mean -3.4° (|rot| 78.7°)/s, frame-to-frame activity 0.065

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 2 | +1.06 | +2.78 | +1.77 | +2.11 | +1.83 |
| 8 | 1 | +2.50 | +1.40 | +3.99 | +2.11 | -0.88 |
| 4 | 2 | -0.28 | +0.56 | -0.07 | -0.21 | +0.57 |
| 2 | 5 | +0.83 | +0.19 | +0.28 | +0.52 | +0.58 |
| 1 | 10 | -0.09 | +0.11 | -0.11 | +0.24 | +0.43 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.13 | #0 | +133 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r16), no onset, looks like a cut, blackout, → probably not audio-driven |
| 1.73 | #3 | +233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.47 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 3.27 | #7 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, → probably not audio-driven |
| 4.27 | #9 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, blackout, → probably not audio-driven |
| 7.00 | #14 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): sat -1.0σ, act -0.9σ
- beat #8 (r8, 4.00s): zoom +1.1σ, abszoom +0.8σ
- beat #12 (r4, 6.00s): bright +1.1σ, sat -0.9σ
- beat #16 (r16, 8.00s): sat -1.0σ, act -0.8σ, zoom -1.0σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 12 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–10.00s (cuts): requested. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.77/timing.png` … — burst 2.77–5.77s (cuts): transition at 4.27s (beat #9 r1, novelty 4.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/005.50/timing.png` … — burst 5.50–8.50s (flash): transition at 7.00s (beat #14 r2, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/007.00/timing.png` … — burst 7.00–10.00s (flash): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py vj-0810 --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png` ← the rank that reacts hardest
- `sheets/rank4.png`
- `sheets/rank2.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
