# Plan: Toon Rave scene (the cartoon rave prototype, as a real scene)

## Goal

A new draft scene, id `toonrave` (working name "Toon Rave"), that plays the cartoon rave
prototype inside the app. The prototype is the tiny DJ who slams the giant red button at
the drop: the same drawing, beat-locked limited animation, gags and camera cuts. Its
clock is the app's beat clock instead of a built-in synth. The drawing is the
prototype's vector art, drawn with Canvas2D into a canvas every frame (crisp at any zoom)
and shown through a small WebGL2 pass. That pass also does the impact frame.

## Read first

- **The prototype**, in `/Users/yaro/.claude/plans/rave-cut-scene/proto/` (outside the
  repo; read-only for this plan):
  - `NOTES.md`: how it is built, the timing map, the shot list.
  - `src/lib.js`, `src/room.js`, `src/cast.js`: the drawing, as SVG strings.
  - `src/motion.js`: `frame(T)`, a pure function of the cycle position.
  - `src/app.js`: how the frame state is written onto the SVG (rigs `data-x`, fx
    `data-o`, cels `data-cel`, `data-led`, `data-ray`, crowd eye classes, the impact
    filter). It also has the controller and the scheduler.
  - `zim-rave-drop.html`: the built page.
  - `png/original.png`: the hero frame.
- **Adding a scene:** `.claude/commands/new-scene.md` (the checklist) and
  `docs/adding-a-scene.md`.
- **The model scene:** `src/render/scene.ts` (the `Scene` interface) and
  `src/render/scenes/coil/index.ts`, a hand-written `Scene` with its own GL objects and a
  pure motion module.
- **Bar counting and drop triggers:** `src/render/scenes/gates/index.ts` (`advanceGates`)
  and `tests/gates.test.ts`. They count bars while `tempoLock > 0.5` and free-run
  otherwise.
- **Settings:** the headers of `src/render/sceneSettings.ts`, `src/render/drives.ts` and
  `src/render/animClock.ts`, plus `src/render/beatListener.ts`.
- **The record:** `docs/scenes/_template.md` and `docs/scenes/coil.md` (an example).

## Do not touch

- Every other scene; the app core (`src/render/*.ts` outside `scenes/toonrave/`) except
  the 4 registry edits in step 5; `src/audio/`; the private-scenes folder.
- The art: the drawing must stay identical to the prototype. No redesign, no new colours.
- **Build target:** es2017 syntax. Use `document.createElement("canvas")`, not
  `OffscreenCanvas`, and no `ctx.roundRect`.
- Nothing at module scope may touch `document`, `Path2D`, `DOMParser` or `window`, because
  tests import every scene under node. Create those in `init()` or in functions it calls.

## Steps

Each step is one commit, made by the lead after the step's check passes. Do not commit
yourself unless the step says so. Never use `git stash`.

### 1. Port the drawing to TypeScript string builders

- **Files:** `src/render/scenes/toonrave/art/lib.ts`, `art/room.ts`, `art/cast.ts`,
  `art/scene.ts`.
- **Edit:** a faithful port of the prototype's `src/lib.js`, `room.js` and `cast.js`.
  - Keep the same functions, the same numbers and the same output strings. Only add
    types and exports.
  - `art/scene.ts` exports `buildSceneSvg(): string`, which returns the full SVG markup
    the prototype builds before its first frame: the defs, the tilted world group and
    every rig, fx and cel. Read `src/app.js` and `src/page.html` to see exactly how the
    page assembles it.
  - It also exports any metadata the prototype keeps beside the markup (`ANCHORS` and
    the like), as typed constants.
  - These are pure functions: no DOM and no randomness except the prototype's own seeded
    random, ported as it is.
- **Check:**
  - `npm run typecheck` passes.
  - A new `tests/toonrave.test.ts` asserts that `buildSceneSvg()` is deterministic (two
    calls are equal).
  - The test also asserts that the markup's SHA-256 equals the prototype builder's
    output. To get the expected hash, run the prototype's `lib.js`, `room.js` and
    `cast.js` plus the same assembly code under node `vm` with no DOM. Write the hash into
    the test as a constant, with a comment saying how it was made.

### 2. Port the motion to a pure module

- **File:** `src/render/scenes/toonrave/motion.ts`.
- **Edit:** port `src/motion.js` as `frameAt(c: number, opts: MotionOpts): FrameState`.
  - `c` is the cycle position in beats, with the drop at `c = 0`.
  - `FrameState` holds:
    - rig matrices by rig id;
    - fx opacities;
    - the cel chosen per part;
    - the crowd eye classes;
    - the LED states;
    - the ray state;
    - the camera: shot id, source rectangle and shake offset, in frame units of the
      1600×900 art;
    - `impact`: 0..1, the prototype's impact-filter amount.
  - `MotionOpts` = `{ cycleBeats: 32 | 64 | 128; cuts: 0 | 1 | 2 | 3; bpm: number }`.
- **Generalise the cycle.** The prototype is the 32-beat case:
  - aftermath = `[0, 16)` (the gags);
  - groove = `[16, cycleBeats - 8)`, repeating the prototype's groove poses with their
    own period;
  - build = `[cycleBeats - 8, cycleBeats)`.
- **Cuts:**
  - `cuts = 0` holds the wide shot.
  - 1, 2 and 3 cut every 4, 2 and 1 bars in the groove, as in the prototype's `cutPlan`.
  - The drop is always wide.
  - The same shot never appears twice in a row, including across the wrap.
- **On twos:** characters use the beat-locked quantised position
  (`stepsPerBeat(bpm) = round(720 / bpm)`); lights, lasers, rays and the camera use the
  continuous `c`.
- No wall time and no `Math.random` (use the prototype's seeded random if it has one).
- **Check:**
  - `npm run typecheck` and `npm run test` pass.
  - A golden test: for `cycleBeats = 32` and the prototype's default cuts setting,
    `frameAt` equals the prototype's `frame()` at a dozen sample positions (groove beat,
    off-beat, build bar 7, end of bar 8, drop +0, +2 frames, +1 beat, +1 bar, the
    pompadour landing at c8, c8.4, c15.3, c17). Produce the expected values by running
    `motion.js` under node `vm`, and inline them as fixtures.
  - An invariant test: no shot repeats back to back, the drop is wide for every
    `cycleBeats` × `cuts` combination over 40 cycles, and `frameAt(c)` equals
    `frameAt(c + cycleBeats)`.

### 3. A conductor that turns the app's beat clock into the cycle position

- **File:** `src/render/scenes/toonrave/conductor.ts`.
- **Edit:** `createConductor()` returns `{ step(input: ConductorInput, cycleBeats: number): ConductorOut; reset(): void }`.
  - Input: `ConductorInput = { timeSec, dtSec, beats, beatPhase, barPhase, tempoLock, bpm, dropFired: boolean }`.
    These are the same fields as `AnimFrame`; `beats` is the unwrapped beat count.
  - Output: `ConductorOut = { c, bpm, locked }`.
- **Rules:**
  - **Locked** (`tempoLock > 0.5` and `bpm > 0`): `c = (beats - anchorBeat) mod cycleBeats`.
    Re-anchor only at a drop. The cycle starts on a whole beat whose `beats` is a
    multiple of 4, so drops land on the app's bar lines.
  - **Unlocked:** free-run at the last good bpm (or 120) from `timeSec`. The position
    never jumps backwards and never jumps by more than one frame's worth of beats when
    the lock comes or goes. When the lock returns, re-anchor at the next bar line.
  - **`dropFired`:** start a new cycle at the nearest whole beat, so `c` becomes 0 there.
    This applies only if at least 8 bars have passed since the last drop. Otherwise
    ignore it.
  - Wrapping past `cycleBeats` is the scheduled drop.
- No wall clock, no DOM: pure, given its inputs.
- **Check:**
  - `npm run typecheck` and `npm run test` pass.
  - Tests (copy the style of `tests/gates.test.ts` "advanceGates"):
    - a steady locked tempo advances `c` by 1 per beat and wraps at `cycleBeats`;
    - losing and regaining the lock keeps `c` continuous;
    - `dropFired` resets `c` to 0;
    - a second `dropFired` within 8 bars is ignored.

Steps 1, 2 and 3 touch different files and may run in parallel.

### 4. Draw the SVG with Canvas2D

- **File:** `src/render/scenes/toonrave/svgDraw.ts`.
- **Edit:**
  - **`compileScene(markup: string): DrawProgram`** runs in the browser only, called from
    `init()`. It parses the markup with `DOMParser`. While compiling, it attaches a
    hidden `<svg>` to `document.body` and removes it at once afterwards. With it, it
    measures `getBBox()` for elements filled with objectBoundingBox gradients, and reads
    any class-based styles once. It builds a tree of draw nodes with precomputed
    `Path2D` objects.
  - **`drawProgram(ctx2d, prog, state: FrameState, view: { scale, tx, ty })`** draws one
    frame.
- **Supported, from a survey of the prototype's SVG:**
  - elements: `g`, `path`, `circle`, `ellipse`, `rect` (with `rx`/`ry`) and `line`;
  - transforms: `matrix`, `rotate`, `translate` and `scale` chains;
  - fill and stroke attributes: `fill`, `stroke`, `stroke-width`, `stroke-linejoin`,
    `stroke-linecap` and `stroke-dasharray`;
  - opacity: the `opacity` attribute, plus `style` `opacity` and `display:none`;
  - `paint-order` "stroke": stroke first, then fill;
  - `clip-path` to a `clipPath`, via `ctx.clip(path)`;
  - `radialGradient` in objectBoundingBox units, converted to user space with the
    measured bbox;
  - `style` `mix-blend-mode: screen`, via `globalCompositeOperation = "screen"`;
  - the dynamic attributes `data-x` (the rig matrix from `state`), `data-o` (fx
    opacity), `data-cel` (only the chosen cel draws), `data-led`, `data-ray` and the
    crowd eye classes. Apply them exactly as `src/app.js` writes them onto the DOM.
- **Group opacity:** the prototype keeps its fades on the screen-blended ray groups
  themselves. Draw a group with opacity below 1 through a reusable offscreen layer only
  where children overlap; otherwise multiply alpha down the tree.
- **The impact filter** (`feColorMatrix` plus `feComponentTransfer`) is not drawn here:
  step 5 reproduces it in GLSL. Export its matrix and table values from the compiled
  defs.
- **Check:**
  - `npm run typecheck` and `npm run test` pass.
  - Unit tests for the pure helpers that run under node: the transform-string parser and
    the style-string parser.

### 5. The scene

- **Files:** `src/render/scenes/toonrave/index.ts` and `glsl.ts`.
- **Registry edits** in `src/render/scenes/index.ts`, four of them:
  - an import of `toonraveScene`;
  - `registerScene(toonraveScene)` right after `registerScene(skyScene);`;
  - `"toonrave"` added to `draftIds`;
  - the export.
- **Settings:** all grouped, groups in order, no `auto`, literal defaults. Copy the shapes
  from coil:
  - **Motion:**
    - `bounce`, "Bounce": how far the cast moves on the beat; 0–1.5, default 1. It has a
      `drive` with the beat grid as default, like coil's `breathe`. Read it with
      `drives.value`.
    - `drops`, "Drops": an enum with options "Every 32 bars", "Every 16 bars" and
      "Every 8 bars", default "Every 16 bars". It maps to `cycleBeats` 128, 64 and 32.
    - `dropHits`, "Drop on big hits": boolean, default on. It triggers through
      `drives.fired("dropHits", anim.dropOnset)` into `ConductorInput.dropFired`. Follow
      the `drives.ts` header for a trigger setting.
  - **Look:** `lights`, "Lights": how bright the lasers, lamps and rays are; 0–1.5,
    default 1, with a drive.
  - **Camera:**
    - `cuts`, "Cuts": 0–3, step 1, default 2. 0 holds the wide shot.
    - `shake`, "Shake": 0–1.5, default 1.
  - **Post:** `flash`, "Impact flash": boolean, default on.
- **`init(ctx)`:**
  - Reset all closure state.
  - Create the 2D canvas.
  - Compile the program once per page: a lazily filled module-level cache, filled inside
    `init`.
  - Create one RGBA texture (LINEAR, CLAMP_TO_EDGE), the post program and the fullscreen
    quad, using `src/render/gl.ts` helpers as coil does.
  - Keep `init` cheap: gallery tiles mount one per tick.
- **`render(ctx, frame, viewport, palette, anim, drives)`:**
  1. **Canvas size.** The canvas is `gl.drawingBufferWidth/Height`, capped at 1920 px
     wide (keep the aspect); `ctx.quality` can lower the cap.
  2. **Timing.** `conductor.step(...)` from `anim` (`timeSec`, `dtSec`, `beats`,
     `beatPhase`, `barPhase`, `tempoLock`, `tempoBpm`), then `frameAt(c, ...)`.
  3. **Camera.** Fit the shot's 16:9 source rectangle to the output aspect by covering:
     crop, centred on the shot. Map the Panorama `viewport` slice onto it.
  4. **Draw.** Run `drawProgram` into the canvas, then apply bounce and shake: scale the
     state's motion amplitudes and shake by the settings, without touching the hero
     frame at `c ≈ 2/12`.
  5. **Upload.** Upload with `texImage2D` on a size change and `texSubImage2D`
     otherwise. Flip V in the shader instead of setting `UNPACK_FLIP_Y_WEBGL`. If any
     `pixelStorei` must change, restore it at once (see `storm.ts` ~3229).
  6. **Post pass.** Draw the fullscreen quad with the post shader: `texture` plus
     `uImpact` (= `state.impact × flash`). Reproduce the prototype's impact filter, its
     `feColorMatrix` values and `feComponentTransfer` tables.
  7. **Restore GL state.** Leave the framebuffer, viewport, texture bindings and BLEND as
     you found them.
- **`dispose(ctx)`:** free the GL objects and drop the canvas.
- **DEV only:** if the `Scene` interface's `command` hook exists, support `{ freeze: c }`
  and `{ freeze: null }` so tests can pin the cycle position. Otherwise expose the same
  through `window.__viz` the way other scenes do.
- **Check:**
  - `npm run typecheck` and `npm run test` pass.
  - Add to `tests/toonrave.test.ts`: the settings use the groups in order, no setting
    has `auto`, and the enum and boolean shapes are valid. Copy the per-scene setting
    tests from `tests/gates.test.ts` where they apply.

### 6. The record

- **Files:** `docs/scenes/toonrave.md` from `docs/scenes/_template.md`, plus
  `docs/scenes/toonrave/artifacts/zim-rave-drop.html`, a copy of the prototype page,
  which is our own art.
- **Edit:** fill every template section.
  - **References:** credit the style study as inspiration (classic Nickelodeon and
    Cartoon Network cartoons). No downloaded media.
  - **Decisions and pivots:** date 2026-10-03. The style rounds led to this cartoon
    look; the prototype became the scene; Canvas2D draws the vector art each frame,
    through a GL post pass.
  - **Known issues:**
    - the groove is repetitive;
    - each crowd row bounces as one block;
    - there is no downbeat detection, so press B to resync the bar;
    - the DJ's colours sit near one well-known cartoon character: change them before
      release.
  - **Resume here:** `/?audio=synthetic&bpm=120#/v/toonrave`.
- **Check:** `npm run typecheck` and `npm run test` pass.

### 7. Verify in the app (verifier step: may run the dev server and Playwright)

- **Dev server:** start it inside this worktree with `SKIP_PRIVATE_SCENES=1 npm run dev`.
  HTTPS, port 5173.
- **Contact sheets:** `node tools/tune-sheet.mjs "https://localhost:5173/?audio=synthetic&bpm=128&quality=high#/v/toonrave" <out.png> --frames 16 --every 470 --settle 4000`.
  Make one sheet at 128 BPM and one at 96 BPM.
- **Hero frame:** freeze at the hero frame (step 5's DEV hook) with the cuts setting at
  0, so the wide shot holds. Screenshot at 1600×900 and compare with the prototype's
  `png/original.png`: the mean absolute difference per channel must be under 3/255.
- **Numbers:** `node tools/tune-probe.mjs <url>` for the frame time. The gallery tile
  must render, there must be no console errors, and a phone viewport of 390×844 must
  render the scene with no errors.
- **Where to save:** `/Users/yaro/.claude/plans/rave-cut-scene/scene-shots/` (outside
  the repo).

## Done when

- `npm run typecheck` and `npm run test` pass.
- The scene appears as a draft. It plays the prototype's loop in time with synthetic
  audio at 96 and 128 BPM, cuts on bar lines and drops every 16 bars by default. Its hero
  frame matches the prototype's `png/original.png` (mean difference under 3/255).
- The screenshots and contact sheets from step 7 are saved in
  `/Users/yaro/.claude/plans/rave-cut-scene/scene-shots/`.
