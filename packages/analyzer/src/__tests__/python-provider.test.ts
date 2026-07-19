import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { PythonProvider } from '../languages/python.js';

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

    it('should detect class with base classes', () => {
      const source = `class Dog(Animal, Pet):\n    pass`;
      const captures = provider.parse(source, 'test.py');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Dog');
    });

    it('should detect decorators', () => {
      const source = `@staticmethod\ndef foo():\n    pass`;
      const captures = provider.parse(source, 'test.py');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.properties?.['decorator']).toBeDefined();
    });

    it('should detect triple-quoted docstrings', () => {
      const source = `"""Module docstring"""\n\ndef foo():\n    """Function docstring"""\n    pass`;
      const captures = provider.parse(source, 'test.py');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect imports', () => {
      const source = `import os\nimport sys\nfrom typing import List`;
      const captures = provider.parse(source, 'test.py');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBe(3);
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
  });

  describe('isExported', () => {
    it('should return true for public symbols (no underscore prefix)', () => {
      expect(provider.isExported('def public_func(): pass', 'public_func')).toBe(true);
    });

    it('should return false for private symbols (_ prefix)', () => {
      expect(provider.isExported('def _private(): pass', '_private')).toBe(false);
    });

    it('should consider __all__ list', () => {
      const source = '__all__ = ["foo", "bar"]';
      expect(provider.isExported(source, 'foo')).toBe(true);
      expect(provider.isExported(source, 'baz')).toBe(false);
    });

    it('should return true for dunder methods (__ prefix)', () => {
      expect(provider.isExported('def __init__(self): pass', '__init__')).toBe(true);
    });

    it('should return true when __all__ is not present', () => {
      expect(provider.isExported('def normal_func(): pass', 'normal_func')).toBe(true);
    });
  });

  describe('_lineNumberAt', () => {
    it('should return line number for offset', () => {
      const source = 'line1\nline2\nline3';
      expect(provider._lineNumberAt(source, 0)).toBe(1);
      expect(provider._lineNumberAt(source, 6)).toBe(2);
      expect(provider._lineNumberAt(source, 12)).toBe(3);
    });
  });

  describe('extractImports edge cases', () => {
    it('should parse from import with alias', () => {
      const source = 'from os import path as p';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('os');
      expect(imports[0]!.names).toContain('path');
    });

    it('should parse import with inline comment', () => {
      const source = 'import os  # system module';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('os');
    });

    it('should parse import with multiple comma-separated modules', () => {
      const source = 'import os, sys, json';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(3);
      expect(imports[0]!.source).toBe('os');
      expect(imports[1]!.source).toBe('sys');
      expect(imports[2]!.source).toBe('json');
    });
  });

  describe('decorator parsing', () => {
    it('should detect decorator with arguments', () => {
      const source = '@app.route("/path")\ndef handler():\n    pass';
      const captures = provider.parse(source, 'test.py');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.properties?.['decorator']).toBe('app.route');
    });

    it('should detect multiple decorators', () => {
      const source = '@staticmethod\n@classmethod\ndef foo():\n    pass';
      const captures = provider.parse(source, 'test.py');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(2);
    });

    it('should detect dotted decorator', () => {
      const source = '@module.decorator\ndef func():\n    pass';
      const captures = provider.parse(source, 'test.py');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.properties?.['decorator']).toBe('module.decorator');
    });
  });

  describe('docstring edge cases', () => {
    it('should handle single-quoted docstrings', () => {
      const source = "'''Module docstring'''\ndef foo():\n    pass";
      const captures = provider.parse(source, 'test.py');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('function edge cases', () => {
    it('should handle function with string parameters', () => {
      const source = 'def greet(name="world"):\n    print(f"Hello {name}")';
      const captures = provider.parse(source, 'test.py');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('greet');
    });

    it('should handle function with complex default args', () => {
      const source = 'def process(data, options=None, format="json"):\n    pass';
      const captures = provider.parse(source, 'test.py');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('process');
    });

    it('should handle function with annotations and return type', () => {
      const source = 'def add(a: int, b: int) -> int:\n    return a + b';
      const captures = provider.parse(source, 'test.py');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('add');
    });

    it('should handle class with no explicit methods', () => {
      const source = 'class EmptyClass:\n    """Just an empty class"""\n    pass';
      const captures = provider.parse(source, 'test.py');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('EmptyClass');
    });
  });

  describe('block indent edge cases', () => {
    it('should handle nested function', () => {
      const source = 'def outer():\n    def inner():\n        return 1\n    return inner()';
      const captures = provider.parse(source, 'test.py');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(2);
      expect(funcs.some((f) => f.name === 'outer')).toBe(true);
      expect(funcs.some((f) => f.name === 'inner')).toBe(true);
    });

    it('should handle top-level function ending at EOF', () => {
      const source = 'def last_func():\n    return 42';
      const captures = provider.parse(source, 'test.py');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'last_func');
      expect(funcs).toHaveLength(1);
    });

    it('should handle class followed by top-level code', () => {
      const source = 'class MyClass:\n    x = 1\n\ntop_level = "after class"';
      const captures = provider.parse(source, 'test.py');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('MyClass');
    });

    it('should handle empty-bodied class/function followed by top-level code', () => {
      const source = 'class Empty:\n\nnext_func = "after empty class"';
      const captures = provider.parse(source, 'test.py');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Empty');
    });
  });
});
