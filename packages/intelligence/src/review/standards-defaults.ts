// @code-analyzer/intelligence — Default Project Standards
// Built-in standards rules used by the PR Review Engine.

import type { ProjectStandard } from '@code-analyzer/shared';

export const DEFAULT_STANDARDS: ProjectStandard[] = [
  {
    id: 'std-func-length',
    name: 'Function Length',
    version: '1.0.0',
    category: 'code-style',
    description: 'Functions should not exceed 50 lines.',
    rules: [
      {
        id: 'func-length-50',
        description: 'Functions must not exceed 50 lines.',
        checkType: 'metric',
        checkConfig: { maxLines: 50 },
        severity: 'medium',
        autoFixable: false,
      },
    ],
    examples: [],
  },
  {
    id: 'std-nesting-depth',
    name: 'Nesting Depth',
    version: '1.0.0',
    category: 'code-style',
    description: 'Code should not nest deeper than 4 levels.',
    rules: [
      {
        id: 'nesting-depth-4',
        description: 'Code nesting depth must not exceed 4 levels.',
        checkType: 'metric',
        checkConfig: { maxDepth: 4 },
        severity: 'high',
        autoFixable: false,
      },
    ],
    examples: [],
  },
  {
    id: 'std-naming',
    name: 'Naming Conventions',
    version: '1.0.0',
    category: 'code-style',
    description: 'Follow naming conventions: PascalCase classes, camelCase functions.',
    rules: [
      {
        id: 'naming-class-pascal',
        description: 'Class names must use PascalCase.',
        checkType: 'regex',
        checkConfig: { pattern: '^[A-Z][a-zA-Z0-9]*$' },
        severity: 'low',
        autoFixable: false,
      },
      {
        id: 'naming-func-camel',
        description: 'Function names must use camelCase.',
        checkType: 'regex',
        checkConfig: { pattern: '^[a-z][a-zA-Z0-9]*$' },
        severity: 'low',
        autoFixable: false,
      },
    ],
    examples: [],
  },
  {
    id: 'std-error-handling',
    name: 'Error Handling',
    version: '1.0.0',
    category: 'error-handling',
    description: 'Async operations should include error handling.',
    rules: [
      {
        id: 'error-handling-async',
        description: 'Async operations must include try/catch or .catch() handlers.',
        checkType: 'ast-pattern',
        checkConfig: { requireTryCatch: true },
        severity: 'medium',
        autoFixable: false,
      },
    ],
    examples: [],
  },
  {
    id: 'std-security',
    name: 'Security Basics',
    version: '1.0.0',
    category: 'security',
    description: 'Avoid common security pitfalls.',
    rules: [
      {
        id: 'no-eval',
        description: 'Avoid using eval() for security reasons.',
        checkType: 'regex',
        checkConfig: { pattern: 'eval\\s*\\(', forbidden: true },
        severity: 'critical',
        autoFixable: false,
      },
      {
        id: 'no-console-log',
        description: 'Remove console.log from production code.',
        checkType: 'regex',
        checkConfig: { pattern: 'console\\.log', forbidden: true },
        severity: 'low',
        autoFixable: false,
      },
    ],
    examples: [],
  },
];
