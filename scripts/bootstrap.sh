#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Atlas bootstrap"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "==> Downloading Go modules"
go mod download

echo "==> Building"
make build

echo "==> Running tests"
make test

echo "==> Bootstrap complete"
echo "    Run: make run"
echo "    Docker: make docker-up"
