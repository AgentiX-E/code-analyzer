// The `config` command — the consumer `loadConfig` never had.
//
// **What is being tested is the answer, not the formatting.** Every page that documented the configuration described a
// four-layer merge, and for the whole life of the feature nothing performed it. So the tests ask the three questions a
// reader asks when a value is not what they expected: which file was read, which layer set this value, and what in the
// file was ignored. The rendering matters only in that it has to keep those three visible in one place.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runConfigCommand } from '../commands/config.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ca-config-cmd-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env['CODE_ANALYZER_MAX_FILES'];
});

function writeConfig(contents: unknown): string {
  const dir = join(root, '.code-analyzer');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(contents, null, 2));
  return file;
}

describe('the report a reader gets', () => {
  it('**names the file that won and the layer that set each value**', async () => {
    const file = writeConfig({ projectId: 'demo', maxFiles: 42 });

    const result = await runConfigCommand({ path: root, env: false });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`project   ✓ ${file}`);
    // The value, the layer, and the fact that the two are adjacent: a table where the source column could drift from the
    // value column would answer the question and be wrong.
    expect(result.output).toMatch(/^projectId\s+demo\s+project$/m);
    expect(result.output).toMatch(/^maxFiles\s+42\s+project$/m);
    expect(result.output).toMatch(/^maxFileSize\s+\d+\s+default$/m);
  });

  it('says which layers it looked for and did not find', async () => {
    const result = await runConfigCommand({ path: root, env: false });

    expect(result.output).toMatch(/global\s+· not found/);
    expect(result.output).toMatch(/project\s+· not found/);
  });

  it('**prints the keys it ignored, with the file they were in**', async () => {
    writeConfig({ projectId: 'demo', index: { maxFileSize: 10 } });

    const result = await runConfigCommand({ path: root, env: false });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Ignored 1 setting(s)');
    expect(result.output).toMatch(/config\.json: index — unknown setting/);
    expect(result.warnings).toEqual([expect.stringContaining('index')]);
  });

  it('truncates a long list rather than printing a wall of globs', async () => {
    writeConfig({ excludePatterns: ['a', 'b', 'c', 'd', 'e'] });

    const result = await runConfigCommand({ path: root, env: false });

    expect(result.output).toContain('a, b, c, … (5 items)');
  });

  it('renders an empty string as a visible "" so the cell is not mistaken for blank', async () => {
    writeConfig({ projectId: '' });

    const result = await runConfigCommand({ path: root, env: false });

    expect(result.output).toMatch(/^projectId\s+""\s+project$/m);
  });
});

describe('machine-readable output', () => {
  it('carries the configuration, the origins, the layers and the ignored keys', async () => {
    const file = writeConfig({ projectId: 'demo' });

    const result = await runConfigCommand({ path: root, env: false, json: true });
    const payload = JSON.parse(result.output) as {
      rootPath: string;
      config: { projectId: string };
      origin: Record<string, string>;
      layers: Array<{ name: string; path: string | null; found: boolean }>;
      ignored: unknown[];
    };

    expect(payload.config.projectId).toBe('demo');
    expect(payload.origin['projectId']).toBe('project');
    expect(payload.layers).toContainEqual({ name: 'project', path: file, found: true });
    expect(payload.ignored).toEqual([]);
    // **stdout stays parseable**, so warnings travel beside the JSON rather than inside the string a caller pipes.
    expect(result.output.trimEnd().endsWith('}')).toBe(true);
  });
});

describe('the two ways it refuses', () => {
  it('exits 1 under --strict when a file names a key this version does not have', async () => {
    writeConfig({ maxFileSizes: 5 });

    const result = await runConfigCommand({ path: root, env: false, strict: true });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('maxFileSizes');
  });

  it('**exits 2 and says why when the file it was pointed at does not exist**', async () => {
    const result = await runConfigCommand({
      path: root,
      env: false,
      file: join(root, 'nope.json'),
    });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('nope.json: no such file');
  });

  it('exits 2 when the file is not JSON, naming the file', async () => {
    const dir = join(root, '.code-analyzer');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{ nope');

    const result = await runConfigCommand({ path: root, env: false });

    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/config\.json: not valid JSON/);
  });
});

describe('the environment layer, and how to skip it', () => {
  it('shows an environment override as the layer that won', async () => {
    process.env['CODE_ANALYZER_MAX_FILES'] = '77';

    const result = await runConfigCommand({ path: root, json: true });
    const payload = JSON.parse(result.output) as {
      config: { maxFiles: number };
      origin: Record<string, string>;
    };

    expect(payload.config.maxFiles).toBe(77);
    expect(payload.origin['maxFiles']).toBe('env:CODE_ANALYZER_MAX_FILES');
  });

  it('`--no-env` gives the value from the file instead', async () => {
    writeConfig({ maxFiles: 12 });
    process.env['CODE_ANALYZER_MAX_FILES'] = '77';

    const result = await runConfigCommand({ path: root, env: false, json: true });
    const payload = JSON.parse(result.output) as { config: { maxFiles: number } };

    expect(payload.config.maxFiles).toBe(12);
  });
});

describe('how a value reads in the table', () => {
  // The renderer is the only place this report can say something false, so every shape a JSON document can hold is
  // checked here rather than inferred from one example.
  it('renders scalars, arrays and the defensive object case', async () => {
    const { renderValue } = await import('../commands/config.js');

    expect(renderValue('node_modules/**')).toBe('node_modules/**');
    expect(renderValue('')).toBe('""');
    expect(renderValue(12)).toBe('12');
    expect(renderValue(true)).toBe('true');
    expect(renderValue(null)).toBe('null');
    expect(renderValue([])).toBe('[]');
    expect(renderValue(['a', 'b'])).toBe('a, b');
    expect(renderValue(['a', 'b', 'c', 'd'])).toBe('a, b, c, … (4 items)');
    // **Not `[object Object]`.** The schema rejects an object at a leaf, and the report still must not print one.
    expect(renderValue({ nested: 1 })).toBe('{…}');
    expect(renderValue([{ nested: 1 }])).toBe('{…}');
  });
});

describe('two project files', () => {
  it('**names the one that lost**, so an edit to it is not silently discarded', async () => {
    const file = writeConfig({ projectId: 'canonical' });
    writeFileSync(join(root, '.code-analyzer.json'), JSON.stringify({ projectId: 'legacy' }));

    const result = await runConfigCommand({ path: root, env: false });

    expect(result.output).toMatch(/warning: .*\.code-analyzer\.json is ignored/);
    expect(result.output).toContain(file);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('a nested block reads as a dotted key', () => {
  it('**shows `mcp.maxResults`, not `mcp {…}`**', async () => {
    writeConfig({ mcp: { maxResults: 5, enablePrompts: false } });

    const result = await runConfigCommand({ path: root, env: false });

    expect(result.output).toMatch(/^mcp\.maxResults\s+5\s+project$/m);
    expect(result.output).toMatch(/^mcp\.enablePrompts\s+false\s+project$/m);
  });
});

describe('a value too long for the column', () => {
  it('is cut with an ellipsis rather than pushing the table out of shape', async () => {
    const long = 'x'.repeat(80);
    writeConfig({ cacheDir: long });

    const result = await runConfigCommand({ path: root, env: false });

    const row = result.output.split('\n').find((line) => line.startsWith('cacheDir'));
    expect(row).toBeDefined();
    expect(row).toContain('…');
    expect(row?.length).toBeLessThan(140);
  });
});

describe('with no path given', () => {
  it('reports the configuration of the working directory', async () => {
    writeConfig({ projectId: 'cwd-project' });
    const previous = process.cwd();
    process.chdir(root);
    try {
      const result = await runConfigCommand({ env: false });
      expect(result.output).toContain('cwd-project');
    } finally {
      process.chdir(previous);
    }
  });
});
