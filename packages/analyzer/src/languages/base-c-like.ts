// @code-analyzer/analyzer — Base C-like Language Provider
// Shared extraction logic for C-family languages (Java, Kotlin, C#, Rust, etc.)

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { ParsedImport } from './provider.js';
import type { TaintSanitizer, TaintSink, TaintSource } from './tree-sitter-base.js';
import type { UnifiedCapture, CaptureTag } from '@code-analyzer/shared';

export function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the end line of a brace-delimited block starting at offset.
 */
export function findBlockEnd(source: string, startOffset: number): number {
  const slice = source.slice(startOffset);
  const openPos = slice.indexOf('{');
  if (openPos === -1) return lineNumberAt(source, startOffset);

  let depth = 0;
  let inString: string | null = null;
  let inComment = false;
  let inLineComment = false;

  for (let i = openPos; i < slice.length; i++) {
    const ch = slice[i]!;
    const prev = i > 0 ? slice[i - 1]! : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inComment) {
      if (prev === '*' && ch === '/') inComment = false;
      continue;
    }

    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }

    if (prev === '/' && ch === '*') {
      inComment = true;
      continue;
    }
    if (prev === '/' && ch === '/') {
      inLineComment = true;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return lineNumberAt(source, startOffset + i);
      }
    }
  }

  return lineNumberAt(source, source.length);
}

/**
 * Extract class-like definitions (class, interface, enum, struct, trait, etc.)
 */
export function extractClassLike(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  keyword: string,
  tag: string,
  modifiers?: string[],
): void {
  const modPrefix = modifiers ? `(?:${modifiers.join('|')}\\s+)*` : '';
  const regex = new RegExp(
    `${modPrefix}(?:export\\s+)?(?:public\\s+)?(?:abstract\\s+)?(?:sealed\\s+)?${keyword}\\s+(\\w+)`,
    'g',
  );
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1]!;
    const startLine = lineNumberAt(source, match.index);
    const endLine = findBlockEnd(source, match.index + match[0].length);
    const fullLine = source.slice(
      match.index,
      source.indexOf('\n', match.index) !== -1 ? source.indexOf('\n', match.index) : source.length,
    );
    const extendsMatch = fullLine.match(/extends\s+(\w+)/);
    const implementsMatch = fullLine.match(/implements\s+([\w\s,]+)/);

    captures.push({
      tag: tag as CaptureTag,
      text: `${keyword} ${name}`,
      startLine,
      endLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: {
        baseClasses: extendsMatch ? extendsMatch[1]! : '',
        interfaces: implementsMatch ? implementsMatch[1]!.replace(/\s+/g, '') : '',
        abstract: String(match[0].includes('abstract')),
        filePath,
      },
    });
  }
}

/**
 * Extract function/method definitions.
 */
export function extractFunctions(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  reservedKeywords: ReadonlySet<string>,
): void {
  // Function declarations: returnType functionName(...) {
  const funcRegex =
    /(?:(?:public|private|protected|static|abstract|final|virtual|override|async|unsafe|extern|native|synchronized)\s+)*(\w+(?:<[^>]*>)?)\s+(\w+)\s*\([^)]*\)\s*(?:\{[^}]*\})?\s*(?:\{|;)/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(source)) !== null) {
    const retType = match[1]!;
    const name = match[2]!;
    if (reservedKeywords.has(name)) continue;
    if (
      ['if', 'while', 'for', 'switch', 'catch', 'with', 'lock', 'using', 'synchronized'].includes(
        name,
      )
    )
      continue;
    const startLine = lineNumberAt(source, match.index);
    const isMethod = match[0].includes('{') ? match[0].indexOf('{') < match[0].length : false;
    const endLine = isMethod
      ? findBlockEnd(source, match.index + match[0].indexOf('{'))
      : startLine;

    captures.push({
      tag: CAPTURE_TAGS.FUNCTION_DEF,
      text: name,
      startLine,
      endLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: {
        returnType: retType !== name ? retType : 'void',
        async: 'false',
        filePath,
      },
    });
  }
}

/**
 * Extract method calls: obj.method(...) or method(...)
 */
export function extractCalls(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  reservedKeywords: ReadonlySet<string>,
): void {
  const callRegex = /(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(source)) !== null) {
    const name = match[1]!;
    if (reservedKeywords.has(name)) continue;
    if (/^[A-Z]/.test(name) && name === name.toUpperCase()) continue; // Skip ALL_CAPS constants
    const startLine = lineNumberAt(source, match.index);
    captures.push({
      tag: CAPTURE_TAGS.FUNCTION_CALL,
      text: name,
      startLine,
      endLine: startLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: { filePath },
    });
  }
}

/**
 * Extract variable/constant definitions.
 */
export function extractVariables(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  varKeywords: string[],
  reservedKeywords: ReadonlySet<string>,
): void {
  const kwPattern = varKeywords.join('|');
  const varRegex = new RegExp(`(?:${kwPattern})\\s+(\\w+)\\s*(?::\\s*[^=\\n]+)?\\s*=`, 'g');
  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(source)) !== null) {
    const name = match[1]!;
    if (reservedKeywords.has(name)) continue;
    const line = lineNumberAt(source, match.index);
    captures.push({
      tag:
        match[0].includes('const') || match[0].includes('final') || match[0].includes('val')
          ? CAPTURE_TAGS.CONSTANT_DEF
          : CAPTURE_TAGS.VARIABLE_DEF,
      text: name,
      startLine: line,
      endLine: line,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: { filePath },
    });
  }
}

/**
 * Extract decorators/annotations: @Override, #[derive(...)], etc.
 */
export function extractAnnotations(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  prefix: string,
): void {
  const escaped = escapeRegex(prefix);
  const regex = new RegExp(`${escaped}(\\w+)(?:\\([\\s\\S]*?\\))?`, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1]!;
    const startLine = lineNumberAt(source, match.index);
    captures.push({
      tag: CAPTURE_TAGS.DECORATOR,
      text: match[0],
      startLine,
      endLine: startLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: { decorator: name, filePath },
    });
  }
}

/**
 * Extract doc comments: /** ... * /, /// ..., etc.
 */
export function extractDocComments(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  pattern: RegExp,
): void {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const text = match[0];
    const startLine = lineNumberAt(source, match.index);
    const endLine = startLine + (text.match(/\n/g)?.length ?? 0);
    captures.push({
      tag: CAPTURE_TAGS.DOCSTRING,
      text,
      startLine,
      endLine,
      startByte: match.index,
      endByte: match.index + text.length,
      properties: { filePath },
    });
  }
}

/**
 * Convert parsed imports into UnifiedCapture entries.
 * Shared across C-like language providers (Java, Kotlin, C#, Rust).
 */
export function extractImportsAsCaptures(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  extractImports: (source: string) => ParsedImport[],
): void {
  const parsedImports = extractImports(source);
  for (const imp of parsedImports) {
    captures.push({
      tag: CAPTURE_TAGS.IMPORT,
      text: imp.source,
      startLine: imp.lineNumber,
      endLine: imp.lineNumber,
      startByte: 0,
      endByte: 0,
      name: imp.source,
      properties: { names: imp.names.join(','), importType: imp.type, filePath },
    });
  }
}

// ---------------------------------------------------------------------------
// Taint sources and sinks for the C-like languages
// ---------------------------------------------------------------------------

/** Source expressions whose value comes from outside the program, and what kind of input it is. */
const C_LIKE_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['process.env', 'env_var'],
  ['process.argv', 'argv'],
  ['req.body', 'http_request'],
  ['req.query', 'http_request'],
  ['req.params', 'http_request'],
  ['request.body', 'http_request'],
  ['request.query', 'http_request'],
  ['window.location', 'url'],
  ['document.location', 'url'],
  ['location.search', 'url'],
  // Python's readers of the same things. `os.environ` and the request objects are where untrusted input arrives in
  // the languages this now covers; the walk matches on text, so the names are all it needs.
  ['os.environ', 'env_var'],
  ['os.getenv', 'env_var'],
  ['sys.argv', 'argv'],
  ['request.GET', 'http_request'],
  ['request.POST', 'http_request'],
  ['request.args', 'http_request'],
  // Java, Go and C# read the same things through calls rather than members.
  ['System.getenv', 'env_var'],
  ['getenv', 'env_var'],
  // The dotted name, because the source matcher compares the **whole** callee: `System.getenv` works for that
  // reason, and this entry was the bare `GetEnvironmentVariable`, which nothing ever equals.
  ['Environment.GetEnvironmentVariable', 'env_var'],
  ['Environment.GetCommandLineArgs', 'argv'],
  // Go capitalises too. The probe showed the callee reaching the list as `os.Getenv`, whose last segment is
  // `Getenv` — and the entry beside it was `os.getenv`.
  ['os.Getenv', 'env_var'],
  ['Getenv', 'env_var'],
  ['flag.Args', 'argv'],
  ['URL.Query', 'http_request'],
  ['FormValue', 'http_request'],
  // PHP reads its input from superglobals, which reach the walk as `variable_name` nodes rather than members.
  ['$_GET', 'http_request'],
  ['$_POST', 'http_request'],
  ['$_REQUEST', 'http_request'],
  ['$_COOKIE', 'cookie'],
  ['$_SERVER', 'server'],
  // Ruby. `params` is Rails' request object and reaches the walk as a call; `ENV` is a constant in a bracket.
  ['params', 'http_request'],
  ['ENV', 'env_var'],
  ['ARGV', 'argv'],
  ['cookies', 'cookie'],
  ['getenv', 'env_var'],
  ['Query', 'http_request'],
];

/** Calls that pass their argument somewhere it will be interpreted, and what kind of sink it is. */
const C_LIKE_SINKS: ReadonlyArray<readonly [string, string]> = [
  ['eval', 'eval'],
  ['execSync', 'os_command'],
  ['exec', 'os_command'],
  ['spawn', 'os_command'],
  ['query', 'sql_exec'],
  ['execute', 'sql_exec'],
  ['document.write', 'html'],
  ['innerHTML', 'html'],
  ['outerHTML', 'html'],
  ['writeFile', 'file_write'],
  ['appendFile', 'file_write'],
  ['os.system', 'os_command'],
  ['os.popen', 'os_command'],
  ['subprocess.run', 'os_command'],
  ['subprocess.call', 'os_command'],
  ['exec', 'os_command'],
  ['Process.Start', 'os_command'],
  // Go's database API capitalises: `db.Query(sql)` and `tx.Exec(sql)` are the calls a Go program makes, and the
  // sink list held only the lowercase JavaScript spellings. The node name was never the problem — the probe showed
  // `call_expression` all along — the name this list compares against was.
  ['Query', 'sql_exec'],
  ['Execute', 'sql_exec'],
  ['Exec', 'sql_exec'],
  // PHP's dangerous calls, of which only `exec` was already listed.
  ['shell_exec', 'os_command'],
  ['system', 'os_command'],
  ['passthru', 'os_command'],
  ['popen', 'os_command'],
  ['proc_open', 'os_command'],
  ['unserialize', 'deserialization'],
  ['include', 'file_include'],
  ['require', 'file_include'],
  // **The vocabulary knew what a server calls and not what a tool calls.** Scanning this repository's own sources
  // found 166 sources and 75 sinks across 42,446 captures, and the sinks were almost all of them `query` or `exec` -
  // while the code it was reading calls `readFileSync`, `JSON.parse` and `spawn`. These are what a build tool, a CLI
  // or a web service calls when it reads a file, parses untrusted input or starts a process.
  ['readFileSync', 'file_read'],
  ['readFile', 'file_read'],
  ['readdirSync', 'file_read'],
  ['createReadStream', 'file_read'],
  ['writeFileSync', 'file_write'],
  ['createWriteStream', 'file_write'],
  ['JSON.parse', 'deserialization'],
  ['parse', 'deserialization'],
  ['spawn', 'os_command'],
  ['spawnSync', 'os_command'],
  ['execSync', 'os_command'],
  ['execFileSync', 'os_command'],
  ['Function', 'code_execution'],
  ['require', 'file_include'],
  // Ruby's process-spawning and file calls, most of which are written with a receiver.
  ['Kernel.system', 'os_command'],
  ['Open3', 'os_command'],
  ['IO.popen', 'os_command'],
  ['File.read', 'file_read'],
  ['File.write', 'file_write'],
  ['File.open', 'file_write'],
  // C and C++ write their dangerous calls as bare functions, most of which are already listed; these are the
  // neighbouring ones a buffer-overflow finding starts from.
  ['popen', 'os_command'],
  ['strcpy', 'buffer_overflow'],
  ['strcat', 'buffer_overflow'],
  ['sprintf', 'buffer_overflow'],
  ['gets', 'buffer_overflow'],
  ['scanf', 'buffer_overflow'],
];

function sourceFor(text: string): readonly [string, string] | undefined {
  return C_LIKE_SOURCES.find(([expr]) => text === expr || text.startsWith(`${expr}.`));
}

/**
 * A sink, matched on the callee's last segment or on its full text.
 *
 * Both, because languages name sinks differently: `query(...)` is matched by its simple name, and `os.system(...)`
 * only by its dotted one. Matching on the last segment alone silently drops every dotted entry in the list — which is
 * what the Python case found.
 */
function sinkFor(text: string): readonly [string, string] | undefined {
  // Splits on `->` as well as `.`: PHP writes `$db->query($sql)`, whose last dot-segment is the whole string.
  const simple =
    text
      .split(/[.\-]>?|(?<![.\-])[.]/)
      .filter(Boolean)
      .pop() ?? text;
  return C_LIKE_SINKS.find(([name]) => simple === name || text === name);
}

/**
 * Collect taint sources under `node`, in the shape `TaintSource` expects.
 *
 * Matching is on the node's **text**, which is how the five providers that already implement this work: it keeps
 * the rule readable, and it does not depend on a grammar field name that can differ between languages and versions.
 *
 * `name` is the source expression itself, not the variable that receives it. Naming the receiver would require
 * following the assignment, which is a data-flow question this walk does not answer — and an invented name would be
 * worse than the expression, which is at least true.
 */
export interface TaintNodeTypes {
  /** Node types denoting `a.b` — a member or attribute read. */
  readonly member: readonly string[];
  /** Node types denoting a call. */
  readonly call: readonly string[];
  /** The node holding a call's arguments. */
  readonly argumentContainer: readonly string[];
}

/** The C family's names for the three. Python calls them `attribute`, `call` and `argument_list`. */
export const C_LIKE_TAINT_NODES: TaintNodeTypes = {
  member: ['member_expression', 'field_expression'],
  call: ['call_expression', 'new_expression'],
  argumentContainer: ['arguments'],
};

/**
 * Collect taint sources under `node`, one entry per expression.
 *
 * A single expression is often **both** a member and a call — `os.Getenv("K")` is a call whose callee the list holds
 * — and a nested member matches twice for the same term, `req.body.id` and the `req.body` inside it. Both arrive, so
 * the walk reports the same source twice. The wrapper drops the repeat and keeps whichever came first, which is the
 * outermost expression because the walk is pre-order.
 */
export function collectCLikeTaintSources(
  node: {
    type: string;
    text: string;
    startPosition: { row: number };
    childCount: number;
    child(i: number): unknown;
  },
  sources: TaintSource[],
  types: TaintNodeTypes = C_LIKE_TAINT_NODES,
): void {
  const before = sources.length;
  walkTaintSources(node, sources, types);

  const seen = new Set<string>();
  const added = sources.splice(before);
  for (const entry of added) {
    const key = `${entry.line}|${entry.sourceType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(entry);
  }
}

function walkTaintSources(
  node: {
    type: string;
    text: string;
    startPosition: { row: number };
    childCount: number;
    child(i: number): unknown;
  },
  sources: TaintSource[],
  types: TaintNodeTypes = C_LIKE_TAINT_NODES,
): void {
  if (types.member.includes(node.type)) {
    const match = sourceFor(node.text);
    if (match) {
      sources.push({
        name: node.text,
        sourceType: match[1],
        line: node.startPosition.row + 1,
        text: node.text,
        properties: {},
      });
    }
  }

  // A source can also be read by **calling** something. `System.getenv("KEY")` is where a Java program's
  // environment arrives and `Environment.GetEnvironmentVariable("KEY")` is C#'s — neither has a member expression to
  // match, which is why the Java, Go and C# overrides found nothing until this existed. The callee is taken the way
  // the sink walk takes it, so `os.environ["KEY"]` and `os.getenv("KEY")` are both recognised.
  if (types.call.includes(node.type)) {
    const callee = calleeOf(node.text);
    // No length guard: `sourceFor('')` matches nothing, so an empty callee falls through on its own — and a guard
    // here would be a branch no call can take, which is the shape the coverage gate reports.
    const match = sourceFor(callee);
    if (match) {
      sources.push({
        name: callee,
        sourceType: match[1],
        line: node.startPosition.row + 1,
        text: node.text,
        properties: {},
      });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i) as Parameters<typeof collectCLikeTaintSources>[0] | null;
    if (child) walkTaintSources(child, sources, types);
  }
}

/**
 * Collect taint sinks under `node`, in the shape `TaintSink` expects.
 *
 * The match is on the last segment of the callee, so `db.query(...)` and `query(...)` are both recognised. The
 * full text is kept in `text`, so a caller that wants to distinguish them can.
 */
export function collectCLikeTaintSinks(
  node: {
    type: string;
    text: string;
    startPosition: { row: number };
    childCount: number;
    child(i: number): unknown;
  },
  sinks: TaintSink[],
  types: TaintNodeTypes = C_LIKE_TAINT_NODES,
): void {
  if (types.call.includes(node.type)) {
    // The callee is everything before the **last** top-level `(`. Taking the first one truncates a chained call at
    // its inner call: `Runtime.getRuntime().exec(cmd)` split at the first parenthesis is `Runtime.getRuntime`, whose
    // last segment is `getRuntime` — which matches nothing. Java's sink case found this.
    const callee = calleeOf(node.text);
    const match = sinkFor(callee);
    if (match && callee.length > 0) {
      sinks.push({
        name: callee,
        sinkType: match[1],
        line: node.startPosition.row + 1,
        text: node.text,
        properties: {},
      });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i) as Parameters<typeof collectCLikeTaintSinks>[0] | null;
    if (child) collectCLikeTaintSinks(child, sinks, types);
  }
}

/**
 * The callee of a call, from the call's text.
 *
 * **Pair the final `)` with its `(` and take everything before it.** Two earlier rules both failed, in opposite
 * directions, and the cases that killed them are worth keeping:
 *
 * - the **last** `(` truncates a call whose argument is itself a call: `popen(key.c_str(), "r")` became
 *   `popen(key.c_str`, whose last segment is `c_str`
 * - the **first** `(` at depth zero truncates a chain: `Runtime.getRuntime().exec(cmd)` became `Runtime.getRuntime`,
 *   because the inner call's parenthesis is also at depth zero
 *
 * Working backwards from the end has neither failure. The parenthesis that pairs with the final `)` is the one that
 * opened the call being read, so the text before it is the callee — `Runtime.getRuntime().exec` for the chain and
 * `popen` for the call with an argument.
 */
function calleeOf(text: string): string {
  const end = text.lastIndexOf(')');
  if (end < 0) return text.trim();

  let depth = 0;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      depth -= 1;
      if (depth === 0) return text.slice(0, i).trim();
    }
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

/**
 * What a sanitizer is called, and what it neutralises.
 *
 * **Nothing in the C family recognised one until this existed.** `extractSanitizers` was implemented for `bash`,
 * `css`, `sql`, `toml` and `markdown` — four of them languages that carry no taint — and the ten languages that do
 * all fell through to the base, which returns nothing. So `sanitized` was false for every finding in real code, not
 * because the code had no sanitizers but because nothing looked for them.
 */
const C_LIKE_SANITIZERS: ReadonlyArray<readonly [string, string]> = [
  ['escape', 'escaping'],
  ['escapeHtml', 'escaping'],
  // Each of the three below was named by a fixture and absent from the list; the fixtures found them, not a reading.
  ['EscapeString', 'escaping'],
  ['HtmlEncode', 'escaping'],
  ['urlencode', 'encoding'],
  ['filename', 'path'],
  ['htmlspecialchars', 'escaping'],
  ['encodeURIComponent', 'encoding'],
  ['encodeURI', 'encoding'],
  ['sanitize', 'validation'],
  ['sanitizeHtml', 'validation'],
  ['strip_tags', 'validation'],
  ['parseInt', 'validation'],
  ['parseFloat', 'validation'],
  ['Number', 'validation'],
  ['basename', 'path'],
  ['realpath', 'path'],
  ['mysql_real_escape_string', 'escaping'],
  ['quote', 'escaping'],
  ['Parameterize', 'parameterisation'],
  ['PreparedStatement', 'parameterisation'],
];

/**
 * Collect taint sanitizers under `node`, in the shape `TaintSanitizer` expects, one entry per expression.
 *
 * The same two shapes as the sources: a call whose callee is a sanitizer, and a member whose text contains one. The
 * last segment is what is matched, as it is for sinks, so `html.EscapeString(s)` resolves.
 */
export function collectCLikeTaintSanitizers(
  node: {
    type: string;
    text: string;
    startPosition: { row: number };
    childCount: number;
    child(i: number): unknown;
  },
  sanitizers: TaintSanitizer[],
  types: TaintNodeTypes = C_LIKE_TAINT_NODES,
): void {
  const seen = new Set<string>();
  const before = sanitizers.length;
  walkSanitizers(node, sanitizers, types);

  const added = sanitizers.splice(before);
  for (const entry of added) {
    const key = `${entry.line}|${entry.sanitizerType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sanitizers.push(entry);
  }
}

function sanitizerFor(text: string): readonly [string, string] | undefined {
  const simple = lastSegmentOf(text);
  return C_LIKE_SANITIZERS.find(
    ([name]) => simple === name || text === name || text.endsWith(name),
  );
}

function walkSanitizers(
  node: {
    type: string;
    text: string;
    startPosition: { row: number };
    childCount: number;
    child(i: number): unknown;
  },
  sanitizers: TaintSanitizer[],
  types: TaintNodeTypes,
): void {
  if (types.member.includes(node.type) || types.call.includes(node.type)) {
    const candidate = types.call.includes(node.type) ? calleeOf(node.text) : node.text;
    const match = candidate.length > 0 ? sanitizerFor(candidate) : undefined;
    if (match) {
      sanitizers.push({
        name: candidate,
        sanitizerType: match[1],
        line: node.startPosition.row + 1,
        text: node.text,
        properties: {},
      });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i) as Parameters<typeof walkSanitizers>[0] | null;
    if (child) walkSanitizers(child, sanitizers, types);
  }
}

/** The last segment of a name, splitting on `.` and on `->`. */
function lastSegmentOf(name: string): string {
  return (
    name
      .split(/[.\-]>?|(?<![.\-])[.]/)
      .filter(Boolean)
      .pop() ?? name
  );
}
