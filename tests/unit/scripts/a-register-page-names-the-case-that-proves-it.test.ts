// **A register nobody can interrogate is a table, and a page nobody renders is a page that drifts.** The register states
// forty capabilities across four axes, and the question that decides what the next iteration builds - *which capabilities
// have no end-to-end case* - is a filter, not a scan. So the page is generated from the table rather than written beside
// it, and these cases hold the two properties that make that safe:
//
//   1. **The page is self-contained.** No `script src`, no `link href`, no `fetch`: the repository's own rule for the
//      report it ships to users, applied to its own documentation. A page that needed the network to answer a click would
//      fail the first time it was emailed.
//   2. **The renderer refuses input it cannot parse.** An empty page and a register with nothing in it look identical, and
//      the difference is whether the table format changed under a renderer that did not notice.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  count,
  main,
  page,
  parseRows,
  plain,
  provenance,
  render,
  state,
} from '../../../scripts/capability-register.mjs';

const ROOT = join(__dirname, '..', '..', '..');
const REGISTER = join(ROOT, 'docs', 'CAPABILITY-REGISTER.md');
const MARKDOWN = readFileSync(REGISTER, 'utf8');
const ROWS = parseRows(MARKDOWN);

/** The register's own table, one column per field, written the way the formatter leaves it: padded. */
const TABLE = [
  '| #   | Capability | Surface | Ships at | Unit | End-to-end | State |',
  '| --- | ---------- | ------- | -------- | ---- | ---------- | ----- |',
  '| 1   | A thing    | CLI     | O        | —    | a-case     | DONE  |',
  '| 2   | Another    | MCP     | C        | u    | —          | NONE  |',
].join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'register-page-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the register is read, not assumed', () => {
  it('finds every row of the committed register', () => {
    // **The number of rows is the document's, not this file's.** A literal here goes red every time a capability is
    // registered - which is the event the register exists for - and the repair is always to retype the literal, so the
    // assertion stops being about the parser the moment it is convenient to change it. **The independent count is a
    // regex over the same text**: a parser that drops a row is then a difference between two readings of one file
    // rather than a difference between a file and a number somebody remembered.
    const numbered = MARKDOWN.match(/^\s*\|\s*\d+\s*\|/gm) ?? [];
    expect(ROWS.length).toBe(numbered.length);
    expect(ROWS.length).toBeGreaterThan(40);
    expect(new Set(ROWS.map((row) => row.id)).size).toBe(ROWS.length);
  });

  it('keeps the section each row belongs to, so the page can group them by user story', () => {
    expect(new Set(ROWS.map((row) => row.section)).size).toBeGreaterThan(5);
    expect(ROWS[0]?.section).toBe('developer opening a pull request, I want a review I can act on');
  });

  it('reads a padded table, which is what the formatter produces', () => {
    // **The first version of this parser required a single space after the pipe and found zero rows** after one
    // `prettier --write`: the columns are aligned, and a parser that only understood its own spacing would have shipped
    // an empty page as a green build.
    expect(parseRows(TABLE)).toHaveLength(2);
  });

  it('ignores a line that is not a numbered row', () => {
    expect(parseRows(`${TABLE}\n| not a row |`).length).toBe(2);
  });

  it('drops the emphasis and the backticks, so a cell renders as text', () => {
    expect(plain('**A comment quotes** the `code`')).toBe('A comment quotes the code');
  });

  it.each([
    ['**O**', 'O'],
    ['O', 'O'],
    ['**C (Qodana, Sonar)**', 'C'],
    ['P', 'P'],
    ['C (Sourcegraph)', 'C'],
  ])('reads the provenance of %s as %s', (cell, expected) => {
    expect(provenance(cell)).toBe(expected);
  });

  it.each([
    ['DONE', 'DONE'],
    ['DONE (§148)', 'DONE'],
    ['**PART — no E2E**', 'PART'],
    ['**NONE — planned**', 'NONE'],
    ['a state word this register does not use', 'PART'],
  ])('reads the state of %s as %s', (cell, expected) => {
    expect(state(cell)).toBe(expected);
  });
});

describe('the page', () => {
  const html = page(ROWS);

  it('is self-contained: no external script, stylesheet or request', () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toContain('fetch(');
    expect(html).not.toContain('cdn.');
  });

  it('carries every row, with the filters the four axes imply', () => {
    expect(html.match(/data-state=/g)?.length).toBe(ROWS.length);
    expect(html).toContain('data-filter="no-e2e"');
    expect(html).toContain('data-filter="C"');
  });

  it('says a missing case is missing rather than leaving the cell blank', () => {
    expect(html).toContain('no end-to-end case');
  });

  it('marks each row with its state and its provenance, so a filter is a click', () => {
    expect(html).toContain('data-who="O"');
    expect(html).toContain('data-state="NONE"');
  });

  it('recounts §7 from the table, so the summary cannot disagree with the rows it summarises', () => {
    // **The one paragraph in this file that was typed rather than computed**, and it was wrong: the block said
    // `end-to-end 41` while the table held thirty-eight, because every round added a row and incremented a number by eye.
    // The rule is stated here once and applied to the same parse the page uses.
    const hasCase = (cell: string) => /`[^`]+`/u.test(cell) && !cell.startsWith('—');
    const tally = { DONE: 0, PART: 0, NONE: 0 } as Record<string, number>;
    const who = { O: 0, P: 0, C: 0 } as Record<string, number>;
    let unit = 0;
    let e2e = 0;
    for (const row of ROWS) {
      // **The renderer's own reading of a status**, rather than a second rule here: a cell like `` `DONE` (§163) `` is
      // `DONE` to `state()` and would be nothing to a `split()` that kept the backticks.
      const state_ = state(String(row.status ?? ''));
      if (state_ in tally) tally[state_] = (tally[state_] ?? 0) + 1;
      const side = String(row.who ?? '')
        .replace(/[*`]/gu, '')
        .charAt(0);
      if (side in who) who[side] = (who[side] ?? 0) + 1;
      if (hasCase(String(row.unit ?? ''))) unit += 1;
      if (hasCase(String(row.e2e ?? ''))) e2e += 1;
    }
    const section = MARKDOWN.slice(MARKDOWN.indexOf('## 7. Coverage, counted'));
    // **The label is the row's first cell with its emphasis stripped**, because the block writes `**\`O\` ours-only**` and
    // a pattern anchored on the pipe would have to spell out every decoration a later edit might add.
    const row = (label: string): number => {
      for (const line of section.split('\n')) {
        if (!line.startsWith('|')) continue;
        const cells = line.split('|').slice(1, -1);
        const first = String(cells[0] ?? '')
          .replace(/[*`]/gu, '')
          .trim();
        if (first !== label) continue;
        return Number(String(cells[1] ?? '').trim());
      }
      expect.fail(`no row labelled ${label}`);
      return Number.NaN;
    };
    expect(row('DONE')).toBe(tally['DONE']);
    expect(row('PART')).toBe(tally['PART']);
    expect(row('NONE')).toBe(tally['NONE']);
    expect(row('with an end-to-end case')).toBe(e2e);
    expect(row('with a unit case')).toBe(unit);
    expect(row('O ours-only')).toBe(who['O']);
    expect(row('P public')).toBe(who['P']);
    expect(row('C competitor-only')).toBe(who['C']);
    expect((tally['DONE'] ?? 0) + (tally['PART'] ?? 0) + (tally['NONE'] ?? 0)).toBe(ROWS.length);
  });

  it('names in prose the count its own table holds', () => {
    // **The sentence beside the table is the last thing in this block typed by hand**, and it drifted by one the round a
    // row was added: the table said `O 38` and the prose said "37 capabilities no competitor in this register ships".
    // A reader quotes the sentence, not the cell.
    const stated = /(\d+) capabilities no competitor in this register ships/u.exec(MARKDOWN);
    expect(stated).not.toBeNull();
    const owned = ROWS.filter((row) =>
      String(row.who ?? '')
        .replace(/[*`]/gu, '')
        .trim()
        .startsWith('O'),
    ).length;
    expect(Number(stated?.[1])).toBe(owned);
  });

  it('counts what it rendered rather than restating a number from the prose', () => {
    const tally = count(ROWS);
    expect(tally.total).toBe(ROWS.length);
    expect(tally.DONE + tally.PART + tally.NONE).toBe(tally.total);
    expect(tally.O + tally.C + tally.P).toBe(tally.total);
    expect(tally.e2e).toBeLessThanOrEqual(tally.total);
    expect(html).toContain(`<b>${tally.total}</b><span>capabilities</span>`);
  });
});

describe('rendering is a function, and it refuses what it cannot read', () => {
  it('writes a page and reports what it wrote', () => {
    const target = join(scratch, 'page.html');
    const result = render(REGISTER, target);
    expect(result.rows).toBe(ROWS.length);
    expect(readFileSync(target, 'utf8')).toContain('<title>Capability register');
  });

  it('defaults to the committed register and the committed page', () => {
    // The two defaults are part of the contract: the CI step runs the command with no arguments and then asks git whether
    // the page it wrote differs from the page in the tree.
    const result = render();
    expect(result.rows).toBe(ROWS.length);
    expect(readFileSync(join(ROOT, 'docs', 'capability-register.html'), 'utf8')).toContain(
      '<title>Capability register',
    );
  });

  it('produces the same bytes twice, so a diff of two builds shows what changed in the register', () => {
    // **Deterministic on purpose**: no clock, no run id, no ordering that depends on a map.
    const first = join(scratch, 'a.html');
    const second = join(scratch, 'b.html');
    render(REGISTER, first);
    render(REGISTER, second);
    expect(readFileSync(first, 'utf8')).toBe(readFileSync(second, 'utf8'));
  });

  it('refuses a table it cannot parse instead of writing an empty page', () => {
    const broken = join(scratch, 'broken.md');
    writeFileSync(broken, '## A section\n\n| # | Capability |\n| - | - |\n');
    expect(() => render(broken, join(scratch, 'never.html'))).toThrow(/no register rows parsed/);
  });

  it('prints what it wrote when it succeeds', () => {
    const said: string[] = [];
    const status = main(
      [],
      (source?: string, target?: string) => {
        expect(source).toBeUndefined();
        expect(target).toBeUndefined();
        return { rows: 40, bytes: 1234 };
      },
      { log: (line: string) => said.push(line), error: () => undefined },
    );
    expect(status).toBe(0);
    expect(said[0]).toContain('(40 capabilities, 1234 bytes)');
  });

  it('falls back to the real renderer and the real console when it is given neither', () => {
    // The CI step runs the command with no arguments at all, so the default is the path that ships.
    const said: string[] = [];
    const status = main(['node', 'script'], undefined, {
      log: (line: string) => said.push(line),
      error: () => undefined,
    });
    expect(status).toBe(0);
    expect(said[0]).toContain(`${ROWS.length} capabilities`);
  });

  it('prints the reason and returns one when a renderer throws something that is not an Error', () => {
    // **The branch that only runs after a bug**: a thrown string used to reach the console as `[object Object]`.
    const said: string[] = [];
    const status = main(
      ['node', 'script', 'in.md', 'out.html'],
      () => {
        throw 'plain string';
      },
      { log: () => undefined, error: (line: string) => said.push(line) },
    );
    expect(status).toBe(1);
    expect(said).toEqual(['plain string']);
  });

  it('names the file it wrote, relative to the repository', () => {
    const said: string[] = [];
    main(
      ['node', 'script'],
      (source?: string) => {
        expect(source).toBeUndefined();
        return { rows: 1, bytes: 2 };
      },
      { log: (line: string) => said.push(line), error: () => undefined },
    );
    expect(said[0]).toContain('docs/capability-register.html');
  });

  it('exits non-zero and says why when the table is unreadable', () => {
    const broken = join(scratch, 'cli-broken.md');
    writeFileSync(broken, 'nothing here\n');
    const outcome = (() => {
      try {
        execFileSync(
          'node',
          [join(ROOT, 'scripts', 'capability-register.mjs'), broken, join(scratch, 'x.html')],
          {
            stdio: 'pipe',
          },
        );
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? 1;
      }
    })();
    expect(outcome).toBe(1);
  });
});
