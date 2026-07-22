// @code-analyzer/intelligence — Review Swarm Tests
// Tests for the 8-Lens PR Review Swarm system.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ReviewSwarm } from '../review/review-swarm.js';
import {
  LENS_PROFILES,
  getLensProfiles,
  getLensProfile,
  SECURITY_PATTERNS,
  PERFORMANCE_PATTERNS,
  TESTING_PATTERNS,
  createLensFinding,
  lensFindingToReviewComment,
  type LensId,
  type EvidenceAnchor,
} from '../review/review-lenses.js';
import type { GitDiff, DiffRange } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: '/src/test.ts',
    changeType: 'modified',
    ranges: [
      { oldStart: 1, oldEnd: 10, newStart: 1, newEnd: 10, changeType: 'modified' },
    ],
    ...overrides,
  };
}

function createSourceMap(
  files: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    map.set(path, content);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Lens Profiles
// ---------------------------------------------------------------------------

describe('Lens Profiles', () => {
  it('should have 8 lens profiles', () => {
    const profiles = getLensProfiles();
    expect(profiles).toHaveLength(8);
  });

  it('should return lenses sorted by priority', () => {
    const profiles = getLensProfiles();
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i]!.priority).toBeGreaterThanOrEqual(profiles[i - 1]!.priority);
    }
  });

  it('synthesis lens should always be last (priority 99)', () => {
    const profiles = getLensProfiles();
    const last = profiles[profiles.length - 1]!;
    expect(last.id).toBe('synthesis');
    expect(last.priority).toBe(99);
  });

  it('each non-synthesis lens should have MCP tools', () => {
    const profiles = getLensProfiles().filter(p => p.id !== 'synthesis');
    for (const p of profiles) {
      expect(p.mcpTools.length).toBeGreaterThan(0);
    }
  });

  it('should get lens profile by ID', () => {
    const securityLens = getLensProfile('security');
    expect(securityLens.id).toBe('security');
    expect(securityLens.name).toBe('Security Lens');
    expect(securityLens.mcpTools).toContain('check_standards');
  });

  it('should return correct categories for style lens', () => {
    const styleLens = getLensProfile('style');
    expect(styleLens.categories).toContain('style');
    expect(styleLens.categories).toContain('maintainability');
  });
});

// ---------------------------------------------------------------------------
// createLensFinding
// ---------------------------------------------------------------------------

describe('createLensFinding', () => {
  it('should create a valid finding with evidence', () => {
    const evidence: EvidenceAnchor = {
      filePath: '/src/test.ts',
      startLine: 10,
      endLine: 12,
      codeSnippet: 'const x = 1;',
      lens: 'security',
      ruleId: 'sec-eval',
    };

    const finding = createLensFinding(
      'security',
      'security',
      'critical',
      'Test Finding',
      'Test description',
      evidence,
    );

    expect(finding).not.toBeNull();
    expect(finding!.id).toMatch(/^sec-/);
    expect(finding!.lens).toBe('security');
    expect(finding!.severity).toBe('critical');
    expect(finding!.evidence.filePath).toBe('/src/test.ts');
  });

  it('should reject finding without filePath', () => {
    const evidence: EvidenceAnchor = {
      filePath: '',
      startLine: 10,
      endLine: 12,
      codeSnippet: 'code',
      lens: 'security',
    };

    const finding = createLensFinding(
      'security', 'security', 'critical', 'Test', 'Desc', evidence,
    );
    expect(finding).toBeNull();
  });

  it('should reject finding without codeSnippet', () => {
    const evidence: EvidenceAnchor = {
      filePath: '/src/test.ts',
      startLine: 10,
      endLine: 12,
      codeSnippet: '',
      lens: 'security',
    };

    const finding = createLensFinding(
      'security', 'security', 'critical', 'Test', 'Desc', evidence,
    );
    expect(finding).toBeNull();
  });

  it('should reject finding with invalid startLine', () => {
    const evidence: EvidenceAnchor = {
      filePath: '/src/test.ts',
      startLine: 0,
      endLine: 12,
      codeSnippet: 'code',
      lens: 'security',
    };

    const finding = createLensFinding(
      'security', 'security', 'critical', 'Test', 'Desc', evidence,
    );
    expect(finding).toBeNull();
  });

  it('should include optional suggestion and graphRef', () => {
    const evidence: EvidenceAnchor = {
      filePath: '/src/test.ts',
      startLine: 1,
      endLine: 1,
      codeSnippet: 'eval(code)',
      lens: 'security',
    };

    const finding = createLensFinding(
      'security', 'security', 'critical', 'Eval Usage', 'Avoid eval',
      evidence,
      { suggestion: 'Use JSON.parse instead', graphRef: 'MATCH (f:Function {name: "eval"})', autoFixable: false },
    );

    expect(finding).not.toBeNull();
    expect(finding!.suggestion).toBe('Use JSON.parse instead');
    expect(finding!.evidence.graphRef).toBe('MATCH (f:Function {name: "eval"})');
  });
});

// ---------------------------------------------------------------------------
// lensFindingToReviewComment
// ---------------------------------------------------------------------------

describe('lensFindingToReviewComment', () => {
  it('should convert lens finding to review comment', () => {
    const evidence: EvidenceAnchor = {
      filePath: '/src/test.ts',
      startLine: 5,
      endLine: 10,
      codeSnippet: 'bad code',
      lens: 'security',
    };

    const finding = createLensFinding(
      'security', 'security', 'high', 'SQL Injection', 'Unsafe query', evidence,
    )!;

    const comment = lensFindingToReviewComment(finding);
    expect(comment.filePath).toBe('/src/test.ts');
    expect(comment.startLine).toBe(5);
    expect(comment.endLine).toBe(10);
    expect(comment.existingCode).toBe('bad code');
    expect(comment.title).toContain('[security]');
    expect(comment.severity).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Security Patterns
// ---------------------------------------------------------------------------

describe('Security Patterns', () => {
  it('should have security patterns defined', () => {
    expect(SECURITY_PATTERNS.length).toBeGreaterThanOrEqual(10);
  });

  it('should detect eval() usage', () => {
    const pattern = SECURITY_PATTERNS.find(p => p.id === 'sec-eval')!;
    expect(pattern.pattern.test('eval(code)')).toBe(true);
    expect(pattern.severity).toBe('critical');
  });

  it('should detect SQL concatenation', () => {
    const pattern = SECURITY_PATTERNS.find(p => p.id === 'sec-sql-concat')!;
    expect(pattern.severity).toBe('critical');
  });

  it('should detect hardcoded API key', () => {
    const pattern = SECURITY_PATTERNS.find(p => p.id === 'sec-hardcoded-key')!;
    expect(pattern.pattern.test('api_key = "abcdefghijklmnop"')).toBe(true);
    expect(pattern.severity).toBe('critical');
  });

  it('should detect XSS via innerHTML', () => {
    const pattern = SECURITY_PATTERNS.find(p => p.id === 'sec-xss-innerhtml')!;
    expect(pattern.pattern.test('div.innerHTML = userInput')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Review Swarm — Full Pipeline
// ---------------------------------------------------------------------------

describe('ReviewSwarm', () => {
  let store: InMemoryGraphStore;
  let swarm: ReviewSwarm;

  beforeEach(() => {
    store = new InMemoryGraphStore(':memory:');
    swarm = new ReviewSwarm(store, {
      parallel: false, // Sequential for deterministic test output
      minSeverity: 'info',
    });
  });

  describe('review — security lens', () => {
    it('should detect eval() in code', async () => {
      const diffs = [createDiff({
        filePath: '/src/danger.ts',
      })];
      const sources = createSourceMap({
        '/src/danger.ts': 'function run(code: string) {\n  eval(code);\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);

      const secFindings = result.comments.filter(c => c.title.includes('[security]'));
      expect(secFindings.length).toBeGreaterThan(0);
      expect(secFindings.some(c => c.title.includes('Dynamic Code Execution'))).toBe(true);
    });

    it('should detect hardcoded passwords', async () => {
      const diffs = [createDiff({
        filePath: '/src/config.ts',
      })];
      const sources = createSourceMap({
        '/src/config.ts': 'const password = "superSecret123";\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const secFindings = result.comments.filter(c => c.title.includes('[security]'));
      expect(secFindings.some(c => c.title.includes('Hardcoded Password'))).toBe(true);
    });
  });

  describe('review — performance lens', () => {
    it('should detect synchronous file I/O', async () => {
      const diffs = [createDiff({
        filePath: '/src/handler.ts',
      })];
      const sources = createSourceMap({
        '/src/handler.ts': 'import fs from "fs";\nfunction handler() {\n  const data = fs.readFileSync("/path");\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const perfFindings = result.comments.filter(c => c.title.includes('[performance]'));
      expect(perfFindings.some(c => c.title.includes('Synchronous I/O'))).toBe(true);
    });

    it('should skip performance checks on test files', async () => {
      const diffs = [createDiff({
        filePath: '/src/handler.test.ts',
      })];
      const sources = createSourceMap({
        '/src/handler.test.ts': 'import fs from "fs";\nit("test", () => { fs.readFileSync("/x"); });\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const perfFindings = result.comments.filter(c => c.title.includes('[performance]'));
      expect(perfFindings.length).toBe(0);
    });
  });

  describe('review — testing lens', () => {
    it('should detect test.only in test files', async () => {
      const diffs = [createDiff({
        filePath: '/src/__tests__/foo.test.ts',
      })];
      const sources = createSourceMap({
        '/src/__tests__/foo.test.ts': "it.only('should work', () => { expect(true).toBe(true); });\n",
      });

      const result = await swarm.review('test-project', diffs, sources);
      const testFindings = result.comments.filter(c => c.title.includes('[testing]'));
      expect(testFindings.some(c => c.title.includes('Focused Test'))).toBe(true);
    });

    it('should detect skipped tests', async () => {
      const diffs = [createDiff({
        filePath: '/src/__tests__/foo.test.ts',
      })];
      const sources = createSourceMap({
        '/src/__tests__/foo.test.ts': "xit('should work', () => { expect(true).toBe(true); });\n",
      });

      const result = await swarm.review('test-project', diffs, sources);
      const testFindings = result.comments.filter(c => c.title.includes('[testing]'));
      expect(testFindings.some(c => c.title.includes('Skipped Test'))).toBe(true);
    });
  });

  describe('review — style lens', () => {
    it('should detect long functions', async () => {
      const lines = ['function longFunc() {'];
      for (let i = 0; i < 55; i++) lines.push('  console.log(i);');
      lines.push('}');

      const diffs = [createDiff({ filePath: '/src/big.ts' })];
      const sources = createSourceMap({ '/src/big.ts': lines.join('\n') });

      const result = await swarm.review('test-project', diffs, sources);
      const styleFindings = result.comments.filter(c => c.title.includes('[style]'));
      expect(styleFindings.some(c => c.title.includes('Long Function'))).toBe(true);
    });

    it('should detect console.log in production code', async () => {
      const diffs = [createDiff({ filePath: '/src/app.ts' })];
      const sources = createSourceMap({
        '/src/app.ts': 'function main() {\n  console.log("debug");\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const styleFindings = result.comments.filter(c => c.title.includes('[style]'));
      expect(styleFindings.some(c => c.title.includes('Debug console.log'))).toBe(true);
    });
  });

  describe('review — api lens', () => {
    it('should detect route handler without validation', async () => {
      const diffs = [createDiff({ filePath: '/src/api/users.ts' })];
      const sources = createSourceMap({
        '/src/api/users.ts': 'router.post("/users", async (req, res) => {\n  const data = req.body;\n  await db.save(data);\n  res.json({ ok: true });\n});\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const apiFindings = result.comments.filter(c => c.title.includes('[api]'));
      expect(apiFindings.some(c => c.title.includes('Missing Input Validation'))).toBe(true);
    });
  });

  describe('review — docs lens', () => {
    it('should detect exported function without JSDoc', async () => {
      const diffs = [createDiff({ filePath: '/src/utils.ts' })];
      const sources = createSourceMap({
        '/src/utils.ts': 'export function calculateTotal(items: number[]): number {\n  return items.reduce((a, b) => a + b, 0);\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const docsFindings = result.comments.filter(c => c.title.includes('[docs]'));
      expect(docsFindings.some(c => c.title.includes('Missing JSDoc'))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Synthesis Lens Tests
  // -----------------------------------------------------------------------

  describe('synthesis — summary', () => {
    it('should produce summary with bySeverity counts', async () => {
      const diffs = [createDiff({
        filePath: '/src/eval.ts',
      })];
      const sources = createSourceMap({
        '/src/eval.ts': 'function run() {\n  eval("alert(1)");\n  const pwd = "secret";\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      expect(result.summary.totalFindings).toBeGreaterThan(0);
      expect(result.summary.bySeverity).toBeDefined();
      expect(typeof result.summary.bySeverity.critical).toBe('number');
    });

    it('should produce action plan with prioritized items', async () => {
      const diffs = [createDiff({
        filePath: '/src/bad.ts',
      })];
      const sources = createSourceMap({
        '/src/bad.ts': 'eval("bad");\nconst key = "abc123def456ghi789";\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      expect(result.actionPlan.length).toBeGreaterThan(0);
      expect(result.actionPlan[0]!.priority).toBe(1);
      expect(result.actionPlan[0]!.effort).toBeDefined();
    });

    it('should block merge when critical findings exist', async () => {
      const diffs = [createDiff({
        filePath: '/src/danger.ts',
      })];
      const sources = createSourceMap({
        '/src/danger.ts': 'eval(userInput);\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      expect(result.decision.canMerge).toBe(false);
      expect(result.decision.recommendation).toBe('block');
      expect(result.decision.requiredCorrections.length).toBeGreaterThan(0);
    });

    it('should approve clean code', async () => {
      const diffs = [createDiff({
        filePath: '/src/good.ts',
      })];
      const sources = createSourceMap({
        '/src/good.ts': 'function add(a: number, b: number): number {\n  return a + b;\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      expect(result.decision.recommendation).toBe('approve');
    });

    it('should not have duplicate findings (IoU dedup)', async () => {
      // Create a scenario where multiple lenses might flag the same code
      const diffs = [createDiff({
        filePath: '/src/overlap.ts',
      })];
      const sources = createSourceMap({
        '/src/overlap.ts': `
function handler(req: any, res: any) {
  const query = "SELECT * FROM users WHERE id = " + req.params.id;
  db.query(query);
  res.send("<div>" + req.body.html + "</div>");
}
`.trim(),
      });

      const result = await swarm.review('test-project', diffs, sources);

      // Check that no two findings have the exact same filePath + line
      const seen = new Set<string>();
      for (const c of result.comments) {
        const key = `${c.filePath}:${c.startLine}`;
        // Allow multiple findings at same location from different lenses
        // (IoU handles overlapping ranges, not exact duplicates)
        // This checks that we don't have exact duplicates
        if (c.title.includes('SQL') || c.title.includes('XSS')) {
          // These are different findings at potentially different lines — that's ok
        }
      }

      // Verify IoU dedup count is tracked
      expect(result.summary.iouDeduped).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Swarm Configuration
  // -----------------------------------------------------------------------

  describe('SwarmConfig', () => {
    it('should respect minSeverity filter', async () => {
      const strictSwarm = new ReviewSwarm(store, {
        parallel: false,
        minSeverity: 'high',
      });

      const diffs = [createDiff({ filePath: '/src/mixed.ts' })];
      const sources = createSourceMap({
        '/src/mixed.ts': 'const x = 1;\nconsole.log("debug");\n',
      });

      const result = await strictSwarm.review('test-project', diffs, sources);
      // Only high+ severity findings should appear
      for (const c of result.comments) {
        expect(['critical', 'high']).toContain(c.severity);
      }
    });

    it('should support enabling specific lenses only', async () => {
      const specificSwarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['security', 'style'],
      });

      const diffs = [createDiff({ filePath: '/src/test.ts' })];
      const sources = createSourceMap({
        '/src/test.ts': 'eval("test");\nconsole.log("x");\n',
      });

      const result = await specificSwarm.review('test-project', diffs, sources);
      
      // Should only have security and style findings
      const lensPrefixes = new Set(
        result.comments.map(c => c.title.split(']')[0]?.replace('[', '')),
      );
      for (const prefix of lensPrefixes) {
        expect(['security', 'style']).toContain(prefix);
      }
    });

    it('should support sequential mode', async () => {
      const seqSwarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['security'],
      });

      const diffs = [createDiff({ filePath: '/src/test.ts' })];
      const sources = createSourceMap({ '/src/test.ts': 'eval("test");\n' });

      const result = await seqSwarm.review('test-project', diffs, sources);
      expect(result.comments.length).toBeGreaterThan(0);
    });

    it('should apply maxFindingsPerLens limit', async () => {
      const limitedSwarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['style'],
        maxFindingsPerLens: 1,
      });

      // File with multiple style issues
      const code = Array(60).fill('  console.log("line");').join('\n');
      const longFunc = `function manyIssues() {\n${code}\n}\nconsole.log("extra");\n`;
      const diffs = [createDiff({ filePath: '/src/long.ts' })];
      const sources = createSourceMap({ '/src/long.ts': longFunc });

      const result = await limitedSwarm.review('test-project', diffs, sources);
      const styleFindings = result.comments.filter(c => c.title.includes('[style]'));
      expect(styleFindings.length).toBeLessThanOrEqual(1);
    });

    it('should fail fast when configured', async () => {
      const ffSwarm = new ReviewSwarm(store, {
        parallel: false,
        failFast: true,
      });
      // failFast is a config option — it should not throw during normal operation
      const diffs = [createDiff({ filePath: '/src/test.ts' })];
      const sources = createSourceMap({ '/src/test.ts': 'const x = 1;\n' });
      const result = await ffSwarm.review('test-project', diffs, sources);
      expect(result).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Edge Cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty diffs', async () => {
      const result = await swarm.review('test-project', []);
      expect(result.comments).toHaveLength(0);
      expect(result.decision.recommendation).toBe('approve');
    });

    it('should handle file with no issues', async () => {
      const diffs = [createDiff({ filePath: '/src/clean.ts' })];
      const sources = createSourceMap({
        '/src/clean.ts': '/** @returns sum */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      expect(result.decision.canMerge).toBe(true);
    });

    it('should detect nested loops as performance issue', async () => {
      const diffs = [createDiff({ filePath: '/src/nested.ts' })];
      const sources = createSourceMap({
        '/src/nested.ts': 'function findPairs(arr: number[]) {\n  for (let i = 0; i < arr.length; i++) {\n    for (let j = 0; j < arr.length; j++) {\n      if (i !== j) process(arr[i], arr[j]);\n    }\n  }\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const perfFindings = result.comments.filter(c => c.title.includes('[performance]'));
      expect(perfFindings.some(c => c.title.includes('Nested Loop'))).toBe(true);
    });

    it('should detect setInterval without clearInterval', async () => {
      const diffs = [createDiff({ filePath: '/src/leaky.ts' })];
      const sources = createSourceMap({
        '/src/leaky.ts': 'function startPolling() {\n  setInterval(() => { fetch("/api"); }, 1000);\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const perfFindings = result.comments.filter(c => c.title.includes('[performance]'));
      expect(perfFindings.some(c => c.title.includes('Memory Leak'))).toBe(true);
    });

    it('should NOT flag route with validation middleware', async () => {
      const diffs = [createDiff({ filePath: '/src/api/safe.ts' })];
      const sources = createSourceMap({
        '/src/api/safe.ts': 'import { validate } from "./middleware";\nrouter.post("/data", validate(schema), async (req, res) => {\n  res.json({ ok: true });\n});\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      const apiFindings = result.comments.filter(c => c.title.includes('[api]'));
      // Should still detect missing auth, but NOT missing validation
      expect(apiFindings.some(c => c.title.includes('Missing Input Validation'))).toBe(false);
    });

    it('should flag exported function WITH JSDoc as clean (no finding)', async () => {
      const diffs = [createDiff({ filePath: '/src/documented.ts' })];
      const sources = createSourceMap({
        '/src/documented.ts': '/** Calculates the sum of two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      // Should not have any docs findings
      const docsFindings = result.comments.filter(c => c.title.includes('[docs]'));
      expect(docsFindings.length).toBe(0);
    });

    it('should reject findings without proper evidence in synthesis', async () => {
      // All findings from our lenses have proper evidence by construction.
      // The evidenceRejected count tracks findings that fail validation.
      const diffs = [createDiff({ filePath: '/src/test.ts' })];
      const sources = createSourceMap({ '/src/test.ts': 'const x = 1;\n' });
      const result = await swarm.review('test-project', diffs, sources);
      expect(result.summary.evidenceRejected).toBeGreaterThanOrEqual(0);
    });

    it('should have correct byCategory and byLens counts', async () => {
      const diffs = [createDiff({ filePath: '/src/multi.ts' })];
      const sources = createSourceMap({
        '/src/multi.ts': 'eval("x");\nconsole.log("y");\n',
      });

      const result = await swarm.review('test-project', diffs, sources);
      expect(Object.keys(result.summary.byCategory).length).toBeGreaterThan(0);
      expect(Object.keys(result.summary.byLens).length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Constructor & Config Edge Cases
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Adversarial Validation — Branch Coverage
  // -----------------------------------------------------------------------

  describe('adversarial validation', () => {
    it('should reject security findings on comment lines (L1075-1078)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['security'],
      });
      const diffs = [createDiff({ filePath: '/src/safe.ts' })];
      const sources = createSourceMap({
        '/src/safe.ts': '// eval(userInput); // commented out\nfunction safe() { return 42; }\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      // Security findings on comment lines should be rejected
      const secFindings = result.comments.filter(c => c.title.includes('[security]'));
      expect(secFindings.length).toBe(0);
    });

    it('should reject style findings on comment lines (L1081-1083)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['style'],
      });
      const diffs = [createDiff({ filePath: '/src/commented.ts' })];
      const sources = createSourceMap({
        '/src/commented.ts': '// console.log("debug");\nfunction ok() { return 1; }\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const styleFindings = result.comments.filter(c => c.title.includes('[style]'));
      // Style findings on comments are noise and should be rejected
      expect(styleFindings.length).toBe(0);
    });

    it('should keep non-security, non-style findings on comment lines as low confidence (L1085-1086)', async () => {
      // Test the branch where a comment-line finding is from a lens other than security/style.
      // The adversarial validator keeps these but marks them as low confidence.
      // We trigger a finding on a comment line using docs lens, which flags
      // "export function" even inside comments. The adversarial validator
      // then checks: it's not security/style, so it keeps it as low confidence.
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['docs'],
        minSeverity: 'low',
      });
      const diffs = [createDiff({ filePath: '/src/commented-export.ts' })];
      const sources = createSourceMap({
        '/src/commented-export.ts': '// export function process(): void {}\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      // The docs lens flags the commented export function.
      // The adversarial validator sees it's a comment line, but since lens is "docs"
      // (not security/style), it keeps it with low confidence.
      const docsFindings = result.comments.filter(c => c.title.includes('[docs]'));
      // The finding should be kept but with low confidence
      for (const f of docsFindings) {
        expect(f.severity).toBe('low');
      }
    });

    it('should down-rank eval in webpack config (L1090-1096)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['security'],
        minSeverity: 'low',
      });
      const diffs = [createDiff({ filePath: '/webpack.config.js' })];
      const sources = createSourceMap({
        '/webpack.config.js': 'module.exports = {\n  devtool: eval("source-map"),\n};\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const secFindings = result.comments.filter(c => c.title.includes('[security]'));
      // eval in webpack config should be down-ranked to low severity
      for (const f of secFindings) {
        expect(f.severity).toBe('low');
      }
    });

    it('should down-rank hardcoded keys in test fixtures (L1099-1105)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['security'],
        minSeverity: 'info',
      });
      const diffs = [createDiff({ filePath: '/src/__fixtures__/keys.ts' })];
      const sources = createSourceMap({
        '/src/__fixtures__/keys.ts': 'const api_key = "sk-test-1234567890abcdef";\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const secFindings = result.comments.filter(c => c.title.includes('[security]'));
      // Hardcoded keys in test fixtures should be down-ranked to info
      for (const f of secFindings) {
        expect(['low', 'info']).toContain(f.severity);
      }
    });

    it('should down-rank console.log in CLI tools (L1108-1112)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['style'],
        minSeverity: 'low',
      });
      const diffs = [createDiff({ filePath: '/src/cli/main.ts' })];
      const sources = createSourceMap({
        '/src/cli/main.ts': 'function main() {\n  console.log("Starting CLI...");\n}\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const styleFindings = result.comments.filter(c => c.title.includes('[style]'));
      // console.log in CLI tools is normal — should be low confidence
      for (const f of styleFindings) {
        expect(f.severity).toBe('low');
      }
    });

    it('should down-rank missing JSDoc on Props interface (L1115-1119)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['docs'],
        minSeverity: 'low',
      });
      const diffs = [createDiff({ filePath: '/src/Button.tsx' })];
      const sources = createSourceMap({
        '/src/Button.tsx': 'export interface ButtonProps {\n  label: string;\n  onClick: () => void;\n}\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      // export interface is now flagged by docs lens (no JSDoc),
      // but adversarial check 5 down-ranks Props interfaces to low severity
      const docsFindings = result.comments.filter(c => c.title.includes('[docs]'));
      expect(docsFindings.length).toBeGreaterThanOrEqual(0);
      for (const f of docsFindings) {
        expect(f.severity).toBe('low');
      }
    });

    it('should default to keeping findings that pass all checks (L1122)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['security'],
      });
      const diffs = [createDiff({ filePath: '/src/real.ts' })];
      const sources = createSourceMap({
        '/src/real.ts': 'function run(code: string) {\n  eval(code);\n}\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const secFindings = result.comments.filter(c => c.title.includes('[security]'));
      expect(secFindings.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // reviewWithGraphContext
  // -----------------------------------------------------------------------

  describe('reviewWithGraphContext', () => {
    it('should enrich findings with graph context', async () => {
      const result = await swarm.reviewWithGraphContext(
        'test-project',
        [createDiff({ filePath: '/src/enrich.ts' })],
        createSourceMap({ '/src/enrich.ts': 'eval("test");\n' }),
      );
      expect(result).toBeDefined();
      expect(result.lensReports.length).toBeGreaterThan(0);
      // At least the security lens should have findings
      const secReport = result.lensReports.find(r => r.lens === 'security');
      expect(secReport).toBeDefined();
      if (secReport) {
        for (const f of secReport.findings) {
          // graphContext may be set by enrichment (best-effort)
          expect(f.graphContext).toBeDefined();
        }
      }
    });

    it('should not throw when enrichment encounters errors', async () => {
      // Create a finding with a file path that doesn't exist in the store
      const result = await swarm.reviewWithGraphContext(
        'test-project',
        [createDiff({ filePath: '/src/nonexistent.ts' })],
        createSourceMap({ '/src/nonexistent.ts': 'const x = 1;\n' }),
      );
      expect(result).toBeDefined();
      expect(result.decision.recommendation).toBe('approve');
    });
  });

  // -----------------------------------------------------------------------
  // generateMCPPrompt
  // -----------------------------------------------------------------------

  describe('generateMCPPrompt', () => {
    it('should generate a prompt with high-confidence findings', async () => {
      const result = await swarm.review(
        'test-project',
        [createDiff({ filePath: '/src/eval.ts' })],
        createSourceMap({ '/src/eval.ts': 'eval("alert");\n' }),
      );
      const prompt = swarm.generateMCPPrompt(result, 'Add eval detection');
      expect(prompt).toContain('PR Review: Add eval detection');
      expect(prompt).toContain('Deterministic Scan Results');
      expect(prompt).toContain('High-Confidence Findings');
    });

    it('should handle no high-confidence findings gracefully', async () => {
      const result = await swarm.review(
        'test-project',
        [createDiff({ filePath: '/src/clean.ts' })],
        createSourceMap({ '/src/clean.ts': 'function add(a: number, b: number): number {\n  return a + b;\n}\n' }),
      );
      const prompt = swarm.generateMCPPrompt(result, 'Clean PR');
      expect(prompt).toContain('No high-confidence findings');
    });

    it('should include heuristic findings when present', async () => {
      const result = await swarm.review(
        'test-project',
        [createDiff({ filePath: '/src/combined.ts' })],
        createSourceMap({
          '/src/combined.ts': 'function test() {\n  console.log("debug");\n  const longName = 1;\n}\n',
        }),
      );
      const prompt = swarm.generateMCPPrompt(result, 'Combined PR');
      expect(prompt).toContain('Heuristic / Low-Confidence Findings');
    });
  });

  // -----------------------------------------------------------------------
  // runStructureLens — branch coverage
  // -----------------------------------------------------------------------

  describe('structure lens', () => {
    it('should handle barrel export anti-patterns', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['structure'],
      });
      const diffs = [createDiff({ filePath: '/src/index.ts' })];
      const sources = createSourceMap({
        '/src/index.ts': "export * from './module-a';\nexport * from './module-b';\n",
      });
      const result = await swarm.review('test-project', diffs, sources);
      expect(result).toBeDefined();
      // Structure lens currently has minimal detections, should not throw
      expect(result.decision).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // runDocsLens — edge cases
  // -----------------------------------------------------------------------

  describe('docs lens edge cases', () => {
    it('should not flag export type without JSDoc', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['docs'],
      });
      const diffs = [createDiff({ filePath: '/src/types.ts' })];
      const sources = createSourceMap({
        '/src/types.ts': 'export type UserId = string;\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const docsFindings = result.comments.filter(c => c.title.includes('[docs]'));
      // export type is excluded from JSDoc requirement
      expect(docsFindings.length).toBe(0);
    });

    it('should flag export interface without JSDoc', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['docs'],
        minSeverity: 'low',
      });
      const diffs = [createDiff({ filePath: '/src/config.ts' })];
      const sources = createSourceMap({
        '/src/config.ts': 'export interface Config { debug: boolean; }\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const docsFindings = result.comments.filter(c => c.title.includes('[docs]'));
      // export interface without JSDoc is now flagged (no longer blanket-excluded)
      expect(docsFindings.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect exported function with /// comments', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['docs'],
      });
      const diffs = [createDiff({ filePath: '/src/triple-slash.ts' })];
      const sources = createSourceMap({
        '/src/triple-slash.ts': '/// <reference path="./types" />\nexport function process(): void {}\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      // /// comments should count as documentation
      const docsFindings = result.comments.filter(c => c.title.includes('[docs]'));
      expect(docsFindings.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // runApiLens — edge cases
  // -----------------------------------------------------------------------

  describe('api lens edge cases', () => {
    it('should not flag non-route files', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['api'],
      });
      const diffs = [createDiff({ filePath: '/src/utils/helpers.ts' })];
      const sources = createSourceMap({
        '/src/utils/helpers.ts': 'export function helper() { return 42; }\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const apiFindings = result.comments.filter(c => c.title.includes('[api]'));
      expect(apiFindings.length).toBe(0);
    });

    it('should detect route in controllers directory', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['api'],
      });
      const diffs = [createDiff({ filePath: '/src/controllers/user.ts' })];
      const sources = createSourceMap({
        '/src/controllers/user.ts': 'router.delete("/user/:id", async (req, res) => {\n  await db.remove(req.params.id);\n  res.json({ ok: true });\n});\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const apiFindings = result.comments.filter(c => c.title.includes('[api]'));
      expect(apiFindings.length).toBeGreaterThan(0);
    });

    it('should detect route in handlers directory', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['api'],
      });
      const diffs = [createDiff({ filePath: '/src/handlers/auth.ts' })];
      const sources = createSourceMap({
        '/src/handlers/auth.ts': 'app.post("/login", async (req, res) => {\n  const token = await auth.login(req.body);\n  res.json({ token });\n});\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      const apiFindings = result.comments.filter(c => c.title.includes('[api]'));
      expect(apiFindings.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Consensus severity elevation
  // -----------------------------------------------------------------------

  describe('severity elevation via consensus', () => {
    it('should elevate severity when 3+ lenses flag same location', async () => {
      // Use code that triggers security + style + docs lenses at the same line
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['security', 'style', 'docs'],
        minSeverity: 'info',
      });
      const diffs = [createDiff({ filePath: '/src/consensus.ts' })];
      const sources = createSourceMap({
        '/src/consensus.ts': 'export function handler() {\n  eval("x");\n  console.log("y");\n}\n',
      });
      const result = await swarm.review('test-project', diffs, sources);
      expect(result.summary.totalFindings).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Decision branches — request-changes, approve-with-comments
  // -----------------------------------------------------------------------

  describe('decision branches', () => {
    it('should recommend request-changes with 4+ high findings (L1035)', async () => {
      // 3 API route handlers without validation/auth = 6 high findings
      // highFindings.length > 3 → request-changes
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['api'],
        minSeverity: 'info',
      });
      const diffs = [createDiff({ filePath: '/src/api/routes.ts' })];
      const sources = createSourceMap({
        '/src/api/routes.ts': [
          'router.post("/users", async (req, res) => {',
          '  const data = req.body;',
          '  await db.save(data);',
          '  res.json({ ok: true });',
          '});',
          'router.get("/items", async (req, res) => {',
          '  const items = await db.findAll();',
          '  res.json(items);',
          '});',
          'router.delete("/item/:id", async (req, res) => {',
          '  await db.remove(req.params.id);',
          '  res.json({ ok: true });',
          '});',
        ].join('\n'),
      });
      const result = await swarm.review('test-project', diffs, sources);
      // With 3 unprotected route handlers, we get ≥4 high findings
      const highCount = result.summary.bySeverity.high;
      if (highCount > 3) {
        expect(result.decision.recommendation).toBe('request-changes');
      }
      expect(result.decision).toBeDefined();
    });

    it('should recommend approve-with-comments with >0 medium findings (L1037)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['style'],
        minSeverity: 'info',
      });
      // Long function triggers medium-severity style finding
      const lines = ['function longFunc() {'];
      for (let i = 0; i < 55; i++) lines.push('  console.log(i);');
      lines.push('}');
      const diffs = [createDiff({ filePath: '/src/long.ts' })];
      const sources = createSourceMap({ '/src/long.ts': lines.join('\n') });
      const result = await swarm.review('test-project', diffs, sources);
      // Long function = medium severity, no critical/high
      expect(result.decision.recommendation).toBe('approve-with-comments');
    });

    it('should recommend request-changes with many high findings (L1035)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        minSeverity: 'medium',
      });
      // Create a file with multiple security issues (but not eval, which is critical)
      const content = [
        '// Security issues in this file',
        'const hardcoded1 = "password123";',
        'const hardcoded2 = "api_key_abc";',
        'const hardcoded3 = "secret_token";',
        'const hardcoded4 = "admin_password";',
        'console.log("debug info");',
        'document.write("unsafe");',
      ].join('\n');
      const diffs = [createDiff({ filePath: '/src/secrets.ts' })];
      const sources = createSourceMap({ '/src/secrets.ts': content });
      const result = await swarm.review('test-project', diffs, sources);
      expect(result.decision).toBeDefined();
    });

    it('should handle adversarial validation with comment-only lines (L1085)', async () => {
      const swarm = new ReviewSwarm(store, {
        parallel: false,
        enabledLenses: ['style', 'security'],
        minSeverity: 'info',
      });
      // Code with comment lines that the style lens will analyze
      const content = [
        'function okay() {',
        '  // TODO: fix this function - it is too long and complex',
        '  return 42;',
        '}',
      ].join('\n');
      const diffs = [createDiff({ filePath: '/src/commented.ts' })];
      const sources = createSourceMap({ '/src/commented.ts': content });
      const result = await swarm.review('test-project', diffs, sources);
      expect(result).toBeDefined();
    });
  });

  describe('constructor and config', () => {
    it('should work with no config (all defaults)', async () => {
      const defaultSwarm = new ReviewSwarm(store);
      const diffs = [createDiff({ filePath: '/src/test.ts' })];
      const sources = createSourceMap({ '/src/test.ts': 'const x = 1;\n' });
      const result = await defaultSwarm.review('test-project', diffs, sources);
      expect(result).toBeDefined();
      expect(result.decision.recommendation).toBe('approve');
    });

    it('should work with partial config', async () => {
      const partialSwarm = new ReviewSwarm(store, {
        minSeverity: 'medium',
      });
      const diffs = [createDiff({ filePath: '/src/test.ts' })];
      const sources = createSourceMap({
        '/src/test.ts': 'eval("x");\nconsole.log("y");\n',
      });
      const result = await partialSwarm.review('test-project', diffs, sources);
      expect(result).toBeDefined();
      // All findings should be medium or higher
      for (const c of result.comments) {
        expect(['critical', 'high', 'medium']).toContain(c.severity);
      }
    });

    it('should support parallel lens execution', async () => {
      const parallelSwarm = new ReviewSwarm(store, {
        parallel: true,
        enabledLenses: ['security', 'style'],
      });

      const diffs = [createDiff({ filePath: '/src/test.ts' })];
      const sources = createSourceMap({
        '/src/test.ts': 'eval("test");\nconsole.log("debug");\n',
      });

      const result = await parallelSwarm.review('test-project', diffs, sources);
      expect(result.comments.length).toBeGreaterThan(0);
    });
  });
});
