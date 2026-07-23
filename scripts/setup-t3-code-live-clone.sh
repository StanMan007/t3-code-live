#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
cd "$repo_root"

expected_origin="https://github.com/StanMan007/t3-code-live.git"
expected_upstream="https://github.com/pingdotgg/t3code.git"
install_dependencies=false

case "${1:-}" in
  "")
    ;;
  --install)
    install_dependencies=true
    ;;
  *)
    echo "usage: $0 [--install]" >&2
    exit 64
    ;;
esac

if [[ "$(git rev-parse --show-toplevel)" != "$repo_root" ]]; then
  echo "refusing setup: $repo_root is not the active repository root" >&2
  exit 2
fi

origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$origin_url" != "$expected_origin" ]]; then
  echo "refusing setup: origin is ${origin_url:-missing}, expected $expected_origin" >&2
  exit 3
fi

if git remote get-url upstream >/dev/null 2>&1; then
  upstream_url="$(git remote get-url upstream)"
  if [[ "$upstream_url" != "$expected_upstream" ]]; then
    echo "refusing setup: upstream is $upstream_url, expected $expected_upstream" >&2
    exit 4
  fi
else
  git remote add upstream "$expected_upstream"
fi

# Keep the canonical project read-only from this fork. All publication goes to origin.
git remote set-url --push upstream DISABLED

git fetch --prune origin main
git fetch --prune upstream main

if [[ "$install_dependencies" == true ]]; then
  command -v node >/dev/null 2>&1 || {
    echo "missing Node.js; install the version declared in package.json before retrying" >&2
    exit 5
  }
  command -v pnpm >/dev/null 2>&1 || {
    echo "missing pnpm; install the package manager declared in package.json before retrying" >&2
    exit 6
  }
  pnpm install --frozen-lockfile
fi

origin_head="$(git rev-parse --short refs/remotes/origin/main)"
upstream_head="$(git rev-parse --short refs/remotes/upstream/main)"

echo "T3 Code Live clone is configured."
echo "origin   $expected_origin ($origin_head)"
echo "upstream $expected_upstream ($upstream_head, push disabled)"
echo
echo "Sign in to GitHub, Claude, and Codex on this computer, then run pnpm run dev:desktop."
echo "Use the in-app guarded updater for upstream merges and the power control for packaged installs."
