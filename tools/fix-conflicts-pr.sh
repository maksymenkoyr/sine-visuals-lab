#!/usr/bin/env bash
# `fix-conflicts <PR number>`: bring a PR's branch up to date with its base and
# push it. Finds (or creates, from the PR's branch on origin) the PR's worktree
# under .claude/worktrees/, starts `git rebase origin/<base>` there unless one
# is already stopped, resolves each stop with tools/fix-conflicts.sh, continues
# the rebase and pushes with --force-with-lease. It stops before the push when
# a file needs judgment. Arguments after the PR number go to fix-conflicts.sh.
#
# The push runs the pre-push hook (npm run check), which takes minutes. Two
# things can refuse it besides a real failure:
# - Someone else's push to the PR. --force-with-lease refuses when origin's
#   copy of the branch moved past this repo's origin/<branch>, and fetching it
#   would let the push drop their commits. So before the push, and after a
#   refusal, the script asks origin for the tip; when it moved, it stops and
#   lists the new commits (fetched into FETCH_HEAD only, so the lease still
#   guards them) with the commands that keep them.
# - A test that ran out of time on a machine busy with parallel agents. A
#   push the check refused only for that (its report in $CHECK_REPORT_FILE,
#   tools/check.mjs header) is tried again, up to push_tries pushes in all.
#   Any other refusal stops at once, so a test that fails now and then can't
#   get through on a second roll.
# When the push fails, the finished rebase stays: the branch shows as diverged
# from origin until it lands. Running this again rebases onto a fresh
# origin/<base> (nothing to do unless the base moved, and then it can stop on
# new conflicts) and pushes.
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

# Pushes in all when the check refuses only because a test ran out of time.
push_tries=2

# True, after listing their commits, when someone pushed to the PR's branch
# since this repo last fetched it.
remote_moved() {
  local known remote range
  known=$(git rev-parse -q --verify "refs/remotes/origin/$branch")
  remote=$(git ls-remote origin "refs/heads/$branch" | cut -f1) || { echo "Could not ask origin for $branch (see above)." >&2; exit 1; }
  [ "$remote" != "$known" ] || return 1
  if [ -z "$remote" ]; then
    echo "origin has no branch $branch any more: look at PR $pr before pushing." >&2
    return 0
  fi
  # An empty --refmap fetches into FETCH_HEAD only, leaving origin/$branch as the lease.
  git fetch -q --refmap= origin "refs/heads/$branch" || exit 1
  range="${known:-HEAD}..$remote"
  echo "Someone pushed to $branch since this repo last fetched it:" >&2
  git log --oneline "$range" >&2
  echo "Put what you keep of it on this branch (git cherry-pick $range), then run: git fetch origin $branch && fix-conflicts $pr" >&2
  echo "Fetching without that makes the next push drop their commits." >&2
}

remote_moved && exit 1

# The pre-push hook runs npm run check, which needs a complete install.
if [ -f package.json ]; then
  npm ls --depth=0 >/dev/null 2>&1 || npm ci || exit 1
fi
CHECK_REPORT_FILE=$(mktemp) || exit 1
export CHECK_REPORT_FILE
trap 'rm -f "$CHECK_REPORT_FILE"' EXIT
for ((try = 1; ; try++)); do
  : >"$CHECK_REPORT_FILE"
  git push --force-with-lease origin "$branch" && exit 0
  remote_moved && exit 1
  if [ "$try" -ge "$push_tries" ] || ! grep -Eq '(Test|Hook) timed out in [0-9]+ms' "$CHECK_REPORT_FILE"; then break; fi
  echo "The check refused the push because a test ran out of time (see above), which a busy machine can cause: pushing again." >&2
done
echo "The rebase is done and kept; only the push failed (see above). Fix what failed, then run: fix-conflicts $pr" >&2
exit 1
