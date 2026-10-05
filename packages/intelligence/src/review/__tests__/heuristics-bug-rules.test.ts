// The bug rules, tested for both halves: that they fire on the bug, and that they are silent on the idiom.
//
// **Why the second half is the one that matters.** The engine's precision on real code is 0.1483 - it talks too
// much - so a rule that also fires on ordinary code makes the product worse while looking like progress. Every rule
// below is paired with the nearest correct form of the same construct, and the silence is asserted as hard as the
// firing.
//
// **Why these rules are syntax-only.** They are decidable from one construct with no dataflow, no types and no
// cross-file knowledge. That is the only kind of bug rule a line-based engine can carry without becoming noise, and
// it is why the list is three rather than thirty.
//
// **And what the numbers were before they existed**, so the tests have a baseline rather than a mood: on a hundred
// real issues from public bug-fix commits the engine produced 688 findings of which 15 were `bug`, and the F1 under
// the overlap criterion was 0.2173.

import { describe, expect, it } from 'vitest';

import {
  checkAssignmentInCondition,
  checkAsyncInSynchronousCallback,
  checkSilentCatch,
} from '../heuristics-bug-rules.js';

const lines = (text: string) => text.split('\n');

describe('checkSilentCatch', () => {
  it('fires on an empty catch, one line and several', () => {
    const one = checkSilentCatch(lines('try { risky(); } catch (e) {}'));
    const many = checkSilentCatch(lines(['try {', '  risky();', '} catch (e) {', '}', ''].join('\n')));
    expect(one).toHaveLength(1);
    expect(one[0]!.category).toBe('bug');
    expect(one[0]!.severity).toBe('medium');
    expect(many).toHaveLength(1);
  });

  it('fires on a catch whose body is only a comment, because a comment is not a handler', () => {
    const found = checkSilentCatch(lines(['try {', '  risky();', '} catch (e) {', '  // ignore', '}', ''].join('\n')));
    expect(found).toHaveLength(1);
    expect(found[0]!.description).toContain('comment is not a handler');
  });

  it('is silent when the handler does anything at all', () => {
    const rethrow = checkSilentCatch(lines('try { risky(); } catch (e) { throw e; }'));
    const log = checkSilentCatch(lines(['try {', '  risky();', '} catch (e) {', '  logger.warn(e);', '}', ''].join('\n')));
    const annotate = checkSilentCatch(lines(['try {', '  risky();', '} catch (e) {', '  e.message += " (in load)";', '  throw e;', '}', ''].join('\n')));
    const fallback = checkSilentCatch(lines(['try {', '  risky();', '} catch {', '  return defaultValue;', '}', ''].join('\n')));
    expect(rethrow).toHaveLength(0);
    expect(log).toHaveLength(0);
    expect(annotate).toHaveLength(0);
    expect(fallback).toHaveLength(0);
  });

  it('is silent on a try with no catch, and on the word appearing in code', () => {
    expect(checkSilentCatch(lines(['try {', '  risky();', '} finally {', '  cleanup();', '}'].join('\n')))).toHaveLength(0);
    expect(checkSilentCatch(lines('const message = "catch (e) {}";'))).toHaveLength(0);
  });
});

describe('checkAssignmentInCondition', () => {
  it('fires on an assignment where a comparison was meant', () => {
    const found = checkAssignmentInCondition(lines('if (status = STATUS.READY) {'));
    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe('bug');
    expect(found[0]!.severity).toBe('high');
    const whileForm = checkAssignmentInCondition(lines('while (remaining = next()) {'));
    expect(whileForm).toHaveLength(1);
  });

  it('is silent on every comparison operator', () => {
    for (const form of [
      'if (a === b) {',
      'if (a !== b) {',
      'if (a <= b) {',
      'if (a >= b) {',
      'if (a == b) {',
      'if (a != b) {',
      'items.filter((x) => x > 0);',
    ]) {
      expect(checkAssignmentInCondition(lines(form)), form).toHaveLength(0);
    }
  });

  it('is silent on the deliberate form that assigns inside its own parentheses and tests the result', () => {
    // The idiom the rule exists to not flag: a reader knows this is an assignment because it is wrapped.
    expect(checkAssignmentInCondition(lines('while ((line = reader.readLine()) !== null) {'))).toHaveLength(0);
    expect(checkAssignmentInCondition(lines('if ((m = re.exec(s)) !== null) {'))).toHaveLength(0);
  });
});

describe('checkAsyncInSynchronousCallback', () => {
  it('fires on an async callback handed to a synchronous array method', () => {
    for (const form of [
      'items.forEach(async (item) => {',
      'const out = items.map(async (item) => {',
      'items.filter(async (item) => {',
      'items.reduce(async (acc, item) => {',
    ]) {
      const found = checkAsyncInSynchronousCallback(lines(form));
      expect(found, form).toHaveLength(1);
      expect(found[0]!.severity).toBe('high');
    }
  });

  it('is silent when the promise is collected, which is the correct form', () => {
    const wrapped = checkAsyncInSynchronousCallback(lines('await Promise.all(items.map(async (item) => handle(item)));'));
    const settled = checkAsyncInSynchronousCallback(lines('await Promise.allSettled(items.map(async (item) => handle(item)));'));
    expect(wrapped).toHaveLength(0);
    expect(settled).toHaveLength(0);
  });

  it('is silent on the synchronous callback and on the sequential loop', () => {
    expect(checkAsyncInSynchronousCallback(lines('items.forEach((item) => handle(item));'))).toHaveLength(0);
    expect(checkAsyncInSynchronousCallback(lines(['for (const item of items) {', '  await handle(item);', '}'].join('\n')))).toHaveLength(0);
  });
});

describe('all three, as the engine runs them', () => {
  it('produces only bug-category findings with a real range', () => {
    const found = [
      ...checkSilentCatch(lines(['try {', '  risky();', '} catch (e) {', '}', ''].join('\n'))),
      ...checkAssignmentInCondition(lines('if (x = y) {')),
      ...checkAsyncInSynchronousCallback(lines('items.forEach(async (i) => {')),
    ];
    expect(found).toHaveLength(3);
    for (const r of found) {
      expect(r.category).toBe('bug');
      expect(r.triggered).toBe(true);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.startLine).toBeGreaterThanOrEqual(1);
      expect(r.endLine).toBeGreaterThanOrEqual(r.startLine);
    }
  });
});
