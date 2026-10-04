#!/bin/sh
# Claude Code SessionStart hook (wired in .claude/settings.json). What it
# prints lands in the session's context before any work starts:
#   - how far this checkout is behind origin/main, when it is, so a session
#     never reads stale code as current;
#   - the open PRs, so a session sees a change another session already has
#     in flight (CLAUDE.md's Git section says what to do with them).
# Prints nothing it can't fetch: offline or without `gh` login it stays
# silent and never blocks the session.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

git fetch -q origin main 2>/dev/null
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null)
if [ "${behind:-0}" -gt 0 ]; then
  echo "This checkout is $behind commits behind origin/main."
fi

prs=$(gh pr list --state open --limit 100 --json number,title,headRefName \
  --jq '.[] | "#\(.number) \(.title) [\(.headRefName)]"' 2>/dev/null)
if [ -n "$prs" ]; then
  echo "Open PRs:"
  echo "$prs"
fi

exit 0
