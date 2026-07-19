// @ts-nocheck
// @code-analyzer/mcp — Tool Registry Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry, makeSchema } from '../tools/registry.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const schema = makeSchema({ query: { type: 'string', description: 'Test' } }, ['query']);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('test_tool', 'A test tool', schema, handler);
      expect(registry.size).toBe(1);
    });

    it('should throw when registering duplicate tool', () => {
      const schema = makeSchema({}, []);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('test_tool', 'desc', schema, handler);
      expect(() => registry.register('test_tool', 'desc2', schema, handler)).toThrow(
        /already registered/,
      );
    });
  });

  describe('get', () => {
    it('should return a registered tool', () => {
      const schema = makeSchema({}, []);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('test_tool', 'desc', schema, handler);
      const tool = registry.get('test_tool');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('test_tool');
    });

    it('should return undefined for unregistered tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should list all registered tools', () => {
      const schema = makeSchema({}, []);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('tool1', 'desc1', schema, handler);
      registry.register('tool2', 'desc2', schema, handler);

      const tools = registry.list();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('tool1');
      expect(tools[1].name).toBe('tool2');
    });
  });

  describe('listByProfile', () => {
    it('should return all tools for "all" profile', () => {
      const schema = makeSchema({}, []);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('general', 'desc', schema, handler, 'all');
      registry.register('analysis', 'desc', schema, handler, 'analysis');
      registry.register('scout', 'desc', schema, handler, 'scout');

      const tools = registry.listByProfile('all');
      expect(tools).toHaveLength(3);
    });

    it('should filter by profile', () => {
      const schema = makeSchema({}, []);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('general', 'desc', schema, handler, 'all');
      registry.register('analysis', 'desc', schema, handler, 'analysis');
      registry.register('scout', 'desc', schema, handler, 'scout');

      const analysisTools = registry.listByProfile('analysis');
      expect(analysisTools).toHaveLength(2);
      expect(analysisTools.map((t) => t.name)).toContain('general');
      expect(analysisTools.map((t) => t.name)).toContain('analysis');
    });

    it('should return only scout tools for scout profile', () => {
      const schema = makeSchema({}, []);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('general', 'desc', schema, handler, 'all');
      registry.register('analysis', 'desc', schema, handler, 'analysis');
      registry.register('scout', 'desc', schema, handler, 'scout');

      const scoutTools = registry.listByProfile('scout');
      expect(scoutTools).toHaveLength(2);
      expect(scoutTools.map((t) => t.name)).toContain('general');
      expect(scoutTools.map((t) => t.name)).toContain('scout');
    });
  });

  describe('execute', () => {
    it('should execute a tool and return its result', async () => {
      const schema = makeSchema({ name: { type: 'string', description: 'Name' } }, ['name']);
      const handler = async (args: Record<string, unknown>) => ({
        content: [{ type: 'text' as const, text: `Hello ${args.name}` }],
      });

      registry.register('greet', 'Greets', schema, handler);
      const result = await registry.execute('greet', { name: 'World' });

      expect(result.content[0].text).toBe('Hello World');
    });

    it('should return error for missing required arguments', async () => {
      const schema = makeSchema({ name: { type: 'string', description: 'Name' } }, ['name']);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('greet', 'Greets', schema, handler);
      const result = await registry.execute('greet', {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required parameter');
    });

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('unknown', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('should catch handler errors', async () => {
      const schema = makeSchema({}, []);
      const handler = async () => {
        throw new Error('Handler crashed');
      };

      registry.register('crashy', 'Crashes', schema, handler);
      const result = await registry.execute('crashy', {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Handler crashed');
    });
  });

  describe('unregister', () => {
    it('should remove a tool', () => {
      const schema = makeSchema({}, []);
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      });

      registry.register('tool', 'desc', schema, handler);
      expect(registry.size).toBe(1);

      const removed = registry.unregister('tool');
      expect(removed).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should return false for non-existent tool', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });
});

describe('makeSchema', () => {
  it('should create a basic JSON schema', () => {
    const schema = makeSchema(
      { name: { type: 'string', description: 'A name' } },
      ['name'],
    );

    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('name');
    expect(schema.required).toContain('name');
  });

  it('should handle optional properties', () => {
    const schema = makeSchema({
      required: { type: 'string', description: 'Required' },
      optional: { type: 'number', description: 'Optional' },
    }, ['required']);

    expect(schema.required).toHaveLength(1);
    expect(schema.required).toContain('required');
  });

  it('should include enums', () => {
    const schema = makeSchema({
      category: { type: 'string', description: 'Category', enum: ['a', 'b', 'c'] },
    });

    const prop = (schema.properties as Record<string, Record<string, unknown>>).category;
    expect(prop.enum).toEqual(['a', 'b', 'c']);
  });
});
