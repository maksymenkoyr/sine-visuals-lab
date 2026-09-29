# CLAUDE.md

Claude Code's file for this repo. The shared project rules load first from
@AGENTS.md — treat this file as authoritative and don't load `AGENTS.md` a
second time as a standalone file (Claude Code's default Project instructions
already won't; this note is the backstop if they're ever changed). Conversely,
tools that aren't Claude Code should read `AGENTS.md` and ignore this file.
Citations of `AGENTS.md` in this repo's code and docs mean the rules imported
below; citations of `CLAUDE.md` for those same rules also mean them.

## Claude Code only

Everything below applies to Claude Code sessions. It lives here because it
depends on Claude Code features — slash commands in `.claude/commands/` and
Anthropic model routing — that no other tool shares.

- Once a detailed plan exists, execute it with Sonnet whenever possible (an
  agent with `model: "sonnet"`). Keep the stronger model for planning and
  review.
- The session commands are `/new-scene`, `/ref`, `/tune` and `/wrap`
  (`.claude/commands/`): `/new-scene` walks the add-a-scene checklist and
  starts the scene's record; `/ref` and `/tune` say what a record gains from
  each; `/wrap` checks that nothing the session used was left unsaved.
- Session close: run `/wrap` to regenerate `docs/status.md` and, if a tuning
  session happened, append to `tuning/VOCAB.md`.