// @code-analyzer/intelligence — Prompt Templates Tests
// Tests for all five review lane prompt templates and response parsing.

import { describe, it, expect } from 'vitest';
import {
  SECURITY_REVIEW_PROMPT,
  PERFORMANCE_REVIEW_PROMPT,
  MAINTAINABILITY_REVIEW_PROMPT,
  TESTING_REVIEW_PROMPT,
  ARCHITECTURE_REVIEW_PROMPT,
  LANE_PROMPTS,
  LANE_LABELS,
  LANE_PRIORITIES,
  parseLLMResponse,
} from '../../review/llm/prompts.js';
import type { PromptContext, ReviewLane, LLMFinding } from '../../review/llm/prompts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    diffContent: '// This is a test diff\nconst x = 1;\nconsole.log(x);',
    filePath: '/src/test.ts',
    changeType: 'modified',
    fileContext: 'import { foo } from "./bar";',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Prompt Template Tests
// ---------------------------------------------------------------------------

describe('Security Review Prompt', () => {
  it('should generate a prompt containing OWASP keywords', () => {
    const ctx = createContext();
    const prompt = SECURITY_REVIEW_PROMPT(ctx);

    expect(prompt).toContain('OWASP');
    expect(prompt).toContain('SQL');
    expect(prompt).toContain('injection');
    expect(prompt).toContain('hardcoded');
    expect(prompt).toContain(ctx.filePath);
    expect(prompt).toContain(ctx.diffContent);
    expect(prompt).toContain(ctx.changeType);
  });

  it('should include file context when provided', () => {
    const ctx = createContext({ fileContext: 'import db from "./database";' });
    const prompt = SECURITY_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('File context');
    expect(prompt).toContain('import db');
  });

  it('should handle minimal diff content', () => {
    const ctx = createContext({ diffContent: '// empty diff', fileContext: undefined });
    const prompt = SECURITY_REVIEW_PROMPT(ctx);
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('should include the JSON output schema', () => {
    const ctx = createContext();
    const prompt = SECURITY_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('"findings"');
    expect(prompt).toContain('"severity"');
    expect(prompt).toContain('"category"');
    expect(prompt).toContain('"startLine"');
    expect(prompt).toContain('"endLine"');
  });

  it('should include few-shot examples', () => {
    const ctx = createContext();
    const prompt = SECURITY_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('Few-shot example');
    expect(prompt).toContain('SQL injection');
    expect(prompt).toContain('Hardcoded API key');
  });
});

describe('Performance Review Prompt', () => {
  it('should generate a prompt with performance keywords', () => {
    const ctx = createContext();
    const prompt = PERFORMANCE_REVIEW_PROMPT(ctx);

    expect(prompt).toContain('N+1');
    expect(prompt).toContain('memory');
    expect(prompt).toContain('synchronous');
    expect(prompt).toContain('O(n');
    expect(prompt).toContain(ctx.filePath);
    expect(prompt).toContain(ctx.diffContent);
  });

  it('should include the JSON output schema', () => {
    const ctx = createContext();
    const prompt = PERFORMANCE_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('"findings"');
    expect(prompt).toContain('"severity"');
  });

  it('should include few-shot example for N+1 query', () => {
    const ctx = createContext();
    const prompt = PERFORMANCE_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('N+1 query pattern');
  });
});

describe('Maintainability Review Prompt', () => {
  it('should generate a prompt with maintainability keywords', () => {
    const ctx = createContext();
    const prompt = MAINTAINABILITY_REVIEW_PROMPT(ctx);

    expect(prompt).toContain('SOLID');
    expect(prompt).toContain('code smell');
    expect(prompt).toContain('readability');
    expect(prompt).toContain('Magic number');
    expect(prompt).toContain(ctx.filePath);
  });

  it('should include few-shot example for magic number', () => {
    const ctx = createContext();
    const prompt = MAINTAINABILITY_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('magic number');
  });
});

describe('Testing Review Prompt', () => {
  it('should generate a prompt with testing keywords', () => {
    const ctx = createContext();
    const prompt = TESTING_REVIEW_PROMPT(ctx);

    expect(prompt).toContain('coverage');
    expect(prompt).toContain('assertion');
    expect(prompt).toContain('Flaky tests');
    expect(prompt).toContain('edge case');
    expect(prompt).toContain(ctx.filePath);
  });

  it('should include few-shot example for weak assertion', () => {
    const ctx = createContext();
    const prompt = TESTING_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('Weak assertion');
    expect(prompt).toContain('toBeTruthy');
  });
});

describe('Architecture Review Prompt', () => {
  it('should generate a prompt with architecture keywords', () => {
    const ctx = createContext();
    const prompt = ARCHITECTURE_REVIEW_PROMPT(ctx);

    expect(prompt).toContain('layer');
    expect(prompt).toContain('circular');
    expect(prompt).toContain('abstraction');
    expect(prompt).toContain(ctx.filePath);
  });

  it('should include few-shot example for layer violation', () => {
    const ctx = createContext();
    const prompt = ARCHITECTURE_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('Layer violation');
    expect(prompt).toContain('data access layer');
  });
});

// ---------------------------------------------------------------------------
// LANE_PROMPTS / LANE_LABELS / LANE_PRIORITIES
// ---------------------------------------------------------------------------

describe('Lane Registry', () => {
  it('should have all five review lanes defined', () => {
    const lanes: ReviewLane[] = [
      'security',
      'performance',
      'maintainability',
      'testing',
      'architecture',
    ];
    for (const lane of lanes) {
      expect(LANE_PROMPTS[lane]).toBeDefined();
      expect(LANE_LABELS[lane]).toBeDefined();
      expect(typeof LANE_PROMPTS[lane]).toBe('function');
      expect(typeof LANE_LABELS[lane]).toBe('string');
    }
  });

  it('should have correct lane labels', () => {
    expect(LANE_LABELS.security).toBe('Security Review');
    expect(LANE_LABELS.performance).toBe('Performance Review');
    expect(LANE_LABELS.maintainability).toBe('Maintainability Review');
    expect(LANE_LABELS.testing).toBe('Testing Review');
    expect(LANE_LABELS.architecture).toBe('Architecture Review');
  });

  it('should have security as highest priority', () => {
    expect(LANE_PRIORITIES[0]).toBe('security');
  });

  it('should have all five lanes in priorities', () => {
    expect(LANE_PRIORITIES).toHaveLength(5);
    const set = new Set(LANE_PRIORITIES);
    expect(set.size).toBe(5);
  });

  it('should generate prompts from each lane prompt function', () => {
    const ctx = createContext();
    for (const lane of LANE_PRIORITIES) {
      const prompt = LANE_PROMPTS[lane](ctx);
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    }
  });
});

// ---------------------------------------------------------------------------
// parseLLMResponse Tests
// ---------------------------------------------------------------------------

describe('parseLLMResponse', () => {
  it('should parse a valid JSON response', () => {
    const json = JSON.stringify({
      findings: [
        {
          startLine: 10,
          endLine: 10,
          severity: 'high',
          category: 'security',
          title: 'SQL injection risk',
          description: 'Concatenating user input into SQL query',
          suggestion: 'Use parameterized queries',
        },
      ],
    });

    const results = parseLLMResponse(json);
    expect(results).toHaveLength(1);
    expect(results[0]!.startLine).toBe(10);
    expect(results[0]!.endLine).toBe(10);
    expect(results[0]!.severity).toBe('high');
    expect(results[0]!.category).toBe('security');
    expect(results[0]!.title).toBe('SQL injection risk');
    expect(results[0]!.description).toBe('Concatenating user input into SQL query');
    expect(results[0]!.suggestion).toBe('Use parameterized queries');
  });

  it('should handle JSON wrapped in markdown code fences', () => {
    const json =
      '```json\n' +
      JSON.stringify({
        findings: [
          {
            startLine: 5,
            endLine: 7,
            severity: 'medium',
            category: 'performance',
            title: 'N+1 query',
            description: 'Query in a loop',
            suggestion: null,
          },
        ],
      }) +
      '\n```';

    const results = parseLLMResponse(json);
    expect(results).toHaveLength(1);
    expect(results[0]!.suggestion).toBeNull();
  });

  it('should handle JSON with code fence but no language tag', () => {
    const json =
      '```\n' +
      JSON.stringify({
        findings: [
          {
            startLine: 1,
            endLine: 1,
            severity: 'low',
            category: 'style',
            title: 'Unused variable',
            description: 'Variable is unused',
            suggestion: 'Remove the variable',
          },
        ],
      }) +
      '\n```';

    const results = parseLLMResponse(json);
    expect(results).toHaveLength(1);
  });

  it('should return empty array for invalid JSON', () => {
    const results = parseLLMResponse('this is not valid json');
    expect(results).toHaveLength(0);
  });

  it('should return empty array for JSON without findings array', () => {
    const results = parseLLMResponse('{"key": "value"}');
    expect(results).toHaveLength(0);
  });

  it('should return empty array for JSON with non-array findings', () => {
    const results = parseLLMResponse('{"findings": "not an array"}');
    expect(results).toHaveLength(0);
  });

  it('should filter invalid finding entries', () => {
    const json = JSON.stringify({
      findings: [
        { invalid: true },
        null,
        {
          startLine: 'not a number',
          endLine: 1,
          severity: 'high',
          category: 'bug',
          title: 'Valid-looking',
        },
        { startLine: 1, endLine: 1, severity: 'high', category: 'bug', title: 'Valid' },
      ],
    });

    const results = parseLLMResponse(json);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('Valid');
  });

  it('should handle empty findings array', () => {
    const json = JSON.stringify({ findings: [] });
    const results = parseLLMResponse(json);
    expect(results).toHaveLength(0);
  });

  it('should handle findings with missing optional fields', () => {
    const json = JSON.stringify({
      findings: [{ startLine: 1, endLine: 1, severity: 'low', category: 'bug', title: 'Test' }],
    });

    const results = parseLLMResponse(json);
    expect(results).toHaveLength(1);
    expect(results[0]!.description).toBe('');
    expect(results[0]!.suggestion).toBeNull();
  });

  it('should handle empty string', () => {
    const results = parseLLMResponse('');
    expect(results).toHaveLength(0);
  });

  it('should handle whitespace-only string', () => {
    const results = parseLLMResponse('   \n  \n  ');
    expect(results).toHaveLength(0);
  });

  it('should parse multiple findings', () => {
    const json = JSON.stringify({
      findings: [
        {
          startLine: 1,
          endLine: 1,
          severity: 'critical',
          category: 'security',
          title: 'A',
          description: 'desc a',
          suggestion: 'fix a',
        },
        {
          startLine: 5,
          endLine: 10,
          severity: 'high',
          category: 'performance',
          title: 'B',
          description: 'desc b',
          suggestion: 'fix b',
        },
        {
          startLine: 15,
          endLine: 15,
          severity: 'low',
          category: 'documentation',
          title: 'C',
          description: 'desc c',
          suggestion: null,
        },
      ],
    });

    const results = parseLLMResponse(json);
    expect(results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// PromptContext Tests
// ---------------------------------------------------------------------------

describe('PromptContext', () => {
  it('should handle all context fields being set', () => {
    const ctx: PromptContext = {
      diffContent: 'const x = 1;\nconst y = 2;',
      filePath: '/src/module.ts',
      changeType: 'added',
      fileContext: 'import a from "./a";\nimport b from "./b";',
    };

    for (const lane of LANE_PRIORITIES) {
      const prompt = LANE_PROMPTS[lane](ctx);
      expect(prompt).toContain('/src/module.ts');
      expect(prompt).toContain('added');
      expect(prompt).toContain('File context');
    }
  });

  it('should handle undefined file context', () => {
    const ctx: PromptContext = {
      diffContent: '// comment',
      filePath: '/src/minimal.ts',
      changeType: 'deleted',
      fileContext: undefined,
    };

    for (const lane of LANE_PRIORITIES) {
      const prompt = LANE_PROMPTS[lane](ctx);
      expect(prompt).toContain('/src/minimal.ts');
      // Should not crash with undefined fileContext
      expect(typeof prompt).toBe('string');
    }
  });

  it('should handle renamed files', () => {
    const ctx = createContext({ changeType: 'renamed' });
    const prompt = SECURITY_REVIEW_PROMPT(ctx);
    expect(prompt).toContain('renamed');
  });
});
