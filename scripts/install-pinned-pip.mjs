// @code-analyzer — install a Python distribution at a version whose bytes are verified before anything runs
//
// **The same finding as `install-pinned.mjs`, one ecosystem over.** `pip install pyarrow==26.0.1` names a version and
// trusts the index to serve the same bytes under it, which is what `PinnedDependenciesID` reports on the three Python
// install lines in this repository's workflows.
//
// **The order is different here, and the difference is the point.** npm resolves a single tarball from a version
// document, so this repository's npm path can fetch, verify and install in that order. **pip resolves a *set* of files
// against the interpreter's platform and ABI**, and re-implementing that resolution would be a second resolver that
// disagrees with the first.
//
// **So pip does the resolution and this file does the checking**:
//
// 1. `pip download --no-deps --dest <dir> <spec>` - resolution, without installing anything;
// 2. every downloaded file is hashed and matched against the digest the index publishes for that filename;
// 3. `pip install --no-deps <verified files>` - an install that reads only files somebody checked.
//
// **`--no-deps` is deliberate and is a limitation stated rather than hidden**: a dependency graph installed without
// verification would be the same defect one level down, and the call sites here pin single self-contained tools. A
// transitive graph would need the index's JSON API for every node, which is a different piece of work.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The index, overridable so a test can serve a document without a network. */
export const DEFAULT_PYPI = 'https://pypi.org/pypi';

/**
 * **`name` and `version` from `name==version`, or the reason the spec is not one.**
 *
 * A Python pin is `==` and nothing else here: `>=`, `~=` and a bare name are all *ranges*, and a range is what this file
 * exists to refuse. **A spec that names no version is refused rather than defaulted to the newest**, because "the newest
 * that day" is exactly the version a reproducibility claim cannot survive.
 */
export function parsePipSpec(spec) {
  const text = String(spec ?? '').trim();
  const at = text.indexOf('==');
  if (at <= 0) return { ok: false, reason: `"${text}" is not an exact pin (name==version)` };
  const name = text.slice(0, at).trim();
  const version = text.slice(at + 2).trim();
  if (version.length === 0) return { ok: false, reason: `"${text}" pins no version` };
  // **An extras marker or an environment marker is a different install**, and this file has no way to verify one.
  if (/[;\s\[]/.test(name) || /[;\s]/.test(version)) {
    return {
      ok: false,
      reason: `"${text}" carries extras or a marker, which this file cannot verify`,
    };
  }
  return { ok: true, name, version };
}

/**
 * **The digests the index publishes for one release, by filename.**
 *
 * The `urls` array is the release's files; `digests.sha256` is the hash of each. **A release whose document lists no
 * files is a refusal**, because then there is nothing to check a download against - and the download is about to happen.
 */
export async function publishedDigests({ name, version, index = DEFAULT_PYPI, fetchImpl = fetch }) {
  const url = `${index.replace(/\/$/, '')}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  let document;
  try {
    const res = await fetchImpl(url);
    if (!res.ok)
      return { ok: false, status: res.status, reason: `the index answered ${String(res.status)}` };
    document = await res.json();
  } catch (error) {
    return { ok: false, reason: `the index request failed: ${String(error?.message ?? error)}` };
  }
  const files = Array.isArray(document?.urls) ? document.urls : [];
  const byName = new Map();
  for (const file of files) {
    if (typeof file?.filename !== 'string') continue;
    const digest = file?.digests?.sha256;
    if (typeof digest === 'string' && digest.length === 64)
      byName.set(file.filename, digest.toLowerCase());
  }
  if (byName.size === 0) {
    return { ok: false, reason: 'the release document published no sha256 for any file' };
  }
  return { ok: true, files: byName, version: String(document?.info?.version ?? version) };
}

/** `sha256` of a file's bytes, lowercase hex, which is the form the index publishes. */
export function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * **Download, verify every file, then install the verified ones.**
 *
 * **`--no-deps` on both calls**, so the set that is verified is the set that is installed and no resolver runs between
 * the check and the install. A file pip produced that the index did not publish a digest for is a refusal: an artifact
 * built locally during the download is not something the index can vouch for.
 */
export async function installPipPinned({
  spec,
  index = DEFAULT_PYPI,
  fetchImpl = fetch,
  download = (spec, dir) =>
    execFileSync('python3', ['-m', 'pip', 'download', '--no-deps', '--dest', dir, spec], {
      stdio: 'inherit',
    }),
  install = (files) =>
    execFileSync('python3', ['-m', 'pip', 'install', '--no-deps', ...files], { stdio: 'inherit' }),
  log = (line) => console.log(line),
  optional = false,
  // **Both injectable, both defaulting to the real thing.** `digestOf` hashes the file's bytes; a default that skipped
  // hashing would be a verifier that verifies nothing, which is the defect this file exists to remove.
  listDir = (dir) => readdirSync(dir),
  digestOf = (path) => sha256Of(readFileSync(path)),
}) {
  const parsed = parsePipSpec(spec);
  if (parsed.ok === false) return parsed;
  const published = await publishedDigests({
    name: parsed.name,
    version: parsed.version,
    index,
    fetchImpl,
  });
  if (published.ok === false) {
    if (optional && published.status === 404) {
      log(`install-pinned: ${spec} is not published at that version - skipped (optional)`);
      return { ok: true, skipped: true, reason: published.reason };
    }
    return published;
  }
  const dir = mkdtempSync(join(tmpdir(), 'pip-pinned-'));
  try {
    download(spec, dir);
    const names = listDir(dir).filter((name) => !name.startsWith('.'));
    if (names.length === 0) return { ok: false, reason: 'the download produced no file' };
    const verified = [];
    for (const name of names) {
      const expected = published.files.get(name);
      if (expected === undefined) {
        return {
          ok: false,
          reason: `the index published no sha256 for ${name}, which pip downloaded`,
        };
      }
      const digest = digestOf(join(dir, name)).toLowerCase();
      if (digest !== expected) {
        return {
          ok: false,
          reason: `${name} hashes to sha256-${digest}, and the index published ${expected}`,
        };
      }
      verified.push({ name, sha256: expected });
    }
    const files = verified.map((entry) => join(dir, entry.name));
    log(
      `install-pinned: ${parsed.name}==${published.version} · ` +
        verified.map((entry) => `${entry.name} sha256-${entry.sha256}`).join(' · ') +
        ' verified',
    );
    install(files);
    return { ok: true, name: parsed.name, version: published.version, files: verified };
  } finally {
    // **The downloaded files do not outlive the install**, because a verified file left behind is a file the next step
    // can install from without verifying it.
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('install-pinned-pip.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const optional = args.includes('--optional');
  const spec = args.find((arg) => !arg.startsWith('--'));
  const outcome = await installPipPinned({ spec, optional });
  if (outcome.ok === false) {
    console.error(`install-pinned: ${spec ?? '(no spec)'} failed - ${outcome.reason}`);
    process.exit(1);
  }
}
