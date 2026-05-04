#!/usr/bin/env bash
# Format all Go and TypeScript source files.
# Run from anywhere; the script cd's to the repo root itself.
#
# Usage:
#   ./scripts/format.sh          # format in place
#   ./scripts/format.sh --check  # exit non-zero if any files need formatting
set -euo pipefail

cd "$(dirname "$0")/.."

CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m>>> %s\033[0m\n' "$*"; }

if [[ $CHECK -eq 1 ]]; then
  step "Go: check formatting"
  unformatted=$(gofmt -l ./internal/ ./*.go 2>/dev/null || true)
  if [[ -n "$unformatted" ]]; then
    echo "The following Go files need formatting:" >&2
    echo "$unformatted" >&2
    exit 1
  fi

  step "TypeScript: check formatting"
  (cd web && npm run format:check)
else
  step "Go: format"
  gofmt -w ./internal/ ./*.go 2>/dev/null || true

  step "TypeScript: format"
  (cd web && npm run format)
fi

step "Done"
