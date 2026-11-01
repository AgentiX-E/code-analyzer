// A local value that shares its name with a class, which is the case a name-level rule gets wrong.

export class Registry {
  put(key: string): void {
    this.keys.push(key);
  }

  private readonly keys: string[] = [];
}

export class Caller {
  run(): void {
    // The binding is a value, not the class. `Registry.put(...)` is a call on the object literal, and the class's
    // `put` is a declaration this file names but this call does not reach.
    const Registry = { put: (key: string): string => key };
    Registry.put('a');
  }
}
