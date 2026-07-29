// @code-analyzer/mcp — PromptProvider Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { PromptProvider, registerPrompts } from '../prompts/index.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';

function makeStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

function populateStore(store: InMemoryGraphStore): void {
  const nodes: GraphNode[] = [
    {
      projectId: 'my-app',
      label: 'Function',
      name: 'authenticateUser',
      qualifiedName: 'src/auth.ts::authenticateUser',
      filePath: 'src/auth.ts',
      startLine: 15,
      endLine: 45,
      language: 'typescript',
      properties: { visibility: 'public' },
      signature: 'authenticateUser(token: string): Promise<User>',
      docstring: 'Authenticates a user from a JWT token',
      complexity: 8,
      isExported: true,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'my-app',
      label: 'Class',
      name: 'UserService',
      qualifiedName: 'src/services/user-service.ts::UserService',
      filePath: 'src/services/user-service.ts',
      startLine: 1,
      endLine: 120,
      language: 'typescript',
      properties: { baseClasses: 'BaseService' },
      signature: null,
      docstring: 'Service for user-related operations',
      complexity: 12,
      isExported: true,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'my-app',
      label: 'EntryPoint',
      name: 'main',
      qualifiedName: 'src/index.ts::main',
      filePath: 'src/index.ts',
      startLine: 1,
      endLine: 30,
      language: 'typescript',
      properties: { isEntrypoint: 'true' },
      signature: null,
      docstring: null,
      complexity: 3,
      isExported: true,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'my-app',
      label: 'Module',
      name: 'src/auth.ts',
      qualifiedName: 'src/auth.ts',
      filePath: 'src/auth.ts',
      startLine: 1,
      endLine: 100,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];
  store.insertNodes(nodes);

  // Add edges for dependency tracking
  store.insertEdge({
    projectId: 'my-app',
    sourceId: 2, // UserService
    targetId: 1, // authenticateUser
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: '2026-01-01T00:00:00Z',
  });
  store.insertEdge({
    projectId: 'my-app',
    sourceId: 2, // UserService
    targetId: 4, // src/auth.ts
    type: 'DEPENDS_ON',
    properties: {},
    weight: 1,
    createdAt: '2026-01-01T00:00:00Z',
  });
  // Add incoming edge to UserService so impact analysis shows dependents
  store.insertEdge({
    projectId: 'my-app',
    sourceId: 3, // main
    targetId: 2, // UserService — main depends on UserService
    type: 'DEPENDS_ON',
    properties: {},
    weight: 1,
    createdAt: '2026-01-01T00:00:00Z',
  });
}

describe('PromptProvider', () => {
  let store: InMemoryGraphStore;
  let provider: PromptProvider;

  beforeEach(() => {
    store = makeStore();
    populateStore(store);
    provider = new PromptProvider(store);
  });

  describe('listPrompts', () => {
    it('should list all 5 prompts', () => {
      const prompts = provider.listPrompts();
      expect(prompts).toHaveLength(5);
    });
  });

  describe('getDefinition', () => {
    it('should return definition for valid prompt', () => {
      const def = provider.getDefinition('explore-codebase');
      expect(def).toBeDefined();
      expect(def!.name).toBe('explore-codebase');
      expect(def!.arguments).toBeDefined();
      expect(def!.arguments!.length).toBeGreaterThan(0);
    });

    it('should return undefined for unknown prompt', () => {
      expect(provider.getDefinition('nonexistent')).toBeUndefined();
    });
  });

  describe('explore-codebase', () => {
    it('should return structured messages with graph context', async () => {
      const result = await provider.getPrompt('explore-codebase', { projectId: 'my-app' });
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBe(2); // system + user
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content.text).toContain('my-app');
      expect(result.messages[1].content.text).toContain('Total Nodes');
      expect(result.messages[1].content.text).toContain('authenticateUser');
    });

    it('should include focus when specified', async () => {
      const result = await provider.getPrompt('explore-codebase', {
        projectId: 'my-app',
        focus: 'auth',
      });
      expect(result.messages[1].content.text).toContain('auth');
    });

    it('should include depth instruction when deep', async () => {
      const result = await provider.getPrompt('explore-codebase', {
        projectId: 'my-app',
        depth: 'deep',
      });
      expect(result.messages[1].content.text).toContain('deep analysis');
    });

    it('should work with wildcard projectId', async () => {
      const result = await provider.getPrompt('explore-codebase', { projectId: '*' });
      expect(result.messages.length).toBe(2);
    });
  });

  describe('review-changes', () => {
    it('should return structured review messages', async () => {
      const result = await provider.getPrompt('review-changes', {
        projectId: 'my-app',
        fromRef: 'main',
        toRef: 'feature-branch',
      });
      expect(result.messages.length).toBe(2);
      expect(result.messages[1].content.text).toContain('main');
      expect(result.messages[1].content.text).toContain('feature-branch');
    });

    it('should include focus instructions for security', async () => {
      const result = await provider.getPrompt('review-changes', {
        projectId: 'my-app',
        fromRef: 'main',
        focus: 'security',
      });
      expect(result.messages[1].content.text).toContain('security vulnerabilities');
    });

    it('should default toRef to HEAD', async () => {
      const result = await provider.getPrompt('review-changes', {
        projectId: 'my-app',
        fromRef: 'main',
      });
      expect(result.messages[1].content.text).toContain('HEAD');
    });
  });

  describe('debug-issue', () => {
    it('should return debug messages with call chain', async () => {
      const result = await provider.getPrompt('debug-issue', {
        projectId: 'my-app',
        entryPoint: 'src/auth.ts::authenticateUser',
        symptom: 'Users getting 401 errors intermittently',
      });
      expect(result.messages.length).toBe(2);
      expect(result.messages[1].content.text).toContain('401');
      expect(result.messages[1].content.text).toContain('authenticateUser');
    });

    it('should handle entryPoint not found in graph', async () => {
      const result = await provider.getPrompt('debug-issue', {
        projectId: 'my-app',
        entryPoint: 'nonexistentFunction',
        symptom: 'Something is broken',
      });
      expect(result.messages[1].content.text).toContain('not found');
    });
  });

  describe('refactor-plan', () => {
    it('should return refactoring plan messages', async () => {
      const result = await provider.getPrompt('refactor-plan', {
        projectId: 'my-app',
        target: 'UserService',
        goal: 'extract',
      });
      expect(result.messages.length).toBe(2);
      expect(result.messages[1].content.text).toContain('UserService');
      expect(result.messages[1].content.text).toContain('extract');
    });

    it('should include impact info for known symbols', async () => {
      const result = await provider.getPrompt('refactor-plan', {
        projectId: 'my-app',
        target: 'UserService',
        goal: 'decouple',
      });
      expect(result.messages[1].content.text).toContain('depended on');
    });
  });

  describe('architecture-review', () => {
    it('should return architecture review messages', async () => {
      const result = await provider.getPrompt('architecture-review', {
        projectId: 'my-app',
        aspect: 'dependencies',
      });
      expect(result.messages.length).toBe(2);
      expect(result.messages[1].content.text).toContain('my-app');
    });

    it('should include ADR generation instruction when requested', async () => {
      const result = await provider.getPrompt('architecture-review', {
        projectId: 'my-app',
        generateADR: 'true',
      });
      expect(result.messages[1].content.text).toContain('ADR');
    });

    it('should default aspect to layers', async () => {
      const result = await provider.getPrompt('architecture-review', {
        projectId: 'my-app',
      });
      expect(result.messages.length).toBe(2);
    });

    it('should not include ADR when not requested', async () => {
      const result = await provider.getPrompt('architecture-review', {
        projectId: 'my-app',
      });
      expect(result.messages[1].content.text).not.toContain('Architecture Decision Record');
    });
  });

  describe('error handling', () => {
    it('should throw for unknown prompt name', async () => {
      await expect(provider.getPrompt('unknown-prompt')).rejects.toThrow('Prompt not found');
    });
  });
});

describe('registerPrompts', () => {
  it('should return 5 prompt definitions', () => {
    const prompts = registerPrompts();
    expect(prompts).toHaveLength(5);
  });

  it('should include expected prompt names', () => {
    const prompts = registerPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain('explore-codebase');
    expect(names).toContain('review-changes');
    expect(names).toContain('debug-issue');
    expect(names).toContain('refactor-plan');
    expect(names).toContain('architecture-review');
  });
});
