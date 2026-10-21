# Plan: Controls first (the desk)

With a pop-out output open, the main window stops being a picture with a panel
over it and becomes a control desk: NEXT and LIVE monitors on top with Play
between them, channel strips under them, small Pads and Orchestrate sections,
and buttons into full Pads, Orchestrate (Timeline, Map) and Nodes views. A
Sidecar window carries the same controls over DJ software. Decisions, rejected
ideas and open questions: issue #617 and the mock it links. Written 2026-10-21
for the build of #619–#628 on branch `worktree-controls-first`.

## Taken as answers (2026-10-21; the user said "implement it, I allow some imperfectness")

The open questions in #617 were not answered. The build takes the mock's own
pick for each, so any can be overturned:

- With no output open the window keeps today's layout; the desk appears when an
  output opens (#619).
- A pad tap lands on the next launch line and plays there: NEXT and LIVE both
  take it (#623). Shift-tap loads it into NEXT only.
- Autopilot and Follow the music run one at a time; turning one on turns the
  other off (#625).
- The main screen is idea C: the monitors stay fixed and everything below them
  scrolls, today's panel cards included (#627).
- Nodes is idea 2, Columns: today's three-column panel at full height under a
  small NEXT monitor (#628). A pinned setting opening into its Chain is left
  for later.
- The mock's own calls (BPM in the top bar, scene list on the scene name,
  palette swatches, a fader turning Follow off) are kept where a part touches
  them and not built where it doesn't.

Known gaps against the mock, accepted for this build: a Set still holds at
most `SET_MAX_PADS` pads (the mock shows sixteen); pad pictures are stills the
desk grabs from NEXT while a pad is loaded, not stills saved with the look; Map
places a pad by its measured picture only after that pad has been on NEXT once.

## Map: the mock's regions and what renders them

| Region (mock main screen) | Today | Desk |
|---|---|---|
| App bar (views, health) | `index.html` `#sceneNav` top left | `#sceneNav` stays; `desk.ts` adds the view switch and BPM on the right of the same 44 px band |
| NEXT monitor | `#gl`, centred by `app.ts` `applyPreviewBox` (`body.output-preview`) | `#gl` placed into the NEXT slot by `body.desk` CSS (`deskTheme.ts`) |
| Play column: list, CUE, PLAY, lands | `#outBar` (`#cueBtn`, `#goBtn`, `#outState`), transition in the scene list (`sceneTransition.ts`) | `desk.ts` moves `#outKeys`/`#outState` into the column; `playList.ts`; fade chips over `getSceneTransition`/`setSceneTransition` |
| LIVE monitor | none (the output window only) | `liveMonitor.ts`: mirrors `#gl` while NEXT = LIVE, else the output's thumbnails |
| Picture row under each monitor | Master card's Picture block (`pictureMeter.ts`) | `desk.ts` row fed by `deps.pictureReading()` |
| Strips, Master, effects | Scene card rows, Master card, `#fxBar` | `strips.ts`; `#fxBar` moved into the desk |
| Small Pads row | Set card (`setCard.ts`) | `padsRow.ts` |
| Small Orchestrate form | none | `orchestrateMini.ts` |
| Everything else | the panel (`deviceMenu.ts`, `.vc-root` fixed columns) | #619: pushed below the top row, opaque; #627: in the desk's scrolling page |

## The four answers

1. **How LIVE renders.** The output is opened `noopener`
   (`outputBridge.ts` `OUTPUT_WINDOW_FEATURES`), so this window cannot read its
   canvas, and a second `SceneHost` here would need every store to read a
   second storage. Instead: while `createCueController`'s `following()` is
   true (NEXT = LIVE, or Cue held) LIVE draws `#gl` into its own 2D canvas
   (`drawImage`, a GPU copy, no readback). While they differ the main window
   sends `{t:"thumbs", on:true}` and the output posts a 384×216 `ImageBitmap`
   (`createImageBitmap(canvas, {resizeWidth, resizeHeight})` right after its
   draw in `output.ts`'s `loop`) at most `THUMB_FPS` times a second as
   `{t:"thumb", bmp}`. Measured 2026-10-21 in headless Chromium: an
   ImageBitmap crosses a BroadcastChannel, 5 ms to make one at 320×180. Cost
   per frame is the copy only while it shows; nothing while the desk is shut.
2. **What Play will change.** `outputBridge.ts` already has both looks as
   `OutputState`s (`createCueController`'s preview and `held()`).
   `lookDiff.ts` `diffLooks(next, live)` walks the union of their storage
   keys minus `SHELF_KEYS`/`VOLATILE_PREFIXES` (`syncedStores.ts`), the same
   filter as `stateKey`, and for the two-level stores (`vibe.sceneSettings`,
   `vibe.drives`: `{scope: {key: value}}`) goes down to one row per
   (scope, key); every other key is one row; scene and palette are rows too.
3. **Sending one setting.** `lookDiff.ts` `takeRow(live, next, row)` builds
   LIVE with only that row taken from NEXT; the bridge sends it with a new
   `sendState(state, glideMs?)`, which `createCueController` gains as
   `goState(state, glideMs?)`: the state becomes the program, exactly like
   `go()` but with a given state. A Live strip calls it on every move (no
   glide). Dropping a row is `dropRow(live, row)`: write LIVE's value back into
   localStorage for that path and call `reloadSyncedStores()` (new, runs the
   `registerSyncedStore` hooks), so NEXT takes LIVE's value.
4. **Solo and Mute on NEXT only.** Solo is `driveSolo.ts` as it is. Mute is a
   new `driveMute.ts` in its mould (in-memory, never synced, so the output
   keeps moving): a set of `scene:key`; `drives.ts` `forScene`'s `resolve`
   returns `SOLO_SILENCED` for a muted key.

## Shape of the code

- Everything new for the desk lives in `src/ui/desk/`. `desk.ts`
  `createDesk(deps: DeskDeps)` is the only entry; `app.ts` loads it with
  `import("./ui/desk/desk.ts")` the first time `previewActive` turns on (the
  size budget counts only what loads before first paint), then calls
  `desk.setActive(on)` and `desk.tick(nowMs)` from its render tick.
- `DeskDeps` is dependency injection like every panel card: functions from
  `app.ts`, no store imports for app state. Pure logic (`lookDiff.ts`,
  `launchQueue.ts`, `lookMap.ts`) lives outside `ui/` with unit tests.
- Styles: `deskTheme.ts` `ensureDeskStyles()` injects one `<style>`; colours
  from the mock's tokens (LIVE red, CUE orange, PLAY green, Autopilot blue),
  fonts from `controlsTheme.ts` (`FONT_LABEL`, `FONT_MONO`). Nothing in the
  desk uses `backdrop-filter`.
- The desk never draws over `#gl` or the LIVE canvas; the cable layer is
  clipped to the area below the top row.

## Parts

### #619 Desk layout

- `src/ui/desk/deskTheme.ts` (new): `ensureDeskStyles()`. `body.desk #gl`:
  fixed at the NEXT slot (`left:16px; top:54px; width: var(--desk-mon-w);
  height: calc(var(--desk-mon-w) * 9 / 16)`); `--desk-mon-w: clamp(320px,
  33.75vw, 560px)`; the top row's bottom is `--desk-top`. `body.desk .vc-root,
  .vc-spectrum-col, .vc-shape-col` start at `--desk-top` with max-heights
  reduced by it; `body.desk .vc-card` opaque (no backdrop-filter, solid
  background).
- `src/ui/desk/desk.ts` (new): `createDesk(deps)`: builds `#desk` (top row:
  NEXT label under `#gl`, the Play column, LIVE slot), `setActive(on)`
  toggles `body.desk`, moves `#outKeys`, `#outState` and `#fxBar` into the
  column on and back to `#outBar`/body off, opens the panel on
  (`deps.openPanel()`), adds the fade chips (Cut, Fade 1 bar, Fade 4 bars over
  `setSceneTransition`).
- `src/app.ts`: the lazy import and the two calls next to `applyPreviewBox`;
  `applyPreviewBox` leaves `output-preview` off while the desk is active.
- Check: with an output open, a screenshot shows `#gl` top left, CUE and PLAY
  beside it, the panel below with no card over the picture; closing the output
  brings back today's layout.

### #620 Play list

- `src/net/lookDiff.ts` (new) + `tests/lookDiff.test.ts`: `diffLooks`,
  `takeRow`, `dropRow` (pure over storage text; `dropRow` returns the new text
  for the key).
- `src/net/syncedStores.ts`: export `reloadSyncedStores()`.
- `src/net/outputSync.ts`: `CueController.goState`. `src/net/outputBridge.ts`:
  `sendState`, `looks(): {next, live}`.
- `src/ui/desk/playList.ts` (new): renders rows (name, `from → to`, ▸, ×),
  count badge, the empty line; labels a settings row by the scene's spec label
  (`deps.settingLabel(scope, key)`).
- Check: unit tests; change two settings and the palette: three rows; ▸ on one
  changes only that on the output; × puts NEXT back.

### #621 LIVE monitor

- `src/net/outputSync.ts`: `ToOutput` gains `{t:"thumbs"; on:boolean}`,
  `ToMain` gains `{t:"thumb"; bmp: ImageBitmap}`; `THUMB_FPS`.
- `src/output.ts`: after each draw in `loop`, while thumbs are on and
  `1000/THUMB_FPS` ms have passed, post a thumbnail.
- `src/net/outputBridge.ts`: `setThumbs(on)`, `onThumb(cb)`.
- `src/ui/desk/liveMonitor.ts` (new): a 2D canvas in the LIVE slot with the
  red frame and tag; mirror `#gl` while `following()`, else the latest thumb;
  thumbs on only while it shows and the looks differ.
- Check: with NEXT ≠ LIVE the LIVE monitor matches the output window (a
  side-by-side capture); the cost: the thumbnail's ms on the output, measured.

### #622 Strips

- `src/render/driveMute.ts` (new) + `drives.ts` `resolve`; test in
  `tests/driveMute.test.ts`.
- `src/ui/desk/strips.ts` (new): one strip per setting of
  `deps.reactiveSettings()` (the first six with a `drive`): name, input name,
  a vertical fader over `getSceneSetting`/`setSceneSetting` via deps, the LIVE
  mark from `lookDiff` reading LIVE's value, a meter from
  `deps.driveReading(key)`, M, S, ▸ (send this one), LIVE (ride). A
  boolean/enum setting gets chips instead of a fader; a fired setting a FIRE
  button that pulses its value. Beside them Master Scale and Expansion faders.
- Check: tests for mute; moving a fader makes the strip orange, ▸ sends it,
  S leaves only that setting moving on NEXT, LIVE rides without a jump.

### #623 Pads

- `src/render/launchQueue.ts` (new) + tests: `LaunchOn` ("now" | "beat" |
  "bar" | "4bars" | "phrase"), `queueLaunch(queue, padId, nowBeats, on)`,
  `dueLaunches(queue, beats)`; stored launch-on in `vibe.launchOn` (a shelf
  key: add it to `SHELF_KEYS`).
- `src/render/setAutopilot.ts`: `peekAutopilot(state, clock, config, padIds)`
  → `{padId, inBars}` without moving the cursor.
- `src/ui/desk/padsRow.ts`, `src/ui/desk/padsView.ts` (new); `app.ts` runs
  the queue in its tick and fires a due pad as Autopilot does
  (`firePad` + `go`).
- Check: tests; a tapped pad counts down and lands on the bar line.

### #624 Orchestrate: Timeline

- `src/ui/desk/orchestrateMini.ts`, `src/ui/desk/timelineView.ts` (new): bars
  around NOW from the metronome beats; blocks from the launch queue, the live
  pad and `peekAutopilot`; drop a pad on a future bar line → `queueLaunch` at
  that bar; keep/skip on Autopilot's pick.

### #625 Orchestrate: Map

- `src/render/lookMap.ts` (new) + tests: place pads by picture reading
  (busier right, brighter up), nudge apart; blend two pads of one scene.
- `src/ui/desk/mapView.ts` (new): field, puck, Follow the music.

### #626 Sidecar

- `src/ui/desk/sidecar.ts` (new): `documentPictureInPicture.requestWindow`
  where it exists, else `window.open` narrow; LIVE (thumbs), Prev/Next pad,
  effects, Autopilot, Expansion, a health line.

### #627 Scrolling page (idea C)

- `deskTheme.ts`/`desk.ts`: the area under the top row is one scroller
  (`#deskLower`) holding strips, the pads row, Orchestrate's small form, then
  today's panel (`.vc-root` moved into it, its fixed columns made static in
  `body.desk`); a "Jump to" bar.

### #628 Nodes (idea 2, Columns)

- `desk.ts`: a Nodes view: the top row shrinks to NEXT and Play, the strips
  and small sections hide, and the panel's three columns fill the rest.

## Done when

- Every part above is on the branch, `npm run check` passes, and the PR shows
  the real app with an output open next to the mock's views.
