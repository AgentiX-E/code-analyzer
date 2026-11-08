// The report's Long Code Arena figures are rendered from the artifact, and these cases are about the two ways that can
// stop being true.
//
// **A generator that nobody checks is a generator that gets bypassed.** The first failure is drift: someone edits a
// number in the block, or the artifact is re-merged and the block is not rewritten, and the report again quotes a run
// that is not the run. `--check` has to catch that, and it has to say which line. The second failure is silence: the
// markers removed, the script run, and the block printed to a terminal that nobody reads. A missing block is a failure,
// because the alternative is a section that looks generated and is not.
//
// **What these cases do not do is compare a number with a number.** The rendering is one statement about the whole
// block, and the case that matters is the diff between the report and what the artifact would write.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/lca-report.js');
const REPORT = join(process.cwd(), 'docs/BENCHMARK_REPORT.md');
const ARTIFACT = join(process.cwd(), 'benchmarks/lca-bug-localization.json');

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(script: string, cwd: string, args: readonly string[] = []): Run {
  try {
    const stdout = execFileSync('node', [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** A tree with the report and the artifact, and **the script copied in**, so `cwd` decides which files it reads. */
function tree(report: string, artifact: unknown): { dir: string; script: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lca-report-'));
  writeFileSync(join(dir, 'report.md'), report);
  writeFileSync(join(dir, 'artifact.json'), JSON.stringify(artifact));
  const script = join(dir, 'lca-report.js');
  // The script's paths are relative to the repository, which is what a workflow invokes it from; this harness rewrites
  // them to the temporary tree rather than passing flags that exist only for tests.
  writeFileSync(
    script,
    readFileSync(SCRIPT, 'utf8')
      .replace("require('node:fs')", "require('node:fs')")
      .replace(
        "const ARTIFACT = 'benchmarks/lca-bug-localization.json';",
        "const ARTIFACT = 'artifact.json';",
      )
      .replace("const REPORT = 'docs/BENCHMARK_REPORT.md';", "const REPORT = 'report.md';"),
  );
  return { dir, script };
}

const BEGIN = '<!-- lca:figures:begin';

describe('lca report — the four tables a reader quotes', () => {
  it('**renders the committed artifact without needing a network or a corpus**', () => {
    // The committed block has to be reproducible from the committed artifact alone, because that is the only pair CI has.
    const runOfScript = run(join(process.cwd(), 'scripts/lca-report.js'), process.cwd());
    expect(runOfScript.status).toBe(0);
    expect(runOfScript.stdout).toContain('### Three denominators');
    expect(runOfScript.stdout).toContain('| BM25 |');
    expect(runOfScript.stdout).toContain('### The run in two lines');
  });

  it('**passes when the report holds exactly what the artifact would write**', () => {
    const rendered = execFileSync('node', [SCRIPT], { encoding: 'utf8' }).trimEnd();
    const { dir, script } = tree(
      `# report\n\n${rendered}\n\ntrailing prose\n`,
      JSON.parse(readFileSync(ARTIFACT, 'utf8')),
    );
    const checked = run(script, dir, ['--check']);
    expect(checked.stderr).toBe('');
    expect(checked.status).toBe(0);
  });

  it('**refuses a block that a hand has edited, and names the line that differs**', () => {
    // This is the whole point: 0.4746 typed as 0.4750 in a report is a figure from a run that does not exist.
    const rendered = execFileSync('node', [SCRIPT], { encoding: 'utf8' }).trimEnd();
    const edited = rendered.replace('**0.4746**', '**0.4750**');
    expect(edited).not.toEqual(rendered);
    const { dir, script } = tree(
      `# report\n\n${edited}\n`,
      JSON.parse(readFileSync(ARTIFACT, 'utf8')),
    );
    const checked = run(script, dir, ['--check']);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain('disagree at line');
    expect(checked.stderr).toContain('lca-report.js --write');
  });

  it('**refuses a report with no block at all, rather than printing one to a terminal**', () => {
    const { dir, script } = tree(
      '# report\n\nThe figures are typed by hand.\n',
      JSON.parse(readFileSync(ARTIFACT, 'utf8')),
    );
    const checked = run(script, dir, ['--check']);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain('no `<!-- lca:figures:begin');
  });

  it('**writes the block where the markers are, and leaves the prose around it alone**', () => {
    const rendered = execFileSync('node', [SCRIPT], { encoding: 'utf8' }).trimEnd();
    const { dir, script } = tree(
      `before\n\n${BEGIN} -->\nstale\n<!-- lca:figures:end -->\n\nafter\n`,
      JSON.parse(readFileSync(ARTIFACT, 'utf8')),
    );
    const written = run(script, dir, ['--write']);
    expect(written.status).toBe(0);
    const text = readFileSync(join(dir, 'report.md'), 'utf8');
    expect(text.startsWith('before\n\n')).toBe(true);
    expect(text.includes('stale')).toBe(false);
    expect(text.trimEnd().endsWith('after')).toBe(true);
    expect(text).toContain(rendered.split('\n')[0]);
  });

  it('**refuses to write into a report whose markers are missing**', () => {
    const { dir, script } = tree('# report\n', JSON.parse(readFileSync(ARTIFACT, 'utf8')));
    const written = run(script, dir, ['--write']);
    expect(written.status).toBe(1);
    expect(written.stderr).toContain('has no');
  });

  it('**prints an em dash where the artifact publishes nothing, never a zero**', () => {
    // A zero is a measurement and an absence is not. The corpus publishes an answer arm only when a provider is present,
    // so the block has to be readable on a run where it is not.
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as Record<string, unknown>;
    const withoutAnswer = { ...artifact };
    delete withoutAnswer['overall'];
    const { dir } = tree('# report\n', withoutAnswer);
    const script = join(dir, 'lca-report.js');
    const printed = run(script, dir);
    expect(printed.status).toBe(0);
    expect(printed.stdout).toContain('| **—** |');
    expect(printed.stdout).not.toContain('NaN');
  });

  it('**is wired into the repository it renders, not only into a temporary tree**', () => {
    // The check is only worth having where the report lives: a `--check` that no workflow runs is a comment.
    const checked = run(SCRIPT, process.cwd(), ['--check']);
    expect(checked.stderr).toBe('');
    expect(checked.status).toBe(0);
    expect(readFileSync(REPORT, 'utf8')).toContain(BEGIN);
  });
});
