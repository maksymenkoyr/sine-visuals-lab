# Documentation map

This folder is a vault: each note here owns a piece of project knowledge that has
no single owning file in the codebase. The working rules that decide what earns a
note — and what belongs in a code comment instead — live in
[`CLAUDE.md`](../CLAUDE.md) at the repo root, outside this vault. Read those rules
before adding a note here; this file doesn't restate them.

- [Architecture](architecture.md) — the cross-file map: how a sound in the room
  becomes a pixel on screen, and how that pixel reaches a second device.
- [Adding a scene](adding-a-scene.md) — the mechanical steps, plus the one
  auto-tune invariant that isn't owned by any single scene file.
- [Tuning](tuning.md) — the live-tuning loop: param bus, mark, numeric probe,
  contact sheet, A/B.
- [Status](status.md) — what's in flight right now. The one note here that's
  expected to be rewritten wholesale each session.

The session rituals that walk these notes live in `.claude/commands/` — run `/`
in Claude Code to see them.
