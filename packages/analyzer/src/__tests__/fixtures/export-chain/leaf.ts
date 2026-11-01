// The declaration every barrel in this fixture publishes, and nothing else.
//
// **`leafIdle` is declared here and published by nobody.** It exists so the negative cases can name a real declaration
// that a barrel does not carry: an import that asks for it must resolve to nothing rather than to the nearest
// declaration in the file the barrel points at.

export function leafRun(): number {
  return 1;
}

export function leafIdle(): number {
  return 0;
}

export class Leaf {
  sample(): number {
    return leafRun();
  }
}
