@AGENTS.md

## Claude Code only

- Give every subagent and workflow `agent()` its own `model` and `effort`,
  the cheapest that does the job — even under Ultracode.
- `/exec-cheap` runs only when the user types it: never suggest it or route
  work to it, and never use it for paid scenes.
- Close a session with `/wrap`.