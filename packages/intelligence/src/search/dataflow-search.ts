// @code-analyzer/intelligence — Dataflow Search Engine
// Taint-tracking and source-to-sink path analysis using the knowledge graph.
// Integrates as the 5th dimension in HybridSearchEngine's RRF fusion.

import type { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataflowNode {
  /** Node ID in the knowledge graph */
  nodeId: number;
  /** Human-readable name */
  name: string;
  /** File path where this node resides */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Type of dataflow node */
  kind: 'source' | 'transform' | 'sanitizer' | 'sink' | 'intermediate';
}

export interface DataflowPath {
  /** Ordered sequence of nodes in the dataflow path */
  nodes: DataflowNode[];
  /** Risk score (0–100), higher = more dangerous */
  riskScore: number;
  /** Whether the path passes through a sanitizer */
  hasSanitizer: boolean;
  /** Description of why this path is flagged */
  description: string;
}

export interface ReachableSink {
  /** Sink node */
  sink: DataflowNode;
  /** All paths from source to this sink */
  paths: DataflowPath[];
  /** Shortest path length (edges) */
  shortestPathLength: number;
}

export interface TaintReport {
  /** Source entry points analyzed */
  entryPoints: string[];
  /** All dataflow paths found */
  paths: DataflowPath[];
  /** Number of sinks reachable */
  reachableSinkCount: number;
  /** Whether sanitizers are present on critical paths */
  sanitizersPresent: boolean;
  /** Overall risk assessment */
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
}

// ---------------------------------------------------------------------------
// Known Source/Sink Patterns
// ---------------------------------------------------------------------------

interface TaintSource {
  /** Regex pattern matching source identifier names */
  namePattern: RegExp;
  /** Category */
  category: 'user_input' | 'network' | 'filesystem' | 'environment';
  /** Risk contribution */
  riskWeight: number;
}

interface TaintSink {
  /** Regex pattern matching sink identifier names */
  namePattern: RegExp;
  /** Category */
  category: 'db_query' | 'file_write' | 'code_exec' | 'network_send' | 'command_exec';
  /** Risk contribution */
  riskWeight: number;
}

interface Sanitizer {
  namePattern: RegExp;
  /** What it sanitizes against */
  protects: 'sql_injection' | 'xss' | 'path_traversal' | 'command_injection' | 'general';
}

const DEFAULT_SOURCES: TaintSource[] = [
  {
    namePattern:
      /\b(?:req\.(?:body|query|params|headers)|request\.(?:body|query|params)|ctx\.request\.(?:body|query))/,
    category: 'user_input',
    riskWeight: 8,
  },
  {
    namePattern: /\b(?:process\.argv|process\.env|Deno\.args|sys\.argv)/,
    category: 'environment',
    riskWeight: 4,
  },
  { namePattern: /\b(?:readFile|fs\.readFile|open\s*\()/, category: 'filesystem', riskWeight: 6 },
  {
    namePattern: /\b(?:fetch|axios|http\.get|urllib\.request|reqwest|HttpClient)/,
    category: 'network',
    riskWeight: 7,
  },
];

const DEFAULT_SINKS: TaintSink[] = [
  {
    namePattern:
      /\b(?:db\.query|db\.execute|sequelize\.query|mongoose\.exec|sql|query\(|connection\.query)/,
    category: 'db_query',
    riskWeight: 10,
  },
  {
    namePattern: /\b(?:writeFile|writeFileSync|fs\.write|fs\.appendFile|open\s*\(\s*['\"]w)/,
    category: 'file_write',
    riskWeight: 7,
  },
  {
    namePattern: /\b(?:eval|exec|execSync|spawn|subprocess|child_process|os\.exec)\s*\(/,
    category: 'code_exec',
    riskWeight: 10,
  },
  {
    namePattern: /\b(?:res\.send|res\.write|res\.json|res\.end|sendResponse|http\.response)/,
    category: 'network_send',
    riskWeight: 6,
  },
  {
    namePattern: /\b(?:child_process\.exec|shelljs\.exec|\.run\s*\(|sh\s+-c)/,
    category: 'command_exec',
    riskWeight: 9,
  },
];

const DEFAULT_SANITIZERS: Sanitizer[] = [
  {
    namePattern: /\b(?:DOMPurify\.sanitize|sanitizeHtml|escapeHtml|encodeURI|htmlspecialchars)/,
    protects: 'xss',
  },
  {
    namePattern: /\b(?:mysql\.escape|pg\.escape|parameterize|escapeSQL|escape_query)/,
    protects: 'sql_injection',
  },
  {
    namePattern: /\b(?:path\.basename|path\.normalize|sanitizePath|escapePath|path\.resolve)/,
    protects: 'path_traversal',
  },
  {
    namePattern: /\b(?:escapeShellArg|shellQuote|escapeShell|sanitizeCommand)/,
    protects: 'command_injection',
  },
  {
    namePattern: /\b(?:zod\.parse|yup\.validate|joi\.validate|class-validator|validate\s*\()/,
    protects: 'general',
  },
];

// ---------------------------------------------------------------------------
// Dataflow Search Engine
// ---------------------------------------------------------------------------

export class DataflowSearchEngine {
  private sources: TaintSource[];
  private sinks: TaintSink[];
  private sanitizers: Sanitizer[];

  constructor(
    private store: InMemoryGraphStore,
    options?: {
      sources?: TaintSource[];
      sinks?: TaintSink[];
      sanitizers?: Sanitizer[];
    },
  ) {
    this.sources = options?.sources ?? DEFAULT_SOURCES;
    this.sinks = options?.sinks ?? DEFAULT_SINKS;
    this.sanitizers = options?.sanitizers ?? DEFAULT_SANITIZERS;
  }

  /**
   * Find all dataflow paths from any source to any sink.
   * Uses BFS from each identified source node with adjacency traversal.
   */
  findPaths(options?: { maxDepth?: number; maxPaths?: number }): DataflowPath[] {
    const maxDepth = options?.maxDepth ?? 10;
    const maxPaths = options?.maxPaths ?? 100;
    const allPaths: DataflowPath[] = [];

    // Identify source and sink nodes in the graph
    const identifiedSources = this.identifyNodes(this.sources);
    const identifiedSinks = this.identifyNodes(this.sinks);
    const identifiedSanitizers = this.identifySanitizerNodes();

    for (const sourceNode of identifiedSources) {
      // BFS from each source
      const paths = this.bfsFromSource(sourceNode, identifiedSinks, identifiedSanitizers, maxDepth);
      allPaths.push(...paths);

      if (allPaths.length >= maxPaths) break;
    }

    // Sort by risk score descending
    return allPaths.sort((a, b) => b.riskScore - a.riskScore).slice(0, maxPaths);
  }

  /**
   * Find all reachable sinks from a specific source node.
   */
  findReachableSinks(sourceNodeId: number, maxDepth: number = 10): ReachableSink[] {
    const sourceNode = this.store.getNode(sourceNodeId);
    if (!sourceNode) return [];

    const identifiedSinks = this.identifyNodes(this.sinks);
    const identifiedSanitizers = this.identifySanitizerNodes();

    const sourceDataflowNode: DataflowNode = {
      nodeId: sourceNode.id,
      name: sourceNode.name,
      filePath: sourceNode.filePath ?? '',
      line: sourceNode.startLine ?? 0,
      kind: 'source',
    };

    const paths = this.bfsFromSource(
      sourceDataflowNode,
      identifiedSinks,
      identifiedSanitizers,
      maxDepth,
    );

    // bfsFromSource records each sink at most once (its visited set deduplicates
    // edge targets) and every recorded path terminates at a sink, so each path
    // maps directly to a single reachable sink.
    return paths.map((path) => {
      const sink = path.nodes[path.nodes.length - 1]!;
      return {
        sink,
        paths: [path],
        shortestPathLength: path.nodes.length,
      };
    });
  }

  /**
   * Full taint analysis: trace from entry points to all sinks.
   */
  taintAnalysis(entryPoints: string[], maxDepth: number = 10): TaintReport {
    // Build custom source patterns from entry points
    const customSources: TaintSource[] = entryPoints.map((name) => ({
      namePattern: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
      category: 'user_input' as const,
      riskWeight: 8,
    }));

    // Temporarily swap sources for this analysis
    const originalSources = this.sources;
    this.sources = customSources;

    const paths = this.findPaths({ maxDepth, maxPaths: 200 });
    this.sources = originalSources;

    const reachableCount = new Set(
      paths.map((p) => p.nodes[p.nodes.length - 1]?.nodeId).filter(Boolean),
    ).size;
    const sanitizerPaths = paths.filter((p) => p.hasSanitizer);

    let overallRisk: TaintReport['overallRisk'] = 'low';
    const maxRisk = paths.length > 0 ? Math.max(...paths.map((p) => p.riskScore)) : 0;
    if (paths.some((p) => p.riskScore >= 90)) overallRisk = 'critical';
    else if (maxRisk >= 70) overallRisk = 'high';
    else if (maxRisk >= 40) overallRisk = 'medium';

    return {
      entryPoints,
      paths,
      reachableSinkCount: reachableCount,
      sanitizersPresent: sanitizerPaths.length > 0,
      overallRisk,
    };
  }

  /**
   * Check a single piece of content for taint patterns.
   * Returns all dataflow-related findings as a string summary.
   */
  analyzeContent(content: string, filePath: string): DataflowPath[] {
    const paths: DataflowPath[] = [];
    const lines = content.split('\n');

    // Check each line for source + sink coexistence
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // find() doubles as the presence check and the category lookup, avoiding
      // the redundant some() + find() scan over the same pattern list.
      const matchedSource = this.sources.find((s) => s.namePattern.test(line));
      if (!matchedSource) continue;

      const sinkFound = this.sinks.find((s) => s.namePattern.test(line));
      const hasSanitizer = this.sanitizers.some((s) => s.namePattern.test(line));

      const node: DataflowNode = {
        nodeId: 0,
        name: line.trim().slice(0, 60),
        filePath,
        line: i + 1,
        kind: 'source',
      };

      if (sinkFound) {
        const sinkKind = sinkFound.category;
        paths.push({
          nodes: [
            node,
            {
              nodeId: 0,
              name: line.trim().slice(0, 60),
              filePath,
              line: i + 1,
              kind: 'sink',
            },
          ],
          riskScore: hasSanitizer ? 40 : 80,
          hasSanitizer,
          description: `Potential taint flow: ${matchedSource.category} → ${sinkKind} in ${filePath}:${i + 1}`,
        });
      }
    }

    return paths;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private identifyNodes(patterns: TaintSource[] | TaintSink[]): DataflowNode[] {
    const nodes: DataflowNode[] = [];
    const allNodes = this.store.getAllNodes();

    // Determine whether these are sources or sinks based on the category value
    const sinkCategories = new Set(this.sinks.map((s) => s.category));

    for (const node of allNodes) {
      const searchText = `${node.name} ${node.qualifiedName} ${node.signature ?? ''}`;
      for (const pattern of patterns) {
        if (pattern.namePattern.test(searchText)) {
          const isSink = sinkCategories.has((pattern as TaintSink).category);
          nodes.push({
            nodeId: node.id,
            name: node.name,
            filePath: node.filePath ?? '',
            line: node.startLine ?? 0,
            kind: isSink
              ? (this.mapSinkCategory as (c: TaintSink['category']) => DataflowNode['kind'])(
                  (pattern as TaintSink).category,
                )
              : (this.mapSourceCategory as (c: TaintSource['category']) => DataflowNode['kind'])(
                  (pattern as TaintSource).category,
                ),
          });
          break;
        }
      }
    }

    return nodes;
  }

  private identifySanitizerNodes(): Set<number> {
    const sanitizerNodeIds = new Set<number>();
    const allNodes = this.store.getAllNodes();

    for (const node of allNodes) {
      const searchText = `${node.name} ${node.qualifiedName} ${node.signature ?? ''}`;
      for (const sanitizer of this.sanitizers) {
        if (sanitizer.namePattern.test(searchText)) {
          sanitizerNodeIds.add(node.id);
          break;
        }
      }
    }

    return sanitizerNodeIds;
  }

  private bfsFromSource(
    source: DataflowNode,
    allSinks: DataflowNode[],
    sanitizerIds: Set<number>,
    maxDepth: number,
  ): DataflowPath[] {
    const sinkSet = new Set(allSinks.map((s) => s.nodeId));
    const paths: DataflowPath[] = [];

    // A non-positive maxDepth forbids any traversal: the source itself is never
    // a sink, so "maximum depth 0" yields no paths.
    if (maxDepth <= 0) return [];

    // BFS using adjacency from the graph store
    const visited = new Set<number>();
    const queue: Array<{
      nodeId: number;
      path: DataflowNode[];
      depth: number;
      metSanitizer: boolean;
    }> = [];

    queue.push({
      nodeId: source.nodeId,
      path: [source],
      depth: 0,
      metSanitizer: false,
    });
    visited.add(source.nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Get outgoing edges
      const edges = this.store.queryEdges({
        projectId: '', // match all — we're searching across projects
        sourceId: current.nodeId,
      });

      for (const edge of edges.items) {
        if (visited.has(edge.targetId)) continue;
        visited.add(edge.targetId);

        const targetNode = this.store.getNode(edge.targetId);
        if (!targetNode) continue;

        const isSanitizer = sanitizerIds.has(targetNode.id);
        const isSink = sinkSet.has(targetNode.id);

        const dataflowNode: DataflowNode = {
          nodeId: targetNode.id,
          name: targetNode.name,
          filePath: targetNode.filePath ?? '',
          line: targetNode.startLine ?? 0,
          kind: isSink ? 'sink' : isSanitizer ? 'sanitizer' : 'intermediate',
        };

        const newPath = [...current.path, dataflowNode];
        const hasSanitizer = current.metSanitizer || isSanitizer;

        if (isSink) {
          const riskScore = this.computeRiskScore(newPath, hasSanitizer);
          paths.push({
            nodes: newPath,
            riskScore,
            hasSanitizer,
            description: `Dataflow path: ${newPath.map((n) => n.name).join(' → ')}`,
          });
        } else if (current.depth + 1 < maxDepth) {
          queue.push({
            nodeId: targetNode.id,
            path: newPath,
            depth: current.depth + 1,
            metSanitizer: hasSanitizer,
          });
        }
      }
    }

    return paths;
  }

  private computeRiskScore(path: DataflowNode[], hasSanitizer: boolean): number {
    // Every path is recorded only when it terminates at a sink (see bfsFromSource),
    // so the terminal node is always a sink and the origin is always a source.
    // Base score from path length (longer path = more opportunities for validation).
    let score = Math.min(path.length * 10, 50);

    // Sink terminal always contributes risk.
    score += 30;

    // Source origin always contributes risk.
    score += 20;

    // Sanitizer reduces risk significantly.
    if (hasSanitizer) {
      score = Math.floor(score * 0.5);
    }

    return Math.min(100, score);
  }

  private mapSourceCategory(_cat: TaintSource['category']): DataflowNode['kind'] {
    return 'source';
  }

  private mapSinkCategory(_cat: TaintSink['category']): DataflowNode['kind'] {
    return 'sink';
  }
}
