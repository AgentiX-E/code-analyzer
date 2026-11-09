// The documented-invocation gate — the reader that decides what a document is promising.
//
// The gate exists because nine files told a reader to run three commands that did not exist. Its value is entirely in
// the judgement it makes about a piece of text: is this a command a reader can copy, or is it a sentence with the
// product's name in it? Those decisions are tested here, because a gate whose reader is wrong is worse than no gate —
// it fails the documents that describe the product best, and the first thing anyone does with a gate like that is turn
// it off.

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const gate = require('../../../scripts/docs-cli-gate.js') as {
  codeRegions(text: string, file: string): { line: number; text: string }[];
  invocations(text: string, file: string): { line: number; verb: string; rest: string }[];
  resolve(
    describe: (chain: string[]) => { commands: Set<string>; options: Set<string> },
    verb: string,
    rest: string,
  ): { chain: string[]; unknown: string };
  flagsOf(
    describe: (chain: string[]) => { commands: Set<string>; options: Set<string> },
    chain: string[],
    rest: string,
  ): string[];
};

/** A command tree built by hand, so these tests do not depend on the CLI having been built. */
const tree = (nodes: Record<string, { commands?: string[]; options?: string[] }>) => {
  return (chain: string[]) => {
    const node = nodes[chain.join(' ')] ?? {};
    return { commands: new Set(node.commands ?? []), options: new Set(node.options ?? []) };
  };
};

const ROOT_TREE = tree({
  '': { commands: ['analyze', 'review', 'standards'], options: ['--version'] },
  analyze: { options: ['--format', '--output'] },
  review: { commands: ['pr'], options: ['--severity'] },
  'review pr': { options: ['--repo', '--pr', '--summary'] },
  standards: { commands: ['check'], options: [] },
  'standards check': { options: ['--repo', '--standard'] },
});

describe('codeRegions — what a reader would copy', () => {
  it('takes the inside of a fenced block', () => {
    const regions = gate.codeRegions('text\n```bash\ncode-analyzer status\n```\n', 'a.md');
    expect(regions.map((region) => region.text)).toEqual(['code-analyzer status']);
    // The line number is the document's, not the region's: a report that points at the wrong line wastes the reader's
    // first minute.
    expect(regions[0]?.line).toBe(3);
    expect(regions[0]?.text).toBe('code-analyzer status');
  });

  it('takes the inside of an inline code span, and nothing around it', () => {
    const regions = gate.codeRegions('Run `code-analyzer status` first.\n', 'a.md');
    expect(regions.map((region) => region.text)).toEqual(['code-analyzer status']);
  });

  it('ignores prose that names the product', () => {
    // The three sentences that produced the gate's first false positives, verbatim.
    const text = [
      'Use the code-analyzer to find all REST API routes in this project',
      'It is safe to configure multiple agents to use code-analyzer simultaneously.',
      'comprehensive competitor analysis and deep audit of the code-analyzer codebase',
    ].join('\n');
    expect(gate.codeRegions(text, 'a.md')).toEqual([]);
  });

  it('reads a whole line of a workflow, where there are no backticks', () => {
    const regions = gate.codeRegions('run: code-analyzer status\n', 'ci.yml');
    // The YAML key is dropped: it is not part of the invocation, and leaving it in would hide every workflow command.
    expect(regions.map((region) => region.text)).toEqual(['code-analyzer status']);
    expect(gate.codeRegions('\n\n', 'ci.yml')).toEqual([]);
  });

  it('skips the line that says the command does not exist', () => {
    // A gate that cannot read a negation fails the paragraph that documents the defect it was built for.
    const text = '`code-analyzer group create` is not a command\n';
    expect(gate.codeRegions(text, 'a.md')).toEqual([]);
    expect(
      gate.codeRegions('no such command has ever existed: `code-analyzer group`', 'a.md'),
    ).toEqual([]);
    expect(gate.codeRegions('`code-analyzer logs` was removed; does not exist', 'a.md')).toEqual(
      [],
    );
  });
});

describe('invocations — command position', () => {
  it('finds a plain invocation', () => {
    expect(gate.invocations('```\ncode-analyzer status\n```', 'a.md')).toEqual([
      { file: 'a.md', line: 2, verb: 'status', rest: '' },
    ]);
  });

  it('finds one behind a prompt, a bullet, or npx', () => {
    for (const line of [
      '$ code-analyzer status',
      '- code-analyzer status',
      'npx @code-analyzer/cli status',
      'npx -y @code-analyzer/cli status',
      'pnpm exec code-analyzer status',
    ]) {
      expect(gate.invocations(`\`${line}\``, 'a.md').map((found) => found.verb)).toEqual([
        'status',
      ]);
    }
  });

  it('does not find one where the name is an argument to something else', () => {
    // These four are why the gate requires command position rather than a word boundary.
    for (const line of [
      'kubectl -n code-analyzer create secret generic x',
      'docker exec code-analyzer node --version',
      'pnpm --filter code-analyzer build',
      'chore: initialize code-analyzer repository',
    ]) {
      expect(gate.invocations(`\`${line}\``, 'a.md')).toEqual([]);
    }
  });

  it('reads the command behind a workflow key', () => {
    // `run: code-analyzer status` is what a workflow looks like, and the key is not part of the invocation.
    expect(gate.invocations('      run: code-analyzer status', 'ci.yml')).toEqual([
      { file: 'ci.yml', line: 1, verb: 'status', rest: '' },
    ]);
  });
});

describe('resolve — a second word is a subcommand only if it is one', () => {
  it('descends into a subcommand', () => {
    expect(gate.resolve(ROOT_TREE, 'review', ' pr --repo a/b')).toEqual({
      chain: ['review', 'pr'],
      unknown: '',
    });
    expect(gate.resolve(ROOT_TREE, 'standards', ' check --repo .').chain).toEqual([
      'standards',
      'check',
    ]);
  });

  it('treats a positional argument as an argument', () => {
    // `analyze ./project` and `review pr` are indistinguishable to a regular expression.
    expect(gate.resolve(ROOT_TREE, 'analyze', ' ./project').chain).toEqual(['analyze']);
  });

  it('reports a verb the CLI does not have', () => {
    expect(gate.resolve(ROOT_TREE, 'setup', ' --agent aider')).toEqual({
      chain: ['setup'],
      unknown: 'setup',
    });
  });
});

describe('flagsOf — the flags written beside an invocation', () => {
  it('accepts what the command has and reports what it does not', () => {
    expect(gate.flagsOf(ROOT_TREE, ['review', 'pr'], ' --repo a/b --pr 7 --summary s.md')).toEqual(
      [],
    );
    expect(gate.flagsOf(ROOT_TREE, ['review', 'pr'], ' --repo a/b --from-ref main')).toEqual([
      '--from-ref',
    ]);
    // `--help` is commander's, so it is never reported even though no command declares it.
    expect(gate.flagsOf(ROOT_TREE, ['analyze'], ' --help')).toEqual([]);
  });

  it('checks a subcommand against its own options, not its parent`s', () => {
    // `--severity` is `review`'s; `review pr` does not inherit it, and a gate that read the parent would say it does.
    expect(gate.flagsOf(ROOT_TREE, ['review', 'pr'], ' --severity high')).toEqual(['--severity']);
  });
});
