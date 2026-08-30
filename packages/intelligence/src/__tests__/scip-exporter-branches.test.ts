// @code-analyzer/intelligence — SCIP Exporter Branch Tests
// Exercises the remaining descriptor kinds, edge-role mappings, and
// syntax-kind classifications that the happy-path exporter tests do not reach.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { exportScipIndex, SyntaxKind } from '../scip/scip-exporter.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

const NOW = new Date().toISOString();
const D = {
  projectId: 'p',
  filePath: 'src/x.ts',
  startLine: 1,
  endLine: 2,
  language: 'typescript',
};

function ins(s: InMemoryGraphStore, o: Record<string, unknown>) {
  return s.insertNode({
    id: 0,
    projectId: 'p',
    label: 'Function',
    name: 'f',
    qualifiedName: (o['qn'] || o['name'] || 'f') as string,
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  } as GraphNode);
}

function ine(s: InMemoryGraphStore, o: Record<string, unknown>) {
  return s.insertEdge({
    id: 0,
    projectId: 'p',
    sourceId: 0,
    targetId: 0,
    type: 'CALLS',
    ...o,
  } as GraphEdge);
}

describe('SCIP Exporter — branch coverage', () => {
  it('formats Method and Constructor labels with the method descriptor', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'Method', name: 'run', qn: 'run', filePath: 'src/m.ts' });
    ins(s, { ...D, label: 'Constructor', name: 'init', qn: 'init', filePath: 'src/c.ts' });

    const idx = exportScipIndex(s, 'p');
    const m = idx.documents.find((d) => d.relativePath === 'src/m.ts')!.symbols[0]!;
    const c = idx.documents.find((d) => d.relativePath === 'src/c.ts')!.symbols[0]!;
    expect(m.symbol).toContain('#method().');
    expect(c.symbol).toContain('#method().');
  });

  it('formats Parameter labels with the parameter descriptor', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'Parameter', name: 'arg', qn: 'arg', filePath: 'src/p.ts' });

    const idx = exportScipIndex(s, 'p');
    expect(idx.documents[0]!.symbols[0]!.symbol).toContain('#parameter().');
  });

  it('classifies an Enum label as IdentifierConstant', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'Enum', name: 'Color', qn: 'Color', filePath: 'src/e.ts' });

    const idx = exportScipIndex(s, 'p');
    expect(idx.documents[0]!.occurrences[0]!.syntaxKind).toBe(SyntaxKind.IdentifierConstant);
  });

  it('classifies a Constant label as IdentifierConstant', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'Constant', name: 'MAX', qn: 'MAX', filePath: 'src/k.ts' });

    const idx = exportScipIndex(s, 'p');
    expect(idx.documents[0]!.occurrences[0]!.syntaxKind).toBe(SyntaxKind.IdentifierConstant);
  });

  it('maps EXTENDS to a definition edge with a type-definition relationship', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, label: 'Class', name: 'A', qn: 'A', filePath: 'src/a.ts' });
    const b = ins(s, { ...D, label: 'Class', name: 'B', qn: 'B', filePath: 'src/b.ts' });
    ine(s, { sourceId: a, targetId: b, type: 'EXTENDS' });

    const rel = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/a.ts')!
      .symbols[0]!.relationships[0]!;
    expect(rel.isDefinition).toBe(true);
    expect(rel.isTypeDefinition).toBe(true);
    expect(rel.isReference).toBe(false);
    expect(rel.isImplementation).toBe(false);
  });

  it('maps IMPORTS to a reference edge', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, label: 'Function', name: 'a', qn: 'a', filePath: 'src/a.ts' });
    const b = ins(s, { ...D, label: 'Function', name: 'b', qn: 'b', filePath: 'src/b.ts' });
    ine(s, { sourceId: a, targetId: b, type: 'IMPORTS' });

    const rel = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/a.ts')!
      .symbols[0]!.relationships[0]!;
    expect(rel.isReference).toBe(true);
    expect(rel.isDefinition).toBe(false);
    expect(rel.isTypeDefinition).toBe(false);
  });

  it('maps DEFINES to a plain definition edge', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, label: 'Function', name: 'a', qn: 'a', filePath: 'src/a.ts' });
    const b = ins(s, { ...D, label: 'Function', name: 'b', qn: 'b', filePath: 'src/b.ts' });
    ine(s, { sourceId: a, targetId: b, type: 'DEFINES' });

    const rel = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/a.ts')!
      .symbols[0]!.relationships[0]!;
    expect(rel.isDefinition).toBe(true);
    expect(rel.isTypeDefinition).toBe(false);
    expect(rel.isReference).toBe(false);
  });

  it('maps METHOD_OVERRIDES to an implementation edge', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, label: 'Method', name: 'run', qn: 'A.run', filePath: 'src/a.ts' });
    const b = ins(s, { ...D, label: 'Method', name: 'run', qn: 'B.run', filePath: 'src/b.ts' });
    ine(s, { sourceId: a, targetId: b, type: 'METHOD_OVERRIDES' });

    const rel = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/a.ts')!
      .symbols[0]!.relationships[0]!;
    expect(rel.isImplementation).toBe(true);
    expect(rel.isReference).toBe(false);
    expect(rel.isDefinition).toBe(false);
    expect(rel.isTypeDefinition).toBe(false);
  });

  it('defaults to unknown language for a path with no extension', () => {
    const s = new InMemoryGraphStore();
    // A trailing dot yields an empty extension segment, driving detectLanguage's
    // `ext ? ... : 'unknown'` fallback.
    ins(s, { ...D, label: 'Function', name: 'fn', qn: 'fn', language: null, filePath: 'src/foo.' });

    const idx = exportScipIndex(s, 'p');
    expect(idx.documents[0]!.language).toBe('unknown');
  });
});
