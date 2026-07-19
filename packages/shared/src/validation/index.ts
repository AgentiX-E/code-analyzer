// @code-analyzer/shared — Validation Utilities
// Validates graph entities, configuration, and review comments.

import { COMPATIBLE_EDGES } from '../constants/index.js';
import { NODE_LABELS, RELATIONSHIP_TYPES } from '../types/graph.js';

import type {
  AnalysisReport,
  CodeAnalyzerConfig,
  NodeLabel,
  ProjectStandard,
  RelationshipType,
  ReviewCategory,
  ReviewComment,
  Severity,
} from '../types/graph.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// ---------------------------------------------------------------------------
// validateNodeProperties
// ---------------------------------------------------------------------------

const REQUIRED_PROPS_BY_LABEL: Partial<Record<NodeLabel, string[]>> = {
  Project: ['name'],
  Package: ['name'],
  Folder: ['name'],
  File: ['name', 'filePath'],
  Module: ['name'],
  Class: ['name'],
  Interface: ['name'],
  Function: ['name'],
  Method: ['name'],
  Constructor: ['name'],
  Property: ['name'],
  Enum: ['name'],
  TypeAlias: ['name'],
  Struct: ['name'],
  Trait: ['name'],
  Variable: ['name'],
  Route: ['name', 'routePath'],
  Tool: ['name'],
  Component: ['name'],
  Test: ['name'],
  Community: ['name'],
  Process: ['name'],
  Config: ['name'],
  ADR: ['name'],
  BasicBlock: ['name'],
  InfraResource: ['name'],
  CrossRepoFunction: ['name'],
  CrossRepoInterface: ['name'],
  CrossRepoModule: ['name'],
  Contract: ['name'],
  Event: ['name'],
  DataSource: ['name'],
  Sink: ['name'],
};

/**
 * Validates that node properties contain the required fields for a given label.
 * Returns a list of human-readable error messages. An empty array means success.
 */
export function validateNodeProperties(
  label: NodeLabel,
  props: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  // Validate that label is recognized
  if (!(NODE_LABELS as readonly string[]).includes(label)) {
    errors.push(`Unknown node label: "${label}"`);
    return errors;
  }

  const required = REQUIRED_PROPS_BY_LABEL[label];
  if (required) {
    for (const key of required) {
      const value = props[key];
      if (value === undefined || value === null) {
        errors.push(`Missing required property "${key}" for label "${label}"`);
      } else if (key === 'name' && !isNonEmptyString(value)) {
        errors.push(`Property "name" must be a non-empty string for label "${label}"`);
      } else if (key === 'filePath' && !isNonEmptyString(value)) {
        errors.push(`Property "filePath" must be a non-empty string for label "${label}"`);
      } else if (key === 'routePath' && !isNonEmptyString(value)) {
        errors.push(`Property "routePath" must be a non-empty string for label "${label}"`);
      }
    }
  }

  // Validate optional visibility field if present
  if ('visibility' in props && props['visibility'] !== undefined) {
    const allowed = new Set(['public', 'private', 'protected']);
    if (!allowed.has(props['visibility'] as string)) {
      errors.push(
        `Invalid visibility "${String(props['visibility'])}" — expected "public", "private", or "protected"`
      );
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// validateEdgeCompatibility
// ---------------------------------------------------------------------------

/**
 * Checks whether an edge of the given type between source and target node
 * labels is semantically valid according to COMPATIBLE_EDGES.
 */
export function validateEdgeCompatibility(
  sourceLabel: NodeLabel,
  targetLabel: NodeLabel,
  type: RelationshipType
): boolean {
  // Validate inputs are real
  if (
    !(NODE_LABELS as readonly string[]).includes(sourceLabel) ||
    !(NODE_LABELS as readonly string[]).includes(targetLabel) ||
    !(RELATIONSHIP_TYPES as readonly string[]).includes(type)
  ) {
    return false;
  }

  const compatible = COMPATIBLE_EDGES.get(type);
  if (!compatible) {
    return false;
  }

  return compatible.some(([s, t]) => s === sourceLabel && t === targetLabel);
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

/**
 * Validates a CodeAnalyzerConfig object. Returns an array of error messages.
 * An empty array means the configuration is valid.
 */
export function validateConfig(config: CodeAnalyzerConfig): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Config must be a non-null object');
    return errors;
  }

  // projectId
  if (!isNonEmptyString(config.projectId)) {
    errors.push('config.projectId must be a non-empty string');
  }

  // rootPath
  if (!isNonEmptyString(config.rootPath)) {
    errors.push('config.rootPath must be a non-empty string');
  }

  // maxFileSize
  if (config.maxFileSize !== undefined) {
    if (!isPositiveInteger(config.maxFileSize)) {
      errors.push('config.maxFileSize must be a positive integer');
    }
  } else {
    errors.push('config.maxFileSize is required (positive integer)');
  }

  // maxFiles
  if (config.maxFiles !== undefined) {
    if (!isPositiveInteger(config.maxFiles)) {
      errors.push('config.maxFiles must be a positive integer');
    }
  } else {
    errors.push('config.maxFiles is required (positive integer)');
  }

  // parseWorkers
  if (config.parseWorkers !== undefined) {
    if (!isPositiveInteger(config.parseWorkers)) {
      errors.push('config.parseWorkers must be a positive integer');
    }
  } else {
    errors.push('config.parseWorkers is required (positive integer)');
  }

  // excludePatterns
  if (!Array.isArray(config.excludePatterns)) {
    errors.push('config.excludePatterns must be an array');
  } else {
    for (let i = 0; i < config.excludePatterns.length; i++) {
      if (typeof config.excludePatterns[i] !== 'string') {
        errors.push(`config.excludePatterns[${i}] must be a string`);
      }
    }
  }

  // includePatterns
  if (!Array.isArray(config.includePatterns)) {
    errors.push('config.includePatterns must be an array');
  } else {
    for (let i = 0; i < config.includePatterns.length; i++) {
      if (typeof config.includePatterns[i] !== 'string') {
        errors.push(`config.includePatterns[${i}] must be a string`);
      }
    }
  }

  // ignorePaths
  if (!Array.isArray(config.ignorePaths)) {
    errors.push('config.ignorePaths must be an array');
  } else {
    for (let i = 0; i < config.ignorePaths.length; i++) {
      if (typeof config.ignorePaths[i] !== 'string') {
        errors.push(`config.ignorePaths[${i}] must be a string`);
      }
    }
  }

  // cacheDir (optional string)
  if (config.cacheDir !== undefined && config.cacheDir !== null) {
    if (typeof config.cacheDir !== 'string') {
      errors.push('config.cacheDir must be a string if provided');
    }
  }

  // mcp (optional sub-config)
  if (config.mcp !== undefined && config.mcp !== null) {
    if (typeof config.mcp !== 'object') {
      errors.push('config.mcp must be an object if provided');
    } else {
      if (!isNonEmptyString(config.mcp.name)) {
        errors.push('config.mcp.name must be a non-empty string');
      }
      if (!isNonEmptyString(config.mcp.version)) {
        errors.push('config.mcp.version must be a non-empty string');
      }
      const validProfiles = new Set(['all', 'analysis', 'scout']);
      if (!validProfiles.has(config.mcp.toolProfile)) {
        errors.push(
          `config.mcp.toolProfile must be one of "all", "analysis", "scout" (got "${config.mcp.toolProfile}")`
        );
      }
      if (!isPositiveInteger(config.mcp.maxResults)) {
        errors.push('config.mcp.maxResults must be a positive integer');
      }
      if (typeof config.mcp.enableStreaming !== 'boolean') {
        errors.push('config.mcp.enableStreaming must be a boolean');
      }
      if (typeof config.mcp.enableResources !== 'boolean') {
        errors.push('config.mcp.enableResources must be a boolean');
      }
      if (typeof config.mcp.enablePrompts !== 'boolean') {
        errors.push('config.mcp.enablePrompts must be a boolean');
      }
    }
  }

  // review (optional sub-config)
  if (config.review !== undefined && config.review !== null) {
    if (typeof config.review !== 'object') {
      errors.push('config.review must be an object if provided');
    } else {
      if (typeof config.review.enabled !== 'boolean') {
        errors.push('config.review.enabled must be a boolean');
      }
      if (!isNonNegativeInteger(config.review.maxComments)) {
        errors.push('config.review.maxComments must be a non-negative integer');
      }
      if (!Array.isArray(config.review.severityFilter)) {
        errors.push('config.review.severityFilter must be an array');
      }
      if (!Array.isArray(config.review.categoryFilter)) {
        errors.push('config.review.categoryFilter must be an array');
      }
    }
  }

  // embed (optional sub-config)
  if (config.embed !== undefined && config.embed !== null) {
    if (typeof config.embed !== 'object') {
      errors.push('config.embed must be an object if provided');
    } else {
      if (typeof config.embed.enabled !== 'boolean') {
        errors.push('config.embed.enabled must be a boolean');
      }
      if (!isNonEmptyString(config.embed.model)) {
        errors.push('config.embed.model must be a non-empty string');
      }
      if (!isPositiveInteger(config.embed.batchSize)) {
        errors.push('config.embed.batchSize must be a positive integer');
      }
      if (!isPositiveInteger(config.embed.dimensions)) {
        errors.push('config.embed.dimensions must be a positive integer');
      }
    }
  }

  // pruner (optional sub-config)
  if (config.pruner !== undefined && config.pruner !== null) {
    if (typeof config.pruner !== 'object') {
      errors.push('config.pruner must be an object if provided');
    } else {
      if (typeof config.pruner.enabled !== 'boolean') {
        errors.push('config.pruner.enabled must be a boolean');
      }
      if (typeof config.pruner.keepTests !== 'boolean') {
        errors.push('config.pruner.keepTests must be a boolean');
      }
      if (typeof config.pruner.keepInternal !== 'boolean') {
        errors.push('config.pruner.keepInternal must be a boolean');
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// validateReviewComment
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: readonly ReviewCategory[] = [
  'bug',
  'security',
  'performance',
  'maintainability',
  'test',
  'style',
  'documentation',
  'architecture',
  'other',
];

const VALID_SEVERITIES: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

/**
 * Validates a ReviewComment object. Returns an array of error messages.
 * An empty array means the comment is valid.
 */
export function validateReviewComment(comment: ReviewComment): string[] {
  const errors: string[] = [];

  if (!comment || typeof comment !== 'object') {
    errors.push('Review comment must be a non-null object');
    return errors;
  }

  // path
  if (!isNonEmptyString(comment.path)) {
    errors.push('reviewComment.path must be a non-empty string');
  }

  // content
  if (!isNonEmptyString(comment.content)) {
    errors.push('reviewComment.content must be a non-empty string');
  }

  // existingCode
  if (!isNonEmptyString(comment.existingCode)) {
    errors.push('reviewComment.existingCode must be a non-empty string');
  }

  // startLine
  if (!isPositiveInteger(comment.startLine)) {
    errors.push('reviewComment.startLine must be a positive integer');
  }

  // endLine
  if (!isPositiveInteger(comment.endLine)) {
    errors.push('reviewComment.endLine must be a positive integer');
  } else if (comment.endLine < comment.startLine) {
    errors.push(
      `reviewComment.endLine (${comment.endLine}) must be >= startLine (${comment.startLine})`
    );
  }

  // category
  if (!(VALID_CATEGORIES as readonly string[]).includes(comment.category)) {
    errors.push(
      `Invalid reviewComment.category "${comment.category}" — must be one of: ${VALID_CATEGORIES.join(', ')}`
    );
  }

  // severity
  if (!(VALID_SEVERITIES as readonly string[]).includes(comment.severity)) {
    errors.push(
      `Invalid reviewComment.severity "${comment.severity}" — must be one of: ${VALID_SEVERITIES.join(', ')}`
    );
  }

  // id
  if (!isNonEmptyString(comment.id)) {
    errors.push('reviewComment.id must be a non-empty string');
  }

  // filtered
  if (typeof comment.filtered !== 'boolean') {
    errors.push('reviewComment.filtered must be a boolean');
  }

  // suggestionCode is optional — validate as string if present
  if (
    comment.suggestionCode !== undefined &&
    comment.suggestionCode !== null &&
    typeof comment.suggestionCode !== 'string'
  ) {
    errors.push('reviewComment.suggestionCode must be a string if provided');
  }

  // thinking is optional — validate as string if present
  if (
    comment.thinking !== undefined &&
    comment.thinking !== null &&
    typeof comment.thinking !== 'string'
  ) {
    errors.push('reviewComment.thinking must be a string if provided');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// validateStandard
// ---------------------------------------------------------------------------

const VALID_STANDARD_CATEGORIES = new Set([
  'code-style',
  'architecture',
  'security',
  'performance',
  'testing',
  'api-design',
  'error-handling',
  'documentation',
  'dependency',
  'custom',
]);

const VALID_CHECK_TYPES = new Set([
  'ast-pattern',
  'regex',
  'graph-query',
  'llm-check',
  'metric',
]);

const VALID_SEVERITIES_SET = new Set([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);

/**
 * Validates a ProjectStandard object. Returns an array of error messages.
 * An empty array means the standard definition is valid.
 */
export function validateStandard(standard: ProjectStandard): string[] {
  const errors: string[] = [];

  if (!standard || typeof standard !== 'object') {
    errors.push('Standard must be a non-null object');
    return errors;
  }

  if (!isNonEmptyString(standard.id)) {
    errors.push('standard.id must be a non-empty string');
  }

  if (!isNonEmptyString(standard.name)) {
    errors.push('standard.name must be a non-empty string');
  }

  if (!isNonEmptyString(standard.version)) {
    errors.push('standard.version must be a non-empty string');
  }

  if (!VALID_STANDARD_CATEGORIES.has(standard.category)) {
    errors.push(
      `Invalid standard.category "${standard.category}" — must be one of: ${[...VALID_STANDARD_CATEGORIES].join(', ')}`
    );
  }

  if (!isNonEmptyString(standard.description)) {
    errors.push('standard.description must be a non-empty string');
  }

  if (!Array.isArray(standard.rules)) {
    errors.push('standard.rules must be an array');
  } else {
    for (let i = 0; i < standard.rules.length; i++) {
      const rule = standard.rules[i];
      if (!rule || typeof rule !== 'object') {
        errors.push(`standard.rules[${i}] must be a non-null object`);
        continue;
      }
      if (!isNonEmptyString(rule.id)) {
        errors.push(`standard.rules[${i}].id must be a non-empty string`);
      }
      if (!isNonEmptyString(rule.description)) {
        errors.push(`standard.rules[${i}].description must be a non-empty string`);
      }
      if (!VALID_CHECK_TYPES.has(rule.checkType)) {
        errors.push(`standard.rules[${i}].checkType "${rule.checkType}" is invalid`);
      }
      if (!VALID_SEVERITIES_SET.has(rule.severity)) {
        errors.push(`standard.rules[${i}].severity "${rule.severity}" is invalid`);
      }
      if (typeof rule.autoFixable !== 'boolean') {
        errors.push(`standard.rules[${i}].autoFixable must be a boolean`);
      }
    }
  }

  if (!Array.isArray(standard.examples)) {
    errors.push('standard.examples must be an array');
  } else {
    for (let i = 0; i < standard.examples.length; i++) {
      const ex = standard.examples[i];
      if (!ex || typeof ex !== 'object') {
        errors.push(`standard.examples[${i}] must be a non-null object`);
        continue;
      }
      if (!isNonEmptyString(ex.description)) {
        errors.push(`standard.examples[${i}].description must be a non-empty string`);
      }
      if (typeof ex.compliant !== 'boolean') {
        errors.push(`standard.examples[${i}].compliant must be a boolean`);
      }
      if (!isNonEmptyString(ex.code)) {
        errors.push(`standard.examples[${i}].code must be a non-empty string`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// validateReport
// ---------------------------------------------------------------------------

const VALID_REPORT_TYPES = new Set([
  'pr-review',
  'codebase-audit',
  'impact-analysis',
  'architecture-review',
  'standards-compliance',
]);

const VALID_SCOPE_TYPES = new Set(['project', 'repo-group', 'pr']);

const VALID_MERGE_RECS = new Set([
  'approve',
  'approve-with-comments',
  'request-changes',
  'block',
]);

/**
 * Validates an AnalysisReport object. Returns an array of error messages.
 * An empty array means the report is valid.
 */
export function validateReport(report: AnalysisReport): string[] {
  const errors: string[] = [];

  if (!report || typeof report !== 'object') {
    errors.push('Report must be a non-null object');
    return errors;
  }

  if (!isNonEmptyString(report.id)) {
    errors.push('report.id must be a non-empty string');
  }

  if (!VALID_REPORT_TYPES.has(report.type)) {
    errors.push(`Invalid report.type "${report.type}"`);
  }

  if (!isNonEmptyString(report.title)) {
    errors.push('report.title must be a non-empty string');
  }

  if (!isNonEmptyString(report.createdAt)) {
    errors.push('report.createdAt must be a non-empty string');
  }

  // Validate scope
  if (!report.scope || typeof report.scope !== 'object') {
    errors.push('report.scope must be a non-null object');
  } else {
    if (!VALID_SCOPE_TYPES.has(report.scope.type)) {
      errors.push(`Invalid report.scope.type "${report.scope.type}"`);
    }
  }

  // Validate summary
  if (!report.summary || typeof report.summary !== 'object') {
    errors.push('report.summary must be a non-null object');
  } else {
    if (typeof report.summary.overallScore !== 'number') {
      errors.push('report.summary.overallScore must be a number');
    }
    if (!isNonNegativeInteger(report.summary.totalFindings)) {
      errors.push('report.summary.totalFindings must be a non-negative integer');
    }
    if (!Array.isArray(report.summary.keyTakeaways)) {
      errors.push('report.summary.keyTakeaways must be an array');
    }
    if (!VALID_MERGE_RECS.has(report.summary.mergeRecommendation)) {
      errors.push(`Invalid report.summary.mergeRecommendation "${report.summary.mergeRecommendation}"`);
    }
    if (!isNonEmptyString(report.summary.mergeRationale)) {
      errors.push('report.summary.mergeRationale must be a non-empty string');
    }
  }

  // Validate findings
  if (!Array.isArray(report.findings)) {
    errors.push('report.findings must be an array');
  } else {
    for (let i = 0; i < report.findings.length; i++) {
      const finding = report.findings[i];
      if (!finding || typeof finding !== 'object') {
        errors.push(`report.findings[${i}] must be a non-null object`);
        continue;
      }
      if (!isNonEmptyString(finding.id)) {
        errors.push(`report.findings[${i}].id must be a non-empty string`);
      }
      if (!isNonEmptyString(finding.title)) {
        errors.push(`report.findings[${i}].title must be a non-empty string`);
      }
    }
  }

  // Validate recommendations
  if (!Array.isArray(report.recommendations)) {
    errors.push('report.recommendations must be an array');
  } else {
    for (let i = 0; i < report.recommendations.length; i++) {
      const rec = report.recommendations[i];
      if (!rec || typeof rec !== 'object') {
        errors.push(`report.recommendations[${i}] must be a non-null object`);
        continue;
      }
      if (!isNonEmptyString(rec.id)) {
        errors.push(`report.recommendations[${i}].id must be a non-empty string`);
      }
      if (!isNonEmptyString(rec.title)) {
        errors.push(`report.recommendations[${i}].title must be a non-empty string`);
      }
      if (![1, 2, 3].includes(rec.priority)) {
        errors.push(`report.recommendations[${i}].priority must be 1, 2, or 3`);
      }
    }
  }

  // Validate metrics
  if (!report.metrics || typeof report.metrics !== 'object') {
    errors.push('report.metrics must be a non-null object');
  } else {
    if (typeof report.metrics.linesChanged !== 'number') {
      errors.push('report.metrics.linesChanged must be a number');
    }
    if (typeof report.metrics.filesChanged !== 'number') {
      errors.push('report.metrics.filesChanged must be a number');
    }
  }

  // Validate metadata
  if (!report.metadata || typeof report.metadata !== 'object') {
    errors.push('report.metadata must be a non-null object');
  } else {
    if (!isNonEmptyString(report.metadata.repository)) {
      errors.push('report.metadata.repository must be a non-empty string');
    }
    if (!isNonEmptyString(report.metadata.commitSha)) {
      errors.push('report.metadata.commitSha must be a non-empty string');
    }
  }

  return errors;
}
