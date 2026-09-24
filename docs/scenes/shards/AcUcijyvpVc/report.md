# ref bundle: AcUcijyvpVc

`tools/.cache/refs/_downloads/AcUcijyvpVc.mp4` — 0.0+4.5s. tempo **161.5 bpm** (beat 0.372s), 13 beats, phrase phase = beat 0 (estimated, margin 0.2σ); sections at beats 8.
Ours heard through `spectrum`: 568 probe samples, 26 onsets vs the reference's 28.

## Findings

Each line is a rule the numbers support; "ours:" is what our analyser did at the same moments (one run — a sample, not a spec).

- no beat-rank preference: the picture reacts about the same on every beat (activity z -1.02..+1.29)
- abszoom follows onset (r +0.30, +333 ms)
- rot moves against onset (r -0.32, +333 ms)
- absrot follows low (r +0.31, +133 ms)
- activity follows low (r +0.36, no lag)
- brightness moves against low (r -0.60, +400 ms)
- sat moves against mid (r -0.27, +400 ms)
- CUTS at 30 fps: 11 hard cuts in 4 s, densest second 5 cuts at 3s; holds between cuts 33–1433 ms (median 167) — the transition list below is measured at 15 fps and merges anything closer than that; the bursts resolve them
- 3 single transitions: 1 on a beat with an onset, 0 off-beat with no onset (timer/scripted) — ours: onset fired at 2/3 of them
- picture changes regime at 0/1 audio section boundaries — ours: `section` shows no rise near any of them
- activity is pulsed, peaking on the beat (contrast 1.29σ across the beat)
- brightness is continuous across the beat (contrast 0.45σ)
- zoom speed is pulsed, peaking on the off-beat (contrast 1.16σ across the beat)
- ours: tempo at ×1 for 0% of the clip, ×½ 0%, ×2 0%, elsewhere 100% (median 111.0 vs reference 161.5); our onset lands within 60 ms of 93% of the reference's onsets, and 92% of ours sit on one of theirs; lag +1 ms ±18

## Picture, measured

What is drawn, per visual regime, from one full-resolution frame each (tools/reflook.py's header says what each line is for). r = distance from the frame centre in half-heights. Check against `look.png` before trusting a count.

### Regime 1 — 69% of the clip, 0.87s — `frames/look_1.jpg`, detections `frames/look_1_overlay.png`

- 22 lit objects on 360×640 (lit floor 0.18, lit 14.1% of pixels): 9 bar, 7 blob, 6 panel; outlines 0%, fills 100%; 0% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.28 over 6 gates: 0.013 half-heights at r 0.3, 0.009 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 3.342, r0.3-0.6 → 0.367, r0.6-1.0 → 0.014, r>1 → 0.009
- rings at r ≈ 0.27 (×6), 0.42 (×5), 0.60 (×3), 0.95 (×5); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): None px at r<0.45, None px at r≥0.45; glow e-fold 7.3 px, halo/core 0.27 at 4 px; core lum 0.66, ground lum 0.006
- hues (by lit area): yellow 60° 64%, violet 270° 20%, rose 330° 12%; ground `#010103`, centre/edge ground brightness 1.00
- flow (454 object tracks, 57% moving outward → mixed directions): radial speed ∝ r^0.18 (not a zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.01, 0.87:+0.01, 1.22:+0.00; rotation -2.4°/s (+ = counter-clockwise on screen)
- streak: median elongation 3.04 at r<0.45 vs 1.66 at r≥0.45; 53% of elongated objects lie along the radial direction

### Regime 2 — 31% of the clip, 2.33s — `frames/look_2.jpg`, detections `frames/look_2_overlay.png`

- 16 lit objects on 360×640 (lit floor 0.18, lit 13.2% of pixels): 7 bar, 4 blob, 4 panel, 1 ring; outlines 6%, fills 94%; 100% of outlines have another lit object inside (a prism/frame seen with depth)
- size ∝ r^-0.18 over 8 substantial objects: 0.424 half-heights at r 0.3, 0.348 at r 0.9 → a flat pattern
- largest objects (90th pct of size) by band: r0.1-0.3 → 1.330, r0.3-0.6 → 0.492, r0.6-1.0 → 0.419, r>1 → —
- rings at r ≈ 0.34 (×4), 0.67 (×4), 0.95 (×5); no rotational multiplicity found; on the axes 0%, on the diagonals 0%
- stroke (outlines): 13.1 px at r<0.45, None px at r≥0.45; glow e-fold 4.6 px, halo/core 0.17 at 4 px; core lum 0.76, ground lum 0.116
- hues (by lit area): orange 30° 88%, rose 330° 12%; ground `#500d23`, centre/edge ground brightness 68.62
- flow (426 object tracks, 60% moving outward → objects fly toward the camera): radial speed ∝ r^0.18 (not a zoom) 0.02 half-heights/s at r 0.5; by r → 0.07:+0.00, 0.21:+0.00, 0.39:+0.00, 0.61:+0.01, 0.87:+0.01, 1.22:+0.03; rotation -2.7°/s (+ = counter-clockwise on screen)
- streak: median elongation 4.19 at r<0.45 vs 2.06 at r≥0.45; 57% of elongated objects lie along the radial direction

## Bursts

Windows decoded at every source frame (30 fps, tools/refburst.py) where the data put them; a hard cut is stated to one frame. Open a burst's images only when a finding sends you there.

- **1.47–4.47s** — transition at 3.33s (beat #9 r1, novelty 3.5); also transition at 0.40s (beat #1 r1, novelty 3.0); also transition at 0.67s (beat #2 r2, novelty 1.8); also phrase start, beat #0 (0.07s) — 7 hard cuts, holds 33–567 ms (median 233); brightness 0.12–0.32 — `bursts/001.47/timing.png` (every frame), `bursts/001.47/detail.png` (large), `bursts/001.47/motion.png` (paths / skeleton / t±1 in RGB)

## Look, as statistics

- palette (share of pixels): `#08080b`×0.72 `#904267`×0.12 `#edc13d`×0.07 `#d3c8b9`×0.06 `#5fc835`×0.04
- mirror symmetry, ~1 axis (r 0.39); centre brightness 0.47 vs edge 0.25; mean brightness 0.29, dark frames 0%; saturation 0.51
- motion: zoom mean +0.049 (|zoom| 0.734) log-scale/s, rotation mean -13.2° (|rot| 42.3°)/s, frame-to-frame activity 0.087

## Reaction per beat rank

z-scored metric in the 0..+250 ms window after beats of exactly that rank.

| rank | n | activity | cut | brightness | \|zoom\| | \|rot\| | ours onset |
|---|---|---|---|---|---|---|---|
| 16 | 1 | -1.00 | -0.81 | -0.95 | -0.55 | -0.64 | 1/1 |
| 8 | 1 | -1.02 | -0.81 | +0.43 | -0.58 | -0.63 | 1/1 |
| 4 | 2 | +0.87 | +0.14 | -0.80 | -0.36 | +1.37 | 2/2 |
| 2 | 3 | +1.29 | +1.03 | +0.56 | +0.71 | +1.78 | 3/3 |
| 1 | 6 | +1.21 | +1.31 | +0.67 | +1.69 | +1.01 | 5/6 |

## Correlations that clear the noise

|r| ≥ 0.2 within ±500 ms; lag positive = picture follows sound.

- brightness ~ low: r -0.60 at +400 ms
- brightness ~ rms: r -0.55 at +333 ms
- brightness ~ mid: r -0.42 at +466 ms
- activity ~ low: r +0.36 at +0 ms
- rot ~ onset: r -0.32 at +333 ms
- absrot ~ low: r +0.31 at +133 ms
- abszoom ~ onset: r +0.30 at +333 ms
- sat ~ mid: r -0.27 at +400 ms
- rot ~ mid: r +0.25 at -400 ms
- activity ~ high: r +0.25 at +133 ms
- absrot ~ mid: r +0.24 at +200 ms
- sat ~ high: r -0.24 at +333 ms

## Transitions, with the audio at that moment

| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |
|---|---|---|---|---|---|---|---|---|
| 0.40 | #1 | -18 | 1 | +0.6 | -1.1 | +0.4 | +1.3 | on beat (r1), no onset, low drops, high jumps, flash, ours: onset yes, bpm 176 |
| 0.67 | #2 | -100 | 2 | +1.4 | +0.9 | +1.6 | -0.0 | on beat (r2), onset, mid jumps, ours: onset no, bpm 112 |
| 3.33 | #9 | +36 | 1 | -0.3 | -0.7 | +0.4 | -0.0 | on beat (r1), no onset, blackout, ours: onset yes, bpm 111 |

## Regime changes on bar/phrase beats

Mean metric over the 2 beats after vs the 2 before, in std units.

- beat #4 (r4, 1.49s): abszoom -0.9σ, rot +1.0σ

## Bar and phrase beats

| beat | t | rank | onset z | low z | high z | act z | cut z | ours onset | ours bpm |
|---|---|---|---|---|---|---|---|---|---|
| #0 | 0.07 | 16 | +3.9 | -0.6 | -1.0 | -1.0 | -0.8 | yes | 0 |
| #4 | 1.49 | 4 | +2.3 | +0.7 | -0.1 | +0.9 | +0.1 | yes | 111 |
| #8 S | 2.93 | 8 | +1.9 | -1.5 | +0.3 | -1.0 | -0.8 | yes | 111 |
| #12 | 4.39 | 4 | +2.2 | +0.8 | -0.1 | +0.8 | +1.2 | yes | 111 |

## Files

- `slitscan.png` — the whole clip, 30 columns per second: centre row / ring r=0.5 / spoke lanes, beat ticks by rank on top, red = transitions. Open this first after the report: every cut, flash and pulse is on it.
- `keyframes.png` — 6 tiles: regimes, transition before/after, phrase starts. The look; open it next.
- `look.png` — per regime: full-res frame | ×3 centre crop | detections. Open when a Picture line looks wrong; `look.json` has every object.
- `timeline.png` — open when a finding names a time and you want to see the neighbours.
- `bursts/001.47/timing.png` … — burst 1.47–4.47s (cuts): transition at 3.33s (beat #9 r1, novelty 3.5). timing.png for when, detail.png for what, motion.png for which way.
- a moment no burst covers: `ref-scan.py AcUcijyvpVc --burst T[,DUR]` decodes one more (3 s at every frame) and re-renders this report.
- `sheets/rank16.png`
- `sheets/rank8.png`
- `sheets/rank4.png`
- `sheets/rank2.png` ← the rank that reacts hardest
- `sheets/rank1-1.png`
- `sheets/rank1-2.png`
- `audio.json` — every number above, per beat; `series.tsv` — per frame.
