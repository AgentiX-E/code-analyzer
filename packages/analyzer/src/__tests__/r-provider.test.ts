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
      // Tree-sitter may parse pipes differently; fallback may not detect them
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

    it('should parse namespace calls like pkg::func', () => {
      const code = 'dplyr::filter(df)';
      const captures = provider.parse(code, 'test.R');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === 'filter')).toBe(true);
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

    it('should handle anonymous functions', () => {
      const code = 'lapply(x, function(y) { y * 2 })';
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

    it('should extract source imports', () => {
      const imports = provider.extractImports('source("utils.R")');
      expect(imports.some((i) => i.source === 'utils.R')).toBe(true);
    });

    it('should handle library() and source() with no arguments', () => {
      expect(provider.extractImports('library()').some((i) => i.source === 'library')).toBe(true);
      expect(provider.extractImports('source()')).toEqual([]);
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

  describe('fallback methods', () => {
    it('fallbackParse should parse function definitions', () => {
      const code = 'myfunc <- function(x) { return(x) }';
      const captures = provider.fallbackParse(code, 'test.R');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'myfunc')).toBe(true);
    });

    it('fallbackParse should parse variable assignments', () => {
      const code = 'x <- 10\ny <- 20';
      const captures = provider.fallbackParse(code, 'test.R');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'x')).toBe(true);
      expect(vars.some((c) => c.name === 'y')).toBe(true);
    });

    it('fallbackParse should skip keywords as variable names', () => {
      const code = 'if <- 10';
      const captures = provider.fallbackParse(code, 'test.R');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'if')).toBe(false);
    });

    it('fallbackParse should parse class definitions', () => {
      const code = 'setClass("Person", slots = c(name = "character"))';
      const captures = provider.fallbackParse(code, 'test.R');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Person')).toBe(true);
    });

    it('fallbackParse should parse library imports', () => {
      const code = 'library(ggplot2)\nrequire("dplyr")';
      const captures = provider.fallbackParse(code, 'test.R');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'ggplot2')).toBe(true);
      expect(imports.some((c) => c.name === 'dplyr')).toBe(true);
    });

    it('fallbackParse should handle empty input', () => {
      const captures = provider.fallbackParse('', 'test.R');
      expect(captures).toEqual([]);
    });

    it('fallbackParse should return sorted captures', () => {
      const code = 'x <- 10\ny <- 20\nf <- function() { }';
      const captures = provider.fallbackParse(code, 'test.R');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('fallbackExtractImports should extract library imports', () => {
      const code = 'library(ggplot2)\nrequire(dplyr)';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('fallbackExtractImports should extract quoted library names', () => {
      const code = 'library("ggplot2")';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]?.source).toBe('ggplot2');
    });

    it('fallbackExtractImports should include line numbers', () => {
      const code = '\nlibrary(dplyr)';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]?.lineNumber).toBe(2);
    });

    it('fallbackExtractImports should handle empty input', () => {
      const imports = provider.fallbackExtractImports('');
      expect(imports).toEqual([]);
    });

    it('fallbackIsExported should return true', () => {
      expect(provider.fallbackIsExported('', 'anything')).toBe(true);
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

  describe('special operators', () => {
    it('should parse the pipe operator', () => {
      const caps = provider.parse('x %>% mean()', 'test.R');
      const pipes = caps.filter((c) => c.properties?.pipeOperator);
      expect(pipes.length).toBeGreaterThanOrEqual(1);
      expect(pipes[0]?.name).toBe('pipe');
    });
    it('should parse the %in% operator', () => {
      const caps = provider.parse('x %in% y', 'test.R');
      const ops = caps.filter((c) => c.properties?.operator === 'in');
      expect(ops.length).toBeGreaterThanOrEqual(1);
    });
    it('should parse custom operators', () => {
      const caps = provider.parse('x %foo% y', 'test.R');
      const ops = caps.filter((c) => c.properties?.customOperator === 'true');
      expect(ops.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('comments', () => {
    it('should capture comments', () => {
      const caps = provider.parse('# a comment', 'test.R');
      const comments = caps.filter((c) => c.tag === CAPTURE_TAGS.COMMENT);
      expect(comments.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('source imports', () => {
    it('should parse source() imports', () => {
      const caps = provider.parse('source("utils.R")', 'test.R');
      const imports = caps.filter((c) => c.tag === CAPTURE_TAGS.IMPORT && c.properties?.importType === 'source');
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('taint analysis', () => {
    it('should detect read.csv as file_read source', () => {
      const sources = provider.extractTaintSources("read.csv('data.csv')");
      expect(sources.some((s) => s.name === 'read.csv' && s.sourceType === 'file_read')).toBe(true);
    });
    it('should detect Sys.getenv as environment source', () => {
      const sources = provider.extractTaintSources('Sys.getenv("TOKEN")');
      expect(sources.some((s) => s.name === 'Sys.getenv' && s.sourceType === 'environment')).toBe(true);
    });
    it('should detect download.file as network source', () => {
      const sources = provider.extractTaintSources('download.file(url, "f")');
      expect(sources.some((s) => s.name === 'download.file' && s.sourceType === 'network')).toBe(true);
    });
    it('should detect system as os_command sink', () => {
      const sinks = provider.extractTaintSinks('system("rm -rf /")');
      expect(sinks.some((s) => s.name === 'system' && s.sinkType === 'os_command')).toBe(true);
    });
    it('should detect eval as code_injection sink', () => {
      const sinks = provider.extractTaintSinks('eval(parse(text = x))');
      expect(sinks.some((s) => s.name === 'eval' && s.sinkType === 'code_injection')).toBe(true);
    });
    it('should detect write.csv as file_write sink', () => {
      const sinks = provider.extractTaintSinks('write.csv(df, "out.csv")');
      expect(sinks.some((s) => s.name === 'write.csv' && s.sinkType === 'file_write')).toBe(true);
    });
    it('should detect is.numeric as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('is.numeric(x)');
      expect(sanitizers.some((s) => s.name === 'is.numeric')).toBe(true);
    });
    it('should return empty for non-taint calls', () => {
      expect(provider.extractTaintSources('mean(x)')).toEqual([]);
      expect(provider.extractTaintSinks('mean(x)')).toEqual([]);
      expect(provider.extractSanitizers('mean(x)')).toEqual([]);
    });
    it('should detect read.table, scan, url, file as file_read', () => {
      for (const fn of ['read.table', 'scan', 'url', 'file']) {
        expect(provider.extractTaintSources(`${fn}("d")`).some((s) => s.name === fn)).toBe(true);
      }
    });
    it('should detect getOption and commandArgs as environment', () => {
      expect(provider.extractTaintSources('getOption("x")').some((s) => s.name === 'getOption')).toBe(true);
      expect(provider.extractTaintSources('commandArgs()').some((s) => s.name === 'commandArgs')).toBe(true);
    });
    it('should detect curl as network', () => {
      expect(provider.extractTaintSources('curl("http://x")').some((s) => s.name === 'curl')).toBe(true);
    });
    it('should detect system2, shell, shell.exec as os_command', () => {
      for (const fn of ['system2', 'shell', 'shell.exec']) {
        expect(provider.extractTaintSinks(`${fn}("x")`).some((s) => s.name === fn && s.sinkType === 'os_command')).toBe(true);
      }
    });
    it('should detect parse as code_injection', () => {
      expect(provider.extractTaintSinks('parse(text = x)').some((s) => s.name === 'parse' && s.sinkType === 'code_injection')).toBe(true);
    });
    it('should detect write.table, saveRDS, save as file_write', () => {
      for (const fn of ['write.table', 'saveRDS', 'save']) {
        expect(provider.extractTaintSinks(`${fn}(d, "o")`).some((s) => s.name === fn && s.sinkType === 'file_write')).toBe(true);
      }
    });
    it('should detect as.numeric, as.character, sanitize as sanitizers', () => {
      for (const fn of ['as.numeric', 'as.character', 'sanitize']) {
        expect(provider.extractSanitizers(`${fn}(x)`).some((s) => s.name === fn)).toBe(true);
      }
    });
    it('should detect readRDS and readLines as file_read', () => {
      expect(provider.extractTaintSources('readRDS("d.rds")').some((s) => s.name === 'readRDS')).toBe(true);
      expect(provider.extractTaintSources('readLines("d.txt")').some((s) => s.name === 'readLines')).toBe(true);
    });
    it('should detect is.character, is.logical, type.convert as sanitizers', () => {
      for (const fn of ['is.character', 'is.logical', 'type.convert']) {
        expect(provider.extractSanitizers(`${fn}(x)`).some((s) => s.name === fn)).toBe(true);
      }
    });
  });

  describe('assignment and function edge cases', () => {
    it('should parse = assignments', () => {
      const caps = provider.parse('x = 10', 'test.R');
      const vars = caps.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'x')).toBe(true);
    });
    it('should handle anonymous functions', () => {
      const caps = provider.parse('function(x) { x }', 'test.R');
      const funcs = caps.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThanOrEqual(1);
    });
    it('should handle calls with no arguments', () => {
      expect(Array.isArray(provider.parse('library()', 'test.R'))).toBe(true);
      expect(Array.isArray(provider.parse('source()', 'test.R'))).toBe(true);
      expect(Array.isArray(provider.parse('setClass()', 'test.R'))).toBe(true);
    });
  });

  describe('fallback taint methods', () => {
    it('fallbackExtractTaintSources should detect read.csv', () => {
      const sources = provider.fallbackExtractTaintSources("read.csv('d.csv')");
      expect(sources.length).toBeGreaterThanOrEqual(1);
    });
    it('fallbackExtractTaintSinks should detect system and eval', () => {
      const sinks = provider.fallbackExtractTaintSinks('system("x")\neval(y)');
      expect(sinks.some((s) => s.name === 'system')).toBe(true);
      expect(sinks.some((s) => s.name === 'eval' && s.sinkType === 'code_injection')).toBe(true);
    });
    it('fallbackExtractSanitizers should return empty', () => {
      expect(provider.fallbackExtractSanitizers('x')).toEqual([]);
    });
  });
});
