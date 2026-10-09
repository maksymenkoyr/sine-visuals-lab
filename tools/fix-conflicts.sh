#!/usr/bin/env bash
# Resolve the merge conflicts of a rebase or merge that stopped, using a cheap
# model in its own headless Claude Code process. Run it by hand
# (`! npm run fix-conflicts` inside a session, or `npm run fix-conflicts` in a
# terminal) after `git rebase origin/main` reports a conflict.
#
# Why a separate process: it starts with an empty conversation, so a long
# session on an expensive model never re-reads (or pays for) its context here.
# The process only sees the conflicted files plus what the prompt below lists.
#
# What it does and does not do: it edits the conflicted files, `git add`s them
# and runs the typecheck. It never runs `git rebase --continue`, commits or
# pushes — you do that after looking at `git diff --cached`. When both sides
# changed the same logic in different ways it stops and says so, leaving the
# file untouched, so you pick a stronger model for that one.
#
# Start-up cost: with ANTHROPIC_API_KEY set it runs `--bare` (no CLAUDE.md,
# hooks or memory loaded). Without a key (subscription login) `--bare` can't
# authenticate, so it runs normally with hooks, skills and MCP switched off.
# FIX_CONFLICTS_MODEL overrides the model (default: sonnet).

set -euo pipefail

MODEL="${FIX_CONFLICTS_MODEL:-sonnet}"

files="$(git diff --name-only --diff-filter=U)"
if [ -z "$files" ]; then
  echo "No conflicted files: nothing to fix." >&2
  exit 0
fi

mode=none
if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
  mode=rebase
elif git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  mode=merge
fi
if [ "$mode" = none ]; then
  echo "Conflicts but no rebase or merge in progress; fix them by hand." >&2
  exit 1
fi

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  context_flags=(--bare)
else
  context_flags=(--disable-slash-commands --strict-mcp-config --setting-sources user)
fi

prompt="A git $mode stopped on conflicts in these files:
$files

For each file: read it, resolve every conflict marker so the result keeps the
intent of BOTH sides, and only after the edit has succeeded (a separate step,
never in the same batch as the edit) \`git add\` the file. Use \`git log\`, \`git show\` and
\`git diff\` (e.g. \`git log --oneline -5 REBASE_HEAD\`, \`git diff --name-only\`)
if you need to know what each side was doing.

Stop and change nothing in a file if both sides changed the same logic in
different ways and you would be guessing: say which file and why.

When done run \`npm run typecheck\`. Never run git rebase --continue, git
commit, git push or git checkout, and never edit anything outside the listed
files. Finish with one line per file: resolved, or needs judgment (and why)."

claude -p "$prompt" \
  --model "$MODEL" \
  "${context_flags[@]}" \
  --permission-mode acceptEdits \
  --allowedTools "Read" "Edit" "Bash(git add:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(npm run typecheck)" \
  "$@"
