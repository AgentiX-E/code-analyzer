import { exists } from '@ioredis/commands';

declare function makeLogger(): (message: string) => void;

/** A module-level value binding: `redis/ioredis` writes `const debug = Debug("redis")` in exactly this shape. */
const logging = makeLogger();

export class Store {
  exists(key: string): boolean {
    return key.length > 0;
  }

  logging(message: string): void {
    void message;
  }

  /** A bare call the file imports: the import binds the name, so this is not `this.exists`. */
  check(key: string): boolean {
    return exists(key);
  }

  /** A bare call the module binds to a value: the member of the same name is not what runs. */
  report(): void {
    logging('store');
  }

  /** A call on the object itself: this is the member, and it is the arm's whole purpose. */
  verify(key: string): boolean {
    return this.exists(key);
  }
}
