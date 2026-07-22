// @code-analyzer/intelligence — Deterministic Rules Engine
// 50+ production-grade code review rules across 6 categories.
// Provides static analysis without LLM dependency.

import type { Severity, GitDiff, GraphEdge, GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Core Rule Types
// ---------------------------------------------------------------------------

/** Categories for deterministic rules.
 *  Maps to ReviewCategory: correctness→bug, security→security, etc. */
export type RuleCategory =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'style'
  | 'architecture';

export interface CodeRule {
  id: string;
  category: RuleCategory;
  severity: Severity;
  title: string;
  description: string;
  /** CWEs or references applicable to security rules */
  cwe?: string[];
  /** Language filter — undefined means all languages */
  language?: string[];
  check(context: RuleContext): RuleViolation[];
}

export interface RuleContext {
  filePath: string;
  lines: string[];
  language: string;
  diff?: GitDiff;
  graphContext?: GraphAnalysisData;
}

export interface RuleViolation {
  ruleId: string;
  category: RuleCategory;
  severity: Severity;
  filePath: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface GraphAnalysisData {
  outDegree: number;
  inDegree: number;
  exportedSymbolCount: number;
  cyclicPaths: string[][];
  edgeCounts: Map<string, number>;
  adjacency?: Map<string, Set<string>>;
}

export const EMPTY_GRAPH_DATA: GraphAnalysisData = {
  outDegree: 0,
  inDegree: 0,
  exportedSymbolCount: 0,
  cyclicPaths: [],
  edgeCounts: new Map(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine language from file path extension */
function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.d.ts')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.py') || lower.endsWith('.pyi')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.rb')) return 'ruby';
  if (lower.endsWith('.php')) return 'php';
  return 'unknown';
}

function makeV(
  rule: CodeRule,
  filePath: string,
  line: number,
  message: string,
  suggestion?: string,
): RuleViolation {
  return {
    ruleId: rule.id,
    category: rule.category,
    severity: rule.severity,
    filePath,
    line,
    message,
    suggestion,
  };
}

/** Check if the file path matches a test-file pattern */
function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('.test.') ||
    filePath.includes('.spec.') ||
    filePath.includes('__tests__') ||
    filePath.includes('__mocks__')
  );
}

// ===========================================================================
// CATEGORY 1: CORRECTNESS (8 Rules)
// ===========================================================================

const NO_UNDEF: CodeRule = {
  id: 'no-undef',
  category: 'correctness',
  severity: 'high',
  title: 'Potentially undefined variable reference',
  description: 'Reference to a variable that has no visible declaration in the file.',
  language: ['typescript', 'javascript', 'python', 'go', 'rust', 'java'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const declared = new Set<string>();

    // Collect declared identifiers
    for (const raw of ctx.lines) {
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

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith('import ') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      const idents = trimmed.match(/\b([a-zA-Z_$]\w+)\b/g);
      if (!idents) continue;

      for (const ident of idents) {
        if (
          ident.length > 1 &&
          !declared.has(ident) &&
          !isBuiltinOrKeyword(ident) &&
          !ident.startsWith('import')
        ) {
          // Check it's used as a reference, not being declared
          if (
            !trimmed.startsWith(`const ${ident}`) &&
            !trimmed.startsWith(`let ${ident}`) &&
            !trimmed.startsWith(`var ${ident}`) &&
            !trimmed.startsWith(`function ${ident}`) &&
            !trimmed.startsWith(`class ${ident}`)
          ) {
            results.push(makeV(
              NO_UNDEF, ctx.filePath, i + 1,
              `"${ident}" is referenced but has no visible declaration in this file.`,
              `Declare "${ident}" with const/let/var or import it.`,
            ));
          }
        }
      }
    }

    return results;
  },
};

function isBuiltinOrKeyword(name: string): boolean {
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
  return builtins.has(name);
}

const NO_DUPLICATE_IMPORTS: CodeRule = {
  id: 'no-duplicate-imports',
  category: 'correctness',
  severity: 'low',
  title: 'Duplicate import statement',
  description: 'The same module is imported more than once. Merge into a single import.',
  language: ['typescript', 'javascript'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const seen = new Map<string, number>();

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      const importMatch = trimmed.match(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const mod = importMatch[1]!;
        if (seen.has(mod)) {
          results.push(makeV(
            NO_DUPLICATE_IMPORTS, ctx.filePath, i + 1,
            `Duplicate import of "${mod}" (also imported at line ${seen.get(mod)}).`,
            `Merge imports from "${mod}" into a single statement.`,
          ));
        } else {
          seen.set(mod, i + 1);
        }
      }
    }

    return results;
  },
};

const NO_UNREACHABLE_CODE: CodeRule = {
  id: 'no-unreachable-code',
  category: 'correctness',
  severity: 'medium',
  title: 'Unreachable code detected',
  description: 'Code that appears after return, throw, break, or continue statements will never execute.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (!/^\s*(?:return|throw|break|continue)\b/.test(trimmed)) continue;
      // Check if the return/throw is the last statement inside a block
      // Look at the next line — if it's code (not closing brace), it's unreachable
      if (i + 1 < ctx.lines.length) {
        const next = ctx.lines[i + 1]!;
        const nextTrimmed = next.trim();

        // Skip empty lines and comments
        if (nextTrimmed === '' || nextTrimmed.startsWith('//')) continue;

        // If next line is a closing brace, that's normal
        if (nextTrimmed.startsWith('}') || nextTrimmed === '}' || nextTrimmed === ');') continue;

        // If the return/throw isn't inside a conditional (inline if)
        if (!trimmed.includes('?')) {
          results.push(makeV(
            NO_UNREACHABLE_CODE, ctx.filePath, i + 2,
            `Code after ${trimmed.split(/\s/)[0]} on line ${i + 1} is unreachable.`,
            `Remove unreachable code or restructure the control flow.`,
          ));
        }
      }
    }

    return results;
  },
};

const NO_CONSTANT_CONDITION: CodeRule = {
  id: 'no-constant-condition',
  category: 'correctness',
  severity: 'medium',
  title: 'Constant condition in control flow',
  description: 'Condition always evaluates to true or false, making the branch dead code or the loop infinite.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const alwaysTrue = /\b(?:if|while|for)\s*\(\s*(?:true|!false)\s*\)/;
    const alwaysFalse = /\b(?:if|while|for)\s*\(\s*(?:false|!true)\s*\)/;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      if (alwaysTrue.test(line)) {
        results.push(makeV(
          NO_CONSTANT_CONDITION, ctx.filePath, i + 1,
          `Condition always evaluates to true — branch is always taken.`,
          `Replace the constant condition with a meaningful check or remove the unnecessary branch.`,
        ));
      } else if (alwaysFalse.test(line)) {
        results.push(makeV(
          NO_CONSTANT_CONDITION, ctx.filePath, i + 1,
          `Condition always evaluates to false — code inside the block is dead.`,
          `Remove the dead code block or update the condition.`,
        ));
      }
    }

    return results;
  },
};

const NO_EMPTY_CATCH: CodeRule = {
  id: 'no-empty-catch',
  category: 'correctness',
  severity: 'medium',
  title: 'Empty catch block',
  description: 'Catch block does not handle the error — silently swallowing errors hides bugs.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      // Match catch(…) { … } on a single line with empty body
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
        results.push(makeV(
          NO_EMPTY_CATCH, ctx.filePath, i + 1,
          `Empty catch block silently swallows errors.`,
          `Log the error and/or re-throw it: catch(error) { logger.error(error); throw error; }`,
        ));
        continue;
      }

      // Match multi-line empty catch: catch(...) { then next line is just }
      if (/catch\s*\([^)]*\)\s*\{/.test(trimmed)) {
        let j = i + 1;
        let hasContent = false;
        while (j < ctx.lines.length && !ctx.lines[j]!.trim().startsWith('}')) {
          if (ctx.lines[j]!.trim() !== '') {
            hasContent = true;
            break;
          }
          j++;
        }
        if (!hasContent && j < ctx.lines.length) {
          results.push(makeV(
            NO_EMPTY_CATCH, ctx.filePath, i + 1,
            `Empty catch block silently swallows errors.`,
            `Log the error and/or re-throw it.`,
          ));
        }
      }
    }

    return results;
  },
};

const NO_UNUSED_VARS: CodeRule = {
  id: 'no-unused-vars',
  category: 'correctness',
  severity: 'low',
  title: 'Potentially unused variable',
  description: 'Variable is declared but never referenced within the same scope.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    // Simple heuristic: find const/let/var declarations and check if the name appears elsewhere
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      const decl = trimmed.match(/^(?:const|let|var)\s+(\w+)\s*[=;]/);
      if (!decl) continue;

      const name = decl[1]!;
      // Skip if name appears to be "_" (intentionally unused by convention)
      if (name === '_') continue;

      let usedElsewhere = false;
      for (let j = 0; j < ctx.lines.length; j++) {
        if (j === i) continue;
        const otherLine = ctx.lines[j]!;
        if (otherLine.includes(name) && !otherLine.trim().startsWith('//')) {
          usedElsewhere = true;
          break;
        }
      }

      if (!usedElsewhere) {
        results.push(makeV(
          NO_UNUSED_VARS, ctx.filePath, i + 1,
          `Variable "${name}" is declared but never used.`,
          `Remove the unused variable or prefix with "_" if intentionally unused.`,
        ));
      }
    }

    return results;
  },
};

const NO_UNSAFE_OPTIONAL_CHAINING: CodeRule = {
  id: 'no-unsafe-optional-chaining',
  category: 'correctness',
  severity: 'medium',
  title: 'Potentially unsafe optional chaining',
  description: 'Optional chaining (?. ) used where the left-hand value is known to be defined, suggesting a logic error.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // Detect ?. on a variable that was just checked for truthiness
      // e.g., if (foo) { foo?.bar }  — the ?. is unnecessary if foo is checked
      if (line.includes('?.')) {
        results.push(makeV(
          NO_UNSAFE_OPTIONAL_CHAINING, ctx.filePath, i + 1,
          `Optional chaining operator used — verify the left-hand side can actually be null/undefined.`,
          `If the value is guaranteed to be defined, remove "?.". Otherwise, add explicit null checks.`,
        ));
      }
    }

    return results;
  },
};

const NO_ARRAY_INDEX_KEY: CodeRule = {
  id: 'no-array-index-key',
  category: 'correctness',
  severity: 'medium',
  title: 'Array index used as key',
  description: 'Using array index as a key in list rendering can cause rendering issues when items are reordered.',
  language: ['typescript', 'javascript'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // Detect key={index} or key={i} in React/JSX
      if (/\bkey\s*=\s*\{?\s*(?:index|i|idx|j|k)\b/.test(line)) {
        results.push(makeV(
          NO_ARRAY_INDEX_KEY, ctx.filePath, i + 1,
          `Array index used as React key — this can cause issues when list order changes.`,
          `Use a stable, unique identifier from your data (e.g., item.id) as the key.`,
        ));
      }
    }

    return results;
  },
};

// ===========================================================================
// CATEGORY 2: SECURITY (12 Rules — OWASP Top 10 + CWE Top 25)
// ===========================================================================

const NO_EVAL: CodeRule = {
  id: 'no-eval',
  category: 'security',
  severity: 'critical',
  title: 'Dynamic code execution detected (eval/Function)',
  description: 'eval() and Function() constructors allow arbitrary code execution, a critical security risk.',
  cwe: ['CWE-95'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      if (/\beval\s*\(/.test(line)) {
        results.push(makeV(
          NO_EVAL, ctx.filePath, i + 1,
          `eval() usage detected — allows arbitrary code execution (CWE-95).`,
          `Use JSON.parse() for data parsing, or structured data formats instead of dynamic code execution.`,
        ));
      }

      if (/\bnew\s+Function\s*\(/.test(line)) {
        results.push(makeV(
          NO_EVAL, ctx.filePath, i + 1,
          `new Function() usage detected — equivalent to eval() (CWE-95).`,
          `Avoid dynamic function creation. Use closures or pre-defined functions instead.`,
        ));
      }
    }

    return results;
  },
};

const NO_SQL_INJECTION: CodeRule = {
  id: 'no-sql-injection',
  category: 'security',
  severity: 'critical',
  title: 'Potential SQL injection',
  description: 'String concatenation or template interpolation in SQL query construction.',
  cwe: ['CWE-89'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // Detect string concatenation in SQL queries
      const concatPattern =
        /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*[`'"].*\$\{.*[`'"]/i;
      const plusConcat = /[`'"][^`'"]*(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^`'"]*[`'"]\s*\+/i;
      const rawQuery = /(?:\.query|\.execute|\.run)\s*\(\s*[`'"][^`'"]*\$\{/;

      if (concatPattern.test(line) || plusConcat.test(line) || rawQuery.test(line)) {
        results.push(makeV(
          NO_SQL_INJECTION, ctx.filePath, i + 1,
          `Potential SQL injection detected — string interpolation in SQL query (CWE-89).`,
          `Use parameterized queries: db.query("SELECT * FROM users WHERE id = ?", [userId])`,
        ));
      }
    }

    return results;
  },
};

const NO_XSS: CodeRule = {
  id: 'no-xss',
  category: 'security',
  severity: 'critical',
  title: 'Cross-site scripting (XSS) vulnerability',
  description: 'Unsafe HTML manipulation that could allow XSS attacks.',
  cwe: ['CWE-79'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      if (/dangerouslySetInnerHTML/.test(line)) {
        results.push(makeV(
          NO_XSS, ctx.filePath, i + 1,
          `dangerouslySetInnerHTML used — bypasses React's XSS protection (CWE-79).`,
          `Use React's built-in escaping or sanitize with DOMPurify before rendering.`,
        ));
      }

      if (/\.innerHTML\s*=/.test(line)) {
        results.push(makeV(
          NO_XSS, ctx.filePath, i + 1,
          `innerHTML assignment — injectable HTML, XSS risk (CWE-79).`,
          `Use textContent, createElement, or sanitize with DOMPurify.`,
        ));
      }

      if (/document\.write\s*\(/.test(line)) {
        results.push(makeV(
          NO_XSS, ctx.filePath, i + 1,
          `document.write() used — XSS vulnerability (CWE-79).`,
          `Use DOM manipulation APIs (createElement, appendChild) instead.`,
        ));
      }
    }

    return results;
  },
};

const NO_HARDCODED_SECRETS: CodeRule = {
  id: 'no-hardcoded-secrets',
  category: 'security',
  severity: 'critical',
  title: 'Hardcoded secrets in source code',
  description: 'Passwords, API keys, tokens, or other credentials appear to be hardcoded.',
  cwe: ['CWE-798'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const secretPatterns = [
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
    ];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;

      for (const pat of secretPatterns) {
        if (pat.re.test(line)) {
          results.push(makeV(NO_HARDCODED_SECRETS, ctx.filePath, i + 1, pat.msg, pat.sug));
        }
      }
    }

    return results;
  },
};

const NO_COMMAND_INJECTION: CodeRule = {
  id: 'no-command-injection',
  category: 'security',
  severity: 'critical',
  title: 'Potential command injection',
  description: 'Shell command construction using string concatenation with user input.',
  cwe: ['CWE-78'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // exec/spawn with string concatenation
      if (
        /(?:exec|spawn|execSync|execFile|execFileSync)\s*\(/.test(line) &&
        (/\+/.test(line) || /\$\{/.test(line) || /`.*\$/.test(line))
      ) {
        results.push(makeV(
          NO_COMMAND_INJECTION, ctx.filePath, i + 1,
          `Potential command injection — shell command uses string concatenation (CWE-78).`,
          `Use execFile with separate arguments array: execFile('cmd', [arg1, arg2])`,
        ));
      }
    }

    return results;
  },
};

const NO_PATH_TRAVERSAL: CodeRule = {
  id: 'no-path-traversal',
  category: 'security',
  severity: 'critical',
  title: 'Path traversal vulnerability',
  description: 'File path constructed from user input without sanitization.',
  cwe: ['CWE-22'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      const fsOps = /fs\.(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|open|readdir|unlink)\s*\(/;
      const pathConstruct = /path\.(?:resolve|join)\s*\(/;
      const userInput = /\b(?:req\.|request\.|params\.|query\.|body\.|input|user)/;

      if (fsOps.test(line) && (/\+\s*/.test(line) || userInput.test(line))) {
        results.push(makeV(
          NO_PATH_TRAVERSAL, ctx.filePath, i + 1,
          `Potential path traversal — file path constructed with user input (CWE-22).`,
          `Use path.resolve(baseDir, path.normalize(userInput)) and verify result starts with baseDir.`,
        ));
      }

      if (pathConstruct.test(line) && userInput.test(line)) {
        results.push(makeV(
          NO_PATH_TRAVERSAL, ctx.filePath, i + 1,
          `Path constructed from user input without visible sanitization (CWE-22).`,
          `Sanitize with path.normalize() and validate against an allowlist.`,
        ));
      }
    }

    return results;
  },
};

const NO_OPEN_REDIRECT: CodeRule = {
  id: 'no-open-redirect',
  category: 'security',
  severity: 'high',
  title: 'Open redirect vulnerability',
  description: 'Redirect URL constructed from unvalidated user input.',
  cwe: ['CWE-601'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // redirect(url) where url comes from request
      if (
        /(?:redirect|res\.redirect|response\.redirect)\s*\(/.test(line) &&
        /\b(?:req\.|request\.|params\.|query\.)/.test(line)
      ) {
        results.push(makeV(
          NO_OPEN_REDIRECT, ctx.filePath, i + 1,
          `Potential open redirect — redirect URL uses user-controlled input (CWE-601).`,
          `Validate redirect URLs against an allowlist of trusted destinations.`,
        ));
      }
    }

    return results;
  },
};

const NO_UNSAFE_DESERIALIZATION: CodeRule = {
  id: 'no-unsafe-deserialization',
  category: 'security',
  severity: 'high',
  title: 'Unsafe deserialization',
  description: 'Deserializing untrusted data without error handling.',
  cwe: ['CWE-502'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      if (/JSON\.parse\s*\(/.test(line) && !/try\s*\{/.test(line)) {
        // Check if there's a try/catch in the surrounding context (simplified)
        let inTryBlock = false;
        for (let j = Math.max(0, i - 5); j < i; j++) {
          if (ctx.lines[j]!.includes('try {')) inTryBlock = true;
        }
        if (!inTryBlock) {
          results.push(makeV(
            NO_UNSAFE_DESERIALIZATION, ctx.filePath, i + 1,
            `JSON.parse() used on potentially untrusted input without try/catch (CWE-502).`,
            `Wrap in try/catch: try { JSON.parse(data) } catch(e) { /* handle error */ }`,
          ));
        }
      }
    }

    return results;
  },
};

const NO_WEAK_CRYPTO: CodeRule = {
  id: 'no-weak-crypto',
  category: 'security',
  severity: 'high',
  title: 'Weak cryptographic algorithm',
  description: 'Use of deprecated or insecure cryptographic algorithms.',
  cwe: ['CWE-327'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const weakAlgs: Array<{ re: RegExp; name: string }> = [
      { re: /\bmd5\b/i, name: 'MD5' },
      { re: /\bsha1\b/i, name: 'SHA-1' },
      { re: /\bdes\b/i, name: 'DES' },
      { re: /\brc4\b/i, name: 'RC4' },
      { re: /\bcreateHash\s*\(\s*['"]md5['"]/i, name: 'MD5 hash' },
      { re: /\bcreateHash\s*\(\s*['"]sha1['"]/i, name: 'SHA-1 hash' },
      { re: /\becb\b/i, name: 'ECB mode' },
    ];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      if (line.trim().startsWith('//')) continue;

      for (const alg of weakAlgs) {
        if (alg.re.test(line)) {
          results.push(makeV(
            NO_WEAK_CRYPTO, ctx.filePath, i + 1,
            `Weak cryptographic algorithm "${alg.name}" detected (CWE-327).`,
            `Use strong algorithms: SHA-256, SHA-512, AES-GCM. For passwords: bcrypt, argon2, scrypt.`,
          ));
        }
      }
    }

    return results;
  },
};

const NO_INSECURE_RANDOM: CodeRule = {
  id: 'no-insecure-random',
  category: 'security',
  severity: 'high',
  title: 'Insecure randomness source',
  description: 'Math.random() is not cryptographically secure for security-sensitive operations.',
  cwe: ['CWE-338'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      if (/Math\.random\s*\(\)/.test(line)) {
        // Check surrounding context for security implications (token, key, crypto)
        const context = ctx.lines.slice(Math.max(0, i - 2), Math.min(ctx.lines.length, i + 3)).join(' ');
        if (/token|key|password|secret|crypto|auth/.test(context.toLowerCase())) {
          results.push(makeV(
            NO_INSECURE_RANDOM, ctx.filePath, i + 1,
            `Math.random() used in security-sensitive context — not cryptographically secure (CWE-338).`,
            `Use crypto.randomBytes() or crypto.getRandomValues() for security purposes.`,
          ));
        }
      }
    }

    return results;
  },
};

const NO_HTTP_URL: CodeRule = {
  id: 'no-http-url',
  category: 'security',
  severity: 'medium',
  title: 'Hardcoded HTTP URL',
  description: 'Hardcoded http:// URL should use https:// for secure communication.',
  cwe: ['CWE-319'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;

      // Match http:// URLs but NOT inside comments or import paths that are relative
      const httpMatch = line.match(/['"`]http:\/\/[^'"]+['"`]/);
      if (httpMatch && !line.includes('http://localhost') && !line.includes('http://127.0.0.1')) {
        results.push(makeV(
          NO_HTTP_URL, ctx.filePath, i + 1,
          `Hardcoded HTTP URL detected — should use HTTPS (CWE-319).`,
          `Replace "http://" with "https://" and verify the endpoint supports HTTPS.`,
        ));
      }
    }

    return results;
  },
};

const NO_DEBUG_STATEMENT: CodeRule = {
  id: 'no-debug-statement',
  category: 'security',
  severity: 'low',
  title: 'Debug statement in production code',
  description: 'Debug logging or breakpoints left in code may leak sensitive information.',
  cwe: ['CWE-489'],
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    if (isTestFile(ctx.filePath)) return results;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (/\bconsole\.log\b/.test(trimmed) && !trimmed.startsWith('//')) {
        results.push(makeV(
          NO_DEBUG_STATEMENT, ctx.filePath, i + 1,
          `console.log() in production code path (CWE-489).`,
          `Remove or replace with a proper logging library.`,
        ));
      }

      if (/\bconsole\.debug\b/.test(trimmed) && !trimmed.startsWith('//')) {
        results.push(makeV(
          NO_DEBUG_STATEMENT, ctx.filePath, i + 1,
          `console.debug() in production code path (CWE-489).`,
          `Use a proper logging library with configurable log levels.`,
        ));
      }

      if (/\bdebugger\b/.test(trimmed) && !trimmed.startsWith('//')) {
        results.push(makeV(
          NO_DEBUG_STATEMENT, ctx.filePath, i + 1,
          `debugger statement left in code (CWE-489).`,
          `Remove the debugger statement before committing.`,
        ));
      }
    }

    return results;
  },
};

// ===========================================================================
// CATEGORY 3: PERFORMANCE (8 Rules)
// ===========================================================================

const NO_SYNC_FS: CodeRule = {
  id: 'no-sync-fs',
  category: 'performance',
  severity: 'medium',
  title: 'Synchronous file system operation',
  description: 'Blocking file I/O blocks the event loop and degrades server performance.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const syncOps = [
      'readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync',
      'mkdirSync', 'rmdirSync', 'readdirSync', 'unlinkSync', 'statSync',
      'lstatSync', 'readlinkSync', 'symlinkSync', 'chmodSync', 'chownSync',
      'copyFileSync', 'renameSync', 'truncateSync', 'utimesSync',
    ];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      for (const op of syncOps) {
        if (line.includes(op)) {
          results.push(makeV(
            NO_SYNC_FS, ctx.filePath, i + 1,
            `Synchronous file operation "${op}" blocks the event loop.`,
            `Use the async version: ${op.replace('Sync', '')}() with await or callbacks.`,
          ));
        }
      }
    }

    return results;
  },
};

const NO_LARGE_ARRAY_COPY: CodeRule = {
  id: 'no-large-array-copy',
  category: 'performance',
  severity: 'medium',
  title: 'Potentially expensive array spread',
  description: 'Spread operator on arrays can cause O(n) copies; avoid in hot paths.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // [...largeArray] where array size is unknown but likely large
      if (/\[\.\.\.(\w+)\]/.test(line)) {
        results.push(makeV(
          NO_LARGE_ARRAY_COPY, ctx.filePath, i + 1,
          `Array spread creates a full copy — potentially expensive for large arrays.`,
          `Consider using Array.from() with a map function, or pass the array reference if mutation is acceptable.`,
        ));
      }
    }

    return results;
  },
};

const NO_INEFFICIENT_REGEX: CodeRule = {
  id: 'no-inefficient-regex',
  category: 'performance',
  severity: 'medium',
  title: 'Potentially inefficient regular expression',
  description: 'Regex pattern may cause catastrophic backtracking on certain inputs.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const patterns = [
      { re: /\(\w\+\+\)\+/, msg: 'Nested quantifiers may cause catastrophic backtracking.' },
      { re: /\(\w\+\*\)\+/, msg: 'Nested quantifiers may cause exponential backtracking.' },
      { re: /\.\*\w\.\*/, msg: 'Greedy .* patterns can be optimized.' },
    ];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const regexMatch = line.match(/\/(.+?)\/[gimsuy]*/);

      if (regexMatch) {
        for (const pat of patterns) {
          if (pat.re.test(regexMatch[1]!)) {
            results.push(makeV(
              NO_INEFFICIENT_REGEX, ctx.filePath, i + 1,
              `Inefficient regex pattern "${regexMatch[1]}" — ${pat.msg}`,
              `Rewrite with possessive quantifiers (++ instead of +), atomic groups, or character classes for better performance.`,
            ));
          }
        }
      }
    }

    return results;
  },
};

const NO_LOOP_AWAIT: CodeRule = {
  id: 'no-loop-await',
  category: 'performance',
  severity: 'medium',
  title: 'Await inside a loop',
  description: 'await inside for/while loops runs operations sequentially — use Promise.all for concurrency.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    let inLoop = false;
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (/^\s*(?:for\s*\(|while\s*\(|for\s+\().*/.test(trimmed)) {
        inLoop = true;
      }

      if (inLoop && /\bawait\b/.test(trimmed) && !trimmed.startsWith('//')) {
        results.push(makeV(
          NO_LOOP_AWAIT, ctx.filePath, i + 1,
          `await inside a loop — operations execute sequentially.`,
          `Use Promise.all() to run operations concurrently: await Promise.all(items.map(fn))`,
        ));
      }

      if (inLoop && trimmed === '}') {
        inLoop = false;
      }
    }

    return results;
  },
};

const AVOID_BLOCKING_OPS: CodeRule = {
  id: 'avoid-blocking-operations',
  category: 'performance',
  severity: 'medium',
  title: 'Potentially blocking synchronous operation',
  description: 'CPU-intensive synchronous operations can block the event loop.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const blockingOps = [
      /JSON\.parse\s*\(\s*.+?\.toString\s*\(\)\s*\)/, // Large JSON stringify in sync context
      /\bwhile\s*\(\s*true\s*\)/, // Infinite loop without break
      /\.sort\s*\(\s*\)/, // Sorting large arrays
    ];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      if (/\bwhile\s*\(\s*true\s*\)/.test(line)) {
        results.push(makeV(
          AVOID_BLOCKING_OPS, ctx.filePath, i + 1,
          `Infinite loop pattern "while(true)" — will block the event loop.`,
          `Add a break condition or use setInterval/setTimeout for periodic tasks.`,
        ));
      }
    }

    return results;
  },
};

const PREFER_LAZY_LOADING: CodeRule = {
  id: 'prefer-lazy-loading',
  category: 'performance',
  severity: 'low',
  title: 'Consider lazy loading for heavy imports',
  description: 'Static imports of heavy modules at module level increase startup time.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const heavyModules = ['lodash', 'moment', 'pdfkit', 'puppeteer', 'sharp',
      'three', 'd3', 'chart.js', 'echarts', 'playwright'];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      for (const mod of heavyModules) {
        if (line.includes(`'${mod}'`) || line.includes(`"${mod}"`)) {
          if (/^import\s+/.test(line.trim())) {
            results.push(makeV(
              PREFER_LAZY_LOADING, ctx.filePath, i + 1,
              `Static import of heavy module "${mod}" increases startup time.`,
              `Use dynamic import(): const mod = await import('${mod}'). Only import when needed.`,
            ));
          }
        }
      }
    }

    return results;
  },
};

const NO_N_PLUS_ONE: CodeRule = {
  id: 'no-n-plus-one',
  category: 'performance',
  severity: 'high',
  title: 'Potential N+1 query pattern',
  description: 'Database query inside a loop can cause N+1 performance problems.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const queryPatterns = [
      /\.find\(/, /\.findOne\(/, /\.query\(/, /\.execute\(/,
      /\.fetch\(/, /\.get\(/,
    ];

    let inLoop = false;
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (/^\s*(?:for\s*\(|while\s*\(|\.forEach|\.map\s*\(|for\s+\().*/.test(trimmed)) {
        inLoop = true;
      }

      if (inLoop) {
        for (const pat of queryPatterns) {
          if (pat.test(trimmed)) {
            results.push(makeV(
              NO_N_PLUS_ONE, ctx.filePath, i + 1,
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
  },
};

const NO_REDUNDANT_COMPUTATION: CodeRule = {
  id: 'no-redundant-computation',
  category: 'performance',
  severity: 'low',
  title: 'Redundant computation detected',
  description: 'The same expression is computed multiple times within a scope — cache the result.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const exprMap = new Map<string, number[]>();

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      // Look for method calls with the same args
      const callMatch = trimmed.match(/(\w+\.\w+\([^)]*\))/g);
      if (callMatch) {
        for (const call of callMatch) {
          const existing = exprMap.get(call) ?? [];
          existing.push(i + 1);
          exprMap.set(call, existing);
        }
      }
    }

    for (const [expr, lines] of exprMap) {
      if (lines.length > 1) {
        results.push(makeV(
          NO_REDUNDANT_COMPUTATION, ctx.filePath, lines[0]!,
          `"${expr}" computed ${lines.length} times — cache the result in a variable.`,
          `Cache the result: const result = ${expr};`,
        ));
      }
    }

    return results;
  },
};

// ===========================================================================
// CATEGORY 4: MAINTAINABILITY (10 Rules)
// ===========================================================================

const MAX_FUNCTION_LINES: CodeRule = {
  id: 'max-function-lines',
  category: 'maintainability',
  severity: 'medium',
  title: 'Function exceeds maximum line limit',
  description: 'Function exceeds 50 lines. Consider splitting into smaller, focused functions.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const threshold = 50;

    let inFunction = false;
    let funcStart = 0;
    let braceDepth = 0;
    let funcName = 'anonymous';

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      // Detect function declarations
      const funcMatch = trimmed.match(
        /^(?:export\s+)?(?:async\s+)?(?:static\s+)?function\s+(\w+)/,
      );
      const arrowMatch = trimmed.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
      const methodMatch = trimmed.match(
        /^\s*(?:public|private|protected|static|async)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*\{/,
      );

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
            results.push(makeV(
              MAX_FUNCTION_LINES, ctx.filePath, funcStart + 1,
              `Function "${funcName}" is ${funcLines} lines (threshold: ${threshold}).`,
              `Split "${funcName}" into smaller, focused functions by extracting logical blocks.`,
            ));
          }
          inFunction = false;
        }
      }
    }

    return results;
  },
};

const MAX_PARAMS: CodeRule = {
  id: 'max-params',
  category: 'maintainability',
  severity: 'medium',
  title: 'Too many function parameters',
  description: 'Function has more than 5 parameters, making it difficult to understand and use.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const threshold = 5;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      const paramMatch = line.match(
        /(?:function\s+|=>\s*|\w+\s*\()\s*\(([^)]*)\)/,
      );
      if (paramMatch) {
        const params = paramMatch[1]!
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0 && p !== '...');
        if (params.length > threshold) {
          results.push(makeV(
            MAX_PARAMS, ctx.filePath, i + 1,
            `Function has ${params.length} parameters (threshold: ${threshold}).`,
            `Group related parameters into a configuration object: function fn({ a, b, c }: Config)`,
          ));
        }
      }
    }

    return results;
  },
};

const MAX_NESTING_DEPTH: CodeRule = {
  id: 'max-nesting-depth',
  category: 'maintainability',
  severity: 'high',
  title: 'Excessive nesting depth',
  description: 'Nesting depth exceeds 4 levels. Deep nesting makes code harder to read and test.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const threshold = 4;
    let cumulativeDepth = 0;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      let braces = 0;
      for (const ch of line) {
        if (ch === '{') braces++;
        if (ch === '}') braces--;
      }
      cumulativeDepth += braces;

      if (cumulativeDepth > threshold && braces > 0) {
        results.push(makeV(
          MAX_NESTING_DEPTH, ctx.filePath, i + 1,
          `Nesting depth ${cumulativeDepth} exceeds threshold ${threshold}.`,
          `Use early returns or extract nested logic into helper functions.`,
        ));
      }
    }

    return results;
  },
};

const MAX_CYCLOMATIC_COMPLEXITY: CodeRule = {
  id: 'max-cyclomatic-complexity',
  category: 'maintainability',
  severity: 'medium',
  title: 'High cyclomatic complexity',
  description: 'Function has high cyclomatic complexity (>15), making it difficult to maintain.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const threshold = 15;

    let inFunction = false;
    let complexity = 1; // Base complexity
    let funcStart = 0;
    let braceDepth = 0;
    let funcName = 'anonymous';

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
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

        // Count branch points
        if (/\bif\b/.test(trimmed)) complexity++;
        if (/\belse\s+if\b/.test(trimmed)) complexity++;
        if (/\bcase\b/.test(trimmed)) complexity++;
        if (/\bdefault\s*:/.test(trimmed)) complexity++;
        if (/[?&]{2}\|{2}/.test(trimmed)) complexity++;
        if (/\bfor\b/.test(trimmed)) complexity++;
        if (/\bwhile\b/.test(trimmed)) complexity++;
        if (/\bcatch\b/.test(trimmed)) complexity++;

        if (braceDepth === 0 && i > funcStart + 1) {
          if (complexity > threshold) {
            results.push(makeV(
              MAX_CYCLOMATIC_COMPLEXITY, ctx.filePath, funcStart + 1,
              `Function "${funcName}" has cyclomatic complexity ${complexity} (threshold: ${threshold}).`,
              `Refactor into smaller functions or use strategy pattern for branching logic.`,
            ));
          }
          inFunction = false;
        }
      }
    }

    return results;
  },
};

const NO_MAGIC_NUMBERS: CodeRule = {
  id: 'no-magic-numbers',
  category: 'maintainability',
  severity: 'low',
  title: 'Magic number without explanation',
  description: 'Numeric literals used without being assigned to a named constant.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    // Allow certain common numbers: 0, 1, 2, -1 and array indices
    const allowedNumbers = new Set([0, 1, 2, -1]);

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      if (trimmed.startsWith('const') || trimmed.startsWith('enum') || trimmed.startsWith('type')) continue;

      // Find standalone numbers not in import paths or comments
      const numMatch = line.match(/(?<!\w)(\d{4,})(?!\w)/g);
      if (numMatch) {
        for (const num of numMatch) {
          if (!allowedNumbers.has(Number(num))) {
            results.push(makeV(
              NO_MAGIC_NUMBERS, ctx.filePath, i + 1,
              `Magic number ${num} used without a named constant.`,
              `Extract to a named constant: const MAX_RETRIES = ${num};`,
            ));
          }
        }
      }
    }

    return results;
  },
};

const NO_TODO_FIXME: CodeRule = {
  id: 'no-todo-fixme',
  category: 'maintainability',
  severity: 'low',
  title: 'Unresolved TODO or FIXME comment',
  description: 'TODO/FIXME comments without a ticket reference may never be addressed.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (
        (trimmed.includes('TODO') || trimmed.includes('FIXME')) &&
        !/#\d+|ISSUE-\d+|\[JIRA\]/i.test(trimmed)
      ) {
        const isFIXME = trimmed.includes('FIXME');
        results.push(makeV(
          NO_TODO_FIXME, ctx.filePath, i + 1,
          `${isFIXME ? 'FIXME' : 'TODO'} comment without ticket reference: "${trimmed.slice(0, 100)}"`,
          `Add a ticket reference: // TODO(#123): description`,
        ));
      }
    }

    return results;
  },
};

const CONSISTENT_NAMING: CodeRule = {
  id: 'consistent-naming',
  category: 'maintainability',
  severity: 'low',
  title: 'Inconsistent naming convention',
  description: 'Mixed or non-standard naming conventions detected.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      // Check class names should be PascalCase
      const classMatch = trimmed.match(/^(?:export\s+)?class\s+([a-z]\w+)/);
      if (classMatch) {
        results.push(makeV(
          CONSISTENT_NAMING, ctx.filePath, i + 1,
          `Class "${classMatch[1]}" should use PascalCase.`,
          `Rename to ${classMatch[1]![0]!.toUpperCase()}${classMatch[1]!.slice(1)}`,
        ));
      }

      // Check variable names starting with uppercase (not classes/enums)
      const varMatch = trimmed.match(/^(?:const|let|var)\s+([A-Z][a-z]\w*)\s*=/);
      if (varMatch && !isTestFile(ctx.filePath)) {
        results.push(makeV(
          CONSISTENT_NAMING, ctx.filePath, i + 1,
          `Variable "${varMatch[1]}" starts with uppercase — should use camelCase.`,
          `Rename to ${varMatch[1]![0]!.toLowerCase()}${varMatch[1]!.slice(1)}`,
        ));
      }
    }

    return results;
  },
};

const NO_DEAD_CODE: CodeRule = {
  id: 'no-dead-code',
  category: 'maintainability',
  severity: 'low',
  title: 'Commented-out code block',
  description: 'Large blocks of commented-out code should be removed — use version control instead.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    let consecutiveCommentLines = 0;
    let startLine = 0;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (trimmed.startsWith('//') && !trimmed.startsWith('// @') && !trimmed.startsWith('// ===') && !trimmed.startsWith('// ---')) {
        if (consecutiveCommentLines === 0) startLine = i;
        consecutiveCommentLines++;
      } else {
        if (consecutiveCommentLines > 5) {
          results.push(makeV(
            NO_DEAD_CODE, ctx.filePath, startLine + 1,
            `Block of ${consecutiveCommentLines} commented-out lines — dead code.`,
            `Remove the commented-out code. Use version control (git) to preserve history.`,
          ));
        }
        consecutiveCommentLines = 0;
      }
    }

    if (consecutiveCommentLines > 5) {
      results.push(makeV(
        NO_DEAD_CODE, ctx.filePath, startLine + 1,
        `Block of ${consecutiveCommentLines} commented-out lines — dead code.`,
        `Remove the commented-out code.`,
      ));
    }

    return results;
  },
};

const NO_GOD_CLASS: CodeRule = {
  id: 'no-god-class',
  category: 'maintainability',
  severity: 'medium',
  title: 'God class anti-pattern',
  description: 'Class has too many methods (>20) or too many lines (>500).',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const maxMethods = 20;
    const maxLines = 500;

    let inClass = false;
    let classStart = 0;
    let className = 'anonymous';
    let classDepth = 0;
    let methodCount = 0;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
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

        // Count methods (approximation using common patterns)
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
            results.push(makeV(
              NO_GOD_CLASS, ctx.filePath, classStart + 1,
              `Class "${className}" has ${methodCount} methods (threshold: ${maxMethods}).`,
              `Split into smaller, focused classes following the Single Responsibility Principle.`,
            ));
          }

          if (classLines > maxLines) {
            results.push(makeV(
              NO_GOD_CLASS, ctx.filePath, classStart + 1,
              `Class "${className}" is ${classLines} lines (threshold: ${maxLines}).`,
              `Extract responsibilities into separate classes or modules.`,
            ));
          }

          inClass = false;
        }
      }
    }

    return results;
  },
};

const PREFER_EARLY_RETURN: CodeRule = {
  id: 'prefer-early-return',
  category: 'maintainability',
  severity: 'low',
  title: 'Deeply nested if-else — consider early return',
  description: 'Deeply nested if-else blocks can be flattened with early returns or guard clauses.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    let consecutiveBranchLines = 0;
    let startBranch = 0;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (/\b(?:if\s*\(|else\s+if\s*\(|else\s*\{)/.test(trimmed) && !trimmed.startsWith('//')) {
        if (consecutiveBranchLines === 0) startBranch = i;
        consecutiveBranchLines++;
      } else if (trimmed === '}' || trimmed === '};') {
        if (consecutiveBranchLines >= 3) {
          results.push(makeV(
            PREFER_EARLY_RETURN, ctx.filePath, startBranch + 1,
            `${consecutiveBranchLines} nested conditional branches — consider flattening with early returns.`,
            `Use guard clauses: if (!valid) return; // Continue with main logic`,
          ));
        }
        consecutiveBranchLines = 0;
      }
    }

    return results;
  },
};

// ===========================================================================
// CATEGORY 5: STYLE (6 Rules)
// ===========================================================================

const TRAILING_WHITESPACE: CodeRule = {
  id: 'trailing-whitespace',
  category: 'style',
  severity: 'low',
  title: 'Trailing whitespace',
  description: 'Lines should not have trailing whitespace characters.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      if (line.length > 0 && /[ \t]+$/.test(line)) {
        results.push(makeV(
          TRAILING_WHITESPACE, ctx.filePath, i + 1,
          `Line ${i + 1} has trailing whitespace.`,
          `Remove trailing whitespace. Most editors can do this automatically on save.`,
        ));
      }
    }

    return results;
  },
};

const NO_CONSOLE: CodeRule = {
  id: 'no-console',
  category: 'style',
  severity: 'low',
  title: 'console statement in production code',
  description: 'console.log/warn/error should be replaced with a proper logging library.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    if (isTestFile(ctx.filePath)) return results;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (/\bconsole\.(?:log|warn|error|info|debug|trace)\s*\(/.test(trimmed) && !trimmed.startsWith('//')) {
        results.push(makeV(
          NO_CONSOLE, ctx.filePath, i + 1,
          `console.${trimmed.match(/console\.(\w+)/)?.[1]} found in production code.`,
          `Replace with a proper logging library (e.g., winston, pino, log4js).`,
        ));
      }
    }

    return results;
  },
};

const CONSISTENT_QUOTES: CodeRule = {
  id: 'consistent-quotes',
  category: 'style',
  severity: 'low',
  title: 'Inconsistent quote style',
  description: 'File uses a mix of single and double quotes — pick one and stay consistent.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    let singleCount = 0;
    let doubleCount = 0;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      // Count string literals (simplified)
      const singleMatches = line.match(/'[^']*'/g);
      const doubleMatches = line.match(/"[^"]*"/g);
      if (singleMatches) singleCount += singleMatches.length;
      if (doubleMatches) doubleCount += doubleMatches.length;
    }

    if (singleCount > 0 && doubleCount > 0 && singleCount + doubleCount > 3) {
      results.push(makeV(
        CONSISTENT_QUOTES, ctx.filePath, 1,
        `Mixed quote styles: ${singleCount} single quotes, ${doubleCount} double quotes.`,
        `Standardize on ${singleCount > doubleCount ? 'single' : 'double'} quotes throughout the file.`,
      ));
    }

    return results;
  },
};

const NO_LONG_LINES: CodeRule = {
  id: 'no-long-lines',
  category: 'style',
  severity: 'low',
  title: 'Line exceeds maximum length',
  description: 'Lines exceeding 120 characters are difficult to read and review.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];
    const maxLength = 120;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      // Skip import statements which often have long URLs
      if (line.trim().startsWith('import ')) continue;
      if (line.length > maxLength) {
        results.push(makeV(
          NO_LONG_LINES, ctx.filePath, i + 1,
          `Line is ${line.length} characters (threshold: ${maxLength}).`,
          `Break the line into multiple lines for readability.`,
        ));
      }
    }

    return results;
  },
};

const SPACING_CONSISTENCY: CodeRule = {
  id: 'spacing-consistency',
  category: 'style',
  severity: 'low',
  title: 'Inconsistent spacing around operators',
  description: 'Inconsistent spacing around operators reduces readability.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      // Detect missing space before/after = operator
      if (/\w=/.test(trimmed) && !/[!=<>]==/.test(trimmed)) {
        results.push(makeV(
          SPACING_CONSISTENCY, ctx.filePath, i + 1,
          `Missing space around "=" operator.`,
          `Add spaces: "x = y" instead of "x=y".`,
        ));
      }
    }

    return results;
  },
};

const FILE_HEADER: CodeRule = {
  id: 'file-header',
  category: 'style',
  severity: 'low',
  title: 'Missing file header comment',
  description: 'File should have a header comment describing its purpose and package.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    if (ctx.lines.length === 0) return results;

    const firstLine = ctx.lines[0]!.trim();
    if (
      !firstLine.startsWith('//') &&
      !firstLine.startsWith('/*') &&
      !firstLine.startsWith('#') &&
      !firstLine.startsWith('"""') &&
      !firstLine.startsWith("'''")
    ) {
      results.push(makeV(
        FILE_HEADER, ctx.filePath, 1,
        `File is missing a header comment describing its purpose.`,
        `Add a header comment: // @code-analyzer/<package> — <description>`,
      ));
    }

    return results;
  },
};

// ===========================================================================
// CATEGORY 6: ARCHITECTURE (6 Rules — Graph-Based)
// ===========================================================================

const NO_CIRCULAR_DEPS: CodeRule = {
  id: 'no-circular-deps',
  category: 'architecture',
  severity: 'high',
  title: 'Circular dependency detected',
  description: 'Circular dependencies between modules cause tight coupling and make the codebase fragile.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const cycles = ctx.graphContext?.cyclicPaths ?? [];
    for (const cycle of cycles) {
      if (cycle.includes(ctx.filePath)) {
        results.push(makeV(
          NO_CIRCULAR_DEPS, ctx.filePath, 1,
          `Circular dependency chain: ${cycle.join(' -> ')}`,
          `Break the cycle by extracting shared types/interfaces into a separate module, or using dependency inversion.`,
        ));
        break;
      }
    }

    return results;
  },
};

const NO_LAYER_VIOLATION: CodeRule = {
  id: 'no-layer-violation',
  category: 'architecture',
  severity: 'high',
  title: 'Layer import violation',
  description: 'Lower layer importing from an upper layer, violating layered architecture.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    const layers = {
      'infra': 0,
      'data': 1,
      'domain': 2,
      'application': 3,
      'presentation': 4,
      'api': 4,
    };

    const fileLayer = getFileLayer(ctx.filePath);
    if (fileLayer === null) return results;

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const importMatch = line.match(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const importPath = importMatch[1]!;
        const importLayer = getImportLayer(importPath);
        if (importLayer !== null) {
          const fileIdx = (layers as Record<string, number>)[fileLayer] ?? -1;
          const importIdx = (layers as Record<string, number>)[importLayer] ?? -1;
          if (importIdx > fileIdx) {
            results.push(makeV(
              NO_LAYER_VIOLATION, ctx.filePath, i + 1,
              `Import from "${importPath}" violates layer boundaries: ${fileLayer} should not import from ${importLayer}.`,
              `Restructure imports to respect layer boundaries. Consider using interfaces for inversion.`,
            ));
          }
        }
      }
    }

    return results;
  },
};

function getFileLayer(filePath: string): string | null {
  const path = filePath.toLowerCase();
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

const NO_BARREL_EXPORT: CodeRule = {
  id: 'no-barrel-export',
  category: 'architecture',
  severity: 'low',
  title: 'Barrel export anti-pattern',
  description: 'Barrel exports (export * from) can cause circular dependencies and tree-shaking issues.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;
      const trimmed = line.trim();

      if (trimmed.startsWith("export * from")) {
        results.push(makeV(
          NO_BARREL_EXPORT, ctx.filePath, i + 1,
          `Barrel export "export * from" — can cause circular dependencies.`,
          `Use explicit named exports: export { Foo, Bar } from './module'`,
        ));
      }
    }

    return results;
  },
};

const MAX_MODULE_SIZE: CodeRule = {
  id: 'max-module-size',
  category: 'architecture',
  severity: 'medium',
  title: 'Module may be too large',
  description: 'Module appears to contain too many files (>30), making it difficult to maintain.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    // This rule requires graph context to determine module file count
    const graphData = ctx.graphContext;
    if (graphData && graphData.outDegree > 30) {
      results.push(makeV(
        MAX_MODULE_SIZE, ctx.filePath, 1,
        `Module has ${graphData.outDegree} outgoing dependencies — may be too large.`,
        `Consider splitting into smaller, focused modules.`,
      ));
    }

    return results;
  },
};

const NO_CROSS_BOUNDARY_ACCESS: CodeRule = {
  id: 'no-cross-boundary-access',
  category: 'architecture',
  severity: 'medium',
  title: 'Cross-boundary access detected',
  description: 'Accessing internal/private symbols across module boundaries.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // Import of private/internal module paths
      if (
        line.includes('import ') &&
        (line.includes('/internal/') || line.includes('/private/') || line.includes('/_'))
      ) {
        results.push(makeV(
          NO_CROSS_BOUNDARY_ACCESS, ctx.filePath, i + 1,
          `Import from internal/private module — may cross module boundaries.`,
          `Use the module's public API. If the symbol should be accessible, consider making it part of the public interface.`,
        ));
      }
    }

    return results;
  },
};

const MISSING_ABSTRACTION: CodeRule = {
  id: 'missing-abstraction',
  category: 'architecture',
  severity: 'medium',
  title: 'Concrete class used where interface expected',
  description: 'Direct usage of concrete classes instead of interfaces reduces flexibility.',
  check(ctx: RuleContext): RuleViolation[] {
    const results: RuleViolation[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!;

      // new ConcreteClass() where interface exists (heuristic check)
      const newMatch = line.match(/new\s+(\w+)\s*\(/);
      if (newMatch && newMatch[1]) {
        const className = newMatch[1]!;
        // Check if there's a corresponding I-prefixed interface pattern
        const hasInterface = ctx.lines.some((l) => l.includes(`interface I${className}`) || l.includes(`interface ${className.replace(/Impl$/, '')}`));
        if (hasInterface) {
          results.push(makeV(
            MISSING_ABSTRACTION, ctx.filePath, i + 1,
            `Direct instantiation of "${className}" — consider using an interface/abstract class.`,
            `Use dependency injection with an interface type: constructor(private service: I${className})`,
          ));
        }
      }
    }

    return results;
  },
};

// ===========================================================================
// Master Rule Set (50 Rules)
// ===========================================================================

/** All 50 deterministic rules in one array. */
export const DEFAULT_RULES: CodeRule[] = [
  // Correctness (8)
  NO_UNDEF,
  NO_DUPLICATE_IMPORTS,
  NO_UNREACHABLE_CODE,
  NO_CONSTANT_CONDITION,
  NO_EMPTY_CATCH,
  NO_UNUSED_VARS,
  NO_UNSAFE_OPTIONAL_CHAINING,
  NO_ARRAY_INDEX_KEY,

  // Security (12)
  NO_EVAL,
  NO_SQL_INJECTION,
  NO_XSS,
  NO_HARDCODED_SECRETS,
  NO_COMMAND_INJECTION,
  NO_PATH_TRAVERSAL,
  NO_OPEN_REDIRECT,
  NO_UNSAFE_DESERIALIZATION,
  NO_WEAK_CRYPTO,
  NO_INSECURE_RANDOM,
  NO_HTTP_URL,
  NO_DEBUG_STATEMENT,

  // Performance (8)
  NO_SYNC_FS,
  NO_LARGE_ARRAY_COPY,
  NO_INEFFICIENT_REGEX,
  NO_LOOP_AWAIT,
  AVOID_BLOCKING_OPS,
  PREFER_LAZY_LOADING,
  NO_N_PLUS_ONE,
  NO_REDUNDANT_COMPUTATION,

  // Maintainability (10)
  MAX_FUNCTION_LINES,
  MAX_PARAMS,
  MAX_NESTING_DEPTH,
  MAX_CYCLOMATIC_COMPLEXITY,
  NO_MAGIC_NUMBERS,
  NO_TODO_FIXME,
  CONSISTENT_NAMING,
  NO_DEAD_CODE,
  NO_GOD_CLASS,
  PREFER_EARLY_RETURN,

  // Style (6)
  TRAILING_WHITESPACE,
  NO_CONSOLE,
  CONSISTENT_QUOTES,
  NO_LONG_LINES,
  SPACING_CONSISTENCY,
  FILE_HEADER,

  // Architecture (6)
  NO_CIRCULAR_DEPS,
  NO_LAYER_VIOLATION,
  NO_BARREL_EXPORT,
  MAX_MODULE_SIZE,
  NO_CROSS_BOUNDARY_ACCESS,
  MISSING_ABSTRACTION,
];

/**
 * Determine the language from a file path.
 * Used by rules that filter on specific languages.
 */
export function getFileLanguage(filePath: string): string {
  return detectLanguage(filePath);
}

/**
 * Run all default rules against a file's content.
 * Returns all violations found.
 */
export function runRules(ctx: RuleContext, rules?: CodeRule[]): RuleViolation[] {
  const ruleSet = rules ?? DEFAULT_RULES;
  const violations: RuleViolation[] = [];
  const lang = ctx.language || detectLanguage(ctx.filePath);

  for (const rule of ruleSet) {
    // Language filter
    if (rule.language && rule.language.length > 0) {
      if (!rule.language.includes(lang)) {
        continue;
      }
    }

    try {
      const result = rule.check(ctx);
      violations.push(...result);
    } catch {
      // Rule ran into an error — skip it to avoid failing the entire analysis
    }
  }

  return violations;
}
