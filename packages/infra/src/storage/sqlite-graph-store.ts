// @code-analyzer/infra — SQLite Graph Store
// Persisted SQLite-backed graph store with WAL mode, FTS5, and prepared statements.

import { createRequire } from 'node:module';
import { existsSync, unlinkSync } from 'node:fs';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import type {
  GraphNode,
  GraphEdge,
  NodeLabel,
  RelationshipType,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Lazy import of better-sqlite3 (optional dependency)
// ---------------------------------------------------------------------------

let BetterSqlite3: typeof import('better-sqlite3') | null = null;

try {
  const req = createRequire(import.meta.url);
  BetterSqlite3 = req('better-sqlite3');
/* v8 ignore start */
} catch {
  // better-sqlite3 is optional; SqliteGraphStore throws a clear error on use.
}
/* v8 ignore stop */

// ---------------------------------------------------------------------------
// SQL Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  language TEXT,
  properties TEXT NOT NULL DEFAULT '{}',
  signature TEXT,
  docstring TEXT,
  complexity INTEGER,
  is_exported INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
CREATE INDEX IF NOT EXISTS idx_nodes_qname ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_project_qname ON nodes(project_id, qualified_name);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  name, qualified_name, docstring, signature,
  content='nodes', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, name, qualified_name, docstring, signature)
  VALUES (new.id, new.name, new.qualified_name, new.docstring, new.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, name, qualified_name, docstring, signature)
  VALUES ('delete', old.id, old.name, old.qualified_name, old.docstring, old.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, name, qualified_name, docstring, signature)
  VALUES ('delete', old.id, old.name, old.qualified_name, old.docstring, old.signature);
  INSERT INTO nodes_fts(rowid, name, qualified_name, docstring, signature)
  VALUES (new.id, new.name, new.qualified_name, new.docstring, new.signature);
END;
`;

// ---------------------------------------------------------------------------
// Row types (matching database columns)
// ---------------------------------------------------------------------------

interface NodeRow {
  id: number;
  project_id: string;
  label: string;
  name: string;
  qualified_name: string;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  language: string | null;
  properties: string; // JSON
  signature: string | null;
  docstring: string | null;
  complexity: number | null;
  is_exported: number; // 0 or 1
  fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  id: number;
  project_id: string;
  source_id: number;
  target_id: number;
  type: string;
  properties: string; // JSON
  weight: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// SqliteGraphStore
// ---------------------------------------------------------------------------

export class SqliteGraphStore {
  private db: DatabaseType;

  // Prepared statements — node operations
  private stmtInsertNode!: Statement;
  private stmtGetNode!: Statement;
  private stmtGetNodesByLabel!: Statement;
  private stmtGetNodesByFile!: Statement;
  private stmtGetNodeByQName!: Statement;
  private stmtUpdateNode!: Statement;
  private stmtDeleteNode!: Statement;

  // Prepared statements — edge operations
  private stmtInsertEdge!: Statement;
  private stmtGetEdge!: Statement;
  private stmtGetEdgesBySource!: Statement;
  private stmtGetEdgesByTarget!: Statement;
  private stmtGetEdgesByType!: Statement;
  private stmtUpdateEdge!: Statement;
  private stmtDeleteEdge!: Statement;

  // Prepared statements — search
  private stmtSearchFts!: Statement;
  private stmtSearchFtsByLabel!: Statement;

  // Prepared statements — stats
  private stmtNodeCount!: Statement;
  private stmtEdgeCount!: Statement;
  private stmtLabelCounts!: Statement;
  private stmtEdgeTypeCounts!: Statement;

  // Prepared statements — integrity
  private stmtOrphanEdges!: Statement;
  private stmtDuplicateQnames!: Statement;
  private stmtMissingQnames!: Statement;

  // Prepared statements — traversals
  private stmtNeighbors!: Statement;
  private stmtNodeExists!: Statement;

  private closed = false;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(dbPath: string) {
    /* v8 ignore next 2 */
    if (!BetterSqlite3) {
      throw new Error(
        'SqliteGraphStore requires better-sqlite3. Install it with:\n' +
          '  pnpm add better-sqlite3\n' +
          '  pnpm add -D @types/better-sqlite3',
      );
    }

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Initialize schema
    this.db.exec(SCHEMA_SQL);

    // Prepare all statements
    this.prepareStatements();
  }

  // -----------------------------------------------------------------------
  // Node CRUD
  // -----------------------------------------------------------------------

  insertNode(node: GraphNode): number {
    this.ensureOpen();
    const now = new Date().toISOString();
    const result = this.stmtInsertNode.run({
      project_id: node.projectId,
      label: node.label,
      name: node.name,
      qualified_name: node.qualifiedName,
      file_path: node.filePath,
      start_line: node.startLine,
      end_line: node.endLine,
      language: node.language,
      properties: JSON.stringify(node.properties),
      signature: node.signature,
      docstring: node.docstring,
      complexity: node.complexity,
      is_exported: node.isExported ? 1 : 0,
      fingerprint: node.fingerprint,
      created_at: node.createdAt || now,
      updated_at: node.updatedAt || now,
    });
    return Number(result.lastInsertRowid);
  }

  getNode(id: number): GraphNode | null {
    this.ensureOpen();
    const row = this.stmtGetNode.get(id) as NodeRow | undefined;
    if (!row) return null;
    return this.toGraphNode(row);
  }

  getNodesByLabel(label: NodeLabel): GraphNode[] {
    this.ensureOpen();
    const rows = this.stmtGetNodesByLabel.all(label) as NodeRow[];
    return rows.map((r) => this.toGraphNode(r));
  }

  getNodesByFile(filePath: string): GraphNode[] {
    this.ensureOpen();
    const rows = this.stmtGetNodesByFile.all(filePath) as NodeRow[];
    return rows.map((r) => this.toGraphNode(r));
  }

  getNodeByQName(qualifiedName: string): GraphNode | null {
    this.ensureOpen();
    const row = this.stmtGetNodeByQName.get(qualifiedName) as NodeRow | undefined;
    if (!row) return null;
    return this.toGraphNode(row);
  }

  updateNode(id: number, updates: Partial<GraphNode>): void {
    this.ensureOpen();

    const existing = this.getNode(id);
    if (!existing) {
      throw new Error(`Node update failed: node id=${id} not found`);
    }

    const name = updates.name ?? existing.name;
    const label = updates.label ?? existing.label;
    const projectId = updates.projectId ?? existing.projectId;
    const qualifiedName = updates.qualifiedName ?? existing.qualifiedName;
    const filePath = 'filePath' in updates ? updates.filePath : existing.filePath;
    const startLine = 'startLine' in updates ? updates.startLine : existing.startLine;
    const endLine = 'endLine' in updates ? updates.endLine : existing.endLine;
    const language = 'language' in updates ? updates.language : existing.language;
    const signature = 'signature' in updates ? updates.signature : existing.signature;
    const docstring = 'docstring' in updates ? updates.docstring : existing.docstring;
    const complexity = 'complexity' in updates ? updates.complexity : existing.complexity;
    const isExported = 'isExported' in updates ? updates.isExported : existing.isExported;
    const fingerprint = 'fingerprint' in updates ? updates.fingerprint : existing.fingerprint;

    const properties = updates.properties
      ? JSON.stringify({ ...existing.properties, ...updates.properties })
      : JSON.stringify(existing.properties);

    const now = new Date().toISOString();

    this.stmtUpdateNode.run({
      project_id: projectId,
      label,
      name,
      qualified_name: qualifiedName,
      file_path: filePath,
      start_line: startLine,
      end_line: endLine,
      language,
      properties,
      signature,
      docstring,
      complexity,
      is_exported: isExported ? 1 : 0,
      fingerprint,
      created_at: existing.createdAt,
      updated_at: now,
      id,
    });
  }

  deleteNode(id: number): void {
    this.ensureOpen();
    this.stmtDeleteNode.run(id);
  }

  // -----------------------------------------------------------------------
  // Edge CRUD
  // -----------------------------------------------------------------------

  insertEdge(edge: GraphEdge): number {
    this.ensureOpen();

    // Verify source and target exist
    this.ensureNodeExists(edge.sourceId, 'source');
    this.ensureNodeExists(edge.targetId, 'target');

    const now = new Date().toISOString();
    const result = this.stmtInsertEdge.run({
      project_id: edge.projectId,
      source_id: edge.sourceId,
      target_id: edge.targetId,
      type: edge.type,
      properties: JSON.stringify(edge.properties),
      weight: edge.weight,
      created_at: edge.createdAt || now,
    });
    return Number(result.lastInsertRowid);
  }

  getEdge(id: number): GraphEdge | null {
    this.ensureOpen();
    const row = this.stmtGetEdge.get(id) as EdgeRow | undefined;
    if (!row) return null;
    return this.toGraphEdge(row);
  }

  getEdgesBySource(sourceId: number): GraphEdge[] {
    this.ensureOpen();
    const rows = this.stmtGetEdgesBySource.all(sourceId) as EdgeRow[];
    return rows.map((r) => this.toGraphEdge(r));
  }

  getEdgesByTarget(targetId: number): GraphEdge[] {
    this.ensureOpen();
    const rows = this.stmtGetEdgesByTarget.all(targetId) as EdgeRow[];
    return rows.map((r) => this.toGraphEdge(r));
  }

  getEdgesByType(type: RelationshipType): GraphEdge[] {
    this.ensureOpen();
    const rows = this.stmtGetEdgesByType.all(type) as EdgeRow[];
    return rows.map((r) => this.toGraphEdge(r));
  }

  updateEdge(id: number, updates: Partial<GraphEdge>): void {
    this.ensureOpen();

    const existing = this.getEdge(id);
    if (!existing) {
      throw new Error(`Edge update failed: edge id=${id} not found`);
    }

    const projectId = updates.projectId ?? existing.projectId;
    const sourceId = updates.sourceId ?? existing.sourceId;
    const targetId = updates.targetId ?? existing.targetId;
    const type = updates.type ?? existing.type;
    const weight = 'weight' in updates ? updates.weight : existing.weight;

    const properties = updates.properties
      ? JSON.stringify({ ...existing.properties, ...updates.properties })
      : JSON.stringify(existing.properties);

    if (sourceId !== existing.sourceId || targetId !== existing.targetId) {
      // Verify new endpoints exist
      if (sourceId !== existing.sourceId) {
        this.ensureNodeExists(sourceId, 'source');
      }
      if (targetId !== existing.targetId) {
        this.ensureNodeExists(targetId, 'target');
      }
    }

    this.stmtUpdateEdge.run({
      project_id: projectId,
      source_id: sourceId,
      target_id: targetId,
      type,
      properties,
      weight,
      id,
    });
  }

  deleteEdge(id: number): void {
    this.ensureOpen();
    this.stmtDeleteEdge.run(id);
  }

  // -----------------------------------------------------------------------
  // Bulk Operations
  // -----------------------------------------------------------------------

  insertNodes(nodes: GraphNode[]): number[] {
    this.ensureOpen();
    const ids: number[] = [];

    const insertTransaction = this.db.transaction((allNodes: GraphNode[]) => {
      for (const node of allNodes) {
        const id = this.insertNode(node);
        ids.push(id);
      }
    });

    insertTransaction(nodes);
    return ids;
  }

  insertEdges(edges: GraphEdge[]): number[] {
    this.ensureOpen();
    const ids: number[] = [];

    const insertTransaction = this.db.transaction((allEdges: GraphEdge[]) => {
      for (const edge of allEdges) {
        const id = this.insertEdge(edge);
        ids.push(id);
      }
    });

    insertTransaction(edges);
    return ids;
  }

  // -----------------------------------------------------------------------
  // Search (FTS5)
  // -----------------------------------------------------------------------

  searchNodes(query: string, limit = 20): GraphNode[] {
    this.ensureOpen();
    const ftsQuery = this.buildFtsQuery(query);
    const rows = this.stmtSearchFts.all(ftsQuery, limit) as NodeRow[];
    return rows.map((r) => this.toGraphNode(r));
  }

  searchNodesByLabel(query: string, label: NodeLabel, limit = 20): GraphNode[] {
    this.ensureOpen();
    const ftsQuery = this.buildFtsQuery(query);
    const rows = this.stmtSearchFtsByLabel.all(ftsQuery, label, limit) as NodeRow[];
    return rows.map((r) => this.toGraphNode(r));
  }

  // -----------------------------------------------------------------------
  // Graph Traversal — BFS
  // -----------------------------------------------------------------------

  bfs(startId: number, maxDepth: number = Number.POSITIVE_INFINITY): GraphNode[] {
    this.ensureOpen();

    const startNode = this.getNode(startId);
    if (!startNode) return [];

    const visited = new Set<number>();
    const result: GraphNode[] = [];
    const queue: Array<{ nodeId: number; depth: number }> = [];

    queue.push({ nodeId: startId, depth: 0 });
    visited.add(startId);
    result.push(startNode);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const neighbors = this.stmtNeighbors.all(current.nodeId) as { target_id: number }[];

      for (const neighbor of neighbors) {
        const neighborId = neighbor.target_id;
        if (visited.has(neighborId)) continue;

        visited.add(neighborId);
        const neighborNode = this.getNode(neighborId);
        if (neighborNode) {
          result.push(neighborNode);
        }
        queue.push({ nodeId: neighborId, depth: current.depth + 1 });
      }
    }

    return result;
  }

  getNeighbors(nodeId: number): { node: GraphNode; edge: GraphEdge }[] {
    this.ensureOpen();

    // Get outgoing edges from this node
    const edges = this.getEdgesBySource(nodeId);
    const neighbors: { node: GraphNode; edge: GraphEdge }[] = [];

    for (const edge of edges) {
      const node = this.getNode(edge.targetId);
      if (node) {
        neighbors.push({ node, edge });
      }
    }

    return neighbors;
  }

  // -----------------------------------------------------------------------
  // Integrity & Maintenance
  // -----------------------------------------------------------------------

  validate(): { valid: boolean; issues: string[] } {
    this.ensureOpen();
    const issues: string[] = [];

    // Check for orphan edges
    const orphanRows = this.stmtOrphanEdges.all() as { edge_id: number; missing_side: string; node_id: number }[];
    /* v8 ignore start */
    for (const row of orphanRows) {
      issues.push(
        `Edge id=${row.edge_id} references missing ${row.missing_side} node id=${row.node_id}`,
      );
    }
    /* v8 ignore stop */

    // Check for duplicate qualified names (per project)
    const dupRows = this.stmtDuplicateQnames.all() as { qualified_name: string; project_id: string; cnt: number; ids: string }[];
    /* v8 ignore start */
    for (const row of dupRows) {
      issues.push(
        `Qualified name "${row.qualified_name}" in project "${row.project_id}" has ${row.cnt} nodes: ${row.ids}`,
      );
    }
    /* v8 ignore stop */

    // Check for missing qualified names
    const missingQnameRows = this.stmtMissingQnames.all() as { id: number; name: string }[];
    for (const row of missingQnameRows) {
      issues.push(
        `Node id=${row.id} name="${row.name}" has empty qualifiedName`,
      );
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  getStats(): {
    nodeCount: number;
    edgeCount: number;
    labels: Record<string, number>;
    edgeTypes: Record<string, number>;
  } {
    this.ensureOpen();

    const nodeCount = (this.stmtNodeCount.get() as { cnt: number }).cnt;
    const edgeCount = (this.stmtEdgeCount.get() as { cnt: number }).cnt;

    const labelRows = this.stmtLabelCounts.all() as { label: string; cnt: number }[];
    const labels: Record<string, number> = {};
    for (const row of labelRows) {
      labels[row.label] = row.cnt;
    }

    const typeRows = this.stmtEdgeTypeCounts.all() as { type: string; cnt: number }[];
    const edgeTypes: Record<string, number> = {};
    for (const row of typeRows) {
      edgeTypes[row.type] = row.cnt;
    }

    return { nodeCount, edgeCount, labels, edgeTypes };
  }

  vacuum(): void {
    this.ensureOpen();
    this.db.exec('VACUUM');
  }

  close(): void {
    if (!this.closed) {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        /* v8 ignore next 2 */
        // Ignore checkpoint errors during close
      }
      this.db.close();
      this.closed = true;
    }
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('SqliteGraphStore is closed');
    }
  }

  private ensureNodeExists(nodeId: number, role: 'source' | 'target'): void {
    const exists = this.stmtNodeExists.get(nodeId) as { id: number } | undefined;
    if (!exists) {
      throw new Error(`Edge insert failed: ${role} node id=${nodeId} not found`);
    }
  }

  private buildFtsQuery(query: string): string {
    // Escape special FTS5 characters and build a prefix query
    const terms = query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, '""')}"*`)
      .join(' AND ');
    return terms || '""';
  }

  // -----------------------------------------------------------------------
  // Row → GraphNode / GraphEdge conversion
  // -----------------------------------------------------------------------

  private toGraphNode(row: NodeRow): GraphNode {
    return {
      id: row.id,
      projectId: row.project_id,
      label: row.label as NodeLabel,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      language: row.language,
      properties: JSON.parse(row.properties),
      signature: row.signature,
      docstring: row.docstring,
      complexity: row.complexity,
      isExported: row.is_exported === 1,
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toGraphEdge(row: EdgeRow): GraphEdge {
    return {
      id: row.id,
      projectId: row.project_id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type as RelationshipType,
      properties: JSON.parse(row.properties),
      weight: row.weight,
      createdAt: row.created_at,
    };
  }

  // -----------------------------------------------------------------------
  // Prepare All Statements
  // -----------------------------------------------------------------------

  private prepareStatements(): void {
    // Node statements — using `@` named parameters
    this.stmtInsertNode = this.db.prepare(`
      INSERT INTO nodes (
        project_id, label, name, qualified_name, file_path,
        start_line, end_line, language, properties, signature,
        docstring, complexity, is_exported, fingerprint,
        created_at, updated_at
      ) VALUES (
        @project_id, @label, @name, @qualified_name, @file_path,
        @start_line, @end_line, @language, @properties, @signature,
        @docstring, @complexity, @is_exported, @fingerprint,
        @created_at, @updated_at
      )
    `);

    this.stmtGetNode = this.db.prepare('SELECT * FROM nodes WHERE id = ?');

    this.stmtGetNodesByLabel = this.db.prepare('SELECT * FROM nodes WHERE label = ?');

    this.stmtGetNodesByFile = this.db.prepare('SELECT * FROM nodes WHERE file_path = ?');

    this.stmtGetNodeByQName = this.db.prepare('SELECT * FROM nodes WHERE qualified_name = ? LIMIT 1');

    this.stmtUpdateNode = this.db.prepare(`
      UPDATE nodes SET
        project_id = @project_id,
        label = @label,
        name = @name,
        qualified_name = @qualified_name,
        file_path = @file_path,
        start_line = @start_line,
        end_line = @end_line,
        language = @language,
        properties = @properties,
        signature = @signature,
        docstring = @docstring,
        complexity = @complexity,
        is_exported = @is_exported,
        fingerprint = @fingerprint,
        created_at = @created_at,
        updated_at = @updated_at
      WHERE id = @id
    `);

    this.stmtDeleteNode = this.db.prepare('DELETE FROM nodes WHERE id = ?');

    // Edge statements — using `@` named parameters for multi-field ops
    this.stmtInsertEdge = this.db.prepare(`
      INSERT INTO edges (
        project_id, source_id, target_id, type, properties, weight, created_at
      ) VALUES (
        @project_id, @source_id, @target_id, @type, @properties, @weight, @created_at
      )
    `);

    this.stmtGetEdge = this.db.prepare('SELECT * FROM edges WHERE id = ?');

    this.stmtGetEdgesBySource = this.db.prepare('SELECT * FROM edges WHERE source_id = ?');

    this.stmtGetEdgesByTarget = this.db.prepare('SELECT * FROM edges WHERE target_id = ?');

    this.stmtGetEdgesByType = this.db.prepare('SELECT * FROM edges WHERE type = ?');

    this.stmtUpdateEdge = this.db.prepare(`
      UPDATE edges SET
        project_id = @project_id,
        source_id = @source_id,
        target_id = @target_id,
        type = @type,
        properties = @properties,
        weight = @weight
      WHERE id = @id
    `);

    this.stmtDeleteEdge = this.db.prepare('DELETE FROM edges WHERE id = ?');

    // FTS5 search statements
    this.stmtSearchFts = this.db.prepare(`
      SELECT nodes.* FROM nodes
      INNER JOIN nodes_fts ON nodes.id = nodes_fts.rowid
      WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?
    `);

    this.stmtSearchFtsByLabel = this.db.prepare(`
      SELECT nodes.* FROM nodes
      INNER JOIN nodes_fts ON nodes.id = nodes_fts.rowid
      WHERE nodes_fts MATCH ? AND nodes.label = ? ORDER BY rank LIMIT ?
    `);

    // Stats statements
    this.stmtNodeCount = this.db.prepare('SELECT COUNT(*) as cnt FROM nodes');
    this.stmtEdgeCount = this.db.prepare('SELECT COUNT(*) as cnt FROM edges');
    this.stmtLabelCounts = this.db.prepare('SELECT label, COUNT(*) as cnt FROM nodes GROUP BY label');
    this.stmtEdgeTypeCounts = this.db.prepare('SELECT type, COUNT(*) as cnt FROM edges GROUP BY type');

    // Integrity statements
    this.stmtOrphanEdges = this.db.prepare(`
      SELECT
        e.id AS edge_id,
        CASE
          WHEN s.id IS NULL THEN 'source'
          WHEN t.id IS NULL THEN 'target'
        END AS missing_side,
        CASE
          WHEN s.id IS NULL THEN e.source_id
          WHEN t.id IS NULL THEN e.target_id
        END AS node_id
      FROM edges e
      LEFT JOIN nodes s ON e.source_id = s.id
      LEFT JOIN nodes t ON e.target_id = t.id
      WHERE s.id IS NULL OR t.id IS NULL
    `);

    this.stmtDuplicateQnames = this.db.prepare(`
      SELECT
        qualified_name,
        project_id,
        COUNT(*) as cnt,
        GROUP_CONCAT(id, ',') as ids
      FROM nodes
      WHERE qualified_name != ''
      GROUP BY project_id, qualified_name
      HAVING COUNT(*) > 1
    `);

    this.stmtMissingQnames = this.db.prepare(`
      SELECT id, name FROM nodes WHERE qualified_name = '' OR qualified_name IS NULL
    `);

    // Traversal statements
    this.stmtNeighbors = this.db.prepare('SELECT target_id FROM edges WHERE source_id = ?');
    this.stmtNodeExists = this.db.prepare('SELECT id FROM nodes WHERE id = ?');
  }
}

/**
 * Delete a SQLite database file (for cleanup in tests).
 */
export function deleteDatabase(dbPath: string): void {
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
}
