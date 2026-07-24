#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agented-notes — Docker build helper
# ---------------------------------------------------------------------------
# Usage:
#   ./docker-build.sh              # build with default tag
#   ./docker-build.sh mytag        # build with custom tag
#   ./docker-build.sh latest prod  # build + run (docker compose up)
# ---------------------------------------------------------------------------
set -euo pipefail

TAG="${1:-latest}"
IMAGE="agented-notes:${TAG}"

echo "==> Building ${IMAGE}..."
docker build -t "${IMAGE}" .

if [[ "${2:-}" == "prod" ]]; then
  echo "==> Starting container with docker compose..."
  docker compose up --build -d
fi

echo "==> Done. Image: ${IMAGE}"
