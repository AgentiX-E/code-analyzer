// @code-analyzer/cli — `standards check`, the second documented command that did not exist
//
// The JSON contract matters more than the prose: `docs/CODE-REVIEW.md` iterates the output as an array and
// `docs/CONFIGURATION.md` filters it with `jq '.[]'`, so an object would make both silently read nothing.

import { DEFAULT_STANDARDS } from '@code-analyzer/intelligence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRepo, type GitFixture } from './git-fixture.js';
import { projectStandard } from '../commands/init.js';
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VIOLATIONS,
  createStandardsEngine,
  flattenViolations,
  formatStandardsJson,
  formatStandardsMarkdown,
  formatStandardsReport,
  formatStandardsText,
  parseStandardsFile,
  readStandardsFile,
  resolveStandards,
  runStandardsCheck,
} from '../commands/standards-check.js';

/** A file with a hardcoded credential, which several shipped standards are written to catch. */
const SECRET_SOURCE = [
  'export function connect(): string {',
  '  const password = "hunter2-hardcoded";',
  '  console.log(password);',
  '  return password;',
  '}',
  '',
].join('\n');

describe('createStandardsEngine', () => {
  it('can name every standard this product ships', () => {
    const engine = createStandardsEngine();
    for (const standard of DEFAULT_STANDARDS) {
      expect(engine.loadStandard(standard.id).id).toBe(standard.id);
    }
  });

  it('still resolves the templates that were already public', () => {
    const engine = createStandardsEngine();
    expect(engine.loadStandard('typescript-coding').id).toBe('typescript-coding');
    expect(engine.loadStandard('security-baseline').id).toBe('security-baseline');
  });
});

describe('parseStandardsFile', () => {
  it('reads one standard', () => {
    const parsed = parseStandardsFile(JSON.stringify(projectStandard()), 'standards.json');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe('project-standards');
  });

  it('reads an array of standards', () => {
    const text = JSON.stringify([projectStandard(), { ...projectStandard(), id: 'second' }]);
    expect(parseStandardsFile(text, 'standards.json').map((s) => s.id)).toEqual([
      'project-standards',
      'second',
    ]);
  });

  it('refuses the flat rule list `init` used to write, and says how to fix it', () => {
    const legacy = JSON.stringify({
      name: 'Project Standards',
      rules: [{ id: 'no-console-log', category: 'quality', severity: 'warning', enabled: true }],
    });
    // Accepting this would have produced a standards report over rules that match nothing — a pass that means nothing.
    expect(() => parseStandardsFile(legacy, 'old.json')).toThrow(/checkType/);
    expect(() => parseStandardsFile(legacy, 'old.json')).toThrow(/init --force/);
  });

  it('refuses a document that is not JSON, naming the file', () => {
    expect(() => parseStandardsFile('{oops', 'broken.json')).toThrow(/broken\.json is not JSON/);
  });

  it('refuses a JSON value that is not a standard', () => {
    expect(() => parseStandardsFile('42', 'n.json')).toThrow(/expected an object/);
    expect(() => parseStandardsFile('{"rules":[]}', 'n.json')).toThrow(
      /expected an object with "id"/,
    );
  });
});

describe('readStandardsFile', () => {
  let repo: GitFixture;

  beforeAll(() => {
    repo = createRepo();
    repo.write('standards.json', JSON.stringify(projectStandard(), null, 2));
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('reads a file that exists', () => {
    const read = readStandardsFile(`${repo.dir}/standards.json`);
    expect(read.text).toContain('project-standards');
  });

  it('names the path it could not find', () => {
    expect(() => readStandardsFile('/tmp/definitely-not-here.json')).toThrow(/does not exist/);
  });
});

describe('resolveStandards', () => {
  it('resolves ids in the order asked for', () => {
    const engine = createStandardsEngine();
    const standards = resolveStandards(
      engine,
      ['std-security-essentials', 'std-naming'],
      undefined,
    );
    expect(standards.map((s) => s.id)).toEqual(['std-security-essentials', 'std-naming']);
  });

  it('names the standards that exist when one does not', () => {
    const engine = createStandardsEngine();
    expect(() => resolveStandards(engine, ['no-such-standard'], undefined)).toThrow(
      /unknown standard "no-such-standard"/,
    );
    expect(() => resolveStandards(engine, ['no-such-standard'], undefined)).toThrow(
      /std-security-essentials/,
    );
  });

  it('registers a standard from a file so the engine can run it by id', () => {
    const engine = createStandardsEngine();
    const text = JSON.stringify({ ...projectStandard(), id: 'our-conventions' });
    const standards = resolveStandards(engine, [], { path: 's.json', text });
    expect(standards.map((s) => s.id)).toEqual(['our-conventions']);
    expect(engine.loadStandard('our-conventions').id).toBe('our-conventions');
  });

  it('refuses a file standard that shadows a shipped one, rather than letting an id mean two things', () => {
    const engine = createStandardsEngine();
    const text = JSON.stringify({ ...projectStandard(), id: 'security-baseline' });
    expect(() => resolveStandards(engine, [], { path: 's.json', text })).toThrow(
      /security-baseline/,
    );
  });
});

describe('flattenViolations', () => {
  it('carries the rule severity, which is where a violation severity lives', () => {
    const engine = createStandardsEngine();
    const result = engine.checkFiles(
      [{ path: 'a.ts', content: SECRET_SOURCE }],
      'std-security-essentials',
    );
    const violations = flattenViolations(result, result.standardId);

    expect(violations.length).toBeGreaterThan(0);
    const first = violations[0];
    expect(first?.file).toBe('a.ts');
    expect(first?.line).toBeGreaterThan(0);
    expect(first?.standard).toBe('std-security-essentials');
    expect(first?.rule).toBeTruthy();
    expect(first?.severity).toBe('critical');
    expect(first?.snippet).toContain('password');
  });
});

describe('runStandardsCheck', () => {
  let repo: GitFixture;

  beforeAll(() => {
    repo = createRepo();
    repo.write('src/connect.ts', SECRET_SOURCE);
    repo.commit('add a credential');
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('judges a checkout against the built-in set when nothing is named', async () => {
    const run = await runStandardsCheck({ repo: repo.dir });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    expect(run.entries).toHaveLength(DEFAULT_STANDARDS.length);
    expect(run.entries.map((entry) => entry.standardId)).toEqual(
      DEFAULT_STANDARDS.map((standard) => standard.id),
    );
  });

  it('judges only the named standard when one is named', async () => {
    const run = await runStandardsCheck({
      repo: repo.dir,
      standards: ['std-security-essentials'],
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    expect(run.entries).toHaveLength(1);
    expect(run.entries[0]?.violations.length).toBeGreaterThan(0);
    expect(run.entries[0]?.files.truncated).toBe(0);
    expect(run.entries[0]?.files.unreadable).toEqual([]);
    expect(run.entries[0]?.files.changed).toBeGreaterThan(0);
  });

  it('narrows the listed violations without touching what was measured', async () => {
    const strict = await runStandardsCheck({
      repo: repo.dir,
      standards: ['std-security-essentials'],
      severity: 'critical',
    });
    const lenient = await runStandardsCheck({
      repo: repo.dir,
      standards: ['std-security-essentials'],
      severity: 'info',
    });
    expect(strict.ok && lenient.ok).toBe(true);
    if (!strict.ok || !lenient.ok) return;

    // The threshold decides what is listed. It must never make a standard look more compliant than it is.
    expect(strict.entries[0]?.summary.critical).toBe(lenient.entries[0]?.summary.critical);
    expect(strict.entries[0]?.complianceScore).toBe(lenient.entries[0]?.complianceScore);
    expect(
      (strict.entries[0]?.violations.length ?? 0) <= (lenient.entries[0]?.violations.length ?? 0),
    ).toBe(true);
  });

  it('exits 0 when advisory and 1 when the caller asked to fail', async () => {
    const advisory = await runStandardsCheck({
      repo: repo.dir,
      standards: ['std-security-essentials'],
    });
    const enforcing = await runStandardsCheck({
      repo: repo.dir,
      standards: ['std-security-essentials'],
      failOn: 'critical',
    });

    expect(advisory.ok && advisory.exitCode).toBe(EXIT_OK);
    expect(enforcing.ok && enforcing.exitCode).toBe(EXIT_VIOLATIONS);
  });

  it('rejects a severity it does not know, listing the ones it does', async () => {
    const run = await runStandardsCheck({ repo: repo.dir, severity: 'urgent' });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.exitCode).toBe(EXIT_USAGE);
    expect(run.error).toContain('critical');
  });

  it('rejects an unknown language rather than checking nothing', async () => {
    const run = await runStandardsCheck({ repo: repo.dir, languages: ['cobol'] });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('cobol');
    expect(run.error).toContain('typescript');
  });

  it('rejects a standards file that is not there', async () => {
    const run = await runStandardsCheck({
      repo: repo.dir,
      standardsFile: '/tmp/no-such-standards.json',
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('no-such-standards.json');
  });

  it('reports a pull request it cannot authenticate rather than checking the checkout instead', async () => {
    const run = await runStandardsCheck({ repo: repo.dir, pr: 3 });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('--pr needs --token');
  });

  it('rejects a fail-on it does not know', async () => {
    const run = await runStandardsCheck({ repo: repo.dir, failOn: 'whenever' });
    expect(run.ok).toBe(false);
  });
});

describe('standards presentation', () => {
  let entries: Awaited<ReturnType<typeof runStandardsCheck>>;

  beforeAll(async () => {
    const repo = createRepo();
    try {
      repo.write('src/connect.ts', SECRET_SOURCE);
      repo.commit('add a credential');
      entries = await runStandardsCheck({ repo: repo.dir, standards: ['std-security-essentials'] });
    } finally {
      repo.cleanup();
    }
  });

  it('writes an array, which is what both published examples parse', () => {
    if (!entries.ok) throw new Error('fixture failed');
    const parsed = JSON.parse(formatStandardsJson(entries.entries)) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);

    const first = parsed[0] as {
      standardId: string;
      complianceScore: number;
      summary: { critical: number };
    };
    expect(typeof first.standardId).toBe('string');
    expect(typeof first.complianceScore).toBe('number');
    expect(typeof first.summary.critical).toBe('number');
  });

  it('renders a Markdown table a reviewer can read', () => {
    if (!entries.ok) throw new Error('fixture failed');
    const markdown = formatStandardsMarkdown(entries.entries);
    expect(markdown).toContain('## Code Analyzer — Standards Compliance');
    expect(markdown).toContain('| Standard | Compliance |');
    expect(markdown).toContain('std-security-essentials');
    expect(markdown).toContain('### Violations');
  });

  it('says so plainly when nothing is violated', () => {
    const clean = createStandardsEngine().checkFiles(
      [{ path: 'a.ts', content: 'export const a = 1;\n' }],
      'std-naming',
    );
    const markdown = formatStandardsMarkdown([
      {
        ...clean,
        violations: flattenViolations(clean, clean.standardId),
        files: { changed: 1, filtered: 0, truncated: 0, unreadable: [] },
      },
    ]);
    expect(markdown).toContain('No violations at or above the reported severity.');
  });

  it('prints a text form and selects a format', () => {
    if (!entries.ok) throw new Error('fixture failed');
    expect(formatStandardsText(entries.entries)).toContain('std-security-essentials');
    expect(formatStandardsReport(entries.entries, 'json')).toContain('standardId');
    expect(formatStandardsReport(entries.entries, 'markdown')).toContain('## Code Analyzer');
    expect(formatStandardsReport(entries.entries, 'text')).not.toContain('## Code Analyzer');
  });
});

describe('parseStandardsFile — the shapes a hand-written file takes', () => {
  it('refuses an object with an id but no rules array', () => {
    expect(() => parseStandardsFile('{"id":"x"}', 'x.json')).toThrow(
      /expected an object with "id" and "rules"/,
    );
  });

  it('refuses an object with rules but no id, once the rules themselves are well formed', () => {
    const text = JSON.stringify({
      rules: [
        {
          id: 'r',
          description: 'd',
          checkType: 'regex',
          checkConfig: { pattern: 'x' },
          severity: 'low',
          autoFixable: false,
        },
      ],
    });
    expect(() => parseStandardsFile(text, 'x.json')).toThrow(
      /expected an object with "id" and "rules"/,
    );
  });
});

describe('readStandardsFile — a path that exists but is not a file', () => {
  it('reports the read failure rather than letting EISDIR escape', () => {
    const repo = createRepo();
    try {
      expect(() => readStandardsFile(repo.dir)).toThrow(/could not be read/);
    } finally {
      repo.cleanup();
    }
  });
});

describe('formatStandardsMarkdown — coverage a reader is owed', () => {
  it('says how much of the change the verdict covers, when it is not all of it', () => {
    const engine = createStandardsEngine();
    const clean = engine.checkFiles(
      [{ path: 'a.ts', content: 'export const a = 1;\n' }],
      'std-naming',
    );
    const markdown = formatStandardsMarkdown([
      {
        ...clean,
        violations: [],
        files: { changed: 10, filtered: 0, truncated: 7, unreadable: ['src/b.ts'] },
      },
    ]);

    expect(markdown).toContain('7 skipped by --max-files');
    expect(markdown).toContain('1 unreadable');
    expect(markdown).toContain('3 of 10 changed file(s)');
  });
});

describe('standards presentation — the cases a report must survive', () => {
  it('renders a violation that offers no fix without inventing one', () => {
    const engine = createStandardsEngine();
    const result = engine.checkFiles([{ path: 'a.ts', content: 'TODO later\n' }], 'std-general');
    const entries = [
      {
        ...result,
        violations: flattenViolations(result, result.standardId),
        files: { changed: 1, filtered: 0, truncated: 0, unreadable: [] },
      },
    ];
    const noisy = entries.map((entry) => ({
      ...entry,
      // Strip the suggestion the engine may have attached, to exercise the branch that prints nothing for it.
      violations: entry.violations.map((violation) => ({ ...violation, fixSuggestion: undefined })),
    }));

    expect(formatStandardsMarkdown(noisy)).not.toContain('— undefined');
    expect(formatStandardsText(noisy)).not.toContain('fix: undefined');
  });

  it('says there was nothing to check when there were no entries', () => {
    expect(formatStandardsText([])).toContain('No standards were checked.');
    expect(formatStandardsMarkdown([])).toContain(
      'No violations at or above the reported severity.',
    );
  });
});

describe('standards presentation — a violation with nothing to say', () => {
  it('falls back to the rule description and prints no empty fix', () => {
    // A rule engine that reports a bare violation is not wrong, it is terse: the report owes the reader the rule's own
    // description rather than an empty line between two dashes.
    const entry = {
      standardId: 'handmade',
      complianceScore: 0,
      filesChecked: 1,
      summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0, passed: 0 },
      duration: 1,
      ruleResults: [],
      violations: [
        {
          file: 'a.ts',
          line: 2,
          severity: 'medium' as const,
          standard: 'handmade',
          rule: 'terse-rule',
          description: 'The rule that fired',
          snippet: 'const a = 1;',
          autoFixable: false,
        },
      ],
      files: { changed: 1, filtered: 0, truncated: 0, unreadable: [] },
    };

    expect(formatStandardsMarkdown([entry])).toContain('The rule that fired');
    expect(formatStandardsMarkdown([entry])).not.toContain('undefined');
    expect(formatStandardsText([entry])).toContain('The rule that fired');
    expect(formatStandardsText([entry])).not.toContain('fix: undefined');
  });

  it('takes the rule description when a violation carries no message of its own', () => {
    const synthetic = {
      standardId: 'handmade',
      complianceScore: 0,
      filesChecked: 1,
      summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0, passed: 0 },
      duration: 1,
      ruleResults: [
        {
          ruleId: 'terse-rule',
          ruleDescription: 'The rule that fired',
          passed: false,
          severity: 'medium' as const,
          autoFixable: false,
          violations: [
            {
              filePath: 'a.ts',
              lineNumber: 2,
              message: '',
              codeSnippet: 'const a = 1;',
              standardRef: 'terse-rule',
            },
          ],
        },
      ],
    };

    const violations = flattenViolations(synthetic, 'handmade');
    expect(violations[0]?.description).toBe('The rule that fired');
  });
});

describe('runStandardsCheck — which violations a pull request can carry', () => {
  let repo: GitFixture;

  // Line 2 is a `console.log` the change never touches, and there are enough lines after it that the hunk's context
  // cannot reach it; the appended function adds one inside the hunk. Same rule, same severity — the only thing telling
  // the two apart is where they land.
  const BASE = [
    'export const answer = 42;',
    "console.log('outside the change');",
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `export const filler${n} = ${n};`),
    '',
  ].join('\n');
  const HEAD = [
    BASE,
    'export function report(): void {',
    "  console.log('inside the change');",
    '}',
    '',
  ].join('\n');

  beforeAll(() => {
    repo = createRepo();
    repo.write('src/logging.ts', BASE);
    repo.commit('a file with a console.log in it');
    repo.branch('with-a-change');
    repo.write('src/logging.ts', HEAD);
    repo.commit('append a function that logs');
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('marks the one inside the diff and the one outside it, because GitHub can anchor only the first', async () => {
    const run = await runStandardsCheck({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'with-a-change',
      standards: ['std-security'],
      severity: 'info',
    });
    if (!run.ok) throw new Error(run.error);

    const violations = run.entries.flatMap((entry) => entry.violations);
    const untouched = violations.find((violation) => violation.line === 2);
    const appended = violations.find((violation) => violation.line === 13);

    expect(untouched?.rule).toBe('no-console-log');
    expect(untouched?.inDiff).toBe(false);
    expect(appended?.line).toBe(13);
    expect(appended?.inDiff).toBe(true);
  });

  it('does not claim to know which lines are in a diff when there is no diff', async () => {
    const run = await runStandardsCheck({ repo: repo.dir, standards: ['std-security'] });
    if (!run.ok) throw new Error(run.error);

    const violations = run.entries.flatMap((entry) => entry.violations);
    expect(violations.length).toBeGreaterThan(0);
    // Absent, not `false`: a tree has no changed lines, and `false` would describe a change nobody made.
    expect(violations.every((violation) => !('inDiff' in violation))).toBe(true);
  });

  it('counts the violations a reader will not see beside the code', async () => {
    const run = await runStandardsCheck({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'with-a-change',
      standards: ['std-security'],
      severity: 'info',
    });
    if (!run.ok) throw new Error(run.error);

    const markdown = formatStandardsMarkdown(run.entries);
    expect(markdown).toMatch(/_1 of these 2 are on lines this change did not touch/);
  });
});
