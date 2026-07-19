// @code-analyzer/analyzer — Unified Parser

import type { LanguageProvider } from '../languages/provider.js';
import type { WorkerPool } from '@code-analyzer/infra';
import type { DiscoveredFile, UnifiedCapture } from '@code-analyzer/shared';

export class UnifiedParser {
  private readonly providers: Map<string, LanguageProvider>;

  constructor(providers: LanguageProvider[]) {
    this.providers = new Map();
    for (const provider of providers) {
      this.providers.set(provider.language, provider);
    }
  }

  /** Parse a single file */
  parseFile(file: DiscoveredFile): UnifiedCapture[] {
    const provider = this.getProviderByExtension(file.filePath);
    if (!provider) {
      return [];
    }
    return provider.parse(file.content, file.filePath);
  }

  /** Parse files in parallel using worker pool */
  async parseFiles(files: DiscoveredFile[], pool: WorkerPool): Promise<Map<string, UnifiedCapture[]>> {
    const results = new Map<string, UnifiedCapture[]>();

    const tasks = files.map((file) => ({
      id: `parse:${file.filePath}`,
      execute: async () => {
        return { filePath: file.filePath, captures: this.parseFile(file) };
      },
    }));

    const taskResults = await pool.executeAll(tasks);
    for (const { filePath, captures } of taskResults) {
      results.set(filePath, captures);
    }

    return results;
  }

  /** Get the provider for a specific language */
  getProvider(language: string): LanguageProvider | undefined {
    return this.providers.get(language);
  }

  /** Get provider by file extension */
  private getProviderByExtension(filePath: string): LanguageProvider | undefined {
    const lowerPath = filePath.toLowerCase();

    // Check each provider's extensions
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
