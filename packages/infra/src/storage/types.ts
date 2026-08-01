// @code-analyzer/infra — Infra-Specific Types
// Types used exclusively within the infrastructure layer.

import type {
  GraphNode,
  GraphEdge,
  NodeLabel,
  RelationshipType,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Query Types
// ---------------------------------------------------------------------------

export interface NodeQuery {
  projectId: string;
  label?: NodeLabel | NodeLabel[];
  namePattern?: string;
  qualifiedNamePattern?: string;
  filePattern?: string;
  minLine?: number;
  maxLine?: number;
  isExported?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'name' | 'complexity' | 'line_count';
  sortDirection?: 'asc' | 'desc';
}

export interface EdgeQuery {
  projectId: string;
  sourceId?: number;
  targetId?: number;
  type?: RelationshipType | RelationshipType[];
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// FTS (Full-Text Search) Types
// ---------------------------------------------------------------------------

export interface FtsSearchResult {
  nodeId: number;
  node: GraphNode;
  rank: number;
  matchedColumn: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// BFS (Breadth-First Search) Types
// ---------------------------------------------------------------------------

export interface BfsResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pathLengths: Map<number, number>;
  visitedCount: number;
  maxDepthReached: number;
}

// ---------------------------------------------------------------------------
// Integrity Check Types
// ---------------------------------------------------------------------------

export interface IntegrityIssue {
  type: 'orphan_edge' | 'missing_node' | 'duplicate_qname' | 'invalid_edge' | 'missing_qname';
  description: string;
  nodeId?: number;
  edgeId?: number;
  qname?: string;
}

export interface IntegrityReport {
  projectId: string;
  valid: boolean;
  nodeCount: number;
  edgeCount: number;
  orphanEdges: number;
  duplicateQnames: number;
  issues: IntegrityIssue[];
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// File System Event Types
// ---------------------------------------------------------------------------

export interface FileChangeEvent {
  type: 'add' | 'modify' | 'delete' | 'rename';
  filePath: string;
  oldPath?: string;
}

// ---------------------------------------------------------------------------
// Git Diff Internals
// ---------------------------------------------------------------------------

export interface GitDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: string[];
}

// ---------------------------------------------------------------------------
// Supervisor Types (duplicated from shared due to build issues)
// ---------------------------------------------------------------------------

export interface SupervisorResult {
  status: 'complete' | 'partial' | 'crashed' | 'timeout';
  filesProcessed: number;
  filesFailed: number;
  quarantinedFiles: QuarantinedFile[];
  crashReports: CrashReport[];
  duration: number;
  peakMemory: number;
}

export interface QuarantinedFile {
  filePath: string;
  error: string;
  quarantinedAt: string;
}

export interface CrashReport {
  filePath: string;
  error: string;
  signal?: string;
  stackTrace?: string;
  attemptNumber: number;
}
