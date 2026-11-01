/** A contract, and one implementation of it. */

export interface Repository {
  find(id: string): string;
  save(value: string): void;
}

export class MemoryRepository implements Repository {
  private readonly rows: string[] = [];

  find(id: string): string {
    return this.rows[id.length] ?? id;
  }

  save(value: string): void {
    this.rows.push(value);
  }
}

/** A function whose receiver is a contract, which is the shape a member node exists for. */
export function load(repository: Repository, id: string): string {
  return repository.find(id);
}

/** A contract member with a computed name: `[Symbol.iterator]` is not a name the graph can store. */
export interface Iterable {
  [Symbol.iterator](): Iterator<string>;
}

/** A contract written inside a parameter type, which no named container holds. */
export declare function register(handlers: { run(): void }): void;
