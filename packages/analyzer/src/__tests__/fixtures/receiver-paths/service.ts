// Every way a receiver's type can be written down, in one class, so each rule can be scored on its own arm.

import { Index, Item } from './model';
import { Store } from './store';

export class Service {
  // A parameter property: the modifier makes the parameter a field, and the annotation is the field's type.
  constructor(private readonly store: Store) {}

  // One hop through a parameter property, then a field of the class it names, then the member.
  throughConstructor(item: Item): void {
    this.store.index.insert(item);
  }

  // A local bound to a `new` expression is an instance of what it constructed.
  throughConstruction(item: Item): void {
    const scoped = new Index();
    scoped.insert(item);
  }

  // A local bound to `this` is the enclosing object. `_this` is the name ioredis writes, and unlike `self` it is not
  // one of the receivers every language reads as the enclosing object - so the alias has to be resolved, not guessed.
  throughAlias(): void {
    const _this = this;
    _this.helper();
  }

  // A local with an annotation says its own type, whatever the initialiser returns.
  throughAnnotation(item: Item): void {
    const chosen: Index = this.pick();
    chosen.insert(item);
  }

  // A field of this class, which is the one-hop case the rule started as.
  throughField(item: Item): void {
    this.local.insert(item);
  }

  private readonly local: Index = new Index();

  private pick(): Index {
    return this.local;
  }

  private helper(): void {}
}
