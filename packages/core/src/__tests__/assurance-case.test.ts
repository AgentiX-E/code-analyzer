// @code-analyzer/core — Security Assurance Case Tests
// Tests for SecurityAuditor, DEFAULT_SECURITY_POLICY, and AuditReport generation.

import { describe, it, expect } from 'vitest';
import {
  SecurityAuditor,
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
  type ThreatCategory,
  type Countermeasure,
  type AuditFinding,
  type AuditReport,
} from '../security/assurance-case.js';

// ---------------------------------------------------------------------------
// DEFAULT_SECURITY_POLICY
// ---------------------------------------------------------------------------

describe('DEFAULT_SECURITY_POLICY', () => {
  it('should have a name and version', () => {
    expect(DEFAULT_SECURITY_POLICY.name).toBe('code-analyzer-security-policy');
    expect(DEFAULT_SECURITY_POLICY.version).toBe('1.0.0');
  });

  it('should cover all 8 threat categories', () => {
    expect(DEFAULT_SECURITY_POLICY.threatModel).toHaveLength(8);
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('pathTraversal');
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('injectionAttack');
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('credentialLeak');
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('dependencyPoisoning');
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('supplyChainAttack');
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('insecureDeserialization');
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('brokenAccessControl');
    expect(DEFAULT_SECURITY_POLICY.threatModel).toContain('sensitiveDataExposure');
  });

  it('should have 11 countermeasures', () => {
    expect(DEFAULT_SECURITY_POLICY.countermeasures).toHaveLength(11);
  });

  it('should have compliance frameworks', () => {
    expect(DEFAULT_SECURITY_POLICY.compliance).toContain('OWASP-Top-10-2021');
    expect(DEFAULT_SECURITY_POLICY.compliance).toContain('SLSA-Level-3');
    expect(DEFAULT_SECURITY_POLICY.compliance).toContain('CWE-Top-25');
  });

  it('should have all countermeasures enabled by default', () => {
    for (const cm of DEFAULT_SECURITY_POLICY.countermeasures) {
      expect(cm.enabled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// SecurityAuditor.audit — default policy
// ---------------------------------------------------------------------------

describe('SecurityAuditor.audit — default policy', () => {
  it('should pass the default policy', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    expect(report.passed).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it('should have correct summary counts', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    expect(report.summary.totalControls).toBe(11);
    expect(report.summary.passed).toBe(11);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.critical).toBe(0);
    expect(report.summary.high).toBe(0);
  });

  it('should include a valid ISO timestamp', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    expect(report.auditedAt).toBeTruthy();
    expect(() => new Date(report.auditedAt)).not.toThrow();
  });

  it('should reference the policy version', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    expect(report.policyVersion).toBe('1.0.0');
  });

  it('should have a risk score of 0 for fully-passed audit', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    expect(report.riskScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SecurityAuditor.audit — custom policy
// ---------------------------------------------------------------------------

describe('SecurityAuditor.audit — custom policy', () => {
  it('should audit a custom policy', () => {
    const policy: SecurityPolicy = {
      name: 'custom',
      version: '0.1.0',
      threatModel: ['credentialLeak'],
      countermeasures: [
        {
          id: 'cm-custom',
          name: 'Custom Check',
          mitigates: ['credentialLeak'],
          verification: 'manual-review',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    expect(report.passed).toBe(true);
    expect(report.policyVersion).toBe('0.1.0');
    expect(report.summary.totalControls).toBe(1);
  });

  it('should detect uncovered threats', () => {
    const policy: SecurityPolicy = {
      name: 'incomplete',
      version: '1.0.0',
      threatModel: ['credentialLeak', 'pathTraversal'],
      countermeasures: [
        {
          id: 'cm-only-creds',
          name: 'Cred Scan',
          mitigates: ['credentialLeak'],
          verification: 'static-analysis',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    expect(report.passed).toBe(false);
    // One gap finding for the uncovered pathTraversal threat
    const gapFindings = report.findings.filter(f => !f.passed);
    expect(gapFindings.length).toBe(1);
    expect(gapFindings[0]!.category).toBe('pathTraversal');
    expect(gapFindings[0]!.severity).toBe('high');
    expect(gapFindings[0]!.description).toContain('pathTraversal');
  });

  it('should flag disabled countermeasures', () => {
    const policy: SecurityPolicy = {
      name: 'disabled-cm',
      version: '1.0.0',
      threatModel: ['credentialLeak'],
      countermeasures: [
        {
          id: 'cm-secret',
          name: 'Secret Scan',
          mitigates: ['credentialLeak'],
          verification: 'static-analysis',
          enabled: false,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    expect(report.passed).toBe(false);
    expect(report.summary.failed).toBe(1);
    const failed = report.findings.filter(f => !f.passed);
    expect(failed[0]!.description).toContain('disabled');
    expect(failed[0]!.remediation).toContain('Enable');
  });

  it('should generate correct countermeasure IDs (cm-001, cm-002, ...)', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();

    // First finding should be cm-001
    expect(report.findings[0]!.id).toBe('cm-001');
    // Last countermeasure finding should be cm-011
    const cmFindings = report.findings.filter(f => f.id.startsWith('cm-'));
    expect(cmFindings).toHaveLength(11);
    expect(cmFindings[10]!.id).toBe('cm-011');
  });

  it('should generate gap IDs (gap-001, gap-002, ...)', () => {
    const policy: SecurityPolicy = {
      name: 'gaps',
      version: '1.0.0',
      threatModel: ['credentialLeak', 'pathTraversal', 'injectionAttack'],
      countermeasures: [
        {
          id: 'cm-one',
          name: 'Only One',
          mitigates: ['credentialLeak'],
          verification: 'manual-review',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    const gapFindings = report.findings.filter(f => f.id.startsWith('gap-'));
    expect(gapFindings).toHaveLength(2);
    expect(gapFindings[0]!.id).toBe('gap-002');
    expect(gapFindings[1]!.id).toBe('gap-003');
  });
});

// ---------------------------------------------------------------------------
// Severity assignment
// ---------------------------------------------------------------------------

describe('severity assignment', () => {
  it('should assign critical severity to credentialLeak', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['credentialLeak'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['credentialLeak'],
          verification: 'automated-test',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('critical');
  });

  it('should assign critical severity to supplyChainAttack', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['supplyChainAttack'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['supplyChainAttack'],
          verification: 'ci-gate',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('critical');
  });

  it('should assign high severity to injectionAttack', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['injectionAttack'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['injectionAttack'],
          verification: 'static-analysis',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('high');
  });

  it('should assign high severity to brokenAccessControl', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['brokenAccessControl'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['brokenAccessControl'],
          verification: 'automated-test',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('high');
  });

  it('should assign medium severity to pathTraversal', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['pathTraversal'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['pathTraversal'],
          verification: 'automated-test',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('medium');
  });

  it('should assign medium severity to dependencyPoisoning', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['dependencyPoisoning'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['dependencyPoisoning'],
          verification: 'ci-gate',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('medium');
  });

  it('should assign medium severity to sensitiveDataExposure', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['sensitiveDataExposure'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['sensitiveDataExposure'],
          verification: 'manual-review',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('medium');
  });

  it('should assign low severity to insecureDeserialization (default branch)', () => {
    const policy: SecurityPolicy = {
      name: 'test',
      version: '1.0.0',
      threatModel: ['insecureDeserialization'],
      countermeasures: [
        {
          id: 'cm-test',
          name: 'Test',
          mitigates: ['insecureDeserialization'],
          verification: 'static-analysis',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.findings[0]!.severity).toBe('low');
  });

  it('should handle countermeasure with empty mitigates array', () => {
    // When mitigates array is empty, mitgates[0] is undefined, falling through
    // to the ?? operator which defaults to 'brokenAccessControl'
    const policy: SecurityPolicy = {
      name: 'empty-mitigates',
      version: '1.0.0',
      threatModel: ['brokenAccessControl'],
      countermeasures: [
        {
          id: 'cm-empty',
          name: 'Empty Mitigates',
          mitigates: [] as unknown as ThreatCategory[],
          verification: 'automated-test',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    expect(report.findings[0]!.category).toBe('brokenAccessControl');
    expect(report.findings[0]!.severity).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Risk score computation
// ---------------------------------------------------------------------------

describe('risk score computation', () => {
  it('should compute risk score for failed findings', () => {
    const policy: SecurityPolicy = {
      name: 'risky',
      version: '1.0.0',
      threatModel: ['credentialLeak', 'pathTraversal'],
      countermeasures: [
        {
          id: 'cm-disabled',
          name: 'Disabled CM',
          mitigates: ['credentialLeak'],
          verification: 'static-analysis',
          enabled: false,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    // disabled cm (critical=25) + uncovered pathTraversal gap (high=15) = 40
    expect(report.riskScore).toBe(40);
    expect(report.passed).toBe(false);
  });

  it('should clamp risk score to 100', () => {
    // Create many high-severity findings to push risk score > 100
    const countermeasures: Countermeasure[] = [];
    const threats: ThreatCategory[] = [];
    for (let i = 0; i < 8; i++) {
      const threat = (['credentialLeak', 'injectionAttack', 'pathTraversal', 'dependencyPoisoning',
        'supplyChainAttack', 'insecureDeserialization', 'brokenAccessControl', 'sensitiveDataExposure'] as ThreatCategory[])[i]!;
      threats.push(threat);
      // All disabled — each critical/high finding adds to risk
      countermeasures.push({
        id: `cm-${i}`,
        name: `CM ${i}`,
        mitigates: [threat],
        verification: 'manual-review',
        enabled: false,
      });
    }

    const policy: SecurityPolicy = {
      name: 'max-risk',
      version: '1.0.0',
      threatModel: threats,
      countermeasures,
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    // Risk score should be clamped to 100
    expect(report.riskScore).toBe(100);
  });

  it('should have zero risk when all findings pass', () => {
    const policy: SecurityPolicy = {
      name: 'clean',
      version: '1.0.0',
      threatModel: ['pathTraversal'],
      countermeasures: [
        {
          id: 'cm-clean',
          name: 'Clean CM',
          mitigates: ['pathTraversal'],
          verification: 'automated-test',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    expect(report.riskScore).toBe(0);
    expect(report.passed).toBe(true);
  });

  it('should not count passed findings toward risk score', () => {
    const policy: SecurityPolicy = {
      name: 'mixed',
      version: '1.0.0',
      threatModel: ['credentialLeak', 'pathTraversal'],
      countermeasures: [
        {
          id: 'cm-pass',
          name: 'Pass CM',
          mitigates: ['pathTraversal'],
          verification: 'automated-test',
          enabled: true,
        },
        {
          id: 'cm-fail',
          name: 'Fail CM',
          mitigates: ['credentialLeak'],
          verification: 'static-analysis',
          enabled: false,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);

    // Only the failed cm (credentialLeak=critical=25) counts
    expect(report.riskScore).toBe(25);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateReport
// ---------------------------------------------------------------------------

describe('generateReport', () => {
  it('should generate a pass report string', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    const reportStr = auditor.generateReport(report);

    expect(reportStr).toContain('PASSED');
    expect(reportStr).toContain('Policy: code-analyzer v1.0.0');
    expect(reportStr).toContain('Risk Score: 0/100');
    expect(reportStr).toContain('Summary:');
    expect(reportStr).toContain('Findings:');
  });

  it('should generate a fail report string', () => {
    const policy: SecurityPolicy = {
      name: 'failing',
      version: '2.0.0',
      threatModel: ['credentialLeak'],
      countermeasures: [
        {
          id: 'cm-bad',
          name: 'Bad CM',
          mitigates: ['credentialLeak'],
          verification: 'static-analysis',
          enabled: false,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    const reportStr = auditor.generateReport(report);

    expect(reportStr).toContain('FAILED');
    expect(reportStr).toContain('Policy: code-analyzer v2.0.0');
  });

  it('should include remediation text for failed findings', () => {
    const policy: SecurityPolicy = {
      name: 'needs-fix',
      version: '1.0.0',
      threatModel: ['credentialLeak'],
      countermeasures: [
        {
          id: 'cm-disabled',
          name: 'Disabled Scan',
          mitigates: ['credentialLeak'],
          verification: 'static-analysis',
          enabled: false,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    const reportStr = auditor.generateReport(report);

    expect(reportStr).toContain('Remediation:');
    expect(reportStr).toContain('Enable');
  });

  it('should not include remediation for passed findings', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();

    // All pass — check a few findings don't have remediation
    const passedFindings = report.findings.filter(f => f.passed);
    for (const f of passedFindings) {
      expect(f.remediation).toBeUndefined();
    }
  });

  it('should include severity labels in report', () => {
    const policy: SecurityPolicy = {
      name: 'sevs',
      version: '1.0.0',
      threatModel: ['credentialLeak'],
      countermeasures: [
        {
          id: 'cm-sev',
          name: 'Sev CM',
          mitigates: ['credentialLeak'],
          verification: 'automated-test',
          enabled: false,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    const reportStr = auditor.generateReport(report);

    expect(reportStr).toContain('[CRITICAL]');
  });

  it('should include gap remediation guidance', () => {
    const policy: SecurityPolicy = {
      name: 'gaps',
      version: '1.0.0',
      threatModel: ['pathTraversal', 'injectionAttack'],
      countermeasures: [
        {
          id: 'cm-one',
          name: 'One CM',
          mitigates: ['injectionAttack'],
          verification: 'static-analysis',
          enabled: true,
        },
      ],
      compliance: [],
    };

    const auditor = new SecurityAuditor();
    const report = auditor.audit(policy);
    const gapFinding = report.findings.find(f => f.id.startsWith('gap-'));

    expect(gapFinding).toBeDefined();
    expect(gapFinding!.remediation).toContain('Add a countermeasure');
  });
});

// ---------------------------------------------------------------------------
// Verification types
// ---------------------------------------------------------------------------

describe('verification types', () => {
  it('should use correct verification labels for automated-test', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    const automatedTestFinding = report.findings.find(f =>
      f.description.includes('automated test'),
    );
    expect(automatedTestFinding).toBeDefined();
  });

  it('should use correct verification labels for static-analysis', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    const staticAnalysisFinding = report.findings.find(f =>
      f.description.includes('static analysis'),
    );
    expect(staticAnalysisFinding).toBeDefined();
  });

  it('should use correct verification labels for manual-review', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    const manualReviewFinding = report.findings.find(f =>
      f.description.includes('manual security review'),
    );
    expect(manualReviewFinding).toBeDefined();
  });

  it('should use correct verification labels for ci-gate', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();
    const ciGateFinding = report.findings.find(f =>
      f.description.includes('CI pipeline gate'),
    );
    expect(ciGateFinding).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Countermeasure properties
// ---------------------------------------------------------------------------

describe('countermeasure properties', () => {
  it('should include mitigates list in description', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();

    // The dep-review cm mitigates dependencyPoisoning and supplyChainAttack
    const depReview = report.findings.find(f =>
      f.id === 'cm-004',
    );
    expect(depReview).toBeDefined();
    expect(depReview!.description).toContain('dependencyPoisoning');
    expect(depReview!.description).toContain('supplyChainAttack');
  });

  it('should include countermeasure name and ID in description', () => {
    const auditor = new SecurityAuditor();
    const report = auditor.audit();

    const pathSanitize = report.findings.find(f => f.id === 'cm-001');
    expect(pathSanitize).toBeDefined();
    expect(pathSanitize!.description).toContain('Path Sanitization');
    expect(pathSanitize!.description).toContain('cm-path-sanitize');
  });
});
