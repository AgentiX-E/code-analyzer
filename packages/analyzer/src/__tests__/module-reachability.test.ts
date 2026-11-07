// @code-analyzer/analyzer — every module is reachable from the package's own entry
//
// **A module nothing imports is a module nothing can disagree with.** `pipeline/parallel-phases.ts` carried a copy of
// the language table — 18 languages, against the 32 the pipeline loads — and it went stale for as long as it did
// because its only readers were two test files. Every orphan below has the same shape: green tests, real assertions,
// and no caller. This suite is the instrument that says so out loud, and the list is the plan.
//
// The rule: a non-test module under `src/` must be reachable from `src/index.ts` by following the imports the compiler
// follows — static `import`/`export … from`, and `import('…')` with a literal specifier, because a backend loaded
// through a dynamic import is loaded. Redirects the package does not reach are listed in `UNREACHABLE` with what they
// are, so removing one is a deletion in this file and not a discovery by a reader.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * **The modules the entry does not reach, with what each of them is.**
 *
 * Ten entries, and every one is a candidate for deletion rather than a capability: six files of a control-flow
 * subsystem whose live counterpart is `@code-analyzer/intelligence`'s `cfg/` (that one builds the PDG, that one is
 * imported by `pdg-builder`, and this one is imported by nothing), two superseded type resolvers whose `-advanced`
 * successors are the ones `phases/type-resolution.ts` loads, a barrel nothing imports, and the parallel phase classes
 * — the module whose stale table started this. **The number may only go down**: a file that gains a caller leaves the
 * list, and a file added here needs a sentence saying why it exists at all.
 */
const UNREACHABLE: Readonly<Record<string, string>> = {
  'cfg/cfg-builder.ts':
    'dead: a second CFG builder; the live one is intelligence/cfg/from-parsed-files.ts',
  'cfg/cfg-types.ts': 'dead: the types of the second CFG builder',
  'cfg/dataflow.ts':
    'dead: reaching definitions over the second CFG; intelligence/cfg/reaching-defs.ts is live',
  'cfg/dominators.ts':
    'dead: dominators over the second CFG; intelligence/cfg/post-dominators.ts is live',
  'cfg/index.ts': 'dead: the barrel of the second CFG package',
  'cfg/set-utils.ts': 'dead: set helpers used only by the second CFG builder',
  'pipeline/index.ts': 'dead: a barrel nothing imports; the package barrel is src/index.ts',
  'pipeline/parallel-phases.ts':
    'dead: parallel phase classes with no production caller; its language table now re-exports the live one',
  'resolution/python-resolver.ts': 'dead: superseded by resolution/python-resolver-advanced.ts',
  'resolution/typescript-resolver.ts':
    'dead: superseded by resolution/typescript-resolver-advanced.ts',
};

/** Every non-test module the package compiles, as paths relative to `src/`. */
function modulesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        // A test may import any module it likes; the question here is what the *product* reaches.
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(path);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        found.push(normalize(relative(root, path)));
      }
    }
  };
  walk(root);
  return found;
}

/**
 * The relative specifiers a module names, in every form the compiler resolves.
 *
 * **`import('…')` counts.** `phases/embed.ts` loads the API embedding backend that way — `await import('./embed-api.js')`
 * when the ONNX model is unavailable — and a graph that ignored the form would report a live backend as dead. A
 * specifier built from a variable is not resolved by the compiler either, so it is not resolved here.
 */
function specifiersOf(source: string): string[] {
  const pattern = /(?:from\s*|import\s*\(\s*|import\s+)['"](\.[^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => match[1]!.replace(/\.js$/, '.ts'));
}

/** The modules reachable from the package entry, by the same rule the bundler uses for relative imports. */
function reachableFromEntry(root: string, modules: readonly string[]): Set<string> {
  const known = new Set(modules);
  const reached = new Set<string>();
  const queue = ['index.ts'];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reached.has(current)) continue;
    reached.add(current);
    const source = readFileSync(join(root, current), 'utf8');
    for (const specifier of specifiersOf(source)) {
      const target = normalize(join(dirname(current), specifier));
      if (known.has(target) && !reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

const MODULES = modulesUnder(SRC);
const REACHED = reachableFromEntry(SRC, MODULES);
const ORPHANS = MODULES.filter((module) => !REACHED.has(module)).sort();

describe('every module the analyzer package compiles is reachable from its entry', () => {
  it('the entry itself is reachable, which is what makes the walk a walk', () => {
    expect(MODULES).toContain('index.ts');
    expect(REACHED.has('index.ts')).toBe(true);
    expect(MODULES.length).toBeGreaterThan(50);
  });

  /**
   * **The list is the measurement.** A module added without a caller, or a caller removed from a module already here,
   * changes this array and fails — which is the only moment anyone is in a position to decide whether that is a
   * capability being built or a file being left behind.
   */
  it('the unreachable modules are exactly the ones named here', () => {
    expect(ORPHANS).toEqual(Object.keys(UNREACHABLE).sort());
  });

  it('every unreachable module says what it is', () => {
    const unexplained = Object.entries(UNREACHABLE)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([module]) => module);
    expect(unexplained, 'modules listed without a reason').toEqual([]);
  });

  /**
   * **A file that gains a caller must leave the list**, and this is the assertion that notices: a stale entry would
   * otherwise sit here claiming a live module is dead, which is the same defect in the other direction.
   */
  it('no module named here is in fact reachable', () => {
    const stale = Object.keys(UNREACHABLE).filter((module) => REACHED.has(module));
    expect(stale, 'modules listed as unreachable that the entry reaches').toEqual([]);
  });

  /**
   * **Ten is a count, not a budget.** Nothing here may grow: the assertions above force a new orphan to be listed, and
   * this one forces the list to be emptied rather than maintained.
   */
  it('the package does not grow another one', () => {
    expect(ORPHANS.length).toBeLessThanOrEqual(10);
  });
});
