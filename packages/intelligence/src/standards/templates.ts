import type {
  ProjectStandard,
  StandardCategory,
} from '@code-analyzer/shared';

export interface StandardTemplate {
  id: string;
  name: string;
  category: StandardCategory;
  description: string;
  language: string;
}

/**
 * TypeScript Coding Standard — enforces idiomatic TypeScript patterns.
 */
const typescriptCoding: ProjectStandard = {
  id: 'typescript-coding',
  name: 'TypeScript Coding Standards',
  version: '1.0.0',
  category: 'code-style',
  description: 'Standard TypeScript coding conventions: function size limits, naming conventions, type safety.',
  rules: [
    {
      id: 'ts-func-lines',
      description: 'Functions must not exceed 50 lines',
      checkType: 'metric',
      checkConfig: { metric: 'function-lines', threshold: 50 },
      severity: 'medium',
      autoFixable: false,
    },
    {
      id: 'ts-max-depth',
      description: 'Maximum nesting depth is 4',
      checkType: 'metric',
      checkConfig: { metric: 'nesting-depth', threshold: 4 },
      severity: 'medium',
      autoFixable: false,
    },
    {
      id: 'ts-no-any',
      description: 'No any types allowed',
      checkType: 'regex',
      checkConfig: { pattern: ':\\s*any\\b', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Replace `any` with a specific type or `unknown`.',
    },
    {
      id: 'ts-pascal-case-class',
      description: 'Classes and interfaces must use PascalCase',
      checkType: 'regex',
      checkConfig: { pattern: '(?:class|interface)\\s+([a-z][a-zA-Z0-9]*)', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Rename class/interface to PascalCase.',
    },
    {
      id: 'ts-camel-case-func',
      description: 'Functions and variables must use camelCase',
      checkType: 'regex',
      checkConfig: { pattern: '(?:function|const|let|var)\\s+([A-Z][a-zA-Z0-9]*)', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Rename function/variable to camelCase.',
    },
    {
      id: 'ts-explicit-return',
      description: 'Public functions must have explicit return types',
      checkType: 'regex',
      checkConfig: { pattern: 'export\\s+(?:async\\s+)?function\\s+\\w+\\s*\\([^)]*\\)\\s*(?![:\\(\\{])', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add an explicit return type annotation.',
    },
    {
      id: 'ts-no-console-log',
      description: 'No console.log in production code',
      checkType: 'regex',
      checkConfig: { pattern: 'console\\.(log|debug|info)\\s*\\(', flags: 'g' },
      severity: 'low',
      autoFixable: true,
      fixSuggestion: 'Replace with a proper logging library.',
    },
  ],
  examples: [
    {
      description: 'Small function with explicit return type',
      compliant: true,
      code: 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}',
    },
    {
      description: 'Function using any type — non-compliant',
      compliant: false,
      code: 'function process(data: any): void {\n  console.log(data);\n}',
      explanation: 'Uses `any` type and `console.log`.',
    },
  ],
};

/**
 * Python PEP8 Standard — enforces PEP8 conventions.
 */
const pythonPep8: ProjectStandard = {
  id: 'python-pep8',
  name: 'Python PEP8 Standards',
  version: '1.0.0',
  category: 'code-style',
  description: 'Python PEP8 conventions: function size, naming, documentation.',
  rules: [
    {
      id: 'py-func-lines',
      description: 'Functions must not exceed 50 lines',
      checkType: 'metric',
      checkConfig: { metric: 'function-lines', threshold: 50 },
      severity: 'medium',
      autoFixable: false,
    },
    {
      id: 'py-max-depth',
      description: 'Maximum nesting depth is 4',
      checkType: 'metric',
      checkConfig: { metric: 'nesting-depth', threshold: 4 },
      severity: 'medium',
      autoFixable: false,
    },
    {
      id: 'py-snake-case-func',
      description: 'Functions and variables must use snake_case',
      checkType: 'regex',
      checkConfig: { pattern: 'def\\s+([A-Z][a-zA-Z0-9_]*)', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Rename function to snake_case.',
    },
    {
      id: 'py-pascal-case-class',
      description: 'Classes must use PascalCase',
      checkType: 'regex',
      checkConfig: { pattern: 'class\\s+([a-z][a-zA-Z0-9_]*)', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Rename class to PascalCase.',
    },
    {
      id: 'py-docstrings',
      description: 'Public functions and classes must have docstrings',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-docstring' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add a docstring describing the function purpose.',
    },
  ],
  examples: [
    {
      description: 'Well-documented Python function',
      compliant: true,
      code: 'def calculate_total(items: list) -> float:\n    """Sum all item prices."""\n    return sum(item.price for item in items)',
    },
    {
      description: 'Function missing docstring',
      compliant: false,
      code: 'def process(x):\n    return x * 2',
      explanation: 'Missing docstring.',
    },
  ],
};

/**
 * Go Idiomatic Standard — enforces Go conventions.
 */
const goIdiomatic: ProjectStandard = {
  id: 'go-idiomatic',
  name: 'Go Idiomatic Standards',
  version: '1.0.0',
  category: 'code-style',
  description: 'Go idiomatic conventions: function size, exports, error handling.',
  rules: [
    {
      id: 'go-func-lines',
      description: 'Functions must not exceed 50 lines',
      checkType: 'metric',
      checkConfig: { metric: 'function-lines', threshold: 50 },
      severity: 'medium',
      autoFixable: false,
    },
    {
      id: 'go-no-unused-imports',
      description: 'No unused imports',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'unused-import' },
      severity: 'high',
      autoFixable: true,
      fixSuggestion: 'Remove unused imports.',
    },
    {
      id: 'go-exported-comments',
      description: 'Exported functions must have comments',
      checkType: 'regex',
      checkConfig: { pattern: '^func\\s+[A-Z]', flags: 'gm' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add a comment before exported function.',
    },
    {
      id: 'go-error-handling',
      description: 'Errors must not be ignored',
      checkType: 'regex',
      checkConfig: { pattern: '\\w+,\\s*_\\s*:=', flags: 'g' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Handle the error instead of ignoring it with `_`.',
    },
  ],
  examples: [
    {
      description: 'Proper Go error handling',
      compliant: true,
      code: 'result, err := doSomething()\nif err != nil {\n    return err\n}',
    },
    {
      description: 'Ignored error — non-compliant',
      compliant: false,
      code: 'result, _ := doSomething()',
      explanation: 'Error is ignored using `_`.',
    },
  ],
};

/**
 * Security Baseline Standard — enforces security best practices.
 */
const securityBaseline: ProjectStandard = {
  id: 'security-baseline',
  name: 'Security Baseline',
  version: '1.0.0',
  category: 'security',
  description: 'Security best practices: no eval, no innerHTML, parameterized SQL, no hardcoded secrets.',
  rules: [
    {
      id: 'sec-no-eval',
      description: 'No eval() usage',
      checkType: 'regex',
      checkConfig: { pattern: '\\beval\\s*\\(', flags: 'g' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Avoid eval(); use safer alternatives.',
    },
    {
      id: 'sec-no-innerhtml',
      description: 'No innerHTML assignment',
      checkType: 'regex',
      checkConfig: { pattern: '\\.innerHTML\\s*=', flags: 'g' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Use textContent or safe DOM methods instead.',
    },
    {
      id: 'sec-parameterized-sql',
      description: 'Use parameterized SQL queries',
      checkType: 'regex',
      checkConfig: { pattern: '[`\'"]\\s*\\+\\s*\\w+\\s*\\+\\s*[`\'"]', flags: 'g' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Use parameterized queries to prevent SQL injection.',
    },
    {
      id: 'sec-no-hardcoded-secrets',
      description: 'No hardcoded secrets (passwords, tokens, keys)',
      checkType: 'regex',
      checkConfig: {
        pattern: '(?:password|secret|token|api[_-]?key|api[_-]?secret)\\s*[:=]\\s*[`\'"][^`\'"]{8,}[`\'"]',
        flags: 'gi',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Use environment variables or a secrets manager.',
    },
    {
      id: 'sec-input-validation',
      description: 'User input must be validated',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-input-validation' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Validate and sanitize all user inputs.',
    },
  ],
  examples: [
    {
      description: 'Parameterized SQL query',
      compliant: true,
      code: 'const rows = await db.query("SELECT * FROM users WHERE id = ?", [userId]);',
    },
    {
      description: 'String concatenation in SQL — non-compliant',
      compliant: false,
      code: 'const query = "SELECT * FROM users WHERE id = " + userId;',
      explanation: 'Vulnerable to SQL injection.',
    },
  ],
};

/**
 * API Design Standard — RESTful API conventions.
 */
const apiDesign: ProjectStandard = {
  id: 'api-design',
  name: 'API Design Standards',
  version: '1.0.0',
  category: 'api-design',
  description: 'RESTful API design conventions: route naming, HTTP methods, versioning, error responses.',
  rules: [
    {
      id: 'api-restful-routes',
      description: 'Routes must follow RESTful naming (plural nouns, kebab-case)',
      checkType: 'regex',
      checkConfig: { pattern: '(?:get|post|put|delete|patch)\\s*\\(\\s*[`\'"]/(?:[a-z][a-z0-9-]*/?)+[`\'"]', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
    },
    {
      id: 'api-http-methods',
      description: 'Use proper HTTP methods (GET, POST, PUT, DELETE, PATCH)',
      checkType: 'regex',
      checkConfig: { pattern: 'app\\.(?!get|post|put|delete|patch|options|head)\\w+\\s*\\(', flags: 'g' },
      severity: 'high',
      autoFixable: false,
    },
    {
      id: 'api-versioned',
      description: 'APIs must be versioned (e.g., /api/v1/)',
      checkType: 'regex',
      checkConfig: { pattern: '/api/(?!v\\d+/)[^/]+', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Prefix routes with version, e.g. /api/v1/users.',
    },
    {
      id: 'api-error-response',
      description: 'Consistent error response format',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'error-response-format' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use a consistent error response shape: { error: { code, message } }.',
    },
  ],
  examples: [
    {
      description: 'Versioned RESTful endpoint',
      compliant: true,
      code: "app.get('/api/v1/users/:id', handler);",
    },
    {
      description: 'Non-versioned endpoint — non-compliant',
      compliant: false,
      code: "app.get('/api/users', handler);",
      explanation: 'Missing API version prefix.',
    },
  ],
};

/**
 * Testing Standards — test conventions and patterns.
 */
const testingStandards: ProjectStandard = {
  id: 'testing-standards',
  name: 'Testing Standards',
  version: '1.0.0',
  category: 'testing',
  description: 'Testing conventions: naming, arrange/act/assert, independence.',
  rules: [
    {
      id: 'test-naming',
      description: 'Tests must follow naming convention (describe/it or test_ prefix)',
      checkType: 'regex',
      checkConfig: { pattern: '\\b(?:it|test)\\s*\\(\\s*[`\'"]should', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use `it("should ...")` or `test("should ...")`.',
    },
    {
      id: 'test-aaa',
      description: 'Tests must follow Arrange/Act/Assert pattern',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'arrange-act-assert' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Structure tests with clear arrange, act, and assert sections.',
    },
    {
      id: 'test-no-interdep',
      description: 'No test interdependencies',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'test-interdependency' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Each test should be independent and self-contained.',
    },
  ],
  examples: [
    {
      description: 'Well-structured test',
      compliant: true,
      code: "it('should calculate total correctly', () => {\n  // Arrange\n  const items = [1, 2, 3];\n  // Act\n  const result = sum(items);\n  // Assert\n  expect(result).toBe(6);\n});",
    },
  ],
};

/**
 * Error Handling Standard — try/catch, propagation, logging.
 */
const errorHandling: ProjectStandard = {
  id: 'error-handling',
  name: 'Error Handling Standards',
  version: '1.0.0',
  category: 'error-handling',
  description: 'Error handling conventions: try/catch, propagation, logging.',
  rules: [
    {
      id: 'err-try-catch',
      description: 'Async operations must have try/catch',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-try-catch' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Wrap async operations in try/catch blocks.',
    },
    {
      id: 'err-propagation',
      description: 'Errors must be propagated, not swallowed',
      checkType: 'regex',
      checkConfig: { pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Do not swallow errors; log and/or rethrow.',
    },
    {
      id: 'err-logging',
      description: 'Errors must be logged with context',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'error-logging' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Log errors with relevant context (file, function, input).',
    },
  ],
  examples: [
    {
      description: 'Proper error handling',
      compliant: true,
      code: 'try {\n  await riskyOperation();\n} catch (error) {\n  logger.error("Operation failed", { error });\n  throw new OperationError("Failed", { cause: error });\n}',
    },
    {
      description: 'Swallowed error — non-compliant',
      compliant: false,
      code: 'try {\n  await riskyOperation();\n} catch (error) {}',
      explanation: 'Error is silently swallowed.',
    },
  ],
};

/**
 * Documentation Standard — JSDoc, README, changelog.
 */
const documentation: ProjectStandard = {
  id: 'documentation',
  name: 'Documentation Standards',
  version: '1.0.0',
  category: 'documentation',
  description: 'Documentation conventions: JSDoc, README, changelog.',
  rules: [
    {
      id: 'doc-jsdoc-public',
      description: 'Public APIs must have JSDoc',
      checkType: 'regex',
      checkConfig: { pattern: 'export\\s+(?:async\\s+)?function\\s+\\w+', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add JSDoc comment before exported functions.',
    },
    {
      id: 'doc-readme',
      description: 'Project must have a README',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'readme-presence' },
      severity: 'low',
      autoFixable: false,
    },
    {
      id: 'doc-changelog',
      description: 'Project must have a changelog format',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'changelog-format' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Maintain a CHANGELOG.md following Keep a Changelog format.',
    },
  ],
  examples: [
    {
      description: 'Well-documented function',
      compliant: true,
      code: '/**\n * Calculates the total price including tax.\n * @param items - List of items\n * @returns Total with tax\n */\nexport function calculateTotal(items: Item[]): number {',
    },
  ],
};

/**
 * Security Essentials — comprehensive security-focused standard.
 * Covers SQL injection, hardcoded secrets, input validation, path traversal,
 * CSRF protection, and XSS prevention.
 */
const securityEssentials: ProjectStandard = {
  id: 'security-essentials',
  name: 'Security Essentials',
  version: '1.0.0',
  category: 'security',
  description:
    'Comprehensive security checks: SQL injection prevention, no hardcoded secrets, input validation, path traversal protection, CSRF tokens, and XSS prevention.',
  rules: [
    {
      id: 'sec-sql-injection',
      description: 'No SQL injection patterns — detect string concatenation in SQL queries and raw queries without parameterization',
      checkType: 'regex',
      checkConfig: {
        pattern: '(?:execute|query|run)\\s*\\(\\s*[`\'"][^`\'"]*\\$\\{|(?:SELECT|INSERT|UPDATE|DELETE|DROP)\\s+.*?\\+.*?["\'`]',
        flags: 'gi',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion:
        'Use parameterized queries (e.g. `db.query("SELECT * FROM users WHERE id = ?", [userId])`) or an ORM with built-in escaping.',
    },
    {
      id: 'sec-hardcoded-secrets',
      description: 'No hardcoded secrets — detect API keys, tokens, passwords, and credentials in source code',
      checkType: 'regex',
      checkConfig: {
        pattern:
          '(?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|db[_-]?password|database[_-]?url)\\s*[:=]\\s*[`\'"][A-Za-z0-9_\\-+=/]{12,}[`\'"]',
        flags: 'gi',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion:
        'Store secrets in environment variables or a secrets manager (e.g. process.env.API_KEY, Vault, AWS Secrets Manager).',
    },
    {
      id: 'sec-no-password-plaintext',
      description: 'No plaintext passwords — detect hardcoded password assignments in config or source',
      checkType: 'regex',
      checkConfig: {
        pattern: '(?:password|passwd|pwd)\\s*[:=]\\s*[`\'"][^`\'"]{3,}[`\'"]',
        flags: 'gi',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion:
        'Never hardcode passwords. Use environment variables or secure vault storage.',
    },
    {
      id: 'sec-input-validation',
      description: 'Input validation required — detect missing validation on user-facing function parameters',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-input-validation' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion:
        'Validate all user-facing inputs: type-check, sanitize, and constrain values before use. Use libraries like zod, joi, or express-validator.',
    },
    {
      id: 'sec-path-traversal',
      description: 'No path traversal — detect unsanitized file path operations that could allow directory traversal',
      checkType: 'regex',
      checkConfig: {
        pattern:
          '(?:fs\\.(?:readFile|writeFile|createReadStream|createWriteStream|open|readdir|unlink|rmdir|mkdir|stat|access|realpath|exists)|path\\.(?:resolve|join))\\s*\\(\\s*[^,)]*\\+\\s*[^,)]*\\b(?:req\\.|request\\.|params\\.|query\\.|body\\.|input|user)',
        flags: 'g',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion:
        'Sanitize file paths with `path.normalize()` and validate that the resolved path stays within the intended directory. Use `path.resolve(baseDir, input)` and verify the result starts with `baseDir`.',
    },
    {
      id: 'sec-csrf-protection',
      description: 'CSRF protection required — detect POST/PUT/DELETE endpoints missing CSRF token validation',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-csrf-token' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion:
        'Add CSRF protection middleware (e.g. csurf, lusca) to all state-changing endpoints. For SPAs, use double-submit cookie pattern or synchronizer token pattern.',
    },
    {
      id: 'sec-xss-prevention',
      description: 'XSS prevention — detect unescaped user input in HTML templates, JSX, and innerHTML usage',
      checkType: 'regex',
      checkConfig: {
        pattern:
          '(?:dangerouslySetInnerHTML|innerHTML\\s*=|document\\.write\\s*\\(|eval\\s*\\(|new\\s+Function\\s*\\(|setTimeout\\s*\\(\\s*[`\'"][^`\'"]*\\$\\{)',
        flags: 'g',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion:
        'Avoid dangerouslySetInnerHTML, innerHTML, and eval(). Use framework-provided escaping (React auto-escapes JSX). For raw HTML, sanitize with DOMPurify before insertion.',
    },
    {
      id: 'sec-no-eval-function',
      description: 'No eval or Function constructor — detect dynamic code execution',
      checkType: 'regex',
      checkConfig: {
        pattern: '\\b(?:eval|Function)\\s*\\(',
        flags: 'g',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion:
        'Avoid eval() and new Function(). Use structured data formats (JSON) for dynamic behavior.',
    },
    {
      id: 'sec-crypto-weak',
      description: 'No weak cryptographic algorithms — detect MD5, SHA1, or hardcoded keys for encryption',
      checkType: 'regex',
      checkConfig: {
        pattern: '\\b(?:md5|sha1|des\\b|rc4|ecb)\\b|createHash\\s*\\(\\s*[`\'"]md5[`\'"]|createHash\\s*\\(\\s*[`\'"]sha1[`\'"]',
        flags: 'gi',
      },
      severity: 'high',
      autoFixable: false,
      fixSuggestion:
        'Use strong cryptographic algorithms: SHA-256, SHA-512, AES-GCM. For password hashing, use bcrypt, argon2, or scrypt.',
    },
  ],
  examples: [
    {
      description: 'Parameterized SQL query — compliant',
      compliant: true,
      code: 'const rows = await db.query(\n  "SELECT * FROM users WHERE id = ?",\n  [userId]\n);',
    },
    {
      description: 'String concatenation in SQL — non-compliant',
      compliant: false,
      code: 'const query = "SELECT * FROM users WHERE id = " + userId;\nconst rows = await db.execute(query);',
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
    {
      description: 'Safe file path resolution — compliant',
      compliant: true,
      code: 'const safePath = path.resolve(baseDir, path.normalize(userInput));\nif (!safePath.startsWith(baseDir)) {\n  throw new Error("Path traversal detected");\n}\nconst content = await fs.readFile(safePath);',
    },
    {
      description: 'Unsanitized file path — non-compliant',
      compliant: false,
      code: 'const content = await fs.readFile("/data/" + req.params.file);',
      explanation: 'User-controlled path allows directory traversal (e.g. ../../etc/passwd).',
    },
    {
      description: 'CSRF-protected form — compliant',
      compliant: true,
      code: '<form method="POST" action="/api/users">\n  <input type="hidden" name="_csrf" value="{{csrfToken}}" />\n  <input name="email" />\n  <button type="submit">Save</button>\n</form>',
    },
    {
      description: 'Missing CSRF token — non-compliant',
      compliant: false,
      code: '<form method="POST" action="/api/users">\n  <input name="email" />\n  <button type="submit">Save</button>\n</form>',
      explanation: 'POST form missing CSRF token, vulnerable to cross-site request forgery.',
    },
    {
      description: 'Safe JSX rendering — compliant',
      compliant: true,
      code: '<div>{user.name}</div>',
    },
    {
      description: 'Unsafe innerHTML — non-compliant',
      compliant: false,
      code: 'element.innerHTML = user.bio;',
      explanation: 'innerHTML assignment with user input allows XSS injection.',
    },
  ],
};

/**
 * Architecture Layered Standard — module boundaries and dependencies.
 */
const architectureLayered: ProjectStandard = {
  id: 'architecture-layered',
  name: 'Architecture Layered Standards',
  version: '1.0.0',
  category: 'architecture',
  description: 'Architecture conventions: no upward imports, no circular deps, proper module boundaries.',
  rules: [
    {
      id: 'arch-no-upward-imports',
      description: 'No layer-violating imports (lower layers importing from higher)',
      checkType: 'graph-query',
      checkConfig: { pattern: 'upward-import' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Restructure imports to respect layer boundaries.',
    },
    {
      id: 'arch-no-circular-deps',
      description: 'No circular dependencies between modules',
      checkType: 'graph-query',
      checkConfig: { pattern: 'circular-dependency' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Extract shared code into a common module.',
    },
    {
      id: 'arch-module-boundaries',
      description: 'Modules must have clear boundaries',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'module-boundary' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Define clear public API with index.ts barrel exports.',
    },
  ],
  examples: [
    {
      description: 'Clean layered architecture',
      compliant: true,
      code: '// services/user-service.ts\nimport { UserRepository } from "../data/user-repository"; // OK: data is a lower layer',
    },
    {
      description: 'Upward import — non-compliant',
      compliant: false,
      code: '// data/user-repository.ts\nimport { formatResponse } from "../api/response-formatter"; // BAD: data importing from api layer',
      explanation: 'Lower layer importing from higher layer.',
    },
  ],
};

/**
 * Dependency Management Standard — version pinning, licenses, unused deps.
 */
const dependencyManagement: ProjectStandard = {
  id: 'dependency-management',
  name: 'Dependency Management Standards',
  version: '1.0.0',
  category: 'dependency',
  description: 'Dependency conventions: no unused deps, version pinning, license compliance.',
  rules: [
    {
      id: 'dep-no-unused',
      description: 'No unused dependencies',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'unused-dependency' },
      severity: 'medium',
      autoFixable: true,
      fixSuggestion: 'Remove unused dependencies from package.json.',
    },
    {
      id: 'dep-version-pinning',
      description: 'Dependencies must use exact versions (no ^ or ~)',
      checkType: 'regex',
      checkConfig: { pattern: '"[\\^~]', flags: 'g' },
      severity: 'low',
      autoFixable: true,
      fixSuggestion: 'Pin dependencies to exact versions.',
    },
    {
      id: 'dep-license-compliance',
      description: 'All dependencies must have compliant licenses',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'license-check' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Review dependency licenses for compliance.',
    },
  ],
  examples: [
    {
      description: 'Correctly pinned versions',
      compliant: true,
      code: '{ "dependencies": { "lodash": "4.17.21" } }',
    },
    {
      description: 'Range-pinned versions — non-compliant',
      compliant: false,
      code: '{ "dependencies": { "lodash": "^4.17.21" } }',
      explanation: 'Caret allows minor version changes.',
    },
  ],
};

// ===========================================================================
// NEW STANDARDS — Security (6)
// ===========================================================================

/**
 * OWASP Top 10 Standard — covers the OWASP Top 10 web application security risks.
 */
const owaspTop10: ProjectStandard = {
  id: 'owasp-top10',
  name: 'OWASP Top 10 Standards',
  version: '1.0.0',
  category: 'security',
  description: 'Checks covering OWASP Top 10: injection, broken auth, sensitive data exposure, XXE, broken access control, security misconfig, XSS, insecure deserialization, vulnerable components, insufficient logging.',
  rules: [
    {
      id: 'owasp-injection',
      description: 'A1: Injection — no string concatenation in SQL/command execution',
      checkType: 'regex',
      checkConfig: { pattern: '(?:execute|query|exec|spawn|execSync|execFile)\\s*\\(\\s*[`\'"][^`\'"]*(?:\\$\\{|\\$\\w+|%s|%d|\\{\\d+\\})', flags: 'gi' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Use parameterized queries or prepared statements.',
    },
    {
      id: 'owasp-broken-auth',
      description: 'A2: Broken Authentication — detect missing auth middleware',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-auth-middleware' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Add authentication middleware to all protected routes.',
    },
    {
      id: 'owasp-sensitive-data',
      description: 'A3: Sensitive Data Exposure — detect plaintext PII/sensitive data in logs',
      checkType: 'regex',
      checkConfig: { pattern: '\\b(?:password|ssn|credit[_-]?card|secret|token|private[_-]?key)\\b.*?(?:console\\.log|logger\\.(?:info|debug|log)|print|echo)', flags: 'gi' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Never log sensitive data. Redact or hash PII before logging.',
    },
    {
      id: 'owasp-xxe',
      description: 'A4: XML External Entities (XXE) — detect XML parsers without XXE protection',
      checkType: 'regex',
      checkConfig: { pattern: '(?:xml2js|DOMParser|XMLHttpRequest|libxml|etree\\.parse|xml\\.dom|xml\\.sax|xml\\.etree)', flags: 'gi' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Disable external entity processing in XML parsers.',
    },
    {
      id: 'owasp-broken-access',
      description: 'A5: Broken Access Control — detect routes without authorization checks',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-access-control' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Add role-based access control checks to all routes.',
    },
    {
      id: 'owasp-security-misconfig',
      description: 'A6: Security Misconfiguration — detect debug mode, verbose errors',
      checkType: 'regex',
      checkConfig: { pattern: '(?:DEBUG\\s*=\\s*(?:True|true|1)|NODE_ENV\\s*=\\s*[\'"]development[\'"]|app\\.use\\(express\\.errorHandler)', flags: 'gi' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Disable debug mode and verbose error messages in production.',
    },
    {
      id: 'owasp-xss',
      description: 'A7: XSS — detect unescaped user input in HTML responses',
      checkType: 'regex',
      checkConfig: { pattern: '(?:innerHTML|outerHTML|document\\.write|dangerouslySetInnerHTML|v-html|\\\\{\\\\{.*?\\}\\}|<%=\\s)', flags: 'g' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Escape or sanitize user input before rendering in HTML.',
    },
    {
      id: 'owasp-insecure-deserial',
      description: 'A8: Insecure Deserialization — detect unsafe deserialization patterns',
      checkType: 'regex',
      checkConfig: { pattern: '(?:pickle\\.loads|yaml\\.load\\s*\\(|JSON\\.parse\\s*\\(\\s*(?:req|request|input)|unserialize|deserialize)', flags: 'gi' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Use safe deserialization libraries and validate input before deserializing.',
    },
    {
      id: 'owasp-vuln-components',
      description: 'A9: Using Components with Known Vulnerabilities — detect unpinned or outdated dependencies',
      checkType: 'regex',
      checkConfig: { pattern: '"[\\^~*]', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Pin dependency versions and regularly audit with npm audit or pip audit.',
    },
    {
      id: 'owasp-insufficient-logging',
      description: 'A10: Insufficient Logging & Monitoring — detect missing audit logging on sensitive operations',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-audit-logging' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add audit logging for all authentication, authorization, and data modification operations.',
    },
  ],
  examples: [
    {
      description: 'Parameterized query — compliant',
      compliant: true,
      code: 'const rows = await db.query("SELECT * FROM users WHERE id = $1", [userId]);',
    },
    {
      description: 'String concatenation in SQL — non-compliant',
      compliant: false,
      code: 'const query = "SELECT * FROM users WHERE id = " + userId;',
      explanation: 'Vulnerable to SQL injection (A1).',
    },
  ],
};

/**
 * API Security Standard — API key exposure, rate limiting, auth middleware, CORS, input validation.
 */
const apiSecurity: ProjectStandard = {
  id: 'api-security',
  name: 'API Security Standards',
  version: '1.0.0',
  category: 'security',
  description: 'API security: key exposure, rate limiting, auth middleware, CORS configuration, input validation.',
  rules: [
    {
      id: 'apisec-key-exposure',
      description: 'No API keys exposed in client-side code or public repos',
      checkType: 'regex',
      checkConfig: { pattern: '(?:api[_-]?key|api[_-]?secret|auth[_-]?token|bearer)\\s*[:=]\\s*[`\'"][A-Za-z0-9_\\-]{16,}[`\'"]', flags: 'gi' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Move API keys to environment variables or server-side only code.',
    },
    {
      id: 'apisec-rate-limit',
      description: 'Rate limiting must be configured on public endpoints',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-rate-limiting' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Add rate limiting middleware (e.g., express-rate-limit, flask-limiter).',
    },
    {
      id: 'apisec-auth-middleware',
      description: 'Authentication middleware required on protected routes',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-auth-middleware' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Apply authentication middleware to all routes requiring authentication.',
    },
    {
      id: 'apisec-cors-config',
      description: 'CORS must be explicitly configured, not wide open',
      checkType: 'regex',
      checkConfig: { pattern: '(?:Access-Control-Allow-Origin\\s*:\\s*\\*|cors\\s*\\(\\s*\\)|origins\\s*:\\s*\\[\\s*[\'"]\\*[\'"]\\s*\\])', flags: 'gi' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Configure CORS with explicit allowed origins, not wildcard.',
    },
    {
      id: 'apisec-input-validation',
      description: 'All API inputs must be validated (query, body, params)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-input-validation' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Validate all request inputs using a schema validation library (zod, joi, pydantic).',
    },
    {
      id: 'apisec-https-only',
      description: 'All API calls must use HTTPS',
      checkType: 'regex',
      checkConfig: { pattern: 'https?://(?!localhost|127\\.0\\.0\\.1)', flags: 'gi' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use HTTPS for all production API endpoints.',
    },
  ],
  examples: [
    {
      description: 'API key from environment — compliant',
      compliant: true,
      code: 'const apiKey = process.env.API_KEY;',
    },
    {
      description: 'Hardcoded API key — non-compliant',
      compliant: false,
      code: 'const apiKey = "sk-live-abc123def456ghi789";',
      explanation: 'API key is hardcoded in source code.',
    },
  ],
};

/**
 * Dependency Security Standard — known vulnerable patterns, unpinned versions.
 */
const dependencySecurity: ProjectStandard = {
  id: 'dependency-security',
  name: 'Dependency Security Standards',
  version: '1.0.0',
  category: 'security',
  description: 'Check for known vulnerable dependency patterns and unpinned versions.',
  rules: [
    {
      id: 'depsec-pinned-versions',
      description: 'Production dependencies must be pinned to exact versions',
      checkType: 'regex',
      checkConfig: { pattern: '"dependencies"\\s*:\\s*\\{[^}]*"[\\^~]', flags: 'g' },
      severity: 'high',
      autoFixable: true,
      fixSuggestion: 'Pin dependencies to exact versions for reproducible builds.',
    },
    {
      id: 'depsec-vuln-patterns',
      description: 'Detect known vulnerable library patterns',
      checkType: 'regex',
      checkConfig: { pattern: '"(?:lodash|jquery|moment|request|left-pad|event-stream|flatmap-stream)":\\s*"[\\^~]?[0-9]', flags: 'gi' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Audit and update vulnerable dependencies. Run npm audit or pip audit.',
    },
    {
      id: 'depsec-no-integrity',
      description: 'Dependencies should have integrity hashes (package-lock, yarn.lock, Pipfile.lock)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-lockfile' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Commit lockfiles to version control for supply chain security.',
    },
    {
      id: 'depsec-unpinned-images',
      description: 'Docker base images must use specific tags, not `latest`',
      checkType: 'regex',
      checkConfig: { pattern: 'FROM\\s+\\S+:latest\\b', flags: 'gi' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Use specific image tags (e.g., node:18-alpine) instead of latest.',
    },
  ],
  examples: [
    {
      description: 'Pinned versions — compliant',
      compliant: true,
      code: '{ "dependencies": { "express": "4.18.2" } }',
    },
    {
      description: 'Caret range — non-compliant',
      compliant: false,
      code: '{ "dependencies": { "express": "^4.18.2" } }',
      explanation: 'Caret allows minor version changes.',
    },
  ],
};

/**
 * Container Security Standard — Dockerfile best practices.
 */
const containerSecurity: ProjectStandard = {
  id: 'container-security',
  name: 'Container Security Standards',
  version: '1.0.0',
  category: 'security',
  description: 'Dockerfile best practices: non-root user, COPY not ADD, specific tags, health checks.',
  rules: [
    {
      id: 'container-non-root',
      description: 'Containers must not run as root',
      checkType: 'regex',
      checkConfig: { pattern: '^USER\\s+(?:root|0)\\s*$', flags: 'gim' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Create and use a non-root user: RUN useradd -m appuser && USER appuser.',
    },
    {
      id: 'container-copy-not-add',
      description: 'Use COPY instead of ADD in Dockerfiles',
      checkType: 'regex',
      checkConfig: { pattern: '^ADD\\s+', flags: 'gim' },
      severity: 'medium',
      autoFixable: true,
      fixSuggestion: 'Use COPY instead of ADD unless you need tar auto-extraction.',
    },
    {
      id: 'container-specific-tags',
      description: 'Base images must use specific tags, not latest',
      checkType: 'regex',
      checkConfig: { pattern: 'FROM\\s+[^:\\s]+$|FROM\\s+\\S+:latest\\b', flags: 'gim' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Use specific image tags (e.g., FROM node:18.17-alpine).',
    },
    {
      id: 'container-healthcheck',
      description: 'Containers should have HEALTHCHECK instructions',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-healthcheck' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Add HEALTHCHECK instruction to detect container health.',
    },
    {
      id: 'container-minimal-layers',
      description: 'Minimize layers by combining RUN commands',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'excessive-run-layers' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Combine RUN commands with && to reduce image layers.',
    },
  ],
  examples: [
    {
      description: 'Non-root user Dockerfile — compliant',
      compliant: true,
      code: 'FROM node:18-alpine\nRUN adduser -D appuser\nUSER appuser\nCOPY . /app\nHEALTHCHECK CMD curl --fail http://localhost:3000/health || exit 1',
    },
    {
      description: 'Root user with ADD — non-compliant',
      compliant: false,
      code: 'FROM node:latest\nADD . /app',
      explanation: 'Running as root and using ADD is less secure.',
    },
  ],
};

/**
 * Data Privacy Standard — PII detection, data encryption, GDPR patterns.
 */
const dataPrivacy: ProjectStandard = {
  id: 'data-privacy',
  name: 'Data Privacy Standards',
  version: '1.0.0',
  category: 'security',
  description: 'PII detection patterns, data encryption requirements, GDPR/data protection compliance.',
  rules: [
    {
      id: 'priv-pii-detection',
      description: 'Detect potential PII patterns in code (SSN, email, phone, credit card)',
      checkType: 'regex',
      checkConfig: {
        pattern: '(?:\\b\\d{3}-\\d{2}-\\d{4}\\b|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}|\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b|\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\\b)',
        flags: 'g',
      },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Remove hardcoded PII. Use environment variables or secure vault for sensitive data.',
    },
    {
      id: 'priv-data-encryption',
      description: 'Sensitive data must be encrypted at rest',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-encryption' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Encrypt sensitive data at rest using AES-256 or equivalent.',
    },
    {
      id: 'priv-data-retention',
      description: 'Data retention policies must be defined',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-retention-policy' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Define and implement data retention and deletion policies.',
    },
    {
      id: 'priv-gdpr-consent',
      description: 'GDPR: user consent mechanisms must be in place',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-consent-mechanism' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Implement explicit consent mechanisms for data collection per GDPR Article 7.',
    },
    {
      id: 'priv-right-to-delete',
      description: 'GDPR: right to erasure (delete) must be supported',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-delete-endpoint' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Implement user data deletion endpoint per GDPR Article 17.',
    },
  ],
  examples: [
    {
      description: 'Environment variable for sensitive data — compliant',
      compliant: true,
      code: 'const dbPassword = process.env.DB_PASSWORD;',
    },
    {
      description: 'Hardcoded SSN — non-compliant',
      compliant: false,
      code: 'const ssn = "123-45-6789";',
      explanation: 'PII is hardcoded in source code.',
    },
  ],
};

// ===========================================================================
// NEW STANDARDS — Quality & Reliability (5)
// ===========================================================================

/**
 * Error Handling Extended Standard — comprehensive error handling patterns.
 */
const errorHandlingExtended: ProjectStandard = {
  id: 'error-handling-standard',
  name: 'Error Handling Extended Standards',
  version: '1.0.0',
  category: 'error-handling',
  description: 'Comprehensive error handling: try-catch patterns, error propagation, custom error types.',
  rules: [
    {
      id: 'err-ext-try-catch',
      description: 'All async operations must have proper error handling',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-async-error-handling' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Wrap async operations in try-catch or use .catch() handlers.',
    },
    {
      id: 'err-ext-no-swallow',
      description: 'Errors must not be silently swallowed',
      checkType: 'regex',
      checkConfig: { pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Always log or rethrow caught errors. Never use empty catch blocks.',
    },
    {
      id: 'err-ext-custom-types',
      description: 'Use custom error types instead of generic Error',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'generic-error-usage' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Define custom error classes (e.g., ValidationError, NotFoundError) for better error handling.',
    },
    {
      id: 'err-ext-context',
      description: 'Errors must include contextual information',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'error-missing-context' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Include relevant context (userId, requestId, operation) when throwing errors.',
    },
    {
      id: 'err-ext-boundary',
      description: 'Use error boundaries at module/service boundaries',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-error-boundary' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Add error boundaries at module/service interfaces to prevent cascading failures.',
    },
  ],
  examples: [
    {
      description: 'Proper error handling with context',
      compliant: true,
      code: 'try {\n  await processOrder(orderId);\n} catch (error) {\n  logger.error("Order processing failed", { orderId, error });\n  throw new OrderProcessingError(orderId, { cause: error });\n}',
    },
  ],
};

/**
 * Testing Extended Standard — comprehensive testing practices.
 */
const testingExtended: ProjectStandard = {
  id: 'testing-standard',
  name: 'Testing Extended Standards',
  version: '1.0.0',
  category: 'testing',
  description: 'Comprehensive testing: test file detection, naming conventions, coverage patterns.',
  rules: [
    {
      id: 'test-ext-file-naming',
      description: 'Test files must follow naming convention (*.test.ts, *_test.py, *_test.go)',
      checkType: 'regex',
      checkConfig: { pattern: '\\.(?:test|spec)\\.[jt]sx?$|_test\\.(?:py|go|rs|java)$', flags: 'g' },
      severity: 'low',
      autoFixable: false,
    },
    {
      id: 'test-ext-coverage',
      description: 'Source files should have corresponding test files',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-test-coverage' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add test files for uncovered source modules.',
    },
    {
      id: 'test-ext-unit-first',
      description: 'Prefer unit tests over integration tests for business logic',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prefer-unit-tests' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Write unit tests for business logic. Use integration tests sparingly for external interactions.',
    },
    {
      id: 'test-ext-mock-properly',
      description: 'Mocks should not be overused; prefer fakes/stubs for simple cases',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'excessive-mocking' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use test fakes or stubs instead of mocks when possible for simpler, more readable tests.',
    },
    {
      id: 'test-ext-no-skip',
      description: 'No skipped tests in committed code',
      checkType: 'regex',
      checkConfig: { pattern: '(?:it\\.skip|describe\\.skip|test\\.skip|xdescribe|xit|xtest|@unittest\\.skip|@pytest\\.mark\\.skip)\\s*\\(', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Remove skipped tests or fix them before committing.',
    },
  ],
  examples: [
    {
      description: 'Well-structured test file',
      compliant: true,
      code: "// user.service.test.ts\nimport { describe, it, expect } from 'vitest';\nimport { UserService } from './user.service';\n\ndescribe('UserService', () => {\n  it('should create a user', () => {\n    const service = new UserService();\n    const user = service.create({ name: 'Test' });\n    expect(user.name).toBe('Test');\n  });\n});",
    },
  ],
};

/**
 * Logging Standard — structured logging, log levels, no console.log.
 */
const loggingStandard: ProjectStandard = {
  id: 'logging-standard',
  name: 'Logging Standards',
  version: '1.0.0',
  category: 'code-style',
  description: 'Structured logging requirements: log levels, structured format, no console.log in production.',
  rules: [
    {
      id: 'log-no-console',
      description: 'No console.log in production code',
      checkType: 'regex',
      checkConfig: { pattern: 'console\\.(?:log|debug|info|warn)\\s*\\(', flags: 'g' },
      severity: 'medium',
      autoFixable: true,
      fixSuggestion: 'Replace console.log with a proper logging library (winston, pino, loguru).',
    },
    {
      id: 'log-structured',
      description: 'Use structured logging (JSON format)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'non-structured-logging' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use structured JSON logging for better observability and log aggregation.',
    },
    {
      id: 'log-levels',
      description: 'Use appropriate log levels (error, warn, info, debug)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'incorrect-log-level' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use error for failures, warn for recoverable issues, info for key events, debug for development.',
    },
    {
      id: 'log-no-sensitive',
      description: 'Never log sensitive information (passwords, tokens, PII)',
      checkType: 'regex',
      checkConfig: { pattern: 'logger\\.\\w+\\([^)]*(?:password|token|secret|api[_-]?key|ssn|credit)', flags: 'gi' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Redact or hash sensitive data before logging.',
    },
    {
      id: 'log-request-id',
      description: 'Logs should include request/correlation IDs for tracing',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-correlation-id' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Include correlation/request IDs in all log entries for distributed tracing.',
    },
  ],
  examples: [
    {
      description: 'Structured logging — compliant',
      compliant: true,
      code: 'logger.info({ event: "user_login", userId: user.id, timestamp: Date.now() });',
    },
    {
      description: 'Console.log — non-compliant',
      compliant: false,
      code: 'console.log("User logged in: " + user.email);',
      explanation: 'Using console.log with sensitive email data.',
    },
  ],
};

/**
 * API Design Extended Standard — RESTful patterns, versioning, pagination.
 */
const apiDesignExtended: ProjectStandard = {
  id: 'api-design-standard',
  name: 'API Design Extended Standards',
  version: '1.0.0',
  category: 'api-design',
  description: 'Extended API design: RESTful patterns, versioning, pagination, error responses, HATEOAS.',
  rules: [
    {
      id: 'apides-ext-restful',
      description: 'Use RESTful resource naming (plural nouns)',
      checkType: 'regex',
      checkConfig: { pattern: '/(?:get|create|update|delete|fetch|remove)[A-Z]', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use HTTP methods with resource nouns: GET /users, POST /users, not GET /getUsers.',
    },
    {
      id: 'apides-ext-pagination',
      description: 'List endpoints must support pagination',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-pagination' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Add pagination to list endpoints: query params for page/limit or cursor-based.',
    },
    {
      id: 'apides-ext-error-response',
      description: 'Use consistent error response format',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'inconsistent-error-format' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use consistent error format: { error: { code, message, details? } }.',
    },
    {
      id: 'apides-ext-status-codes',
      description: 'Use correct HTTP status codes',
      checkType: 'regex',
      checkConfig: { pattern: 'res\\.status\\((?:200|201|204|400|401|403|404|409|422|429|500)\\)', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use appropriate HTTP status codes for different scenarios.',
    },
    {
      id: 'apides-ext-content-type',
      description: 'Set proper Content-Type headers',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-content-type' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Always set Content-Type header in API responses.',
    },
  ],
  examples: [
    {
      description: 'Proper RESTful paginated endpoint',
      compliant: true,
      code: "app.get('/api/v1/users', async (req, res) => {\n  const { page = 1, limit = 20 } = req.query;\n  const users = await userService.list({ page, limit });\n  res.json({ data: users, pagination: { page, limit, total: users.total } });\n});",
    },
  ],
};

/**
 * Configuration Management Standard — env vars, config files, secrets.
 */
const configurationManagement: ProjectStandard = {
  id: 'configuration-management',
  name: 'Configuration Management Standards',
  version: '1.0.0',
  category: 'code-style',
  description: 'Configuration management: environment variables, config files, secrets management.',
  rules: [
    {
      id: 'cfg-env-vars',
      description: 'Use environment variables for environment-specific configuration',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-env-config' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Move environment-specific configuration to environment variables.',
    },
    {
      id: 'cfg-no-hardcoded-config',
      description: 'No hardcoded configuration values (URLs, ports, timeouts)',
      checkType: 'regex',
      checkConfig: { pattern: '(?:const|let|var)\\s+\\w+\\s*=\\s*(?:\\d{4,5}|https?://\\S+)\\s*;', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Extract configuration values into config files or environment variables.',
    },
    {
      id: 'cfg-secrets-management',
      description: 'Use a secrets manager for sensitive configuration',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-secrets-manager' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault) for production secrets.',
    },
    {
      id: 'cfg-config-validation',
      description: 'Validate configuration at startup',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-config-validation' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Validate all required configuration at application startup with clear error messages.',
    },
    {
      id: 'cfg-no-secrets-in-vcs',
      description: 'No secrets in version control (.env committed, credentials in code)',
      checkType: 'regex',
      checkConfig: { pattern: '\\.env(?!\\.example$)', flags: 'g' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Add .env to .gitignore. Use .env.example with placeholder values for documentation.',
    },
  ],
  examples: [
    {
      description: 'Configuration from environment — compliant',
      compliant: true,
      code: 'const config = {\n  port: parseInt(process.env.PORT || "3000"),\n  dbUrl: process.env.DATABASE_URL,\n};\nif (!config.dbUrl) throw new Error("DATABASE_URL is required");',
    },
    {
      description: 'Hardcoded config — non-compliant',
      compliant: false,
      code: 'const dbUrl = "postgres://user:password@localhost:5432/mydb";',
      explanation: 'Database credentials hardcoded in source code.',
    },
  ],
};

// ===========================================================================
// NEW STANDARDS — Language-Specific (6)
// ===========================================================================

/**
 * TypeScript Best Practices Extended Standard.
 */
const typescriptBestPractices: ProjectStandard = {
  id: 'typescript-best-practices',
  name: 'TypeScript Best Practices Extended',
  version: '1.0.0',
  category: 'code-style',
  description: 'TypeScript best practices: strict mode, no `any`, proper null checks, enum usage, discriminated unions.',
  rules: [
    {
      id: 'tsbp-strict-mode',
      description: 'Enable strict mode in tsconfig.json',
      checkType: 'regex',
      checkConfig: { pattern: '"strict"\\s*:\\s*false', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Set "strict": true in tsconfig.json for comprehensive type checking.',
    },
    {
      id: 'tsbp-no-any',
      description: 'No `any` type usage',
      checkType: 'regex',
      checkConfig: { pattern: ':\\s*any\\b|as\\s+any\\b|<any>', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Replace `any` with `unknown`, specific types, or generics.',
    },
    {
      id: 'tsbp-null-checks',
      description: 'Use proper null/undefined checks with optional chaining and nullish coalescing',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-null-checks' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use optional chaining (?.) and nullish coalescing (??) for safe property access.',
    },
    {
      id: 'tsbp-enum-usage',
      description: 'Prefer const enums or union types over numeric enums',
      checkType: 'regex',
      checkConfig: { pattern: 'enum\\s+\\w+\\s*\\{', flags: 'g' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Consider using const enum or string union types instead of numeric enums.',
    },
    {
      id: 'tsbp-discriminated-unions',
      description: 'Use discriminated unions for state management',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prefer-discriminated-unions' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use discriminated unions with a `type` or `kind` field for exhaustive type narrowing.',
    },
    {
      id: 'tsbp-no-type-assertion',
      description: 'Avoid unsafe type assertions (as, !)',
      checkType: 'regex',
      checkConfig: { pattern: '\\bas\\s+\\w+(?:<[^>]*>)?\\s*(?:[;,\\)\\}])|!\\s*[;,\\)\\}]', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use type guards and proper type narrowing instead of type assertions.',
    },
  ],
  examples: [
    {
      description: 'Type-safe code with discriminated union — compliant',
      compliant: true,
      code: 'type Result<T> = { kind: "ok"; value: T } | { kind: "err"; error: Error };\n\nfunction handle<T>(result: Result<T>): T {\n  if (result.kind === "ok") return result.value;\n  throw result.error;\n}',
    },
    {
      description: 'Using `any` — non-compliant',
      compliant: false,
      code: 'function process(data: any): any {\n  return data.value;\n}',
      explanation: 'Uses `any` type which defeats TypeScript type checking.',
    },
  ],
};

/**
 * JavaScript Best Practices Standard.
 */
const javascriptBestPractices: ProjectStandard = {
  id: 'javascript-best-practices',
  name: 'JavaScript Best Practices',
  version: '1.0.0',
  category: 'code-style',
  description: 'JavaScript best practices: strict mode, const/let, template literals, arrow functions.',
  rules: [
    {
      id: 'jsbp-use-strict',
      description: 'Use strict mode in all modules',
      checkType: 'regex',
      checkConfig: { pattern: '^[\'"]use strict[\'"];?$', flags: 'gm' },
      severity: 'medium',
      autoFixable: false,
    },
    {
      id: 'jsbp-no-var',
      description: 'Use const/let instead of var',
      checkType: 'regex',
      checkConfig: { pattern: '\\bvar\\s+\\w+', flags: 'g' },
      severity: 'high',
      autoFixable: true,
      fixSuggestion: 'Replace `var` with `const` (preferred) or `let`.',
    },
    {
      id: 'jsbp-template-literals',
      description: 'Use template literals instead of string concatenation',
      checkType: 'regex',
      checkConfig: { pattern: '[\'"]\\s*\\+\\s*\\w+\\s*\\+\\s*[\'"]', flags: 'g' },
      severity: 'low',
      autoFixable: true,
      fixSuggestion: 'Use template literals: `Hello ${name}` instead of "Hello " + name.',
    },
    {
      id: 'jsbp-arrow-functions',
      description: 'Prefer arrow functions for callbacks and short functions',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prefer-arrow-functions' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use arrow functions for anonymous callbacks.',
    },
    {
      id: 'jsbp-destructuring',
      description: 'Use object/array destructuring for cleaner code',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prefer-destructuring' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use destructuring: const { name, age } = user; instead of const name = user.name;',
    },
    {
      id: 'jsbp-equality',
      description: 'Use === and !== instead of == and !=',
      checkType: 'regex',
      checkConfig: { pattern: '(?:[^=!])=[^=]|[^=!]!=[^=]', flags: 'g' },
      severity: 'high',
      autoFixable: true,
      fixSuggestion: 'Use strict equality (===) and strict inequality (!==) operators.',
    },
  ],
  examples: [
    {
      description: 'Modern JS — compliant',
      compliant: true,
      code: "'use strict';\nconst name = 'World';\nconst greet = (n) => `Hello, ${n}!`;\nconsole.log(greet(name));",
    },
    {
      description: 'Using var — non-compliant',
      compliant: false,
      code: "var name = 'World';\nconsole.log('Hello, ' + name + '!');",
      explanation: 'Uses `var` and string concatenation.',
    },
  ],
};

/**
 * Python PEP8 Extended Standard.
 */
const pythonPep8Extended: ProjectStandard = {
  id: 'python-pep8-extended',
  name: 'Python PEP8 Extended Standards',
  version: '1.0.0',
  category: 'code-style',
  description: 'Extended Python best practices: type hints, f-strings, context managers, walrus operator.',
  rules: [
    {
      id: 'pyext-type-hints',
      description: 'Use type hints for function signatures',
      checkType: 'regex',
      checkConfig: { pattern: 'def\\s+\\w+\\s*\\([^)]*\\)\\s*(?!->)', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add type hints to function parameters and return types.',
    },
    {
      id: 'pyext-fstrings',
      description: 'Use f-strings instead of .format() or % formatting',
      checkType: 'regex',
      checkConfig: { pattern: '(?:\\.format\\s*\\(|%\\s*\\()', flags: 'g' },
      severity: 'low',
      autoFixable: true,
      fixSuggestion: 'Use f-strings: f"Hello {name}" instead of "Hello {}".format(name).',
    },
    {
      id: 'pyext-context-managers',
      description: 'Use context managers (with) for resource management',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-context-manager' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use `with` statement for file handles, locks, and other resources.',
    },
    {
      id: 'pyext-walrus',
      description: 'Use walrus operator (:=) for assignment expressions where appropriate',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'walrus-opportunity' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Consider using the walrus operator (:=) for cleaner assignment-in-expression patterns.',
    },
    {
      id: 'pyext-list-comprehension',
      description: 'Use list/dict comprehensions instead of map/filter',
      checkType: 'regex',
      checkConfig: { pattern: '(?:map\\s*\\(|filter\\s*\\()\\s*lambda', flags: 'g' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use list comprehensions: [x*2 for x in items] instead of map(lambda x: x*2, items).',
    },
    {
      id: 'pyext-pathlib',
      description: 'Use pathlib instead of os.path for file path operations',
      checkType: 'regex',
      checkConfig: { pattern: 'os\\.path\\.(?:join|exists|isfile|isdir|basename|dirname)', flags: 'g' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use pathlib.Path for modern file path handling.',
    },
  ],
  examples: [
    {
      description: 'Modern Python — compliant',
      compliant: true,
      code: 'from pathlib import Path\n\ndef read_config(path: Path) -> dict[str, str]:\n    with path.open() as f:\n        return {k: v for line in f if (line := line.strip()) and not line.startswith("#") for k, _, v in [line.partition("=")]}',
    },
    {
      description: 'Old-style Python — non-compliant',
      compliant: false,
      code: 'import os\ndef read_config(path):\n    f = open(path)\n    result = {}\n    for line in f:\n        result[line.split("=")[0]] = line.split("=")[1]\n    f.close()\n    return result',
      explanation: 'Missing type hints, no context manager, using os.path.',
    },
  ],
};

/**
 * Go Idiomatic Extended Standard.
 */
const goIdiomaticExtended: ProjectStandard = {
  id: 'go-idiomatic-extended',
  name: 'Go Idiomatic Extended Standards',
  version: '1.0.0',
  category: 'code-style',
  description: 'Extended Go best practices: error wrapping, defer patterns, interface segregation.',
  rules: [
    {
      id: 'goext-error-wrap',
      description: 'Use fmt.Errorf with %w for error wrapping',
      checkType: 'regex',
      checkConfig: { pattern: 'fmt\\.Errorf\\([^)]*%v[^)]*err', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use %w verb for error wrapping: fmt.Errorf("context: %w", err).',
    },
    {
      id: 'goext-defer-close',
      description: 'Use defer for resource cleanup (files, connections)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-defer-close' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use `defer f.Close()` after opening resources.',
    },
    {
      id: 'goext-interface-segregation',
      description: 'Keep interfaces small (1-3 methods)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'large-interface' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Split large interfaces into smaller, focused interfaces.',
    },
    {
      id: 'goext-no-global-state',
      description: 'Avoid package-level global variables',
      checkType: 'regex',
      checkConfig: { pattern: '^var\\s+\\w+\\s+(?:\\*?\\w+|=)', flags: 'gm' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use dependency injection instead of package-level global state.',
    },
    {
      id: 'goext-context-propagation',
      description: 'Propagate context.Context through call chains',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-context-param' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Pass context.Context as the first parameter to functions that perform I/O.',
    },
  ],
  examples: [
    {
      description: 'Proper Go error wrapping — compliant',
      compliant: true,
      code: 'func GetUser(ctx context.Context, id string) (*User, error) {\n    user, err := db.FindUser(ctx, id)\n    if err != nil {\n        return nil, fmt.Errorf("GetUser: %w", err)\n    }\n    return user, nil\n}',
    },
  ],
};

/**
 * Rust Best Practices Standard.
 */
const rustBestPractices: ProjectStandard = {
  id: 'rust-best-practices',
  name: 'Rust Best Practices',
  version: '1.0.0',
  category: 'code-style',
  description: 'Rust best practices: ownership patterns, unsafe blocks, error handling, derive macros.',
  rules: [
    {
      id: 'rust-ownership',
      description: 'Prefer borrowing over cloning for read-only access',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'excessive-cloning' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use references (&T) instead of .clone() when ownership is not needed.',
    },
    {
      id: 'rust-unsafe-audit',
      description: 'Unsafe blocks must be justified with safety comments',
      checkType: 'regex',
      checkConfig: { pattern: 'unsafe\\s*\\{(?!\\s*//\\s*SAFETY)', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Add a // SAFETY: comment explaining why the unsafe block is sound.',
    },
    {
      id: 'rust-error-handling',
      description: 'Use Result and ? operator instead of unwrap/expect',
      checkType: 'regex',
      checkConfig: { pattern: '\\.(?:unwrap|expect)\\s*\\(', flags: 'g' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Use the ? operator or proper error handling instead of unwrap()/expect().',
    },
    {
      id: 'rust-derive-macros',
      description: 'Use derive macros for common trait implementations',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-derive-macros' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use #[derive(Debug, Clone, PartialEq)] instead of manual implementations.',
    },
    {
      id: 'rust-no-unwrap',
      description: 'Avoid .unwrap() in library code',
      checkType: 'regex',
      checkConfig: { pattern: '\\.unwrap\\s*\\(\\s*\\)', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use proper error propagation with Result and ? operator.',
    },
  ],
  examples: [
    {
      description: 'Safe Rust with proper error handling — compliant',
      compliant: true,
      code: 'fn read_config(path: &Path) -> Result<Config, io::Error> {\n    let content = std::fs::read_to_string(path)?;\n    let config: Config = serde_json::from_str(&content)?;\n    Ok(config)\n}',
    },
    {
      description: 'Using unwrap — non-compliant',
      compliant: false,
      code: 'fn read_config(path: &str) -> Config {\n    let content = std::fs::read_to_string(path).unwrap();\n    serde_json::from_str(&content).unwrap()\n}',
      explanation: 'Uses .unwrap() which panics on error.',
    },
  ],
};

/**
 * Java Best Practices Standard.
 */
const javaBestPractices: ProjectStandard = {
  id: 'java-best-practices',
  name: 'Java Best Practices',
  version: '1.0.0',
  category: 'code-style',
  description: 'Java best practices: streams over loops, Optional, records, sealed classes.',
  rules: [
    {
      id: 'java-streams',
      description: 'Prefer Streams API over imperative for loops for collection processing',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prefer-streams-over-loops' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use Streams API for filter/map/reduce operations on collections.',
    },
    {
      id: 'java-optional',
      description: 'Use Optional instead of null returns',
      checkType: 'regex',
      checkConfig: { pattern: 'return\\s+null\\s*;', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Return Optional<T> instead of null to make null-safety explicit.',
    },
    {
      id: 'java-records',
      description: 'Use records for simple data carriers (Java 14+)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prefer-records' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use record classes for immutable data transfer objects.',
    },
    {
      id: 'java-sealed-classes',
      description: 'Use sealed classes for restricted hierarchies (Java 17+)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prefer-sealed-classes' },
      severity: 'low',
      autoFixable: false,
      fixSuggestion: 'Use sealed classes/interfaces for controlled type hierarchies.',
    },
    {
      id: 'java-try-with-resources',
      description: 'Use try-with-resources for AutoCloseable resources',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-try-with-resources' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Use try-with-resources to automatically close resources.',
    },
  ],
  examples: [
    {
      description: 'Modern Java — compliant',
      compliant: true,
      code: 'public record User(String name, String email) {}\n\npublic Optional<User> findUser(String id) {\n    return users.stream()\n        .filter(u -> u.name().equals(id))\n        .findFirst();\n}',
    },
  ],
};

// ===========================================================================
// NEW STANDARDS — Architecture & Design (3)
// ===========================================================================

/**
 * Microservices Patterns Standard.
 */
const microservicesPatterns: ProjectStandard = {
  id: 'microservices-patterns',
  name: 'Microservices Patterns Standards',
  version: '1.0.0',
  category: 'architecture',
  description: 'Microservices patterns: service boundaries, circuit breakers, eventual consistency, idempotency.',
  rules: [
    {
      id: 'ms-service-boundaries',
      description: 'Services must have clearly defined bounded contexts',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'unclear-service-boundaries' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Define clear service boundaries following Domain-Driven Design principles.',
    },
    {
      id: 'ms-circuit-breaker',
      description: 'Implement circuit breaker pattern for external service calls',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-circuit-breaker' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Add circuit breaker (e.g., resilience4j, polly, gobreaker) to external service calls.',
    },
    {
      id: 'ms-eventual-consistency',
      description: 'Embrace eventual consistency with compensating transactions',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-saga-pattern' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use Saga pattern or compensating transactions for distributed operations.',
    },
    {
      id: 'ms-idempotency',
      description: 'API operations must be idempotent with idempotency keys',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-idempotency-key' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Implement idempotency keys for all mutating API operations.',
    },
    {
      id: 'ms-service-discovery',
      description: 'Use service discovery instead of hardcoded service URLs',
      checkType: 'regex',
      checkConfig: { pattern: 'https?://(?!localhost|127\\.0\\.0\\.1)[^/]+/api/', flags: 'g' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Use service discovery (Consul, Eureka, Kubernetes DNS) instead of hardcoded URLs.',
    },
    {
      id: 'ms-health-checks',
      description: 'All services must expose health check endpoints',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-health-check' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add /health and /ready endpoints for health checking and readiness probes.',
    },
  ],
  examples: [
    {
      description: 'Service with circuit breaker — compliant',
      compliant: true,
      code: 'const breaker = new CircuitBreaker(paymentService.process, {\n  timeout: 5000,\n  errorThresholdPercentage: 50,\n  resetTimeout: 30000,\n});\nconst result = await breaker.fire(payment);',
    },
  ],
};

/**
 * Event-Driven Architecture Standard.
 */
const eventDrivenArchitecture: ProjectStandard = {
  id: 'event-driven-architecture',
  name: 'Event-Driven Architecture Standards',
  version: '1.0.0',
  category: 'architecture',
  description: 'Event-driven architecture: event schemas, idempotency keys, dead letter queues.',
  rules: [
    {
      id: 'eda-event-schema',
      description: 'Events must have well-defined schemas with versioning',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-event-schema' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Define event schemas with version field and use schema registry.',
    },
    {
      id: 'eda-idempotency',
      description: 'Event handlers must be idempotent',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-idempotency' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Implement idempotency using event IDs or idempotency keys.',
    },
    {
      id: 'eda-dlq',
      description: 'Configure Dead Letter Queues for failed events',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-dlq' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Configure Dead Letter Queues for events that fail processing after retries.',
    },
    {
      id: 'eda-event-id',
      description: 'All events must have unique IDs and timestamps',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-event-metadata' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Include eventId, timestamp, and correlationId in all event envelopes.',
    },
    {
      id: 'eda-retry-strategy',
      description: 'Implement exponential backoff retry strategy',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-retry-strategy' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Configure exponential backoff with max retries for event processing.',
    },
  ],
  examples: [
    {
      description: 'Well-structured event — compliant',
      compliant: true,
      code: '{\n  "eventId": "evt_abc123",\n  "eventType": "order.created",\n  "version": "1.0",\n  "timestamp": "2024-01-01T00:00:00Z",\n  "correlationId": "corr_xyz789",\n  "payload": {\n    "orderId": "ord_456",\n    "amount": 99.99\n  }\n}',
    },
  ],
};

/**
 * Clean Architecture Standard.
 */
const cleanArchitecture: ProjectStandard = {
  id: 'clean-architecture',
  name: 'Clean Architecture Standards',
  version: '1.0.0',
  category: 'architecture',
  description: 'Clean Architecture: layer separation, dependency inversion, entities vs DTOs.',
  rules: [
    {
      id: 'ca-layer-separation',
      description: 'Separate code into layers: entities, use cases, interfaces, infrastructure',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-layer-separation' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Organize code into clear layers: domain, application, infrastructure, presentation.',
    },
    {
      id: 'ca-dependency-inversion',
      description: 'Dependencies must point inward (domain <- use cases <- infrastructure)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'dependency-inversion-violation' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Domain layer should not depend on infrastructure. Use interfaces for dependency inversion.',
    },
    {
      id: 'ca-entity-vs-dto',
      description: 'Separate domain entities from DTOs/data models',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'entity-dto-coupling' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Keep domain entities pure. Use separate DTOs for API contracts and database models.',
    },
    {
      id: 'ca-use-case-boundaries',
      description: 'Each use case should be a single, focused operation',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'large-use-case' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Split large use cases into smaller, focused operations following single responsibility.',
    },
    {
      id: 'ca-no-framework-leak',
      description: 'Domain layer must not depend on frameworks (Express, FastAPI, Spring)',
      checkType: 'regex',
      checkConfig: { pattern: 'import\\s+.*(?:express|fastapi|spring|django|flask|nestjs)', flags: 'gi' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Keep domain logic framework-agnostic. Use interfaces for framework integration.',
    },
  ],
  examples: [
    {
      description: 'Clean Architecture — compliant',
      compliant: true,
      code: '// domain/entities/user.ts\nclass User {\n  constructor(readonly id: string, readonly email: string) {}\n}\n\n// application/use-cases/create-user.ts\ninterface UserRepository {\n  save(user: User): Promise<void>;\n}\nclass CreateUserUseCase {\n  constructor(private repo: UserRepository) {}\n  async execute(email: string): Promise<User> {\n    const user = new User(generateId(), email);\n    await this.repo.save(user);\n    return user;\n  }\n}',
    },
  ],
};

// ===========================================================================
// NEW STANDARDS — AI/ML Specific (2)
// ===========================================================================

/**
 * ML Pipeline Best Practices Standard.
 */
const mlPipelineBestPractices: ProjectStandard = {
  id: 'ml-pipeline-best-practices',
  name: 'ML Pipeline Best Practices',
  version: '1.0.0',
  category: 'custom',
  description: 'ML pipeline best practices: data validation, model versioning, reproducibility, bias detection.',
  rules: [
    {
      id: 'ml-data-validation',
      description: 'Data pipelines must include validation steps (schema, distribution checks)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-data-validation' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Add data validation using Great Expectations, TFDV, or custom validation pipelines.',
    },
    {
      id: 'ml-model-versioning',
      description: 'Models must be versioned with metadata (training date, data hash, metrics)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-model-versioning' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Use MLflow, DVC, or W&B for model versioning and experiment tracking.',
    },
    {
      id: 'ml-reproducibility',
      description: 'Training must be reproducible (seed, dependencies, data snapshot)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'non-reproducible-training' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Set random seeds, pin dependencies, and version training data for reproducibility.',
    },
    {
      id: 'ml-bias-detection',
      description: 'Include bias and fairness evaluation in model assessment',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-bias-evaluation' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Add fairness metrics (demographic parity, equal opportunity) to model evaluation.',
    },
    {
      id: 'ml-feature-doc',
      description: 'Document feature definitions, transformations, and data sources',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-feature-documentation' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Maintain a feature registry documenting all features, their sources, and transformations.',
    },
    {
      id: 'ml-monitoring',
      description: 'Models in production must have monitoring (drift, performance, data quality)',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-model-monitoring' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Implement model monitoring for data drift, concept drift, and performance degradation.',
    },
  ],
  examples: [
    {
      description: 'ML pipeline with validation — compliant',
      compliant: true,
      code: '# Configured with Great Expectations\ncheckpoint = context.get_checkpoint("data_quality_check")\nvalidation_result = checkpoint.run(\n    batch_request=batch_request,\n    run_name="training_data_validation"\n)\nif not validation_result.success:\n    raise DataQualityError(validation_result.failures)',
    },
  ],
};

/**
 * AI Agent Code Patterns Standard.
 */
const aiAgentCodePatterns: ProjectStandard = {
  id: 'ai-agent-code-patterns',
  name: 'AI Agent Code Patterns',
  version: '1.0.0',
  category: 'custom',
  description: 'AI agent code patterns: MCP tool design, prompt engineering, tool safety.',
  rules: [
    {
      id: 'ai-tool-safety',
      description: 'AI tools must validate inputs and have safety boundaries',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-tool-safety' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Validate all tool inputs, set rate limits, and define clear safety boundaries.',
    },
    {
      id: 'ai-prompt-engineering',
      description: 'System prompts must be modular, versioned, and testable',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'unstructured-prompt' },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Structure prompts as modular templates with version tracking and A/B testing.',
    },
    {
      id: 'ai-tool-schema',
      description: 'MCP tools must have complete JSON schemas with descriptions',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'incomplete-tool-schema' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Define complete JSON schemas for all tool inputs with descriptions and constraints.',
    },
    {
      id: 'ai-error-graceful',
      description: 'AI agents must handle tool errors gracefully with clear messages',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-graceful-error' },
      severity: 'high',
      autoFixable: false,
      fixSuggestion: 'Implement graceful error handling with user-friendly error messages for tool failures.',
    },
    {
      id: 'ai-output-validation',
      description: 'AI-generated outputs must be validated before execution',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'missing-output-validation' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Validate all AI-generated outputs (code, commands, data) before execution.',
    },
    {
      id: 'ai-prompt-injection',
      description: 'Protect against prompt injection attacks',
      checkType: 'ast-pattern',
      checkConfig: { pattern: 'prompt-injection-vulnerability' },
      severity: 'critical',
      autoFixable: false,
      fixSuggestion: 'Sanitize user inputs in prompts. Use input/output separation and content filtering.',
    },
  ],
  examples: [
    {
      description: 'Safe tool definition — compliant',
      compliant: true,
      code: '{\n  "name": "execute_sql",\n  "description": "Execute a read-only SQL query against the database",\n  "inputSchema": {\n    "type": "object",\n    "properties": {\n      "query": { "type": "string", "description": "SQL SELECT query" }\n    },\n    "required": ["query"]\n  },\n  "safety": {\n    "readOnly": true,\n    "rateLimit": 10,\n    "validateInput": true\n  }\n}',
    },
  ],
};

/** Map of all built-in standard templates by ID. */
export const STANDARD_TEMPLATES: Record<string, ProjectStandard> = {
  'typescript-coding': typescriptCoding,
  'python-pep8': pythonPep8,
  'go-idiomatic': goIdiomatic,
  'security-baseline': securityBaseline,
  'security-essentials': securityEssentials,
  'api-design': apiDesign,
  'testing-standards': testingStandards,
  'error-handling': errorHandling,
  documentation,
  'architecture-layered': architectureLayered,
  'dependency-management': dependencyManagement,
  // Security (6)
  'owasp-top10': owaspTop10,
  'api-security': apiSecurity,
  'dependency-security': dependencySecurity,
  'container-security': containerSecurity,
  'data-privacy': dataPrivacy,
  // Quality & Reliability (5)
  'error-handling-standard': errorHandlingExtended,
  'testing-standard': testingExtended,
  'logging-standard': loggingStandard,
  'api-design-standard': apiDesignExtended,
  'configuration-management': configurationManagement,
  // Language-Specific (6)
  'typescript-best-practices': typescriptBestPractices,
  'javascript-best-practices': javascriptBestPractices,
  'python-pep8-extended': pythonPep8Extended,
  'go-idiomatic-extended': goIdiomaticExtended,
  'rust-best-practices': rustBestPractices,
  'java-best-practices': javaBestPractices,
  // Architecture & Design (3)
  'microservices-patterns': microservicesPatterns,
  'event-driven-architecture': eventDrivenArchitecture,
  'clean-architecture': cleanArchitecture,
  // AI/ML Specific (2)
  'ml-pipeline-best-practices': mlPipelineBestPractices,
  'ai-agent-code-patterns': aiAgentCodePatterns,
};

/** Get a standard template by ID. */
export function getTemplate(id: string): ProjectStandard | undefined {
  return STANDARD_TEMPLATES[id];
}

/** List all available standard template descriptors. */
export function listTemplates(): StandardTemplate[] {
  return [
    {
      id: 'typescript-coding',
      name: 'TypeScript Coding Standards',
      category: 'code-style',
      description: 'TypeScript conventions: function size, naming, type safety.',
      language: 'typescript',
    },
    {
      id: 'python-pep8',
      name: 'Python PEP8 Standards',
      category: 'code-style',
      description: 'Python PEP8 conventions: function size, naming, documentation.',
      language: 'python',
    },
    {
      id: 'go-idiomatic',
      name: 'Go Idiomatic Standards',
      category: 'code-style',
      description: 'Go conventions: function size, exports, error handling.',
      language: 'go',
    },
    {
      id: 'security-baseline',
      name: 'Security Baseline',
      category: 'security',
      description: 'Security best practices for all languages.',
      language: 'any',
    },
    {
      id: 'security-essentials',
      name: 'Security Essentials',
      category: 'security',
      description: 'Comprehensive security checks: SQL injection, hardcoded secrets, input validation, path traversal, CSRF, XSS.',
      language: 'any',
    },
    {
      id: 'api-design',
      name: 'API Design Standards',
      category: 'api-design',
      description: 'RESTful API design conventions.',
      language: 'any',
    },
    {
      id: 'testing-standards',
      name: 'Testing Standards',
      category: 'testing',
      description: 'Testing conventions: naming, AAA pattern, independence.',
      language: 'any',
    },
    {
      id: 'error-handling',
      name: 'Error Handling Standards',
      category: 'error-handling',
      description: 'Error handling: try/catch, propagation, logging.',
      language: 'any',
    },
    {
      id: 'documentation',
      name: 'Documentation Standards',
      category: 'documentation',
      description: 'Documentation: JSDoc, README, changelog.',
      language: 'any',
    },
    {
      id: 'architecture-layered',
      name: 'Architecture Layered Standards',
      category: 'architecture',
      description: 'Architecture: layer boundaries, circular deps.',
      language: 'any',
    },
    {
      id: 'dependency-management',
      name: 'Dependency Management Standards',
      category: 'dependency',
      description: 'Dependencies: version pinning, licenses, unused deps.',
      language: 'any',
    },
    // Security (6)
    {
      id: 'owasp-top10',
      name: 'OWASP Top 10 Standards',
      category: 'security',
      description: 'Checks covering OWASP Top 10: injection, broken auth, sensitive data exposure, XXE, broken access control, security misconfig, XSS, insecure deserialization, vulnerable components, insufficient logging.',
      language: 'any',
    },
    {
      id: 'api-security',
      name: 'API Security Standards',
      category: 'security',
      description: 'API key exposure, rate limiting, auth middleware, CORS configuration, input validation.',
      language: 'any',
    },
    {
      id: 'dependency-security',
      name: 'Dependency Security Standards',
      category: 'security',
      description: 'Known vulnerable dependency patterns, unpinned versions.',
      language: 'any',
    },
    {
      id: 'container-security',
      name: 'Container Security Standards',
      category: 'security',
      description: 'Dockerfile best practices: non-root user, COPY not ADD, specific tags.',
      language: 'any',
    },
    {
      id: 'data-privacy',
      name: 'Data Privacy Standards',
      category: 'security',
      description: 'PII detection patterns, data encryption, GDPR/data protection patterns.',
      language: 'any',
    },
    // Quality & Reliability (5)
    {
      id: 'error-handling-standard',
      name: 'Error Handling Extended Standards',
      category: 'error-handling',
      description: 'Comprehensive error handling: try-catch patterns, error propagation, custom error types.',
      language: 'any',
    },
    {
      id: 'testing-standard',
      name: 'Testing Extended Standards',
      category: 'testing',
      description: 'Test file detection, test naming conventions, coverage patterns.',
      language: 'any',
    },
    {
      id: 'logging-standard',
      name: 'Logging Standards',
      category: 'code-style',
      description: 'Structured logging, log levels, no console.log in production.',
      language: 'any',
    },
    {
      id: 'api-design-standard',
      name: 'API Design Extended Standards',
      category: 'api-design',
      description: 'RESTful patterns, versioning, pagination, error responses.',
      language: 'any',
    },
    {
      id: 'configuration-management',
      name: 'Configuration Management Standards',
      category: 'code-style',
      description: 'Environment variables, config files, secrets management.',
      language: 'any',
    },
    // Language-Specific (6)
    {
      id: 'typescript-best-practices',
      name: 'TypeScript Best Practices Extended',
      category: 'code-style',
      description: 'TypeScript: strict mode, no any, proper null checks, enum usage.',
      language: 'typescript',
    },
    {
      id: 'javascript-best-practices',
      name: 'JavaScript Best Practices',
      category: 'code-style',
      description: 'JavaScript: strict mode, const/let, template literals, arrow functions.',
      language: 'javascript',
    },
    {
      id: 'python-pep8-extended',
      name: 'Python PEP8 Extended Standards',
      category: 'code-style',
      description: 'Extended Python: type hints, f-strings, context managers, walrus operator.',
      language: 'python',
    },
    {
      id: 'go-idiomatic-extended',
      name: 'Go Idiomatic Extended Standards',
      category: 'code-style',
      description: 'Extended Go: error wrapping, defer patterns, interface segregation.',
      language: 'go',
    },
    {
      id: 'rust-best-practices',
      name: 'Rust Best Practices',
      category: 'code-style',
      description: 'Rust: ownership patterns, unsafe blocks, error handling, derive macros.',
      language: 'rust',
    },
    {
      id: 'java-best-practices',
      name: 'Java Best Practices',
      category: 'code-style',
      description: 'Java: streams over loops, Optional, records, sealed classes.',
      language: 'java',
    },
    // Architecture & Design (3)
    {
      id: 'microservices-patterns',
      name: 'Microservices Patterns Standards',
      category: 'architecture',
      description: 'Service boundaries, circuit breakers, eventual consistency, idempotency.',
      language: 'any',
    },
    {
      id: 'event-driven-architecture',
      name: 'Event-Driven Architecture Standards',
      category: 'architecture',
      description: 'Event schemas, idempotency keys, dead letter queues.',
      language: 'any',
    },
    {
      id: 'clean-architecture',
      name: 'Clean Architecture Standards',
      category: 'architecture',
      description: 'Layer separation, dependency inversion, entities vs DTOs.',
      language: 'any',
    },
    // AI/ML Specific (2)
    {
      id: 'ml-pipeline-best-practices',
      name: 'ML Pipeline Best Practices',
      category: 'custom',
      description: 'Data validation, model versioning, reproducibility, bias detection patterns.',
      language: 'any',
    },
    {
      id: 'ai-agent-code-patterns',
      name: 'AI Agent Code Patterns',
      category: 'custom',
      description: 'MCP tool design, prompt engineering patterns, tool safety.',
      language: 'any',
    },
  ];
}
