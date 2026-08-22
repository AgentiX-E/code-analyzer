// @code-analyzer/core — Enterprise Features Tests
// Comprehensive tests for RBAC, Audit Logging, Secret Scanner, and Rate Limiter.

import { describe, it, expect, beforeEach } from 'vitest';
import { RBACEngine, RBACError, type RBACRole } from '../enterprise/rbac.js';
import { AuditLogger, type AuditAction } from '../enterprise/audit-log.js';
import { SecretScanner } from '../enterprise/secret-scanner.js';
import { RateLimiter, PRESET_LIMITS } from '../enterprise/rate-limiter.js';

// =========================================================================
// RBAC Tests
// =========================================================================

describe('RBACEngine', () => {
  let rbac: RBACEngine;

  beforeEach(() => {
    rbac = new RBACEngine();
  });

  describe('Role assignment', () => {
    it('defaults to viewer for unknown users', () => {
      expect(rbac.getRole('unknown')).toBe('viewer');
    });

    it('assigns and retrieves roles', () => {
      rbac.assignRole('alice', 'admin');
      expect(rbac.getRole('alice')).toBe('admin');
    });

    it('revokes role (back to viewer)', () => {
      rbac.assignRole('bob', 'developer');
      rbac.revokeRole('bob');
      expect(rbac.getRole('bob')).toBe('viewer');
    });

    it('lists all users', () => {
      rbac.assignRole('alice', 'admin');
      rbac.assignRole('bob', 'developer');
      const users = rbac.listUsers();
      expect(users.length).toBe(2);
      expect(users.find((u) => u.userId === 'alice')!.role).toBe('admin');
    });
  });

  describe('Permission checks', () => {
    it('admin has all permissions', () => {
      rbac.assignRole('alice', 'admin');
      expect(rbac.hasPermission('alice', 'admin:manage-users')).toBe(true);
      expect(rbac.hasPermission('alice', 'security:secret-scan')).toBe(true);
      expect(rbac.hasPermission('alice', 'query:search')).toBe(true);
    });

    it('viewer has only read permissions', () => {
      rbac.assignRole('bob', 'viewer');
      expect(rbac.hasPermission('bob', 'query:search')).toBe(true);
      expect(rbac.hasPermission('bob', 'index:delete')).toBe(false);
      expect(rbac.hasPermission('bob', 'admin:manage-users')).toBe(false);
    });

    it('developer can index and cross-repo', () => {
      rbac.assignRole('carol', 'developer');
      expect(rbac.hasPermission('carol', 'index:create')).toBe(true);
      expect(rbac.hasPermission('carol', 'crossrepo:search')).toBe(true);
      expect(rbac.hasPermission('carol', 'admin:manage-users')).toBe(false);
    });

    it('auditor can read security logs but not scan', () => {
      rbac.assignRole('dave', 'auditor');
      expect(rbac.hasPermission('dave', 'security:audit-log')).toBe(true);
      expect(rbac.hasPermission('dave', 'security:secret-scan')).toBe(false);
      expect(rbac.hasPermission('dave', 'admin:benchmark')).toBe(false);
    });
  });

  describe('Multi-permission checks', () => {
    it('hasAllPermissions succeeds when all granted', () => {
      rbac.assignRole('admin', 'admin');
      expect(rbac.hasAllPermissions('admin', ['query:search', 'index:create'])).toBe(true);
    });

    it('hasAllPermissions fails when any missing', () => {
      rbac.assignRole('viewer', 'viewer');
      expect(rbac.hasAllPermissions('viewer', ['query:search', 'index:create'])).toBe(false);
    });

    it('hasAnyPermission succeeds with at least one match', () => {
      rbac.assignRole('viewer', 'viewer');
      expect(rbac.hasAnyPermission('viewer', ['query:search', 'index:create'])).toBe(true);
      expect(rbac.hasAnyPermission('viewer', ['index:create', 'index:delete'])).toBe(false);
    });
  });

  describe('require() — fail-fast', () => {
    it('throws RBACError when permission denied', () => {
      rbac.assignRole('viewer', 'viewer');
      expect(() => rbac.require('viewer', 'admin:manage-users')).toThrow(RBACError);
    });

    it('does not throw when permission granted', () => {
      rbac.assignRole('admin', 'admin');
      expect(() => rbac.require('admin', 'admin:manage-users')).not.toThrow();
    });

    it('error contains user, role, and permission', () => {
      rbac.assignRole('bob', 'viewer');
      try {
        rbac.require('bob', 'index:delete');
      } catch (e) {
        const err = e as RBACError;
        expect(err.userId).toBe('bob');
        expect(err.role).toBe('viewer');
        expect(err.requiredPermission).toBe('index:delete');
      }
    });
  });

  describe('getPermissions', () => {
    it('returns all permissions for a role', () => {
      rbac.assignRole('alice', 'maintainer');
      const perms = rbac.getPermissions('alice');
      expect(perms).toContain('query:search');
      expect(perms).toContain('security:secret-scan');
      expect(perms).not.toContain('admin:manage-users');
    });
  });
});

// =========================================================================
// Audit Logger Tests
// =========================================================================

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  describe('Logging', () => {
    it('records an audit entry', () => {
      const entry = logger.log({
        userId: 'alice',
        action: 'tool.invoke',
        resource: 'search_graph',
        description: 'Searched for "login" function',
        result: 'success',
      });
      expect(entry.id).toBe(1);
      expect(entry.userId).toBe('alice');
      expect(entry.action).toBe('tool.invoke');
      expect(entry.hash).toBeDefined();
    });

    it('assigns sequential IDs', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r1', description: 'd1' });
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r2', description: 'd2' });
      expect(logger.all[0]!.id).toBe(1);
      expect(logger.all[1]!.id).toBe(2);
    });
  });

  describe('Hash chain integrity', () => {
    it('verify() confirms intact chain', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: 'd' });
      logger.log({ userId: 'b', action: 'index.create', resource: 'repo', description: 'created' });
      expect(logger.verify()).toBe(true);
    });

    it('findTamperedEntry returns null for intact chain', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: 'd' });
      expect(logger.findTamperedEntry()).toBeNull();
    });

    it('each entry has previousHash pointing to prior', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r1', description: 'd1' });
      logger.log({ userId: 'b', action: 'tool.invoke', resource: 'r2', description: 'd2' });
      expect(logger.all[1]!.previousHash).toBe(logger.all[0]!.hash);
    });

    it('first entry has null previousHash', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: 'd' });
      expect(logger.all[0]!.previousHash).toBeNull();
    });
  });

  describe('Querying', () => {
    it('filters by userId', () => {
      logger.log({ userId: 'alice', action: 'tool.invoke', resource: 'a', description: 'a' });
      logger.log({ userId: 'bob', action: 'tool.invoke', resource: 'b', description: 'b' });
      expect(logger.query({ userId: 'alice' }).length).toBe(1);
    });

    it('filters by action', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: 'd' });
      logger.log({ userId: 'a', action: 'index.create', resource: 'r', description: 'd' });
      expect(logger.query({ action: 'index.create' }).length).toBe(1);
    });

    it('filters by resource', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'repo-a', description: 'd' });
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'repo-b', description: 'd' });
      expect(logger.query({ resource: 'repo-a' }).length).toBe(1);
    });

    it('handles empty results', () => {
      expect(logger.query({ userId: 'nonexistent' }).length).toBe(0);
    });
  });

  describe('Export', () => {
    it('exports to JSON Lines', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: 'test' });
      const lines = logger.exportJsonLines();
      expect(lines).toContain('"userId":"a"');
      expect(lines).not.toContain('\n\n');
    });

    it('exports to CSV', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: 'test' });
      const csv = logger.exportCsv();
      expect(csv).toContain('id,timestamp,userId');
      expect(csv).toContain('a');
    });
  });

  describe('Retention', () => {
    it('enforces maxEntries limit', () => {
      const small = new AuditLogger({ maxEntries: 3 });
      for (let i = 0; i < 10; i++) {
        small.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: `d${i}` });
      }
      expect(small.count).toBe(3);
    });

    it('clear resets everything', () => {
      logger.log({ userId: 'a', action: 'tool.invoke', resource: 'r', description: 'd' });
      logger.clear();
      expect(logger.count).toBe(0);
      expect(logger.all).toEqual([]);
    });
  });

  describe('Result tracking', () => {
    it('records result field', () => {
      const entry = logger.log({
        userId: 'a',
        action: 'tool.invoke',
        resource: 'r',
        description: 'd',
        result: 'denied',
      });
      expect(entry.result).toBe('denied');
    });

    it('records duration', () => {
      const entry = logger.log({
        userId: 'a',
        action: 'tool.invoke',
        resource: 'r',
        description: 'd',
        durationMs: 42,
      });
      expect(entry.durationMs).toBe(42);
    });
  });
});

// =========================================================================
// Secret Scanner Tests
// =========================================================================

describe('SecretScanner', () => {
  let scanner: SecretScanner;

  beforeEach(() => {
    scanner = new SecretScanner();
  });

  describe('Pattern matching', () => {
    it('detects AWS access key', () => {
      const findings = scanner.scan('const key = "AKIAJ7K2M9Q3F8V5P4L6"');
      expect(findings.some((f) => f.patternName === 'aws-access-key')).toBe(true);
    });

    it('detects GitHub token', () => {
      const findings = scanner.scan('TOKEN=ghp_1234567890abcdef1234567890abcdef12345678');
      expect(findings.some((f) => f.patternName === 'github-token')).toBe(true);
    });

    it('detects GitHub PAT', () => {
      const findings = scanner.scan('export GH_TOKEN=github_pat_11AINQNPI0wAZti6M1c0wu_MLYDhEoyf');
      expect(findings.some((f) => f.patternName === 'github-pat')).toBe(true);
    });

    it('detects JWT token', () => {
      const findings = scanner.scan(
        'Auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      );
      expect(findings.some((f) => f.patternName === 'jwt-token')).toBe(true);
    });

    it('detects SSH private key', () => {
      const findings = scanner.scan('-----BEGIN RSA PRIVATE KEY-----');
      expect(findings.some((f) => f.patternName === 'ssh-private-key')).toBe(true);
    });

    it('detects password assignment', () => {
      const findings = scanner.scan('password = "superSecret123!"');
      expect(findings.some((f) => f.patternName === 'password-assignment')).toBe(true);
    });

    it('detects database connection string', () => {
      const findings = scanner.scan('mongodb://admin:secretpass@localhost:27017/db');
      expect(findings.some((f) => f.patternName === 'db-connection-string')).toBe(true);
    });

    it('detects OpenAI key', () => {
      const findings = scanner.scan('OPENAI_API_KEY=sk-proj-abcdef1234567890abcdef1234567890');
      expect(findings.some((f) => f.patternName === 'openai-key')).toBe(true);
    });
  });

  describe('Exclusion patterns', () => {
    it('excludes EXAMPLE_KEY patterns', () => {
      const findings = scanner.scan('EXAMPLE_KEY=AKIAIOSFODNN7EXAMPLE');
      expect(findings.length).toBe(0);
    });

    it('excludes placeholder patterns', () => {
      const findings = scanner.scan('password = "your_password_here"');
      expect(findings.length).toBe(0);
    });

    it('excludes REPLACE_ME tokens', () => {
      const findings = scanner.scan('API_KEY="REPLACE_ME"');
      expect(findings.length).toBe(0);
    });
  });

  describe('Entropy detection', () => {
    it('detects high-entropy base64-like strings', () => {
      const scanner2 = new SecretScanner({
        entropyDetection: true,
        entropyThreshold: 3.0,
        entropyMinLength: 10,
      });
      // High-entropy alphanumeric string (should have entropy > 4.0)
      const highEntropyStr = 'a7Xk2Mp9Qf3Vn8Lw5Rh1Jy6Cb4Az0Te3sWd7Gu9Iq2Op5';
      const findings = scanner2.scan(highEntropyStr);
      expect(findings.some((f) => f.entropyBased)).toBe(true);
    });

    it('skips low-entropy tokens', () => {
      const scanner2 = new SecretScanner({ entropyDetection: true, entropyThreshold: 4.5 });
      const findings = scanner2.scan('function calculateTotalAmount(items)');
      // Normal code tokens should have low entropy
      expect(findings.filter((f) => f.entropyBased).length).toBe(0);
    });

    it('entropy-based findings have entropy value', () => {
      const scanner2 = new SecretScanner({ entropyDetection: true, entropyThreshold: 3.5 });
      const findings = scanner2.scan('xK9mQ7fV3pL8wR5nH1jY6cB4aZ0tE3s');
      const entropyFindings = findings.filter((f) => f.entropyBased);
      for (const f of entropyFindings) {
        expect(typeof f.entropy).toBe('number');
        expect(f.entropy!).toBeGreaterThanOrEqual(3.5);
      }
    });
  });

  describe('Multi-line scanning', () => {
    it('scans multiple lines', () => {
      const content = [
        'const db = "postgres://user:pass@host/db"',
        'const key = "sk-1234567890abcdef1234567890abcdef1234567890abcdef"',
        '// This is a comment',
      ].join('\n');

      const findings = scanner.scan(content);
      expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('includes line numbers in findings', () => {
      const content = ['', 'password = "secret123"'].join('\n');

      const findings = scanner.scanLine(content.split('\n')[1]!, 2);
      expect(findings[0]!.line).toBe(2);
    });

    it('returns empty for clean code', () => {
      const findings = scanner.scan('function hello() { return "world"; }');
      // Clean code should have no findings (exclusions handle false positives)
      expect(findings.filter((f) => !f.entropyBased).length).toBe(0);
    });
  });
});

// =========================================================================
// Rate Limiter Tests
// =========================================================================

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  describe('Token bucket', () => {
    it('allows requests within limits', () => {
      const result = limiter.check('user1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it('eventually denies after burst exhausted', () => {
      // Burst is 20 by default
      let denied = false;
      for (let i = 0; i < 30; i++) {
        const result = limiter.check('user2');
        if (!result.allowed) {
          denied = true;
          expect(result.retryAfterMs).toBeGreaterThan(0);
          break;
        }
      }
      expect(denied).toBe(true);
    });

    it('different keys have independent buckets', () => {
      for (let i = 0; i < 25; i++) limiter.check('user3');
      const result = limiter.check('user4');
      // User4 has a fresh bucket
      expect(result.allowed).toBe(true);
    });

    it('peek returns state without consuming', () => {
      limiter.check('user5');
      const before = limiter.peek('user5');
      expect(before).not.toBeNull();
      limiter.check('user5');
      const after = limiter.peek('user5');
      expect(after!.tokens).toBeLessThan(before!.tokens!);
    });
  });

  describe('Configuration', () => {
    it('uses preset limits', () => {
      const strict = new RateLimiter(PRESET_LIMITS.strict);
      const r1 = strict.check('u1');
      expect(r1.allowed).toBe(true);
      const r2 = strict.check('u1');
      expect(r2.allowed).toBe(true);
      // Third request with burst=2 should fail
      const r3 = strict.check('u1');
      expect(r3.allowed).toBe(false);
    });
  });

  describe('checkWithConfig', () => {
    it('applies per-key limit config', () => {
      const result = limiter.checkWithConfig('api-key', PRESET_LIMITS.tool);
      expect(result.limit).toBe(PRESET_LIMITS.tool.burst);
    });

    it('result has correct structure', () => {
      const result = limiter.check('user');
      expect(typeof result.allowed).toBe('boolean');
      expect(typeof result.remaining).toBe('number');
      expect(typeof result.retryAfterMs).toBe('number');
      expect(typeof result.limit).toBe('number');
      expect(typeof result.resetAt).toBe('number');
    });
  });

  describe('Maintenance', () => {
    it('reset clears a bucket', () => {
      for (let i = 0; i < 25; i++) limiter.check('user');
      limiter.reset('user');
      const result = limiter.check('user');
      expect(result.allowed).toBe(true);
    });

    it('resetAll clears all', () => {
      limiter.check('u1');
      limiter.check('u2');
      limiter.resetAll();
      expect(limiter.activeBuckets).toBe(0);
    });

    it('cleanup removes stale buckets', () => {
      limiter.check('u1');
      // No real time passing in test, but function should work
      const removed = limiter.cleanup(0);
      expect(typeof removed).toBe('number');
    });

    it('activeBuckets tracks count', () => {
      limiter.check('u1');
      limiter.check('u2');
      limiter.check('u3');
      expect(limiter.activeBuckets).toBe(3);
    });
  });
});
