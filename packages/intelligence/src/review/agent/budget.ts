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
  /** Model rounds, each of which may carry several tool calls. Default 4. */
  maxRounds: number;
  /** Tool calls in total across all rounds. Default 12. */
  maxToolCalls: number;
  /** Characters of file text the agent may read. Default 120 000. */
  maxReadChars: number;
  /** Distinct files read. Default 12. */
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

  /** Count a round. */
  startRound(): Consumed {
    if (this.ledger.rounds >= this.limits.maxRounds) {
      return this.refuse('round', `the ${String(this.limits.maxRounds)}-round budget is spent`);
    }
    this.ledger.rounds += 1;
    return { ok: true };
  }

  /** Count a tool call, before it is made. **Before, because a call that is refused must not be billed.** */
  takeToolCall(kind: string): Consumed {
    if (this.ledger.toolCalls >= this.limits.maxToolCalls) {
      return this.refuse(kind, `the ${String(this.limits.maxToolCalls)}-call budget is spent`);
    }
    if (kind === 'search_code' && this.ledger.searches >= this.limits.maxSearches) {
      return this.refuse(kind, `the ${String(this.limits.maxSearches)}-search budget is spent`);
    }
    if (kind === 'read_file' && this.files.size >= this.limits.maxFilesRead) {
      return this.refuse(kind, `the ${String(this.limits.maxFilesRead)}-file budget is spent`);
    }
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
    this.ledger.filesRead = this.files.size;
    return { ok: true };
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
