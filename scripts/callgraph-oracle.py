#!/usr/bin/env python3
"""Ground truth for the call graph, read by Python's own parser.

**Why a second implementation exists.** The call graph is now measured by asking it how many edges it has, which is
not a measurement: a pass that joined every function to every name its file mentions reported 6 690 edges on
`pallets/flask` and 88 % of the same-file ones were false. The instrument here does not read the product's code.
It parses the same checkout with `ast` - the interpreter's parser - resolves each call site with Python's own
module and scoping rules, and only then looks at what the graph claimed.

**What it asserts, and what it refuses to assert.**

- A bare call `f()` inside a function resolves to the module-level `def f` of that file, or to the `def f` of a
  module this file imports `f` from. If the name is bound in the function - a parameter, an assignment, a local
  import, a nested `def` - **it is a variable and the oracle says so**, because a call through a variable is not
  statically resolvable and a graph that resolves it is guessing.
- A call `self.m()` or `cls.m()` resolves to `m` in the enclosing class, or in a base class **that is defined in
  the corpus**. A base class from the standard library or from a third-party package is not followed.
- **Any other receiver is silent.** `request.args.get(k)` names neither the file nor the class that defines `get`,
  so there is no expected answer and the site is not counted in either precision or recall. A silent oracle must
  never be read as agreement.
- A site whose owner or target has a **duplicate simple name in one file** is excluded: the graph identifies a
  symbol by `(file, name)`, so those two declarations are one node there, and scoring a correct-looking edge
  against an identity that cannot distinguish them would credit the graph for a distinction it does not make. The
  count of those collisions is published instead, because it is the ceiling on recall.

Usage:
  python3 scripts/callgraph-oracle.py --root <checkout> --graph <dump.json> --name owner/name --out <report.json>
"""

from __future__ import annotations

import argparse
import ast
import builtins
import collections
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

BUILTIN_NAMES = frozenset(dir(builtins))


# ---------------------------------------------------------------------------
# Reading one file
# ---------------------------------------------------------------------------


@dataclass
class ClassInfo:
    name: str
    line: int
    methods: dict[str, int] = field(default_factory=dict)
    bases: list[str] = field(default_factory=list)
    #: field name -> the class its annotation names, for `self.field.m()`. Only a bare name is recorded: a container
    #: (`list[Item]`), a union (`A | None`) and a string annotation say nothing this oracle can look a member up in,
    #: and recording one would make every guess it supports look like an expectation.
    fields: dict[str, str] = field(default_factory=dict)


@dataclass
class Unit:
    """One source file, in the coordinates a call site is written in."""

    rel: str
    module: str | None
    #: a package entry file, whose own module name **is** the package
    is_package: bool = False
    #: module-level `def`/`class`, by simple name -> every line that declares it
    defs: dict[str, list[int]] = field(default_factory=dict)
    #: local alias -> (module, relative level, original name). `import a.b` binds `a`, as does `import a.b as c`.
    imports: dict[str, tuple[str | None, int, str]] = field(default_factory=dict)
    #: namespace aliases only (`import a.b` / `import a.b as c` / `from . import mod`), which is the receiver a
    #: qualified call legitimately carries
    namespaces: dict[str, tuple[str | None, int]] = field(default_factory=dict)
    classes: dict[str, ClassInfo] = field(default_factory=dict)


#: Directories that hold packages rather than being one, so the module path stops below them.
SOURCE_ROOTS = frozenset({"src", "lib", "python", "packages", "vendor"})


def module_name(path: Path, root: Path) -> str | None:
    """The dotted module a file declares.

    **The package boundary is not `__init__.py`.** That rule was the first version and it read `flask/sansio/app.py`
    as module `app`, because `sansio` has no `__init__.py` - it is a PEP 420 implicit namespace package, which is how
    flask 3.x is laid out. The consequence was that every inherited method reached through `sansio` looked external
    and the graph was scored wrong for a resolution it had right. A directory is part of the path when its name is an
    identifier and it is not a conventional source root, which is what Python's own import system does once the
    directory is on `sys.path`.
    """
    parts = [] if path.stem == "__init__" else [path.stem]
    cur = path.parent
    while cur != root and cur.name and cur.name.isidentifier() and cur.name not in SOURCE_ROOTS:
        parts.append(cur.name)
        cur = cur.parent
    return ".".join(reversed(parts)) if parts else None


def own_scope_nodes(node: ast.AST):
    """Every node lexically in this scope - a nested `def`, `class` or `lambda` opens a new one."""
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        yield child
        yield from own_scope_nodes(child)


def bound_names(fn: ast.AST) -> tuple[set[str], set[str]]:
    """Names this scope binds, and names it declares `global`."""
    names: set[str] = set()
    globalised: set[str] = set()
    args = getattr(fn, "args", None)
    if isinstance(args, ast.arguments):
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            names.add(arg.arg)
        if args.vararg:
            names.add(args.vararg.arg)
        if args.kwarg:
            names.add(args.kwarg.arg)
    for child in own_scope_nodes(fn):
        if isinstance(child, ast.Name) and isinstance(child.ctx, (ast.Store, ast.Del)):
            names.add(child.id)
        elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(child.name)
        elif isinstance(child, ast.Import):
            for alias in child.names:
                names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(child, ast.ImportFrom):
            for alias in child.names:
                if alias.name != "*":
                    names.add(alias.asname or alias.name)
        elif isinstance(child, ast.ExceptHandler) and child.name:
            names.add(child.name)
        elif isinstance(child, ast.Global):
            globalised.update(child.names)
    return names - globalised, globalised


#: Names a method receives its own object under, which is what makes an annotated attribute a field.
OWN_SCOPE_NAMES = frozenset({"self", "cls"})


def annotation_name(node: ast.AST | None) -> str | None:
    """The class an annotation names, or `None` when it names no single one.

    **`Index` is a name, and `list[Index]`, `Index | None` and `"Index"` are not** - a container's members are not the
    receiver's, a union has two answers, and a string annotation is a forward reference this oracle cannot read. None
    of the three is refused because it is unlikely; each is refused because a lookup of it would be a guess.
    """
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def dotted(node: ast.AST) -> str | None:
    """The dotted path a receiver is written as, or `None` when it is not a name at all - `f()[0].m()`."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        inner = dotted(node.value)
        return None if inner is None else f"{inner}.{node.attr}"
    return None


def record_field(fields: dict[str, str], node: ast.AST, *, in_class_body: bool) -> None:
    """Record `field -> the class its annotation names` for one statement of a class.

    **Two shapes, and the flag is the difference between them.** A class body's `index: Index` declares a field; a
    method's `local: Index` declares a local variable and nothing else. `self.cache: Cache` inside a method is a field
    again, because the attribute is written on the object rather than on a name.

    **And a field is very often declared by what it is assigned** - `self.index = InvertedIndex()` says the type as
    plainly as an annotation does, and Python code written before annotations existed says it that way and no other.
    The name is recorded whether or not it turns out to be a class: `field_type` answers only for a name that exactly
    one file declares *as a class*, so a factory function called `make_index` is dropped there rather than here.
    """
    target: ast.expr | None = None
    annotation: str | None = None
    if isinstance(node, ast.AnnAssign):
        target = node.target
        annotation = annotation_name(node.annotation)
    elif isinstance(node, ast.Assign) and len(node.targets) == 1:
        target = node.targets[0]
        value = node.value
        annotation = value.func.id if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) else None
    if target is None or annotation is None:
        return
    if isinstance(target, ast.Name) and in_class_body:
        fields.setdefault(target.id, annotation)
    elif (
        isinstance(target, ast.Attribute)
        and isinstance(target.value, ast.Name)
        and target.value.id in OWN_SCOPE_NAMES
    ):
        fields.setdefault(target.attr, annotation)


def read_unit(path: Path, root: Path) -> tuple[Unit, ast.Module]:
    rel = path.relative_to(root).as_posix()
    module = module_name(path, root)
    unit = Unit(rel=rel, module=module, is_package=path.stem == "__init__")
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=rel)

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            unit.defs.setdefault(node.name, []).append(node.lineno)
        elif isinstance(node, ast.ClassDef):
            unit.defs.setdefault(node.name, []).append(node.lineno)
            info = ClassInfo(name=node.name, line=node.lineno)
            for item in node.body:
                if isinstance(item, (ast.AnnAssign, ast.Assign)):
                    record_field(info.fields, item, in_class_body=True)
                elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    info.methods[item.name] = item.lineno
                    # **`self.cache: Cache = Cache()` in `__init__` is where a Python class declares most of its
                    # fields**, so the annotations inside a method are read as well as the ones in the class body.
                    # A plain `local: Cache` inside a method is a local variable and is refused by the same function.
                    for statement in ast.walk(item):
                        record_field(info.fields, statement, in_class_body=False)
            for base in node.bases:
                if isinstance(base, ast.Name):
                    info.bases.append(base.id)
                elif isinstance(base, ast.Attribute):
                    info.bases.append(base.attr)
            unit.classes[node.name] = info
        elif isinstance(node, ast.Import):
            for alias in node.names:
                alias_name = alias.asname or alias.name.split(".")[0]
                unit.imports[alias_name] = (alias.asname and alias.name or alias.name, 0, alias.name.split(".")[-1])
                unit.namespaces[alias_name] = (alias.name, 0)
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "*":
                    continue
                local = alias.asname or alias.name
                unit.imports[local] = (node.module, node.level, alias.name)
                if node.module is None:
                    unit.namespaces[local] = (alias.name, 0)
    return unit, tree


# ---------------------------------------------------------------------------
# Resolving a name to a file
# ---------------------------------------------------------------------------


class Corpus:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.units: dict[str, Unit] = {}
        self.by_module: dict[str, str] = {}
        self.by_basename: dict[str, list[str]] = {}
        for path in sorted(root.rglob("*.py")):
            if any(part in {".git", "node_modules", ".venv", "venv", "__pycache__"} for part in path.parts):
                continue
            try:
                unit, _tree = read_unit(path, root)
            except (SyntaxError, UnicodeDecodeError):
                continue
            self.units[unit.rel] = unit
            if unit.module:
                self.by_module.setdefault(unit.module, unit.rel)
            self.by_basename.setdefault(path.name, []).append(unit.rel)
        #: class name -> the files that declare it, because a field's annotation is written in the file that uses the
        #: type and the class is declared in the file that defines it.
        self.by_class: dict[str, list[str]] = {}
        for rel, unit in self.units.items():
            for class_name in unit.classes:
                self.by_class.setdefault(class_name, []).append(rel)

    def files_declaring(self, class_name: str) -> list[str]:
        """The one file that declares a class, or nothing when it is undeclared or declared twice."""
        files = self.by_class.get(class_name, [])
        return files if len(files) == 1 else []

    def field_type(self, file: str, class_name: str, field_name: str) -> str | None:
        """The class a class's field was annotated with, read through the bases when the class does not say."""
        unit = self.units.get(file)
        if unit is None:
            return None
        seen: set[str] = set()
        current_file, current_name = file, class_name
        while True:
            key = f"{current_file}#{current_name}"
            if key in seen:
                return None
            seen.add(key)
            current = self.units.get(current_file)
            if current is None:
                return None
            info = current.classes.get(current_name)
            if info is None:
                return None
            if field_name in info.fields:
                return info.fields[field_name]
            if not info.bases:
                return None
            base = info.bases[0]
            if base in current.classes:
                current_name = base
                continue
            resolved = self.resolve_import(current, base)
            if resolved is None:
                return None
            current_file, current_name = resolved


    def file_for_module(self, module: str) -> str | None:
        if module in self.by_module:
            return self.by_module[module]
        # A checkout laid out as `src/<package>/...`: the package root is not on `sys.path` for the parser, so the
        # dotted name arrives without its leading segment.
        for known, rel in self.by_module.items():
            if known.endswith("." + module) or known == module:
                return rel
        return None

    def resolve_relative(self, unit: Unit, level: int, module: str | None) -> str | None:
        if not unit.module:
            return None
        parts = unit.module.split(".")
        # **`from .map import Map` means two different things depending on the file it is written in.** In
        # `werkzeug/routing/map.py` the current package is the module's parent, so the answer is `werkzeug.routing.map`;
        # in `werkzeug/routing/__init__.py` the module's own name *is* the package, so the same statement means
        # `werkzeug.routing.map` as well - but only if `parts` keeps its last segment. Reading every file as a plain
        # module made every relative import inside every `__init__.py` resolve to nothing, and an oracle that cannot
        # follow a package's own re-exports calls a correct graph wrong.
        package = parts if unit.is_package else parts[:-1]
        keep = len(package) - (level - 1)
        if keep < 0:
            return None
        base = package[:keep]
        target = base + (module.split(".") if module else [])
        return self.file_for_module(".".join(target)) if target else None

    def resolve_import(self, unit: Unit, local: str, seen: set[tuple[str, str]] | None = None) -> tuple[str, str] | None:
        """The file and the original name an alias binds, or `None` when it leaves the corpus.

        **One hop of re-export is followed, because a package file is where a public name is usually declared.** A
        graph that answered `flash` with `flask/helpers.py` was scored wrong until this existed: `from flask import
        flash` names `flask/__init__.py`, which does not define `flash`, it re-exports it. Stopping there would have
        called a correct resolution a false positive and rewarded a graph that gave up.
        """
        entry = unit.imports.get(local)
        if entry is None:
            return None
        module, level, original = entry
        if level:
            file = self.resolve_relative(unit, level, module)
        else:
            file = self.file_for_module(module) if module else None
        if file is None:
            return None
        target_unit = self.units.get(file)
        if target_unit is None:
            return file, original
        if original in target_unit.defs:
            return file, original
        # **A re-export chain has no fixed length.** `from werkzeug import Request` is three hops in werkzeug 3.0.3 -
        # the package entry, then `wrappers/__init__.py`, then `wrappers/request.py` - so a limit of one hop, and then
        # of two, both called a correct graph wrong. The walk stops on a name it has already visited rather than on a
        # count, which is what makes a cycle finite.
        seen = seen or set()
        key = (file, original)
        if key in seen or len(seen) > 8:
            return file, original
        seen.add(key)
        deeper = self.resolve_import(target_unit, original, seen)
        if deeper is not None:
            return deeper
        return file, original

    def resolve_namespace(self, unit: Unit, local: str) -> str | None:
        entry = unit.namespaces.get(local)
        if entry is None:
            return None
        module, level = entry
        if level:
            return self.resolve_relative(unit, level, module)
        return self.file_for_module(module) if module else None

    def find_method(self, file: str, class_name: str, method: str, seen: set[str]) -> str | None:
        key = f"{file}#{class_name}"
        if key in seen:
            return None
        seen.add(key)
        unit = self.units.get(file)
        if unit is None:
            return None
        info = unit.classes.get(class_name)
        if info is None:
            return None
        if method in info.methods:
            return file
        for base in info.bases:
            base_file = file if base in unit.classes else None
            base_name = base
            if base_file is None:
                resolved = self.resolve_import(unit, base)
                if resolved:
                    base_file, base_name = resolved
            if base_file and base_file in self.units and base_name in self.units[base_file].classes:
                found = self.find_method(base_file, base_name, method, seen)
                if found:
                    return found
        return None


# ---------------------------------------------------------------------------
# Walking the call sites
# ---------------------------------------------------------------------------


@dataclass
class Site:
    file: str
    owner: str
    owner_class: str | None
    line: int
    callee: str
    receiver: str | None
    verdict: str  # internal | external | variable | unknown | silent
    target_file: str | None = None


def class_of(tree: ast.Module) -> dict[int, str]:
    """Every function node id mapped to the class that encloses it."""
    owner: dict[int, str] = {}

    def descend(node: ast.AST, current: str | None) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                descend(child, child.name)
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if current:
                    owner[id(child)] = current
                descend(child, current)
            else:
                descend(child, current)

    descend(tree, None)
    return owner


def parameter_types(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, str]:
    """A function's parameters that say what they are, by name.

    **`def run_command(info: ScriptInfo)` says `info.load_app()` names a member of `ScriptInfo`**, and an oracle that
    reads only names has to call that site unresolvable - which scores a resolver that reads the annotation as wrong.
    `self` and `cls` are left out: the enclosing class is not an annotation and is answered elsewhere.
    """
    typed: dict[str, str] = {}
    args = fn.args
    every = [*args.posonlyargs, *args.args, *args.kwonlyargs]
    for arg in [*every, args.vararg, args.kwarg]:
        if arg is None or arg.arg in OWN_SCOPE_NAMES:
            continue
        name = annotation_name(arg.annotation)
        if name is not None:
            typed.setdefault(arg.arg, name)
    return typed


def sites_of(corpus: Corpus, unit: Unit, tree: ast.Module) -> list[Site]:
    out: list[Site] = []
    enclosing = class_of(tree)

    def visit(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                collect(child, enclosing.get(id(child)))
                visit(child)
            elif isinstance(child, ast.ClassDef):
                visit(child)

    def collect(fn: ast.FunctionDef | ast.AsyncFunctionDef, cls: str | None) -> None:
        local, _globals = bound_names(fn)
        typed = parameter_types(fn)
        body = list(own_scope_nodes(fn))
        for node in body:
            if not isinstance(node, ast.Call):
                continue
            callee, receiver = call_target(node.func)
            if callee is None:
                continue
            verdict, target = classify(unit, cls, callee, receiver, local, typed)
            out.append(
                Site(
                    file=unit.rel,
                    owner=fn.name,
                    owner_class=cls,
                    line=node.lineno,
                    callee=callee,
                    receiver=receiver,
                    verdict=verdict,
                    target_file=target,
                )
            )

    def call_target(func: ast.expr) -> tuple[str | None, str | None]:
        if isinstance(func, ast.Name):
            return func.id, None
        # **The receiver is kept whole, not only when it is a bare name.** `self.session_interface.is_null_session()`
        # has an `Attribute` as its receiver, and the first version of this function answered `(None, None)` for it -
        # so the site was never classified, and every graph that resolved it was scored as wrong. A receiver is the
        # dotted path written before the callee, and what it *is* is decided by `classify`.
        if isinstance(func, ast.Attribute):
            return func.attr, dotted(func.value)
        return None, None

    def classify(
        unit: Unit,
        cls: str | None,
        callee: str,
        receiver: str | None,
        local: set[str],
        typed: dict[str, str],
    ) -> tuple[str, str | None]:
        # **`self.field.m()` - the field's annotation names the class the member is looked up in.** A Python reader
        # that stops at one level cannot answer it: the field is a name the class declares and the callee is a name the
        # *field's type* declares, and only the annotation joins them. Two segments, and the annotation must name one
        # class the corpus declares once; anything else is `unknown` rather than a guess.
        if receiver is not None and "." in receiver:
            base, _, path = receiver.partition(".")
            if base in OWN_SCOPE_NAMES and cls is not None and "." not in path:
                annotation = corpus.field_type(unit.rel, cls, path)
                if annotation is not None:
                    files = corpus.files_declaring(annotation)
                    if files:
                        found = corpus.find_method(files[0], annotation, callee, set())
                        if found:
                            return "internal", found
            return "unknown", None
        # `self.m()` / `cls.m()` - the enclosing class, then a base class inside the corpus.
        if receiver in OWN_SCOPE_NAMES:
            if cls:
                found = corpus.find_method(unit.rel, cls, callee, set())
                if found:
                    return "internal", found
            return "external", None
        # **`param.m()` where the parameter says what it is** - the same question as `self.field.m()` with the
        # annotation written on the parameter instead of on a field.
        if receiver is not None and receiver in typed:
            annotation = typed[receiver]
            files = corpus.files_declaring(annotation)
            if files:
                found = corpus.find_method(files[0], annotation, callee, set())
                if found:
                    return "internal", found
            return "unknown", None
        # `mod.f()` - only when the receiver is a module this file imported.
        if receiver is not None:
            namespace = corpus.resolve_namespace(unit, receiver)
            if namespace is not None:
                target_unit = corpus.units.get(namespace)
                if target_unit and callee in target_unit.defs:
                    return "internal", namespace
                return "external", None
            return "silent", None
        # A bare call: a variable first, because that is what a bound name is.
        if callee in local:
            return "variable", None
        if callee in unit.defs:
            return "internal", unit.rel
        resolved = corpus.resolve_import(unit, callee)
        if resolved:
            file, original = resolved
            target_unit = corpus.units.get(file)
            if target_unit and original in target_unit.defs:
                return "internal", file
            return "external", None
        if callee in BUILTIN_NAMES:
            return "external", None
        return "unknown", None

    visit(tree)
    return out


# ---------------------------------------------------------------------------
# Comparing the graph against the truth
# ---------------------------------------------------------------------------


def _cause(candidates: list[Site], callee: str) -> str:
    """Why the oracle does not corroborate a pair the graph claims, in one word.

    The distinctions matter because they are fixed in different places: `silent` means the oracle had no opinion and
    the graph may well be right, while `external` and `variable` mean the call site exists and goes somewhere else.
    """
    same_name = [site for site in candidates if site.callee == callee]
    if not same_name:
        return "owner-makes-no-such-call"
    verdicts = {site.verdict for site in same_name}
    if "internal" in verdicts:
        return "resolves-elsewhere"
    if "external" in verdicts:
        return "external"
    if "variable" in verdicts:
        return "variable"
    if "silent" in verdicts:
        return "silent-receiver"
    return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--graph", required=True)
    parser.add_argument("--name", default="")
    parser.add_argument("--out")
    parser.add_argument("--explain", help="file|owner|callee — print the evidence for one pair")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    corpus = Corpus(root)

    sites: list[Site] = []
    for rel, unit in corpus.units.items():
        _unit, tree = read_unit(root / rel, root)
        sites.extend(sites_of(corpus, unit, tree))

    if args.explain:
        # **One pair, all of the evidence.** Reading a wrong edge off a table is how a defect gets attributed to the
        # wrong pass; this prints every site the oracle found for the owner, and every declaration of the name.
        wanted_file, wanted_owner, wanted_callee = (args.explain.split("|") + ["", ""])[:3]
        for site in sites:
            if wanted_file and site.file != wanted_file:
                continue
            if wanted_owner and site.owner != wanted_owner:
                continue
            if wanted_callee and site.callee != wanted_callee:
                continue
            json.dump(site.__dict__, sys.stdout)
            sys.stdout.write("\n")
        unit = corpus.units.get(wanted_file)
        if unit:
            json.dump(
                {
                    "defs": unit.defs,
                    "imports": unit.imports,
                    "classes": {name: vars(info) for name, info in unit.classes.items()},
                },
                sys.stdout,
                indent=1,
            )
            sys.stdout.write("\n")
        return 0

    # **Identity the graph cannot distinguish.** A symbol is `(file, name)` in the graph and `(file, class, name)` in
    # Python, so two declarations of one name in one file are one node. Every site touching such a name is excluded
    # from the score, and the number is published because it is the ceiling on what any resolution can reach.
    per_file_names: dict[str, dict[str, int]] = {}
    for rel, unit in corpus.units.items():
        counts: dict[str, int] = {}
        for name in unit.defs:
            counts[name] = counts.get(name, 0) + 1
        for info in unit.classes.values():
            for method in info.methods:
                counts[method] = counts.get(method, 0) + 1
        per_file_names[rel] = counts

    def ambiguous(file: str, name: str) -> bool:
        return per_file_names.get(file, {}).get(name, 0) > 1

    expected: set[tuple[str, str, str, str]] = set()
    excluded = 0
    verdicts: dict[str, int] = {}
    for site in sites:
        verdicts[site.verdict] = verdicts.get(site.verdict, 0) + 1
        if site.verdict != "internal":
            continue
        assert site.target_file is not None
        # **Recursion is not an edge in this graph, deliberately** - `cross-file` and `scope-resolution` both refuse a
        # self-edge because "a function calls itself" is a recursion fact the graph records elsewhere. Scoring it as a
        # miss would penalise a decision already made.
        if (site.file, site.owner) == (site.target_file, site.callee):
            verdicts["internalRecursion"] = verdicts.get("internalRecursion", 0) + 1
            continue
        if ambiguous(site.file, site.owner) or ambiguous(site.target_file, site.callee):
            excluded += 1
            continue
        expected.add((site.file, site.owner, site.target_file, site.callee))

    sites_by_owner: dict[tuple[str, str], list[Site]] = {}
    for site in sites:
        sites_by_owner.setdefault((site.file, site.owner), []).append(site)

    dump = json.loads(Path(args.graph).read_text())
    nodes = {n["id"]: n for n in dump["nodes"]}
    claimed: set[tuple[str, str, str, str]] = set()
    per_arm: dict[str, dict[str, int]] = {}
    for edge in dump["edges"]:
        source = nodes.get(edge["s"])
        target = nodes.get(edge["t"])
        if source is None or target is None:
            continue
        if not source.get("file") or not target.get("file"):
            continue
        key = (source["file"], source["name"], target["file"], target["name"])
        if ambiguous(source["file"], source["name"]) or ambiguous(target["file"], target["name"]):
            continue
        claimed.add(key)
        arm = (edge.get("properties") or {}).get("resolution", "unlabelled")
        bucket = per_arm.setdefault(arm, {"tp": 0, "fp": 0})
        if key in expected:
            bucket["tp"] += 1
        else:
            bucket["fp"] += 1

    wrong_with_arm: list[tuple[str, str, str, str, str]] = []
    arm_of: dict[tuple[str, str, str, str], str] = {}
    for edge in dump["edges"]:
        source = nodes.get(edge["s"])
        target = nodes.get(edge["t"])
        if source is None or target is None or not source.get("file") or not target.get("file"):
            continue
        key = (source["file"], source["name"], target["file"], target["name"])
        arm_of.setdefault(key, (edge.get("properties") or {}).get("resolution", "unlabelled"))
    for source, owner, target_file, callee in claimed - expected:
        wrong_with_arm.append((source, owner, target_file, callee, arm_of.get((source, owner, target_file, callee), "unlabelled")))

    true_positive = len(claimed & expected)
    false_positive = len(claimed - expected)
    missed = expected - claimed

    def ratio(part: int, whole: int) -> float | None:
        return round(part / whole, 4) if whole else None

    by_arm = {
        arm: {
            "claimed": value["tp"] + value["fp"],
            "correct": value["tp"],
            "precision": ratio(value["tp"], value["tp"] + value["fp"]),
        }
        for arm, value in sorted(per_arm.items())
    }

    functions = sum(
        len([line for lines in unit.defs.values() for line in lines]) for unit in corpus.units.values()
    )
    owners_with_calls = {site.owner for site in sites if site.verdict in {"internal", "external"}}
    graph_callers = {key[1] for key in claimed}
    oracle_callers = {(site.file, site.owner) for site in sites if site.verdict == "internal"}
    graph_caller_keys = {(key[0], key[1]) for key in claimed}

    report = {
        "generatedBy": "scripts/callgraph-oracle.py",
        "corpus": args.name,
        "files": len(corpus.units),
        "definitions": {
            "moduleLevel": functions,
            "simpleNameCollisionsPerFile": sum(
                1 for counts in per_file_names.values() for name, count in counts.items() if count > 1
            ),
        },
        "sites": {
            "total": len(sites),
            **{
                key: verdicts.get(key, 0)
                for key in ("internal", "internalRecursion", "external", "variable", "unknown", "silent")
            },
            "excludedForDuplicateName": excluded,
        },
        "expectedPairs": len(expected),
        "claimedPairs": len(claimed),
        "precision": {"correct": true_positive, "wrong": false_positive, "value": ratio(true_positive, len(claimed))},
        "recall": {"found": true_positive, "missed": len(missed), "value": ratio(true_positive, len(expected))},
        "byArm": by_arm,
        "callers": {
            "oracle": len(oracle_callers),
            "graph": len(graph_caller_keys & oracle_callers),
            "graphOnly": len(graph_caller_keys - oracle_callers),
            "ownersWithAnyCall": len(owners_with_calls),
            "graphCallers": graph_callers and len(graph_callers),
        },
        "wrongSamples": sorted(
            f"[{arm_of.get((s, o, t, n), 'unlabelled')}] {s}|{o} -> {t}|{n}" for s, o, t, n in list(claimed - expected)
        )[:40],
        "wrongCauses": dict(
            sorted(
                collections.Counter(
                    _cause(sites_by_owner.get((source, owner), []), callee)
                    for source, owner, _target, callee in claimed - expected
                ).items(),
                key=lambda kv: -kv[1],
            )
        ),
        "wrongByArm": {
            arm: dict(
                sorted(
                    collections.Counter(
                        _cause(sites_by_owner.get((source, owner), []), callee)
                        for source, owner, _target, callee, owner_arm in wrong_with_arm
                        if owner_arm == arm
                    ).items(),
                    key=lambda kv: -kv[1],
                )
            )
            for arm in sorted({entry[4] for entry in wrong_with_arm})
        },
        "missedSamples": sorted(f"{s}|{o}|{t}|{n}" for s, o, t, n in list(missed))[:15],
    }

    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n")
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
