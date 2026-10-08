#!/bin/sh
# Claude Code PreToolUse hook on Bash (wired in .claude/settings.json): a
# `gh issue create` must carry one difficulty label (`high dif`, `mid dif` or
# `low dif`), or it is refused (exit 2) with the rules of docs/issue-labels.md.
#   - The hook can't judge the `human` label (it takes a read of the task), so
#     an issue that passes without it gets a reminder of that rule instead.
#   - Only the command text is read; an issue made on the GitHub site, or by
#     someone else, doesn't pass through here.

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
case "$cmd" in
  *"gh issue create"*) ;;
  *) exit 0 ;;
esac

case "$cmd" in
  *"high dif"*|*"mid dif"*|*"low dif"*) ;;
  *)
    echo "Add a difficulty label with --label: \"high dif\", \"mid dif\" or \"low dif\" (which model and effort should build it; docs/issue-labels.md)." >&2
    exit 2 ;;
esac

case "$cmd" in
  *human*) ;;
  *)
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Issue labels: you left off `human`. Add it (gh issue edit --add-label human) if the task needs a person, or has more than a 30% chance of needing one at some point (docs/issue-labels.md)."}}' ;;
esac
exit 0
