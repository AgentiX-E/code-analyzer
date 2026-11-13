// The selector rules, stated as cases, because the defect they replace was a rule nobody had written down.

import { describe, expect, it } from 'vitest';

import { repoSelectorMatches, resolveRepoScope } from '../../cross-repo/search-scope.js';

describe('repoSelectorMatches — three shapes, one repository', () => {
  it('matches the project id the indexer produces', () => {
    expect(repoSelectorMatches('pallets/flask', 'pallets/flask')).toBe(true);
  });

  it('matches the repository name alone, which is what a user types', () => {
    expect(repoSelectorMatches('flask', 'pallets/flask')).toBe(true);
  });

  it('matches regardless of case, because GitHub resolves repository names that way', () => {
    expect(repoSelectorMatches('Flask', 'pallets/flask')).toBe(true);
    expect(repoSelectorMatches('PALLETS/FLASK', 'pallets/flask')).toBe(true);
  });

  it('does not match a prefix, so a typo selects nothing instead of something else', () => {
    expect(repoSelectorMatches('flas', 'pallets/flask')).toBe(false);
    expect(repoSelectorMatches('pallets', 'pallets/flask')).toBe(false);
  });

  it('does not match an empty selector or an empty project id', () => {
    expect(repoSelectorMatches('', 'pallets/flask')).toBe(false);
    expect(repoSelectorMatches('   ', 'pallets/flask')).toBe(false);
    expect(repoSelectorMatches('flask', '')).toBe(false);
    expect(repoSelectorMatches('', '')).toBe(false);
  });

  it('does not match a bare name against a repository whose name differs', () => {
    expect(repoSelectorMatches('werkzeug', 'pallets/flask')).toBe(false);
  });
});

describe('resolveRepoScope — what was selected, and what named nothing', () => {
  const candidates = ['pallets/flask', 'expressjs/express', 'google/gson'];

  it('selects by name part and by project id in the same call', () => {
    const scope = resolveRepoScope(['flask', 'expressjs/express'], candidates);
    expect([...scope.selected].sort()).toEqual(['expressjs/express', 'pallets/flask']);
    expect(scope.unmatched).toEqual([]);
  });

  it('reports a selector that matched none of the candidates', () => {
    const scope = resolveRepoScope(['flask', 'django'], candidates);
    expect([...scope.selected]).toEqual(['pallets/flask']);
    expect(scope.unmatched).toEqual(['django']);
  });

  it('reports nothing unmatched when there were no candidates to match against', () => {
    // A query with no hits cannot say which selector was at fault, and naming one would be a guess presented as a
    // measurement.
    const scope = resolveRepoScope(['django'], []);
    expect([...scope.selected]).toEqual([]);
    expect(scope.unmatched).toEqual([]);
  });

  it('treats no selector as no selection rather than as a selection of everything', () => {
    const scope = resolveRepoScope([], candidates);
    expect(scope.selected.size).toBe(0);
    expect(scope.unmatched).toEqual([]);
  });

  it('selects every repository a duplicated name appears under, and says so by selecting both ids', () => {
    const scope = resolveRepoScope(['utils'], ['a/utils', 'b/utils']);
    expect([...scope.selected].sort()).toEqual(['a/utils', 'b/utils']);
  });
});
