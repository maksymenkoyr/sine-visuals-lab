---
description: Close out the session — refresh status, log any tuning learned, flag stale docs
---

Close out this working session:

1. **Rewrite `docs/status.md` wholesale**, not incrementally. Base it on what
   actually happened this session plus current repo state (`git status`, any
   worktrees via `git worktree list`, any branches ahead of `main`). Three
   headings: **In flight**, **Open questions**, **Next up**. Keep it short
   enough to read in one glance — this file is a snapshot, not a history.

2. **If this session did any live tuning** (touched `tuning/params.json`, ran
   the probe/mark/contact-sheet loop from `docs/tuning.md`, or resolved a
   phrase like "brighter"/"less frantic" into a param change), append one line
   to `tuning/VOCAB.md` in its documented format:
   `"phrase" -> scene: setting/param, direction, ~magnitude`.

3. **Update the scene records.** For every scene this session touched, bring
   `docs/scenes/<id>.md` up to date. Add:
   - a dated line per decision or pivot, with the PR;
   - new measurements or tuning findings;
   - what's still off;
   - anything that would save time next time under "Resume here".

   A scene without a record gets one from `docs/scenes/_template.md`. The
   session's memory notes are private to this machine; the record is what
   survives.

   Then **save the materials** — anything this session used for a scene that
   would otherwise be lost (the Materials section of
   `docs/scenes/_template.md` says where each kind goes):
   - scripts written in the session's scratch folder that were used to
     build, measure or screenshot the scene → `docs/scenes/<id>/scripts/`,
     with absolute local paths made repo-relative;
   - a `/ref` bundle not yet kept → `uv run tools/ref-keep.py <bundle> <id>`;
   - an artifact made for the scene → its source in
     `docs/scenes/<id>/artifacts/` (reference images replaced), and its link
     under Materials;
   - reference material used outside `/ref` (a pasted still, frames pulled
     by hand) → under `tools/.cache/refs/<name>/`, named in the record.

4. **Check for doc rot.** Run `npm run doc-check` first — it narrows this to
   the doc paragraphs that mention code this branch changed and, with a
   `TYPESAFE_API_KEY` configured, flags which of those the change actually
   made wrong; read and fix only the flagged paragraphs. Without a key it
   lists the same candidate paragraphs unjudged — read those instead. Then,
   for any symbol, file, or param name this session renamed, removed, or
   changed the meaning of, grep `AGENTS.md`, `CLAUDE.md` and `docs/*.md` for
   the old name as a fallback — this catches a rename the tool's diff-based
   search can miss, like a name only mentioned in prose rather than declared
   in code. Fix any reference you find — this is the enforcement mechanism
   behind `CLAUDE.md`'s rule to name the variable instead of copying numbers
   or lists from the code: a
   reference that names a real symbol will surface itself here the moment
   that symbol changes.

   After fixing, record a verdict for each flagged paragraph — `stale` if it
   really was wrong, `fine` if the flag was noise — and `missed` for any
   stale paragraph you found some other way that the tool didn't flag, via
   `npm run doc-check -- --verdict <ref>=<stale|fine|missed> ...` (ref is
   `doc:line`, from the tool's own output). `npm run doc-check -- --report`
   shows how well it's doing (precision, cost, calibration) across every run
   recorded so far.

Report what you changed in `docs/status.md`, which scene records and
materials you updated, and whether any doc needed a fix.
