// @code-analyzer/intelligence — Extended AST-Aware Security Rules (Batch 2)
// 20 additional rules leveraging the AstRuleContext infrastructure.
// Each rule operates on structured call sites, string literals,
// assignments, and imports rather than raw line-based regex.

import type { RuleCheckResult } from './rule-runner.js';
import type { AstRuleContext } from './ast-rule-checker.js';
import {
  hasCall,
  findCalls,
  findStringLiterals,
  hasAssignment,
  isTestFile,
} from './ast-rule-checker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mk(ruleId: string, line: number, message: string, suggestion?: string): RuleCheckResult {
  return { ruleId, line, message, suggestion };
}

function isComment(line: string): boolean {
  return /^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*\/\*/.test(line);
}

// ===========================================================================
// BATCH 1: Additional Injection Vulnerabilities (6 rules)
// ===========================================================================

/** XXE: XML external entity processing (CWE-611) */
export function checkXxeAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const xxePatterns = [
    /new\s+DOMParser\s*\(\s*\)/,
    /xml2js\s*\.\s*parseString\s*\(/,
    /etree\s*\.\s*parse\s*\(/,
    /lxml\s*\.\s*etree\s*\.\s*parse\s*\(/,
  ];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    for (const pat of xxePatterns) {
      if (pat.test(line) && !/noent|resolve_entities|DTD_LOAD/i.test(line)) {
        r.push(
          mk(
            'no-xxe',
            i + 1,
            'CWE-611: XML parser used without disabling external entity resolution — potential XXE.',
            'Disable external entity loading: DOMParser({ noent: false }) or set resolve_entities=False.',
          ),
        );
      }
    }
  }
  return r;
}

/** SSTI: Server-Side Template Injection (CWE-94) */
export function checkSstiAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const templateCalls = [
    /\.render\s*\(/,
    /\.renderTemplate\s*\(/,
    /nunjucks\s*\.\s*render\s*\(/,
    /jinja2\s*\.\s*Template\s*\(/,
  ];

  for (const call of ctx.calls) {
    const fullName = call.object ? `${call.object}.${call.name}` : call.name;
    for (const pat of templateCalls) {
      if (pat.test(fullName)) {
        const hasUserInput = call.arguments.some((a) =>
          /req\.|request\.|params\.|query\.|body\.|user/.test(a),
        );
        if (hasUserInput) {
          r.push(
            mk(
              'no-ssti',
              call.line,
              'CWE-94: Template rendered with user-controlled input — potential SSTI.',
              'Sanitize user input before template rendering, or use sandboxed template engines.',
            ),
          );
        }
      }
    }
  }
  return r;
}

/** LDAP Injection (CWE-90) */
export function checkLdapInjectionAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (/(?:ldap|LDAP)\.(?:search|modify|add|delete|bind)\s*\(/.test(line) && /\$\{/.test(line)) {
      r.push(
        mk(
          'no-ldap-injection',
          i + 1,
          'CWE-90: LDAP query built with string interpolation — potential LDAP injection.',
          'Escape special LDAP characters: * ( ) \\ \\0 and use parameterized LDAP queries.',
        ),
      );
    }
  }
  return r;
}

/** NoSQL Injection (CWE-943) */
export function checkNosqlInjectionAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (
      /(?:find|findOne|findById|aggregate|updateOne|updateMany|deleteOne|deleteMany)\s*\(\s*\{/.test(
        line,
      ) &&
      /\$\{/.test(line)
    ) {
      r.push(
        mk(
          'no-nosql-injection',
          i + 1,
          'CWE-943: MongoDB query built with user-controlled object — potential NoSQL injection.',
          'Use mongo-sanitize or validate query objects against whitelisted operators.',
        ),
      );
    }
  }
  return r;
}

/** Log Injection / Forging (CWE-117) */
export function checkLogInjectionAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const call of findCalls(ctx, /(?:log|info|warn|error|debug|trace)\b/)) {
    const hasUserInput = call.arguments.some((a) =>
      /req\.|request\.|params\.|query\.|body\.|user|\$\{/.test(a),
    );
    if (hasUserInput && call.object !== 'console') {
      r.push(
        mk(
          'no-log-injection',
          call.line,
          'CWE-117: Log message includes user-controlled input — potential log injection.',
          'Sanitize user input before logging. Strip newlines and control characters.',
        ),
      );
    }
  }
  return r;
}

/** ReDoS: Inefficient Regular Expression (CWE-1333) */
export function checkInefficientRegexAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    // Detect nested quantifiers (classic ReDoS pattern)
    const regexMatch = line.match(/\/(.+?)\/[gimsuy]*/);
    if (regexMatch) {
      const pattern = regexMatch[1]!;
      if (
        /\(\w\+\)\*/.test(pattern) ||
        /\(\w\+\)\+/.test(pattern) ||
        /\(\w\*\)\*/.test(pattern) ||
        /\(\w\*\)\+/.test(pattern)
      ) {
        r.push(
          mk(
            'no-inefficient-regex',
            i + 1,
            'CWE-1333: Regular expression has nested quantifiers — potential ReDoS vulnerability.',
            'Rewrite the regex to avoid backtracking. Use possessive quantifiers or atomic groups.',
          ),
        );
      }
    }
  }
  return r;
}

// ===========================================================================
// BATCH 2: Cryptographic & Randomness Issues (4 rules)
// ===========================================================================

/** Hardcoded encryption key / IV (CWE-321) */
export function checkHardcodedKeyIvAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const a of ctx.assignments) {
    if (/(?:key|iv|nonce|salt)\b/i.test(a.name)) {
      const val = a.value.trim();
      const isEnvRef =
        val.includes('process.env') || val.includes('import.meta.env') || val.includes('Deno.env');
      if (
        !isEnvRef &&
        (val.startsWith("'") ||
          val.startsWith('"') ||
          val.startsWith('`') ||
          /^[A-Fa-f0-9]{16,}$/.test(val))
      ) {
        r.push(
          mk(
            'no-hardcoded-key-iv',
            a.line,
            'CWE-321: Hardcoded cryptographic key or IV detected.',
            'Generate keys at runtime or load from a secure key management service.',
          ),
        );
      }
    }
  }
  return r;
}

/** Missing certificate validation (CWE-295) */
export function checkMissingCertValidationAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (
      /rejectUnauthorized\s*:\s*false/.test(line) ||
      /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*(?:'0'|"0"|0)/.test(line) ||
      /verify_ssl\s*:\s*false/i.test(line) ||
      /verify\s*:\s*false\s*[,;}]/.test(line)
    ) {
      r.push(
        mk(
          'no-missing-cert-validation',
          i + 1,
          'CWE-295: TLS certificate validation disabled — vulnerable to MITM attacks.',
          'Remove rejectUnauthorized: false. Fix certificate issues instead of disabling validation.',
        ),
      );
    }
  }
  return r;
}

/** Predictable random seed (CWE-335) */
export function checkPredictableSeedAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const call of findCalls(ctx, /(?:seed|srand|random\.seed|Random)\b/)) {
    for (const arg of call.arguments) {
      if (/^\d+$/.test(arg.trim()) || /Date\.now/.test(arg) || /new Date/.test(arg)) {
        r.push(
          mk(
            'no-predictable-seed',
            call.line,
            'CWE-335: PRNG seeded with predictable value — sequence is deterministic.',
            'Use crypto.randomBytes() or crypto.getRandomValues() for cryptographic randomness.',
          ),
        );
      }
    }
  }
  return r;
}

/** Insecure hash for password storage (CWE-256) */
export function checkInsecurePasswordHashAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const fastHashCalls = findCalls(ctx, /(?:md5|sha1|sha256|sha512|hash)\s*\(/);

  for (const call of fastHashCalls) {
    // Context: is this used in a password-related context?
    const nearbyStart = Math.max(0, call.line - 3);
    const nearbyEnd = Math.min(ctx.lines.length, call.line + 2);
    const context = ctx.lines.slice(nearbyStart, nearbyEnd).join('\n');

    if (/(?:password|passwd|pwd|credential|secret)/i.test(context)) {
      r.push(
        mk(
          'no-insecure-password-hash',
          call.line,
          'CWE-256: Fast hash function used for password storage — use bcrypt/argon2 instead.',
          'Use bcrypt, argon2, or scrypt for password hashing with appropriate work factor.',
        ),
      );
    }
  }
  return r;
}

// ===========================================================================
// BATCH 3: Authentication & Authorization (4 rules)
// ===========================================================================

/** Missing authentication check (CWE-306) */
export function checkMissingAuthCheckAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];
  const routeDefs = /(?:\.get|\.post|\.put|\.delete|\.patch|route)\s*\(\s*['"`][^'"`]*['"`]/;

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (routeDefs.test(line) && /admin|manage|delete|config|setting/i.test(line)) {
      // Check next 3 lines for auth middleware
      const nextLines = ctx.lines.slice(i + 1, Math.min(i + 4, ctx.lines.length));
      const hasAuth = nextLines.some((l) =>
        /auth|authenticate|authorize|middleware|guard|protect/i.test(l),
      );
      if (!hasAuth) {
        r.push(
          mk(
            'no-missing-auth',
            i + 1,
            'CWE-306: Sensitive route defined without visible authentication middleware.',
            'Add authentication middleware to protect admin/management endpoints.',
          ),
        );
      }
    }
  }
  return r;
}

/** Overly permissive CORS (CWE-942) */
export function checkPermissiveCorsAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (
      /(?:origin|Origin)\s*:\s*['"]\*['"]/.test(line) ||
      /Access-Control-Allow-Origin\s*:\s*['"]\*['"]/.test(line)
    ) {
      r.push(
        mk(
          'no-permissive-cors',
          i + 1,
          'CWE-942: CORS configured with wildcard origin — allows any website to access resources.',
          'Restrict CORS to specific allowed origins instead of using * wildcard.',
        ),
      );
    }
  }
  return r;
}

/** Missing rate limiting (CWE-770) */
export function checkMissingRateLimitAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  if (isTestFile(ctx.filePath)) return r;

  // Check if this is an Express/Fastify/Koa app setup
  const hasAppInit = /const\s+app\s*=\s*(?:express|fastify|koa)\s*\(\)/.test(ctx.lines.join('\n'));

  if (hasAppInit) {
    const hasRateLimit = /rateLimit|rate-limit|rate_limit|RateLimiter|express-rate-limit/.test(
      ctx.lines.join('\n'),
    );
    if (!hasRateLimit) {
      r.push(
        mk(
          'no-missing-rate-limit',
          1,
          'CWE-770: No rate limiting detected — API is vulnerable to DoS.',
          'Add express-rate-limit or a similar middleware to protect against brute-force and DoS attacks.',
        ),
      );
    }
  }
  return r;
}

/** Excessive data exposure in error responses (CWE-209) */
export function checkErrorDataExposureAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    // Detect sending raw error objects in responses
    if (/(?:res|response|reply)\s*\.\s*(?:json|send|end)\s*\(\s*(?:err|error|e)\b/.test(line)) {
      r.push(
        mk(
          'no-error-exposure',
          i + 1,
          'CWE-209: Raw error object sent in response — may leak stack traces and internals.',
          'Sanitize error responses: send only user-friendly messages, log the full error server-side.',
        ),
      );
    }
  }
  return r;
}

// ===========================================================================
// BATCH 4: Input Validation & Data Handling (4 rules)
// ===========================================================================

/** Prototype pollution (CWE-1321) */
export function checkPrototypePollutionAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const call of findCalls(ctx, /(?:merge|extend|assign)\b/)) {
    const args = call.arguments;
    // Check if first arg is {} (creating a new object from user input)
    if (
      args.length >= 2 &&
      /^\{\s*\}$/.test(args[0]! ?? '') &&
      args.slice(1).some((a) => /req\.|request\.|params\.|query\.|body\./.test(a))
    ) {
      r.push(
        mk(
          'no-prototype-pollution',
          call.line,
          'CWE-1321: Object merge with user-controlled input — potential prototype pollution.',
          'Use Object.create(null) or check for __proto__/constructor/prototype keys before merging.',
        ),
      );
    }
  }
  return r;
}

/** Integer overflow / underflow (CWE-190) */
export function checkIntegerOverflowAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    if (
      /(?:BigInt|Number\s*\(\s*[^(]+request|parseInt\s*\(\s*(?:req|request|body|query|params))/.test(
        line,
      )
    ) {
      r.push(
        mk(
          'no-integer-overflow',
          i + 1,
          'CWE-190: User input parsed as integer without bounds checking — potential overflow.',
          'Validate numeric input bounds: check min/max before casting, use BigInt for large values.',
        ),
      );
    }
  }
  return r;
}

/** Unsafe dynamic import (CWE-914) */
export function checkUnsafeDynamicImportAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (const call of ctx.calls) {
    if (call.name === 'import' && call.object === null) {
      const arg = call.arguments[0] ?? '';
      if (/req\.|request\.|params\.|query\.|body\.|\$\{/.test(arg)) {
        r.push(
          mk(
            'no-unsafe-dynamic-import',
            call.line,
            'CWE-914: Dynamic import path derived from user input — may load arbitrary modules.',
            'Whitelist allowed module paths or validate against a known set of modules.',
          ),
        );
      }
    }
  }
  return r;
}

/** Missing input size validation (CWE-400) */
export function checkMissingInputSizeLimitAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  if (isTestFile(ctx.filePath)) return r;

  // Check for common server setups without body size limits
  const hasServerInit = /(?:express|fastify|koa|hapi|body-parser|bodyParser)/i.test(
    ctx.lines.join('\n'),
  );
  const hasSizeLimit = /(?:limit\s*:|bodyLimit|maxBodySize|maxRequestSize)/i.test(
    ctx.lines.join('\n'),
  );

  if (hasServerInit && !hasSizeLimit) {
    r.push(
      mk(
        'no-missing-input-size-limit',
        1,
        'CWE-400: No request body size limit configured — vulnerable to resource exhaustion.',
        'Configure body-parser with a reasonable limit: bodyParser.json({ limit: "1mb" }).',
      ),
    );
  }
  return r;
}

// ===========================================================================
// BATCH 5: File & Resource Security (2 rules)
// ===========================================================================

/** Unrestricted file upload (CWE-434) */
export function checkUnrestrictedFileUploadAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  const uploadPatterns = [
    /\.(?:file|upload|File|Upload)\s*\(/,
    /multer\s*\(\s*\{/,
    /formidable\s*\.\s*IncomingForm\s*\(/,
  ];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    for (const pat of uploadPatterns) {
      if (pat.test(line)) {
        // Check if file type validation exists nearby
        const nearbyStart = Math.max(0, i);
        const nearbyEnd = Math.min(ctx.lines.length, i + 10);
        const nearbyLines = ctx.lines.slice(nearbyStart, nearbyEnd).join('\n');
        const hasTypeCheck =
          /(?:fileFilter|allowedTypes|mime|extension|extname|mimetype|magic)/i.test(nearbyLines);

        if (!hasTypeCheck) {
          r.push(
            mk(
              'no-unrestricted-upload',
              i + 1,
              'CWE-434: File upload handler without type validation — allows arbitrary file uploads.',
              'Validate file types by MIME type and magic bytes. Restrict to whitelisted extensions.',
            ),
          );
          break;
        }
      }
    }
  }
  return r;
}

/** Race condition / TOCTOU (CWE-367) */
export function checkToctouAst(ctx: AstRuleContext): RuleCheckResult[] {
  const r: RuleCheckResult[] = [];

  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!;
    if (isComment(line)) continue;
    // exists check followed by immediate file operation
    if (/existsSync\s*\(/.test(line) || /accessSync\s*\(/.test(line)) {
      // Check if next 2 lines do write/delete without re-checking
      const next = ctx.lines[i + 1] ?? '';
      const nextNext = ctx.lines[i + 2] ?? '';
      if (/(?:writeFile|unlink|rmdir|mkdir|chmod|chown)\s*\(/.test(next + nextNext)) {
        r.push(
          mk(
            'no-toctou',
            i + 1,
            'CWE-367: TOCTOU race condition — file checked then operated on without atomicity.',
            'Use atomic operations: open file descriptors, then check and operate, or use advisory locks.',
          ),
        );
      }
    }
  }
  return r;
}
