---
description: Plan a settled change here, have a builder agent build it on the model and effort its difficulty gets, then review its diff and ship
argument-hint: [what to build | #issue]
---

Plan-build splits a settled change in two: this session plans it and a
`builder` agent (`.claude/agents/builder.md`) builds it. It is a working
pattern with one agent, not a workflow, so it runs unasked when CLAUDE.md
says so as well as on `/plan-build` or the user naming it.

1. **Settle it.** Build only what the user asked for or agreed to. An open
   question goes to the user now, not into the plan.
2. **Plan it** as one part in `/handoff`'s part layout (Read first, Steps,
   Do not touch, Done when), under its rules for the writer. Every step
   names the file, the edit and the check. Add the worktree path and branch.
   A change too big for one agent splits into several builds, one after the
   other, each leaving the branch working.
3. **Pick the tier.** Rate the build's difficulty by
   `docs/issue-labels.md` and take the cheapest row of
   `docs/agent-models.md` whose tag covers it: a plan spelled out to the
   diff is tier 5, a build that still takes judgment goes higher. A tier
   that says "ask the user first" waits for their yes.
4. **Spawn the builder** with `subagent_type: "builder"` and the tier's
   `model` and `effort` both passed, never left to the fallback. Say the
   tier in one line before it starts.
5. **Review.** Read its whole diff against the plan, run the checks
   yourself and fix what's wrong; its "done" isn't proof.
6. **Finish with `/ship`.**

`/plan-build #<n>` builds the next part of issue `n`: `/handoff #<n>`'s
pick-up steps choose and read the part, and this command builds it.
