// @code-analyzer/intelligence — AST Security Rules Regression Tests
// Locks in fixes for four real detection bugs (duplicate string extraction,
// disabled SSTI, disabled insecure-password-hash, no-eval string false positive)
// and covers previously-uncovered detection branches across the AST security
// rules, including comment-skip paths and regex fallback.

import { describe, it, expect } from 'vitest';
import { CHECKER_MAP } from '../rules/rule-runner.js';
import { createAstContext, isTestFile } from '../rules/ast-rule-checker.js';

function run(ruleId: string, source: string, lang = 'typescript', filePath = 'test.ts') {
  const c = CHECKER_MAP[ruleId];
  if (!c) throw new Error('No checker: ' + ruleId);
  return c(source.split('\n'), filePath, lang);
}

// ---------------------------------------------------------------------------
// Regression: string literal extraction is not duplicated
// ---------------------------------------------------------------------------

describe('AST string extraction (dedup regression)', () => {
  it('extracts each string literal exactly once', () => {
    const ctx = createAstContext(
      ['const t = "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH";'],
      't.ts',
      'typescript',
    );
    expect(ctx.strings).toHaveLength(1);
    expect(ctx.strings[0]!.value).toBe('abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH');
  });

  it('no-hardcoded-secrets reports a high-entropy literal once', () => {
    const r = run(
      'no-hardcoded-secrets',
      'const t = "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH";',
    );
    expect(r).toHaveLength(1);
  });

  it('no-http-url reports each URL once', () => {
    const r = run('no-http-url', 'const u = "http://example.com";');
    expect(r).toHaveLength(1);
  });

  it('no-http-url skips localhost and 127.0.0.1', () => {
    expect(run('no-http-url', 'const a = "http://localhost:3000";')).toHaveLength(0);
    expect(run('no-http-url', 'const b = "http://127.0.0.1:8080";')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: no-eval must not false-positive on prose strings
// ---------------------------------------------------------------------------

describe('no-eval (string false-positive regression)', () => {
  it('does not flag a string containing "new Function"', () => {
    expect(run('no-eval', "const warn = 'Never use new Function';")).toHaveLength(0);
  });

  it('still flags eval()', () => {
    expect(run('no-eval', 'eval(code);')).toHaveLength(1);
  });

  it('still flags new Function()', () => {
    expect(run('no-eval', "const fn = new Function('a', 'return a');")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Regression: SSTI detection (was silently disabled by trailing-paren patterns)
// ---------------------------------------------------------------------------

describe('no-ssti (disabled-rule regression)', () => {
  it('detects res.render with user input', () => {
    expect(run('no-ssti', 'res.render(req.query.template);')).toHaveLength(1);
  });

  it('detects nunjucks.render with user input', () => {
    expect(run('no-ssti', 'nunjucks.render("x.html", req.body);')).toHaveLength(1);
  });

  it('detects jinja2.Template with user input', () => {
    expect(run('no-ssti', 'jinja2.Template(req.body.data);')).toHaveLength(1);
  });

  it('does not flag rendering a static template', () => {
    expect(run('no-ssti', 'res.render("static.html");')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: insecure password hash (was silently disabled)
// ---------------------------------------------------------------------------

describe('no-insecure-password-hash (disabled-rule regression)', () => {
  it('detects md5(password)', () => {
    expect(run('no-insecure-password-hash', 'const h = md5(password);')).toHaveLength(1);
  });

  it('detects crypto.createHash for a password', () => {
    expect(
      run('no-insecure-password-hash', 'const h = crypto.createHash("sha256").update(password);'),
    ).toHaveLength(1);
  });

  it('does not flag hashing non-secret data', () => {
    expect(run('no-insecure-password-hash', 'const h = md5(checksum);')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Comment-skip paths (isComment true branch) across representative rules
// ---------------------------------------------------------------------------

describe('comment-skip paths', () => {
  it('no-xss skips commented innerHTML', () => {
    expect(run('no-xss', '// el.innerHTML = userInput;')).toHaveLength(0);
    expect(run('no-xss', 'el.innerHTML = userInput;')).toHaveLength(1);
  });

  it('no-sql-injection skips commented queries', () => {
    expect(run('no-sql-injection', '// const q = "SELECT * FROM t WHERE x=" + id;')).toHaveLength(
      0,
    );
  });

  it('no-command-injection skips commented exec', () => {
    expect(run('no-command-injection', '// exec(`rm ${path}`);')).toHaveLength(0);
  });

  it('no-path-traversal skips commented fs.readFile', () => {
    expect(run('no-path-traversal', '// fs.readFile(req.query.p);')).toHaveLength(0);
  });

  it('no-open-redirect skips commented redirect', () => {
    expect(run('no-open-redirect', '// res.redirect(req.query.url);')).toHaveLength(0);
  });

  it('no-unsafe-deserialization skips commented JSON.parse', () => {
    expect(run('no-unsafe-deserialization', '// JSON.parse(body);')).toHaveLength(0);
  });

  it('no-weak-crypto skips commented md5', () => {
    expect(run('no-weak-crypto', '// md5(data);')).toHaveLength(0);
  });

  it('no-debug-statement skips commented debugger', () => {
    expect(run('no-debug-statement', '// debugger;')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-hardcoded-secrets: env-ref and high-entropy branches
// ---------------------------------------------------------------------------

describe('no-hardcoded-secrets branches', () => {
  it('flags a literal secret assignment', () => {
    expect(run('no-hardcoded-secrets', 'const password = "secret123";')).toHaveLength(1);
  });

  it('skips process.env / import.meta.env / Deno.env / undefined / null / short', () => {
    expect(run('no-hardcoded-secrets', 'const a = process.env.PW;')).toHaveLength(0);
    expect(run('no-hardcoded-secrets', 'const b = import.meta.env.PW;')).toHaveLength(0);
    expect(run('no-hardcoded-secrets', 'const c = Deno.env.get("PW");')).toHaveLength(0);
    expect(run('no-hardcoded-secrets', 'const d = undefined;')).toHaveLength(0);
    expect(run('no-hardcoded-secrets', 'const e = null;')).toHaveLength(0);
    expect(run('no-hardcoded-secrets', 'const f = "x";')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-weak-crypto: createHash + standalone algorithm branches
// ---------------------------------------------------------------------------

describe('no-weak-crypto branches', () => {
  it('detects crypto.createHash("md5")', () => {
    expect(run('no-weak-crypto', 'crypto.createHash("md5");')).toHaveLength(1);
  });

  it('detects standalone md5() call', () => {
    expect(run('no-weak-crypto', 'md5(data);')).toHaveLength(1);
  });

  it('does not flag strong algorithms', () => {
    expect(run('no-weak-crypto', 'crypto.createHash("sha256");')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-unsafe-deserialization: try/catch detection
// ---------------------------------------------------------------------------

describe('no-unsafe-deserialization branches', () => {
  it('flags JSON.parse without try/catch', () => {
    expect(run('no-unsafe-deserialization', 'const o = JSON.parse(body);')).toHaveLength(1);
  });

  it('skips JSON.parse wrapped in try', () => {
    const src = 'try {\n  const o = JSON.parse(body);\n} catch (e) {}';
    expect(run('no-unsafe-deserialization', src)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-unsafe-optional-chaining: guard and per-scope dedup branches
// ---------------------------------------------------------------------------

describe('no-unsafe-optional-chaining branches', () => {
  it('flags optional chaining without a null guard', () => {
    expect(run('no-unsafe-optional-chaining', 'do(obj?.prop);')).toHaveLength(1);
  });

  it('skips declarations (const/let/var)', () => {
    expect(run('no-unsafe-optional-chaining', 'const v = obj?.prop;')).toHaveLength(0);
  });

  it('skips optional chaining with a nearby null guard', () => {
    expect(
      run('no-unsafe-optional-chaining', 'if (obj != null) {\n  x = obj?.prop;\n}'),
    ).toHaveLength(0);
  });

  it('dedupes multiple optional chains in the same function', () => {
    const src = 'function f() {\n  a(obj?.x);\n  b(obj?.y);\n}';
    expect(run('no-unsafe-optional-chaining', src)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ast-security-rules-2: positive detections + comment skip
// ---------------------------------------------------------------------------

describe('extended AST security rules', () => {
  it('no-xxe detects DOMParser without entity disabling', () => {
    expect(run('no-xxe', 'new DOMParser().parseFromString(xml, "text/xml");')).toHaveLength(1);
  });

  it('no-xxe skips when noent is present', () => {
    expect(
      run('no-xxe', 'new DOMParser().parseFromString(xml, "text/xml", { noent: false });'),
    ).toHaveLength(0);
  });

  it('no-ldap-injection detects interpolation', () => {
    expect(run('no-ldap-injection', 'ldap.search(`cn=${user}`, base);')).toHaveLength(1);
  });

  it('no-nosql-injection detects interpolation', () => {
    expect(run('no-nosql-injection', 'db.collection("x").find({name:`${u}`});')).toHaveLength(1);
  });

  it('no-log-injection detects user input and skips console', () => {
    expect(run('no-log-injection', 'logger.info(`user: ${req.body.name}`);')).toHaveLength(1);
    expect(run('no-log-injection', 'console.log("static");')).toHaveLength(0);
  });

  it('no-redos detects nested quantifiers', () => {
    expect(run('no-redos', 'const r = /(a+)+/;')).toHaveLength(1);
    expect(run('no-redos', 'const r = /abc/;')).toHaveLength(0);
  });

  it('no-hardcoded-key-iv detects literal key', () => {
    expect(run('no-hardcoded-key-iv', 'const key = "abcdef1234567890";')).toHaveLength(1);
    expect(run('no-hardcoded-key-iv', 'const key = process.env.KEY;')).toHaveLength(0);
  });

  it('no-missing-cert-validation detects disabled validation', () => {
    expect(
      run('no-missing-cert-validation', 'https.request({rejectUnauthorized:false});'),
    ).toHaveLength(1);
    expect(run('no-missing-cert-validation', 'NODE_TLS_REJECT_UNAUTHORIZED=0;')).toHaveLength(1);
  });

  it('no-predictable-seed detects numeric seed and Date.now', () => {
    expect(run('no-predictable-seed', 'random.seed(12345);')).toHaveLength(1);
    expect(run('no-predictable-seed', 'srand(Date.now());')).toHaveLength(1);
  });

  it('no-missing-auth detects admin route without auth', () => {
    expect(run('no-missing-auth', 'app.delete("/api/admin/users", h);')).toHaveLength(1);
  });

  it('no-permissive-cors detects wildcard origin', () => {
    expect(run('no-permissive-cors', 'cors({origin: "*"});')).toHaveLength(1);
  });

  it('no-missing-rate-limit detects express without rate limit', () => {
    expect(run('no-missing-rate-limit', 'const app = express();')).toHaveLength(1);
  });

  it('no-error-exposure detects raw error in response', () => {
    expect(run('no-error-exposure', 'res.json(err);')).toHaveLength(1);
  });

  it('no-prototype-pollution detects merge with user input', () => {
    expect(run('no-prototype-pollution', '_.merge({}, req.body);')).toHaveLength(1);
  });

  it('no-integer-overflow detects parseInt on request input', () => {
    expect(run('no-integer-overflow', 'const n = parseInt(req.query.n);')).toHaveLength(1);
  });

  it('no-unsafe-dynamic-import detects user-derived import path', () => {
    expect(run('no-unsafe-dynamic-import', 'import(req.query.mod);')).toHaveLength(1);
  });

  it('no-missing-input-size-limit detects server without body limit', () => {
    expect(run('no-missing-input-size-limit', 'const app = express();')).toHaveLength(1);
  });

  it('no-unrestricted-upload detects multer without type filter', () => {
    expect(run('no-unrestricted-upload', 'const up = multer({ dest: "up/" });')).toHaveLength(1);
  });

  it('no-toctou detects existsSync followed by writeFile', () => {
    const src = 'if (fs.existsSync(p)) {\n  fs.writeFile(p, data);\n}';
    expect(run('no-toctou', src)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// isTestFile branches
// ---------------------------------------------------------------------------

describe('isTestFile', () => {
  it('matches .test., .spec., __tests__, and __mocks__', () => {
    expect(isTestFile('a.test.ts')).toBe(true);
    expect(isTestFile('a.spec.ts')).toBe(true);
    expect(isTestFile('src/__tests__/a.ts')).toBe(true);
    expect(isTestFile('src/__mocks__/a.ts')).toBe(true);
    expect(isTestFile('src/app.ts')).toBe(false);
  });

  it('no-missing-rate-limit and no-missing-input-size-limit skip test files', () => {
    const testPath = 'app.test.ts';
    expect(
      run('no-missing-rate-limit', 'const app = express();', 'typescript', testPath),
    ).toHaveLength(0);
    expect(
      run('no-missing-input-size-limit', 'const app = express();', 'typescript', testPath),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regex fallback (when tree-sitter grammar is unavailable)
// ---------------------------------------------------------------------------

describe('regex fallback extraction', () => {
  it('falls back to regex for unknown languages', () => {
    const ctx = createAstContext(
      ['const x = 1;', 'eval(code);', 'const s = "abc";'],
      't.unknown',
      'unknown',
    );
    expect(ctx.hasAst).toBe(false);
    expect(ctx.calls.some((c) => c.name === 'eval')).toBe(true);
    expect(ctx.strings.some((s) => s.value === 'abc')).toBe(true);
    expect(ctx.assignments.some((a) => a.name === 'x')).toBe(true);
  });

  it('still detects no-eval via regex fallback', () => {
    expect(run('no-eval', 'eval(code);', 'unknown')).toHaveLength(1);
  });
});
