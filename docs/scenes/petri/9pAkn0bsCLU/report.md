# ref bundle: 9pAkn0bsCLU

`tools/.cache/refs/_downloads/9pAkn0bsCLU.mp4` — 0.0+18.8s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- CUTS at 30 fps: 5 hard cuts in 19 s, densest second 2 cuts at 15s; holds between cuts 167–5867 ms (median 2133) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 3 single transitions at t 5.0, 9.1, 15.0
- zoom direction changes at beat #12 (r4, 6.0s, +2.1σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 61% of the clip, 7.33s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 109 lit objects on 360×640 (lit floor 0.59, lit 17.1% of pixels): 59 blob, 46 bar, 2 panel, 2 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.53 over 56 substantial objects: 0.163 half-heights at r 0.3, 0.091 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.232, r0.3-0.6 → 0.347, r0.6-1.0 → 0.151, r>1 → 0.090
- rings at r ≈ 0.38 (×26), 0.60 (×31); 2-fold (score 0.69); on the axes 11%, on the diagonals 35%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -7.88 at 4 px; core lum 0.68, ground lum 0.654
- hues (by lit area): white 0° 100%; ground `#a6a6a6`, centre/edge ground brightness 1.00
- flow (1206 object tracks, 31% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.29 (not a zoom) 0.01 half-heights/s at r 0.5; by r → 0.07:-0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.34 at r<0.45 vs 2.87 at r≥0.45; 48% of elongated objects lie along the radial direction

### Regime 2 — 24% of the clip, 3.13s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 61 lit objects on 360×640 (lit floor 0.27, lit 27.5% of pixels): 24 blob, 19 bar, 15 disc, 3 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-1.50 over 18 gates: 0.286 half-heights at r 0.3, 0.055 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.626, r0.3-0.6 → 0.423, r0.6-1.0 → 0.034, r>1 → —
- rings at r ≈ 0.53 (×37); 5-fold (score 0.87); on the axes 26%, on the diagonals 21%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -551.39 at 4 px; core lum 0.45, ground lum 0.673
- hues (by lit area): white 0° 100%; ground `#ababab`, centre/edge ground brightness 1.00
- flow (487 object tracks, 8% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.14 (not a zoom) 0.07 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:-0.07, 0.39:-0.04, 0.61:-0.08, 0.87:—, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.47 at r<0.45 vs 1.79 at r≥0.45; 72% of elongated objects lie along the radial direction

### Regime 3 — 16% of the clip, 16.20s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 10 lit objects on 360×640 (lit floor 0.40, lit 35.2% of pixels): 6 blob, 3 bar, 1 hex ring; outlines 10%, fills 90%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-12.68 over 5 substantial objects: 3.610 half-heights at r 0.3, 0.000 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → 1.189, r0.6-1.0 → —, r>1 → 0.019
- rings at r ≈ 0.38 (×7), 1.06 (×2); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 7.6 px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -585.23 at 4 px; core lum 0.64, ground lum 0.818
- hues (by lit area): white 0° 100%; ground `#d0d0d0`, centre/edge ground brightness 1.00
- flow (76 object tracks, 5% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^1.91 (a fly-through along the axis) 0.30 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.45 at r<0.45 vs 2.04 at r≥0.45; 38% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — every 10 s (no audio to place by) — no hard cut but brightness swings 0.43–0.60 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **3.50–6.50s** — transition at 5.00s (beat #10 r2, novelty 8.1) — 1 hard cut at 5.00s; brightness 0.37–0.65 — `bursts/003.50/timing.png` (every frame), `bursts/003.50/detail.png` (large), `bursts/003.50/motion.png` (paths / skeleton / t±1 in RGB)
- **7.63–10.63s** — transition at 9.13s (beat #18 r2, novelty 2.5) — 1 hard cut at 9.06s; brightness 0.57–0.63 — `bursts/007.63/timing.png` (every frame), `bursts/007.63/detail.png` (large), `bursts/007.63/motion.png` (paths / skeleton / t±1 in RGB)
- **10.00–13.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.54–0.59, colour change 0.016/frame (cut ≥ 0.2) — `bursts/010.00/timing.png` (every frame), `bursts/010.00/detail.png` (large), `bursts/010.00/motion.png` (paths / skeleton / t±1 in RGB)
- **13.50–16.50s** — transition at 15.00s (beat #30 r2, novelty 8.9) — 3 hard cuts, holds 167–200 ms (median 183); brightness 0.54–0.78 — `bursts/013.50/timing.png` (every frame), `bursts/013.50/detail.png` (large), `bursts/013.50/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#a6a6a6`×0.52 `#787878`×0.19 `#1b1b1b`×0.11 `#4e4e4e`×0.11 `#cfcfcf`×0.07
- 2-fold rotational symmetry (r 0.53); mirror symmetry, ~2 axes (r 0.84); centre brightness 0.40 vs edge 0.48; mean brightness 0.47, dark frames 0%; saturation 0.00
- motion: zoom mean -0.283 (|zoom| 0.426) log-scale/s, rotation mean +2.0° (|rot| 9.1°)/s, frame-to-frame activity 0.053

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 3 | -0.10 | -0.03 | +0.55 | +0.16 | -0.22 |
| 8 | 2 | +0.83 | +0.46 | -0.81 | +1.19 | +2.91 |
| 4 | 5 | +0.36 | -0.03 | +0.09 | -0.14 | -0.17 |
| 2 | 9 | +1.33 | +1.58 | +0.41 | +1.09 | +1.19 |
| 1 | 19 | +0.19 | -0.06 | -0.02 | +0.17 | +0.40 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 5.00 | #10 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, looks like a cut, flash |
| 9.13 | #18 | +133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r2), no onset, → probably not audio-driven |
| 15.00 | #30 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset, flash |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): bright -0.8σ
- beat #12 (r4, 6.00s): zoom +2.1σ, abszoom -2.8σ
- beat #24 (r8, 12.00s): abszoom +1.0σ
- beat #32 (r16, 16.00s): abszoom -1.4σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 11 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (flash): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/003.50/timing.png` … — burst 3.50–6.50s (cut): transition at 5.00s (beat #10 r2, novelty 8.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/007.63/timing.png` … — burst 7.63–10.63s (cut): transition at 9.13s (beat #18 r2, novelty 2.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.00/timing.png` … — burst 10.00–13.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/013.50/timing.png` … — burst 13.50–16.50s (cuts): transition at 15.00s (beat #30 r2, novelty 8.9). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py 9pAkn0bsCLU --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
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
