// A base named with an argument, and a contract merged into a class the way ioredis merges its command table in.

export class Base<T> {
  dispatch(value: T): void {
    this.step(value);
  }

  private step(_value: T): void {}
}

// `extends Base<T>` names `Base`; the argument is not part of the name, and a rule that read the whole text would
// find no class called `Base<T>` and lose the base entirely.
export class Child extends Base<number> {
  run(): void {
    this.dispatch(1);
  }
}

export interface CommandBase {
  ping(): void;
}

// Declaration merging: the class declares `run`, the interface contributes the `extends` clause that reaches
// `CommandBase`. A class that names no base still has one, because the interface it is merged with names it.
interface CommandSet extends CommandBase {}

export class CommandSet {
  run(): void {
    this.ping();
  }
}

// The negative case beside the positive one: nothing links `Outsider` to `Unrelated`, so `this.begin()` has no
// declaration to reach and must not be resolved to the contract's member by name.
export interface Unrelated {
  begin(): void;
}

export class Outsider {
  go(): void {
    this.begin();
  }
}
