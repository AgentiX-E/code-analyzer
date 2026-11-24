// @code-analyzer — the verified pip installer, declared for the callers that typecheck it

/** A python spec split into a name and a version; a range or a marker is a refusal. */
export interface ParsedPipSpec {
  readonly ok: boolean;
  readonly name?: string;
  readonly version?: string;
  readonly reason?: string;
}

/** What a fetch answered, in the shape this installer reads. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** The digests one release publishes, by filename. */
export interface PublishedDigests {
  readonly ok: boolean;
  readonly files?: Map<string, string>;
  readonly version?: string;
  readonly status?: number;
  readonly reason?: string;
}

/** What an install did. */
export interface PipInstallOutcome {
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly name?: string;
  readonly version?: string;
  readonly files?: readonly { readonly name: string; readonly sha256: string }[];
  readonly status?: number;
  readonly reason?: string;
}

/** The index this file reads when no other is given. */
export const DEFAULT_PYPI: string;

/** Splits `name==version`, and refuses anything that is not an exact pin. */
export function parsePipSpec(spec: string): ParsedPipSpec;

/** The sha256 the index publishes for every file of one release. */
export function publishedDigests(options: {
  name: string;
  version: string;
  index?: string;
  fetchImpl?: FetchLike;
}): Promise<PublishedDigests>;

/** Lowercase hex `sha256` of some bytes, which is the form the index publishes. */
export function sha256Of(bytes: Buffer): string;

/** Downloads, verifies every file, then installs the verified ones. */
export function installPipPinned(options: {
  spec?: string;
  index?: string;
  fetchImpl?: FetchLike;
  download?: (spec: string, dir: string) => void;
  install?: (files: string[]) => void;
  log?: (line: string) => void;
  optional?: boolean;
  listDir?: (dir: string) => string[];
  digestOf?: (path: string) => string;
}): Promise<PipInstallOutcome>;
