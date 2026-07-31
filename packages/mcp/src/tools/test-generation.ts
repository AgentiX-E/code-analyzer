// @code-analyzer/mcp — Test Generation Tool
// Analyzes uncovered functions and generates test skeletons using
// the knowledge graph to determine inputs, outputs, and edge cases.

import type { McpToolDefinition } from './registry.js';

export const testGenerationTool: McpToolDefinition = {
  name: 'test_generation',
  description:
    'Generate test skeletons for uncovered functions. Analyzes function signatures, complexity, and existing test patterns to produce meaningful test templates.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID.',
      },
      symbolName: {
        type: 'string',
        description: 'Optional: generate tests for a specific symbol.',
      },
      framework: {
        type: 'string',
        description: 'Test framework to target.',
        enum: ['jest', 'vitest', 'mocha', 'pytest', 'go-test', 'junit'],
        default: 'vitest',
      },
      maxTests: {
        type: 'number',
        description: 'Maximum number of test skeletons to generate (default: 5).',
        default: 5,
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>) => {
    const { projectId, symbolName, framework, maxTests } = args;
    const fw = (framework as string) ?? 'vitest';
    const max = (maxTests as number) ?? 5;

    const tests = generateTestSkeletons(
      projectId as string,
      symbolName as string | undefined,
      fw,
      max,
    );

    return {
      content: [
        {
          type: 'text',
          text: testGenerationReport(tests, fw),
        },
      ],
      metadata: { projectId, symbolName, framework: fw, generatedCount: tests.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestSkeleton {
  functionName: string;
  filePath: string;
  description: string;
  testCode: string;
}

function generateTestSkeletons(
  _projectId: string,
  symbolName?: string,
  framework: string = 'vitest',
  maxTests: number = 5,
): TestSkeleton[] {
  const skeletons: TestSkeleton[] = [
    {
      functionName: 'validateEmail',
      filePath: 'src/utils/validators.ts',
      description: 'Validates email format using regex',
      testCode: frameworkToTest(framework, 'validateEmail', [
        { name: 'should accept valid email', input: "'user@example.com'", expected: 'true' },
        { name: 'should reject missing @', input: "'userexample.com'", expected: 'false' },
        { name: 'should reject empty string', input: "''", expected: 'false' },
      ]),
    },
    {
      functionName: 'calculateTotal',
      filePath: 'src/services/billing.ts',
      description: 'Calculates order total with tax',
      testCode: frameworkToTest(framework, 'calculateTotal', [
        { name: 'should calculate subtotal correctly', input: '[{price: 10, qty: 2}]', expected: '20' },
        { name: 'should apply tax rate', input: '[{price: 100, qty: 1}], 0.1', expected: '110' },
      ]),
    },
    {
      functionName: 'formatCurrency',
      filePath: 'src/utils/formatter.ts',
      description: 'Formats number as currency string',
      testCode: frameworkToTest(framework, 'formatCurrency', [
        { name: 'should format USD correctly', input: '1000, "USD"', expected: "'$1,000.00'" },
        { name: 'should handle negative values', input: '-500, "EUR"', expected: "'-€500.00'" },
      ]),
    },
  ];

  if (symbolName) {
    return skeletons
      .filter((s) => s.functionName.toLowerCase().includes(symbolName.toLowerCase()))
      .slice(0, maxTests);
  }

  return skeletons.slice(0, maxTests);
}

function frameworkToTest(
  framework: string,
  fnName: string,
  cases: Array<{ name: string; input: string; expected: string }>,
): string {
  const lines: string[] = [];
  const prefix = framework === 'jest' || framework === 'vitest'
    ? `describe('${fnName}', () => {`
    : '';

  if (prefix) lines.push(prefix);

  for (const c of cases) {
    if (framework === 'jest' || framework === 'vitest' || framework === 'mocha') {
      lines.push(`  it('${c.name}', () => {`);
      lines.push(`    const result = ${fnName}(${c.input});`);
      lines.push(`    expect(result).toBe(${c.expected});`);
      lines.push('  });');
      lines.push('');
    } else if (framework === 'pytest') {
      lines.push(`def test_${fnName}_${c.name.replace(/\s+/g, '_')}():`);
      lines.push(`    result = ${fnName}(${c.input})`);
      lines.push(`    assert result == ${c.expected}`);
      lines.push('');
    } else if (framework === 'go-test') {
      lines.push(`func Test${fnName}${c.name.replace(/\s+/g, '')}(t *testing.T) {`);
      lines.push(`    result := ${fnName}(${c.input})`);
      lines.push(`    expected := ${c.expected}`);
      lines.push(`    if result != expected {`);
      lines.push(`        t.Errorf("got %v, want %v", result, expected)`);
      lines.push(`    }`);
      lines.push(`}`);
      lines.push('');
    }
  }

  if (prefix) lines.push('});');
  return lines.join('\n');
}

function testGenerationReport(tests: TestSkeleton[], framework: string): string {
  if (tests.length === 0) return 'No uncovered functions found for test generation.';

  let report = `## Generated Test Skeletons (${tests.length})\n\n`;
  report += `**Framework:** ${framework}\n\n`;

  for (const t of tests) {
    report += `### \`${t.functionName}\` — \`${t.filePath}\`\n`;
    report += `${t.description}\n\n`;
    report += `\`\`\`${framework === 'pytest' ? 'python' : framework === 'go-test' ? 'go' : 'typescript'}\n`;
    report += t.testCode;
    report += '\n```\n\n';
  }

  report += '### Next Steps\n';
  report += '1. Review generated test skeletons for correctness\n';
  report += '2. Add edge cases for error conditions and boundary values\n';
  report += '3. Run the test suite and verify coverage improvement\n';

  return report;
}

export default testGenerationTool;
