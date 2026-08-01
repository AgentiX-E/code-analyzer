// @code-analyzer/core — Security Barrel
// RBAC, audit logging, secret scanning, and security assurance.

export { RBACEngine } from './rbac.js';
export type { Permission, Role, RoleDefinition, UserIdentity } from './rbac.js';

export { AuditLogger } from './audit-logger.js';
export type { AuditEvent, AuditQuery, AuditSummary } from './audit-logger.js';

export { SecretScanner } from './secret-scanner.js';
export type { SecretScanResult } from './secret-scanner.js';

export { SecurityAuditor, DEFAULT_SECURITY_POLICY } from './assurance-case.js';
export type {
  SecurityPolicy,
  AuditReport,
  AuditFinding,
  Countermeasure,
  ThreatCategory,
} from './assurance-case.js';
