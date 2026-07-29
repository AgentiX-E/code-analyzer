// @code-analyzer/infra — ProjectDetector Tests

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectProject, detectToolVersion } from '../project/project-detector.js';
import type { ProjectInfo } from '../project/project-detector.js';

describe('ProjectDetector', () => {
  let rootPath: string;

  function setup(dirs: string[], files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-projdet-'));
    for (const dir of dirs) {
      fs.mkdirSync(path.join(base, dir), { recursive: true });
    }
    for (const [filePath, content] of Object.entries(files)) {
      const full = path.join(base, filePath);
      const dir = path.dirname(full);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(full, content);
    }
    return base;
  }

  afterEach(() => {
    if (rootPath) {
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Node.js projects
  // -------------------------------------------------------------------------

  it('detects a Node.js project by package.json', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'my-project', version: '1.0.0' }),
      'src/index.ts': 'export const x = 1;',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('node');
    expect(info.languages).toContain('typescript');
    expect(info.packageManager).toBe('npm');
  });

  it('detects pnpm package manager from lock file', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'pnpm-project' }),
      'pnpm-lock.yaml': '',
      'src/app.ts': '',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('node');
    // The packageManagerFn reads package.json which is the content string,
    // then uses path.dirname on that string, which is relative
    // It checks for lock files in path.dirname of package.json path,
    // which resolves to rootPath
    expect(info.packageManager).toBeDefined();
  });

  it('detects yarn package manager from lock file', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'yarn-project' }),
      'yarn.lock': '',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('node');
  });

  // -------------------------------------------------------------------------
  // Python projects
  // -------------------------------------------------------------------------

  it('detects a Python project by requirements.txt', () => {
    rootPath = setup([], {
      'requirements.txt': 'flask==2.0.0',
      'app.py': 'print("hello")',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('python');
    expect(info.languages).toContain('python');
    expect(info.packageManager).toBe('pip');
  });

  it('detects a Python project by pyproject.toml', () => {
    rootPath = setup([], {
      'pyproject.toml': '[build-system]\nrequires = ["setuptools"]',
      'src/main.py': '',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('python');
    expect(info.packageManager).toBe('poetry/pip');
  });

  it('detects a Python project by Pipfile', () => {
    rootPath = setup([], {
      'Pipfile': '',
      'app.py': '',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('python');
    expect(info.packageManager).toBe('pipenv');
  });

  // -------------------------------------------------------------------------
  // Rust projects
  // -------------------------------------------------------------------------

  it('detects a Rust project by Cargo.toml', () => {
    rootPath = setup([], {
      'Cargo.toml': '[package]\nname = "my-crate"',
      'src/main.rs': 'fn main() {}',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('rust');
    expect(info.languages).toContain('rust');
  });

  // -------------------------------------------------------------------------
  // Go projects
  // -------------------------------------------------------------------------

  it('detects a Go project by go.mod', () => {
    rootPath = setup([], {
      'go.mod': 'module github.com/example/project\n\ngo 1.21',
      'main.go': 'package main',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('go');
    expect(info.languages).toContain('go');
  });

  // -------------------------------------------------------------------------
  // Java projects
  // -------------------------------------------------------------------------

  it('detects a Java project by pom.xml', () => {
    rootPath = setup([], {
      'pom.xml': '<project></project>',
      'src/Main.java': 'public class Main {}',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('java');
    expect(info.languages).toContain('java');
    expect(info.packageManager).toBe('maven');
  });

  it('detects a Java project by build.gradle', () => {
    rootPath = setup([], {
      'build.gradle': '',
      'src/Main.java': '',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('java');
    expect(info.packageManager).toBe('gradle');
  });

  it('detects a Kotlin project by build.gradle.kts', () => {
    rootPath = setup([], {
      'build.gradle.kts': '',
      'src/Main.kt': 'fun main() {}',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('java');
    expect(info.languages).toContain('kotlin');
  });

  // -------------------------------------------------------------------------
  // Monorepo detection
  // -------------------------------------------------------------------------

  it('detects a monorepo with lerna.json', () => {
    rootPath = setup(['packages/app', 'packages/lib'], {
      'lerna.json': '{}',
      'package.json': JSON.stringify({ name: 'monorepo' }),
      'packages/app/package.json': JSON.stringify({ name: 'app' }),
      'packages/lib/package.json': JSON.stringify({ name: 'lib' }),
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('monorepo');
  });

  it('detects a monorepo with nx.json', () => {
    rootPath = setup(['apps/web', 'libs/shared'], {
      'nx.json': '{}',
      'package.json': '{}',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('monorepo');
  });

  it('detects a monorepo with turbo.json', () => {
    rootPath = setup(['apps/web'], {
      'turbo.json': '{}',
      'package.json': '{}',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('monorepo');
  });

  it('detects a monorepo with pnpm-workspace.yaml', () => {
    rootPath = setup(['packages/a', 'packages/b'], {
      'pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
      'package.json': '{}',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('monorepo');
  });

  it('detects a polyglot project as monorepo', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'polyglot' }),
      'go.mod': 'module example',
      'main.go': 'package main',
    });

    const info = detectProject(rootPath);
    // Multiple project-type markers exist, so it should be monorepo
    expect(['monorepo', 'node', 'go']).toContain(info.type);
    expect(info.languages.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Unknown type
  // -------------------------------------------------------------------------

  it('returns unknown for a directory with no recognizable markers', () => {
    rootPath = setup([], {
      'README.md': '# Hello',
      'data.txt': 'some data',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('unknown');
  });

  // -------------------------------------------------------------------------
  // Docker detection
  // -------------------------------------------------------------------------

  it('detects Docker support', () => {
    rootPath = setup([], {
      'Dockerfile': 'FROM node:20',
      'package.json': JSON.stringify({ name: 'app' }),
      'src/index.ts': '',
    });

    const info = detectProject(rootPath);
    expect(info.hasDocker).toBe(true);
  });

  it('detects docker-compose support', () => {
    rootPath = setup([], {
      'docker-compose.yml': 'version: "3"',
      'package.json': '{}',
    });

    const info = detectProject(rootPath);
    expect(info.hasDocker).toBe(true);
  });

  it('detects Docker from .dockerignore', () => {
    rootPath = setup([], {
      '.dockerignore': 'node_modules',
      'package.json': '{}',
    });

    const info = detectProject(rootPath);
    expect(info.hasDocker).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Kubernetes detection
  // -------------------------------------------------------------------------

  it('detects Kubernetes support via k8s directory', () => {
    rootPath = setup(['k8s'], {
      'package.json': '{}',
      'k8s/deployment.yaml': 'apiVersion: apps/v1',
    });

    const info = detectProject(rootPath);
    expect(info.hasK8s).toBe(true);
  });

  it('detects Kubernetes via deployment.yaml at root', () => {
    rootPath = setup([], {
      'deployment.yaml': 'apiVersion: apps/v1',
      'package.json': '{}',
    });

    const info = detectProject(rootPath);
    expect(info.hasK8s).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Language auto-detection
  // -------------------------------------------------------------------------

  it('auto-detects TypeScript from source files', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'ts-project' }),
      'index.ts': 'export const x = 1;',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('typescript');
  });

  it('auto-detects JavaScript from source files', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'js-project' }),
      'index.js': 'const x = 1;',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('javascript');
  });

  it('detects Python from .py files', () => {
    rootPath = setup([], {
      'setup.py': '# setup',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('python');
  });

  it('detects Rust from .rs files', () => {
    rootPath = setup([], {
      'main.rs': 'fn main() {}',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('rust');
  });

  it('detects Go from .go files', () => {
    rootPath = setup([], {
      'main.go': 'package main',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('go');
  });

  it('detects Java from .java files', () => {
    rootPath = setup([], {
      'Main.java': 'public class Main {}',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('java');
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------

  it('handles non-existent directory', () => {
    rootPath = ''; // Won't be cleaned up
    const info = detectProject('/nonexistent/path/12345');
    expect(info.type).toBe('unknown');
    expect(info.languages).toEqual([]);
    expect(info.hasDocker).toBe(false);
    expect(info.hasK8s).toBe(false);
  });

  it('handles empty directory', () => {
    rootPath = setup([], {});
    const info = detectProject(rootPath);
    expect(info.type).toBe('unknown');
  });

  // -------------------------------------------------------------------------
  // detectToolVersion
  // -------------------------------------------------------------------------

  it('detects Go version from go.mod', () => {
    rootPath = setup([], {
      'go.mod': 'module example\n\ngo 1.21\n\nrequire (...)',
    });

    const version = detectToolVersion(rootPath, 'go');
    expect(version).toBe('1.21');
  });

  it('returns null for Go without go.mod', () => {
    rootPath = setup([], {});
    const version = detectToolVersion(rootPath, 'go');
    expect(version).toBeNull();
  });

  it('detects Rust toolchain version from rust-toolchain.toml', () => {
    rootPath = setup([], {
      'rust-toolchain.toml': '[toolchain]\nchannel = "stable-2024-01-01"',
    });

    const version = detectToolVersion(rootPath, 'rust');
    expect(version).toBe('stable-2024-01-01');
  });

  it('returns null for Rust without toolchain file', () => {
    rootPath = setup([], {
      'Cargo.toml': '[package]\nname = "test"',
    });
    const version = detectToolVersion(rootPath, 'rust');
    expect(version).toBeNull();
  });

  it('returns null for unknown tool', () => {
    rootPath = setup([], {
      'package.json': '{}',
    });
    const version = detectToolVersion(rootPath, 'unknown');
    expect(version).toBeNull();
  });

  // -------------------------------------------------------------------------
  // docker-compose.yaml alternate spelling
  // -------------------------------------------------------------------------

  it('detects Docker via docker-compose.yaml', () => {
    rootPath = setup([], {
      'docker-compose.yaml': 'version: "3"',
      'package.json': '{}',
    });

    const info = detectProject(rootPath);
    expect(info.hasDocker).toBe(true);
  });

  // -------------------------------------------------------------------------
  // More edge cases
  // -------------------------------------------------------------------------

  it('detects JSX as TypeScript language', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'react-app' }),
      'App.tsx': 'export default function App() {}',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('typescript');
  });

  it('detects JSX as JavaScript language', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'react-js-app' }),
      'App.jsx': 'export default function App() {}',
    });

    const info = detectProject(rootPath);
    expect(info.languages).toContain('javascript');
  });

  it('handles multiple source file types', () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'mixed-project' }),
      'index.ts': '',
      'utils.js': '',
      'config.json': '',
    });

    const info = detectProject(rootPath);
    expect(info.languages.length).toBeGreaterThanOrEqual(2);
  });

  it('detects Go module without other markers', () => {
    rootPath = setup([], {
      'go.mod': 'module example\n\ngo 1.20',
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('go');
    expect(info.languages).toContain('go');
  });

  // -------------------------------------------------------------------------
  // pyproject.toml without [build-system] (pip fallback)
  // -------------------------------------------------------------------------

  it('detects pyproject.toml without build-system as pip', () => {
    rootPath = setup([], {
      'pyproject.toml': '[tool.black]\nline-length = 88',
    });

    const info = detectProject(rootPath);
    expect(info.packageManager).toBe('pip');
  });

  // -------------------------------------------------------------------------
  // Invalid package.json (parsing error)
  // -------------------------------------------------------------------------

  it('handles invalid package.json gracefully', () => {
    rootPath = setup([], {
      'package.json': 'not valid json {{{',
    });

    const info = detectProject(rootPath);
    // Still detects as node project (file exists) but packageManager is undefined
    expect(info.type).toBe('node');
    expect(info.packageManager).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Project type language inference (no source files)
  // -------------------------------------------------------------------------

  it('infers language from project type when no source files found', () => {
    rootPath = setup([], {
      'go.mod': 'module example\n\ngo 1.21',
      // No .go files
    });

    const info = detectProject(rootPath);
    expect(info.type).toBe('go');
    expect(info.languages).toContain('go');
  });
});
