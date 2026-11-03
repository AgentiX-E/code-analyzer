// @code-analyzer/analyzer — the two class spellings the walk did not file, and the scopes a `this` survives.
//
// `colinhacks/zod@3.23.8` declares its entire type system on `export abstract class ZodType<…>` and
// `redis/ioredis@v5.4.2` declares `AbstractConnector` the same way, so every member of those classes was a member of
// nothing. And ioredis writes its `Script` class as an *expression* inside a constructor, so its members belonged to
// whatever class contained the expression.

export abstract class Shape {
  protected readonly bounds: Bounds;

  abstract area(): number;

  describe(): number {
    // A member of the abstract class itself, called on `this`.
    return this.area();
  }

  measure(): number {
    // An arrow keeps `this`, and the field is read through it.
    const read = (): number => this.bounds.half();
    return read();
  }

  rebound(): number {
    // A function expression rebinds `this`, so `this.bounds` here is not this instance's and the walk refuses it.
    const read = function (this: unknown): number {
      return this.bounds.half();
    };
    return read.call({});
  }
}

export class Circle extends Shape {
  area(): number {
    return 1;
  }
}

export class Factory {
  private readonly bounds = new Bounds(1);

  make(): Shape {
    // **A class expression is a class**, and its base is read from its own heritage clause.
    return class Inline extends Shape {
      area(): number {
        return this.bounds.half();
      }
    };
  }

  measure(): number {
    // **A field initialised by a construction holds that class**, and the call is answered through it.
    return this.bounds.half();
  }
}

export class Bounds {
  constructor(readonly width: number) {}

  half(): number {
    return this.width / 2;
  }
}
