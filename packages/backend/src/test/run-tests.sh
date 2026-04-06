#!/usr/bin/env bash
# Roda testes de integração contra a API em execução
# Uso: ./run-tests.sh [API_URL]
set -e

API_URL=${1:-http://localhost:3000}
echo "Testando API em $API_URL"
echo ""

# Aguarda backend ficar disponível
MAX_WAIT=30
WAITED=0
until curl -sf "$API_URL/health" > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "Backend não respondeu em ${MAX_WAIT}s. Abortando."
    exit 1
  fi
  echo "Aguardando backend... ($WAITED s)"
  sleep 2
  WAITED=$((WAITED + 2))
done

echo "Backend disponível."
echo ""

# Roda os testes TypeScript via tsx
API_URL=$API_URL node --test --import tsx/esm src/test/api.test.ts
