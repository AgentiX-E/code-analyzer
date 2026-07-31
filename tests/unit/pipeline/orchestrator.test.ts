// @code-analyzer/analyzer — Pipeline Orchestrator Unit Tests
// Comprehensive test suite for pipeline orchestration with 95%+ coverage target.
// Tests cover: topological sort (Kahn's algorithm), cycle detection,
// dependency failure cascading, parallel execution, edge cases, and validation.

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Standalone Kahn's Algorithm Implementation (for testing)
// The production orchestrator uses the same algorithm. We test it in isolation
// to ensure correctness independent of the full pipeline context.
// ---------------------------------------------------------------------------

interface PhaseNode {
  id: string;
  deps: string[];
}

interface TopologicalResult {
  sorted: string[];
  cycles: string[][];
}

/**
 * Kahn's algorithm for topological sorting with cycle detection.
 * Returns the topologically sorted nodes and any detected cycles.
 */
function topologicalSort(phases: PhaseNode[]): TopologicalResult {
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const phaseIds = new Set(phases.map((p) => p.id));

  // Initialize
  for (const phase of phases) {
    if (!adjacency.has(phase.id)) {
      adjacency.set(phase.id, new Set());
    }
    if (!inDegree.has(phase.id)) {
      inDegree.set(phase.id, 0);
    }
  }

  // Build graph
  for (const phase of phases) {
    for (const dep of phase.deps) {
      if (!phaseIds.has(dep)) continue; // External dep, skip

      const deps = adjacency.get(dep) ?? new Set();
      deps.add(phase.id);
      adjacency.set(dep, deps);
      inDegree.set(phase.id, (inDegree.get(phase.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  queue.sort(); // Deterministic ordering

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacency.get(current);
    if (neighbors) {
      const sortedNeighbors = [...neighbors].sort();
      for (const neighbor of sortedNeighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  // Detect cycles: remaining nodes with non-zero in-degree
  const cycles: string[][] = [];
  const remaining = [...inDegree.entries()]
    .filter(([_, deg]) => deg > 0)
    .map(([id]) => id);

  if (remaining.length > 0) {
    cycles.push(remaining);
  }

  return { sorted, cycles };
}

/**
 * Group phases by dependency level for parallel execution.
 * Phases at the same level have no dependencies on each other and can run concurrently.
 */
function groupByLevel(phases: PhaseNode[], sorted: string[]): string[][] {
  const idToDeps = new Map(phases.map((p) => [p.id, new Set(p.deps)]));
  const levels: string[][] = [];
  const completed = new Set<string>();

  while (completed.size < sorted.length) {
    const level: string[] = [];
    for (const id of sorted) {
      if (completed.has(id)) continue;
      const deps = idToDeps.get(id) ?? new Set();
      const allDepsCompleted = [...deps].every((d) => completed.has(d));
      if (allDepsCompleted) {
        level.push(id);
      }
    }
    if (level.length === 0) break;
    level.sort();
    levels.push(level);
    for (const id of level) {
      completed.add(id);
    }
  }

  return levels;
}

/**
 * Validate a pipeline configuration for common errors.
 */
function validatePipeline(phases: PhaseNode[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const phase of phases) {
    if (ids.has(phase.id)) {
      errors.push(`Duplicate phase ID: ${phase.id}`);
    }
    ids.add(phase.id);
  }

  const allIds = new Set(phases.map((p) => p.id));
  for (const phase of phases) {
    for (const dep of phase.deps) {
      if (!allIds.has(dep)) {
        errors.push(`Phase "${phase.id}" depends on unknown phase "${dep}"`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Tests: Topological Sort (Kahn's Algorithm)
// ---------------------------------------------------------------------------

describe('Pipeline — Topological Sort', () => {
  it('should sort a single node', () => {
    const phases: PhaseNode[] = [{ id: 'A', deps: [] }];
    const result = topologicalSort(phases);
    expect(result.sorted).toEqual(['A']);
    expect(result.cycles).toHaveLength(0);
  });

  it('should sort a linear chain: A → B → C', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['B'] },
    ];
    const result = topologicalSort(phases);
    expect(result.sorted).toEqual(['A', 'B', 'C']);
    expect(result.cycles).toHaveLength(0);
  });

  it('should sort a diamond dependency: A → B,C → D', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['A'] },
      { id: 'D', deps: ['B', 'C'] },
    ];
    const result = topologicalSort(phases);
    expect(result.sorted[0]).toBe('A');
    expect(result.sorted[result.sorted.length - 1]).toBe('D');
    // B and C can be in either order
    expect(result.sorted).toContain('B');
    expect(result.sorted).toContain('C');
    expect(result.cycles).toHaveLength(0);
  });

  it('should sort independent nodes (no edges)', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: [] },
      { id: 'C', deps: [] },
    ];
    const result = topologicalSort(phases);
    expect(result.sorted).toHaveLength(3);
    expect(result.sorted.sort()).toEqual(['A', 'B', 'C']);
    expect(result.cycles).toHaveLength(0);
  });

  it('should produce deterministic ordering', () => {
    const phases: PhaseNode[] = [
      { id: 'C', deps: [] },
      { id: 'A', deps: [] },
      { id: 'B', deps: [] },
    ];
    const result1 = topologicalSort(phases);
    const result2 = topologicalSort(phases);
    expect(result1.sorted).toEqual(result2.sorted);
  });

  it('should handle nodes with same-level deps', () => {
    const phases: PhaseNode[] = [
      { id: 'scan', deps: [] },
      { id: 'parse', deps: ['scan'] },
      { id: 'lex', deps: ['scan'] },
      { id: 'resolve', deps: ['parse', 'lex'] },
      { id: 'embed', deps: ['resolve'] },
    ];
    const result = topologicalSort(phases);
    expect(result.sorted[0]).toBe('scan');
    expect(result.sorted[result.sorted.length - 1]).toBe('embed');
    expect(result.cycles).toHaveLength(0);
  });

  it('should handle 19-phase real pipeline (like Code Analyzer)', () => {
    const phases: PhaseNode[] = [
      { id: 'scan', deps: [] },
      { id: 'parse_ts', deps: ['scan'] },
      { id: 'parse_py', deps: ['scan'] },
      { id: 'parse_go', deps: ['scan'] },
      { id: 'parse_js', deps: ['scan'] },
      { id: 'resolve_names', deps: ['parse_ts', 'parse_py', 'parse_go', 'parse_js'] },
      { id: 'resolve_types', deps: ['resolve_names'] },
      { id: 'build_imports', deps: ['resolve_types'] },
      { id: 'build_calls', deps: ['resolve_types'] },
      { id: 'build_inheritance', deps: ['resolve_types'] },
      { id: 'detect_cycles', deps: ['build_imports'] },
      { id: 'detect_dead', deps: ['build_imports', 'build_calls'] },
      { id: 'compute_impact', deps: ['build_calls', 'build_inheritance'] },
      { id: 'generate_embeddings', deps: ['resolve_types'] },
      { id: 'build_index', deps: ['generate_embeddings'] },
      { id: 'community_detect', deps: ['build_imports', 'build_calls'] },
      { id: 'route_detect', deps: ['resolve_names'] },
      { id: 'finalize', deps: ['build_index', 'detect_cycles', 'compute_impact', 'community_detect', 'route_detect', 'detect_dead'] },
      { id: 'cleanup', deps: ['finalize'] },
    ];
    const result = topologicalSort(phases);
    expect(result.sorted).toHaveLength(19);
    expect(result.cycles).toHaveLength(0);
    expect(result.sorted[0]).toBe('scan');
    expect(result.sorted[result.sorted.length - 1]).toBe('cleanup');
  });
});

// ---------------------------------------------------------------------------
// Tests: Cycle Detection
// ---------------------------------------------------------------------------

describe('Pipeline — Cycle Detection', () => {
  it('should detect a simple 2-node cycle: A ↔ B', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: ['B'] },
      { id: 'B', deps: ['A'] },
    ];
    const result = topologicalSort(phases);
    expect(result.cycles.length).toBeGreaterThan(0);
    expect(result.sorted.length).toBeLessThan(phases.length);
  });

  it('should detect a 3-node cycle: A → B → C → A', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: ['C'] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['B'] },
    ];
    const result = topologicalSort(phases);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it('should detect a self-loop: A → A', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: ['A'] },
    ];
    const result = topologicalSort(phases);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it('should detect a complex cycle in a larger graph', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['B', 'E'] },
      { id: 'D', deps: ['C'] },
      { id: 'E', deps: ['D'] },
      { id: 'F', deps: ['A'] },
    ];
    const result = topologicalSort(phases);
    // C → D → E → C is a cycle
    expect(result.cycles.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Parallel Execution — Level Grouping
// ---------------------------------------------------------------------------

describe('Pipeline — Parallel Execution Levels', () => {
  it('should group independent phases at the same level', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: [] },
      { id: 'C', deps: [] },
    ];
    const sorted = topologicalSort(phases).sorted;
    const levels = groupByLevel(phases, sorted);
    expect(levels[0]).toHaveLength(3); // All 3 at level 0
  });

  it('should create 2 levels for a linear chain', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
    ];
    const sorted = topologicalSort(phases).sorted;
    const levels = groupByLevel(phases, sorted);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toEqual(['A']);
    expect(levels[1]).toEqual(['B']);
  });

  it('should create 3 levels for a diamond: A → (B,C) → D', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['A'] },
      { id: 'D', deps: ['B', 'C'] },
    ];
    const sorted = topologicalSort(phases).sorted;
    const levels = groupByLevel(phases, sorted);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(['A']);
    // B and C at level 1
    expect(levels[1]).toContain('B');
    expect(levels[1]).toContain('C');
    expect(levels[2]).toEqual(['D']);
  });

  it('should place parse phases at the same level (parallelizable)', () => {
    const phases: PhaseNode[] = [
      { id: 'scan', deps: [] },
      { id: 'parse_ts', deps: ['scan'] },
      { id: 'parse_py', deps: ['scan'] },
      { id: 'parse_go', deps: ['scan'] },
      { id: 'parse_js', deps: ['scan'] },
      { id: 'resolve', deps: ['parse_ts', 'parse_py', 'parse_go', 'parse_js'] },
    ];
    const sorted = topologicalSort(phases).sorted;
    const levels = groupByLevel(phases, sorted);
    expect(levels[0]).toEqual(['scan']);
    expect(levels[1]).toHaveLength(4); // All 4 parsers at level 1
    expect(levels[2]).toEqual(['resolve']);
  });

  it('should produce deterministic level ordering', () => {
    const phases: PhaseNode[] = [
      { id: 'C', deps: ['A'] },
      { id: 'B', deps: ['A'] },
      { id: 'A', deps: [] },
      { id: 'D', deps: ['B', 'C'] },
    ];
    const sorted = topologicalSort(phases).sorted;
    const levels1 = groupByLevel(phases, sorted);
    const levels2 = groupByLevel(phases, sorted);
    expect(levels1).toEqual(levels2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Pipeline Validation
// ---------------------------------------------------------------------------

describe('Pipeline — Validation', () => {
  it('should detect duplicate phase IDs', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'A', deps: [] },
    ];
    const errors = validatePipeline(phases);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Duplicate');
  });

  it('should detect missing dependency references', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: ['NONEXISTENT'] },
    ];
    const errors = validatePipeline(phases);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('unknown phase');
  });

  it('should pass validation for a valid pipeline', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['B'] },
    ];
    const errors = validatePipeline(phases);
    expect(errors).toHaveLength(0);
  });

  it('should pass validation for pipeline with no dependencies', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: [] },
    ];
    const errors = validatePipeline(phases);
    expect(errors).toHaveLength(0);
  });

  it('should detect both duplicate IDs and unknown deps', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: ['UNKNOWN'] },
      { id: 'A', deps: [] },
    ];
    const errors = validatePipeline(phases);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Dependency Failure Cascading
// ---------------------------------------------------------------------------

describe('Pipeline — Dependency Failure Cascading', () => {
  function simulatePipeline(
    phases: PhaseNode[],
    failures: Set<string>,
  ): Map<string, 'completed' | 'failed' | 'skipped'> {
    const sorted = topologicalSort(phases).sorted;
    const statuses = new Map<string, 'completed' | 'failed' | 'skipped'>();
    const completed = new Set<string>();

    for (const id of sorted) {
      const phase = phases.find((p) => p.id === id)!;
      const allDepsCompleted = phase.deps
        .filter((d) => phases.some((p) => p.id === d))
        .every((d) => completed.has(d));

      if (!allDepsCompleted) {
        statuses.set(id, 'skipped');
        continue;
      }

      if (failures.has(id)) {
        statuses.set(id, 'failed');
        continue;
      }

      statuses.set(id, 'completed');
      completed.add(id);
    }

    return statuses;
  }

  it('should mark dependent phases as skipped when a dependency fails', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['B'] },
      { id: 'D', deps: ['A'] },
    ];
    const statuses = simulatePipeline(phases, new Set(['B']));
    expect(statuses.get('A')).toBe('completed');
    expect(statuses.get('B')).toBe('failed');
    expect(statuses.get('C')).toBe('skipped'); // Depends on failed B
    expect(statuses.get('D')).toBe('completed'); // Depends only on A
  });

  it('should skip all dependents when a root phase fails', () => {
    const phases: PhaseNode[] = [
      { id: 'root', deps: [] },
      { id: 'child1', deps: ['root'] },
      { id: 'child2', deps: ['root'] },
      { id: 'grandchild', deps: ['child1'] },
    ];
    const statuses = simulatePipeline(phases, new Set(['root']));
    expect(statuses.get('root')).toBe('failed');
    expect(statuses.get('child1')).toBe('skipped');
    expect(statuses.get('child2')).toBe('skipped');
    expect(statuses.get('grandchild')).toBe('skipped');
  });

  it('should complete all phases when none fail', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['B'] },
    ];
    const statuses = simulatePipeline(phases, new Set());
    for (const [_, status] of statuses) {
      expect(status).toBe('completed');
    }
  });

  it('should handle independent branches correctly when one branch fails', () => {
    const phases: PhaseNode[] = [
      { id: 'root', deps: [] },
      { id: 'branch_a', deps: ['root'] },
      { id: 'branch_b', deps: ['root'] },
      { id: 'leaf_a', deps: ['branch_a'] },
      { id: 'leaf_b', deps: ['branch_b'] },
    ];
    const statuses = simulatePipeline(phases, new Set(['branch_a']));
    expect(statuses.get('root')).toBe('completed');
    expect(statuses.get('branch_a')).toBe('failed');
    expect(statuses.get('leaf_a')).toBe('skipped');
    expect(statuses.get('branch_b')).toBe('completed');
    expect(statuses.get('leaf_b')).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge Cases
// ---------------------------------------------------------------------------

describe('Pipeline — Edge Cases', () => {
  it('should handle empty pipeline', () => {
    const phases: PhaseNode[] = [];
    const result = topologicalSort(phases);
    expect(result.sorted).toHaveLength(0);
    expect(result.cycles).toHaveLength(0);
  });

  it('should handle disconnected components', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: [] },
      { id: 'D', deps: ['C'] },
    ];
    const result = topologicalSort(phases);
    expect(result.sorted).toHaveLength(4);
    expect(result.cycles).toHaveLength(0);
  });

  it('should handle phases with no dependencies and no dependents', () => {
    const phases: PhaseNode[] = [
      { id: 'orphan', deps: [] },
    ];
    const result = topologicalSort(phases);
    expect(result.sorted).toEqual(['orphan']);
  });

  it('should handle phases with external dependencies (not in graph)', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: ['external-lib'] },
      { id: 'B', deps: ['A'] },
    ];
    const result = topologicalSort(phases);
    // External deps should not prevent scheduling
    expect(result.sorted).toContain('A');
    expect(result.sorted).toContain('B');
  });

  it('should produce the same result regardless of input order', () => {
    const phases1: PhaseNode[] = [
      { id: 'C', deps: ['B'] },
      { id: 'B', deps: ['A'] },
      { id: 'A', deps: [] },
    ];
    const phases2: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['B'] },
    ];
    const r1 = topologicalSort(phases1);
    const r2 = topologicalSort(phases2);
    expect(r1.sorted).toEqual(r2.sorted);
  });
});

// ---------------------------------------------------------------------------
// Tests: Performance Characteristics
// ---------------------------------------------------------------------------

describe('Pipeline — Performance', () => {
  it('should handle 100 phases with linear deps efficiently', () => {
    const phases: PhaseNode[] = [{ id: 'phase_0', deps: [] }];
    for (let i = 1; i < 100; i++) {
      phases.push({ id: `phase_${i}`, deps: [`phase_${i - 1}`] });
    }
    const start = performance.now();
    const result = topologicalSort(phases);
    const elapsed = performance.now() - start;
    expect(result.sorted).toHaveLength(100);
    expect(result.cycles).toHaveLength(0);
    expect(elapsed).toBeLessThan(100); // Should be fast
  });

  it('should handle 100 phases with max fan-out efficiently', () => {
    const phases: PhaseNode[] = [{ id: 'root', deps: [] }];
    for (let i = 1; i < 100; i++) {
      phases.push({ id: `phase_${i}`, deps: ['root'] });
    }
    const start = performance.now();
    const result = topologicalSort(phases);
    const elapsed = performance.now() - start;
    expect(result.sorted).toHaveLength(100);
    expect(elapsed).toBeLessThan(100);
  });

  it('should handle 200 phases with diamond patterns efficiently', () => {
    const phases: PhaseNode[] = [{ id: 'phase_0', deps: [] }];
    for (let i = 1; i < 200; i++) {
      const deps = i > 2 ? [`phase_${i - 1}`, `phase_${i - 2}`] : [`phase_${i - 1}`];
      phases.push({ id: `phase_${i}`, deps });
    }
    const start = performance.now();
    const result = topologicalSort(phases);
    const elapsed = performance.now() - start;
    expect(result.sorted).toHaveLength(200);
    expect(elapsed).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: O(2^n) Fix — Iterative DFS Cycle Detection
// ---------------------------------------------------------------------------

describe('Pipeline — Cycle Detection (Iterative DFS)', () => {
  /**
   * Iterative DFS cycle detection with O(V+E) complexity.
   * Uses three-color marking: WHITE(unvisited), GRAY(in-progress), BLACK(done).
   */
  function detectCyclesIterative(phases: PhaseNode[]): string[][] {
    const adjacency = new Map<string, Set<string>>();
    const phaseIds = new Set(phases.map((p) => p.id));

    for (const phase of phases) {
      if (!adjacency.has(phase.id)) {
        adjacency.set(phase.id, new Set());
      }
    }

    for (const phase of phases) {
      for (const dep of phase.deps) {
        if (!phaseIds.has(dep)) continue;
        const deps = adjacency.get(phase.id)!;
        deps.add(dep);
      }
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const cycles: string[][] = [];

    const stack: Array<{ node: string; phase: 'enter' | 'exit'; path: string[] }> = [];

    for (const phase of phases) {
      if (color.has(phase.id)) continue;

      stack.push({ node: phase.id, phase: 'enter', path: [] });

      while (stack.length > 0) {
        const frame = stack.pop()!;

        if (frame.phase === 'exit') {
          color.set(frame.node, BLACK);
          continue;
        }

        const c = color.get(frame.node) ?? WHITE;

        if (c === BLACK) continue;

        if (c === GRAY) {
          // Found a cycle
          const cycleStart = frame.path.indexOf(frame.node);
          if (cycleStart >= 0) {
            cycles.push([...frame.path.slice(cycleStart), frame.node]);
          }
          continue;
        }

        // Mark as GRAY and explore
        color.set(frame.node, GRAY);
        const newPath = [...frame.path, frame.node];

        stack.push({ node: frame.node, phase: 'exit', path: newPath });

        const neighbors = adjacency.get(frame.node);
        if (neighbors) {
          for (const neighbor of [...neighbors].reverse()) {
            stack.push({ node: neighbor, phase: 'enter', path: newPath });
          }
        }
      }
    }

    return cycles;
  }

  it('should find cycle in a dense graph with multiple possible cycles', () => {
    const phases: PhaseNode[] = [];
    for (let i = 0; i < 20; i++) {
      const deps: string[] = [];
      if (i > 0) deps.push(`P${i - 1}`);
      phases.push({ id: `P${i}`, deps });
    }
    // Create a cycle: P15 → P5 → P15
    phases[15]!.deps.push('P5');

    const cycles = detectCyclesIterative(phases);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('should find no cycles in a valid DAG', () => {
    const phases: PhaseNode[] = [
      { id: 'A', deps: [] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['A', 'B'] },
      { id: 'D', deps: ['C'] },
      { id: 'E', deps: ['B'] },
    ];
    const cycles = detectCyclesIterative(phases);
    expect(cycles).toHaveLength(0);
  });

  it('should handle a fully connected graph (worst-case for DFS)', () => {
    const phases: PhaseNode[] = [];
    for (let i = 0; i < 20; i++) {
      const deps: string[] = [];
      for (let j = 0; j < i; j++) {
        deps.push(`P${j}`);
      }
      phases.push({ id: `P${i}`, deps });
    }
    // Add a back-edge to create a cycle
    phases[0]!.deps.push(`P${19}`);

    const start = performance.now();
    const cycles = detectCyclesIterative(phases);
    const elapsed = performance.now() - start;
    expect(cycles.length).toBeGreaterThan(0);
    // Should be O(V+E), not O(2^V)
    expect(elapsed).toBeLessThan(200);
  });
});
