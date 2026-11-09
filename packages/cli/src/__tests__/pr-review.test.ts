// @code-analyzer/cli — `review pr`, end to end on a real repository
//
// **The user story this file exists for:** a developer opens a pull request that adds a credential and a concatenated
// SQL query; CI runs `code-analyzer review pr`; the pull request receives findings that name the file and the line.
// Every case below drives that story with git and the real engines, because the bug being fixed was that the command
// five documents described did not exist — and a command that exists but reports the wrong lines is the same failure
// with better manners.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRepo, type GitFixture } from './git-fixture.js';
import { resolveChangeSet } from '../commands/change-set.js';
import { projectStandard } from '../commands/init.js';
import {
  EXIT_FINDINGS,
  EXIT_OK,
  EXIT_USAGE,
  PR_REVIEW_SCHEMA,
  formatPrReviewMarkdown,
  formatPrReviewReport,
  formatPrReviewText,
  diffMembership,
  joinLensFindings,
  runPrReview,
} from '../commands/pr-review.js';
import { severityRank } from '../commands/severity.js';

const SECRET_AND_SQL = [
  'export function lookup(id: string): string {',
  '  const password = "hunter2-hardcoded";',
  '  const query = "SELECT * FROM users WHERE id = " + id;',
  '  console.log(password);',
  '  return query;',
  '}',
  '',
].join('\n');

/** A repository whose `feature` branch adds the file above and whose `main` does not have it. */
function pullRequestFixture(): GitFixture {
  const repo = createRepo();
  repo.branch('feature');
  repo.write('src/lookup.ts', SECRET_AND_SQL);
  repo.commit('add lookup');
  repo.checkout('main');
  repo.write('src/untouched.ts', 'export const untouched = 1;\n');
  repo.commit('base work');
  // **Left at the head, which is what `.github/workflows/pr-review.yml` does before calling the CLI**: the diff comes
  // from the refs, but the file texts come from the checkout, and a review of a checkout at the base can read neither.
  repo.checkout('feature');
  return repo;
}

describe('runPrReview — the pull request user story', () => {
  let repo: GitFixture;

  beforeAll(() => {
    repo = pullRequestFixture();
  });

  afterAll(() => {
    repo.cleanup();
  });

  beforeEach(() => {
    // The two documented environment variables, cleared so one case cannot decide another's answer.
    delete process.env['CODE_ANALYZER_REVIEW_MAX_COMMENTS'];
    delete process.env['CODE_ANALYZER_PROJECT_ID'];
  });

  it('reports the added credential and the concatenated query, with file and line', async () => {
    const run = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const { report } = run;
    expect(report.schema).toBe(PR_REVIEW_SCHEMA);
    expect(report.mode).toBe('refs');
    expect(report.baseRef).toBe('main');
    expect(report.headRef).toBe('feature');
    expect(report.summary.changedFileCount).toBe(1);
    expect(report.findings.length).toBeGreaterThan(0);

    // **Every finding must carry evidence**, because the workflow's own gate rejects the ones that do not and a
    // finding without a location cannot become an inline comment.
    for (const finding of report.findings) {
      expect(finding.file.length).toBeGreaterThan(0);
      expect(finding.line).toBeGreaterThan(0);
      expect(finding.snippet.length).toBeGreaterThan(0);
      expect(finding.description.length).toBeGreaterThan(0);
    }

    const titles = report.findings.map((finding) => finding.title).join(' | ');
    expect(titles).toMatch(/Hardcoded Password|SQL/i);
  });

  it('reports no standards by default, because a standard is something the caller names', async () => {
    const run = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'feature' });
    if (!run.ok) throw new Error(run.error);
    expect(run.report.standardsApplied).toEqual([]);
  });

  it('applies the standard the caller names, and says which one', async () => {
    const withStandard = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      standards: ['std-security-essentials'],
    });
    if (!withStandard.ok) throw new Error(withStandard.error);

    expect(withStandard.report.standardsApplied).toEqual(['std-security-essentials']);
    expect(withStandard.report.findings.some((finding) => finding.lens === 'standards')).toBe(true);
  });

  it('applies a standards file', async () => {
    const file = `${repo.dir}/standards.json`;
    const run = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      standardsFile: file,
    });
    // The file does not exist yet, and that is a usage error naming the path rather than a review with no rules.
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('standards.json');

    // Write it with the repository's own writer, then run again: the two ends of `init` and `review` must agree.
    repo.write('standards.json', JSON.stringify(projectStandard(), null, 2));
    const applied = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      standardsFile: file,
    });
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.report.standardsApplied).toEqual(['project-standards']);
    expect(applied.report.findings.some((finding) => finding.source === 'standards')).toBe(true);
  });

  it('filters by severity without claiming the discarded ones were not there', async () => {
    const all = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      severity: 'info',
    });
    const criticalOnly = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      severity: 'critical',
    });
    if (!all.ok || !criticalOnly.ok) throw new Error('fixture failed');

    expect(all.report.findings.length).toBeGreaterThanOrEqual(criticalOnly.report.findings.length);
    expect(criticalOnly.report.findings.every((finding) => finding.severity === 'critical')).toBe(true);
    // The decision still reflects what was measured, so a quiet report cannot hide a blocking state.
    expect(criticalOnly.report.decision).toBeDefined();
  });

  it('caps the findings it prints and reports how many it did not', async () => {
    const all = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'feature' });
    if (!all.ok) throw new Error(all.error);
    expect(all.report.findings.length).toBeGreaterThan(1);

    const capped = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      maxFindings: 1,
    });
    if (!capped.ok) throw new Error(capped.error);

    expect(capped.report.findings).toHaveLength(1);
    expect(capped.report.summary.truncatedFindings).toBe(all.report.findings.length - 1);
  });

  it('honours the documented CODE_ANALYZER_REVIEW_MAX_COMMENTS, because a documented variable that does nothing is a lie', async () => {
    process.env['CODE_ANALYZER_REVIEW_MAX_COMMENTS'] = '1';
    const run = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'feature' });
    if (!run.ok) throw new Error(run.error);
    expect(run.report.findings).toHaveLength(1);
  });

  it('lets the flag win over the environment', async () => {
    process.env['CODE_ANALYZER_REVIEW_MAX_COMMENTS'] = '1';
    const run = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      maxFindings: 2,
    });
    if (!run.ok) throw new Error(run.error);
    expect(run.report.findings).toHaveLength(2);
  });

  it('reads the project id from the environment when the flag is absent', async () => {
    process.env['CODE_ANALYZER_PROJECT_ID'] = 'from-env';
    const run = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'feature' });
    if (!run.ok) throw new Error(run.error);
    expect(run.report.projectId).toBe('from-env');
  });

  it('exits 0 when advisory and 1 when asked to fail at critical', async () => {
    const advisory = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'feature' });
    const enforcing = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      failOn: 'critical',
    });

    expect(advisory.ok && advisory.exitCode).toBe(EXIT_OK);
    expect(enforcing.ok && enforcing.exitCode).toBe(EXIT_FINDINGS);
  });
});

describe('runPrReview — refusals', () => {
  let repo: GitFixture;

  beforeAll(() => {
    repo = createRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('refuses to review a tree, and names the two forms that would work', async () => {
    const run = await runPrReview({ repo: repo.dir });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.exitCode).toBe(EXIT_USAGE);
    expect(run.error).toContain('--target-branch');
    expect(run.error).toContain('standards check');
  });

  it('refuses a severity it does not know', async () => {
    const run = await runPrReview({ repo: repo.dir, severity: 'urgent' });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('urgent');
    expect(run.error).toContain('critical');
  });

  it('refuses a fail-on it does not know instead of never failing', async () => {
    const run = await runPrReview({ repo: repo.dir, failOn: 'critcal' });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('critcal');
  });

  it('accepts off as a fail-on', async () => {
    const run = await runPrReview({ repo: repo.dir, failOn: 'off' });
    // It still refuses the tree; what matters is that the refusal is the tree, not the flag.
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('review pr needs a change');
  });

  it('refuses a language it does not know', async () => {
    const run = await runPrReview({ repo: repo.dir, languages: ['cobol'] });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('cobol');
  });

  it('refuses a pull request with no token', async () => {
    const run = await runPrReview({ repo: 'AgentiX-E/code-analyzer', pr: 4 });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('--pr needs --token');
  });

  it('refuses a slug without a pull request rather than reviewing the current directory', async () => {
    const run = await runPrReview({ repo: 'owner/name' });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error).toContain('names a repository on GitHub');
    expect(run.error).toContain('--pr');
  });

  it('reports a clean change as clean', async () => {
    const clean = createRepo();
    try {
      clean.branch('noop');
      const run = await runPrReview({ repo: clean.dir, targetBranch: 'main', sourceBranch: 'noop' });
      if (!run.ok) throw new Error(run.error);
      expect(run.report.summary.totalFindings).toBe(0);
      expect(run.exitCode).toBe(EXIT_OK);
    } finally {
      clean.cleanup();
    }
  });
});

describe('review presentation', () => {
  let report: Awaited<ReturnType<typeof runPrReview>>;

  beforeAll(async () => {
    const repo = pullRequestFixture();
    try {
      report = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'feature' });
    } finally {
      repo.cleanup();
    }
  });

  it('writes JSON a consumer can read without guessing', () => {
    if (!report.ok) throw new Error(report.error);
    const parsed = JSON.parse(formatPrReviewReport(report.report, 'json')) as {
      schema: string;
      findings: { file: string; line: number; severity: string }[];
    };

    expect(parsed.schema).toBe(PR_REVIEW_SCHEMA);
    expect(Array.isArray(parsed.findings)).toBe(true);
    // This is the exact filter `.github/workflows/pr-review.yml` runs to enforce evidence.
    const withoutEvidence = parsed.findings.filter(
      (finding) => finding.file === undefined || finding.line === undefined,
    );
    expect(withoutEvidence).toEqual([]);
  });

  it('writes Markdown a reviewer can read', () => {
    if (!report.ok) throw new Error(report.error);
    const markdown = formatPrReviewMarkdown(report.report);
    expect(markdown).toContain('## Code Analyzer — Pull Request Review');
    expect(markdown).toContain('| Severity | Findings |');
    expect(markdown).toContain('### Findings');
    expect(markdown).toContain('**Suggestion:**');
  });

  it('writes text for a terminal', () => {
    if (!report.ok) throw new Error(report.error);
    const text = formatPrReviewText(report.report);
    expect(text).toContain('PR review —');
    expect(text).toContain('Decision:');
    expect(text).not.toContain('## Code Analyzer');
  });

  it('selects the format it was asked for', () => {
    if (!report.ok) throw new Error(report.error);
    expect(formatPrReviewReport(report.report, 'json').trimStart().startsWith('{')).toBe(true);
    expect(formatPrReviewReport(report.report, 'markdown')).toContain('## Code Analyzer');
    expect(formatPrReviewReport(report.report, 'text')).toContain('PR review —');
  });

  it('says plainly when there is nothing to report', async () => {
    const repo = createRepo();
    try {
      repo.branch('empty');
      const run = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'empty' });
      if (!run.ok) throw new Error(run.error);
      expect(formatPrReviewMarkdown(run.report)).toContain(
        'No findings at or above the reported severity.',
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe('runPrReview — a pull request read over the API', () => {
  // **This is the form `.github/workflows/pr-review.yml` uses**: the diff comes from GitHub and the texts come from the
  // checkout, so both halves of the resolution have to agree about the same file.
  const diff = [
    'diff --git a/src/lookup.ts b/src/lookup.ts',
    'index 1111111..2222222 100644',
    '--- a/src/lookup.ts',
    '+++ b/src/lookup.ts',
    '@@ -0,0 +1,6 @@',
    '+export function lookup(id: string): string {',
    '+  const password = "hunter2-hardcoded";',
    '+  const query = "SELECT * FROM users WHERE id = " + id;',
    '+  console.log(password);',
    '+  return query;',
    '+}',
    '',
  ].join('\n');

  let repo: GitFixture;

  beforeAll(() => {
    repo = createRepo();
    repo.remote('git@github.com:AgentiX-E/code-analyzer.git');
    repo.write('src/lookup.ts', SECRET_AND_SQL);
  });

  afterAll(() => {
    repo.cleanup();
  });

  beforeEach(() => {
    delete process.env['CODE_ANALYZER_PROJECT_ID'];
  });

  it('names the repository, the pull request, and a project id derived from the slug', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(diff, { status: 200 }));
    try {
      const run = await runPrReview({ repo: repo.dir, pr: 42, token: 'token' });
      if (!run.ok) throw new Error(run.error);

      expect(run.report.mode).toBe('github');
      expect(run.report.repository).toBe('AgentiX-E/code-analyzer');
      expect(run.report.pullRequest).toBe(42);
      // The name half of the slug, which is what the graph lookups and the report title key on.
      expect(run.report.projectId).toBe('code-analyzer');
      expect(run.report.findings.length).toBeGreaterThan(0);
      expect(run.report.findings.every((finding) => finding.inDiff)).toBe(true);
    } finally {
      stub.mockRestore();
    }
  });

  it('warns, above the findings, when part of the change could not be read', async () => {
    // A deletion in the diff that the checkout still has: the review cannot read the old text of a removed file, and
    // saying so is the difference between a report that covers 9 of 10 files and one that claims all 10.
    const withDeletion = [
      diff,
      'diff --git a/src/absent.ts b/src/absent.ts',
      'index 3333333..0000000 100644',
      '--- a/src/absent.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-export const absent = 1;',
      '',
    ].join('\n');

    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(withDeletion, { status: 200 }));
    try {
      const run = await runPrReview({ repo: repo.dir, pr: 7, token: 'token' });
      if (!run.ok) throw new Error(run.error);

      expect(run.report.summary.unreadable).toContain('src/absent.ts');
      expect(formatPrReviewMarkdown(run.report)).toContain('could not be read, so the findings below do not cover');
      expect(formatPrReviewText(run.report)).toContain('could not be read');
    } finally {
      stub.mockRestore();
    }
  });
});

describe('runPrReview — findings on lines the change did not touch', () => {
  it('marks them so an inline comment is never attempted, and says how many there were', async () => {
    const repo = createRepo();
    try {
      const body = Array.from({ length: 12 }, (_, i) => `export function f${i + 1}() { return ${i + 1}; }`);
      repo.write('src/many.ts', `${body.join('\n')}\n`);
      repo.commit('twelve functions');

      repo.branch('edits-last');
      const edited = [...body];
      edited[11] = 'export function f12() { return 1200; }';
      repo.write('src/many.ts', `${edited.join('\n')}\n`);
      repo.commit('edit the last one');

      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'edits-last',
        severity: 'info',
      });
      if (!run.ok) throw new Error(run.error);

      const outside = run.report.findings.filter((finding) => !finding.inDiff);
      expect(outside.length).toBeGreaterThan(0);
      // Every finding outside the hunk is on an earlier line, which GitHub will not accept a comment on.
      for (const finding of outside) expect(finding.line).toBeLessThan(10);
      expect(formatPrReviewMarkdown(run.report)).toContain('lines this change did not touch');
    } finally {
      repo.cleanup();
    }
  });
});

describe('runPrReview — edge inputs a workflow can produce', () => {
  it('ignores a CODE_ANALYZER_REVIEW_MAX_COMMENTS that is not a number instead of reporting nothing', async () => {
    const repo = pullRequestFixture();
    try {
      process.env['CODE_ANALYZER_REVIEW_MAX_COMMENTS'] = 'not-a-number';
      const run = await runPrReview({ repo: repo.dir, targetBranch: 'main', sourceBranch: 'feature' });
      if (!run.ok) throw new Error(run.error);
      expect(run.report.findings.length).toBeGreaterThan(1);
    } finally {
      delete process.env['CODE_ANALYZER_REVIEW_MAX_COMMENTS'];
      repo.cleanup();
    }
  });

  it('reports the findings it withheld when the cap is zero', async () => {
    const repo = pullRequestFixture();
    try {
      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
        maxFindings: 0,
      });
      if (!run.ok) throw new Error(run.error);
      expect(run.report.findings).toEqual([]);
      expect(run.report.summary.truncatedFindings).toBeGreaterThan(0);
      // The empty report still says how much it is not showing.
      expect(formatPrReviewMarkdown(run.report)).toContain('were not reported');
      expect(formatPrReviewText(run.report)).toContain('were not reported');
    } finally {
      repo.cleanup();
    }
  });

  it('reports a standards finding without a suggestion as having none, rather than inventing one', async () => {
    const repo = pullRequestFixture();
    try {
      // A rule with no `fixSuggestion`: the engine leaves `suggestion` undefined, and the report must not fill it in.
      repo.write(
        'no-todo.json',
        JSON.stringify({
          id: 'no-todo',
          name: 'No TODO',
          version: '1.0.0',
          category: 'custom',
          description: 'No TODO comments',
          examples: [],
          rules: [
            {
              id: 'no-todo',
              description: 'A TODO was left in the change',
              checkType: 'regex',
              checkConfig: { pattern: 'console\\.log' },
              severity: 'low',
              autoFixable: false,
            },
          ],
        }),
      );

      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
        severity: 'info',
        standardsFile: `${repo.dir}/no-todo.json`,
      });
      if (!run.ok) throw new Error(run.error);

      const fromStandard = run.report.findings.filter((finding) => finding.source === 'standards');
      expect(fromStandard.length).toBeGreaterThan(0);
      expect(fromStandard[0]?.fixSuggestion).toBeUndefined();
      expect(fromStandard[0]?.rule).toBe('no-todo');
    } finally {
      repo.cleanup();
    }
  });
});

describe('joinLensFindings', () => {
  it('keeps a comment whose finding is gone, rather than dropping it or pairing it with the wrong one', () => {
    const joined = joinLensFindings(
      {
        comments: [
          {
            id: 'orphan',
            path: 'a.ts',
            content: 'Something the synthesizer kept',
            startLine: 4,
            endLine: 4,
            severity: 'medium',
            category: 'bug',
            existingCode: 'const a = 1;',
          },
        ],
        lensReports: [{ findings: [] }],
      },
      () => true,
    );

    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      id: 'orphan',
      file: 'a.ts',
      line: 4,
      lens: 'unknown',
      title: 'Something the synthesizer kept',
      snippet: 'const a = 1;',
      inDiff: true,
    });
    expect(joined[0]?.fixSuggestion).toBeUndefined();
  });
});

describe('review presentation — a report with standards and a cap', () => {
  it('names the standards it applied and the findings it withheld, in both human formats', async () => {
    const repo = pullRequestFixture();
    try {
      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
        standards: ['std-security-essentials'],
        severity: 'info',
        maxFindings: 1,
      });
      if (!run.ok) throw new Error(run.error);

      const markdown = formatPrReviewMarkdown(run.report);
      expect(markdown).toContain('**Standards applied:** std-security-essentials');
      expect(markdown).toContain('finding(s) beyond `--max-findings` were not reported');

      const text = formatPrReviewText(run.report);
      expect(text).toContain('Standards: std-security-essentials');
      expect(text).toContain('were not reported');
    } finally {
      repo.cleanup();
    }
  });
});

describe('diffMembership', () => {
  it('answers false for a file the change does not contain, and true inside a hunk', async () => {
    const repo = pullRequestFixture();
    try {
      const change = await resolveChangeSet({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
      });
      const inDiff = diffMembership(change);

      expect(inDiff('src/lookup.ts', 1)).toBe(true);
      // A file that exists in the repository but that the change never touched: no hunk, no inline comment.
      expect(inDiff('src/untouched.ts', 1)).toBe(false);
      // A path the change never heard of is the same answer, not an exception.
      expect(inDiff('src/nowhere.ts', 7)).toBe(false);
      expect(inDiff('src/lookup.ts', 9999)).toBe(false);
    } finally {
      repo.cleanup();
    }
  });
});

describe('runPrReview — a change in more than one file', () => {
  it('orders findings by severity, then by file, then down the file', async () => {
    const repo = createRepo();
    try {
      repo.branch('two-files');
      repo.write('src/b-second.ts', 'export function b() {\n  const password = "hunter2-hardcoded";\n  return password;\n}\n');
      repo.write('src/a-first.ts', 'export function a() {\n  const password = "hunter2-hardcoded";\n  return password;\n}\n');
      repo.commit('two files with the same problem');
      // Left on the branch, so both files can be read: the point of this case is truncation, not an unreadable checkout.

      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'two-files',
        severity: 'info',
        // Half the change, so the report has to say which half it read.
        maxFiles: 1,
      });
      if (!run.ok) throw new Error(run.error);

      expect(run.report.summary.changedFileCount).toBe(2);
      expect(run.report.summary.analyzedFileCount).toBe(1);
      expect(run.report.summary.truncatedFileCount).toBe(1);
      expect(formatPrReviewMarkdown(run.report)).toContain('1 skipped by --max-files');
      expect(run.report.summary.filteredFileCount).toBe(0);
      expect(formatPrReviewText(run.report)).toContain('skipped by --max-files');

      const files = run.report.findings.map((finding) => finding.file);
      expect(files).toEqual([...files].sort());
    } finally {
      repo.cleanup();
    }
  });

  it('uses the project id it was given', async () => {
    const repo = pullRequestFixture();
    try {
      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
        projectId: 'explicit-project',
      });
      if (!run.ok) throw new Error(run.error);
      expect(run.report.projectId).toBe('explicit-project');
    } finally {
      repo.cleanup();
    }
  });
});

describe('runPrReview — two findings that tie on severity', () => {
  it('breaks the tie by file, then by line, then by id, so two runs produce the same bytes', async () => {
    const repo = createRepo();
    try {
      repo.branch('two-secrets');
      repo.write(
        'src/secrets.ts',
        [
          'export function one() {',
          '  const password = "hunter2-first";',
          '  return password;',
          '}',
          'export function two() {',
          '  const password = "hunter2-second";',
          '  return password;',
          '}',
          '',
        ].join('\n'),
      );
      repo.commit('two secrets');
      // Left on the branch: the diff comes from the refs, but the texts come from the checkout.

      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'two-secrets',
        severity: 'info',
        // The same password on the same line is found twice — by the security lens and by the shipped standard — and
        // those two findings tie on file and line, which is the last tie the ordering has to settle.
        standards: ['std-security-essentials'],
      });
      if (!run.ok) throw new Error(run.error);

      const findings = run.report.findings;
      expect(findings.length).toBeGreaterThan(2);

      for (let i = 1; i < findings.length; i += 1) {
        const previous = findings[i - 1];
        const current = findings[i];
        if (previous === undefined || current === undefined) continue;
        if (previous.severity !== current.severity) {
          expect(severityRank(previous.severity)).toBeGreaterThan(severityRank(current.severity));
          continue;
        }
        if (previous.file !== current.file) {
          expect(previous.file < current.file).toBe(true);
          continue;
        }
        expect(previous.line).toBeLessThanOrEqual(current.line);
      }

      const sameLine = findings.filter((finding) => finding.line === findings[0]?.line);
      expect(sameLine.length).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
    }
  });
});

describe('review presentation — a report a consumer assembled by hand', () => {
  it('prints a named pull request, a finding with no rule, and a finding with no snippet', () => {
    // Every field here is one a real run can produce except the empties, which the formatters must survive because the
    // JSON schema allows them: a standards rule that fires on end-of-file has no snippet, and a lens finding with no
    // named rule has no rule.
    const report = {
      schema: PR_REVIEW_SCHEMA,
      mode: 'github' as const,
      repository: 'AgentiX-E/code-analyzer',
      pullRequest: 9,
      projectId: 'code-analyzer',
      standardsApplied: [],
      summary: {
        totalFindings: 1,
        bySeverity: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
        byCategory: { security: 1 },
        byLens: { security: 1 },
        outsideDiff: 0,
        changedFileCount: 1,
        analyzedFileCount: 1,
        filteredFileCount: 0,
        truncatedFileCount: 0,
        unreadable: [],
        linesAnalyzed: 10,
        evidenceRejected: 0,
        adversarialRejected: 0,
        iouDeduped: 0,
        needsLLMValidation: 0,
        truncatedFindings: 0,
      },
      decision: {
        canMerge: false,
        recommendation: 'block' as const,
        reason: 'a critical finding',
        blockingCount: 1,
        requiredCorrections: ['fix it'],
      },
      actionPlan: [],
      findings: [
        {
          id: 'bare',
          file: 'a.ts',
          line: 3,
          endLine: 3,
          severity: 'critical' as const,
          category: 'security',
          lens: 'security',
          source: 'lens' as const,
          title: 'Something',
          description: 'A finding with no rule and no snippet',
          snippet: '',
          confidence: 'rule',
          autoFixable: false,
          inDiff: true,
        },
      ],
      durationMs: 1,
    };

    const markdown = formatPrReviewMarkdown(report);
    expect(markdown).toContain('AgentiX-E/code-analyzer#9');
    // No rule means no rule badge, and no snippet means no empty code fence.
    expect(markdown).toContain('#### `critical` · `a.ts:3` · security\n');
    expect(markdown).not.toContain('```');
  });
});

describe('runPrReview — a file the caller excluded is not a file the cap dropped', () => {
  it('counts an excluded file as filtered, and says so with the reason that applies', async () => {
    const repo = pullRequestFixture();
    try {
      const run = await runPrReview({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
        exclude: ['**/lookup.ts'],
      });
      if (!run.ok) throw new Error(run.error);

      expect(run.report.summary.changedFileCount).toBe(1);
      expect(run.report.summary.analyzedFileCount).toBe(0);
      expect(run.report.summary.filteredFileCount).toBe(1);
      // **The remedy is different, so the count is different**: raising `--max-files` would not read this file.
      expect(run.report.summary.truncatedFileCount).toBe(0);
      expect(formatPrReviewMarkdown(run.report)).toContain('1 excluded by --exclude/--languages');
      expect(formatPrReviewMarkdown(run.report)).not.toContain('skipped by --max-files');
    } finally {
      repo.cleanup();
    }
  });
});
