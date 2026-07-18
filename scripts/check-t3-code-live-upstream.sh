#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
cd "$repo_root"

timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
current_branch="$(git symbolic-ref --quiet --short HEAD || true)"
if [[ "$current_branch" != "main" ]]; then
  echo "[$timestamp] refusing check: current branch is ${current_branch:-detached HEAD}, expected main" >&2
  exit 4
fi
expected_upstream="https://github.com/pingdotgg/t3code.git"
actual_upstream="$(git remote get-url upstream)"
if [[ "$actual_upstream" != "$expected_upstream" ]]; then
  echo "[$timestamp] refusing check: upstream is $actual_upstream, expected $expected_upstream" >&2
  exit 2
fi
git fetch --prune upstream main --quiet
daily_cache="$HOME/Library/Application Support/T3 Code Live Updater/t3code-check.git"
if [[ -d "$daily_cache" ]]; then
  git --git-dir="$daily_cache" fetch --force --quiet "$repo_root" main:refs/heads/main
fi
counts="$(git rev-list --left-right --count HEAD...upstream/main)"
local_ahead="${counts%%[[:space:]]*}"
upstream_ahead="${counts##*[[:space:]]}"

echo "[$timestamp] fork=$(git rev-parse --short HEAD) upstream=$(git rev-parse --short upstream/main) local_ahead=$local_ahead upstream_ahead=$upstream_ahead"

if [[ "$upstream_ahead" -gt 0 ]]; then
  echo "T3 Code Live has $upstream_ahead incoming upstream commit(s):"
  git log --oneline HEAD..upstream/main
fi
