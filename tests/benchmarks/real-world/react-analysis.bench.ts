/**
 * Real-World Benchmark: React Source Code Analysis
 *
 * Benchmarks the code-analyzer's JavaScript/TypeScript parsing against the
 * facebook/react repository. Uses language providers directly for stability.
 *
 * Prerequisites:
 *   git clone --depth 1 --single-branch --branch main https://github.com/facebook/react.git /tmp/react-src
 *
 * Usage:
 *   pnpm vitest run tests/benchmarks/real-world/__tests__/react-analysis.test.ts
 */

// The benchmark logic lives in the test file which is the canonical source.
// This file serves as documentation and can be used as a standalone entry point
// for running the benchmark via vitest.

export { default } from './__tests__/react-analysis.test.js';
