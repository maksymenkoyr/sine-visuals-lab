# Code Rain (`coderain`)

A 3D field of falling glyph columns that the camera glides through, with a
dancer drawn in tiny raining glyphs among them. Bass hits start fresh heads
from the top of the view and flare the heads; the overall level speeds the
fall; a drop swings the camera to a new heading. A draft, behind the gallery's draft fold.

## Where the code is

- `src/render/scenes/coderain/index.ts` — settings, drives, camera, fall
  clock, the hit-burst ring (`BURST_SLOTS`), the draws.
- `glyphs.ts` — the hand-drawn stroke glyph set and `buildGlyphAtlas`.
- `figure.ts` — the dancer: the Dancers scene's choreographer and rig, flattened to 2D capsules.
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
