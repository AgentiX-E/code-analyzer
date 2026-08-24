// @ts-nocheck
// @code-analyzer/intelligence — AST security rule branch coverage: comment-line
// skipping and negative/edge branches not exercised by the existing suites.

import { describe, it, expect } from 'vitest';
import { CHECKER_MAP } from '../rules/rule-runner.js';

function run(ruleId: string, source: string) {
  const c = CHECKER_MAP[ruleId];
  if (!c) throw new Error('No checker: ' + ruleId);
  return c(source.split('\n'), 'app.ts', 'typescript');
}

// Rules that iterate ctx.lines and skip comment lines via `isComment(line)`.
const LINE_LOOP_RULES = [
  'no-xxe',
  'no-ldap-injection',
  'no-nosql-injection',
  'no-redos',
  'no-missing-cert-validation',
  'no-missing-auth',
  'no-permissive-cors',
  'no-error-exposure',
  'no-integer-overflow',
  'no-unrestricted-upload',
  'no-toctou',
];

describe('AST security rules — comment-line skipping', () => {
  for (const ruleId of LINE_LOOP_RULES) {
    it(`skips comment lines for ${ruleId}`, () => {
      // A comment line that resembles the detection pattern must not fire.
      const src =
        '// new DOMParser().parseFromString(xml);\n' +
        '// ldap.search(`cn=${user}`);\n' +
        '// db.find({name:`${u}`});\n';
      expect(run(ruleId, src)).toHaveLength(0);
    });
  }
});

describe('checkNoDebugAst — bare debugger keyword on a comment line', () => {
  it('skips a commented-out debugger statement', () => {
    expect(run('no-debug-statement', '// debugger;')).toHaveLength(0);
  });
});

describe('checkPredictableSeedAst — new Date() seed', () => {
  it('flags a Date-derived seed', () => {
    expect(run('no-predictable-seed', 'random.seed(new Date());').length).toBeGreaterThan(0);
  });
});

describe('checkMissingAuthCheckAst — route with visible auth', () => {
  it('does not flag a sensitive route when auth middleware follows', () => {
    const src = [
      "app.get('/admin/users', handler);",
      '  authenticate(req, res, next);',
      '  authorize(role);',
    ].join('\n');
    expect(run('no-missing-auth', src)).toHaveLength(0);
  });
});

describe('checkMissingRateLimitAst — app with rate limiting', () => {
  it('does not flag an app that configures a rate limiter', () => {
    const src = ['const app = express();', 'app.use(rateLimit({ windowMs: 60000 }));'].join('\n');
    expect(run('no-missing-rate-limit', src)).toHaveLength(0);
  });
});

describe('checkPrototypePollutionAst — safe merge', () => {
  it('does not flag a merge whose first argument is not an empty object', () => {
    expect(run('no-prototype-pollution', 'Object.assign(target, req.body);')).toHaveLength(0);
  });
});

describe('checkUnsafeDynamicImportAst — non-import call', () => {
  it('does not flag a regular function call', () => {
    expect(run('no-unsafe-dynamic-import', 'loadModule(req.params.name);')).toHaveLength(0);
  });
});

describe('checkUnrestrictedFileUploadAst — upload with a type filter', () => {
  it('does not flag an upload guarded by fileFilter', () => {
    const src = [
      "app.post('/upload', upload.single('file'), (req, res) => {});",
      'const upload = multer({ fileFilter: checkMimeType });',
    ].join('\n');
    expect(run('no-unrestricted-upload', src)).toHaveLength(0);
  });
});

describe('checkToctouAst — exists check at end of file', () => {
  it('tolerates a trailing existsSync without a following operation', () => {
    const src = 'const ok = fs.existsSync(path);';
    expect(run('no-toctou', src)).toHaveLength(0);
  });
});

describe('checkNoDebugAst — bare debugger keyword on a comment line', () => {
  it('skips a commented-out debugger statement', () => {
    expect(run('no-debug-statement', '// debugger;')).toHaveLength(0);
  });
});

describe('checkHardcodedSecretsAst — commented secret assignment', () => {
  it('does not flag a secret assignment on a commented line', () => {
    const src = '// const password = "example";';
    expect(run('no-hardcoded-secrets', src)).toHaveLength(0);
  });
});

describe('checkUnsafeDeserializationAst — parse wrapped in try', () => {
  it('does not flag a JSON.parse guarded by a try block', () => {
    const src = ['try {', '  const x = JSON.parse(body);', '} catch (e) {}'].join('\n');
    expect(run('no-unsafe-deserialization', src)).toHaveLength(0);
  });
});

describe('checkHttpUrlAst — commented http URL', () => {
  it('does not flag an http URL on a commented line', () => {
    const src = '// const api = "http://example.com";';
    expect(run('no-http-url', src)).toHaveLength(0);
  });
});
