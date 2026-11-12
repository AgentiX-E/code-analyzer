// A review can read the code it is reviewing, and says what that reading cost
//
// **The capability the head-to-head said we did not have.** Their reviewer is a checkout with six tools; ours was a
// string. This suite covers the three pieces that make the difference real rather than rhetorical: a repository that
// can be read **and refuses what it must not read**, a budget that **stops a run before it is a bill with no ceiling**,
// and a dispatcher that **decides every effect a tool can have in one place**.
//
// **Real files, on a real disk**, because the thing under test is a reader: a reader tested against a fake reader has
// not been tested.

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentBudget } from '../../../../packages/intelligence/src/review/agent/budget.js';
import {
  DirectoryRepository,
  MappedRepository,
} from '../../../../packages/intelligence/src/review/agent/repository.js';
import {
  AGENT_TOOLS,
  dispatchTool,
  parseDeclaration,
  parseDraftComments,
} from '../../../../packages/intelligence/src/review/agent/tools.js';
import type { ReviewRepository } from '../../../../packages/intelligence/src/review/agent/repository.js';

const created: string[] = [];

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-repo-'));
  created.push(root);
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

afterEach(() => {
  // **The temp dirs are removed by the OS**, and a teardown that threw would hide the assertion that mattered. The list
  // is still emptied, because a suite that kept every tree it ever built would hold handles across files.
  created.splice(0);
});

const DIFF =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n';

describe('a repository is read, and refuses what it must not read', () => {
  it('reads a changed file and serves its diff', () => {
    const root = makeTree({
      'src/a.ts': 'const a = 1;\nconst b = 2;\n',
      'src/c.ts': 'export {};\n',
    });
    const repository = new DirectoryRepository({ root, changed: new Map([['src/a.ts', DIFF]]) });
    expect(repository.changedPaths()).toEqual(['src/a.ts']);
    expect(repository.diffOf('src/a.ts')).toBe(DIFF);
    expect(repository.diffOf('src/c.ts')).toBeNull();
    const file = repository.readFile('src/a.ts');
    expect(file?.text).toContain('const b = 2;');
    expect(file?.truncated).toBe(false);
    expect(file?.firstLine).toBe(1);
  });

  it('answers absent for a path that is not there, and refuses one that leaves the root', () => {
    const root = makeTree({ 'src/a.ts': 'export {};\n' });
    const repository = new DirectoryRepository({ root, changed: new Map() });
    expect(repository.readFile('src/missing.ts')).toBeNull();
    // **A model chooses the path.** `../` is a read it asked for and a read it must not get.
    expect(repository.readFile('../../etc/passwd')).toBeNull();
    expect(repository.readFile('/etc/passwd')).toBeNull();
    expect(repository.readFile('')).toBeNull();
  });

  it('refuses a directory, and a file past the byte ceiling without opening it', () => {
    const root = makeTree({ 'src/a.ts': 'export {};\n' });
    const repository = new DirectoryRepository({
      root,
      changed: new Map(),
      limits: { maxFileBytes: 4 },
    });
    expect(repository.readFile('src')).toBeNull();
    const tooLarge = repository.readFile('src/a.ts');
    expect(tooLarge?.text).toBe('');
    expect(tooLarge?.truncated).toBe(true);
  });

  it('says when it truncated a read rather than returning half a file silently', () => {
    const root = makeTree({ 'src/big.ts': `${'x'.repeat(50)}\n` });
    const repository = new DirectoryRepository({
      root,
      changed: new Map(),
      limits: { maxFileChars: 10 },
    });
    const file = repository.readFile('src/big.ts');
    expect(file?.text).toHaveLength(10);
    expect(file?.truncated).toBe(true);
  });

  it('refuses a link that leaves the root, and reads one that stays inside it', () => {
    // **A path inside the root is not a file inside the root.** A pull request can commit a symlink; stripping `..` and
    // comparing strings then says the name is legal while the file it names is `/elsewhere`. The rule has to be about
    // the file the name ends at, which is what `realpath` answers.
    const outside = mkdtempSync(join(tmpdir(), 'agent-outside-'));
    created.push(outside);
    const secret = join(outside, 'secret.ts');
    writeFileSync(secret, 'const leaked = 1;\n');
    const root = makeTree({ 'src/a.ts': 'const a = 1;\n' });
    symlinkSync(secret, join(root, 'notes.ts'));
    symlinkSync(join(root, 'src/a.ts'), join(root, 'alias.ts'));
    const repository = new DirectoryRepository({ root, changed: new Map() });
    expect(repository.readFile('notes.ts')).toBeNull();
    expect(repository.readFile('alias.ts')?.text).toBe('const a = 1;\n');
  });

  it('treats a sibling directory whose name starts with the root name as outside the root', () => {
    // **`/tmp/x/repo-evil` starts with `/tmp/x/repo`**, so a prefix test without the separator would read it. The
    // fixture is built as two sibling directories for that reason, and the link is the only way to reach the second.
    const parent = mkdtempSync(join(tmpdir(), 'agent-siblings-'));
    created.push(parent);
    const root = join(parent, 'repo');
    const sibling = join(parent, 'repo-evil');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), 'const a = 1;\n');
    writeFileSync(join(sibling, 'secret.ts'), 'const sibling = 1;\n');
    symlinkSync(join(sibling, 'secret.ts'), join(root, 'bridge.ts'));
    const repository = new DirectoryRepository({ root, changed: new Map() });
    expect(repository.readFile('bridge.ts')).toBeNull();
    expect(repository.readFile('src/a.ts')?.text).toBe('const a = 1;\n');
  });

  it('answers for the root itself without reading it as a file', () => {
    // `readFile('.')` normalises to the root, which is the one path where the containment rule is equality rather than
    // a prefix - and the answer is the same one a directory gets.
    const root = makeTree({ 'src/a.ts': 'const a = 1;\n' });
    const repository = new DirectoryRepository({ root, changed: new Map() });
    expect(repository.readFile('.')).toBeNull();
    expect(repository.readFile('./src/a.ts')?.text).toBe('const a = 1;\n');
  });

  it('closes what it opened, so a long review does not run out of descriptors', () => {
    // **The descriptor is the thing a leak would be measured in.** Without the `finally`, each read leaves one open and
    // the process ceiling (1024 on a default Linux) arrives inside a single review's tool budget - so the assertion is
    // simply that the last read of many still returns text.
    const root = makeTree({ 'src/a.ts': 'const a = 1;\n' });
    const repository = new DirectoryRepository({ root, changed: new Map() });
    let last: string | null = null;
    for (let i = 0; i < 1200; i += 1) last = repository.readFile('src/a.ts')?.text ?? null;
    expect(last).toBe('const a = 1;\n');
  });

  it('lists nothing when the root itself is not there, rather than throwing at a reviewer', () => {
    const repository = new DirectoryRepository({
      root: join(tmpdir(), 'agent-root-that-is-not-there'),
      changed: new Map(),
    });
    expect(repository.listFiles()).toEqual([]);
    expect(repository.search('anything')).toEqual([]);
    expect(repository.readFile('a.ts')).toBeNull();
  });

  it('searches literals, honours a suffix and a limit, and ignores a query too short to mean anything', () => {
    const root = makeTree({
      'src/a.ts': 'const needle = 1;\nconst other = 2;\n',
      'src/b.py': 'needle = 1\n',
      'node_modules/c.ts': 'needle\n',
      '.hidden.ts': 'needle\n',
    });
    const repository = new DirectoryRepository({ root, changed: new Map() });
    expect(repository.search('n')).toEqual([]);
    const all = repository.search('needle');
    expect(all.map((hit) => hit.path)).toEqual(['src/a.ts', 'src/b.py']);
    expect(all[0]?.line).toBe(1);
    expect(all[0]?.text).toBe('const needle = 1;');
    expect(repository.search('needle', { suffix: '.py' }).map((hit) => hit.path)).toEqual([
      'src/b.py',
    ]);
    expect(repository.search('needle', { limit: 1 })).toHaveLength(1);
    expect(repository.search('needle', { maxFiles: 0 })).toEqual([]);
    // **A skipped directory is skipped**, and a dotfile is not source.
    expect(repository.listFiles()).toEqual(['src/a.ts', 'src/b.py']);
  });
});

describe('a repository can be the files a transport already fetched', () => {
  it('serves what it was given, and falls through to a reader for the rest', () => {
    const root = makeTree({ 'src/other.ts': 'const fromDisk = 1;\n' });
    const disk = new DirectoryRepository({ root, changed: new Map() });
    const repository = new MappedRepository({
      files: new Map([
        ['src/a.ts', 'const a = 1;'],
        ['src/b.ts', 'const b = 2;'],
      ]),
      changed: new Map([['src/a.ts', DIFF]]),
      fallback: disk,
    });
    expect(repository.changedPaths()).toEqual(['src/a.ts']);
    expect(repository.diffOf('src/a.ts')).toBe(DIFF);
    expect(repository.readFile('src/a.ts')?.text).toBe('const a = 1;');
    expect(repository.readFile('src/other.ts')?.text).toContain('const fromDisk = 1;');
    expect(repository.readFile('src/nowhere.ts')).toBeNull();
    expect(repository.listFiles()).toEqual(['src/a.ts', 'src/b.ts', 'src/other.ts']);
  });

  it('searches its own files first and then the fallback, without naming one file twice', () => {
    const root = makeTree({ 'src/b.ts': 'needle here\n' });
    const disk = new DirectoryRepository({ root, changed: new Map() });
    const repository = new MappedRepository({
      files: new Map([['src/b.ts', 'needle here\n']]),
      changed: new Map(),
      fallback: disk,
    });
    const hits = repository.search('needle');
    expect(hits).toHaveLength(1);
    expect(repository.search('n')).toEqual([]);
    expect(repository.search('needle', { suffix: '.ts' })).toHaveLength(1);
    expect(new MappedRepository({ files: new Map(), changed: new Map() }).search('needle')).toEqual(
      [],
    );
    expect(new MappedRepository({ files: new Map(), changed: new Map() }).listFiles()).toEqual([]);
  });

  it('falls through to the fallback for a search it cannot answer, and never names one file twice', () => {
    const root = makeTree({ 'src/b.ts': 'needle one\nneedle two\n', 'src/c.ts': 'needle three\n' });
    const disk = new DirectoryRepository({ root, changed: new Map() });
    const repository = new MappedRepository({
      // **The same file the fallback also has**, so the dedupe is exercised rather than assumed.
      files: new Map([['src/b.ts', 'needle one\nneedle two\n']]),
      changed: new Map([['src/b.ts', 'diff']]),
      fallback: disk,
    });
    const hits = repository.search('needle');
    expect(hits.map((hit) => hit.path)).toEqual(['src/b.ts', 'src/b.ts', 'src/c.ts']);
    // **A limit inside the mapped files stops the walk**, so the fallback is not called for a question already answered.
    expect(repository.search('needle', { limit: 1 }).map((hit) => hit.path)).toEqual(['src/b.ts']);
    expect(repository.search('needle', { suffix: '.py' })).toEqual([]);
    expect(repository.diffOf('src/nowhere.ts')).toBeNull();
  });

  it('truncates a mapped file at the same ceiling as one on disk', () => {
    const repository = new MappedRepository({
      files: new Map([['src/a.ts', 'x'.repeat(80)]]),
      changed: new Map(),
      limits: { maxFileChars: 5 },
    });
    expect(repository.readFile('src/a.ts')?.truncated).toBe(true);
    expect(repository.readFile('src/a.ts')?.text).toHaveLength(5);
  });
});

describe('a budget stops a run before it is a bill with no ceiling', () => {
  it('counts rounds and refuses the one past the limit, naming the limit', () => {
    const budget = new AgentBudget({ maxRounds: 2, maxToolCalls: 10 });
    expect(budget.startRound().ok).toBe(true);
    expect(budget.startRound().ok).toBe(true);
    const refused = budget.startRound();
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.reason : '').toContain('2-round budget');
    expect(budget.report().refusals).toHaveLength(1);
  });

  it('refuses a call past the call budget, and counts the refusal rather than the call', () => {
    const budget = new AgentBudget({ maxToolCalls: 1, maxRounds: 5 });
    expect(budget.takeToolCall('read_file').ok).toBe(true);
    expect(budget.takeToolCall('read_file').ok).toBe(false);
    expect(budget.report().toolCalls).toBe(1);
    expect(budget.report().refusals[0]?.kind).toBe('read_file');
  });

  it('caps searches, files and characters separately, because they cost different things', () => {
    const searches = new AgentBudget({ maxSearches: 1, maxToolCalls: 9 });
    expect(searches.takeToolCall('search_code').ok).toBe(true);
    expect(searches.takeToolCall('search_code').ok).toBe(false);

    const files = new AgentBudget({ maxFilesRead: 1, maxToolCalls: 9 });
    expect(files.takeToolCall('read_file').ok).toBe(true);
    expect(files.chargeRead('a.ts', 10).ok).toBe(true);
    expect(files.takeToolCall('read_file').ok).toBe(false);
    expect(files.hasRead('a.ts')).toBe(true);
    expect(files.hasRead('b.ts')).toBe(false);

    const chars = new AgentBudget({ maxReadChars: 10 });
    expect(chars.chargeRead('a.ts', 5).ok).toBe(true);
    const refused = chars.chargeRead('b.ts', 90);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.reason : '').toContain('10-character budget');
    expect(chars.report().readChars).toBe(5);
  });

  it('states the policy it enforces, so an artifact can carry it', () => {
    expect(new AgentBudget({ maxRounds: 3 }).policy().maxRounds).toBe(3);
    expect(new AgentBudget().policy().maxToolCalls).toBeGreaterThan(0);
  });
});

describe('the dispatcher owns every effect a tool can have', () => {
  const root = makeTree({
    'src/a.ts': 'const a = 1;\nconst b = 2;\n',
    'src/c.ts': 'export const c = 3;\n',
  });
  const repository: ReviewRepository = new DirectoryRepository({
    root,
    changed: new Map([['src/a.ts', DIFF]]),
  });

  const context = (overrides: Partial<Parameters<typeof dispatchTool>[1]> = {}) => ({
    repository,
    round: 1,
    changedPaths: ['src/a.ts'],
    takeToolCall: () => ({ ok: true as const }),
    chargeRead: () => ({ ok: true as const }),
    ...overrides,
  });

  it('reads a file with line numbers, and a range when it is asked for one', () => {
    const whole = dispatchTool({ name: 'read_file', arguments: { path: 'src/a.ts' } }, context());
    expect(whole.text).toContain('    1| const a = 1;');
    expect(whole.text).toContain('    2| const b = 2;');
    const ranged = dispatchTool(
      { name: 'read_file', arguments: { path: 'src/a.ts', from_line: 2, to_line: 2 } },
      context(),
    );
    expect(ranged.text).toBe('    2| const b = 2;');
  });

  it('says when the read it served was truncated, so the model does not reason about half a file', () => {
    const small = new DirectoryRepository({
      root,
      changed: new Map([['src/a.ts', DIFF]]),
      limits: { maxFileChars: 5 },
    });
    const served = dispatchTool(
      { name: 'read_file', arguments: { path: 'src/a.ts' } },
      context({ repository: small }),
    );
    expect(served.text).toContain('this read was truncated');
  });

  it('stops a range at the end of the file rather than inventing lines', () => {
    const ranged = dispatchTool(
      { name: 'read_file', arguments: { path: 'src/a.ts', from_line: 2, to_line: 99 } },
      context(),
    );
    expect(ranged.text).toBe('    2| const b = 2;');
  });

  it('passes a suffix through to the search', () => {
    const narrowed = dispatchTool(
      { name: 'search_code', arguments: { query: 'const', suffix: '.py' } },
      context(),
    );
    expect(narrowed.text).toContain('No occurrence');
  });

  it('resolves a comment with no path to nothing when the review has more than one file', () => {
    const filed = dispatchTool(
      {
        name: 'file_comment',
        arguments: { comments: [{ content: 'a claim', existing_code: 'x' }] },
      },
      context({ changedPaths: ['src/a.ts', 'src/c.ts'] }),
    );
    expect(filed.comments).toEqual([]);
    expect(filed.refused).toBe('no usable comment');
  });

  it('answers a call whose arguments are absent with the arguments it needs', () => {
    const served = dispatchTool({ name: 'read_file', arguments: null }, context());
    expect(served.refused).toBe('no path');
  });

  it('answers a read it cannot serve with a sentence the model can act on', () => {
    const missing = dispatchTool(
      { name: 'read_file', arguments: { path: 'src/none.ts' } },
      context(),
    );
    expect(missing.text).toContain('not in this repository');
    expect(missing.refused).toBe('absent');
    expect(dispatchTool({ name: 'read_file', arguments: {} }, context()).refused).toBe('no path');
  });

  it('serves the diff of another changed file, and names what was changed instead of failing silently', () => {
    const ok = dispatchTool({ name: 'read_diff', arguments: { path: 'src/a.ts' } }, context());
    expect(ok.text).toContain('@@ -1,1 +1,2 @@');
    const notChanged = dispatchTool(
      { name: 'read_diff', arguments: { path: 'src/c.ts' } },
      context(),
    );
    expect(notChanged.text).toContain('was not changed');
    expect(notChanged.text).toContain('src/a.ts');
    expect(dispatchTool({ name: 'read_diff', arguments: {} }, context()).refused).toBe('no path');
  });

  it('refuses a diff read the budget declined, rather than serving it for free', () => {
    const refused = dispatchTool(
      { name: 'read_diff', arguments: { path: 'src/a.ts' } },
      context({ chargeRead: () => ({ ok: false as const, reason: 'past the ceiling' }) }),
    );
    expect(refused.refused).toBe('past the ceiling');
  });

  it('searches, and says so plainly when nothing matched', () => {
    const hit = dispatchTool({ name: 'search_code', arguments: { query: 'const c' } }, context());
    expect(hit.text).toContain('src/c.ts:1:');
    const miss = dispatchTool({ name: 'search_code', arguments: { query: 'nowhere' } }, context());
    expect(miss.text).toContain('No occurrence');
    expect(dispatchTool({ name: 'search_code', arguments: {} }, context()).refused).toBe(
      'no query',
    );
  });

  it('files a finding only when it carries the code it is about', () => {
    const filed = dispatchTool(
      {
        name: 'file_comment',
        arguments: {
          comments: [
            { path: 'src/a.ts', content: 'b is unused', existing_code: 'const b = 2;' },
            { path: 'src/a.ts', content: 'no quote here' },
          ],
        },
      },
      context(),
    );
    expect(filed.comments).toHaveLength(1);
    expect(filed.comments[0]?.existingCode).toBe('const b = 2;');
    expect(filed.text).toContain('Filed 1 finding(s)');
    expect(filed.text).toContain('no existing_code');
  });

  it('refuses a batch where nothing could be filed, rather than reporting success', () => {
    const refused = dispatchTool(
      { name: 'file_comment', arguments: { comments: [{}] } },
      context(),
    );
    expect(refused.comments).toEqual([]);
    expect(refused.refused).toBe('no usable comment');
    expect(dispatchTool({ name: 'file_comment', arguments: {} }, context()).refused).toBe(
      'no usable comment',
    );
  });

  it('takes the reviewed path when a single-file review filed a comment with no path', () => {
    const filed = dispatchTool(
      {
        name: 'file_comment',
        arguments: { comments: [{ content: 'wrong branch', existing_code: 'const a = 1;' }] },
      },
      context(),
    );
    expect(filed.comments[0]?.path).toBe('src/a.ts');
  });

  it('ends only when task_done names its files', () => {
    const done = dispatchTool(
      {
        name: 'task_done',
        arguments: { reviewed: ['src/a.ts'], skipped: [{ path: 'src/c.ts', reason: 'config' }] },
      },
      context(),
    );
    expect(done.done?.reviewed).toEqual(['src/a.ts']);
    expect(done.done?.skipped[0]?.reason).toBe('config');
    expect(parseDeclaration(undefined).reviewed).toEqual([]);
    expect(parseDeclaration({ reviewed: [1, 'a.ts'], skipped: [null, { path: 'x' }] })).toEqual({
      reviewed: ['a.ts'],
      skipped: [],
    });
  });

  it('reads a declaration whose reviewed field is not a list as an empty declaration', () => {
    const done = dispatchTool(
      { name: 'task_done', arguments: { reviewed: 'src/a.ts' } },
      context(),
    );
    expect(done.done).toEqual({ reviewed: [], skipped: [] });
  });

  it('rejects a tool it does not implement, and a call the budget refused', () => {
    const unknown = dispatchTool({ name: 'run_shell', arguments: {} }, context());
    expect(unknown.text).toContain('no tool named');
    const refused = dispatchTool(
      { name: 'read_file', arguments: { path: 'src/a.ts' } },
      context({
        takeToolCall: () => ({ ok: false as const, reason: 'the 12-call budget is spent' }),
      }),
    );
    expect(refused.refused).toBe('the 12-call budget is spent');
    const tooMuch = dispatchTool(
      { name: 'read_file', arguments: { path: 'src/a.ts' } },
      context({ chargeRead: () => ({ ok: false as const, reason: 'past the ceiling' }) }),
    );
    expect(tooMuch.refused).toBe('past the ceiling');
    const searchTooMuch = dispatchTool(
      { name: 'search_code', arguments: { query: 'const' } },
      context({ chargeRead: () => ({ ok: false as const, reason: 'past the ceiling' }) }),
    );
    expect(searchTooMuch.refused).toBe('past the ceiling');
  });

  it('describes five tools, each with a schema the model can fill in', () => {
    expect(AGENT_TOOLS.map((tool) => tool.name)).toEqual([
      'read_file',
      'search_code',
      'read_diff',
      'file_comment',
      'task_done',
    ]);
    for (const tool of AGENT_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters).toHaveProperty('properties');
    }
    // **The contract the whole design rests on is in the description the model reads**, not only in the parser.
    expect(AGENT_TOOLS.find((tool) => tool.name === 'file_comment')?.description).toContain(
      'verbatim',
    );
  });
});

describe('a draft comment is parsed strictly about the three fields the contract needs', () => {
  it('keeps the fields it was given and defaults the two it can default', () => {
    const parsed = parseDraftComments(
      [
        {
          path: 'src/a.ts',
          content: 'wrong',
          existing_code: 'x',
          category: 'security',
          severity: 'high',
          suggestion_code: 'y',
          start_line: 4,
        },
        {
          path: 'src/a.ts',
          content: 'second',
          existing_code: 'z',
          category: 'nonsense',
          severity: 'urgent',
        },
      ],
      'fallback.ts',
      2,
    );
    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[0]?.category).toBe('security');
    expect(parsed.comments[0]?.severity).toBe('high');
    expect(parsed.comments[0]?.suggestionCode).toBe('y');
    expect(parsed.comments[0]?.startLine).toBe(4);
    expect(parsed.comments[0]?.round).toBe(2);
    // **An unrecognised category is a bug until someone says otherwise**, and an unrecognised severity is medium.
    expect(parsed.comments[1]?.category).toBe('bug');
    expect(parsed.comments[1]?.severity).toBe('medium');
    expect(parsed.comments[1]?.suggestionCode).toBeNull();
    expect(parsed.rejected).toEqual([]);
  });

  it('counts what it refused instead of dropping a batch in silence', () => {
    const parsed = parseDraftComments(
      [
        null,
        'a sentence',
        { content: '' },
        { content: 'no quote' },
        { existing_code: 'no content' },
      ],
      'src/a.ts',
      1,
    );
    expect(parsed.comments).toEqual([]);
    expect(parsed.rejected.map((entry) => entry.reason)).toEqual([
      'not an object',
      'not an object',
      'no content',
      'no existing_code',
      'no content',
    ]);
  });

  it('accepts a single object as a batch of one', () => {
    expect(
      parseDraftComments({ content: 'c', existing_code: 'e' }, 'src/a.ts', 1).comments,
    ).toHaveLength(1);
    expect(parseDraftComments(undefined, 'src/a.ts', 1).comments).toEqual([]);
  });
});
