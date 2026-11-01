// @code-analyzer/analyzer — a loop variable is the element type of what it iterates.
//
// `for (const sentinel of this.sentinels) { sentinel.client.disconnect(); }` is how `redis/ioredis@5.4.2` writes its
// failover detector, and it is how every codebase writes a walk over a collection. The binding has no annotation: the
// type comes from the iterable, and `Sentinel[]` says `Sentinel` only to a reader that knows what `[]` means for a
// variable bound by `of`.
//
// Three refusals are as important as the answer: an array literal (`for (const v of [1, 2])`) says nothing about `v`
// that this resolver can name, `Array<T>` is the same fact in the other spelling and *is* readable, and `for...in`
// iterates keys — a `string` in TypeScript — so it is never the element type.

export interface Leaf {
  disconnect(): void;
}

export class Pool {
  private leaves: Leaf[] = [];

  resetField(): void {
    for (const leaf of this.leaves) {
      leaf.disconnect();
    }
  }

  resetLocal(): void {
    const all: Array<Leaf> = [];
    for (const leaf of all) {
      leaf.disconnect();
    }
  }

  refuseLiteral(): void {
    for (const value of [1, 2, 3]) {
      value.toFixed();
    }
  }

  refuseKeys(): void {
    for (const key in this.leaves) {
      key.trim();
    }
  }

  shadow(flag: boolean): void {
    const pick: Leaf = this.leaves[0] as Leaf;
    pick.disconnect();
    if (flag) {
      const pick: string = '';
      pick.trim();
    }
  }
}
