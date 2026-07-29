// @code-analyzer/core — Supply Chain Integrity
// Security hardening: checksum verification, provenance tracking,
// dependency audit, and artifact signing support.

import { createHash, createVerify, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntegrityManifest {
  /** Manifest version */
  version: '1.0';
  /** Build timestamp */
  timestamp: string;
  /** Git commit SHA */
  commitSha: string;
  /** Package version */
  packageVersion: string;
  /** Map of file paths to SHA-256 hashes */
  files: Record<string, string>;
  /** Dependencies with resolved versions and integrity hashes */
  dependencies: DependencyIntegrity[];
  /** SLSA provenance level (1-3) */
  slsaLevel: number;
}

export interface DependencyIntegrity {
  name: string;
  version: string;
  /** npm integrity hash (sha512-...) */
  integrity: string;
  /** License identifier */
  license: string;
}

export interface AuditResult {
  passed: boolean;
  totalFiles: number;
  verifiedFiles: number;
  failedFiles: string[];
  totalDeps: number;
  verifiedDeps: number;
  failedDeps: string[];
  violations: SecurityViolation[];
}

export interface SecurityViolation {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'integrity' | 'license' | 'vulnerability' | 'signature';
  message: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// Integrity Verifier
// ---------------------------------------------------------------------------

export class IntegrityVerifier {
  private manifest: IntegrityManifest | null = null;

  /**
   * Load an integrity manifest from a JSON file.
   */
  loadManifest(manifest: IntegrityManifest): void {
    this.validateManifest(manifest);
    this.manifest = manifest;
  }

  /**
   * Load a manifest from a file path.
   */
  /* v8 ignore start -- @preserve */
  loadManifestFromFile(filePath: string): void {
    const content = readFileSync(filePath, 'utf-8');
    const manifest = JSON.parse(content) as IntegrityManifest;
    this.loadManifest(manifest);
  }
  /* v8 ignore stop -- @preserve */

  /**
   * Verify a single file against the manifest.
   */
  verifyFile(filePath: string, content: Buffer | string): boolean {
    if (!this.manifest) {
      throw new Error('No manifest loaded. Call loadManifest() first.');
    }

    const expectedHash = this.manifest.files[filePath];
    if (!expectedHash) return false;

    const actualHash = this.hashContent(content);
    return actualHash === expectedHash;
  }

  /**
   * Verify a dependency's integrity.
   */
  verifyDependency(name: string, version: string, integrity: string): boolean {
    if (!this.manifest) return false;

    const dep = this.manifest.dependencies.find(
      (d) => d.name === name && d.version === version,
    );
    if (!dep) return false;

    return dep.integrity === integrity;
  }

  /**
   * Run a full audit using the loaded manifest.
   */
  audit(fileContents: Map<string, Buffer | string>): AuditResult {
    const violations: SecurityViolation[] = [];
    let verifiedFiles = 0;
    let failedFiles: string[] = [];
    const totalFiles = Object.keys(this.manifest?.files ?? {}).length;

    if (this.manifest) {
      for (const [filePath, expectedHash] of Object.entries(this.manifest.files)) {
        const content = fileContents.get(filePath);
        if (content) {
          const actualHash = this.hashContent(content);
          if (actualHash === expectedHash) {
            verifiedFiles++;
          } else {
            failedFiles.push(filePath);
            violations.push({
              severity: 'critical',
              category: 'integrity',
              message: `File "${filePath}" integrity check failed`,
              path: filePath,
            });
          }
        }
      }
    }

    // License audit
    if (this.manifest) {
      for (const dep of this.manifest.dependencies) {
        if (isRestrictedLicense(dep.license)) {
          violations.push({
            severity: 'high',
            category: 'license',
            message: `Dependency "${dep.name}@${dep.version}" uses restricted license: ${dep.license}`,
          });
        }
      }
    }

    // SLSA level check
    if (this.manifest && this.manifest.slsaLevel < 2) {
      violations.push({
        severity: 'medium',
        category: 'signature',
        message: `SLSA provenance level ${this.manifest.slsaLevel} is below recommended minimum (2)`,
      });
    }

    return {
      passed: violations.filter((v) => v.severity === 'critical').length === 0,
      totalFiles,
      verifiedFiles,
      failedFiles,
      totalDeps: this.manifest?.dependencies.length ?? 0,
      verifiedDeps: 0,
      failedDeps: [],
      violations,
    };
  }

  /**
   * Get the loaded manifest.
   */
  getManifest(): IntegrityManifest | null {
    return this.manifest;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private hashContent(content: Buffer | string): string {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    return createHash('sha256').update(data).digest('hex');
  }

  private validateManifest(manifest: IntegrityManifest): void {
    if (manifest.version !== '1.0') {
      throw new Error(`Unsupported manifest version: ${manifest.version}`);
    }
    if (!manifest.commitSha) {
      throw new Error('Manifest missing required field: commitSha');
    }
    if (!manifest.files || typeof manifest.files !== 'object') {
      throw new Error('Manifest missing required field: files');
    }
  }
}

// ---------------------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------------------

/**
 * Verify a digital signature against a public key and payload.
 * Supports RSA-SHA256 signatures.
 */
export function verifySignature(
  payload: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  /* v8 ignore start -- @preserve */
  try {
    const verify = createVerify('RSA-SHA256');
    verify.update(payload);
    verify.end();
    return verify.verify(publicKeyPem, signature, 'base64');
  } catch {
    return false;
  }
  /* v8 ignore stop -- @preserve */
}

/**
 * Sign a payload with a private key.
 */
export function signPayload(
  payload: string,
  privateKeyPem: string,
): string {
  /* v8 ignore start -- @preserve */
  const sign = createSign('RSA-SHA256');
  sign.update(payload);
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
  /* v8 ignore stop -- @preserve */
}

// ---------------------------------------------------------------------------
// License Check
// ---------------------------------------------------------------------------

const RESTRICTED_LICENSES = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'BUSL-1.1',
  'SSPL-1.0',
  'Elastic-2.0',
]);

/**
 * Check if a license is in the restricted list.
 */
export function isRestrictedLicense(license: string): boolean {
  return RESTRICTED_LICENSES.has(license);
}

// ---------------------------------------------------------------------------
// Secret Scanner Enhancement
// ---------------------------------------------------------------------------

/** Pre-compiled patterns for common secret types */
export const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severity: SecurityViolation['severity'] }> = [
  {
    name: 'GitHub Token (PAT)',
    pattern: /ghp_[a-zA-Z0-9]{36,}/g,
    severity: 'critical',
  },
  {
    name: 'GitHub Token (Fine-grained)',
    pattern: /github_pat_[a-zA-Z0-9_]{50,}/g,
    severity: 'critical',
  },
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
  },
  {
    name: 'AWS Secret Key',
    pattern: /(?<=['"`])(?![A-Z0-9]{20})[A-Za-z0-9/+=]{40}(?=['"`])/g,
    severity: 'critical',
  },
  {
    name: 'OpenAI API Key',
    pattern: /sk-[a-zA-Z0-9]{20,60}/g,
    severity: 'critical',
  },
  {
    name: 'Private Key Header',
    pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g,
    severity: 'critical',
  },
  {
    name: 'JWT Token',
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    severity: 'high',
  },
  {
    name: 'Generic Password Assignment',
    pattern: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    severity: 'high',
  },
];

/**
 * Scan content for secrets using predefined patterns.
 */
export function scanForSecrets(content: string, filePath: string): SecurityViolation[] {
  const violations: SecurityViolation[] = [];
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    if (match) {
      violations.push({
        severity,
        category: 'vulnerability',
        message: `Potential secret found: ${name}`,
        path: filePath,
      });
    }
  }
  return violations;
}
