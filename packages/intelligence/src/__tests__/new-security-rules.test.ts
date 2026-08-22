// @code-analyzer/intelligence — New AST Security Rules Tests

import { describe, it, expect } from 'vitest';
import { CHECKER_MAP } from '../rules/rule-runner.js';

function run(ruleId: string, source: string) {
  const c = CHECKER_MAP[ruleId];
  if (!c) throw new Error('No checker: ' + ruleId);
  return c(source.split('\n'), 'test.ts', 'typescript');
}

describe('Injection Rules', () => {
  it('no-xxe: detects DOMParser', () => {
    expect(
      run('no-xxe', 'new DOMParser().parseFromString(xml, "text/xml");').length,
    ).toBeGreaterThan(0);
  });
  it('no-xxe: skips with noent', () => {
    expect(
      run('no-xxe', 'new DOMParser().parseFromString(xml, "text/xml", { noent: false });').length,
    ).toBe(0);
  });
  it('no-ldap-injection: detects interpolation', () => {
    expect(run('no-ldap-injection', 'ldap.search(`cn=${user}`, base);').length).toBeGreaterThan(0);
  });
  it('no-nosql-injection: detects interpolation', () => {
    expect(
      run('no-nosql-injection', 'db.collection("x").find({name:`${u}`});').length,
    ).toBeGreaterThan(0);
  });
  it('no-log-injection: detects user input in log', () => {
    expect(
      run('no-log-injection', 'logger.info(`user: ${req.body.name}`);').length,
    ).toBeGreaterThan(0);
  });
  it('no-log-injection: skips console', () => {
    expect(run('no-log-injection', 'console.log("static");').length).toBe(0);
  });
});

describe('Crypto Rules', () => {
  it('no-hardcoded-key-iv: detects literal key', () => {
    expect(run('no-hardcoded-key-iv', 'const key = "secret123";').length).toBeGreaterThan(0);
  });
  it('no-hardcoded-key-iv: skips env ref', () => {
    expect(run('no-hardcoded-key-iv', 'const key = process.env.KEY;').length).toBe(0);
  });
  it('no-missing-cert-validation: detects rejectUnauthorized', () => {
    expect(
      run('no-missing-cert-validation', 'https.request({rejectUnauthorized:false});').length,
    ).toBeGreaterThan(0);
  });
  it('no-missing-cert-validation: detects NODE_TLS env', () => {
    expect(
      run('no-missing-cert-validation', 'NODE_TLS_REJECT_UNAUTHORIZED=0;').length,
    ).toBeGreaterThan(0);
  });
  it('no-predictable-seed: detects numeric seed', () => {
    expect(run('no-predictable-seed', 'random.seed(12345);').length).toBeGreaterThan(0);
  });
});

describe('Auth Rules', () => {
  it('no-missing-auth: detects admin route', () => {
    expect(
      run('no-missing-auth', 'app.delete("/api/admin/users", handler);').length,
    ).toBeGreaterThan(0);
  });
  it('no-error-exposure: detects raw err in response', () => {
    expect(run('no-error-exposure', 'res.json(err);').length).toBeGreaterThan(0);
  });
});

describe('Input Rules', () => {
  it('no-prototype-pollution: detects merge', () => {
    expect(run('no-prototype-pollution', 'Object.assign({}, req.body);').length).toBeGreaterThan(0);
  });
  it('no-integer-overflow: detects parseInt', () => {
    expect(run('no-integer-overflow', 'const n = parseInt(req.query.n);').length).toBeGreaterThan(
      0,
    );
  });
  it('no-unsafe-dynamic-import: detects user import', () => {
    expect(run('no-unsafe-dynamic-import', 'import(req.query.mod);').length).toBeGreaterThan(0);
  });
});

describe('File Rules', () => {
  it('no-unrestricted-upload: detects multer without filter', () => {
    expect(
      run('no-unrestricted-upload', 'const up = multer({ dest: "up/" });').length,
    ).toBeGreaterThan(0);
  });
});

describe('Edge Cases', () => {
  it('all rules handle empty source without crash', () => {
    for (const id of Object.keys(CHECKER_MAP)) {
      expect(Array.isArray(run(id, ''))).toBe(true);
    }
  });
});
