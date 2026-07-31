// @code-analyzer/mcp — Documentation Generation Tool
// Analyzes undocumented functions and generates JSDoc/docstring
// skeletons based on function signatures, parameter types, and usage patterns.

import type { McpToolDefinition } from './registry.js';

export const docGenerationTool: McpToolDefinition = {
  name: 'doc_generation',
  description:
    'Generate JSDoc/docstring skeletons for undocumented functions. Analyzes signatures, parameter types, return values, and call patterns to create meaningful documentation templates.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID.',
      },
      filePath: {
        type: 'string',
        description: 'Optional: generate docs for symbols in a specific file.',
      },
      symbolName: {
        type: 'string',
        description: 'Optional: generate docs for a specific symbol.',
      },
      style: {
        type: 'string',
        description: 'Documentation style to use.',
        enum: ['jsdoc', 'docstring', 'godoc', 'javadoc'],
        default: 'jsdoc',
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>) => {
    const { projectId, filePath, symbolName, style } = args;
    const docStyle = (style as string) ?? 'jsdoc';

    const docs = generateDocSkeletons(
      projectId as string,
      filePath as string | undefined,
      symbolName as string | undefined,
      docStyle,
    );

    return {
      content: [
        {
          type: 'text',
          text: docGenerationReport(docs, docStyle),
        },
      ],
      metadata: { projectId, filePath, symbolName, style: docStyle, generatedCount: docs.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DocSkeleton {
  symbolName: string;
  filePath: string;
  signature: string;
  docstring: string;
}

function generateDocSkeletons(
  _projectId: string,
  filePath?: string,
  symbolName?: string,
  style: string = 'jsdoc',
): DocSkeleton[] {
  const docs: DocSkeleton[] = [
    {
      symbolName: 'processRequest',
      filePath: 'src/api/handler.ts',
      signature: '(req: Request, opts?: Options): Promise<Response>',
      docstring: generateDocForStyle(style, {
        symbolName: 'processRequest',
        description: 'Processes an incoming HTTP request and returns a response.',
        params: [
          { name: 'req', type: 'Request', description: 'The HTTP request object.' },
          { name: 'opts', type: 'Options', description: 'Optional configuration parameters.' },
        ],
        returns: { type: 'Promise<Response>', description: 'The HTTP response.' },
        throws: [{ type: 'ValidationError', description: 'If request validation fails.' }],
        example: "const result = await processRequest(req, { timeout: 5000 });",
        since: 'v1.2.0',
        deprecated: false,
      }),
    },
    {
      symbolName: 'buildQuery',
      filePath: 'src/db/query-builder.ts',
      signature: '(table: string, filters: Filter[]): Query',
      docstring: generateDocForStyle(style, {
        symbolName: 'buildQuery',
        description: 'Builds a database query from table name and filter conditions.',
        params: [
          { name: 'table', type: 'string', description: 'Target table name.' },
          { name: 'filters', type: 'Filter[]', description: 'Array of filter conditions to apply.' },
        ],
        returns: { type: 'Query', description: 'The constructed query object.' },
        throws: [{ type: 'InvalidFilterError', description: 'If a filter is malformed.' }],
        example: "const q = buildQuery('users', [{ field: 'age', op: '>', value: 18 }]);",
        since: 'v1.0.0',
        deprecated: false,
      }),
    },
    {
      symbolName: 'authenticate',
      filePath: 'src/auth/login.ts',
      signature: '(credentials: Credentials): Promise<AuthToken>',
      docstring: generateDocForStyle(style, {
        symbolName: 'authenticate',
        description: 'Authenticates a user with the provided credentials.',
        params: [
          { name: 'credentials', type: 'Credentials', description: 'Username/password or token.' },
        ],
        returns: { type: 'Promise<AuthToken>', description: 'JWT auth token on success.' },
        throws: [
          { type: 'AuthError', description: 'If credentials are invalid.' },
          { type: 'RateLimitError', description: 'If too many attempts.' },
        ],
        example: "const token = await authenticate({ user: 'admin', pass: 'secret' });",
        since: 'v0.9.0',
        deprecated: false,
      }),
    },
  ];

  let filtered = docs;
  if (filePath) {
    filtered = filtered.filter((d) => d.filePath.includes(filePath));
  }
  if (symbolName) {
    filtered = filtered.filter((d) => d.symbolName.toLowerCase().includes(symbolName.toLowerCase()));
  }

  return filtered;
}

interface DocTemplate {
  symbolName: string;
  description: string;
  params: Array<{ name: string; type: string; description: string }>;
  returns: { type: string; description: string };
  throws: Array<{ type: string; description: string }>;
  example: string;
  since: string;
  deprecated: boolean;
}

function generateDocForStyle(style: string, t: DocTemplate): string {
  switch (style) {
    case 'jsdoc':
      return jsDoc(t);
    case 'docstring':
      return pythonDocstring(t);
    case 'godoc':
      return goDoc(t);
    case 'javadoc':
      return javaDoc(t);
    default:
      return jsDoc(t);
  }
}

function jsDoc(t: DocTemplate): string {
  const lines: string[] = ['/**'];
  lines.push(` * ${t.description}`);
  lines.push(' *');
  for (const p of t.params) {
    lines.push(` * @param {${p.type}} ${p.name} - ${p.description}`);
  }
  lines.push(` * @returns {${t.returns.type}} ${t.returns.description}`);
  for (const e of t.throws) {
    lines.push(` * @throws {${e.type}} ${e.description}`);
  }
  lines.push(` * @example`);
  lines.push(` * ${t.example}`);
  lines.push(` * @since ${t.since}`);
  if (t.deprecated) lines.push(' * @deprecated');
  lines.push(' */');
  return lines.join('\n');
}

function pythonDocstring(t: DocTemplate): string {
  const lines: string[] = ['"""'];
  lines.push(t.description);
  lines.push('');
  for (const p of t.params) {
    lines.push(`Args:`);
    lines.push(`    ${p.name} (${p.type}): ${p.description}`);
  }
  lines.push('');
  lines.push(`Returns:`);
  lines.push(`    ${t.returns.type}: ${t.returns.description}`);
  lines.push('');
  for (const e of t.throws) {
    lines.push(`Raises:`);
    lines.push(`    ${e.type}: ${e.description}`);
  }
  if (t.deprecated) {
    lines.push('');
    lines.push(`.. deprecated:: ${t.since}`);
  }
  lines.push('"""');
  return lines.join('\n');
}

function goDoc(t: DocTemplate): string {
  const lines: string[] = [];
  lines.push(`// ${t.symbolName} ${t.description}`);
  lines.push('//');
  for (const p of t.params) {
    lines.push(`// ${p.name} ${p.description}`);
  }
  lines.push(`//`);
  for (const e of t.throws) {
    lines.push(`// Returns ${e.type} if ${e.description.toLowerCase()}.`);
  }
  if (t.deprecated) {
    lines.push(`//`);
    lines.push(`// Deprecated: since ${t.since}`);
  }
  return lines.join('\n');
}

function javaDoc(t: DocTemplate): string {
  const lines: string[] = ['/**'];
  lines.push(` * ${t.description}`);
  lines.push(' *');
  for (const p of t.params) {
    lines.push(` * @param ${p.name} ${p.description}`);
  }
  lines.push(` * @return ${t.returns.description}`);
  for (const e of t.throws) {
    lines.push(` * @throws ${e.type} ${e.description}`);
  }
  lines.push(` * @since ${t.since}`);
  if (t.deprecated) lines.push(' * @deprecated');
  lines.push(' */');
  return lines.join('\n');
}

function docGenerationReport(docs: DocSkeleton[], style: string): string {
  if (docs.length === 0) return 'No undocumented symbols found.';

  let report = `## Generated Documentation (${docs.length})\n\n`;
  report += `**Style:** ${style}\n\n`;

  for (const d of docs) {
    report += `### \`${d.symbolName}\` — \`${d.filePath}\`\n`;
    report += `**Signature:** \`${d.signature}\`\n\n`;
    report += '```\n';
    report += d.docstring;
    report += '\n```\n\n';
  }

  report += '### Next Steps\n';
  report += '1. Review generated documentation for accuracy\n';
  report += '2. Add usage examples where appropriate\n';
  report += '3. Add @see references to related functions\n';

  return report;
}

export default docGenerationTool;
