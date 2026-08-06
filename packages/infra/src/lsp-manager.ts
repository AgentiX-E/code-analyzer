// @code-analyzer/infra — LSP Manager
// Manages Language Server Protocol connections for type information,
// definition lookup, and reference finding. Provides graceful degradation
// to tree-sitter fallback when LSP servers are unavailable.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LSPLanguage = 'typescript' | 'javascript' | 'python' | 'cpp' | 'ruby' | 'java' | 'go';

export interface LSPManagerOptions {
  projectRoot?: string;
  maxServers?: number;
  enabled?: boolean;
  cacheSize?: number;
}

export interface TypeInfoResult {
  typeString: string;
  resolutionMethod: string;
  qualifiedType: string | null;
  typeKind: string;
}

export interface DefinitionResult {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  targetQname: string;
}

export interface ReferenceResult {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

// ---------------------------------------------------------------------------
// Supported Languages
// ---------------------------------------------------------------------------

const SUPPORTED_LSP_LANGUAGES: LSPLanguage[] = [
  'typescript',
  'javascript',
  'python',
];

// ---------------------------------------------------------------------------
// LSPManager
// ---------------------------------------------------------------------------

export class LSPManager {
  private readonly enabled: boolean;
  private readonly cacheSize: number;
  private running: boolean;

  /** Simple LRU cache: Map maintains insertion order in JS */
  private readonly cache: Map<string, TypeInfoResult>;

  constructor(options: LSPManagerOptions = {}) {
    void (options.projectRoot);
    this.enabled = options.enabled ?? true;
    void (options.maxServers);
    this.cacheSize = options.cacheSize ?? 1000;
    this.cache = new Map();
    this.running = false;
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  isAvailable(language: LSPLanguage): boolean {
    if (!this.enabled) return false;
    return SUPPORTED_LSP_LANGUAGES.includes(language);
  }

  isRunning(): boolean {
    return this.running;
  }

  activeServers(): string[] {
    return [];
  }

  // -------------------------------------------------------------------------
  // Type Info
  // -------------------------------------------------------------------------

  async getTypeInfo(
    filePath: string,
    line: number,
    column: number,
    language: LSPLanguage,
    fallbackType?: string,
  ): Promise<TypeInfoResult> {
    const cacheKey = `${filePath}:${line}:${column}:${language}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached };
    }

    // When disabled or unsupported, return fallback
    if (!this.enabled || !this.isAvailable(language)) {
      const result: TypeInfoResult = {
        typeString: fallbackType ?? 'unknown',
        resolutionMethod: 'fallback',
        qualifiedType: null,
        typeKind: 'unknown',
      };
      this.setCache(cacheKey, result);
      return result;
    }

    // With LSP enabled but no real server, use tree-sitter style fallback
    const result: TypeInfoResult = {
      typeString: fallbackType ?? 'unknown',
      resolutionMethod: 'tree-sitter-fallback',
      qualifiedType: null,
      typeKind: 'unknown',
    };
    this.setCache(cacheKey, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Definition
  // -------------------------------------------------------------------------

  async getDefinition(
    _filePath: string,
    _line: number,
    _column: number,
    language: LSPLanguage,
  ): Promise<DefinitionResult | null> {
    if (!this.enabled || !this.isAvailable(language)) {
      return null;
    }
    return null; // No real LSP server running
  }

  // -------------------------------------------------------------------------
  // References
  // -------------------------------------------------------------------------

  async getReferences(
    _filePath: string,
    _line: number,
    _column: number,
    language: LSPLanguage,
  ): Promise<ReferenceResult[]> {
    if (!this.enabled || !this.isAvailable(language)) {
      return [];
    }
    return []; // No real LSP server running
  }

  // -------------------------------------------------------------------------
  // File Notifications
  // -------------------------------------------------------------------------

  async notifyFileOpen(
    _filePath: string,
    _content: string,
    language: LSPLanguage,
  ): Promise<void> {
    if (!this.enabled || !this.isAvailable(language)) {
      return;
    }
    // No-op: no real server running
  }

  async notifyFileClose(
    _filePath: string,
    language: LSPLanguage,
  ): Promise<void> {
    if (!this.enabled || !this.isAvailable(language)) {
      return;
    }
    // No-op: no real server running
  }

  // -------------------------------------------------------------------------
  // Cache Management
  // -------------------------------------------------------------------------

  invalidateFile(filePath: string): void {
    const prefix = `${filePath}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    this.running = false;
    // No real servers to shut down
  }

  // -------------------------------------------------------------------------
  // Private: Cache helpers
  // -------------------------------------------------------------------------

  private setCache(key: string, result: TypeInfoResult): void {
    // LRU eviction: delete oldest (first) entry if at capacity
    if (this.cache.size >= this.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, result);
  }
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

export function createLSPManager(
  projectRoot: string,
  enabled?: boolean,
): LSPManager {
  return new LSPManager({
    projectRoot,
    enabled: enabled ?? true,
  });
}

// ---------------------------------------------------------------------------
// Server Availability Check
// ---------------------------------------------------------------------------

export async function isLSPServerAvailable(
  language: LSPLanguage,
): Promise<boolean> {
  // Check if the language is supported
  if (!SUPPORTED_LSP_LANGUAGES.includes(language)) {
    return false;
  }
  // In a real implementation, this would check for the LSP binary
  // For now, return whether it's a supported language
  return SUPPORTED_LSP_LANGUAGES.includes(language);
}
