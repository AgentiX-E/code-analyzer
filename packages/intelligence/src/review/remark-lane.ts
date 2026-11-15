// @code-analyzer/intelligence — the remarks the lanes were never asked for, asked for
//
// **The measurement this file exists for.** On fifty pull requests of `Alibaba-Aone/aacr-bench`, 386 of 724 goldens had a
// finding of ours on their own path and were still judged as not addressing them. Fifty of those were read one at a
// time (§47.1): **five were the same concern in other words, four aimed at the same function with a different focus, and
// forty-one described something else entirely** - `const auto&` on a loop variable that is only read, `2.0` that should
// be `2.0f`, a commented-out `Fill(0.0)`, an `async` with nothing to await, a doc comment naming the wrong parameter.
// **About ten of the fifty goldens report a defect and about twenty-nine report a maintainability or convention
// remark**, and the engine emits semantic defects and nothing else.
//
// **Why the deterministic lane was not enough, and why this is a second device rather than a bigger first one.**
// `idiom-rules.ts` decides six constructs from the patch text and was measured at +0.0148 against a registered +0.02
// (R-21, p = 0.2615) - **directionally right and short of the bar**, which is what a six-rule list looks like against a
// bucket that holds a corpus's whole remark vocabulary. A rule can only fire on the construct its author thought of; the
// remarks a reviewer leaves are a distribution, and **the device that can address a distribution is the one that reads
// the line**.
//
// **What this pass is not.** It is not a second opinion about defects - the five lanes already give five of those, and a
// sixth would be paid for and merged away. It is one call whose contract is *the remarks a senior reviewer leaves and a
// compiler cannot check*, with the family list below standing where the lane prompts put a defect checklist, and with
// three rails that keep a remark-shaped emission from becoming a noise-shaped one.

import { numberedAddedLines } from './adjudication/patch-lines.js';
import {
  composeLanePrompt,
  describeTarget,
  selectionContract,
  type LLMFinding,
  type PromptContext,
} from './llm/prompts.js';

/**
 * **The remark families, each naming what in the corpus produced it.**
 *
 * The list is derived from §47.1's fifty read goldens rather than from a style guide, so that **a family that stops
 * earning can be retired on evidence rather than on taste** - the same contract `idiom-rules.ts` holds its six rules to.
 * A family here is deliberately broader than a rule: `const auto&` is one construct, but *a loop variable that is only
 * read* is a sentence a reviewer writes and a rule cannot.
 */
export interface RemarkFamily {
  /** The name the artifact records, so a run says which families it was asked for. */
  readonly id: string;
  /** What the reviewer is being asked to notice, in the words the corpus's own comments use. */
  readonly asks: string;
  /** Where the family comes from: a golden, or the count in §47.1. */
  readonly evidence: string;
}

export const REMARK_FAMILIES: readonly RemarkFamily[] = Object.freeze([
  {
    id: 'const-correctness',
    asks: 'a parameter, local or loop variable the body never writes, declared without `const` / `const auto&`; a copy of a container that is only read',
    evidence: 'golden `FemVTKTools.cpp` loop variable; §47.1 row 3',
  },
  {
    id: 'literal-type',
    asks: 'a floating-point literal that widens the expression it sits in (`2.0` beside a `float`), an integer literal assigned to a narrower type, an unsigned/signed mixed comparison',
    evidence: 'golden `SoDatumLabel.cpp:84`',
  },
  {
    id: 'commented-out-code',
    asks: 'commented-out statements, a debug print left in, a `TODO(name)` that has no owner, a commented-out assertion',
    evidence: 'golden `FemVTKTools.cpp:1434`',
  },
  {
    id: 'redundant-modifier',
    asks: '`async` with nothing awaited, `await` on a non-promise, an `override`-shaped redundant annotation, a redundant `else` after `return`',
    evidence: 'golden `index.ts:460`',
  },
  {
    id: 'doc-mismatch',
    asks: 'a doc comment that names a different parameter, type or unit than the code below it; a comment describing the previous version of the code',
    evidence: 'golden `lv_observer.h:610`, and the `ulid`/taskId renames in `cline/cline#5524`',
  },
  {
    id: 'naming',
    asks: 'a name that contradicts its type or its unit, a constant spelled like a variable, a boolean named as a negative, an abbreviation the file elsewhere spells out',
    evidence: 'golden `usb_ids.h:63`',
  },
  {
    id: 'dead-or-unreachable',
    asks: 'an unused import or include added by this change, a branch that cannot be reached, a guard that duplicates one above it, a variable assigned and never read',
    evidence: '§47.1 rows 1-2 (same function, different focus)',
  },
  {
    id: 'wording',
    asks: 'a user-visible message, error string or log line whose wording is wrong, inconsistent with its siblings, or leaks an internal name',
    evidence: 'the corpus notes on error strings in `cline/cline#5524`',
  },
]);

/**
 * **Three per file, and the number is a precision rail rather than a budget.**
 *
 * A file with twelve commented-out statements is one refactor; the twelve comments a reader would have to dismiss are
 * not twelve findings - the same sentence §47.4 holds the deterministic lane to. **Three rather than six** because this
 * pass sees the same diff the lanes saw and files beside them, so its findings compete with theirs for one slot list.
 */
export const REMARKS_PER_FILE_CEILING = 3;

/** What the rail removed, so a count that looks low can be explained rather than guessed at. */
export interface RemarkSelection {
  readonly kept: readonly LLMFinding[];
  /** A remark on a line the pull request did not add: a comment the reviewer could not have left. */
  readonly notAddedLine: number;
  /** Findings the ceiling removed, in emission order. */
  readonly capped: number;
  /** `true` when the text was not a patch, so no coordinate existed and the pass said nothing. */
  readonly notAPatch: boolean;
}

/**
 * **The rails, applied to what a model said, with the patch as the only authority on where it may speak.**
 *
 * **Only added lines**, read out of the patch text rather than out of `diff.ranges`: the benchmark builds its diffs from
 * patch text, where `ranges` counts the patch's own lines, and **a remark on a context line is a comment on code the
 * pull request did not touch** - a line the positioner cannot place and a reviewer could not have written.
 *
 * **And silence when the text is not a patch.** `numberedAddedLines` returns `null` for anything that is not a unified
 * diff, and the correct answer to *which lines did this change add* about a code window is not *all of them*: a caller
 * that hands a window gets no remarks, which is the same refusal `reviewIdioms` makes and for the same reason.
 */
export function selectRemarks(
  findings: readonly LLMFinding[],
  patch: string,
  ceiling: number = REMARKS_PER_FILE_CEILING,
): RemarkSelection {
  const numbered = numberedAddedLines(patch);
  // **`null` is "this is not a patch" and `[]` is "this patch adds nothing", and the two are different answers.** The
  // first says the rail has no coordinate system to work in; the second says it has one and every remark fell outside
  // it - which is what a deletion-only hunk looks like, and why those findings are counted as `notAddedLine` rather than
  // reported as a pass that was never asked.
  if (numbered === null) {
    return { kept: [], notAddedLine: 0, capped: 0, notAPatch: true };
  }
  const addedLines = new Set(numbered.map((line) => line.line));
  const kept: LLMFinding[] = [];
  let notAddedLine = 0;
  let capped = 0;
  for (const finding of findings) {
    if (!addedLines.has(finding.startLine)) {
      notAddedLine += 1;
      continue;
    }
    if (kept.length >= ceiling) {
      capped += 1;
      continue;
    }
    kept.push(finding);
  }
  return { kept, notAddedLine, capped, notAPatch: false };
}

/**
 * **The prompt, built with the same three arrangements as a lane so the ordering device is not measured twice.**
 *
 * `composeLanePrompt` puts the constant block first for `boilerplate-first`, which is what ships, and this pass reuses it
 * rather than inlining an order: **a sixth prompt with its own arrangement would make the arm differ from the lanes in
 * two things instead of one.**
 */
export function remarkPrompt(ctx: PromptContext): string {
  const families = REMARK_FAMILIES.map((family, at) => `${at + 1}. ${family.asks}`).join('\n');
  const head = `You are the senior engineer on this team, reading a pull request the way a reviewer reads one: you leave the small remarks that make the change mergeable, and you do not repeat the deep defect analysis somebody else is already doing.

**What you are asked for, and what you are not.** You are NOT asked whether the code is correct - assume a defect-hunting pass has already run and has said what it has to say. You are asked for the remarks an experienced reviewer leaves on the lines this change added. A remark is worth leaving when a competent author would reply "good catch, fixing" and change one or two lines.

The families below are the ones this repository has measured its reviewers writing. They are a floor, not a closed list: if a remark of the same size and the same kind is there and is not on the list, leave it.

${families}

**Rule 1, and it is the one that decides whether this pass is worth what it costs: the remark must be decidable from the added line and the code immediately around it.** If answering it needs the rest of the repository, it is not this pass's remark - leave it out rather than hedge.

**Rule 2: name the repair.** Every remark carries a suggestion that states the edit - "declare it \`const std::string&\`", "write \`2.0f\`", "delete the commented block", "say \`ulid\` in the doc comment". A remark whose repair is "consider whether" is a remark that costs the author more than it saves.

**Rule 3: the line you name must be a line this diff added.** A remark on an unchanged line is a comment this pull request cannot carry. If the thing you noticed is genuinely beside an added line, say so on the added line.

**Rule 4: silence is a valid answer.** A test file, a generated file, a vendored directory, or a change that is already clean gets nothing. Three remarks on one file is the ceiling and one is usually the right number.

`;
  const tail = `${describeTarget(ctx)}

Diff content:
\`\`\`
${ctx.diffContent}
\`\`\`

${selectionContract(ctx)}

Few-shot example - a \`float\` widened by its literal:
Input: a diff adding \`const auto gain = 2.0 * factor;\` where \`factor\` is a \`float\`
Output:
{
  "findings": [
    {
      "startLine": 84,
      "endLine": 84,
      "severity": "low",
      "category": "maintainability",
      "title": "Float product widened to double by the literal",
      "description": "\`factor\` is a float but \`2.0\` is a double, so the product is promoted and narrowed back on assignment.",
      "suggestion": "Write \`2.0f * factor\`."
    }
  ]
}

Few-shot example - the correct answer on a clean addition:
Input: a diff adding \`const auto count = items.size();\`
Output:
{
  "findings": []
}

Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}
