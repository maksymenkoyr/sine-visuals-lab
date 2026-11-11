# Oil Drops (`oildrops`)

Saturated oil drops floating on blue glitter paint: red, magenta and orange
discs from pin-size beads to pools a tenth of the frame wide, pressing
against each other without merging, some carrying a smaller drop inside,
a few ringed by a clear lens, all lit from the upper left and drifting
together on a sheet that slides, turns and spreads. Loudness speeds the
drift from a creep to a sweep, bass stirs eddies into it, a kick jolts
every drop, a drop in the music pours a cluster of new drops onto the
paint, and treble sets the glitter flashing. In development, not yet on main.

## Where the code is

- `src/render/scenes/oildrops/card.ts` — the card: the settings, `PAINTS`,
  the `gallery` record and `loadBody`.
- `src/render/scenes/oildrops/drops.ts` — the population, pure and
  node-tested: `RADIUS_QUANTILES` (the size law), `SheetState` and
  `advanceSheet` (the slide-turn-spread sheet), `eddyVelocity` (the curl of
  a value-noise field), `stepDrops` (flow, the jolt, contact by position
  projection, inner drops, culling, entry from the inflow side), `pour`,
  `packDrops` (drawing order). `driftSpeed`, `eddyScale` and `dropCount`
  turn settings and drive readings into what the step takes.
- `src/render/scenes/oildrops/glsl.ts` — `PAINT_FRAG` (the paint and its
  glitter), `DROP_VERT`/`DROP_FRAG` (one instanced quad per drop),
  `FAMILY_SHADING` and `FAMILY_RGB` (per colour family), `PAINT_RGB`,
  `LIGHT_DIR`, `EDGE_WIDTH`.
- `src/render/scenes/oildrops/index.ts` — the scene: two programs, the
  instance buffer, `paintDrifts`/`boilDepths` (the paint's wrapped slide and
  boil), `glitterAmount`.
- `tests/oildrops.test.ts` covers the population and the drive formulas.
- Shared systems: `noiseHash.ts` (`NOISE_HASH_GLSL`, `wrapFlow`);
  `sceneCommon.ts`'s `uploadCommonUniforms` for both passes; the drives
  (`drives.ts`): `rush` ← Level, `swirl` ← Bass level, `shove` ← Kick (a hit
  driver, "shove"), `pour` ← Drop (a hit driver, "pour"), `glitter` ← Treble
  level; the room palette when Colour is Room.

## References

- "Abstract Liquid Background Video (No Sound) — 4K UHD Abstract Liquid
  Screensaver 9 Hours", Ambient Escape, YouTube `hOgVAYpHPCc` — studied for
  the look and the motion of its oil-on-paint clips: 1:10:03–1:10:14 and
  1:12:44–1:13:03 (clip A, red spheres on blue glitter paint) and
  1:11:50–1:12:06 (clip B, pink, orange and yellow spheres packed on dark
  blue). It is silent by design, so no sync was taken from it; every
  reaction here is our own.
  - Measured for issue #824 (2026-11-09) on a downloaded 180 s slice from
    1:10:03, at 1920×1080, with the scripts in `oildrops/scripts/`. The
    contact sheets and detector overlays sit on a private page, because
    they show frames of the video; the numbers are in the issue and below.
  - Not a `/ref` bundle: the clips are silent, and the measuring needed a
    circle detector of its own (`circles.py`), not `tools/reflook.py`.

## Measurements

2026-11-09, the reference (`%W` is percent of frame width):

| | Clip A 1:10:03 (10 s) | Clip A 1:12:44 (18 s) | Clip B 1:11:50 (16 s) |
|---|---|---|---|
| Drops on screen, median per frame | 83 | 76 | 251 |
| … with radius ≥ 12 px | 40 | 33 | 174 |
| Frame area covered | 35 % | 36 % | 60 % |
| Radius median / p90 / largest, %W | 0.67 / 4.47 / 10.71 | 0.56 / 3.62 / 10.90 | 1.19 / 4.59 / 8.17 |
| Drop speed, median, %W/s | 0.25 | 0.50 | 3.90 |
| Paint speed between drops, median, %W/s | 0.24 | 0.16 | 3.98 |
| Drop velocity vs the paint around it: slope / R² | 0.96 / 0.25 | 1.18 / 0.57 | 1.06 / 0.96 |
| Neighbours' velocity correlation, 5–10 / 20–40 %W apart | 0.39 / −0.16 | 0.54 / 0.01 | 0.35 / 0.09 |
| Drops ≥ 12 px touching another | 50 % | 46 % | 78 % |
| Drops ≥ 24 px holding an inner drop | 16 % | 27 % | 22 % |
| Merges confirmed | 0 | 0 | 1 |

Shading per colour family, brightness relative to the drop's own body:

| | Red, clip A | Pink, clip B | Orange, clip B | Yellow, clip B |
|---|---|---|---|---|
| Tilt, lit edge against body | ±12–30 % | ±35 % | ±27 % | ±10 % |
| Brightness at 0.85–0.92 r | 0.95–0.96 | 0.86 | 0.84 | 0.85 |
| Soft highlight, median peak | none broad; small spots | 1.34 | 1.13 | 1.06 |
| Glitter points per 1000 px² | 0.2–0.6 | 2.9 | 0 | 0 |
| Rim, 10–90 % rise, px at 1920 wide | 7.0–7.9 | 8.0 | 8.0 | 9.2 |

Also: one light for the frame, the bright side up and about 25° left;
reds have a dark line at the rim 18 % below the body, a shadow to the lower
right outside the rim (first-harmonic contrast 0.38–0.40), and a lens ring at
1.18–1.28 r on 20–38 % of the big ones; drops press into each other by
5–14 % of the smaller radius; shading follows the colour family, not the
size (correlation of log radius with tilt −0.17 and 0.00).

2026-11-11, ours, from the simulation itself (`oildrops/scripts/stats.mts`,
default settings, median over 20 s after a 10 s settle, two seeds), against
clip A at 1:10:03:

| | clip A | ours, quiet | ours, Rush at full (loud) |
|---|---|---|---|
| drops on screen | 83 | 89–90 | 78 |
| … radius ≥ 12 px | 40 | 52–53 | 49 |
| frame area covered | 35 % | 39–47 % | 29 % |
| radius median / p90 / largest, %W | 0.67 / 4.47 / 10.7 | 0.81–0.96 / 5.5–6.3 / 9.7–10.2 | 0.99 / 4.3 / 9.8 |
| drops ≥ 12 px touching another | 50 % | 47–48 % | 41 % |
| big drops holding an inner drop | 16–27 % | 23–33 % | 23 % |
| drop speed, median, %W/s | 0.25 | 0.26–0.27 | 3.95 (clip B: 3.9) |

The on-screen median runs above the clip's because the count takes inner
drops and drops cut by the frame edge, both big; the sampled radii
themselves hit the clip's quantiles exactly (`RADIUS_QUANTILES`).

2026-11-11, `tools/tune-real.mjs oildrops` (around-the-world, then silence;
30 s from 4 s; change = % of full scale per 100 ms):

| source | change med | change p95 | hits/min | kick/min | clap/min | hats/min | chord/min | drops/min | energy |
|---|---|---|---|---|---|---|---|---|---|
| song | 4.60 | 6.26 | 426 | 118 | 50 | 280 | 124 | 2 | 0.61 |
| silence | 0.37 | 0.51 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 |

Song p95 / silence p95 = 12.4×. The silence row is the designed drift.

2026-11-11, the Auto sign-off (`oildrops/scripts/automodes.mjs`, synthetic
124 bpm, dev pin cleared): on a fresh profile every setting probes `manual`
at its default; with Auto on, the ten with an auto table probe `auto`, and
Inner drops, Paint and Colour stay `manual`.

## Decisions and pivots

- 2026-11-09: the study (#824) ruled out designing from thumbnails, merging
  past an overlap, and big drops flattening; it found shading follows the
  colour family, drops ride the paint, neighbours agree to 10–20 %W apart,
  and one merge in 45 s. The owner said go, as an app scene, starting from
  clip A.
- 2026-11-11: one analytic flow for paint and drops, nothing read back from
  the GPU: a slide-turn-spread sheet that re-targets every few seconds, plus
  value-noise eddies at the measured neighbour scale. The paint rides only
  the sheet's translation (an affine slide can't be wrapped per noise
  octave), the drops ride all of it.
- 2026-11-11: contact as a velocity push left beads deep inside pools (its
  resting overlap grew with the flow and shrank with the radius); contact is
  now a position projection, a few relaxation passes a frame.
- 2026-11-11: the fill placed the biggest radii first and stopped at the
  count, which left the small tail out; it places every sampled radius now.
- 2026-11-11: a log-normal could not hold the clip's floor, median and p90
  at once; radii come from a quantile table through the measured points.
- 2026-11-11: the reactions, all our own since the clips are silent:
  loudness takes the drift from clip A's pace to clip B's (Rush), bass stirs
  the eddies (Swirl), a kick jolts the drops, small ones most (Shove), a drop
  in the music pours a cluster that grows in and shoves the neighbours
  (Pour), treble flashes the glitter (Glitter). Glitter density and the lens
  ring were turned down after the first stills: the flakes read as snow.

## Tuning notes

- Judge the population by `stats.mts`, never one still: an 87-drop sample's
  median swings ±30 % between seeds.
- `DRIFT_SPEED` × Drift's default is clip A's pace; `RUSH_GAIN` puts a full
  Rush reading at clip B's.
- `EDDY_GAIN` was set so the eddies' median speed is about the drift
  (tests check the ratio); `SWIRL_GAIN` is how far bass raises it.
- The soft edge is a width on screen (`EDGE_WIDTH`), never a share of the
  radius: a bead's edge is as soft as a pool's, as in the clips.
- With Drops at 1 the frame is three quarters covered and nearly every drop
  touches another, clip B's packing.

## Known issues and next steps

- The look waits for the owner's verdict beside the clips. Likely asks: the
  paint is flatter and more even than clip A's marbling; the lens ring is a
  guess at a refracted ring, not measured against frames; the pink family's
  glitter is a flat sprinkle.
- The on-screen median radius and cover run above clip A's (table above).
- Shove and Pour are checked by the tests and by the song row's 118 kicks and
  2 drops a minute, not yet frame by frame on a real kick.
- The inner-drop drain (one seen in 45 s) is not built.
- Clip B's full look (250 packed glossy drops) is only approximated by the
  Candy on navy paint with Drops turned up.

## Materials

- `oildrops/scripts/` — the #824 measuring scripts (the circle detector,
  tracking, shading profiles, flow, sheet fits, sheets), `stats.mts` (our
  population's numbers), `shot.mjs` (stills) and `automodes.mjs` (the Auto
  sign-off); its `README.md` lists them.
- The reference media is never in this repo: the downloaded slice and the
  frames stay in the session's work folder and the study's private page.

## Resume here

- `npm run dev`, then `/#/v/oildrops`; `?audio=synthetic&bpm=120` before the
  hash for a reproducible run.
- Stills: `node docs/scenes/oildrops/scripts/shot.mjs <out> --repo <checkout>
  --port <p> [--settings '{"paint":1}']`.
- Numbers: `node --experimental-strip-types docs/scenes/oildrops/scripts/stats.mts`.
- Real song: `node tools/tune-real.mjs oildrops --wav <song.wav> --port <p>
  --sheet <prefix>`.
- Gotchas: a worktree's `node_modules` symlink 403s the fonts (harmless for
  scene stills); the dev tuning bus clears `setParams` for about 1.5 s after
  load, so the shot script waits before applying settings.

## History

- this PR — first cut: the population, the two passes, tests, the record.
