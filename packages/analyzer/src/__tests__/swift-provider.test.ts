import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';

import { SwiftProvider } from '../languages/swift.js';
import type { ParsedImport } from '../languages/provider.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from '../languages/tree-sitter-base.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// A minimal in-memory TreeSitterSyntaxNode. Used to exercise defensive branches
// that real tree-sitter Swift cannot produce from valid input (a declaration
// without a type_identifier, an `access_modifier` child emitted by other
// tree-sitter versions, etc.).
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
class TestableSwiftProvider extends SwiftProvider {
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

  public checkExportedForTest(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    return this.checkExported(node, symbolName);
  }
}

// Simulates a runtime where the tree-sitter grammar is unavailable, forcing
// the provider onto its regex-based fallback methods.
class NoGrammarSwiftProvider extends SwiftProvider {
  protected override loadGrammar(): TreeSitterLanguage | null {
    return null;
  }
}

describe('SwiftProvider', () => {
  const provider = new SwiftProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('swift');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Swift');
    });

    it('should have .swift extension', () => {
      expect(provider.extensions).toContain('.swift');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — type declarations', () => {
    it('should extract a class', () => {
      const code = 'class Foo {}';
      const captures = provider.parse(code, 't.swift');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should extract a struct', () => {
      const code = 'struct Point { var x: Int }';
      const captures = provider.parse(code, 't.swift');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });

    it('should extract an enum', () => {
      const code = 'enum Color { case red }';
      const captures = provider.parse(code, 't.swift');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should extract an extension', () => {
      const code = 'extension Foo {}';
      const captures = provider.parse(code, 't.swift');
      const exts = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(exts.some((c) => c.name === 'Foo' && c.properties?.isExtension === 'true')).toBe(true);
    });

    it('should extract a protocol', () => {
      const code = 'protocol Drawable {}';
      const captures = provider.parse(code, 't.swift');
      const protos = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(protos.some((c) => c.name === 'Drawable')).toBe(true);
    });

    it('should extract an actor', () => {
      const code = 'actor Counter { var count = 0 }';
      const captures = provider.parse(code, 't.swift');
      const actors = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(actors.some((c) => c.name === 'Counter' && c.properties?.isActor === 'true')).toBe(
        true,
      );
    });

    it('should extract a resultBuilder attribute', () => {
      const code = '@resultBuilder struct Builder {}';
      const captures = provider.parse(code, 't.swift');
      const builders = captures.filter((c) => c.properties?.isResultBuilder === 'true');
      expect(builders.some((c) => c.name === 'Builder')).toBe(true);
    });
  });

  describe('parse — functions and properties', () => {
    it('should extract a function with async/throws', () => {
      const code = 'func greet() async throws {}';
      const captures = provider.parse(code, 't.swift');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet' && c.properties?.isAsync === 'true')).toBe(true);
    });

    it('should mark a throwing function with hasThrows', () => {
      const code = 'func load() throws {}';
      const captures = provider.parse(code, 't.swift');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'load' && c.properties?.hasThrows === 'true')).toBe(true);
    });

    it('should mark a rethrowing function with hasThrows', () => {
      const code = 'func map() rethrows {}';
      const captures = provider.parse(code, 't.swift');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'map' && c.properties?.hasThrows === 'true')).toBe(true);
    });

    it('should leave hasThrows false for a plain function', () => {
      const code = 'func plain() {}';
      const captures = provider.parse(code, 't.swift');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'plain' && c.properties?.hasThrows === 'false')).toBe(
        true,
      );
    });

    it('should extract a variable and constant', () => {
      const code = 'var name: String = "x"\nlet count = 1';
      const captures = provider.parse(code, 't.swift');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
      expect(consts.some((c) => c.name === 'count')).toBe(true);
    });
  });

  describe('parse — imports', () => {
    it('should extract a simple import', () => {
      const code = 'import Foundation';
      const captures = provider.parse(code, 't.swift');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'Foundation')).toBe(true);
    });

    it('should extract a submodule import', () => {
      const code = 'import UIKit.UIViewController';
      const captures = provider.parse(code, 't.swift');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'UIKit.UIViewController')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract module path with last segment as name', () => {
      const code = 'import UIKit.UIViewController';
      const imports = provider.extractImports(code, 't.swift');
      expect(
        imports.some(
          (i) => i.source === 'UIKit.UIViewController' && i.names.includes('UIViewController'),
        ),
      ).toBe(true);
    });
  });

  describe('isExported', () => {
    it('should report a public class as exported', () => {
      expect(provider.isExported('public class Foo {}', 'Foo')).toBe(true);
    });

    it('should report a private class as not exported', () => {
      expect(provider.isExported('private class Bar {}', 'Bar')).toBe(false);
    });

    it('should report an open function as exported', () => {
      expect(provider.isExported('open func setup() {}', 'setup')).toBe(true);
    });

    it('should report a public class as not matching a different symbol', () => {
      expect(provider.isExported('public class Foo {}', 'Bar')).toBe(false);
    });

    it('should report an open struct as exported', () => {
      expect(provider.isExported('open struct Point {}', 'Point')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Real grammar edge cases
  // -------------------------------------------------------------------------

  describe('attribute edge cases (real grammar)', () => {
    it('ignores a non-resultBuilder attribute', () => {
      const code = '@objc class Legacy {}';
      const captures = provider.parse(code, 't.swift');
      const builders = captures.filter((c) => c.properties?.isResultBuilder === 'true');
      expect(builders).toHaveLength(0);
    });

    it('ignores a resultBuilder attribute on a non-class declaration', () => {
      const code = '@resultBuilder func build() {}';
      const captures = provider.parse(code, 't.swift');
      const builders = captures.filter((c) => c.properties?.isResultBuilder === 'true');
      expect(builders).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Fallback methods (grammar unavailable)
// ---------------------------------------------------------------------------

describe('SwiftProvider fallback (grammar unavailable)', () => {
  const provider = new NoGrammarSwiftProvider();

  it('parses functions via regex', () => {
    const captures = provider.parse('func greet() {}', 'f.swift');
    const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(funcs.some((f) => f.name === 'greet')).toBe(true);
  });

  it('parses classes with and without a base class', () => {
    const captures = provider.parse('class Foo: Bar {}\nclass Baz {}', 'f.swift');
    const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(classes.some((c) => c.name === 'Foo' && c.properties?.baseClasses === 'Bar')).toBe(true);
    expect(classes.some((c) => c.name === 'Baz' && c.properties?.baseClasses === '')).toBe(true);
  });

  it('parses structs with and without a base protocol', () => {
    const captures = provider.parse('struct A: Equatable {}\nstruct B {}', 'f.swift');
    const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
    expect(structs.some((c) => c.name === 'A' && c.properties?.baseClasses === 'Equatable')).toBe(
      true,
    );
    expect(structs.some((c) => c.name === 'B' && c.properties?.baseClasses === '')).toBe(true);
  });

  it('parses protocols, enums, and extensions via regex', () => {
    const captures = provider.parse('protocol P {}\nenum E { case a }\nextension E {}', 'f.swift');
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF && c.name === 'P')).toBe(true);
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.ENUM_DEF && c.name === 'E')).toBe(true);
    expect(
      captures.some(
        (c) =>
          c.tag === CAPTURE_TAGS.CLASS_DEF &&
          c.name === 'E' &&
          c.properties?.isExtension === 'true',
      ),
    ).toBe(true);
  });

  it('parses var and let declarations via regex', () => {
    const captures = provider.parse('var x: Int = 1\nlet y = 2', 'f.swift');
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'x')).toBe(true);
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'y')).toBe(true);
  });

  it('extracts imports through the fallback parser', () => {
    const captures = provider.parse('import Foundation\nfunc g() {}', 'f.swift');
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'Foundation')).toBe(
      true,
    );
  });

  it('sorts same-line captures by byte offset', () => {
    const captures = provider.parse('var a = 1; let b = 2;', 'f.swift');
    expect(captures).toHaveLength(2);
    expect(captures[0]!.startByte).toBeLessThan(captures[1]!.startByte);
  });

  it('extracts simple and dotted imports via regex', () => {
    const imports = provider.extractImports('import Foundation\nimport UIKit.UIViewController');
    expect(imports.some((i) => i.source === 'Foundation' && i.names.includes('Foundation'))).toBe(
      true,
    );
    expect(
      imports.some(
        (i) => i.source === 'UIKit.UIViewController' && i.names.includes('UIViewController'),
      ),
    ).toBe(true);
  });

  it('extracts scoped imports via regex', () => {
    const imports = provider.extractImports('import class UIKit.UIView');
    expect(imports.some((i) => i.source === 'UIKit.UIView')).toBe(true);
  });

  it('returns no imports for plain source', () => {
    expect(provider.extractImports('func f() {}')).toHaveLength(0);
  });

  it('detects exported declarations via regex', () => {
    expect(provider.isExported('public func f() {}', 'f')).toBe(true);
    expect(provider.isExported('open class C {}', 'C')).toBe(true);
    expect(provider.isExported('public struct S {}', 'S')).toBe(true);
    expect(provider.isExported('public var v = 1', 'v')).toBe(true);
    expect(provider.isExported('public let l = 1', 'l')).toBe(true);
  });

  it('returns false for non-exported symbols', () => {
    expect(provider.isExported('func f() {}', 'f')).toBe(false);
    expect(provider.isExported('internal class C {}', 'C')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defensive branches exercised with synthetic AST nodes
// ---------------------------------------------------------------------------

describe('SwiftProvider defensive branches (synthetic nodes)', () => {
  const provider = new TestableSwiftProvider();

  describe('checkExported — access modifier variants', () => {
    it('treats a direct access_modifier public child as exported', () => {
      const node = makeNode('class_declaration', [
        makeNode('access_modifier', [], 'public'),
        makeNode('type_identifier', [], 'Foo'),
      ]);
      expect(provider.checkExportedForTest(node, 'Foo')).toBe(true);
    });

    it('treats a direct access_modifier private child as not exported', () => {
      const node = makeNode('class_declaration', [
        makeNode('access_modifier', [], 'private'),
        makeNode('type_identifier', [], 'Foo'),
      ]);
      expect(provider.checkExportedForTest(node, 'Foo')).toBe(false);
    });

    it('treats a direct access_control_modifier open child as exported', () => {
      const node = makeNode('class_declaration', [
        makeNode('access_control_modifier', [], 'open'),
        makeNode('type_identifier', [], 'Foo'),
      ]);
      expect(provider.checkExportedForTest(node, 'Foo')).toBe(true);
    });
  });

  describe('walkAndCapture — declaration without a name', () => {
    it('emits no struct capture for a class_declaration without a type_identifier', () => {
      const node = makeNode('class_declaration', [], 'struct Point {}');
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF)).toEqual([]);
    });

    it('emits no enum capture for a class_declaration without a type_identifier', () => {
      const node = makeNode('class_declaration', [], 'enum Color {}');
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF)).toEqual([]);
    });

    it('emits no extension capture when the user_type is absent', () => {
      const node = makeNode('class_declaration', [], 'extension Foo {}');
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF)).toEqual([]);
    });

    it('emits no extension capture when the user_type has no type_identifier', () => {
      const node = makeNode('class_declaration', [makeNode('user_type', [])], 'extension Foo {}');
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF)).toEqual([]);
    });

    it('emits no actor capture for a class_declaration without a type_identifier', () => {
      const node = makeNode('class_declaration', [], 'actor Counter {}');
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF)).toEqual([]);
    });

    it('emits no class capture for a class_declaration without a type_identifier', () => {
      const node = makeNode('class_declaration', [], 'class Foo {}');
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF)).toEqual([]);
    });

    it('emits no protocol capture for a protocol_declaration without a type_identifier', () => {
      const node = makeNode('protocol_declaration', [], 'protocol P {}');
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF)).toEqual([]);
    });
  });

  describe('walkAndCapture — function name fallback', () => {
    it('falls back to an identifier child when simple_identifier is absent', () => {
      const node = makeNode('function_declaration', [makeNode('identifier', [], 'greet')]);
      const captures = provider.walkAndCaptureForTest(node);
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('greet');
    });

    it('emits no capture for a function with no name at all', () => {
      const node = makeNode('function_declaration', []);
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF)).toEqual([]);
    });
  });

  describe('walkAndCapture — resultBuilder attribute', () => {
    it('resolves the declaration name via an identifier child', () => {
      const decl = makeNode('class_declaration', [makeNode('identifier', [], 'Builder')]);
      const modifiers = makeNode('modifiers', []);
      const attribute = makeNode('attribute', [], '@resultBuilder', modifiers);
      modifiers.parent = decl;
      attribute.parent = modifiers;
      const captures = provider.walkAndCaptureForTest(attribute);
      const builders = captures.filter((c) => c.properties?.isResultBuilder === 'true');
      expect(builders.some((c) => c.name === 'Builder')).toBe(true);
    });

    it('resolves the declaration name via a simple_identifier child', () => {
      const decl = makeNode('class_declaration', [makeNode('simple_identifier', [], 'Builder')]);
      const modifiers = makeNode('modifiers', []);
      const attribute = makeNode('attribute', [], '@resultBuilder', modifiers);
      modifiers.parent = decl;
      attribute.parent = modifiers;
      const captures = provider.walkAndCaptureForTest(attribute);
      const builders = captures.filter((c) => c.properties?.isResultBuilder === 'true');
      expect(builders.some((c) => c.name === 'Builder')).toBe(true);
    });

    it('emits no capture when the declaration has no name', () => {
      const decl = makeNode('class_declaration', []);
      const modifiers = makeNode('modifiers', []);
      const attribute = makeNode('attribute', [], '@resultBuilder', modifiers);
      modifiers.parent = decl;
      attribute.parent = modifiers;
      const captures = provider.walkAndCaptureForTest(attribute);
      expect(captures.filter((c) => c.properties?.isResultBuilder === 'true')).toEqual([]);
    });
  });

  describe('walkAndCapture — property without a name', () => {
    it('emits no capture when the pattern has no simple_identifier', () => {
      const pattern = makeNode('pattern', [makeNode('tuple_pattern', [])]);
      const node = makeNode('property_declaration', [
        makeNode('value_binding_pattern', [], 'var'),
        pattern,
      ]);
      const captures = provider.walkAndCaptureForTest(node);
      expect(
        captures.filter(
          (c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF || c.tag === CAPTURE_TAGS.CONSTANT_DEF,
        ),
      ).toEqual([]);
    });

    it('emits no capture when the property has no pattern at all', () => {
      const node = makeNode('property_declaration', [makeNode('value_binding_pattern', [], 'var')]);
      const captures = provider.walkAndCaptureForTest(node);
      expect(captures).toEqual([]);
    });
  });

  describe('walkAndCapture — import declaration', () => {
    it('resolves the import name from a type_identifier child', () => {
      const node = makeNode('import_declaration', [makeNode('type_identifier', [], 'Foundation')]);
      const captures = provider.walkAndCaptureForTest(node);
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'Foundation')).toBe(true);
    });

    it('falls back to stripping the import keyword when no name node exists', () => {
      const node = makeNode('import_declaration', [], 'import Something');
      const captures = provider.walkAndCaptureForTest(node);
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'Something')).toBe(true);
    });
  });

  describe('walkForImports — import declaration parts', () => {
    it('collects a type_identifier part', () => {
      const node = makeNode('import_declaration', [makeNode('type_identifier', [], 'UIKit')]);
      const imports = provider.walkForImportsForTest(node);
      expect(imports.some((i) => i.source === 'UIKit' && i.names.includes('UIKit'))).toBe(true);
    });

    it('collects a simple_identifier part', () => {
      const node = makeNode('import_declaration', [
        makeNode('simple_identifier', [], 'Foundation'),
      ]);
      const imports = provider.walkForImportsForTest(node);
      expect(imports.some((i) => i.source === 'Foundation')).toBe(true);
    });

    it('returns no import for an import_declaration with no identifier parts', () => {
      const node = makeNode('import_declaration', [makeNode('string', [], '"unused"')]);
      expect(provider.walkForImportsForTest(node)).toEqual([]);
    });
  });
});
