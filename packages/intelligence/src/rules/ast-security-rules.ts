// @code-analyzer/intelligence — AST-Aware Security Rule Checkers (v2)
// Security rules rewritten to use structured AST context with improved
// detection accuracy while maintaining backward-compatible output format.
// Uses AstRuleContext from ast-rule-checker.ts.

import type { RuleCheckResult } from './rule-runner.js';
import type { AstRuleContext } from './ast-rule-checker.js';
import {
  hasCall,
  findCalls,
  findStringLiterals,
  isTestFile,
} from './ast-rule-checker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mk(ruleId: string, line: number, message: string, suggestion?: string): RuleCheckResult {
  return { ruleId, line, message, suggestion };
}

/** Check if a line looks like a comment (safe to skip). */
function isComment(line: string): boolean {
  return /^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*\/\*/.test(line);
}

// ===========================================================================
// no-eval (CWE-95)
// ===========================================================================

export function checkNoEvalAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const call of ctx.calls) {
    if (call.name === 'eval') {
      r.push(mk('no-eval', call.line, 'CWE-95: Avoid using eval() — dynamic code execution is a security risk.', 'Use explicit code instead.'));
    }
  }

  // new Function() detection via string literals
  for (const s of ctx.strings) {
    if (/new\s+Function/.test(s.text)) {
      r.push(mk('no-eval', s.line, 'CWE-95: Avoid using new Function() — dynamic code execution is a security risk.', 'Use a proper function declaration.'));
    }
  }

  // Also check raw lines for new Function
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (/new\s+Function\s*\(/.test(line)) {
      r.push(mk('no-eval', i + 1, 'CWE-95: Avoid using new Function() — dynamic code execution is a security risk.', 'Use a proper function declaration.'));
    }
  }

  return r;
}

// ===========================================================================
// no-debug-statement
// ===========================================================================

export function checkNoDebugAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  // Skip debug checks in test files
  if (isTestFile(ctx.filePath)) return r;

  const debugMethods = ['log', 'debug', 'info', 'warn', 'error', 'trace', 'dir', 'table'];

  for (const call of ctx.calls) {
    if (call.object === 'console' && (debugMethods as string[]).includes(call.name)) {
      // Skip commented lines
      if (!isComment(ctx.lines[call.line - 1] ?? '')) {
        r.push(mk('no-debug-statement', call.line,
          `CWE-489: Remove \`console.${call.name}()\` before committing.`,
          'Use a proper logging framework for production code.',
        ));
      }
    }
  }

  // Bare debugger keyword
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (/\bdebugger\b/.test(line)) {
      r.push(mk('no-debug-statement', i + 1,
        'CWE-489: Remove `debugger` statement before committing.',
        'Use browser DevTools breakpoints instead.',
      ));
    }
  }

  return r;
}

// ===========================================================================
// no-xss (CWE-79)
// ===========================================================================

export function checkXssAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const xssSinks: Array<{ pattern: RegExp; msg: string; sug: string }> = [
    { pattern: /dangerouslySetInnerHTML/, msg: 'CWE-79: dangerouslySetInnerHTML may cause XSS.', sug: 'Use a sanitization library like DOMPurify.' },
    { pattern: /\.innerHTML\s*=/, msg: 'CWE-79: innerHTML assignment may cause XSS.', sug: 'Use textContent or createTextNode instead.' },
    { pattern: /document\.write\s*\(/, msg: 'CWE-79: document.write() may cause XSS.', sug: 'Use DOM manipulation methods instead.' },
    { pattern: /\.outerHTML\s*=/, msg: 'CWE-79: outerHTML assignment may cause XSS.', sug: 'Use textContent or createTextNode instead.' },
    { pattern: /insertAdjacentHTML\s*\(/, msg: 'CWE-79: insertAdjacentHTML() may cause XSS.', sug: 'Use a sanitization library.' },
  ];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    for (const sink of xssSinks) {
      if (sink.pattern.test(line)) {
        r.push(mk('no-xss', i + 1, sink.msg, sink.sug));
      }
    }
  }

  return r;
}

// ===========================================================================
// no-hardcoded-secrets (CWE-798)
// ===========================================================================

export function checkHardcodedSecretsAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const secretNamePattern = /(?:password|passwd|pwd|secret|api[_-]?key|api[_-]?secret|access[_-]?key|access[_-]?secret|token|auth[_-]?token|private[_-]?key|credential)/i;

  for (const a of ctx.assignments) {
    if (isComment(ctx.lines[a.line - 1] ?? '')) continue;
    if (secretNamePattern.test(a.name)) {
      const val = a.value.trim();
      const isEnvRef = val.includes('process.env') || val.includes('import.meta.env') ||
                       val.includes('Deno.env') || val === 'undefined' || val === 'null' || val.length < 4;
      if (!isEnvRef && (val.startsWith("'") || val.startsWith('"') || val.startsWith('`'))) {
        r.push(mk('no-hardcoded-secrets', a.line,
          `CWE-798: Hardcoded secret detected in variable \`${a.name}\`.`,
          'Use environment variables (process.env) or a secrets manager.',
        ));
      }
    }
  }

  // Also check for high-entropy-looking strings
  for (const s of ctx.strings) {
    if (/^[A-Za-z0-9+/=_-]{35,}$/.test(s.value) && !s.value.startsWith('http')) {
      r.push(mk('no-hardcoded-secrets', s.line,
        'CWE-798: Potential hardcoded secret/token detected.',
        'Use environment variables or a secrets manager.',
      ));
    }
  }

  return r;
}

// ===========================================================================
// no-sql-injection (CWE-89)
// ===========================================================================

export function checkSqlInjectionAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;

    // Template literal with SQL keywords + ${}
    if (/(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|query|execute)\b.*\$[\{\(]/.test(line)) {
      r.push(mk('no-sql-injection', i + 1,
        'CWE-89: SQL query built with string interpolation — potential SQL injection.',
        'Use parameterized queries (e.g., `$1`, `:name`) instead of string concatenation.',
      ));
      continue;
    }

    // String concatenation in SQL context
    if (/(?:SELECT|INSERT|UPDATE|DELETE)\b.*['"]\s*\+/.test(line)) {
      r.push(mk('no-sql-injection', i + 1,
        'CWE-89: SQL query uses string concatenation — potential SQL injection.',
        'Use parameterized queries or an ORM with safe query building.',
      ));
    }
  }

  return r;
}

// ===========================================================================
// no-command-injection (CWE-78)
// ===========================================================================

export function checkCommandInjectionAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;

    if (/(?:exec|spawn|execSync|execFile|execFileSync)\s*\(/.test(line)) {
      // Check if args contain template literals with variables or concatenation
      if (/\$\{/.test(line) || /['"]\s*\+/.test(line)) {
        r.push(mk('no-command-injection', i + 1,
          'CWE-78: Potential command injection — command string uses dynamic value.',
          'Use `spawn()` with argument arrays instead of string concatenation.',
        ));
      }
    }
  }

  return r;
}

// ===========================================================================
// no-path-traversal (CWE-22)
// ===========================================================================

export function checkPathTraversalAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;

    // fs operations with user input
    if (/fs\.(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|access|open|unlink|rmdir|mkdir)\s*\(/.test(line) &&
        /(?:req\.|request\.|params\.|query\.|body\.|\.\.\/)/.test(line)) {
      r.push(mk('no-path-traversal', i + 1,
        'CWE-22: Potential path traversal — file path may contain user-controlled input.',
        'Validate and sanitize file paths against an allowed base directory.',
      ));
      continue;
    }

    // path.join/resolve with user input
    if (/path\.(?:resolve|join|normalize)\s*\(/.test(line) &&
        /(?:req\.|request\.|params\.|query\.|body\.)/.test(line)) {
      r.push(mk('no-path-traversal', i + 1,
        'CWE-22: Path constructed from user-controlled input — potential path traversal.',
        'Validate user input before passing to path operations.',
      ));
    }
  }

  return r;
}

// ===========================================================================
// no-open-redirect (CWE-601)
// ===========================================================================

export function checkOpenRedirectAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;

    if (/(?:redirect|res\.redirect|response\.redirect|ctx\.redirect|reply\.redirect)\s*\(/.test(line) &&
        /(?:req\.|request\.|params\.|query\.|body\.)/.test(line)) {
      r.push(mk('no-open-redirect', i + 1,
        'CWE-601: Open redirect — URL uses user-controlled input.',
        'Validate redirect URLs against a whitelist of allowed destinations.',
      ));
    }
  }

  return r;
}

// ===========================================================================
// no-unsafe-deserialization (CWE-502)
// ===========================================================================

export function checkUnsafeDeserializationAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;

    if (/JSON\.parse\s*\(/.test(line) || /\.parse\s*\(/.test(line)) {
      // Check if surrounded by try/catch
      let inTry = false;
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (/try\s*\{/.test(ctx.lines[j]!)) {
          inTry = true;
          break;
        }
        if (/^[^/]*\}/.test(ctx.lines[j]!)) break;
      }

      if (!inTry) {
        r.push(mk('no-unsafe-deserialization', i + 1,
          'CWE-502: Deserialization without try/catch — may throw on malformed input.',
          'Wrap deserialization in a try/catch block to handle parse errors.',
        ));
      }
    }
  }

  return r;
}

// ===========================================================================
// no-weak-crypto (CWE-327)
// ===========================================================================

export function checkWeakCryptoAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const weakAlgos = ['md5', 'MD5', 'sha1', 'SHA1', 'des', 'DES', 'rc4', 'RC4', 'ecb', 'ECB'];

  // Check for createHash/createHmac/createCipher/etc calls
  for (const call of findCalls(ctx, /createHash|createHmac|createCipher|createDecipher|createSign/)) {
    const arg = call.arguments[0]?.replace(/['"`]/g, '') ?? '';
    if (weakAlgos.some((a) => arg.toLowerCase().includes(a.toLowerCase()))) {
      r.push(mk('no-weak-crypto', call.line,
        `CWE-327: Weak cryptographic algorithm \`${arg}\` — considered broken.`,
        'Use SHA-256, SHA-384, SHA-512, or AES-256-GCM instead.',
      ));
    }
  }

  // Also detect weak crypto function names as standalone identifiers
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    for (const algo of weakAlgos) {
      const regex = new RegExp(`\\b${algo}\\s*\\(`, 'i');
      if (regex.test(line)) {
        r.push(mk('no-weak-crypto', i + 1,
          `CWE-327: Weak cryptographic function \`${algo}()\` — considered broken.`,
          'Use SHA-256 or a modern cryptographic library.',
        ));
        break; // One violation per line
      }
    }
  }

  return r;
}

// ===========================================================================
// no-insecure-random (CWE-338)
// ===========================================================================

export function checkInsecureRandomAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const call of findCalls(ctx, /Math\.random/)) {
    // Check context — look for security keywords nearby
    const start = Math.max(0, call.line - 5);
    const end = Math.min(ctx.lines.length, call.line + 5);
    const context = ctx.lines.slice(start, end).join('\n');

    if (/(?:token|key|password|secret|auth|crypto|hash|salt|nonce|session|csrf)/i.test(context)) {
      r.push(mk('no-insecure-random', call.line,
        'CWE-330: Math.random() is not cryptographically secure.',
        'Use crypto.randomBytes() or crypto.getRandomValues() instead.',
      ));
    }
  }

  return r;
}

// ===========================================================================
// no-http-url
// ===========================================================================

export function checkHttpUrlAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const s of findStringLiterals(ctx, /^http:\/\//)) {
    // Skip commented lines
    if (isComment(ctx.lines[s.line - 1] ?? '')) continue;
    if (!s.value.includes('localhost') && !s.value.includes('127.0.0.1')) {
      r.push(mk('no-http-url', s.line,
        'CWE-319: Hardcoded HTTP URL detected — use HTTPS instead.',
        `Replace \`${s.text}\` with an HTTPS URL.`,
      ));
    }
  }

  return r;
}

// ===========================================================================
// no-unsafe-optional-chaining
// ===========================================================================

export function checkUnsafeOptionalChainingAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const seenFunctions = new Set<string>();

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;

    if (/\?\./.test(line) && !/^\s*(?:const|let|var|import|export|require)/.test(line)) {
      // Check if this has a null guard nearby
      const hasGuard =
        (i > 0 && /(?:!==?\s*(?:null|undefined)|===?\s*null|===?\s*undefined)/.test(ctx.lines[i - 1] ?? '')) ||
        (i < ctx.lines.length - 1 && /(?:!==?\s*(?:null|undefined)|===?\s*null|===?\s*undefined)/.test(ctx.lines[i + 1] ?? ''));

      if (!hasGuard) {
        // Only flag once per function scope
        const fn = ctx.functions.find((f) => i + 1 >= f.startLine && i + 1 <= f.endLine);
        const scopeKey = fn ? fn.name : `global:${Math.floor(i / 10)}`;

        if (!seenFunctions.has(scopeKey)) {
          seenFunctions.add(scopeKey);
          r.push(mk('no-unsafe-optional-chaining', i + 1,
            'Optional chaining (?.) may silently propagate undefined values.',
            'Add an explicit null/undefined check or handle the undefined case.',
          ));
        }
      }
    }
  }

  return r;
}
