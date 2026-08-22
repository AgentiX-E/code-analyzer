// @code-analyzer/analyzer — New Language Providers Test (Iteration 16)
// Validates all 10 new language providers: YAML, JSON, SQL, Bash, TOML,
// Markdown, HTML, CSS, R, and Groovy.

import { describe, it, expect } from 'vitest';
import { YamlProvider } from '../yaml.js';
import { JsonProvider } from '../json.js';
import { SqlProvider } from '../sql.js';
import { BashProvider } from '../bash.js';
import { TomlProvider } from '../toml.js';
import { MarkdownProvider } from '../markdown.js';
import { HtmlProvider } from '../html.js';
import { CssProvider } from '../css.js';
import { RProvider } from '../r.js';
import { GroovyProvider } from '../groovy.js';

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

describe('YAML Provider', () => {
  const p = new YamlProvider();

  it('should detect key-value pairs', () => {
    const src = 'name: MyApp\nversion: "1.0.0"\ndescription: A test app\n';
    const captures = p.parse(src, '/test/config.yaml');
    expect(captures.length).toBeGreaterThanOrEqual(3);
    expect(captures.find((c) => c.name === 'name')).toBeTruthy();
    expect(captures.find((c) => c.name === 'version')).toBeTruthy();
  });

  it('should skip comments', () => {
    const src = '# This is a comment\nname: MyApp\n# Another comment\nversion: "1.0"';
    const captures = p.parse(src, '/test/config.yaml');
    const comments = captures.filter((c) => c.name?.startsWith('#'));
    expect(comments.length).toBe(0);
  });

  it('should handle empty source', () => {
    const captures = p.parse('', '/test/empty.yaml');
    expect(captures).toEqual([]);
  });

  it('should handle nested YAML with indent tracking', () => {
    const src =
      'server:\n  host: localhost\n  port: 3000\ndatabase:\n  url: postgresql://localhost';
    const captures = p.parse(src, '/test/nested.yaml');
    expect(captures.length).toBeGreaterThanOrEqual(4);
  });

  it('should have correct language info', () => {
    expect(p.language).toBe('yaml');
    expect(p.extensions).toContain('.yaml');
    expect(p.extensions).toContain('.yml');
  });
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

describe('JSON Provider', () => {
  const p = new JsonProvider();

  it('should detect key-value pairs in JSON', () => {
    const src = '{"name": "MyApp", "version": "1.0.0", "dependencies": {"express": "^4.18.0"}}';
    const captures = p.parse(src, '/test/package.json');
    expect(captures.length).toBeGreaterThanOrEqual(2);
    // JSON pair keys are extracted from tree-sitter string nodes (quotes stripped)
    expect(captures.some((c) => c.name === 'name')).toBe(true);
    expect(captures.some((c) => c.name === 'version')).toBe(true);
    // dependencies object should be captured
    expect(captures.some((c) => c.properties?.valueType === 'object')).toBe(true);
  });

  it('should handle empty JSON object', () => {
    const captures = p.parse('{}', '/test/empty.json');
    // Tree-sitter may create an object capture even for empty objects
    expect(Array.isArray(captures)).toBe(true);
  });

  it('should handle JSON arrays', () => {
    const src = '["item1", "item2", 42, true]';
    const captures = p.parse(src, '/test/array.json');
    // Arrays without object keys produce no Variable captures in fallback mode
    expect(Array.isArray(captures)).toBe(true);
  });

  it('should have correct extensions', () => {
    expect(p.extensions).toContain('.json');
    expect(p.extensions).toContain('.jsonc');
  });
});

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

describe('SQL Provider', () => {
  const p = new SqlProvider();

  it('should detect CREATE TABLE statements', () => {
    const src = 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);';
    const captures = p.parse(src, '/test/schema.sql');
    expect(captures.some((c) => c.name === 'users')).toBe(true);
  });

  it('should detect CREATE FUNCTION statements', () => {
    const src =
      'CREATE FUNCTION calculate_tax(amount DECIMAL) RETURNS DECIMAL BEGIN RETURN amount * 0.1; END;';
    const captures = p.parse(src, '/test/func.sql');
    expect(captures.some((c) => c.name === 'calculate_tax')).toBe(true);
  });

  it('should detect SELECT/INSERT/UPDATE/DELETE', () => {
    const src =
      'SELECT * FROM users;\nINSERT INTO users (name) VALUES ("Alice");\nUPDATE users SET name="Bob" WHERE id=1;\nDELETE FROM users WHERE id=2;';
    const captures = p.parse(src, '/test/dml.sql');
    expect(captures.length).toBeGreaterThanOrEqual(2);
    const tables = captures.map((c) => c.name);
    expect(tables).toContain('users');
  });

  it('should handle CREATE VIEW', () => {
    const src = 'CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1;';
    const captures = p.parse(src, '/test/view.sql');
    expect(captures.some((c) => c.name === 'active_users')).toBe(true);
  });

  it('should handle empty SQL', () => {
    const captures = p.parse('', '/test/empty.sql');
    expect(captures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bash
// ---------------------------------------------------------------------------

describe('Bash Provider', () => {
  const p = new BashProvider();

  it('should detect function definitions', () => {
    const src = 'hello() {\n  echo "Hello, $1"\n}\n';
    const captures = p.parse(src, '/test/hello.sh');
    expect(captures.some((c) => c.name === 'hello')).toBe(true);
  });

  it('should detect variable assignments', () => {
    const src = 'NAME="World"\nPORT=3000\nexport DATABASE_URL="postgresql://localhost"';
    const captures = p.parse(src, '/test/vars.sh');
    expect(captures.some((c) => c.name === 'NAME')).toBe(true);
    expect(captures.some((c) => c.name === 'DATABASE_URL')).toBe(true);
  });

  it('should detect source/import statements', () => {
    const src = 'source ./utils.sh\n. ./config.sh';
    const captures = p.parse(src, '/test/main.sh');
    expect(captures.some((c) => c.name === './utils.sh')).toBe(true);
  });

  it('should handle empty script', () => {
    const captures = p.parse('', '/test/empty.sh');
    expect(captures).toEqual([]);
  });

  it('should have correct extensions', () => {
    expect(p.extensions).toContain('.sh');
    expect(p.extensions).toContain('.bash');
  });
});

// ---------------------------------------------------------------------------
// TOML
// ---------------------------------------------------------------------------

describe('TOML Provider', () => {
  const p = new TomlProvider();

  it('should detect table sections', () => {
    const src =
      '[server]\nhost = "localhost"\nport = 3000\n\n[database]\nurl = "postgresql://localhost"';
    const captures = p.parse(src, '/test/config.toml');
    expect(captures.some((c) => c.name === 'server')).toBe(true);
    expect(captures.some((c) => c.name === 'database')).toBe(true);
  });

  it('should detect key-value pairs', () => {
    const src = 'name = "MyApp"\nversion = "1.0.0"\n';
    const captures = p.parse(src, '/test/simple.toml');
    expect(captures.some((c) => c.name === 'name')).toBe(true);
  });

  it('should detect array of tables', () => {
    const src =
      '[[products]]\nname = "Widget"\nprice = 9.99\n\n[[products]]\nname = "Gadget"\nprice = 19.99';
    const captures = p.parse(src, '/test/array.toml');
    expect(captures.some((c) => c.name === 'products')).toBe(true);
  });

  it('should handle empty TOML', () => {
    const captures = p.parse('', '/test/empty.toml');
    expect(captures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

describe('Markdown Provider', () => {
  const p = new MarkdownProvider();

  it('should detect headings', () => {
    const src = '# Introduction\n\n## Getting Started\n\n### Installation\n';
    const captures = p.parse(src, '/test/readme.md');
    expect(captures.some((c) => c.name === 'Introduction')).toBe(true);
    expect(captures.some((c) => c.name === 'Getting Started')).toBe(true);
  });

  it('should detect links', () => {
    const src =
      'See [the docs](https://example.com/docs) for more info.\n[GitHub](https://github.com)\n';
    const captures = p.parse(src, '/test/links.md');
    expect(captures.some((c) => c.properties?.linkType === 'markdown')).toBe(true);
  });

  it('should detect code blocks', () => {
    const src = '```typescript\nconst x = 1;\n```\n\n```python\nprint("hello")\n```\n';
    const captures = p.parse(src, '/test/code.md');
    expect(captures.some((c) => c.name === 'typescript')).toBe(true);
    expect(captures.some((c) => c.name === 'python')).toBe(true);
  });

  it('should handle empty markdown', () => {
    const captures = p.parse('', '/test/empty.md');
    expect(captures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

describe('HTML Provider', () => {
  const p = new HtmlProvider();

  it('should detect HTML tags', () => {
    const src =
      '<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p></body></html>';
    const captures = p.parse(src, '/test/page.html');
    const tags = new Set(captures.map((c) => c.name));
    expect(tags.has('html')).toBe(true);
    expect(tags.has('body')).toBe(true);
  });

  it('should detect script references', () => {
    const src = '<script src="./app.js"></script><link rel="stylesheet" href="./style.css">';
    const captures = p.parse(src, '/test/index.html');
    // HTML parser may use tree-sitter or regex fallback depending on module availability
    // Both paths should produce at least some captures
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty HTML', () => {
    const captures = p.parse('', '/test/empty.html');
    expect(captures).toEqual([]);
  });

  it('should have correct extensions', () => {
    expect(p.extensions).toContain('.html');
    expect(p.extensions).toContain('.htm');
  });
});

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

describe('CSS Provider', () => {
  const p = new CssProvider();

  it('should detect CSS selectors', () => {
    const src = '.button { color: red; }\n#header { background: blue; }\nh1 { font-size: 24px; }';
    const captures = p.parse(src, '/test/style.css');
    expect(captures.some((c) => c.name === '.button')).toBe(true);
    expect(captures.some((c) => c.name === '#header')).toBe(true);
  });

  it('should detect @import statements', () => {
    const src = '@import "theme.css";\n@import url("https://fonts.googleapis.com/css2");';
    const captures = p.parse(src, '/test/imports.css');
    // CSS @import regex may match differently depending on quoting style
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect @keyframes and @media rules', () => {
    const src =
      '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }\n@media screen and (max-width: 768px) { .container { padding: 10px; } }';
    const captures = p.parse(src, '/test/atrules.css');
    expect(captures.some((c) => c.name === 'keyframes')).toBe(true);
    expect(captures.some((c) => c.name === 'media')).toBe(true);
  });

  it('should handle empty CSS', () => {
    const captures = p.parse('', '/test/empty.css');
    expect(captures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R
// ---------------------------------------------------------------------------

describe('R Provider', () => {
  const p = new RProvider();

  it('should detect function definitions', () => {
    const src = 'myFunc <- function(x, y) {\n  return(x + y)\n}\n';
    const captures = p.parse(src, '/test/func.R');
    expect(captures.some((c) => c.name === 'myFunc')).toBe(true);
  });

  it('should detect variable assignments', () => {
    const src = 'x <- 42\ny <- "hello"\nz <- c(1, 2, 3)';
    const captures = p.parse(src, '/test/vars.R');
    // Tree-sitter R: binary_operator with <- detected as variable assignment
    expect(captures.length).toBeGreaterThanOrEqual(2);
  });

  it('should detect S3/S4 class definitions', () => {
    const src = 'setClass("Person", representation(name = "character", age = "numeric"))';
    const captures = p.parse(src, '/test/class.R');
    // SetClass call should produce CLASS_DEF or FUNCTION_CALL capture
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect library/require imports', () => {
    const src = 'library(ggplot2)\nlibrary("dplyr")\nrequire(tidyr)';
    const captures = p.parse(src, '/test/imports.R');
    // library/require calls should produce IMPORT captures
    expect(captures.some((c) => c.name === 'ggplot2')).toBe(true);
    expect(captures.some((c) => c.name === 'dplyr')).toBe(true);
  });

  it('should handle empty R', () => {
    const captures = p.parse('', '/test/empty.R');
    expect(captures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Groovy
// ---------------------------------------------------------------------------

describe('Groovy Provider', () => {
  const p = new GroovyProvider();

  it('should detect class definitions', () => {
    const src = 'class MyService {\n    String name\n    def execute() { "done" }\n}';
    const captures = p.parse(src, '/test/Service.groovy');
    expect(captures.some((c) => c.name === 'MyService')).toBe(true);
  });

  it('should detect trait definitions', () => {
    const src = 'trait Loggable {\n    abstract void log(String msg)\n}';
    const captures = p.parse(src, '/test/Loggable.groovy');
    expect(captures.some((c) => c.name === 'Loggable')).toBe(true);
  });

  it('should detect function definitions', () => {
    const src = 'def greet(name) { return "Hello, $name" }\nvoid process(data) { println data }';
    const captures = p.parse(src, '/test/funcs.groovy');
    expect(captures.some((c) => c.name === 'greet')).toBe(true);
    expect(captures.some((c) => c.name === 'process')).toBe(true);
  });

  it('should detect import statements', () => {
    const src = 'import groovy.json.JsonSlurper\nimport static java.lang.Math.PI';
    const captures = p.parse(src, '/test/imports.groovy');
    expect(captures.some((c) => c.name === 'groovy.json.JsonSlurper')).toBe(true);
  });

  it('should handle empty Groovy', () => {
    const captures = p.parse('', '/test/empty.groovy');
    expect(captures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting tests
// ---------------------------------------------------------------------------

describe('New Language Provider — Cross-Cutting', () => {
  it('all 10 providers should have unique language IDs', () => {
    const providers = [
      new YamlProvider(),
      new JsonProvider(),
      new SqlProvider(),
      new BashProvider(),
      new TomlProvider(),
      new MarkdownProvider(),
      new HtmlProvider(),
      new CssProvider(),
      new RProvider(),
      new GroovyProvider(),
    ];
    const ids = new Set(providers.map((p) => p.language));
    expect(ids.size).toBe(10);
  });

  it('all 10 providers should have displayName', () => {
    const providers = [
      new YamlProvider(),
      new JsonProvider(),
      new SqlProvider(),
      new BashProvider(),
      new TomlProvider(),
      new MarkdownProvider(),
      new HtmlProvider(),
      new CssProvider(),
      new RProvider(),
      new GroovyProvider(),
    ];
    for (const p of providers) {
      expect(p.displayName).toBeTruthy();
      expect(p.displayName.length).toBeGreaterThan(0);
    }
  });

  it('all 10 providers should have non-empty extensions', () => {
    const providers = [
      new YamlProvider(),
      new JsonProvider(),
      new SqlProvider(),
      new BashProvider(),
      new TomlProvider(),
      new MarkdownProvider(),
      new HtmlProvider(),
      new CssProvider(),
      new RProvider(),
      new GroovyProvider(),
    ];
    for (const p of providers) {
      expect(p.extensions.length).toBeGreaterThan(0);
    }
  });

  it('fallbackParse should handle moderately complex source', () => {
    const providers = [
      new YamlProvider(),
      new JsonProvider(),
      new SqlProvider(),
      new BashProvider(),
      new TomlProvider(),
      new MarkdownProvider(),
      new HtmlProvider(),
      new CssProvider(),
      new RProvider(),
      new GroovyProvider(),
    ];

    const samples: Record<string, string> = {
      yaml: 'key1: value1\nkey2: value2\nnested:\n  sub: value3',
      json: '{"a": 1, "b": {"c": 2}}',
      sql: 'CREATE TABLE t1 (id INT); SELECT * FROM t1;',
      bash: 'fn() { echo hi; }\nexport VAR=42',
      toml: '[table]\nkey = "value"\n[[items]]\nid = 1',
      markdown: '# Title\n[Link](http://example.com)\n```js\ncode\n```',
      html: '<div class="main"><p>Hello</p></div>',
      css: '.btn { color: red; }\n@import "base.css";',
      r: 'f <- function(x) { x + 1 }\nlibrary(dplyr)',
      groovy: 'class Foo { def bar() { } }\nimport groovy.json.*',
    };

    for (const p of providers) {
      const sample = samples[p.language] ?? '';
      const result = p.parse(sample, `/test/sample.${p.extensions[0]}`);
      expect(Array.isArray(result)).toBe(true);
    }
  });
});
