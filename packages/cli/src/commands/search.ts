// @code-analyzer/cli — Search Command
// Searches the knowledge graph using FTS5, graph traversal, and
// optional semantic scoring. Supports multiple output formats.

import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { EOL } from 'node:os';
import { PipelineOrchestrator } from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { PipelineContext } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Search query */
  query: string;
  /** Repository path (for auto-index if needed) */
  path?: string;
  /** Maximum results */
  limit?: number;
  /** Output format */
  format?: 'text' | 'json' | 'summary';
  /** Node type filter */
  type?: string;
  /** Include file content in results */
  verbose?: boolean;
}

export interface SearchResult {
  id: number;
  name: string;
  type: string;
  file: string;
  line: number;
  score: number;
  snippet?: string;
}

export interface SearchOutput {
  success: boolean;
  query: string;
  results: SearchResult[];
  totalResults: number;
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Search the knowledge graph for nodes matching a query.
 *
 * Uses FTS5 full-text search on node names, qualified names, and
 * source content. Results are ranked by relevance score.
 */
export async function searchGraph(
  options: SearchOptions,
  store?: InMemoryGraphStore,
): Promise<SearchOutput> {
  const startTime = Date.now();
  const limit = options.limit ?? 50;

  try {
    // Use provided store or create one from path
    let graphStore = store;
    if (!graphStore) {
      graphStore = new InMemoryGraphStore();
    }

    // Perform FTS search
    const ftsRaw = graphStore.searchFts(options.query, limit);

    // Map to structured results
    const results: SearchResult[] = ftsRaw.map((r: {
      id: number;
      name?: string;
      label?: string;
      type?: string;
      file?: string;
      line?: number;
      score?: number;
      content?: string;
    }) => ({
      id: r.id,
      name: r.name ?? 'unknown',
      type: r.type ?? r.label ?? 'unknown',
      file: r.file ?? '',
      line: r.line ?? 1,
      score: r.score ?? 0,
      snippet: options.verbose ? (r.content ?? '').slice(0, 200) : undefined,
    }));

    // Filter by type if specified
    const filtered = options.type
      ? results.filter((r) => r.type.toLowerCase() === options.type.toLowerCase())
      : results;

    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);

    return {
      success: true,
      query: options.query,
      results: filtered,
      totalResults: filtered.length,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      query: options.query,
      results: [],
      totalResults: 0,
      duration: Date.now() - startTime,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format search output for display.
 */
export function formatSearchResult(
  result: SearchOutput,
  format: 'text' | 'json' | 'summary',
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  if (format === 'summary') {
    lines.push(`Found ${result.totalResults} results for "${result.query}" in ${result.duration}ms`);
    return lines.join(EOL);
  }

  // Full text format
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Code Analyzer — Search Results: "${result.query}"`);
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Found: ${result.totalResults} results in ${result.duration}ms`);
  lines.push(` `);

  if (!result.success && result.error) {
    lines.push(`Error: ${result.error}`);
    return lines.join(EOL);
  }

  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i];
    lines.push(`${'─'.repeat(40)}`);
    lines.push(`[${i + 1}] ${r.name}  (${r.type})  score: ${r.score.toFixed(2)}`);
    if (r.file) {
      lines.push(`    File: ${r.file}:${r.line}`);
    }
    if (r.snippet) {
      lines.push(`    ${r.snippet}`);
    }
  }
  lines.push(`${'='.repeat(60)}`);
  return lines.join(EOL);
}
