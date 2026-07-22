// @code-analyzer/intelligence — Rule Executors (Checker Functions)
// 50 standalone checker functions for all deterministic rules.
// Each checker validates inputs and returns violations with clear messages.

import type { RuleDefinition } from './rule-definitions.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleCheckResult {
  ruleId: string;
  line: number;
  message: string;
  suggestion?: string;
}

export type RuleChecker = (
  lines: string[],
  filePath: string,
  language: string,
) => RuleCheckResult[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('.test.') ||
    filePath.includes('.spec.') ||
    filePath.includes('__tests__') ||
    filePath.includes('__mocks__')
  );
}

function safeLines(lines: string[] | null | undefined): string[] {
  return lines ?? [];
}

function makeResult(
  ruleId: string,
  line: number,
  message: string,
  suggestion?: string,
): RuleCheckResult {
  return { ruleId, line, message, suggestion };
}

// ===========================================================================
// CATEGORY 1: CORRECTNESS (8 Checkers)
// ===========================================================================

/** Check for potentially undefined variable references. */
export function checkNoUndef(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const declared = new Set<string>();
  const builtins = new Set([
    'console', 'require', 'module', 'exports', '__dirname', '__filename',
    'process', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout',
    'clearInterval', 'Promise', 'JSON', 'Math', 'Date', 'RegExp',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Object', 'String',
    'Number', 'Boolean', 'Symbol', 'undefined', 'null', 'true', 'false',
    'this', 'super', 'arguments', 'Error', 'TypeError', 'Reflect',
    'Proxy', 'Intl', 'BigInt', 'NaN', 'Infinity', 'parseInt',
    'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
  ]);

  for (const raw of src) {
    const line = raw.trim();
    const decl = line.match(/^(?:const|let|var|function|class|import)\s+(\w+)/);
    if (decl) declared.add(decl[1]!);
    const param = line.match(/^\s*(?:async\s+)?(?:function|class)\s+\w+\s*\(([^)]*)\)/);
    if (param) {
      for (const p of param[1]!.split(',')) {
        const name = p.trim().split(/[:= ]/)[0];
        if (name) declared.add(name!);
      }
    }
    const arrow = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\s*\(([^)]*)\)/);
    if (arrow) {
      declared.add(arrow[1]!);
      for (const p of arrow[2]!.split(',')) {
        const name = p.trim().split(/[:= ]/)[0];
        if (name) declared.add(name!);
      }
    }
  }

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    const idents = trimmed.match(/\b([a-zA-Z_$]\w+)\b/g);
    if (!idents) continue;

    for (const ident of idents) {
      if (
        ident.length > 1 &&
        !declared.has(ident) &&
        !builtins.has(ident)
      ) {
        if (
          !trimmed.startsWith(`const ${ident}`) &&
          !trimmed.startsWith(`let ${ident}`) &&
          !trimmed.startsWith(`var ${ident}`) &&
          !trimmed.startsWith(`function ${ident}`) &&
          !trimmed.startsWith(`class ${ident}`)
        ) {
          results.push(makeResult(
            'no-undef', i + 1,
            `"${ident}" is referenced but has no visible declaration in this file.`,
            `Declare "${ident}" with const/let/var or import it.`,
          ));
        }
      }
    }
  }

  return results;
}

/** Check for duplicate import statements. */
export function checkNoDuplicateImports(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    const importMatch = trimmed.match(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const mod = importMatch[1]!;
      if (seen.has(mod)) {
        results.push(makeResult(
          'no-duplicate-imports', i + 1,
          `Duplicate import of "${mod}" (also imported at line ${seen.get(mod)}).`,
          `Merge imports from "${mod}" into a single statement.`,
        ));
      } else {
        seen.set(mod, i + 1);
      }
    }
  }

  return results;
}

/** Check for unreachable code after return/throw/break/continue. */
export function checkNoUnreachableCode(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (!/^\s*(?:return|throw|break|continue)\b/.test(trimmed)) continue;

    const keyword = trimmed.split(/\s/)[0]!;

    if (i + 1 < src.length) {
      const next = src[i + 1]!;
      const nextTrimmed = next.trim();
      if (nextTrimmed === '' || nextTrimmed.startsWith('//')) continue;
      if (nextTrimmed.startsWith('}') || nextTrimmed === '}' || nextTrimmed === ');') continue;

      if (!trimmed.includes('?')) {
        results.push(makeResult(
          'no-unreachable-code', i + 2,
          `Code after ${keyword} on line ${i + 1} is unreachable.`,
          `Remove unreachable code or restructure the control flow.`,
        ));
      }
    }
  }

  return results;
}

/** Check for constant conditions in control flow. */
export function checkNoConstantCondition(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const alwaysTrue = /\b(?:if|while|for)\s*\(\s*(?:true|!false)\s*\)/;
  const alwaysFalse = /\b(?:if|while|for)\s*\(\s*(?:false|!true)\s*\)/;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (alwaysTrue.test(line)) {
      results.push(makeResult(
        'no-constant-condition', i + 1,
        `Condition always evaluates to true — branch is always taken.`,
        `Replace the constant condition with a meaningful check or remove the unnecessary branch.`,
      ));
    } else if (alwaysFalse.test(line)) {
      results.push(makeResult(
        'no-constant-condition', i + 1,
        `Condition always evaluates to false — code inside the block is dead.`,
        `Remove the dead code block or update the condition.`,
      ));
    }
  }

  return results;
}

/** Check for empty catch blocks. */
export function checkNoEmptyCatch(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
      results.push(makeResult(
        'no-empty-catch', i + 1,
        `Empty catch block silently swallows errors.`,
        `Log the error and/or re-throw it: catch(error) { logger.error(error); throw error; }`,
      ));
      continue;
    }

    if (/catch\s*\([^)]*\)\s*\{/.test(trimmed)) {
      let j = i + 1;
      let hasContent = false;
      while (j < src.length && !src[j]!.trim().startsWith('}')) {
        if (src[j]!.trim() !== '') {
          hasContent = true;
          break;
        }
        j++;
      }
      if (!hasContent && j < src.length) {
        results.push(makeResult(
          'no-empty-catch', i + 1,
          `Empty catch block silently swallows errors.`,
          `Log the error and/or re-throw it.`,
        ));
      }
    }
  }

  return results;
}

/** Check for unused variable declarations. */
export function checkNoUnusedVars(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    const decl = trimmed.match(/^(?:const|let|var)\s+(\w+)\s*[=;]/);
    if (!decl) continue;

    const name = decl[1]!;
    if (name === '_') continue;

    let usedElsewhere = false;
    for (let j = 0; j < src.length; j++) {
      if (j === i) continue;
      const otherLine = src[j]!;
      if (otherLine.includes(name) && !otherLine.trim().startsWith('//')) {
        usedElsewhere = true;
        break;
      }
    }

    if (!usedElsewhere) {
      results.push(makeResult(
        'no-unused-vars', i + 1,
        `Variable "${name}" is declared but never used.`,
        `Remove the unused variable or prefix with "_" if intentionally unused.`,
      ));
    }
  }

  return results;
}

/** Check for potentially unsafe optional chaining. */
export function checkNoUnsafeOptionalChaining(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.includes('?.')) {
      results.push(makeResult(
        'no-unsafe-optional-chaining', i + 1,
        `Optional chaining operator used — verify the left-hand side can actually be null/undefined.`,
        `If the value is guaranteed to be defined, remove "?.". Otherwise, add explicit null checks.`,
      ));
    }
  }

  return results;
}

/** Check for array index used as React key. */
export function checkNoArrayIndexKey(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (/\bkey\s*=\s*\{?\s*(?:index|i|idx|j|k)\b/.test(line)) {
      results.push(makeResult(
        'no-array-index-key', i + 1,
        `Array index used as React key — this can cause issues when list order changes.`,
        `Use a stable, unique identifier from your data (e.g., item.id) as the key.`,
      ));
    }
  }

  return results;
}

// ===========================================================================
// CATEGORY 2: SECURITY (12 Checkers)
// ===========================================================================

/** Check for eval() usage (CWE-95). */
export function checkNoEval(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (/\beval\s*\(/.test(line)) {
      results.push(makeResult(
        'no-eval', i + 1,
        `eval() usage detected — allows arbitrary code execution (CWE-95).`,
        `Use JSON.parse() for data parsing, or structured data formats instead of dynamic code execution.`,
      ));
    }
    if (/\bnew\s+Function\s*\(/.test(line)) {
      results.push(makeResult(
        'no-eval', i + 1,
        `new Function() usage detected — equivalent to eval() (CWE-95).`,
        `Avoid dynamic function creation. Use closures or pre-defined functions instead.`,
      ));
    }
  }

  return results;
}

/** Check for SQL injection patterns (CWE-89). */
export function checkSqlInjection(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;

    const concatPattern = /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*[`'"].*\$\{.*[`'"]/i;
    const plusConcat = /[`'"][^`'"]*(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^`'"]*[`'"]\s*\+/i;
    const rawQuery = /(?:\.query|\.execute|\.run)\s*\(\s*[`'"][^`'"]*\$\{/;

    if (concatPattern.test(line) || plusConcat.test(line) || rawQuery.test(line)) {
      results.push(makeResult(
        'no-sql-injection', i + 1,
        `Potential SQL injection detected — string interpolation in SQL query (CWE-89).`,
        `Use parameterized queries: db.query("SELECT * FROM users WHERE id = ?", [userId])`,
      ));
    }
  }

  return results;
}

/** Check for XSS vulnerabilities (CWE-79). */
export function checkXss(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (/dangerouslySetInnerHTML/.test(line)) {
      results.push(makeResult(
        'no-xss', i + 1,
        `dangerouslySetInnerHTML used — bypasses React's XSS protection (CWE-79).`,
        `Use React's built-in escaping or sanitize with DOMPurify before rendering.`,
      ));
    }
    if (/\.innerHTML\s*=/.test(line)) {
      results.push(makeResult(
        'no-xss', i + 1,
        `innerHTML assignment — injectable HTML, XSS risk (CWE-79).`,
        `Use textContent, createElement, or sanitize with DOMPurify.`,
      ));
    }
    if (/document\.write\s*\(/.test(line)) {
      results.push(makeResult(
        'no-xss', i + 1,
        `document.write() used — XSS vulnerability (CWE-79).`,
        `Use DOM manipulation APIs (createElement, appendChild) instead.`,
      ));
    }
  }

  return results;
}

/** Check for hardcoded secrets (CWE-798). */
export function checkHardcodedSecrets(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const secretPatterns: Array<{ re: RegExp; msg: string; sug: string }> = [
    {
      re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{3,}['"]/i,
      msg: 'Hardcoded password detected — must be retrieved from environment or secrets manager (CWE-798).',
      sug: 'Use process.env.PASSWORD or a secrets manager (Vault, AWS Secrets Manager).',
    },
    {
      re: /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_\-+=/]{8,}['"]/i,
      msg: 'Hardcoded API key/token detected (CWE-798).',
      sug: 'Store secrets in environment variables or a secrets manager.',
    },
    {
      re: /(?:access[_-]?key|access[_-]?secret|client[_-]?secret)\s*[:=]\s*['"][A-Za-z0-9_\-+=/]{8,}['"]/i,
      msg: 'Hardcoded credential detected (CWE-798).',
      sug: 'Move credentials to environment variables.',
    },
    {
      re: /(?:token|secret|key)\s*[:=]\s*['"][A-Za-z0-9_\-+=/]{20,}['"]/i,
      msg: 'Hardcoded sensitive value detected (CWE-798).',
      sug: 'Store secrets in environment variables or a secrets manager.',
    },
  ];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;

    for (const pat of secretPatterns) {
      if (pat.re.test(line)) {
        results.push(makeResult('no-hardcoded-secrets', i + 1, pat.msg, pat.sug));
      }
    }
  }

  return results;
}

/** Check for command injection vulnerabilities (CWE-78). */
export function checkCommandInjection(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (
      /(?:exec|spawn|execSync|execFile|execFileSync)\s*\(/.test(line) &&
      (/\+/.test(line) || /\$\{/.test(line) || /`.*\$/.test(line))
    ) {
      results.push(makeResult(
        'no-command-injection', i + 1,
        `Potential command injection — shell command uses string concatenation (CWE-78).`,
        `Use execFile with separate arguments array: execFile('cmd', [arg1, arg2])`,
      ));
    }
  }

  return results;
}

/** Check for path traversal vulnerabilities (CWE-22). */
export function checkPathTraversal(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const fsOps = /fs\.(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|open|readdir|unlink)\s*\(/;
    const pathConstruct = /path\.(?:resolve|join)\s*\(/;
    const userInput = /\b(?:req\.|request\.|params\.|query\.|body\.|input|user)/;

    if (fsOps.test(line) && (/\+\s*/.test(line) || userInput.test(line))) {
      results.push(makeResult(
        'no-path-traversal', i + 1,
        `Potential path traversal — file path constructed with user input (CWE-22).`,
        `Use path.resolve(baseDir, path.normalize(userInput)) and verify result starts with baseDir.`,
      ));
    }

    if (pathConstruct.test(line) && userInput.test(line)) {
      results.push(makeResult(
        'no-path-traversal', i + 1,
        `Path constructed from user input without visible sanitization (CWE-22).`,
        `Sanitize with path.normalize() and validate against an allowlist.`,
      ));
    }
  }

  return results;
}

/** Check for open redirect vulnerabilities (CWE-601). */
export function checkOpenRedirect(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (
      /(?:redirect|res\.redirect|response\.redirect)\s*\(/.test(line) &&
      /\b(?:req\.|request\.|params\.|query\.)/.test(line)
    ) {
      results.push(makeResult(
        'no-open-redirect', i + 1,
        `Potential open redirect — redirect URL uses user-controlled input (CWE-601).`,
        `Validate redirect URLs against an allowlist of trusted destinations.`,
      ));
    }
  }

  return results;
}

/** Check for unsafe deserialization (CWE-502). */
export function checkUnsafeDeserialization(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (/JSON\.parse\s*\(/.test(line) && !/try\s*\{/.test(line)) {
      let inTryBlock = false;
      for (let j = Math.max(0, i - 5); j < i; j++) {
        if (src[j]!.includes('try {')) inTryBlock = true;
      }
      if (!inTryBlock) {
        results.push(makeResult(
          'no-unsafe-deserialization', i + 1,
          `JSON.parse() used on potentially untrusted input without try/catch (CWE-502).`,
          `Wrap in try/catch: try { JSON.parse(data) } catch(e) { /* handle error */ }`,
        ));
      }
    }
  }

  return results;
}

/** Check for weak cryptographic algorithms (CWE-327). */
export function checkWeakCrypto(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const weakAlgs: Array<{ re: RegExp; name: string }> = [
    { re: /\bmd5\b/i, name: 'MD5' },
    { re: /\bsha1\b/i, name: 'SHA-1' },
    { re: /\bdes\b/i, name: 'DES' },
    { re: /\brc4\b/i, name: 'RC4' },
    { re: /\bcreateHash\s*\(\s*['"]md5['"]/i, name: 'MD5 hash' },
    { re: /\bcreateHash\s*\(\s*['"]sha1['"]/i, name: 'SHA-1 hash' },
    { re: /\becb\b/i, name: 'ECB mode' },
  ];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.trim().startsWith('//')) continue;

    for (const alg of weakAlgs) {
      if (alg.re.test(line)) {
        results.push(makeResult(
          'no-weak-crypto', i + 1,
          `Weak cryptographic algorithm "${alg.name}" detected (CWE-327).`,
          `Use strong algorithms: SHA-256, SHA-512, AES-GCM. For passwords: bcrypt, argon2, scrypt.`,
        ));
      }
    }
  }

  return results;
}

/** Check for insecure random number generation (CWE-330). */
export function checkInsecureRandom(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (/Math\.random\s*\(\)/.test(line)) {
      const contextStart = Math.max(0, i - 2);
      const contextEnd = Math.min(src.length, i + 3);
      const context = src.slice(contextStart, contextEnd).join(' ');
      if (/token|key|password|secret|crypto|auth/.test(context.toLowerCase())) {
        results.push(makeResult(
          'no-insecure-random', i + 1,
          `Math.random() used in security-sensitive context — not cryptographically secure (CWE-330).`,
          `Use crypto.randomBytes() or crypto.getRandomValues() for security purposes.`,
        ));
      }
    }
  }

  return results;
}

/** Check for hardcoded HTTP URLs (CWE-319). */
export function checkHttpUrl(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;

    const httpMatch = line.match(/['"`]http:\/\/[^'"]+['"`]/);
    if (httpMatch && !line.includes('http://localhost') && !line.includes('http://127.0.0.1')) {
      results.push(makeResult(
        'no-http-url', i + 1,
        `Hardcoded HTTP URL detected — should use HTTPS (CWE-319).`,
        `Replace "http://" with "https://" and verify the endpoint supports HTTPS.`,
      ));
    }
  }

  return results;
}

/** Check for debug statements in production code (CWE-489). */
export function checkDebugStatement(
  lines: string[] | null | undefined,
  filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];
  if (isTestFile(filePath)) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    if (/\bconsole\.log\b/.test(trimmed) && !trimmed.startsWith('//')) {
      results.push(makeResult(
        'no-debug-statement', i + 1,
        `console.log() in production code path (CWE-489).`,
        `Remove or replace with a proper logging library.`,
      ));
    }

    if (/\bconsole\.debug\b/.test(trimmed) && !trimmed.startsWith('//')) {
      results.push(makeResult(
        'no-debug-statement', i + 1,
        `console.debug() in production code path (CWE-489).`,
        `Use a proper logging library with configurable log levels.`,
      ));
    }

    if (/\bdebugger\b/.test(trimmed) && !trimmed.startsWith('//')) {
      results.push(makeResult(
        'no-debug-statement', i + 1,
        `debugger statement left in code (CWE-489).`,
        `Remove the debugger statement before committing.`,
      ));
    }
  }

  return results;
}

// ===========================================================================
// CATEGORY 3: PERFORMANCE (8 Checkers)
// ===========================================================================

/** Check for synchronous file system operations. */
export function checkNoSyncFs(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const syncOps = [
    'readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync',
    'mkdirSync', 'rmdirSync', 'readdirSync', 'unlinkSync', 'statSync',
    'lstatSync', 'readlinkSync', 'symlinkSync', 'chmodSync', 'chownSync',
    'copyFileSync', 'renameSync', 'truncateSync', 'utimesSync',
  ];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    for (const op of syncOps) {
      if (line.includes(op)) {
        results.push(makeResult(
          'no-sync-fs', i + 1,
          `Synchronous file operation "${op}" blocks the event loop.`,
          `Use the async version: ${op.replace('Sync', '')}() with await or callbacks.`,
        ));
      }
    }
  }

  return results;
}

/** Check for potentially expensive array spread operations. */
export function checkNoLargeArrayCopy(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (/\[\.\.\.(\w+)\]/.test(line)) {
      results.push(makeResult(
        'no-large-array-copy', i + 1,
        `Array spread creates a full copy — potentially expensive for large arrays.`,
        `Consider using Array.from() with a map function, or pass the array reference if mutation is acceptable.`,
      ));
    }
  }

  return results;
}

/** Check for potentially inefficient regular expressions. */
export function checkNoInefficientRegex(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const patterns = [
    { re: /\(\w\+\+\)\+/, msg: 'Nested quantifiers may cause catastrophic backtracking.' },
    { re: /\(\w\+\*\)\+/, msg: 'Nested quantifiers may cause exponential backtracking.' },
    { re: /\.\*\w\.\*/, msg: 'Greedy .* patterns can be optimized.' },
  ];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const regexMatch = line.match(/\/(.+?)\/[gimsuy]*/);
    if (regexMatch) {
      for (const pat of patterns) {
        if (pat.re.test(regexMatch[1]!)) {
          results.push(makeResult(
            'no-inefficient-regex', i + 1,
            `Inefficient regex pattern "${regexMatch[1]}" — ${pat.msg}`,
            `Rewrite with possessive quantifiers or character classes for better performance.`,
          ));
        }
      }
    }
  }

  return results;
}

/** Check for await inside loops. */
export function checkNoLoopAwait(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  let inLoop = false;
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    if (/^\s*(?:for\s*\(|while\s*\(|for\s+\().*/.test(trimmed)) {
      inLoop = true;
    }

    if (inLoop && /\bawait\b/.test(trimmed) && !trimmed.startsWith('//')) {
      results.push(makeResult(
        'no-loop-await', i + 1,
        `await inside a loop — operations execute sequentially.`,
        `Use Promise.all() to run operations concurrently: await Promise.all(items.map(fn))`,
      ));
    }

    if (inLoop && trimmed === '}') {
      inLoop = false;
    }
  }

  return results;
}

/** Check for redundant computation within a scope. */
export function checkNoRedundantComputation(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const exprMap = new Map<string, number[]>();

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    const callMatch = trimmed.match(/(\w+\.\w+\([^)]*\))/g);
    if (callMatch) {
      for (const call of callMatch) {
        const existing = exprMap.get(call) ?? [];
        existing.push(i + 1);
        exprMap.set(call, existing);
      }
    }
  }

  for (const [expr, lineNumbers] of exprMap) {
    if (lineNumbers.length > 1) {
      results.push(makeResult(
        'no-redundant-computation', lineNumbers[0]!,
        `"${expr}" computed ${lineNumbers.length} times — cache the result in a variable.`,
        `Cache the result: const result = ${expr};`,
      ));
    }
  }

  return results;
}

/** Check for potentially blocking operations. */
export function checkAvoidBlockingOperations(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (/\bwhile\s*\(\s*true\s*\)/.test(line)) {
      results.push(makeResult(
        'avoid-blocking-operations', i + 1,
        `Infinite loop pattern "while(true)" — will block the event loop.`,
        `Add a break condition or use setInterval/setTimeout for periodic tasks.`,
      ));
    }
  }

  return results;
}

/** Check for static imports of heavy modules — suggest lazy loading. */
export function checkPreferLazyLoading(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const heavyModules = [
    'lodash', 'moment', 'pdfkit', 'puppeteer', 'sharp',
    'three', 'd3', 'chart.js', 'echarts', 'playwright',
  ];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    for (const mod of heavyModules) {
      if ((line.includes(`'${mod}'`) || line.includes(`"${mod}"`)) &&
        /^import\s+/.test(line.trim())) {
        results.push(makeResult(
          'prefer-lazy-loading', i + 1,
          `Static import of heavy module "${mod}" increases startup time.`,
          `Use dynamic import(): const mod = await import('${mod}'). Only import when needed.`,
        ));
      }
    }
  }

  return results;
}

/** Check for N+1 query patterns. */
export function checkNoNPlusOne(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const queryPatterns = [
    /\.find\(/, /\.findOne\(/, /\.query\(/, /\.execute\(/,
    /\.fetch\(/, /\.get\(/,
  ];

  let inLoop = false;
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    if (/^\s*(?:for\s*\(|while\s*\(|\.forEach|\.map\s*\(|for\s+\().*/.test(trimmed)) {
      inLoop = true;
    }

    if (inLoop) {
      for (const pat of queryPatterns) {
        if (pat.test(trimmed)) {
          results.push(makeResult(
            'no-n-plus-one', i + 1,
            `Database query inside a loop — potential N+1 query problem.`,
            `Batch queries or use eager loading (e.g., .include() in Prisma, .populate() in Mongoose).`,
          ));
        }
      }
    }

    if (inLoop && (trimmed === '}' || trimmed === ');' || trimmed === ']))')) {
      inLoop = false;
    }
  }

  return results;
}

// ===========================================================================
// CATEGORY 4: MAINTAINABILITY (10 Checkers)
// ===========================================================================

/** Check for functions exceeding max line count (50 lines). */
export function checkMaxFunctionLines(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const threshold = 50;

  let inFunction = false;
  let funcStart = 0;
  let braceDepth = 0;
  let funcName = 'anonymous';

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?(?:static\s+)?function\s+(\w+)/);
    const arrowMatch = trimmed.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    const methodMatch = trimmed.match(/^\s*(?:public|private|protected|static|async)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*\{/);

    if (funcMatch || arrowMatch || methodMatch) {
      const name = funcMatch?.[1] ?? arrowMatch?.[1] ?? methodMatch?.[1] ?? 'function';
      if (!inFunction) {
        inFunction = true;
        funcStart = i;
        braceDepth = 0;
        funcName = name;
      }
    }

    if (inFunction) {
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      if (braceDepth === 0 && i > funcStart + 1) {
        const funcLines = i - funcStart + 1;
        if (funcLines > threshold) {
          results.push(makeResult(
            'max-function-lines', funcStart + 1,
            `Function "${funcName}" is ${funcLines} lines (threshold: ${threshold}).`,
            `Split "${funcName}" into smaller, focused functions by extracting logical blocks.`,
          ));
        }
        inFunction = false;
      }
    }
  }

  // Handle unclosed function at end of file
  if (inFunction) {
    const funcLines = src.length - funcStart;
    if (funcLines > threshold) {
      results.push(makeResult(
        'max-function-lines', funcStart + 1,
        `Function "${funcName}" is ${funcLines} lines (threshold: ${threshold}).`,
        `Split "${funcName}" into smaller, focused functions.`,
      ));
    }
  }

  return results;
}

/** Check for too many function parameters (>5). */
export function checkMaxParams(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const threshold = 5;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const paramMatch = line.match(/(?:function\s+\w+\s*|=>\s*|\w+\s*)\s*\(([^)]*)\)/);
    if (paramMatch) {
      const params = paramMatch[1]!
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p !== '...');
      if (params.length > threshold) {
        results.push(makeResult(
          'max-params', i + 1,
          `Function has ${params.length} parameters (threshold: ${threshold}).`,
          `Group related parameters into a configuration object: function fn({ a, b, c }: Config)`,
        ));
      }
    }
  }

  return results;
}

/** Check for excessive nesting depth (>4). */
export function checkMaxNestingDepth(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const threshold = 4;
  let cumulativeDepth = 0;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    let braces = 0;
    for (const ch of line) {
      if (ch === '{') braces++;
      if (ch === '}') braces--;
    }
    cumulativeDepth += braces;

    if (cumulativeDepth > threshold && braces > 0) {
      results.push(makeResult(
        'max-nesting-depth', i + 1,
        `Nesting depth ${cumulativeDepth} exceeds threshold ${threshold}.`,
        `Use early returns or extract nested logic into helper functions.`,
      ));
    }
  }

  return results;
}

/** Check for high cyclomatic complexity (>15). */
export function checkMaxCyclomaticComplexity(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const threshold = 15;

  let inFunction = false;
  let complexity = 1;
  let funcStart = 0;
  let braceDepth = 0;
  let funcName = 'anonymous';

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    const arrowMatch = trimmed.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);

    if (funcMatch && !inFunction) {
      inFunction = true;
      funcStart = i;
      complexity = 1;
      braceDepth = 0;
      funcName = funcMatch[1]!;
    } else if (arrowMatch && !inFunction) {
      inFunction = true;
      funcStart = i;
      complexity = 1;
      braceDepth = 0;
      funcName = arrowMatch[1]!;
    }

    if (inFunction) {
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      if (/\bif\b/.test(trimmed)) complexity++;
      if (/\belse\s+if\b/.test(trimmed)) complexity++;
      if (/\bcase\b/.test(trimmed)) complexity++;
      if (/\bdefault\s*:/.test(trimmed)) complexity++;
      if (/[\?&]{2}\|{2}/.test(trimmed)) complexity++;
      if (/\bfor\b/.test(trimmed)) complexity++;
      if (/\bwhile\b/.test(trimmed)) complexity++;
      if (/\bcatch\b/.test(trimmed)) complexity++;

      if (braceDepth === 0 && i > funcStart + 1) {
        if (complexity > threshold) {
          results.push(makeResult(
            'max-cyclomatic-complexity', funcStart + 1,
            `Function "${funcName}" has cyclomatic complexity ${complexity} (threshold: ${threshold}).`,
            `Refactor into smaller functions or use strategy pattern for branching logic.`,
          ));
        }
        inFunction = false;
      }
    }
  }

  return results;
}

/** Check for magic numbers without named constants. */
export function checkNoMagicNumbers(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const allowedNumbers = new Set([0, 1, 2, -1]);

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    if (trimmed.startsWith('const') || trimmed.startsWith('enum') || trimmed.startsWith('type') || trimmed.startsWith('import')) continue;

    const numMatch = line.match(/(?<!\w)(\d{4,})(?!\w)/g);
    if (numMatch) {
      for (const num of numMatch) {
        if (!allowedNumbers.has(Number(num))) {
          results.push(makeResult(
            'no-magic-numbers', i + 1,
            `Magic number ${num} used without a named constant.`,
            `Extract to a named constant: const MAX_RETRIES = ${num};`,
          ));
        }
      }
    }
  }

  return results;
}

/** Check for unresolved TODO/FIXME comments without ticket references. */
export function checkNoTodoFixme(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    if (
      (trimmed.includes('TODO') || trimmed.includes('FIXME')) &&
      !/#\d+|ISSUE-\d+|\[JIRA\]/i.test(trimmed)
    ) {
      const isFIXME = trimmed.includes('FIXME');
      results.push(makeResult(
        'no-todo-fixme', i + 1,
        `${isFIXME ? 'FIXME' : 'TODO'} comment without ticket reference: "${trimmed.slice(0, 100)}"`,
        `Add a ticket reference: // TODO(#123): description`,
      ));
    }
  }

  return results;
}

/** Check for inconsistent naming conventions. */
export function checkConsistentNaming(
  lines: string[] | null | undefined,
  filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    const classMatch = trimmed.match(/^(?:export\s+)?class\s+([a-z]\w+)/);
    if (classMatch) {
      results.push(makeResult(
        'consistent-naming', i + 1,
        `Class "${classMatch[1]}" should use PascalCase.`,
        `Rename to ${classMatch[1]![0]!.toUpperCase()}${classMatch[1]!.slice(1)}`,
      ));
    }

    const varMatch = trimmed.match(/^(?:const|let|var)\s+([A-Z][a-z]\w*)\s*=/);
    if (varMatch && !isTestFile(filePath)) {
      results.push(makeResult(
        'consistent-naming', i + 1,
        `Variable "${varMatch[1]}" starts with uppercase — should use camelCase.`,
        `Rename to ${varMatch[1]![0]!.toLowerCase()}${varMatch[1]!.slice(1)}`,
      ));
    }
  }

  return results;
}

/** Check for commented-out code blocks (dead code). */
export function checkNoDeadCode(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  let consecutiveCommentLines = 0;
  let startLine = 0;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    if (
      trimmed.startsWith('//') &&
      !trimmed.startsWith('// @') &&
      !trimmed.startsWith('// ===') &&
      !trimmed.startsWith('// ---')
    ) {
      if (consecutiveCommentLines === 0) startLine = i;
      consecutiveCommentLines++;
    } else {
      if (consecutiveCommentLines > 5) {
        results.push(makeResult(
          'no-dead-code', startLine + 1,
          `Block of ${consecutiveCommentLines} commented-out lines — dead code.`,
          `Remove the commented-out code. Use version control (git) to preserve history.`,
        ));
      }
      consecutiveCommentLines = 0;
    }
  }

  if (consecutiveCommentLines > 5) {
    results.push(makeResult(
      'no-dead-code', startLine + 1,
      `Block of ${consecutiveCommentLines} commented-out lines — dead code.`,
      `Remove the commented-out code.`,
    ));
  }

  return results;
}

/** Check for god class anti-patterns. */
export function checkNoGodClass(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const maxMethods = 20;
  const maxLines = 500;

  let inClass = false;
  let classStart = 0;
  let className = 'anonymous';
  let classDepth = 0;
  let methodCount = 0;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    const classMatch = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch && !inClass) {
      inClass = true;
      classStart = i;
      className = classMatch[1]!;
      classDepth = 0;
      methodCount = 0;
    }

    if (inClass) {
      for (const ch of line) {
        if (ch === '{') classDepth++;
        if (ch === '}') classDepth--;
      }

      if (
        /^\s*(?:public|private|protected|static)?\s*(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*\{/.test(trimmed) &&
        !trimmed.includes('constructor') &&
        classDepth <= 2
      ) {
        methodCount++;
      }

      if (classDepth === 0 && i > classStart + 1) {
        const classLines = i - classStart + 1;

        if (methodCount > maxMethods) {
          results.push(makeResult(
            'no-god-class', classStart + 1,
            `Class "${className}" has ${methodCount} methods (threshold: ${maxMethods}).`,
            `Split into smaller, focused classes following the Single Responsibility Principle.`,
          ));
        }

        if (classLines > maxLines) {
          results.push(makeResult(
            'no-god-class', classStart + 1,
            `Class "${className}" is ${classLines} lines (threshold: ${maxLines}).`,
            `Extract responsibilities into separate classes or modules.`,
          ));
        }

        inClass = false;
      }
    }
  }

  return results;
}

/** Check for deeply nested if-else — suggest early return pattern. */
export function checkPreferEarlyReturn(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  let consecutiveBranchLines = 0;
  let startBranch = 0;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    if (/\b(?:if\s*\(|else\s+if\s*\(|else\s*\{)/.test(trimmed) && !trimmed.startsWith('//')) {
      if (consecutiveBranchLines === 0) startBranch = i;
      consecutiveBranchLines++;
    } else if (trimmed === '}' || trimmed === '};') {
      if (consecutiveBranchLines >= 3) {
        results.push(makeResult(
          'prefer-early-return', startBranch + 1,
          `${consecutiveBranchLines} nested conditional branches — consider flattening with early returns.`,
          `Use guard clauses: if (!valid) return; // Continue with main logic`,
        ));
      }
      consecutiveBranchLines = 0;
    }
  }

  return results;
}

// ===========================================================================
// CATEGORY 5: STYLE (6 Checkers)
// ===========================================================================

/** Check for trailing whitespace. */
export function checkTrailingWhitespace(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.length > 0 && /[ \t]+$/.test(line)) {
      results.push(makeResult(
        'trailing-whitespace', i + 1,
        `Line ${i + 1} has trailing whitespace.`,
        `Remove trailing whitespace. Most editors can do this automatically on save.`,
      ));
    }
  }

  return results;
}

/** Check for console statements in production code. */
export function checkNoConsole(
  lines: string[] | null | undefined,
  filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];
  if (isTestFile(filePath)) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();

    if (/\bconsole\.(?:log|warn|error|info|debug|trace)\s*\(/.test(trimmed) && !trimmed.startsWith('//')) {
      const match = trimmed.match(/console\.(\w+)/);
      results.push(makeResult(
        'no-console', i + 1,
        `console.${match?.[1]} found in production code.`,
        `Replace with a proper logging library (e.g., winston, pino, log4js).`,
      ));
    }
  }

  return results;
}

/** Check for inconsistent quote styles. */
export function checkConsistentQuotes(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  let singleCount = 0;
  let doubleCount = 0;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const singleMatches = line.match(/'[^']*'/g);
    const doubleMatches = line.match(/"[^"]*"/g);
    if (singleMatches) singleCount += singleMatches.length;
    if (doubleMatches) doubleCount += doubleMatches.length;
  }

  if (singleCount > 0 && doubleCount > 0 && singleCount + doubleCount > 3) {
    results.push(makeResult(
      'consistent-quotes', 1,
      `Mixed quote styles: ${singleCount} single quotes, ${doubleCount} double quotes.`,
      `Standardize on ${singleCount > doubleCount ? 'single' : 'double'} quotes throughout the file.`,
    ));
  }

  return results;
}

/** Check for excessively long lines (>120 chars). */
export function checkNoLongLines(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];
  const maxLength = 120;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.trim().startsWith('import ')) continue;
    if (line.length > maxLength) {
      results.push(makeResult(
        'no-long-lines', i + 1,
        `Line is ${line.length} characters (threshold: ${maxLength}).`,
        `Break the line into multiple lines for readability.`,
      ));
    }
  }

  return results;
}

/** Check for inconsistent spacing around operators. */
export function checkSpacingConsistency(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    if (/[^ ]=[^=]/.test(trimmed) && !/[!=<>]==/.test(trimmed) && !/=>/.test(trimmed)) {
      results.push(makeResult(
        'spacing-consistency', i + 1,
        `Missing space around "=" operator.`,
        `Add spaces: "x = y" instead of "x=y".`,
      ));
    }
  }

  return results;
}

/** Check for missing file header comments. */
export function checkFileHeader(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const firstLine = src[0]!.trim();
  if (
    !firstLine.startsWith('//') &&
    !firstLine.startsWith('/*') &&
    !firstLine.startsWith('#') &&
    !firstLine.startsWith('"""') &&
    !firstLine.startsWith("'''")
  ) {
    results.push(makeResult(
      'file-header', 1,
      `File is missing a header comment describing its purpose.`,
      `Add a header comment: // @code-analyzer/<package> — <description>`,
    ));
  }

  return results;
}

// ===========================================================================
// CATEGORY 6: ARCHITECTURE (6 Checkers)
// ===========================================================================

/** Check for circular dependencies (requires graph context via review engine). */
export function checkNoCircularDeps(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  // Simple heuristic: check for import chains that reference back
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (line.includes('import ') && line.includes('../') && line.includes('*/')) {
      // Deep import jumping is a potential indicator
      const depthMatch = line.match(/\.\.\//g);
      if (depthMatch && depthMatch.length > 2) {
        results.push(makeResult(
          'no-circular-deps', i + 1,
          `Deep relative import with ${depthMatch.length} parent references — check for circular dependency.`,
          `Break the cycle by extracting shared types/interfaces into a separate module.`,
        ));
      }
    }
  }

  return results;
}

/** Check for layer import violations. */
export function checkNoLayerViolation(
  lines: string[] | null | undefined,
  filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  const layers: Record<string, number> = {
    'infra': 0,
    'data': 1,
    'domain': 2,
    'application': 3,
    'presentation': 4,
    'api': 4,
  };

  function getFileLayer(fp: string): string | null {
    const path = fp.toLowerCase();
    if (path.includes('/infra/')) return 'infra';
    if (path.includes('/data/') || path.includes('/repositories/')) return 'data';
    if (path.includes('/domain/') || path.includes('/models/') || path.includes('/entities/')) return 'domain';
    if (path.includes('/application/') || path.includes('/services/') || path.includes('/usecases/')) return 'application';
    if (path.includes('/presentation/') || path.includes('/api/') || path.includes('/controllers/')) return 'presentation';
    return null;
  }

  function getImportLayer(importPath: string): string | null {
    if (importPath.includes('/infra/')) return 'infra';
    if (importPath.includes('/data/') || importPath.includes('/repositories/')) return 'data';
    if (importPath.includes('/domain/') || importPath.includes('/models/')) return 'domain';
    if (importPath.includes('/application/') || importPath.includes('/services/')) return 'application';
    if (importPath.includes('/presentation/') || importPath.includes('/api/') || importPath.includes('/controllers/')) return 'presentation';
    return null;
  }

  const fileLayer = getFileLayer(filePath);
  if (fileLayer === null) return results;

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const importMatch = line.match(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const importPath = importMatch[1]!;
      const importLayer = getImportLayer(importPath);
      if (importLayer !== null) {
        const fileIdx = layers[fileLayer] ?? -1;
        const importIdx = layers[importLayer] ?? -1;
        if (importIdx > fileIdx) {
          results.push(makeResult(
            'no-layer-violation', i + 1,
            `Import from "${importPath}" violates layer boundaries: ${fileLayer} should not import from ${importLayer}.`,
            `Restructure imports to respect layer boundaries. Consider using interfaces for inversion.`,
          ));
        }
      }
    }
  }

  return results;
}

/** Check for barrel export anti-patterns. */
export function checkNoBarrelExport(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("export * from")) {
      results.push(makeResult(
        'no-barrel-export', i + 1,
        `Barrel export "export * from" — can cause circular dependencies.`,
        `Use explicit named exports: export { Foo, Bar } from './module'`,
      ));
    }
  }

  return results;
}

/** Check for potentially oversized modules (>30 outgoing dependencies). */
export function checkMaxModuleSize(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  // Heuristic: count import statements as a proxy for module size
  let importCount = 0;
  for (const line of src) {
    if (/^import\s+/.test(line.trim())) {
      importCount++;
    }
  }

  if (importCount > 30) {
    results.push(makeResult(
      'max-module-size', 1,
      `Module has ${importCount} import statements — may be too large.`,
      `Consider splitting into smaller, focused modules.`,
    ));
  }

  return results;
}

/** Check for cross-boundary access to internal/private modules. */
export function checkNoCrossBoundaryAccess(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    if (
      line.includes('import ') &&
      (line.includes('/internal/') || line.includes('/private/') || line.includes('/_'))
    ) {
      results.push(makeResult(
        'no-cross-boundary-access', i + 1,
        `Import from internal/private module — may cross module boundaries.`,
        `Use the module's public API. If the symbol should be accessible, consider making it part of the public interface.`,
      ));
    }
  }

  return results;
}

/** Check for concrete class instantiation where interface exists (missing abstraction). */
export function checkMissingAbstraction(
  lines: string[] | null | undefined,
  _filePath: string,
  _language: string,
): RuleCheckResult[] {
  const src = safeLines(lines);
  if (src.length === 0) return [];

  const results: RuleCheckResult[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const newMatch = line.match(/new\s+(\w+)\s*\(/);
    if (newMatch && newMatch[1]) {
      const className = newMatch[1]!;
      const hasInterface = src.some(
        (l) => l.includes(`interface I${className}`) || l.includes(`interface ${className.replace(/Impl$/, '')}`),
      );
      if (hasInterface) {
        results.push(makeResult(
          'missing-abstraction', i + 1,
          `Direct instantiation of "${className}" — consider using an interface/abstract class.`,
          `Use dependency injection with an interface type: constructor(private service: I${className})`,
        ));
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Master Checker Map
// ---------------------------------------------------------------------------

/** Map of rule IDs to their checker functions. */
export const CHECKER_MAP: Record<string, RuleChecker> = {
  // Correctness
  'no-undef': checkNoUndef,
  'no-duplicate-imports': checkNoDuplicateImports,
  'no-unreachable-code': checkNoUnreachableCode,
  'no-constant-condition': checkNoConstantCondition,
  'no-empty-catch': checkNoEmptyCatch,
  'no-unused-vars': checkNoUnusedVars,
  'no-unsafe-optional-chaining': checkNoUnsafeOptionalChaining,
  'no-array-index-key': checkNoArrayIndexKey,

  // Security
  'no-eval': checkNoEval,
  'no-sql-injection': checkSqlInjection,
  'no-xss': checkXss,
  'no-hardcoded-secrets': checkHardcodedSecrets,
  'no-command-injection': checkCommandInjection,
  'no-path-traversal': checkPathTraversal,
  'no-open-redirect': checkOpenRedirect,
  'no-unsafe-deserialization': checkUnsafeDeserialization,
  'no-weak-crypto': checkWeakCrypto,
  'no-insecure-random': checkInsecureRandom,
  'no-http-url': checkHttpUrl,
  'no-debug-statement': checkDebugStatement,

  // Performance
  'no-sync-fs': checkNoSyncFs,
  'no-large-array-copy': checkNoLargeArrayCopy,
  'no-inefficient-regex': checkNoInefficientRegex,
  'no-loop-await': checkNoLoopAwait,
  'no-redundant-computation': checkNoRedundantComputation,
  'avoid-blocking-operations': checkAvoidBlockingOperations,
  'prefer-lazy-loading': checkPreferLazyLoading,
  'no-n-plus-one': checkNoNPlusOne,

  // Maintainability
  'max-function-lines': checkMaxFunctionLines,
  'max-params': checkMaxParams,
  'max-nesting-depth': checkMaxNestingDepth,
  'max-cyclomatic-complexity': checkMaxCyclomaticComplexity,
  'no-magic-numbers': checkNoMagicNumbers,
  'no-todo-fixme': checkNoTodoFixme,
  'consistent-naming': checkConsistentNaming,
  'no-dead-code': checkNoDeadCode,
  'no-god-class': checkNoGodClass,
  'prefer-early-return': checkPreferEarlyReturn,

  // Style
  'trailing-whitespace': checkTrailingWhitespace,
  'no-console': checkNoConsole,
  'consistent-quotes': checkConsistentQuotes,
  'no-long-lines': checkNoLongLines,
  'spacing-consistency': checkSpacingConsistency,
  'file-header': checkFileHeader,

  // Architecture
  'no-circular-deps': checkNoCircularDeps,
  'no-layer-violation': checkNoLayerViolation,
  'no-barrel-export': checkNoBarrelExport,
  'max-module-size': checkMaxModuleSize,
  'no-cross-boundary-access': checkNoCrossBoundaryAccess,
  'missing-abstraction': checkMissingAbstraction,
};
