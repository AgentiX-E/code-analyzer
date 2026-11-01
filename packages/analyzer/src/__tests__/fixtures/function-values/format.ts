/** The callees. Imported by `binding.ts`, so every call below is a cross-file call. */

export function toArray(value: string): string[] {
  return [value];
}

export function toSet(value: string): Set<string> {
  return new Set([value]);
}
