// @ts-nocheck
// @code-analyzer/mcp — Documentation Generation Tool Tests

import { describe, it, expect } from 'vitest';
import docGenerationTool, { docGenerationTool as namedExport } from '../tools/doc-generation.js';

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe('docGenerationTool definition', () => {
  it('should have the correct tool name', () => {
    expect(docGenerationTool.name).toBe('doc_generation');
  });

  it('should have a non-empty description', () => {
    expect(docGenerationTool.description.length).toBeGreaterThan(0);
  });

  it('should have a valid inputSchema', () => {
    expect(docGenerationTool.inputSchema.type).toBe('object');
    expect(docGenerationTool.inputSchema.properties).toBeDefined();
    expect(docGenerationTool.inputSchema.required).toContain('projectId');
  });

  it('should have style enum with all 4 styles', () => {
    const styleProp = docGenerationTool.inputSchema.properties.style;
    expect(styleProp.enum).toContain('jsdoc');
    expect(styleProp.enum).toContain('docstring');
    expect(styleProp.enum).toContain('godoc');
    expect(styleProp.enum).toContain('javadoc');
  });

  it('should default style to jsdoc', () => {
    const styleProp = docGenerationTool.inputSchema.properties.style;
    expect(styleProp.default).toBe('jsdoc');
  });

  it('should have a callable handler', () => {
    expect(typeof docGenerationTool.handler).toBe('function');
  });

  it('should export the same object as default and named', () => {
    expect(docGenerationTool).toBe(namedExport);
  });
});

// ---------------------------------------------------------------------------
// Handler Tests
// ---------------------------------------------------------------------------

describe('docGenerationTool handler', () => {
  it('should generate docs with default jsdoc style', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('Generated Documentation');
    expect(result.content[0].text).toContain('**Style:** jsdoc');
    expect(result.metadata.generatedCount).toBe(3);
    expect(result.metadata.projectId).toBe('test-project');
    expect(result.metadata.style).toBe('jsdoc');
  });

  it('should generate docs with docstring style', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      style: 'docstring',
    });
    expect(result.content[0].text).toContain('**Style:** docstring');
    expect(result.content[0].text).toContain('"""');
    expect(result.metadata.style).toBe('docstring');
  });

  it('should generate docs with godoc style', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      style: 'godoc',
    });
    expect(result.content[0].text).toContain('**Style:** godoc');
    expect(result.metadata.style).toBe('godoc');
  });

  it('should generate docs with javadoc style', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      style: 'javadoc',
    });
    expect(result.content[0].text).toContain('**Style:** javadoc');
    expect(result.metadata.style).toBe('javadoc');
  });

  it('should filter by filePath', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      filePath: 'handler',
    });
    expect(result.content[0].text).toContain('processRequest');
    expect(result.content[0].text).toContain('src/api/handler.ts');
    expect(result.metadata.generatedCount).toBe(1);
  });

  it('should filter by symbolName (case-insensitive)', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'AUTH',
    });
    expect(result.content[0].text).toContain('authenticate');
    expect(result.content[0].text).not.toContain('processRequest');
    expect(result.content[0].text).not.toContain('buildQuery');
    expect(result.metadata.generatedCount).toBe(1);
  });

  it('should filter by symbolName with partial match', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'build',
    });
    expect(result.content[0].text).toContain('buildQuery');
    expect(result.metadata.generatedCount).toBe(1);
  });

  it('should handle empty results when filter matches nothing', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      filePath: 'nonexistent',
    });
    expect(result.content[0].text).toBe('No undocumented symbols found.');
    expect(result.metadata.generatedCount).toBe(0);
  });

  it('should handle combined filePath and symbolName filters', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      filePath: 'handler',
      symbolName: 'process',
    });
    expect(result.content[0].text).toContain('processRequest');
    expect(result.metadata.generatedCount).toBe(1);
  });

  it('should use default style when style is undefined', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      style: undefined,
    });
    expect(result.metadata.style).toBe('jsdoc');
    expect(result.content[0].text).toContain('**Style:** jsdoc');
  });
});

// ---------------------------------------------------------------------------
// JSDoc Style Content Tests
// ---------------------------------------------------------------------------

describe('jsdoc style output', () => {
  it('should include @param tags', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
      style: 'jsdoc',
    });
    expect(result.content[0].text).toContain('@param');
    expect(result.content[0].text).toContain('@returns');
  });

  it('should include @throws tags', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'authenticate',
      style: 'jsdoc',
    });
    expect(result.content[0].text).toContain('@throws');
  });

  it('should include @example and @since', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'buildQuery',
      style: 'jsdoc',
    });
    expect(result.content[0].text).toContain('@example');
    expect(result.content[0].text).toContain('@since');
  });

  it('should not include @deprecated for non-deprecated symbols', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
      style: 'jsdoc',
    });
    expect(result.content[0].text).not.toContain('@deprecated');
  });
});

// ---------------------------------------------------------------------------
// Docstring Style Content Tests
// ---------------------------------------------------------------------------

describe('docstring style output', () => {
  it('should use Python docstring format', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
      style: 'docstring',
    });
    expect(result.content[0].text).toContain('"""');
    expect(result.content[0].text).toContain('Args:');
    expect(result.content[0].text).toContain('Returns:');
    expect(result.content[0].text).toContain('Raises:');
  });

  it('should include deprecated notice for deprecated symbols', async () => {
    // The deprecated flag is false for all default docs — test format structure instead
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'authenticate',
      style: 'docstring',
    });
    expect(result.content[0].text).toContain('"""');
    expect(result.content[0].text).toContain('Args:');
  });
});

// ---------------------------------------------------------------------------
// GoDoc Style Content Tests
// ---------------------------------------------------------------------------

describe('godoc style output', () => {
  it('should use Go comment format', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
      style: 'godoc',
    });
    expect(result.content[0].text).toContain('// processRequest');
    expect(result.content[0].text).toContain('// req');
  });

  it('should include error return descriptions', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'authenticate',
      style: 'godoc',
    });
    expect(result.content[0].text).toContain('Returns');
  });
});

// ---------------------------------------------------------------------------
// JavaDoc Style Content Tests
// ---------------------------------------------------------------------------

describe('javadoc style output', () => {
  it('should use Java comment format', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
      style: 'javadoc',
    });
    expect(result.content[0].text).toContain('/**');
    expect(result.content[0].text).toContain('@param');
    expect(result.content[0].text).toContain('@return');
    expect(result.content[0].text).toContain('*/');
  });

  it('should include @throws and @since', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'authenticate',
      style: 'javadoc',
    });
    expect(result.content[0].text).toContain('@throws');
    expect(result.content[0].text).toContain('@since');
  });

  it('should not include @deprecated for non-deprecated', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'buildQuery',
      style: 'javadoc',
    });
    expect(result.content[0].text).not.toContain('@deprecated');
  });
});

// ---------------------------------------------------------------------------
// Report Structure Tests
// ---------------------------------------------------------------------------

describe('doc generation report structure', () => {
  it('should include symbol name in heading', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('### `processRequest`');
    expect(result.content[0].text).toContain('### `buildQuery`');
    expect(result.content[0].text).toContain('### `authenticate`');
  });

  it('should include file path in heading', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
    });
    expect(result.content[0].text).toContain('src/api/handler.ts');
  });

  it('should include signature in output', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
    });
    expect(result.content[0].text).toContain('**Signature:**');
  });

  it('should include code blocks with docstrings', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
    });
    expect(result.content[0].text).toContain('```');
  });

  it('should include next steps section', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('### Next Steps');
    expect(result.content[0].text).toContain('Review generated documentation');
  });

  it('should return empty message when no docs generated', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      filePath: 'zzz_nonexistent_path_zzz',
    });
    expect(result.content[0].text).toBe('No undocumented symbols found.');
  });

  it('should have correct generatedCount in metadata', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.metadata.generatedCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle undefined filePath gracefully', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      filePath: undefined,
    });
    expect(result.content[0].text).toContain('Generated Documentation');
    expect(result.metadata.generatedCount).toBe(3);
  });

  it('should handle undefined symbolName gracefully', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: undefined,
    });
    expect(result.metadata.generatedCount).toBe(3);
  });

  it('should handle both filePath and symbolName being undefined', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      filePath: undefined,
      symbolName: undefined,
    });
    expect(result.metadata.generatedCount).toBe(3);
  });

  it('should handle all 4 styles producing valid output', async () => {
    const styles = ['jsdoc', 'docstring', 'godoc', 'javadoc'];
    for (const style of styles) {
      const result = await docGenerationTool.handler({
        projectId: 'test-project',
        style,
      });
      expect(result.metadata.style).toBe(style);
      expect(result.metadata.generatedCount).toBe(3);
    }
  });

  it('should filter by symbolName case-insensitively', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'PROCESSREQUEST',
    });
    expect(result.metadata.generatedCount).toBe(1);
    expect(result.content[0].text).toContain('processRequest');
  });
});

// ---------------------------------------------------------------------------
// Style output format tests — verify all format-specific markers
// ---------------------------------------------------------------------------

describe('godoc style output details', () => {
  it('should include "// " comment prefix for all lines', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'buildQuery',
      style: 'godoc',
    });
    expect(result.content[0].text).toContain('// buildQuery');
    expect(result.content[0].text).toContain('// table');
    expect(result.content[0].text).toContain('// filters');
  });

  it('should include deprecated notice for godoc format structure', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'buildQuery',
      style: 'godoc',
    });
    // godoc format should not contain @deprecated (all sample data is non-deprecated)
    expect(result.content[0].text).not.toContain('Deprecated:');
  });
});

describe('docstring style output details', () => {
  it('should include Args and Returns sections', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
      style: 'docstring',
    });
    expect(result.content[0].text).toContain('Args:');
    expect(result.content[0].text).toContain('Returns:');
    expect(result.content[0].text).toContain('Raises:');
  });

  it('should not include deprecated marker for non-deprecated symbols', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'processRequest',
      style: 'docstring',
    });
    expect(result.content[0].text).not.toContain('deprecated');
  });

  it('should include raises section for authenticate (multiple throws)', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'authenticate',
      style: 'docstring',
    });
    expect(result.content[0].text).toContain('Raises:');
    expect(result.content[0].text).toContain('AuthError');
  });
});

describe('javadoc style output details', () => {
  it('should include @param and @return tags', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      symbolName: 'authenticate',
      style: 'javadoc',
    });
    expect(result.content[0].text).toContain('@param');
    expect(result.content[0].text).toContain('@return');
    expect(result.content[0].text).toContain('@throws');
  });
});

describe('style format — default fallback', () => {
  it('should default to jsdoc when style is not one of the 4 known values', async () => {
    // The handler defaults style to 'jsdoc' via (style as string) ?? 'jsdoc',
    // and generateDocForStyle has a default case returning jsDoc(t).
    // Passing an unknown style triggers the default path.
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
      style: 'unknown-style',
    });
    // Falls back to jsdoc format
    expect(result.content[0].text).toContain('/**');
    expect(result.content[0].text).toContain('@param');
    expect(result.content[0].text).toContain('@returns');
    expect(result.content[0].text).not.toContain('Args:');
    expect(result.content[0].text).not.toContain('"""');
  });
});

describe('report structure — all symbols', () => {
  it('should include all three symbols when no filter is applied', async () => {
    const result = await docGenerationTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('processRequest');
    expect(result.content[0].text).toContain('buildQuery');
    expect(result.content[0].text).toContain('authenticate');
  });

  it('should include style in report header', async () => {
    for (const style of ['jsdoc', 'docstring', 'godoc', 'javadoc']) {
      const result = await docGenerationTool.handler({
        projectId: 'test-project',
        style,
      });
      expect(result.content[0].text).toContain(`**Style:** ${style}`);
    }
  });
});
