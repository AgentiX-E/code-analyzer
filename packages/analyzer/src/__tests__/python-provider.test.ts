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
    child: (i: number) => children[i]!,
    namedChild: (i: number) => children[i]!,
    childForFieldName: () => null,
    parent,
    walk: () => ({
      nodeType: type,
      nodeText: '',
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
      expect(classes[0]!.properties?.['baseClasses']).toBe('Base,Mixin');
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

  // **Python writes a field's type in two places and the graph stored neither.** A class body may annotate a field
  // (`index: Index`), and `__init__` may annotate the attribute it assigns (`self.cache: Cache = Cache()`); both are
  // declarations a call on `self.index` or `self.cache` needs, and both are invisible to a walk that only looks for
  // `def` and `class`. The fact is filed on the **class**, as one property, for the reason iteration 45 measured on
  // TypeScript: a node per field competes with the functions of the file for a search query.
  describe('field types and the class a method is declared in', () => {
    const classOf = (captures: UnifiedCapture[], name: string): unknown =>
      captures.find((capture) => capture.tag === CAPTURE_TAGS.CLASS_DEF && capture.name === name)
        ?.properties?.['fieldTypes'];

    it('files a class-body annotation on the class', () => {
      const captures = provider.parse(
        'class Holder:\n    index: Index\n    plain = 1\n    def run(self):\n        pass\n',
        '/p/a.py',
      );
      expect(classOf(captures, 'Holder')).toBe(JSON.stringify({ index: 'Index' }));
    });

    it('files an attribute annotated in a method on the class that method belongs to', () => {
      const captures = provider.parse(
        [
          'class Holder:',
          '    def __init__(self):',
          '        self.cache: Cache = Cache()',
          '        self.count = 0',
          '',
        ].join('\n'),
        '/p/a.py',
      );
      // `self.count` has no annotation, so it is not a fact; `self.cache` has one, and it is the class's field.
      expect(classOf(captures, 'Holder')).toBe(JSON.stringify({ cache: 'Cache' }));
    });

    it('keeps a parameter annotation out of the fields', () => {
      // `def run(self, other: Holder)` annotates a parameter, which the provider already files on the parameter.
      const captures = provider.parse(
        'class Holder:\n    def run(self, other: Holder):\n        pass\n',
        '/p/a.py',
      );
      expect(classOf(captures, 'Holder')).toBeUndefined();
    });

    it('names the class a method is declared in, which is what a `self.` call needs', () => {
      const captures = provider.parse(
        'class Holder:\n    def run(self):\n        pass\n\ndef free():\n    pass\n',
        '/p/a.py',
      );
      const run = captures.find(
        (capture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF && capture.name === 'run',
      );
      const free = captures.find(
        (capture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF && capture.name === 'free',
      );
      expect(run?.properties?.['enclosingClass']).toBe('Holder');
      // A module-level function belongs to no class, and says so rather than naming the last one it saw.
      expect(free?.properties?.['enclosingClass']).toBeUndefined();
    });

    it('reads a field declared by what it is assigned, which is how Python wrote it before annotations', () => {
      const captures = provider.parse(
        [
          'class Holder:',
          '    index = InvertedIndex()',
          '    def __init__(self):',
          '        self.cache = Cache()',
          '        self.helper = make_helper()',
          '        self.pair = Pair.build()',
          '',
        ].join('\n'),
        '/p/a.py',
      );
      // **`InvertedIndex()` says the type as plainly as an annotation**, and a bare call is the only shape recorded:
      // `make_helper()` is a factory and `Pair.build()` is a member call, and neither says what the field *is*. The
      // resolver is what decides whether `make_helper` names a class, so recording it costs nothing either way.
      expect(classOf(captures, 'Holder')).toBe(
        JSON.stringify({ index: 'InvertedIndex', cache: 'Cache', helper: 'make_helper' }),
      );
    });

    it('prefers the annotation when a field carries both', () => {
      const captures = provider.parse('class Holder:\n    index: Index = Index()\n', '/p/a.py');
      expect(classOf(captures, 'Holder')).toBe(JSON.stringify({ index: 'Index' }));
    });

    it('refuses an attribute written on anybody but `self` or `cls`, and one that is two levels deep', () => {
      const captures = provider.parse(
        [
          'class Holder:',
          '    def run(self, holder):',
          '        holder.cache: Cache = Cache()',
          '        self.a.b: Index = None',
          '        cls.index: Index = None',
          '',
        ].join('\n'),
        '/p/a.py',
      );
      // `holder.cache` is somebody else's field - this parse knows what the annotation says and not what `holder` is.
      // `self.a.b` names a field of `self.a`, and only the first hop is a type this file could state. `cls.index` is
      // the class's own and is recorded.
      expect(classOf(captures, 'Holder')).toBe(JSON.stringify({ index: 'Index' }));
    });

    it('records what a class writes, and never a method local or an unannotated field', () => {
      const captures = provider.parse(
        [
          'class Holder:',
          '    items: list[Item] = []',
          '    maybe: Optional[Index] = None',
          '    plain = 1',
          '    def run(self):',
          '        local: Index = None',
          '',
        ].join('\n'),
        '/p/a.py',
      );
      // **What a container, a union or a primitive is worth is the resolver's decision, not the parser's**: this
      // records the text that was written, and `simpleTypeName` refuses it later. `local` is the one thing the
      // provider must not record - a variable in a method is not a field, and `plain` has no annotation at all.
      expect(classOf(captures, 'Holder')).toBe(
        JSON.stringify({
          items: 'list[Item]',
          maybe: 'Optional[Index]',
        }),
      );
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
      // **`numpy` is what is imported and `np` is what this file calls it.** Reporting the alias as the imported name
      // names a module that does not exist, and every edge built from it resolves to nothing.
      expect(imports[0]!.names).toContain('numpy');
      expect(imports[0]!.alias).toBe('np');
    });

    it('should parse from-import with alias', () => {
      const source = `from module import thing as alias`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('module');
      expect(imports[0]!.names).toContain('thing');
      expect(imports[0]!.alias).toBe('alias');
    });

    it('should read a relative star import as a wildcard from the importer’s own package', () => {
      // **`from . import *` imports every public name of the package the file is in**, which is a wildcard import from
      // `.` — not "no imports". The empty list was the base implementation failing to see the statement at all.
      const imports = provider.extractImports('from . import *\n');
      expect(imports).toEqual([{ source: '.', names: ['*'], type: 'wildcard', lineNumber: 1 }]);
    });

    it('should parse a relative named import with the package as its module', () => {
      const imports = provider.extractImports('from . import foo\n');
      expect(imports).toHaveLength(1);
      // **The module is `.` and the name is `foo`.** Reporting `foo` as the module made the import a bare package name
      // that the resolver then looked for in `node_modules`.
      expect(imports[0]!.source).toBe('.');
      expect(imports[0]!.names).toEqual(['foo']);
    });

    it('should record a star import as a wildcard of names rather than of the module', () => {
      const imports = provider.extractImports('from x import *\n');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('x');
      // `*` is the honest name list: the module is `x`, and which names it exports is not known from here.
      expect(imports[0]!.names).toEqual(['*']);
      expect(imports[0]!.type).toBe('wildcard');
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
    // **This is the regex fallback**, which knows only the source of an import and not its kind - so `named` here is
    // what a regex can honestly say. The AST path, which knows the difference and reports `namespace` plus the alias,
    // is covered by `PythonProvider.extractImports` above; the two readers are allowed to differ in what they know.
    expect(imports.some((i) => i.source === 'os' && i.type === 'named')).toBe(true);
    expect(imports.some((i) => i.source === 'numpy')).toBe(true);
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

    it('files no parameter owner and no class for a function the tree gives no name', () => {
      // **A parameter list with no function name**: the walk still emits the parameter, and neither the owner key nor
      // the enclosing class can be built - so the parameter carries its index and nothing else. No Python source
      // produces this; the grammar's `ERROR` recovery under a truncated file does.
      const parameter = makeNode('identifier', [], 'self');
      const parameters = makeNode('parameters', [parameter], '(self)');
      const node = makeNode('function_definition', [parameters], 'def (self):');
      const captures = provider.walkAndCaptureForTest(node);
      const defs = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(defs).toHaveLength(1);
      expect(defs[0]!.properties?.['parameterOwner']).toBeUndefined();
      expect(
        captures.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF)?.properties?.['enclosingClass'],
      ).toBeUndefined();
    });
  });

  describe('walkAndCapture — a statement with no scope', () => {
    it('files no field for an assignment with no left-hand side', () => {
      // A truncated `x` at the end of a file parses as an `assignment` with nothing under it. The annotation walk must
      // answer "no field" rather than read the first child of nothing.
      const node = makeNode('assignment', [], '');
      expect(() => provider.walkAndCaptureForTest(node)).not.toThrow();
    });

    it('files no field for an annotated assignment that sits in no class at all', () => {
      // A node detached from any parent has no container, so there is no class to file its annotation on.
      const name = makeNode('identifier', [], 'x');
      const annotation = makeNode('type', [makeNode('identifier', [], 'Index')], 'Index');
      const node = makeNode('assignment', [name, annotation], 'x: Index', null);
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

  // **The `walkForImports` hook is gone from this provider**, because `extractImports` reads Python's nodes
  // directly; the two cases that exercised the hook went with it. **A test of a method nothing calls is a test that
  // keeps a dead branch alive**, and this campaign has already found one of those.
});

// Python's imports read from Python's own nodes.
//
// **The base implementation walks JavaScript shapes**, and on a Python tree it read whatever node came first: a probe
// of `src/flask/app.py` returned `cabc`, `t` and `datetime` for `from __future__ import annotations`,
// `import typing as t` and `from datetime import timedelta`. **Sixty imports, nearly all wrong**, and each one
// unresolvable - which is why `pallets/flask` produced four import edges instead of a hundred and eighty-one.
describe('PythonProvider.extractImports', () => {
  const provider = new PythonProvider();

  const sourceOf = (source: string): Array<[string, string[], string]> =>
    provider.extractImports(source).map((i) => [i.source, i.names, i.type]);

  it('reads a plain module import and the dotted path it names', () => {
    expect(sourceOf('import os\n')).toEqual([['os', ['os'], 'namespace']]);
    // `import a.b.c` binds `a` and names `a.b.c`; **the edge is to the module**.
    expect(sourceOf('import a.b.c\n')).toEqual([['a.b.c', ['a'], 'namespace']]);
  });

  it('reads an aliased module import as the module, not the alias', () => {
    // `import typing as t` — the module is `typing`, and `t` is what the file calls it afterwards.
    expect(sourceOf('import typing as t\n')).toEqual([['typing', ['typing'], 'namespace']]);
  });

  it('keeps the dots on a relative import, because they name the package', () => {
    expect(sourceOf('from .helpers import A, B\n')).toEqual([['.helpers', ['A', 'B'], 'named']]);
    expect(sourceOf('from ..x.y import z\n')).toEqual([['..x.y', ['z'], 'named']]);
    // `from . import helpers` is a bare dot: the specifier is `.`, and the names are the submodules.
    expect(sourceOf('from . import helpers\n')).toEqual([['.', ['helpers'], 'named']]);
  });

  it('reads names wrapped in parentheses, which a direct-children filter drops', () => {
    // `from urllib.parse import (_url_quote)` put the name inside a parenthesised list, and the first version of this
    // method reported the import with **no names at all**.
    expect(sourceOf('from urllib.parse import (_url_quote, quote)\n')).toEqual([
      ['urllib.parse', ['_url_quote', 'quote'], 'named'],
    ]);
  });

  it('reads a wildcard import as a wildcard rather than as no names', () => {
    expect(sourceOf('from m import *\n')).toEqual([['m', ['*'], 'wildcard']]);
  });

  it('reads an import nested inside a function or a conditional', () => {
    // **A deferred import is still an import**, and it is where a circular dependency is usually broken.
    const nested = 'def f():\n    if True:\n        from . import late\n';
    expect(sourceOf(nested)).toEqual([['.', ['late'], 'named']]);
  });
});

// The statement shapes the taint walk reads, on ordinary Python.
//
// **None of these is exotic**: a bare name, an assignment whose value is a name, and a method call. They were uncovered
// because every fixture in this file is a declaration, and **a provider is judged by what it emits for a statement as
// much as for a `def`**.
describe('PythonProvider statements', () => {
  const provider = new PythonProvider();

  it('records a bare name statement as a use', () => {
    const captures = provider.parse('x\n', 'f.py');
    const uses = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS);

    expect(uses.map((c) => String(c.name))).toEqual(['x']);
  });

  it('records the right-hand side of an assignment as a use of every name it mentions', () => {
    const captures = provider.parse('total = left + right\n', 'f.py');
    const uses = captures
      .filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS)
      .map((c) => String(c.name));

    // The target is a def and the two sources are uses; **a propagator with only the def has nothing to carry taint**.
    expect(uses).toEqual(expect.arrayContaining(['left', 'right']));
  });

  it('names a method call by its method, not by its receiver', () => {
    const captures = provider.parse('session.commit()\n', 'f.py');
    const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_CALL);

    // **`session` is the object, `commit` is the call.** A call named after its receiver joins nothing.
    expect(calls.map((c) => String(c.name))).toEqual(['commit']);
  });
});
