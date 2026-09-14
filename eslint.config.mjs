import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Base recommended configs
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  prettierConfig,

  // Global settings
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Bounded, and deliberately not a directory glob: the project service rejects a pattern that
          // matches many files, and the previous `**/__tests__/**` matched enough of them to make every
          // file in the repository a parsing error. The suites are handled by disabling the type-aware
          // rules for them, below.
          allowDefaultProject: ['*.cjs', '*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
  },

  // Production code rules
  {
    rules: {
      // Allow _ prefix for unused
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Module resolution in a pnpm workspace is what the typecheck ratchet enforces, and it is the
      // authoritative gate for it. Here the resolver reads each dependency's built entry points, so its
      // verdict changes with whether the workspace has been built — which the lint gate must not depend
      // on. Measured on CI it produced an `Unable to resolve '@code-analyzer/shared'` family that does
      // not exist once the packages are built.
      'import/no-unresolved': 'off',

      // Console only for warn/error
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Import ordering
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // No any in production
      '@typescript-eslint/no-explicit-any': 'error',

      // The type-aware rules that used to live here are gone with the type-aware base: they depend on
      // a fully built workspace, which is what made the gate's numbers move between machines.
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Stub/pipeline phase files: async methods may not await (placeholder implementations)
  {
    files: ['**/pipeline/phases.ts', '**/phases.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Test files: relaxed rules.
  //
  // The suites belong to `tsconfig.tests.json`, not to a package project, so the project service is
  // told where to find them. `defaultProject` is that mechanism; unlike `allowDefaultProject` it has
  // no cap on the number of files it covers, which is why the suites are handled here.
  {
    languageOptions: {
      parserOptions: {
        projectService: { defaultProject: 'tsconfig.tests.json' },
      },
    },
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'tests/**/*.ts',
      'tests/**/*.tsx',
      '**/__tests__/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },

  // Config and script files: relaxed
  {
    files: ['*.config.{js,mjs,ts}', 'scripts/**/*.{js,mjs,ts}', 'vitest.*.config.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Ignore build artifacts
  {
    // Root-relative patterns match only the repository root, so nested build output was being linted.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'pnpm-lock.yaml',
    ],
  },
);
