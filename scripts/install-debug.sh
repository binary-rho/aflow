#!/usr/bin/env bash
# pnpm install이 멈출 때 어디서 멈추는지 확인용

set -e
cd "$(dirname "$0")/.."

echo "=== 1) 스크립트 없이 설치 (여기서 멈추면 링크/디스크 문제) ==="
pnpm install --ignore-scripts

echo "=== 2) 완료 ==="
