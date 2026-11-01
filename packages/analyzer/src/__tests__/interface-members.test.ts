// A method a contract declares is a declaration, and it is the one a call on a contract reaches.
//
// **The gap this file exists for.** `interface Respondable { resolve(result: any): void }` in
// `redis/ioredis@5.4.2` declares `resolve`, every implementation of it writes a body, and the graph had **neither**:
// the TypeScript provider emitted an `interface.def` for the interface and nothing at all for its members, so a call
// written on a receiver whose type is the contract resolved to no declaration. Measured on the checker's own answers,
// three of ioredis's unanswered call pairs point at exactly that: `resolve`, `handleReconnection`,
// `recoverFromFatalError` are members of `Respondable` and `Condition`, not of any class.
//
// **A contract member is not a body, and the tests say so.** It has no calls inside it, so it is never a *source* of
// an edge; what it is is what an edge can *reach*, which is what makes `repository.find(id)` resolvable at the one
// place the source names the type explicitly.

import { describe, expect, it, beforeAll } from 'vitest';

import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { getOrLoadProvider, groupCaptures } from '../pipeline/phase-helpers.js';
import {
  CrossFilePhase,
  ParsePhase,
  ScanPhase,
  ScopeResolutionPhase,
  StructurePhase,
} from '../pipeline/phases/index.js';

import type { KnowledgeGraph, PipelineContext } from '@code-analyzer/shared';

const FIXTURES = new URL('./fixtures/interface-members/', import.meta.url).pathname;

describe('a contract declares its members', () => {
  it('emits one Method per signature, held by the interface', async () => {
    const provider = await getOrLoadProvider('typescript');
    if (provider === null || provider === undefined) throw new Error('no TypeScript provider');
    const content = (await import('node:fs')).readFileSync(`${FIXTURES}contracts.ts`, 'utf8');
    const { symbols } = groupCaptures(provider.parse(content, 'contracts.ts'), 'contracts.ts');
    const members = symbols.filter((symbol) => symbol.containerName === 'Repository');

    expect(members.map((symbol) => symbol.name).sort()).toEqual(['find', 'save']);
    for (const member of members) expect(member.kind).toBe('Method');
    expect(members.map((symbol) => symbol.qualifiedName).sort()).toEqual([
      'file:contracts.ts:Repository.find',
      'file:contracts.ts:Repository.save',
    ]);
  });
});

describe('a call on a contract reaches the contract, and a call on a class reaches the class', () => {
  let graph: KnowledgeGraph;

  beforeAll(async () => {
    const empty: KnowledgeGraph = {
      projectId: 'interface-members',
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    };
    const ctx: PipelineContext = {
      projectId: 'interface-members',
      rootPath: FIXTURES,
      graph: empty,
      config: {
        projectId: 'interface-members',
        rootPath: FIXTURES,
        ignorePaths: [],
        excludePatterns: [],
        includePatterns: [],
        maxFileSize: 10 * 1024 * 1024,
        maxFiles: 1000,
        parseWorkers: 1,
        cacheDir: '.code-analyzer-test',
      },
      phaseData: new Map<string, unknown>(),
    };
    await new PipelineOrchestrator([
      new ScanPhase(),
      new StructurePhase(),
      new ParsePhase(),
      new CrossFilePhase(),
      new ScopeResolutionPhase(),
    ]).execute(ctx);
    graph = ctx.graph as KnowledgeGraph;
  });

  function idOf(suffix: string): number {
    const id = [...graph.nodes.values()].find(
      (node) => node.qualifiedName !== null && node.qualifiedName.endsWith(suffix),
    )?.id;
    if (id === undefined) throw new Error(`no node named …${suffix}`);
    return id;
  }

  function callsFrom(suffix: string): string[] {
    const source = idOf(suffix);
    return [...graph.edges.values()]
      .filter((edge) => edge.type === 'CALLS' && edge.sourceId === source)
      .map((edge) => {
        const qualified = String(graph.nodes.get(edge.targetId)?.qualifiedName ?? '');
        return qualified.slice(qualified.lastIndexOf(':') + 1);
      });
  }

  it('resolves the call whose receiver is declared as the contract', () => {
    // `repository.find(id)` inside `load(repository: Repository)`. The annotation is the evidence, and the member is
    // the declaration it names - not `MemoryRepository.find`, which is a different declaration.
    const targets = callsFrom('load');
    expect(targets).toContain('Repository.find');
    expect(targets).not.toContain('MemoryRepository.find');
  });

  it('keeps the contract member and the implementation apart, both as nodes', () => {
    // `Repository.find` and `MemoryRepository.find` are two declarations with one name. A graph keyed by name keeps
    // one and loses the other, and the lost one is whichever the index saw second.
    const contract = idOf('Repository.find');
    const implementation = idOf('MemoryRepository.find');
    expect(contract).not.toBe(implementation);
    expect(String(graph.nodes.get(contract)?.label)).toBe('Method');
    expect(String(graph.nodes.get(implementation)?.label)).toBe('Method');
  });
});
