// `get_code_snippet` — the tool that is named for code.
//
// **It returned a note instead of any.** For every call, in every deployment, the answer was
// `// Code snippet not available in current session` with `File system access required for code retrieval` beside it:
// a true sentence about a version of the handler that had no directory to look in, printed as though it were a fact
// about the request. The graph holds symbols and line numbers, so the tool could describe the function and never show
// it, and the agents built on this server reviewed symbol names.
//
// These cases are the two ways that can come back: a tool that cannot read (no root recorded) must say so with the
// reason, and a tool that can read must not read anything outside the directory it was told about. The third case is
// what the first one is for — the source, with the comments a model needs to answer a question about behaviour.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyzeRepository } from '../tools/indexing-lifecycle.js';
import { getCodeSnippet } from '../tools/querying-exploration.js';
import { ToolContextImpl } from '../tools/tool-context.js';

const PROJECT = 'snippet-fixture';

let root: string;
let context: ToolContextImpl;

const SOURCE = [
  'export function clamp(value: number, max: number): number {',
  '  // Values above the ceiling are pinned to it rather than wrapped.',
  '  return Math.min(value, max);',
  '}',
  '',
  'export function scale(value: number): number {',
  '  return value * 2;',
  '}',
  '',
].join('\n');

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'snippet-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'limits.ts'), SOURCE);
  context = new ToolContextImpl(new InMemoryGraphStore(), { llm: null });
  const indexed = await analyzeRepository({ path: root, projectId: PROJECT }, context);
  expect(indexed.isError).toBeUndefined();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function bodyOf(result: { content: Array<{ text?: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('the snippet a caller asked for', () => {
  it('**is the source**, with the comment inside the function, which is what a question about behaviour needs', async () => {
    const body = bodyOf(
      await getCodeSnippet(
        { filePath: 'src/limits.ts', projectId: PROJECT, endLine: 4, contextLines: 0 },
        context,
      ),
    );
    expect(body['code']).toContain('export function clamp');
    expect(body['code']).toContain('Values above the ceiling');
    expect(body['totalLines']).toBe(9);
    // The second function is outside the range the caller asked for.
    expect(body['code']).not.toContain('export function scale');
  });

  it('numbers the lines it returned, so a caller can cite them', async () => {
    const body = bodyOf(
      await getCodeSnippet(
        {
          filePath: 'src/limits.ts',
          projectId: PROJECT,
          startLine: 1,
          endLine: 4,
          contextLines: 0,
        },
        context,
      ),
    );
    expect(body['startLine']).toBe(1);
    expect(body['endLine']).toBe(4);
    expect(body['truncated']).toBe(true);
  });

  it('**marks a slice that starts late as truncated even when it reaches the end**', async () => {
    const body = bodyOf(
      await getCodeSnippet(
        {
          filePath: 'src/limits.ts',
          projectId: PROJECT,
          startLine: 6,
          endLine: 9,
          contextLines: 0,
        },
        context,
      ),
    );
    expect(body['startLine']).toBe(6);
    expect(body['endLine']).toBe(9);
    // `to < lines.length` is false here; the flag has to come from the other half of the condition.
    expect(body['truncated']).toBe(true);
  });

  it('reports the symbols the graph holds for the range, beside the code', async () => {
    const body = bodyOf(
      await getCodeSnippet(
        { filePath: 'src/limits.ts', projectId: PROJECT, endLine: 4, contextLines: 0 },
        context,
      ),
    );
    const symbols = body['symbolsInRange'] as Array<{ name: string }>;
    expect(symbols.map((symbol) => symbol.name)).toContain('clamp');
  });

  it('**a call that names no range returns the file**, not the six lines around line one', async () => {
    // **The shape every model actually calls**, because `startLine` and `endLine` are optional and a caller that wants
    // "the code in this file" has no reason to invent a range. It used to end at `startLine`, which is line 1, so the
    // answer was the import block: the function was `truncated` away while `totalLines` said the file was longer.
    // The injection corpus reads its call sites this way, which is how this was found.
    const body = bodyOf(
      await getCodeSnippet({ filePath: 'src/limits.ts', projectId: PROJECT }, context),
    );
    expect(body['startLine']).toBe(1);
    expect(body['endLine']).toBe(9);
    expect(body['truncated']).toBe(false);
    expect(body['code']).toContain('export function scale');
    // And the symbols in what was returned, which is what a caller reading a whole file is looking for.
    expect((body['symbolsInRange'] as Array<{ name: string }>).map((s) => s.name)).toEqual(
      expect.arrayContaining(['clamp', 'scale']),
    );
  });

  it('**a long file is capped and says so**, rather than putting a generated module in one tool result', async () => {
    const long = Array.from(
      { length: 500 },
      (_, index) => `export const v${String(index)} = ${String(index)};`,
    );
    writeFileSync(join(root, 'src', 'long.ts'), long.join('\n'));
    await analyzeRepository({ path: root, projectId: PROJECT }, context);

    const body = bodyOf(
      await getCodeSnippet({ filePath: 'src/long.ts', projectId: PROJECT }, context),
    );
    expect(body['endLine']).toBe(400);
    expect(body['totalLines']).toBe(500);
    expect(body['truncated']).toBe(true);
    // A caller that got 400 of 500 lines is told which 400, so it can ask for the rest.
    expect(body['code']).toContain('export const v0 = 0;');
    expect(body['code']).not.toContain('export const v499 = 499;');
  });
});

describe('what it refuses, and how it says so', () => {
  it('**will not read outside the project root**, and names the root so the caller can see why', async () => {
    const body = bodyOf(
      await getCodeSnippet({ filePath: '../../etc/passwd', projectId: PROJECT }, context),
    );
    expect(body['code']).toBeUndefined();
    expect(String(body['error'])).toContain('outside the project root');
    expect(body['projectRoot']).toBe(root);
  });

  it('**a sibling directory with the root as a prefix is still outside it**', async () => {
    // `/tmp/snippet-abc` and `/tmp/snippet-abcdef` share a prefix; a string comparison without a separator would let
    // the second be read under the first root's authority.
    const sibling = `${root}-evil`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'secret.ts'), 'export const secret = 1;\n');
    try {
      const body = bodyOf(
        await getCodeSnippet(
          { filePath: `../${sibling.split('/').pop() ?? 'sibling'}/secret.ts`, projectId: PROJECT },
          context,
        ),
      );
      expect(body['code']).toBeUndefined();
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('**a path inside the root that does not exist is a different sentence from a path outside it**', async () => {
    const body = bodyOf(
      await getCodeSnippet({ filePath: 'src/absent.ts', projectId: PROJECT }, context),
    );
    expect(String(body['error'])).toContain('is not a file under the root');
  });

  it('**a project indexed before roots were recorded says so instead of pretending**', async () => {
    // A store with nodes and no context: the shape every existing caller of this tool had, and the shape the old
    // fallback was written for. It still must not claim to have read a file.
    const bare = new InMemoryGraphStore();
    const body = bodyOf(
      await getCodeSnippet({ filePath: 'src/limits.ts', projectId: PROJECT }, bare),
    );
    expect(body['code']).toBe('// Code snippet not available in current session');
    expect(String(body['note'])).toContain('File system access required');
  });

  it('**a root belongs to its project**, so one project’s directory is not used to answer for another', async () => {
    const body = bodyOf(
      await getCodeSnippet({ filePath: 'src/limits.ts', projectId: 'another-project' }, context),
    );
    expect(body['code']).toBe('// Code snippet not available in current session');
  });
});
