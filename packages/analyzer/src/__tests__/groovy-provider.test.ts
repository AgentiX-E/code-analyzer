import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { GroovyProvider } from '../languages/groovy.js';

/**
 * A GroovyProvider with the tree-sitter parser disabled, forcing the public
 * entry points to take their regex fallback paths. `parser`/`languageGrammar`
 * are protected, so the subclass can null them after construction.
 */
class RegexGroovyProvider extends GroovyProvider {
  constructor() {
    super();
    this.parser = null;
    this.languageGrammar = null;
  }
}

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
      expect(classes.some((c) => c.name === 'Foo' && c.properties?.baseClasses === 'Bar')).toBe(
        true,
      );
    });

    it('should extract a class implementing an interface', () => {
      const code = 'class Foo implements Runnable {}';
      const captures = provider.parse(code, 'Foo.groovy');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(
        classes.some((c) => c.name === 'Foo' && c.properties?.baseClasses === 'Runnable'),
      ).toBe(true);
    });

    it('should extract a trait', () => {
      const code = 'trait Named {\n  String getName() { "x" }\n}';
      const captures = provider.parse(code, 't.groovy');
      const traits = captures.filter((c) => c.tag === CAPTURE_TAGS.TRAIT_DEF);
      expect(traits.some((c) => c.name === 'Named')).toBe(true);
    });

    it('should extract an empty-body trait via the AST walker', () => {
      // A trait with a method body triggers a parse ERROR and is handled by the
      // regex fallback; an empty body parses cleanly and reaches walkAndCapture.
      const captures = provider.parse('trait Named {}', 't.groovy');
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
      expect(methods.some((c) => c.name === 'bar' && c.properties?.containerName === 'Foo')).toBe(
        true,
      );
    });

    it('should extract a top-level method with an empty container name', () => {
      const captures = provider.parse('void run() {}', 't.groovy');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'run' && c.properties?.containerName === '')).toBe(
        true,
      );
    });

    it('should flag a method named like its enclosing class as a constructor', () => {
      const captures = provider.parse('class Foo { def Foo() {} }', 't.groovy');
      const ctors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(ctors.some((c) => c.name === 'Foo')).toBe(true);
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

  describe('parse — closures, gstrings and comments', () => {
    it('should extract a closure', () => {
      const code = 'def c = { x -> x * 2 }';
      const captures = provider.parse(code, 't.groovy');
      const closures = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(closures.some((c) => c.properties?.isClosure === 'true')).toBe(true);
    });

    it('should extract a gstring', () => {
      const code = 'def s = "hello ${name}"';
      const captures = provider.parse(code, 't.groovy');
      const gstrings = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.properties?.isGString === 'true',
      );
      expect(gstrings.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract an annotation', () => {
      const code = '@Grab("x")\nclass A {}';
      const captures = provider.parse(code, 't.groovy');
      const annotations = captures.filter((c) => c.tag === CAPTURE_TAGS.ANNOTATION);
      expect(annotations.some((c) => c.name === 'Grab')).toBe(true);
    });

    it('should extract a line comment', () => {
      const code = '// a comment\nclass A {}';
      const captures = provider.parse(code, 't.groovy');
      const comments = captures.filter((c) => c.tag === CAPTURE_TAGS.COMMENT);
      expect(comments.some((c) => c.name === '[comment]')).toBe(true);
    });

    it('should extract a block comment', () => {
      const code = '/* a comment */\nclass A {}';
      const captures = provider.parse(code, 't.groovy');
      const comments = captures.filter((c) => c.tag === CAPTURE_TAGS.COMMENT);
      expect(comments.some((c) => c.name === '[comment]')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract import with last segment as name', () => {
      const code = 'import groovy.json.JsonSlurper';
      const imports = provider.extractImports(code, 't.groovy');
      expect(
        imports.some(
          (i) => i.source === 'groovy.json.JsonSlurper' && i.names.includes('JsonSlurper'),
        ),
      ).toBe(true);
    });
  });

  describe('isExported', () => {
    it('reports Groovy defs as exported by default', () => {
      expect(provider.isExported('class Foo {}', 'Foo')).toBe(true);
    });
  });

  describe('taint sources (AST)', () => {
    it('should detect Eval.me as code_injection source', () => {
      const sources = provider.extractTaintSources('def x = Eval.me(script)');
      expect(sources.some((s) => s.sourceType === 'code_injection')).toBe(true);
    });

    it('should detect Eval.x as code_injection source', () => {
      const sources = provider.extractTaintSources('def x = Eval.x(script)');
      expect(sources.some((s) => s.sourceType === 'code_injection')).toBe(true);
    });

    it('should detect System.console as user_input source', () => {
      const sources = provider.extractTaintSources('def x = System.console.readLine()');
      expect(sources.some((s) => s.sourceType === 'user_input')).toBe(true);
    });

    it('should detect System.in as user_input source', () => {
      const sources = provider.extractTaintSources('def x = System.in.read()');
      expect(sources.some((s) => s.sourceType === 'user_input')).toBe(true);
    });

    it('should detect args as user_input source', () => {
      const sources = provider.extractTaintSources('args.each { }');
      expect(sources.some((s) => s.sourceType === 'user_input')).toBe(true);
    });

    it('should detect binding as user_input source', () => {
      const sources = provider.extractTaintSources('binding.getVariable("x")');
      expect(sources.some((s) => s.sourceType === 'user_input')).toBe(true);
    });

    it('should detect request as user_input source', () => {
      const sources = provider.extractTaintSources('def x = request.getParameter("x")');
      expect(sources.some((s) => s.sourceType === 'user_input')).toBe(true);
    });

    it('should detect params as user_input source', () => {
      const sources = provider.extractTaintSources('params.get("x")');
      expect(sources.some((s) => s.sourceType === 'user_input')).toBe(true);
    });

    it('should not flag an unrelated call as a source', () => {
      const sources = provider.extractTaintSources('foo()');
      expect(sources).toEqual([]);
    });
  });

  describe('taint sinks (AST)', () => {
    it('should detect Eval.me as code_injection sink', () => {
      const sinks = provider.extractTaintSinks('Eval.me(script)');
      expect(sinks.some((s) => s.sinkType === 'code_injection')).toBe(true);
    });

    it('should detect Eval.x as code_injection sink', () => {
      const sinks = provider.extractTaintSinks('Eval.x(script)');
      expect(sinks.some((s) => s.sinkType === 'code_injection')).toBe(true);
    });

    it('should detect GroovyShell as code_injection sink', () => {
      const sinks = provider.extractTaintSinks('new GroovyShell().evaluate(script)');
      expect(sinks.some((s) => s.sinkType === 'code_injection')).toBe(true);
    });

    it('should detect GroovyScriptEngine as code_injection sink', () => {
      const sinks = provider.extractTaintSinks('new GroovyScriptEngine(".").run()');
      expect(sinks.some((s) => s.sinkType === 'code_injection')).toBe(true);
    });

    it('should detect evaluate as code_injection sink', () => {
      const sinks = provider.extractTaintSinks('evaluate(script)');
      expect(sinks.some((s) => s.sinkType === 'code_injection')).toBe(true);
    });

    it('should detect execute as sql_exec sink', () => {
      const sinks = provider.extractTaintSinks('sql.execute(query)');
      expect(sinks.some((s) => s.sinkType === 'sql_exec')).toBe(true);
    });

    it('should detect Sql receiver as sql_exec sink', () => {
      const sinks = provider.extractTaintSinks('new Sql(conn).rows(query)');
      expect(sinks.some((s) => s.sinkType === 'sql_exec')).toBe(true);
    });

    it('should detect write as file_write sink', () => {
      const sinks = provider.extractTaintSinks('file.write(data)');
      expect(sinks.some((s) => s.sinkType === 'file_write')).toBe(true);
    });

    it('should detect withWriter as file_write sink', () => {
      const sinks = provider.extractTaintSinks('f.withWriter { }');
      expect(sinks.some((s) => s.sinkType === 'file_write')).toBe(true);
    });

    it('should detect withOutputStream as file_write sink', () => {
      const sinks = provider.extractTaintSinks('f.withOutputStream { }');
      expect(sinks.some((s) => s.sinkType === 'file_write')).toBe(true);
    });

    it('should not flag an unrelated call as a sink', () => {
      const sinks = provider.extractTaintSinks('foo()');
      expect(sinks).toEqual([]);
    });
  });

  describe('taint sanitizers (AST)', () => {
    it('should detect encodeAsHTML as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('def y = x.encodeAsHTML()');
      expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);
    });

    it('should detect encodeAsJavaScript as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('def y = x.encodeAsJavaScript()');
      expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);
    });

    it('should detect encodeAsURL as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('def y = x.encodeAsURL()');
      expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);
    });

    it('should detect escape as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('def y = x.escape()');
      expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);
    });

    it('should detect stripIndent as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('def y = x.stripIndent()');
      expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);
    });

    it('should detect replaceAll as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('def y = x.replaceAll("a", "b")');
      expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);
    });

    it('should not flag an unrelated call as a sanitizer', () => {
      const sanitizers = provider.extractSanitizers('foo()');
      expect(sanitizers).toEqual([]);
    });
  });

  describe('regex fallback (no parser)', () => {
    const regex = new RegexGroovyProvider();

    it('should parse classes, traits, enums, functions and imports', () => {
      const code = 'class A {}\ntrait T {}\nenum E {X}\ndef foo() {}\nimport a.b.C';
      const captures = regex.parse(code, 'f.groovy');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'A')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.TRAIT_DEF && c.name === 'T')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.ENUM_DEF && c.name === 'E')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'foo')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'a.b.C')).toBe(true);
    });

    it('should match abstract class and typed method variants', () => {
      const code = 'abstract class Base {}\nvoid run() {}\nint count() {}\nString s() {}';
      const captures = regex.parse(code, 'f.groovy');
      expect(captures.some((c) => c.name === 'Base')).toBe(true);
      expect(captures.some((c) => c.name === 'run')).toBe(true);
      expect(captures.some((c) => c.name === 'count')).toBe(true);
      expect(captures.some((c) => c.name === 's')).toBe(true);
    });

    it('should sort captures by line then byte offset', () => {
      const captures = regex.parse('class A {} class B {}', 'f.groovy');
      expect(captures.map((c) => c.name)).toEqual(['A', 'B']);
    });

    it('should return an empty list when nothing matches', () => {
      expect(regex.parse('def x = 1', 'f.groovy')).toEqual([]);
    });

    it('should extract imports via the regex fallback', () => {
      const imports = regex.extractImports('import a.b.C\nimport static d.E', 'f.groovy');
      expect(imports.map((i) => i.source)).toEqual(['a.b.C', 'd.E']);
      expect(imports[0].names).toEqual(['C']);
    });

    it('should report exported by default via the regex fallback', () => {
      expect(regex.isExported('class Foo {}', 'Foo')).toBe(true);
    });

    it('should classify Eval.me and request sources via the regex fallback', () => {
      const sources = regex.extractTaintSources(
        'Eval.me(x)\nEval.x(y)\nSystem.console\nrequest\nparams',
      );
      expect(sources.some((s) => s.name === 'Eval.me' && s.sourceType === 'code_injection')).toBe(
        true,
      );
      expect(sources.some((s) => s.name === 'Eval.x' && s.sourceType === 'code_injection')).toBe(
        true,
      );
      expect(sources.some((s) => s.name === 'request' && s.sourceType === 'user_input')).toBe(true);
    });

    it('should classify code-injection and sql sinks via the regex fallback', () => {
      const sinks = regex.extractTaintSinks(
        'Eval.me(x)\nGroovyShell\nexecuteUpdate(q)\nfoo.execute()',
      );
      expect(sinks.some((s) => s.name === 'Eval.me' && s.sinkType === 'code_injection')).toBe(true);
      expect(sinks.some((s) => s.name === 'GroovyShell' && s.sinkType === 'code_injection')).toBe(
        true,
      );
      expect(sinks.some((s) => s.name === 'executeUpdate' && s.sinkType === 'sql_exec')).toBe(true);
    });

    it('should return no sanitizers via the regex fallback', () => {
      expect(regex.extractSanitizers('x.encodeAsHTML()')).toEqual([]);
    });
  });
});
