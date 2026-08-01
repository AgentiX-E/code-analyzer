// @code-analyzer/infra — Language Server Protocol (LSP) Integration
// Provides semantic type resolution, go-to-definition, hover information,
// and reference finding by communicating with language servers.
//
// Supported language servers:
//   - TypeScript/JavaScript: typescript-language-server (wraps tsserver)
//   - Python: pyright-langserver (preferred) or jedi-language-server
//
// Architecture:
//   LSPManager (orchestrator)
//     └── LSPClient (per-language server process)
//           └── JSON-RPC 2.0 over stdio
//           └── LRU caching layer
//
// Graceful degradation: when a language server is unavailable, falls back
// to tree-sitter-only analysis with no loss of basic functionality.

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** LSP-related type information for a symbol at a position. */
export interface LSPTypeInfo {
  /** The resolved type string (e.g., "User | null", "Optional[str]"). */
  typeString: string;
  /** The fully-qualified name of the type if resolvable. */
  qualifiedType: string | null;
  /** Type kind: class, interface, type-alias, enum, function, primitive, etc. */
  typeKind: string;
  /** Documentation string from the type definition (hover info). */
  documentation: string | null;
  /** Whether this type was resolved through LSP or is a tree-sitter fallback. */
  resolutionMethod: 'lsp' | 'tree-sitter' | 'fallback';
}

/** Result of a go-to-definition request. */
export interface LSPDefinition {
  /** URI of the definition file. */
  uri: string;
  /** File path of the definition. */
  filePath: string;
  /** Start position (0-based). */
  startLine: number;
  startCharacter: number;
  /** End position (0-based). */
  endLine: number;
  endCharacter: number;
  /** Name of the defined symbol. */
  symbolName: string | null;
}

/** Result of a references search. */
export interface LSPReference {
  /** URI of the referencing file. */
  uri: string;
  /** File path of the reference. */
  filePath: string;
  /** Position range (0-based). */
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** Supported language server types. */
export type LSPServerType = 'typescript' | 'python' | 'go' | 'rust' | 'java';

/** Configuration for a language server process. */
export interface LSPServerConfig {
  /** The command to launch the server. */
  command: string;
  /** Arguments passed to the command. */
  args: string[];
  /** Root URI sent in the initialize request. */
  rootUri: string;
  /** Initialization options sent to the server. */
  initializationOptions?: Record<string, unknown>;
  /** Environment variables for the server process. */
  env?: Record<string, string>;
}

/** Configuration for the LSP manager. */
export interface LSPManagerConfig {
  /** Root directory of the project. */
  projectRoot: string;
  /** Maximum number of concurrent language server processes. */
  maxServers: number;
  /** Timeout for server initialization (milliseconds). */
  initTimeout: number;
  /** Timeout for individual requests (milliseconds). */
  requestTimeout: number;
  /** Maximum number of cached results per server. */
  cacheSize: number;
  /** Whether to enable LSP features (set to false for tree-sitter-only). */
  enabled: boolean;
}

/** Supported languages with LSP integration. */
export type LSPLanguage = 'typescript' | 'javascript' | 'typescriptreact' | 'javascriptreact' | 'python';

// ---------------------------------------------------------------------------
// Default Language Server Configurations
// ---------------------------------------------------------------------------

const LANGUAGE_TO_SERVER_TYPE: Record<LSPLanguage, LSPServerType> = {
  typescript: 'typescript',
  javascript: 'typescript',
  typescriptreact: 'typescript',
  javascriptreact: 'typescript',
  python: 'python',
};

const DEFAULT_SERVER_COMMANDS: Record<LSPServerType, LSPServerConfig['command']> = {
  typescript: 'typescript-language-server',
  python: 'pyright-langserver',
  go: 'gopls',
  rust: 'rust-analyzer',
  java: 'jdtls',
};

const DEFAULT_SERVER_ARGS: Record<LSPServerType, string[]> = {
  typescript: ['--stdio'],
  python: ['--stdio'],
  go: ['serve'],
  rust: [],
  java: [],
};

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 Helpers
// ---------------------------------------------------------------------------

interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function createRequest(id: number, method: string, params?: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', id, method, params };
}

function createNotification(method: string, params?: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', method, params };
}

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Delete least recently used (first entry)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, value);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// LSP Client — Manages a single language server process
// ---------------------------------------------------------------------------

class LSPClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private initialized = false;
  private readonly config: LSPServerConfig;
  private readonly serverType: LSPServerType;
  private readonly cache: LRUCache<string, unknown>;
  private shutdown = false;

  constructor(serverType: LSPServerType, projectRoot: string, cacheSize: number) {
    this.serverType = serverType;
    this.cache = new LRUCache(cacheSize);
    this.config = {
      command: DEFAULT_SERVER_COMMANDS[serverType],
      args: DEFAULT_SERVER_ARGS[serverType],
      rootUri: `file://${projectRoot}`,
      initializationOptions: {},
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.process) return;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.config.command, this.config.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...this.config.env },
        });
      } catch (error) {
        reject(new Error(`Failed to start ${this.serverType} language server: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }

      let startupError = '';

      this.process.stderr?.on('data', (data: Buffer) => {
        startupError += data.toString();
      });

      this.process.on('error', (err) => {
        reject(new Error(`LSP process error (${this.serverType}): ${err.message}`));
      });

      this.process.on('exit', (code) => {
        if (!this.shutdown && code !== 0) {
          // Process exited unexpectedly
        }
      });

      const rl = createInterface({ input: this.process.stdout! });
      rl.on('line', (line: string) => {
        this.handleMessage(line);
      });

      // Send initialize request
      this.sendRequest('initialize', {
        processId: process.pid,
        rootUri: this.config.rootUri,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            references: {},
            typeDefinition: { linkSupport: true },
          },
        },
        initializationOptions: this.config.initializationOptions,
      }).then(() => {
        // Send initialized notification
        this.sendNotification('initialized', {});
        this.initialized = true;
        resolve();
      }).catch(reject);
    });
  }

  async stop(): Promise<void> {
    this.shutdown = true;
    try {
      this.sendNotification('shutdown', {});
      this.sendNotification('exit', {});
    } catch {
      // Best effort shutdown
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
    this.cache.clear();
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.initialized;
  }

  // ---------------------------------------------------------------------------
  // LSP Methods
  // ---------------------------------------------------------------------------

  async getTypeInfo(
    filePath: string,
    line: number,
    character: number,
  ): Promise<LSPTypeInfo | null> {
    const uri = `file://${filePath}`;
    const cacheKey = `hover:${filePath}:${line}:${character}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as LSPTypeInfo | null;

    try {
      const result = await this.sendRequest('textDocument/hover', {
        textDocument: { uri },
        position: { line, character },
      }) as { contents?: unknown } | null;

      if (!result?.contents) {
        this.cache.set(cacheKey, null);
        return null;
      }

      const content = this.extractHoverContent(result.contents);
      const typeInfo: LSPTypeInfo = {
        typeString: this.extractTypeString(content),
        qualifiedType: this.extractQualifiedType(content),
        typeKind: this.inferTypeKind(content),
        documentation: content.length > 100 ? content : null,
        resolutionMethod: 'lsp',
      };

      this.cache.set(cacheKey, typeInfo);
      return typeInfo;
    } catch {
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  async getDefinition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<LSPDefinition | null> {
    const uri = `file://${filePath}`;
    const cacheKey = `def:${filePath}:${line}:${character}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as LSPDefinition | null;

    try {
      const result = await this.sendRequest('textDocument/definition', {
        textDocument: { uri },
        position: { line, character },
      }) as LSPDefinition | LSPDefinition[] | null;

      if (!result) {
        this.cache.set(cacheKey, null);
        return null;
      }

      const def = Array.isArray(result) ? result[0] : result;
      if (!def) {
        this.cache.set(cacheKey, null);
        return null;
      }

      const definition: LSPDefinition = {
        uri: def.uri,
        filePath: this.uriToPath(def.uri),
        startLine: def.startLine,
        startCharacter: def.startCharacter,
        endLine: def.endLine,
        endCharacter: def.endCharacter,
        symbolName: null,
      };

      this.cache.set(cacheKey, definition);
      return definition;
    } catch {
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  async getReferences(
    filePath: string,
    line: number,
    character: number,
  ): Promise<LSPReference[]> {
    const uri = `file://${filePath}`;
    const cacheKey = `refs:${filePath}:${line}:${character}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as LSPReference[];

    try {
      const result = await this.sendRequest('textDocument/references', {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration: false },
      }) as LSPReference[] | null;

      const refs = (result ?? []).map((r) => ({
        ...r,
        filePath: this.uriToPath(r.uri),
      }));

      this.cache.set(cacheKey, refs);
      return refs;
    } catch {
      this.cache.set(cacheKey, []);
      return [];
    }
  }

  async didOpen(filePath: string, content: string, language: string): Promise<void> {
    if (!this.initialized) return;
    const uri = `file://${filePath}`;
    try {
      this.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: language,
          version: 1,
          text: content,
        },
      });
      // Invalidate cache for this file
      this.invalidateFileCache(filePath);
    } catch {
      // Non-critical notification
    }
  }

  async didClose(filePath: string): Promise<void> {
    if (!this.initialized) return;
    const uri = `file://${filePath}`;
    try {
      this.sendNotification('textDocument/didClose', { textDocument: { uri } });
    } catch {
      // Non-critical notification
    }
  }

  // ---------------------------------------------------------------------------
  // Cache Management
  // ---------------------------------------------------------------------------

  invalidateFileCache(filePath: string): void {
    const keysToDelete: string[] = [];
    for (const key of (this.cache as unknown as { map: Map<string, unknown> }).map.keys()) {
      if (key.includes(filePath)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  invalidateAllCache(): void {
    this.cache.clear();
  }

  // ---------------------------------------------------------------------------
  // JSON-RPC Communication
  // ---------------------------------------------------------------------------

  private sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request = createRequest(id, method, params);
      this.pending.set(id, { resolve, reject });
      this.write(request);
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const notification = createNotification(method, params);
    this.write(notification);
  }

  private write(message: JSONRPCMessage): void {
    if (!this.process?.stdin) {
      throw new Error(`LSP process (${this.serverType}) is not running`);
    }
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin.write(header + content);
  }

  private handleMessage(line: string): void {
    // LSP messages are framed with Content-Length header
    // but we receive them line-by-line. We accumulate in buffer.
    this.buffer += line + '\n';

    // Try to parse a complete message
    const headerMatch = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
    if (!headerMatch || headerMatch.index === undefined) return;

    const contentLength = parseInt(headerMatch[1], 10);
    const headerEnd = headerMatch.index + headerMatch[0].length;
    const contentStart = headerEnd;
    const contentEnd = contentStart + contentLength;

    if (this.buffer.length < contentEnd) return; // Not enough data yet

    const content = this.buffer.substring(contentStart, contentEnd);
    // Remove processed portion from buffer
    this.buffer = this.buffer.substring(contentEnd);

    try {
      const message: JSONRPCMessage = JSON.parse(content);

      // If this is a response to a pending request
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!;
        this.pending.delete(message.id);

        if (message.error) {
          pending.reject(new Error(`LSP error: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
    } catch {
      // Malformed message — ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private uriToPath(uri: string): string {
    try {
      const url = new URL(uri);
      return url.pathname;
    } catch {
      return uri.replace(/^file:\/\//, '');
    }
  }

  private extractHoverContent(contents: unknown): string {
    if (typeof contents === 'string') return contents;
    if (typeof contents === 'object' && contents !== null) {
      const c = contents as Record<string, unknown>;
      if (typeof c['value'] === 'string') return c['value'] as string;
      if (Array.isArray(c)) {
        return (c as Array<{ value?: string }>)
          .map((item) => (typeof item === 'object' && item !== null ? (item.value ?? '') : String(item)))
          .join('\n');
      }
    }
    // MarkedString or MarkupContent
    if (typeof contents === 'object' && contents !== null && 'value' in (contents as object)) {
      return String((contents as { value: unknown }).value);
    }
    return String(contents);
  }

  private extractTypeString(content: string): string {
    // Common patterns in hover content:
    // "const x: number" -> "number"
    // "(property) User.name: string" -> "string"
    // "function foo(): void" -> "void"
    const match = content.match(/:\s*([^\n(]+?)(?:\s*$|\s*\n|$)/);
    if (match) return match[1].trim();
    return content.split('\n')[0]?.trim() ?? 'unknown';
  }

  private extractQualifiedType(content: string): string | null {
    // Try to extract fully qualified type from hover markdown
    // e.g., "```typescript\nimport(\"module\").Type\n```"
    const match = content.match(/import\("([^"]+)"\)\.(\w+)/);
    if (match) return `${match[1]}.${match[2]}`;
    return null;
  }

  private inferTypeKind(content: string): string {
    const lower = content.toLowerCase();
    if (lower.includes('class')) return 'class';
    if (lower.includes('interface')) return 'interface';
    if (lower.includes('type alias')) return 'type-alias';
    if (lower.includes('enum')) return 'enum';
    if (lower.includes('function') || lower.includes('method')) return 'function';
    if (lower.includes('property')) return 'property';
    if (lower.includes('variable') || lower.includes('const') || lower.includes('let')) return 'variable';
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// LSP Manager — Orchestrates multiple language servers
// ---------------------------------------------------------------------------

export class LSPManager {
  private readonly config: LSPManagerConfig;
  private readonly clients = new Map<LSPServerType, LSPClient>();
  private readonly contentTypeCache: LRUCache<string, LSPTypeInfo | null>;

  constructor(config: Partial<LSPManagerConfig> = {}) {
    this.config = {
      projectRoot: config.projectRoot ?? process.cwd(),
      maxServers: config.maxServers ?? 3,
      initTimeout: config.initTimeout ?? 15000,
      requestTimeout: config.requestTimeout ?? 5000,
      cacheSize: config.cacheSize ?? 1000,
      enabled: config.enabled ?? true,
    };
    this.contentTypeCache = new LRUCache(this.config.cacheSize);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check if LSP is available for a given language.
   */
  isAvailable(language: LSPLanguage): boolean {
    return this.config.enabled && language in LANGUAGE_TO_SERVER_TYPE;
  }

  /**
   * Get semantic type information for a symbol at a position.
   * Falls back gracefully to tree-sitter analysis if LSP is unavailable.
   *
   * @param filePath — absolute path to the file
   * @param line — 0-based line number
   * @param character — 0-based character offset
   * @param language — the language of the file
   * @param fallbackType — the type string from tree-sitter analysis (used if LSP fails)
   */
  async getTypeInfo(
    filePath: string,
    line: number,
    character: number,
    language: LSPLanguage,
    fallbackType?: string,
  ): Promise<LSPTypeInfo> {
    if (!this.config.enabled || !this.isAvailable(language)) {
      return this.fallbackTypeInfo(fallbackType);
    }

    const serverType = LANGUAGE_TO_SERVER_TYPE[language];
    const cacheKey = this.computeCacheKey(filePath, line, character);
    const cached = this.contentTypeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const client = await this.ensureClient(serverType);
      const result = await client.getTypeInfo(filePath, line, character);

      if (result) {
        this.contentTypeCache.set(cacheKey, result);
        return result;
      }
    } catch {
      // LSP failed — use fallback
    }

    const fallback = this.fallbackTypeInfo(fallbackType);
    this.contentTypeCache.set(cacheKey, fallback);
    return fallback;
  }

  /**
   * Get the definition location for a symbol at a position.
   */
  async getDefinition(
    filePath: string,
    line: number,
    character: number,
    language: LSPLanguage,
  ): Promise<LSPDefinition | null> {
    if (!this.config.enabled || !this.isAvailable(language)) return null;

    try {
      const serverType = LANGUAGE_TO_SERVER_TYPE[language];
      const client = await this.ensureClient(serverType);
      return client.getDefinition(filePath, line, character);
    } catch {
      return null;
    }
  }

  /**
   * Find all references to a symbol at a position.
   */
  async getReferences(
    filePath: string,
    line: number,
    character: number,
    language: LSPLanguage,
  ): Promise<LSPReference[]> {
    if (!this.config.enabled || !this.isAvailable(language)) return [];

    try {
      const serverType = LANGUAGE_TO_SERVER_TYPE[language];
      const client = await this.ensureClient(serverType);
      return client.getReferences(filePath, line, character);
    } catch {
      return [];
    }
  }

  /**
   * Notify language servers that a file has been opened/changed.
   */
  async notifyFileOpen(
    filePath: string,
    content: string,
    language: LSPLanguage,
  ): Promise<void> {
    if (!this.config.enabled || !this.isAvailable(language)) return;
    try {
      const serverType = LANGUAGE_TO_SERVER_TYPE[language];
      const client = await this.ensureClient(serverType);
      await client.didOpen(filePath, content, language);
    } catch {
      // Non-critical
    }
  }

  /**
   * Notify language servers that a file has been closed.
   */
  async notifyFileClose(filePath: string, language: LSPLanguage): Promise<void> {
    if (!this.config.enabled || !this.isAvailable(language)) return;
    try {
      const serverType = LANGUAGE_TO_SERVER_TYPE[language];
      const client = await this.ensureClient(serverType);
      await client.didClose(filePath);
    } catch {
      // Non-critical
    }
  }

  /**
   * Invalidate cached results for a specific file.
   */
  invalidateFile(filePath: string): void {
    for (const client of this.clients.values()) {
      client.invalidateFileCache(filePath);
    }
    // Also invalidate manager-level cache
    const keysToDelete: string[] = [];
    for (const key of (this.contentTypeCache as unknown as { map: Map<string, unknown> }).map.keys()) {
      if (key.includes(filePath)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.contentTypeCache.delete(key);
    }
  }

  /**
   * Shutdown all language servers and clear caches.
   */
  async shutdown(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const client of this.clients.values()) {
      stops.push(client.stop());
    }
    await Promise.allSettled(stops);
    this.clients.clear();
    this.contentTypeCache.clear();
  }

  /**
   * Check if any language servers are currently running.
   */
  isRunning(): boolean {
    return [...this.clients.values()].some((c) => c.isRunning());
  }

  /**
   * Get the list of active server types.
   */
  activeServers(): LSPServerType[] {
    return [...this.clients.entries()]
      .filter(([_, c]) => c.isRunning())
      .map(([type]) => type);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async ensureClient(serverType: LSPServerType): Promise<LSPClient> {
    let client = this.clients.get(serverType);

    if (!client?.isRunning()) {
      if (this.clients.size >= this.config.maxServers) {
        // Evict least recently used client
        const firstKey = this.clients.keys().next().value;
        if (firstKey) {
          const oldClient = this.clients.get(firstKey);
          if (oldClient) {
            await oldClient.stop();
          }
          this.clients.delete(firstKey);
        }
      }

      client = new LSPClient(
        serverType,
        this.config.projectRoot,
        this.config.cacheSize,
      );
      await client.start();
      this.clients.set(serverType, client);
    }

    return client;
  }

  private fallbackTypeInfo(fallbackType?: string): LSPTypeInfo {
    return {
      typeString: fallbackType ?? 'unknown',
      qualifiedType: null,
      typeKind: 'unknown',
      documentation: null,
      resolutionMethod: fallbackType ? 'tree-sitter' : 'fallback',
    };
  }

  private computeCacheKey(filePath: string, line: number, character: number): string {
    return `type:${filePath}:${line}:${character}`;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an LSP manager for a project.
 *
 * @param projectRoot — the root directory of the project
 * @param enabled — whether to enable LSP features
 */
export function createLSPManager(
  projectRoot: string,
  enabled = true,
): LSPManager {
  return new LSPManager({
    projectRoot,
    enabled,
    maxServers: 3,
    cacheSize: 1000,
    initTimeout: 15000,
    requestTimeout: 5000,
  });
}

/**
 * Check if a language server binary is available on the system PATH.
 * Returns true if the command can be found.
 */
export async function isLSPServerAvailable(
  serverType: LSPServerType,
): Promise<boolean> {
  const command = DEFAULT_SERVER_COMMANDS[serverType];
  try {
    const { execSync } = await import('node:child_process');
    execSync(`which ${command} 2>/dev/null || command -v ${command} 2>/dev/null`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}
