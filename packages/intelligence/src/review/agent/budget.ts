// @code-analyzer/intelligence — what a review agent is allowed to spend
//
// **The competitor's template sets `MAX_TOOL_REQUEST_TIMES: 100`**, and on a group of ten files that is a hundred model
// calls before the filter pass and the relocation passes are counted. It works, and it is a bill this project cannot
// carry per pull request: our measured cost for a 36-pull-request run was 0.58 USD *for five single-shot lanes per
// file*. An agent with a hundred rounds would multiply it by an order of magnitude and produce a benchmark nobody
// could re-run.
//
// **So the budget is a first-class object rather than a constant inside the loop.** Every read, every search and every
// round is a `consume` that either succeeds or returns the reason it did not - and **the reason is kept**, because an
// agent that stopped for want of budget and an agent that stopped because it was finished produce the same comments
// and different explanations, and only one of them is a reviewer that can be trusted with a larger budget.
//
// The numbers are set from the two measurements that exist: their reviewer files ~7.8 comments per pull request, and our
// own run spent 1 425 calls over 36 pull requests. **Six reads and three rounds per pull request is 36 × 9 calls**,
// which is the same order and two orders below theirs.

/** What one agent run may spend. */
export interface AgentLimits {
  /**
   * Model rounds **per group of files**, each of which may carry several tool calls. Default 4.
   *
   * **Per group, and that is a correction rather than a detail.** The first run of this agent spent the whole budget on
   * the first group of every pull request: 36 of 36 pull requests used rounds `g1:r1` to `g1:r4` and no group ever
   * started, because a ceiling meant for one group was counted once for the review. **The unit of work is a group**, so
   * the ceiling has to be one too.
   */
  maxRounds: number;
  /** Tool calls **per group of files**. Default 12. The bill is bounded by `maxReadChars`, which is per review. */
  maxToolCalls: number;
  /** Characters of file text the agent may read. Default 120 000. **Per review**, because this is the cost ceiling. */
  maxReadChars: number;
  /**
   * Distinct files one group may read. Default 12.
   *
   * **Per group, for the same reason the rounds are.** A file ceiling counted once for the review starves the later
   * groups of a large pull request exactly as the round ceiling did, and the cost of the reading is bounded by
   * `maxReadChars` rather than by this number.
   */
  maxFilesRead: number;
  /** Search calls. Default 4. */
  maxSearches: number;
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = Object.freeze({
  maxRounds: 4,
  maxToolCalls: 12,
  maxReadChars: 120_000,
  maxFilesRead: 12,
  maxSearches: 4,
});

/** A refusal, with the reason. */
export interface Refusal {
  ok: false;
  reason: string;
}

export type Consumed = { ok: true } | Refusal;

/** **Where the budget went**, so a run that produced nothing can say which ceiling it hit. */
export interface AgentLedger {
  /** Model rounds across the review. **The ceilings are per group; this is what the review cost.** */
  rounds: number;
  toolCalls: number;
  readChars: number;
  filesRead: number;
  searches: number;
  refusals: Array<{ kind: string; reason: string }>;
}

/** A budget with a ledger. One instance per pull request. */
export class AgentBudget {
  private readonly limits: AgentLimits;
  private readonly ledger: AgentLedger = {
    rounds: 0,
    toolCalls: 0,
    readChars: 0,
    filesRead: 0,
    searches: 0,
    refusals: [],
  };
  private readonly files = new Set<string>();
  private group = 0;
  private readonly groupRounds = new Map<number, number>();
  private readonly groupCalls = new Map<number, number>();
  private readonly groupFiles = new Map<number, Set<string>>();

  constructor(limits: Partial<AgentLimits> = {}) {
    this.limits = { ...DEFAULT_AGENT_LIMITS, ...limits };
  }

  /** Read the ledger, without the ability to write it. */
  report(): AgentLedger {
    return { ...this.ledger, refusals: [...this.ledger.refusals] };
  }

  /** The limits this budget enforces, for an artifact that has to state them. */
  policy(): AgentLimits {
    return { ...this.limits };
  }

  /**
   * Start a group of files. **The rounds and calls a group may spend are counted from here**, and the review's totals
   * keep counting: a group's ceiling is a unit of work and the review's total is what it cost.
   */
  beginGroup(group: number): void {
    // **Nothing is initialised here, because every counter already reads a missing group as zero.** Three `if (!has)`
    // guards stood here and each had an arm no caller could reach: the maps are keyed on first write, and `groupSet`
    // creates its set on demand for the callers that never announce a group at all.
    this.group = group;
  }

  /** How many rounds this group has left, **including the one it is about to take**. */
  roundsLeft(): number {
    return Math.max(0, this.limits.maxRounds - (this.groupRounds.get(this.group) ?? 0));
  }

  /** Count a round. */
  startRound(): Consumed {
    const spent = this.groupRounds.get(this.group) ?? 0;
    if (spent >= this.limits.maxRounds) {
      return this.refuse('round', `the ${String(this.limits.maxRounds)}-round budget is spent`);
    }
    this.groupRounds.set(this.group, spent + 1);
    this.ledger.rounds += 1;
    return { ok: true };
  }

  /** Count a tool call, before it is made. **Before, because a call that is refused must not be billed.** */
  takeToolCall(kind: string): Consumed {
    const spent = this.groupCalls.get(this.group) ?? 0;
    if (spent >= this.limits.maxToolCalls) {
      return this.refuse(kind, `the ${String(this.limits.maxToolCalls)}-call budget is spent`);
    }
    if (kind === 'search_code' && this.ledger.searches >= this.limits.maxSearches) {
      return this.refuse(kind, `the ${String(this.limits.maxSearches)}-search budget is spent`);
    }
    if (kind === 'read_file' && this.groupSet().size >= this.limits.maxFilesRead) {
      return this.refuse(kind, `the ${String(this.limits.maxFilesRead)}-file budget is spent`);
    }
    this.groupCalls.set(this.group, spent + 1);
    this.ledger.toolCalls += 1;
    if (kind === 'search_code') this.ledger.searches += 1;
    return { ok: true };
  }

  /** Record a read's cost, after it happened, so the character ceiling can stop the next one. */
  chargeRead(path: string, chars: number): Consumed {
    if (this.ledger.readChars + chars > this.limits.maxReadChars) {
      return this.refuse(
        'read_file',
        `reading ${path} would pass the ${String(this.limits.maxReadChars)}-character budget`,
      );
    }
    this.ledger.readChars += chars;
    this.files.add(path);
    this.groupSet().add(path);
    this.ledger.filesRead = this.files.size;
    return { ok: true };
  }

  /**
   * The set of files the current group has read, created on demand.
   *
   * **On demand rather than in `beginGroup`, because a budget is usable without one**: the unit tests and the `--dry-run`
   * rehearsal drive a single group and never call it, and a ceiling that silently disappeared for them would be a
   * ceiling that is only enforced by the caller who remembered to announce its group.
   */
  private groupSet(): Set<string> {
    const existing = this.groupFiles.get(this.group);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    this.groupFiles.set(this.group, created);
    return created;
  }

  /** Whether a file was read, so a comment about it can be grounded in the text rather than the diff. */
  hasRead(path: string): boolean {
    return this.files.has(path);
  }

  private refuse(kind: string, reason: string): Refusal {
    this.ledger.refusals.push({ kind, reason });
    return { ok: false, reason };
  }
}
