// @code-analyzer/analyzer — a type written twice: a class with bodies and the interface that adds to it.
//
// `redis/ioredis@5.4.2` writes `class Redis extends Commander` and, nine hundred lines later,
// `interface Redis extends Transaction {}` — declaration merging that adds the transaction methods to the same class.
// Both are `Redis`, and only one of them declares a base list, so a reader that *replaces* the base list when it meets
// the second declaration loses `Commander` and answers `this.defineCommand(…)` with nothing.

export interface Extra {
  extra(): void;
}

export class Commander {
  defineCommand(name: string): void {
    void name;
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface -- the merge is the point, not a member.
export interface Commander extends Extra {}
