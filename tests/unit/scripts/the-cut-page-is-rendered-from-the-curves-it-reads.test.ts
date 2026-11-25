// **A page that recomputes is a page that can disagree.** Every number on `docs/cut-curve.html` comes from a
// `cut-curve.json` written by the instrument, so the renderer's only job is to refuse input it cannot draw and to draw
// the rest without a network request. These cases hold the three ways it can fail:
//
//   1. **A file whose version it does not know** - the renderer would otherwise read a different schema's fields as
//      undefined and draw a flat line through zero.
//   2. **A "best" that is not a row of its own curve** - the one claim a table can carry that a page cannot, because the
//      page draws the curve beside it.
//   3. **A page that needs the network** - the rule `scripts/capability-register.mjs` states for its own page, applied
//      to this one: it must survive being emailed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SOURCES,
  UnreadableCurveError,
  main,
  page,
  read,
  summary,
} from '../../../scripts/cut-curve-page.mjs';

const ROOT = join(__dirname, '..', '..', '..');

function record(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 'cut-curve-v1',
    results: [
      {
        artifact: 'benchmarks/martian-bench.json',
        corpus: 'benchmarks/martian/positive_samples.json',
        cut: 'drop:test+budget:12',
        profile: 'all',
        budgets: [4, 8, 12],
        shippedBudget: 12,
        shipped: {
          budget: 12,
          emitted: 40,
          truePositives: 8,
          falsePositives: 32,
          precision: 0.2,
          recall: 0.4,
          f1: 0.2667,
        },
        goldens: 20,
        curve: [
          {
            budget: 4,
            emitted: 16,
            truePositives: 5,
            falsePositives: 11,
            falseNegatives: 15,
            precision: 0.3125,
            recall: 0.25,
            f1: 0.2778,
          },
          {
            budget: 8,
            emitted: 30,
            truePositives: 8,
            falsePositives: 22,
            falseNegatives: 12,
            precision: 0.2667,
            recall: 0.4,
            f1: 0.32,
          },
          {
            budget: 12,
            emitted: 40,
            truePositives: 8,
            falsePositives: 32,
            falseNegatives: 12,
            precision: 0.2,
            recall: 0.4,
            f1: 0.2667,
          },
        ],
        best: { budget: 8, f1: 0.32 },
        costAtBest: 0.0533,
        splitHalf: {
          chosenOn: 'chosen',
          chosenGoldens: 10,
          heldOutGoldens: 10,
          budget: 8,
          chosenF1: 0.3,
          heldOut: {
            budget: 8,
            emitted: 15,
            truePositives: 4,
            falsePositives: 11,
            falseNegatives: 6,
            precision: 0.2667,
            recall: 0.4,
            f1: 0.32,
          },
          heldOutAtShipped: {
            budget: 12,
            emitted: 20,
            truePositives: 4,
            falsePositives: 16,
            falseNegatives: 6,
            precision: 0.2,
            recall: 0.4,
            f1: 0.2667,
          },
          gain: 0.0533,
        },
        ...overrides,
      },
    ],
  });
}

describe('the cut page', () => {
  it('draws every committed curve, and the best figure of each appears on it', () => {
    const text = readFileSync(join(ROOT, SOURCES[0] ?? ''), 'utf8');
    expect(text.length).toBeGreaterThan(0);
    const records = SOURCES.map((source) => read(source, readFileSync(join(ROOT, source), 'utf8')));
    const html = page(records);
    for (const entry of records) expect(html).toContain(entry.best.f1.toFixed(4));
    expect(html).toContain('AACR-Bench');
    expect(html).toContain('profile core');
  });

  it('needs no network, which is the rule this repository states for its own pages', () => {
    const records = SOURCES.map((source) => read(source, readFileSync(join(ROOT, source), 'utf8')));
    const html = page(records);
    expect(html).not.toMatch(/<script\s+src=/);
    expect(html).not.toMatch(/<link\s/);
    expect(html).not.toContain('fetch(');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('is deterministic, so a diff of two builds shows the corpus and nothing else', () => {
    const records = SOURCES.map((source) => read(source, readFileSync(join(ROOT, source), 'utf8')));
    expect(page(records)).toBe(page(records));
  });

  it('refuses a version it does not know rather than drawing undefined fields', () => {
    expect(() => read('x.json', JSON.stringify({ version: 'cut-curve-v2', results: [] }))).toThrow(
      UnreadableCurveError,
    );
    expect(() => read('x.json', 'not json')).toThrow(/not JSON/);
  });

  it('refuses a best budget that is not a row of the curve it claims to be the best of', () => {
    expect(() => read('x.json', record({ best: { budget: 9, f1: 0.5 } }))).toThrow(
      /best budget 9 is not a row/,
    );
    expect(() => read('x.json', record({ curve: [] }))).toThrow(/holds no curve/);
  });

  it('refuses to draw a page with no curves on it', () => {
    expect(() => page([])).toThrow(/no curves to draw/);
  });

  it('writes the shipped point as "no cut" when the artifact published none', () => {
    const parsed = JSON.parse(record({ shipped: null, shippedBudget: null, costAtBest: null }));
    const html = summary(parsed.results[0], 0);
    expect(html).toContain('no cut');
    expect(html).toContain('&mdash;');
  });

  it('renders the committed files to the committed page in one call', () => {
    const before = readFileSync(join(ROOT, 'docs', 'cut-curve.html'), 'utf8');
    main([]);
    const after = readFileSync(join(ROOT, 'docs', 'cut-curve.html'), 'utf8');
    expect(after).toBe(before);
  });
});
