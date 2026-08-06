// @code-analyzer/intelligence — SCIP Exporter Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { exportScipIndex, serializeScipIndex, serializeScipIndexPretty, scipStats, SyntaxKind } from '../scip/scip-exporter.js';

const NOW = new Date().toISOString();
const D = { projectId: 'p', filePath: 'src/x.ts', startLine: 1, endLine: 2, language: 'typescript' };
function ins(s, o) {
  return s.insertNode({ id:0,projectId:'p',label:'Function',name:'f',qualifiedName:o.qn||o.name||'f',filePath:null,startLine:null,endLine:null,language:null,properties:{},signature:null,docstring:null,complexity:null,isExported:false,fingerprint:null,createdAt:NOW,updatedAt:NOW, ...o });
}
function ine(s, o) {
  return s.insertEdge({ id:0,projectId:'p',sourceId:0,targetId:0,type:'CALLS', ...o });
}

describe('SCIP Exporter', () => {
  it('exports empty store', () => {
    expect(exportScipIndex(new InMemoryGraphStore(),'p').documents).toHaveLength(0);
  });
  it('exports function as SCIP symbol', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name:'main', qn:'main', filePath:'src/index.ts' });
    const sym = exportScipIndex(s,'p').documents[0].symbols[0];
    expect(sym.symbol).toContain('ts .'); expect(sym.symbol).toContain('main#function');
  });
  it('formats Python symbols', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name:'handler', qn:'handler', filePath:'pkg/api.py', language:'python' });
    expect(exportScipIndex(s,'p').documents[0].symbols[0].symbol).toContain('py .');
  });
  it('formats Go symbols', () => {
    const s = new InMemoryGraphStore();
    ins(s, { ...D, name:'Serve', qn:'Serve', filePath:'pkg/server.go', language:'go' });
    expect(exportScipIndex(s,'p').documents[0].symbols[0].symbol).toContain('go .');
  });
  it('maps CALLS to references', () => {
    const s = new InMemoryGraphStore();
    const a = ins(s,{...D,name:'caller',qn:'caller',filePath:'src/a.ts'});
    const b = ins(s,{...D,name:'callee',qn:'callee',filePath:'src/b.ts'});
    ine(s,{sourceId:a,targetId:b,type:'CALLS'});
    const rels = exportScipIndex(s,'p').documents.find(d=>d.relativePath==='src/a.ts').symbols[0].relationships;
    expect(rels.length).toBeGreaterThan(0); expect(rels[0].isReference).toBe(true);
  });
  it('maps IMPLEMENTS to implementation', () => {
    const s = new InMemoryGraphStore();
    const i = ins(s,{...D,label:'Interface',name:'IFoo',qn:'IFoo',filePath:'src/i.ts'});
    const c = ins(s,{...D,label:'Class',name:'Foo',qn:'Foo',filePath:'src/c.ts'});
    ine(s,{sourceId:c,targetId:i,type:'IMPLEMENTS'});
    const rels = exportScipIndex(s,'p').documents.find(d=>d.relativePath==='src/c.ts').symbols[0].relationships;
    expect(rels.length).toBeGreaterThan(0); expect(rels[0].isImplementation).toBe(true);
  });
  it('serializes to valid JSON', () => {
    const s = new InMemoryGraphStore(); ins(s,{...D,qn:'f'});
    expect(() => JSON.parse(serializeScipIndex(exportScipIndex(s,'p')))).not.toThrow();
  });
  it('pretty prints', () => {
    const s = new InMemoryGraphStore(); ins(s,{...D,qn:'f'});
    expect(serializeScipIndexPretty(exportScipIndex(s,'p'))).toContain('\n');
  });
  it('computes statistics', () => {
    const s = new InMemoryGraphStore();
    ins(s,{...D,name:'f1',qn:'f1',filePath:'src/a.ts'});
    ins(s,{...D,name:'f2',qn:'f2',filePath:'src/b.ts'});
    expect(scipStats(exportScipIndex(s,'p')).documentCount).toBeGreaterThanOrEqual(2);
  });
  it('handles multiple languages', () => {
    const s = new InMemoryGraphStore();
    ins(s,{...D,name:'tf',qn:'tf',filePath:'src/a.ts',language:'typescript'});
    ins(s,{...D,name:'pf',qn:'pf',filePath:'src/b.py',language:'python'});
    const idx = exportScipIndex(s,'p');
    expect(idx.documents.some(d=>d.language==='typescript')).toBe(true);
    expect(idx.documents.some(d=>d.language==='python')).toBe(true);
  });
  it('skips nodes without filePath', () => {
    const s = new InMemoryGraphStore();
    ins(s,{...D,name:'o',qn:'o',filePath:null});
    expect(exportScipIndex(s,'p').documents).toHaveLength(0);
  });
  it('includes docstring', () => {
    const s = new InMemoryGraphStore();
    ins(s,{...D,name:'add',qn:'add',docstring:'Adds two numbers.'});
    expect(exportScipIndex(s,'p').documents[0].symbols[0].documentation).toContain('Adds two numbers.');
  });
  it('uses correct SyntaxKind for functions', () => {
    const s = new InMemoryGraphStore(); ins(s,{...D,qn:'f'});
    expect(exportScipIndex(s,'p').documents[0].occurrences[0].syntaxKind).toBe(SyntaxKind.IdentifierFunctionDefinition);
  });
  it('uses correct SyntaxKind for classes', () => {
    const s = new InMemoryGraphStore(); ins(s,{...D,label:'Class',name:'App',qn:'App'});
    expect(exportScipIndex(s,'p').documents[0].occurrences[0].syntaxKind).toBe(SyntaxKind.IdentifierNamespace);
  });
  it('uses correct SyntaxKind for variables', () => {
    const s = new InMemoryGraphStore(); ins(s,{...D,label:'Variable',name:'count',qn:'count'});
    expect(exportScipIndex(s,'p').documents[0].occurrences[0].syntaxKind).toBe(SyntaxKind.IdentifierLocal);
  });
});
