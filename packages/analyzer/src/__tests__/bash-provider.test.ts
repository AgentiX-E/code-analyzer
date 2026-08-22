import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { BashProvider } from '../languages/bash.js';

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

    it('should extract a variable assignment', () => {
      const code = 'NAME=world\nexport PATH=/bin';
      const captures = provider.parse(code, 't.sh');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'NAME')).toBe(true);
      expect(vars.some((c) => c.name === 'PATH')).toBe(true);
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

    it('should extract a source as an import', () => {
      const code = 'source ./config.sh';
      const captures = provider.parse(code, 't.sh');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === './config.sh')).toBe(true);
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
  });

  describe('extractImports', () => {
    it('should extract source as an import', () => {
      const code = 'source ./config.sh';
      const imports = provider.extractImports(code, 't.sh');
      expect(imports.some((i) => i.source === './config.sh')).toBe(true);
    });
  });

  describe('taint analysis', () => {
    it('should detect read as user_input source', () => {
      const sources = provider.extractTaintSources('read input');
      expect(sources.some((s) => s.name === 'read_input' && s.sourceType === 'user_input')).toBe(
        true,
      );
    });

    it('should detect curl as network source', () => {
      const sources = provider.extractTaintSources('curl http://example.com');
      expect(sources.some((s) => s.sourceType === 'network')).toBe(true);
    });

    it('should detect $1 as script_argument source', () => {
      const sources = provider.extractTaintSources('echo $1');
      expect(sources.some((s) => s.name === '$1' && s.sourceType === 'script_argument')).toBe(true);
    });

    it('should detect $USER as external_input source', () => {
      const sources = provider.extractTaintSources('echo $USER');
      expect(sources.some((s) => s.sourceType === 'external_input')).toBe(true);
    });

    it('should detect eval as os_command sink', () => {
      const sinks = provider.extractTaintSinks('eval "$cmd"');
      expect(sinks.some((s) => s.name === 'eval' && s.sinkType === 'os_command')).toBe(true);
    });

    it('should detect rm as file_write sink', () => {
      const sinks = provider.extractTaintSinks('rm -rf /tmp/x');
      expect(sinks.some((s) => s.name === 'rm' && s.sinkType === 'file_write')).toBe(true);
    });

    it('should detect nc as network sink', () => {
      const sinks = provider.extractTaintSinks('nc -l 4444');
      expect(sinks.some((s) => s.name === 'nc' && s.sinkType === 'network')).toBe(true);
    });

    it('should detect printf as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('printf "%s" "$input"');
      expect(sanitizers.some((s) => s.name === 'printf_sanitize')).toBe(true);
    });

    it('should detect parameter expansion as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('echo ${x:-default}');
      expect(sanitizers.some((s) => s.sanitizerType === 'parameter_validation')).toBe(true);
    });
  });

  describe('isExported', () => {
    it('should report shell functions as exported by default', () => {
      expect(provider.isExported('hello() {}', 'hello')).toBe(true);
    });
  });
});
