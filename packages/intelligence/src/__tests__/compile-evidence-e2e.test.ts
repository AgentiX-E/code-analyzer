// A typecheck, a diagnostic, a comment, and the gate - all four, on a project that exists.
//
// **The user story this closes**: *"tell me whether this branch typechecks, and if not, where"* - **which no rule in
// this product could answer before this pair of commits.** The unit tests cover each half; **this one runs the whole
// chain**, because **the failure mode this sequence keeps finding is not a wrong half but a missing join** - eight
// times so far.
//
// **And it runs a real `tsc`.** A test that stubbed the compiler would prove the parser and the converter agree with
// each other **about a compiler neither of them met**.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectCompileEvidence } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { compilerToComments } from '../review/compiler-comments.js';
import { judgeGrounding } from '../review/grounding-judge.js';

/** **A project with one type error in it**, built here so a reader can see every byte it is judged on. */
function makeProjectWithATypeError(): { root: string; source: string; filePath: string } {
  const root = mkdtempSync(join(tmpdir(), 'ca-e2e-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  // **The error is deliberate and typed**: a `string` assigned to a `number` annotation - **`TS2322`, the diagnostic
  // a reader is most likely to have seen.**
  const source = 'const count: number = "not a number";\nexport function f() {\n  return count;\n}\n';
  writeFileSync(join(root, 'src', 'a.ts'), source, 'utf8');
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler' }, include: ['src/**/*.ts'] }, null, 2),
    'utf8',
  );
  // **A package.json so the chooser picks a script rather than guessing**, which is the path a real repository takes.
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'e2e', devDependencies: { typescript: '*' }, scripts: { typecheck: 'tsc --noEmit' } }, null, 2),
    'utf8',
  );
  return { root, source, filePath: 'src/a.ts' };
}

describe('a typecheck, end to end', () => {
  it('turns a real compiler diagnostic into a comment the grounding judge accepts', () => {
    const project = makeProjectWithATypeError();
    try {
      // **The real compiler, through the real capability**, with a runner that is just `execFileSync` - **which is
      // the only thing this module ever asks for, and the reason it can be tested at all.**
      const runner = {
        run: async (command: string, args: string[], cwd: string) => {
          try {
            const stdout = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            return { stdout, exitCode: 0 };
          } catch (error) {
            const e = error as { stdout?: string; status?: number | null };
            return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 };
          }
        },
      };

      const packageJson = { devDependencies: { typescript: '*' }, scripts: { typecheck: 'tsc --noEmit' } };
      const evidence = collectCompileEvidence(project.root, runner, packageJson, 180_000);

      return evidence.then((result) => {
        // **The compiler ran**, so a skip here would be a failure of this test rather than a fact about the project.
        expect(result.skipped).toBeNull();
        expect(result.findings.length).toBeGreaterThan(0);

        const mismatch = result.findings.find((f) => f.code === 'TS2322');
        expect(mismatch).toBeDefined();
        expect(mismatch!.line).toBe(1);

        // **And the diagnostic becomes a comment**, quoted from the file the compiler named.
        const comments = compilerToComments(result.findings, (p) => (p === project.filePath ? project.source.split('\n') : null));
        expect(comments.length).toBe(result.findings.length);
        expect(comments[0]!.category).toBe('bug');

        // **And the gate accepts it**, which is the case the whole wiring exists for: **the one finding this product
        // does not produce by heuristic must still be verifiable.**
        const judged = judgeGrounding(comments, { contents: new Map([[project.filePath, project.source]]) });
        expect(judged.ungrounded).toEqual([]);
      });
    } finally {
      rmSync(project.root, { recursive: true, force: true });
    }
  }, 300_000);

  it('reports the skip rather than an empty success when the project has no compiler', async () => {
    // **The other half of the user story**: asked about a project it cannot check, **this says so** rather than
    // reporting a clean branch.
    const root = mkdtempSync(join(tmpdir(), 'ca-e2e-nocompiler-'));
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'plain', dependencies: { express: '^5' } }), 'utf8');
      const result = await collectCompileEvidence(root, { run: async () => ({ stdout: '', exitCode: 0 }) }, { dependencies: { express: '^5' } });
      expect(result.findings).toEqual([]);
      expect(result.skipped?.reason).toMatch(/no typecheck script/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
