#!/usr/bin/env bash
# Create a new git worktree under ../go-rom-manager.worktrees/<branch-name>.
#
# Usage:
#   ./scripts/new-worktree.sh <branch-name>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$(dirname "$REPO_ROOT")/go-rom-manager.worktrees"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <branch-name>" >&2
  exit 1
fi

BRANCH="$1"
WORKTREE_PATH="$WORKTREES_DIR/$BRANCH"

if [[ -d "$WORKTREE_PATH" ]]; then
  echo "error: worktree already exists at $WORKTREE_PATH" >&2
  exit 1
fi

mkdir -p "$WORKTREES_DIR"

# Create the worktree on a new branch (or error if the branch already exists).
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_PATH"

# Copy node_modules rather than reinstalling — much faster for large trees.
# Fall back to npm ci if the copy fails for any reason.
SRC_MODULES="$REPO_ROOT/web/node_modules"
DEST_MODULES="$WORKTREE_PATH/web/node_modules"

if [[ -d "$SRC_MODULES" ]]; then
  echo "Copying node_modules from main worktree..."
  cp -a "$SRC_MODULES" "$DEST_MODULES"
else
  echo "node_modules not found in main worktree; running npm ci..."
  npm ci --prefix "$WORKTREE_PATH/web"
fi

echo ""
echo "Worktree ready: $WORKTREE_PATH"
echo "  Branch: $BRANCH"
echo "  cd $WORKTREE_PATH"
