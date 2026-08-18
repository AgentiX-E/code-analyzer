import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { MarkdownProvider } from '../languages/markdown.js';

describe('MarkdownProvider', () => {
  const provider = new MarkdownProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('markdown');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Markdown');
    });

    it('should have .md, .mdx, .markdown extensions', () => {
      expect(provider.extensions).toContain('.md');
      expect(provider.extensions).toContain('.mdx');
      expect(provider.extensions).toContain('.markdown');
    });

    it('should have "none" import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse', () => {
    it('should parse headings', () => {
      const code = '# Heading 1\n## Heading 2\n### Heading 3';
      const captures = provider.parse(code, 'test.md');
      const headings = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(headings.some((c) => c.name === 'Heading 1')).toBe(true);
      expect(headings.some((c) => c.name === 'Heading 2')).toBe(true);
      expect(headings.some((c) => c.name === 'Heading 3')).toBe(true);
    });

    it('should parse links', () => {
      const code = '[Click here](https://example.com)';
      const captures = provider.parse(code, 'test.md');
      const links = captures.filter((c) => c.properties?.url === 'https://example.com');
      expect(links.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse code blocks', () => {
      const code = '```javascript\nconsole.log("hello");\n```';
      const captures = provider.parse(code, 'test.md');
      const codeBlocks = captures.filter((c) => c.properties?.language === 'javascript');
      expect(codeBlocks.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse images', () => {
      const code = '![alt text](image.png)';
      const captures = provider.parse(code, 'test.md');
      const images = captures.filter((c) => c.properties?.isImage === 'true');
      expect(images.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse unordered lists', () => {
      const code = '- Item 1\n- Item 2\n- Item 3';
      const captures = provider.parse(code, 'test.md');
      const items = captures.filter((c) => c.properties?.isListItem === 'true');
      expect(items.length).toBeGreaterThanOrEqual(3);
    });

    it('should parse ordered lists', () => {
      const code = '1. First\n2. Second\n3. Third';
      const captures = provider.parse(code, 'test.md');
      const items = captures.filter((c) => c.properties?.isListItem === 'true');
      expect(items.length).toBeGreaterThanOrEqual(3);
    });

    it('should parse YAML frontmatter', () => {
      const code = '---\ntitle: Test\n---\n\n# Content';
      const captures = provider.parse(code, 'test.md');
      const fm = captures.filter((c) => c.properties?.isFrontmatter === 'true');
      expect(fm.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse blockquotes', () => {
      const code = '> This is a quote\n> Another line';
      const captures = provider.parse(code, 'test.md');
      const quotes = captures.filter((c) => c.properties?.isBlockquote === 'true');
      expect(quotes.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.md');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle files with only whitespace', () => {
      const captures = provider.parse('   \n\n  ', 'test.md');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = '# Title\n- Item 1\n- Item 2';
      const captures = provider.parse(code, 'test.md');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should parse headings with correct level property', () => {
      const code = '# Level 1\n## Level 2\n###### Level 6';
      const captures = provider.parse(code, 'test.md');
      const h1 = captures.find((c) => c.name === 'Level 1');
      const h2 = captures.find((c) => c.name === 'Level 2');
      const h6 = captures.find((c) => c.name === 'Level 6');
      expect(h1?.properties?.level).toBe('1');
      expect(h2?.properties?.level).toBe('2');
      expect(h6?.properties?.level).toBe('6');
    });

    it('should include filePath in properties', () => {
      const code = '# Test';
      const captures = provider.parse(code, 'myfile.md');
      const heading = captures.find((c) => c.name === 'Test');
      expect(heading?.properties?.filePath).toBe('myfile.md');
    });
  });

  describe('extractImports', () => {
    it('should return empty array (Markdown has no imports)', () => {
      const imports = provider.extractImports('# Title');
      expect(imports).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return false (Markdown has no export concept)', () => {
      expect(provider.isExported('# Title', 'Title')).toBe(false);
    });
  });

  describe('regex parsing (via parse)', () => {
    it('parse should parse headings', () => {
      const code = '# Title\n## Subtitle';
      const captures = provider.parse(code, 'test.md');
      const headings = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(headings.some((c) => c.name === 'Title')).toBe(true);
      expect(headings.some((c) => c.name === 'Subtitle')).toBe(true);
    });

    it('parse should parse links', () => {
      const code = '[link](https://example.com)';
      const captures = provider.parse(code, 'test.md');
      const links = captures.filter((c) => c.properties?.url === 'https://example.com');
      expect(links.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should parse images', () => {
      const code = '![alt](image.png)';
      const captures = provider.parse(code, 'test.md');
      const images = captures.filter((c) => c.properties?.isImage === 'true');
      expect(images.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should parse code blocks', () => {
      const code = '```python\nprint("hello")\n```';
      const captures = provider.parse(code, 'test.md');
      const blocks = captures.filter((c) => c.properties?.language === 'python');
      expect(blocks.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should parse lists', () => {
      const code = '- item1\n- item2';
      const captures = provider.parse(code, 'test.md');
      const items = captures.filter((c) => c.properties?.isListItem === 'true');
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('parse should parse ordered lists', () => {
      const code = '1. first\n2. second';
      const captures = provider.parse(code, 'test.md');
      const items = captures.filter((c) => c.properties?.isListItem === 'true');
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('parse should parse frontmatter', () => {
      const code = '---\ntitle: hello\n---\n# Content';
      const captures = provider.parse(code, 'test.md');
      const fm = captures.filter((c) => c.properties?.isFrontmatter === 'true');
      expect(fm.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should parse blockquotes', () => {
      const code = '> quoted text';
      const captures = provider.parse(code, 'test.md');
      const quotes = captures.filter((c) => c.properties?.isBlockquote === 'true');
      expect(quotes.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should handle empty input', () => {
      const captures = provider.parse('', 'test.md');
      expect(captures).toEqual([]);
    });

    it('parse should handle text without markdown features', () => {
      const captures = provider.parse('Just plain text', 'test.md');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('extractImports should return empty array', () => {
      expect(provider.extractImports('anything')).toEqual([]);
    });

    it('isExported should return false', () => {
      expect(provider.isExported('anything', 'any')).toBe(false);
    });
  });
});
