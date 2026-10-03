# Toon Rave (`toonrave`)

A hand-drawn-looking cartoon rave in a balcony room: a tiny DJ stands behind a
giant red button, a crowd bounces on twos, lasers and lamps sweep, and the
camera cuts between close shots on bar lines. Every cycle ends in the drop:
a two-colour impact frame, then a held wide "hero" frame, then gags, a groove
and a build back up. The beat clock drives the whole cycle, so the drops land
on the app's bar lines. Draft scene, not on main yet.

## Where the code is

- `src/render/scenes/toonrave/art/` — the drawing as SVG string builders
  (`lib.ts`, `room.ts`, `cast.ts`), assembled by `buildSceneSvg` in
  `art/scene.ts`, which also holds `WORLD_TRANSFORM`, the impact-frame
  colour tables (`IMPACT_MATRIX`, `IMPACT_A`, `IMPACT_B`) and the `ANCHORS`
  where props attach.
- `src/render/scenes/toonrave/motion.ts` — `frameAt(c, opts)`, a pure function
  of the cycle position `c` (beats, drop at 0) returning a `FrameState`: rig
  matrices, fx opacities, cels, crowd eye classes, LED states, the camera and
  the impact flag. `cutPlan` is the edit (which shot on which bar),
  `stepsPerBeat` is the "on twos" quantiser, `cameraMatrix` the shot framing.
- `src/render/scenes/toonrave/conductor.ts` — `createConductor`: turns
  AnimFrame's beats/`tempoLock`/bpm into `c`. Locked, `c` follows the beats and
  re-anchors only at a drop; unlocked, it free-runs and slews back to a bar line
  when the lock returns. `dropFired` can start a cycle early, gated by
  `MIN_DROP_GAP_BEATS`.
- `src/render/scenes/toonrave/svgDraw.ts` — `compileScene` parses the markup
  once into a `DrawProgram`; `drawProgram` paints one `FrameState` with
  Canvas2D every frame (vector, so crisp at any zoom).
- `src/render/scenes/toonrave/glsl.ts` — `buildPostFrag`, the one GL pass: shows
  the canvas as a texture and applies the impact frame.
- `src/render/scenes/toonrave/index.ts` — the `Scene` (id `"toonrave"`),
  `SETTINGS`, `shapeState` (applies Bounce, Lights and Shake after `frameAt`,
  so the prototype's numbers stay untouched at the defaults), `HERO_C`,
  `CAST_RIGS`, `DROP_CYCLE_BEATS` and the DEV `freeze` command.
- Tests: `tests/toonrave.test.ts` (motion, conductor, drawing, settings) with
  the golden in `tests/toonraveMotion.golden.ts`.
- Plugs into: drives (`bounce` on the beat grid, `lights` on the treble level,
  `dropHits` on `anim.dropOnset`), `animClock` (`beats`, `tempoLock`), quality
  (`MAX_CANVAS_WIDTH` caps the canvas width). The build is es2017, so nothing
  at module scope touches `document`, `Path2D` or `window`.

## References

- Style study: the look of classic Nickelodeon and Cartoon Network cartoons
  (flat colour, heavy outlines, limited animation on twos, smear and squash
  poses, a hard impact frame). Studied as inspiration for the drawing and the
  timing; no frames, clips or audio were taken or copied.
- An earlier still from the same study rounds (`stills/r5/zim-ppg` in the
  prototype folder) was the first drawing; the prototype redrew it as its own
  vector construction, and its hero frame is what the scene holds after the
  drop.

No `/ref` bundle; no downloaded media is kept anywhere in this repo.

## Measurements

2026-10-03, on the prototype (`artifacts/zim-rave-drop.html`):

- **Hero frame vs the prototype's still:** mean difference 0.37/255, no pixel
  off by more than 24/255 at 1600x900. Matrices written at 1e-6 (4 decimals
  had shifted the tilted characters by about 1 px); the rest came from the
  fitted lamp-glow ellipses.
- **Frame cost** (prototype, SVG in Chromium, 1600x900, vsync off, whole
  cycle): median about 3.2 ms, p95 about 7 ms, on a machine at load 14 to 18,
  so noisy. The crowd's per-head opacity groups were the biggest paint cost.
- **Clock rate:** 2.142 beats/s measured against 2.133 expected at 128 BPM.

The scene's own hero-frame and frame-time measurements belong to plan step 7
and are not recorded here yet.

## Decisions and pivots

- 2026-10-03 — Style rounds on stills led to this cartoon look; one still was
  rebuilt as a living beat-synced loop (the prototype) with its own WebAudio
  synth.
- 2026-10-03 — The prototype becomes the scene, with the app's beat clock
  replacing the built-in synth: `conductor.ts` produces `c`, `motion.ts` is the
  prototype's `frame(T)` ported unchanged, so the hero frame is still the still.
- 2026-10-03 — Canvas2D draws the vector art each frame, shown through a GL
  post pass. Not a pure WebGL port: the art is SVG-shaped (nested rigs, gradients,
  blends), Canvas2D keeps it crisp at any zoom and keeps the drawing identical;
  the GL pass exists for the impact frame and to fit the Scene contract. The
  prototype had no filters (every blur became a radial gradient), which is
  what makes the Canvas2D port exact.
- 2026-10-03 — The DJ changes layer (behind the button in the groove, in front
  when airborne): her legs would cover the dome otherwise. The only
  re-parenting in the rig.
- 2026-10-03 — The impact is a two-colour frame of the real hero composition,
  not a white flash: it reads in the scene's own palette and costs nothing for
  the rest of the cycle.
- 2026-10-03 — Settings reshape the state after `frameAt` (`shapeState`)
  rather than being threaded through `motion.ts`, so the defaults are exactly
  the prototype and Bounce 1 never moves the hero frame.

## Tuning notes

- Bounce scales each cast rig's matrix between the hero-frame rest pose and the
  moving one; 0 freezes everyone. Cuts 0 holds the wide shot (use it to judge
  the hero frame); the groove's picks vary per cycle by hash and never repeat a
  shot back to back.
- Judge the look on the hero frame: DEV `window.__toonrave.freeze(2 / 12)` with
  Cuts 0 gives the still; `freeze(0.03)` is the impact frame; `freeze(null)`
  releases. Freezing also neutralises the audio modulation, so the picture is
  repeatable.
- Under a locked beat clock the drops land on bar lines; with no lock it
  free-runs at 120 BPM until one appears.

## Known issues and next steps

- The groove is repetitive: whole-rig squash and stretch plus cel swaps, with
  few new in-betweens, so it reads mechanical after a few cycles.
- Each crowd row bounces as one block: no per-head offset or arm wave.
- There is no downbeat detection, so the cycle may start off the musical bar;
  press B (the Beat trim's bar resync, see `src/render/beatTrim.ts`) to
  resync the bar.
- The DJ's colours sit near one well-known cartoon character. Change them
  before release.
- The DJ's wind-up reads one-armed (the left arm hides behind her headphone
  cup); it needs a dedicated over-the-head arm drawing.
- Not yet heard on real music: the sync is tested only with synthetic audio.
- No `minQuality`; the canvas width scales with quality but it has not been
  benchmarked on a low-end device.

## Materials

- `toonrave/artifacts/zim-rave-drop.html` — the prototype page ("Zim Rave
  Drop"), one self-contained file with its own synth, built from the
  prototype's `src/` folder. It is our own art and has no reference media in
  it. Its source folder (with `NOTES.md`, the
  timing map and shot list, and its build and shoot scripts) lives outside the
  repo at `~/.claude/plans/rave-cut-scene/proto/`.
- The plan the scene was built from: `plans/toonrave.md`.
- No `/ref` bundles, and no reference media of any kind.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/toonrave` for headless
  checks (the dev server prints the plain scene link at startup; use
  `SKIP_PRIVATE_SCENES=1 npm run dev` in a worktree without the private
  checkout).
- Hero frame: set Cuts to 0, then `window.__toonrave.freeze(2 / 12)` and
  screenshot at 1600x900; compare with the prototype's `png/original.png`.
  `freeze(0.03)` is the impact frame.
- Tools for the next pass: `tools/tune-sheet.mjs` for contact sheets and
  `tools/tune-probe.mjs` for frame time.
- Gotchas: the dev server is HTTPS and 5173 may be taken, so use the port it
  prints; tests import every scene under node, so keep `document`, `Path2D` and
  `DOMParser` out of module scope.

## History

<!-- HISTORY: PR number once opened -->
- `2e3c637` — plan.
- `d755bfb` — port the prototype's drawing, motion and a bar conductor.
- `09298a6` — draw the SVG with Canvas2D.
- `e4bb770` — the scene.
