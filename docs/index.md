# Documentation map

This folder is a vault: each note here owns a piece of project knowledge that has
no single owning file in the codebase. The working rules that decide what earns a
note — and what belongs in a code comment instead — live in
[`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md) at the repo
root, outside this vault. Read those rules
before adding a note here; this file doesn't restate them.

- [Architecture](architecture.md) — the cross-file map: how a sound in the room
  becomes a pixel on screen, and how that pixel reaches a second device.
- [Feature map](feature-map.md) — every feature a visitor can meet, as a tree
  by where they meet it, each marked by how much it matters, with what the
  usage counts measured.
- [Adding a scene](adding-a-scene.md) — the mechanical steps, plus the one
  auto-tune invariant that isn't owned by any single scene file.
- [Tuning](tuning.md) — the live-tuning loop: param bus, mark, numeric probe,
  contact sheet, A/B.
- [Vocabulary](vocabulary.md) — the words the panel uses for wiring the sound
  into a scene (signal, jack, wire, port, reactive setting), mapped to the
  code's own names.
- [Video house style](video-house-style.md) — the three promo videos (release,
  hook, explainer) and the taste calls every one of them follows.
- [Issue labels](issue-labels.md) — the difficulty labels (which model builds an
  issue), the `human` label (a person is needed), and the hook that enforces them.
- [Status](status.md) — what's in flight right now. The one note here that's
  expected to be rewritten wholesale each session.
- [Scene records](scenes/) — one note per scene, `scenes/<id>.md`: what it
  is, what inspired it, what was measured, every decision and pivot, what's
  still off, and how to pick it back up. New ones start from
  [the template](scenes/_template.md).

The session rituals that walk these notes live in `.claude/commands/` — run `/`
in Claude Code to see them. Research handed on to later build sessions lives in
`plans/<topic>.md`; `/handoff` writes those plans and picks them up.
