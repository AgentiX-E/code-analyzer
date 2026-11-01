// A store whose field carries the type a two-hop receiver needs, one of them through a union.

import { Index, Item, SubscriptionSet } from './model';

export class Store {
  readonly index: Index = new Index();

  subscriber: false | SubscriptionSet = false;

  add(item: Item): void {
    this.index.insert(item);
  }

  subscribe(channel: string): void {
    if (this.subscriber) {
      // The guard is what narrows `false | SubscriptionSet` to the set; the annotation is all a resolver reads.
      this.subscriber.add(channel);
    }
  }
}
