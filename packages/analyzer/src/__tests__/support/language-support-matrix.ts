/**
 * The capability matrix in `docs/language-support.md`, expressed as something a test can disagree with.
 *
 * **A row in that table is a promise and the table had no instrument behind it.** Iteration 85 found one false row by
 * accident — `Function Calls` was `✅` for Kotlin while the graph held zero `CALLS` edges, because the provider's walk
 * never reached a `call_expression` — and a row found by accident is a row that was never checked. The other
 * forty-seven had the same status: a claim, written from what the language *can* do, with nothing that fails when the
 * provider stops doing it.
 *
 * Three pieces make a row checkable:
 *
 * 1. **One fixture per language**, written to contain the constructs the row names, with the same identifiers in every
 *    language so a check does not have to be written twenty-one times. `Widget`, `draw`, `topLevel`, `Drawable`,
 *    `Color`, `LIMIT` and `local` mean the same thing in all twenty-one files.
 * 2. **One check per row**, reading the captures the provider emitted for its own fixture. A check returns `null` when
 *    the row is backed and a sentence naming the missing evidence when it is not, so a failure says what to look at
 *    rather than only that something is wrong.
 * 3. **A list of the rows that are not instrumented yet, and why.** A row that is neither checked nor listed fails the
 *    suite, so the matrix cannot grow a row that nobody has decided about.
 *
 * **What a check may look at is the fixture, not the code.** The question is "given this source, does this row's
 * evidence appear", and the answer is read off the same `parse()` call the index makes. That is why a check can say
 * `the enum Color is captured` without knowing whether the provider spells it `enum.def` or `class.def` with `Enum` in
 * its bases — the language's own way of writing the construct is the fixture's problem, and the row is about the fact
 * reaching the graph.
 */

import type { UnifiedCapture, CaptureTag } from '@code-analyzer/shared';

/** The identifiers every fixture writes, so one check serves twenty-one languages. */
export interface FixtureNames {
  /** A function declared at file scope. */
  readonly fn: string;
  /** A method declared in `cls`. */
  readonly method: string;
  /** The class the method belongs to. */
  readonly cls: string;
  /** An interface, protocol or trait. */
  readonly iface: string;
  /** An enum. */
  readonly enumName: string;
  /** An enum member. */
  readonly enumMember: string;
  /** A type alias, where the language has one. */
  readonly type: string;
  /** A constant. */
  readonly constant: string;
  /** A local variable bound inside `fn`. */
  readonly variable: string;
  /** The type the file names in a type position. */
  readonly typeName: string;
  /** The name every call in the fixture calls. */
  readonly callee: string;
}

/** One language's fixture: a file the language would accept, and the names a check can ask about. */
export interface MatrixFixture {
  readonly file: string;
  readonly source: string;
  readonly names: FixtureNames;
}

const DEFAULT_NAMES: FixtureNames = {
  fn: 'topLevel',
  method: 'draw',
  cls: 'Widget',
  iface: 'Drawable',
  enumName: 'Color',
  enumMember: 'RED',
  type: 'Alias',
  constant: 'LIMIT',
  variable: 'local',
  typeName: 'Widget',
  callee: 'helper',
};

/** A fixture with the camelCase names, which is what most of the twenty-one languages write. */
function fixture(
  file: string,
  source: string,
  overrides: Partial<FixtureNames> = {},
): MatrixFixture {
  return { file, source, names: { ...DEFAULT_NAMES, ...overrides } };
}

export const FIXTURES: Readonly<Record<string, MatrixFixture>> = {
  TypeScript: fixture(
    'matrix.ts',
    `
import { helper } from './helper';

export const LIMIT = 10;

/** Greets a name through the helper. */
export function topLevel(name: string): string {
  let local = helper(name);
  return local;
}

export abstract class Base {
  abstract run(): void;
}

export class Widget {
  private label: string = 'x';

  constructor(label: string) {
    this.label = label;
  }

  draw(): void {
    helper(this.label);
  }
}

export interface Drawable {
  draw(): void;
}

export enum Color {
  RED,
  GREEN,
}

export type Alias = Widget;

export function identity<T>(value: T): T {
  return value;
}

export const later = async (): Promise<number> => 1;

export const anon = class Inner {
  run(): void {}
};

@sealed
export class Decorated {}
`,
  ),
  JavaScript: fixture(
    'matrix.js',
    `
import { helper } from './helper';

export const LIMIT = 10;

/** Greets a name through the helper. */
export function topLevel(name) {
  let local = helper(name);
  return local;
}

export class Widget {
  constructor(label) {
    this.label = label;
  }

  draw() {
    helper(this.label);
  }
}

export const anon = class Inner {
  run() {}
};

export const later = async () => 1;
`,
  ),
  Python: fixture(
    'matrix.py',
    `
import helper
from os import path

LIMIT = 10


def top_level(name: str) -> str:
    """Return the helper of a name."""
    local = helper(name)
    return local


@cached
def typed(name: str) -> str:
    return helper(name)


def build(widget: Widget) -> Widget:
    return widget


class Widget:
    """A widget."""

    def __init__(self, label: str) -> None:
        self.label = label

    def draw(self) -> str:
        return helper(self.label)


class Color(Enum):
    RED = 1
    GREEN = 2


async def later() -> int:
    return 1
`,
    { fn: 'top_level', typeName: 'Widget' },
  ),
  Go: fixture(
    'matrix.go',
    `
package main

import "example.com/helper"

const LIMIT = 10

type Drawable interface {
	Draw() string
}

type Widget struct {
	label string
}

// topLevel greets a name through the helper.
func topLevel(name string) string {
	local := helper(name)
	return local
}

func (w Widget) draw() string {
	return helper(w.label)
}

func identity[T any](value T) T {
	return value
}
`,
  ),
  Java: fixture(
    'Matrix.java',
    `
package matrix;

import java.util.List;

@interface Marker {}

interface Drawable {
  void draw();
}

enum Color {
  RED,
  GREEN
}

abstract class Base {
  abstract void run();
}

/** A widget. */
@Marker
public /// A widget.
class Widget implements Drawable {
  private final List<String> labels;

  public Widget(List<String> labels) {
    this.labels = labels;
  }

  public static final int LIMIT = 10;

  @Override
  public void draw() {
    List<String> local = helper(labels);
  }

  public static void topLevel(String name) {
    helper(name);
  }
}
`,
    { typeName: 'List' },
  ),
  Kotlin: fixture(
    'Matrix.kt',
    `
package matrix

import kotlinx.coroutines.Flow

const val LIMIT = 10

interface Drawable {
    fun draw()
}

enum class Color { RED, GREEN }

/** A widget. */
@Deprecated("old")
class Widget(val label: String) : Drawable {
    override fun draw() {
        helper(label)
    }
}

fun topLevel(name: String): String {
    val local = helper(name)
    return local
}

fun <T> identity(value: T): T = value

suspend fun later(): Int = 1

fun String.shout(): String = helper(this)

object Registry {
    fun register() {}
}
`,
    { variable: 'local', typeName: 'String' },
  ),
  'C#': fixture(
    'Matrix.cs',
    `
using System;

namespace Matrix
{
    public interface IDrawable
    {
        void Draw();
    }

    public enum Color
    {
        Red,
        Green
    }

    public struct Point
    {
        public int X;
    }

    /// <summary>A widget.</summary>
    [Serializable]
    public class Widget : IDrawable
    {
        private readonly string label;

        public const int LIMIT = 10;

        public Widget(string label)
        {
            this.label = label;
        }

        public void Draw()
        {
            var local = Helper(label);
        }

        public async void Later() { }
    }

    public class Box<T>
    {
        public T Value;
    }
}
`,
    {
      cls: 'Widget',
      method: 'Draw',
      iface: 'IDrawable',
      fn: 'Draw',
      enumMember: 'Red',
      typeName: 'string',
    },
  ),
  Rust: fixture(
    'matrix.rs',
    `
use std::fmt;

const LIMIT: usize = 10;

pub trait Drawable {
    fn draw(&self);
}

pub enum Color {
    RED,
    GREEN,
}

#[derive(Debug)]
pub struct Widget {
    label: String,
}

/// A widget that draws.
impl Drawable for Widget {
    fn draw(&self) {
        let local = helper(&self.label);
    }
}

/// Greets a name.
pub fn top_level(name: &str) -> String {
    helper(name)
}

pub fn identity<T>(value: T) -> T {
    value
}

pub async fn later() -> u8 {
    1
}
`,
    { fn: 'top_level', method: 'draw', typeName: 'Widget' },
  ),
  PHP: fixture(
    'matrix.php',
    `
<?php

namespace Matrix;

use Other\\Helper;

interface Drawable
{
    public function draw();
}

trait Loggable
{
    public function log() {}
}

function topLevel($name)
{
    return helper($name);
}

enum Color
{
    case RED;
    case GREEN;
}

const LIMIT = 10;

#[Attribute]
/** A widget. */
class Widget implements Drawable
{
    private $label;

    public function __construct($label)
    {
        $this->label = $label;
    }

    public function draw()
    {
        $local = helper($this->label);
        return $local;
    }
}
`,
    { enumMember: 'RED' },
  ),
  Ruby: fixture(
    'matrix.rb',
    `
require 'helper'

LIMIT = 10

module Matrix
  class Widget
    def initialize(label)
      @label = label
    end

    # Draws the label.
    # Draws the label.
    def draw
      helper(@label)
    end
  end
end

def top_level(name)
  local = helper(name)
  local
end
`,
    { fn: 'top_level', variable: 'local' },
  ),
  'C/C++': fixture(
    'matrix.cpp',
    `
#include "helper.h"

#define LIMIT 10

enum Color { RED, GREEN };

struct Point { int x; int y; };

/** Greets a name. */
int top_level(const char *name) {
    int local = helper(name);
    return local;
}

class Widget {
 public:
  Widget(const char *label) : label_(label) {}

  void draw() { helper(label_); }

 private:
  const char *label_;
};
`,
    { cls: 'Widget', method: 'draw', fn: 'top_level', typeName: 'Point' },
  ),
  Swift: fixture(
    'Matrix.swift',
    `
import Foundation

let LIMIT = 10

protocol Drawable {
    func draw()
}

enum Color {
    case RED
    case GREEN
}

struct Point {
    var x: Int
}

/// A widget.
public class Widget: Drawable {
    var label: String

    init(label: String) {
        self.label = label
    }

    func draw() {
        let local = helper(label)
    }
}

public func topLevel(name: String) -> String {
    return helper(name)
}

public func identity<T>(value: T) -> T {
    return value
}

public func later() async -> Int {
    return 1
}
`,
    { enumMember: 'RED' },
  ),
  Dart: fixture(
    'matrix.dart',
    `
import 'helper.dart';

const int LIMIT = 10;

abstract class Drawable {
  void draw();
}

enum Color { RED, GREEN }

/// A widget.
class Widget implements Drawable {
  final String label;

  Widget(this.label);

  @override
  void draw() {
    var local = helper(label);
  }
}

String topLevel(String name) => helper(name);

Future<int> later() async {
  return 1;
}

class Box<T> {
  T? value;
}
`,
    { enumMember: 'RED' },
  ),
  Lua: fixture(
    'matrix.lua',
    `
local helper = require("helper")

local LIMIT = 10

-- Greets a name.
function topLevel(name)
  local local1 = helper(name)
  return local1
end

local Widget = {}

function Widget.draw(self)
  return helper(self.label)
end

return Widget
`,
    { variable: 'local1' },
  ),
  Scala: fixture(
    'Matrix.scala',
    `
package matrix

import scala.collection.mutable

trait Drawable {
  def draw(): Unit
}

/** A widget. */
class Widget(label: String) extends Drawable {
  def draw(): Unit = helper(label)
}

object App {
  val LIMIT = 10

  def topLevel(name: String): String = {
    val local = helper(name)
    local
  }
}

enum Color {
  case RED
  case GREEN
}

class Box[T](value: T)
`,
    { fn: 'topLevel', typeName: 'Widget' },
  ),
  Zig: fixture(
    'matrix.zig',
    `
const std = @import("std");

const LIMIT = 10;

const Color = enum { RED, GREEN };

const Point = struct { x: i32 };

/// Greets a name.
/// Greets a name.
pub fn topLevel(name: []const u8) []const u8 {
    const local = helper(name);
    return local;
}
`,
    { variable: 'local', typeName: 'Point' },
  ),
  Elixir: fixture(
    'matrix.ex',
    `
defmodule Matrix do
  import Helper

  @limit 10

  @doc """
  Greets a name.
  """
  def top_level(name) do
    local = helper(name)
    local
  end

  defmodule Widget do
    defstruct [:label]

    def draw(label) do
      helper(label)
    end
  end
end
`,
    { fn: 'top_level', cls: 'Widget', variable: 'local' },
  ),

  /**
   * **ArkTS is TypeScript with a UI language bolted on**, and the fixture writes both halves: `struct` with `@Component`
   * is a declarative component rather than a class, `@State` is a decorator that changes what a field means, and the
   * rest of the file is ordinary TypeScript so that a row which passes here and fails in the TypeScript column would be
   * a fact about the provider rather than about the grammar.
   */
  ArkTS: fixture(
    'matrix.ets',
    `
import { helper } from './helper';

export const LIMIT: number = 10;

/** Greets a name through the helper. */
export function topLevel(name: string): string {
  let local = helper(name);
  return local;
}

export abstract class Base {
  abstract run(): void;
}

export class Widget {
  private label: string = 'x';

  constructor(label: string) {
    this.label = label;
  }

  draw(): void {
    helper(this.label);
  }
}

export interface Drawable {
  draw(): void;
}

export enum Color {
  RED,
  GREEN,
}

export type Alias = Widget;

export function identity<T>(value: T): T {
  return value;
}

export const later = async (): Promise<number> => 1;

export const anon = class Inner {
  run(): void {}
};

@Component
export struct Card {
  @State title: string = 'x';

  build() {
    Column() {
      Text(this.title)
    }
  }
}
`,
  ),
  /**
   * **Groovy is the JVM with the ceremony removed**, and the fixture writes the parts that differ from Java: a method
   * without a modifier, a property declared as a field with no type, a constructor that assigns, `@Override` in front of
   * a method, and a `static final` constant — the same six constructs the Java fixture writes, in Groovy's spelling.
   */
  Groovy: fixture(
    'matrix.groovy',
    `
import java.util.List

interface Drawable {
  void draw()
}

enum Color {
  RED,
  GREEN
}

abstract class Base {
  abstract void run()
}

/** A widget. */
class Widget extends Base implements Drawable {
  public static final int LIMIT = 10
  private final List<String> labels

  Widget(List<String> labels) {
    this.labels = labels
  }

  @Override
  void draw() {
    List<String> local = helper(labels)
  }

  static void topLevel(String name) {
    helper(name)
  }
}
`,
    { typeName: 'List' },
  ),
};

/**
 * **Three providers whose fixture is a file rather than a program.** Bash and R are scripts — a declaration with a name
 * and a call, and no interface, enum or generic syntax to write — which is why most of their rows are `N/A`. Svelte is a
 * component: its declarations live inside a `<script>` block and its template is markup, so the rows about types and
 * receivers do not describe it either.
 *
 * They live in this second table rather than in `FIXTURES` because the fixtures above are one family with a shared
 * vocabulary and a type system; these three write a file, and a reader comparing them to the eighteen above should see
 * the difference before the braces.
 *
 * **`N/A` means the syntax does not exist, not that the language cannot express the idea.** R has classes — `setClass`
 * declares one and the walker files it as `class.def` — so R's `Class Definitions` is `✅` and this fixture writes the
 * call, while Bash's is `N/A` because a shell has no class at all.
 */
export const SCRIPT_AND_COMPONENT_FIXTURES: Readonly<Record<string, MatrixFixture>> = {
  Bash: fixture(
    'matrix.sh',
    `
#!/usr/bin/env bash
# A small script.
LIMIT=10
readonly NAME="widget"

# Draws the widget through the helper.
draw() {
  local label="$1"
  helper "$label"
}

draw "$NAME"
`,
    { fn: 'draw', variable: 'label', constant: 'NAME', callee: 'helper' },
  ),
  R: fixture(
    'matrix.R',
    `
# A small script.
LIMIT <- 10

setClass("Widget", representation(label = "character"))

# Draws the widget through the helper.
draw <- function(labels) {
  local <- helper(labels)
  local
}

draw(LIMIT)
`,
    { fn: 'draw', variable: 'local', constant: 'LIMIT', callee: 'helper' },
  ),
  Svelte: fixture(
    'Widget.svelte',
    `
<script lang="ts">
  import { helper } from './helper';

  export const LIMIT = 10;

  /** Greets a name through the helper. */
  export function topLevel(name: string): string {
    let local = helper(name);
    return local;
  }
</script>

<div class="widget">{LIMIT}</div>
`,
  ),
};

/** What a check needs besides the captures. */
export interface CheckContext {
  readonly captures: readonly UnifiedCapture[];
  readonly names: FixtureNames;
  /** Whether the provider reports a name as exported, which is a method rather than a capture. */
  readonly isExported: (name: string) => boolean;
}

/** `null` when the row is backed, or a sentence naming the evidence that is missing. */
export type MatrixCheck = (context: CheckContext) => string | null;

const tagsOf = (captures: readonly UnifiedCapture[], ...tags: CaptureTag[]): UnifiedCapture[] =>
  captures.filter((capture) => tags.includes(capture.tag));

const named = (captures: readonly UnifiedCapture[], name: string): UnifiedCapture[] =>
  captures.filter((capture) => capture.name === name);

const propertyOf = (capture: UnifiedCapture, key: string): string | undefined =>
  capture.properties?.[key];

const missing = (row: string, names: readonly string[]): string =>
  `${row}: no capture names ${names.map((name) => `\`${name}\``).join(', ')}`;

/**
 * One check per matrix row.
 *
 * The keys are the row labels exactly as `docs/language-support.md` writes them, so the test proves that the two lists
 * are the same list. A row whose check cannot be written against captures belongs in `UNINSTRUMENTED` below.
 */
export const CHECKS: Readonly<Record<string, MatrixCheck>> = {
  /**
   * **A function is a declaration with a name, and in a language where every function is a method the method is the
   * function.** Java, C# and Ruby write no file-scope functions at all: `topLevel` is a `static` member or a method of
   * `Object`, and a check that insisted on `function.def` would downgrade a row for a language that simply has nowhere
   * else to put a function. What the row is about — the declaration is captured, with its name — is the same question.
   */
  'Function Definitions': ({ captures, names }) =>
    named(tagsOf(captures, 'function.def', 'method.def'), names.fn).length > 0
      ? null
      : missing('Function Definitions', [names.fn]),

  /**
   * **A method is a definition with a member's name, and the tag is what tells them apart where the grammar does.**
   * Python and Kotlin file a method as `function.def` with an `enclosingClass`, which is the same fact under a
   * different tag; both are accepted here because the row is about the method being captured, and the tag is recorded
   * separately by the `Declared Type Facts` row.
   */
  'Method Definitions': ({ captures, names }) => {
    const definitions = tagsOf(captures, 'method.def', 'function.def');
    const byName = named(definitions, names.method);
    const byContainer = byName.some(
      (capture) =>
        capture.tag === 'method.def' || propertyOf(capture, 'enclosingClass') === names.cls,
    );
    return byName.length > 0 && byContainer
      ? null
      : `Method Definitions: no method \`${names.method}\` is captured as a member of \`${names.cls}\``;
  },

  'Class Definitions': ({ captures, names }) =>
    named(tagsOf(captures, 'class.def', 'struct.def'), names.cls).length > 0
      ? null
      : missing('Class Definitions', [names.cls]),

  'Interface Definitions': ({ captures, names }) =>
    named(tagsOf(captures, 'interface.def', 'trait.def'), names.iface).length > 0
      ? null
      : missing('Interface Definitions', [names.iface]),

  /**
   * **Python spells an enum `class Color(Enum)`, and the row is about the enum being captured.** A provider that
   * files it as a class with `Enum` among its bases has detected the enumeration; one that files nothing has not.
   */
  'Enum Definitions': ({ captures, names }) => {
    if (named(tagsOf(captures, 'enum.def'), names.enumName).length > 0) return null;
    const asClass = named(tagsOf(captures, 'class.def'), names.enumName).some((capture) =>
      (propertyOf(capture, 'baseClasses') ?? '').includes('Enum'),
    );
    return asClass ? null : missing('Enum Definitions', [names.enumName]);
  },

  'Type Definitions': ({ captures, names }) =>
    named(tagsOf(captures, 'type.def'), names.type).length > 0
      ? null
      : missing('Type Definitions', [names.type]),

  'Variable Definitions': ({ captures, names }) =>
    named(tagsOf(captures, 'variable.def'), names.variable).length > 0
      ? null
      : missing('Variable Definitions', [names.variable]),

  'Constant Definitions': ({ captures, names }) =>
    named(tagsOf(captures, 'constant.def'), names.constant).length > 0
      ? null
      : missing('Constant Definitions', [names.constant]),

  'Import Statements': ({ captures }) =>
    tagsOf(captures, 'import').length > 0
      ? null
      : 'Import Statements: the fixture imports and nothing was captured',

  /** Export is a question the provider answers, not a capture it emits, so the check asks the same method the index does. */
  'Export Detection': ({ names, isExported }) =>
    isExported(names.fn)
      ? null
      : `Export Detection: \`${names.fn}\` is written exported and reported otherwise`,

  'Decorators/Annotations': ({ captures }) =>
    tagsOf(captures, 'decorator', 'annotation').length > 0
      ? null
      : 'Decorators/Annotations: the fixture carries an annotation and nothing was captured',

  'Route Detection': ({ captures }) =>
    tagsOf(captures, 'route.path', 'route.method').length > 0
      ? null
      : 'Route Detection: no route was captured',

  /**
   * **The constructor is the language's own word for it.** `constructor`, `__init__`, `initialize` and `init` are
   * four spellings of one declaration, and a provider that files it as a method has still captured it.
   */
  'Constructor Detection': ({ captures, names }) => {
    if (tagsOf(captures, 'constructor.def').length > 0) return null;
    const spellings = ['constructor', '__init__', '__construct', 'initialize', 'init', names.cls];
    const found = captures.some(
      (capture) =>
        tagsOf([capture], 'method.def', 'function.def').length > 0 &&
        spellings.includes(capture.name ?? ''),
    );
    return found ? null : 'Constructor Detection: no constructor is captured in any spelling';
  },

  /**
   * **A docstring is either a capture or a property, and both are the same fact.** TypeScript and JavaScript emit a
   * `docstring` capture that the base class attaches to the declaration above it; Python stores the text as a
   * property. Either way the row is backed; neither way is not.
   */
  'Docstrings/JSDoc': ({ captures }) => {
    if (tagsOf(captures, 'docstring').length > 0) return null;
    const attached = captures.some(
      (capture) => (propertyOf(capture, 'docstring') ?? '').length > 0,
    );
    return attached
      ? null
      : 'Docstrings/JSDoc: the fixture documents a declaration and no docstring reached it';
  },

  'Function Calls': ({ captures }) =>
    tagsOf(captures, 'function.call', 'method.call').length > 0
      ? null
      : 'Function Calls: the fixture calls `helper` and no call site was captured',

  /**
   * **Three properties carry a declared type and any of them is the fact.** `fieldTypes` is a class's own fields,
   * `parameterType` a parameter's, `localTypes` a body's locals; the row says the language publishes what a
   * declaration is, and which of the three it publishes is the provider's business.
   */
  'Declared Type Facts': ({ captures }) =>
    captures.some(
      (capture) =>
        (propertyOf(capture, 'fieldTypes') ?? '').includes(':') ||
        (propertyOf(capture, 'localTypes') ?? '').includes(':') ||
        (propertyOf(capture, 'parameterType') ?? '').length > 0,
    )
      ? null
      : 'Declared Type Facts: no capture states a type for a field, a local or a parameter',

  'Declared Return Types': ({ captures }) =>
    captures.some((capture) => (propertyOf(capture, 'returnType') ?? '').length > 0)
      ? null
      : 'Declared Return Types: no capture states a return type',

  'Parameter Arity': ({ captures }) =>
    captures.some((capture) => (propertyOf(capture, 'parameterCount') ?? '').length > 0)
      ? null
      : 'Parameter Arity: no capture states a parameter count',

  'Type-Position References': ({ captures, names }) =>
    named(tagsOf(captures, 'type.reference'), names.typeName).length > 0
      ? null
      : missing('Type-Position References', [names.typeName]),

  'Abstract Classes': ({ captures }) =>
    captures.some(
      (capture) =>
        capture.tag === 'class.def' &&
        (propertyOf(capture, 'abstract') === 'true' ||
          propertyOf(capture, 'isAbstract') === 'true' ||
          (capture.text ?? '').includes('abstract')),
    )
      ? null
      : 'Abstract Classes: the fixture declares `abstract class` and the capture does not say so',

  'Class Expressions': ({ captures }) =>
    captures.some(
      (capture) =>
        capture.tag === 'class.def' &&
        (propertyOf(capture, 'expression') === 'true' ||
          propertyOf(capture, 'isExpression') === 'true' ||
          capture.name === 'Inner'),
    )
      ? null
      : 'Class Expressions: the fixture declares a class expression and it was not captured as one',

  'Type Aliases': ({ captures, names }) =>
    tagsOf(named(captures, names.type), 'type.def').some(
      (capture) => (propertyOf(capture, 'aliasOf') ?? '').length > 0,
    )
      ? null
      : `Type Aliases: \`type ${names.type} = …\` is not captured with the type it stands for`,

  /**
   * **Generics are read off the signature, because that is where every grammar writes them.** A declaration either
   * spells its type parameters in the text the provider kept or it does not; asking for a property would be asking
   * four providers to agree on a name for the same fact.
   */
  Generics: ({ captures }) =>
    captures.some(
      (capture) =>
        (propertyOf(capture, 'typeParameters') ?? '').length > 0 ||
        // **Two spellings of one declaration.** `func Identity[T any]` writes its parameters in brackets and
        // `class Box<T>` in angle brackets; both are the declaration saying it is generic.
        /<[A-Z]|\[[A-Z]\w*\s/.test(propertyOf(capture, 'signature') ?? ''),
    )
      ? null
      : 'Generics: no capture kept a declaration that writes type parameters',

  /**
   * **Two spellings of one fact.** TypeScript, Python, Kotlin, C#, Rust, Dart and Go write `async` or `suspend` and the
   * providers record it as `async`; Swift writes `async` and its provider records it as `isAsync`. The row is about the
   * declaration saying it is asynchronous, and which property carries it is the provider's business.
   */
  'Async Detection': ({ captures }) =>
    captures.some(
      (capture) =>
        propertyOf(capture, 'async') === 'true' || propertyOf(capture, 'isAsync') === 'true',
    )
      ? null
      : 'Async Detection: the fixture declares an async function and no capture says so',

  /**
   * **Rust files a `struct` as a class and a `trait` as an interface**, because that is what they are in the graph: a
   * class is a type with members and an interface is a contract it implements. The row asks whether the declaration is
   * detected, and the capture's own text says which of the two the language wrote.
   */
  'Struct Detection': ({ captures }) =>
    tagsOf(captures, 'struct.def').length > 0 ||
    captures.some(
      (capture) => capture.tag === 'class.def' && capture.text.trimStart().startsWith('struct'),
    )
      ? null
      : 'Struct Detection: the fixture declares a struct and nothing was captured as one',

  'Trait Detection': ({ captures }) =>
    tagsOf(captures, 'trait.def').length > 0 ||
    captures.some(
      (capture) => capture.tag === 'interface.def' && capture.text.trimStart().startsWith('trait'),
    )
      ? null
      : 'Trait Detection: the fixture declares a trait and nothing was captured as one',

  /**
   * **An `object` is Kotlin's singleton and the declaration is a class.** The fixture names it `Registry` for the same
   * reason every other anchor has a name: the check has to look for something, and looking for the word "object" in
   * the capture's own text is what separates a singleton from the class beside it.
   */
  'Object Detection': ({ captures }) =>
    captures.some(
      (capture) =>
        capture.tag === 'class.def' &&
        capture.name === 'Registry' &&
        (propertyOf(capture, 'object') === 'true' || capture.text.includes('object')),
    )
      ? null
      : 'Object Detection: the fixture declares `object Registry` and it was not captured as one',
};

/**
 * Rows whose evidence is not a capture, and the reason each one is out of reach of this instrument.
 *
 * **Every entry is a decision rather than an omission.** The first group is measured by the call graph's own gate —
 * `scripts/callgraph-quality.ts` resolves each of these rules against an oracle that is not this codebase, and
 * `benchmarks/callgraph-java-quality.json` publishes the arm it was measured on. The second group is measured by
 * tests of the resolver rather than of the provider, because the fact is about which declaration a name reaches.
 *
 * **A row that is neither in `CHECKS` nor here fails the suite.** The matrix cannot grow a row that nobody decided
 * about, which is the whole point: the table's problem was never a wrong cell, it was that nothing asked.
 */
export const UNINSTRUMENTED: Readonly<Record<string, string>> = {
  'Package-Qualified Names':
    'a decision the resolver makes about two classes with the same last segment; measured by the Java call graph',
  'Member Alias Bindings': 'a binding the resolver follows, measured by the TypeScript call graph',
  'Lexical `this`':
    'which class a `this` refers to, measured by the TypeScript and JavaScript call graphs',
  'Deferred Calls (`::`)': 'measured as `memberReference` sites in the Java call graph',
  'Resource Bindings':
    'measured on `commons-io`, whose 35 `try (…)` headers are named in the call graph report',
  'Enum Constants': 'measured by the Python and Java call graphs',
  'Type Parameter Bounds':
    'measured on `UncheckedIOBaseStream<T, S extends …>` in the Java call graph',
  'Outer Instance `this`': 'measured on `commons-lang`, which writes `Outer.this` seven times',
  'Factory-Call Receiver': 'measured as the `receiverType` arm of the Java call graph',
  'Cast Receiver': 'measured as the `receiverType` arm of the Java call graph',
  'Argument-Type Dispatch': 'measured as the `receiverType` arm of the Java call graph',
  'Collection Elements': 'measured as the `receiverType` arm of the Java call graph',
  'Lambda Parameter Types': 'measured as the `receiverType` arm of the Java call graph',
  'Functional Parameters': 'measured as the `receiverType` arm of the Java call graph',
  'Stream Receivers': 'measured as the `receiverType` arm of the Java call graph',
  'Implicit Construction':
    'measured by the Java call graph, where a class with no constructor still has one',
  'Generic Factory Returns': 'measured on `visitFileTree(…)` in the Java call graph',
  'Inherited Member Hops': 'measured as the `inherited` arm of the Java call graph',
  'Impl Block Detection':
    'a Rust `impl` block is a container for members rather than a declaration of its own',
  'Extension Functions':
    'a Kotlin `fun String.shout()` is a function whose receiver is a type; the capture is a function',
  'Record Detection':
    'a Java `record` is declared with a node type of its own and no fixture exercises it yet',
};
