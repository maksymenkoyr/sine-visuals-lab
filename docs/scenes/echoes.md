# Echoes (`echoes`)

One warm-white outline — a circle, a regular polygon, or a 3D or 4D
wireframe figure turning in space — drawn into a feedback loop that a drifting noise field warps every frame, so it sheds a
fan of echo lines that peel off, bend, pinch to points and fade. The music
swings its size once a bar, pops it outward on bass hits (a ripple that runs
down the fan) and spreads the echoes further apart as the mids get louder.
Draft, not yet on main.

## Where the code is

- `src/render/scenes/echoes/index.ts` — the scene: `SETTINGS`, the ping-pong
  render-target pair (`ensureTargets`, sized by `TARGET_SCALE` and capped at
  `MAX_TARGET_DIM` like Coil's), and `render()`, which turns settings and
  drives into the step pass's uniforms. The header explains why this is a
  feedback loop and not a drawn stack of copies.
- `src/render/scenes/echoes/glsl.ts` — `buildStepFrag` (one generation of the
  loop: sample one step back along `flowField`, fade by `uFadeStep`, screen
  the crisp outline from `outlineDist` on top) and `buildDisplayFrag` (the
  two channels to colour: `LINE_RGB` on black, or the room palette's ramp by
  freshness with Colours raised). Its header owns the R/G channel meaning and
  why the fade is linear.
- `src/render/scenes/echoes/solids.ts` — the 3D and 4D figures in `SOLIDS`
  (vertices only; edges are derived as nearest pairs) and `projectSolid`,
  which turns one through 3D/4D planes and projects it to 2D segments. Its
  header owns the turning and projection; `index.ts` maps the Shape chips
  (`SHAPES`) to flat corner counts or figures and uploads the segments as a
  one-row float texture that `segmentsDist` in glsl.ts reads.
- Shared systems: drives (Flow, Breathe, Kick), `noiseHash.ts`
  (`NOISE_HASH_GLSL` for the field, `wrapFlow` for the drift phase).
- Tests: `tests/echoesSolids.test.ts` (each figure's vertex and edge counts,
  equal edges, projected size); the cross-scene tests (`tests/drives.test.ts`,
  `tests/settingGroups.test.ts`, …) cover the rest through `listScenes()`.

## References

- **"Live coding generative visuals during our show called 404"** by
  u/xemantic, r/creativecoding, 2022-11-10
  (<https://www.reddit.com/r/creativecoding/comments/yrux9i/live_coding_generative_visuals_during_our_show/>),
  720×720, 30 fps, 59 s, with the show's audio. A phone video of a concert:
  the visual is projected on the back wall and, in perspective, on the floor;
  the performers' live code is projected beside it, and the venue's haze,
  light beams and the performers are in frame too. Studied for the look and
  the technique only — the projected code names the parameters it was played
  with (a shape's vertex count, its size swinging on a sine of time, a
  noise-driven feedback "impact" and a noise scale), and the scene is our own
  implementation of that idea, not a port of anything. Measured whole (0–59 s)
  in the `/ref` bundle `livecode-wall` (`tools/.cache/refs/livecode-wall/`),
  scanned from a 400×400 crop of the wall projection only (`crop=400:400:180:30`
  on the 720×720 frame) so the floor, the code text and most of the room stay
  out of the measurements.

## Measurements

2026-10-05, bundle `livecode-wall` (report in `echoes/livecode-wall/report.md`):

| What | Reference | Ours |
|---|---|---|
| Clean circle radius (20.2 s, `scripts/circle_fit.py`) | 94 px on the 400 px crop | Size default (circumradius, half-heights) |
| Stroke (`scripts/measure_lines.py`, 4 regime frames) | 2 px run median = 0.021 of the radius | `STROKE_HALF_HH` ×2 ≈ 0.023 of the default radius |
| Echo gap between neighbouring lines | median 10.5–14 px (p25 5–9, p75 18–27) ≈ 0.12 of the radius | judged by eye on `compare.png`, see Decisions |
| Line colour (bright pixels minus the local wall) | rgb (1.00, 0.94–0.97, 0.83–0.86) | `LINE_RGB` |
| Hard cuts | none in 59 s; 28 fades of 1–4 frames | none |
| Onset flashes | brightness rise z −0.00 over 32 strong onsets | none |
| Continuity across the beat | activity 0.26σ, brightness 0.06σ, zoom 0.25σ | continuous |
| Transitions | 18; 9 off-beat with no onset under them | — |
| "Strobes" | 6.3 s and 9.6 s, flash every 0.73 beat (no beat ratio) | not built |
| Bar/phrase brightness | rank 8 z +1.04, rank 16 z +0.43 | not built |
| Tempo (librosa) | 112.3 bpm | our tracker held ×1 for 17 % of the clip (median 134.7) |
| Our onsets vs theirs | — | 68 % of theirs within 60 ms, lag +12 ms |
| Our `section` at the reference's 7 audio boundaries | — | no rise near any |

Burst `009.35` settled the 9.6 s "strobe": frames 11–17 grey the whole frame
evenly, haze included, so they are a house light. From 10.1 s on, the soft
cream fill that grows inside the circle is the visual itself, echoes
overlapping into a sheet.

Reaction check, synthetic 112 bpm, `scripts/radius_burst.mjs` (Flow 0,
Echoes 2, so only the outline shows): at Kick 0.3 a bass hit popped the
radius about 0.08 half-heights and it decayed over about half a beat, on every
beat; the bar wave moved the resting size between pops.

## Decisions and pivots

2026-10-05 — built in one session from `/ref`:

- **Sync hypotheses, and how they held up.** (1) Size swings continuously on
  a timer: the projected code says so and the slit-scan's centre row shows
  slow sine waves. Held; ours puts that swing on the Bar wave instead, as a
  wire, because a scene here should move with the music. (2) The flow field
  drifts continuously ("continuous across the beat" for activity, brightness
  and zoom). Held; Drift is a plain timer. (3) No onset flashes and no hard
  cuts. Held; nothing in the scene flashes. (4) Regime changes are the
  performer typing (9/18 transitions off-beat with no onset). Held; shape,
  Flow and Detail are settings, not triggers, and our `section` signal
  showed no rise at the audio boundaries anyway. (5) The two "strobes" are a
  timer at 0.73 beat; burst `009.35` showed the 9.6 s one is the venue's
  light. Not built. (6) A weak brightening on bar/phrase starts: the only
  audio link, too weak to copy as a flash; Kick (a size pop on bass hits) is
  ours, not the reference's.
- **Cropped to the wall.** The floor projection is the same picture in
  perspective; the code text, the haze beams and the performers are the
  venue. The first full-frame scan's look numbers were swamped by them.
- **A feedback loop, not a drawn stack of copies.** The index.ts header has
  the reasoning; the loop gives the stationary fan, the sheets where the flow
  stalls, and the softening of old echoes without faking any of them.
- **First shoot showed Physarum 2.** The setting key `detail` became
  `uDetail`, a common uniform (`sceneCommon.ts`), so the shader failed to
  compile and the app fell back. Renamed the key `flowDetail`.
- **Tube, not fans.** With the field's cells larger than the outline, every
  echo was the same circle shifted. Made the field finer (`FIELD_FREQ`) and
  the step larger (`STEP_PER_FLOW`) until parts of the outline peel off in
  different directions and cross it, as the reference's do.
- **Linear fade.** A proportional fade left a long tail of faint lines; the
  reference shows a handful of even ones that stop. The fade is now the same
  amount off every generation, so Echoes is exactly how many lines trail,
  and the display pass eases brightness so they stay bright until near the
  end of the fan.
- **Breathe on the plain Bar wave.** A one-source patch on Beat wave every 8
  beats was closer to the reference's slow timer, but no patch default had
  used a divider and the drives test's patch identity check reads Beat wave
  as 0 in its fixture. Moved to `anim.barWave` and lowered the amount.
- **Kick halved.** On four-on-the-floor the pop lands on every beat and
  pumped the outline against the reference's calm drift.
- **Finer octave halved.** It compounds down the fan, so at the first
  strength echoes crinkled where the reference's sweep in smooth arcs;
  compared side by side with the previous version before keeping it.

2026-10-05 — the user asked "can figures morph into each other? can we add
3d figures? 4d?", then "just add 3d and 4d figures" (no morphing):

- **3D and 4D figures as more Shape chips**, appended after the flat ones
  so a saved look's index still means the same shape. Wireframes, turned
  and projected in JS each frame (a few dozen vertices at most), drawn by
  the shader as the nearest of the projected segments — the echo loop is
  unchanged. A 4D figure also turns through two planes that include the
  fourth axis, which is what turns a tesseract inside out.
- **Spin drives the tumble.** One turn phase, with each plane at its own
  multiple, so the Spin slider speeds the whole motion; the phase is never
  wrapped, since wrapping would jump every plane but the first.
- **Sized by a measured average.** Projected as built, the 4D figures and
  the tetrahedron drew about half the size of a circle at the same Size.
  Each figure is now divided by its own average projected size over a sweep
  of turns, measured once, so all of them land within about ±12 % of the
  circle while a 4D figure's swelling as it turns still shows.
- **GPU cost:** `tools/gpu-bench.mjs --app --dpr 2` put the step pass at
  0.81 ms with the circle and 3.74 ms with the 24-cell, the figure with the
  most edges, but a circle re-run straight after read 4.10 ms. On this
  machine the GPU clock and the shared Chrome swing more than the figure
  costs, so no optimisation was made. Pixels beyond the figure's reach skip
  the edge loop.

## Tuning notes

- The reference's bare-circle stretches (17–20 s) are Flow 0; its busy
  square stretch (37–46 s) is about Shape Square, Flow 0.9, Echoes 14.
- Detail is the reference's `noise.scale`: right gives busier, smaller bends.
- Echoes past about 20 starts filling the fan into a sheet; that's the
  reference's 10–12 s look, but not a good resting state.
- Judge it on real music: synthetic audio's mid level is low, so Flow reads
  short fans there.
- The figures with many edges (the 24-cell, the icosahedron) fill into a
  dense mass at the default Echoes; fewer echoes, or more Spin so the trails
  separate, reads cleaner.

## Known issues and next steps

- Only checked on the reference clip and synthetic audio, not on a range of
  real tracks. On the reference clip our tempo held ×1 only 17 % of the time,
  so the bar-wave swing ran at the wrong tempo there.
- The reference's dense sheet fills (10–12 s) are rare at the defaults.
- In a room, each device runs its own loop: an echo that crosses a tile edge
  isn't carried to the neighbouring device (it's sampled as black), the same
  limit Coil has.
- No `auto` weight tables yet.

## Materials

- `echoes/livecode-wall/` — our half of the `/ref` bundle (report, data, our
  shots), saved with `tools/ref-keep.py`.
- `echoes/scripts/` — `circle_fit.py` and `measure_lines.py` (the stroke,
  gap and colour numbers above), `radius_burst.mjs` (the reaction check),
  `variants.mjs` + `tile.py` (headless settings variants, tiled).
- The reference media (the video, its audio, the wall crop, frames, bursts)
  is in the local `/ref` cache and the private archive (`tools/ref-archive.py`),
  never in this repo.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=112#/v/echoes`.
- Compare at the same beats:
  `node tools/ref-shoot.mjs tools/.cache/refs/livecode-wall --scene echoes --port <port> --size 600x600`
  (square, like the crop). The crop is tighter than the projection: the
  reference's circle is about 0.47 crop half-heights, ours sits at Size.
- Gotchas: Homebrew ffmpeg on this machine died on a missing
  `libx265.216.dylib` (2026-10-05); `DYLD_LIBRARY_PATH` pointed at the
  unlinked x265 4.2 keg in the Cellar made it run without touching the
  install. yt-dlp's Reddit download came as separate video and audio streams
  that its failed ffmpeg merge left unjoined. A setting key that collides
  with a common uniform fails the shader silently into another scene; check
  the probe's `scene`.

## History

- #369 — first draft from `/ref` on the live-coding reference; then 3D and
  4D wireframe figures as more Shape chips.
