# ref bundle: qtPi0JvmWbs

`tools/.cache/refs/_downloads/qtPi0JvmWbs.mp4` — 15.0+5.0s. tempo **103.4 bpm** (beat 0.580s), 8 beats, phrase phase = beat 4 (estimated, margin 1.09σ); sections at beats 7.
Ours heard through `spectrum`: 626 probe samples, 29 onsets vs the reference's 21.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- zoom speed reacts most at phrase starts (rank 16 z +0.80 vs rank 4 -0.42) — ours: onset fires on 1/1 of those beats
- zoom follows high (r +0.61, -400 ms)
- abszoom follows high (r +0.65, -66 ms)
- rot follows low (r +0.20, -333 ms)
- activity follows high (r +0.48, no lag)
- cut follows onset (r +0.26, -133 ms)
- brightness moves against low (r -0.51, -333 ms)
- no hard cuts at 30 fps in 5 s: every transition below is a fade or a motion
- 2 single transitions: 0 on a beat with an onset, 1 off-beat with no onset (timer/scripted) — ours: onset fired at 1/2 of them
- picture changes regime at 0/1 audio section boundaries — ours: `section` shows no rise near any of them
- activity is pulsed, peaking on the beat (contrast 0.93σ across the beat)
- brightness is pulsed, peaking on the beat (contrast 0.83σ across the beat)
- zoom speed is pulsed, peaking on the beat (contrast 1.38σ across the beat)
- rotates counter-clockwise continuously (+9.3°/s)
- ours: tempo at ×1 for 0% of the clip, ×½ 0%, ×2 0%, elsewhere 100% (median 146.0 vs reference 103.4); our onset lands within 60 ms of 71% of the reference's onsets, and 52% of ours sit on one of theirs; lag -13 ms ±29

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 67% of the clip, 3.60s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 439 lit objects on 1280×720 (lit floor 0.28, lit 29.1% of pixels): 424 bar, 11 blob, 4 disc; outlines 1%, fills 99%; 67% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.10 over 220 substantial objects: 0.474 half-heights at r 0.3, 0.424 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 1.482, r0.3-0.6 → 1.711, r0.6-1.0 → 1.062, r>1 → 1.038
- rings at r ≈ 0.95 (×91), 1.68 (×158); 2-fold (score 0.85); on the axes 49%, on the diagonals 5%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 12.2 px, halo/core 0.46 at 4 px; core lum 0.79, ground lum 0.156
- hues (by lit area): white 0° 100%; ground `#272727`, centre/edge ground brightness 1.00
- flow (1482 object tracks, 35% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.38 (not a zoom) 0.46 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.03, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 28.45 at r<0.45 vs 49.72 at r≥0.45; 9% of elongated objects lie along the radial direction

### Regime 2 — 33% of the clip, 2.47s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 425 lit objects on 1280×720 (lit floor 0.28, lit 27.6% of pixels): 399 bar, 17 blob, 4 panel, 4 disc, 1 ring; outlines 2%, fills 98%; 38% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^0.03 over 9 gates: 0.069 half-heights at r 0.3, 0.071 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 1.413, r0.3-0.6 → 1.386, r0.6-1.0 → 0.967, r>1 → 0.846
- rings at r ≈ 0.95 (×118); 2-fold (score 0.76); on the axes 42%, on the diagonals 10%
- stroke (outlines): 1.9 px at r<0.45, 1.9 px at r≥0.45; glow e-fold 14.6 px, halo/core 0.65 at 4 px; core lum 0.78, ground lum 0.159
- hues (by lit area): white 0° 100%; ground `#282828`, centre/edge ground brightness 1.00
- flow (1288 object tracks, 35% moving outward → objects recede toward the vanishing point — the camera flies backward): radial speed ∝ r^0.19 (not a zoom) 0.53 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.00, 0.87:+0.00, 1.22:+0.00; rotation +0.0°/s (+ = counter-clockwise on screen)
- streak: median elongation 22.0 at r<0.45 vs 41.88 at r≥0.45; 16% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **0.00–3.00s** — transition at 0.27s (beat #0 r4, novelty 2.7); also transition at 2.47s (beat #3 r1, novelty 1.5) — no hard cut; brightness 0.47–0.53, colour change 0.046/frame (cut ≥ 0.2) — `bursts/000.00/timing.png` (every frame), `bursts/000.00/detail.png` (large), `bursts/000.00/motion.png` (paths / skeleton / t±1 in RGB)
- **2.00–5.00s** — phrase start, beat #4 (2.93s) — no hard cut; brightness 0.49–0.58, colour change 0.044/frame (cut ≥ 0.2) — `bursts/002.00/timing.png` (every frame), `bursts/002.00/detail.png` (large), `bursts/002.00/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#282828`×0.30 `#b9b9b9`×0.20 `#e5e5e5`×0.20 `#8c8c8c`×0.17 `#5a5a5a`×0.14
- mirror symmetry, ~1 axis (r 0.48); centre brightness 0.83 vs edge 0.49; mean brightness 0.53, dark frames 0%; saturation 0.00
- motion: zoom mean +0.036 (|zoom| 0.071) log-scale/s, rotation mean +9.3° (|rot| 9.4°)/s, frame-to-frame activity 0.056

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 1 | -0.12 | +0.40 | -0.32 | +0.80 | +1.99 | 1/1 |
| 4 | 1 | +0.39 | +0.55 | +0.43 | -0.42 | -0.38 | 1/1 |
| 2 | 2 | +0.27 | +1.44 | -0.20 | +0.51 | +1.36 | 1/2 |
| 1 | 4 | +0.57 | +1.33 | +0.57 | +1.05 | +0.88 | 4/4 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- abszoom ~ high: r +0.65 at -66 ms
- zoom ~ high: r +0.61 at -400 ms
- brightness ~ low: r -0.51 at -333 ms
- activity ~ high: r +0.48 at +0 ms
- zoom ~ low: r +0.30 at -66 ms
- activity ~ low: r +0.30 at +266 ms
- abszoom ~ low: r +0.27 at +133 ms
- cut ~ onset: r +0.26 at -133 ms
- abszoom ~ onset: r -0.23 at -133 ms
- rot ~ low: r +0.20 at -333 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.27 | #0 | -337 | 4 | +0.2 | -0.2 | -0.6 | +0.6 | off-beat (-0.58 beat from r4), no onset, blackout, → probably not audio-driven, ours: onset yes, bpm 0 |
| 2.47 | #3 | +98 | 1 | -0.1 | -0.8 | +2.2 | +0.5 | on beat (r1), no onset, mid jumps, blackout, ours: onset no, bpm 165 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r16, 2.93s): bright -2.0σ, zoom +1.1σ, abszoom +1.1σ

## Bar and phrase beats

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #0 | 0.60 | 4 | +4.2 | +0.8 | -0.3 | +0.4 | +0.6 | yes | 120 |
| #4 | 2.93 | 16 | +4.9 | +0.3 | -0.2 | -0.1 | +1.6 | yes | 165 |
| #7 S | 4.46 | 1 | -0.2 | +1.1 | +1.7 | +1.3 | +1.0 | yes | 146 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 5 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/000.00/timing.png` … — burst 0.00–3.00s (continuous): transition at 0.27s (beat #0 r4, novelty 2.7). timing.png for when, detail.png for what, motion.png for which way.
- `bursts/002.00/timing.png` … — burst 2.00–5.00s (continuous): phrase start, beat #4 (2.93s). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py qtPi0JvmWbs --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank4.png`
- `sheets/rank2.png`
- `sheets/rank1.png` ← the rank that reacts hardest
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
