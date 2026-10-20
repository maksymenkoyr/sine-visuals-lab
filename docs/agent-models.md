# Agent models

Which model and effort an agent runs on: subagents from the Agent tool,
`agent()` calls in a workflow, and the session itself when it picks one.
Difficulty words are the issue labels in `docs/issue-labels.md`.

| Tier | Model · effort | Tag | Spawn |
|---|---|---|---|
| 1 | Opus 5.5 · max | The hardest `high dif` work, where overthinking beats a miss | Ask the user first |
| 2 | Opus 5.5 · xhigh, high | The top of `high dif` | Ask the user first |
| 3 | Opus 5.5 · medium | The easy end of `high dif`, the hard end of `mid dif` | Free |
| 4 | Sonnet 5.5 · high | `mid dif` and below: thinking work that needs no Opus | Free |
| 5 | Haiku 5.5 · xhigh, high | Writing code from a written plan | Free |
| 6 | Haiku 5.5 · low to xhigh | High volume, low complexity: gathering, checking one claim, sweeps | Free |

Tiers 1–4 think: plan, design, research, review, judge. Tiers 5–6 carry out
a plan or do mechanical work.

- **These are the only allowed combinations.** An agent runs on a row of this
  table or not at all. Sonnet below high, Opus below medium, or any other
  model, needs the user's go-ahead first.
- **A tag names the usual job, not the only one.** Pick the cheapest tier
  whose tag covers the job; a tier may take other work at the same
  difficulty.
- **Always name the model and effort.** An agent that names neither inherits
  the session's model, and a session runs on Opus. Workflows that left the
  model unset spent the most on Opus with nothing to show for it (the
  2026-10-20 cost review: the 09-30 perf audit and the 10-02 code review).
- **Many agents means low tiers.** Fan-out work (one agent per finding, file
  or PR) goes to tier 5 or 6. Only the one agent that merges or judges their
  output goes higher.

**Exception:** the `/plan-code-review` and `/grade-runs` benchmarks may run
any model and effort, since comparing them is their job.
