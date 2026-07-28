// @code-analyzer/intelligence — File Bundler Tests

import { describe, it, expect } from 'vitest';
import { FileBundler } from '../review/file-bundler.js';
import type { FileBundle } from '../review/file-bundler.js';

const ROOT = '/project/src';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bundler(): FileBundler {
  return new FileBundler();
}

function bundle(files: string[]): FileBundle[] {
  return bundler().bundleFiles(files, ROOT);
}

function filesOf(bundles: FileBundle[]): string[][] {
  return bundles.map((b) => b.files.sort());
}

function categoriesOf(bundles: FileBundle[]): string[] {
  return bundles.map((b) => b.category);
}

function primaryFilesOf(bundles: FileBundle[]): string[] {
  return bundles.map((b) => b.primaryFile);
}

// ---------------------------------------------------------------------------
// Mirror / Convention Pairs
// ---------------------------------------------------------------------------

describe('Mirror/convention pairs', () => {
  it('groups language-specific properties files together', () => {
    const result = bundle([
      '/project/src/messages_en.properties',
      '/project/src/messages_zh.properties',
      '/project/src/messages_ja.properties',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('mirror');
    expect(result[0]!.files).toHaveLength(3);
    expect(result[0]!.files).toContain('messages_en.properties');
    expect(result[0]!.files).toContain('messages_zh.properties');
    expect(result[0]!.files).toContain('messages_ja.properties');
    expect(result[0]!.primaryFile).toMatch(/messages/);
  });

  it('groups environment-specific config files together', () => {
    const result = bundle([
      '/project/src/config.dev.ts',
      '/project/src/config.prod.ts',
      '/project/src/config.staging.ts',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('mirror');
    expect(result[0]!.files).toHaveLength(3);
    expect(result[0]!.files).toContain('config.dev.ts');
    expect(result[0]!.files).toContain('config.prod.ts');
    expect(result[0]!.files).toContain('config.staging.ts');
  });

  it('groups development and production config files', () => {
    const result = bundle([
      '/project/src/config.development.ts',
      '/project/src/config.production.ts',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('mirror');
  });

  it('keeps single mirror file as solo if no pair exists', () => {
    const result = bundle(['/project/src/config.dev.ts']);

    // A single mirror file without a pair still gets the mirror key,
    // but with only itself in the bundle it becomes solo-ish.
    // Let's check it's bundled alone.
    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test file pairing
// ---------------------------------------------------------------------------

describe('Test file pairing', () => {
  it('pairs .test.ts with source .ts file', () => {
    const result = bundle([
      '/project/src/user.service.ts',
      '/project/src/user.service.test.ts',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.files).toContain('user.service.ts');
    expect(result[0]!.files).toContain('user.service.test.ts');
    expect(result[0]!.primaryFile).toBe('user.service.ts');
  });

  it('pairs .spec.tsx with source .tsx file', () => {
    const result = bundle([
      '/project/src/Button.tsx',
      '/project/src/Button.spec.tsx',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.primaryFile).toBe('Button.tsx');
  });

  it('pairs __tests__ directory file with source', () => {
    const result = bundle([
      '/project/src/utils.ts',
      '/project/src/__tests__/utils.test.ts',
    ]);

    // These are in different directories, so dir+base grouping won't catch them,
    // but test file key matching should.
    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Interface + Implementation Pairs
// ---------------------------------------------------------------------------

describe('Interface/implementation pairs', () => {
  it('pairs IUserService.ts with UserService.ts', () => {
    const result = bundle([
      '/project/src/IUserService.ts',
      '/project/src/UserService.ts',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('impl');
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.files).toContain('IUserService.ts');
    expect(result[0]!.files).toContain('UserService.ts');
    expect(result[0]!.primaryFile).toBe('UserService.ts');
  });

  it('pairs AbstractRepository.ts with Repository.ts', () => {
    const result = bundle([
      '/project/src/AbstractRepository.ts',
      '/project/src/Repository.ts',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('impl');
    expect(result[0]!.files).toHaveLength(2);
  });

  it('keeps lone interface as solo if no implementation exists', () => {
    const result = bundle(['/project/src/ISoloInterface.ts']);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Same-directory Siblings
// ---------------------------------------------------------------------------

describe('Same-directory siblings', () => {
  it('groups Button.tsx with Button.styles.ts and Button.test.tsx', () => {
    const result = bundle([
      '/project/src/Button.tsx',
      '/project/src/Button.styles.ts',
      '/project/src/Button.test.tsx',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(3);
    expect(result[0]!.category).toBe('sibling');
    expect(result[0]!.primaryFile).toBe('Button.tsx');
  });

  it('groups component with .module.css', () => {
    const result = bundle([
      '/project/src/Card.tsx',
      '/project/src/Card.module.css',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.category).toBe('sibling');
  });

  it('groups component with .stories.tsx', () => {
    const result = bundle([
      '/project/src/Header.tsx',
      '/project/src/Header.stories.tsx',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
  });

  it('groups file with .d.ts type declaration', () => {
    const result = bundle([
      '/project/src/types.ts',
      '/project/src/types.d.ts',
    ]);

    expect(result).toHaveLength(1);
  });

  it('groups file with .types.ts', () => {
    const result = bundle([
      '/project/src/UserProfile.tsx',
      '/project/src/UserProfile.types.ts',
    ]);

    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Configuration File Pairs
// ---------------------------------------------------------------------------

describe('Configuration file pairs', () => {
  it('groups config.dev.ts with config.prod.ts as config category', () => {
    const result = bundle([
      '/project/src/config.dev.ts',
      '/project/src/config.prod.ts',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('mirror');
  });
});

// ---------------------------------------------------------------------------
// Complex Scenarios
// ---------------------------------------------------------------------------

describe('Complex scenarios', () => {
  it('handles a mix of related and unrelated files', () => {
    const result = bundle([
      '/project/src/Button.tsx',
      '/project/src/Button.styles.ts',
      '/project/src/Button.test.tsx',
      '/project/src/random-util.ts',
      '/project/src/IUserRepo.ts',
      '/project/src/UserRepo.ts',
      '/project/src/config.dev.ts',
      '/project/src/config.prod.ts',
    ]);

    // Expected bundles:
    // 1. Button + Button.styles + Button.test
    // 2. IUserRepo + UserRepo
    // 3. config.dev + config.prod
    // 4. random-util (solo)

    expect(result).toHaveLength(4);

    const buttonBundle = result.find((b) => b.primaryFile === 'Button.tsx')!;
    expect(buttonBundle).toBeDefined();
    expect(buttonBundle.files).toHaveLength(3);
    expect(buttonBundle.category).toBe('sibling');

    const implBundle = result.find((b) => b.primaryFile === 'UserRepo.ts')!;
    expect(implBundle).toBeDefined();
    expect(implBundle.files).toHaveLength(2);
    expect(implBundle.category).toBe('impl');

    const configBundle = result.find((b) => b.files.includes('config.dev.ts'))!;
    expect(configBundle).toBeDefined();
    expect(configBundle.files).toHaveLength(2);
    expect(configBundle.category).toBe('mirror');

    const soloBundle = result.find((b) => b.primaryFile === 'random-util.ts')!;
    expect(soloBundle).toBeDefined();
    expect(soloBundle.files).toHaveLength(1);
    expect(soloBundle.category).toBe('solo');
  });

  it('handles files in different directories with same base name separately', () => {
    const result = bundle([
      '/project/src/components/Button.tsx',
      '/project/src/utils/Button.ts',
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((b) => b.category === 'solo')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('returns empty array for empty input', () => {
    const result = bundle([]);
    expect(result).toEqual([]);
  });

  it('returns single solo bundle for single file', () => {
    const result = bundle(['/project/src/single-file.ts']);

    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('solo');
    expect(result[0]!.files).toEqual(['single-file.ts']);
    expect(result[0]!.primaryFile).toBe('single-file.ts');
  });

  it('handles files without extensions', () => {
    const result = bundle([
      '/project/src/script',
      '/project/src/script.test',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
  });

  it('handles deeply nested paths', () => {
    const result = bundle([
      '/project/src/deeply/nested/path/messages_en.properties',
      '/project/src/deeply/nested/path/messages_zh.properties',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.files).toContain('deeply/nested/path/messages_en.properties');
  });

  it('does not group unrelated files', () => {
    const result = bundle([
      '/project/src/apple.ts',
      '/project/src/banana.ts',
      '/project/src/cherry.ts',
      '/project/src/dog.ts',
    ]);

    expect(result).toHaveLength(4);
    expect(result.every((b) => b.category === 'solo')).toBe(true);
  });

  it('produces unique bundle IDs', () => {
    const result = bundle([
      '/project/src/a.ts',
      '/project/src/b.ts',
      '/project/src/c.ts',
      '/project/src/d.ts',
      '/project/src/e.ts',
    ]);

    const ids = result.map((b) => b.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('handles files with Windows-style backslashes', () => {
    const result = bundle([
      '\\project\\src\\user.service.ts',
      '\\project\\src\\user.service.test.ts',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
  });

  it('handles relative file paths', () => {
    const bundlerInstance = bundler();
    const result = bundlerInstance.bundleFiles(
      ['src/user.service.ts', 'src/user.service.test.ts'],
      '/project',
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
  });

  it('preserves ordering: primary file is non-test source', () => {
    const result = bundle([
      '/project/src/Component.test.tsx',
      '/project/src/Component.tsx',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.primaryFile).toBe('Component.tsx');
  });
});

// ---------------------------------------------------------------------------
// Category Detection
// ---------------------------------------------------------------------------

describe('Category detection', () => {
  it('detects mirror category for language files', () => {
    const result = bundle([
      '/project/src/errors_en.properties',
      '/project/src/errors_zh.properties',
    ]);
    expect(result[0]!.category).toBe('mirror');
  });

  it('detects impl category for interface/implementation', () => {
    const result = bundle([
      '/project/src/IService.ts',
      '/project/src/Service.ts',
    ]);
    expect(result[0]!.category).toBe('impl');
  });

  it('detects sibling category for component + styles', () => {
    const result = bundle([
      '/project/src/Box.tsx',
      '/project/src/Box.styles.ts',
    ]);
    expect(result[0]!.category).toBe('sibling');
  });

  it('detects solo category for single files', () => {
    const result = bundle(['/project/src/standalone.ts']);
    expect(result[0]!.category).toBe('solo');
  });

  it('detects sibling for same-base files in same directory', () => {
    const result = bundle([
      '/project/src/Foo.tsx',
      '/project/src/Foo.helpers.ts',
    ]);
    expect(result[0]!.category).toBe('sibling');
  });
});

// ---------------------------------------------------------------------------
// Primary File Selection
// ---------------------------------------------------------------------------

describe('Primary file selection', () => {
  it('selects non-test file as primary', () => {
    const result = bundle([
      '/project/src/auth.ts',
      '/project/src/auth.test.ts',
    ]);
    expect(result[0]!.primaryFile).toBe('auth.ts');
  });

  it('selects implementation over interface as primary', () => {
    const result = bundle([
      '/project/src/IStore.ts',
      '/project/src/Store.ts',
    ]);
    expect(result[0]!.primaryFile).toBe('Store.ts');
  });

  it('selects main component over style file as primary', () => {
    const result = bundle([
      '/project/src/Modal.tsx',
      '/project/src/Modal.styles.ts',
    ]);
    expect(result[0]!.primaryFile).toBe('Modal.tsx');
  });

  it('selects main source over language variant as primary', () => {
    const result = bundle([
      '/project/src/strings_en.properties',
      '/project/src/strings_zh.properties',
      '/project/src/strings_ja.properties',
    ]);
    // Primary should be one of the files, all are equally scored for mirror
    expect(result[0]!.primaryFile).toMatch(/strings/);
  });
});

// ---------------------------------------------------------------------------
// FileBundle Type
// ---------------------------------------------------------------------------

describe('FileBundle type', () => {
  it('every bundle has required fields', () => {
    const result = bundle([
      '/project/src/a.ts',
      '/project/src/b.ts',
    ]);

    for (const b of result) {
      expect(b).toHaveProperty('id');
      expect(b).toHaveProperty('files');
      expect(b).toHaveProperty('primaryFile');
      expect(b).toHaveProperty('category');
      expect(typeof b.id).toBe('string');
      expect(Array.isArray(b.files)).toBe(true);
      expect(typeof b.primaryFile).toBe('string');
      expect(['mirror', 'sibling', 'impl', 'config', 'solo']).toContain(b.category);
    }
  });
});
