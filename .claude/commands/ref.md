---
description: Measure a reference visualisation video (audio + picture on one time axis) before building the same, then compare ours at the same beats
argument-hint: <video path or URL> [sceneId]
---

Build a scene that does what the reference video `$1` does — scene `$2` if
given — by measuring the reference, not by guessing from stills. The tools
own the details; read the header of `tools/ref-scan.py` (bundle contents,
beat *rank*, how "what ours hears" is joined) and `tools/ref-shoot.mjs` (how
our side is aligned to the same t=0) once per session before the first run.

The budget: one report, one key-frame sheet, one timeline should be enough
to write the sync hypotheses. Everything else in the bundle is drill-down,
opened only when the report points at it.

1. **Scan.** `uv run tools/ref-scan.py $1 [--start S --dur D]` — a URL is
   fetched with audio; a file is used as is. Bundle lands under
   `tools/.cache/refs/<name>/`. Say where it is.
2. **Hear.** With `npm run dev` running on some port:
   `node tools/ref-hear.mjs tools/.cache/refs/<name> --port <port>`, then
   `uv run tools/ref-scan.py <name> --report-only`. This adds the "ours:"
   clauses — whether our analyser fires an onset where the reference reacts,
   what tempo it held, whether its section signal moves where the reference's
   sections are. Skip only if the bundle reports no usable audio.
3. **Read `report.md`**, Findings first. Then `keyframes.png` (the look,
   before/after of each transition, phrase starts), then `timeline.png`.
   A STROBE finding states its flash spacing in beats *and* the measurement
   resolution — don't claim tighter. If the phase margin is low, find a
   phrase start by eye on the rank-4 sheet and re-run with `--phase N`.
4. **Write the sync hypotheses down** in the reply before building — one
   line each, *"X happens on rank-N beats / on onsets / at section
   boundaries / continuously"*, each pointing at the finding that says so,
   and each with its "ours:" verdict: can the runtime see that trigger? A
   trigger ours can't see (no section signal, tempo at ×½) is a to-do in
   `src/audio/` or `src/render/beatClock.ts`, not something to fake in the
   scene. A transition off the beat with no onset is a timer — say so.
5. **Build or tune** against those hypotheses — `/new-scene` or `/tune`,
   with a direct scene link handed over (`https://localhost:<port>/#/v/$2`,
   query before the hash).
6. **Compare at the same beats.** `node tools/ref-shoot.mjs
   tools/.cache/refs/<name> --scene $2 --port <port> [--settings JSON]`,
   then look at `ours-$2/compare.png`: reference frames left, ours right,
   same beats, same offsets, with what ours heard under each label.
   Iterate 5→6 on the rank the reference actually reacts on.
7. When it's good, record it the way `save-good-visualizations-for-reuse`
   asks; either way, note what this reference syncs to (and doesn't) in the
   scene's memory, and any phrase → param mapping in `tuning/VOCAB.md`.
