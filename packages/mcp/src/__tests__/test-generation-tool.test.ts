// @ts-nocheck
// @code-analyzer/mcp — Test Generation Tool Tests

import { describe, it, expect } from 'vitest';
import testGenerationTool, {
  testGenerationTool as namedExport,
} from '../tools/test-generation.js';

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe('testGenerationTool definition', () => {
  it('should have the correct tool name', () => {
    expect(testGenerationTool.name).toBe('test_generation');
  });

  it('should have a non-empty description', () => {
    expect(testGenerationTool.description.length).toBeGreaterThan(0);
  });

  it('should have a valid inputSchema', () => {
    expect(testGenerationTool.inputSchema.type).toBe('object');
    expect(testGenerationTool.inputSchema.properties).toBeDefined();
    expect(testGenerationTool.inputSchema.required).toContain('projectId');
  });

  it('should have framework enum with all 6 frameworks', () => {
    const frameworkProp = testGenerationTool.inputSchema.properties.framework;
    expect(frameworkProp.enum).toContain('jest');
    expect(frameworkProp.enum).toContain('vitest');
    expect(frameworkProp.enum).toContain('mocha');
    expect(frameworkProp.enum).toContain('pytest');
    expect(frameworkProp.enum).toContain('go-test');
    expect(frameworkProp.enum).toContain('junit');
  });

  it('should default framework to vitest', () => {
    const frameworkProp = testGenerationTool.inputSchema.properties.framework;
    expect(frameworkProp.default).toBe('vitest');
  });

  it('should have maxTests with default 5', () => {
    const maxTestsProp = testGenerationTool.inputSchema.properties.maxTests;
    expect(maxTestsProp.type).toBe('number');
    expect(maxTestsProp.default).toBe(5);
  });

  it('should have a callable handler', () => {
    expect(typeof testGenerationTool.handler).toBe('function');
  });

  it('should export the same object as default and named', () => {
    expect(testGenerationTool).toBe(namedExport);
  });
});

// ---------------------------------------------------------------------------
// Handler Tests
// ---------------------------------------------------------------------------

describe('testGenerationTool handler', () => {
  it('should generate tests with default vitest framework', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('Generated Test Skeletons');
    expect(result.content[0].text).toContain('**Framework:** vitest');
    expect(result.metadata.generatedCount).toBe(3);
    expect(result.metadata.projectId).toBe('test-project');
    expect(result.metadata.framework).toBe('vitest');
  });

  it('should generate tests with jest framework', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'jest',
    });
    expect(result.content[0].text).toContain('**Framework:** jest');
    expect(result.content[0].text).toContain('describe');
    expect(result.content[0].text).toContain("it('");
    expect(result.metadata.framework).toBe('jest');
  });

  it('should generate tests with mocha framework', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'mocha',
    });
    expect(result.content[0].text).toContain('**Framework:** mocha');
    expect(result.content[0].text).toContain("it('");
    expect(result.content[0].text).toContain('expect(');
    expect(result.metadata.framework).toBe('mocha');
  });

  it('should generate tests with pytest framework', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'pytest',
    });
    expect(result.content[0].text).toContain('**Framework:** pytest');
    expect(result.content[0].text).toContain('def test_');
    expect(result.content[0].text).toContain('assert');
    expect(result.metadata.framework).toBe('pytest');
  });

  it('should generate tests with go-test framework', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'go-test',
    });
    expect(result.content[0].text).toContain('**Framework:** go-test');
    expect(result.content[0].text).toContain('func Test');
    expect(result.content[0].text).toContain('*testing.T');
    expect(result.content[0].text).toContain('t.Errorf');
    expect(result.metadata.framework).toBe('go-test');
  });

  it('should generate tests with junit framework', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'junit',
    });
    expect(result.content[0].text).toContain('**Framework:** junit');
    expect(result.metadata.framework).toBe('junit');
  });
});

// ---------------------------------------------------------------------------
// Symbol Name Filtering Tests
// ---------------------------------------------------------------------------

describe('symbol name filtering', () => {
  it('should filter by symbolName (case-insensitive)', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'VALIDATE',
    });
    expect(result.content[0].text).toContain('validateEmail');
    expect(result.metadata.generatedCount).toBe(1);
  });

  it('should filter by partial symbolName match', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'format',
    });
    expect(result.content[0].text).toContain('formatCurrency');
    expect(result.metadata.generatedCount).toBe(1);
  });

  it('should return empty for non-matching symbolName', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'nonexistent',
    });
    expect(result.content[0].text).toBe('No uncovered functions found for test generation.');
    expect(result.metadata.generatedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// maxTests Limit Tests
// ---------------------------------------------------------------------------

describe('maxTests limit', () => {
  it('should respect maxTests limit', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      maxTests: 1,
    });
    expect(result.metadata.generatedCount).toBe(1);
  });

  it('should use default maxTests of 5 when not provided', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      maxTests: undefined,
    });
    // Only 3 skeletons defined, so max is 3
    expect(result.metadata.generatedCount).toBe(3);
  });

  it('should handle maxTests larger than available tests', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      maxTests: 100,
    });
    expect(result.metadata.generatedCount).toBe(3);
  });

  it('should handle maxTests of 0', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      maxTests: 0,
    });
    expect(result.metadata.generatedCount).toBe(0);
    expect(result.content[0].text).toBe('No uncovered functions found for test generation.');
  });
});

// ---------------------------------------------------------------------------
// Framework-Specific Code Block Tests
// ---------------------------------------------------------------------------

describe('jest/vitest framework code blocks', () => {
  it('should include describe block for jest', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'jest',
      symbolName: 'validateEmail',
    });
    expect(result.content[0].text).toContain("describe('validateEmail'");
    expect(result.content[0].text).toContain("it('should accept valid email'");
    expect(result.content[0].text).toContain('expect(result).toBe(');
  });

  it('should include describe block for vitest', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'vitest',
      symbolName: 'validateEmail',
    });
    expect(result.content[0].text).toContain("describe('validateEmail'");
    expect(result.content[0].text).toContain("it('should accept valid email'");
  });

  it('should not include describe block for mocha', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'mocha',
      symbolName: 'validateEmail',
    });
    // Mocha does not use describe() prefix in the template
    expect(result.content[0].text).toContain("it('should accept valid email'");
    expect(result.content[0].text).not.toContain("describe('validateEmail'");
  });
});

describe('pytest framework code blocks', () => {
  it('should use Python test function syntax', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'pytest',
      symbolName: 'validateEmail',
    });
    expect(result.content[0].text).toContain('def test_validateEmail_should_accept_valid_email');
    expect(result.content[0].text).toContain('assert result ==');
  });

  it('should replace spaces with underscores in test names', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'pytest',
      symbolName: 'formatCurrency',
    });
    expect(result.content[0].text).toContain('test_formatCurrency_should_format_USD_correctly');
  });

  it('should use python language tag in code block', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'pytest',
    });
    expect(result.content[0].text).toContain('```python');
  });
});

describe('go-test framework code blocks', () => {
  it('should use Go test function syntax', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'go-test',
      symbolName: 'validateEmail',
    });
    expect(result.content[0].text).toContain('func TestvalidateEmail');
    expect(result.content[0].text).toContain('*testing.T');
    expect(result.content[0].text).toContain('t.Errorf');
  });

  it('should use go language tag in code block', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'go-test',
    });
    expect(result.content[0].text).toContain('```go');
  });
});

// ---------------------------------------------------------------------------
// Report Structure Tests
// ---------------------------------------------------------------------------

describe('test generation report structure', () => {
  it('should include function name in heading', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('### `validateEmail`');
    expect(result.content[0].text).toContain('### `calculateTotal`');
    expect(result.content[0].text).toContain('### `formatCurrency`');
  });

  it('should include file path in heading', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'validateEmail',
    });
    expect(result.content[0].text).toContain('src/utils/validators.ts');
  });

  it('should include description for each test', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'validateEmail',
    });
    expect(result.content[0].text).toContain('Validates email format using regex');
  });

  it('should include framework in report header', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'pytest',
    });
    expect(result.content[0].text).toContain('**Framework:** pytest');
  });

  it('should include next steps section', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('### Next Steps');
    expect(result.content[0].text).toContain('Review generated test skeletons');
    expect(result.content[0].text).toContain('Add edge cases');
    expect(result.content[0].text).toContain('Run the test suite');
  });

  it('should include code blocks with test code', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'validateEmail',
    });
    expect(result.content[0].text).toContain('```');
  });

  it('should show empty message when no tests generated', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'zzz_nonexistent',
    });
    expect(result.content[0].text).toBe('No uncovered functions found for test generation.');
  });
});

// ---------------------------------------------------------------------------
// Metadata Tests
// ---------------------------------------------------------------------------

describe('test generation metadata', () => {
  it('should include projectId in metadata', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'my-project',
    });
    expect(result.metadata.projectId).toBe('my-project');
  });

  it('should include symbolName in metadata when provided', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'myFunc',
    });
    expect(result.metadata.symbolName).toBe('myFunc');
  });

  it('should include framework in metadata', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: 'pytest',
    });
    expect(result.metadata.framework).toBe('pytest');
  });

  it('should include generatedCount in metadata', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.metadata.generatedCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle undefined framework (defaults to vitest)', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      framework: undefined,
    });
    expect(result.metadata.framework).toBe('vitest');
    expect(result.content[0].text).toContain('**Framework:** vitest');
  });

  it('should handle undefined symbolName gracefully', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      symbolName: undefined,
    });
    expect(result.metadata.generatedCount).toBe(3);
  });

  it('should handle undefined maxTests gracefully', async () => {
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      maxTests: undefined,
    });
    expect(result.metadata.generatedCount).toBe(3);
  });

  it('should generate correct code for all 6 frameworks', async () => {
    const frameworks = ['jest', 'vitest', 'mocha', 'pytest', 'go-test', 'junit'];
    for (const fw of frameworks) {
      const result = await testGenerationTool.handler({
        projectId: 'test-project',
        framework: fw,
      });
      expect(result.content[0].text).toContain('**Framework:** ' + fw);
      expect(result.metadata.generatedCount).toBe(3);
    }
  });

  it('should use typescript language tag for jest/vitest/mocha', async () => {
    for (const fw of ['jest', 'vitest', 'mocha']) {
      const result = await testGenerationTool.handler({
        projectId: 'test-project',
        framework: fw,
        symbolName: 'validateEmail',
      });
      expect(result.content[0].text).toContain('```typescript');
    }
  });

  it('should apply maxTests limit with symbolName filter', async () => {
    // With no symbolName, 3 tests. With maxTests=2, should get 2.
    const result = await testGenerationTool.handler({
      projectId: 'test-project',
      maxTests: 2,
    });
    expect(result.metadata.generatedCount).toBe(2);
  });
});
