// The configuration file, read by something.
//
// **What these tests are about.** `loadConfig` existed, was documented in two pages, and was called by no command; `init`
// wrote a second file at a third path with a different schema. Before any command can read a configuration, the reader
// has to answer three questions that the previous implementation did not: *which file won*, *which layer set this value*,
// and *what did I ignore*. The answers are the API — `origin` and `ignored` — and these tests are the contract for them.
//
// Every test disables global discovery explicitly (`globalFile: null`) so that a stray `~/.code-analyzer/config.json` on
// the machine running the suite cannot change what is being measured. The one test that exercises the global layer
// writes into the temporary directory and points the loader at it.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultConfig, loadConfig, loadConfigWithDiagnostics } from '../config/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ca-config-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write a file, creating its parent directory. */
function write(file: string, contents: unknown): string {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return file;
}

describe('which file is the project configuration', () => {
  it('reads .code-analyzer/config.json, the path init writes', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { projectId: 'from-init', maxFiles: 17 });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.config.projectId).toBe('from-init');
    expect(loaded.config.maxFiles).toBe(17);
    expect(loaded.layers.find((layer) => layer.name === 'project')?.path).toBe(
      join(root, '.code-analyzer', 'config.json'),
    );
  });

  it('still reads a root-level .code-analyzer.json', async () => {
    write(join(root, '.code-analyzer.json'), { projectId: 'from-root' });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.config.projectId).toBe('from-root');
    expect(loaded.origin['projectId']).toBe('project');
  });

  it('**prefers the canonical file and says which one it ignored** when both exist', async () => {
    write(join(root, '.code-analyzer.json'), { projectId: 'from-root', maxFiles: 3 });
    write(join(root, '.code-analyzer', 'config.json'), { projectId: 'from-init' });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.config.projectId).toBe('from-init');
    // The value only the ignored file sets must not leak through a merge, because a merged pair of files cannot be
    // reasoned about by the person editing either one of them.
    expect(loaded.config.maxFiles).toBe(getDefaultConfig().maxFiles);
    expect(loaded.warnings.join('\n')).toMatch(/\.code-analyzer\.json.*ignored/s);
  });

  it('an explicit file replaces discovery instead of adding to it', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { projectId: 'discovered' });
    const explicit = write(join(root, 'elsewhere', 'team-config.json'), { projectId: 'explicit' });

    const loaded = await loadConfigWithDiagnostics(root, {
      file: explicit,
      globalFile: null,
      env: false,
    });

    expect(loaded.config.projectId).toBe('explicit');
    expect(loaded.layers.find((layer) => layer.name === 'project')?.found).toBe(false);
    expect(loaded.layers.find((layer) => layer.name === 'explicit')?.path).toBe(explicit);
  });

  it('reads the global layer from the path it is given', async () => {
    const global = write(join(root, 'home', 'config.json'), { maxFiles: 11 });
    write(join(root, '.code-analyzer', 'config.json'), { projectId: 'project' });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: global, env: false });

    expect(loaded.config.maxFiles).toBe(11);
    expect(loaded.origin['maxFiles']).toBe('global');
    // Project did not set projectId? It did. The point of this assertion is that both layers ran.
    expect(loaded.config.projectId).toBe('project');
  });

  it('reports a layer that does not exist rather than pretending it did', async () => {
    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.layers).toContainEqual({ name: 'project', path: null, found: false });
    expect(loaded.origin['maxFiles']).toBe('default');
  });
});

describe('which layer set each value', () => {
  it('records the layer for every key it can answer for', async () => {
    write(join(root, '.code-analyzer', 'config.json'), {
      projectId: 'p',
      review: { maxComments: 7 },
    });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.origin['projectId']).toBe('project');
    expect(loaded.origin['review.maxComments']).toBe('project');
    expect(loaded.origin['maxFileSize']).toBe('default');
  });

  it('records an environment override as the layer that won, by variable name', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { maxFiles: 5 });
    process.env['CODE_ANALYZER_MAX_FILES'] = '9';
    try {
      const loaded = await loadConfigWithDiagnostics(root, { globalFile: null });

      expect(loaded.config.maxFiles).toBe(9);
      expect(loaded.origin['maxFiles']).toBe('env:CODE_ANALYZER_MAX_FILES');
    } finally {
      delete process.env['CODE_ANALYZER_MAX_FILES'];
    }
  });

  it('records a comma-separated environment override of an array', async () => {
    process.env['CODE_ANALYZER_EXCLUDE_PATTERNS'] = 'a/**, b/**';
    try {
      const loaded = await loadConfigWithDiagnostics(root, { globalFile: null });
      expect(loaded.config.excludePatterns).toEqual(['a/**', 'b/**']);
      expect(loaded.origin['excludePatterns']).toBe('env:CODE_ANALYZER_EXCLUDE_PATTERNS');
    } finally {
      delete process.env['CODE_ANALYZER_EXCLUDE_PATTERNS'];
    }
  });
});

describe('what it refuses to ignore', () => {
  it('**names an unknown key instead of dropping it**', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { maxFileSize: 100, maxFileSizes: 200 });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.ignored).toHaveLength(1);
    expect(loaded.ignored[0]?.key).toBe('maxFileSizes');
    expect(loaded.ignored[0]?.file).toBe(join(root, '.code-analyzer', 'config.json'));
    expect(loaded.ignored[0]?.message).toContain('did you mean maxFileSize');
    // The unknown key is not merged into the configuration under any name.
    expect(Object.keys(loaded.config)).not.toContain('maxFileSizes');
  });

  it('says nothing about a key it understood', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { maxFileSize: 100 });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.ignored).toEqual([]);
  });

  it('**refuses a value of the wrong type, naming the file, the key and the expected type**', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { maxFileSize: 'ten megabytes' });

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /\.code-analyzer\/config\.json: maxFileSize must be a positive integer/,
    );
  });

  it('refuses a string where an array of strings belongs', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { excludePatterns: 'node_modules/**' });

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /excludePatterns must be an array of strings/,
    );
  });

  it('refuses a negative number where a count belongs', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { maxFiles: -1 });

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /maxFiles must be a positive integer/,
    );
  });

  it('**names the file when the JSON does not parse**', async () => {
    write(join(root, '.code-analyzer', 'config.json'), '{ "maxFiles": 3, }');

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /\.code-analyzer\/config\.json: not valid JSON/,
    );
  });

  it('refuses a JSON array, which is not a configuration', async () => {
    write(join(root, '.code-analyzer', 'config.json'), '[1, 2, 3]');

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /must contain a JSON object/,
    );
  });
});

describe('the signature the rest of the code already uses', () => {
  it('loadConfig returns the configuration and nothing else', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { projectId: 'p' });

    const config = await loadConfig(root);

    expect(config.projectId).toBe('p');
    expect(Object.keys(config)).not.toContain('origin');
  });
});

describe('a nested block, which is where a flat test would have stopped', () => {
  it('**records the origin of a nested key by its dotted path**', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { mcp: { maxResults: 5 } });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.origin['mcp.maxResults']).toBe('project');
    // The rest of the block was never set by anything, so it is not in the configuration and not in the origins: a key
    // that does not exist is not the same fact as a key that has its default.
    expect(loaded.config.mcp?.enablePrompts).toBeUndefined();
    expect(loaded.origin['mcp.enablePrompts']).toBeUndefined();
  });

  it('reports an unknown key inside a block, not just at the top level', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { mcp: { maxResult: 5 } });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: null, env: false });

    expect(loaded.ignored[0]?.key).toBe('mcp.maxResult');
    expect(loaded.ignored[0]?.message).toContain('did you mean mcp.maxResults');
  });
});

describe('the environment, which is a layer like any other but easier to get wrong', () => {
  it('**refuses a variable that does not parse, naming the variable**', async () => {
    process.env['CODE_ANALYZER_MAX_FILES'] = 'none';
    try {
      await expect(loadConfigWithDiagnostics(root, { globalFile: null })).rejects.toThrow(
        /CODE_ANALYZER_MAX_FILES must be a positive integer, got "none"/,
      );
    } finally {
      delete process.env['CODE_ANALYZER_MAX_FILES'];
    }
  });

  it('refuses a variable that contradicts a boolean', async () => {
    process.env['CODE_ANALYZER_REVIEW_ENABLED'] = 'yes-please';
    try {
      await expect(loadConfigWithDiagnostics(root, { globalFile: null })).rejects.toThrow(
        /CODE_ANALYZER_REVIEW_ENABLED must be true or false/,
      );
    } finally {
      delete process.env['CODE_ANALYZER_REVIEW_ENABLED'];
    }
  });
});

describe('the thin wrapper keeps stdout clean', () => {
  it('**sends the diagnostics to stderr**, because the caller may be printing JSON', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { maxFileSizes: 1 });
    write(join(root, '.code-analyzer.json'), { projectId: 'legacy' });

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    // **`HOME` is moved to the temporary directory for the duration of the call**, because `loadConfig` — the one-line
    // signature the rest of the code uses — takes no options and therefore always reads `~/.code-analyzer/config.json`.
    // Another test file in the same run writes exactly that path to exercise the global layer, so without this the
    // assertion would be about whichever worker happened to write last.
    const home = process.env['HOME'];
    process.env['HOME'] = join(root, 'home');
    try {
      const config = await loadConfig(root);
      expect(config.projectId).toBe('');
      const output = errors.join('\n');
      expect(output).toContain('.code-analyzer.json is ignored');
      expect(output).toContain('maxFileSizes');
    } finally {
      process.env['HOME'] = home;
      spy.mockRestore();
    }
  });
});

describe('a file that cannot be a configuration at all', () => {
  it('names the directory when the path is one', async () => {
    const dir = join(root, '.code-analyzer', 'config.json');
    mkdirSync(dir, { recursive: true });

    await expect(
      loadConfigWithDiagnostics(root, { file: dir, globalFile: null, env: false }),
    ).rejects.toThrow(/EISDIR|illegal operation on a directory/i);
  });

  it('refuses a document that is JSON but not an object', async () => {
    write(join(root, '.code-analyzer', 'config.json'), 'null');

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /must contain a JSON object, got null/,
    );
  });
});

describe('a value of the wrong shape is described in the terms it arrived in', () => {
  it('says `null` when the value is null', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { excludePatterns: null });

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /excludePatterns must be an array of strings, got null/,
    );
  });

  it('says `an array` when the value is the wrong array', async () => {
    write(join(root, '.code-analyzer', 'config.json'), { maxFiles: [] });

    await expect(loadConfigWithDiagnostics(root, { globalFile: null, env: false })).rejects.toThrow(
      /maxFiles must be a positive integer, got an array/,
    );
  });
});

describe('the same block in two layers', () => {
  it('**merges the block and keeps both origins**, instead of one layer replacing the other', async () => {
    const global = write(join(root, 'home', 'config.json'), { mcp: { name: 'from-global' } });
    write(join(root, '.code-analyzer', 'config.json'), { mcp: { maxResults: 7 } });

    const loaded = await loadConfigWithDiagnostics(root, { globalFile: global, env: false });

    expect(loaded.config.mcp?.name).toBe('from-global');
    expect(loaded.config.mcp?.maxResults).toBe(7);
    expect(loaded.origin['mcp.name']).toBe('global');
    expect(loaded.origin['mcp.maxResults']).toBe('project');
  });
});
