import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { BashProvider } from '../languages/bash.js';

/** BashProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexBashProvider extends BashProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

describe('BashProvider', () => {
  const provider = new BashProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('bash');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Bash/Shell');
    });

    it('should have .sh and .bash extensions', () => {
      expect(provider.extensions).toContain('.sh');
      expect(provider.extensions).toContain('.bash');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — functions and variables', () => {
    it('should extract a function definition', () => {
      const code = 'hello() { echo "hi"; }';
      const captures = provider.parse(code, 't.sh');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'hello')).toBe(true);
    });

    it('should extract a function defined with the function keyword', () => {
      const code = 'function world() { echo hi; }';
      const captures = provider.parse(code, 't.sh');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'world')).toBe(true);
    });

    it('should extract a variable assignment', () => {
      const code = 'NAME=world\nexport PATH=/bin';
      const captures = provider.parse(code, 't.sh');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'NAME')).toBe(true);
      expect(vars.some((c) => c.name === 'PATH')).toBe(true);
    });

    it('should extract a local variable assignment', () => {
      const code = 'local x=1';
      const captures = provider.parse(code, 't.sh');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'x')).toBe(true);
    });
  });

  describe('parse — commands', () => {
    it('should extract a non-builtin command as a function call', () => {
      const code = 'ls -la';
      const captures = provider.parse(code, 't.sh');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === 'ls')).toBe(true);
    });

    it('should not emit builtin commands as function calls', () => {
      const code = 'echo "hi"';
      const captures = provider.parse(code, 't.sh');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === 'echo')).toBe(false);
    });

    it('should resolve a quoted command name', () => {
      const code = '"ls" -la';
      const captures = provider.parse(code, 't.sh');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === '"ls"')).toBe(true);
    });

    it('should resolve a dynamic command name', () => {
      const code = '$cmd arg';
      const captures = provider.parse(code, 't.sh');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === '$cmd')).toBe(true);
    });

    it('should resolve a concatenated command name', () => {
      const code = '"$pre"fix arg';
      const captures = provider.parse(code, 't.sh');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === '"$pre"fix')).toBe(true);
    });

    it('should extract a source as an import', () => {
      const code = 'source ./config.sh';
      const captures = provider.parse(code, 't.sh');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === './config.sh')).toBe(true);
    });

    it('should extract a dot-source as an import', () => {
      const code = '. ./other.sh';
      const captures = provider.parse(code, 't.sh');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === './other.sh')).toBe(true);
    });
  });

  describe('parse — expansions and comments', () => {
    it('should extract a comment', () => {
      const code = '# a comment\nls';
      const captures = provider.parse(code, 't.sh');
      const comments = captures.filter((c) => c.tag === CAPTURE_TAGS.COMMENT);
      expect(comments.some((c) => c.name === '[comment]')).toBe(true);
    });

    it('should extract a command substitution', () => {
      const code = 'result=$(ls -la)';
      const captures = provider.parse(code, 't.sh');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.properties?.isSubshell === 'true')).toBe(true);
    });

    it('should extract a variable expansion', () => {
      const code = 'echo $HOME';
      const captures = provider.parse(code, 't.sh');
      const accesses = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS);
      expect(accesses.some((c) => c.properties?.isExpansion === 'true')).toBe(true);
    });

    it('should extract a braced variable expansion', () => {
      const code = 'echo ${HOME}';
      const captures = provider.parse(code, 't.sh');
      const accesses = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS);
      expect(accesses.some((c) => c.properties?.isExpansion === 'true')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract source as an import', () => {
      const code = 'source ./config.sh';
      const imports = provider.extractImports(code, 't.sh');
      expect(imports.some((i) => i.source === './config.sh')).toBe(true);
    });

    it('should extract a dot-source as an import', () => {
      const imports = provider.extractImports('. ./other.sh', 't.sh');
      expect(imports.some((i) => i.source === './other.sh')).toBe(true);
    });

    it('should return empty for code without imports', () => {
      expect(provider.extractImports('echo hi', 't.sh')).toEqual([]);
    });
  });

  describe('taint sources', () => {
    it.each(['$@', '$*', '$1', '$2', '$3', '$4', '$5'])(
      'should detect %s as script_argument source',
      (arg) => {
        const sources = provider.extractTaintSources(`echo ${arg}`);
        expect(sources.some((s) => s.name === arg && s.sourceType === 'script_argument')).toBe(
          true,
        );
      },
    );

    it.each(['$USER', '${USER}', '$INPUT', '$ARG', '$0'])(
      'should detect %s as external_input source',
      (arg) => {
        const sources = provider.extractTaintSources(`echo ${arg}`);
        expect(sources.some((s) => s.sourceType === 'external_input')).toBe(true);
      },
    );

    it('should detect read as user_input source', () => {
      const sources = provider.extractTaintSources('read input');
      expect(sources.some((s) => s.name === 'read_input' && s.sourceType === 'user_input')).toBe(
        true,
      );
    });

    it.each(['curl', 'wget', 'nc'])('should detect %s as network source', (cmd) => {
      const sources = provider.extractTaintSources(`${cmd} http://example.com`);
      expect(sources.some((s) => s.sourceType === 'network')).toBe(true);
    });

    it('should return empty for a non-source command', () => {
      expect(provider.extractTaintSources('echo hi')).toEqual([]);
    });
  });

  describe('taint sinks', () => {
    it.each(['eval', 'exec', 'bash', 'sh', 'zsh', 'ksh'])(
      'should detect %s as os_command sink',
      (cmd) => {
        const sinks = provider.extractTaintSinks(`${cmd} "$payload"`);
        expect(sinks.some((s) => s.name === cmd && s.sinkType === 'os_command')).toBe(true);
      },
    );

    it.each(['rm', 'mv', 'cp', 'dd', 'chmod', 'chown'])(
      'should detect %s as file_write sink',
      (cmd) => {
        const sinks = provider.extractTaintSinks(`${cmd} target`);
        expect(sinks.some((s) => s.name === cmd && s.sinkType === 'file_write')).toBe(true);
      },
    );

    it.each(['nc', 'telnet', 'ssh'])('should detect %s as network sink', (cmd) => {
      const sinks = provider.extractTaintSinks(`${cmd} host`);
      expect(sinks.some((s) => s.name === cmd && s.sinkType === 'network')).toBe(true);
    });

    it('should return empty for a non-sink command', () => {
      expect(provider.extractTaintSinks('echo hi')).toEqual([]);
    });
  });

  describe('taint sanitizers', () => {
    it('should detect printf as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('printf "%s" "$input"');
      expect(sanitizers.some((s) => s.name === 'printf_sanitize')).toBe(true);
    });

    it.each(['${x:-default}', '${x:=default}', '${x:?error}'])(
      'should detect %s as parameter validation sanitizer',
      (expr) => {
        const sanitizers = provider.extractSanitizers(`echo ${expr}`);
        expect(sanitizers.some((s) => s.sanitizerType === 'parameter_validation')).toBe(true);
      },
    );

    it('should return empty for a non-sanitizing expansion', () => {
      expect(provider.extractSanitizers('echo ${x}')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should report shell functions as exported by default', () => {
      expect(provider.isExported('hello() {}', 'hello')).toBe(true);
    });
  });

  describe('fallback (regex)', () => {
    const fallback = new RegexBashProvider();

    it('should parse functions and variables', () => {
      const captures = fallback.parse('hello() {}\nNAME=world\n', 't.sh');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'hello')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'NAME')).toBe(
        true,
      );
    });

    it('should parse a function defined with the function keyword', () => {
      const captures = fallback.parse('function world() {}', 't.sh');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'world')).toBe(
        true,
      );
    });

    it('should filter keyword-like variable names', () => {
      const captures = fallback.parse('fi=1', 't.sh');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.filter((c) => c.name === 'fi')).toHaveLength(0);
    });

    it('should parse source and pipe commands', () => {
      const captures = fallback.parse('source ./x.sh\ncat file | grep y\n', 't.sh');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === './x.sh')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.name === 'cat')).toBe(
        true,
      );
    });

    it('should sort captures by position', () => {
      const captures = fallback.parse('b() {}\na() {}', 't.sh');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should sort same-line captures by byte offset', () => {
      const captures = fallback.parse('b() {} a() {}', 't.sh');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should return empty captures for empty source', () => {
      expect(fallback.parse('', 't.sh')).toEqual([]);
    });

    it('should extract source imports', () => {
      const imports = fallback.extractImports('source ./a.sh\n. ./b.sh', 't.sh');
      expect(imports.some((i) => i.source === './a.sh')).toBe(true);
      expect(imports.some((i) => i.source === './b.sh')).toBe(true);
    });

    it('should return empty imports without sources', () => {
      expect(fallback.extractImports('echo hi', 't.sh')).toEqual([]);
    });

    it('should report everything as exported', () => {
      expect(fallback.isExported('hello() {}', 'hello')).toBe(true);
      expect(fallback.isExported('', 'anything')).toBe(true);
    });

    it('should extract read taint sources', () => {
      const sources = fallback.extractTaintSources('read input');
      expect(sources.some((s) => s.name === 'read_input')).toBe(true);
    });

    it('should return empty taint sources without read', () => {
      expect(fallback.extractTaintSources('echo hi')).toEqual([]);
    });

    it('should extract command-injection taint sinks', () => {
      const sinks = fallback.extractTaintSinks('eval "$x"\nexec y\nrm -rf /tmp');
      expect(sinks.some((s) => s.name === 'eval')).toBe(true);
      expect(sinks.some((s) => s.name === 'exec')).toBe(true);
      expect(sinks.some((s) => s.name === 'rm -rf')).toBe(true);
    });

    it('should return empty taint sinks without matches', () => {
      expect(fallback.extractTaintSinks('echo hi')).toEqual([]);
    });

    it('should return empty sanitizers', () => {
      expect(fallback.extractSanitizers('echo hi')).toEqual([]);
    });
  });
});
