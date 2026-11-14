// @code-analyzer/intelligence — one ranking engine per store
//
// The engine is a function of the store: `HybridSearchEngine.initialize()` walks every node to compute field lengths and
// collection statistics, and those numbers describe the index rather than the question. A surface that built one per
// request would recompute them on a store that had not changed - ~18 000 nodes per question on the six-repository
// corpus - and two surfaces that built their own would hold two copies of the same arithmetic.

import { FederatedSearchEngine } from '../cross-repo/federated-search.js';

import type { RepoScopeResolver } from '../cross-repo/federated-search.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';

/**
 * **Weak, because the statistics are the store's and not the process's.**
 *
 * A store that goes out of scope should take its field lengths with it; a strong map would keep every checkout ever
 * indexed alive for the lifetime of a server, which is the leak a cache is usually accused of and here would be one.
 */
const engines = new WeakMap<InMemoryGraphStore, FederatedSearchEngine>();

/**
 * The ranking engine for this store, built on first use and shared thereafter.
 *
 * **The scope resolver is a property of the store rather than of the call.** A store is indexed by one
 * `RepoGroupManager`, so a second resolver over the same store would be a second answer to "what is in this group", and
 * an engine that swapped between them would make `groupId` mean two things inside one process. A caller that needs a
 * different meaning — the measurement harness does, when it builds a workspace per corpus — constructs its own engine,
 * which is exactly what an explicit constructor is for.
 */
export function searchEngineFor(
  store: InMemoryGraphStore,
  scopes?: RepoScopeResolver,
): FederatedSearchEngine {
  const existing = engines.get(store);
  if (existing !== undefined) return existing;

  const engine = new FederatedSearchEngine(store, scopes);
  engines.set(store, engine);
  return engine;
}
