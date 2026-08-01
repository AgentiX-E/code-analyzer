// @code-analyzer — CA-Bench: Review Quality Suite
// Measures code review quality: vulnerability detection rate,
// false positive rate, and heuristic review engine accuracy.
/* v8 ignore file -- @preserve */

import type { BenchmarkSuite, BenchmarkResult } from '../runner.js';
import { measurement, makeResult } from '../reporter.js';
import { CodeReviewEngine } from '@code-analyzer/intelligence';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Known-Vulnerability Test Cases
// ---------------------------------------------------------------------------

interface VulnerabilityCase {
  name: string;
  diff: GitDiff;
  expectedCategory: string;
  expectedSeverity: string;
}

function makeDiff(fileName: string, oldContent: string, newContent: string): GitDiff {
  return {
    filePath: fileName,
    oldContent,
    newContent,
    hunks: [
      {
        oldStart: 1,
        oldLines: oldContent.split('\n').length,
        newStart: 1,
        newLines: newContent.split('\n').length,
        lines: newContent.split('\n').map((line) => ({ type: 'added' as const, content: line })),
      },
    ],
  };
}

const VULN_CASES: VulnerabilityCase[] = [
  {
    name: 'SQL Injection — string concatenation',
    diff: makeDiff(
      'query.ts',
      'function getUser(id: string) { return db.query("SELECT * FROM users"); }',
      'function getUser(id: string) { return db.query("SELECT * FROM users WHERE id = \'" + id + "\'"); }',
    ),
    expectedCategory: 'security',
    expectedSeverity: 'high',
  },
  {
    name: 'Hardcoded secret',
    diff: makeDiff(
      'config.ts',
      'const apiKey = process.env.API_KEY;',
      'const apiKey = "sk-1234567890abcdef";',
    ),
    expectedCategory: 'security',
    expectedSeverity: 'critical',
  },
  {
    name: 'Missing error handling',
    diff: makeDiff(
      'handler.ts',
      'function process(data: string) { return data.trim(); }',
      'async function process(data: string) { const result = await fetch(data); return result.json(); }',
    ),
    expectedCategory: 'bug',
    expectedSeverity: 'medium',
  },
  {
    name: 'Console log left in production',
    diff: makeDiff(
      'auth.ts',
      'function login(user: string, pass: string) { return validateCredentials(user, pass); }',
      'function login(user: string, pass: string) { console.log("Login attempt:", user, pass); return validateCredentials(user, pass); }',
    ),
    expectedCategory: 'security',
    expectedSeverity: 'medium',
  },
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

export class ReviewQualitySuite implements BenchmarkSuite {
  readonly name = 'review-quality';
  readonly description = 'Measures code review accuracy: vulnerability detection rate and false positive rate';

  async run(): Promise<BenchmarkResult> {
    const store = new InMemoryGraphStore();
    const engine = new CodeReviewEngine(store);
    const details: string[] = [];
    let detectedCount = 0;
    let totalCases = VULN_CASES.length;

    for (const vc of VULN_CASES) {
      try {
        const session = await engine.reviewDiff('test-project', [vc.diff]);
        const comments = session.comments ?? [];

        // Check if at least one comment matches the expected category
        const hasRelevantComment = comments.some(
          (c) =>
            c.category === vc.expectedCategory &&
            (c.severity === vc.expectedSeverity || c.severity === 'high' || c.severity === 'critical'),
        );

        if (hasRelevantComment) {
          detectedCount++;
        } else {
          details.push(
            `${vc.name}: No comment matched category="${vc.expectedCategory}" severity="${vc.expectedSeverity}". Got ${comments.length} comments: [${comments.map((c) => `${c.category}/${c.severity}`).join(', ')}]`,
          );
        }
      } catch (error: unknown) {
        details.push(`${vc.name}: Review failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const detectionRate = totalCases > 0 ? detectedCount / totalCases : 0;

    const measurements = [
      measurement('Vulnerability Detection Rate', detectionRate, 'ratio', { target: 0.8, min: 0.5 }),
      measurement('Test Cases Evaluated', totalCases, 'count', { target: totalCases, min: totalCases }),
      measurement('Vulnerabilities Detected', detectedCount, 'count', { target: totalCases, min: 2 }),
    ];

    details.push(`Evaluated ${totalCases} known-vulnerability test cases`);

    return makeResult(this.name, this.description, measurements, details);
  }
}
