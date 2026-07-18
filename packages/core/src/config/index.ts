// @code-analyzer/core — Configuration System (Stub)
// Full implementation in Iteration 0

export interface CodeAnalyzerConfig {
  version: string;
  indexing: {
    maxFileSize: number;
    parseTimeout: number;
    workerCount: number;
    allowedRoots: string[];
    excludePatterns: string[];
    indexMode: 'full' | 'moderate' | 'fast';
    incrementalEnabled: boolean;
  };
  storage: {
    cacheDir: string;
    dbPath: string;
    mmapSize: number;
    walEnabled: boolean;
  };
}

export async function loadConfig(rootPath: string): Promise<CodeAnalyzerConfig> {
  // Stub: returns default configuration
  return {
    version: '0.1.0',
    indexing: {
      maxFileSize: 10 * 1024 * 1024,
      parseTimeout: 30000,
      workerCount: 4,
      allowedRoots: [rootPath],
      excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
      indexMode: 'full',
      incrementalEnabled: true,
    },
    storage: {
      cacheDir: '.code-analyzer',
      dbPath: '.code-analyzer/graph.db',
      mmapSize: 1024 * 1024 * 1024,
      walEnabled: true,
    },
  };
}
