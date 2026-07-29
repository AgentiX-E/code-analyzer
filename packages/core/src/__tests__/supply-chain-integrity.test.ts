// @code-analyzer/core — Supply Chain Integrity Tests

import { describe, it, expect } from 'vitest';
import {
  IntegrityVerifier,
  isRestrictedLicense,
  scanForSecrets,
  SECRET_PATTERNS,
} from '../security/supply-chain-integrity.js';
import type { IntegrityManifest } from '../security/supply-chain-integrity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(): IntegrityManifest {
  return {
    version: '1.0',
    timestamp: '2026-01-01T00:00:00Z',
    commitSha: 'abc123def456',
    packageVersion: '1.0.0',
    files: {
      'src/index.ts': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    dependencies: [
      { name: 'typescript', version: '5.0.0', integrity: 'sha512-abc', license: 'Apache-2.0' },
      { name: 'left-pad', version: '1.0.0', integrity: 'sha512-def', license: 'GPL-3.0' },
    ],
    slsaLevel: 2,
  };
}

// ---------------------------------------------------------------------------
// IntegrityVerifier
// ---------------------------------------------------------------------------

describe('IntegrityVerifier', () => {
  describe('loadManifest', () => {
    it('should accept a valid manifest', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      expect(v.getManifest()).toBeTruthy();
    });

    it('should throw for unsupported version', () => {
      const v = new IntegrityVerifier();
      const bad = { ...makeManifest(), version: '2.0' as any };
      expect(() => v.loadManifest(bad)).toThrow(/Unsupported manifest version/);
    });

    it('should throw for missing commitSha', () => {
      const v = new IntegrityVerifier();
      const bad = { ...makeManifest(), commitSha: '' };
      expect(() => v.loadManifest(bad)).toThrow(/commitSha/);
    });

    it('should throw for missing files', () => {
      const v = new IntegrityVerifier();
      const bad = { ...makeManifest(), files: null as any };
      expect(() => v.loadManifest(bad)).toThrow(/files/);
    });
  });

  describe('verifyFile', () => {
    it('should return true for matching hash', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      // Empty file hashes to known value
      expect(v.verifyFile('src/index.ts', '')).toBe(true);
    });

    it('should return false for non-matching hash', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      expect(v.verifyFile('src/index.ts', 'modified content')).toBe(false);
    });

    it('should return false for unknown file', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      expect(v.verifyFile('src/unknown.ts', '')).toBe(false);
    });

    it('should throw when no manifest loaded', () => {
      const v = new IntegrityVerifier();
      expect(() => v.verifyFile('x', '')).toThrow(/No manifest loaded/);
    });
  });

  describe('verifyDependency', () => {
    it('should return true for matching dependency', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      expect(v.verifyDependency('typescript', '5.0.0', 'sha512-abc')).toBe(true);
    });

    it('should return false for wrong integrity', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      expect(v.verifyDependency('typescript', '5.0.0', 'sha512-wrong')).toBe(false);
    });
  });

  describe('audit', () => {
    it('should pass for valid files', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      const result = v.audit(new Map([['src/index.ts', Buffer.from('')]]));
      expect(result.passed).toBe(true);
    });

    it('should fail for tampered files', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      const result = v.audit(new Map([['src/index.ts', Buffer.from('tampered')]]));
      expect(result.passed).toBe(false);
      expect(result.failedFiles).toContain('src/index.ts');
    });

    it('should detect restricted licenses', () => {
      const v = new IntegrityVerifier();
      v.loadManifest(makeManifest());
      const result = v.audit(new Map());
      expect(result.violations.some((v) => v.category === 'license')).toBe(true);
    });

    it('should detect SLSA level below minimum', () => {
      const v = new IntegrityVerifier();
      const manifest = { ...makeManifest(), slsaLevel: 1 };
      v.loadManifest(manifest);
      const result = v.audit(new Map());
      expect(result.violations.some((v) => v.category === 'signature')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// isRestrictedLicense
// ---------------------------------------------------------------------------

describe('isRestrictedLicense', () => {
  it('should return true for GPL-3.0', () => {
    expect(isRestrictedLicense('GPL-3.0')).toBe(true);
  });

  it('should return true for AGPL-3.0', () => {
    expect(isRestrictedLicense('AGPL-3.0')).toBe(true);
  });

  it('should return false for MIT', () => {
    expect(isRestrictedLicense('MIT')).toBe(false);
  });

  it('should return false for Apache-2.0', () => {
    expect(isRestrictedLicense('Apache-2.0')).toBe(false);
  });

  it('should return true for BUSL-1.1', () => {
    expect(isRestrictedLicense('BUSL-1.1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Secret Scanning
// ---------------------------------------------------------------------------

describe('scanForSecrets', () => {
  it('should detect GitHub PAT', () => {
    const violations = scanForSecrets('const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890AB";', 'test.ts');
    expect(violations.some((v) => v.message.includes('GitHub Token'))).toBe(true);
  });

  it('should detect OpenAI API key', () => {
    const violations = scanForSecrets('const key = "sk-abcdefghijklmnopqrstuvwxyz123456";', 'test.ts');
    expect(violations.some((v) => v.message.includes('OpenAI'))).toBe(true);
  });

  it('should detect private key headers', () => {
    const violations = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----', 'key.pem');
    expect(violations.some((v) => v.message.includes('Private Key'))).toBe(true);
  });

  it('should detect AWS access keys', () => {
    const violations = scanForSecrets('AWS_KEY=AKIAIOSFODNN7EXAMPLE', '.env');
    expect(violations.some((v) => v.message.includes('AWS Access'))).toBe(true);
  });

  it('should detect hardcoded passwords', () => {
    const violations = scanForSecrets('password = "superSecret123!"', 'config.ts');
    expect(violations.some((v) => v.message.includes('Password'))).toBe(true);
  });

  it('should detect JWT tokens', () => {
    const violations = scanForSecrets(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.dummySignatureValue',
      'request.ts',
    );
    expect(violations.some((v) => v.message.includes('JWT'))).toBe(true);
  });

  it('should return empty array for clean content', () => {
    const violations = scanForSecrets('const x = 42;', 'clean.ts');
    expect(violations).toHaveLength(0);
  });

  it('should report correct file path', () => {
    const violations = scanForSecrets('ghp_abcdefghijklmnopqrstuvwxyz1234567890AB', 'secrets.ts');
    expect(violations[0]!.path).toBe('secrets.ts');
  });
});

// ---------------------------------------------------------------------------
// SECRET_PATTERNS
// ---------------------------------------------------------------------------

describe('SECRET_PATTERNS', () => {
  it('should include all standard pattern types', () => {
    const names = SECRET_PATTERNS.map((p) => p.name);
    expect(names).toContain('GitHub Token (PAT)');
    expect(names).toContain('AWS Access Key');
    expect(names).toContain('OpenAI API Key');
    expect(names).toContain('Private Key Header');
    expect(names).toContain('JWT Token');
  });

  it('should have valid severity for all patterns', () => {
    for (const p of SECRET_PATTERNS) {
      expect(['critical', 'high', 'medium', 'low']).toContain(p.severity);
    }
  });

  it('should reset regex state between scans', () => {
    const content = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890AB';
    const r1 = scanForSecrets(content, 'a.ts');
    const r2 = scanForSecrets(content, 'b.ts');
    expect(r1.length).toBe(r2.length);
  });
});
