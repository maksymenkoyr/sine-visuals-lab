---
description: Run GitHub issues through the plan → code → review workflow with correction rounds (a strong model plans and reviews, a cheaper one codes), or rerun the fixed benchmark, and record the results for model comparison
argument-hint: <issue numbers | bench> [solo] [plan=model/effort] [code=model/effort] [review=model/effort] [solo=model/effort] [rounds=N] [fork] [tag=name]
---

This command lives in workflow-arena, cloned at `.workflow-arena/` by the
session-start hook. Read `.workflow-arena/commands/plan-code-review.md` and
follow it with `$ARGUMENTS`. If the clone is missing, run
`git clone --depth 1 https://github.com/maksymenkoyr/workflow-arena .workflow-arena`
first. This repo's benchmark is `.claude/arena-bench.json`.
