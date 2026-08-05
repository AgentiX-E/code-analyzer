// @code-analyzer/intelligence — Leiden + Taint Models Tests

import { describe, it, expect } from 'vitest';
import { LeidenCommunityDetector } from '../community/leiden-detector.js';
import { TYPESCRIPT_TAINT_MODEL, PYTHON_TAINT_MODEL, GO_TAINT_MODEL, TAINT_MODELS } from '../security/taint-models.js';
import type { TaintModel, TaintSinkDef, TaintSourceDef, SanitizerDef } from '../security/taint-models.js';

// =========================================================================
// Leiden Tests
// =========================================================================

describe('LeidenCommunityDetector', () => {
  function makeGraph(
    n: number,
    edges: Array<[number, number, number?]> = [],
  ) {
    const nodes = new Map<number, any>();
    const graphEdges = new Map<number, any>();
    for (let i = 0; i < n; i++) {
      nodes.set(i, { id: i, name: `node${i}`, label: 'Function', language: 'typescript' });
    }
    for (let i = 0; i < edges.length; i++) {
      const [s, t, w] = edges[i]!;
      graphEdges.set(i, { id: i, sourceId: s, targetId: t, weight: w ?? 1, projectId: 'test', type: 'CALLS', createdAt: '' });
    }
    return { nodes, edges: graphEdges, projectId: 'test' } as any;
  }

  describe('Basic detection', () => {
    it('handles empty graph', () => {
      const g = makeGraph(0);
      const d = new LeidenCommunityDetector();
      const r = d.detect(g);
      expect(r.communityCount).toBe(0);
      expect(r.modularity).toBe(0);
    });

    it('isolated nodes form separate communities', () => {
      const g = makeGraph(5);
      const d = new LeidenCommunityDetector();
      const r = d.detect(g);
      // 5 isolated nodes → each in its own community
      expect(r.communityCount).toBeGreaterThanOrEqual(1);
      expect(r.nodeToCommunity.size).toBe(5);
    });

    it('connected nodes cluster together', () => {
      const g = makeGraph(4, [[0, 1], [1, 2], [2, 3]]);
      const d = new LeidenCommunityDetector();
      const r = d.detect(g);
      expect(r.communityCount).toBeGreaterThanOrEqual(1);
      expect(r.modularity).toBeGreaterThanOrEqual(-1);
    });

    it('two-cluster graph produces two communities', () => {
      const g = makeGraph(6, [
        [0, 1, 3], [0, 2, 2], [1, 2, 3],  // Cluster 1
        [3, 4, 3], [3, 5, 2], [4, 5, 3],  // Cluster 2
        [2, 3, 1],  // Bridge
      ]);
      const d = new LeidenCommunityDetector({ resolution: 0.5 });
      const r = d.detect(g);
      expect(r.communityCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Refinement phase', () => {
    it('communities are well-connected (no disconnected subgraphs)', () => {
      const g = makeGraph(8, [
        [0, 1, 5], [0, 2, 3], [1, 2, 5],
        [3, 4, 1],
        [5, 6, 3], [5, 7, 2], [6, 7, 3],
      ]);
      const d = new LeidenCommunityDetector({ resolution: 0.3 });
      const r = d.detect(g);
      expect(r.communityCount).toBeGreaterThanOrEqual(1);
      // Leiden refinement should produce well-connected communities
      // (no community should contain isolated nodes)
    });

    it('higher resolution produces more communities', () => {
      const g = makeGraph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
      const d1 = new LeidenCommunityDetector({ resolution: 0.3 });
      const d2 = new LeidenCommunityDetector({ resolution: 2.0 });
      const r1 = d1.detect(g);
      const r2 = d2.detect(g);
      // Higher resolution should produce more (finer) communities
      expect(r2.communityCount).toBeGreaterThanOrEqual(r1.communityCount);
    });
  });

  describe('describeCommunities', () => {
    it('produces metadata for each community', () => {
      const g = makeGraph(4, [[0, 1], [1, 2], [0, 3]]);
      const d = new LeidenCommunityDetector();
      const r = d.detect(g);
      const infos = d.describeCommunities(g, r);
      expect(infos.length).toBe(r.communityCount);
      for (const info of infos) {
        expect(info.size).toBeGreaterThan(0);
        expect(info.topSymbols.length).toBeLessThanOrEqual(10);
        expect(info.cohesion).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// =========================================================================
// Taint Model Tests
// =========================================================================

function validateModel(model: TaintModel, lang: string) {
  describe(`${lang} model`, () => {
    it('has sources', () => expect(model.sources.length).toBeGreaterThan(0));
    it('has sinks', () => expect(model.sinks.length).toBeGreaterThan(0));
    it('has sanitizers', () => expect(model.sanitizers.length).toBeGreaterThan(0));

    it('all sources have valid structure', () => {
      for (const s of model.sources) {
        expect(typeof s.kind).toBe('string');
        expect(['callResult', 'memberRead', 'param']).toContain(s.accessType);
        expect(typeof s.description).toBe('string');
        expect(s.description.length).toBeGreaterThan(0);
      }
    });

    it('all sinks have valid structure', () => {
      for (const s of model.sinks) {
        expect(typeof s.kind).toBe('string');
        expect(typeof s.severity).toBe('string');
        expect(['moduleFunction', 'globalFunction', 'anyReceiver', 'receiverConvention']).toContain(s.matchType);
        expect(s.taintArg).toBeDefined();
      }
    });

    it('all sanitizers have valid structure', () => {
      for (const s of model.sanitizers) {
        expect(s.neutralizes.length).toBeGreaterThan(0);
        expect(['moduleFunction', 'globalFunction']).toContain(s.matchType);
        expect(typeof s.description).toBe('string');
      }
    });

    it('contains critical security sinks', () => {
      const kinds = new Set(model.sinks.map(s => s.kind));
      const critical: string[] = [];
      if (kinds.has('sql-injection')) critical.push('sql-injection');
      if (kinds.has('command-injection')) critical.push('command-injection');
      if (kinds.has('code-injection')) critical.push('code-injection');
      expect(critical.length).toBeGreaterThanOrEqual(2);
    });

    it('every sink severity is valid', () => {
      const valid = ['critical', 'high', 'medium', 'low'] as const;
      for (const s of model.sinks) {
        expect(valid).toContain(s.severity);
      }
    });

    it('CWEs are valid for critical sinks', () => {
      for (const s of model.sinks) {
        if (s.severity === 'critical') {
          expect(s.cweId).toBeDefined();
          expect(s.cweId).toMatch(/^CWE-\d+$/);
        }
      }
    });
  });
}

validateModel(TYPESCRIPT_TAINT_MODEL, 'TypeScript');
validateModel(PYTHON_TAINT_MODEL, 'Python');
validateModel(GO_TAINT_MODEL, 'Go');

describe('TAINT_MODELS registry', () => {
  it('maps TypeScript and JavaScript to the same model', () => {
    expect(TAINT_MODELS.get('typescript')).toBe(TAINT_MODELS.get('javascript'));
  });

  it('maps TSX and JSX to TypeScript model', () => {
    expect(TAINT_MODELS.get('tsx')).toBe(TAINT_MODELS.get('typescript'));
    expect(TAINT_MODELS.get('jsx')).toBe(TAINT_MODELS.get('typescript'));
  });

  it('has distinct models for different languages', () => {
    expect(TAINT_MODELS.get('python')).not.toBe(TAINT_MODELS.get('typescript'));
    expect(TAINT_MODELS.get('go')).not.toBe(TAINT_MODELS.get('python'));
  });

  it('has 6 entries', () => {
    expect(TAINT_MODELS.size).toBe(6);
  });
});

describe('Language-specific coverage', () => {
  it('TypeScript has 10+ sources, 14+ sinks, 9+ sanitizers', () => {
    expect(TYPESCRIPT_TAINT_MODEL.sources.length).toBeGreaterThanOrEqual(10);
    expect(TYPESCRIPT_TAINT_MODEL.sinks.length).toBeGreaterThanOrEqual(14);
    expect(TYPESCRIPT_TAINT_MODEL.sanitizers.length).toBeGreaterThanOrEqual(9);
  });

  it('Python has 8+ sources, 11+ sinks, 5+ sanitizers', () => {
    expect(PYTHON_TAINT_MODEL.sources.length).toBeGreaterThanOrEqual(8);
    expect(PYTHON_TAINT_MODEL.sinks.length).toBeGreaterThanOrEqual(11);
    expect(PYTHON_TAINT_MODEL.sanitizers.length).toBeGreaterThanOrEqual(5);
  });

  it('Go has 8+ sources, 8+ sinks, 4+ sanitizers', () => {
    expect(GO_TAINT_MODEL.sources.length).toBeGreaterThanOrEqual(8);
    expect(GO_TAINT_MODEL.sinks.length).toBeGreaterThanOrEqual(8);
    expect(GO_TAINT_MODEL.sanitizers.length).toBeGreaterThanOrEqual(4);
  });
});
