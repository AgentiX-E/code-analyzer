// What the configuration file actually changes about an analysis.
//
// **The question these tests answer is the one the previous state could not.** `loadConfig` merged four layers and nobody
// called it; `init` wrote `.code-analyzer/config.json` and nothing read it; `--exclude` was parsed, merged into
// `config.excludePatterns`, and then dropped by a discovery phase that never looked at the field. A test that asserted
// `loadConfig` returned the right object would have passed through all three. So these assertions are about the graph:
// how many files the run discovered, and which project id it stamped them with.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfigWithDiagnostics } from '@code-analyzer/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyzeRepository } from '../commands/analyze.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ca-analyze-config-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const app = 1;\n');
  writeFileSync(join(root, 'src', 'app.test.ts'), 'export const test = 2;\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write the project configuration the way `init` does. */
function writeConfig(contents: unknown): void {
  const dir = join(root, '.code-analyzer');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(contents, null, 2));
}

describe('the configuration decides what is discovered', () => {
  // **`graph.fileCount` counts folder nodes as well as file nodes**, because `fileIndex` is the graph's path index and a
  // path can be either. So the assertions here are differences between two runs of the same fixture rather than absolute
  // numbers: an absolute number would encode how many directories the fixture happens to have, and would pass for the
  // wrong reason if the walk started returning folders.
  it('**a file the configuration excludes is not in the graph**', async () => {
    // **An empty configuration first, so that the only difference between the two runs is the exclusion.** The file
    // itself is discovered — `.json` is a language this product indexes — so a baseline without it would compare two
    // checkouts that differ by one file before the exclusion is even considered.
    writeConfig({});
    const both = await analyzeRepository({
      path: root,
      config: (await loadConfigWithDiagnostics(root, { env: false })).config,
    });

    writeConfig({ excludePatterns: ['**/*.test.ts'] });
    const excluded = await analyzeRepository({
      path: root,
      config: (await loadConfigWithDiagnostics(root, { env: false })).config,
    });

    expect(both.success).toBe(true);
    expect(excluded.success).toBe(true);
    // Exactly one entry fewer: the excluded file. The `src` folder they share was already in the index, so a difference
    // of two would mean the exclusion had taken a directory with it.
    expect(both.graph.fileCount - excluded.graph.fileCount).toBe(1);
  });

  it('a `maxFiles` in the file caps the walk', async () => {
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 3;\n');
    writeFileSync(join(root, 'src', 'c.ts'), 'export const c = 4;\n');

    const uncapped = await analyzeRepository({
      path: root,
      config: (await loadConfigWithDiagnostics(root, { env: false })).config,
    });

    writeConfig({ maxFiles: 1 });
    const capped = await analyzeRepository({
      path: root,
      config: (await loadConfigWithDiagnostics(root, { env: false })).config,
    });

    expect(uncapped.graph.fileCount).toBeGreaterThan(capped.graph.fileCount);
  });
});

describe('the project id, which has three sources and one order', () => {
  it('comes from the configuration file when no flag is given', async () => {
    writeConfig({ projectId: 'from-config' });
    const config = (await loadConfigWithDiagnostics(root, { env: false })).config;

    const result = await analyzeRepository({ path: root, config });

    expect(result.projectId).toBe('from-config');
  });

  it('**a flag beats the file**, because a flag is a decision about one run', async () => {
    writeConfig({ projectId: 'from-config' });
    const config = (await loadConfigWithDiagnostics(root, { env: false })).config;

    const result = await analyzeRepository({ path: root, config, projectId: 'from-flag' });

    expect(result.projectId).toBe('from-flag');
  });

  it('falls back to the derived id when neither names one', async () => {
    const config = (await loadConfigWithDiagnostics(root, { env: false })).config;

    const result = await analyzeRepository({ path: root, config });

    expect(result.projectId.length).toBeGreaterThan(0);
  });
});
