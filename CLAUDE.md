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

- Subagents and workflows run on the cheapest model and effort that does
  their job well — see "Choosing a model for each agent" below. Once a
  detailed plan exists, execute it with Sonnet whenever possible. The
  stronger model stays with planning and review.
- `/exec-cheap plans/<topic>.md` hands a plan to an OpenRouter model in a
  separate Claude Code process (`tools/cheap.sh` owns the setup) and verifies
  the result here. Use it only when the user types `/exec-cheap` themselves;
  otherwise ignore it entirely — don't suggest it, don't route work to it, and
  the model rules below stand unchanged. Never for paid scenes.
- The session commands are `/new-scene`, `/ref`, `/tune` and `/wrap`
  (`.claude/commands/`): `/new-scene` walks the add-a-scene checklist and
  starts the scene's record; `/ref` and `/tune` say what a record gains from
  each; `/wrap` checks that nothing the session used was left unsaved.
- Session close: run `/wrap` to regenerate `docs/status.md` and, if a tuning
  session happened, append to `tuning/VOCAB.md`.

### Choosing a model for each agent

The main session is the orchestrator. It plans the work, splits it into
agents, and picks a model and an effort for **each agent separately**. That
choice is part of the plan, not something the agent inherits. Pick the
cheapest tier the job allows. Moving up a tier needs a reason: what would go
wrong on the cheaper one.

- **Haiku, effort `low`** — mechanical work whose output is easy to check:
  finding files or symbols, grep and log sweeps, collecting lists, running a
  command and reporting what it printed, reformatting.
- **Sonnet, effort `medium`** — the default worker: executing a detailed
  plan, writing code to a spec, per-file transforms, finding review
  candidates, one scene's measurements.
- **Opus, effort `high`** — planning and design, choosing between
  approaches, adversarial verification, synthesis across many results, and
  judging a picture against a reference or the previous version. That last
  one is taste, which cheaper tiers get wrong while still matching the
  numbers. Use Opus for any work whose spec is still vague.
- **`xhigh` / `max`** — only for the single hardest judge or verify stage,
  and never on a stage that fans out.

Escalate one item at a time; don't raise the default for everything. If a
cheap stage's output fails verification, re-run that item one tier up rather
than moving the whole fan-out up a tier.

How to set it:

- **Workflow scripts** (`agent()`): pass both `model` and `effort` on every
  call, and put the stage's `model` on its `meta.phases` entry. Leaving them
  out inherits the session's model and effort, which is the most expensive
  tier. The workflow reference's "default to omitting `model`" advice is
  overridden here.
- **Agent tool**: `model` is set per call. Effort is not. It comes from the
  agent type's definition (`.claude/agents/*.md` frontmatter), and this repo
  defines none, so a plain Agent call runs at the session's effort. When a job
  needs low effort, run it as a workflow `agent()` instead. A `fork` always
  runs on the parent's model, so never fork cheap work.
- **Ultracode** makes "a workflow for every substantive task" the default. It
  doesn't put every agent on the session model. The tiers above still apply
  inside every workflow it runs, and its stated "token cost is not a
  constraint" covers how many agents run and how many verification rounds
  happen, not which tier each agent uses.