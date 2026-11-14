// @code-analyzer/intelligence — the comments a human reviewer writes that are not about a defect
//
// **Why this file exists, in one number.** Fifty pull requests of `Alibaba-Aone/aacr-bench` carry fifty sampled goldens
// the file arm failed to match; **forty-one of them describe something the engine never tried to say** - `const auto&`
// on a loop variable that is only read, a `2.0` that should be `2.0f`, a commented-out `Fill(0.0)` nobody deleted, an
// `async` on a method with no `await`. The engine emitted a semantic defect at a nearby line instead, and the judge
// scored the pair as disagreement because it was one.
//
// **So the gap is a lane, not a threshold.** No amount of prompt wording turns "uninitialised pointer" into "missing
// const"; the second sentence is decidable from the syntax of a single construct, costs nothing, and is what a reviewer
// of `FreeCAD` or `littlefs` actually wrote. **Every rule below is derived from one of those goldens and names it**, so
// a rule that stops matching the corpus is a rule a reader can retire on evidence.
//
// **Nothing here guesses.** A rule fires only on a line the patch *added* (a review comment on an untouched line is a
// comment a reviewer could not have made), and each rule carries the smallest reading of the syntax that decides it -
// `const auto&` requires knowing the variable is not written, which is why the loop rule looks for the body's use of it
// rather than assuming.

import { describe, expect, it } from 'vitest';

import { detectIdioms, type IdiomInput } from '../../review/idiom-rules.js';

/** A patch whose added lines are the ones under test, numbered from `first`. */
function patch(lines: string[], first = 10, path = 'src/subject.cpp'): IdiomInput {
  const added = new Map<number, string>();
  lines.forEach((text, at) => added.set(first + at, text));
  return { path, addedLines: added, patch: lines.join('\n') };
}

/** The same, for a rule that only a script language triggers. */
function script(lines: string[], first = 10): IdiomInput {
  return patch(lines, first, 'src/subject.ts');
}

/** The rule ids that fired, so a test states which rule rather than "something". */
const fired = (input: IdiomInput): string[] =>
  detectIdioms(input).map((finding) => String(finding.id));

describe('a commented-out statement is something to delete, not something to read', () => {
  // corpus: `FemVTKTools.cpp` line 1434 - "Remove commented-out code. If `Fill(0.0)` is not needed, the commented
  // lines should be removed."
  it('fires on a commented-out call, in every comment syntax the corpus uses', () => {
    expect(fired(patch(['//   vtkCellArray->Fill(0.0);']))).toContain('commented-out-code');
    expect(fired(patch(['// this->dispose();']))).toContain('commented-out-code');
    expect(fired(patch(['#  self.mesh.reset()']))).toContain('commented-out-code');
    expect(fired(patch(['// if (count > 0) { return true; }']))).toContain('commented-out-code');
  });

  it('does not fire on prose, a tag, or a task marker', () => {
    // **The negative side is the one that decides whether the rule is usable.** A rule that reads "a sentence with a
    // parenthesis" as code fires on most doc comments in `FreeCAD`, and a lane that produces forty of those per pull
    // request is a lane that costs precision on every pull request.
    expect(fired(patch(['// Returns the scale of a section.']))).toEqual([]);
    expect(fired(patch(['// TODO: revisit this once the schema is published']))).toEqual([]);
    expect(fired(patch(['/// <summary>Reads the value.</summary>']))).toEqual([]);
    expect(fired(patch(['# See the spec (section 4) for the units.']))).toEqual([]);
  });

  it('reports the line the comment sits on, and at most two per file', () => {
    const findings = detectIdioms(patch(['// a();', '// b();', '// c();', '// d();'], 40)).filter(
      (finding) => finding.id === 'commented-out-code',
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.startLine)).toEqual([40, 41]);
  });
});

describe('a double literal in float arithmetic is a quiet widening', () => {
  // corpus: `SoDatumLabel.cpp` line 84 - "consider using float literal `2.0f` instead of double literal `2.0`. The
  // current code still performs double arithmetic (2.0 * float)".
  it('fires when the patch declares the variable as float', () => {
    const lines = ['float ratio = a / b;', 'float scaled = 2.0 * ratio;'];
    expect(fired(patch(lines))).toContain('float-literal-in-float-arithmetic');
  });

  it('does not fire when the literal is already a float, or the variable is not one', () => {
    expect(fired(patch(['float ratio = a / b;', 'float scaled = 2.0f * ratio;']))).toEqual([]);
    // **The declaration is the evidence.** Without it in the same patch the rule cannot know the multiplication widens,
    // and a rule that assumes it is a rule that fires on every `2.0 *` in a C++ file.
    expect(fired(patch(['double scaled = 2.0 * ratio;']))).toEqual([]);
    expect(fired(patch(['float scaled = 2.0 * count;']))).toEqual([]);
  });
});

describe('an async method with no await misleads its caller', () => {
  // corpus: `index.ts` line 460 - "Remove async keyword as this method doesn't perform any asynchronous operations.
  // This is misleading and unnecessary."
  it('fires on a method whose body awaits nothing', () => {
    const lines = [
      '  async resolveOptions(): Promise<Options> {',
      '    return this.options;',
      '  }',
    ];
    expect(fired(script(lines))).toContain('redundant-async');
  });

  it('does not fire when the body awaits, or the keyword is on something else', () => {
    expect(
      fired(
        script([
          '  async load(): Promise<Data> {',
          '    const raw = await this.fs.read();',
          '    return raw;',
          '  }',
        ]),
      ),
    ).toEqual([]);
    expect(fired(script(['  const x = async () => this.value;']))).toEqual([]);
  });
});

describe('a loose equality is a coercion the checklist forbids', () => {
  // corpus: `ExtrudeGeometry.js` line 406 - "Use strict equality === instead of ==. The checklist requires using ===
  // and !== for all comparisons."
  it('fires on == and != between two named values', () => {
    expect(fired(script(['if (value == 0) {', '  return null;', '}']))).toContain('loose-equality');
    expect(fired(script(['if (left != right) return;']))).toContain('loose-equality');
  });

  it('does not fire on strict comparisons or on a null guard', () => {
    expect(fired(script(['if (value === 0) {']))).toEqual([]);
    // **`== null` is the one loose comparison that is idiomatic**, because it is the only single expression that covers
    // both `null` and `undefined`. A rule that fired on it would be arguing with the language, not with the author.
    expect(fired(script(['if (value == null) {']))).toEqual([]);
    expect(fired(script(['if (value != undefined) {']))).toEqual([]);
  });
});

describe('an article that does not agree with its noun is a typo a reader sees', () => {
  // corpus: `lv_observer.h` line 610 - `"an Scale" should be "a Scale"`; `observer.rst` line 581 - the same for
  // "Scale Section's".
  it('fires on `an` before a consonant and on `a` before a vowel', () => {
    expect(fired(patch(['// Return an Scale value for the section.']))).toContain(
      'article-agreement-in-comment',
    );
    expect(fired(patch(['// Set a Hour for the timer.']))).toContain(
      'article-agreement-in-comment',
    );
  });

  it('does not fire on agreement, or on a vowel that sounds like a consonant', () => {
    expect(fired(patch(['// Return a Scale value for the section.']))).toEqual([]);
    expect(fired(patch(['// Wait an Hour before the retry.']))).toEqual([]);
    // **`a user`, `a union`, `an hour`, `an owner`**: the rule reads letters, so the words whose article follows the
    // sound rather than the spelling are the ones it must not touch.
    expect(fired(patch(['// Ask a user for a union of two sets.']))).toEqual([]);
    expect(fired(patch(['// Wait an hour for an owner to reply.']))).toEqual([]);
  });
});

describe('a macro whose name is not upper case is a name that will be mistyped', () => {
  // corpus: `usb_ids.h` line 63 - "The added USB product definitions use inconsistent naming conventions (e.g.,
  // `SN30_Pro` instead of `SN30_PRO`)".
  it('fires on an object-like macro with a lower-case letter', () => {
    expect(fired(patch(['#define SN30_Pro 0x1234']))).toContain('macro-name-case');
    expect(fired(patch(['#define maxRetries 3']))).toContain('macro-name-case');
  });

  it('does not fire on an upper-case macro or a function-like one', () => {
    expect(fired(patch(['#define SN30_PRO 0x1234']))).toEqual([]);
    // **A function-like macro is a different construct** and the corpus's finding was about names of constants; a rule
    // that also fired on `#define MIN(a, b)` would be reporting a style the C preprocessor's own headers use.
    expect(fired(patch(['#define MAX_OF(a, b) ((a) > (b) ? (a) : (b))']))).toEqual([]);
  });
});

describe('the lane reports only what the patch added', () => {
  // **A reviewer cannot comment on a line the patch did not touch**, so a rule that reads the whole file produces
  // findings the comment positioner has no coordinate for - and the benchmark attributes those to the wrong bucket.
  it('ignores context lines that are not in the added set', () => {
    const input: IdiomInput = {
      path: 'src/subject.ts',
      addedLines: new Map([[10, 'const changed = 1;']]),
      patch: ['if (value == 0) {', 'const changed = 1;'].join('\n'),
    };
    expect(detectIdioms(input)).toEqual([]);
  });
});

describe('every finding is a review comment a positioner can place', () => {
  it('carries a category the profile knows, a severity, and a one-line title', () => {
    const findings = [
      ...detectIdioms(patch(['//   mFill.MoveTo(p);', '#define maxRetries 3'])),
      ...detectIdioms(script(['if (value == 0) {', '  return null;', '}'])),
    ];
    expect(findings.length).toBeGreaterThan(1);
    for (const finding of findings) {
      expect(['bug', 'maintainability', 'style']).toContain(finding.category);
      expect(['critical', 'high', 'medium', 'low', 'info']).toContain(finding.severity);
      expect(finding.title).not.toContain('\n');
      expect(finding.title.length).toBeGreaterThan(0);
      // **The line is the coordinate the harness grounds the comment on**, and a finding whose end precedes its start
      // is a range the comment positioner silently drops.
      expect(finding.endLine).toBeGreaterThanOrEqual(finding.startLine);
      expect(finding.lane).toBe('idioms');
    }
  });
});
