import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { GroovyProvider } from '../languages/groovy.js';

describe('GroovyProvider', () => {
  const provider = new GroovyProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('groovy');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Groovy');
    });

    it('should have .groovy extension', () => {
      expect(provider.extensions).toContain('.groovy');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — classes and traits', () => {
    it('should extract a class with base class', () => {
      const code = 'class Foo extends Bar {}';
      const captures = provider.parse(code, 'Foo.groovy');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Foo' && c.properties?.baseClasses === 'Bar')).toBe(true);
    });

    it('should extract a trait', () => {
      const code = 'trait Named {\n  String getName() { "x" }\n}';
      const captures = provider.parse(code, 't.groovy');
      const traits = captures.filter((c) => c.tag === CAPTURE_TAGS.TRAIT_DEF);
      expect(traits.some((c) => c.name === 'Named')).toBe(true);
    });

    it('should extract an enum', () => {
      const code = 'enum Color { RED, GREEN }';
      const captures = provider.parse(code, 't.groovy');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });
  });

  describe('parse — methods and fields', () => {
    it('should extract a method with container name', () => {
      const code = 'class Foo {\n  def bar() {}\n}';
      const captures = provider.parse(code, 't.groovy');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'bar' && c.properties?.containerName === 'Foo')).toBe(true);
    });

    it('should extract a constructor', () => {
      const code = 'class Foo {\n  Foo() {}\n}';
      const captures = provider.parse(code, 't.groovy');
      const ctors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(ctors.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should extract a field declaration', () => {
      const code = 'class Foo {\n  String name;\n}';
      const captures = provider.parse(code, 't.groovy');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
    });
  });

  describe('parse — imports and calls', () => {
    it('should extract an import', () => {
      const code = 'import groovy.json.JsonSlurper';
      const captures = provider.parse(code, 't.groovy');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'groovy.json.JsonSlurper')).toBe(true);
    });

    it('should extract a method invocation as a call', () => {
      const code = 'def result = foo.bar()';
      const captures = provider.parse(code, 't.groovy');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_CALL);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('parse — closures and gstrings', () => {
    it('should extract a closure', () => {
      const code = 'def c = { x -> x * 2 }';
      const captures = provider.parse(code, 't.groovy');
      const closures = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(closures.some((c) => c.properties?.isClosure === 'true')).toBe(true);
    });

    it('should extract a gstring', () => {
      const code = 'def s = "hello ${name}"';
      const captures = provider.parse(code, 't.groovy');
      const gstrings = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.properties?.isGString === 'true');
      expect(gstrings.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract an annotation', () => {
      const code = '@Grab("x")\nclass A {}';
      const captures = provider.parse(code, 't.groovy');
      const annotations = captures.filter((c) => c.tag === CAPTURE_TAGS.ANNOTATION);
      expect(annotations.some((c) => c.name === 'Grab')).toBe(true);
    });

    it('should extract a comment', () => {
      const code = '// a comment\nclass A {}';
      const captures = provider.parse(code, 't.groovy');
      const comments = captures.filter((c) => c.tag === CAPTURE_TAGS.COMMENT);
      expect(comments.some((c) => c.name === '[comment]')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract import with last segment as name', () => {
      const code = 'import groovy.json.JsonSlurper';
      const imports = provider.extractImports(code, 't.groovy');
      expect(imports.some((i) => i.source === 'groovy.json.JsonSlurper' && i.names.includes('JsonSlurper'))).toBe(true);
    });
  });

  describe('isExported', () => {
    it('reports Groovy defs as exported by default', () => {
      expect(provider.isExported('class Foo {}', 'Foo')).toBe(true);
    });
  });

  describe('taint analysis', () => {
    it('should detect Eval.me as code_injection source', () => {
      const sources = provider.extractTaintSources('def x = Eval.me(script)');
      expect(sources.some((s) => s.sourceType === 'code_injection')).toBe(true);
    });

    it('should detect request as user_input source', () => {
      const sources = provider.extractTaintSources('def x = request.getParameter("x")');
      expect(sources.some((s) => s.sourceType === 'user_input')).toBe(true);
    });

    it('should detect GroovyShell as code_injection sink', () => {
      const sinks = provider.extractTaintSinks('new GroovyShell().evaluate(script)');
      expect(sinks.some((s) => s.sinkType === 'code_injection')).toBe(true);
    });

    it('should detect execute as sql_exec sink', () => {
      const sinks = provider.extractTaintSinks('sql.execute(query)');
      expect(sinks.some((s) => s.sinkType === 'sql_exec')).toBe(true);
    });

    it('should detect write as file_write sink', () => {
      const sinks = provider.extractTaintSinks('file.write(data)');
      expect(sinks.some((s) => s.sinkType === 'file_write')).toBe(true);
    });

    it('should detect encodeAsHTML as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('def y = x.encodeAsHTML()');
      expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);
    });
  });
});
