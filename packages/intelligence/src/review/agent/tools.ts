// @code-analyzer/intelligence — the tools a review agent may call
//
// **The competitor's six tools, minus the one we do not need and plus the contract that makes its comments checkable.**
// `internal/tool/definitions.go` declares `file_read`, `file_read_diff`, `file_search`, `file_find`, `code_comment`,
// `task_done`. `file_find` locates a file by name; **we already have a path index**, so a search that names a path is
// one call rather than two. What we must copy exactly is the shape of `code_comment`: **a finding is a claim plus the
// verbatim code it is about**, and the code is what gets checked. Their `re_location_task` exists because a model that
// quotes from memory gets the quote approximately right, and there is no version of this design in which trusting the
// line number is cheaper than trusting the text.
//
// **And one addition that is ours**: `task_done` takes the list of files the agent reviewed and the ones it skipped with
// a reason. Theirs takes nothing, which is why *whether the model actually read every changed file* is unobservable
// from their output. **32 of the 282 goldens we missed in the head-to-head sat on files our review never looked at**,
// and a contract that cannot say which files were reviewed cannot fix that.

import type { RepositoryFile, ReviewRepository, SearchHit } from './repository.js';
import type { ToolDefinition } from '../llm/provider.js';
import type { ReviewCategory, Severity } from '@code-analyzer/shared';

/** One comment as the model filed it, before anything has been checked. */
export interface DraftComment {
  path: string;
  content: string;
  /** **The verbatim code the claim is about.** The only part of the claim that can be verified without a model. */
  existingCode: string;
  suggestionCode: string | null;
  category: ReviewCategory;
  severity: Severity;
  /** The line the model *thinks* it is on. **Used only to break a tie**, never trusted as the answer. */
  startLine: number | null;
  endLine: number | null;
  /** Which tool call filed it, so a drop can be traced to a round. */
  round: number;
}

/** What `task_done` reported. */
export interface ReviewDeclaration {
  reviewed: string[];
  skipped: Array<{ path: string; reason: string }>;
}

/** The result of one tool call, as it is rendered back into the transcript. */
export interface ToolOutcome {
  /** The text the model reads next round. */
  text: string;
  /** Comments the call filed, if it filed any. */
  comments: DraftComment[];
  /** Set when the call ended the task. */
  done: ReviewDeclaration | null;
  /** Set when the call could not be executed, for the ledger. */
  refused: string | null;
}

const CATEGORIES: ReadonlySet<string> = new Set([
  'bug',
  'security',
  'performance',
  'maintainability',
  'test',
  'style',
  'documentation',
  'architecture',
]);

const SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low']);

/** **The five tools, described for a model that has never seen this repository.** */
export const AGENT_TOOLS: ReadonlyArray<ToolDefinition> = Object.freeze([
  {
    name: 'read_file',
    description:
      'Read a file from the repository at the revision under review. Use it before claiming what a function does, ' +
      'what a caller passes, or whether a check exists elsewhere. Returns numbered lines.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository-relative path.' },
        from_line: { type: 'integer', description: 'First line to return, 1-based. Optional.' },
        to_line: { type: 'integer', description: 'Last line to return, inclusive. Optional.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description:
      'Find a literal string across the repository. Use it to locate a definition, a caller, or every use of a ' +
      'symbol before saying something is unused or missing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A literal string, not a regular expression.' },
        suffix: {
          type: 'string',
          description: 'Only paths ending with this, e.g. ".ts". Optional.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_diff',
    description:
      'Read the change made to another file in this pull request. Use it for a contract that spans files: a new ' +
      'parameter, a changed return type, a renamed field.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repository-relative path.' } },
      required: ['path'],
    },
  },
  {
    name: 'file_comment',
    description:
      'File a finding. `existing_code` must be copied verbatim from the file as it stands after the change - it is ' +
      'how the finding is located, and a finding whose code cannot be found in the file is discarded.',
    parameters: {
      type: 'object',
      properties: {
        comments: {
          type: 'array',
          description: 'One or more findings.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: {
                type: 'string',
                description:
                  'What is wrong, what happens because of it, and what to do instead. Name the concrete values.',
              },
              existing_code: {
                type: 'string',
                description: 'The verbatim lines the finding is about, copied from the file.',
              },
              suggestion_code: {
                type: 'string',
                description: 'Replacement code, when it is short.',
              },
              category: {
                type: 'string',
                enum: [
                  'bug',
                  'security',
                  'performance',
                  'maintainability',
                  'test',
                  'style',
                  'documentation',
                ],
              },
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            },
            required: ['path', 'content', 'existing_code'],
          },
        },
      },
      required: ['comments'],
    },
  },
  {
    name: 'task_done',
    description:
      'End the review. Name every changed file you reviewed and every one you skipped, with the reason. A file that ' +
      'is in neither list is reported as unaccounted for.',
    parameters: {
      type: 'object',
      properties: {
        reviewed: { type: 'array', items: { type: 'string' } },
        skipped: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, reason: { type: 'string' } },
            required: ['path', 'reason'],
          },
        },
      },
      required: ['reviewed'],
    },
  },
]);

/** The names, for a dispatcher that must reject a call it does not implement. */
export const AGENT_TOOL_NAMES: ReadonlyArray<string> = AGENT_TOOLS.map((tool) => tool.name);

/**
 * **The tools that can only report, for the round in which reading is over.**
 *
 * **The first measured run of this agent filed nothing.** 36 pull requests, 145 model calls, 273 tool calls, 2.4 million
 * characters read - and not one `file_comment`, because the reading budget ran out while the model was still opening
 * files. An agent whose last act is always a read is an agent that has never been asked to conclude, so the last round of
 * every group offers these two tools and nothing else: it cannot read, and `task_done` still names what was covered.
 * **This is a reservation rather than an extra call**, so a group costs what it cost before - one of its rounds is now
 * spent concluding instead of exploring.
 */
export const FILING_TOOLS: ReadonlyArray<ToolDefinition> = Object.freeze(
  AGENT_TOOLS.filter((tool) => tool.name === 'file_comment' || tool.name === 'task_done'),
);

/** Whether a tool may be called in the round that files. */
export function isFilingTool(name: string): boolean {
  return FILING_TOOLS.some((tool) => tool.name === name);
}

/** Render a file with line numbers, so a quote can be copied without counting. */
function numbered(file: RepositoryFile, from?: number, to?: number): string {
  const lines = file.text.split('\n');
  // **A file that ends with a newline splits into a final empty string**, and a numbered line saying `3| ` invites a
  // model to quote an empty line as code - which then fails the locator that this same read was supposed to supply.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const first = Math.max(1, from ?? file.firstLine);
  const last = Math.min(lines.length + file.firstLine - 1, to ?? lines.length + file.firstLine - 1);
  const out: string[] = [];
  for (let line = first; line <= last; line += 1) {
    const text = lines[line - file.firstLine];
    if (text === undefined) break;
    out.push(`${String(line).padStart(5, ' ')}| ${text}`);
  }
  if (file.truncated)
    out.push(`… the file continues past ${String(last)} lines and this read was truncated`);
  return out.join('\n');
}

/** Read one argument as a string, or `null`. **`noPropertyAccessFromIndexSignature` applies to tool arguments too.** */
function argString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function argNumber(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * **Parse `file_comment` into drafts.**
 *
 * Tolerant of the two shapes a model produces - an array, or a single object - and **strict about the three fields the
 * contract needs**: a comment with no path, no content or no quoted code is not a comment, it is a sentence, and the
 * count of those is kept rather than thrown away. A reviewer that drops half a batch in silence is a reviewer whose
 * recall cannot be explained.
 */
export function parseDraftComments(
  raw: unknown,
  fallbackPath: string,
  round: number,
): { comments: DraftComment[]; rejected: Array<{ reason: string; content: string }> } {
  const list: unknown[] = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const comments: DraftComment[] = [];
  const rejected: Array<{ reason: string; content: string }> = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) {
      rejected.push({ reason: 'not an object', content: String(entry).slice(0, 120) });
      continue;
    }
    const record = entry as Record<string, unknown>;
    const content = argString(record, 'content');
    const existingCode = argString(record, 'existing_code') ?? argString(record, 'existingCode');
    const path = argString(record, 'path') ?? fallbackPath;
    if (content === null) {
      rejected.push({ reason: 'no content', content: path });
      continue;
    }
    if (path.length === 0) {
      // **No path and no single-file review to fall back on.** A finding with no file cannot be posted and cannot be
      // located; filing it under the empty string would put it on a file that does not exist.
      rejected.push({ reason: 'no path', content: content.slice(0, 120) });
      continue;
    }
    if (existingCode === null) {
      // **The one field that is not negotiable.** Without it the finding has no location that can be checked, and a
      // reviewer that files findings at a line number it guessed is the reviewer this whole module replaces.
      rejected.push({ reason: 'no existing_code', content: content.slice(0, 120) });
      continue;
    }
    const category = argString(record, 'category');
    const severity = argString(record, 'severity');
    comments.push({
      path,
      content,
      existingCode,
      suggestionCode: argString(record, 'suggestion_code') ?? argString(record, 'suggestionCode'),
      category: (category !== null && CATEGORIES.has(category)
        ? category
        : 'bug') as ReviewCategory,
      severity: (severity !== null && SEVERITIES.has(severity) ? severity : 'medium') as Severity,
      startLine: argNumber(record, 'start_line') ?? argNumber(record, 'startLine'),
      endLine: argNumber(record, 'end_line') ?? argNumber(record, 'endLine'),
      round,
    });
  }
  return { comments, rejected };
}

/** Parse `task_done`. */
export function parseDeclaration(raw: unknown): ReviewDeclaration {
  if (typeof raw !== 'object' || raw === null) return { reviewed: [], skipped: [] };
  const record = raw as Record<string, unknown>;
  const reviewed = Array.isArray(record['reviewed'])
    ? record['reviewed'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  const skippedRaw = Array.isArray(record['skipped']) ? record['skipped'] : [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const entry of skippedRaw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const path = argString(row, 'path');
    const reason = argString(row, 'reason');
    if (path !== null && reason !== null) skipped.push({ path, reason });
  }
  return { reviewed, skipped };
}

/**
 * **Execute one tool call.**
 *
 * The dispatcher owns the repository, the budget and the round number, so **every effect a tool can have is decided in
 * one place** - which is what makes "the agent cannot comment without quoting" a property of the dispatch rather than of
 * a prompt it might ignore.
 */
export function dispatchTool(
  call: { name: string; arguments: unknown },
  context: {
    repository: ReviewRepository;
    round: number;
    /** Called before a read is served, so the budget can refuse it. */
    takeToolCall: (name: string) => { ok: true } | { ok: false; reason: string };
    /** Called with a read's cost, so the character ceiling can stop the next one. */
    chargeRead: (path: string, chars: number) => { ok: true } | { ok: false; reason: string };
    /** The paths this review covers, for a comment filed against a file nobody changed. */
    changedPaths: ReadonlyArray<string>;
  },
): ToolOutcome {
  const refusal = context.takeToolCall(call.name);
  if (!refusal.ok) {
    return { text: `Error: ${refusal.reason}`, comments: [], done: null, refused: refusal.reason };
  }
  const args = (
    typeof call.arguments === 'object' && call.arguments !== null ? call.arguments : {}
  ) as Record<string, unknown>;

  switch (call.name) {
    case 'read_file': {
      const path = argString(args, 'path');
      if (path === null)
        return {
          text: 'Error: read_file needs a path',
          comments: [],
          done: null,
          refused: 'no path',
        };
      const file = context.repository.readFile(path);
      if (file === null) {
        return {
          text: `Error: ${path} is not in this repository`,
          comments: [],
          done: null,
          refused: 'absent',
        };
      }
      const charged = context.chargeRead(file.path, file.text.length);
      if (!charged.ok) {
        return {
          text: `Error: ${charged.reason}`,
          comments: [],
          done: null,
          refused: charged.reason,
        };
      }
      return {
        text: numbered(
          file,
          argNumber(args, 'from_line') ?? undefined,
          argNumber(args, 'to_line') ?? undefined,
        ),
        comments: [],
        done: null,
        refused: null,
      };
    }
    case 'read_diff': {
      const path = argString(args, 'path');
      if (path === null)
        return {
          text: 'Error: read_diff needs a path',
          comments: [],
          done: null,
          refused: 'no path',
        };
      const diff = context.repository.diffOf(path);
      if (diff === null) {
        return {
          text: `Error: ${path} was not changed by this pull request. Changed files: ${context.changedPaths.join(', ')}`,
          comments: [],
          done: null,
          refused: 'not changed',
        };
      }
      const charged = context.chargeRead(path, diff.length);
      if (!charged.ok) {
        return {
          text: `Error: ${charged.reason}`,
          comments: [],
          done: null,
          refused: charged.reason,
        };
      }
      return { text: diff.slice(0, 20_000), comments: [], done: null, refused: null };
    }
    case 'search_code': {
      const query = argString(args, 'query');
      if (query === null) {
        return {
          text: 'Error: search_code needs a query',
          comments: [],
          done: null,
          refused: 'no query',
        };
      }
      const suffix = argString(args, 'suffix');
      const hits: SearchHit[] = context.repository.search(query, {
        limit: 20,
        ...(suffix === null ? {} : { suffix }),
      });
      if (hits.length === 0) {
        return {
          text: `No occurrence of ${JSON.stringify(query)}.`,
          comments: [],
          done: null,
          refused: null,
        };
      }
      const charged = context.chargeRead('(search)', hits.length * 80);
      if (!charged.ok)
        return {
          text: `Error: ${charged.reason}`,
          comments: [],
          done: null,
          refused: charged.reason,
        };
      return {
        text: hits.map((hit) => `${hit.path}:${String(hit.line)}: ${hit.text}`).join('\n'),
        comments: [],
        done: null,
        refused: null,
      };
    }
    case 'file_comment': {
      // **The path fallback is the review's own single path when it has one**, and the empty string otherwise: a
      // comment with no path and no review path is rejected by the parser rather than filed somewhere plausible.
      const fallback = context.changedPaths.length === 1 ? (context.changedPaths[0] ?? '') : '';
      const parsed = parseDraftComments(args['comments'], fallback, context.round);
      if (parsed.comments.length === 0) {
        return {
          text:
            `Error: none of the ${String(parsed.rejected.length)} entr(ies) could be filed. ` +
            parsed.rejected.map((entry) => `${entry.reason}: ${entry.content}`).join('; '),
          comments: [],
          done: null,
          refused: 'no usable comment',
        };
      }
      const rejectedNote =
        parsed.rejected.length === 0
          ? ''
          : `\nRejected: ${parsed.rejected.map((entry) => `${entry.reason} for "${entry.content}"`).join('; ')}`;
      return {
        text: `Filed ${String(parsed.comments.length)} finding(s).${rejectedNote}`,
        comments: parsed.comments,
        done: null,
        refused: null,
      };
    }
    case 'task_done':
      return { text: 'Review ended.', comments: [], done: parseDeclaration(args), refused: null };
    default:
      return {
        text: `Error: there is no tool named ${JSON.stringify(call.name)}`,
        comments: [],
        done: null,
        refused: 'unknown tool',
      };
  }
}
