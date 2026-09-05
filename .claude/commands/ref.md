---
description: Measure a reference video's audio/visual sync before adapting it into a scene, then compare ours at the same beats
argument-hint: <video path or URL> [sceneId]
---

Adapt a visualization from the reference video `$1` — for scene `$2` if given —
by measuring what it does on the beat grid, not by guessing from stills.
The tools own the details: read the header of `tools/ref-scan.py` (what a
bundle contains, what beat *rank* means, how the downbeat is estimated) and
`tools/ref-shoot.mjs` (how our side is aligned to the same t=0) before the
first run of a session.

1. **Scan.** `uv run tools/ref-scan.py $1 [--start S --dur D]` — a URL is
   fetched with audio; a file is used as is. The bundle lands under
   `tools/.cache/refs/<name>/`. Say where it is.
2. **Read the report, then look.** `report.md` first: tempo, the phase
   estimate and its margin, the per-rank table (does the picture react
   harder on bars/phrases than on beats?), the correlation table, and every
   transition with the audio at that moment — a STROBE row means a stretch
   of flashes, and its spacing in beats says whether they follow the beat or
   a timer. Then `timeline.png`, then the rank sheets from `rank16` down.
   If the phase margin is low, find a phrase start by eye on `rank4.png`
   and re-run with `--phase N`.
3. **Write the sync hypotheses down** in the reply before building — one
   line each, in the form *"X happens on rank-N beats / on hard onsets /
   continuously"*, with the row of the report that says so. Check any
   doubtful one against `audio.json` (per-beat audio + frame paths) or
   `series.tsv` at that time. A transition with no onset and off the beat
   is a timer, not a sync — say so rather than inventing one. A silent
   video gets an invented grid; the report says so, and there is no sync
   to find.
4. **Build or tune** the scene against those hypotheses — `/new-scene` or
   `/tune`, with `npm run dev` running and a direct scene link handed over
   (`https://localhost:<port>/#/v/$2`, query before the hash).
5. **Compare at the same beats.** `node tools/ref-shoot.mjs
   tools/.cache/refs/<name> --scene $2 --port <port> [--settings JSON]`,
   then look at `ours-$2/compare.png`: one row per beat, reference frames
   left, ours right, same offsets. `ours.json` records the probe's bpm at
   each shot — if it isn't the scan's tempo, the beat clock is the problem,
   not the scene. Iterate 4→5 on the rank the reference actually reacts on.
6. When it's good, record it the way `save-good-visualizations-for-reuse`
   asks; either way, note what was learned about *this* reference (what it
   syncs to, what it doesn't) in the scene's memory, and any phrase → param
   mapping in `tuning/VOCAB.md`.
