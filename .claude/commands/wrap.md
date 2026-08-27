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

3. **Resolve every setting this session promoted.** Grep the scenes touched
   this session for `draft: true`. A draft is a constant that was promoted to
   a dial so it could be scrubbed, and leaving it undecided is how a scene
   silently fills with half-considered controls. For each one, say which it
   should be — kept (drop the flag and give it a real label, description and
   `auto` weights), still a draft (say why it's unresolved), or baked (fold
   the scrubbed value back into a constant and delete the entry). Take the
   scrubbed values from the `tuning/params*.json` files. See the
   promote → scrub → keep/draft/bake loop in `docs/tuning.md`.

4. **Check for doc rot.** For any symbol, file, or param name this session
   renamed, removed, or changed the meaning of, grep `CLAUDE.md` and `docs/*.md`
   for the old name. Fix any reference you find — this is the enforcement
   mechanism behind rule 2 in `CLAUDE.md` ("never write down anything
   countable"): a reference that names a real symbol will surface itself here
   the moment that symbol changes.

Report what you changed in `docs/status.md` and whether any doc needed a fix.
