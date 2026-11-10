// Every script in this repository parses — because the gates that watch scripts never read one.
//
// **The defect this exists for.** Iteration 113 added a `tag` to a `completeWithTools` call in
// `scripts/agentic-permissions.ts` and left the call it belonged to unclosed. The file stopped parsing. **Every gate
// this repository owns stayed green**: `gate:wiring` asks whether a script is named by something that runs, the
// coverage gate measures `packages/*/src`, `tsconfig.tests.json` does not include `scripts/`, and the script is run by
// a benchmark workflow that nobody had dispatched. **CodeQL found it — six `js/syntax-error` alerts on the default
// branch, after the push.**
//
// **So the check is the smallest one that would have caught it**: read every script, parse it, assert no diagnostic.
// It costs milliseconds, it runs in the unit suite, and it answers the question the other gates only appear to answer.
//
// **It reads the parse, not the type.** A type error in a script is the `typecheck` job's business and a lint error is
// `lint`'s; what this holds is that the file is a syntactically valid program, **which is the one property whose absence
// makes every other check about that file meaningless.**

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// `tests/unit/scripts` → the repository root.
const ROOT = join(import.meta.dirname, '..', '..', '..');

/** The directories whose contents are executed by workflows rather than compiled by a package. */
const SCRIPT_DIRECTORIES = ['scripts', join('.github', 'scripts')];

/** Every `.ts`, `.mts`, `.mjs` and `.cjs` file under one directory, recursively. */
function scriptFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(?:ts|mts|mjs|cjs)$/.test(entry) && !entry.endsWith('.d.ts')) found.push(path);
    }
  };
  walk(join(ROOT, directory));
  return found;
}

/**
 * **`parseDiagnostics` is real at run time and absent from the public type**, because TypeScript keeps it on
 * `SourceFile` for its own use. A cast names that once, with the reason, instead of a `@ts-expect-error` that would
 * hide a genuine break when the field moves.
 */
function parseDiagnostics(file: ts.SourceFile): ts.Diagnostic[] {
  return (file as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
}

/** TypeScript's own parser, told which grammar to read the file with. */
function parseDiagnosticsOf(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const kind = path.endsWith('.ts') || path.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, kind);
  return parseDiagnostics(file).map((diagnostic) => {
    const position = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${relative(ROOT, path)}:${position.line + 1}:${position.character + 1} ${ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      ' ',
    )}`;
  });
}

describe('every script this repository runs is a valid program', () => {
  const files = SCRIPT_DIRECTORIES.flatMap((directory) => scriptFiles(directory));

  it('finds the scripts it is supposed to be reading', () => {
    // **A walk that silently finds nothing passes every assertion below**, which is the failure mode this repository has
    // a rule about: a check that cannot fail is not a check.
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((file) => file.endsWith('agentic-permissions.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('aacr-bench.mjs'))).toBe(true);
  });

  it('parses all of them without a diagnostic', () => {
    const failures = files.flatMap((file) => parseDiagnosticsOf(file));
    expect(failures).toEqual([]);
  });

  it('reports a diagnostic when a file really is broken, so the check above cannot be vacuous', () => {
    // The control: the parser this test relies on must reject the exact shape that shipped — a call whose closing
    // `});` was replaced by the next statement.
    const broken = join(ROOT, 'scripts', '__parse-control__.ts');
    const source = 'const a = f({\n  tag: 1,\nconst b = 2;\n';
    const file = ts.createSourceFile(
      broken,
      source,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    expect(parseDiagnostics(file).length).toBeGreaterThan(0);
  });
});
