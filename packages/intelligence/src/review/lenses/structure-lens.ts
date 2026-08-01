// @code-analyzer/intelligence — Structure Review Lens
// Detects architectural issues: complexity, coupling, cohesion, god classes, long methods, deep nesting.

import type { LensFinding, EvidenceAnchor, LensReport } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';

// ---------------------------------------------------------------------------
// Detection functions
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
// Main analyzer
// ---------------------------------------------------------------------------

export function analyzeStructure(
  content: string,
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');
  const totalLines = lines.length;

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
): LensReport {
  const start = Date.now();
  const findings = analyzeStructure(content, filePath);
  return {
    lens: 'structure',
    name: 'Structure Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}
