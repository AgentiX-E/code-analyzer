import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { SwiftProvider } from '../languages/swift.js';

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
  });
});
