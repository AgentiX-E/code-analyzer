// @code-analyzer/mcp — the shared test helpers' own contract.
//
// `toolText` exists so that reading a tool result's text is asserted once, with a message that names
// what was missing, instead of `content[0]!.text` at 59 call sites. A helper that throws on a bad
// payload needs that path exercised: it is the branch every caller relies on to fail loudly.

import { describe, it, expect } from 'vitest';

import { toolText } from './test-helpers.js';

describe('toolText', () => {
  it('returns the text of the first content item', () => {
    const result = { content: [{ type: 'text', text: '{"ok":true}' }] };

    expect(toolText(result)).toBe('{"ok":true}');
  });

  it('throws a message naming what was missing when the item has no text', () => {
    const result = { content: [{ type: 'image' }] };

    expect(() => toolText(result)).toThrow(/no text content/);
  });

  it('throws when there is no content at all', () => {
    const result = { content: [] };

    expect(() => toolText(result)).toThrow(/no text content/);
  });
});
