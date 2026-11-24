/**
 * **A page is code, and the four things that go wrong with one are all assertable.**
 *
 * The replay's total is one number and the page's job is the fifty rows behind it, so the failures here are the ones a
 * screenshot hides: a row that silently disappears, a link that needs a network the reader does not have, a filter that
 * matches nothing, and a renderer that happily draws an empty table when the report carries no rows at all. Each is a
 * case below, and **the fourth is the one that matters most**: an empty page is a claim that the gate acted nowhere,
 * presented with the same confidence as a measurement.
 */
import { describe, expect, it } from 'vitest';

import { renderGateReplayPage } from '../../../scripts/lib/gate-replay-page.mjs';

const row = (over: Record<string, unknown> = {}) => ({
  pr: 'https://github.com/owner/alpha/pull/1',
  applied: true,
  withheld: null,
  findings: 4,
  readable: 4,
  dropped: 1,
  postedBefore: 3,
  postedAfter: 2,
  goldensBefore: 2,
  goldensAfter: 1,
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  cut: { label: 'drop test, drop path test, budget 12' },
  baseline: { emitted: 3, truePositives: 2, precision: 0.6667, recall: 0.5, f1: 0.5714 },
  gated: { emitted: 2, truePositives: 1, precision: 0.5, recall: 0.25, f1: 0.3333 },
  reproduced: true,
  delta: { f1: -0.2381 },
  removals: { posted: 1, share: 1 },
  goldens: { lost: ['https://github.com/owner/alpha/pull/1\u00000'], gained: [] },
  gate: {
    withheldPullRequests: 1,
    byReason: [
      { reason: 'the finding names an identifier that occurs nowhere in the file', count: 1 },
    ],
    perPullRequest: [
      row(),
      row({
        pr: 'https://github.com/owner/beta/pull/2',
        applied: false,
        withheld: 'no-readable-arm',
        dropped: 0,
        postedBefore: 2,
        postedAfter: 2,
        goldensBefore: 1,
        goldensAfter: 1,
      }),
    ],
  },
  ...over,
});

describe('the page shows the rows the total hides', () => {
  it('draws one row per pull request, with the decision it was given', () => {
    const html = renderGateReplayPage(report());
    const rows = html.match(/<tr data-state=/gu) ?? [];

    expect(rows).toHaveLength(2);
    expect(html).toContain('data-state="applied"');
    expect(html).toContain('data-state="withheld"');
    expect(html).toContain('no-readable-arm');
    // **The lost golden is attributed to the pull request that lost it**, because a count in the header is the figure the
    // page exists to explain rather than to repeat.
    expect(html).toContain('>−1<');
  });

  it('marks the pull request that moved and leaves the inert one unmarked', () => {
    const html = renderGateReplayPage(report());

    expect(html).toContain('data-changed="true"');
    expect(html).toContain('data-changed="false"');
  });
});

describe('the page stands alone', () => {
  it('refers to nothing a file system or an inbox cannot resolve', () => {
    const html = renderGateReplayPage(report());

    // **The three references that make a page fail offline**, which is the only way a documentation artefact is read
    // six months later: a script, a stylesheet, and a fetch. An `<a href>` to github.com is a *link a reader may follow*
    // and not a dependency - the page renders without it.
    expect(html).not.toMatch(/<script[^>]+src=/iu);
    expect(html).not.toMatch(/<link[^>]+href=/iu);
    expect(html).not.toMatch(/fetch\(/u);
    expect(html).toContain('<style>');
  });

  it('escapes the reasons it prints, so a finding cannot write the page', () => {
    const html = renderGateReplayPage(
      report({
        gate: {
          withheldPullRequests: 0,
          byReason: [{ reason: '<img src=x onerror=alert(1)>', count: 1 }],
          perPullRequest: [row()],
        },
      }),
    );

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('the two counts §150 turned rules into', () => {
  it('shows the names a comment could not anchor and the findings it could not post', () => {
    const html = renderGateReplayPage(
      report({
        gate: {
          withheldPullRequests: 0,
          namesNowhere: 6,
          coverage: { offered: 591, readable: 590, unpostable: 1 },
          byReason: [],
          perPullRequest: [row()],
        },
      }),
    );

    expect(html).toMatch(/<b>6<\/b><span>names absent<\/span>/u);
    expect(html).toMatch(/<b>1<\/b><span>unpostable<\/span>/u);
  });

  it('draws where the names live when the replay measured it', () => {
    const html = renderGateReplayPage(
      report({
        anchors: {
          findings: 10,
          readable: 10,
          noName: 4,
          inRange: 3,
          inFile: 1,
          inChange: 1,
          nowhere: 1,
        },
      }),
    );

    expect(html).toContain('Where the names a comment mentions actually live');
    expect(html).toContain('names a symbol absent from all of it');
    expect(html).toContain('10</b> findings whose file was read');
  });

  it('says the artifact predates the measurement rather than drawing an empty table', () => {
    const html = renderGateReplayPage(report());

    expect(html).toContain('this artifact predates the measurement');
  });
});

describe('a report with nothing behind it is refused rather than drawn', () => {
  it('throws when the replay carried no per-pull-request rows', () => {
    expect(() =>
      renderGateReplayPage({
        ...report(),
        gate: { withheldPullRequests: 0, byReason: [], perPullRequest: [] },
      }),
    ).toThrow(/no per-pull-request rows/u);
  });

  it('throws when the rows are absent rather than empty', () => {
    expect(() => renderGateReplayPage({ ...report(), gate: {} })).toThrow(
      /no per-pull-request rows/u,
    );
  });
});
