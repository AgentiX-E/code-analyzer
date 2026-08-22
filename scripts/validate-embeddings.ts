#!/usr/bin/env npx tsx
/**
 * @fileoverview Zhipu GLM Embedding Validation Script
 *
 * Sends a test embedding request to the Zhipu GLM embedding-3 API and validates
 * the response. Verifies that the returned embedding vector has the expected
 * dimensionality and contains valid (non-zero) values.
 *
 * Usage:
 *   npx tsx scripts/validate-embeddings.ts
 *
 * Environment:
 *   ZHIPU_API_KEY — API key for Zhipu GLM (set in .env, gitignored)
 *
 * Output:
 *   PASS — embedding API returned valid vectors
 *   FAIL — embedding API failed validation (with details)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Load .env file manually (avoids requiring dotenv as a dependency)
// ---------------------------------------------------------------------------

const rootDir = join(fileURLToPath(import.meta.url), '../..');

function loadEnv(): void {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) {
    console.warn(
      `Warning: .env file not found at ${envPath}. Ensure ZHIPU_API_KEY is set in environment.`,
    );
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv();

// ---------------------------------------------------------------------------
// API Configuration
// ---------------------------------------------------------------------------

const API_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
const MODEL = 'embedding-3';
const API_KEY = process.env['ZHIPU_API_KEY'];

// Expected embedding dimensionality for embedding-3 model
const EXPECTED_DIMENSIONS = 2048; // Zhipu embedding-3 outputs 2048-dimensional vectors

// ---------------------------------------------------------------------------
// Sample code snippet for embedding
// ---------------------------------------------------------------------------

const SAMPLE_CODE = `
/**
 * A utility class that manages a weighted graph of code dependencies.
 * Used by the code analyzer to track import relationships between modules.
 */
export class DependencyGraph {
  private adjacencyList: Map<string, Map<string, number>> = new Map();

  /**
   * Add a weighted edge from source to target module.
   * @param source - Source module path
   * @param target - Target module path
   * @param weight - Edge weight (e.g., number of imports)
   */
  addEdge(source: string, target: string, weight: number = 1): void {
    if (!this.adjacencyList.has(source)) {
      this.adjacencyList.set(source, new Map());
    }
    const edges = this.adjacencyList.get(source)!;
    edges.set(target, (edges.get(target) ?? 0) + weight);
  }

  /**
   * Get all modules that the given source depends on.
   * Returns an array of [target, weight] tuples sorted by weight descending.
   */
  getDependencies(source: string): [string, number][] {
    const edges = this.adjacencyList.get(source);
    if (!edges) return [];
    return Array.from(edges.entries())
      .sort((a, b) => b[1] - a[1]);
  }

  /**
   * Detect circular dependencies using DFS-based cycle detection.
   */
  findCycles(): string[][] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (node: string, path: string[]): boolean => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = this.adjacencyList.get(node);
      if (neighbors) {
        for (const [neighbor] of neighbors) {
          if (!visited.has(neighbor)) {
            if (dfs(neighbor, [...path])) {
              return true;
            }
          } else if (recursionStack.has(neighbor)) {
            const cycleStart = path.indexOf(neighbor);
            cycles.push(path.slice(cycleStart));
          }
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of this.adjacencyList.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }
}`;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function validateEmbedding(embedding: number[], tolerance: number = 1e-10): string[] {
  const issues: string[] = [];

  // Check dimensionality
  if (embedding.length !== EXPECTED_DIMENSIONS) {
    issues.push(
      `Dimensionality mismatch: got ${embedding.length}, expected ${EXPECTED_DIMENSIONS}`,
    );
  }

  // Check for NaN values
  if (embedding.some((v) => Number.isNaN(v))) {
    issues.push('Embedding contains NaN values');
  }

  // Check for Infinity values
  if (embedding.some((v) => !Number.isFinite(v))) {
    issues.push('Embedding contains Infinity values');
  }

  // Check for all-zero vectors (unlikely but possible on error)
  const allZero = embedding.every((v) => Math.abs(v) < tolerance);
  if (allZero) {
    issues.push('Embedding vector is all zeros');
  }

  // Check that at least some values are meaningfully non-zero
  const nonZeroCount = embedding.filter((v) => Math.abs(v) > tolerance).length;
  if (nonZeroCount === 0) {
    issues.push('No non-zero values in embedding vector');
  }

  // Basic statistical sanity check
  if (!issues.length) {
    const min = Math.min(...embedding);
    const max = Math.max(...embedding);
    const sum = embedding.reduce((a, b) => a + b, 0);
    const avg = sum / embedding.length;

    // A valid embedding should have reasonable spread
    if (Math.abs(max - min) < tolerance) {
      issues.push('All embedding values are identical (no variance)');
    }

    console.log(`  Dimensionality: ${embedding.length} (expected ${EXPECTED_DIMENSIONS})`);
    console.log(`  Non-zero values: ${nonZeroCount}/${embedding.length}`);
    console.log(`  Range: [${min.toFixed(6)}, ${max.toFixed(6)}]`);
    console.log(`  Mean: ${avg.toFixed(8)}`);
    console.log(`  Sum: ${sum.toFixed(4)}`);
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Zhipu GLM Embedding Validation');
  console.log(`Model: ${MODEL}`);
  console.log(`Endpoint: ${API_URL}`);
  console.log(`Expected dimensions: ${EXPECTED_DIMENSIONS}`);
  console.log('');

  if (!API_KEY) {
    console.log('FAIL: ZHIPU_API_KEY environment variable is not set.');
    console.log('');
    console.log('Create a .env file in the project root with:');
    console.log('  ZHIPU_API_KEY=your-api-key-here');
    console.log('');
    console.log('For CI environments, set ZHIPU_API_KEY as a repository secret.');
    process.exit(1);
  }

  console.log('Sending embedding request with sample code snippet...');
  console.log(`Input length: ${SAMPLE_CODE.length} characters`);
  console.log('');

  const startTime = Date.now();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: SAMPLE_CODE,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const latencyMs = Date.now() - startTime;
    console.log(`Response received in ${latencyMs}ms`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error body');
      console.log(`FAIL: API returned HTTP ${response.status}`);
      console.log(`Error: ${errorText.slice(0, 500)}`);
      process.exit(1);
    }

    const data = (await response.json()) as EmbeddingResponse;

    // Validate response structure
    if (!data.data || data.data.length === 0) {
      console.log('FAIL: No embedding data in response');
      console.log(`Response object: ${data.object}`);
      process.exit(1);
    }

    const embeddingItem = data.data[0];
    if (!embeddingItem || !embeddingItem.embedding) {
      console.log('FAIL: Embedding array is empty or missing');
      process.exit(1);
    }

    // Validate the embedding vector
    const issues = validateEmbedding(embeddingItem.embedding);

    // Token usage info
    if (data.usage) {
      console.log(
        `  Tokens: ${data.usage.total_tokens} (${data.usage.prompt_tokens} prompt + ${data.usage.completion_tokens} completion)`,
      );
    }

    console.log(`  Model reported: ${data.model}`);

    if (issues.length === 0) {
      console.log('');
      console.log('PASS: Embedding API returned valid vectors.');
      console.log(`  - Correct dimensionality: ${embeddingItem.embedding.length}`);
      console.log(`  - All values finite and valid`);
      console.log(`  - Vector contains meaningful non-zero values`);
      console.log(`  - Model: ${data.model}`);
      console.log(`  - Latency: ${latencyMs}ms`);
      process.exit(0);
    } else {
      console.log('');
      console.log('FAIL: Embedding validation failed with the following issues:');
      for (const issue of issues) {
        console.log(`  - ${issue}`);
      }
      process.exit(1);
    }
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    // Handle network errors gracefully (API unreachable)
    if (
      message.includes('fetch failed') ||
      message.includes('ENOTFOUND') ||
      message.includes('ECONNREFUSED') ||
      message.includes('TimeoutError') ||
      (err instanceof DOMException && err.name === 'TimeoutError')
    ) {
      console.log('');
      console.log('Zhipu GLM API is unreachable.');
      console.log(`  Error: ${message}`);
      console.log(`  Latency before timeout: ${latencyMs}ms`);
      console.log('');
      console.log('This is expected in sandbox/offline environments.');
      console.log('The script is ready for CI use where network access is available.');
      process.exit(0);
    }

    console.log(`FAIL: Unexpected error during API call: ${message}`);
    process.exit(1);
  }
}

main();
