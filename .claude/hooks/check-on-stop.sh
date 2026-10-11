#!/bin/sh
# Claude Code Stop + SubagentStop hook (wired in .claude/settings.json): a
# session or subagent can't report done while `npm run check` fails. When the
# checkout it worked in has changes against origin/main, this runs
# `node tools/check.mjs --changed` (every step, but only the tests related to
# the changed files; the tools/check.mjs header lists the steps). On failure
# it exits 2, which sends the errors back to that session or agent to fix
# before it stops.
#   - Runs only when something changed, and only when that change differs
#     from the last one that passed (a hash kept in the checkout's git dir),
#     so a conversational turn costs nothing.
#   - Blocks once per stop: if the retry still fails (say main itself is
#     red) it lets the session stop rather than loop.
#   - A checkout from before tools/check.mjs existed gets the old
#     typecheck-only run.
#   - Anything it can't work out (no git, no origin/main, no typecheck
#     script) means stay silent and allow the stop.

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ] && exit 0

dir=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
cd "${dir:-${CLAUDE_PROJECT_DIR:-.}}" 2>/dev/null || exit 0
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$top" || exit 0
grep -q '"typecheck"' package.json 2>/dev/null || exit 0
base=$(git merge-base HEAD origin/main 2>/dev/null) || exit 0

untracked=$(git ls-files --others --exclude-standard)
if [ -z "$(git diff --name-only "$base")" ] && [ -z "$untracked" ]; then
  exit 0
fi

stamp="$(git rev-parse --git-dir)/claude-check-ok"
state=$( { git diff "$base"; for f in $untracked; do [ -f "$f" ] && cat "$f"; done; } | shasum | cut -d' ' -f1)
[ "$(cat "$stamp" 2>/dev/null)" = "$state" ] && exit 0

if [ -f tools/check.mjs ]; then
  what="npm run check"
  out=$(node tools/check.mjs --changed 2>&1)
else
  what="npm run typecheck"
  out=$(npm run -s typecheck 2>&1)
fi
if [ $? -eq 0 ]; then
  echo "$state" > "$stamp"
  exit 0
fi
echo "$what fails in $top. Fix it before finishing:" >&2
echo "$out" | head -80 >&2
exit 2
