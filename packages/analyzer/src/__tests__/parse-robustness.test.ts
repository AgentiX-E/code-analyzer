// @code-analyzer/analyzer — what a parser owes an input it did not choose.
//
// **Three defects, one shape: the index treated one file as if it were the repository.** A generated API page in
// `redis/ioredis@5.4.2` overflowed the stack in the doc-comment pass, the `parse` phase failed as a whole, and 174
// discovered files produced a graph with **zero** `CALLS` edges - the failure that made the TypeScript corpus
// measurable at all. A JSON array nested 20 000 deep did the same thing on its own. And a phase-level `try` meant the
// only way to fail was to fail everything, which is why `filesFailed` had always reported `0`.
//
// **The inputs here are synthetic on purpose.** The real one is a 5.8 MB HTML page in a tarball, and a test that
// needs a network download is a test that skips.

import { describe, it, expect } from 'vitest';

import { getOrLoadProvider } from '../pipeline/phase-helpers.js';
import { ParsePhase } from '../pipeline/phases/parse.js';

import type {
  CodeAnalyzerConfig,
  DiscoveredFile,
  PipelineContext,
  SupportedLanguage,
} from '@code-analyzer/shared';

function makeConfig(): CodeAnalyzerConfig {
  return {
    projectId: 'robustness',
    rootPath: '/proj',
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 0,
    maxFiles: 0,
    parseWorkers: 1,
    ignorePaths: [],
  };
}

function makeFile(filePath: string, language: SupportedLanguage, content: string): DiscoveredFile {
  return { filePath, language, content, hash: 'h', size: String(content ?? '').length };
}

describe('the doc-comment pass on a file with more captures than an argument list can hold', () => {
  it('parses a page whose capture list is longer than V8 will spread', async () => {
    // **The number is the point.** `captures.push(...kept)` is an argument list, and V8 raises
    // `RangeError: Maximum call stack size exceeded` somewhere above 100 000 arguments - the real page carried
    // 127 336 captures. Fifty thousand elements with one comment each is the cheapest input that crosses the line.
    const content = '<html><body>' + '<div><!-- note --></div>'.repeat(50_000) + '</body></html>';
    const provider = await getOrLoadProvider('html');
    expect(provider).not.toBeNull();

    const captures = provider!.parse(content, '/proj/generated/docs/classes/Big.html');

    expect(captures.length).toBeGreaterThan(100_000);
    // Every element is still a capture and the comments are still there: the pass copies, it does not prune. The HTML
    // grammar maps its comments to the `docstring` tag, which is what a comment is for in markup - documentation.
    expect(captures.some((capture) => capture.tag === 'docstring')).toBe(true);
  }, 60_000);
});

describe('a walk that cannot fit in the stack', () => {
  it('degrades a 20 000-deep JSON array to the reader instead of raising', async () => {
    const provider = await getOrLoadProvider('json');
    expect(provider).not.toBeNull();

    const captures = provider!.parse('['.repeat(20_000) + ']'.repeat(20_000), '/proj/deep.json');

    // The reader finds no declarations in a bare array, and **an empty answer that is reported beats a stack trace**.
    expect(captures).toEqual([]);
    expect(provider!.lastParseWasARegularExpressionFallback).toBe(true);
  }, 30_000);

  it('degrades a 20 000-deep JavaScript expression the same way', async () => {
    const provider = await getOrLoadProvider('javascript');
    expect(provider).not.toBeNull();

    const content = `x = ${'('.repeat(20_000)}1${')'.repeat(20_000)};`;
    expect(() => provider!.parse(content, '/proj/deep.js')).not.toThrow();
    expect(provider!.lastParseWasARegularExpressionFallback).toBe(true);
  }, 30_000);

  it('rethrows a failure that is not the stack running out', async () => {
    // The guard is for one specific condition. A provider bug must still be a bug, not a quiet fallback.
    const provider = await getOrLoadProvider('typescript');
    expect(provider).not.toBeNull();
    expect(() => provider!.parse(undefined as unknown as string, '/proj/a.ts')).toThrow();
  });
});

describe('the parse phase, when one of its files cannot be read', () => {
  it('parses the rest of the repository and reports the one it could not', async () => {
    const ctx: PipelineContext = {
      projectId: 'robustness',
      rootPath: '/proj',
      phaseData: new Map([
        [
          'scan',
          {
            discoveredFiles: [
              // A record the reader could not decode: the content is not a string, so `sanitizeSource` raises.
              makeFile('/proj/broken.ts', 'typescript', undefined as unknown as string),
              makeFile('/proj/ok.ts', 'typescript', 'export function keep() { return 1; }\n'),
            ],
          },
        ],
      ]),
      config: makeConfig(),
    };

    const result = await new ParsePhase().execute(ctx);

    expect(result.status).toBe('success');
    expect(result.output).toMatchObject({ filesParsed: 1, filesFailed: 1 });
    const parseData = ctx.phaseData.get('parse') as {
      parsedFiles: Array<{ filePath: string }>;
      filesFailed: number;
      failurePaths: Array<{ filePath: string; message: string }>;
    };
    expect(parseData.parsedFiles.map((file) => file.filePath)).toEqual(['/proj/ok.ts']);
    expect(parseData.filesFailed).toBe(1);
    expect(parseData.failurePaths).toHaveLength(1);
    expect(parseData.failurePaths[0]!.filePath).toBe('/proj/broken.ts');
    expect(parseData.failurePaths[0]!.message.length).toBeGreaterThan(0);
  });

  it('counts every failure but carries only the messages it can act on', async () => {
    // **The count is unbounded and the messages are capped**, because an index that reported "20 files failed" when
    // 3 000 did would be lying about its own completeness. Twenty-one broken files is one more than the cap.
    const broken = Array.from({ length: 21 }, (_unused, index) =>
      makeFile(`/proj/broken-${index}.ts`, 'typescript', undefined as unknown as string),
    );
    const ctx: PipelineContext = {
      projectId: 'robustness',
      rootPath: '/proj',
      phaseData: new Map([
        [
          'scan',
          {
            discoveredFiles: [
              ...broken,
              makeFile('/proj/ok.ts', 'typescript', 'export const a = 1;\n'),
            ],
          },
        ],
      ]),
      config: makeConfig(),
    };

    const result = await new ParsePhase().execute(ctx);

    expect(result.output).toMatchObject({ filesParsed: 1, filesFailed: 21 });
    expect((ctx.phaseData.get('parse') as { failurePaths: unknown[] }).failurePaths).toHaveLength(
      20,
    );
  });

  it('reports zero failures on a corpus it can read entirely', async () => {
    const ctx: PipelineContext = {
      projectId: 'robustness',
      rootPath: '/proj',
      phaseData: new Map([
        [
          'scan',
          {
            discoveredFiles: [makeFile('/proj/a.ts', 'typescript', 'export const a = 1;\n')],
          },
        ],
      ]),
      config: makeConfig(),
    };

    const result = await new ParsePhase().execute(ctx);

    expect(result.output).toMatchObject({ filesParsed: 1, filesFailed: 0 });
    expect((ctx.phaseData.get('parse') as { failurePaths: unknown[] }).failurePaths).toEqual([]);
  });
});
