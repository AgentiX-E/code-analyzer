// @code-analyzer/shared — Phase Logger Tests
// Exercises the structured pipeline logger and its no-op variant.

import { describe, it, expect } from 'vitest';
import { createPhaseLogger, createNoopPhaseLogger } from '../logging/phase-logger.js';
import type { PhaseLogEntry, PhaseLogContext } from '../logging/phase-logger.js';

const baseContext: PhaseLogContext = { phaseId: 'parse' };

describe('createPhaseLogger', () => {
  it('emits an error entry with the Error object attached', () => {
    const entries: PhaseLogEntry[] = [];
    const logger = createPhaseLogger((e) => entries.push(e), 'parse');
    const err = new Error('boom');

    logger.error('failed to parse', err, baseContext);

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('[parse] failed to parse');
    expect(entry.context).toBe(baseContext);
    expect(entry.error).toBe(err);
    expect(typeof entry.timestamp).toBe('number');
  });

  it('emits warn/info/debug/trace without an error field', () => {
    const entries: PhaseLogEntry[] = [];
    const logger = createPhaseLogger((e) => entries.push(e), 'analyze');

    logger.warn('skipped', baseContext);
    logger.info('started', { phaseId: 'analyze', filePath: 'a.ts' });
    logger.debug('detail', { phaseId: 'analyze', durationMs: 12 });
    logger.trace('verbose', { phaseId: 'analyze', extra: { n: 1 } });

    expect(entries.map((e) => e.level)).toEqual(['warn', 'info', 'debug', 'trace']);
    for (const entry of entries) {
      expect(entry.error).toBeUndefined();
      expect(entry.message.startsWith('[analyze] ')).toBe(true);
    }
  });

  it('preserves optional context fields verbatim', () => {
    const entries: PhaseLogEntry[] = [];
    const logger = createPhaseLogger((e) => entries.push(e), 'x');
    const ctx: PhaseLogContext = {
      phaseId: 'lint',
      filePath: 'src/a.ts',
      durationMs: 42,
      extra: { rule: 'no-eval' },
    };

    logger.info('done', ctx);

    expect(entries[0]!.context).toEqual(ctx);
  });
});

describe('createNoopPhaseLogger', () => {
  it('returns a logger whose methods never throw and never emit', () => {
    const logger = createNoopPhaseLogger();
    const err = new Error('ignored');

    expect(() => {
      logger.error('e', err, baseContext);
      logger.warn('w', baseContext);
      logger.info('i', baseContext);
      logger.debug('d', baseContext);
      logger.trace('t', baseContext);
    }).not.toThrow();
  });
});
