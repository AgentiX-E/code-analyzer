// Types a receiver has to reach through, written the way a real package writes them: a value class, the type a
// field is declared to have, and a union a guard narrows.

export class Item {
  save(): void {
    this.touch();
  }

  private touch(): void {
    this.saved = true;
  }

  private saved = false;
}

/** The type `Store.index` is declared as, so a call written on that field has a declaration to reach. */
export class Index {
  insert(item: Item): void {
    item.save();
  }

  size(): number {
    return this.entries.length;
  }

  private readonly entries: Item[] = [];
}

/** The shape ioredis writes as `false | SubscriptionSet`, where the guard is what makes the call legal. */
export class SubscriptionSet {
  add(channel: string): void {
    this.channels.push(channel);
  }

  private readonly channels: string[] = [];
}
