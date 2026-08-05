// @code-analyzer/mcp — Refactor Suggestion Tool Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import refactorSuggestionTool from '../tools/refactor-suggestion.js';

function createStoreWithData(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  insertNode(store, { projectId: 'test-project', label: 'Project', name: 'Test', qualifiedName: 'Test' });
  const funcId = insertNode(store, { projectId: 'test-project', label: 'Function', name: 'bigFunction', qualifiedName: 'bigFunction', filePath: 'src/big.ts' });
  const classId = insertNode(store, { projectId: 'test-project', label: 'Class', name: 'BigClass', qualifiedName: 'BigClass', filePath: 'src/big.ts' });
  for (let i = 0; i < 12; i++) {
    const depId = insertNode(store, { projectId: 'test-project', label: 'Function', name: `dep${i}`, qualifiedName: `dep${i}`, filePath: 'src/dep.ts' });
    insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: funcId, targetId: depId });
  }
  for (let i = 0; i < 8; i++) {
    const clsDepId = insertNode(store, { projectId: 'test-project', label: 'Function', name: `clsDep${i}`, qualifiedName: `clsDep${i}`, filePath: 'src/dep.ts' });
    insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: classId, targetId: clsDepId });
  }
  return store;
}

describe('refactorSuggestionTool', () => {
  it('should have correct name', () => {
    expect(refactorSuggestionTool.name).toBe('refactor_suggestion');
  });
  it('should have callable handler', () => {
    expect(typeof refactorSuggestionTool.handler).toBe('function');
  });
  it('should return error with no store', async () => {
    const r = await refactorSuggestionTool.handler({ projectId: 'test-project' });
    expect(r.isError).toBe(true);
  });
  it('should generate suggestions from graph data', async () => {
    const r = await refactorSuggestionTool.handler(
      { projectId: 'test-project', maxSuggestions: 10 }, createStoreWithData(),
    );
    expect(r.content[0].text).toContain('Refactor Suggestions');
    expect(r.metadata.suggestionCount).toBeGreaterThan(0);
  });
  it('should return none for empty store', async () => {
    const r = await refactorSuggestionTool.handler(
      { projectId: 'test-project' }, new InMemoryGraphStore(),
    );
    expect(r.content[0].text).toContain('No symbols found');
  });
  it('should respect maxSuggestions limit', async () => {
    const r = await refactorSuggestionTool.handler(
      { projectId: 'test-project', maxSuggestions: 1 }, createStoreWithData(),
    );
    expect(r.metadata.suggestionCount).toBeLessThanOrEqual(1);
  });
});
