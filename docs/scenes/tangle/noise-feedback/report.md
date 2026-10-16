# ref bundle: noise-feedback

`tools/.cache/refs/_downloads/noise-feedback.mp4` — 0.0+15.1s. no usable audio (no audio stream).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (no audio stream): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 15 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 1 single transitions at t 0.3
- zoom direction changes at beat #8 (r8, 4.0s, +1.2σ)
- zoom direction changes at beat #24 (r8, 12.0s, +1.3σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 74% of the clip, 8.53s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 92 lit objects on 720×720 (lit floor 0.18, lit 2.8% of pixels): 58 bar, 20 blob, 9 disc, 4 panel, 1 hex ring; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.55 over 14 gates: 0.051 half-heights at r 0.3, 0.028 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.176, r0.3-0.6 → 0.187, r0.6-1.0 → 0.205, r>1 → —
- rings at r ≈ 0.53 (×31), 0.75 (×20); 3-fold (score 0.63); on the axes 43%, on the diagonals 24%
- stroke (outlines): 1.9 px at r<0.45, None px at r≥0.45; glow e-fold 13.6 px, halo/core 0.21 at 4 px; core lum 0.53, ground lum 0.027
- hues (by lit area): cyan 180° 44%, blue 240° 25%, chartreuse 90° 23%; ground `#060607`, centre/edge ground brightness 1.00
- flow (347 object tracks, 37% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.32 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.02, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.42 at r<0.45 vs 5.56 at r≥0.45; 38% of elongated objects lie along the radial direction

### Regime 2 — 20% of the clip, 1.87s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 131 lit objects on 720×720 (lit floor 0.18, lit 3.8% of pixels): 78 bar, 27 blob, 19 disc, 7 panel; outlines 2%, fills 98%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.14 over 26 gates: 0.027 half-heights at r 0.3, 0.032 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.169, r0.3-0.6 → 0.295, r0.6-1.0 → 0.158, r>1 → —
- rings at r ≈ 0.21 (×7), 0.42 (×31), 0.84 (×53); 6-fold (score 0.65); on the axes 25%, on the diagonals 26%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 14.9 px, halo/core 0.21 at 4 px; core lum 0.55, ground lum 0.029
- hues (by lit area): orange 30° 28%, azure 210° 20%, yellow 60° 14%, magenta 300° 11%; ground `#070707`, centre/edge ground brightness 1.00
- flow (383 object tracks, 39% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^-0.35 (not a zoom) 0.03 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:-0.00, 0.61:+0.00, 0.87:+0.00, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.0 at r<0.45 vs 4.31 at r≥0.45; 36% of elongated objects lie along the radial direction

### Regime 3 — 6% of the clip, 0.47s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 151 lit objects on 720×720 (lit floor 0.18, lit 6.5% of pixels): 70 bar, 49 blob, 27 disc, 5 panel; outlines 1%, fills 99%; 50% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.01 over 32 gates: 0.043 half-heights at r 0.3, 0.042 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.363, r0.3-0.6 → 0.374, r0.6-1.0 → 0.223, r>1 → —
- rings at r ≈ 0.42 (×20), 0.84 (×89); 8-fold (score 0.84); on the axes 34%, on the diagonals 34%
- stroke (outlines): None px at r<0.45, 1.9 px at r≥0.45; glow e-fold 18.2 px, halo/core 0.27 at 4 px; core lum 0.54, ground lum 0.040
- hues (by lit area): green 120° 48%, orange 30° 14%, yellow 60° 11%, azure 210° 10%; ground `#0a0a0a`, centre/edge ground brightness 4.83
- flow (473 object tracks, 41% moving outward → mixed directions): radial speed ∝ r^-1.09 (not a zoom) 0.06 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.03, 0.39:-0.02, 0.61:+0.00, 0.87:-0.00, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.69 at r<0.45 vs 3.13 at r≥0.45; 23% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.27s (beat #1 r1, novelty 12.0); also every 10 s (no audio to place by) — no hard cut; brightness 0.10–0.18, colour change 0.012/frame (cut ≥ 0.2) — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **10.00–13.00s** — every 10 s (no audio to place by) — no hard cut; brightness 0.08–0.08, colour change 0.005/frame (cut ≥ 0.2) — `bursts/010.00/timing.png` (every frame), `bursts/010.00/detail.png` (large), `bursts/010.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#080808`×0.53 `#171717`×0.28 `#2f2e2f`×0.13 `#5d5d5e`×0.04 `#bebebf`×0.02
- 12-fold rotational symmetry (r 0.51); mirror symmetry, ~1 axis (r 0.49); centre brightness 0.32 vs edge 0.07; mean brightness 0.09, dark frames 37%; saturation 0.03
- motion: zoom mean -0.006 (|zoom| 0.039) log-scale/s, rotation mean -0.5° (|rot| 1.5°)/s, frame-to-frame activity 0.004

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 2 | +3.08 | +4.03 | +2.02 | +1.53 | +1.34 |
| 8 | 2 | +0.08 | -0.08 | -0.27 | +0.25 | +1.35 |
| 4 | 4 | +0.14 | +0.49 | -0.16 | +0.23 | +0.20 |
| 2 | 8 | +0.00 | +0.29 | -0.03 | +0.97 | +0.51 |
| 1 | 15 | +0.08 | +0.30 | -0.00 | +0.46 | +0.53 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.27 | #1 | -233 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.47 beat from r1), no onset, looks like a cut, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #8 (r8, 4.00s): zoom +1.2σ, abszoom -1.7σ
- beat #12 (r4, 6.00s): abszoom -1.2σ
- beat #16 (r16, 8.00s): rot +1.0σ
- beat #24 (r8, 12.00s): zoom +1.3σ, rot -1.2σ
- beat #28 (r4, 14.00s): zoom -1.0σ, rot +1.1σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 5 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (continuous): transition at 0.27s (beat #1 r1, novelty 12.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.00/timing.png` … — burst 10.00–13.00s (continuous): every 10 s (no audio to place by). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py noise-feedback --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png` ← the rank that reacts hardest
- `sheets/rank8.png`
- `sheets/rank4.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
