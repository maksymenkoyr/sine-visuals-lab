# ref bundle: violet-filament

`tools/.cache/refs/_downloads/hKckckhpbYY.mp4` — 60.0+40.0s. no usable audio (audio is silent or has no beat).

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- NO USABLE AUDIO (audio is silent or has no beat): the beat grid is a uniform 120 bpm placeholder; only the visual findings mean anything
- NO HARD CUTS at 30 fps in 40 s: every transition below is a fade or a motion — build it with envelopes and travel, never a switch
- 2 strobe stretch(es), flashes every 0.30 s (3.3 Hz), at t 8.9, 17.7
- 19 single transitions at t 1.2, 1.9, 2.6, 3.1, 3.6, 4.6, 4.9, 5.9, 6.5, 7.4, 10.5, 11.5, 12.9, 14.2, 15.5, 15.9, 17.0, 21.9, 23.0
- zoom direction changes at beat #40 (r8, 20.0s, +2.1σ)

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 36% of the clip, 6.33s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 174 lit objects on 1280×720 (lit floor 0.21, lit 11.5% of pixels): 74 blob, 67 bar, 27 disc, 6 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.45 over 33 gates: 0.023 half-heights at r 0.3, 0.038 at r 0.9 → in between
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.114, r0.3-0.6 → 0.391, r0.6-1.0 → 0.109, r>1 → 0.275
- rings at r ≈ 0.38 (×14), 1.06 (×58), 1.50 (×43); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 10.9 px, halo/core 0.32 at 4 px; core lum 0.51, ground lum 0.095
- hues (by lit area): magenta 300° 64%, violet 270° 27%, rose 330° 7%; ground `#231135`, centre/edge ground brightness 1.00
- flow (790 object tracks, 59% moving outward → mixed directions): radial speed ∝ r^0.45 (not a zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:-0.02, 0.21:-0.01, 0.39:+0.01, 0.61:+0.04, 0.87:+0.02, 1.22:+0.05; rotation -1.6°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.94 at r<0.45 vs 2.42 at r≥0.45; 64% of elongated objects lie along the radial direction

### Regime 2 — 21% of the clip, 34.73s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 119 lit objects on 1280×720 (lit floor 0.19, lit 10.2% of pixels): 48 blob, 46 bar, 20 disc, 4 panel, 1 frame; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.00 over 25 gates: 0.072 half-heights at r 0.3, 0.072 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.069, r0.3-0.6 → 0.361, r0.6-1.0 → 0.190, r>1 → 0.194
- rings at r ≈ 0.84 (×36), 1.68 (×41); 2-fold (score 0.65); on the axes 60%, on the diagonals 10%
- stroke (outlines): 7.4 px at r<0.45, None px at r≥0.45; glow e-fold 12.0 px, halo/core 0.34 at 4 px; core lum 0.53, ground lum 0.066
- hues (by lit area): magenta 300° 43%, violet 270° 30%, rose 330° 25%; ground `#170d1f`, centre/edge ground brightness 0.98
- flow (473 object tracks, 62% moving outward → objects fly toward the camera): radial speed ∝ r^0.68 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:—, 0.39:+0.01, 0.61:+0.05, 0.87:+0.00, 1.22:+0.06; rotation -0.9°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.82 at r<0.45 vs 2.58 at r≥0.45; 71% of elongated objects lie along the radial direction

### Regime 3 — 16% of the clip, 28.67s — `frames/look_3.jpg`, detections `frames/look_3_overlay.png`

- 133 lit objects on 1280×720 (lit floor 0.19, lit 9.1% of pixels): 52 bar, 49 blob, 20 disc, 11 panel, 1 frame; outlines 1%, fills 99%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.34 over 32 gates: 0.079 half-heights at r 0.3, 0.055 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.095, r0.3-0.6 → 0.255, r0.6-1.0 → 0.119, r>1 → 0.183
- rings at r ≈ 0.67 (×18), 1.19 (×44), 1.68 (×38); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 6.6 px at r<0.45, None px at r≥0.45; glow e-fold 12.9 px, halo/core 0.30 at 4 px; core lum 0.49, ground lum 0.071
- hues (by lit area): violet 270° 53%, magenta 300° 45%; ground `#1a0d26`, centre/edge ground brightness 1.00
- flow (631 object tracks, 64% moving outward → objects fly toward the camera): radial speed ∝ r^0.68 (a flat zoom) 0.05 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.03, 0.39:+0.03, 0.61:+0.07, 0.87:+0.10, 1.22:+0.00; rotation -0.6°/s (+ = counter-clockwise on screen)
- streak: median elongation 1.63 at r<0.45 vs 2.63 at r≥0.45; 63% of elongated objects lie along the radial direction

### Regime 4 — 16% of the clip, 22.00s — `frames/look_4.jpg`, detections `frames/look_4_overlay.png`

- 158 lit objects on 1280×720 (lit floor 0.19, lit 9.0% of pixels): 82 bar, 55 blob, 14 disc, 7 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.71 over 21 gates: 0.015 half-heights at r 0.3, 0.033 at r 0.9 → a perspective tunnel (size grows with distance from the vanishing point)
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.065, r0.3-0.6 → 0.046, r0.6-1.0 → 0.256, r>1 → 0.199
- rings at r ≈ 1.50 (×48); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 6.6 px, halo/core 0.27 at 4 px; core lum 0.46, ground lum 0.087
- hues (by lit area): magenta 300° 74%, violet 270° 24%; ground `#1f1033`, centre/edge ground brightness 1.00
- flow (768 object tracks, 73% moving outward → objects fly toward the camera): radial speed ∝ r^1.05 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:-0.03, 0.39:+0.00, 0.61:+0.04, 0.87:+0.07, 1.22:+0.10; rotation -0.9°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.25 at r<0.45 vs 3.32 at r≥0.45; 73% of elongated objects lie along the radial direction

### Regime 5 — 11% of the clip, 16.73s — `frames/look_5.jpg`, detections `frames/look_5_overlay.png`

- 183 lit objects on 1280×720 (lit floor 0.19, lit 9.5% of pixels): 83 blob, 70 bar, 22 disc, 8 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.29 over 30 gates: 0.064 half-heights at r 0.3, 0.047 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 0.928, r0.3-0.6 → 0.092, r0.6-1.0 → 0.186, r>1 → 0.241
- rings at r ≈ 0.60 (×21), 1.19 (×56); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 10.3 px, halo/core 0.29 at 4 px; core lum 0.46, ground lum 0.079
- hues (by lit area): violet 270° 47%, magenta 300° 45%, red 0° 5%; ground `#1c0f2c`, centre/edge ground brightness 1.00
- flow (738 object tracks, 77% moving outward → objects fly toward the camera): radial speed ∝ r^1.23 (a flat zoom) 0.04 half-heights/s at r 0.5; by r → 0.07:—, 0.21:+0.04, 0.39:+0.04, 0.61:+0.02, 0.87:+0.02, 1.22:+0.17; rotation -1.6°/s (+ = counter-clockwise on screen)
- streak: median elongation 2.03 at r<0.45 vs 2.66 at r≥0.45; 73% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.43–3.43s** — transition at 1.93s (beat #4 r4, novelty 3.1); also transition at 1.20s (beat #2 r2, novelty 2.4); also every 10 s (no audio to place by) — no hard cut; brightness 0.23–0.24, colour change 0.013/frame (cut ≥ 0.2) — `bursts/000.43/timing.png` (every frame), `bursts/000.43/detail.png` (large), `bursts/000.43/motion.png` (paths / skeleton / t±1 in RGB)
- **2.10–5.10s** — transition at 3.60s (beat #7 r1, novelty 3.9); also transition at 2.60s (beat #5 r1, novelty 2.6); also transition at 3.07s (beat #6 r2, novelty 2.3); also transition at 4.60s (beat #9 r1, novelty 2.2); also transition at 4.87s (beat #10 r2, novelty 2.1) — no hard cut; brightness 0.23–0.24, colour change 0.012/frame (cut ≥ 0.2) — `bursts/002.10/timing.png` (every frame), `bursts/002.10/detail.png` (large), `bursts/002.10/motion.png` (paths / skeleton / t±1 in RGB)
- **4.43–7.43s** — transition at 5.93s (beat #12 r4, novelty 2.6); also transition at 6.47s (beat #13 r1, novelty 2.6); also transition at 7.40s (beat #15 r1, novelty 1.8) — no hard cut; brightness 0.22–0.23, colour change 0.012/frame (cut ≥ 0.2) — `bursts/004.43/timing.png` (every frame), `bursts/004.43/detail.png` (large), `bursts/004.43/motion.png` (paths / skeleton / t±1 in RGB)
- **8.68–11.68s** — strobe 8.93–9.53s, flashes every 0.30s; also transition at 10.47s (beat #21 r1, novelty 3.0); also transition at 11.53s (beat #23 r1, novelty 2.4); also every 10 s (no audio to place by) — no hard cut; brightness 0.21–0.22, colour change 0.011/frame (cut ≥ 0.2) — `bursts/008.68/timing.png` (every frame), `bursts/008.68/detail.png` (large), `bursts/008.68/motion.png` (paths / skeleton / t±1 in RGB)
- **12.70–15.70s** — transition at 14.20s (beat #28 r4, novelty 3.4); also transition at 15.47s (beat #31 r1, novelty 2.4); also transition at 12.87s (beat #26 r2, novelty 1.7) — no hard cut; brightness 0.20–0.21, colour change 0.012/frame (cut ≥ 0.2) — `bursts/012.70/timing.png` (every frame), `bursts/012.70/detail.png` (large), `bursts/012.70/motion.png` (paths / skeleton / t±1 in RGB)
- **15.50–18.50s** — transition at 17.00s (beat #34 r2, novelty 2.7); also transition at 15.87s (beat #32 r16, novelty 2.5) — no hard cut; brightness 0.17–0.20, colour change 0.011/frame (cut ≥ 0.2) — `bursts/015.50/timing.png` (every frame), `bursts/015.50/detail.png` (large), `bursts/015.50/motion.png` (paths / skeleton / t±1 in RGB)
- **17.42–20.42s** — strobe 17.67–18.27s, flashes every 0.30s — no hard cut; brightness 0.16–0.17, colour change 0.011/frame (cut ≥ 0.2) — `bursts/017.42/timing.png` (every frame), `bursts/017.42/detail.png` (large), `bursts/017.42/motion.png` (paths / skeleton / t±1 in RGB)
- **20.37–23.37s** — transition at 21.87s (beat #44 r4, novelty 2.1); also transition at 23.00s (beat #46 r2, novelty 1.6); also every 10 s (no audio to place by) — no hard cut; brightness 0.16–0.17, colour change 0.010/frame (cut ≥ 0.2) — `bursts/020.37/timing.png` (every frame), `bursts/020.37/detail.png` (large), `bursts/020.37/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#190e27`×0.39 `#3b1e5c`×0.28 `#5a3b86`×0.17 `#8662ab`×0.11 `#c89dc7`×0.05
- 12-fold rotational symmetry (r 0.30); mirror symmetry, ~1 axis (r 0.34); centre brightness 0.25 vs edge 0.20; mean brightness 0.20, dark frames 0%; saturation 0.59
- motion: zoom mean +0.005 (|zoom| 0.020) log-scale/s, rotation mean -0.1° (|rot| 0.4°)/s, frame-to-frame activity 0.008

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| |
|---|---|---|---|---|---|---|
| 16 | 5 | +1.12 | +1.03 | +0.30 | +0.27 | +0.91 |
| 8 | 5 | +0.82 | +0.97 | -0.02 | -0.28 | +0.94 |
| 4 | 10 | +0.94 | +1.11 | +0.00 | +0.49 | +0.56 |
| 2 | 20 | +0.84 | +1.03 | +0.00 | +0.45 | +0.45 |
| 1 | 40 | +0.90 | +1.08 | +0.01 | +0.37 | +0.53 |

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 1.20 | #2 | +200 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r2), no onset, → probably not audio-driven |
| 1.93 | #4 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 2.60 | #5 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 3.07 | #6 | +67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 3.60 | #7 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.20 beat from r1), no onset, → probably not audio-driven |
| 4.60 | #9 | +100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 4.87 | #10 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 5.93 | #12 | -67 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r4), no onset |
| 6.47 | #13 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 7.40 | #15 | -100 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 8.93 | #18 | -67 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 9.53s: 3 flashes every 0.30s = 0.60 beat (≈ 0.5 beat within the ±0.13-beat resolution of 15 fps), starts on beat r2, no onset |
| 10.47 | #21 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 11.53 | #23 | +33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 12.87 | #26 | -133 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r2), no onset, → probably not audio-driven |
| 14.20 | #28 | +200 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (+0.40 beat from r4), no onset, → probably not audio-driven |
| 15.47 | #31 | -33 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r1), no onset |
| 15.87 | #32 | -133 | 16 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r16), no onset, → probably not audio-driven |
| 17.00 | #34 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |
| 17.67 | #35 | +167 | 1 | +0.0 | +0.0 | +0.0 | +0.0 | STROBE to 18.27s: 3 flashes every 0.30s = 0.60 beat (no simple fraction of a beat → own timer), starts off beat r1, no onset |
| 21.87 | #44 | -133 | 4 | +0.0 | +0.0 | +0.0 | +0.0 | off-beat (-0.27 beat from r4), no onset, → probably not audio-driven |
| 23.00 | #46 | +0 | 2 | +0.0 | +0.0 | +0.0 | +0.0 | on beat (r2), no onset |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #32 (r16, 16.00s): abszoom +1.0σ
- beat #36 (r4, 18.00s): zoom -1.1σ, abszoom +1.8σ
- beat #40 (r8, 20.00s): zoom +2.1σ, abszoom -2.1σ
- beat #44 (r4, 22.00s): abszoom +1.1σ
- beat #48 (r16, 24.00s): abszoom -1.3σ

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 16 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.43/timing.png` … — burst 0.43–3.43s (continuous): transition at 1.93s (beat #4 r4, novelty 3.1). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.10/timing.png` … — burst 2.10–5.10s (continuous): transition at 3.60s (beat #7 r1, novelty 3.9). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/004.43/timing.png` … — burst 4.43–7.43s (continuous): transition at 5.93s (beat #12 r4, novelty 2.6). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/008.68/timing.png` … — burst 8.68–11.68s (continuous): strobe 8.93–9.53s, flashes every 0.30s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/012.70/timing.png` … — burst 12.70–15.70s (continuous): transition at 14.20s (beat #28 r4, novelty 3.4). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/015.50/timing.png` … — burst 15.50–18.50s (continuous): transition at 17.00s (beat #34 r2, novelty 2.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/017.42/timing.png` … — burst 17.42–20.42s (continuous): strobe 17.67–18.27s, flashes every 0.30s. timing.png for when, detail.png for what, motion.png for which way.
- `bursts/020.37/timing.png` … — burst 20.37–23.37s (continuous): transition at 21.87s (beat #44 r4, novelty 2.1). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py violet-filament --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png` ← the rank that reacts hardest
- `sheets/rank8.png`
- `sheets/rank4-1.png`
- `sheets/rank4-2.png`
- `sheets/rank2-1.png`
- `sheets/rank2-2.png`
- `sheets/rank2-3.png`
- `sheets/rank2-4.png`
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `sheets/rank1-3.png`
- `sheets/rank1-4.png`
- `sheets/rank1-5.png`
- `sheets/rank1-6.png`
- `sheets/rank1-7.png`
- `sheets/rank1-8.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.
