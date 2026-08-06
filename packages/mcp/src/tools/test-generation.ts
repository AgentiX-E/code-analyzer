// @code-analyzer/mcp — Test Generation Tool
// Analyzes function/method symbols in the knowledge graph and generates
// test skeleton templates based on their signatures and dependencies.

import type { McpToolDefinition, ToolResult } from './registry.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from './tool-context.js';

export const testGenerationTool: McpToolDefinition = {
  name: 'test_generation',
  description:
    'Generate test skeletons for functions and methods based on knowledge graph analysis — includes dependency mocking stubs and edge case suggestions.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to analyze.',
      },
      symbolName: {
        type: 'string',
        description: 'Optional: generate tests for a specific symbol (by name).',
      },
      filePath: {
        type: 'string',
        description: 'Optional: limit to symbols in a specific file.',
      },
      framework: {
        type: 'string',
        description: 'Target test framework: jest, vitest, mocha, pytest, or go-test.',
        enum: ['jest', 'vitest', 'mocha', 'pytest', 'go-test'],
        default: 'vitest',
      },
      maxTests: {
        type: 'number',
        description: 'Maximum number of test skeletons to generate (default: 10).',
        default: 10,
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>, storeOrContext?: unknown): Promise<ToolResult> => {
    const { projectId, symbolName, filePath, framework, maxTests } = args;
    const fw = (framework as string) ?? 'vitest';
    const max = (maxTests as number) ?? 10;
    const store = ToolContextImpl.getStore(storeOrContext);

    if (!store) {
      return {
        content: [{ type: 'text', text: 'No graph store available. Index a project first.' }],
        isError: true,
      };
    }

    const projectIdStr = projectId as string;
    let nodes = store.getAllNodes().filter(
      (n) => n.projectId === projectIdStr && isTestableNode(n.label),
    );

    if (symbolName) {
      nodes = nodes.filter((n) => n.name === (symbolName as string));
    }
    if (filePath) {
      nodes = nodes.filter((n) => n.filePath === (filePath as string));
    }

    if (nodes.length === 0) {
      return {
        content: [{ type: 'text', text: `No testable symbols found for project "${projectIdStr}". Index the project first.` }],
        metadata: { projectId: projectIdStr },
      };
    }

    const skeletons = generateTestSkeletons(store, nodes.slice(0, max), fw);

    return {
      content: [{ type: 'text', text: formatSkeletons(skeletons, projectIdStr, fw) }],
      metadata: { projectId: projectIdStr, skeletonCount: skeletons.length, framework: fw },
    };
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestSkeleton {
  functionName: string;
  filePath: string;
  language: string;
  dependencies: string[];
  testCode: string;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

function isTestableNode(label: string): boolean {
  return label === 'Function' || label === 'Method';
}

// ---------------------------------------------------------------------------
// Test skeleton generation from real graph data
// ---------------------------------------------------------------------------

function generateTestSkeletons(
  store: InMemoryGraphStore,
  nodes: import('@code-analyzer/shared').GraphNode[],
  framework: string,
): TestSkeleton[] {
  const skeletons: TestSkeleton[] = [];

  for (const node of nodes) {
    // Detect language from file extension
    const ext = node.filePath ? node.filePath.split('.').pop()?.toLowerCase() : '';
    const language = ext === 'ts' || ext === 'tsx' ? 'typescript'
      : ext === 'js' || ext === 'jsx' ? 'javascript'
      : ext === 'py' ? 'python'
      : ext === 'go' ? 'go'
      : 'typescript';

    // Get dependencies (called symbols)
    const outgoingEdges = store.getEdgesForNode(node.id, 'CALLS', 'out');
    const dependencies: string[] = [];

    for (const edge of outgoingEdges.slice(0, 5)) {
      const targetNode = store.getNode(edge.targetId);
      if (targetNode && targetNode.name !== node.name) {
        dependencies.push(targetNode.name);
      }
    }

    const testCode = generateTestCode(node.name, language, dependencies, framework);

    skeletons.push({
      functionName: node.name,
      filePath: node.filePath ?? '<unknown>',
      language,
      dependencies,
      testCode,
    });
  }

  return skeletons;
}

// ---------------------------------------------------------------------------
// Test code generation per framework and language
// ---------------------------------------------------------------------------

function generateTestCode(
  functionName: string,
  language: string,
  dependencies: string[],
  framework: string,
): string {
  const safeName = functionName.replace(/[^a-zA-Z0-9_]/g, '_');

  if (language === 'typescript' || language === 'javascript') {
    return generateTSTestCode(safeName, functionName, dependencies, framework);
  }
  if (language === 'python') {
    return generatePythonTestCode(safeName, functionName, dependencies);
  }
  if (language === 'go') {
    return generateGoTestCode(safeName, functionName, dependencies);
  }
  return generateTSTestCode(safeName, functionName, dependencies, 'vitest');
}

function generateTSTestCode(
  _safeName: string,
  originalName: string,
  dependencies: string[],
  framework: string,
): string {
  const describe = framework === 'jest' || framework === 'vitest' ? 'describe' : 'suite';
  const it = framework === 'jest' || framework === 'vitest' ? 'it' : 'test';
  const expect = framework === 'jest' || framework === 'vitest' ? 'expect' : 'assert';

  let code = `// Test skeleton for: ${originalName}\n`;
  code += `// Generated by Code Analyzer — test_generation tool\n\n`;

  // Mock dependencies
  if (dependencies.length > 0) {
    if (framework === 'vitest' || framework === 'jest') {
      for (const dep of dependencies) {
        code += `vi.mock('${dep}');\n`;
      }
      code += '\n';
    }
  }

  code += `${describe}('${originalName}', () => {\n`;
  code += `  ${it}('should return expected output for valid input', () => {\n`;
  code += `    // Arrange — prepare input parameters and mock dependencies\n`;
  code += `    // const result = ${originalName}(/* TODO: provide valid arguments */);\n\n`;
  code += `    // Assert — verify the output\n`;
  code += `    // ${expect}(result).toBeDefined();\n`;
  code += `  });\n\n`;

  code += `  ${it}('should handle edge case: empty input', () => {\n`;
  code += `    // Test with empty/null/undefined inputs\n`;
  code += `    // const result = ${originalName}(/* empty input */);\n`;
  code += `    // ${expect}(result).toBeDefined();\n`;
  code += `  });\n\n`;

  code += `  ${it}('should handle edge case: invalid input', () => {\n`;
  code += `    // Test with wrong-type inputs\n`;
  code += `    // ${expect}(() => ${originalName}(/* invalid input */)).toThrow();\n`;
  code += `  });\n`;

  if (dependencies.length > 0) {
    code += '\n';
    code += `  ${it}('should handle dependency failure gracefully', () => {\n`;
    code += `    // Test with mocked dependency throwing an error\n`;
    code += `    // ${expect}(() => ${originalName}(/* valid args */)).not.toThrow();\n`;
    code += `  });\n`;
  }

  code += `});\n`;

  return code;
}

function generatePythonTestCode(
  safeName: string,
  originalName: string,
  dependencies: string[],
): string {
  let code = `# Test skeleton for: ${originalName}\n`;
  code += `# Generated by Code Analyzer — test_generation tool\n\n`;
  code += `import pytest\n`;

  if (dependencies.length > 0) {
    code += `from unittest.mock import patch, MagicMock\n\n`;
  }

  code += `class Test${safeName.charAt(0).toUpperCase() + safeName.slice(1)}:\n`;
  code += `    def test_valid_input(self):\n`;
  code += `        """Test that the function returns expected output for valid input."""\n`;
  code += `        # result = ${originalName}(  # TODO: provide valid arguments\n`;
  code += `        # )\n`;
  code += `        # assert result is not None\n`;
  code += `        pass\n\n`;

  code += `    def test_empty_input(self):\n`;
  code += `        """Test behavior with empty/null inputs."""\n`;
  code += `        # result = ${originalName}()\n`;
  code += `        # assert result is not None\n`;
  code += `        pass\n\n`;

  code += `    def test_invalid_input_raises(self):\n`;
  code += `        """Test that invalid input raises appropriate exception."""\n`;
  code += `        # with pytest.raises(ValueError):\n`;
  code += `        #     ${originalName}(None)\n`;
  code += `        pass\n\n`;

  if (dependencies.length > 0) {
    code += `    def test_dependency_failure(self):\n`;
    code += `        """Test graceful handling of dependency failures."""\n`;
    code += `        # with patch('${dependencies[0]}') as mock_dep:\n`;
    code += `        #     mock_dep.side_effect = Exception('Mock failure')\n`;
    code += `        #     # Verify the function handles this gracefully\n`;
    code += `        pass\n`;
  }

  return code;
}

function generateGoTestCode(
  safeName: string,
  originalName: string,
  dependencies: string[],
): string {
  let code = `// Test skeleton for: ${originalName}\n`;
  code += `// Generated by Code Analyzer — test_generation tool\n\n`;
  code += `package main\n\n`;
  code += `import "testing"\n\n`;

  code += `func Test${safeName.charAt(0).toUpperCase() + safeName.slice(1)}(t *testing.T) {\n`;
  code += `\tt.Run("valid input", func(t *testing.T) {\n`;
  code += `\t\t// result := ${originalName}(/* TODO: provide valid arguments */)\n`;
  code += `\t\t// if result == nil {\n`;
  code += `\t\t// \tt.Error("expected non-nil result")\n`;
  code += `\t\t// }\n`;
  code += `\t})\n\n`;

  code += `\tt.Run("empty input", func(t *testing.T) {\n`;
  code += `\t\t// Test behavior with zero values\n`;
  code += `\t})\n\n`;

  code += `\tt.Run("invalid input", func(t *testing.T) {\n`;
  code += `\t\t// Test that invalid input is handled gracefully\n`;
  code += `\t})\n`;

  if (dependencies.length > 0) {
    code += `\n`;
    code += `\tt.Run("dependency failure", func(t *testing.T) {\n`;
    code += `\t\t// Test graceful handling when dependencies fail\n`;
    code += `\t\t// Mock or inject failing ${dependencies[0]}\n`;
    code += `\t})\n`;
  }

  code += `}\n`;

  return code;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatSkeletons(skeletons: TestSkeleton[], projectId: string, framework: string): string {
  if (skeletons.length === 0) {
    return `## Test Generation — ${projectId}\n\nNo testable symbols found.\n`;
  }

  let report = `## Test Generation — ${projectId}\n\n`;
  report += `**Framework**: ${framework} | **Skeletons**: ${skeletons.length}\n\n`;
  report += `> Below are test skeletons generated from knowledge graph data.\n`;
  report += `> TODO markers indicate where you need to fill in actual test values.\n`;
  report += `> Dependencies listed are those detected via CALLS edges in the graph.\n\n`;

  for (const sk of skeletons) {
    const depInfo = sk.dependencies.length > 0
      ? ` | **Dependencies**: ${sk.dependencies.join(', ')}`
      : '';
    report += `### \`${sk.functionName}\` — ${sk.language}${depInfo}\n\n`;
    report += '```' + (sk.language === 'typescript' ? 'typescript' : sk.language) + '\n';
    report += sk.testCode;
    report += '```\n\n';
  }

  return report;
}

export default testGenerationTool;
