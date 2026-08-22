// @code-analyzer/analyzer — Unified Parser
// Centralized language-aware code parser with optional fingerprint-based caching.

import type { LanguageProvider } from '../languages/provider.js';
import type { WorkerPool } from '@code-analyzer/infra';
import type { DiscoveredFile, UnifiedCapture } from '@code-analyzer/shared';
import { ParseCache } from './parse-cache.js';
import type { ParseCacheStats } from './parse-cache.js';

// ---------------------------------------------------------------------------
// Parser Options
// ---------------------------------------------------------------------------

export interface UnifiedParserOptions {
  /** Enable parse cache (default: true). Set to false for one-shot analysis. */
  cache?: boolean;
  /** Maximum cache entries (default: 10000) */
  cacheCapacity?: number;
}

// ---------------------------------------------------------------------------
// UnifiedParser
// ---------------------------------------------------------------------------

export class UnifiedParser {
  private readonly providers: Map<string, LanguageProvider>;
  private readonly cache: ParseCache | null;

  constructor(providers: LanguageProvider[], options: UnifiedParserOptions = {}) {
    const { cache: enableCache = true, cacheCapacity = 10000 } = options;

    this.providers = new Map();
    for (const provider of providers) {
      this.providers.set(provider.language, provider);
    }

    this.cache = enableCache ? new ParseCache(cacheCapacity) : null;
  }

  /** Parse a single file. Uses cache when enabled. */
  parseFile(file: DiscoveredFile): UnifiedCapture[] {
    // Check cache first
    if (this.cache) {
      const cached = this.cache.get(file.filePath, file.content);
      if (cached) return cached;
    }

    const provider = this.getProviderByExtension(file.filePath);
    if (!provider) {
      return [];
    }

    const captures = provider.parse(file.content, file.filePath);

    // Store in cache
    if (this.cache) {
      this.cache.set(file.filePath, file.content, captures);
    }

    return captures;
  }

  /** Parse files in parallel using worker pool. Uses cache when enabled. */
  async parseFiles(
    files: DiscoveredFile[],
    pool: WorkerPool,
  ): Promise<Map<string, UnifiedCapture[]>> {
    const results = new Map<string, UnifiedCapture[]>();
    const cachedPaths: string[] = [];

    // Check cache for all files first
    const uncachedFiles: DiscoveredFile[] = [];
    if (this.cache) {
      for (const file of files) {
        const cached = this.cache.get(file.filePath, file.content);
        if (cached) {
          results.set(file.filePath, cached);
          cachedPaths.push(file.filePath);
        } else {
          uncachedFiles.push(file);
        }
      }
    } else {
      uncachedFiles.push(...files);
    }

    // Parse uncached files in parallel
    if (uncachedFiles.length > 0) {
      const tasks = uncachedFiles.map((file) => ({
        id: `parse:${file.filePath}`,
        execute: async () => {
          return { filePath: file.filePath, captures: this.parseFile(file) };
        },
      }));

      const taskResults = await pool.executeAll(tasks);
      for (const { filePath, captures } of taskResults) {
        results.set(filePath, captures);
      }
    }

    return results;
  }

  /** Get the provider for a specific language */
  getProvider(language: string): LanguageProvider | undefined {
    return this.providers.get(language);
  }

  /** Get cache statistics, or null if cache is disabled. */
  get cacheStats(): ParseCacheStats | null {
    return this.cache?.stats ?? null;
  }

  /** Clear the parse cache. */
  clearCache(): void {
    this.cache?.clear();
  }

  /** Whether the cache is currently enabled. */
  get isCacheEnabled(): boolean {
    return this.cache !== null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Get provider by file extension */
  private getProviderByExtension(filePath: string): LanguageProvider | undefined {
    const lowerPath = filePath.toLowerCase();

    for (const [, provider] of this.providers) {
      for (const ext of provider.extensions) {
        if (lowerPath.endsWith(ext)) {
          return provider;
        }
      }
    }

    return undefined;
  }
}
