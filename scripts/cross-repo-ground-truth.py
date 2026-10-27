#!/usr/bin/env python3
"""Ground truth for cross-repository imports, read by Python's own parser.

**Why a second implementation exists.** A measurement whose expected answer is produced by the thing being
measured is not a measurement. The product resolves imports with its TypeScript extractors and its own file
walk; this script resolves them with `ast` — the interpreter's parser — and with Python's documented module
rules (`pkg/mod.py` or `pkg/mod/__init__.py`). Neither implementation reads the other.

**What counts as a pair.** One `(importing file, imported file)` pair per distinct import statement — the unit
the graph stores as an edge. `from werkzeug.exceptions import A` and `from werkzeug.exceptions import B` in one
file are two statements and one pair; the product's edge carries both names, which is what `names` records.

**Only resolvable pairs are emitted.** A module that names no file in the target checkout (`werkzeug.nonexistent`)
is reported under `unresolved` instead of being counted as a pair, so recall is never inflated by an expectation
that could not be met.

Usage:
  python3 scripts/cross-repo-ground-truth.py \
    --importer <checkout of the importing repository> --importer-name owner/name \
    --package <top-level module name> --target <checkout of the imported repository> \
    --out <file.json>
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import sys
from pathlib import Path

def module_file(target: Path, package: str, module: str) -> str | None:
    """The file Python would import for `module`, as a path relative to `target`."""
    parts = module.split(".")
    if parts[0] != package:
        return None
    rest = parts[1:]

    for layout in ("src", "lib", ""):
        base = target / layout if layout else target
        package_dir = base / package
        if not package_dir.is_dir():
            continue
        candidate = package_dir.joinpath(*rest) if rest else package_dir
        as_module = candidate.with_suffix(".py")
        if as_module.is_file():
            return str(as_module.relative_to(target))
        as_package = candidate / "__init__.py"
        if as_package.is_file():
            return str(as_package.relative_to(target))
    return None

def names_of(node: ast.AST) -> list[str]:
    """The names an import statement makes reachable, in the convention the graph records.

    `from m import a, b` makes `a` and `b` reachable and says so; `import m` makes **everything `m` defines**
    reachable through the binding, which the graph records as `*` — the same marker the product has always used for
    a namespace import. Recording the bound segment instead would make the two sides disagree about a statement both
    of them read correctly.
    """
    if isinstance(node, ast.Import):
        return ["*"]
    out: list[str] = []
    for alias in getattr(node, "names", []):
        # `from m import a as b` imports `a`; the local name `b` is not what the module exports.
        out.append(alias.name)
    return out or ["*"]

def scan(importer: Path, package: str, target: Path) -> dict:
    pairs: dict[tuple[str, str, str], set[str]] = {}
    unresolved: dict[str, int] = {}
    files_scanned = 0
    statements = 0

    for dirpath, dirnames, filenames in os.walk(importer):
        dirnames[:] = sorted(d for d in dirnames if d not in {".git", "__pycache__", ".tox", ".venv"})
        for filename in sorted(filenames):
            if not filename.endswith(".py"):
                continue
            path = Path(dirpath) / filename
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except SyntaxError:
                continue
            files_scanned += 1
            relative = str(path.relative_to(importer))
            for node in ast.walk(tree):
                modules: list[str] = []
                if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                    modules.append(node.module)
                elif isinstance(node, ast.Import):
                    modules.extend(alias.name for alias in node.names)
                for module in modules:
                    if module.split(".")[0] != package:
                        continue
                    statements += 1
                    resolved = module_file(target, package, module)
                    if resolved is None:
                        unresolved[module] = unresolved.get(module, 0) + 1
                        continue
                    key = (relative, module, resolved)
                    pairs.setdefault(key, set()).update(names_of(node))

    return {
        "filesScanned": files_scanned,
        "importStatements": statements,
        "pairs": [
            {"importer": importer_file, "module": module, "target": target_file, "names": sorted(names)}
            for (importer_file, module, target_file), names in sorted(pairs.items())
        ],
        "unresolved": [{"module": module, "statements": count} for module, count in sorted(unresolved.items())],
    }

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--importer", required=True)
    parser.add_argument("--importer-name", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    importer = Path(args.importer).resolve()
    target = Path(args.target).resolve()
    if not importer.is_dir() or not target.is_dir():
        print("both checkouts must exist", file=sys.stderr)
        return 2

    result = scan(importer, args.package, target)
    result.update(
        {
            "comment": [
                "Ground truth for cross-repository imports, produced by Python's own parser (`ast`) and by the",
                "module-to-file rules the interpreter uses. Nothing here reads the product's extractors.",
                "One entry per (importing file, imported module, imported file); `names` is the union of names",
                "every statement in that pair asked for.",
            ],
            "method": "python-ast",
            "importer": args.importer_name,
            "package": args.package,
            "pairCount": len(result["pairs"]),
        }
    )

    Path(args.out).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{args.importer_name}: {len(result['pairs'])} pairs, {result['importStatements']} statements, "
          f"{len(result['unresolved'])} unresolved modules")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
