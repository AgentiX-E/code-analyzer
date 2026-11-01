import { Commander, Extra } from './merged-base';

export class Holder extends Commander {
  constructor() {
    super();
    Object.entries({ hello: 'world' }).forEach(([name]) => {
      this.defineCommand(name);
    });
  }

  callExtra(): void {
    this.extra();
  }
}

// The second spelling of `Holder`, adding a base the class itself does not name.
// eslint-disable-next-line @typescript-eslint/no-empty-interface -- the merge is the point.
export interface Holder extends Extra {}
