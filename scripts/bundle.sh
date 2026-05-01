#!/usr/bin/env bash
# Build the full app: frontend bundle, all tests, and the embedded Go
# binary. Run from anywhere; the script cd's to the repo root itself.
#
# Usage:
#   ./scripts/bundle.sh              # full pipeline
#   ./scripts/bundle.sh --skip-tests # skip test suites (faster local rebuild)
set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m>>> %s\033[0m\n' "$*"; }

step "Frontend: install dependencies"
(cd web && npm ci)

if [[ $SKIP_TESTS -eq 0 ]]; then
  step "Frontend: typecheck"
  (cd web && npm run typecheck)

  step "Frontend: tests"
  (cd web && npm test)
fi

step "Frontend: production build"
(cd web && npm run build)

if [[ $SKIP_TESTS -eq 0 ]]; then
  step "Backend: tests"
  go test ./...
fi

step "Backend: build static binary"
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o rom-manager ./

step "Done"
ls -lh rom-manager
