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
   would otherwise be lost (the standing rule in `AGENTS.md` says where each
   kind goes):
   - scripts written in the session's scratch folder that were used to
     build, measure or screenshot the scene → `docs/scenes/<id>/scripts/`,
     with absolute local paths made repo-relative;
   - a `/ref` bundle not yet kept → `uv run tools/ref-keep.py <bundle> <id>`;
   - an artifact made for the scene → its source in
     `docs/scenes/<id>/artifacts/` (reference images replaced), and its link
     under Materials;
   - reference material used outside `/ref` (a pasted still, frames pulled
     by hand) → under `tools/.cache/refs/<name>/`, named in the record.

4. **Check for doc rot.** For any symbol, file, or param name this session
   renamed, removed, or changed the meaning of, grep `AGENTS.md`, `CLAUDE.md`
   and `docs/*.md` for the old name. Fix any reference you find — this is the
   enforcement mechanism behind rule 2 in `AGENTS.md` ("never write down
   anything countable"): a reference that names a real symbol will surface
   itself here the moment that symbol changes.

Report what you changed in `docs/status.md`, which scene records and
materials you updated, and whether any doc needed a fix.
