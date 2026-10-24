# Issue labels

Three label systems sit on top of the type labels GitHub ships (`bug`,
`enhancement`, `scene idea` and so on). Every issue gets one difficulty label
and one token label; `human` is added when it applies.

## Difficulty: who builds it

One of `high dif`, `mid dif`, `low dif`. The label says which model and effort
should pick the issue up, using the table in `docs/agent-models.md` (the
label's own description in GitHub carries the short version):

- `high dif`: plans, architecture, look and shader work judged by eye, DSP and
  tempo. Opus, medium effort; higher only with the user's go-ahead.
- `mid dif`: following a written plan, writing tests, fixing typecheck errors.
  Sonnet, high effort, or Haiku when the plan spells out every edit.
- `low dif`: edits that can be spelled out exactly, renames, sweeps. Haiku.

Pick the label for the hardest part of the issue. A `plan` label (a written
plan is in the issue, ready to build) can sit next to any of them.

## Tokens: how big it is

One of the labels in `TOKEN_BUCKETS` (`tools/difficultyLib.mjs`), from
`<100K tok` to `>10M tok`: a guess at every token the work will take, counted
over every session that builds it and every agent those sessions start,
cache reads included. Cache reads are most of any session's count, so the
guess is mostly about how long the work runs and how many agents it needs,
not how much code it writes. Difficulty says who should build it; tokens say
what it costs, and the two move apart: a sweep across many files is `low dif`
but can be large, a one-line DSP fix `high dif` but small.

To calibrate, measure finished work: `npm run difficulty -- tokens
<session-id>` prints a past session's count, and `report` (below) shows which
way the guesses have been off.

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
with no difficulty or no token label, and reminds of `human` when that is
missing. It
covers issues Claude files from this repo; an issue made by hand on GitHub
isn't checked. The label names live in `tools/difficultyLib.mjs`, shared with
the correction loop below.

## After the work: the correction loop

A label is a guess made before anyone has done the task. Once a PR closes an
issue, `/ship` records the difficulty the task actually had and the tokens it
took:

    npm run difficulty -- record <issue> --actual <low|mid|high> --human <yes|no> --tokens session --pr <pr> --why "<one line>"

Judge `--actual` by what the work turned out to need, on the same scale as at
filing, not by which model happened to build it: a task that looked like a
sweep but needed a plan is `mid`, one that ended in judging a look by eye is
`high`. `--human` says whether a person was in the end needed. The `--why`
line is what a future corrector learns most from: name what the filing
missed, or what made the task easy.

`--tokens` is measured, not judged: `session` counts the session running the
command and every agent it started, from the Claude Code transcripts. When
earlier sessions worked on the same issue, add them to the list, by session
id or as a count (`--tokens session,4f2c…,1.5M`); a handed-off issue names
its earlier sessions in its comments when they are known. The issue's token
label moves to the bucket the count falls in.

The record is an issue comment that carries the judgement inside an HTML
comment, and the issue is relabeled to match. The issue then holds both the
guess and the outcome, and nothing depends on a container surviving. Record
every closed issue, also when the label held: agreements are data too.
Without `gh`, `--print` (with the current labels in `--labels`) prints the
comment and the label list to post through the GitHub MCP.

`npm run difficulty -- export` writes the dataset, one JSON row per recorded
issue: its title and body, the labels it was filed with, the outcome and the
reason. `npm run difficulty -- report` shows how often the filed difficulty
and token labels held and which way they were off. Both read only records from the repo's owner,
members and collaborators. The `tools/difficulty.mjs` header has the details.
