// @code-analyzer/core — Role-Based Access Control (RBAC)
// Implements 5 roles with 25 granular permissions for enterprise
// multi-tenant deployments. Permissions are grouped by resource category
// and checked at the tool level for MCP operations.

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Standard RBAC roles in ascending privilege order. */
export type RBACRole = 'viewer' | 'auditor' | 'developer' | 'maintainer' | 'admin';

/** All roles in ascending order of privilege. */
export const ALL_ROLES: readonly RBACRole[] = [
  'viewer',
  'auditor',
  'developer',
  'maintainer',
  'admin',
];

// ---------------------------------------------------------------------------
// Permissions (25 granular permissions in 6 categories)
// ---------------------------------------------------------------------------

/** Indexing permissions: control over repository analysis. */
export type IndexingPermission = 'index:read' | 'index:create' | 'index:delete' | 'index:status';

/** Querying permissions: search and exploration operations. */
export type QueryPermission =
  'query:search' | 'query:graph' | 'query:semantic' | 'query:calls' | 'query:architecture';

/** Code Review permissions: review and report operations. */
export type ReviewPermission =
  'review:diff' | 'review:file' | 'review:pr' | 'review:standards' | 'review:report';

/** Cross-Repo permissions: multi-repository operations. */
export type CrossRepoPermission =
  'crossrepo:search' | 'crossrepo:trace' | 'crossrepo:impact' | 'crossrepo:manage';

/** Security permissions: security and audit operations. */
export type SecurityPermission =
  'security:taint' | 'security:pdg' | 'security:secret-scan' | 'security:audit-log';

/** Admin permissions: system-level operations. */
export type AdminPermission =
  'admin:manage-users' | 'admin:manage-roles' | 'admin:system-config' | 'admin:benchmark';

/** All permission strings. */
export type RBACPermission =
  | IndexingPermission
  | QueryPermission
  | ReviewPermission
  | CrossRepoPermission
  | SecurityPermission
  | AdminPermission;

// ---------------------------------------------------------------------------
// Role → Permission Mapping
// ---------------------------------------------------------------------------

/**
 * Permission assignments per role.
 *
 * Viewer:    Read-only access to queries and reviews.
 * Auditor:   Viewer + security audit access.
 * Developer: Auditor + indexing, cross-repo, and basic admin.
 * Maintainer: Developer + all security and review operations.
 * Admin:    All permissions (full access).
 */
const ROLE_PERMISSIONS: Record<RBACRole, readonly RBACPermission[]> = {
  viewer: [
    'query:search',
    'query:graph',
    'query:calls',
    'query:architecture',
    'review:diff',
    'review:file',
    'review:pr',
    'review:report',
    'index:read',
    'index:status',
  ],
  auditor: [
    'query:search',
    'query:graph',
    'query:semantic',
    'query:calls',
    'query:architecture',
    'review:diff',
    'review:file',
    'review:pr',
    'review:standards',
    'review:report',
    'index:read',
    'index:status',
    'security:taint',
    'security:pdg',
    'security:audit-log',
  ],
  developer: [
    'query:search',
    'query:graph',
    'query:semantic',
    'query:calls',
    'query:architecture',
    'review:diff',
    'review:file',
    'review:pr',
    'review:standards',
    'review:report',
    'index:read',
    'index:create',
    'index:delete',
    'index:status',
    'crossrepo:search',
    'crossrepo:trace',
    'crossrepo:impact',
    'crossrepo:manage',
    'security:taint',
    'security:pdg',
    'security:audit-log',
  ],
  maintainer: [
    'query:search',
    'query:graph',
    'query:semantic',
    'query:calls',
    'query:architecture',
    'review:diff',
    'review:file',
    'review:pr',
    'review:standards',
    'review:report',
    'index:read',
    'index:create',
    'index:delete',
    'index:status',
    'crossrepo:search',
    'crossrepo:trace',
    'crossrepo:impact',
    'crossrepo:manage',
    'security:taint',
    'security:pdg',
    'security:secret-scan',
    'security:audit-log',
    'admin:benchmark',
  ],
  admin: [
    'index:read',
    'index:create',
    'index:delete',
    'index:status',
    'query:search',
    'query:graph',
    'query:semantic',
    'query:calls',
    'query:architecture',
    'review:diff',
    'review:file',
    'review:pr',
    'review:standards',
    'review:report',
    'crossrepo:search',
    'crossrepo:trace',
    'crossrepo:impact',
    'crossrepo:manage',
    'security:taint',
    'security:pdg',
    'security:secret-scan',
    'security:audit-log',
    'admin:manage-users',
    'admin:manage-roles',
    'admin:system-config',
    'admin:benchmark',
  ],
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Pre-computed permission set for O(1) lookup per role. */
const CACHED: Map<RBACRole, ReadonlySet<RBACPermission>> = new Map();
for (const role of ALL_ROLES) {
  CACHED.set(role, new Set(ROLE_PERMISSIONS[role]));
}

/**
 * Role-Based Access Control engine.
 * Checks permissions for MCP tool invocations and API requests.
 */
export class RBACEngine {
  private userRoles = new Map<string, RBACRole>();

  /** Assign a role to a user. */
  assignRole(userId: string, role: RBACRole): void {
    this.userRoles.set(userId, role);
  }

  /** Get a user's role. Defaults to 'viewer' for unknown users. */
  getRole(userId: string): RBACRole {
    return this.userRoles.get(userId) ?? 'viewer';
  }

  /** Revoke a user's role (reset to viewer). */
  revokeRole(userId: string): void {
    this.userRoles.delete(userId);
  }

  /**
   * Check if a user has a specific permission.
   * @param userId — User identifier
   * @param permission — Permission to check
   * @returns true if the user's role includes the permission
   */
  hasPermission(userId: string, permission: RBACPermission): boolean {
    const role = this.getRole(userId);
    return CACHED.get(role)?.has(permission) ?? false;
  }

  /**
   * Check if a user has ALL specified permissions.
   * Use for operations requiring multiple permissions.
   */
  hasAllPermissions(userId: string, permissions: readonly RBACPermission[]): boolean {
    for (const p of permissions) {
      if (!this.hasPermission(userId, p)) return false;
    }
    return true;
  }

  /**
   * Check if a user has ANY of the specified permissions.
   * Use for operations that accept multiple access paths.
   */
  hasAnyPermission(userId: string, permissions: readonly RBACPermission[]): boolean {
    for (const p of permissions) {
      if (this.hasPermission(userId, p)) return true;
    }
    return false;
  }

  /**
   * Get all permissions granted to a user.
   */
  getPermissions(userId: string): readonly RBACPermission[] {
    const role = this.getRole(userId);
    return ROLE_PERMISSIONS[role];
  }

  /**
   * Validate a user has the required permission, throwing if not.
   * Use at the tool-call entry point for fail-fast authorization.
   */
  require(userId: string, permission: RBACPermission): void {
    if (!this.hasPermission(userId, permission)) {
      const role = this.getRole(userId);
      throw new RBACError(userId, role, permission);
    }
  }

  /** List all users with their assigned roles. */
  listUsers(): Array<{ userId: string; role: RBACRole }> {
    return Array.from(this.userRoles.entries()).map(([userId, role]) => ({
      userId,
      role,
    }));
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class RBACError extends Error {
  constructor(
    public readonly userId: string,
    public readonly role: RBACRole,
    public readonly requiredPermission: RBACPermission,
  ) {
    super(
      `Access denied: user "${userId}" (role: ${role}) lacks permission "${requiredPermission}"`,
    );
    this.name = 'RBACError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
