// @code-analyzer/intelligence — Structure Review Lens
// Detects architectural issues: complexity, coupling, cohesion, god classes,
// long methods, deep nesting, layer violations, circular imports,
// barrel export anti-patterns, orphan code.

import type {
  LensFinding,
  EvidenceAnchor,
  LensReport,
} from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';
import type { GraphNode, GraphEdge, RelationshipType } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_IMPORTS, EDGE_TESTS } from '@code-analyzer/shared';
import type { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Layer rule types
// ---------------------------------------------------------------------------

/** Layer definition parsed from .code-analyzer.yml */
interface LayerRule {
  name: string;
  /** Path prefixes belonging to this layer (e.g. "src/services/") */
  paths: string[];
  /** Layers this layer is forbidden from importing */
  forbiddenImports: string[];
}

/** Parse layer rules from config content (YAML-like subset) */
function parseLayerRules(configContent: string): LayerRule[] {
  const rules: LayerRule[] = [];
  const lines = configContent.split('\n');
  let currentRule: Partial<LayerRule> | null = null;
  let inForbidden = false;
  let inPaths = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Match "- name: <layer-name>"
    const nameMatch = trimmed.match(/^\s*-\s*name\s*:\s*(.+)/);
    if (nameMatch) {
      if (currentRule?.name) {
        rules.push({
          name: currentRule.name,
          paths: currentRule.paths ?? [],
          forbiddenImports: currentRule.forbiddenImports ?? [],
        });
      }
      currentRule = { name: nameMatch[1]!.trim(), paths: [], forbiddenImports: [] };
      inForbidden = false;
      inPaths = false;
      continue;
    }

    if (!currentRule) continue;

    if (trimmed.startsWith('paths:')) { inPaths = true; inForbidden = false; continue; }
    if (trimmed.startsWith('forbidden_imports:') || trimmed.startsWith('forbidden:')) {
      inPaths = false;
      inForbidden = true;
      continue;
    }
    if (trimmed.startsWith('#') || trimmed === '') {
      inPaths = false;
      inForbidden = false;
      continue;
    }

    if (inPaths) {
      const pathMatch = trimmed.match(/^\s*-\s*(.+)/);
      if (pathMatch) currentRule.paths!.push(pathMatch[1]!.trim());
    }
    if (inForbidden) {
      const forbidMatch = trimmed.match(/^\s*-\s*(.+)/);
      if (forbidMatch) currentRule.forbiddenImports!.push(forbidMatch[1]!.trim());
    }
  }

  if (currentRule?.name) {
    rules.push({
      name: currentRule.name,
      paths: currentRule.paths ?? [],
      forbiddenImports: currentRule.forbiddenImports ?? [],
    });
  }

  return rules;
}

/** Determine which layer a file belongs to based on path prefix */
function resolveLayer(filePath: string, rules: LayerRule[]): string | null {
  for (const rule of rules) {
    for (const prefix of rule.paths) {
      if (filePath.startsWith(prefix)) return rule.name;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detection functions (existing)
// ---------------------------------------------------------------------------

/** Count cyclomatic complexity branches in source lines */
function countBranches(lines: string[]): number {
  let count = 1; // base complexity
  for (const line of lines) {
    const t = line.trim();
    if (/\bif\b|\belse if\b|\?.*:|&&|\|\||\bcase\b|\bcatch\b|\bfor\b|\bwhile\b|\?.+\b/.test(t)) count++;
  }
  return count;
}

/** Count the number of dependency imports in source */
function countImports(lines: string[]): number {
  let count = 0;
  for (const line of lines) {
    if (/\bimport\b|\brequire\s*\(|\bfrom\s+['"]/.test(line)) count++;
  }
  return count;
}

/** Detect nesting depth from indentation */
function maxNestingDepth(lines: string[]): number {
  let max = 0;
  for (const line of lines) {
    const indent = line.search(/\S/);
    if (indent > 0) max = Math.max(max, Math.floor(indent / 2));
  }
  return max;
}

/** Count method/function definitions within a class/scope */
function countMethods(lines: string[]): number {
  let count = 0;
  for (const line of lines) {
    if (/\b(?:function|async\s+function|static\s+(?:async\s+)?)\s*\w+\s*\(/.test(line) ||
        /\b\w+\s*\([^)]*\)\s*\{/.test(line)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// NEW: Layer violation detection
// ---------------------------------------------------------------------------

/**
 * Detect layer violations by comparing import statements against
 * `.code-analyzer.yml` layer rules.
 */
function detectLayerViolations(
  lines: string[],
  filePath: string,
  layerRules: LayerRule[],
): LensFinding[] {
  const findings: LensFinding[] = [];
  if (layerRules.length === 0) return findings;

  const sourceLayer = resolveLayer(filePath, layerRules);
  if (!sourceLayer) return findings;

  const sourceRule = layerRules.find(r => r.name === sourceLayer);
  if (!sourceRule || sourceRule.forbiddenImports.length === 0) return findings;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const importMatch = line.match(/import\s+.*\s+from\s+['"](.+)['"]/);
    const requireMatch = line.match(/require\s*\(\s*['"](.+)['"]\s*\)/);
    const importPath = importMatch?.[1] ?? requireMatch?.[1];
    if (!importPath) continue;

    for (const forbidden of sourceRule.forbiddenImports) {
      if (resolveLayer(importPath, layerRules) === forbidden) {
        const evidence: EvidenceAnchor = {
          filePath,
          startLine: i + 1,
          endLine: i + 1,
          codeSnippet: line.trim().slice(0, 200),
          lens: 'structure',
          ruleId: 'struct-layer-violation',
        };
        const f = createLensFinding(
          'structure', 'architecture', 'high',
          `Layer Violation: ${sourceLayer} imports from ${forbidden}`,
          `File in "${sourceLayer}" layer imports from forbidden layer "${forbidden}": "${importPath}". This violates the architecture rules defined in .code-analyzer.yml.`,
          evidence,
          { suggestion: `Move shared logic to a common layer or use dependency inversion.`, ruleId: 'struct-layer-violation' });
        if (f) findings.push(f);
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Circular import detection via graph BFS
// ---------------------------------------------------------------------------

/**
 * Detect circular imports using BFS on the IMPORTS edge graph.
 * A cycle exists when a BFS from node A reaches node A again.
 */
function detectCircularImports(
  filePath: string,
  store?: InMemoryGraphStore,
  projectId?: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  if (!store || !projectId) return findings;

  // Find the File node for this file
  const fileNodes = store.queryNodes({
    projectId,
    label: 'File',
    filePattern: filePath,
    limit: 1,
  });

  if (fileNodes.items.length === 0) return findings;
  const fileNodeId = fileNodes.items[0]!.id;

  // Run BFS on IMPORTS edges to detect cycles back to source
  const importerNodes = store.queryEdges({
    projectId,
    sourceId: fileNodeId,
    type: EDGE_IMPORTS as RelationshipType,
  });

  // Also check reverse: what does this file import?
  const importEdges = store.queryEdges({
    projectId,
    targetId: fileNodeId,
    type: EDGE_IMPORTS as RelationshipType,
  });

  for (const edge of importEdges.items) {
    // Check if the imported node transitively imports this file
    const bfsResult = store.bfs(edge.sourceId, 50, [EDGE_IMPORTS as RelationshipType]);
    for (const [nodeId, depth] of bfsResult.pathLengths) {
      if (nodeId === fileNodeId && depth > 0) {
        const importedNode = store.getNode(edge.sourceId);
        const evidence: EvidenceAnchor = {
          filePath,
          startLine: 1,
          endLine: 1,
          codeSnippet: `Circular import: ${filePath} ↔ ${importedNode?.filePath ?? 'unknown'}`,
          lens: 'structure',
          ruleId: 'struct-circular-import',
        };
        const f = createLensFinding(
          'structure', 'architecture', 'high',
          `Circular Import Detected`,
          `File "${filePath}" has a circular import via "${importedNode?.filePath ?? 'unknown'}" (${depth} steps). Break the cycle by extracting shared logic to a common module.`,
          evidence,
          { suggestion: 'Extract shared code into a separate module to break the cycle.', ruleId: 'struct-circular-import' });
        if (f) findings.push(f);
        break; // One notification per import target is enough
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Barrel export anti-pattern detection
// ---------------------------------------------------------------------------

/**
 * Detect barrel export anti-patterns: index.ts/index.tsx files that
 * re-export > 10 symbols, which creates tight coupling and slow builds.
 */
function detectBarrelExports(
  lines: string[],
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const fileName = filePath.split('/').pop() ?? '';

  // Only check index.* files
  if (!fileName.startsWith('index.')) return findings;

  // Count re-export statements
  let reExportCount = 0;
  const reExportLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (/\bexport\s+(?:\{[^}]+\}|\*\s+from)\s+/.test(trimmed)) {
      // Count individual exports inside braces
      const braceMatch = trimmed.match(/export\s+\{([^}]+)\}/);
      if (braceMatch) {
        const exports = braceMatch[1]!.split(',').filter(e => e.trim());
        reExportCount += exports.length;
      } else if (/export\s+\*\s+from/.test(trimmed)) {
        reExportCount += 10; // wildcard export = high coupling proxy
      } else {
        reExportCount++;
      }
      reExportLines.push(i + 1);
    }
  }

  if (reExportCount > 10) {
    const evidence: EvidenceAnchor = {
      filePath,
      startLine: Math.min(...reExportLines),
      endLine: Math.max(...reExportLines),
      codeSnippet: `${reExportCount} re-exports in barrel file`,
      lens: 'structure',
      ruleId: 'struct-barrel-export',
    };
    const f = createLensFinding(
      'structure', 'architecture', 'medium',
      `Barrel Export Anti-Pattern: ${reExportCount} re-exports`,
      `File "${fileName}" has ${reExportCount} re-exports (>10 threshold). Barrel exports create tight coupling and slow tree-shaking. Consider direct imports from source files.`,
      evidence,
      { suggestion: 'Replace barrel exports with direct imports from individual module files.', ruleId: 'struct-barrel-export' });
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Orphan code detection
// ---------------------------------------------------------------------------

/**
 * Detect orphan code: nodes with no incoming edges (not CALLED,
 * not IMPORTED, not TESTED by anything).
 */
function detectOrphanCode(
  filePath: string,
  store?: InMemoryGraphStore,
  projectId?: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  if (!store || !projectId) return findings;

  // Find Function/Method nodes in this file
  const funcNodes = store.queryNodes({
    projectId,
    filePattern: filePath,
    limit: 100,
  });

  for (const node of funcNodes.items) {
    if (node.label !== 'Function' && node.label !== 'Method') continue;
    if (!node.isExported) continue; // Only flag exported orphans

    // Check incoming edges
    const incomingEdges = store.queryEdges({
      projectId,
      targetId: node.id,
    });

    const hasIncomingCalls = incomingEdges.items.some(e => e.type === EDGE_CALLS);
    const hasIncomingImports = incomingEdges.items.some(e => e.type === EDGE_IMPORTS);
    const hasIncomingTests = incomingEdges.items.some(e => e.type === EDGE_TESTS);

    if (!hasIncomingCalls && !hasIncomingImports && !hasIncomingTests) {
      const lineNum = node.startLine ?? 1;
      const evidence: EvidenceAnchor = {
        filePath: node.filePath ?? filePath,
        startLine: lineNum,
        endLine: (node.endLine ?? lineNum),
        codeSnippet: `Orphan export: ${node.name}`,
        lens: 'structure',
        ruleId: 'struct-orphan-code',
      };
      const f = createLensFinding(
        'structure', 'maintainability', 'medium',
        `Orphan Code: ${node.name}`,
        `Exported symbol "${node.name}" has no incoming CALLS, IMPORTS, or TESTS edges. It may be dead code. Verify before removing.`,
        evidence,
        { suggestion: `Delete unused export "${node.name}" or add tests to confirm it's needed.`, ruleId: 'struct-orphan-code' });
      if (f) findings.push(f);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Layer configuration loader
// ---------------------------------------------------------------------------

/** Attempt to load layer rules from .code-analyzer.yml config */
function loadLayerConfig(configContent?: string): LayerRule[] {
  if (!configContent) return [];
  try {
    // Look for layers: section
    const layerMatch = configContent.match(/^layers:\s*\n([\s\S]*?)(?=\n\S|\n*$)/m);
    if (layerMatch) {
      return parseLayerRules(layerMatch[1]!);
    }
  } catch {
    // Best-effort config loading
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export interface StructureAnalysisOptions {
  /** Knowledge graph store for graph-backed detections (circular imports, orphans) */
  store?: InMemoryGraphStore;
  /** Project identifier */
  projectId?: string;
  /** Content of .code-analyzer.yml for layer config */
  layerConfig?: string;
}

export function analyzeStructure(
  content: string,
  filePath: string,
  options?: StructureAnalysisOptions,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');
  const totalLines = lines.length;
  const { store, projectId, layerConfig } = options ?? {};
  const layerRules = loadLayerConfig(layerConfig);

  // 1. Cyclomatic complexity per function
  const complexity = countBranches(lines);
  if (complexity > 15) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: totalLines,
      codeSnippet: `File-level cyclomatic complexity: ${complexity}`,
      lens: 'structure', ruleId: 'struct-complexity',
    };
    const f = createLensFinding('structure', 'architecture', 'high',
      `High Cyclomatic Complexity: ${complexity} branches`,
      `This file has cyclomatic complexity of ${complexity}. Consider splitting into smaller functions or modules.`,
      evidence, { suggestion: 'Extract related logic into helper functions to reduce complexity.', ruleId: 'struct-complexity' });
    if (f) findings.push(f);
  }

  // 2. Import/coupling count
  const imports = countImports(lines);
  if (imports > 30) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: totalLines,
      codeSnippet: `File has ${imports} import/dependency statements`,
      lens: 'structure', ruleId: 'struct-high-coupling',
    };
    const f = createLensFinding('structure', 'architecture', 'medium',
      `High Coupling: ${imports} imports`,
      `This file has ${imports} dependency imports, indicating high coupling. Consider splitting into smaller modules.`,
      evidence, { suggestion: 'Group related functionality into smaller, focused modules.', ruleId: 'struct-high-coupling' });
    if (f) findings.push(f);
  }

  // 3. God class detection — classes with >20 methods or >500 lines
  const classBlocks = extractClassBlocks(lines);
  for (const block of classBlocks) {
    if (block.lineCount > 500) {
      const evidence: EvidenceAnchor = {
        filePath, startLine: block.startLine, endLine: block.endLine,
        codeSnippet: `Class "${block.name}" spans ${block.lineCount} lines`,
        lens: 'structure', ruleId: 'struct-god-class-lines',
      };
      const f = createLensFinding('structure', 'architecture', 'high',
        `God Class: ${block.name} (${block.lineCount} lines)`,
        `Class "${block.name}" has ${block.lineCount} lines (>500 threshold). Split into smaller classes following Single Responsibility Principle.`,
        evidence, { suggestion: `Split ${block.name} into focused classes with single responsibilities.`, ruleId: 'struct-god-class-lines' });
      if (f) findings.push(f);
    }

    const methodCount = countMethods(lines.slice(block.startLine - 1, block.endLine));
    if (methodCount > 20) {
      const evidence: EvidenceAnchor = {
        filePath, startLine: block.startLine, endLine: block.endLine,
        codeSnippet: `Class "${block.name}" has ${methodCount} methods`,
        lens: 'structure', ruleId: 'struct-god-class-methods',
      };
      const f = createLensFinding('structure', 'architecture', 'high',
        `God Class: ${block.name} (${methodCount} methods)`,
        `Class "${block.name}" has ${methodCount} methods (>20 threshold). Extract cohesive method groups into separate classes.`,
        evidence, { suggestion: `Extract related methods from ${block.name} into collaborator classes.`, ruleId: 'struct-god-class-methods' });
      if (f) findings.push(f);
    }
  }

  // 4. Long method detection (>50 lines)
  const funcBlocks = extractFunctionBlocks(lines);
  for (const block of funcBlocks) {
    if (block.lineCount > 50) {
      const evidence: EvidenceAnchor = {
        filePath, startLine: block.startLine, endLine: block.endLine,
        codeSnippet: `Function "${block.name}" spans ${block.lineCount} lines`,
        lens: 'structure', ruleId: 'struct-long-method',
      };
      const f = createLensFinding('structure', 'maintainability', 'medium',
        `Long Method: ${block.name} (${block.lineCount} lines)`,
        `Function "${block.name}" is ${block.lineCount} lines long (>50 threshold). Break into smaller, focused functions.`,
        evidence, { suggestion: `Extract sub-steps of ${block.name} into well-named helper functions.`, ruleId: 'struct-long-method' });
      if (f) findings.push(f);
    }
  }

  // 5. Deep nesting (>4 levels)
  const depth = maxNestingDepth(lines);
  if (depth > 4) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: totalLines,
      codeSnippet: `Maximum nesting depth detected: ${depth} levels`,
      lens: 'structure', ruleId: 'struct-deep-nesting',
    };
    const f = createLensFinding('structure', 'maintainability', 'medium',
      `Deep Nesting: ${depth} levels`,
      `Code has nesting depth of ${depth} (>4 threshold). Deep nesting makes code hard to read and test. Use early returns or extract inner logic.`,
      evidence, { suggestion: 'Use guard clauses (early returns) to reduce nesting.', ruleId: 'struct-deep-nesting' });
    if (f) findings.push(f);
  }

  // 6. Module cohesion — internal vs external references
  const cohesion = computeCohesion(lines);
  if (cohesion < 0.3 && totalLines > 100) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: totalLines,
      codeSnippet: `Module cohesion score: ${(cohesion * 100).toFixed(0)}%`,
      lens: 'structure', ruleId: 'struct-low-cohesion',
    };
    const f = createLensFinding('structure', 'architecture', 'low',
      `Low Module Cohesion: ${(cohesion * 100).toFixed(0)}%`,
      `Module cohesion is ${(cohesion * 100).toFixed(0)}% (<30% threshold). Functions in this file may not belong together.`,
      evidence, { suggestion: 'Move unrelated functions to separate modules.', ruleId: 'struct-low-cohesion' });
    if (f) findings.push(f);
  }

  // 7. NEW: Layer violation detection
  findings.push(...detectLayerViolations(lines, filePath, layerRules));

  // 8. NEW: Barrel export anti-pattern
  findings.push(...detectBarrelExports(lines, filePath));

  // 9. NEW: Circular import detection (graph-backed)
  findings.push(...detectCircularImports(filePath, store, projectId));

  // 10. NEW: Orphan code detection (graph-backed)
  findings.push(...detectOrphanCode(filePath, store, projectId));

  return findings;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BlockInfo {
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

function extractClassBlocks(lines: string[]): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/\bclass\s+(\w+)/);
    if (match) {
      const name = match[1]!;
      const start = i + 1;
      let depth = 1;
      let end = start;
      for (let j = i + 1; j < lines.length && depth > 0; j++) {
        const braces = (lines[j]!.match(/\{/g) || []).length - (lines[j]!.match(/\}/g) || []).length;
        depth += braces;
        if (depth === 0) end = j + 1;
      }
      blocks.push({ name, startLine: start, endLine: end, lineCount: end - start + 1 });
      i = end - 1;
    }
  }
  return blocks;
}

function extractFunctionBlocks(lines: string[]): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const m = line.match(/(?:async\s+)?function\s+(\w+)\s*\(/);
    const cm = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    const match = m || cm;
    if (match && (line.includes('{') || lines[i + 1]?.includes('{'))) {
      const name = match[1]!;
      const start = i + 1;
      let depth = 0;
      let started = false;
      let end = start;
      for (let j = i; j < lines.length; j++) {
        const braceCount = (lines[j]!.match(/\{/g) || []).length - (lines[j]!.match(/\}/g) || []).length;
        depth += braceCount;
        if (braceCount > 0) started = true;
        if (started && depth === 0) { end = j + 1; break; }
      }
      if (end > start) {
        blocks.push({ name, startLine: start, endLine: end, lineCount: end - start + 1 });
        i = end - 1;
      }
    }
  }
  return blocks;
}

function computeCohesion(lines: string[]): number {
  let internalRefs = 0;
  let externalRefs = 0;
  const definedNames = new Set<string>();

  for (const line of lines) {
    const m = line.match(/(?:function|const|let|var|class)\s+(\w+)/);
    if (m) definedNames.add(m[1]!);
  }

  for (const line of lines) {
    for (const name of definedNames) {
      if (new RegExp(`\\b${name}\\b`).test(line)) internalRefs++;
    }
    if (/\bimport\b|\brequire\b|\bfrom\s+['"]/.test(line)) externalRefs++;
  }

  const total = internalRefs + externalRefs;
  return total === 0 ? 1 : internalRefs / total;
}

/** Generate a lens report for structure analysis */
export function generateStructureReport(
  content: string,
  filePath: string,
  options?: StructureAnalysisOptions,
): LensReport {
  const start = Date.now();
  const findings = analyzeStructure(content, filePath, options);
  return {
    lens: 'structure',
    name: 'Structure Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}