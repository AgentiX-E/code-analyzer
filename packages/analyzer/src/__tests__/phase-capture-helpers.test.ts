// @code-analyzer/analyzer — the pure helpers the pipeline shares between its phases
//
// These five functions convert a capture into a node label, a capture into a reference kind, group a file's captures into
// symbols, read a call's receiver, and coerce a thrown value into a phase failure. They lived in a test file that also
// covered three `Parallel*Phase` classes; those classes had no production caller and were deleted in iteration 94, so
// what is left here is the half that the pipeline actually runs.

import { CAPTURE_TAGS, createNoopPhaseLogger } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import {
  captureTagToNodeLabel,
  captureTagToReferenceKind,
  groupCaptures,
  getOrLoadProvider,
  receiverOf,
  toPhaseFailure,
} from '../pipeline/phase-helpers.js';

import type { UnifiedCapture, PhaseLogger } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCapture(
  tag: UnifiedCapture['tag'],
  overrides: Partial<UnifiedCapture> = {},
): UnifiedCapture {
  return {
    tag,
    text: 'sample',
    startLine: 1,
    endLine: 1,
    startByte: 0,
    endByte: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// captureTagToNodeLabel
// ---------------------------------------------------------------------------

describe('captureTagToNodeLabel', () => {
  const cases: Array<[string, string]> = [
    [CAPTURE_TAGS.FUNCTION_DEF, 'Function'],
    [CAPTURE_TAGS.FUNCTION_CALL, 'Function'],
    [CAPTURE_TAGS.METHOD_DEF, 'Method'],
    [CAPTURE_TAGS.METHOD_CALL, 'Method'],
    [CAPTURE_TAGS.CLASS_DEF, 'Class'],
    [CAPTURE_TAGS.INTERFACE_DEF, 'Interface'],
    [CAPTURE_TAGS.ENUM_DEF, 'Enum'],
    [CAPTURE_TAGS.TYPE_DEF, 'TypeAlias'],
    [CAPTURE_TAGS.VARIABLE_DEF, 'Variable'],
    [CAPTURE_TAGS.VARIABLE_ACCESS, 'Variable'],
    [CAPTURE_TAGS.CONSTANT_DEF, 'Variable'],
    [CAPTURE_TAGS.CONSTRUCTOR_DEF, 'Constructor'],
    [CAPTURE_TAGS.PROPERTY_DEF, 'Property'],
    [CAPTURE_TAGS.STRUCT_DEF, 'Struct'],
    [CAPTURE_TAGS.TRAIT_DEF, 'Trait'],
    [CAPTURE_TAGS.ROUTE_PATH, 'Route'],
    [CAPTURE_TAGS.ROUTE_METHOD, 'Route'],
    [CAPTURE_TAGS.COMPONENT_PROPS, 'Component'],
  ];

  it.each(cases)('maps %s to %s', (tag, label) => {
    expect(captureTagToNodeLabel(tag)).toBe(label);
  });

  it('falls back to Variable for an unmapped tag', () => {
    // DECORATOR is not part of the switch, so it hits the default arm.
    expect(captureTagToNodeLabel(CAPTURE_TAGS.DECORATOR)).toBe('Variable');
    expect(captureTagToNodeLabel('unknown.tag')).toBe('Variable');
  });
});

// ---------------------------------------------------------------------------
// captureTagToReferenceKind
// ---------------------------------------------------------------------------

describe('captureTagToReferenceKind', () => {
  const cases: Array<[string, string]> = [
    [CAPTURE_TAGS.FUNCTION_CALL, 'call'],
    [CAPTURE_TAGS.METHOD_CALL, 'call'],
    [CAPTURE_TAGS.IMPORT, 'import'],
    [CAPTURE_TAGS.IMPORT_NAMED, 'import'],
    [CAPTURE_TAGS.IMPORT_DEFAULT, 'import'],
    [CAPTURE_TAGS.IMPORT_WILDCARD, 'import'],
    [CAPTURE_TAGS.TYPE_REFERENCE, 'type'],
    [CAPTURE_TAGS.VARIABLE_ACCESS, 'access'],
  ];

  it.each(cases)('maps %s to %s', (tag, kind) => {
    expect(captureTagToReferenceKind(tag)).toBe(kind);
  });

  it('falls back to call for an unmapped tag', () => {
    // NEW_EXPRESSION is not part of the reference switch, so it hits default.
    expect(captureTagToReferenceKind(CAPTURE_TAGS.NEW_EXPRESSION)).toBe('call');
    expect(captureTagToReferenceKind('unknown.tag')).toBe('call');
  });
});

// ---------------------------------------------------------------------------
// groupCaptures
// ---------------------------------------------------------------------------

describe('groupCaptures', () => {
  it('returns empty symbols/references and a default scope tree for no captures', () => {
    const { symbols, references, scopeTree } = groupCaptures([], '/app/src/a.ts');
    expect(symbols).toEqual([]);
    expect(references).toEqual([]);
    expect(scopeTree.name).toBe('a.ts');
    expect(scopeTree.kind).toBe('File');
    expect(scopeTree.startLine).toBe(1);
    expect(scopeTree.endLine).toBe(1);
    expect(scopeTree.children).toEqual([]);
    expect(scopeTree.symbols).toEqual([]);
  });

  it('converts a definition capture into a symbol (name fallback to text)', () => {
    const { symbols, references, scopeTree } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.FUNCTION_DEF, {
          name: 'doWork',
          startLine: 10,
          endLine: 30,
          properties: { signature: 'doWork(x)', returnType: 'Result', docstring: 'Docs' },
        }),
      ],
      '/app/src/a.ts',
    );
    expect(symbols).toHaveLength(1);
    const s = symbols[0]!;
    expect(s.name).toBe('doWork');
    expect(s.kind).toBe('Function');
    expect(s.qualifiedName).toBe('file:/app/src/a.ts:doWork');
    expect(s.startLine).toBe(10);
    expect(s.endLine).toBe(30);
    expect(s.signature).toBe('doWork(x)');
    expect(s.returnType).toBe('Result');
    expect(s.docstring).toBe('Docs');
    expect(s.isExported).toBe(false);
    expect(s.visibility).toBe('public');
    expect(references).toEqual([]);
    // scopeTree endLine is the max capture endLine.
    expect(scopeTree.endLine).toBe(30);
    expect(scopeTree.children).toHaveLength(1);
    expect(scopeTree.symbols).toEqual(['file:/app/src/a.ts:doWork']);
  });

  it('uses capture.text as the name when name is absent', () => {
    const { symbols } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.CLASS_DEF, { text: 'MyClass', endLine: 5 })],
      '/app/src/a.ts',
    );
    expect(symbols[0]!.name).toBe('MyClass');
    expect(symbols[0]!.qualifiedName).toBe('file:/app/src/a.ts:MyClass');
  });

  it('prefixes the qualified name with containerName when present', () => {
    const { symbols } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.METHOD_DEF, {
          name: 'run',
          containerName: 'MyClass',
          endLine: 3,
        }),
      ],
      '/app/src/a.ts',
    );
    expect(symbols[0]!.qualifiedName).toBe('MyClass.run');
    expect(symbols[0]!.containerName).toBe('MyClass');
  });

  it('converts a reference capture into a reference site', () => {
    const { symbols, references } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.FUNCTION_CALL, { name: 'target', startLine: 7 }),
        makeCapture(CAPTURE_TAGS.TYPE_REFERENCE, { text: 'Foo' }),
      ],
      '/app/src/a.ts',
    );
    expect(symbols).toEqual([]);
    expect(references).toHaveLength(2);
    expect(references[0]).toEqual({
      sourceFile: '/app/src/a.ts',
      sourceLine: 7,
      sourceColumn: 0,
      targetName: 'target',
      referenceKind: 'call',
    });
    expect(references[1]!.targetName).toBe('Foo');
    expect(references[1]!.referenceKind).toBe('type');
  });

  it('ignores captures that are neither definitions nor references', () => {
    const { symbols, references } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.DECORATOR, { name: 'inject' })],
      '/app/src/a.ts',
    );
    expect(symbols).toEqual([]);
    expect(references).toEqual([]);
  });

  it('carries the receiver of a method call into the reference the resolver reads', () => {
    // **The receiver is the whole difference between a bound method and a free function of the same name.** Both
    // captures below say "call `get`"; only the first says it was called on `request.args`, and a resolver that
    // cannot see that has to guess - which is how a five-line `__getattr__` in flask collected edges to `pop`,
    // `setdefault` and `__repr__`.
    const { references } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.METHOD_CALL, {
          name: 'get',
          text: 'request.args.get',
          startLine: 4,
        }),
        makeCapture(CAPTURE_TAGS.METHOD_CALL, { name: 'rollback', text: 'rollback', startLine: 5 }),
      ],
      '/app/src/a.py',
    );
    expect(references[0]).toMatchObject({ targetName: 'get', receiver: 'request.args' });
    // A provider that stored the callee as a bare name reports no receiver, which reads as "the caller's scope".
    expect(references[1]).not.toHaveProperty('receiver');
  });
});

// ---------------------------------------------------------------------------
// receiverOf
// ---------------------------------------------------------------------------

describe('receiverOf', () => {
  it('reports what stood before the last dot, so a chained call keeps its full receiver', () => {
    expect(receiverOf(CAPTURE_TAGS.METHOD_CALL, 'self.get', 'get')).toBe('self');
    expect(receiverOf(CAPTURE_TAGS.METHOD_CALL, 'request.args.get', 'get')).toBe('request.args');
  });

  it('reports nothing when the provider stored the callee as a bare name', () => {
    // Reading `get` as if it had a receiver would invent one; `undefined` is the answer that says "own scope".
    expect(receiverOf(CAPTURE_TAGS.METHOD_CALL, 'get', 'get')).toBeUndefined();
  });

  it('reports nothing for a capture that is not a method call', () => {
    // A `FUNCTION_CALL` capture is a bare name by definition, whatever its text looks like.
    expect(receiverOf(CAPTURE_TAGS.FUNCTION_CALL, 'get', 'get')).toBeUndefined();
    expect(receiverOf(CAPTURE_TAGS.IMPORT_NAMED, 'os.path', 'path')).toBeUndefined();
  });

  it('reports nothing when the capture has no text to read', () => {
    expect(receiverOf(CAPTURE_TAGS.METHOD_CALL, undefined, 'get')).toBeUndefined();
  });

  it('reports nothing when the text names a different callee', () => {
    // `self.get` captured for a target of `set`: the segment after the dot disagrees, so this text is not a
    // spelling of that call and cannot be read as its receiver.
    expect(receiverOf(CAPTURE_TAGS.METHOD_CALL, 'self.get', 'set')).toBeUndefined();
  });

  it('reports nothing when the dot leads the text', () => {
    // `.get` has no receiver before the dot - the empty string is not one.
    expect(receiverOf(CAPTURE_TAGS.METHOD_CALL, '.get', 'get')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getOrLoadProvider
// ---------------------------------------------------------------------------

describe('getOrLoadProvider', () => {
  const languages = [
    'typescript',
    'javascript',
    'python',
    'go',
    'java',
    'kotlin',
    'csharp',
    'rust',
    'yaml',
    'json',
    'sql',
    'bash',
    'toml',
    'markdown',
    'html',
    'css',
    'r',
    'groovy',
  ];

  it('loads a provider for every supported language', async () => {
    for (const language of languages) {
      const provider = await getOrLoadProvider(language);
      expect(provider, `provider for ${language}`).not.toBeNull();
      expect(typeof provider!.parse).toBe('function');
    }
  }, 60_000);

  it('returns the same cached instance on a second load', async () => {
    const first = await getOrLoadProvider('typescript');
    const second = await getOrLoadProvider('typescript');
    expect(second).toBe(first);
  });

  it('returns null for an unknown language', async () => {
    expect(await getOrLoadProvider('nosuch-language')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toPhaseFailure
// ---------------------------------------------------------------------------

describe('toPhaseFailure', () => {
  it('uses err.message for an Error', () => {
    const result = toPhaseFailure(new Error('boom'), 'scan', createNoopPhaseLogger());
    expect(result).toEqual({ phaseId: 'scan', status: 'failed', error: 'boom' });
  });

  it('coerces a non-Error throw to its string form', () => {
    const result = toPhaseFailure('boom', 'parse', createNoopPhaseLogger(), '/fake/project');
    expect(result).toEqual({ phaseId: 'parse', status: 'failed', error: 'boom' });
  });

  it('coerces an arbitrary object via String()', () => {
    const result = toPhaseFailure({ toString: () => 'obj' }, 'dump', createNoopPhaseLogger());
    expect(result.error).toBe('obj');
  });

  it('reports through the supplied logger without throwing', () => {
    const seen: Array<{ message: string; error: unknown; context?: unknown }> = [];
    const logger: PhaseLogger = {
      ...createNoopPhaseLogger(),
      error: (message: string, error: unknown, context?: unknown) => {
        seen.push({ message, error, context });
      },
    };
    const result = toPhaseFailure('x', 'scan', logger, '/root');
    expect(result.status).toBe('failed');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toBe('Phase execution failed');
    expect(seen[0]!.error).toBeInstanceOf(Error);
    expect(seen[0]!.context).toEqual({ phaseId: 'scan', filePath: '/root' });
  });
});
