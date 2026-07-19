// @code-analyzer/shared — Capture Tag Tests
import { describe, it, expect } from 'vitest';

import { CAPTURE_TAGS } from '../index.js';

import type { CaptureTag, UnifiedCapture } from '../index.js';

// ---------------------------------------------------------------------------
// Enumerate all tag values for exhaustive coverage
// ---------------------------------------------------------------------------

const ALL_TAGS: CaptureTag[] = Object.values(CAPTURE_TAGS);

describe('CaptureTag constants', () => {
  describe('definitions', () => {
    it('FUNCTION_DEF is "function.def"', () => {
      expect(CAPTURE_TAGS.FUNCTION_DEF).toBe('function.def');
    });
    it('METHOD_DEF is "method.def"', () => {
      expect(CAPTURE_TAGS.METHOD_DEF).toBe('method.def');
    });
    it('CLASS_DEF is "class.def"', () => {
      expect(CAPTURE_TAGS.CLASS_DEF).toBe('class.def');
    });
    it('INTERFACE_DEF is "interface.def"', () => {
      expect(CAPTURE_TAGS.INTERFACE_DEF).toBe('interface.def');
    });
    it('ENUM_DEF is "enum.def"', () => {
      expect(CAPTURE_TAGS.ENUM_DEF).toBe('enum.def');
    });
    it('TYPE_DEF is "type.def"', () => {
      expect(CAPTURE_TAGS.TYPE_DEF).toBe('type.def');
    });
    it('VARIABLE_DEF is "variable.def"', () => {
      expect(CAPTURE_TAGS.VARIABLE_DEF).toBe('variable.def');
    });
    it('CONSTANT_DEF is "constant.def"', () => {
      expect(CAPTURE_TAGS.CONSTANT_DEF).toBe('constant.def');
    });
    it('PROPERTY_DEF is "property.def"', () => {
      expect(CAPTURE_TAGS.PROPERTY_DEF).toBe('property.def');
    });
    it('CONSTRUCTOR_DEF is "constructor.def"', () => {
      expect(CAPTURE_TAGS.CONSTRUCTOR_DEF).toBe('constructor.def');
    });
    it('STRUCT_DEF is "struct.def"', () => {
      expect(CAPTURE_TAGS.STRUCT_DEF).toBe('struct.def');
    });
    it('TRAIT_DEF is "trait.def"', () => {
      expect(CAPTURE_TAGS.TRAIT_DEF).toBe('trait.def');
    });
  });

  describe('references', () => {
    it('FUNCTION_CALL is "function.call"', () => {
      expect(CAPTURE_TAGS.FUNCTION_CALL).toBe('function.call');
    });
    it('METHOD_CALL is "method.call"', () => {
      expect(CAPTURE_TAGS.METHOD_CALL).toBe('method.call');
    });
    it('NEW_EXPRESSION is "new.expression"', () => {
      expect(CAPTURE_TAGS.NEW_EXPRESSION).toBe('new.expression');
    });
    it('TYPE_REFERENCE is "type.reference"', () => {
      expect(CAPTURE_TAGS.TYPE_REFERENCE).toBe('type.reference');
    });
    it('VARIABLE_ACCESS is "variable.access"', () => {
      expect(CAPTURE_TAGS.VARIABLE_ACCESS).toBe('variable.access');
    });
  });

  describe('imports', () => {
    it('IMPORT is "import"', () => {
      expect(CAPTURE_TAGS.IMPORT).toBe('import');
    });
    it('IMPORT_NAMED is "import.named"', () => {
      expect(CAPTURE_TAGS.IMPORT_NAMED).toBe('import.named');
    });
    it('IMPORT_WILDCARD is "import.wildcard"', () => {
      expect(CAPTURE_TAGS.IMPORT_WILDCARD).toBe('import.wildcard');
    });
    it('IMPORT_DEFAULT is "import.default"', () => {
      expect(CAPTURE_TAGS.IMPORT_DEFAULT).toBe('import.default');
    });
  });

  describe('annotations & metadata', () => {
    it('DECORATOR is "decorator"', () => {
      expect(CAPTURE_TAGS.DECORATOR).toBe('decorator');
    });
    it('ANNOTATION is "annotation"', () => {
      expect(CAPTURE_TAGS.ANNOTATION).toBe('annotation');
    });
  });

  describe('documentation', () => {
    it('DOCSTRING is "docstring"', () => {
      expect(CAPTURE_TAGS.DOCSTRING).toBe('docstring');
    });
    it('COMMENT is "comment"', () => {
      expect(CAPTURE_TAGS.COMMENT).toBe('comment');
    });
  });

  describe('framework-specific', () => {
    it('ROUTE_PATH is "route.path"', () => {
      expect(CAPTURE_TAGS.ROUTE_PATH).toBe('route.path');
    });
    it('ROUTE_METHOD is "route.method"', () => {
      expect(CAPTURE_TAGS.ROUTE_METHOD).toBe('route.method');
    });
    it('DI_INJECT is "di.inject"', () => {
      expect(CAPTURE_TAGS.DI_INJECT).toBe('di.inject');
    });
    it('DI_PROVIDE is "di.provide"', () => {
      expect(CAPTURE_TAGS.DI_PROVIDE).toBe('di.provide');
    });
    it('COMPONENT_PROPS is "component.props"', () => {
      expect(CAPTURE_TAGS.COMPONENT_PROPS).toBe('component.props');
    });
    it('COMPONENT_EMITS is "component.emits"', () => {
      expect(CAPTURE_TAGS.COMPONENT_EMITS).toBe('component.emits');
    });
  });

  describe('completeness', () => {
    it('every tag value is unique', () => {
      const values = Object.values(CAPTURE_TAGS);
      expect(new Set(values).size).toBe(values.length);
    });

    it('exactly 31 tags exist', () => {
      expect(Object.keys(CAPTURE_TAGS)).toHaveLength(31);
    });

    it('all tags follow dot-separated lowercase pattern or single word', () => {
      for (const tag of Object.values(CAPTURE_TAGS)) {
        expect(tag).toMatch(/^[a-z]+(\.[a-z]+)*$/);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// UnifiedCapture — structural validation
// ---------------------------------------------------------------------------

describe('UnifiedCapture', () => {
  const makeCapture = (overrides: Partial<UnifiedCapture> = {}): UnifiedCapture => ({
    tag: CAPTURE_TAGS.FUNCTION_DEF,
    text: 'function hello() {}',
    startLine: 1,
    endLine: 3,
    startByte: 0,
    endByte: 20,
    name: 'hello',
    ...overrides,
  });

  it('can be created with minimal fields', () => {
    const cap = makeCapture();
    expect(cap.tag).toBe('function.def');
    expect(cap.text).toBe('function hello() {}');
    expect(cap.startLine).toBe(1);
    expect(cap.endLine).toBe(3);
  });

  it('optional fields default correctly', () => {
    const cap: UnifiedCapture = {
      tag: CAPTURE_TAGS.CLASS_DEF,
      text: 'class Foo',
      startLine: 1,
      endLine: 1,
      startByte: 0,
      endByte: 9,
    };
    expect(cap.name).toBeUndefined();
    expect(cap.containerName).toBeUndefined();
    expect(cap.properties).toBeUndefined();
  });

  it('uses all tag variants', () => {
    for (const tag of ALL_TAGS) {
      const cap: UnifiedCapture = {
        tag,
        text: 'x',
        startLine: 1,
        endLine: 1,
        startByte: 0,
        endByte: 1,
      };
      expect(cap.tag).toBe(tag);
    }
  });

  it('name field stores identifier', () => {
    const cap = makeCapture({ name: 'myFunction' });
    expect(cap.name).toBe('myFunction');
  });

  it('containerName field stores parent context', () => {
    const cap = makeCapture({ containerName: 'MyClass' });
    expect(cap.containerName).toBe('MyClass');
  });

  it('properties field stores extra metadata', () => {
    const cap = makeCapture({ properties: { kind: 'async', returns: 'void' } });
    expect(cap.properties).toEqual({ kind: 'async', returns: 'void' });
  });

  it('captures varying startLine and endLine', () => {
    const cap = makeCapture({ startLine: 10, endLine: 25 });
    expect(cap.startLine).toBe(10);
    expect(cap.endLine).toBe(25);
  });
});
