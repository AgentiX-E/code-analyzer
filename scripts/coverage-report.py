#!/usr/bin/env python3
"""Aggregate vitest v8 coverage JSON reports into a human-readable summary.

Usage: pnpm test:coverage
"""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COVERAGE_DIR = ROOT / 'coverage'

# Packages to measure (matches vitest.config.ts coverage.include)
PACKAGES = ['shared', 'core', 'infra', 'analyzer', 'intelligence', 'mcp', 'server', 'cli']

# Exclusions matching vitest.config.ts coverage.exclude
EXCLUDE_PATTERNS = [
    '**/*.test.ts', '**/__tests__/**', '**/index.ts', '**/provider.ts',
    '**/fixtures/**', '**/benchmarks/**',
    'packages/infra/src/storage/types.ts',
    'packages/core/src/agents/types.ts',
    'packages/infra/src/filesystem/watcher.ts',
    'packages/analyzer/src/languages/tree-sitter-base.ts',
    'packages/analyzer/src/languages/base-c-like.ts',
    'packages/analyzer/src/languages/typescript.ts',
    'packages/analyzer/src/languages/javascript.ts',
    'packages/analyzer/src/languages/python.ts',
    'packages/analyzer/src/languages/go.ts',
    'packages/analyzer/src/languages/java.ts',
    'packages/analyzer/src/languages/kotlin.ts',
    'packages/analyzer/src/languages/csharp.ts',
    'packages/analyzer/src/languages/rust.ts',
    'packages/analyzer/src/languages/php.ts',
    'packages/analyzer/src/languages/ruby.ts',
    'packages/analyzer/src/languages/swift.ts',
    'packages/*/dist/**',
]

def should_exclude(filepath: str) -> bool:
    """Check if a file path matches any exclusion pattern."""
    import fnmatch
    for pattern in EXCLUDE_PATTERNS:
        if fnmatch.fnmatch(filepath, pattern):
            return True
        # Also check without root prefix
        rel = filepath.replace(str(ROOT) + '/', '')
        if fnmatch.fnmatch(rel, pattern):
            return True
    return False

def run_package_coverage(pkg: str) -> dict:
    """Run vitest with coverage for a single package and parse results."""
    test_dir = ROOT / f'packages/{pkg}/src/__tests__'
    if not test_dir.exists():
        return None

    cmd = [
        'npx', 'vitest', 'run',
        str(test_dir),
        '--coverage',
        '--coverage.enabled=true',
        '--coverage.provider=v8',
        f'--coverage.include=packages/{pkg}/src/**/*.ts',
        '--coverage.exclude=**/*.test.ts',
        '--coverage.exclude=**/__tests__/**',
        '--coverage.exclude=**/index.ts',
        '--coverage.exclude=**/provider.ts',
        '--coverage.exclude=**/fixtures/**',
        '--coverage.exclude=**/benchmarks/**',
        '--coverage.reporter=json',
        f'--coverage.reportsDirectory={COVERAGE_DIR}',
    ]

    # Add package-specific exclusions
    if pkg == 'core':
        cmd.append('--coverage.exclude=packages/core/src/agents/types.ts')
    elif pkg == 'infra':
        cmd.append('--coverage.exclude=packages/infra/src/storage/types.ts')
        cmd.append('--coverage.exclude=packages/infra/src/filesystem/watcher.ts')
    elif pkg == 'analyzer':
        for lang in ['tree-sitter-base', 'base-c-like', 'typescript', 'javascript',
                     'python', 'go', 'java', 'kotlin', 'csharp', 'rust', 'php', 'ruby', 'swift']:
            cmd.append(f'--coverage.exclude=packages/analyzer/src/languages/{lang}.ts')

    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=600)
    
    coverage_file = COVERAGE_DIR / 'coverage-final.json'
    if not coverage_file.exists():
        print(f"  ⚠️  No coverage output for {pkg}", file=sys.stderr)
        return None

    with open(coverage_file) as f:
        data = json.load(f)

    # Clean up
    coverage_file.unlink(missing_ok=True)

    return data

def aggregate_coverage(all_data: dict) -> dict:
    """Aggregate coverage data from multiple packages."""
    packages = {}
    for pkg, data in all_data.items():
        if data is None:
            continue
        
        packages[pkg] = {
            'stmt_total': 0, 'stmt_covered': 0,
            'branch_total': 0, 'branch_covered': 0,
            'func_total': 0, 'func_covered': 0,
            'line_total': 0, 'line_covered': 0,
            'file_count': 0,
        }

        for filepath, cov in data.items():
            rel = filepath.replace(str(ROOT) + '/', '')
            if should_exclude(filepath):
                continue

            packages[pkg]['file_count'] += 1

            s = cov.get('s', {})
            for sid, count in s.items():
                packages[pkg]['stmt_total'] += 1
                if count > 0:
                    packages[pkg]['stmt_covered'] += 1

            b = cov.get('b', {})
            for bid, counts in b.items():
                for c in counts:
                    packages[pkg]['branch_total'] += 1
                    if c > 0:
                        packages[pkg]['branch_covered'] += 1

            f = cov.get('f', {})
            for fid, count in f.items():
                packages[pkg]['func_total'] += 1
                if count > 0:
                    packages[pkg]['func_covered'] += 1

            stmt_map = cov.get('statementMap', {})
            lines_covered = set()
            lines_all = set()
            for sid, sm in stmt_map.items():
                for line in range(sm['start']['line'], sm['end']['line'] + 1):
                    lines_all.add(line)
                    if s.get(sid, 0) > 0:
                        lines_covered.add(line)
            packages[pkg]['line_total'] += len(lines_all)
            packages[pkg]['line_covered'] += len(lines_covered)

    return packages

def print_report(packages: dict):
    """Print coverage report."""
    print()
    print(f"{'Package':<16s} {'Lines':>8s} {'Branch':>8s} {'Funcs':>8s} {'Stmts':>8s}  {'Files':>5s}")
    print("-" * 68)

    totals = {'line_total': 0, 'line_covered': 0, 'branch_total': 0, 'branch_covered': 0,
              'func_total': 0, 'func_covered': 0, 'stmt_total': 0, 'stmt_covered': 0}

    for pkg in sorted(packages.keys()):
        p = packages[pkg]
        lp = (p['line_covered'] / p['line_total'] * 100) if p['line_total'] > 0 else 100
        bp = (p['branch_covered'] / p['branch_total'] * 100) if p['branch_total'] > 0 else 100
        fp = (p['func_covered'] / p['func_total'] * 100) if p['func_total'] > 0 else 100
        sp = (p['stmt_covered'] / p['stmt_total'] * 100) if p['stmt_total'] > 0 else 100

        for k in totals:
            totals[k] += p[k]

        flags = []
        for name, val in [('L', lp), ('B', bp), ('F', fp), ('S', sp)]:
            if val < 95:
                flags.append(f'{name}={val:.1f}%')
        flag_str = ' ⚠️  ' + ' '.join(flags) if flags else ' ✅'
        print(f"{pkg:<16s} {lp:7.1f}% {bp:7.1f}% {fp:7.1f}% {sp:7.1f}%  {p['file_count']:>5d}{flag_str}")

    print("-" * 68)
    t = totals
    tlp = (t['line_covered'] / t['line_total'] * 100) if t['line_total'] > 0 else 100
    tbp = (t['branch_covered'] / t['branch_total'] * 100) if t['branch_total'] > 0 else 100
    tfp = (t['func_covered'] / t['func_total'] * 100) if t['func_total'] > 0 else 100
    tsp = (t['stmt_covered'] / t['stmt_total'] * 100) if t['stmt_total'] > 0 else 100
    print(f"{'TOTAL':<16s} {tlp:7.1f}% {tbp:7.1f}% {tfp:7.1f}% {tsp:7.1f}%")
    print()
    print(f"Lines:      {t['line_covered']}/{t['line_total']}")
    print(f"Branches:   {t['branch_covered']}/{t['branch_total']}")
    print(f"Functions:  {t['func_covered']}/{t['func_total']}")
    print(f"Statements: {t['stmt_covered']}/{t['stmt_total']}")

    # Check thresholds
    all_pass = all([
        tlp >= 95, tbp >= 95, tfp >= 95, tsp >= 95
    ])
    if all_pass:
        print("\n✅ ALL coverage thresholds met (≥95%)!")
    else:
        print("\n❌ Coverage thresholds NOT met!")
        for name, val in [('Lines', tlp), ('Branches', tbp), ('Functions', tfp), ('Statements', tsp)]:
            if val < 95:
                print(f"   {name}: {val:.1f}% < 95%")

def main():
    os.makedirs(COVERAGE_DIR, exist_ok=True)
    
    all_data = {}
    for pkg in PACKAGES:
        print(f"Measuring {pkg}...", end=' ', flush=True)
        data = run_package_coverage(pkg)
        all_data[pkg] = data
        if data:
            print(f"{len(data)} files")
        else:
            print("no data")

    packages = aggregate_coverage(all_data)
    print_report(packages)

if __name__ == '__main__':
    main()
