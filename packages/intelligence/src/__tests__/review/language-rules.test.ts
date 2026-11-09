// @code-analyzer/intelligence — Per-language defect checklist tests
//
// **What these tests are for.** The checklist is prose, and prose is the part of a prompt nobody tests - which is why
// the last time a prompt was edited in this repository the section was replaced with a copy of itself and the suites
// stayed green. So the assertions here are about **structure that a measurement depends on**: that every rule has an
// exclusion, that selection is deterministic, that the cap holds, that the switch removes the section and nothing else,
// and that all five lanes carry the same checklist for the same change.

import { describe, expect, it } from 'vitest';

import {
  LANGUAGES,
  MAX_LANGUAGES_PER_CALL,
  defectChecklist,
  extensionOf,
  languageOf,
  languagesOf,
} from '../../review/llm/language-rules.js';
import {
  ARCHITECTURE_REVIEW_PROMPT,
  LANE_PROMPTS,
  MAINTAINABILITY_REVIEW_PROMPT,
  PERFORMANCE_REVIEW_PROMPT,
  SECURITY_REVIEW_PROMPT,
  TESTING_REVIEW_PROMPT,
} from '../../review/llm/prompts.js';

import type { PromptContext } from '../../review/llm/prompts.js';

function context(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    diffContent: '@@ -1 +1 @@\n+final int x = 1;',
    filePath: 'src/main/java/com/example/Ledger.java',
    changeType: 'modified',
    ...overrides,
  };
}

describe('the rule corpus', () => {
  it('covers the eleven languages the audit lists first', () => {
    expect(LANGUAGES.map((definition) => definition.language)).toEqual([
      'java',
      'javascript',
      'typescript',
      'python',
      'groovy',
      'xml',
      'yaml',
      'json',
      'kotlin',
      'swift',
      'arkts',
    ]);
  });

  it('gives every rule an identifier, a pattern and an exclusion', () => {
    for (const definition of LANGUAGES) {
      expect(definition.rules.length).toBeGreaterThanOrEqual(4);
      expect(definition.extensions.length).toBeGreaterThanOrEqual(1);
      expect(definition.label.length).toBeGreaterThan(0);
      for (const rule of definition.rules) {
        // **A prefix rather than the language name**, because two languages are known in code by their short form
        // (`ts.`, `js.`) and renaming the identifiers to satisfy a test would make them harder to recognise in a
        // finding. What has to hold is the shape: a namespace, a dot, and a slug.
        expect(rule.id).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
        expect(rule.report.trim().endsWith('.')).toBe(true);
        expect(rule.report.length).toBeGreaterThan(40);
        expect(rule.notWhen.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it('keeps identifiers unique across the whole corpus', () => {
    const ids = LANGUAGES.flatMap((definition) => definition.rules.map((rule) => rule.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps extensions unique, so a path selects exactly one language', () => {
    const extensions = LANGUAGES.flatMap((definition) => [...definition.extensions]);
    expect(new Set(extensions).size).toBe(extensions.length);
  });
});

describe('selecting a language from a path', () => {
  it('reads the extension of a nested path', () => {
    expect(extensionOf('a/b/c/Thing.java')).toBe('.java');
    expect(languageOf('a/b/c/Thing.java')?.language).toBe('java');
  });

  it('ignores case in the extension', () => {
    expect(languageOf('MODULE.GRADLE')?.language).toBe('groovy');
    expect(languageOf('View.ETS')?.language).toBe('arkts');
  });

  it('treats a dotfile as having no extension', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(languageOf('.gitignore')).toBeUndefined();
  });

  it('treats a path with no dot as having no extension', () => {
    expect(extensionOf('Makefile')).toBe('');
    expect(languageOf('Makefile')).toBeUndefined();
  });

  it('selects nothing for a language the corpus does not carry', () => {
    expect(languageOf('src/main.rs')).toBeUndefined();
    expect(languageOf('src/app.go')).toBeUndefined();
  });

  it('selects YAML for both spellings', () => {
    expect(languageOf('ci/check.yaml')?.language).toBe('yaml');
    expect(languageOf('ci/check.yml')?.language).toBe('yaml');
  });
});

describe('ordering the languages of a call', () => {
  it('puts the most-represented language first', () => {
    const chosen = languagesOf(['a/One.java', 'a/Two.java', 'a/Three.java', 'ci/build.yml']);
    expect(chosen.map((definition) => definition.language)).toEqual(['java', 'yaml']);
  });

  it('breaks a tie by label, so the order does not depend on the file order', () => {
    const forwards = languagesOf(['a/One.java', 'b/One.kt']);
    const backwards = languagesOf(['b/One.kt', 'a/One.java']);
    expect(forwards.map((definition) => definition.language)).toEqual(
      backwards.map((definition) => definition.language),
    );
    expect(forwards.map((definition) => definition.label)).toEqual(['Java', 'Kotlin']);
  });

  it('ignores paths it does not know', () => {
    expect(languagesOf(['README.md', 'src/main.rs'])).toEqual([]);
  });

  it('counts files rather than extensions, so two extensions of one language add up', () => {
    const chosen = languagesOf(['a/One.kt', 'a/Build.kts', 'ci/build.yml']);
    expect(chosen[0]?.language).toBe('kotlin');
  });
});

describe('rendering the checklist', () => {
  it('renders every rule of the selected language with its exclusion', () => {
    const text = defectChecklist(context());
    expect(text).toContain('### Java');
    for (const rule of LANGUAGES[0]!.rules) {
      expect(text).toContain(rule.id);
      expect(text).toContain(rule.notWhen);
    }
    expect(text.match(/Do not report when/g)?.length).toBe(LANGUAGES[0]!.rules.length);
  });

  it('states that the exclusion outranks the rule', () => {
    expect(defectChecklist(context())).toContain('clause outranks the rule');
  });

  it('is empty when the call covers no language it knows', () => {
    expect(defectChecklist(context({ filePath: 'README.md' }))).toBe('');
  });

  it('is empty for a pull-request call that named no paths', () => {
    // **The scope without its paths**, which the engine never builds but a caller can: the answer is silence rather
    // than a checklist about the file in `filePath`, which for a pull request is a label like `a.ts (+3 more)`.
    expect(defectChecklist(context({ scope: 'pull-request' }))).toBe('');
    expect(defectChecklist(context({ scope: 'pull-request', paths: [] }))).toBe('');
  });

  it('is empty when the switch is off, and says nothing about the absence', () => {
    expect(defectChecklist(context({ languageChecklist: false }))).toBe('');
  });

  it('is on when the switch is undefined, which is every caller that predates it', () => {
    expect(defectChecklist(context())).toContain('### Java');
  });

  it('caps a pull request at three languages', () => {
    const text = defectChecklist(
      context({
        scope: 'pull-request',
        paths: ['a/One.java', 'a/two.py', 'a/three.kt', 'a/four.swift', 'ci/build.yml'],
      }),
    );
    expect(text).toContain('### Java');
    expect(text).toContain('### Python');
    expect(text).toContain('### Kotlin');
    expect(text).not.toContain('### Swift');
    expect(text).not.toContain('### YAML');
    expect(MAX_LANGUAGES_PER_CALL).toBe(3);
  });

  it('reads the paths of a pull-request call and the single path of a file call', () => {
    const pull = defectChecklist(
      context({ scope: 'pull-request', paths: ['a/One.py'], filePath: 'a/One.java (+1 more)' }),
    );
    expect(pull).toContain('### Python');
    expect(pull).not.toContain('### Java');
  });

  it('is deterministic for the same input', () => {
    const paths = ['a/One.java', 'a/two.py', 'a/three.kt'];
    expect(defectChecklist(context({ scope: 'pull-request', paths }))).toBe(
      defectChecklist(context({ scope: 'pull-request', paths })),
    );
  });
});

describe('the five lanes all carry it', () => {
  const lanes = [
    ['security', SECURITY_REVIEW_PROMPT],
    ['performance', PERFORMANCE_REVIEW_PROMPT],
    ['maintainability', MAINTAINABILITY_REVIEW_PROMPT],
    ['testing', TESTING_REVIEW_PROMPT],
    ['architecture', ARCHITECTURE_REVIEW_PROMPT],
  ] as const;

  it('renders the corpus checklist in every lane', () => {
    for (const [name, build] of lanes) {
      expect(build(context()), name).toContain('java.resource-leak');
      expect(build(context()), name).toContain('### Java');
    }
  });

  it('is the same section in every lane, byte for byte', () => {
    const sections = lanes.map(([, build]) => {
      const text = build(context());
      const start = text.indexOf('Defect checklist for the language');
      const end = text.indexOf('Report a rule', start);
      return text.slice(start, end);
    });
    expect(new Set(sections).size).toBe(1);
  });

  it('is absent from every lane when the switch is off', () => {
    for (const [name, build] of lanes) {
      expect(build(context({ languageChecklist: false })), name).not.toContain('Defect checklist');
    }
  });

  it('does not disturb the output contract, which still comes after it', () => {
    for (const [, build] of lanes) {
      const text = build(context());
      expect(text.indexOf('Defect checklist')).toBeLessThan(text.indexOf('Respond ONLY with'));
    }
  });

  it('reaches every lane through the exported lane map', () => {
    for (const build of Object.values(LANE_PROMPTS)) {
      expect(build(context())).toContain('java.resource-leak');
    }
  });
});
