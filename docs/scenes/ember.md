# Ember (`ember`)

Red fire fronts rising out of black: soft glowing lobes with a brighter rim
along each crest, dark lanes curling through the body, the whole fire
swelling up to fill the screen and sinking back over a few bars. Kicks throw
the fronts upward, the bass heats the body, louder sections churn it harder.
Draft, added 2026-10-21; not yet on main.

## Where the code is

- `src/render/scenes/ember/index.ts` — the scene module: `SETTINGS`, the
  per-frame clocks (`extraUniforms`: the kick lift through
  `drives.fired("lift")`, the climb phase on `createScaledPhase` over
  `anim.flowPhase`, the swell phase), and the constants that set the climb
  speed (`RISE_PER_SEC`, `LIFT_RISE_PER_SEC`, `MORPH_PER_RISE`).
- `src/render/scenes/ember/glsl.ts` — `FRAG`: value-noise fbm on
  `NOISE_HASH_GLSL`, a two-stage domain warp that climbs (`WARP_SCALE`),
  `frontField` (the height line of each front, with ridged tips and the
  smooth line the body's depth is read from), the sheet/rim shading loop
  over `MAX_LAYERS`, and the own-red vs room-palette output.
- `src/render/scenes/ember/motion.ts` — `SWELL_SHAPE` (the measured swell),
  `swellAt`, `swellRate` (bars at the held tempo, `REST_BPM` without one),
  and the kick lift envelope (`advanceLift`, `LIFT_ATTACK_SEC`,
  `LIFT_FALL_SEC`). Tested in `tests/emberMotion.test.ts`.
- Shared systems: drives (`lift` on a hit, `churn` and `heat` on levels),
  `noiseHash.ts` (every phase reaching a noise coordinate goes through
  `wrapFlow`), `flowClock.ts`.

## References

- "Red Abstract Wave Loop 4K UHD Ambient TV Background Screen Visuals | No
  Sound" by ALIVE SCREENS — https://youtu.be/vg2cB1EeJpo — studied at
  1:00–1:30 for the look and the motion only: a silent, 3-hour ambient loop
  with no chapters. Measured in the `/ref` bundle `vg2cB1EeJpo`. Its picture
  is a fluid simulation; Ember is an independent design (layered noise
  fronts, no simulation) that aims at the same feel. Nothing in the
  reference syncs to music, so every reaction here is our own.

## Measurements

2026-10-21, bundle `vg2cB1EeJpo` (clip 60–90 s of the video, 1280×720, 30 fps):

- Silent: no beat grid, every "on beat" in the report is the 120 BPM
  placeholder grid.
- An exact 8.0 s loop: the frames at 0, 8 and 16 s are identical, and the
  regime-change lines repeat every 8 s (bright +1.7σ at 2/10/18/26 s, −1.9σ
  at 8/16/24 s).
- No hard cuts at 30 fps; every change is a fade. The 19.7 s "strobe"
  (0.40 s apart) is the loop's swirl phase, not a flash.
- Mean brightness folded on the 8 s period, in 0.5 s steps: 0.087, 0.062,
  0.073, 0.106, 0.138, 0.155, 0.153, 0.151, 0.162, 0.170, 0.159, 0.138,
  0.136, 0.146, 0.145, 0.128 — the source of `SWELL_SHAPE`. The darkest point
  sits just after the seam, the brightest mid-loop (×2.7).
- Palette: `#070000` 26%, `#3c0000` 19%, `#730000` 18%, `#aa0000` 21%,
  `#df0000` 15%; saturation 0.85; ground `#310000`–`#850001` by regime.
- Flow: features climb at 0.08 half-heights/s at r 0.5 (Ember's
  `RISE_PER_SEC`); the −1.7°/s "rotation" is the fluid's own swirl, not a
  camera spin.
- Red-channel shares, reference vs Ember at rest (ref-shoot on the silent
  bundle audio, the same 21 shots): mean 0.408 / 0.434; <0.1: 0.19 / 0.25;
  0.1–0.3: 0.18 / 0.11; 0.3–0.5: 0.30 / 0.15; 0.5–0.7: 0.16 / 0.23;
  0.7–0.85: 0.09 / 0.23; ≥0.85: 0.08 / 0.03.
- `tools/tune-real.mjs ember` on around-the-world (30 s from 4 s), change as
  % of full scale per 100 ms:

  | source  | change med | change p95 | hits/min | energy |
  |---------|-----------:|-----------:|---------:|-------:|
  | song    | 1.64       | 2.72       | 284      | 0.61   |
  | silence | 0.37       | 1.11       | 0        | 0.00   |

  Song p95 / silence p95 = 2.4×. The silence motion is the designed climb
  and swell.

## Decisions and pivots

- 2026-10-21 — Sync hypotheses from the `/ref` report, none of which the
  runtime can see (the reference is silent): the swell is an 8 s timer; the
  fronts climb continuously; every change is a fade. Kept as the rest state;
  music reactions are ours: the swell's period becomes whole bars at the
  held tempo (the default bar count at `REST_BPM` equals the reference's
  period), kicks lift the fronts and speed the climb, the bass heats the
  body, and section intensity drives churn.
- 2026-10-21 — First pass drew thin crest lines over a dark body; the
  same-beat comparison showed the reference is body-dominant (bright lobes,
  brightest just under each rim). Switched to stacked glowing sheets that
  combine like light, with a wide inner rim glow.
- 2026-10-21 — The swell at first only brightened the body. The comparison
  showed the reference's fire climbs to fill the frame at mid-loop, the
  black top returning only at the seam, so the swell now lifts the fire
  (`SWELL_RISE`) and dims the body only a little.
- 2026-10-21 — Fronts were measured in pixels from screen derivatives; below
  a steep tip that leaked the rim's glow into vertical streaks, so the
  gradient is capped.

## Tuning notes

- At rest (silence) Heat and Churn sit where the silent reference does;
  music only adds on top, so a quiet room still looks like the reference.
- Swell length is in bars; at the rest tempo its default matches the
  reference loop.
- Sharp tips: low values give rounded lobes like the reference; high values
  read as flame tongues.
- Room colours off keeps the reference's own red; on, the body follows the
  room palette's ramp.

## Known issues and next steps

- On a dense four-on-the-floor song the kick lift rarely falls back, so the
  black top mostly disappears; the owner should judge whether Kick lift's
  default or `LIFT_FALL_SEC` should come down.
- The red-channel spread is still narrower than the reference's: too much
  in 0.5–0.85, too few hot patches.
- The reference's fluid makes real overhangs and detached blobs (the round
  "bubble" at the seam); a height-line model only approximates those
  through the warp.
- The swell runs at the tempo's rate but isn't phase-locked to the downbeat.

## Materials

- `ember/vg2cB1EeJpo/` — our half of the `/ref` bundle (report, data, our
  same-beat shots), saved with `tools/ref-keep.py`.
- The reference media and comparison sheets: the local `/ref` cache and the
  private archive (`tools/ref-archive.py`), never this repo.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/ember`.
- Same-beat comparison: `node tools/ref-shoot.mjs tools/.cache/refs/vg2cB1EeJpo --scene ember --port <port> --min-rank 8 --max-beats 8`
  (the bundle audio is silent, so this shows Ember at rest, as the reference
  is).
- Real audio: `node tools/tune-real.mjs ember --wav tools/.cache/tempo-tracks/around-the-world/audio.wav --port <port>`.
- Gotchas: Homebrew ffmpeg needed the old x265 keg on `DYLD_LIBRARY_PATH`,
  through wrapper scripts on `PATH` (`/usr/bin/env` strips `DYLD_*`); a
  shader compile error shows up in ref-shoot only as a mic timeout.

## History

- 2026-10-21 — #652, first draft.
