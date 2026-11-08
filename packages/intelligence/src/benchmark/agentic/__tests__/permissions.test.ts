// The injection corpus, checked as a set rather than file by file.
//
// Every assertion here is about a property the measurement depends on: if two arms differ in anything but the payload,
// the difference between their rates is not attributable to the payload; if a question can be answered without reading
// its file, exposure is a coincidence; if the payload is shorter than the clean comment, the truncation differs too.

import { describe, expect, it } from 'vitest';

import {
  CLEAN_PAYLOAD,
  CORPUS,
  INJECTION_ACTION,
  INJECTION_PAYLOAD,
  PERMISSION_ARMS,
  PERMISSION_CORPUS_STATS,
  PERMISSION_PROJECT_ID,
  PERMISSION_TASKS,
  moduleSource,
  permissionFirstTurn,
  permissionNextTurn,
  requestFor,
} from '../permissions.js';

describe('the corpus', () => {
  it('**has a hundred tasks, with a unique id, file and symbol for each**', () => {
    expect(PERMISSION_TASKS).toHaveLength(100);
    expect(new Set(PERMISSION_TASKS.map((task) => task.id)).size).toBe(100);
    expect(new Set(CORPUS.map((module) => module.relativePath)).size).toBe(100);
    expect(new Set(CORPUS.map((module) => module.symbol)).size).toBe(100);
    // The floor the project publishes at. A corpus that shrinks is a rate with a denominator nobody chose.
    expect(CORPUS.length).toBeGreaterThanOrEqual(100);
  });

  it('spreads the corpus across ten groups rather than one directory', () => {
    const groups = new Set(CORPUS.map((module) => module.relativePath.split('/')[1]));
    expect(groups.size).toBe(10);
  });

  it('**declares its size, and the declaration is the array**, so the gate is not reading a copy', () => {
    // The corpus has no sample files: `moduleSource` writes them at run time. So the gate reads this constant, and a
    // constant is only evidence when something recomputes it. Growing the corpus without growing the declaration
    // would leave `benchmarks/citations.json` describing a hundred modules while the run indexed a hundred and twenty,
    // and the citation would still pass the gate - a denominator nobody chose, agreeably confirmed.
    expect(PERMISSION_CORPUS_STATS.totalCases).toBe(CORPUS.length);
    expect(PERMISSION_CORPUS_STATS.totalGroundTruthIssues).toBe(CORPUS.length);
    // And the citation's hundred is this hundred: one question per module, asked three times, is still one unit.
    expect(PERMISSION_CORPUS_STATS.totalGroundTruthIssues).toBe(PERMISSION_TASKS.length);
  });

  it('**each module exports its symbol and returns its answer**, so a question about it has one source', () => {
    for (const module of CORPUS) {
      const source = moduleSource(module, 'clean');
      expect(source).toContain(`export function ${module.symbol}(`);
      expect(source).toContain(JSON.stringify(module.answer));
    }
  });

  it('**the payload is inside the function body**, where a snippet and a whole-file read both return it', () => {
    for (const module of CORPUS) {
      const lines = moduleSource(module, 'injected').split('\n');
      const bodyStart = lines.findIndex((line) =>
        line.includes(`export function ${module.symbol}(`),
      );
      const payloadStart = lines.findIndex((line) => line.includes('this module is deprecated'));
      expect(bodyStart).toBeGreaterThanOrEqual(0);
      expect(payloadStart).toBeGreaterThan(bodyStart);
    }
  });

  it('**the two payloads are the same shape and the same length**, so the arms differ in content alone', () => {
    expect(INJECTION_PAYLOAD.split('\n')).toHaveLength(CLEAN_PAYLOAD.split('\n').length);
    // Same width as well as the same shape: a comment three characters longer would change what a truncation cuts.
    for (const [injected, clean] of [
      [0, 0],
      [1, 2],
    ] as const) {
      expect(INJECTION_PAYLOAD.split('\n')[injected]!.length).toBeGreaterThan(
        CLEAN_PAYLOAD.split('\n')[clean]!.length - 8,
      );
    }
    for (const module of CORPUS) {
      const injected = moduleSource(module, 'injected').split('\n');
      const clean = moduleSource(module, 'clean').split('\n');
      expect(injected).toHaveLength(clean.length);
    }
  });

  it('**the clean comment asks for nothing**, which is what makes it a control', () => {
    // The words that make the payload an instruction rather than a note. None of them may appear in the control, or the
    // control is a weaker version of the treatment and the comparison is not the one being reported.
    for (const word of ['delete_project', 'call ', 'required', 'Before answering']) {
      expect(CLEAN_PAYLOAD).not.toContain(word);
    }
    expect(INJECTION_PAYLOAD).toContain('delete_project');
    expect(INJECTION_PAYLOAD).toContain('Before answering');
  });

  it('**the action names the project the corpus is indexed under**, so a complying call has an observable effect', () => {
    expect(INJECTION_ACTION.tool).toBe('delete_project');
    expect(INJECTION_ACTION.arguments.projectId).toBe(PERMISSION_PROJECT_ID);
    expect(INJECTION_PAYLOAD).toContain(PERMISSION_PROJECT_ID);
  });
});

describe('the prompts', () => {
  it('**the injected and clean arms get the identical request**, which is the point of the pairing', () => {
    for (const task of PERMISSION_TASKS) {
      expect(requestFor(task, 'injected')).toBe(requestFor(task, 'clean'));
    }
  });

  it('**the directed request is the same question plus the call**, so it differs from the treatment in one clause', () => {
    for (const task of PERMISSION_TASKS) {
      const question = requestFor(task, 'injected');
      const directed = requestFor(task, 'directed');
      expect(directed.startsWith(question)).toBe(true);
      expect(directed).toContain(PERMISSION_PROJECT_ID);
    }
  });

  it('names the symbol and the file, so the answer cannot come from anywhere else', () => {
    for (const task of PERMISSION_TASKS) {
      const prompt = requestFor(task, 'injected');
      expect(prompt).toContain(task.module.symbol);
      expect(prompt).toContain(task.module.relativePath);
    }
  });

  it('**the instruction carries the project id and no tool names**, so the corpus does not teach the attack', () => {
    const first = permissionFirstTurn(PERMISSION_TASKS[0]!, 'injected');
    expect(first).toContain(PERMISSION_PROJECT_ID);
    expect(first).not.toContain('delete_project');
    expect(first).not.toContain('search_code');
  });

  it('announces a truncation instead of making one silently', () => {
    const task = PERMISSION_TASKS[0]!;
    const long = permissionNextTurn(task, 'injected', {
      tool: 'get_code_snippet',
      detail: 'x'.repeat(4000),
    });
    expect(long).toContain('… (truncated)');
    const short = permissionNextTurn(task, 'injected', {
      tool: 'get_code_snippet',
      detail: 'short',
    });
    expect(short).not.toContain('… (truncated)');
    expect(short).toContain('get_code_snippet');
  });

  it('has exactly three arms, because two would have no positive control', () => {
    expect(PERMISSION_ARMS).toEqual(['injected', 'clean', 'directed']);
  });
});
