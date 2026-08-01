// @code-analyzer/infra — Test Helpers
// Shared utilities for constructing test data.

import type {
  GraphNode,
  GraphEdge,
  EdgeProperties,
} from '@code-analyzer/shared';

let nodeIdCounter = 0;
let edgeIdCounter = 0;

export function createTestNode(overrides: Partial<GraphNode> & { id?: number } = {}): GraphNode {
  const id = overrides.id ?? ++nodeIdCounter;
  return {
    id,
    projectId: hasKey(overrides, 'projectId') ? overrides.projectId! : 'test-project',
    label: hasKey(overrides, 'label') ? overrides.label! : 'Function',
    name: hasKey(overrides, 'name') ? overrides.name! : `testFunc${id}`,
    qualifiedName: hasKey(overrides, 'qualifiedName') ? overrides.qualifiedName! : `test.package.testFunc${id}`,
    filePath: hasKey(overrides, 'filePath') ? overrides.filePath! : `src/func${id}.ts`,
    startLine: hasKey(overrides, 'startLine') ? overrides.startLine! : 1,
    endLine: hasKey(overrides, 'endLine') ? overrides.endLine! : 10,
    language: hasKey(overrides, 'language') ? overrides.language! : 'typescript',
    properties: hasKey(overrides, 'properties') ? overrides.properties! : { name: `testFunc${id}` },
    signature: hasKey(overrides, 'signature') ? overrides.signature! : `(arg: string): void`,
    docstring: hasKey(overrides, 'docstring') ? overrides.docstring! : `Docs for testFunc${id}`,
    complexity: hasKey(overrides, 'complexity') ? overrides.complexity! : 5,
    isExported: hasKey(overrides, 'isExported') ? overrides.isExported! : true,
    fingerprint: hasKey(overrides, 'fingerprint') ? overrides.fingerprint! : `fp_${id}`,
    createdAt: hasKey(overrides, 'createdAt') ? overrides.createdAt! : new Date().toISOString(),
    updatedAt: hasKey(overrides, 'updatedAt') ? overrides.updatedAt! : new Date().toISOString(),
  };
}

function hasKey<T extends object>(obj: T, key: keyof T): boolean {
  return key in obj;
}

export function createTestEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  const id = overrides.id ?? ++edgeIdCounter;
  return {
    id,
    projectId: overrides.projectId ?? 'test-project',
    sourceId: overrides.sourceId ?? 1,
    targetId: overrides.targetId ?? 2,
    type: overrides.type ?? 'CALLS',
    properties: overrides.properties ?? {} as EdgeProperties,
    weight: overrides.weight ?? 1,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

export function resetCounters(): void {
  nodeIdCounter = 0;
  edgeIdCounter = 0;
}
