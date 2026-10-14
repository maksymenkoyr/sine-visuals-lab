#!/usr/bin/env bash
# `fix-conflicts <PR number>`: bring a PR's branch up to date with its base and
# push it. Finds (or creates, from the PR's branch on origin) the PR's worktree
# under .claude/worktrees/, starts `git rebase origin/<base>` there unless one
# is already stopped, resolves each stop with tools/fix-conflicts.sh, continues
# the rebase and pushes with --force-with-lease. It stops before the push when
# a file needs judgment. Arguments after the PR number go to fix-conflicts.sh.
#
# The push runs the pre-push hook (npm run check). On a machine busy with
# parallel agents a slow test can run past its time limit, so a refused push
# is tried once more. If that fails too, the finished rebase stays: the branch
# shows as diverged from origin until it lands, and running this again only
# pushes.
#
# The ~/.zshrc function `fix-conflicts` only runs this script from the main
# checkout and then cd's into the worktree it names (a script can't move its
# parent shell): it writes the worktree path to $FIX_CONFLICTS_CD_FILE when
# that is set. All the logic lives here, not in ~/.zshrc, because a terminal
# keeps the copy of a function it loaded at start-up: when the steps lived in
# the function, a terminal opened before an update ran the old steps and
# stopped mid-rebase without continuing.

set -uo pipefail

pr="${1:?usage: fix-conflicts-pr.sh <PR number> [fix-conflicts.sh args]}"
shift
fixer="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fix-conflicts.sh"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" || exit 1

rebasing() { [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; }
conflicted() { [ -n "$(git diff --name-only --diff-filter=U)" ]; }

branch=$(cd "$main" && gh pr view "$pr" --json headRefName -q .headRefName) || exit 1
base=$(cd "$main" && gh pr view "$pr" --json baseRefName -q .baseRefName) || exit 1

dir=$(git -C "$main" worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree /{p=substr($0,10)} $1=="branch" && $2==b {print p}')
if [ -z "$dir" ]; then
  # A worktree stopped mid-rebase has a detached HEAD; its rebase still names the branch.
  while IFS= read -r w; do
    gd=$(git -C "$w" rev-parse --absolute-git-dir)
    if [ -f "$gd/rebase-merge/head-name" ] && [ "$(<"$gd/rebase-merge/head-name")" = "refs/heads/$branch" ]; then dir=$w; break; fi
  done < <(git -C "$main" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}')
fi
if [ -z "$dir" ]; then
  name="${branch#worktree-}"
  dir="$main/.claude/worktrees/${name//\//-}"
  git -C "$main" fetch origin "$branch" || exit 1
  if git -C "$main" show-ref -q --verify "refs/heads/$branch"; then
    git -C "$main" worktree add "$dir" "$branch" || exit 1
  else
    git -C "$main" worktree add -b "$branch" "$dir" "origin/$branch" || exit 1
  fi
fi
cd "$dir" || exit 1
[ -n "${FIX_CONFLICTS_CD_FILE:-}" ] && printf '%s\n' "$dir" >"$FIX_CONFLICTS_CD_FILE"

if ! conflicted && ! rebasing; then
  git fetch origin "$base" || exit 1
  git rebase "origin/$base" || conflicted || exit 1
fi

# Resolve, continue and repeat (a rebase of several commits can stop again).
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if conflicted; then
    bash "$fixer" "$@"
    if conflicted; then
      echo "Conflicts left that need judgment (see above): fix by hand, then run: fix-conflicts $pr" >&2
      exit 1
    fi
  fi
  rebasing || break
  GIT_EDITOR=true git rebase --continue || conflicted || exit 1
done
if rebasing; then
  echo "Rebase did not finish: see git status." >&2
  exit 1
fi

# The pre-push hook runs npm run check, which needs a complete install.
if [ -f package.json ]; then
  npm ls --depth=0 >/dev/null 2>&1 || npm ci || exit 1
fi
for try in 1 2; do
  git push --force-with-lease origin "$branch" && exit 0
  [ "$try" = 1 ] && echo "Push refused (see above). Trying once more, in case a test only ran slow." >&2
done
echo "The rebase is done and kept; only the push failed (see above). Fix what failed, then run: fix-conflicts $pr" >&2
exit 1
