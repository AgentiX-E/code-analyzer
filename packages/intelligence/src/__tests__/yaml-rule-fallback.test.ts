// @code-analyzer/intelligence — the YAML rule path has no grammar, on purpose
//
// **The defect this file exists to prevent is a silent one**: pointing the grammar map at a package whose
// `Language` the parser rejects makes `hasAst` false forever, and nobody notices because the regex fallback
// answers. That is how `tree-sitter-yaml@0.5.0` sat in the map for a year while every YAML file in the
// repository was extracted by the fallback. Iteration 132 removed the entry rather than repairing it; these
// tests are what makes the removal a decision instead of a disappearance.

import { describe, expect, it } from 'vitest';

import { createAstContext } from '../rules/ast-rule-checker.js';

describe('a YAML file is extracted by the fallback, and that is what the rules get', () => {
  it('reports no syntax tree rather than an empty one', () => {
    // **The distinction is the whole point**: `hasAst: false` sends the caller to `extractStringsRegex`, while
    // `hasAst: true` with four empty arrays sends it nowhere.
    const context = createAstContext(
      ['db:', '  host: "prod-db.internal"', '  password: "hunter2"'],
      'x.yaml',
      'yaml',
    );
    expect(context.hasAst).toBe(false);
  });

  it('still finds the quoted strings a secret rule reads', () => {
    // The measurement behind the removal: the maintained grammar *does* parse YAML, but the capture walker knows
    // none of its node types, so enabling it would have returned nothing here. The fallback returns both values.
    const context = createAstContext(
      ['db:', '  host: "prod-db.internal"', '  password: "hunter2"'],
      'x.yaml',
      'yaml',
    );
    expect(context.strings.map((entry) => entry.value)).toEqual(['prod-db.internal', 'hunter2']);
  });

  it('records the line the value sits on, which a rule cites', () => {
    const context = createAstContext(['db:', '  password: "hunter2"'], 'x.yaml', 'yaml');
    expect(context.strings[0]?.line).toBe(2);
  });
});

describe('the loader itself works, so the absence above is YAML and not a broken module graph', () => {
  it('parses JSON through the same entry point', () => {
    // **The control arm.** If this failed too, the YAML test above would prove only that `require` is broken,
    // and the removal would have been justified by a defect that is not the one it names.
    const context = createAstContext(['{"name": "web", "image": "nginx:1.27"}'], 'x.json', 'json');
    expect(context.hasAst).toBe(true);
    expect(context.strings.map((entry) => entry.value)).toContain('nginx:1.27');
  });
});
