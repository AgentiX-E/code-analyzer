// @code-analyzer — a registration is a sentence with a rule behind it, and both halves have to name the same thing
//
// **Why this file exists.** `mechanismRule` was added because the comparison script used to check every registration
// against one hardcoded rule - "precision rose and recall did not fall by more than a golden" - while R-17 registered a
// different one. On its confirmation those two disagreed: precision rose 0.0937, recall fell 0.0414, **the registered
// mechanism held and the hardcoded one did not**, and the artifact said `mechanismMet: false` about a registration whose
// own words described what happened. **A verdict field that tests a different rule from the one it is filed under is
// worse than no field, because it is the field a reader trusts.**
//
// **So the table is walked rather than sampled.** The existing tests name `emissionProfile` and `languageChecklist`
// because those were the registrations that existed when they were written; a third registration that spelled its
// mechanism wrong, or promised a confirmation slice the job cannot finish, would have failed only after its money was
// spent. **The assertions below hold for every entry, including the ones added after this file.**

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_CEILING_FRACTION,
  MEASURED_MINUTES_PER_PULL_REQUEST,
  MECHANISMS,
  REGISTRATIONS,
} from '../../../.github/scripts/aacr-ablation-compare.mjs';

const WORKFLOW = readFileSync(
  resolve(import.meta.dirname, '../../../.github/workflows/aacr-bench.yml'),
  'utf8',
);

const CEILING_MINUTES = (() => {
  const match = /timeout-minutes:\s*(\d+)/.exec(WORKFLOW);
  expect(match, 'the benchmark job must declare a timeout').not.toBeNull();
  return Number(match?.[1]);
})();

const entries = Object.entries(REGISTRATIONS);

describe('every registration names a mechanism the comparison can test', () => {
  it('points at a rule in the mechanism table rather than at a sentence', () => {
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const [field, registration] of entries) {
      expect(
        Object.keys(MECHANISMS),
        `${field} names mechanismRule "${String(registration.mechanismRule)}", which no predicate implements`,
      ).toContain(registration.mechanismRule);
    }
  });

  it('states a gain, and states the same number in the sentence a reader quotes', () => {
    // **A claim that says "at least 0.04" beside a field of 0.02 is a registration two readers will quote differently**,
    // and the artifact reports the field. The number in the prose is therefore checked against the field rather than
    // trusted to have been edited together with it.
    for (const [field, registration] of entries) {
      expect(registration.registeredGain, `${field} registers no gain`).toBeGreaterThan(0);
      expect(
        registration.claim,
        `${field}'s claim does not mention its registered gain of ${String(registration.registeredGain)}`,
      ).toContain(String(registration.registeredGain));
    }
  });

  it('keeps every confirmation slice inside the half-ceiling rule', () => {
    for (const [field, registration] of entries) {
      for (const slice of registration.confirmation) {
        const minutes = slice.max * MEASURED_MINUTES_PER_PULL_REQUEST;
        expect(
          minutes,
          `${field}'s slice of ${String(slice.max)} needs ${minutes.toFixed(1)} of ${String(CEILING_MINUTES)} minutes`,
        ).toBeLessThanOrEqual(CEILING_MINUTES * CONFIRMATION_CEILING_FRACTION);
        // **And a confirmation must start after row zero.** This is the weak form of the rule on purpose: each
        // registration's discovery was a different size - the code window's was the first fourteen pull requests and the
        // category floor's the first fifty - and a table that asserted one number here would be asserting a fact about
        // the smallest discovery for all of them. **The registration that needs the strong form asserts it itself**
        // (`R-21`'s rules came from the first fifty rows, and its test says so).
        expect(slice.skip, `${field}'s confirmation reads the discovery rows`).toBeGreaterThan(0);
      }
    }
  });
});

describe('R-21, the idiom lane', () => {
  it('is registered as a recall device, which is the mechanism a lane that adds remarks has', () => {
    // **`recall-rises` rather than a precision rule, and the choice is what stops a flooding lane from passing.** A
    // lane that fired on everything would raise recall and lose precision, and only this rule makes the loss part of
    // the verdict rather than a footnote.
    const registration = REGISTRATIONS.idioms;
    expect(registration.section).toBe('§47 (R-21)');
    expect(registration.mechanismRule).toBe('recall-rises');
    expect(registration.arm).toBe('file');
  });

  it('is priced on rows whose goldens did not choose its rules', () => {
    // **Six rules were derived by reading fifty goldens from the first fifty pull requests.** Pricing them on those rows
    // would measure the search rather than the lane, so the confirmation slice starts where the sample ended.
    expect(REGISTRATIONS.idioms.confirmation).toEqual([{ skip: 50, max: 100 }]);
  });

  it('asks for a gain the instrument can resolve', () => {
    // **The published resolution at 452 goldens is 1.94 points** (§45.6), so a registration below that is a claim no
    // run of this corpus can settle either way - and a `falsified` verdict would then be noise reported as evidence.
    expect(REGISTRATIONS.idioms.registeredGain).toBeGreaterThanOrEqual(0.02);
  });
});
