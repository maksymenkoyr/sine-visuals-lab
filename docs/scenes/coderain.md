# Code Rain (`coderain`)

A 3D field of falling glyph columns with a dancer drawn in tiny raining
glyphs among them. The camera stands still. In a dev build (`npm run dev`)
only, a viewer can walk through the rain and look round by hand, like in a
game: click the picture, then the mouse looks and the keys walk, and Esc
stops. Kicks start fresh heads from the top of the view and flare the heads;
the overall level speeds the fall. In development, in the gallery's
development section.

## Where the code is

- `src/render/scenes/coderain/card.ts` — the scene's card, loaded with the page: id, name,
  `SETTINGS`, the `gallery` record and `loadBody`. The body spreads the card, so the
  registered settings are the body's own objects.
- `src/render/scenes/coderain/index.ts` — the body, loaded after first paint: drives, camera, fall
  clock, the hit-burst ring (`BURST_SLOTS`), the draws.
- `glyphs.ts` — the hand-drawn stroke glyph set and `buildGlyphAtlas`.
- `figure.ts` — the dancer: the Dancers scene's choreographer and rig, flattened to 2D capsules.
- `src/render/freeLook.ts` and `src/ui/freeLook.ts` — the walk by hand, shared rather than the scene's own: the card's `freeLook` turns it on, and the body moves its camera with a `createWalker`.
- `glsl.ts` — `RAIN_VERT`/`RAIN_FRAG` (instanced columns) and `FIGURE_VERT`/`FIGURE_FRAG`; hashes via `noiseHash.ts`'s `uhash` on integers only.
- `tests/coderain.test.ts`; the walk's own in `tests/freeLook.test.ts`.

## References

- Reddit r/creativecoding, "I made a 3D simulation of the Matrix code rain"
  (https://www.reddit.com/r/creativecoding/comments/1vb2os8/), a 48 s screen
  recording of an interactive three.js piece. Studied for its look (fixed
  glyphs with a moving head, depth distribution, colours) and its "ghost"
  idea (an image drawn in glyphs). Its glyph sprites and film stills were not
  used; the glyphs here are drawn from scratch and the ghost is a dancer.
  Measured in the `/ref` bundle `matrix-rain` (`tools/.cache/refs/matrix-rain/`).

## Measurements

2026-10-05, reference vs ours (rain only, 720p, `scripts/framestats.py`, 8 ref frames 17–23 s vs 4 of ours):

| | lit share | strips/frame | glyph width p10/p50/p90/p99 px |
|---|---|---|---|
| reference | 5.0% | 62 | 4 / 7 / 17 / 42 |
| ours | 4.5% | 78 | 5 / 7 / 18 / 32 |

Reference, `scripts/rainmeasure.py` on the still camera 17–20 s: glyph texture
shift 0 (r 0.7–0.99) while heads move — glyphs fixed, a head writes down;
trails 12–25 glyphs; row pitch 1.0–1.17× glyph width; heads ~14–27 rows/s;
colours tail `#1d3a10` → near head `#4faa1d`, head `#8cad6d`–`#99b379`.
`/ref` report: 107.7 bpm; no hard cuts; brightness does not flash on onsets;
the only correlation brightness~mid r +0.21. Ours heard 160 bpm (×3/2) on the
hear run but ~106.7 on the ref-shoot run.

## Decisions and pivots

- 2026-10-05: sync hypotheses — the reference syncs to nothing (hand-flown
  camera over a soundtrack); held up on every finding. So the reactions are
  this scene's own: Rush (All level), Downpour and Hit glow (Bass hit), Turn (Drop), all real wires.
- 2026-10-05: user picked free scene, a procedural figure for the ghosts, and
  glide + hits light heads.
- 2026-10-05: first ref-shoot showed a horizontal band of burst heads at the
  top on every bass hit; share lowered and each head now enters from its own
  height above the top.
- 2026-10-08 — Downpour and Turn became hit drivers (the Reaction row, Flat or Sized; drives.ts's header, "Hit drivers"). Sized scales the burst share and the camera swing by how far the hit stood out; Flat, the default, is unchanged.
- 2026-10-11 — Sampler uniforms that were looked up with a raw `getUniformLocation` on every call now go through `GLProgram.setI`. Nothing visible changed: headless before/after shots look the same. (#349)
- 2026-10-24 — Id, name, settings and gallery record moved to `src/render/scenes/coderain/card.ts`, so the scene's code loads after the page's first paint. Nothing visible changed. (#536)
- 2026-10-26 — The straight glide became an explorer on foot (`explorer.ts`): it walks a gently curving path with a step bob, eases to a stop, looks one way, the other and up into the rain, then walks off where it last looked. The dancer stays ahead of where it walks, so a look round sweeps off the dancer and back. One new setting, Speed, scales the explorer's clock and the fall clock together; Glide is gone (an old look's `glide` is ignored). `tools/tune-real.mjs`, Around the World then silence, 30 s, change med / p95: main 2.60 / 3.40 song, 1.62 / 2.11 silence (1.6x); explorer 3.96 / 5.10 song, 2.92 / 3.88 silence (1.3x); hits/min unchanged (406 vs 402, 0 in silence). The walk adds steady motion under both, so the music's share of the motion is smaller.
- 2026-10-26 — User: head movement "a bit more interesting", "more verticality". The head now turns to a gaze point, holds it, and turns to the next (a critically damped spring with a capped turn rate) instead of smooth sine sweeps; it tips its roll now and then and sways with each step. Look rounds reach high into the rain and down below; a new rise leg floats up or sinks through the columns while gazing that way, and walks roll over low hills. Tilt plus the explorer's pitch is capped (`PITCH_MAX`). `tools/tune-real.mjs`, same song and length: 3.73 / 4.89 song, 3.09 / 4.22 silence (1.2x); hits/min 408, 0 in silence.
- 2026-10-26 — User: "walk straight evenly all the time … faster or slower but no stops or interruptions". The explorer never stops now: each leg has its own pace (`WALK_SPEED`, `LOOK_SPEED`, `RISE_SPEED`) and the walk glides between them (`PACE_TAU`); a look round strolls on and ends looking ahead, so the heading no longer snaps to where it last looked. `tools/tune-real.mjs`, same song and length: 3.53 / 4.82 song, 2.87 / 4.11 silence (1.2x); hits/min 404, 0 in silence.
- 2026-10-30, #802: Downpour and Hit glow moved from the bass hit to the
  Kick.
  - tune-real on a real song (around-the-world) then silence, main → this
    change: song change median 3.58 → 3.64, p95 4.76 → 4.93; silence
    median 2.83 → 2.79, p95 4.00 → 3.99; hits a minute on the song 406 →
    422, in silence 0 → 0; main's bass / mid / treble lanes 152 / 126 /
    242 a minute against kick / clap / hats / chord 120 / 48 / 278 / 120.
- 2026-10-30, #803: the scene's drop reaction now fires when audio v6's
  drop level crosses its mark (`DROP_MARK`, `src/render/animClock.ts`), not
  on the Section trend's old drop detector.
  - tune-real on a real song (around-the-world, 60 s) then silence, the
    commit before → this change, one run each: song change median
    3.66 → 3.54, p95 4.94 → 4.98; silence median
    2.65 → 2.68, p95 3.78 → 3.77; hits a minute on the song
    372 → 380, in silence 0 → 0; drops a minute on the song
    0 → 2, in silence 0 → 0.
- 2026-10-30, #804: Rush's drive on the fall speed moves with Level, which
  now reads audio v6's Loudness (the song's loudness on a fixed decibel
  scale), not the band mean.
  - tune-real on a real song (around-the-world) then silence, before →
    after: at full level change median 3.75 → 3.71, p95 5.34 → 5.26 on the
    song, median 2.79 → 2.8, p95 3.92 → 4.09 in silence; hits a minute 422 →
    418 on the song, 0 → 0 in silence; with the song 20 dB down change
    median 3.71 → 3.6, p95 5.21 → 5.15 on the song, median 2.81 → 2.77, p95
    4.01 → 4.03 in silence; hits a minute 414 → 408 on the song, 0 → 0 in
    silence.
- 2026-11-07 — Owner: remove the head tilting and all the moving, "we
  should just stay stand", and let a viewer move and look around "like in
  game". The scripted explorer (`explorer.ts`), Tilt, a drop's Turn and
  Speed are gone; Speed's only job left was the fall, which Fall speed does.
  An old look's `speed`, `tilt` and `turn` are ignored on apply. The camera
  stands still and level, with the dancer in the middle of the view. A click
  on the picture locks the mouse to it: the mouse looks round, W A S D or
  the arrows walk, Space goes up, Shift down, Esc stops; while walking those
  keys don't strobe, open the panel, invert or cue (`src/ui/freeLook.ts`'s
  header). The dancer now stands in the world, `FIG_DIST` ahead of the
  start, repeating every `FIELD` like the columns and fading with distance
  as they do. Closes #737: its parts 1 (a wandering head) and 4 (legs on the
  music) no longer apply, part 2 is this walk, part 3 is Tilt's removal.
  - tune-real, Around the World then silence, 30 s, main → this change,
    change median / p95: song 3.75 / 5.21 → 1.59 / 2.08, silence 2.79 /
    3.99 → 0.65 / 0.81 (song p95 over silence 1.3x → 2.6x); hits a minute
    406 → 414 on the song, 0 → 0 in silence; drops a minute 2 → 2. With the
    walk gone, what moves in silence is the rain, the flicker and the
    dancer, so the music's share of the motion doubled.
- 2026-11-10 — Owner: the walk "should work only on local build". app.ts
  wires the mouse and keys, the HUD's "click the picture to walk" and the
  keys list's Walk row only behind a literal `import.meta.env.DEV`, so
  `npm run dev` walks and Stable, Insiders and the PR previews drop the code
  and keep the still camera alone. Nothing the scene draws or hears changed,
  so the tune-real numbers above stand.

## Known issues and next steps

- The pop-out output and a room's TV don't follow the walk: each draws its
  own camera, which stands at the start. Following would mean sending the
  pose over the output bridge; the owner's call.
- No walk on a touch screen: it has no pointer lock, and nothing else is
  wired.

- No `auto` weight tables yet (every setting manual).
- The reference's ghosts carry image colour; ours is pale green — ask whether a colour option is wanted.
- Tempo tracker held ×3/2 on one run of this clip (`src/audio/tempoAnalyzer.ts` to-do).
- Not done yet: `ref-keep.py matrix-rain coderain` and `ref-archive.py matrix-rain` — both left for the user to run.

## Materials

- `coderain/scripts/rainmeasure.py`, `coderain/scripts/framestats.py` — the purpose-built rain measurers.
- Reference media: local `/ref` cache only (`tools/.cache/refs/_downloads/matrix-rain.mp4`).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/coderain`; click the picture to walk.
- `node tools/ref-shoot.mjs tools/.cache/refs/matrix-rain --scene coderain --port <p> --size 1280x720`.
- Shell guard in the worktree rejects compound commands; use plain ones.

## History

- Branch `worktree-coderain-scene`: first version, never opened as a PR.
- Draft PR #398 (`worktree-coderain-scene-v2`): the same version, rebased onto main.
- #532 (2026-10-15): the dancers' clip library downloads the first time the
  scene mounts, not on every page load; a later mount (the gallery tile, then
  the full view) now gets it too, where that figure only swayed before.
