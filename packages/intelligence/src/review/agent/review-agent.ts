// @code-analyzer/intelligence — a review that can read the code it is reviewing
//
// **Why this module exists, in one measurement.** On AACR-Bench, 36 pull requests, one judge, one model, the competitor
// scored F1 0.4043 and this repository scored 0.2033. The diagnostic the artifact carries says where the difference is:
// **158 of the 282 goldens we missed had a finding of ours on their path, within ten lines** - we were looking at the
// right code and describing the wrong thing - and **31 sat on files the review never opened**. Our reviewer was given a
// diff. Theirs was given a checkout and six tools, and its prompt says *"when the context is unclear, use tools to
// obtain contextual information rather than judging based on assumptions"*.
//
// **So this is their pipeline, rebuilt on our engine**: group the changed files, plan the risks, run a tool loop that
// may read the repository, accept only findings whose quoted code can be found, then filter the survivors. What is
// copied is copied deliberately and the source is named at each step, because a design this close to a competitor's
// should be legible as a comparison rather than resemble one by accident.
//
// **Three places where this is not a copy:**
//
//   1. **`task_done` must name every file it reviewed and every file it skipped, with a reason.** Theirs takes no
//      arguments, so *did the agent actually read every changed file* is unobservable from its output - and 31 of the
//      goldens we missed were on files nobody looked at. Here an unaccounted file is a counted defect of the review.
//   2. **A quote that cannot be found is dropped, not relocated by a second model call.** Their `re_location_task` asks
//      a model to regenerate the snippet, which is a model deciding where a model's claim belongs. Our locator is
//      deterministic, reports whether it had to disambiguate, and **refuses rather than guesses**.
//   3. **The budget is explicit and reported.** Their template allows 100 tool rounds per group; ours is set from our
//      own measured cost per pull request, and the ledger says which ceiling a run hit.

import { AgentBudget, type AgentLedger, type AgentLimits } from './budget.js';
import { locateInDiff, locateInFile, type LocatedSpan } from './grounding.js';
import { AGENT_TOOLS, dispatchTool, type DraftComment, type ReviewDeclaration } from './tools.js';

import type { ReviewRepository } from './repository.js';
import type { LLMProvider } from '../llm/provider.js';
import type { ReviewComment } from '@code-analyzer/shared';

/** How a changed file ended up. */
export type FileStatus =
  /** At least one finding survived grounding. */
  | 'commented'
  /** The agent declared it reviewed and filed nothing. **A decision, not an absence.** */
  | 'reviewed-clean'
  /** The agent declared it skipped, with a reason. */
  | 'skipped'
  /** Neither declared nor commented on. **The state this module exists to make countable.** */
  | 'unaccounted';

export interface FileAccount {
  path: string;
  status: FileStatus;
  comments: number;
  reason: string | null;
}

/** Why a filed comment did not survive. */
export interface DropRecord {
  path: string;
  reason: 'snippet-not-found' | 'no-source' | 'off-diff' | 'duplicate' | 'filtered' | 'over-budget';
  detail: string;
  content: string;
}

export interface AgentReviewOutcome {
  comments: ReviewComment[];
  accounts: FileAccount[];
  drops: DropRecord[];
  ledger: AgentLedger & {
    modelCalls: number;
    groups: number;
    /** Grounding reads are ours, not the model's; they are counted separately rather than hidden. */
    groundingReads: number;
    groundingChars: number;
    /** How many grounding attempts had to break a tie between identical snippets. */
    disambiguated: number;
    /** The agent's own declaration, or null when it never ended the task. */
    declared: ReviewDeclaration | null;
    filtered: number;
  };
}

export interface ReviewAgentOptions {
  limits?: Partial<AgentLimits>;
  /** Maximum findings kept per file. Default 4. **A file with six defects has six; a file with six opinions has one.** */
  maxFindingsPerFile?: number;
  /** Run the precision filter after grounding. Default true - **it can only remove, so its worst case is recall**. */
  filter?: boolean;
  /** Allow a finding on a file this change did not touch. Default true, **because a change can break an untouched file
   * and the competitor's own filter prompt protects exactly that case**. */
  allowOffDiff?: boolean;
  /** Files per agent call. Default 4. */
  groupSize?: number;
  /** Tag for the cost ledger. */
  tag?: string;
}

const SYSTEM = `You are a senior engineer reviewing one pull request. You have tools that read the repository at the
revision under review. Use them. A claim about code you have not read is the failure this review exists to prevent: the
diff shows what changed, and almost every defect is only visible in what surrounds it.

## What to report

Only defects this change introduces, in code it adds or changes:

- **Behaviour.** A wrong value, an inverted or missing condition, an unhandled failure path, a resource that is not
  released, a state that is read before it is set, a boundary that is off by one.
- **Semantics.** A name, comment, log line or config key that now says the opposite of what the code does. "The key is
  called X but it does Y" is a defect, and it is the kind a reader cannot recover from.
- **Duplication.** Logic that repeats an existing function closely enough that the two will drift. **Name the function
  you compared it with and say which part is repeated** - an uncompared duplication claim is a guess.
- **Convention.** A new identifier that breaks the casing, naming or ordering the same file already uses, when the break
  is the kind that causes a mistake later.
- **Tests.** A changed behaviour whose test still asserts the old one, or a test that cannot fail.

Do not report: formatting, blank lines, "consider extracting", comments on obvious code, missing documentation for
internal code, or anything whose remedy you cannot state in one sentence.

## How to report

- \`existing_code\` is copied **verbatim** from the file as it stands after the change: whole lines, no ellipsis, no line
  numbers, no re-indentation. **It is how the finding is located; a quote that is not in the file is discarded.**
- \`content\` names the concrete values - which input, which branch, which caller, which function. Say what goes wrong
  and what to do instead. Two sentences are enough; a paragraph is not.
- One finding per defect. If two lines have the same defect, one finding quoting both.

## Method

1. Read every changed file's diff.
2. For anything you suspect, open the file: the surrounding function, the caller, the declaration. Compare the new code
   with how the same file already does the same thing.
3. File the findings you can support, then call \`task_done\` naming every changed file you reviewed and every file you
   skipped, with the reason. A file in neither list is recorded as unaccounted for, which is a defect of this review.`;

/** The user message for a group of files. */
function groupPrompt(
  group: ReadonlyArray<{ path: string; diff: string }>,
  otherPaths: ReadonlyArray<string>,
): string {
  const diffs = group
    .map((entry) => `<file path="${entry.path}">\n${entry.diff.slice(0, 24_000)}\n</file>`)
    .join('\n\n');
  const others =
    otherPaths.length === 0 ? '(none)' : otherPaths.map((path) => `- ${path}`).join('\n');
  return `Other files changed by this pull request, not in this review group:
<other_changed_files>
${others}
</other_changed_files>

<review_files>
${diffs}
</review_files>

Before your first tool call, write at most five lines: the risks you are going to check in these files and which file
each one is in. Then check them, then file what you can support, then call \`task_done\`.`;
}

/**
 * Group changed files for one agent call.
 *
 * **Deterministic, by directory, rather than a model call.** Theirs spends one LLM call to cluster the files
 * semantically, which is better on a repository where `interface.go` and `impl.ts` sit in different trees. Ours groups
 * by the containing directory and caps the group at `groupSize`, so **the same input produces the same groups and the
 * benchmark stays reproducible without a second paid call** - and a file that shares no directory with another is
 * reviewed on its own, which is what the semantic grouping does for unrelated files anyway.
 */
export function groupChangedFiles(
  paths: ReadonlyArray<string>,
  groupSize: number,
): Array<Array<string>> {
  const size = Math.max(1, Math.min(groupSize, 10));
  const byDirectory = new Map<string, string[]>();
  for (const path of paths) {
    const cut = path.lastIndexOf('/');
    const directory = cut === -1 ? '.' : path.slice(0, cut);
    const bucket = byDirectory.get(directory);
    if (bucket === undefined) byDirectory.set(directory, [path]);
    else bucket.push(path);
  }
  const groups: string[][] = [];
  for (const directory of [...byDirectory.keys()].sort()) {
    const bucket = (byDirectory.get(directory) ?? []).slice().sort();
    for (let at = 0; at < bucket.length; at += size) groups.push(bucket.slice(at, at + size));
  }
  return groups;
}

/**
 * **The reviewer.**
 *
 * One instance per pull request: it owns the budget, the ledger and the accounts, and it is deliberately not reusable
 * across pull requests, because a ledger that spans two of them is a cost figure that cannot be attributed.
 */
export class ReviewAgent {
  private readonly provider: LLMProvider;
  private readonly options: Required<Omit<ReviewAgentOptions, 'limits' | 'tag'>> & {
    limits: Partial<AgentLimits>;
    tag: string;
  };

  constructor(provider: LLMProvider, options: ReviewAgentOptions = {}) {
    this.provider = provider;
    this.options = {
      maxFindingsPerFile: options.maxFindingsPerFile ?? 4,
      filter: options.filter ?? true,
      allowOffDiff: options.allowOffDiff ?? true,
      groupSize: options.groupSize ?? 4,
      limits: options.limits ?? {},
      tag: options.tag ?? 'agent-review',
    };
  }

  async review(input: {
    repository: ReviewRepository;
    /** The paths this review covers. **The repository knows them too**; both are checked, because a disagreement
     * between the two is the defect that filed 199 files under the competitor's name in an earlier run. */
    changedPaths: ReadonlyArray<string>;
  }): Promise<AgentReviewOutcome> {
    const budget = new AgentBudget(this.options.limits);
    const repository = input.repository;
    const changed =
      input.changedPaths.length > 0 ? [...input.changedPaths] : [...repository.changedPaths()];
    const changedSet = new Set(changed);

    const drafts: DraftComment[] = [];
    const drops: DropRecord[] = [];
    let declared: ReviewDeclaration | null = null;
    let modelCalls = 0;
    let groundingReads = 0;
    let groundingChars = 0;
    let disambiguated = 0;
    let groups = 0;

    const groupList = groupChangedFiles(changed, this.options.groupSize);
    for (const group of groupList) {
      groups += 1;
      const entries = group.map((path) => ({ path, diff: repository.diffOf(path) ?? '' }));
      const others = changed.filter((path) => !group.includes(path));
      const transcript: string[] = [SYSTEM, '', groupPrompt(entries, others)];
      let finished = false;
      // **A `while` rather than a `for`, so the round that is refused is refused by the budget** - which records the
      // reason. A `for (round = 1; round <= maxRounds; …)` stops one step earlier and leaves the ledger saying nothing
      // about why the review ended, which is the difference between a run that finished and a run that ran out.
      while (!finished) {
        const started = budget.startRound();
        if (!started.ok) break;
        const round = budget.report().rounds;
        modelCalls += 1;
        const result = await this.provider.completeWithTools(
          transcript.join('\n\n'),
          [...AGENT_TOOLS],
          {
            maxTokens: 4_000,
            temperature: 0.1,
            tag: `${this.options.tag}:g${String(groups)}:r${String(round)}`,
          },
        );
        const calls = result.toolCalls ?? [];
        const said = result.content.trim();
        if (calls.length === 0) {
          // **A round that called nothing is a round the model spent talking.** It is recorded in the transcript so the
          // next round can answer it, and it is not treated as `task_done`: an agent that stops without declaring its
          // coverage is an agent whose files are unaccounted for, and that is a fact about the review.
          transcript.push(
            `ASSISTANT: ${said.length > 0 ? said : '(no tool call)'}`,
            'Continue with a tool call.',
          );
          continue;
        }
        const rendered: string[] = [];
        for (const call of calls) {
          let parsed: unknown = {};
          try {
            parsed = JSON.parse(call.arguments.length > 0 ? call.arguments : '{}');
          } catch {
            parsed = {};
          }
          const outcome = dispatchTool(
            { name: call.name, arguments: parsed },
            {
              repository,
              round,
              changedPaths: changed,
              takeToolCall: (name) => budget.takeToolCall(name),
              chargeRead: (path, chars) => budget.chargeRead(path, chars),
            },
          );
          drafts.push(...outcome.comments);
          if (outcome.done !== null) {
            declared = mergeDeclarations(declared, outcome.done);
            finished = true;
          }
          rendered.push(`TOOL ${call.name} -> ${outcome.text}`);
        }
        transcript.push(
          `ASSISTANT: ${said.length > 0 ? said : '(tool calls)'}`,
          rendered.join('\n\n'),
        );
      }
    }

    // **Grounding happens after every group has run**, because a finding filed in one group about a file in another is
    // still a finding, and dropping it because of which call produced it would be an artefact of the grouping.
    const kept: ReviewComment[] = [];
    const perFile = new Map<string, number>();
    for (const draft of drafts) {
      const path = draft.path;
      const inChange = changedSet.has(path);
      if (!inChange && !this.options.allowOffDiff) {
        drops.push({
          path,
          reason: 'off-diff',
          detail: 'the file was not changed by this pull request',
          content: draft.content.slice(0, 200),
        });
        continue;
      }
      const already = perFile.get(path) ?? 0;
      if (already >= this.options.maxFindingsPerFile) {
        drops.push({
          path,
          reason: 'over-budget',
          detail: `the ${String(this.options.maxFindingsPerFile)}-finding limit for this file is spent`,
          content: draft.content.slice(0, 200),
        });
        continue;
      }
      const grounded = this.ground(draft, repository, (chars) => {
        groundingReads += 1;
        groundingChars += chars;
      });
      if (grounded === null) {
        drops.push({
          path,
          reason: 'snippet-not-found',
          detail: `the quoted code is not in ${path}`,
          content: draft.content.slice(0, 200),
        });
        continue;
      }
      if (grounded.span.quality === 'disambiguated') disambiguated += 1;
      const comment: ReviewComment = {
        id: `agent-${String(kept.length)}-${path}`,
        path,
        content: draft.content,
        existingCode: draft.existingCode,
        startLine: grounded.span.startLine,
        endLine: grounded.span.endLine,
        category: draft.category,
        severity: draft.severity,
        filtered: false,
        createdAt: new Date().toISOString(),
        ...(draft.suggestionCode === null ? {} : { suggestionCode: draft.suggestionCode }),
      };
      const duplicate = kept.find(
        (other) =>
          other.path === path &&
          other.startLine === comment.startLine &&
          other.category === comment.category,
      );
      if (duplicate !== undefined) {
        drops.push({
          path,
          reason: 'duplicate',
          detail: `another finding is already at line ${String(comment.startLine)}`,
          content: draft.content.slice(0, 200),
        });
        continue;
      }
      kept.push(comment);
      perFile.set(path, already + 1);
    }

    let filtered = 0;
    if (this.options.filter && kept.length > 0) {
      modelCalls += 1;
      filtered = await this.filterAndRemove(kept, repository, drops);
    }

    const accounts = this.accountFor(changed, kept, declared);
    return {
      comments: kept,
      accounts,
      drops,
      ledger: {
        ...budget.report(),
        modelCalls,
        groups,
        groundingReads,
        groundingChars,
        disambiguated,
        declared,
        filtered,
      },
    };
  }

  /**
   * **Find the quoted code, or refuse.** A file read is not charged to the model's budget: it is ours, for a purpose the
   * model did not ask for, and hiding it inside the tool budget would make the budget report a number that is not the
   * agent's spend.
   */
  private ground(
    draft: DraftComment,
    repository: ReviewRepository,
    charge: (chars: number) => void,
  ): { span: LocatedSpan } | null {
    const file = repository.readFile(draft.path);
    if (file !== null) {
      charge(file.text.length);
      const span = locateInFile(file, draft.existingCode, draft.startLine);
      if (span !== null) return { span };
    }
    const diff = repository.diffOf(draft.path);
    if (diff !== null) {
      charge(diff.length);
      const span = locateInDiff(diff, draft.existingCode, draft.startLine);
      if (span !== null) return { span };
    }
    return null;
  }

  /**
   * **The precision pass, with the asymmetry the competitor's own prompt spells out**: keeping a wrong comment costs a
   * reader a few seconds, and removing a right one destroys a finding nobody will ever hear about. So the model is asked
   * to remove only what the diff *proves* wrong, and a removal without a named contradicting line is ignored.
   */
  private async filterAndRemove(
    comments: ReviewComment[],
    repository: ReviewRepository,
    drops: DropRecord[],
  ): Promise<number> {
    const diffs = [...new Set(comments.map((comment) => comment.path))]
      .map(
        (path) =>
          `<file path="${path}">\n${(repository.diffOf(path) ?? '(not changed)').slice(0, 12_000)}\n</file>`,
      )
      .join('\n\n');
    const listed = comments
      .map(
        (comment, at) =>
          `${String(at)}. path=${comment.path}\ncontent: ${comment.content}\nquoted:\n${comment.existingCode}`,
      )
      .join('\n\n');
    const prompt = `You are a fact-checker for code review comments. You see only the diffs below; the reviewer saw the
whole repository, so anything you cannot see it may well have seen.

Remove a comment only when you can name a line in these diffs that **literally contradicts** its central claim, or when
the code it describes is **not in its own file's diff at all**. Style, low value, "I would not have raised this",
"I cannot verify this" and "the code looks fine" are all reasons to keep it. Keeping a wrong comment costs a reader a few
seconds; removing a right one destroys a finding.

Answer with one JSON object: {"remove": [{"index": 0, "line": "the contradicting diff line"}]}. Answer {"remove": []}
when nothing is provably wrong - which is the usual answer.

<diffs>
${diffs}
</diffs>

<comments>
${listed}
</comments>`;
    let raw: string;
    try {
      const result = await this.provider.complete(prompt, {
        maxTokens: 600,
        temperature: 0,
        tag: `${this.options.tag}:filter`,
      });
      raw = result.content;
    } catch {
      // **A filter that could not run removes nothing**, and says so by leaving the count at zero. The alternative -
      // treating a failed filter as an empty removal list with no record - is the same result with no evidence.
      return 0;
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return 0;
    }
    const list =
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { remove?: unknown }).remove)
        ? (parsed as { remove: unknown[] }).remove
        : [];
    const doomed: number[] = [];
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as { index?: unknown; line?: unknown };
      const index = typeof record.index === 'number' ? record.index : Number.NaN;
      // **A removal without the contradicting line is not a removal.** That is the whole instruction, enforced here
      // rather than trusted, because the model's default under uncertainty is to agree with the instruction's spirit.
      if (!Number.isInteger(index) || index < 0 || index >= comments.length) continue;
      if (typeof record.line !== 'string' || record.line.trim().length === 0) continue;
      doomed.push(index);
    }
    for (const index of doomed) {
      // **No `undefined` check**: `doomed` only holds indices that were bounds-checked against this array above, and a
      // guard that cannot fire is a branch nobody can test and everybody has to read.
      const comment = comments[index]!;
      drops.push({
        path: comment.path,
        reason: 'filtered',
        detail: 'the filter named a contradicting line',
        content: comment.content.slice(0, 200),
      });
    }
    const removed = new Set(doomed);
    const survivors = comments.filter((_, at) => !removed.has(at));
    comments.length = 0;
    comments.push(...survivors);
    return removed.size;
  }

  /** Every changed file gets a status. **`unaccounted` is the one that is a finding about the review itself.** */
  private accountFor(
    changed: ReadonlyArray<string>,
    comments: ReadonlyArray<ReviewComment>,
    declared: ReviewDeclaration | null,
  ): FileAccount[] {
    const reviewed = new Set(declared?.reviewed ?? []);
    const skipped = new Map((declared?.skipped ?? []).map((entry) => [entry.path, entry.reason]));
    const counts = new Map<string, number>();
    for (const comment of comments) counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
    return changed.map((path) => {
      const own = counts.get(path) ?? 0;
      const skipReason = skipped.get(path) ?? null;
      if (own > 0) {
        return { path, status: 'commented', comments: own, reason: null };
      }
      if (skipReason !== null) return { path, status: 'skipped', comments: 0, reason: skipReason };
      if (reviewed.has(path)) return { path, status: 'reviewed-clean', comments: 0, reason: null };
      return {
        path,
        status: 'unaccounted',
        comments: 0,
        reason:
          declared === null ? 'the review ended without a declaration' : 'named in neither list',
      };
    });
  }
}

/** Merge two declarations from two groups. **A file reviewed in either group is reviewed.** */
function mergeDeclarations(
  current: ReviewDeclaration | null,
  next: ReviewDeclaration,
): ReviewDeclaration {
  if (current === null)
    return { reviewed: [...new Set(next.reviewed)], skipped: [...next.skipped] };
  const reviewed = new Set([...current.reviewed, ...next.reviewed]);
  const skipped = new Map(current.skipped.map((entry) => [entry.path, entry.reason]));
  for (const entry of next.skipped)
    if (!skipped.has(entry.path)) skipped.set(entry.path, entry.reason);
  return {
    reviewed: [...reviewed],
    skipped: [...skipped].map(([path, reason]) => ({ path, reason })),
  };
}
