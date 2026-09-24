# ref bundle: 48H_Fre00AY

`tools/.cache/refs/_downloads/48H_Fre00AY.mp4` — 0.0+17.5s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- no hard cuts at 30 fps in 17 s: every transition below is a fade or a motion
- 4 single transitions at t 0.1, 10.9, 11.5, 12.3
- zoom direction changes at beat #4 (r4, 2.0s, +2.9σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 78% of the clip, 4.80s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 36 lit objects on 720×720 (lit floor 0.44, lit 10.3% of pixels): 17 blob, 16 disc, 2 bar, 1 ring; outlines 3%, fills 97%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.54 over 16 gates: 0.083 half-heights at r 0.3, 0.046 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.608, r0.3-0.6 → 0.064, r0.6-1.0 → 0.066, r>1 → 0.080
- rings at r ≈ 0.30 (×7), 0.95 (×7); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 7.4 px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core -0.65 at 4 px; core lum 0.77, ground lum 0.449
- hues (by lit area): chartreuse 90° 90%, green 120° 9%; ground `#0289d6`, centre/edge ground brightness 1.00
- flow (377 object tracks, 83% moving outward → objects fly toward the camera): radial speed ∝ r^0.71 (a flat zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.01, 0.39:+0.03, 0.61:+0.02, 0.87:+0.04, 1.22:+0.09; rotation +1.5°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.15 at r<0.45 vs 1.12 at r≥0.45; 38% of elongated objects lie along the radial direction

### Regime 2 — 14% of the clip, 12.53s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 14 lit objects on 720×720 (lit floor 0.44, lit 6.2% of pixels): 6 disc, 3 blob, 2 bar, 2 ring, 1 hex ring; outlines 21%, fills 79%; 33% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.00 over 9 gates: 0.086 half-heights at r 0.3, 0.086 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.092, r0.3-0.6 → 0.608, r0.6-1.0 → 0.169, r>1 → —
- rings at r ≈ 0.27 (×3), 0.53 (×6), 0.75 (×3); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 2.7 px at r<0.45, None px at r≥0.45; glow e-fold 193.9 px, halo/core -0.14 at 4 px; core lum 0.76, ground lum 0.373
- hues (by lit area): green 120° 92%; ground `#006cf4`, centre/edge ground brightness 0.82
- flow (86 object tracks, 35% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.08 (not a zoom) 0.03 half-heights/s at r 0.5; by r → 0.07:-0.04, 0.21:-0.02, 0.39:-0.07, 0.61:-0.00, 0.87:-0.02, 1.22:—; rotation +1.1°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.04 at r<0.45 vs 2.14 at r≥0.45; 38% of elongated objects lie along the radial direction

### Regime 3 — 8% of the clip, 11.80s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 69 lit objects on 720×720 (lit floor 0.41, lit 14.5% of pixels): 37 disc, 19 blob, 9 bar, 2 hex ring, 1 ring, 1 panel; outlines 6%, fills 94%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.03 over 41 gates: 0.060 half-heights at r 0.3, 0.062 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.196, r0.3-0.6 → 0.058, r0.6-1.0 → 0.284, r>1 → 0.161
- rings at r ≈ 0.38 (×19), 0.53 (×18), 0.95 (×13); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, 2.7 px at r≥0.45; glow e-fold None px, halo/core -0.49 at 4 px; core lum 0.75, ground lum 0.400
- hues (by lit area): green 120° 79%, chartreuse 90° 12%, spring 150° 6%; ground `#0176e5`, centre/edge ground brightness 1.00
- flow (602 object tracks, 76% moving outward → objects fly toward the camera): radial speed ∝ r^0.89 (a flat zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:+0.02, 0.21:+0.01, 0.39:+0.01, 0.61:+0.02, 0.87:+0.05, 1.22:+0.03; rotation +0.3°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.06 at r<0.45 vs 1.18 at r≥0.45; 6% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.13s (beat #0 r16, novelty 8.8); also every 10 s (no audio to place by) — no hard cut but brightness swings 0.32–0.46 — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **10.83–13.83s** — transition at 12.33s (beat #25 r1, novelty 11.3); also transition at 11.53s (beat #23 r1, novelty 4.6); also transition at 10.93s (beat #22 r2, novelty 3.1); also every 10 s (no audio to place by) — no hard cut; brightness 0.40–0.46, colour change 0.034/frame (cut ≥ 0.2) — `bursts/010.83/timing.png` (every frame), `bursts/010.83/detail.png` (large), `bursts/010.83/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#0252fc`×0.62 `#19fd1f`×0.14 `#00f0c9`×0.10 `#c5d308`×0.08 `#d40d9a`×0.06
- 12-fold rotational symmetry (r 0.33); mirror symmetry, ~1 axis (r 0.41); centre brightness 0.44 vs edge 0.42; mean brightness 0.42, dark frames 0%; saturation 0.99
- motion: zoom mean -0.022 (|zoom| 0.083) log-scale/s, rotation mean +1.8° (|rot| 2.2°)/s, frame-to-frame activity 0.010

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 3 | +1.00 | +2.32 | -1.20 | +0.72 | +1.35 |
| 8 | 2 | +2.02 | +1.13 | -0.27 | -0.34 | -0.26 |
| 4 | 4 | -0.29 | -0.18 | +0.36 | -0.12 | -0.22 |
| 2 | 9 | -0.05 | -0.02 | +0.27 | +0.26 | -0.07 |
| 1 | 17 | +0.06 | +0.17 | +0.12 | +0.13 | +0.37 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.13 | #0 | +133 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.27 beat from r16), no onset, looks like a cut, → probably not audio-driven |
| 10.93 | #22 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 11.53 | #23 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 12.33 | #25 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, looks like a cut, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): zoom +2.9σ, abszoom -2.6σ, rot -1.1σ
- beat #24 (r8, 12.00s): bright -1.0σ, sat +1.9σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 10 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (flash): transition at 0.13s (beat #0 r16, novelty 8.8). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.83/timing.png` … — burst 10.83–13.83s (continuous): transition at 12.33s (beat #25 r1, novelty 11.3). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py 48H_Fre00AY --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png` ← the rank that reacts hardest
- `sheets/rank4.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
