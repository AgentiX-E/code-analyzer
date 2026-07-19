// @code-analyzer/shared — Validation Tests
import { describe, it, expect } from 'vitest';

import {
  NODE_LABELS,
  RELATIONSHIP_TYPES,
  COMPATIBLE_EDGES,
  validateNodeProperties,
  validateEdgeCompatibility,
  validateConfig,
  validateReviewComment,
  validateStandard,
  validateReport,
} from '../index.js';

import type { CodeAnalyzerConfig, NodeLabel, RelationshipType, ReviewComment, ProjectStandard, AnalysisReport, ReviewCategory, Severity } from '../index.js';

// ---------------------------------------------------------------------------
// validateNodeProperties
// ---------------------------------------------------------------------------

describe('validateNodeProperties', () => {
  describe('valid inputs', () => {
    it('passes for Project with name', () => {
      const errors = validateNodeProperties('Project', { name: 'my-project' });
      expect(errors).toEqual([]);
    });

    it('passes for Package with name', () => {
      const errors = validateNodeProperties('Package', { name: 'lodash' });
      expect(errors).toEqual([]);
    });

    it('passes for Folder with name', () => {
      const errors = validateNodeProperties('Folder', { name: 'src' });
      expect(errors).toEqual([]);
    });

    it('passes for File with name and filePath', () => {
      const errors = validateNodeProperties('File', {
        name: 'index.ts',
        filePath: '/src/index.ts',
      });
      expect(errors).toEqual([]);
    });

    it('passes for Module with name', () => {
      const errors = validateNodeProperties('Module', { name: 'utils' });
      expect(errors).toEqual([]);
    });

    it('passes for Class with name', () => {
      const errors = validateNodeProperties('Class', { name: 'MyClass' });
      expect(errors).toEqual([]);
    });

    it('passes for Interface with name', () => {
      const errors = validateNodeProperties('Interface', { name: 'IService' });
      expect(errors).toEqual([]);
    });

    it('passes for Function with name', () => {
      const errors = validateNodeProperties('Function', { name: 'doWork' });
      expect(errors).toEqual([]);
    });

    it('passes for Method with name', () => {
      const errors = validateNodeProperties('Method', { name: 'handleClick' });
      expect(errors).toEqual([]);
    });

    it('passes for Constructor with name', () => {
      const errors = validateNodeProperties('Constructor', { name: 'constructor' });
      expect(errors).toEqual([]);
    });

    it('passes for Property with name', () => {
      const errors = validateNodeProperties('Property', { name: 'count' });
      expect(errors).toEqual([]);
    });

    it('passes for Enum with name', () => {
      const errors = validateNodeProperties('Enum', { name: 'Color' });
      expect(errors).toEqual([]);
    });

    it('passes for Route with name and routePath', () => {
      const errors = validateNodeProperties('Route', {
        name: 'GET /users',
        routePath: '/users',
      });
      expect(errors).toEqual([]);
    });

    it('passes for Route with routeMethod in extra props', () => {
      const errors = validateNodeProperties('Route', {
        name: 'CreateUser',
        routePath: '/users',
        routeMethod: 'POST',
      });
      expect(errors).toEqual([]);
    });

    it('passes for Tool with name', () => {
      const errors = validateNodeProperties('Tool', { name: 'deploy' });
      expect(errors).toEqual([]);
    });

    it('passes for Component with name', () => {
      const errors = validateNodeProperties('Component', { name: 'Button' });
      expect(errors).toEqual([]);
    });

    it('passes for Test with name', () => {
      const errors = validateNodeProperties('Test', { name: 'user test' });
      expect(errors).toEqual([]);
    });

    it('passes for Config with name', () => {
      const errors = validateNodeProperties('Config', { name: 'tsconfig' });
      expect(errors).toEqual([]);
    });

    it('passes for ADR with name', () => {
      const errors = validateNodeProperties('ADR', { name: 'ADR-001' });
      expect(errors).toEqual([]);
    });

    it('passes with optional valid visibility', () => {
      const errors = validateNodeProperties('Method', {
        name: 'doWork',
        visibility: 'public',
      });
      expect(errors).toEqual([]);
    });
  });

  describe('missing required fields', () => {
    it('returns error when name is missing for Class', () => {
      const errors = validateNodeProperties('Class', {});
      expect(errors).toContain('Missing required property "name" for label "Class"');
    });

    it('returns error when name is null', () => {
      const errors = validateNodeProperties('Function', { name: null });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('name');
    });

    it('returns error when File is missing filePath', () => {
      const errors = validateNodeProperties('File', { name: 'index.ts' });
      expect(errors).toContain('Missing required property "filePath" for label "File"');
    });

    it('returns error when Route is missing routePath', () => {
      const errors = validateNodeProperties('Route', { name: 'GET /users' });
      expect(errors).toContain('Missing required property "routePath" for label "Route"');
    });

    it('returns error when name is empty string', () => {
      const errors = validateNodeProperties('Class', { name: '' });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('name');
    });

    it('returns error when filePath is empty string', () => {
      const errors = validateNodeProperties('File', { name: 'f.ts', filePath: '' });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('filePath');
    });

    it('returns error when routePath is empty string', () => {
      const errors = validateNodeProperties('Route', { name: 'r', routePath: '' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('invalid label', () => {
    it('returns error for an unknown label', () => {
      const errors = validateNodeProperties('UnknownLabel' as NodeLabel, { name: 'x' });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Unknown node label');
    });

    it('returns just one error for unknown label (short-circuits)', () => {
      const errors = validateNodeProperties('BadLabel' as NodeLabel, {});
      expect(errors).toHaveLength(1);
    });
  });

  describe('invalid visibility', () => {
    it('returns error for invalid visibility value', () => {
      const errors = validateNodeProperties('Method', {
        name: 'm',
        visibility: 'hidden',
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('visibility');
    });
  });

  describe('exhaustive — every NodeLabel', () => {
    it.each(NODE_LABELS)('accepts valid minimal props for "%s"', (label) => {
      const props: Record<string, unknown> = { name: `test-${label}` };
      if (label === 'File') props['filePath'] = '/test.ts';
      if (label === 'Route') props['routePath'] = '/test';

      const errors = validateNodeProperties(label, props);
      expect(errors).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// validateEdgeCompatibility
// ---------------------------------------------------------------------------

describe('validateEdgeCompatibility', () => {
  describe('valid edges', () => {
    it.each([
      ['Project', 'Package', 'CONTAINS'],
      ['Package', 'Folder', 'CONTAINS'],
      ['Folder', 'File', 'CONTAINS'],
      ['File', 'Class', 'DEFINES'],
      ['Class', 'Method', 'DEFINES'],
      ['Class', 'Property', 'HAS_PROPERTY'],
      ['Class', 'Class', 'EXTENDS'],
      ['Class', 'Interface', 'IMPLEMENTS'],
      ['Method', 'Method', 'METHOD_OVERRIDES'],
      ['Function', 'Function', 'CALLS'],
      ['File', 'Module', 'IMPORTS'],
      ['Function', 'Variable', 'ACCESSES'],
      ['Function', 'Class', 'INSTANTIATES'],
      ['Function', 'TypeAlias', 'USES_TYPE'],
      ['File', 'Route', 'HANDLES_ROUTE'],
      ['File', 'Tool', 'HANDLES_TOOL'],
      ['Module', 'Class', 'EXPOSES'],
      ['Constructor', 'Class', 'INJECTS'],
      ['Class', 'Class', 'SIMILAR_TO'],
      ['Test', 'Function', 'TESTS'],
      ['File', 'File', 'CHANGES_WITH'],
      ['Function', 'Variable', 'DATA_FLOWS'],
      ['Function', 'Process', 'STEP_IN_PROCESS'],
    ])('%s --[%s]--> %s is valid', (src, tgt, type) => {
      expect(
        validateEdgeCompatibility(
          src as NodeLabel,
          tgt as NodeLabel,
          type as RelationshipType
        )
      ).toBe(true);
    });
  });

  describe('invalid edges', () => {
    it('rejects invalid source label for CONTAINS', () => {
      expect(validateEdgeCompatibility('Function', 'File', 'CONTAINS')).toBe(false);
    });

    it('rejects invalid target label for DEFINES', () => {
      expect(validateEdgeCompatibility('Class', 'File', 'DEFINES')).toBe(false);
    });

    it('rejects non-class extending an interface', () => {
      expect(validateEdgeCompatibility('Function', 'Interface', 'IMPLEMENTS')).toBe(false);
    });

    it('rejects EXTENDS between Function nodes', () => {
      expect(validateEdgeCompatibility('Function', 'Function', 'EXTENDS')).toBe(false);
    });

    it('rejects CALLS between Class nodes', () => {
      expect(validateEdgeCompatibility('Class', 'Class', 'CALLS')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for unknown source label', () => {
      expect(
        validateEdgeCompatibility('Bad' as NodeLabel, 'File', 'CONTAINS')
      ).toBe(false);
    });

    it('returns false for unknown target label', () => {
      expect(
        validateEdgeCompatibility('File', 'Bad' as NodeLabel, 'CONTAINS')
      ).toBe(false);
    });

    it('returns false for unknown relationship type', () => {
      expect(
        validateEdgeCompatibility('File', 'Class', 'UNKNOWN' as RelationshipType)
      ).toBe(false);
    });
  });

  describe('exhaustive — all valid pairs exist in COMPATIBLE_EDGES', () => {
    it('every COMPATIBLE_EDGES entry passes validateEdgeCompatibility', () => {
      for (const [type, pairs] of COMPATIBLE_EDGES.entries()) {
        for (const [s, t] of pairs) {
          expect(validateEdgeCompatibility(s, t, type)).toBe(true);
        }
      }
    });

    it('every combination not in COMPATIBLE_EDGES returns false', () => {
      const covered: Set<string> = new Set();
      for (const [type, pairs] of COMPATIBLE_EDGES.entries()) {
        for (const [s, t] of pairs) {
          covered.add(`${type}:${s}:${t}`);
        }
      }

      for (const relType of RELATIONSHIP_TYPES) {
        for (const src of NODE_LABELS) {
          for (const tgt of NODE_LABELS) {
            const key = `${relType}:${src}:${tgt}`;
            if (!covered.has(key)) {
              expect(
                validateEdgeCompatibility(
                  src,
                  tgt,
                  relType
                )
              ).toBe(false);
            }
          }
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

function makeValidConfig(overrides: Partial<CodeAnalyzerConfig> = {}): CodeAnalyzerConfig {
  return {
    projectId: 'test-proj',
    rootPath: '/tmp/test',
    excludePatterns: ['node_modules', 'dist'],
    includePatterns: ['src/**'],
    maxFileSize: 500000,
    maxFiles: 10000,
    parseWorkers: 4,
    ignorePaths: ['.git', '.cache'],
    ...overrides,
  };
}

describe('validateConfig', () => {
  describe('valid configs', () => {
    it('passes with minimal required fields', () => {
      const errors = validateConfig(makeValidConfig());
      expect(errors).toEqual([]);
    });

    it('passes with full sub-configs', () => {
      const config = makeValidConfig({
        language: 'typescript',
        cacheDir: '/tmp/cache',
        mcp: {
          name: 'code-analyzer',
          version: '1.0.0',
          toolProfile: 'all',
          maxResults: 50,
          enableStreaming: true,
          enableResources: true,
          enablePrompts: false,
        },
        review: {
          enabled: true,
          maxComments: 100,
          severityFilter: ['high', 'critical'],
          categoryFilter: ['bug', 'security'],
        },
        embed: {
          enabled: false,
          model: 'text-embedding-3',
          batchSize: 32,
          dimensions: 1536,
        },
        pruner: {
          enabled: true,
          keepTests: true,
          keepInternal: false,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toEqual([]);
    });

    it('passes without optional sub-configs', () => {
      const config = makeValidConfig();
      delete config.mcp;
      delete config.review;
      delete config.embed;
      delete config.pruner;
      // mcp/review/embed/pruner are optional in the type
      const errors = validateConfig(config);
      expect(errors).toEqual([]);
    });
  });

  describe('invalid projectId', () => {
    it('rejects empty projectId', () => {
      const errors = validateConfig(makeValidConfig({ projectId: '' }));
      expect(errors).toContain('config.projectId must be a non-empty string');
    });

    it('rejects whitespace-only projectId', () => {
      const errors = validateConfig(makeValidConfig({ projectId: '   ' }));
      expect(errors).toContain('config.projectId must be a non-empty string');
    });
  });

  describe('invalid rootPath', () => {
    it('rejects empty rootPath', () => {
      const errors = validateConfig(makeValidConfig({ rootPath: '' }));
      expect(errors).toContain('config.rootPath must be a non-empty string');
    });
  });

  describe('invalid numeric fields', () => {
    it('rejects maxFileSize of 0', () => {
      const errors = validateConfig(makeValidConfig({ maxFileSize: 0 }));
      expect(errors).toContain('config.maxFileSize must be a positive integer');
    });

    it('rejects maxFileSize of -1', () => {
      const errors = validateConfig(makeValidConfig({ maxFileSize: -1 }));
      expect(errors.some((e) => e.includes('maxFileSize'))).toBe(true);
    });

    it('rejects maxFileSize as float', () => {
      const errors = validateConfig(makeValidConfig({ maxFileSize: 3.5 }));
      expect(errors.some((e) => e.includes('maxFileSize'))).toBe(true);
    });

    it('rejects maxFiles of 0', () => {
      const errors = validateConfig(makeValidConfig({ maxFiles: 0 }));
      expect(errors).toContain('config.maxFiles must be a positive integer');
    });

    it('rejects parseWorkers of 0', () => {
      const errors = validateConfig(makeValidConfig({ parseWorkers: 0 }));
      expect(errors).toContain('config.parseWorkers must be a positive integer');
    });
  });

  describe('invalid arrays', () => {
    it('rejects excludePatterns as non-array', () => {
      const errors = validateConfig(
        makeValidConfig({ excludePatterns: 'bad' as unknown as string[] })
      );
      expect(errors).toContain('config.excludePatterns must be an array');
    });

    it('rejects excludePatterns with non-string entries', () => {
      const config = makeValidConfig({ excludePatterns: ['good', 123 as unknown as string] });
      const errors = validateConfig(config);
      expect(errors.some((e) => e.includes('excludePatterns[1]'))).toBe(true);
    });

    it('rejects includePatterns as non-array', () => {
      const errors = validateConfig(
        makeValidConfig({ includePatterns: null as unknown as string[] })
      );
      expect(errors).toContain('config.includePatterns must be an array');
    });

    it('rejects ignorePaths as non-array', () => {
      const errors = validateConfig(
        makeValidConfig({ ignorePaths: 42 as unknown as string[] })
      );
      expect(errors).toContain('config.ignorePaths must be an array');
    });
  });

  describe('invalid cacheDir', () => {
    it('rejects non-string cacheDir', () => {
      const errors = validateConfig(
        makeValidConfig({ cacheDir: 42 as unknown as string })
      );
      expect(errors).toContain('config.cacheDir must be a string if provided');
    });
  });

  describe('invalid sub-configs', () => {
    it('rejects mcp with missing name', () => {
      const config = makeValidConfig({
        mcp: {
          name: '',
          version: '1.0.0',
          toolProfile: 'all',
          maxResults: 50,
          enableStreaming: true,
          enableResources: true,
          enablePrompts: true,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.mcp.name must be a non-empty string');
    });

    it('rejects mcp with missing version', () => {
      const config = makeValidConfig({
        mcp: {
          name: 'test',
          version: '',
          toolProfile: 'all',
          maxResults: 50,
          enableStreaming: true,
          enableResources: true,
          enablePrompts: true,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.mcp.version must be a non-empty string');
    });

    it('rejects mcp with non-object value', () => {
      const config = makeValidConfig({
        mcp: 'bad' as unknown as any,
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.mcp must be an object if provided');
    });

    it('rejects mcp with invalid toolProfile', () => {
      const config = makeValidConfig({
        mcp: {
          name: 'test',
          version: '1.0.0',
          toolProfile: 'unknown' as 'all',
          maxResults: 50,
          enableStreaming: true,
          enableResources: true,
          enablePrompts: true,
        },
      });
      const errors = validateConfig(config);
      expect(errors.some((e) => e.includes('toolProfile'))).toBe(true);
    });

    it('rejects mcp with non-boolean enableResources', () => {
      const config = makeValidConfig({
        mcp: {
          name: 'test',
          version: '1.0.0',
          toolProfile: 'all',
          maxResults: 50,
          enableStreaming: true,
          enableResources: 'yes' as unknown as boolean,
          enablePrompts: true,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.mcp.enableResources must be a boolean');
    });

    it('rejects mcp with non-boolean enablePrompts', () => {
      const config = makeValidConfig({
        mcp: {
          name: 'test',
          version: '1.0.0',
          toolProfile: 'all',
          maxResults: 50,
          enableStreaming: true,
          enableResources: true,
          enablePrompts: 'yes' as unknown as boolean,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.mcp.enablePrompts must be a boolean');
    });

    it('rejects mcp with non-boolean enableStreaming', () => {
      const config = makeValidConfig({
        mcp: {
          name: 'test',
          version: '1.0.0',
          toolProfile: 'all',
          maxResults: 50,
          enableStreaming: 'yes' as unknown as boolean,
          enableResources: true,
          enablePrompts: true,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.mcp.enableStreaming must be a boolean');
    });

    it('rejects mcp with non-positive maxResults', () => {
      const config = makeValidConfig({
        mcp: {
          name: 'test',
          version: '1.0.0',
          toolProfile: 'all',
          maxResults: 0,
          enableStreaming: true,
          enableResources: true,
          enablePrompts: true,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.mcp.maxResults must be a positive integer');
    });

    it('rejects embed with missing model', () => {
      const config = makeValidConfig({
        embed: {
          enabled: true,
          model: '',
          batchSize: 32,
          dimensions: 1536,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.embed.model must be a non-empty string');
    });

    it('rejects embed with zero batchSize', () => {
      const config = makeValidConfig({
        embed: {
          enabled: true,
          model: 'text-embedding',
          batchSize: 0,
          dimensions: 1536,
        },
      });
      const errors = validateConfig(config);
      expect(errors.some((e) => e.includes('batchSize'))).toBe(true);
    });

    it('rejects embed with zero dimensions', () => {
      const config = makeValidConfig({
        embed: {
          enabled: true,
          model: 'text-embedding',
          batchSize: 32,
          dimensions: 0,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.embed.dimensions must be a positive integer');
    });

    it('rejects pruner with non-boolean keepTests', () => {
      const config = makeValidConfig({
        pruner: {
          enabled: true,
          keepTests: 'yes' as unknown as boolean,
          keepInternal: false,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.pruner.keepTests must be a boolean');
    });

    it('rejects pruner with non-boolean keepInternal', () => {
      const config = makeValidConfig({
        pruner: {
          enabled: true,
          keepTests: true,
          keepInternal: 'no' as unknown as boolean,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.pruner.keepInternal must be a boolean');
    });

    it('rejects pruner with non-object value', () => {
      const config = makeValidConfig({
        pruner: 'enabled' as unknown as any,
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.pruner must be an object if provided');
    });

    it('rejects pruner with non-boolean enabled', () => {
      const config = makeValidConfig({
        pruner: {
          enabled: 'yes' as unknown as boolean,
          keepTests: true,
          keepInternal: false,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.pruner.enabled must be a boolean');
    });
  });

  describe('invalid review sub-config', () => {
    it('rejects review as non-object', () => {
      const config = makeValidConfig({
        review: 'bad' as unknown as any,
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.review must be an object if provided');
    });

    it('rejects review.categoryFilter as non-array', () => {
      const config = makeValidConfig({
        review: {
          enabled: true,
          maxComments: 10,
          severityFilter: [],
          categoryFilter: 'bad' as unknown as ReviewCategory[],
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.review.categoryFilter must be an array');
    });

    it('rejects review.severityFilter as non-array', () => {
      const config = makeValidConfig({
        review: {
          enabled: true,
          maxComments: 10,
          severityFilter: 'bad' as unknown as Severity[],
          categoryFilter: [],
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.review.severityFilter must be an array');
    });

    it('rejects review.maxComments as non-integer', () => {
      const config = makeValidConfig({
        review: {
          enabled: true,
          maxComments: -1,
          severityFilter: [],
          categoryFilter: [],
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.review.maxComments must be a non-negative integer');
    });

    it('rejects review with non-boolean enabled', () => {
      const config = makeValidConfig({
        review: {
          enabled: 'yes' as unknown as boolean,
          maxComments: 10,
          severityFilter: [],
          categoryFilter: [],
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.review.enabled must be a boolean');
    });
  });

  describe('invalid embed sub-config', () => {
    it('rejects embed as non-object', () => {
      const config = makeValidConfig({
        embed: 'bad' as unknown as any,
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.embed must be an object if provided');
    });

    it('rejects embed with non-boolean enabled', () => {
      const config = makeValidConfig({
        embed: {
          enabled: 'yes' as unknown as boolean,
          model: 'embed',
          batchSize: 32,
          dimensions: 1536,
        },
      });
      const errors = validateConfig(config);
      expect(errors).toContain('config.embed.enabled must be a boolean');
    });
  });

  describe('null/undefined edge cases', () => {
    it('rejects null config', () => {
      const errors = validateConfig(null as unknown as CodeAnalyzerConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('must be a non-null object');
    });

    it('rejects undefined config', () => {
      const errors = validateConfig(undefined as unknown as CodeAnalyzerConfig);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects string config', () => {
      const errors = validateConfig('bad' as unknown as CodeAnalyzerConfig);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// validateReviewComment
// ---------------------------------------------------------------------------

function makeValidComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: 'src/index.ts',
    content: 'Use const instead of let for non-reassigned variables',
    suggestionCode: 'const x = 1;',
    existingCode: 'let x = 1;',
    startLine: 10,
    endLine: 12,
    category: 'maintainability',
    severity: 'low',
    filtered: false,
    id: 'rc-001',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('validateReviewComment', () => {
  describe('valid comment', () => {
    it('passes with all required fields', () => {
      const errors = validateReviewComment(makeValidComment());
      expect(errors).toEqual([]);
    });

    it('passes with optional fields', () => {
      const comment = makeValidComment({ thinking: 'Could use const', suggestionCode: undefined });
      const errors = validateReviewComment(comment);
      expect(errors).toEqual([]);
    });

    it('passes when startLine equals endLine', () => {
      const errors = validateReviewComment(makeValidComment({ startLine: 5, endLine: 5 }));
      expect(errors).toEqual([]);
    });
  });

  describe('invalid path', () => {
    it('rejects empty path', () => {
      const errors = validateReviewComment(makeValidComment({ path: '' }));
      expect(errors).toContain('reviewComment.path must be a non-empty string');
    });
  });

  describe('invalid content', () => {
    it('rejects empty content', () => {
      const errors = validateReviewComment(makeValidComment({ content: '' }));
      expect(errors).toContain('reviewComment.content must be a non-empty string');
    });
  });

  describe('invalid existingCode', () => {
    it('rejects empty existingCode', () => {
      const errors = validateReviewComment(makeValidComment({ existingCode: '' }));
      expect(errors).toContain('reviewComment.existingCode must be a non-empty string');
    });
  });

  describe('invalid line numbers', () => {
    it('rejects startLine of 0', () => {
      const errors = validateReviewComment(makeValidComment({ startLine: 0 }));
      expect(errors).toContain('reviewComment.startLine must be a positive integer');
    });

    it('rejects negative startLine', () => {
      const errors = validateReviewComment(makeValidComment({ startLine: -1 }));
      expect(errors).toContain('reviewComment.startLine must be a positive integer');
    });

    it('rejects endLine < startLine', () => {
      const errors = validateReviewComment(
        makeValidComment({ startLine: 10, endLine: 5 })
      );
      expect(errors.some((e) => e.includes('endLine'))).toBe(true);
    });

    it('rejects endLine of 0', () => {
      const errors = validateReviewComment(makeValidComment({ endLine: 0 }));
      expect(errors).toContain('reviewComment.endLine must be a positive integer');
    });
  });

  describe('invalid category', () => {
    it('rejects unknown category', () => {
      const errors = validateReviewComment(
        makeValidComment({ category: 'unknown' as 'bug' })
      );
      expect(errors.some((e) => e.includes('category'))).toBe(true);
    });
  });

  describe('invalid severity', () => {
    it('rejects unknown severity', () => {
      const errors = validateReviewComment(
        makeValidComment({ severity: 'extreme' as 'low' })
      );
      expect(errors.some((e) => e.includes('severity'))).toBe(true);
    });
  });

  describe('invalid id', () => {
    it('rejects empty id', () => {
      const errors = validateReviewComment(makeValidComment({ id: '' }));
      expect(errors).toContain('reviewComment.id must be a non-empty string');
    });
  });

  describe('invalid filtered', () => {
    it('rejects non-boolean filtered', () => {
      const errors = validateReviewComment(
        makeValidComment({ filtered: 'true' as unknown as boolean })
      );
      expect(errors).toContain('reviewComment.filtered must be a boolean');
    });
  });

  describe('optional fields validation', () => {
    it('rejects non-string suggestionCode', () => {
      const errors = validateReviewComment(
        makeValidComment({ suggestionCode: 42 as unknown as string })
      );
      expect(errors.some((e) => e.includes('suggestionCode'))).toBe(true);
    });

    it('rejects non-string thinking', () => {
      const errors = validateReviewComment(
        makeValidComment({ thinking: 123 as unknown as string })
      );
      expect(errors.some((e) => e.includes('thinking'))).toBe(true);
    });

    it('passes when suggestionCode is undefined', () => {
      const comment = makeValidComment();
      comment.suggestionCode = undefined;
      const errors = validateReviewComment(comment);
      expect(errors).toEqual([]);
    });

    it('passes when thinking is undefined', () => {
      const comment = makeValidComment();
      comment.thinking = undefined;
      const errors = validateReviewComment(comment);
      expect(errors).toEqual([]);
    });
  });

  describe('null/undefined edge cases', () => {
    it('rejects null comment', () => {
      const errors = validateReviewComment(null as unknown as ReviewComment);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects undefined comment', () => {
      const errors = validateReviewComment(undefined as unknown as ReviewComment);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('exhaustive — all categories and severities pass', () => {
    it.each(['bug', 'security', 'performance', 'maintainability', 'test', 'style', 'documentation', 'architecture', 'other'] as const)(
      'accepts category "%s"',
      (cat) => {
        const errors = validateReviewComment(makeValidComment({ category: cat }));
        expect(errors).toEqual([]);
      }
    );

    it.each(['critical', 'high', 'medium', 'low', 'info'] as const)(
      'accepts severity "%s"',
      (sev) => {
        const errors = validateReviewComment(makeValidComment({ severity: sev }));
        expect(errors).toEqual([]);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// validateStandard
// ---------------------------------------------------------------------------

function makeValidStandard(overrides: Partial<ProjectStandard> = {}): ProjectStandard {
  return {
    id: 'test-standard',
    name: 'Test Standard',
    version: '1.0.0',
    category: 'code-style',
    description: 'A test standard for validation',
    rules: [
      {
        id: 'rule-1',
        description: 'Use const over let',
        checkType: 'ast-pattern',
        checkConfig: {},
        severity: 'medium',
        autoFixable: true,
      },
    ],
    examples: [
      {
        description: 'Good const usage',
        compliant: true,
        code: 'const x = 1;',
      },
    ],
    ...overrides,
  };
}

describe('validateStandard', () => {
  describe('valid standard', () => {
    it('passes with all required fields', () => {
      const errors = validateStandard(makeValidStandard());
      expect(errors).toEqual([]);
    });

    it('passes with multiple rules', () => {
      const standard = makeValidStandard({
        rules: [
          { id: 'r1', description: 'Rule 1', checkType: 'regex', checkConfig: {}, severity: 'low', autoFixable: false },
          { id: 'r2', description: 'Rule 2', checkType: 'graph-query', checkConfig: {}, severity: 'high', autoFixable: true },
        ],
      });
      const errors = validateStandard(standard);
      expect(errors).toEqual([]);
    });

    it('passes with multiple examples', () => {
      const standard = makeValidStandard({
        examples: [
          { description: 'Good', compliant: true, code: 'good code' },
          { description: 'Bad', compliant: false, code: 'bad code', explanation: 'This is wrong' },
        ],
      });
      const errors = validateStandard(standard);
      expect(errors).toEqual([]);
    });

    it('passes with optional config', () => {
      const standard = makeValidStandard({
        config: {
          includePaths: ['src/'],
          excludePaths: ['test/'],
          severityOverrides: { 'rule-1': 'critical' },
          disabledRules: [],
          ruleParams: {},
        },
      });
      const errors = validateStandard(standard);
      expect(errors).toEqual([]);
    });
  });

  describe('invalid id', () => {
    it('rejects empty id', () => {
      const errors = validateStandard(makeValidStandard({ id: '' }));
      expect(errors).toContain('standard.id must be a non-empty string');
    });
  });

  describe('invalid name', () => {
    it('rejects empty name', () => {
      const errors = validateStandard(makeValidStandard({ name: '' }));
      expect(errors).toContain('standard.name must be a non-empty string');
    });
  });

  describe('invalid version', () => {
    it('rejects empty version', () => {
      const errors = validateStandard(makeValidStandard({ version: '' }));
      expect(errors).toContain('standard.version must be a non-empty string');
    });
  });

  describe('invalid category', () => {
    it('rejects unknown category', () => {
      const errors = validateStandard(makeValidStandard({ category: 'invalid' as 'code-style' }));
      expect(errors.some((e) => e.includes('category'))).toBe(true);
    });
  });

  describe('invalid description', () => {
    it('rejects empty description', () => {
      const errors = validateStandard(makeValidStandard({ description: '' }));
      expect(errors).toContain('standard.description must be a non-empty string');
    });
  });

  describe('invalid rules', () => {
    it('rejects rules as non-array', () => {
      const errors = validateStandard(makeValidStandard({ rules: null as unknown as [] }));
      expect(errors).toContain('standard.rules must be an array');
    });

    it('rejects rule with empty id', () => {
      const standard = makeValidStandard({
        rules: [{ id: '', description: 'bad', checkType: 'regex', checkConfig: {}, severity: 'low', autoFixable: false }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('.id'))).toBe(true);
    });

    it('rejects rule with empty description', () => {
      const standard = makeValidStandard({
        rules: [{ id: 'r1', description: '', checkType: 'regex', checkConfig: {}, severity: 'low', autoFixable: false }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('.description'))).toBe(true);
    });

    it('rejects rule with invalid checkType', () => {
      const standard = makeValidStandard({
        rules: [{ id: 'r1', description: 'bad', checkType: 'unknown' as 'regex', checkConfig: {}, severity: 'low', autoFixable: false }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('checkType'))).toBe(true);
    });

    it('rejects rule with invalid severity', () => {
      const standard = makeValidStandard({
        rules: [{ id: 'r1', description: 'bad', checkType: 'regex', checkConfig: {}, severity: 'extreme' as 'low', autoFixable: false }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('severity'))).toBe(true);
    });

    it('rejects rule with non-boolean autoFixable', () => {
      const standard = makeValidStandard({
        rules: [{ id: 'r1', description: 'bad', checkType: 'regex', checkConfig: {}, severity: 'low', autoFixable: 'yes' as unknown as boolean }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('autoFixable'))).toBe(true);
    });

    it('rejects null rule entry', () => {
      const standard = makeValidStandard({
        rules: [null as unknown as any],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('must be a non-null object'))).toBe(true);
    });
  });

  describe('invalid examples', () => {
    it('rejects examples as non-array', () => {
      const errors = validateStandard(makeValidStandard({ examples: null as unknown as [] }));
      expect(errors).toContain('standard.examples must be an array');
    });

    it('rejects example with empty description', () => {
      const standard = makeValidStandard({
        examples: [{ description: '', compliant: true, code: 'code' }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('.description'))).toBe(true);
    });

    it('rejects example with non-boolean compliant', () => {
      const standard = makeValidStandard({
        examples: [{ description: 'test', compliant: 'yes' as unknown as boolean, code: 'code' }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('compliant'))).toBe(true);
    });

    it('rejects example with empty code', () => {
      const standard = makeValidStandard({
        examples: [{ description: 'test', compliant: true, code: '' }],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('.code'))).toBe(true);
    });

    it('rejects null example entry', () => {
      const standard = makeValidStandard({
        examples: [null as unknown as any],
      });
      const errors = validateStandard(standard);
      expect(errors.some((e) => e.includes('must be a non-null object'))).toBe(true);
    });
  });

  describe('null/undefined edge cases', () => {
    it('rejects null standard', () => {
      const errors = validateStandard(null as unknown as ProjectStandard);
      expect(errors).toContain('Standard must be a non-null object');
    });

    it('rejects undefined standard', () => {
      const errors = validateStandard(undefined as unknown as ProjectStandard);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('all categories are valid', () => {
    const categories = ['code-style', 'architecture', 'security', 'performance', 'testing', 'api-design', 'error-handling', 'documentation', 'dependency', 'custom'] as const;
    it.each(categories)('accepts category "%s"', (cat) => {
      const errors = validateStandard(makeValidStandard({ category: cat }));
      expect(errors).toEqual([]);
    });
  });

  describe('all check types are valid', () => {
    const checkTypes = ['ast-pattern', 'regex', 'graph-query', 'llm-check', 'metric'] as const;
    it.each(checkTypes)('accepts checkType "%s"', (ct) => {
      const standard = makeValidStandard({
        rules: [{ id: 'r1', description: 'test', checkType: ct, checkConfig: {}, severity: 'low', autoFixable: false }],
      });
      const errors = validateStandard(standard);
      expect(errors).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// validateReport
// ---------------------------------------------------------------------------

function makeValidReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    id: 'report-001',
    type: 'pr-review',
    title: 'Test Report',
    createdAt: '2024-01-01T00:00:00Z',
    scope: { type: 'project', projectId: 'proj-1' },
    summary: {
      overallScore: 85,
      riskLevel: 'low',
      totalFindings: 5,
      criticalFindings: 0,
      highFindings: 1,
      mediumFindings: 2,
      lowFindings: 2,
      keyTakeaways: ['No critical issues'],
      mergeRecommendation: 'approve',
      mergeRationale: 'All checks passed',
    },
    findings: [
      {
        id: 'f-1',
        category: 'bug',
        severity: 'high',
        title: 'Null pointer',
        description: 'Potential null pointer dereference',
        filePath: 'src/index.ts',
        lineRange: [10, 15],
        evidence: 'Line 12: obj.method()',
        relatedFindings: [],
      },
    ],
    recommendations: [
      {
        id: 'rec-1',
        priority: 1,
        title: 'Add null check',
        description: 'Add null check before calling method',
        estimatedEffort: 'small',
        affectedFiles: ['src/index.ts'],
        actionItems: [{ description: 'Add null check', file: 'src/index.ts' }],
        risksAddressed: ['Null safety'],
        references: [{ type: 'url', label: 'Docs', value: 'https://example.com' }],
      },
    ],
    metrics: {
      linesChanged: 100,
      filesChanged: 5,
      symbolsAffected: 10,
      routesAffected: 0,
      testsImpacted: 2,
      complexityDelta: 0.5,
      coverageDelta: 0.1,
      complianceScore: 90,
      reviewDuration: 3000,
      tokenUsage: 5000,
    },
    metadata: {
      repository: 'org/repo',
      branch: 'main',
      baseBranch: 'main',
      commitSha: 'abc123',
      author: 'dev',
      reviewer: 'reviewer',
      standardsApplied: [],
      rulesApplied: [],
      generatorVersion: '1.0.0',
    },
    ...overrides,
  };
}

describe('validateReport', () => {
  describe('valid report', () => {
    it('passes with all required fields', () => {
      const errors = validateReport(makeValidReport());
      expect(errors).toEqual([]);
    });
  });

  describe('invalid id', () => {
    it('rejects empty id', () => {
      const errors = validateReport(makeValidReport({ id: '' }));
      expect(errors).toContain('report.id must be a non-empty string');
    });
  });

  describe('invalid type', () => {
    it('rejects unknown type', () => {
      const errors = validateReport(makeValidReport({ type: 'unknown' as 'pr-review' }));
      expect(errors.some((e) => e.includes('type'))).toBe(true);
    });
  });

  describe('invalid title', () => {
    it('rejects empty title', () => {
      const errors = validateReport(makeValidReport({ title: '' }));
      expect(errors).toContain('report.title must be a non-empty string');
    });
  });

  describe('invalid createdAt', () => {
    it('rejects empty createdAt', () => {
      const errors = validateReport(makeValidReport({ createdAt: '' }));
      expect(errors).toContain('report.createdAt must be a non-empty string');
    });
  });

  describe('invalid scope', () => {
    it('rejects null scope', () => {
      const errors = validateReport(makeValidReport({ scope: null as unknown as any }));
      expect(errors).toContain('report.scope must be a non-null object');
    });

    it('rejects invalid scope type', () => {
      const errors = validateReport(makeValidReport({
        scope: { type: 'unknown' as 'project' },
      }));
      expect(errors.some((e) => e.includes('scope.type'))).toBe(true);
    });
  });

  describe('invalid summary', () => {
    it('rejects null summary', () => {
      const errors = validateReport(makeValidReport({ summary: null as unknown as any }));
      expect(errors).toContain('report.summary must be a non-null object');
    });

    it('rejects non-number overallScore', () => {
      const report = makeValidReport();
      (report.summary as any).overallScore = 'high';
      const errors = validateReport(report);
      expect(errors).toContain('report.summary.overallScore must be a number');
    });

    it('rejects negative totalFindings', () => {
      const report = makeValidReport();
      report.summary.totalFindings = -1;
      const errors = validateReport(report);
      expect(errors).toContain('report.summary.totalFindings must be a non-negative integer');
    });

    it('rejects non-array keyTakeaways', () => {
      const report = makeValidReport();
      (report.summary as any).keyTakeaways = 'bad';
      const errors = validateReport(report);
      expect(errors).toContain('report.summary.keyTakeaways must be an array');
    });

    it('rejects invalid mergeRecommendation', () => {
      const report = makeValidReport();
      (report.summary as any).mergeRecommendation = 'reject';
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('mergeRecommendation'))).toBe(true);
    });

    it('rejects empty mergeRationale', () => {
      const report = makeValidReport();
      report.summary.mergeRationale = '';
      const errors = validateReport(report);
      expect(errors).toContain('report.summary.mergeRationale must be a non-empty string');
    });
  });

  describe('invalid findings', () => {
    it('rejects findings as non-array', () => {
      const errors = validateReport(makeValidReport({ findings: null as unknown as [] }));
      expect(errors).toContain('report.findings must be an array');
    });

    it('rejects finding with empty id', () => {
      const report = makeValidReport({
        findings: [{ id: '', category: 'bug', severity: 'high', title: 'test', description: 'd', filePath: 'f.ts', lineRange: [1, 2], evidence: 'e', relatedFindings: [] }],
      });
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('.id'))).toBe(true);
    });

    it('rejects finding with empty title', () => {
      const report = makeValidReport({
        findings: [{ id: 'f1', category: 'bug', severity: 'high', title: '', description: 'd', filePath: 'f.ts', lineRange: [1, 2], evidence: 'e', relatedFindings: [] }],
      });
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('.title'))).toBe(true);
    });

    it('rejects null finding entry', () => {
      const report = makeValidReport({
        findings: [null as unknown as any],
      });
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('must be a non-null object'))).toBe(true);
    });
  });

  describe('invalid recommendations', () => {
    it('rejects recommendations as non-array', () => {
      const errors = validateReport(makeValidReport({ recommendations: null as unknown as [] }));
      expect(errors).toContain('report.recommendations must be an array');
    });

    it('rejects recommendation with empty id', () => {
      const report = makeValidReport({
        recommendations: [{ id: '', priority: 1, title: 'test', description: 'd', estimatedEffort: 'small', affectedFiles: [], actionItems: [], risksAddressed: [], references: [] }],
      });
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('.id'))).toBe(true);
    });

    it('rejects recommendation with invalid priority', () => {
      const report = makeValidReport({
        recommendations: [{ id: 'r1', priority: 5 as 1, title: 'test', description: 'd', estimatedEffort: 'small', affectedFiles: [], actionItems: [], risksAddressed: [], references: [] }],
      });
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('priority'))).toBe(true);
    });

    it('rejects recommendation with empty title', () => {
      const report = makeValidReport({
        recommendations: [{ id: 'r1', priority: 1, title: '', description: 'd', estimatedEffort: 'small', affectedFiles: [], actionItems: [], risksAddressed: [], references: [] }],
      });
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('.title'))).toBe(true);
    });

    it('rejects null recommendation entry', () => {
      const report = makeValidReport({
        recommendations: [null as unknown as any],
      });
      const errors = validateReport(report);
      expect(errors.some((e) => e.includes('must be a non-null object'))).toBe(true);
    });
  });

  describe('invalid metrics', () => {
    it('rejects null metrics', () => {
      const errors = validateReport(makeValidReport({ metrics: null as unknown as any }));
      expect(errors).toContain('report.metrics must be a non-null object');
    });

    it('rejects non-number linesChanged', () => {
      const report = makeValidReport();
      (report.metrics as any).linesChanged = 'many';
      const errors = validateReport(report);
      expect(errors).toContain('report.metrics.linesChanged must be a number');
    });

    it('rejects non-number filesChanged', () => {
      const report = makeValidReport();
      (report.metrics as any).filesChanged = 'many';
      const errors = validateReport(report);
      expect(errors).toContain('report.metrics.filesChanged must be a number');
    });
  });

  describe('invalid metadata', () => {
    it('rejects null metadata', () => {
      const errors = validateReport(makeValidReport({ metadata: null as unknown as any }));
      expect(errors).toContain('report.metadata must be a non-null object');
    });

    it('rejects empty repository', () => {
      const report = makeValidReport();
      report.metadata.repository = '';
      const errors = validateReport(report);
      expect(errors).toContain('report.metadata.repository must be a non-empty string');
    });

    it('rejects empty commitSha', () => {
      const report = makeValidReport();
      report.metadata.commitSha = '';
      const errors = validateReport(report);
      expect(errors).toContain('report.metadata.commitSha must be a non-empty string');
    });
  });

  describe('null/undefined edge cases', () => {
    it('rejects null report', () => {
      const errors = validateReport(null as unknown as AnalysisReport);
      expect(errors).toContain('Report must be a non-null object');
    });

    it('rejects undefined report', () => {
      const errors = validateReport(undefined as unknown as AnalysisReport);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('all report types are valid', () => {
    const types = ['pr-review', 'codebase-audit', 'impact-analysis', 'architecture-review', 'standards-compliance'] as const;
    it.each(types)('accepts report type "%s"', (type) => {
      const errors = validateReport(makeValidReport({ type }));
      expect(errors).toEqual([]);
    });
  });

  describe('all merge recommendations are valid', () => {
    const recs = ['approve', 'approve-with-comments', 'request-changes', 'block'] as const;
    it.each(recs)('accepts merge recommendation "%s"', (rec) => {
      const report = makeValidReport();
      report.summary.mergeRecommendation = rec;
      const errors = validateReport(report);
      expect(errors).toEqual([]);
    });
  });
});
