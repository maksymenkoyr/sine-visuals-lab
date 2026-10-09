# Issue labels

Two label systems sit on top of the type labels GitHub ships (`bug`,
`enhancement`, `scene idea` and so on). Every issue gets one difficulty label;
`human` is added when it applies.

## Difficulty: who builds it

One of `high dif`, `mid dif`, `low dif`. The label says which model and effort
should pick the issue up, using the table in `CLAUDE.md` (the label's own
description in GitHub carries the short version):

- `high dif`: plans, architecture, look and shader work judged by eye, DSP and
  tempo. Opus, high effort.
- `mid dif`: following a written plan, writing tests, fixing typecheck errors.
  Sonnet, medium effort.
- `low dif`: edits that can be spelled out exactly, renames, sweeps. Haiku, low
  effort.

Pick the label for the hardest part of the issue. A `plan` label (a written
plan is in the issue, ready to build) can sit next to any of them.

## `human`: a person is needed

Add `human` when the task needs a person at some point, or has more than a 30%
chance of needing one. A person is needed to:

- record, listen to or watch something (a take in a room, a gig, a screen);
- test on a device or account the model can't reach (a phone, a Mac setting,
  the user's own Spotify);
- decide a look, wording or tradeoff the issue leaves open;
- give a permission or a credential, or confirm a guess (a tempo, a name).

Judge it when the issue is filed. If it turns out later that a person was
needed, the record after the work (below) says so and adds the label.

## Where it is enforced

`.claude/hooks/issue-labels.mjs`, a PreToolUse hook on Bash and on the GitHub
MCP's `issue_write`, wired in `.claude/settings.json`. It refuses a new issue
with no difficulty label, and reminds of `human` when that is missing. It
covers issues Claude files from this repo; an issue made by hand on GitHub
isn't checked. The label names live in `tools/difficultyLib.mjs`, shared with
the correction loop below.

## After the work: the correction loop

A label is a guess made before anyone has done the task. Once a PR closes an
issue, `/ship` records the difficulty the task actually had:

    npm run difficulty -- record <issue> --actual <low|mid|high> --human <yes|no> --pr <pr> --why "<one line>"

Judge `--actual` by what the work turned out to need, on the same scale as at
filing, not by which model happened to build it: a task that looked like a
sweep but needed a plan is `mid`, one that ended in judging a look by eye is
`high`. `--human` says whether a person was in the end needed. The `--why`
line is what a future corrector learns most from: name what the filing
missed, or what made the task easy.

The record is an issue comment that carries the judgement inside an HTML
comment, and the issue is relabeled to match. The issue then holds both the
guess and the outcome, and nothing depends on a container surviving. Record
every closed issue, also when the label held: agreements are data too.
Without `gh`, `--print` (with the current labels in `--labels`) prints the
comment and the label list to post through the GitHub MCP.

`npm run difficulty -- export` writes the dataset, one JSON row per recorded
issue: its title and body, the labels it was filed with, the outcome and the
reason. `npm run difficulty -- report` shows how often the filed difficulty
held and which way it was off. Both read only records from the repo's owner,
members and collaborators. The `tools/difficulty.mjs` header has the details.
