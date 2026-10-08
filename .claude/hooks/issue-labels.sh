#!/bin/sh
# Claude Code PreToolUse hook on Bash (wired in .claude/settings.json): a
# `gh issue create` must carry one difficulty label (`high dif`, `mid dif` or
# `low dif`), or it is refused (exit 2) with the rules of docs/issue-labels.md.
#   - The hook runs no model: the refusal tells the model that filed the issue
#     to judge both the difficulty and `human` (it takes a read of the task).
#     An issue that passes without `human` gets a reminder of that rule.
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
    echo "Label this issue first (docs/issue-labels.md), then run it again. Judge two things: (1) difficulty, one --label of \"high dif\", \"mid dif\" or \"low dif\" (which model and effort should build it); (2) human, add --label human if the task needs a person at some point or has more than a 30% chance of it (recording, listening, a device only they have, a decision left open)." >&2
    exit 2 ;;
esac

case "$cmd" in
  *human*) ;;
  *)
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Issue labels: you left off `human`. Add it (gh issue edit --add-label human) if the task needs a person, or has more than a 30% chance of needing one at some point (docs/issue-labels.md)."}}' ;;
esac
exit 0
