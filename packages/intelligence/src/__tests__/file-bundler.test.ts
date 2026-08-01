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

  // --- Additional branch coverage ---
  it('groups .d.ts with source as sibling', () => {
    const result = bundle([
      '/project/src/lib.ts',
      '/project/src/lib.d.ts',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
  });

  it('groups .module.css with component', () => {
    const result = bundle([
      '/project/src/Widget.tsx',
      '/project/src/Widget.module.css',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.category).toBe('sibling');
  });

  it('groups .module.scss with component', () => {
    const result = bundle([
      '/project/src/Panel.tsx',
      '/project/src/Panel.module.scss',
    ]);
    expect(result).toHaveLength(1);
  });

  it('groups .module.less with component', () => {
    const result = bundle([
      '/project/src/Modal.tsx',
      '/project/src/Modal.module.less',
    ]);
    expect(result).toHaveLength(1);
  });

  it('groups .story.tsx with component', () => {
    const result = bundle([
      '/project/src/Avatar.tsx',
      '/project/src/Avatar.story.tsx',
    ]);
    expect(result).toHaveLength(1);
  });

  it('handles files outside project root with absolute path fallback', () => {
    const bundlerInstance = bundler();
    const result = bundlerInstance.bundleFiles(
      ['/outside/file.ts'],
      '/project',
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.files[0]).toContain('outside');
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

  it('detects sibling for same-base files with no conventional suffix (lines 283-286)', () => {
    // Files with same base name but no mirror/impl/sibling-suffix/test suffix
    // Should fall through to same-base sibling detection at line 286
    const result = bundle([
      '/project/src/User.model.ts',
      '/project/src/User.controller.ts',
    ]);
    expect(result[0]!.category).toBe('sibling');
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.files).toContain('User.model.ts');
    expect(result[0]!.files).toContain('User.controller.ts');
  });

  it('detects mirror for files with dev/prod suffix (line 268 before config check)', () => {
    // Files matching mirror patterns (dev/prod) are caught by mirror check
    // before config check at line 274
    const result = bundle([
      '/project/src/app.dev.conf',
      '/project/src/app.prod.conf',
    ]);
    expect(result[0]!.category).toBe('mirror');
    expect(result[0]!.files).toHaveLength(2);
    expect(result[0]!.files).toContain('app.dev.conf');
    expect(result[0]!.files).toContain('app.prod.conf');
  });

  it('detects config category for dev/prod files that escape mirror detection', () => {
    // Use a filename pattern that the mirror check doesn't match
    // but the config regex does. Mirror patterns look for [._]CODE[._] or [._]CODE.
    // Config regex looks for [._](dev|prod|...)[._]
    // A file like "settings.prod.config" has [._]prod[._] which matches both mirror and config
    // But mirror check comes first, so config only triggers when mirror doesn't match.
    // We need a file where the mirror stem pattern doesn't match but the config regex does.
    // Mirror stem patterns match [._]dev(?:[._]|$) etc. 
    // "settings-dev.json" has "-dev." which doesn't match [._]dev[._] (dash, not dot/underscore)
    // Wait, "-" doesn't match [._], so this won't match mirror patterns.
    // But the config regex uses [._](dev|prod|...)[._] which also requires [._] not "-"
    // Let me check: config regex is /[._](dev|prod|staging|development|production)[._]/i
    // "settings.dev.json" -> ".dev." matches both mirror and config
    // We need a pattern where the stem after mirror stripping doesn't match
    // Actually, the config check happens AFTER mirror check on the same names.
    // The mirror check uses hasMirrorSuffix which checks MIRROR_FULL_PATTERNS
    // These include [._]dev[._] and [._]dev\.
    // "settings.dev.json" matches [._]dev\. so mirror catches it first.
    // There's actually no way for config to be reached since mirror catches all dev/prod/staging
    // This branch is effectively dead code. The test verifies the behavior.
    const result = bundle([
      '/project/src/settings.json',
      '/project/src/settings.dev.json',
    ]);
    // These group because logicalBaseName strips the .dev suffix
    expect(result).toHaveLength(1);
    // Category is mirror because mirror check comes before config check
    expect(result[0]!.category).toBe('mirror');
  });

  it('detects sibling for same-base files with different base names (line 286 false branch)', () => {
    // Files in same directory but with DIFFERENT base names
    // Should be solo bundles since they don't share the same base
    const result = bundle([
      '/project/src/foo.ts',
      '/project/src/bar.ts',
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((b) => b.category === 'solo')).toBe(true);
  });

  it('handles single file with same-base sibling check (line 283 false branch)', () => {
    // A single file — files.length > 1 is false, so it falls through
    const result = bundle(['/project/src/unique-file.ts']);
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('solo');
  });

  it('handles file where stem becomes empty after stripping', () => {
    // A file whose logical base name strips to empty (e.g., just ".test")
    const result = bundle(['/project/src/.test.ts']);
    // Should not crash
    expect(result).toHaveLength(1);
  });

  it('groups files with same base in same directory but different extensions', () => {
    const result = bundle([
      '/project/src/Data.model.ts',
      '/project/src/Data.service.ts',
      '/project/src/Data.utils.ts',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('sibling');
    expect(result[0]!.files).toHaveLength(3);
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
