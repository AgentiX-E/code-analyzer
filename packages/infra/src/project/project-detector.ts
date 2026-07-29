// @code-analyzer/infra — Project Detector
// Auto-detect project characteristics by scanning for known config files.

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type ProjectType =
  | 'node'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'monorepo'
  | 'unknown';

export interface ProjectInfo {
  type: ProjectType;
  languages: string[];
  hasDocker: boolean;
  hasK8s: boolean;
  packageManager?: string;
}

// ---------------------------------------------------------------------------
// Config file markers
// ---------------------------------------------------------------------------

const MARKERS: Array<{
  file: string;
  type: ProjectType;
  language: string;
  packageManagerFn?: (content: string, fullPath: string) => string | undefined;
}> = [
  { file: 'package.json', type: 'node', language: 'typescript',
    packageManagerFn: (content: string, fullPath: string): string | undefined => {
      try {
        const pkg = JSON.parse(content);
        if (pkg.packageManager?.startsWith('pnpm')) return 'pnpm';
        if (pkg.packageManager?.startsWith('yarn')) return 'yarn';
        const dir = path.dirname(fullPath);
        if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
        if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
        return 'npm';
      } catch {
        return undefined;
      }
    },
  },
  { file: 'Cargo.toml', type: 'rust', language: 'rust' },
  { file: 'go.mod', type: 'go', language: 'go' },
  {
    file: 'pom.xml', type: 'java', language: 'java',
    packageManagerFn: () => 'maven',
  },
  {
    file: 'build.gradle', type: 'java', language: 'java',
    packageManagerFn: () => 'gradle',
  },
  {
    file: 'build.gradle.kts', type: 'java', language: 'kotlin',
    packageManagerFn: () => 'gradle',
  },
  { file: 'requirements.txt', type: 'python', language: 'python',
    packageManagerFn: () => 'pip',
  },
  { file: 'pyproject.toml', type: 'python', language: 'python',
    packageManagerFn: (content: string): string | undefined => {
      if (content.includes('[build-system]')) return 'poetry/pip';
      return 'pip';
    },
  },
  { file: 'Pipfile', type: 'python', language: 'python', packageManagerFn: () => 'pipenv' },
  // Monorepo markers (checked after all single-project markers)
];

const MONOREPO_MARKERS = [
  'lerna.json',
  'nx.json',
  'turbo.json',
  'pnpm-workspace.yaml',
  'rush.json',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect project characteristics by scanning the root directory for
 * known configuration files (package.json, Cargo.toml, go.mod, etc.).
 *
 * @param rootPath - Absolute path to the project root directory.
 * @returns ProjectInfo describing the detected project type, languages, etc.
 */
export function detectProject(rootPath: string): ProjectInfo {
  const resolved = path.resolve(rootPath);
  const languages = new Set<string>();
  let detectedType: ProjectType = 'unknown';
  let packageManager: string | undefined;
  let markerCount = 0;

  try {
    const entries = fs.readdirSync(resolved);
    const markerSet = new Set(entries);

    // Check for monorepo markers
    const isMonorepo = MONOREPO_MARKERS.some((m) => markerSet.has(m));

    // Scan markers
    for (const marker of MARKERS) {
      if (!markerSet.has(marker.file)) continue;

      const fullPath = path.join(resolved, marker.file);
      try {
        const stat = fs.statSync(fullPath);
        /* v8 ignore next -- @preserve */
        if (!stat.isFile()) continue;
      /* v8 ignore start */
      } catch {
        continue;
      }
      /* v8 ignore stop */

      markerCount++;

      /* v8 ignore next 7 -- @preserve */
      if (marker.type !== 'unknown') {
        if (markerCount === 1) {
          detectedType = marker.type;
        } else if (detectedType !== marker.type) {
          // Multiple project types detected — monorepo or polyglot
          detectedType = 'monorepo';
        }
      }

      languages.add(marker.language);

      if (marker.packageManagerFn) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const pm = marker.packageManagerFn(content, fullPath);
          if (pm) packageManager = pm;
        } catch {
          // Cannot read file — skip package manager detection
        }
      }
    }

    // Override type if monorepo markers exist
    if (isMonorepo && languages.size > 0) {
      detectedType = 'monorepo';
    }

    // Auto-detect additional languages from source file extensions
    const extMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.rs': 'rust',
      '.go': 'go',
      '.java': 'java',
      '.kt': 'kotlin',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.cs': 'csharp',
    };

    // Quick scan of top-level files for additional languages (depth 1 only)
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      const lang = extMap[ext];
      if (lang && !languages.has(lang)) {
        // Only add if it's a file, not a directory
        try {
          const stat = fs.statSync(path.join(resolved, entry));
          /* v8 ignore next 2 -- @preserve */
          if (stat.isFile()) {
            languages.add(lang);
          }
        } catch {
          // Skip
        }
      }
    }

  } catch {
    // Directory doesn't exist or can't be read
  }

  // Check for Docker
  const hasDocker = hasMarker(resolved, ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore']);

  // Check for Kubernetes
  const hasK8s = hasMarker(resolved, ['k8s', 'kubernetes', 'deployment.yaml', 'deployment.yml', 'service.yaml', 'service.yml']);
  // Also check for k8s directory
  const k8sDir = path.join(resolved, 'k8s');
  const hasK8sDir = (() => {
    /* v8 ignore start */
    try {
      return fs.statSync(k8sDir).isDirectory();
    } catch {
      return false;
    }
    /* v8 ignore stop */
  })();

  // Add common languages for the detected type
  /* v8 ignore start -- @preserve */
  if (languages.size === 0 && detectedType !== 'unknown') {
    // Infer language from type
    const typeToLang: Record<string, string> = {
      node: 'typescript',
      python: 'python',
      rust: 'rust',
      go: 'go',
      java: 'java',
    };
    const lang = typeToLang[detectedType];
    if (lang) languages.add(lang);
  }
  /* v8 ignore stop */

  return {
    type: detectedType,
    languages: Array.from(languages).sort(),
    hasDocker: hasDocker || false,
    hasK8s: hasK8s || hasK8sDir,
    packageManager,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasMarker(rootPath: string, names: string[]): boolean {
  try {
    const entries = fs.readdirSync(rootPath);
    const set = new Set(entries);
    if (names.some((n) => set.has(n))) return true;
    // Also check for nested k8s patterns by scanning dirs
    for (const name of names) {
      if (name.includes('.yaml') || name.includes('.yml')) {
        for (const entry of entries) {
          const fullEntry = path.join(rootPath, entry);
          try {
            const stat = fs.statSync(fullEntry);
            if (stat.isDirectory()) {
              const sub = fs.readdirSync(fullEntry);
              /* v8 ignore next -- @preserve */
              if (sub.some((f) => f === name)) return true;
            }
          } catch {
            // Skip
          }
        }
      }
    }
    return false;
  /* v8 ignore start */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

/**
 * Detect the version of a tool used by the project.
 */
export function detectToolVersion(rootPath: string, tool: string): string | null {
  const resolved = path.resolve(rootPath);

  if (tool === 'go') {
    const modPath = path.join(resolved, 'go.mod');
    try {
      const content = fs.readFileSync(modPath, 'utf-8');
      const match = content.match(/^go\s+(\d+\.\d+)/m);
      /* v8 ignore next -- @preserve */
      if (match) return match[1] ?? null;
    } catch {
      // No go.mod
    }
  }

  if (tool === 'rust') {
    // Cargo.toml doesn't have a version, check toolchain
    const toolchainPath = path.join(resolved, 'rust-toolchain.toml');
    try {
      const content = fs.readFileSync(toolchainPath, 'utf-8');
      const match = content.match(/channel\s*=\s*"(.+)"/);
      /* v8 ignore next -- @preserve */
      if (match) return match[1] ?? null;
    } catch {
      // No toolchain file
    }
  }

  return null;
}
