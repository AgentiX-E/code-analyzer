import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';

import { PythonProvider } from '../languages/python.js';
import type { ParsedImport } from '../languages/provider.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from '../languages/tree-sitter-base.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// A minimal in-memory TreeSitterSyntaxNode. Used to exercise defensive branches
// that real tree-sitter Python cannot produce from valid input (a function or
// class without an identifier, a decorator without a name node, etc.).
function makeNode(
  type: string,
  children: TreeSitterSyntaxNode[] = [],
  text?: string,
  parent: TreeSitterSyntaxNode | null = null,
): TreeSitterSyntaxNode {
  return {
    type,
    text: text ?? children.map((c) => c.text).join(''),
    startIndex: 0,
    endIndex: 0,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    childCount: children.length,
    namedChildCount: children.length,
    hasError: false,
    child: (i: number) => children[i],
    namedChild: (i: number) => children[i],
    childForFieldName: () => null,
    parent,
    walk: () => ({
      nodeType: type,
      startIndex: 0,
      endIndex: 0,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      gotoFirstChild: () => false,
      gotoNextSibling: () => false,
      gotoParent: () => false,
    }),
  };
}

// Exposes the protected AST-walk methods so their defensive branches can be
// exercised directly with synthetic nodes.
class TestablePythonProvider extends PythonProvider {
  public walkAndCaptureForTest(node: TreeSitterSyntaxNode): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    this.walkAndCapture(node, captures);
    return captures;
  }

  public walkForImportsForTest(node: TreeSitterSyntaxNode): ParsedImport[] {
    const imports: ParsedImport[] = [];
    this.walkForImports(node, imports);
    return imports;
  }
}

// Simulates a runtime where the tree-sitter grammar is unavailable, forcing
// the provider onto its regex-based fallback methods.
class NoGrammarPythonProvider extends PythonProvider {
  protected override loadGrammar(): TreeSitterLanguage | null {
    return null;
  }
}

describe('PythonProvider', () => {
  const provider = new PythonProvider();

  describe('properties', () => {
    it('should have correct language and display name', () => {
      expect(provider.language).toBe('python');
      expect(provider.displayName).toBe('Python');
    });

    it('should have Python extensions', () => {
      expect(provider.extensions).toContain('.py');
    });

    it('should have wildcard-leaf import semantics', () => {
      expect(provider.importSemantics).toBe('wildcard-leaf');
    });
  });

  describe('parse', () => {
    it('should detect function definitions', () => {
      const source = `def hello():\n    return "hi"`;
      const captures = provider.parse(source, 'test.py');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('hello');
    });

    it('should detect class definitions', () => {
      const source = `class Dog:\n    def bark(self):\n        pass`;
      const captures = provider.parse(source, 'test.py');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Dog');
    });

    it('should detect class definitions with base classes', () => {
      const source = `class Child(Base, Mixin):\n    pass\n`;
      const captures = provider.parse(source, 'test.py');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Child');
      expect(classes[0]!.properties?.baseClasses).toBe('Base,Mixin');
    });

    it('should detect decorators with arguments', () => {
      const source = `@app.route("/home")\ndef index():\n    pass\n`;
      const captures = provider.parse(source, 'test.py');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.name).toBe('app.route');
    });

    it('should detect decorators', () => {
      const source = `@staticmethod\ndef foo():\n    pass`;
      const captures = provider.parse(source, 'test.py');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.name).toBeDefined();
    });

    it('should detect a dotted decorator without arguments', () => {
      const source = `@foo.bar\ndef baz():\n    pass`;
      const captures = provider.parse(source, 'test.py');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.name).toBe('foo.bar');
    });

    it('should detect triple-quoted docstrings', () => {
      const source = `"""Module docstring"""\n\ndef foo():\n    """Function docstring"""\n    pass`;
      const captures = provider.parse(source, 'test.py');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect single-quote triple-quoted docstrings', () => {
      const source = "'''Module docstring'''\n";
      const captures = provider.parse(source, 'test.py');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
    });

    it('should not treat a plain string statement as a docstring', () => {
      const source = '"just a string"\n';
      const captures = provider.parse(source, 'test.py');
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING)).toEqual([]);
    });

    it('should detect imports', () => {
      const source = `import os\nimport sys\nfrom typing import List`;
      const captures = provider.parse(source, 'test.py');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBe(3);
    });

    it('should detect aliased imports as captures', () => {
      const source = `import numpy as np\n`;
      const captures = provider.parse(source, 'test.py');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.name).toBe('np');
    });

    it('should emit an empty source for a relative star import', () => {
      const source = `from . import *\n`;
      const captures = provider.parse(source, 'test.py');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.name).toBe('');
    });

    it('should detect async functions', () => {
      const source = `async def fetch_data():\n    await something()`;
      const captures = provider.parse(source, 'test.py');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('fetch_data');
    });

    it('should return results sorted by start line', () => {
      const source = `import os\n\ndef a():\n    pass\n\nclass B:\n    pass`;
      const captures = provider.parse(source, 'test.py');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.py');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should parse simple imports', () => {
      const source = `import os\nimport sys`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(2);
      expect(imports[0]!.source).toBe('os');
      expect(imports[1]!.source).toBe('sys');
    });

    it('should parse "from ... import" statements', () => {
      const source = `from typing import List, Dict`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('typing');
      expect(imports[0]!.names).toContain('List');
      expect(imports[0]!.names).toContain('Dict');
    });

    it('should parse aliased imports', () => {
      const source = `import numpy as np`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('namespace');
      expect(imports[0]!.names).toContain('np');
    });

    it('should parse from-import with alias', () => {
      const source = `from module import thing as alias`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('module');
      expect(imports[0]!.names).toContain('alias');
    });

    it('should return no imports for a relative star import', () => {
      expect(provider.extractImports('from . import *\n')).toEqual([]);
    });

    it('should parse a relative named import', () => {
      const imports = provider.extractImports('from . import foo\n');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('foo');
    });

    it('should fall back to the module name for a star import', () => {
      const imports = provider.extractImports('from x import *\n');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('x');
      expect(imports[0]!.names).toEqual(['x']);
    });
  });

  describe('isExported', () => {
    it('should return true for public symbols', () => {
      expect(provider.isExported('def public_func(): pass', 'public_func')).toBe(true);
    });

    it('should return false for private symbols', () => {
      expect(provider.isExported('def _private(): pass', '_private')).toBe(false);
    });

    it('should consider __all__ list', () => {
      const source = '__all__ = ["foo", "bar"]';
      expect(provider.isExported(source, 'foo')).toBe(true);
      expect(provider.isExported(source, 'baz')).toBe(false);
    });

    it('should return true for dunder methods', () => {
      expect(provider.isExported('def __init__(self): pass', '__init__')).toBe(true);
    });

    it('should return true when __all__ is mentioned but not a list literal', () => {
      expect(provider.isExported('print(__all__)', 'x')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Fallback methods (grammar unavailable)
// ---------------------------------------------------------------------------

describe('PythonProvider fallback (grammar unavailable)', () => {
  const provider = new NoGrammarPythonProvider();

  it('parses functions via regex', () => {
    const captures = provider.parse('def greet():\n    pass', 'f.py');
    const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(funcs.some((f) => f.name === 'greet')).toBe(true);
  });

  it('parses async functions via regex', () => {
    const captures = provider.parse('async def fetch():\n    pass', 'f.py');
    const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(funcs.some((f) => f.name === 'fetch')).toBe(true);
  });

  it('parses classes via regex', () => {
    const captures = provider.parse('class Foo:\n    pass', 'f.py');
    const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(classes.some((c) => c.name === 'Foo')).toBe(true);
  });

  it('parses decorators via regex', () => {
    const captures = provider.parse('@app.route("/x")\ndef f():\n    pass', 'f.py');
    const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
    expect(decorators.some((d) => d.name === 'app.route')).toBe(true);
  });

  it('parses docstrings via regex', () => {
    const captures = provider.parse('"""Module doc"""\ndef f():\n    pass', 'f.py');
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.DOCSTRING)).toBe(true);
  });

  it('parses imports via the fallback parser', () => {
    const captures = provider.parse('import os\nfrom x import y', 'f.py');
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'os')).toBe(true);
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'x')).toBe(true);
  });

  it('sorts same-line captures by byte offset', () => {
    const captures = provider.parse('def a(): pass; def b(): pass', 'f.py');
    const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(funcs).toHaveLength(2);
    expect(funcs[0]!.startByte).toBeLessThan(funcs[1]!.startByte);
  });

  it('sorts multi-line captures by line number', () => {
    const captures = provider.parse('class A:\n    pass\ndef b():\n    pass', 'f.py');
    for (let i = 1; i < captures.length; i++) {
      expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
    }
  });

  it('extracts simple and aliased imports via regex', () => {
    const imports = provider.extractImports('import os\nimport numpy as np');
    expect(imports.some((i) => i.source === 'os' && i.type === 'named')).toBe(true);
    expect(imports.some((i) => i.source === 'numpy' && i.type === 'namespace')).toBe(true);
  });

  it('extracts comma-separated imports via regex', () => {
    const imports = provider.extractImports('import os, sys');
    expect(imports.some((i) => i.source === 'os')).toBe(true);
    expect(imports.some((i) => i.source === 'sys')).toBe(true);
  });

  it('extracts from-imports via regex', () => {
    const imports = provider.extractImports('from typing import List, Dict');
    expect(imports.some((i) => i.source === 'typing' && i.names.includes('List'))).toBe(true);
    expect(imports.some((i) => i.source === 'typing' && i.names.includes('Dict'))).toBe(true);
  });

  it('extracts from-import aliases via regex (drops the alias)', () => {
    const imports = provider.extractImports('from module import thing as alias');
    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('module');
    expect(imports[0]!.names).toContain('thing');
  });

  it('returns no imports for plain source', () => {
    expect(provider.extractImports('def f():\n    pass')).toHaveLength(0);
  });

  it('detects exported symbols via regex', () => {
    expect(provider.isExported('def public(): pass', 'public')).toBe(true);
    expect(provider.isExported('def _private(): pass', '_private')).toBe(false);
    expect(provider.isExported('def __init__(self): pass', '__init__')).toBe(true);
  });

  it('considers __all__ via regex', () => {
    const source = '__all__ = ["foo", "bar"]';
    expect(provider.isExported(source, 'foo')).toBe(true);
    expect(provider.isExported(source, 'baz')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defensive branches exercised with synthetic AST nodes
// ---------------------------------------------------------------------------

describe('PythonProvider defensive branches (synthetic nodes)', () => {
  const provider = new TestablePythonProvider();

  describe('walkAndCapture — declarations without a name', () => {
    it('emits no function capture for a function_definition without an identifier', () => {
      const node = makeNode('function_definition', []);
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF)).toEqual([]);
    });

    it('emits no class capture for a class_definition without an identifier', () => {
      const node = makeNode('class_definition', []);
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF)).toEqual([]);
    });
  });

  describe('walkAndCapture — decorator name fallback', () => {
    it('falls back to the call text when the called function has no name node', () => {
      const call = makeNode('call', [], 'foo(1)');
      const decorator = makeNode('decorator', [call], '@foo(1)');
      const decorated = makeNode('decorated_definition', [decorator], '@foo(1)\ndef f(): pass');
      const captures = provider.walkAndCaptureForTest(decorated);
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.name).toBe('foo');
    });

    it('emits no decorator capture for a bare decorator without a name node', () => {
      const decorator = makeNode('decorator', [], '@');
      const decorated = makeNode('decorated_definition', [decorator], '@');
      const captures = provider.walkAndCaptureForTest(decorated);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR)).toEqual([]);
    });
  });

  describe('walkAndCapture — import without a name', () => {
    it('emits an empty source when an aliased import has no identifier', () => {
      const aliased = makeNode('aliased_import', [], 'numpy as ');
      const node = makeNode('import_statement', [aliased], 'import numpy as ');
      const captures = provider.walkAndCaptureForTest(node);
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.name).toBe('');
    });
  });

  describe('walkForImports — import without a name', () => {
    it('falls back to the child text when an aliased import has no identifier', () => {
      const aliased = makeNode('aliased_import', [], 'numpy as np');
      const node = makeNode('import_statement', [aliased], 'import numpy as np');
      const imports = provider.walkForImportsForTest(node);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('numpy as np');
      expect(imports[0]!.type).toBe('namespace');
    });

    it('emits no names when a from-import aliased import has no identifier', () => {
      const aliased = makeNode('aliased_import', [], 'thing as ');
      const node = makeNode('import_from_statement', [aliased], 'from x import thing as ');
      const imports = provider.walkForImportsForTest(node);
      expect(imports).toEqual([]);
    });
  });
});
