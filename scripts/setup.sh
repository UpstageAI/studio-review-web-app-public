#!/bin/bash
# 로컬 개발 환경을 한 번에 띄운다: Postgres 컨테이너 → 의존성 설치 → 마이그레이션 → 개발 서버.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "🐳 Postgres 컨테이너를 시작합니다..."
docker compose up -d --wait postgres

cd next

if [ ! -f .env ]; then
  echo "📝 .env 가 없어 .env.example 을 복사합니다."
  cp .env.example .env
fi

echo "📦 의존성을 설치합니다..."
pnpm install

echo "🗄️  마이그레이션을 적용합니다..."
pnpm migrate

echo "🚀 개발 서버를 시작합니다..."
pnpm dev
