// **A figure that subtracts one row set's score from another's is the most confident wrong number a chart can carry**,
// because the axes look shared and the caption says *the same key*.
//
// `docs/figures/aacr-same-corpus.svg` was published under the title *the one corpus where a competitor's findings and
// ours were scored against the same key*, and two of its three rows were **14 pull requests against 196 goldens** while
// the third was the competitor's own **47 pull requests against 436 goldens**. The key was shared and the rows were not,
// and the figure drew a dashed line between them labelled **"5.1 F1 of headroom"** - an arithmetic the gate in this
// change now refuses to perform.
//
// These tests hold four properties, and the fourth is the one that makes the other three worth anything:
//
// 1. **A row may declare the row set it was scored on**, and the declaration is integers rather than prose.
// 2. **A figure whose rows disagree has to declare a reason**, and a figure whose rows agree may not carry one. A stale
//    warning teaches readers to skip warnings.
// 3. **A half-scoped figure is refused**, because scoping the rows somebody remembered is worse than scoping none.
// 4. **The refusal reaches the picture**: the rendered figure prints the reason and **does not draw the gap**, so the
//    gate is a gate and not a caption beside a subtraction.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mixedScopeOf, scopeOf } from '../../../scripts/competitive-position.mjs';

const ROOT = resolve(__dirname, '../../..');

interface Scope {
  readonly pullRequests: number;
  readonly goldens: number;
}

interface Row {
  readonly tool: string;
  readonly scope?: Scope;
}

interface Figure {
  readonly id: string;
  readonly rows: readonly Row[];
  readonly mixedScope?: string;
}

const DATA: { readonly figures: readonly Figure[] } = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks/competitive-position.json'), 'utf8'),
);

const SAME_CORPUS = DATA.figures.find((figure) => figure.id === 'aacr-same-corpus');

let out: string;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'scope-figure-'));
  execFileSync('node', [join(ROOT, 'scripts/competitive-position.mjs'), '--out', out], {
    cwd: ROOT,
    stdio: 'pipe',
  });
});

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

function svg(id: string): string {
  return readFileSync(join(out, `${id}.svg`), 'utf8');
}

/** A figure whose rows all declare one scope, and which therefore may not carry a reason. */
function oneRowSet(): Figure {
  return {
    id: 'fixture-one-row-set',
    rows: [
      { tool: 'a', scope: { pullRequests: 14, goldens: 196 } },
      { tool: 'b', scope: { pullRequests: 14, goldens: 196 } },
    ],
  };
}

describe('the scope a row was scored on', () => {
  it('is rendered beside the score rather than in a legend', () => {
    // **The legend is where a caption goes to be skipped.** Every row in the committed figure carries its scope on the
    // line that carries its score, so the row set is read at the moment the number is.
    expect(SAME_CORPUS).toBeDefined();
    const rendered = svg('aacr-same-corpus');
    for (const row of SAME_CORPUS?.rows ?? []) {
      const scope = row.scope;
      expect(scope).toBeDefined();
      expect(rendered).toContain(
        `${String(scope?.pullRequests)} pr / ${String(scope?.goldens)} goldens`,
      );
    }
  });

  it('is integers, or it is refused', () => {
    // A scope written as prose is a scope nobody can compare, and a comparison is the only thing it is for.
    expect(() => scopeOf({ tool: 'x', scope: { pullRequests: 14 } as unknown as Scope })).toThrow(
      /without integer pullRequests and goldens/u,
    );
  });

  it('is null for a row that does not declare one', () => {
    expect(scopeOf({ tool: 'x' })).toBeNull();
  });
});

describe('a figure whose rows are not one row set', () => {
  it('has to say so, and the committed one does', () => {
    expect(SAME_CORPUS?.mixedScope).toEqual(expect.any(String));
    expect(mixedScopeOf(SAME_CORPUS as Figure)).toBe(SAME_CORPUS?.mixedScope);
  });

  it('prints the reason in the picture', () => {
    // The reason is checked as a substring of the first clause rather than the whole sentence: a renderer that wrapped
    // the text would otherwise fail a test about whether the text is there.
    const reason = (SAME_CORPUS?.mixedScope ?? '').slice(0, 40);
    expect(reason.length).toBeGreaterThan(0);
    expect(svg('aacr-same-corpus')).toContain(reason.replace(/&/gu, '&amp;'));
  });

  it('does not draw the gap between them', () => {
    // **This is the assertion the section exists for.** The published figure drew a dashed headroom line across two
    // row sets and labelled it *5.1 F1*; a warning beside that line would have left the subtraction in the picture.
    const rendered = svg('aacr-same-corpus');
    expect(rendered).not.toContain('of headroom');
    expect(rendered).toContain('no gap is drawn');
  });

  it('is refused when the reason is missing', () => {
    const figure: Figure = {
      id: 'fixture-mixed',
      rows: [
        { tool: 'a', scope: { pullRequests: 14, goldens: 196 } },
        { tool: 'b', scope: { pullRequests: 47, goldens: 436 } },
      ],
    };
    expect(() => mixedScopeOf(figure)).toThrow(/mixes 2 row sets .* carries no mixedScope reason/u);
  });

  it('is refused when only some rows are scoped', () => {
    // **Scoping the rows somebody remembered is worse than scoping none**, because the unscoped row silently borrows the
    // scope of the rows beside it.
    const figure: Figure = {
      id: 'fixture-half',
      rows: [
        { tool: 'a', scope: { pullRequests: 14, goldens: 196 } },
        { tool: 'b' },
      ],
      mixedScope: 'half',
    };
    expect(() => mixedScopeOf(figure)).toThrow(/scopes 1 of its 2 rows and not the rest/u);
  });
});

describe('a figure whose rows are one row set', () => {
  it('renders without a reason and keeps the gap', () => {
    // The other direction: a gate that fired on every figure would be a gate that got removed. `martian-offline` is one
    // row set only in the sense that no row declares a scope, which is the *undeclared* case and stays permitted.
    expect(mixedScopeOf(oneRowSet())).toBeNull();
    expect(mixedScopeOf(DATA.figures.find((figure) => figure.id === 'martian-offline') as Figure)).toBeNull();
    expect(svg('martian-offline')).toContain('of headroom');
  });

  it('may not carry a stale reason', () => {
    // A warning that outlived its cause is how a reader learns to skip warnings.
    expect(() => mixedScopeOf({ ...oneRowSet(), mixedScope: 'stale' })).toThrow(
      /stale warning is a warning that teaches readers to skip warnings/u,
    );
  });
});
