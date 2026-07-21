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
      description:
        'Comprehensive security checks: SQL injection, hardcoded secrets, input validation, path traversal, CSRF, XSS.',
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
  ];
}
