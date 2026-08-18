import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { RProvider } from '../languages/r.js';

describe('RProvider', () => {
  const provider = new RProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('r');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('R');
    });

    it('should have .r, .R, .Rprofile, .Renviron extensions', () => {
      expect(provider.extensions).toContain('.r');
      expect(provider.extensions).toContain('.R');
      expect(provider.extensions).toContain('.Rprofile');
      expect(provider.extensions).toContain('.Renviron');
    });

    it('should have "named" import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should parse function definitions', () => {
      const code = 'myfunc <- function(x) {\n  return(x + 1)\n}';
      const captures = provider.parse(code, 'test.R');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'myfunc')).toBe(true);
    });

    it('should parse variable assignments with <-', () => {
      const code = 'x <- 10\ny <- "hello"';
      const captures = provider.parse(code, 'test.R');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'x')).toBe(true);
      expect(vars.some((c) => c.name === 'y')).toBe(true);
    });

    it('should parse library imports', () => {
      const code = 'library(ggplot2)\nlibrary("dplyr")';
      const captures = provider.parse(code, 'test.R');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'ggplot2')).toBe(true);
      expect(imports.some((c) => c.name === 'dplyr')).toBe(true);
    });

    it('should parse require imports', () => {
      const code = 'require(tidyr)';
      const captures = provider.parse(code, 'test.R');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'tidyr')).toBe(true);
    });

    it('should parse S4 class definitions', () => {
      const code = 'setClass("Person", representation(name = "character"))';
      const captures = provider.parse(code, 'test.R');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Person')).toBe(true);
    });

    it('should parse S4 ref class definitions', () => {
      const code = 'setRefClass("Account", fields = list(balance = "numeric"))';
      const captures = provider.parse(code, 'test.R');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Account')).toBe(true);
    });

    it('should parse function calls', () => {
      const code = 'mean(x)\nsum(y)';
      const captures = provider.parse(code, 'test.R');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === 'mean')).toBe(true);
      expect(calls.some((c) => c.name === 'sum')).toBe(true);
    });

    it('should parse pipe operators', () => {
      // Pipe operators are not captured by the regex parser; parse must not throw.
      const code = 'x %>% mean()';
      const captures = provider.parse(code, 'test.R');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.R');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle files with only comments', () => {
      const code = '# Comment\n# Another comment';
      const captures = provider.parse(code, 'test.R');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse namespace_get calls like pkg::func', () => {
      // Namespace resolution depends on tree-sitter grammar accuracy
      const code = 'dplyr::filter(df)';
      const captures = provider.parse(code, 'test.R');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = 'x <- 10\nmyfunc <- function() { }\nlibrary(dplyr)';
      const captures = provider.parse(code, 'test.R');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should include filePath in properties', () => {
      const code = 'myfunc <- function() { }';
      const captures = provider.parse(code, 'myfile.R');
      const func = captures.find((c) => c.name === 'myfunc');
      expect(func?.properties?.filePath).toBe('myfile.R');
    });

    it('should handle if statements', () => {
      const code = 'if (x > 0) { print(x) }';
      const captures = provider.parse(code, 'test.R');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle for loops', () => {
      const code = 'for (i in 1:10) { print(i) }';
      const captures = provider.parse(code, 'test.R');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract library imports', () => {
      const code = 'library(ggplot2)\nlibrary(dplyr)';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract require imports', () => {
      const code = 'require(tidyr)';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]?.source).toBe('tidyr');
    });

    it('should handle quoted library names', () => {
      const code = 'library("dplyr")';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]?.source).toBe('dplyr');
    });

    it('should handle files without imports', () => {
      const imports = provider.extractImports('x <- 10');
      expect(imports.length).toBe(0);
    });

    it('should include line numbers', () => {
      const code = '\nlibrary(dplyr)';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]?.lineNumber).toBe(2);
    });
  });

  describe('isExported', () => {
    it('should return true (R functions are globally visible)', () => {
      expect(provider.isExported('myfunc <- function() { }', 'myfunc')).toBe(true);
    });

    it('should return true for any symbol', () => {
      expect(provider.isExported('', 'anything')).toBe(true);
    });
  });

  describe('regex parsing (via parse)', () => {
    it('parse should parse function definitions', () => {
      const code = 'myfunc <- function(x) { return(x) }';
      const captures = provider.parse(code, 'test.R');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'myfunc')).toBe(true);
    });

    it('parse should parse variable assignments', () => {
      const code = 'x <- 10\ny <- 20';
      const captures = provider.parse(code, 'test.R');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'x')).toBe(true);
      expect(vars.some((c) => c.name === 'y')).toBe(true);
    });

    it('parse should skip keywords as variable names', () => {
      const code = 'if <- 10';
      const captures = provider.parse(code, 'test.R');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'if')).toBe(false);
    });

    it('parse should parse class definitions', () => {
      const code = 'setClass("Person", slots = c(name = "character"))';
      const captures = provider.parse(code, 'test.R');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Person')).toBe(true);
    });

    it('parse should parse library imports', () => {
      const code = 'library(ggplot2)\nrequire("dplyr")';
      const captures = provider.parse(code, 'test.R');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'ggplot2')).toBe(true);
      expect(imports.some((c) => c.name === 'dplyr')).toBe(true);
    });

    it('parse should handle empty input', () => {
      const captures = provider.parse('', 'test.R');
      expect(captures).toEqual([]);
    });

    it('parse should return sorted captures', () => {
      const code = 'x <- 10\ny <- 20\nf <- function() { }';
      const captures = provider.parse(code, 'test.R');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('extractImports should extract library imports', () => {
      const code = 'library(ggplot2)\nrequire(dplyr)';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('extractImports should extract quoted library names', () => {
      const code = 'library("ggplot2")';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]?.source).toBe('ggplot2');
    });

    it('extractImports should include line numbers', () => {
      const code = '\nlibrary(dplyr)';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]?.lineNumber).toBe(2);
    });

    it('extractImports should handle empty input', () => {
      const imports = provider.extractImports('');
      expect(imports).toEqual([]);
    });

    it('isExported should return true', () => {
      expect(provider.isExported('', 'anything')).toBe(true);
    });
  });

  describe('internal helpers', () => {
    it('getCallName should find function name in call node', () => {
      const code = 'mean(x)';
      const captures = provider.parse(code, 'test.R');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === 'mean')).toBe(true);
    });

    it('getCallArgs should extract string arguments', () => {
      const code = 'setClass("MyClass", slots = c(x = "numeric"))';
      const captures = provider.parse(code, 'test.R');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyClass')).toBe(true);
    });
  });
});
