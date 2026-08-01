import { describe, it, expect } from 'vitest';

import { SecretScanner } from '../security/secret-scanner.js';
import type { SecretScanResult } from '../security/secret-scanner.js';

describe('SecretScanner', () => {
  // -----------------------------------------------------------------------
  // Built-in Patterns
  // -----------------------------------------------------------------------

  describe('getPatterns', () => {
    it('should return built-in patterns', () => {
      const patterns = SecretScanner.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(Array.isArray(patterns)).toBe(true);
      patterns.forEach((p) => expect(p).toBeInstanceOf(RegExp));
    });
  });

  // -----------------------------------------------------------------------
  // Redaction
  // -----------------------------------------------------------------------

  describe('redact', () => {
    it('should redact any secret value', () => {
      const result = SecretScanner.redact('sk-proj-abcdefghijklmnopqrstuvwxyz123456');
      expect(result).toBe('[REDACTED]');
      expect(result).not.toContain('sk-proj');
      expect(result).not.toContain('abcdef');
    });

    it('should redact a short value', () => {
      const result = SecretScanner.redact('abc');
      expect(result).toBe('[REDACTED]');
    });

    it('should redact a long value', () => {
      const result = SecretScanner.redact('a'.repeat(100));
      expect(result).toBe('[REDACTED]');
    });
  });

  // -----------------------------------------------------------------------
  // isLikelySecret (Entropy)
  // -----------------------------------------------------------------------

  describe('isLikelySecret', () => {
    it('should return false for short strings', () => {
      const scanner = new SecretScanner();
      expect(scanner.isLikelySecret('abc')).toBe(false);
      expect(scanner.isLikelySecret('short')).toBe(false);
    });

    it('should return false for low-entropy strings', () => {
      const scanner = new SecretScanner();
      expect(scanner.isLikelySecret('aaaaaaaaaaaaaa')).toBe(false);
      expect(scanner.isLikelySecret('abcabcabcabc')).toBe(false);
    });

    it('should return true for high-entropy strings', () => {
      const scanner = new SecretScanner();
      expect(scanner.isLikelySecret('kh2Xp9mN4vR7qW3tY8uL5')).toBe(true);
    });

    it('should respect custom entropy threshold', () => {
      const strictScanner = new SecretScanner({ entropyThreshold: 5.0 });
      expect(strictScanner.isLikelySecret('abcdef1XJK')).toBe(false);

      const looseScanner = new SecretScanner({ entropyThreshold: 1.0 });
      expect(looseScanner.isLikelySecret('abcdefgh')).toBe(true);
    });

    it('should handle empty string', () => {
      const scanner = new SecretScanner();
      expect(scanner.isLikelySecret('')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // scanText — AWS keys
  // -----------------------------------------------------------------------

  describe('scanText — AWS keys', () => {
    it('should detect AWS access key IDs', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('api_key');
      expect(results[0]!.match).toBe('[REDACTED]');
    });

    it('should not false-positive on non-AWS strings', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText('const keyGroup = "AKIA"; // not an actual key');
      expect(results.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // scanText — GitHub tokens
  // -----------------------------------------------------------------------

  describe('scanText — GitHub tokens', () => {
    it('should detect GitHub personal access tokens (classic)', () => {
      const scanner = new SecretScanner();
      // Exactly 36 chars after ghp_ (40 total with ghp_)
      const results = scanner.scanText('export GITHUB_TOKEN=ghp_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('token');
      expect(results[0]!.severity).toBe('critical');
    });

    it('should detect GitHub fine-grained PATs', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText('GH_TOKEN=github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('token');
    });

    it('should not detect incomplete GitHub tokens', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText('token=ghp_short');
      expect(results.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // scanText — JWT tokens
  // -----------------------------------------------------------------------

  describe('scanText — JWT tokens', () => {
    it('should detect JWT tokens', () => {
      const scanner = new SecretScanner();
      const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const results = scanner.scanText(`Authorization: Bearer ${token}`);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('token');
    });
  });

  // -----------------------------------------------------------------------
  // scanText — Private Keys
  // -----------------------------------------------------------------------

  describe('scanText — Private Keys', () => {
    it('should detect RSA private keys', () => {
      const scanner = new SecretScanner();
      const content = `-----BEGIN RSA PRIVATE KEY-----
MIICXAIBAAKBgQCqGKukO1De7zhZj6+H0qtjTkVxwTCpvKe4eCZ0FPqri0cb2JZfXJ/DgYSF6vUp
-----END RSA PRIVATE KEY-----`;
      const results = scanner.scanText(content);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('private_key');
    });

    it('should detect EC private keys', () => {
      const scanner = new SecretScanner();
      const content = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgqvZ8KjpQv9QJ3zDB
-----END PRIVATE KEY-----`;
      const results = scanner.scanText(content);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('private_key');
    });
  });

  // -----------------------------------------------------------------------
  // scanText — Certificates
  // -----------------------------------------------------------------------

  describe('scanText — Certificates', () => {
    it('should detect certificate PEM blocks', () => {
      const scanner = new SecretScanner();
      const content = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKlK6nNsd09PMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
-----END CERTIFICATE-----`;
      const results = scanner.scanText(content);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('certificate');
    });
  });

  // -----------------------------------------------------------------------
  // scanText — Connection Strings
  // -----------------------------------------------------------------------

  describe('scanText — Connection Strings', () => {
    it('should detect MongoDB connection strings', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("const uri = 'mongodb://admin:pass123@localhost:27017/mydb'");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('connection_string');
    });

    it('should detect MongoDB SRV connection strings', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("const uri = 'mongodb+srv://user:password@cluster.mongodb.net/db'");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect PostgreSQL connection strings', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("DATABASE_URL=postgres://user:pass@localhost:5432/db");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('connection_string');
    });

    it('should detect MySQL connection strings', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("DB=mysql://root:secret@localhost:3306/mydb");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('connection_string');
    });

    it('should detect Redis connection strings', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("CACHE_URL=redis://:redispwd@redis.example.com:6379/0");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('connection_string');
    });

    it('should detect URLs with embedded credentials', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("ENDPOINT=http://admin:secret123@api.example.com/v1");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('connection_string');
    });
  });

  // -----------------------------------------------------------------------
  // scanText — Passwords
  // -----------------------------------------------------------------------

  describe('scanText — Passwords', () => {
    it('should detect password assignments', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("password = 'MySecretP@ssw0rd123'");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('password');
      expect(results[0]!.severity).toBe('critical');
    });

    it('should detect password with colon separator', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText('password: "supersecretpassword"');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('password');
    });

    it('should redact password matches', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("password = 'MySecretValue123'");
      expect(results.length).toBeGreaterThanOrEqual(1);
      // The match must never contain the actual secret
      expect(results[0]!.match).toBe('[REDACTED]');
      expect(results[0]!.match).not.toContain('MySecretValue');
    });
  });

  // -----------------------------------------------------------------------
  // scanText — API Keys
  // -----------------------------------------------------------------------

  describe('scanText — API Keys', () => {
    it('should detect API key assignments', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("api_key='abcdefghijklmnopqrst1234567890'");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('api_key');
    });

    it('should detect secret key assignments', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("secret_key = 'prod-secret-must-not-be-here'");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.severity).toBe('critical');
    });
  });

  // -----------------------------------------------------------------------
  // scanText — Token Assignments
  // -----------------------------------------------------------------------

  describe('scanText — Token Assignments', () => {
    it('should detect generic token assignments', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("token = 'abc123def456ghi789jkl012mno345pqr'");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('token');
    });

    it('should not detect short token-like strings', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("token = 'short'");
      // "token =" with a short value won't match the 24-char minimum
      const tokenResults = results.filter((r) => r.type === 'token');
      expect(tokenResults.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // scanFile
  // -----------------------------------------------------------------------

  describe('scanFile', () => {
    it('should detect secrets with file path and line numbers', () => {
      const scanner = new SecretScanner();
      const content = `line1
line2
api_key='abcdefghijklmnopqrstuvwxyz012'
line4`;

      const results = scanner.scanFile('/app/config.ts', content);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.filePath).toBe('/app/config.ts');
      expect(results[0]!.line).toBe(3);
    });

    it('should detect multiple secrets on different lines', () => {
      const scanner = new SecretScanner();
      const content = `export AWS_KEY=AKIAIOSFODNN7EXAMPLE
# Password below
password = "superSecret123"
# GitHub token (exactly 36 chars after ghp_)
GITHUB_TOKEN=ghp_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r`;

      const results = scanner.scanFile('/app/env.ts', content);
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle empty file content', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanFile('/app/empty.ts', '');
      expect(results).toEqual([]);
    });

    it('should handle file with no secrets', () => {
      const scanner = new SecretScanner();
      const content = 'console.log("hello world");\nconst x = 42;\n';
      const results = scanner.scanFile('/app/clean.ts', content);
      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Custom Patterns
  // -----------------------------------------------------------------------

  describe('custom patterns', () => {
    it('should support custom regex patterns', () => {
      const customPattern = /my_custom_secret\s*=\s*['"]([^'"]+)['"]/gi;
      const scanner = new SecretScanner({ customPatterns: [customPattern] });

      const results = scanner.scanText("my_custom_secret = 'some-hash-value-here'");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.type).toBe('api_key');
    });
  });

  // -----------------------------------------------------------------------
  // Result Structure
  // -----------------------------------------------------------------------

  describe('result structure', () => {
    it('should return well-formed scan results', () => {
      const scanner = new SecretScanner();
      const results = scanner.scanText("AKIAIOSFODNN7EXAMPLE");

      expect(results.length).toBeGreaterThanOrEqual(1);
      const result: SecretScanResult = results[0]!;
      expect(result).toHaveProperty('filePath');
      expect(result).toHaveProperty('line');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('match');
      expect(result).toHaveProperty('severity');
      expect(result).toHaveProperty('confidence');
      expect(result.confidence).toBeCloseTo(0.9, 1);
      expect(['password', 'api_key', 'token', 'private_key', 'certificate', 'connection_string']).toContain(result.type);
      expect(['critical', 'high']).toContain(result.severity);
    });
  });

  // -----------------------------------------------------------------------
  // No Secret Logging
  // -----------------------------------------------------------------------

  describe('no secret logging', () => {
    it('should never include actual secret in match field', () => {
      const scanner = new SecretScanner();
      const secrets = [
        'AKIAIOSFODNN7EXAMPLE',
        'ghp_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r',
        'super-secret-password-value',
        '-----BEGIN RSA PRIVATE KEY-----\nMIICfake\n-----END RSA PRIVATE KEY-----',
      ];

      for (const secret of secrets) {
        const results = scanner.scanText(secret);
        for (const result of results) {
          // Match field must always be '[REDACTED]' — never the actual secret
          expect(result.match).toBe('[REDACTED]');
        }
      }
    });

    it('should redact all match values uniformly', () => {
      const scanner = new SecretScanner();
      const content = `
        AWS_KEY=AKIAIOSFODNN7EXAMPLE
        password = "mySecret123"
        REDIS_URL=redis://:pwd@localhost:6379
      `;
      const results = scanner.scanText(content);

      for (const result of results) {
        expect(result.match).toBe('[REDACTED]');
      }
    });
  });
});
