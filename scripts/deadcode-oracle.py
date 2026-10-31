#!/usr/bin/env python3
"""A second reader of "is this private function used anywhere", for the dead-code measurement.

**The product's reachability pass and every competitor's dead-code detector answer the same question and share nothing
else**, which is exactly the condition a measurement needs: if the expected answer came from the thing being measured,
agreement would be a tautology. This script parses the corpus with CPython's `ast`, collects every private function and
method, and asks one mechanical question of each — **does the name occur anywhere in the corpus other than where it is
defined?** A `Name` node, an `Attribute` id, an alias in an `import`, a word inside a string literal: any of them keeps
the symbol out of the dead set, because any of them could be the reference the static tools did not model.

**The universe is private symbols on purpose.** For a public name, "nothing in this repository calls it" and "it is the
API" are both true at once, and no oracle can settle which without knowing the consumers. A private name has no such
ambiguity: nothing outside the package may import it and the repository is the world. Restricting the disagreement to
where the truth is decidable is what makes the figure comparable rather than rhetorical — and the public findings are
reported separately, as a disagreement about the API rather than about deadness.

**What it cannot see, and therefore does not claim.** A name that occurs elsewhere may still be dead (a stale string
mention in an error message) and a name that occurs nowhere may still be reachable through a framework hook named in a
configuration file. So the oracle is a lower bound on deadness and an upper bound on usability, and both figures are
published beside the tools' own so a reader can see the interval rather than a point.

Usage:
    python3 scripts/deadcode-oracle.py --root benchmarks/corpora/flask-3.0.3/src/flask
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

# **Dunders are excluded**: `__init__`, `__repr__` and `__enter__` are invoked by the interpreter, so a repository that
# never writes their names is a repository that is working correctly.
DUNDER = re.compile(r"^__.*__$")
WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def python_files(root: Path) -> list[Path]:
    # **Stubs are excluded for the same reason the product excludes them**: a `.pyi` declares the shape of code that
    # lives elsewhere, so nothing in the corpus may call it and reporting it is reporting the convention.
    return sorted(path for path in root.rglob("*.py") if path.is_file() and path.suffix == ".py")


def occurrences(files: list[Path]) -> dict[str, int]:
    """Every identifier the corpus mentions, counted across names, attributes, imports and string literals."""
    counts: dict[str, int] = {}
    for path in files:
        try:
            source = path.read_text(encoding="utf-8", errors="replace")
            tree = ast.parse(source, filename=str(path))
        except SyntaxError:
            # **A file the parser cannot read is not evidence about the names in it**, so it is skipped whole rather
            # than counted as containing nothing.
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                counts[node.id] = counts.get(node.id, 0) + 1
            elif isinstance(node, ast.Attribute):
                counts[node.attr] = counts.get(node.attr, 0) + 1
            elif isinstance(node, ast.alias):
                for part in (node.name, node.asname):
                    if part:
                        counts[part] = counts.get(part, 0) + 1
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                for word in WORD.findall(node.value):
                    counts[word] = counts.get(word, 0) + 1
            elif isinstance(node, ast.keyword) and node.arg:
                counts[node.arg] = counts.get(node.arg, 0) + 1
    return counts


def exports_of(tree: ast.Module) -> set[str]:
    """The names a module publishes, from `__all__` when it has one."""
    out: set[str] = set()
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "__all__" not in targets:
            continue
        if isinstance(node.value, (ast.List, ast.Tuple)):
            for element in node.value.elts:
                if isinstance(element, ast.Constant) and isinstance(element.value, str):
                    out.add(element.value)
    return out


def definitions(root: Path) -> tuple[list[dict], set[str]]:
    """Every private function and method, with the file and line it is defined at."""
    found: list[dict] = []
    exported: set[str] = set()
    for path in python_files(root):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=str(path))
        except SyntaxError:
            continue
        exported |= exports_of(tree)
        relative = path.relative_to(root).as_posix()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            name = node.name
            if not name.startswith("_") or DUNDER.match(name):
                continue
            found.append(
                {
                    "file": relative,
                    "line": node.lineno,
                    "name": name,
                    # **A decorator is a registration this script does not model**: `@app.route` and `@pytest.fixture`
                    # both invoke a function nothing calls, so a decorated function is never counted as dead here.
                    "decorated": len(node.decorator_list) > 0,
                }
            )
    return found, exported


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="the directory whose Python the question is about")
    parser.add_argument("--out", help="write the report here instead of stdout")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 1

    files = python_files(root)
    counts = occurrences(files)
    found, exported = definitions(root)

    dead = [
        {"file": item["file"], "line": item["line"], "name": item["name"]}
        for item in found
        if counts.get(item["name"], 0) == 0 and not item["decorated"] and item["name"] not in exported
    ]
    report = {
        "corpus": str(root),
        "files": len(files),
        "privateFunctions": len(found),
        "declaredExports": len(exported),
        "oracleDead": dead,
        # **The whole decidable set, not only the dead half.** Both tools are scored over these symbols and no others,
        # so a claim about something outside the set is neither right nor wrong and is counted as `outside` rather
        # than quietly folded into either column. A function a decorator registers stays in the set with the verdict
        # "alive": the oracle knows `@app.route` invokes it, and a tool that reports it is wrong, not unaudited.
        "universe": [{"file": item["file"], "line": item["line"], "name": item["name"]} for item in found],
    }
    text = json.dumps(report, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"{len(dead)} private functions nothing in the corpus names -> {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
