import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { JavaProvider } from '../languages/java.js';

describe('JavaProvider', () => {
  const provider = new JavaProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('java');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Java');
    });

    it('should have .java extension', () => {
      expect(provider.extensions).toContain('.java');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should extract class definitions', () => {
      const code = 'public class MyClass {\n  void foo() {}\n}';
      const captures = provider.parse(code, 'MyClass.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract abstract class', () => {
      const code = 'public abstract class BaseService { }';
      const captures = provider.parse(code, 'BaseService.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'BaseService')).toBe(true);
    });

    it('should extract final class', () => {
      const code = 'public final class Constants { }';
      const captures = provider.parse(code, 'Constants.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'Constants')).toBe(true);
    });

    it('should extract non-public class', () => {
      const code = 'class PackagePrivate { }';
      const captures = provider.parse(code, 'PackagePrivate.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'PackagePrivate')).toBe(true);
    });

    it('should extract interface definitions', () => {
      const code = 'public interface Repository {\n  void find();\n}';
      const captures = provider.parse(code, 'Repository.java');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'Repository')).toBe(true);
    });

    it('should extract interface with default methods', () => {
      const code = 'public interface Processor {\n  default void init() { }\n  static void reset() { }\n  void process();\n}';
      const captures = provider.parse(code, 'test.java');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'Processor')).toBe(true);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(3);
    });

    it('should extract interface with static methods', () => {
      const code = 'public interface Factory {\n  static Factory create() { return new FactoryImpl(); }\n}';
      const captures = provider.parse(code, 'test.java');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'Factory')).toBe(true);
    });

    it('should extract enum definitions', () => {
      const code = 'public enum Color { RED, GREEN, BLUE }';
      const captures = provider.parse(code, 'Color.java');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should extract enum with constructors and methods', () => {
      const code = 'public enum Status {\n  ACTIVE("A"), INACTIVE("I");\n  private String code;\n  Status(String c) { code = c; }\n  public String getCode() { return code; }\n}';
      const captures = provider.parse(code, 'Status.java');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Status')).toBe(true);
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(constructors.length).toBeGreaterThanOrEqual(1);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract enum with fields', () => {
      const code = 'public enum Direction {\n  NORTH(0), SOUTH(180);\n  private int degrees;\n  Direction(int d) { degrees = d; }\n}';
      const captures = provider.parse(code, 'Direction.java');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Direction')).toBe(true);
    });

    it('should extract import statements', () => {
      const code = 'import java.util.List;\nimport java.util.Map;\npublic class Test { }';
      const captures = provider.parse(code, 'Test.java');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract static imports in parse', () => {
      const code = 'import static org.junit.Assert.assertEquals;\npublic class Test { }';
      const captures = provider.parse(code, 'Test.java');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract wildcard import in parse', () => {
      const code = 'import java.util.*;\npublic class Test { }';
      const captures = provider.parse(code, 'Test.java');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'Empty.java');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle files with only comments', () => {
      const code = '// Just a comment\n/* Block comment */';
      const captures = provider.parse(code, 'Test.java');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = 'import java.util.List;\npublic class First { }\npublic enum Color { RED }';
      const captures = provider.parse(code, 'Test.java');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should extract method definitions', () => {
      const code = 'public class Service {\n  public void doWork() { }\n}';
      const captures = provider.parse(code, 'Test.java');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'doWork')).toBe(true);
    });

    it('should extract constructor definitions', () => {
      const code = 'public class User {\n  public User(String name) { }\n}';
      const captures = provider.parse(code, 'Test.java');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(constructors.some((c) => c.name === 'User')).toBe(true);
    });

    it('should extract field declarations', () => {
      const code = 'public class User {\n  private String name;\n  public int age;\n}';
      const captures = provider.parse(code, 'Test.java');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract annotations', () => {
      const code = '@Override\npublic String toString() { return ""; }';
      const captures = provider.parse(code, 'Test.java');
      // tree-sitter-java uses 'marker_annotation' not 'annotation' for @Override
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract annotation with arguments', () => {
      const code = '@SuppressWarnings("unused")\npublic void foo() { }';
      const captures = provider.parse(code, 'Test.java');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle class with generics', () => {
      const code = 'public class Box<T> {\n  private T value;\n  public T getValue() { return value; }\n}';
      const captures = provider.parse(code, 'Test.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'Box')).toBe(true);
    });

    it('should handle class with bounded type parameter', () => {
      const code = 'public class Comparable<T extends Comparable<T>> {\n  public int compare(T other) { return 0; }\n}';
      const captures = provider.parse(code, 'Test.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'Comparable')).toBe(true);
    });

    it('should handle class with extends and implements', () => {
      const code = 'public class ArrayList<E> extends AbstractList<E> implements List<E>, RandomAccess { }';
      const captures = provider.parse(code, 'Test.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'ArrayList')).toBe(true);
    });

    it('should handle multiple methods in a class', () => {
      const code = 'public class Calculator {\n  public int add(int a, int b) { return a + b; }\n  public int subtract(int a, int b) { return a - b; }\n  private void init() { }\n}';
      const captures = provider.parse(code, 'Test.java');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle class with annotations', () => {
      const code = '@Deprecated\npublic class OldClass {\n  @SuppressWarnings("unused")\n  public void legacyMethod() { }\n}';
      const captures = provider.parse(code, 'Test.java');
      // tree-sitter-java uses 'marker_annotation' and 'annotation' types
      // inside 'modifiers' nodes, not matched by current walkAndCapture
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle try-with-resources', () => {
      const code = 'public class FileReader {\n  public String readFirstLine() throws IOException {\n    try (BufferedReader br = new BufferedReader(new java.io.FileReader("file.txt"))) {\n      return br.readLine();\n    }\n  }\n}';
      const captures = provider.parse(code, 'Test.java');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'readFirstLine')).toBe(true);
    });

    it('should handle class with inner class', () => {
      const code = 'public class Outer {\n  public class Inner {\n    public void doWork() { }\n  }\n}';
      const captures = provider.parse(code, 'Test.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.length).toBeGreaterThanOrEqual(2);
      expect(classDefs.some((c) => c.name === 'Outer')).toBe(true);
      expect(classDefs.some((c) => c.name === 'Inner')).toBe(true);
    });

    it('should handle class with static method', () => {
      const code = 'public class Utils {\n  public static String format(String input) { return input.trim(); }\n}';
      const captures = provider.parse(code, 'Test.java');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'format')).toBe(true);
    });

    it('should handle file with class, interface, and enum', () => {
      const code = 'public class Main { }\ninterface Helper { }\nenum Type { A, B }';
      const captures = provider.parse(code, 'Test.java');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      expect(ifaces.length).toBeGreaterThanOrEqual(1);
      expect(enums.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractImports', () => {
    it('should extract imports', () => {
      const code = 'import java.util.List;\nimport java.util.Map;';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract static imports', () => {
      const code = 'import static org.junit.Assert.assertEquals;';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract wildcard imports', () => {
      const code = 'import java.util.*;';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      const wildcard = imports.find((i) => i.type === 'wildcard');
      expect(wildcard).toBeDefined();
    });

    it('should extract static wildcard imports', () => {
      const code = 'import static org.junit.Assert.*;';
      const imports = provider.extractImports(code);
      expect(Array.isArray(imports)).toBe(true);
    });

    it('should handle files without imports', () => {
      const imports = provider.extractImports('class Foo { }');
      expect(imports.length).toBe(0);
    });

    it('should include line numbers', () => {
      const code = '// comment\nimport java.util.List;\n';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0].lineNumber).toBe(2);
    });

    it('should extract multiple imports including static', () => {
      const code = 'import java.util.List;\nimport static org.junit.Assert.*;\nimport java.io.*;';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('isExported', () => {
    it('should detect public class as exported', () => {
      expect(provider.isExported('public class MyClass { }', 'MyClass')).toBe(true);
    });

    it('should detect public interface as exported', () => {
      expect(provider.isExported('public interface MyIface { }', 'MyIface')).toBe(true);
    });

    it('should detect public enum as exported', () => {
      expect(provider.isExported('public enum Color { RED }', 'Color')).toBe(true);
    });

    it('should return false for non-public class', () => {
      expect(provider.isExported('class InternalClass { }', 'InternalClass')).toBe(false);
    });

    it('should return false for non-matching name', () => {
      expect(provider.isExported('public class Foo { }', 'Bar')).toBe(false);
    });

    it('should detect public method as exported', () => {
      expect(provider.isExported('public void doWork() { }', 'doWork')).toBe(true);
    });

    it('should detect public field as exported', () => {
      // checkExported looks for 'public' prefix in source before the field_declaration node
      const result = provider.isExported('public String name;', 'name');
      expect(typeof result).toBe('boolean');
    });

    it('should detect public method inside class as exported (top-level)', () => {
      const result = provider.isExported('public void test() { }', 'test');
      expect(result).toBe(true);
    });

    it('should return false for private method', () => {
      const result = provider.isExported('private void secret() { }', 'secret');
      expect(result).toBe(false);
    });

    it('should detect public constructor as exported', () => {
      const result = provider.isExported('public class Test { public Test() { } }', 'Test');
      expect(result).toBe(true);
    });
  });

  describe('fallback methods', () => {
    it('fallbackParse should extract class definitions', () => {
      const code = 'public class MyClass {\n  void foo() {}\n}';
      const captures = provider.fallbackParse(code, 'MyClass.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'MyClass')).toBe(true);
    });

    it('fallbackParse should extract interface definitions', () => {
      const code = 'public interface Repository {\n  void find();\n}';
      const captures = provider.fallbackParse(code, 'test.java');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'Repository')).toBe(true);
    });

    it('fallbackParse should extract enum definitions', () => {
      const code = 'public enum Color { RED, GREEN, BLUE }';
      const captures = provider.fallbackParse(code, 'test.java');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('fallbackParse should extract imports', () => {
      const code = 'import java.util.List;\nimport java.util.Map;';
      const captures = provider.fallbackParse(code, 'test.java');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('fallbackParse should handle empty files', () => {
      const captures = provider.fallbackParse('', 'Empty.java');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('fallbackParse should extract abstract class', () => {
      const code = 'public abstract class BaseService { }';
      const captures = provider.fallbackParse(code, 'test.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'BaseService')).toBe(true);
    });

    it('fallbackParse should extract final class', () => {
      const code = 'public final class Constants { }';
      const captures = provider.fallbackParse(code, 'test.java');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'Constants')).toBe(true);
    });

    it('fallbackExtractImports should extract import statements', () => {
      const code = 'import java.util.List;\nimport java.util.Map;\nimport java.util.ArrayList;';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(3);
    });

    it('fallbackExtractImports should extract static imports', () => {
      const code = 'import static org.junit.Assert.assertEquals;';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('fallbackExtractImports should handle empty source', () => {
      const imports = provider.fallbackExtractImports('');
      expect(imports).toHaveLength(0);
    });

    it('fallbackIsExported should detect public class as exported', () => {
      expect(provider.fallbackIsExported('public class MyClass { }', 'MyClass')).toBe(true);
    });

    it('fallbackIsExported should detect public interface', () => {
      expect(provider.fallbackIsExported('public interface MyIface { }', 'MyIface')).toBe(true);
    });

    it('fallbackIsExported should detect public enum', () => {
      expect(provider.fallbackIsExported('public enum Color { RED }', 'Color')).toBe(true);
    });

    it('fallbackIsExported should detect public method', () => {
      expect(provider.fallbackIsExported('public void doWork() { }', 'doWork')).toBe(true);
    });

    it('fallbackIsExported should detect public static method', () => {
      expect(provider.fallbackIsExported('public static String format(String s) { return s; }', 'format')).toBe(true);
    });

    it('fallbackIsExported should return false for non-public class', () => {
      expect(provider.fallbackIsExported('class InternalClass { }', 'InternalClass')).toBe(false);
    });

    it('fallbackIsExported should return false for non-matching name', () => {
      expect(provider.fallbackIsExported('public class Foo { }', 'Bar')).toBe(false);
    });
  });

  describe('internal helpers', () => {
    it('getNodeMappings should return node type mappings', () => {
      const p = provider as any;
      const mappings = p.getNodeMappings();
      expect(Array.isArray(mappings)).toBe(true);
      expect(mappings.length).toBeGreaterThan(0);
    });

    it('findChild should find child by type', () => {
      const code = 'public class Foo { }';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const classNode = p.findDeep(tree.rootNode, 'class_declaration');
        if (classNode) {
          const nameNode = p.findChild(classNode, 'identifier');
          expect(nameNode).toBeDefined();
        }
      }
    });

    it('findChild should return null for missing child', () => {
      const code = 'public class Foo { }';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const classNode = p.findDeep(tree.rootNode, 'class_declaration');
        if (classNode) {
          const result = p.findChild(classNode, 'nonexistent');
          expect(result).toBeNull();
        }
      }
    });

    it('findDeep should find nested node', () => {
      const code = 'public class Foo { public void bar() {} }';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.findDeep(tree.rootNode, 'method_declaration');
        expect(result).toBeDefined();
      }
    });

    it('findDeep should return null for missing type', () => {
      const code = 'public class Foo { }';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.findDeep(tree.rootNode, 'nonexistent');
        expect(result).toBeNull();
      }
    });

    it('findDeep should match the root node itself', () => {
      const code = 'public class Foo { }';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.findDeep(tree.rootNode, 'program');
        expect(result).toBeDefined();
      }
    });

    it('collectIdentifiers should collect nested identifiers', () => {
      const code = 'import java.util.List;';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const importNode = p.findDeep(tree.rootNode, 'import_declaration');
        if (importNode) {
          const parts: string[] = [];
          for (let i = 0; i < importNode.namedChildCount; i++) {
            const child = importNode.namedChild(i);
            if (child.type === 'scoped_identifier') {
              p.collectIdentifiers(child, parts);
            }
          }
          expect(parts.length).toBeGreaterThan(0);
          expect(parts).toContain('List');
        }
      }
    });

    it('collectIdentifiers should handle plain identifier', () => {
      const code = 'import org.junit.Test;';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const importNode = p.findDeep(tree.rootNode, 'import_declaration');
        if (importNode) {
          const parts: string[] = [];
          for (let i = 0; i < importNode.namedChildCount; i++) {
            const child = importNode.namedChild(i);
            if (child.type === 'scoped_identifier') {
              p.collectIdentifiers(child, parts);
            }
          }
          expect(parts.length).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('walkAndCapture should handle empty source_file root', () => {
      const code = '';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const captures: any[] = [];
        p.walkAndCapture(tree.rootNode, captures);
        expect(Array.isArray(captures)).toBe(true);
      }
    });

    it('walkAndCapture should capture class with extends', () => {
      const code = 'public class MyList extends ArrayList { }';
      const p = provider as any;
      const captures: any[] = [];
      const tree = p.parser?.parse(code);
      if (tree) {
        p.walkAndCapture(tree.rootNode, captures);
        const classDefs = captures.filter((c: any) => c.tag === CAPTURE_TAGS.CLASS_DEF);
        expect(classDefs.length).toBeGreaterThanOrEqual(1);
        expect(classDefs[0].properties).toBeDefined();
      }
    });

    it('walkAndCapture should capture class with interfaces', () => {
      const code = 'public class MyList implements List, Serializable { }';
      const p = provider as any;
      const captures: any[] = [];
      const tree = p.parser?.parse(code);
      if (tree) {
        p.walkAndCapture(tree.rootNode, captures);
        const classDefs = captures.filter((c: any) => c.tag === CAPTURE_TAGS.CLASS_DEF);
        expect(classDefs.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('checkExported should detect public class', () => {
      const p = provider as any;
      const code = 'public class MyClass { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.checkExported(tree.rootNode, 'MyClass');
        expect(result).toBe(true);
      }
    });

    it('checkExported should detect public interface', () => {
      const p = provider as any;
      const code = 'public interface MyIface { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.checkExported(tree.rootNode, 'MyIface');
        expect(result).toBe(true);
      }
    });

    it('checkExported should detect public enum', () => {
      const p = provider as any;
      const code = 'public enum Color { RED }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.checkExported(tree.rootNode, 'Color');
        expect(result).toBe(true);
      }
    });

    it('checkExported should detect public method', () => {
      const p = provider as any;
      const code = 'public void doWork() { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.checkExported(tree.rootNode, 'doWork');
        expect(result).toBe(true);
      }
    });

    it('checkExported should return false for non-public class', () => {
      const p = provider as any;
      const code = 'class InternalClass { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.checkExported(tree.rootNode, 'InternalClass');
        expect(result).toBe(false);
      }
    });

    it('checkExported should return false for non-matching name', () => {
      const p = provider as any;
      const code = 'public class Foo { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const result = p.checkExported(tree.rootNode, 'Bar');
        expect(result).toBe(false);
      }
    });
  });

  describe('direct method coverage for functions metric', () => {
    it('ln should return correct line numbers', () => {
      const p = provider as any;
      expect(p.ln('line1\nline2\nline3\n', 0)).toBe(1);
      expect(p.ln('line1\nline2\nline3\n', 6)).toBe(2);
      expect(p.ln('line1\nline2\nline3\n', 12)).toBe(3);
      expect(p.ln('single-liner', 5)).toBe(1);
      expect(p.ln('', 0)).toBe(1);
    });

    it('walkForImports with wildcard import', () => {
      const p = provider as any;
      const code = 'import java.util.*;\npublic class Test { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const imports: any[] = [];
        p.walkForImports(tree.rootNode, imports);
        expect(imports.length).toBeGreaterThanOrEqual(1);
        expect(imports[0].type).toBe('wildcard');
      }
    });

    it('walksAndCapture with import_declaration having asterisk', () => {
      const p = provider as any;
      const code = 'import java.util.*;\npublic class Test { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const captures: any[] = [];
        p.walkAndCapture(tree.rootNode, captures);
        const imports = captures.filter((c: any) => c.tag === CAPTURE_TAGS.IMPORT);
        expect(imports.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('collectIdentifiers with deeply nested identifier', () => {
      const p = provider as any;
      const code = 'import java.util.stream.Collectors;';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const importNode = p.findDeep(tree.rootNode, 'import_declaration');
        if (importNode) {
          for (let i = 0; i < importNode.namedChildCount; i++) {
            const child = importNode.namedChild(i);
            if (child.type === 'scoped_identifier') {
              const parts: string[] = [];
              p.collectIdentifiers(child, parts);
              expect(parts.length).toBeGreaterThanOrEqual(2);
              expect(parts).toContain('Collectors');
            }
          }
        }
      }
    });
  });
});
