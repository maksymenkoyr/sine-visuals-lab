# ref bundle: oiIxQ_JxbZo

`tools/.cache/refs/_downloads/oiIxQ_JxbZo.mp4` — 0.0+30.0s. tempo **117.5 bpm** (beat 0.511s), 53 beats, phrase phase = beat 12 (estimated, margin 1.37σ); sections at beats 13, 27, 37.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- colour change reacts most at phrase starts (rank 16 z +1.55 vs rank 4 +0.51)
- abszoom moves against rms (r -0.25, +333 ms)
- activity follows high (r +0.22, -400 ms)
- brightness moves against rms (r -0.66, no lag)
- no hard cuts at 30 fps in 30 s: every transition below is a fade or a motion
- 1 strobe stretch(es), flashes every 0.23 s ≈ 0.46 beat (≈ 0.5 beat within the ±0.13-beat resolution of 15 fps); 0/1 start on a beat, at t 1.3
- 8 single transitions: 1 on a beat with an onset, 5 off-beat with no onset (timer/scripted)
- picture changes regime at 1/3 audio section boundaries
- zoom direction changes at beat #4 (r8, 2.0s, +3.3σ)
- brightness does not flash on onsets (rise z +0.01 over 15 strong onsets)
- activity flashes on onsets: rises z +0.41 in ~266 ms, settles within one frame (15 strong onsets averaged)
- activity is continuous across the beat (contrast 0.37σ)
- brightness is continuous across the beat (contrast 0.19σ)
- zoom speed is continuous across the beat (contrast 0.33σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 39% of the clip, 29.00s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.04, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.817
- hues (by lit area): ; ground `#d0d0d0`, centre/edge ground brightness 0.39
- flow (223 object tracks, 20% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.15 (not a zoom) 0.09 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:—, 0.61:+0.00, 0.87:+0.00, 1.22:—; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 2 — 18% of the clip, 11.80s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.05, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.841
- hues (by lit area): ; ground `#d6d6d6`, centre/edge ground brightness 0.52
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 3 — 18% of the clip, 5.13s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.05, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.909
- hues (by lit area): ; ground `#e7e7e7`, centre/edge ground brightness 0.99
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 4 — 14% of the clip, 18.20s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.05, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.829
- hues (by lit area): ; ground `#d3d3d3`, centre/edge ground brightness 0.47
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

### Regime 5 — 10% of the clip, 5.00s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 0 lit objects on 1280×720 (lit floor 1.05, lit 0.0% of pixels): —; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- largest objects (90th pct of size) by band: r0.1-0.3 → —, r0.3-0.6 → —, r0.6-1.0 → —, r>1 → —
- rings at r ≈ —; no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold None px, halo/core 0.00 at 4 px; core lum 1.00, ground lum 0.909
- hues (by lit area): ; ground `#e7e7e7`, centre/edge ground brightness 0.99
- streak: median elongation None at r<0.45 vs None at r≥0.45; 0% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **1.02–4.02s** — strobe 1.27–1.73s, flashes every 0.23s — no hard cut; brightness 0.90–0.93, colour change 0.003/frame (cut ≥ 0.2) — `bursts/001.02/timing.png` (every frame), `bursts/001.02/detail.png` (large), `bursts/001.02/motion.png` (paths / skeleton / t±1 in RGB)
- **5.28–8.28s** — phrase start, beat #12 (5.78s) — no hard cut; brightness 0.89–0.91, colour change 0.002/frame (cut ≥ 0.2) — `bursts/005.28/timing.png` (every frame), `bursts/005.28/detail.png` (large), `bursts/005.28/motion.png` (paths / skeleton / t±1 in RGB)
- **12.30–15.30s** — transition at 13.80s (beat #28 r16, novelty 3.2); also transition at 14.13s (beat #29 r1, novelty 2.4); also transition at 15.20s (beat #31 r1, novelty 1.9); also phrase start, beat #28 (13.84s) — no hard cut; brightness 0.86–0.87, colour change 0.005/frame (cut ≥ 0.2) — `bursts/012.30/timing.png` (every frame), `bursts/012.30/detail.png` (large), `bursts/012.30/motion.png` (paths / skeleton / t±1 in RGB)
- **17.30–20.30s** — transition at 18.80s (beat #37 r1, novelty 3.0); also transition at 18.47s (beat #37 r1, novelty 3.0) — no hard cut; brightness 0.77–0.83, colour change 0.004/frame (cut ≥ 0.2) — `bursts/017.30/timing.png` (every frame), `bursts/017.30/detail.png` (large), `bursts/017.30/motion.png` (paths / skeleton / t±1 in RGB)
- **20.37–23.37s** — transition at 21.87s (beat #44 r16, novelty 4.0); also transition at 22.20s (beat #44 r16, novelty 3.3); also phrase start, beat #44 (22.08s) — no hard cut; brightness 0.77–0.81, colour change 0.003/frame (cut ≥ 0.2) — `bursts/020.37/timing.png` (every frame), `bursts/020.37/detail.png` (large), `bursts/020.37/motion.png` (paths / skeleton / t±1 in RGB)
- **23.90–26.90s** — transition at 25.40s (beat #51 r1, novelty 1.9) — no hard cut; brightness 0.77–0.80, colour change 0.003/frame (cut ≥ 0.2) — `bursts/023.90/timing.png` (every frame), `bursts/023.90/detail.png` (large), `bursts/023.90/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#ebebeb`×0.84 `#b6b6b6`×0.07 `#1a1a1a`×0.04 `#333333`×0.02 `#646464`×0.02
- mirror symmetry, ~1 axis (r 0.90); centre brightness 0.48 vs edge 0.82; mean brightness 0.78, dark frames 0%; saturation 0.00
- motion: zoom mean +0.050 (|zoom| 0.138) log-scale/s, rotation mean -6.4° (|rot| 6.5°)/s, frame-to-frame activity 0.002

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 3 | +1.22 | +1.55 | +0.09 | -0.12 | -0.17 |
| 8 | 4 | +0.54 | +0.18 | +0.16 | +1.24 | +1.39 |
| 4 | 7 | +0.80 | +0.51 | +0.23 | -0.13 | -0.17 |
| 2 | 13 | +0.76 | +1.20 | +0.17 | +0.10 | -0.17 |
| 1 | 26 | +0.79 | +0.93 | +0.18 | +0.40 | +0.07 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- brightness ~ rms: r -0.66 at +0 ms
- brightness ~ low: r -0.48 at +333 ms
- abszoom ~ rms: r -0.25 at +333 ms
- activity ~ high: r +0.22 at -400 ms
- brightness ~ onset: r -0.21 at -133 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.27 | #2 | +199 | 2 | +0.2 | +0.6 | +0.4 | +0.4 | STROBE to 1.73s: 3 flashes every 0.23s = 0.46 beat (≈ 0.5 beat within the ±0.13-beat resolution of 15 fps), starts off beat r2, no onset |
| 13.80 | #28 | -39 | 16 | +2.9 | -0.6 | +0.0 | -0.3 | on beat (r16), hard onset |
| 14.13 | #29 | -170 | 1 | +0.2 | +2.0 | -0.0 | -0.1 | off-beat (-0.33 beat from r1), no onset, low jumps, → probably not audio-driven |
| 15.20 | #31 | -195 | 1 | +0.6 | -0.9 | +0.1 | +0.2 | off-beat (-0.38 beat from r1), no onset, → probably not audio-driven |
| 18.47 | #37 | -109 | 1 | +0.3 | -1.2 | -0.1 | +0.0 | off-beat (-0.21 beat from r1), no onset, low drops, section boundary, → probably not audio-driven |
| 18.80 | #37 | +224 | 1 | +0.5 | -1.3 | +0.0 | -0.0 | off-beat (+0.44 beat from r1), no onset, low drops, section boundary, → probably not audio-driven |
| 21.87 | #44 | -216 | 16 | +1.0 | +0.3 | -0.3 | -0.1 | off-beat (-0.42 beat from r16), onset |
| 22.20 | #44 | +118 | 16 | +1.8 | -0.5 | +0.0 | +0.2 | off-beat (+0.23 beat from r16), hard onset |
| 25.40 | #51 | -188 | 1 | +0.0 | +0.7 | -0.2 | -0.1 | off-beat (-0.37 beat from r1), no onset, → probably not audio-driven |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r8, 2.02s): act -2.1σ, zoom +3.3σ, abszoom +3.4σ, rot -3.4σ
- beat #16 (r4, 7.71s): zoom +1.2σ, abszoom -1.2σ
- beat #28 (r16, 13.84s): act +1.4σ
- beat #36 (r8, 18.07s): act +1.0σ
- beat #48 (r4, 24.06s): act +0.9σ
- beat #52 (r8, 26.12s): act -0.9σ

## Bar and phrase beats

| beat | t | rank | onset z | low z | high z | act z | cut z |
|---|---|---|---|---|---|---|---|
| #0 | 0.07 | 4 | +12.1 | -2.7 | -2.0 | -1.1 | -0.7 |
| #4 | 2.02 | 8 | -0.2 | -0.5 | -1.3 | -1.1 | -0.7 |
| #8 | 3.95 | 4 | +1.0 | +0.4 | -0.1 | +1.5 | +1.1 |
| #12 | 5.78 | 16 | +0.5 | -0.8 | -0.4 | +1.5 | +1.1 |
| #13 S | 6.29 | 1 | -0.1 | -0.7 | -0.7 | +1.7 | +1.1 |
| #16 | 7.71 | 4 | +0.6 | -1.1 | -1.4 | +1.5 | +1.1 |
| #20 | 9.89 | 8 | +0.8 | -1.1 | -0.7 | +1.6 | +1.1 |
| #24 | 11.91 | 4 | +0.8 | -0.8 | -0.3 | +1.6 | +1.1 |
| #27 S | 13.35 | 1 | +0.1 | -0.0 | -0.6 | -1.1 | -0.7 |
| #28 | 13.84 | 16 | +2.9 | -0.6 | -0.4 | +0.7 | +4.6 |
| #32 | 15.95 | 4 | +0.1 | -0.2 | +1.0 | +0.9 | +0.3 |
| #36 | 18.07 | 8 | +3.2 | +0.3 | +1.6 | +1.3 | +0.4 |
| #37 S | 18.58 | 1 | +0.6 | +0.5 | +1.4 | +1.7 | +0.9 |
| #40 | 20.15 | 4 | -0.2 | +0.5 | +1.1 | +0.7 | +0.6 |
| #44 | 22.08 | 16 | +1.8 | +0.7 | +1.3 | +1.7 | +2.6 |
| #48 | 24.06 | 4 | +1.2 | +1.4 | +0.8 | +0.7 | +0.1 |
| #52 | 26.12 | 8 | +2.5 | +0.7 | +0.9 | +0.4 | -0.1 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 12 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/001.02/timing.png` … — burst 1.02–4.02s (continuous): strobe 1.27–1.73s, flashes every 0.23s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/005.28/timing.png` … — burst 5.28–8.28s (continuous): phrase start, beat #12 (5.78s). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.30/timing.png` … — burst 12.30–15.30s (continuous): transition at 13.80s (beat #28 r16, novelty 3.2). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/017.30/timing.png` … — burst 17.30–20.30s (continuous): transition at 18.80s (beat #37 r1, novelty 3.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.37/timing.png` … — burst 20.37–23.37s (continuous): transition at 21.87s (beat #44 r16, novelty 4.0). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/023.90/timing.png` … — burst 23.90–26.90s (continuous): transition at 25.40s (beat #51 r1, novelty 1.9). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py oiIxQ_JxbZo --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
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
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
