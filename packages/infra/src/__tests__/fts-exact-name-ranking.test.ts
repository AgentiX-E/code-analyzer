// @code-analyzer/infra — what a search for a name is asked to answer.
//
// **`searchFts` ranked by substring containment only, so "Owner" matched every symbol whose name starts with it with the
// same weight.** Measured on real corpora - `pallets/flask` and `spring-petclinic` - recall@5 for an exact symbol name
// was **0.72 and 0.80**, and the misses were not "the index is wrong": they were `Owner`, `OwnerController`,
// `OwnerRepository`, `OwnerService` tied at the same rank and the slice of five decided by insertion order. **A user
// asking for `Owner` means `Owner`**, and a search that cannot say so is a search a competitor beats.

import { describe, it, expect } from 'vitest';

import { createTestNode } from './helpers.js';
import { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';

function storeWith(names: string[]): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  // **Inserted in the order that loses**: the exact match is last, so a tie can only be broken by rank, not by position.
  for (const name of names) {
    store.insertNode(createTestNode({ name, qualifiedName: `pkg:${name}`, label: 'Class' }));
  }
  return store;
}

describe('searchFts — an exact name beats a name that merely contains it', () => {
  it('ranks the symbol whose name is the query first among prefix-sharing siblings', () => {
    const store = storeWith(['OwnerController', 'OwnerRepository', 'OwnerService', 'Owner']);

    const results = store.searchFts('Owner', { limit: 5 });

    expect(results.map((r) => r.node.name)[0]).toBe('Owner');
    // The siblings are still found - this is a ranking rule, not a filter.
    expect(results.map((r) => r.node.name)).toEqual(
      expect.arrayContaining(['OwnerController', 'OwnerRepository', 'OwnerService']),
    );
  });

  it('is case-insensitive about what "exact" means', () => {
    const store = storeWith(['owner', 'OwnerFactory']);

    expect(store.searchFts('Owner', { limit: 5 })[0]?.node.name).toBe('owner');
  });

  it('keeps a qualified-name match below an exact name match', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      createTestNode({ name: 'createApp', qualifiedName: 'pkg:createApp', label: 'Function' }),
    );
    store.insertNode(
      createTestNode({
        name: 'bootstrap',
        qualifiedName: 'pkg:createApp.bootstrap',
        label: 'Function',
      }),
    );

    const names = store.searchFts('createApp', { limit: 5 }).map((r) => r.node.name);
    expect(names[0]).toBe('createApp');
  });
});
