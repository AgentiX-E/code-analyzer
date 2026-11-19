// The constructs a JavaScript review meets: default exports, generators, destructuring and private methods.

export const LIMIT = 10;

export let counter = 0;

export var legacy = null;

export function named() {
  return LIMIT;
}

export async function load(url) {
  return fetch(url);
}

export function* walk(node) {
  yield node;
}

export async function* stream(source) {
  for await (const chunk of source) yield chunk;
}

export class Widget {
  #secret = 0;

  #bump() {
    this.#secret += 1;
  }

  render() {
    this.#bump();
    return this.#secret;
  }
}

export class Panel extends Widget {}

export default class Shell {
  mount(root) {
    root.append(document.createElement('div'));
  }
}

const local = () => 1;

module.exports = { local };
