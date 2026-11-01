// @code-analyzer/analyzer — `this` past a closure: the scope that preserves it, and the two that do not.
//
// The shape is everywhere in TypeScript and JavaScript: a method starts something asynchronous, hands the work to an
// arrow function, and the arrow calls a member of the object the method belongs to.
// `redis/ioredis@5.4.2` writes it four times in one method — `const readyHandler = () => { this.setStatus("ready") … }`
// inside `Cluster.connect` — and the file-level member index answered all four, because `setStatus` is declared once in
// that file and the receiver was never read. That index is gone for own-scope receivers (it also answered
// `this.begin()` with an unrelated class' `begin`), so the question is now asked of the scope chain: **the innermost
// enclosing declaration whose container is a class, reached only through the scopes that keep `this`.**
//
// An arrow function keeps it. A `function` expression does not — `this` there is whatever the call site makes it — so
// the walk stops at one and answers nothing, which is the negative case below.

export class Counter {
  private total = 0;

  bump(): void {
    this.total += 1;
  }

  connect(): void {
    // One arrow, in a method body: `this` is the instance.
    const onReady = (): void => {
      this.bump();
    };

    // Two arrows, one of them inside a promise executor: still the instance.
    new Promise<void>((resolve) => {
      const onClose = (): void => {
        this.bump();
      };
      setTimeout(() => {
        onClose();
        resolve();
        onReady();
      }, 0);
    });
  }
}

export class Plain {
  bump(): void {}

  connect(): void {
    // A function expression binds its own `this`, so the enclosing class is not the receiver of `this.bump()`.
    const onSpawn = function (this: unknown): void {
      this.bump();
    };
    onSpawn.call({});
  }
}
