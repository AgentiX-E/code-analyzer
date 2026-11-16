#!/usr/bin/env bash
# CI Simulation Script — mimics the GitHub Actions ci.yml pipeline steps.
# Run this before pushing to verify the CI pipeline will succeed.
# Usage: bash scripts/ci-simulate.sh
#
# **The two steps that made this script a liar are now in it.**
#
# On 2026-11-16 four consecutive commits (`0765125`, `1fa3444`, `1e67507`, `1ecda9a`) were pushed after this script
# printed `CI Simulation Complete`, and the `Lint & Format` and `Type Check` jobs failed on all four. The reasons were
# exactly the two gates this script did not run:
#
#   - **`format:check`**, because step 2 ran `turbo lint` — eslint, which does not care about Prettier — and ci.yml's
#     lint job runs `pnpm format:check` at line 73. Twenty-five files were unformatted the whole time;
#   - **the test-tree ratchet**, because step 3 ran `pnpm typecheck` over the packages, and ci.yml's type job also
#     compiles the test tree and judges it file by file. A declaration file had drifted seven sections behind the module
#     beside it, so five tests imported names the checker could not see.
#
# **A simulation that does not run a gate is worse than no simulation**, because it converts "I ran the checks" into a
# false statement. Everything below is a command ci.yml runs, in the order ci.yml runs it.

set -euo pipefail

echo "=== CI Simulation ==="
echo "Node: $(node -v)"
echo "pnpm: $(pnpm -v)"
echo ""

# Step 1: Install dependencies
echo "[1/13] Installing dependencies..."
pnpm install --ignore-scripts --frozen-lockfile 2>&1 | tail -1

# Step 2: Lint (eslint, through turbo)
echo "[2/13] Running lint..."
pnpm run lint 2>&1 | tail -1

# Step 3: Format — **ci.yml's `Lint & Format` job runs this and nothing else in that job**
echo "[3/13] Checking formatting..."
pnpm format:check 2>&1 | tail -1

# Step 4: Typecheck the packages
echo "[4/13] Running typecheck..."
pnpm run typecheck 2>&1 | tail -1

# Step 5: Typecheck the test tree, judged per file against its baseline
echo "[5/13] Ratcheting the test tree's type errors..."
pnpm typecheck:tests > /tmp/ci-simulate-typecheck-tests.log 2>&1 || true
node scripts/typecheck-per-file.js --log /tmp/ci-simulate-typecheck-tests.log 2>&1 | tail -2

# Step 6: The repository's own gates, which the workflows run and this script did not
echo "[6/13] Running the wiring, docs and action gates..."
pnpm gate:wiring 2>&1 | tail -1
pnpm lint:ratchet 2>&1 | tail -1
pnpm docs:numbers 2>&1 | tail -1
pnpm docs:code-sync 2>&1 | tail -1
pnpm gate:actions 2>&1 | tail -1
pnpm gate:permissions 2>&1 | tail -1

# Step 7: Build
echo "[7/13] Building packages..."
pnpm run build 2>&1 | tail -1

# Step 8: Unit Tests
echo "[8/13] Running unit tests..."
npx vitest run --config vitest.config.ts --exclude '**/sqlite*' 2>&1 | grep -E "Test Files|Tests|FAIL" | tail -3

# Step 9: Integration Tests
echo "[9/13] Running integration tests..."
if [ -f vitest.integration.config.ts ]; then
  npx vitest run --config vitest.integration.config.ts --exclude '**/sqlite*' 2>&1 | grep -E "Test Files|Tests" | tail -2 || true
fi

# Step 10: Coverage (if available)
echo "[10/13] Running coverage..."
npx vitest run --config vitest.config.coverage.ts --coverage --exclude '**/sqlite*' 2>&1 | grep -E "%|Coverage|Statements|Branches|Functions|Lines" | tail -6 || true

# Step 11: Benchmarks
echo "[11/13] Running benchmarks..."
if [ -f vitest.bench.config.ts ]; then
  npx vitest bench --config vitest.bench.config.ts 2>&1 | tail -3 || true
fi

# Step 12: The workflow-level gates that read the tree rather than run a package
echo "[12/13] Checking node version and corpus provenance..."
pnpm gate:node-version 2>&1 | tail -1
pnpm gate:corpus 2>&1 | tail -1

# Step 13: The scripts' own self-tests, which is where an instrument bug is caught before a dispatch pays for it
echo "[13/13] Running the scripts' self-tests..."
node .github/scripts/aacr-ablation-compare.mjs --self-test 2>&1 | tail -1

echo ""
echo "=== CI Simulation Complete ==="
