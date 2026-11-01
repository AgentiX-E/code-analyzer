// A file that declares what it also re-exports. The declaration wins, because a local name shadows a published one.
export * from './collide-a';

export function clash(): number {
  return 4;
}
