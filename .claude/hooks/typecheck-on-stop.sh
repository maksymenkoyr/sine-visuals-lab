#!/bin/sh
# Renamed to check-on-stop.sh. This stays so a worktree whose
# .claude/settings.json predates the rename still finds its Stop hook.
exec "$(dirname "$0")/check-on-stop.sh"
