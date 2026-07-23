import { describe, it, expect, beforeEach } from 'vitest';

import { RBACEngine } from '../security/rbac.js';
import type { Permission, Role } from '../security/rbac.js';

describe('RBACEngine', () => {
  let engine: RBACEngine;

  beforeEach(() => {
    engine = new RBACEngine();
  });

  // -----------------------------------------------------------------------
  // Role Definition
  // -----------------------------------------------------------------------

  describe('defineRole', () => {
    it('should define a role with permissions', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read', 'search:read'],
      });

      engine.assignRole('user-1', 'viewer');
      expect(engine.hasPermission('user-1', 'analysis:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'search:read')).toBe(true);
    });

    it('should define a role without inherited roles', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      expect(engine.hasPermission('user-1', 'analysis:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'analysis:write')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Role Assignment
  // -----------------------------------------------------------------------

  describe('assignRole', () => {
    it('should assign a role to a user', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      expect(engine.hasRole('user-1', 'viewer')).toBe(true);
    });

    it('should assign multiple roles to a user', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });
      engine.defineRole('reviewer', {
        name: 'reviewer',
        permissions: ['review:write'],
      });

      engine.assignRole('user-1', 'viewer');
      engine.assignRole('user-1', 'reviewer');

      expect(engine.hasRole('user-1', 'viewer')).toBe(true);
      expect(engine.hasRole('user-1', 'reviewer')).toBe(true);
    });

    it('should handle duplicate role assignment gracefully', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      engine.assignRole('user-1', 'viewer');

      expect(engine.getRoles('user-1')).toEqual(['viewer']);
    });
  });

  // -----------------------------------------------------------------------
  // Role Revocation
  // -----------------------------------------------------------------------

  describe('revokeRole', () => {
    it('should revoke a role from a user', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      engine.revokeRole('user-1', 'viewer');

      expect(engine.hasRole('user-1', 'viewer')).toBe(false);
    });

    it('should not throw when revoking a role user does not have', () => {
      expect(() => engine.revokeRole('user-1', 'viewer')).not.toThrow();
    });

    it('should handle revoking role from non-existent user', () => {
      expect(() => engine.revokeRole('non-existent', 'viewer')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Permission Checking
  // -----------------------------------------------------------------------

  describe('hasPermission', () => {
    it('should return true for directly assigned permission', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      expect(engine.hasPermission('user-1', 'analysis:read')).toBe(true);
    });

    it('should return false for unassigned permission', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      expect(engine.hasPermission('user-1', 'analysis:write')).toBe(false);
    });

    it('should return false for non-existent user', () => {
      expect(engine.hasPermission('non-existent', 'analysis:read')).toBe(false);
    });

    it('should handle wildcard admin:* permission', () => {
      engine.defineRole('admin', {
        name: 'admin',
        permissions: ['admin:*'],
      });

      engine.assignRole('user-1', 'admin');
      expect(engine.hasPermission('user-1', 'analysis:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'analysis:write')).toBe(true);
      expect(engine.hasPermission('user-1', 'review:admin')).toBe(true);
      expect(engine.hasPermission('user-1', 'search:write')).toBe(true);
    });

    it('should handle wildcard analysis:* permission', () => {
      engine.defineRole('developer', {
        name: 'developer',
        permissions: ['analysis:*'],
      });

      engine.assignRole('user-1', 'developer');
      expect(engine.hasPermission('user-1', 'analysis:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'analysis:write')).toBe(true);
      expect(engine.hasPermission('user-1', 'analysis:admin')).toBe(true);
      expect(engine.hasPermission('user-1', 'review:read')).toBe(false);
    });

    it('should handle wildcard review:* permission', () => {
      engine.defineRole('reviewer', {
        name: 'reviewer',
        permissions: ['review:*'],
      });

      engine.assignRole('user-1', 'reviewer');
      expect(engine.hasPermission('user-1', 'review:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'review:write')).toBe(true);
      expect(engine.hasPermission('user-1', 'review:admin')).toBe(true);
      expect(engine.hasPermission('user-1', 'analysis:read')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Role Checking
  // -----------------------------------------------------------------------

  describe('hasRole', () => {
    it('should return true if user has the role', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      expect(engine.hasRole('user-1', 'viewer')).toBe(true);
    });

    it('should return false if user does not have the role', () => {
      expect(engine.hasRole('user-1', 'viewer')).toBe(false);
    });

    it('should return false for non-existent user', () => {
      expect(engine.hasRole('non-existent', 'viewer')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Get Permissions
  // -----------------------------------------------------------------------

  describe('getPermissions', () => {
    it('should return all permissions for user including inherited', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read', 'search:read'],
      });
      engine.defineRole('developer', {
        name: 'developer',
        permissions: ['analysis:write'],
        inherits: ['viewer'],
      });

      engine.assignRole('user-1', 'developer');

      const perms = engine.getPermissions('user-1');
      expect(perms).toContain('analysis:read');
      expect(perms).toContain('search:read');
      expect(perms).toContain('analysis:write');
    });

    it('should return empty array for non-existent user', () => {
      expect(engine.getPermissions('non-existent')).toEqual([]);
    });

    it('should handle circular inheritance', () => {
      engine.defineRole('role-a' as Role, {
        name: 'role-a' as Role,
        permissions: ['analysis:read'],
        inherits: ['role-b' as Role],
      });
      engine.defineRole('role-b' as Role, {
        name: 'role-b' as Role,
        permissions: ['review:read'],
        inherits: ['role-a' as Role],
      });

      engine.assignRole('user-1', 'role-a' as Role);

      // Should not hang; should collect permissions without infinite loop
      const perms = engine.getPermissions('user-1');
      expect(perms).toContain('analysis:read');
      expect(perms).toContain('review:read');
    });
  });

  // -----------------------------------------------------------------------
  // Get Roles
  // -----------------------------------------------------------------------

  describe('getRoles', () => {
    it('should return all roles for a user', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });

      engine.assignRole('user-1', 'viewer');
      expect(engine.getRoles('user-1')).toEqual(['viewer']);
    });

    it('should return empty array for non-existent user', () => {
      expect(engine.getRoles('non-existent')).toEqual([]);
    });

    it('should return multiple roles', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['analysis:read'],
      });
      engine.defineRole('reviewer', {
        name: 'reviewer',
        permissions: ['review:read'],
      });

      engine.assignRole('user-1', 'viewer');
      engine.assignRole('user-1', 'reviewer');

      const roles = engine.getRoles('user-1');
      expect(roles).toContain('viewer');
      expect(roles).toContain('reviewer');
    });
  });

  // -----------------------------------------------------------------------
  // Default Roles
  // -----------------------------------------------------------------------

  describe('createDefault', () => {
    it('should create engine with default roles', () => {
      const defaultEngine = RBACEngine.createDefault();

      defaultEngine.assignRole('admin-user', 'admin');
      defaultEngine.assignRole('dev-user', 'developer');
      defaultEngine.assignRole('reviewer-user', 'reviewer');
      defaultEngine.assignRole('viewer-user', 'viewer');
      defaultEngine.assignRole('ci-user', 'ci-bot');

      // Admin has all permissions
      expect(defaultEngine.hasPermission('admin-user', 'admin:*')).toBe(true);
      expect(defaultEngine.hasPermission('admin-user', 'analysis:admin')).toBe(true);
      expect(defaultEngine.hasPermission('admin-user', 'review:admin')).toBe(true);

      // Developer has analysis:write but not analysis:admin
      expect(defaultEngine.hasPermission('dev-user', 'analysis:write')).toBe(true);
      expect(defaultEngine.hasPermission('dev-user', 'analysis:read')).toBe(true);
      expect(defaultEngine.hasPermission('dev-user', 'standards:write')).toBe(true);

      // Developer does NOT have admin permissions (only inherits from viewer)
      expect(defaultEngine.hasPermission('dev-user', 'analysis:admin')).toBe(false);
      expect(defaultEngine.hasPermission('dev-user', 'review:admin')).toBe(false);

      // Reviewer has review permissions
      expect(defaultEngine.hasPermission('reviewer-user', 'review:read')).toBe(true);
      expect(defaultEngine.hasPermission('reviewer-user', 'review:write')).toBe(true);
      expect(defaultEngine.hasPermission('reviewer-user', 'review:admin')).toBe(true);
      expect(defaultEngine.hasPermission('reviewer-user', 'analysis:write')).toBe(false);

      // Viewer has read-only permissions
      expect(defaultEngine.hasPermission('viewer-user', 'analysis:read')).toBe(true);
      expect(defaultEngine.hasPermission('viewer-user', 'review:read')).toBe(true);
      expect(defaultEngine.hasPermission('viewer-user', 'analysis:write')).toBe(false);
      expect(defaultEngine.hasPermission('viewer-user', 'review:write')).toBe(false);

      // CI-bot has limited permissions
      expect(defaultEngine.hasPermission('ci-user', 'analysis:read')).toBe(true);
      expect(defaultEngine.hasPermission('ci-user', 'search:read')).toBe(true);
      expect(defaultEngine.hasPermission('ci-user', 'impact:read')).toBe(true);
      expect(defaultEngine.hasPermission('ci-user', 'analysis:write')).toBe(false);
    });

    it('should verify all default role definitions exist', () => {
      const defaultEngine = RBACEngine.createDefault();

      const roles: Role[] = ['admin', 'developer', 'reviewer', 'viewer', 'ci-bot'];
      for (const role of roles) {
        defaultEngine.assignRole('test-user', role);
        expect(defaultEngine.hasRole('test-user', role)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Permission type coverage
  // -----------------------------------------------------------------------

  describe('permission granularity', () => {
    it('should check all analysis permissions', () => {
      engine.defineRole('admin', {
        name: 'admin',
        permissions: ['admin:*'],
      });
      engine.assignRole('user-1', 'admin');

      const analysisPerms: Permission[] = ['analysis:read', 'analysis:write', 'analysis:admin'];
      for (const perm of analysisPerms) {
        expect(engine.hasPermission('user-1', perm)).toBe(true);
      }
    });

    it('should check all review permissions via wildcard', () => {
      engine.defineRole('reviewer', {
        name: 'reviewer',
        permissions: ['review:*'],
      });
      engine.assignRole('user-1', 'reviewer');

      const reviewPerms: Permission[] = ['review:read', 'review:write', 'review:admin'];
      for (const perm of reviewPerms) {
        expect(engine.hasPermission('user-1', perm)).toBe(true);
      }
    });

    it('should check specific search permissions', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['search:read'],
      });
      engine.assignRole('user-1', 'viewer');

      expect(engine.hasPermission('user-1', 'search:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'search:write')).toBe(false);
    });

    it('should check specific impact permissions', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['impact:read'],
      });
      engine.assignRole('user-1', 'viewer');

      expect(engine.hasPermission('user-1', 'impact:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'impact:write')).toBe(false);
    });

    it('should check specific crossrepo permissions', () => {
      engine.defineRole('viewer', {
        name: 'viewer',
        permissions: ['crossrepo:read'],
      });
      engine.assignRole('user-1', 'viewer');

      expect(engine.hasPermission('user-1', 'crossrepo:read')).toBe(true);
      expect(engine.hasPermission('user-1', 'crossrepo:write')).toBe(false);
    });

    it('should check all standards permissions via wildcard', () => {
      engine.defineRole('reviewer', {
        name: 'reviewer',
        permissions: ['standards:*'],
      });
      engine.assignRole('user-1', 'reviewer');

      const standardsPerms: Permission[] = ['standards:read', 'standards:write', 'standards:admin'];
      for (const perm of standardsPerms) {
        expect(engine.hasPermission('user-1', perm)).toBe(true);
      }
    });
  });
});
