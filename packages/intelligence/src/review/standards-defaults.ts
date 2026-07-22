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
    description: 'Code should not nest deeper than 4 levels. Files should not exceed 200 lines.',
    rules: [
      {
        id: 'nesting-depth-4',
        description: 'Code nesting depth must not exceed 4 levels.',
        checkType: 'metric',
        checkConfig: { maxDepth: 4, maxLines: 50 },
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
  {
    id: 'std-security-essentials',
    name: 'Security Essentials',
    version: '1.0.0',
    category: 'security',
    description:
      'Comprehensive security checks: SQL injection prevention, no hardcoded secrets, input validation, path traversal protection, CSRF tokens, and XSS prevention.',
    rules: [
      {
        id: 'sec-sql-injection',
        description:
          'No SQL injection patterns — detect string concatenation in SQL queries and raw queries without parameterization.',
        checkType: 'regex',
        checkConfig: {
          pattern: '(?:execute|query|run)\\s*\\(\\s*[`\'"][^`\'"]*\\$\\{|(?:SELECT|INSERT|UPDATE|DELETE|DROP)\\s+.*?\\+.*?["\'`]',
          flags: 'gi',
          forbidden: true,
        },
        severity: 'critical',
        autoFixable: false,
        fixSuggestion:
          'Use parameterized queries or an ORM with built-in escaping.',
      },
      {
        id: 'sec-hardcoded-secrets',
        description:
          'No hardcoded secrets — detect API keys, tokens, passwords, and credentials in source code.',
        checkType: 'regex',
        checkConfig: {
          pattern:
            '(?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|db[_-]?password|database[_-]?url)\\s*[:=]\\s*[`\'"][A-Za-z0-9_\\-+=/]{12,}[`\'"]',
          flags: 'gi',
          forbidden: true,
        },
        severity: 'critical',
        autoFixable: false,
        fixSuggestion:
          'Store secrets in environment variables or a secrets manager.',
      },
      {
        id: 'sec-no-password-plaintext',
        description:
          'No plaintext passwords — detect hardcoded password assignments in config or source.',
        checkType: 'regex',
        checkConfig: {
          pattern: '(?:password|passwd|pwd)\\s*[:=]\\s*[`\'"][^`\'"]{3,}[`\'"]',
          flags: 'gi',
          forbidden: true,
        },
        severity: 'critical',
        autoFixable: false,
        fixSuggestion:
          'Never hardcode passwords. Use environment variables or secure vault storage.',
      },
      {
        id: 'sec-input-validation',
        description:
          'Input validation required — detect missing validation on user-facing function parameters.',
        checkType: 'ast-pattern',
        checkConfig: { pattern: 'missing-input-validation' },
        severity: 'high',
        autoFixable: false,
        fixSuggestion:
          'Validate all user-facing inputs: type-check, sanitize, and constrain values before use.',
      },
      {
        id: 'sec-path-traversal',
        description:
          'No path traversal — detect unsanitized file path operations that could allow directory traversal.',
        checkType: 'regex',
        checkConfig: {
          pattern:
            '(?:fs\\.(?:readFile|writeFile|createReadStream|createWriteStream|open|readdir|unlink|rmdir|mkdir|stat|access|realpath|exists)|path\\.(?:resolve|join))\\s*\\(\\s*[^,)]*\\+\\s*[^,)]*\\b(?:req\\.|request\\.|params\\.|query\\.|body\\.|input|user)',
          forbidden: true,
        },
        severity: 'critical',
        autoFixable: false,
        fixSuggestion:
          'Sanitize file paths with path.normalize() and validate the resolved path stays within the intended directory.',
      },
      {
        id: 'sec-csrf-protection',
        description:
          'CSRF protection required — detect POST/PUT/DELETE endpoints missing CSRF token validation.',
        checkType: 'ast-pattern',
        checkConfig: { pattern: 'missing-csrf-token' },
        severity: 'high',
        autoFixable: false,
        fixSuggestion:
          'Add CSRF protection middleware (e.g. csurf, lusca) to all state-changing endpoints.',
      },
      {
        id: 'sec-xss-prevention',
        description:
          'XSS prevention — detect unescaped user input in HTML templates, JSX, and innerHTML usage.',
        checkType: 'regex',
        checkConfig: {
          pattern:
            '(?:dangerouslySetInnerHTML|innerHTML\\s*=|document\\.write\\s*\\(|eval\\s*\\(|new\\s+Function\\s*\\(|setTimeout\\s*\\(\\s*[`\'"][^`\'"]*\\$\\{)',
          forbidden: true,
        },
        severity: 'critical',
        autoFixable: false,
        fixSuggestion:
          'Avoid dangerouslySetInnerHTML, innerHTML, and eval(). For raw HTML, sanitize with DOMPurify.',
      },
    ],
    examples: [
      {
        description: 'Parameterized SQL query — compliant',
        compliant: true,
        code: 'const rows = await db.query("SELECT * FROM users WHERE id = ?", [userId]);',
      },
      {
        description: 'String concatenation in SQL — non-compliant',
        compliant: false,
        code: 'const query = "SELECT * FROM users WHERE id = " + userId;',
        explanation: 'Vulnerable to SQL injection via string concatenation.',
      },
      {
        description: 'Secret from environment — compliant',
        compliant: true,
        code: 'const apiKey = process.env.API_KEY;',
      },
      {
        description: 'Hardcoded API key — non-compliant',
        compliant: false,
        code: 'const apiKey = "sk-abcdef1234567890";',
        explanation: 'API key is hardcoded in source code.',
      },
    ],
  },
  {
    id: 'std-general',
    name: 'General Quality',
    version: '1.0.0',
    category: 'general',
    description: 'General code quality checks not covered by other standards.',
    rules: [
      {
        id: 'general-check',
        description: 'Generic quality marker for extensible standards.',
        checkType: 'regex',
        checkConfig: { pattern: 'STDGENERAL_MARKER_7F3A', forbidden: true },
        severity: 'low',
        autoFixable: false,
      },
    ],
    examples: [],
  },
];
