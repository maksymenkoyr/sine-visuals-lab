# Ember (`ember`)

Red fire rising out of black: a full-screen fluid simulation fed red dye and
an upward push by a row of burners along the bottom, so the fire rolls over
itself, curls and sheds mushroom-capped blobs; the dye fades as it climbs,
which leaves the black above. Over a few bars the fire swells up the screen
and sinks back. Kicks surge the burners and flare the glow, the bass heats
it, louder sections churn the fluid harder. Draft, added 2026-10-21; not yet
on main.

## Where the code is

- `src/render/scenes/ember/index.ts` — a hand-rolled `Scene` (not
  `createFullscreenScene`: the display samples the sim's own texture, as
  Sky's does). Owns `SETTINGS`, the sim (`createFluidSim` in `MIRROR_OFF`,
  edge pass off), the splats it feeds each frame (burners, stirrers, the
  bed), the warm start (`WARM_SEC`, `WARM_STEPS`), and the constants that
  set force, dye and timing (`BURN_*`, `STIR_*`, `BED_*`, `LIFT_*`,
  `RISE_TIME`).
- `src/render/scenes/ember/glsl.ts` — `buildDisplayFrag`: reads the dye
  sharp, through a near ring of taps (soft body + its gradient for the rims)
  and a far ring (the smoke halo); a hotter base and core; own red or the
  room palette.
- `src/render/scenes/ember/motion.ts` — `SWELL_SHAPE` (the measured swell),
  `swellAt`, `swellRate`, the kick lift envelope (`advanceLift`), and the
  splat paths: `burnerAt` (`BURNERS` along the bottom) and `stirrerAt`
  (`STIRRERS`, force-only, through the body). Tested in
  `tests/emberMotion.test.ts`.
- Shared systems: `fluidSim.ts` (the stable-fluids solver Neon Fluid and Sky
  use — units and codecs are in its header), drives (`lift` on a hit;
  `churn`, `heat` and `rise` on levels).

## References

- "Red Abstract Wave Loop 4K UHD Ambient TV Background Screen Visuals | No
  Sound" by ALIVE SCREENS — https://youtu.be/vg2cB1EeJpo — studied at
  1:00–1:30 for the look and the motion only: a silent, 3-hour ambient loop
  with no chapters. Measured in the `/ref` bundle `vg2cB1EeJpo`. Its picture
  is itself a fluid simulation; Ember is an independent design on our own
  solver. Nothing in the reference syncs to music, so every reaction here is
  our own.

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
  0.136, 0.146, 0.145, 0.128 — the source of `SWELL_SHAPE`.
- Palette: `#070000` 26%, `#3c0000` 19%, `#730000` 18%, `#aa0000` 21%,
  `#df0000` 15%; saturation 0.85.
- Flow: features climb at 0.08 half-heights/s at r 0.5; the −1.7°/s
  "rotation" is the fluid's own swirl, not a camera spin.

Red-channel shares, reference vs Ember at rest (ref-shoot on the silent
bundle audio, the same 21 shots):

| bin | ref | noise version (10-21) | fluid version (10-24) |
|---|---:|---:|---:|
| mean | 0.408 | 0.434 | 0.429 |
| <0.1 | 0.19 | 0.25 | 0.37 |
| 0.1–0.3 | 0.18 | 0.11 | 0.08 |
| 0.3–0.5 | 0.30 | 0.15 | 0.08 |
| 0.5–0.7 | 0.16 | 0.23 | 0.11 |
| 0.7–0.85 | 0.09 | 0.23 | 0.14 |
| ≥0.85 | 0.08 | 0.03 | 0.22 |

`tools/tune-real.mjs ember` on around-the-world (30 s from 4 s), change as %
of full scale per 100 ms:

| version | source | change med | change p95 | hits/min |
|---|---|---:|---:|---:|
| noise (10-21) | song | 1.64 | 2.72 | 284 |
| noise (10-21) | silence | 0.37 | 1.11 | 0 |
| fluid (10-24) | song | 0.56 | 0.92 | 288 |
| fluid (10-24) | silence | 0.35 | 0.42 | 0 |

The fluid version moves less in absolute terms (a fluid answers a push over
a beat or so), but its silence is calmer, so song/silence p95 is 2.2× for
both.

## Decisions and pivots

- 2026-10-21 — Sync hypotheses from the `/ref` report, none of which the
  runtime can see (the reference is silent): the swell is an 8 s timer; the
  fire climbs continuously; every change is a fade. Kept as the rest state;
  music reactions are ours: the swell's period becomes whole bars at the
  held tempo (the default bar count at `REST_BPM` equals the reference's
  period), kicks lift the fire, the bass heats it, section intensity drives
  churn.
- 2026-10-21 — First version (#652's first commit): layered noise fronts in
  one fragment shader, tuned side by side against the reference.
- 2026-10-24 — Owner: "source looks better. like u missed couple shaders".
  The reference is a fluid sim with a soft glow; noise fronts can't roll
  over, curl or shed blobs, and one pass had no glow. Rebuilt on
  `fluidSim.ts` with a display pass that blurs the dye through two rings of
  taps. Tuned against the reference by ref-shoot: more, narrower burners for
  its row of lobes; weak stirrers (strong ones made two or three whorls take
  over the frame); a wide dye bed so the box's return flow can't pull black
  down between the plumes; dye kept under the sim's cap so the body has
  tones, not one flat red; the halo on the body's own curve (raw density
  saturated the output); a warm start so a mount isn't black for seconds.
- 2026-10-24 — On a four-on-the-floor song the first lift settings filled
  the whole frame with flat red; the lift's extra push and dye were cut, and
  the glow now flares with each kick so it reads before the fluid answers.

## Tuning notes

- At rest (silence) Heat and Churn sit where the silent reference does;
  music only adds on top.
- Fire height sets how fast the dye fades as it climbs.
- Swell length is in bars; at the rest tempo its default matches the
  reference loop.
- Room colours off keeps the reference's own red; on, the body follows the
  room palette's ramp.

## Known issues and next steps

- Tones are still split: too much near-black and too much hot red against
  the reference's mid-reds (table above).
- The sim's thin jets with mushroom caps are livelier than the reference.
- The swell runs at the tempo's rate but isn't phase-locked to the downbeat.
- Cost: the sim's passes plus two rings of `RING_TAPS` taps a pixel; not
  yet measured with `tools/gpu-bench.mjs`.

## Materials

- `ember/vg2cB1EeJpo/` — our half of the `/ref` bundle (report, data, our
  same-beat shots of the current version), saved with `tools/ref-keep.py`.
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
  shader compile error shows up in ref-shoot only as a mic timeout; the
  display's brightness saturates easily on raw dye density (up to the sim's
  `DYE_MAX`), so a gain change that "does nothing" usually means another
  term is already saturating.

## History

- 2026-10-21 — #652, first draft (noise fronts).
- 2026-10-24 — #652, rebuilt on the fluid sim.
