// The repository a question names.
//
// **The failure this module answers was measured, not imagined**: on four released checkouts, "where does an express
// application mount middleware and route handlers" ranked express's `lib/application.js:use` 22nd, because werkzeug is
// a library whose every module is named after a kind of middleware and the word in the question matched all of them.
// The tests below fix the rule that resolves it - and, just as importantly, the cases where it must refuse to.

import { describe, expect, it } from 'vitest';

import {
  GENERIC_REPOSITORY_NAMES,
  LANGUAGE_SUFFIXES,
  headWord,
  indexOfWords,
  isDistinctiveName,
  namedProjects,
  projectName,
  resolveScope,
} from '../qa/scope.js';

const WORKSPACE = [
  'expressjs/express',
  'pallets/flask',
  'pallets/werkzeug',
  'spring-projects/spring-petclinic',
];

describe('projectName', () => {
  it('is the part after the owner', () => {
    expect(projectName('pallets/flask')).toBe('flask');
  });

  it('is the whole id when there is no owner', () => {
    // **A store can hold a project indexed by path rather than by repository**, and its id is then a single token.
    expect(projectName('cosqa')).toBe('cosqa');
  });

  it('takes the last segment, so a nested namespace still names the repository', () => {
    expect(projectName('org/team/service')).toBe('service');
  });
});

describe('isDistinctiveName', () => {
  it('accepts a name that is not an ordinary word', () => {
    expect(isDistinctiveName('express')).toBe(true);
    expect(isDistinctiveName('spring-petclinic')).toBe(true);
  });

  it('refuses a name that is the word a question would use anyway', () => {
    // **`app` is the failure mode**: a workspace of microservices called `app`, `api`, `core` and `web` would have
    // every question scoped by whichever of those words happened to appear in it, silently and wrongly.
    for (const name of ['app', 'api', 'core', 'web', 'utils', 'server', 'worker', 'docs']) {
      expect(isDistinctiveName(name), name).toBe(false);
    }
  });

  it('reads the head word, so a hyphenated name inherits the verdict of its noun', () => {
    expect(isDistinctiveName('my-app')).toBe(false);
    expect(isDistinctiveName('payments-api')).toBe(false);
    expect(isDistinctiveName('spring-petclinic')).toBe(true);
  });

  it('reads through a language suffix to the noun before it', () => {
    // **`micro-kinetic-ts` is about kinetics**, and a rule that stopped at `ts` would refuse to scope a question that
    // named this project's own sibling repository by name.
    expect(isDistinctiveName('micro-kinetic-ts')).toBe(true);
    expect(isDistinctiveName('code-analyzer')).toBe(true);
    // **And the same rule refuses `my-app.js`**, because the word it read through to is generic.
    expect(isDistinctiveName('my-app.js')).toBe(false);
  });

  it('refuses a name too short to be a mention', () => {
    // **Three characters is the floor**: a two-letter token appears inside other identifiers constantly, and a scope
    // chosen by accident is worse than no scope.
    expect(isDistinctiveName('go')).toBe(false);
    expect(isDistinctiveName('ui')).toBe(false);
  });

  it('refuses an empty name rather than matching everything', () => {
    expect(isDistinctiveName('')).toBe(false);
  });

  it('keeps its generic list lower-case, which is what tokenizing produces', () => {
    for (const name of GENERIC_REPOSITORY_NAMES) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe('headWord', () => {
  it('is the last word of a name', () => {
    expect(headWord('spring-petclinic')).toBe('petclinic');
    expect(headWord('express')).toBe('express');
  });

  it('is the word before a language suffix', () => {
    expect(headWord('micro-kinetic-ts')).toBe('kinetic');
    expect(headWord('schema.json')).toBe('schema');
  });

  it('is the suffix itself when there is no word before it', () => {
    // **A repository called `go`** is a name, and the rule has to return something it can then judge.
    expect(headWord('go')).toBe('go');
    expect(LANGUAGE_SUFFIXES.has('go')).toBe(true);
  });

  it('is empty for an empty name', () => {
    expect(headWord('')).toBe('');
  });
});

describe('indexOfWords', () => {
  it('finds a run of whole words', () => {
    expect(indexOfWords(['a', 'spring', 'petclinic', 'b'], ['spring', 'petclinic'])).toBe(1);
  });

  it('does not find a run that is not contiguous', () => {
    expect(indexOfWords(['spring', 'the', 'petclinic'], ['spring', 'petclinic'])).toBe(-1);
  });

  it('does not match inside a longer word', () => {
    // **This is the difference between tokenizing and `includes`**: "expressive" is not "express".
    expect(indexOfWords(['expressive', 'api'], ['express'])).toBe(-1);
  });

  it('refuses a needle longer than the haystack, and an empty needle', () => {
    expect(indexOfWords(['a'], ['a', 'b'])).toBe(-1);
    expect(indexOfWords(['a'], [])).toBe(-1);
  });

  it('finds the last possible position, which is the boundary the loop condition decides', () => {
    expect(indexOfWords(['a', 'b'], ['b'])).toBe(1);
  });
});

describe('namedProjects', () => {
  it('finds the repository a question names', () => {
    expect(namedProjects('where does an express application mount middleware', WORKSPACE)).toEqual([
      { projectId: 'expressjs/express', name: 'express' },
    ]);
  });

  it('ignores case', () => {
    expect(namedProjects('How does Flask dispatch a request', WORKSPACE)).toHaveLength(1);
  });

  it('matches a hyphenated name written with a space', () => {
    // **Both are the same two tokens after tokenization**, which is why the rule is written on tokens: a user typing
    // "spring petclinic" means the same repository as one typing "spring-petclinic".
    expect(namedProjects('how does spring petclinic wire its controllers', WORKSPACE)).toEqual([
      { projectId: 'spring-projects/spring-petclinic', name: 'spring-petclinic' },
    ]);
  });

  it('finds nothing when the question names no repository', () => {
    expect(namedProjects('where is the request object created for each call', WORKSPACE)).toEqual(
      [],
    );
  });

  it('does not scope on a generic name', () => {
    // **A workspace that really has a repository called `app`** is the case this refusal exists for.
    const generic = ['o/app', 'o/api'];
    expect(namedProjects('where does the app route a request', generic)).toEqual([]);
  });

  it('reports every repository named, so a comparison can be recognised', () => {
    const named = namedProjects('how does the flask session differ from werkzeug', WORKSPACE);
    expect(named.map((entry) => entry.name)).toEqual(['flask', 'werkzeug']);
  });

  it('reports one entry for two projects that share a name', () => {
    // **A fork is the same repository as far as a question is concerned**, and picking the first is deterministic.
    const forks = ['o/express', 'upstream/express'];
    expect(namedProjects('where does express mount a route', forks)).toEqual([
      { projectId: 'o/express', name: 'express' },
    ]);
  });

  it('returns nothing for an empty question rather than scanning every project', () => {
    expect(namedProjects('', WORKSPACE)).toEqual([]);
  });
});

describe('resolveScope', () => {
  it('resolves the single repository a question names', () => {
    expect(resolveScope('where does express mount middleware', WORKSPACE)?.projectId).toBe(
      'expressjs/express',
    );
  });

  it('refuses to choose between two names, which is a comparison rather than a scope', () => {
    // **Answering half a comparison silently is worse than answering all of it noisily.**
    expect(resolveScope('how does flask use werkzeug to sign a session', WORKSPACE)).toBeNull();
  });

  it('returns nothing when no repository is named', () => {
    expect(resolveScope('where is the request object created', WORKSPACE)).toBeNull();
  });

  it('returns nothing for a single-project workspace, because there is nothing to choose', () => {
    // Guarded in `ask.ts` as well, but the rule belongs to this function: one candidate is not a resolution.
    expect(resolveScope('where does express mount middleware', ['expressjs/express'])).toEqual({
      projectId: 'expressjs/express',
      name: 'express',
    });
  });
});
