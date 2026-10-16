#!/bin/sh
# Claude Code PreToolUse hook on Edit/Write/NotebookEdit (wired in
# .claude/settings.json): no file in this repo is edited in a checkout that's
# on `main` or `production`. The edit is refused (exit 2) with a note to
# start a worktree; the PreToolUse hook on EnterWorktree fetches first, so
# the new branch starts from a fresh `origin/main`.
#   - Only this repo counts (same git common dir as the project, so its
#     worktrees too); files elsewhere, like memory or scratch, pass.
#   - Edits made through shell commands don't pass through here.

input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
[ -n "$path" ] || exit 0

dir=$(dirname "$path")
while [ ! -d "$dir" ]; do dir=$(dirname "$dir"); done

ours=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
theirs=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ "$ours" = "$theirs" ] || exit 0

branch=$(git -C "$dir" branch --show-current 2>/dev/null)
case "$branch" in
  main|production)
    echo "This checkout is on $branch. Start a worktree (EnterWorktree) and make the change there." >&2
    exit 2 ;;
esac
exit 0
