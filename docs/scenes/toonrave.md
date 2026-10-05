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
  `MIN_DROP_GAP_BEATS`. `paused` (Clock on signal) holds `c` as a lost lock
  that doesn't advance; a returning lock re-anchors on the next bar line.
- `src/render/scenes/toonrave/dance.ts` — Dance and Energy, pure: `createDance`
  finds a beat in the Dance signal's fires (tempoComb.ts's `estimateTempo` +
  beatClock.ts's phase comb, reused unchanged) and learns the move, the signal
  folded over one bar of that beat (`MOVE_BINS` slots); `createEnergy` is
  base/boost/pump/drop; `createPlayhead` turns energy into on-beat speed steps
  (`SPEED_STEPS`) through the move. `frameAt`'s `castC` (the cast's own cycle
  position) and `move` (the groove's bounce values) are how index.ts hands the
  result to motion.ts.
- `src/ui/widgets/danceMove.ts` — the Dance card: the Dance row, the learned
  move with its playhead, the Energy rows and the Speed line, drawn from the
  scene's `probe()`.
- `src/render/scenes/toonrave/svgDraw.ts` — `compileScene` parses the markup
  once into a `DrawProgram`; `drawProgram` paints one `FrameState` with
  Canvas2D every frame (vector, so crisp at any zoom).
- `src/render/scenes/toonrave/glsl.ts` — `buildPostFrag`, the one GL pass: shows
  the canvas as a texture and applies the impact frame.
- `src/render/scenes/toonrave/index.ts` — the `Scene` (id `"toonrave"`),
  `SETTINGS`, `PANEL` (the Dance card), `probe()`, `shapeState` (applies Lights and Shake after `frameAt`,
  so the prototype's numbers stay untouched at the defaults), `HERO_C`,
  `CAST_RIGS`, `DROP_CYCLE_BEATS` and the DEV `freeze` command.
- Tests: `tests/toonrave.test.ts` (motion, conductor, drawing, settings) with
  the golden in `tests/toonraveMotion.golden.ts`.
- Plugs into: drives (`dance` and `energyPump` on `anim.lowOnset`,
  `energyBoost` and `clock` on `anim.energy` (`clock` with a scene-handled
  threshold `CLOCK_RUN_MARK`), `lights` on the treble level, `dropHits` on
  `anim.dropOnset`), `animClock` (`beats`, `tempoLock`), quality
  (`MAX_CANVAS_WIDTH` caps the canvas width). The build is es2017, so nothing
  at module scope touches `document`, `Path2D` or `window`.

## References

- The art direction was developed in a series of private style studies inspired by classic Nickelodeon and Cartoon Network cartoons
  (flat colour, heavy outlines, limited animation on twos, smear and squash
  poses, a hard impact frame). Studied as inspiration for the drawing and the
  timing; no frames, clips or audio were taken or copied.
- An earlier still from the same study rounds was the first drawing; the prototype redrew it as its own
  vector construction, and its hero frame is what the scene holds after the
  drop.

No `/ref` bundle; no downloaded media is kept anywhere in this repo.

## Measurements

2026-10-03, on the prototype (`artifacts/toonrave-prototype.html`):

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
  the prototype.
- 2026-10-04 — Bounce renamed Energy ("Dance size" was tried first and rejected; key still `bounce`, so saved looks
  keep working). "Bounce" plus a beat-grid wire read as "the signal makes them
  bounce", but the steps always follow the BPM through the conductor; the wire
  only pumps how big they are. The caption now says both, with the quiet-end
  share computed from `BOUNCE_DRIVE_DEPTH`.
- 2026-10-04 — Moves on signal (asked for as "sync their moves to any
  signal"): the cast's groove dancing can follow any wired signal instead of
  the BPM. Only the groove's dancing switches clocks; drops, gags, the build,
  lights and camera stay on the BPM, because the cycle's story is built on bar
  lines. A step jumps to the hit pose, the rebound plays at the tempo and holds
  at its top (`STEP_HOLD_PHASE`), so every fire shows as a slam down rather
  than drifting on between fires. Off by default; Bass hit as the default wire.
  Toggle rows had no wire port until this change (deviceMenu.ts's boolean
  branch skipped `buildDriveRow`), so Drop on big hits got its port too.
- 2026-10-04 — "Why do they move when the signal is at 0? Shouldn't be like
  that": Energy's beat-grid pulse kept scaling the held pose every beat. While
  the signal steps the cast, Energy's pulse is now sampled at each step and
  held, so it sizes each step and nothing moves the cast between steps.
- 2026-10-04 — "Still movement happens while there are no signals": measured
  on a silent mic, the cast's poses were frozen but the camera's push-in inside
  each shot, the drop gags and the build (still on the BPM), the button's
  squash and the snap into the groove all moved. Now the cast has its own cycle
  position everywhere in the cycle: groove fires step it, gag and build fires
  let it catch up to the script for half a beat, nothing else moves it (not
  even a drop, and not an unwired toggle); the camera holds each shot's
  framing while the toggle is on. Lights keep the beat: they have their own
  control.
- 2026-10-04 — "None of the drivers show signal but something affects the
  scene": the conductor free-ran at 120 BPM in silence, and everything that
  isn't the cast (lamps, lasers, LEDs, turntables, drops, cuts) reads that one
  clock. The user chose to stop the clock in silence and to expose it: Clock
  on signal, a driver on All level with a threshold line, on by default. It
  goes by input level, not tempo lock, because a lock can drop in a breakdown.
- 2026-10-04 — The Dance card replaces Energy-as-size and Moves on signal,
  after two prototype rounds (artifacts/dance-card-prototype.html). The user:
  "dance just a shape, energy is what makes them move", then "no shape …
  internal magic to turn any signal into nice movement … energy is how fast we
  move through that shape … shape should show sync with music". So Dance learns
  the move from its own signal (folded over one bar of the beat it finds) and
  Energy is the speed through it, in on-beat steps so it stays in sync; Energy
  is built like Caustics' Drift speed family with a drop that drains slower
  near the floor. The move drives the groove's existing poses (their bounce
  curve), so the cel swaps, the hair's lag and the crowd's offset rows all
  follow it. The gags and the build keep their script.
- 2026-10-04: the Dance card's two canvases take their size from
  `src/ui/onScreen.ts`'s `watchSize` instead of reading `clientWidth` every
  tick (a forced layout per read; found while chasing Physarum 2's panel
  lag). No visible change.

## Tuning notes

- Cuts 0 holds the wide shot (use it to judge the hero frame); the groove's
  picks vary per cycle by hash and never repeat a shot back to back.
- Judge the look on the hero frame: DEV `window.__toonrave.freeze(2 / 12)` with
  Cuts 0 gives the still; `freeze(0.03)` is the impact frame; `freeze(null)`
  releases. Freezing also neutralises the audio modulation, so the picture is
  repeatable.
- Under a locked beat clock the drops land on bar lines; with no lock it
  free-runs at 120 BPM until one appears.
- Dance: DEV `window.__toonrave.peek()` gives `castC` (the groove beat the move
  is on; null outside the groove or with Dance off), `move` (0..1, where the cast
  is in the move) and `energy`. Traced against hits, the move should jump on each
  hit and the castC beat step in order at 1x. The speed step follows energy
  smoothed over `STEP_ENERGY_SMOOTH_SEC`: a pump swings energy every beat, and an
  unsmoothed step flipped ½x/1x on every kick. A steady 120 BPM kick at the
  default pump sits near 0.6, so the 1x line is below that. A silent fake mic
  (`--use-file-for-fake-audio-capture` on a silent wav) is the honest "no
  signal" check; synthetic audio always has hits.
- Clock on signal: the threshold under its graph is the run mark; once running
  it stops only below `CLOCK_STOP_SHARE` of it, so a level at the line doesn't
  stutter. Nothing wired = held.

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
  benchmarked on a low-end device. Software rendering (SwiftShader, as in
  `tools/tune-sheet.mjs`) runs it at only about 20–25 fps; a real GPU holds the
  display rate.
- Some shot framings, kept from the prototype, read awkwardly:
  - In the build, the raver shot shows the pompadour guy's dangling feet across
    its top and crops the raver's chin.
  - The button shot crops the DJ's face out entirely.
  - The pomp shot is tight on the gag at its landing.

  Each is one rectangle in `motion.ts`'s shot table. Changing one also means
  updating the camera values in `tests/toonraveMotion.golden.ts`.
- The first cut after load can come before the tempo lock arrives, so it may miss
  the bar line. `conductor.ts` snaps to the grid on the first lock; every later
  cut lands on the bar.

## Materials

- `toonrave/artifacts/toonrave-prototype.html` — the prototype page ("Toon Rave
  Prototype"), one self-contained file with its own synth, built from the
  prototype's `src/` folder. It is our own art and has no reference media in
  it. Its source folder (with `NOTES.md`, the
  timing map and shot list, and its build and shoot scripts) lives outside the
  repo at `~/.claude/plans/rave-cut-scene/proto/`.
- `toonrave/artifacts/dance-card-prototype.html` — the Dance card prototype
  (published as the "Toon Rave Dance Card" artifact, 2026-10-04): a simulated
  track, a stand-in beat follower and the learned-move idea, judged before the
  scene's Dance card was built. Our own drawing, no reference media.
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
