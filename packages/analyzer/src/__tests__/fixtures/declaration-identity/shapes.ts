// The member kinds a TypeScript parser can mistake for declarations, and the ones it must not.
//
// **A method of an object literal is not a declaration of a class member.** `const routes = { handler() {} }`
// declares a property of an object; it is reachable only through the object, so filing it as `Method` gives the graph
// a member nothing holds and a name that competes with every real `handler` in the file.
//
// **A prototype assignment declares a member of the class it names.** `Repo.prototype.load = function () {}` is the
// pre-class way of writing `Repo.load`, and its enclosing container is `Repo` - not the file.

export class Repo {
  load(): string {
    return 'class';
  }
}

export const routes = {
  handler(): string {
    return 'literal';
  },
};

export interface Store {
  load(): string;
}

export const store: Store = {
  load(): string {
    return 'store';
  },
};

export function Repo_prototype(): void {
  // Left for the type system to reject: the fixture is parsed, not compiled.
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Legacy: any;

Legacy.prototype.fetchAll = function fetchAll(): string {
  return 'prototype';
};
