#!/usr/bin/env bash
# Resolve the merge conflicts of a rebase or merge that stopped, spending as
# few tokens as possible. Run it by hand (`! npm run fix-conflicts` inside a
# session, or `fix-conflicts <PR number>` in a terminal, which runs
# tools/fix-conflicts-pr.sh to also continue the rebase and push) after
# `git rebase origin/main` reports a conflict.
#
# Two passes:
#   1. tools/fix-conflicts-auto.mjs settles, with plain code and no model, the
#      conflicts where both sides only added lines at the same spot or made
#      the same change (rules in tools/fixConflictsLib.mjs). Most conflicts
#      in this repo are these: two branches adding to one list.
#   2. Only what is left goes to a cheap model in its own headless Claude Code
#      process. It starts with an empty conversation, with CLAUDE.md, the
#      memory index and the dynamic system-prompt sections switched off (a
#      trivial prompt measured about 55% cheaper that way), and is told the
#      line range of each remaining conflict so it reads those and no more.
#
# What it does and does not do: it edits the conflicted files and `git add`s
# them. It never runs `git rebase --continue`, commits or pushes
# (tools/fix-conflicts-pr.sh does, after this script says nothing
# is left), and it does not run the typecheck: the pre-push hook runs
# `npm run check`. When both sides changed the same logic in different ways it
# stops and says so, leaving the file untouched, so you pick a stronger model
# for that one.
#
# With ANTHROPIC_API_KEY set the model runs `--bare` (no hooks or settings
# loaded). Without a key (subscription login) `--bare` can't authenticate, so
# it runs normally with skills, MCP and project settings switched off.
# FIX_CONFLICTS_MODEL overrides the model (default: sonnet).

set -euo pipefail

MODEL="${FIX_CONFLICTS_MODEL:-sonnet}"

if [ -z "$(git diff --name-only --diff-filter=U)" ]; then
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

# Pass 1: no model. The script may be missing in an older checkout; then the
# model gets everything.
auto="$(dirname "${BASH_SOURCE[0]}")/fix-conflicts-auto.mjs"
if [ -f "$auto" ]; then
  node "$auto"
fi

files="$(git diff --name-only --diff-filter=U)"
if [ -z "$files" ]; then
  echo "All conflicts settled without a model." >&2
  exit 0
fi

# Pass 2: where each remaining conflict sits (first marker line to last), so
# the model reads those lines instead of whole files.
ranges="$(for f in $files; do
  awk -v f="$f" '/^<{7}( |$)/ {s=NR} /^>{7}( |$)/ && s {print f ": lines " s "-" NR; s=0}' "$f" 2>/dev/null || true
done)"

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  context_flags=(--bare)
else
  context_flags=(--disable-slash-commands --strict-mcp-config --setting-sources user --exclude-dynamic-system-prompt-sections)
fi
export CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

prompt="A git $mode stopped on conflicts. These conflict blocks remain
(marker lines, ours then theirs; ours is what the branch was rebased onto):
$ranges

For each file read only those lines (plus a few around them), resolve every
conflict marker so the result keeps the intent of BOTH sides, and edit. When
every edit has succeeded, in a separate final step, \`git add\` all the
resolved files in one command. Use \`git log\`, \`git show\` and \`git diff\`
(e.g. \`git log --oneline -5 REBASE_HEAD\`) only if you need to know what a
side was doing.

Stop and change nothing in a file if both sides changed the same logic in
different ways and you would be guessing: say which file and why.

Never run git rebase --continue, git commit, git push or git checkout, and
never edit anything outside the listed files. Finish with one line per file:
resolved, or needs judgment (and why)."

claude -p "$prompt" \
  --model "$MODEL" \
  "${context_flags[@]}" \
  --permission-mode acceptEdits \
  --allowedTools "Read" "Edit" "Bash(git add:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" \
  "$@"
