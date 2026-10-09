# Gather what we know about agent models, effort and token cost

Several sessions have worked out which model and effort each kind of agent work needs (planning, coding, review, sweeps) and what it costs in tokens. The findings are spread over PRs, a plan, issues, CLAUDE.md and local notes, and one of them is wrong: the workflow stats price Haiku as if it never passed 100K tokens, so Haiku looks up to 3.5× cheaper than it is. This fixes the stats, writes everything into one doc, and makes CLAUDE.md's delegation table match it. Then the next choice about models starts from all the evidence at once.

Researched 2026-10-09. Issue: #455

## Decisions

- "Gather all this stuff in one place", including loosely related research — one doc in `docs/`, linking each source rather than copying it.
- "Set recommended auto compaction": auto-compaction is back on in the user settings at its default (`autoCompactEnabled`, it had been `false`).
- "On haiku cap I think I shouldn't force it. It could affect work and it's still quite cheap too" — no Haiku compact window. Haiku may pass 100K; the stats should just price it honestly (phase 1).
- A lean Haiku agent for plan-following code: `.claude/agents/haiku-coder.md` (#451), the user's "yeah" to trying it.

## Prototypes

None. Measurements are in "Evidence" below and in `~/.claude/workflow-stats/runs.jsonl` (`npm run workflow-stats -- report`).

## Evidence (2026-10-09, this session)

- Haiku 5.5 bills a request at a higher per-token rate once its prompt passes 100K tokens (claude-api skill pricing; current rates on the pricing page).
- Recorded `/plan-code-review` Haiku code stages at xhigh peaked at 107–172K tokens. Repriced request by request with the over-100K tier, Haiku cost per run was 1.8× (r8) to 3.5× (r6) what the stats recorded: r6 $1.26 vs $0.36, r8 $0.36 vs $0.20, for three issues each.
- Per issue, the Haiku code stage at xhigh made 34–115 requests, re-read 2.5–12.8M tokens of cached context, wrote 90–170K new context and ~9–37K output (output is a floor; transcripts undercount it). Re-reading is almost all of its cost.
- Auto-compaction off means no window setting works: Haiku agents grew to 270K in tests with every window setting tried.
- With compaction on, a Haiku `autoCompactWindow` of 100000 compacted at ~65–77K (peak request 72K); 120000 compacted at 88–99K (peak request 90K). Neither let a request pass 100K. Claude Code keeps a ~30K buffer under the window. The setting reaches subagents, including Haiku subagents spawned by an Opus session.
- `haiku-coder` (body replaces Claude Code's system prompt, `omitClaudeMd: true`, six tools) started at 5K tokens on a small task; a general-purpose Haiku agent with the same task started at 19K. Workflow agents also carry their prompt (the plan), which stays.
- Anthropic's guidance (claude-api skill, cached 2026-10-06): Sonnet 5.5 at medium is the starting point for agentic coding; Opus 5.5 at its default medium matched Opus 5 at high on coding and catches more bugs in review with fewer false alarms; Haiku 5.5 is for sub-agent and high-volume work, "not long agentic loops"; sweep effort before switching to a cheaper model; a planner plus workers paid off only when there was bulk to hand out; judge cost per finished task; review prompts that say "only high-severity" hide real bugs.

## Rejected

- A Haiku compact window (`modelSettings` `autoCompactWindow` 100000 or 120000) — the user's call above. It worked in tests, but compaction mid-task summarizes the plan Haiku is following, and the money saved is small.
- A hook that stops Haiku near 100K — hooks don't receive the model or token use, and stopping mid-change leaves work for a fix round.

## Open questions

- Should the `/plan-code-review` code stage run as `agentType: 'haiku-coder'`, with the repo rules it needs written into the plan? — blocks phase 4

## Phases

Each phase is one build session and one PR.

- [ ] **1. `npm run workflow-stats -- report` shows Haiku's real cost, over-100K requests included**
  - Touches: `tools/workflowStatsLib.mjs` (`PRICES`, `transcriptStats`, the cost sum), `tools/workflow-stats.mjs`, their tests
  - Read first: the `tools/workflowStatsLib.mjs` header; the claude-api skill's Haiku 5.5 pricing (both rate cards)
  - Done when: `transcriptStats` splits tokens from requests over 100K and the cost prices them at the higher card; a test with a fixture over 100K fails without the split; re-recording the existing runs (`sweep`) shows r6's Haiku cost near $1.26 rather than $0.36; `npm run typecheck` and `npm run test` pass

- [ ] **2. One doc says which model and effort each kind of agent work gets, and why**
  - Touches: new `docs/agent-models.md`, `docs/index.md`
  - Read first: this plan's Evidence; `plans/multi-model-flow.md`; #429, #444, #447, #451; CLAUDE.md's delegation table; `docs/issue-labels.md`
  - Done when: the doc covers planning, coding, review and sweeps, Haiku's 100K line and why it isn't capped, the lean agent, and the cost-per-finished-task rule, each linking its source; numbers stay in dated notes, per CLAUDE.md

- [ ] **3. CLAUDE.md's delegation table matches the doc**
  - Touches: `CLAUDE.md`, `AGENTS.md` (two separate copies; edit shared rules in both), `docs/issue-labels.md`
  - Read first: `docs/agent-models.md` from phase 2
  - Done when: the table names `haiku-coder` for spelled-out edits, every row agrees with the doc, and both files say the same thing

- [ ] **4. `/plan-code-review` codes with the lean Haiku agent, and a bench run shows whether it holds up**
  - Touches: `.claude/workflows/plan-code-review.js` (the code and fix stages), `.claude/commands/plan-code-review.md`
  - Read first: the workflow's header; `plans/multi-model-flow.md`; `.claude/agents/haiku-coder.md`
  - Done when: the open question is answered; `/plan-code-review bench` with the lean coder is recorded next to r8 in `npm run workflow-stats -- report`, with its grade and cost

## Learned while building
