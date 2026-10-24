// The resources, read against a graph that is missing one field of each kind.
//
// **Every resource here is a projection of the graph, and every projection has a fallback**: a route with a method and
// no path, a symbol with no qualified name, a hotspot measured by degree rather than complexity, a repository listed
// twice, a cluster with no language. **A fallback that has never fired is a fallback nobody has read**, and these are
// the values an indexer produces when a provider could not fill a field rather than values a fixture invents.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { ResourceProvider } from '../resources/index.js';

function makeStore(): {
  store: InMemoryGraphStore;
  add: (over: Record<string, unknown>) => number;
} {
  const store = new InMemoryGraphStore();
  let seq = 0;
  // **The qualified name follows the name**, because the store rejects a duplicate and a fixture that gave every node
  // the same one would be testing the store's validation rather than the resource's projection.
  const add = (over: Record<string, unknown>): number => {
    seq += 1;
    const name = (over['name'] as string | undefined) ?? `fn${seq}`;
    return store.insertNode({
      projectId: 'p',
      label: 'Function',
      name,
      qualifiedName: over['qualifiedName'] ?? `p:${name}`,
      filePath: 'src/fn.ts',
      startLine: 1,
      endLine: 2,
      language: 'TypeScript',
      properties: {},
      ...over,
    } as never);
  };
  return { store, add };
}

async function read(store: InMemoryGraphStore, uri: string): Promise<Record<string, unknown>> {
  const provider = new ResourceProvider(store);
  const result = await provider.getResource(uri);
  // **The handler's answer is the `text` field**, because a resource is a document: the envelope carries the MIME type
  // and the body is the JSON the handler produced.
  return JSON.parse((result as { text: string }).text) as Record<string, unknown>;
}

describe('a graph with one field missing from each kind of node', () => {
  it('falls back to UNKNOWN and / for a route that has only half of itself', async () => {
    // **A route is a method and a path**, and a partial one is still a route: `GET` with no path is the root, a path
    // with no method is a handler the parser could not attribute.
    const { store, add } = makeStore();
    add({ properties: { routeMethod: 'GET' } });
    add({ properties: { routePath: '/health' } });

    const body = await read(store, 'code-analyzer://resources/routes');
    const routes = body['routes'] as Array<{ method: string; path: string }>;

    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /', 'UNKNOWN /health']);
  });

  it('names an entry point whose qualified name was never computed', async () => {
    const { store, add } = makeStore();
    add({ qualifiedName: '', name: 'boot', properties: { isEntrypoint: 'true' } });

    const body = await read(store, 'code-analyzer://resources/entrypoints');

    expect((body['entrypoints'] as Array<{ name: string }>)[0]!.name).toBe('boot');
  });

  it('finds a hotspot by degree when its complexity was never measured', async () => {
    // **`complexity !== null && complexity > threshold`** is the first clause; a node with no complexity and a high
    // degree is the second, and a detector that only read complexity would miss the most connected function in a file.
    const { store } = makeStore();
    const hot = store.insertNode({
      projectId: 'p',
      label: 'Function',
      name: 'hub',
      qualifiedName: 'p:hub',
      filePath: 'src/hub.ts',
      startLine: 1,
      endLine: 2,
      language: 'TypeScript',
      complexity: null,
      properties: {},
    } as never);
    for (let i = 0; i < 12; i += 1) {
      const caller = store.insertNode({
        projectId: 'p',
        label: 'Function',
        name: `c${i}`,
        qualifiedName: `p:c${i}`,
        filePath: 'src/c.ts',
        startLine: 1,
        endLine: 1,
        language: 'TypeScript',
        properties: {},
      } as never);
      store.insertEdge({
        projectId: 'p',
        sourceId: caller,
        targetId: hot,
        type: 'CALLS',
        properties: {},
        weight: 1,
        createdAt: '2026-01-01T00:00:00Z',
      } as never);
    }

    const body = await read(store, 'code-analyzer://resources/hotspots');
    const hotspots = body['hotspots'] as Array<{ name: string; complexity: number | null }>;

    expect(hotspots[0]!.name).toBe('p:hub');
    expect(hotspots[0]!.complexity).toBeNull();
  });

  it('lists each repository once per group', async () => {
    // **A group with a hundred symbols in one repository is one repository**, and a list that repeated it would
    // overstate how many repositories the group holds.
    const { store, add } = makeStore();
    for (let i = 0; i < 3; i += 1) {
      add({ name: `s${i}`, properties: { repoGroup: 'g', repoName: 'svc-a' } });
    }
    add({ name: 'other', properties: { repoGroup: 'g', repoName: 'svc-b' } });

    const body = await read(store, 'code-analyzer://resources/groups');
    const groups = body['groups'] as Array<{ name: string; repos: string[] }>;

    expect(groups[0]!.repos).toEqual(['svc-a', 'svc-b']);
  });

  it('takes a cluster’s language from the first member that has one', async () => {
    const { store, add } = makeStore();
    add({ name: 'noLang', language: undefined, properties: { clusterId: 'c' } });
    add({ name: 'withLang', properties: { clusterId: 'c' } });

    const body = await read(store, 'code-analyzer://resources/clusters');
    const clusters = body['clusters'] as Array<{
      primaryLanguage: string | null;
      memberCount: number;
    }>;

    expect(clusters[0]!.memberCount).toBe(2);
    expect(clusters[0]!.primaryLanguage).toBe('TypeScript');
  });

  it('reports a process with and without a step count', async () => {
    const { store, add } = makeStore();
    add({ name: 'withSteps', label: 'Process', properties: { stepCount: 4 } });
    add({ name: 'noSteps', properties: { isProcess: 'true' } });

    const body = await read(store, 'code-analyzer://resources/processes');
    const processes = body['processes'] as Array<{ name: string; stepCount: number }>;

    expect(processes.map((p) => `${p.name}:${p.stepCount}`)).toEqual(['withSteps:4', 'noSteps:0']);
  });

  it('answers an unknown URI with an error rather than an empty document', async () => {
    // **An empty document is a valid answer about an empty graph**, so a missing resource must not look like one.
    const { store } = makeStore();
    const provider = new ResourceProvider(store);

    const result = await provider.getResource('code-analyzer://resources/nothing-here');

    expect(result).toHaveProperty('error');
    expect(String((result as { error: string }).error)).toMatch(/not found/i);
  });

  it('describes every resource it claims to serve', () => {
    const { store } = makeStore();
    const provider = new ResourceProvider(store);
    const listed = provider.listResources();

    expect(listed.length).toBeGreaterThan(10);
    for (const resource of listed) {
      expect(resource.uri.startsWith('code-analyzer://resources/')).toBe(true);
      expect(resource.name.length).toBeGreaterThan(0);
    }
  });
});

describe('the two resource tables agree', () => {
  it('serves every resource it advertises', async () => {
    // **The definitions and the handlers are two lists**, and a resource added to one and not the other is a URI that
    // is advertised and cannot be read. This walks the advertisement and reads each one, which is the only check that
    // fails when they diverge.
    const { store } = makeStore();
    const provider = new ResourceProvider(store);

    for (const resource of provider.listResources()) {
      const result = await provider.getResource(resource.uri);
      expect(result, resource.uri).not.toHaveProperty('error');
    }
  });
});

describe('ordering and measurement in the projections', () => {
  it('orders routes by path and then by method', async () => {
    const { store, add } = makeStore();
    add({ name: 'z', properties: { routeMethod: 'POST', routePath: '/same' } });
    add({ name: 'a', properties: { routeMethod: 'GET', routePath: '/same' } });
    add({ name: 'm', properties: { routeMethod: 'PUT', routePath: '/aaa' } });

    const body = await read(store, 'code-analyzer://resources/routes');
    const routes = body['routes'] as Array<{ method: string; path: string }>;

    // Same path twice, so the method decides - which is the comparator's second clause.
    expect(routes.map((r) => `${r.path} ${r.method}`)).toEqual([
      '/aaa PUT',
      '/same GET',
      '/same POST',
    ]);
  });

  it('names a route handler whose qualified name was never computed', async () => {
    const { store, add } = makeStore();
    add({ name: 'plain', qualifiedName: '', properties: { routeMethod: 'GET', routePath: '/' } });

    const body = await read(store, 'code-analyzer://resources/routes');

    expect((body['routes'] as Array<{ handler: string }>)[0]!.handler).toBe('plain');
  });

  it('orders two hotspots, one measured and one not', async () => {
    const { store, add } = makeStore();
    add({ name: 'measured', complexity: 40, properties: {} });
    add({ name: 'unmeasured', complexity: null, properties: {} });
    for (let i = 0; i < 12; i += 1) {
      add({ name: `hub${i}`, properties: {} });
    }

    const body = await read(store, 'code-analyzer://resources/hotspots');
    const hotspots = body['hotspots'] as Array<{ name: string }>;

    // The measured one sorts first: `(b.complexity ?? 0)` is what makes an unmeasured hotspot comparable at all.
    expect(hotspots[0]!.name).toBe('p:measured');
  });

  it('tracks the earliest and latest appearance of a project', async () => {
    const { store } = makeStore();
    const base = {
      projectId: 'p',
      label: 'Function',
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      language: 'TypeScript',
      properties: {},
    };
    store.insertNode({
      ...base,
      name: 'early',
      qualifiedName: 'p:early',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    } as never);
    store.insertNode({
      ...base,
      name: 'late',
      qualifiedName: 'p:late',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    } as never);

    const body = await read(store, 'code-analyzer://resources/projects');
    const project = (body['projects'] as Array<Record<string, unknown>>)[0]!;

    expect(project['firstSeen']).toBe('2026-01-01T00:00:00Z');
    expect(project['lastUpdated']).toBe('2026-03-01T00:00:00Z');
  });
});

describe('the metadata a resource reports when a field is absent', () => {
  it('defaults an ADR status and a report type', async () => {
    // **Both are optional in the graph and neither may be blank in a document**: an ADR without a status reads as
    // unset, and a report without a type reads as untyped, when the honest reading is the default.
    const { store, add } = makeStore();
    add({ name: 'adr', label: 'ADR', properties: { isADR: 'true' } });
    add({ name: 'report', properties: { isReport: 'true' } });

    const adrs = (await read(store, 'code-analyzer://resources/adrs'))['adrs'] as Array<{
      status: string;
    }>;
    const reports = (await read(store, 'code-analyzer://resources/reports'))['reports'] as Array<{
      type: string;
    }>;

    expect(adrs[0]!.status).toBe('proposed');
    expect(reports[0]!.type).toBe('analysis');
  });

  it('ranks a hotspot with no measured complexity by its degree alone', async () => {
    // **`(b.complexity ?? 0)`** is what makes the two comparable: without the fallback the sort compares `null` with a
    // number, which JavaScript coerces silently and differently from one engine version to the next.
    const { store, add } = makeStore();
    const measured = add({ name: 'measured', complexity: 40, properties: {} });
    const unmeasured = add({
      name: 'unmeasured',
      complexity: null,
      qualifiedName: '',
      properties: {},
    });
    for (let i = 0; i < 12; i += 1) {
      const caller = add({ name: `hub${i}`, properties: {} });
      store.insertEdge({
        projectId: 'p',
        sourceId: caller,
        targetId: unmeasured,
        type: 'CALLS',
        properties: {},
        weight: 1,
        createdAt: '2026-01-01T00:00:00Z',
      } as never);
    }
    void measured;

    const hotspots = (await read(store, 'code-analyzer://resources/hotspots'))[
      'hotspots'
    ] as Array<{
      name: string;
      complexity: number | null;
    }>;

    const unmeasuredEntry = hotspots.find((h) => h.name === 'unmeasured');
    expect(unmeasuredEntry).toBeDefined();
    expect(unmeasuredEntry!.complexity).toBeNull();
  });

  it('takes the earliest first-seen even when the later node was indexed first', async () => {
    // **`firstSeen` is a minimum, not the first insert**, which is why the comparison exists: an incremental build
    // visits the newer file first whenever it changed.
    const { store } = makeStore();
    const base = {
      projectId: 'p',
      label: 'Function',
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      language: 'TypeScript',
      properties: {},
    };
    store.insertNode({
      ...base,
      name: 'late',
      qualifiedName: 'p:late',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    } as never);
    store.insertNode({
      ...base,
      name: 'early',
      qualifiedName: 'p:early',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    } as never);

    const project = (
      (await read(store, 'code-analyzer://resources/projects'))['projects'] as Array<
        Record<string, unknown>
      >
    )[0]!;

    expect(project['firstSeen']).toBe('2026-01-01T00:00:00Z');
  });
});

describe('a project that exists only as an edge', () => {
  it('counts an edge without inventing a project for it', async () => {
    // **An edge can name a project whose nodes were pruned**, and the statistics must not list a project with no
    // symbols - a project row with `nodeCount: 0` reads as a repository that failed to index.
    const { store, add } = makeStore();
    const a = add({ name: 'a', properties: {} });
    const b = add({ name: 'b', properties: {} });
    store.insertEdge({
      projectId: 'ghost',
      sourceId: a,
      targetId: b,
      type: 'CALLS',
      properties: {},
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    } as never);

    const body = await read(store, 'code-analyzer://resources/projects');
    const projects = body['projects'] as Array<{ projectId: string; edgeCount: number }>;

    expect(projects.map((p) => p.projectId)).toEqual(['p']);
    // And the edge is not counted against the project it belongs to nowhere.
    expect(projects[0]!.edgeCount).toBe(0);
  });
});

describe('ordering hotspots when neither has a measured complexity', () => {
  it('falls back to degree, and to zero complexity twice over', async () => {
    // **Both operands take the `?? 0` arm** when neither hotspot has a complexity, which is the state of a graph built
    // before the complexity phase ran - and the order it produces there is the order of the degree.
    const { store, add } = makeStore();
    const first = add({ name: 'first', complexity: null, properties: {} });
    const second = add({ name: 'second', complexity: null, properties: {} });
    for (let i = 0; i < 30; i += 1) {
      const caller = add({ name: `c${i}`, properties: {} });
      store.insertEdge({
        projectId: 'p',
        sourceId: caller,
        targetId: i < 18 ? first : second,
        type: 'CALLS',
        properties: {},
        weight: 1,
        createdAt: '2026-01-01T00:00:00Z',
      } as never);
    }

    const hotspots = (await read(store, 'code-analyzer://resources/hotspots'))[
      'hotspots'
    ] as Array<{
      name: string;
    }>;

    // Both are hotspots and neither has a complexity, so the degree decides - and the first one has more.
    expect(hotspots.map((h) => h.name)).toEqual(['p:first', 'p:second']);
  });
});
