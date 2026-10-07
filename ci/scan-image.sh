#!/bin/sh
set -eu
IMAGE=${1:-ue03-telemetry:local}
OUT=${2:-artifacts/ci}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
docker save "$IMAGE" -o "$OUT/image.tar"
# Aucun socket Docker exposé au scanner : seule l'archive de l'image est montée.
docker run --rm -v "$OUT:/scan" -v ue03-trivy-cache:/root/.cache/trivy \
  aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 \
  image --input /scan/image.tar --scanners vuln --severity CRITICAL --exit-code 1 \
  --format json --output /scan/trivy.json
