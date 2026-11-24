// @code-analyzer — the verified installer, declared for the callers that typecheck it

/** A package spec split into a name and a version; `latest` when the spec names no version. */
export interface ParsedSpec {
  readonly ok: boolean;
  readonly name?: string;
  readonly version?: string;
  readonly reason?: string;
}

/** What a fetch answered, in the shape `install-pinned` reads. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

/** The outcome of verifying bytes against a published integrity string. */
export interface IntegrityOutcome {
  readonly ok: boolean;
  readonly algorithm?: string;
  readonly digest?: string;
  readonly reason?: string;
}

/** The bytes a version document describes, or the reason there are none. */
export interface PinnedTarball extends IntegrityOutcome {
  readonly name?: string;
  readonly version?: string;
  readonly tarball?: string;
  readonly integrity?: string;
  readonly bytes?: Buffer;
  readonly status?: number;
}

/** What an install did. */
export interface InstallOutcome extends IntegrityOutcome {
  readonly skipped?: boolean;
  readonly name?: string;
  readonly version?: string;
  readonly integrity?: string;
  readonly file?: string;
  readonly status?: number;
}

/** The registry this file reads when no other is given. */
export const DEFAULT_REGISTRY: string;

/** Splits a spec at its last `@`, so a scope is not read as a version. */
export function parseSpec(spec: string): ParsedSpec;

/** True when any published hash matches the bytes. */
export function verifyIntegrity(bytes: Buffer, integrity: string): IntegrityOutcome;

/** The tarball and the hash that describes it, from the registry's own metadata. */
export function fetchPinned(options: {
  spec: string;
  registry?: string;
  fetchImpl?: FetchLike;
}): Promise<PinnedTarball>;

/** Verifies, writes the verified bytes, and installs from that file. */
export function installPinned(options: {
  spec?: string;
  registry?: string;
  fetchImpl?: FetchLike;
  install?: (file: string) => void;
  log?: (line: string) => void;
  optional?: boolean;
}): Promise<InstallOutcome>;
