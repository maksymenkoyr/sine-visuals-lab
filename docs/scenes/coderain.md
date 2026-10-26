# Code Rain (`coderain`)

A 3D field of falling glyph columns that the camera explores on foot —
walking over low hills without ever stopping, slowing to look round, high
into the rain and down below, floating up or sinking through the columns — with a
dancer drawn in tiny raining glyphs among them. Bass hits start fresh heads
from the top of the view and flare the heads; the overall level speeds the
fall; a drop swings the camera to a new heading. Speed runs the walk and the
fall faster or slower together. In development, in the gallery's development section.

## Where the code is

- `src/render/scenes/coderain/card.ts` — the scene's card, loaded with the page: id, name,
  `SETTINGS`, the `gallery` record and `loadBody`. The body spreads the card, so the
  registered settings are the body's own objects.
- `src/render/scenes/coderain/index.ts` — the body, loaded after first paint: drives, camera, fall
  clock, the hit-burst ring (`BURST_SLOTS`), the draws.
- `glyphs.ts` — the hand-drawn stroke glyph set and `buildGlyphAtlas`.
- `figure.ts` — the dancer: the Dancers scene's choreographer and rig, flattened to 2D capsules.
- `explorer.ts` — the camera's scripted walk: walk, look-round and rise legs from a seeded generator, and the head's gaze points.
- `glsl.ts` — `RAIN_VERT`/`RAIN_FRAG` (instanced columns) and `FIGURE_VERT`/`FIGURE_FRAG`; hashes via `noiseHash.ts`'s `uhash` on integers only.
- `tests/coderain.test.ts`.

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

## Known issues and next steps

- No `auto` weight tables yet (every setting manual).
- The reference's ghosts carry image colour; ours is pale green — ask whether a colour option is wanted.
- Tempo tracker held ×3/2 on one run of this clip (`src/audio/tempoAnalyzer.ts` to-do).
- Not done yet: `ref-keep.py matrix-rain coderain` and `ref-archive.py matrix-rain` — both left for the user to run.

## Materials

- `coderain/scripts/rainmeasure.py`, `coderain/scripts/framestats.py` — the purpose-built rain measurers.
- Reference media: local `/ref` cache only (`tools/.cache/refs/_downloads/matrix-rain.mp4`).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/coderain`.
- `node tools/ref-shoot.mjs tools/.cache/refs/matrix-rain --scene coderain --port <p> --size 1280x720`.
- Shell guard in the worktree rejects compound commands; use plain ones.

## History

- Branch `worktree-coderain-scene`: first version, never opened as a PR.
- Draft PR #398 (`worktree-coderain-scene-v2`): the same version, rebased onto main.
- #532 (2026-10-15): the dancers' clip library downloads the first time the
  scene mounts, not on every page load; a later mount (the gallery tile, then
  the full view) now gets it too, where that figure only swayed before.
