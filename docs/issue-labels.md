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

Judge it when the issue is filed. If it turns out later that a person was needed,
add the label then.

## Where it is enforced

`.claude/hooks/issue-labels.sh`, a PreToolUse hook on Bash, wired in
`.claude/settings.json`. It refuses a `gh issue create` with no difficulty
label, and reminds of `human` when that is missing. It covers issues Claude
files from this repo; an issue made by hand on GitHub isn't checked.
