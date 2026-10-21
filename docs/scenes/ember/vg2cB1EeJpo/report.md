# ref bundle: vg2cB1EeJpo

`tools/.cache/refs/_downloads/vg2cB1EeJpo.mp4` — 60.0+30.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 30 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 1 strobe stretch(es), flashes every 0.40 s (2.5 Hz), at t 19.7
- 17 single transitions at t 0.2, 3.7, 4.0, 4.6, 5.3, 7.9, 9.9, 11.7, 12.6, 13.3, 15.9, 21.3, 23.9, 25.8, 27.7, 28.6, 29.4
- rotates clockwise continuously (-1.7°/s)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 39% of the clip, 26.53s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.099
- hues (by lit area): ; ground `#760001`, centre/edge ground brightness 1.30
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 2 — 30% of the clip, 28.47s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 1 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): 1 disc; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 33.3 px, halo/core 0.85 at 4 px; core lum 0.18, ground lum 0.113
- hues (by lit area): red 0° 100%; ground `#850001`, centre/edge ground brightness 0.61
- flow (6 object tracks, 33% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.58 (not a zoom) 0.08 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.04, 0.39:-0.05, 0.61:—, 0.87:—, 1.22:—; rotation +0.6°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.52 at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 3 — 12% of the clip, 1.80s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.071
- hues (by lit area): ; ground `#540001`, centre/edge ground brightness 1.09
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 4 — 11% of the clip, 8.87s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.041
- hues (by lit area): ; ground `#310000`, centre/edge ground brightness 1.45
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 5 — 8% of the clip, 17.40s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 0 lit objects on 1280×720 (lit floor 0.18, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.052
- hues (by lit area): ; ground `#3d0001`, centre/edge ground brightness 1.03
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.20s (beat #0 r16, novelty 2.7); also every 10 s (no audio to place by) — no hard cut; brightness 0.04–0.10, colour change 0.025/frame (cut ≥ 0.2) — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **2.17–5.17s** — transition at 3.67s (beat #7 r1, novelty 4.2); also transition at 4.60s (beat #9 r1, novelty 2.1); also transition at 4.00s (beat #8 r8, novelty 1.8) — no hard cut; brightness 0.09–0.11, colour change 0.024/frame (cut ≥ 0.2) — `bursts/002.17/timing.png` (every frame), `bursts/002.17/detail.png` (large), `bursts/002.17/motion.png` (paths / skeleton / t±1 in RGB)
- **6.43–9.43s** — transition at 7.93s (beat #16 r16, novelty 3.5) — no hard cut; brightness 0.04–0.10, colour change 0.024/frame (cut ≥ 0.2) — `bursts/006.43/timing.png` (every frame), `bursts/006.43/detail.png` (large), `bursts/006.43/motion.png` (paths / skeleton / t±1 in RGB)
- **10.17–13.17s** — transition at 11.67s (beat #23 r1, novelty 4.1); also transition at 12.60s (beat #25 r1, novelty 2.4); also every 10 s (no audio to place by) — no hard cut; brightness 0.09–0.11, colour change 0.024/frame (cut ≥ 0.2) — `bursts/010.17/timing.png` (every frame), `bursts/010.17/detail.png` (large), `bursts/010.17/motion.png` (paths / skeleton / t±1 in RGB)
- **14.43–17.43s** — transition at 15.93s (beat #32 r16, novelty 3.1) — no hard cut; brightness 0.04–0.10, colour change 0.025/frame (cut ≥ 0.2) — `bursts/014.43/timing.png` (every frame), `bursts/014.43/detail.png` (large), `bursts/014.43/motion.png` (paths / skeleton / t±1 in RGB)
- **19.42–22.42s** — strobe 19.67–20.47s, flashes every 0.40s; also transition at 21.33s (beat #43 r1, novelty 1.6); also every 10 s (no audio to place by) — no hard cut; brightness 0.09–0.11, colour change 0.025/frame (cut ≥ 0.2) — `bursts/019.42/timing.png` (every frame), `bursts/019.42/detail.png` (large), `bursts/019.42/motion.png` (paths / skeleton / t±1 in RGB)
- **22.43–25.43s** — transition at 23.93s (beat #48 r16, novelty 3.1) — no hard cut; brightness 0.04–0.10, colour change 0.025/frame (cut ≥ 0.2) — `bursts/022.43/timing.png` (every frame), `bursts/022.43/detail.png` (large), `bursts/022.43/motion.png` (paths / skeleton / t±1 in RGB)
- **26.17–29.17s** — transition at 27.67s (beat #55 r1, novelty 4.0); also transition at 28.60s (beat #57 r1, novelty 2.4); also transition at 29.40s (beat #59 r1, novelty 1.7); also every 10 s (no audio to place by) — no hard cut; brightness 0.09–0.11, colour change 0.024/frame (cut ≥ 0.2) — `bursts/026.17/timing.png` (every frame), `bursts/026.17/detail.png` (large), `bursts/026.17/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#070000`×0.26 `#aa0000`×0.21 `#3c0000`×0.19 `#730000`×0.18 `#df0000`×0.15
- 12-fold rotational symmetry (r 0.61); mirror symmetry, ~1 axis (r 0.68); centre brightness 0.12 vs edge 0.13; mean brightness 0.13, dark frames 14%; saturation 0.85
- motion: zoom mean -0.055 (|zoom| 0.103) log-scale/s, rotation mean -1.7° (|rot| 2.1°)/s, frame-to-frame activity 0.006

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 4 | +1.31 | +1.34 | -0.74 | -0.05 | -0.64 |
| 8 | 4 | +4.40 | +0.54 | +0.91 | -0.48 | -0.66 |
| 4 | 7 | -0.44 | +0.14 | +0.15 | +1.00 | +0.81 |
| 2 | 15 | -0.07 | +0.04 | +0.10 | -0.19 | +0.47 |
| 1 | 30 | +0.43 | +1.05 | +0.09 | +0.14 | +0.76 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.20 | #0 | +200 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r16), no onset, → probably not audio-driven |
| 3.67 | #7 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 4.00 | #8 | +0 | 8 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r8), no onset |
| 4.60 | #9 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 5.33 | #11 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 7.93 | #16 | -67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 9.87 | #20 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 11.67 | #23 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, looks like a cut, → probably not audio-driven |
| 12.60 | #25 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 13.33 | #27 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 15.93 | #32 | -67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 19.67 | #39 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 20.47s: 3 flashes every 0.40s = 0.80 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset |
| 21.33 | #43 | -167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.33 beat from r1), no onset, → probably not audio-driven |
| 23.93 | #48 | -67 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r16), no onset |
| 25.80 | #52 | -200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.40 beat from r4), no onset, → probably not audio-driven |
| 27.67 | #55 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.33 beat from r1), no onset, → probably not audio-driven |
| 28.60 | #57 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 29.40 | #59 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.20 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 2.00s): bright +1.7σ, act -1.3σ, rot +1.1σ
- beat #8 (r8, 4.00s): act +1.0σ
- beat #12 (r4, 6.00s): sat -0.9σ, act -1.8σ, rot +1.3σ
- beat #16 (r16, 8.00s): bright -1.9σ, sat -1.0σ
- beat #20 (r4, 10.00s): bright +1.7σ, act -1.3σ, rot +1.2σ
- beat #24 (r8, 12.00s): act +0.8σ
- beat #28 (r4, 14.00s): sat -1.0σ, act -1.8σ, rot +1.4σ
- beat #32 (r16, 16.00s): bright -1.9σ, sat -1.0σ
- beat #36 (r4, 18.00s): bright +1.7σ, act -1.3σ, rot +1.1σ
- beat #40 (r8, 20.00s): act +1.0σ
- beat #44 (r4, 22.00s): sat -0.9σ, act -1.8σ, rot +1.4σ
- beat #48 (r16, 24.00s): bright -1.9σ, sat -1.0σ
- beat #52 (r4, 26.00s): bright +1.8σ, act -1.3σ, rot +1.0σ
- beat #56 (r8, 28.00s): act +0.9σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (continuous): transition at 0.20s (beat #0 r16, novelty 2.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.17/timing.png` … — burst 2.17–5.17s (continuous): transition at 3.67s (beat #7 r1, novelty 4.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/006.43/timing.png` … — burst 6.43–9.43s (continuous): transition at 7.93s (beat #16 r16, novelty 3.5). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/010.17/timing.png` … — burst 10.17–13.17s (continuous): transition at 11.67s (beat #23 r1, novelty 4.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/014.43/timing.png` … — burst 14.43–17.43s (continuous): transition at 15.93s (beat #32 r16, novelty 3.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/019.42/timing.png` … — burst 19.42–22.42s (continuous): strobe 19.67–20.47s, flashes every 0.40s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/022.43/timing.png` … — burst 22.43–25.43s (continuous): transition at 23.93s (beat #48 r16, novelty 3.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/026.17/timing.png` … — burst 26.17–29.17s (continuous): transition at 27.67s (beat #55 r1, novelty 4.0). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py vg2cB1EeJpo --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png` ← the rank that reacts hardest
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
