import { describe, expect, it } from 'vitest';

import { DartProvider } from '../languages/dart.js';
import { ElixirProvider } from '../languages/elixir.js';
import { LuaProvider } from '../languages/lua.js';
import { RustProvider } from '../languages/rust.js';
import { ScalaProvider } from '../languages/scala.js';
import { SwiftProvider } from '../languages/swift.js';
import { ZigProvider } from '../languages/zig.js';

import type { LanguageProvider } from '../languages/provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const callsOf = (provider: LanguageProvider, source: string, file: string): UnifiedCapture[] =>
  provider.parse(source, file).filter((capture) => /call$/.test(capture.tag));

const summary = (captures: readonly UnifiedCapture[]): string[] =>
  captures.map((capture) => `${capture.tag}:${capture.name}`);

/**
 * Seven languages claimed `Function Calls` and emitted no call site at all.
 *
 * **The defect is the one iteration 85 found in Kotlin, six more times.** A tree-sitter provider that replaces
 * `walkAndCapture` handles the declaration nodes it knows about and recurses; a `call_expression` is not one of them,
 * so `helper(x)` was parsed, matched nothing and was dropped — and because no walk ever emitted a call, the base
 * class's call machinery was dead code for those languages rather than a missing arm in a walk.
 *
 * Three of the seven read text rather than a tree and had no call machinery to reach at all, which is why the scanner
 * they share is tested on its own in `regex-calls.test.ts` and only its product is asserted here.
 */
describe('a call site in a language whose walk had no arm for one', () => {
  it('records a Rust call, a method call and a path call', () => {
    const calls = callsOf(
      new RustProvider(),
      'fn a() { helper(x); self.draw(); std::mem::drop(y); }',
      'a.rs',
    );
    expect(summary(calls)).toEqual([
      'function.call:helper',
      'method.call:draw',
      'function.call:drop',
    ]);
  });

  it('records a Swift call, a method call and a call on a factory result', () => {
    const calls = callsOf(
      new SwiftProvider(),
      'func a() { helper(x); self.draw(); builder().build() }',
      'a.swift',
    );
    expect(summary(calls)).toEqual([
      'function.call:helper',
      'method.call:draw',
      'method.call:build',
      'function.call:builder',
    ]);
  });

  it('records a Scala call and a method call', () => {
    const calls = callsOf(
      new ScalaProvider(),
      'object A { def a(): Unit = { helper(x); this.draw() } }',
      'a.scala',
    );
    expect(summary(calls)).toEqual(['function.call:helper', 'method.call:draw']);
  });

  it('records an Elixir call and a remote call, and not the definition it is written in', () => {
    const calls = callsOf(
      new ElixirProvider(),
      'defmodule A do\n  def a do\n    helper(x)\n    Enum.map(list, fn y -> y end)\n  end\nend',
      'a.ex',
    );
    // **`def a do` is a call node too**, because a macro is a function; the definition it introduces is not a call.
    expect(summary(calls)).toEqual(['function.call:helper', 'method.call:map']);
  });

  it('records a Zig call and a Dart call, which are read from text', () => {
    expect(summary(callsOf(new ZigProvider(), 'fn a() void { helper(x); }', 'a.zig'))).toEqual([
      'function.call:helper',
    ]);
    expect(summary(callsOf(new DartProvider(), 'void a() { helper(x); }', 'a.dart'))).toEqual([
      'function.call:helper',
    ]);
  });

  it('records a Lua call and a method call', () => {
    const calls = callsOf(
      new LuaProvider(),
      'local Widget = {}\nfunction Widget.draw(self)\n  return helper(self.label)\nend',
      'a.lua',
    );
    expect(summary(calls)).toEqual(['function.call:helper']);
  });
});

describe('what the call-site arms read off the call', () => {
  it('counts the arguments a Rust call passes', () => {
    const [call] = callsOf(new RustProvider(), 'fn a() { helper(x, y); }', 'a.rs');
    expect(call!.properties).toMatchObject({ argumentCount: '2' });
  });

  it('counts a Swift call through its call suffix', () => {
    const [call] = callsOf(new SwiftProvider(), 'func a() { helper(x, y) }', 'a.swift');
    expect(call!.properties).toMatchObject({ argumentCount: '2' });
  });

  it('counts a Lua call through its argument list', () => {
    const [call] = callsOf(new LuaProvider(), 'helper(a, b, c)', 'a.lua');
    expect(call!.properties).toMatchObject({ argumentCount: '3' });
  });

  it('files a Rust path call as a call to its last segment', () => {
    const [call] = callsOf(new RustProvider(), 'fn a() { std::mem::drop(y); }', 'a.rs');
    expect(call!.name).toBe('drop');
  });

  it('writes the receiver as the callee text rather than into the name', () => {
    const [call] = callsOf(new RustProvider(), 'fn a() { self.draw(); }', 'a.rs');
    expect(call!.text).toBe('self.draw');
    expect(call!.name).toBe('draw');
  });
});
