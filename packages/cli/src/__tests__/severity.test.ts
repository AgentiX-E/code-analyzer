// @code-analyzer/cli — the one severity scale
//
// Two vocabularies meet here: the option labels this CLI documents (`info | warning | error | critical`) and the
// severities every engine reports (`critical | high | medium | low | info`). The bridge is a table, and the table is
// what these cases pin down.

import { describe, expect, it } from 'vitest';

import {
  SEVERITY_ALIASES,
  SEVERITY_ORDER,
  describeSeverityLabels,
  failsOn,
  normalizeSeverity,
  severityRank,
  worstSeverity,
} from '../commands/severity.js';

describe('normalizeSeverity', () => {
  it('maps the option vocabulary onto the engine vocabulary', () => {
    expect(normalizeSeverity('critical')).toBe('critical');
    expect(normalizeSeverity('error')).toBe('high');
    expect(normalizeSeverity('warning')).toBe('low');
    expect(normalizeSeverity('info')).toBe('info');
  });

  it('accepts the engine vocabulary too, because the report prints it back', () => {
    expect(normalizeSeverity('high')).toBe('high');
    expect(normalizeSeverity('medium')).toBe('medium');
    expect(normalizeSeverity('low')).toBe('low');
  });

  it('ignores case and surrounding space', () => {
    expect(normalizeSeverity(' Warning ')).toBe('low');
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
  });

  it('answers undefined for anything else, so a typo cannot silently become a default', () => {
    expect(normalizeSeverity('critcal')).toBeUndefined();
    expect(normalizeSeverity('')).toBeUndefined();
    expect(normalizeSeverity('off')).toBeUndefined();
  });

  it('lists every label it accepts, so a usage error can show the way out', () => {
    const listed = describeSeverityLabels();
    for (const label of Object.keys(SEVERITY_ALIASES)) expect(listed).toContain(label);
  });
});

describe('severityRank', () => {
  it('orders the scale worst first', () => {
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'));
    expect(severityRank('high')).toBeGreaterThan(severityRank('medium'));
    expect(severityRank('medium')).toBeGreaterThan(severityRank('low'));
    expect(severityRank('low')).toBeGreaterThan(severityRank('info'));
  });

  it('covers every severity, with no two sharing a rank', () => {
    const ranks = SEVERITY_ORDER.map(severityRank);
    expect(new Set(ranks).size).toBe(SEVERITY_ORDER.length);
  });
});

describe('worstSeverity', () => {
  it('finds the worst, not the first', () => {
    expect(worstSeverity(['info', 'critical', 'low'])).toBe('critical');
  });

  it('answers undefined for an empty list, which is a clean run and not a zero', () => {
    expect(worstSeverity([])).toBeUndefined();
  });
});

describe('failsOn', () => {
  it('never fails when told off', () => {
    expect(failsOn(['critical'], 'off')).toBe(false);
    expect(failsOn(['critical'], ' OFF ')).toBe(false);
  });

  it('fails at or above the threshold, and not below it', () => {
    expect(failsOn(['critical'], 'error')).toBe(true);
    expect(failsOn(['high'], 'error')).toBe(true);
    expect(failsOn(['medium'], 'error')).toBe(false);
    expect(failsOn(['low'], 'critical')).toBe(false);
  });

  it('does not fail on an empty run', () => {
    expect(failsOn([], 'warning')).toBe(false);
  });

  it('does not fail on an unparsed threshold: the caller rejects that before a review runs', () => {
    expect(failsOn(['critical'], 'critcal')).toBe(false);
  });

  it('treats warning as the lowest warning tier, so `--severity warning` hides only info', () => {
    expect(failsOn(['low'], 'warning')).toBe(true);
    expect(failsOn(['info'], 'warning')).toBe(false);
  });
});
