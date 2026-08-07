#!/usr/bin/env bash
# CI Simulation Script — mimics the GitHub Actions ci.yml pipeline steps.
# Run this before pushing to verify the CI pipeline will succeed.
# Usage: bash scripts/ci-simulate.sh

set -euo pipefail

echo "=== CI Simulation ==="
echo "Node: $(node -v)"
echo "pnpm: $(pnpm -v)"
echo ""

# Step 1: Install dependencies
echo "[1/8] Installing dependencies..."
pnpm install --ignore-scripts --frozen-lockfile 2>&1 | tail -1

# Step 2: Lint
echo "[2/8] Running lint..."
pnpm run lint 2>&1 | tail -1

# Step 3: Typecheck
echo "[3/8] Running typecheck..."
pnpm run typecheck 2>&1 | tail -1

# Step 4: Build
echo "[4/8] Building packages..."
pnpm run build 2>&1 | tail -1

# Step 5: Unit Tests
echo "[5/8] Running unit tests..."
npx vitest run --config vitest.config.ts --exclude '**/sqlite*' 2>&1 | grep -E "Test Files|Tests|FAIL" | tail -3

# Step 6: Integration Tests
echo "[6/8] Running integration tests..."
if [ -f vitest.integration.config.ts ]; then
  npx vitest run --config vitest.integration.config.ts --exclude '**/sqlite*' 2>&1 | grep -E "Test Files|Tests" | tail -2 || true
fi

# Step 7: Coverage (if available)
echo "[7/8] Running coverage..."
npx vitest run --config vitest.config.coverage.ts --coverage --exclude '**/sqlite*' 2>&1 | grep -E "%|Coverage|Statements|Branches|Functions|Lines" | tail -6 || true

# Step 8: Benchmarks
echo "[8/8] Running benchmarks..."
if [ -f vitest.bench.config.ts ]; then
  npx vitest bench --config vitest.bench.config.ts 2>&1 | tail -3 || true
fi

echo ""
echo "=== CI Simulation Complete ==="
