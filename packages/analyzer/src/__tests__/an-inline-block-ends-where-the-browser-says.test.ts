// @code-analyzer/analyzer — an inline block ends where a browser ends it
//
// **The three shapes below are the ones the regular expression got wrong**, and each was a real
// file rather than a construction: a quoted attribute containing `>`, an end tag carrying
// attributes, and a tag whose name merely begins with `script`. The last section asserts the
// provider's behaviour rather than the scanner's, because an offset that is right in isolation and
// wrong when added to the block's start is still a wrong line number.

import { describe, expect, it } from 'vitest';

import {
  findInlineBlockContents,
  findInlineBlocks,
  isInsideRanges,
} from '../languages/html-script-blocks.js';
import { SvelteProvider } from '../languages/svelte.js';

describe('a block boundary is the browser boundary', () => {
  it('reads one block, and its content starts after the open tag', () => {
    const source = '<script>const a = 1;</script>';
    const blocks = findInlineBlockContents(source, 'script');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toBe('const a = 1;');
    // The offset is where the content starts, which is what a caller adds a match index to.
    expect(source.slice(blocks[0]!.offset, blocks[0]!.offset + blocks[0]!.content.length)).toBe(
      'const a = 1;',
    );
  });

  it('lets a `>` inside a quoted attribute belong to the value', () => {
    const source = '<script data-template="a > b">let c = 2;</script>';
    const blocks = findInlineBlockContents(source, 'script');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toBe('let c = 2;');
  });

  it('ends at an end tag that carries attributes', () => {
    const source = '<script>let a = 1;</script\t\n bar><p>after</p>';
    const blocks = findInlineBlockContents(source, 'script');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toBe('let a = 1;');
  });

  it('does not treat a tag whose name begins with script as a script', () => {
    const source = '<scriptfoo>not code</scriptfoo><script>let a = 1;</script>';

    expect(findInlineBlockContents(source, 'script')).toHaveLength(1);
    expect(findInlineBlockContents(source, 'script')[0]!.content).toBe('let a = 1;');
  });

  it('reads two blocks in source order, including a module block', () => {
    const source =
      '<script context="module">export const a = 1;</script>\n<p/>\n<script>let b = 2;</script>';
    const blocks = findInlineBlockContents(source, 'script');

    expect(blocks.map((block) => block.content)).toEqual([
      'export const a = 1;',
      'let b = 2;',
    ]);
  });

  it('runs an unclosed block to the end of the file rather than reporting none', () => {
    const source = '<script>let a = 1;\nlet b = 2;';
    const blocks = findInlineBlockContents(source, 'script');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toBe('let a = 1;\nlet b = 2;');
  });

  it('matches the tag name in any case', () => {
    const source = '<SCRIPT>let a = 1;</SCRIPT>';

    expect(findInlineBlockContents(source, 'script')[0]!.content).toBe('let a = 1;');
  });

  it('reports no block for a file with no such tag', () => {
    expect(findInlineBlockContents('<p>hello</p>', 'script')).toEqual([]);
  });

  it('answers "inside a block" against the ranges it was given', () => {
    const source = 'x<script>abc</script>y';
    const ranges = findInlineBlocks(source, 'script');

    expect(isInsideRanges(ranges, 0)).toBe(false);
    expect(isInsideRanges(ranges, source.indexOf('abc'))).toBe(true);
    expect(isInsideRanges(ranges, source.lastIndexOf('y'))).toBe(false);
  });
});

describe('the svelte provider reads the same boundaries', () => {
  const provider = new SvelteProvider();

  it('keeps a component after an end tag that carries attributes', () => {
    // One line per element, so the expectation is the line a reader counts rather than the line a
    // tab inside the end tag opens.
    const source = ['<script>', '  let a = 1;', '</script bar>', '<MyComponent />'].join('\n');

    const calls = provider
      .parse(source, 'Component.svelte')
      .filter((capture) => capture.name === 'MyComponent');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.startLine).toBe(4);
  });

  it('imports from a block whose open tag quotes a `>`', () => {
    const source = '<script data-template="a > b">\nimport x from "./x";\n</script>';

    const imports = provider
      .parse(source, 'Component.svelte')
      .filter((capture) => capture.text === './x');

    expect(imports).toHaveLength(1);
    expect(imports[0]!.startLine).toBe(2);
  });

  it('does not read code from a tag named scriptfoo', () => {
    const source = '<scriptfoo>import x from "./nope";</scriptfoo>';

    const imports = provider
      .parse(source, 'Component.svelte')
      .filter((capture) => capture.text === './nope');

    expect(imports).toEqual([]);
  });
});
