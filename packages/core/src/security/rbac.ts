// @code-analyzer/core — Role-Based Access Control
// Enterprise RBAC engine with role inheritance and granular permissions.

export type Permission =
  | 'analysis:read' | 'analysis:write' | 'analysis:admin' | 'analysis:*'
  | 'review:read' | 'review:write' | 'review:admin' | 'review:*'
  | 'search:read' | 'search:write' | 'search:*'
  | 'impact:read' | 'impact:write' | 'impact:*'
  | 'crossrepo:read' | 'crossrepo:write' | 'crossrepo:*'
  | 'standards:read' | 'standards:write' | 'standards:admin' | 'standards:*'
  | 'admin:*';

export type Role = 'admin' | 'developer' | 'reviewer' | 'viewer' | 'ci-bot';

export interface RoleDefinition {
  name: Role;
  permissions: Permission[];
  inherits?: Role[];
}

export interface UserIdentity {
  id: string;
  roles: Role[];
  metadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// RBAC Engine
// ---------------------------------------------------------------------------

export class RBACEngine {
  private roleDefinitions: Map<Role, RoleDefinition> = new Map();
  private userRoles: Map<string, Set<Role>> = new Map();

  /** Define a role with its permissions and optional inherited roles. */
  defineRole(role: Role, definition: RoleDefinition): void {
    this.roleDefinitions.set(role, definition);
  }

  /** Assign a role to a user. */
  assignRole(userId: string, role: Role): void {
    let roles = this.userRoles.get(userId);
    if (!roles) {
      roles = new Set();
      this.userRoles.set(userId, roles);
    }
    roles.add(role);
  }

  /** Revoke a role from a user. */
  revokeRole(userId: string, role: Role): void {
    const roles = this.userRoles.get(userId);
    if (roles) {
      roles.delete(role);
      if (roles.size === 0) {
        this.userRoles.delete(userId);
      }
    }
  }

  /** Check if a user has a specific permission (including inherited). */
  hasPermission(userId: string, permission: Permission): boolean {
    const permissions = this.resolvePermissions(userId);

    // Direct match
    if (permissions.has(permission)) {
      return true;
    }

    // Wildcard match: e.g., 'admin:*' grants all, 'analysis:*' grants all analysis
    for (const p of permissions) {
      if (p === 'admin:*') return true;
      if (p.endsWith(':*')) {
        const prefix = p.slice(0, -2);
        if (permission.startsWith(prefix + ':')) {
          return true;
        }
      }
    }

    return false;
  }

  /** Check if a user has a specific role. */
  hasRole(userId: string, role: Role): boolean {
    const roles = this.userRoles.get(userId);
    return roles ? roles.has(role) : false;
  }

  /** Get all permissions for a user (including inherited). */
  getPermissions(userId: string): Permission[] {
    return Array.from(this.resolvePermissions(userId));
  }

  /** Get all roles for a user. */
  getRoles(userId: string): Role[] {
    const roles = this.userRoles.get(userId);
    return roles ? (Array.from(roles) as Role[]) : [];
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Resolve all permissions for a user by walking role hierarchy. */
  private resolvePermissions(userId: string): Set<Permission> {
    const roles = this.userRoles.get(userId);
    if (!roles) return new Set();

    const permissions = new Set<Permission>();
    const visited = new Set<Role>();

    for (const role of roles) {
      this.collectPermissions(role, permissions, visited);
    }

    return permissions;
  }

  /** Recursively collect permissions from a role and its ancestors. */
  private collectPermissions(
    role: Role,
    permissions: Set<Permission>,
    visited: Set<Role>,
  ): void {
    if (visited.has(role)) return;
    visited.add(role);

    const definition = this.roleDefinitions.get(role);
    if (!definition) return;

    for (const perm of definition.permissions) {
      permissions.add(perm);
    }

    if (definition.inherits) {
      for (const inherited of definition.inherits) {
        this.collectPermissions(inherited, permissions, visited);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Factory
  // -----------------------------------------------------------------------

  /** Create an RBACEngine pre-loaded with default enterprise roles. */
  static createDefault(): RBACEngine {
    const engine = new RBACEngine();

    engine.defineRole('admin', {
      name: 'admin',
      permissions: ['admin:*'],
      inherits: ['developer', 'reviewer', 'viewer'],
    });

    engine.defineRole('developer', {
      name: 'developer',
      permissions: [
        'analysis:read', 'analysis:write',
        'review:read',
        'search:read', 'search:write',
        'impact:read', 'impact:write',
        'crossrepo:read', 'crossrepo:write',
        'standards:read', 'standards:write',
      ],
      inherits: ['viewer'],
    });

    engine.defineRole('reviewer', {
      name: 'reviewer',
      permissions: [
        'review:read', 'review:write', 'review:admin',
        'search:read',
        'impact:read',
        'crossrepo:read',
        'standards:read',
      ],
      inherits: ['viewer'],
    });

    engine.defineRole('viewer', {
      name: 'viewer',
      permissions: [
        'analysis:read',
        'review:read',
        'search:read',
        'impact:read',
        'crossrepo:read',
        'standards:read',
      ],
    });

    engine.defineRole('ci-bot', {
      name: 'ci-bot',
      permissions: [
        'analysis:read',
        'search:read',
        'impact:read',
        'standards:read',
      ],
    });

    return engine;
  }
}
