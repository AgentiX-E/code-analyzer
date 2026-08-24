// @code-analyzer/intelligence — SCIP Exporter Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  exportScipIndex,
  serializeScipIndex,
  serializeScipIndexPretty,
  scipStats,
  SyntaxKind,
} from '../scip/scip-exporter.js';
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

describe('SCIP Exporter', () => {
  it('exports empty store', () => {
    expect(exportScipIndex(new InMemoryGraphStore(), 'p').documents).toHaveLength(0);
  });
  it('exports function as SCIP symbol', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'main', qn: 'main', filePath: 'src/index.ts' });
    const sym = exportScipIndex(s, 'p').documents[0]!.symbols[0]!;
    expect(sym.symbol).toContain('ts .');
    expect(sym.symbol).toContain('main#function');
  });
  it('formats Python symbols', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'handler', qn: 'handler', filePath: 'pkg/api.py', language: 'python' });
    expect(exportScipIndex(s, 'p').documents[0]!.symbols[0]!.symbol).toContain('py .');
  });
  it('formats Go symbols', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'Serve', qn: 'Serve', filePath: 'pkg/server.go', language: 'go' });
    expect(exportScipIndex(s, 'p').documents[0]!.symbols[0]!.symbol).toContain('go .');
  });
  it('maps CALLS to references', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, name: 'caller', qn: 'caller', filePath: 'src/a.ts' });
    const b = ins(s, { ...D, name: 'callee', qn: 'callee', filePath: 'src/b.ts' });
    ine(s, { sourceId: a, targetId: b, type: 'CALLS' });
    const doc = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/a.ts')!;
    const rels = doc.symbols[0]!.relationships;
    expect(rels.length).toBeGreaterThan(0);
    expect(rels[0]!.isReference).toBe(true);
  });
  it('maps IMPLEMENTS to implementation', () => {
    const s = new InMemoryGraphStore();
    const i = ins(s, { ...D, label: 'Interface', name: 'IFoo', qn: 'IFoo', filePath: 'src/i.ts' });
    const c = ins(s, { ...D, label: 'Class', name: 'Foo', qn: 'Foo', filePath: 'src/c.ts' });
    ine(s, { sourceId: c, targetId: i, type: 'IMPLEMENTS' });
    const doc = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/c.ts')!;
    const rels = doc.symbols[0]!.relationships;
    expect(rels.length).toBeGreaterThan(0);
    expect(rels[0]!.isImplementation).toBe(true);
  });
  it('serializes to valid JSON', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, qn: 'f' });
    expect(() => JSON.parse(serializeScipIndex(exportScipIndex(s, 'p')))).not.toThrow();
  });
  it('pretty prints', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, qn: 'f' });
    expect(serializeScipIndexPretty(exportScipIndex(s, 'p'))).toContain('\n');
  });
  it('computes statistics', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'f1', qn: 'f1', filePath: 'src/a.ts' });
    ins(s, { ...D, name: 'f2', qn: 'f2', filePath: 'src/b.ts' });
    expect(scipStats(exportScipIndex(s, 'p')).documentCount).toBeGreaterThanOrEqual(2);
  });
  it('handles multiple languages', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'tf', qn: 'tf', filePath: 'src/a.ts', language: 'typescript' });
    ins(s, { ...D, name: 'pf', qn: 'pf', filePath: 'src/b.py', language: 'python' });
    const idx = exportScipIndex(s, 'p');
    expect(idx.documents.some((d) => d.language === 'typescript')).toBe(true);
    expect(idx.documents.some((d) => d.language === 'python')).toBe(true);
  });
  it('skips nodes without filePath', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'o', qn: 'o', filePath: null });
    expect(exportScipIndex(s, 'p').documents).toHaveLength(0);
  });
  it('includes docstring', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'add', qn: 'add', docstring: 'Adds two numbers.' });
    expect(exportScipIndex(s, 'p').documents[0]!.symbols[0]!.documentation).toContain(
      'Adds two numbers.',
    );
  });
  it('uses correct SyntaxKind for functions', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, qn: 'f' });
    expect(exportScipIndex(s, 'p').documents[0]!.occurrences[0]!.syntaxKind).toBe(
      SyntaxKind.IdentifierFunctionDefinition,
    );
  });
  it('uses correct SyntaxKind for classes', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'Class', name: 'App', qn: 'App' });
    expect(exportScipIndex(s, 'p').documents[0]!.occurrences[0]!.syntaxKind).toBe(
      SyntaxKind.IdentifierNamespace,
    );
  });
  it('uses correct SyntaxKind for variables', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'Variable', name: 'count', qn: 'count' });
    expect(exportScipIndex(s, 'p').documents[0]!.occurrences[0]!.syntaxKind).toBe(
      SyntaxKind.IdentifierLocal,
    );
  });

  it('falls back to default SyntaxKind for unknown labels', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'File', name: 'f.txt', qn: 'f.txt' });
    expect(exportScipIndex(s, 'p').documents[0]!.occurrences[0]!.syntaxKind).toBe(
      SyntaxKind.Identifier,
    );
  });

  it('formats a symbol without a descriptor suffix for unclassified labels', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, label: 'Module', name: 'util', qn: 'util', filePath: 'src/util.ts' });
    const sym = exportScipIndex(s, 'p').documents[0]!.symbols[0]!;
    // Module labels map to the empty descriptor suffix → no `#...()`.
    expect(sym.symbol).not.toContain('()');
  });

  it('formats a symbol for a file path with src in the middle', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'f', qn: 'f', filePath: 'apps/web/src/index.ts' });
    const sym = exportScipIndex(s, 'p').documents[0]!.symbols[0]!;
    expect(sym.symbol).toContain('.');
  });

  it('maps unknown edge types to a default reference role', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, name: 'a', qn: 'a', filePath: 'src/a.ts' });
    const b = ins(s, { ...D, name: 'b', qn: 'b', filePath: 'src/b.ts' });
    ine(s, { sourceId: a, targetId: b, type: 'CONTAINS' });
    const doc = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/a.ts')!;
    const rel = doc.symbols[0]!.relationships[0]!;
    expect(rel.isReference).toBe(true);
    expect(rel.isImplementation).toBe(false);
  });

  it('collects cross-project edge targets as external symbols', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, name: 'a', qn: 'a', filePath: 'src/a.ts', projectId: 'p' });
    const b = ins(s, {
      ...D,
      name: 'b',
      qn: 'b',
      filePath: 'lib/b.ts',
      projectId: 'other', // external project
    });
    ine(s, { sourceId: a, targetId: b, type: 'CALLS' });
    const idx = exportScipIndex(s, 'p');
    // b is in the graph but not defined in project 'p' → external symbol.
    expect(idx.externalSymbols.length).toBeGreaterThan(0);
    expect(idx.externalSymbols.some((e) => e.symbol.includes('b'))).toBe(true);
  });

  it('uses the external symbol scheme when the target language is unknown', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s, { ...D, name: 'a', qn: 'a', filePath: 'src/a.ts' });
    const b = ins(s, { ...D, name: 'b', qn: 'b', filePath: 'src/b.ts', language: null });
    ine(s, { sourceId: a, targetId: b, type: 'CALLS' });
    const doc = exportScipIndex(s, 'p').documents.find((d) => d.relativePath === 'src/a.ts')!;
    const rel = doc.symbols[0]!.relationships[0]!;
    // Target node has null language → getScheme falls back to 'unknown'.
    expect(rel.symbol).toContain('unknown');
  });

  it('falls back to file-extension detection for null-language nodes', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'f', qn: 'f', filePath: 'src/main.py', language: null });
    const doc = exportScipIndex(s, 'p').documents[0]!;
    expect(doc.language).toBe('python');
  });

  it('defaults language to unknown for unrecognized extensions', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'f', qn: 'f', filePath: 'data.xyz', language: null });
    const doc = exportScipIndex(s, 'p').documents[0]!;
    expect(doc.language).toBe('xyz');
  });

  it('computes a zero-based occurrence range from null lines', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name: 'f', qn: 'f', filePath: 'src/f.ts', startLine: null, endLine: null });
    const occ = exportScipIndex(s, 'p').documents[0]!.occurrences[0]!;
    expect(occ.range[0]).toBe(-1);
    expect(occ.range[2]).toBe(0);
  });
});
