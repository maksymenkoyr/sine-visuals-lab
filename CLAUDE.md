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

- Give every subagent and workflow `agent()` its own `model` and `effort`,
  the cheapest that does the job — even under Ultracode.
- `/exec-cheap plans/<topic>.md` hands a plan to an OpenRouter model in a
  separate Claude Code process (`tools/cheap.sh` owns the setup) and verifies
  the result here. Use it only when the user types `/exec-cheap` themselves;
  otherwise ignore it entirely — don't suggest it, don't route work to it, and
  the model rule above stands unchanged. Never for paid scenes.
- The session commands are `/new-scene`, `/ref`, `/tune` and `/wrap`
  (`.claude/commands/`): `/new-scene` walks the add-a-scene checklist and
  starts the scene's record; `/ref` and `/tune` say what a record gains from
  each; `/wrap` checks that nothing the session used was left unsaved.
- Session close: run `/wrap` to regenerate `docs/status.md` and, if a tuning
  session happened, append to `tuning/VOCAB.md`.