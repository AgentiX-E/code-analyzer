// @code-analyzer/intelligence — Per-Language Taint Models
// Structured source/sink/sanitizer definitions for TypeScript, Python, and Go.
// These models enable precise taint analysis with language-aware matching
// including import resolution, method receiver tracking, and call-site analysis.
//
// Model categories:
//   - Sources: user input (HTTP params, CLI args), file reads, network, database
//   - Sinks: SQL injection, command injection, XSS, path traversal, SSRF, etc.
//   - Sanitizers: parameterized queries, HTML escaping, path normalization, etc.

// ---------------------------------------------------------------------------
// Common Types
// ---------------------------------------------------------------------------

/** Sink category for kind-set matching. */
export type TaintSinkKind =
  | 'sql-injection'
  | 'command-injection'
  | 'code-injection'
  | 'xss'
  | 'path-traversal'
  | 'open-redirect'
  | 'ssrf'
  | 'deserialization'
  | 'file-inclusion'
  | 'ldap-injection'
  | 'log-injection';

/** Source category. */
export type TaintSourceKind = 'remote-input' | 'file-read' | 'network-input' | 'database-input';

/** A structured source definition. */
export interface TaintSourceDef {
  /** Source category. */
  kind: TaintSourceKind;
  /** How the source is accessed: 'callResult' or 'memberRead'. */
  accessType: 'callResult' | 'memberRead' | 'param';
  /** Module name (e.g., 'express', 'flask.request') or null for globals. */
  module: string | null;
  /** Method/function name (e.g., 'body', 'readFile') — may use '*' wildcard. */
  method: string;
  /** For callResult: which argument index receives the tainted value. */
  argIndex?: number;
  /** Human-readable description. */
  description: string;
}

/** A structured sink definition. */
export interface TaintSinkDef {
  /** Sink category. */
  kind: TaintSinkKind;
  /** CWE identifier. */
  cweId?: string;
  /** Severity. */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Matching strategy. */
  matchType: 'moduleFunction' | 'globalFunction' | 'anyReceiver' | 'receiverConvention';
  /** Module name or null. */
  module: string | null;
  /** Function/method name. */
  method: string;
  /** For matchType='anyReceiver': the method called on any object. */
  anyReceiverMethod?: string;
  /** For receiverConvention: receiver variable name patterns (pipe-separated). */
  receiverPatterns?: string;
  /** Which argument index carries the tainted value (-1 for all). */
  taintArg: number;
  /** Description. */
  description: string;
}

/** A structured sanitizer definition. */
export interface SanitizerDef {
  /** Sink kinds neutralized. */
  neutralizes: readonly TaintSinkKind[];
  /** Matching strategy. */
  matchType: 'moduleFunction' | 'globalFunction';
  /** Module or null. */
  module: string | null;
  /** Function name. */
  method: string;
  /** Description. */
  description: string;
}

/** Complete taint model for a language. */
export interface TaintModel {
  /** Language identifier. */
  language: string;
  /** Source definitions. */
  sources: readonly TaintSourceDef[];
  /** Sink definitions. */
  sinks: readonly TaintSinkDef[];
  /** Sanitizer definitions. */
  sanitizers: readonly SanitizerDef[];
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript Taint Model
// ---------------------------------------------------------------------------

export const TYPESCRIPT_TAINT_MODEL: TaintModel = {
  language: 'typescript',

  sources: [
    // Express/Koa/Fastify HTTP request
    { kind: 'remote-input', accessType: 'memberRead', module: null, method: 'req', description: 'Express/Koa/Fastify request object' },
    { kind: 'remote-input', accessType: 'memberRead', module: null, method: 'request', description: 'Generic HTTP request object' },
    // process.argv
    { kind: 'remote-input', accessType: 'memberRead', module: null, method: 'process', description: 'process.argv CLI input' },
    // fs.readFile (file as source)
    { kind: 'file-read', accessType: 'callResult', module: 'fs', method: 'readFile', argIndex: 0, description: 'File content from fs.readFile' },
    { kind: 'file-read', accessType: 'callResult', module: 'fs', method: 'readFileSync', argIndex: 0, description: 'File content from fs.readFileSync' },
    { kind: 'file-read', accessType: 'callResult', module: 'fs/promises', method: 'readFile', argIndex: 0, description: 'File content from fs/promises.readFile' },
    // Network fetch
    { kind: 'network-input', accessType: 'callResult', module: null, method: 'fetch', description: 'Response from fetch()' },
    { kind: 'network-input', accessType: 'callResult', module: 'axios', method: 'get', description: 'Response from axios.get' },
    { kind: 'network-input', accessType: 'callResult', module: 'axios', method: 'post', description: 'Response from axios.post' },
    // Database
    { kind: 'database-input', accessType: 'callResult', module: null, method: 'db', description: 'Database query result' },
    { kind: 'database-input', accessType: 'callResult', module: null, method: 'database', description: 'Database query result' },
  ],

  sinks: [
    // SQL injection
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'anyReceiver', module: null, method: 'query', anyReceiverMethod: 'query', taintArg: 0, description: 'SQL query execution with user input' },
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'anyReceiver', module: null, method: 'execute', anyReceiverMethod: 'execute', taintArg: 0, description: 'SQL execution with user input' },
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'receiverConvention', module: null, method: 'run', receiverPatterns: 'db|database|conn|client|pool|stmt|statement|prepared', taintArg: 0, description: 'SQL run on DB connection' },
    // Command injection
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'child_process', method: 'exec', taintArg: 0, description: 'Shell command execution' },
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'child_process', method: 'execSync', taintArg: 0, description: 'Shell command execution (sync)' },
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'child_process', method: 'spawn', taintArg: 0, description: 'Process spawning' },
    // XSS
    { kind: 'xss', cweId: 'CWE-79', severity: 'high', matchType: 'receiverConvention', module: null, method: 'send', receiverPatterns: 'res|response|ctx', taintArg: 0, description: 'HTTP response with user input' },
    { kind: 'xss', cweId: 'CWE-79', severity: 'high', matchType: 'moduleFunction', module: null, method: 'document.write', taintArg: 0, description: 'document.write with user input' },
    { kind: 'xss', cweId: 'CWE-79', severity: 'high', matchType: 'moduleFunction', module: null, method: 'innerHTML', taintArg: -1, description: 'innerHTML assignment' },
    // Path traversal
    { kind: 'path-traversal', cweId: 'CWE-22', severity: 'high', matchType: 'moduleFunction', module: 'fs', method: 'writeFile', taintArg: 0, description: 'File write with user-controlled path' },
    { kind: 'path-traversal', cweId: 'CWE-22', severity: 'high', matchType: 'moduleFunction', module: 'fs', method: 'createReadStream', taintArg: 0, description: 'File read stream with user path' },
    // Code injection
    { kind: 'code-injection', cweId: 'CWE-94', severity: 'critical', matchType: 'globalFunction', module: null, method: 'eval', taintArg: 0, description: 'Dynamic code evaluation' },
    { kind: 'code-injection', cweId: 'CWE-94', severity: 'critical', matchType: 'globalFunction', module: null, method: 'Function', taintArg: 0, description: 'Dynamic Function constructor' },
    // Deserialization
    { kind: 'deserialization', cweId: 'CWE-502', severity: 'high', matchType: 'globalFunction', module: null, method: 'JSON.parse', taintArg: 0, description: 'Untrusted JSON deserialization' },
  ],

  sanitizers: [
    // SQL parameterization
    { neutralizes: ['sql-injection'], matchType: 'moduleFunction', module: null, method: 'parameterizedQuery', description: 'Parameterized SQL query' },
    { neutralizes: ['sql-injection'], matchType: 'moduleFunction', module: null, method: '$$raw', description: 'Knex raw value (already escaped)' },
    // HTML escaping
    { neutralizes: ['xss'], matchType: 'moduleFunction', module: 'escape-html', method: 'default', description: 'HTML entity escaping' },
    { neutralizes: ['xss', 'path-traversal'], matchType: 'globalFunction', module: null, method: 'encodeURIComponent', description: 'URI encoding' },
    { neutralizes: ['xss'], matchType: 'moduleFunction', module: 'dompurify', method: 'sanitize', description: 'DOMPurify sanitization' },
    // Shell escaping
    { neutralizes: ['command-injection'], matchType: 'moduleFunction', module: 'shell-quote', method: 'quote', description: 'Shell argument quoting' },
    // Path sanitization
    { neutralizes: ['path-traversal'], matchType: 'moduleFunction', module: 'path', method: 'normalize', description: 'Path normalization' },
    { neutralizes: ['path-traversal'], matchType: 'moduleFunction', module: 'path', method: 'resolve', description: 'Path resolution (absolute)' },
    // Input validation
    { neutralizes: ['sql-injection', 'command-injection', 'xss'], matchType: 'moduleFunction', module: 'validator', method: 'escape', description: 'Validator.js escape' },
  ],
};

// ---------------------------------------------------------------------------
// Python Taint Model
// ---------------------------------------------------------------------------

export const PYTHON_TAINT_MODEL: TaintModel = {
  language: 'python',

  sources: [
    // Flask request
    { kind: 'remote-input', accessType: 'memberRead', module: 'flask', method: 'request', description: 'Flask request object' },
    // Django request
    { kind: 'remote-input', accessType: 'memberRead', module: 'django.http', method: 'HttpRequest', description: 'Django HTTP request' },
    // FastAPI request
    { kind: 'remote-input', accessType: 'param', module: 'fastapi', method: '*', description: 'FastAPI request parameter' },
    // sys.argv
    { kind: 'remote-input', accessType: 'memberRead', module: 'sys', method: 'argv', description: 'CLI arguments' },
    // file reads
    { kind: 'file-read', accessType: 'callResult', module: null, method: 'open', argIndex: 0, description: 'File content from open()' },
    { kind: 'file-read', accessType: 'callResult', module: 'pathlib', method: 'Path.read_text', description: 'Pathlib file read' },
    // Network
    { kind: 'network-input', accessType: 'callResult', module: 'requests', method: 'get', description: 'HTTP GET response' },
    { kind: 'network-input', accessType: 'callResult', module: 'requests', method: 'post', description: 'HTTP POST response' },
    { kind: 'network-input', accessType: 'callResult', module: 'urllib.request', method: 'urlopen', description: 'urllib response' },
    // Database
    { kind: 'database-input', accessType: 'callResult', module: null, method: 'cursor', description: 'Database cursor result' },
  ],

  sinks: [
    // SQL injection
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'anyReceiver', module: null, method: 'execute', anyReceiverMethod: 'execute', taintArg: 0, description: 'SQL execution' },
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'anyReceiver', module: null, method: 'executemany', anyReceiverMethod: 'executemany', taintArg: 0, description: 'Batch SQL execution' },
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'receiverConvention', module: null, method: 'raw', receiverPatterns: 'db|database|cursor|conn|connection|session', taintArg: 0, description: 'Raw SQL on DB handle' },
    // Command injection
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'os', method: 'system', taintArg: 0, description: 'Shell command via os.system' },
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'os', method: 'popen', taintArg: 0, description: 'Shell command via os.popen' },
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'subprocess', method: 'call', taintArg: 0, description: 'Shell via subprocess.call' },
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'subprocess', method: 'run', taintArg: 0, description: 'Shell via subprocess.run' },
    // Code injection
    { kind: 'code-injection', cweId: 'CWE-94', severity: 'critical', matchType: 'globalFunction', module: null, method: 'eval', taintArg: 0, description: 'Dynamic eval' },
    { kind: 'code-injection', cweId: 'CWE-94', severity: 'critical', matchType: 'globalFunction', module: null, method: 'exec', taintArg: 0, description: 'Dynamic exec' },
    // Path traversal
    { kind: 'path-traversal', cweId: 'CWE-22', severity: 'high', matchType: 'globalFunction', module: null, method: 'open', taintArg: 0, description: 'File open with user path' },
    // Deserialization
    { kind: 'deserialization', cweId: 'CWE-502', severity: 'high', matchType: 'moduleFunction', module: 'pickle', method: 'loads', taintArg: 0, description: 'Untrusted pickle deserialization' },
    { kind: 'deserialization', cweId: 'CWE-502', severity: 'high', matchType: 'moduleFunction', module: 'yaml', method: 'load', taintArg: 0, description: 'Unsafe YAML load' },
    // SSRF
    { kind: 'ssrf', cweId: 'CWE-918', severity: 'high', matchType: 'moduleFunction', module: 'requests', method: 'get', taintArg: 0, description: 'HTTP GET with user-controlled URL' },
  ],

  sanitizers: [
    { neutralizes: ['sql-injection'], matchType: 'moduleFunction', module: null, method: 'cursor.execute', description: 'Parameterized cursor.execute' },
    { neutralizes: ['xss'], matchType: 'moduleFunction', module: 'html', method: 'escape', description: 'HTML escaping' },
    { neutralizes: ['xss'], matchType: 'moduleFunction', module: 'markupsafe', method: 'escape', description: 'MarkupSafe escaping' },
    { neutralizes: ['command-injection'], matchType: 'moduleFunction', module: 'shlex', method: 'quote', description: 'Shell argument quoting' },
    { neutralizes: ['path-traversal'], matchType: 'moduleFunction', module: 'os.path', method: 'realpath', description: 'Path canonicalization' },
  ],
};

// ---------------------------------------------------------------------------
// Go Taint Model
// ---------------------------------------------------------------------------

export const GO_TAINT_MODEL: TaintModel = {
  language: 'go',

  sources: [
    // HTTP request
    { kind: 'remote-input', accessType: 'param', module: 'net/http', method: 'Request', description: 'HTTP request (*http.Request)' },
    { kind: 'remote-input', accessType: 'callResult', module: 'net/http', method: 'Request.FormValue', description: 'HTTP form value' },
    { kind: 'remote-input', accessType: 'callResult', module: 'net/http', method: 'Request.URL.Query', description: 'URL query parameter' },
    // CLI
    { kind: 'remote-input', accessType: 'memberRead', module: 'os', method: 'Args', description: 'CLI arguments' },
    { kind: 'remote-input', accessType: 'memberRead', module: 'flag', method: 'Args', description: 'Flag arguments' },
    // File read
    { kind: 'file-read', accessType: 'callResult', module: 'os', method: 'ReadFile', description: 'File content from os.ReadFile' },
    { kind: 'file-read', accessType: 'callResult', module: 'io/ioutil', method: 'ReadFile', description: 'File content from ioutil.ReadFile' },
    // Network
    { kind: 'network-input', accessType: 'callResult', module: 'net/http', method: 'Get', description: 'HTTP GET response' },
    { kind: 'network-input', accessType: 'callResult', module: 'net/http', method: 'Post', description: 'HTTP POST response' },
    // Database
    { kind: 'database-input', accessType: 'callResult', module: 'database/sql', method: 'Rows', description: 'SQL query rows' },
  ],

  sinks: [
    // SQL injection
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'receiverConvention', module: 'database/sql', method: 'Query', receiverPatterns: 'db|database|conn|tx|stmt', taintArg: 0, description: 'SQL query with user input' },
    { kind: 'sql-injection', cweId: 'CWE-89', severity: 'critical', matchType: 'receiverConvention', module: 'database/sql', method: 'Exec', receiverPatterns: 'db|database|conn|tx|stmt', taintArg: 0, description: 'SQL exec with user input' },
    // Command injection
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'os/exec', method: 'Command', taintArg: 0, description: 'Command execution via exec.Command' },
    { kind: 'command-injection', cweId: 'CWE-78', severity: 'critical', matchType: 'moduleFunction', module: 'os/exec', method: 'CommandContext', taintArg: 0, description: 'Command execution with context' },
    // XSS
    { kind: 'xss', cweId: 'CWE-79', severity: 'high', matchType: 'receiverConvention', module: 'net/http', method: 'ResponseWriter', receiverPatterns: 'w|rw|writer|responseWriter', taintArg: 0, description: 'HTTP response with user input' },
    // Path traversal
    { kind: 'path-traversal', cweId: 'CWE-22', severity: 'high', matchType: 'moduleFunction', module: 'os', method: 'Open', taintArg: 0, description: 'File open with user path' },
    { kind: 'path-traversal', cweId: 'CWE-22', severity: 'high', matchType: 'moduleFunction', module: 'os', method: 'Create', taintArg: 0, description: 'File create with user path' },
    // Code injection
    { kind: 'code-injection', cweId: 'CWE-94', severity: 'critical', matchType: 'moduleFunction', module: 'text/template', method: 'Execute', taintArg: 0, description: 'Template execution with user data' },
    { kind: 'code-injection', cweId: 'CWE-94', severity: 'critical', matchType: 'moduleFunction', module: 'html/template', method: 'Execute', taintArg: 0, description: 'HTML template execution' },
  ],

  sanitizers: [
    { neutralizes: ['sql-injection'], matchType: 'moduleFunction', module: 'database/sql', method: 'Named', description: 'Named parameterized query' },
    { neutralizes: ['xss'], matchType: 'moduleFunction', module: 'html', method: 'EscapeString', description: 'HTML escaping' },
    { neutralizes: ['xss'], matchType: 'moduleFunction', module: 'html/template', method: 'HTMLEscaper', description: 'HTML template auto-escaping' },
    { neutralizes: ['path-traversal'], matchType: 'moduleFunction', module: 'path/filepath', method: 'Clean', description: 'Path cleaning' },
  ],
};

// ---------------------------------------------------------------------------
// Model Registry
// ---------------------------------------------------------------------------

/** All available taint models indexed by language. */
export const TAINT_MODELS: ReadonlyMap<string, TaintModel> = new Map([
  ['typescript', TYPESCRIPT_TAINT_MODEL],
  ['javascript', TYPESCRIPT_TAINT_MODEL],  // JS shares TS model
  ['tsx', TYPESCRIPT_TAINT_MODEL],
  ['jsx', TYPESCRIPT_TAINT_MODEL],
  ['python', PYTHON_TAINT_MODEL],
  ['go', GO_TAINT_MODEL],
]);
