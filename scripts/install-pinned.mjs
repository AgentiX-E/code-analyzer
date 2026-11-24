// @code-analyzer — install a tool from npm at a version whose bytes are verified before anything runs
//
// **A version pin is not a pin.** `npm install -g pkg@1.2.3` names a version, and the registry is free to serve different
// bytes under that version - which is the class `PinnedDependenciesID` reports, twelve times in this repository, on the
// install lines of the jobs that produce the competitor figures. A figure produced by an installer nobody verified is a
// figure about an unknown program.
//
// **So the bytes are checked against the registry's own published integrity, and the install reads from the file that
// was checked.** The order matters: verify, then install from the verified file - an install that runs first and a
// verification that runs after it has measured the wrong thing, whatever it reports.
//
// **`--optional` exists because three of the call sites are probes rather than requirements.** `greptile`, `auggie` and
// `kodus` are installed to see whether a competitor can be run at all, and the workflows already say so (`|| echo "…"`).
// An absence is a fact those steps report and continue from; a *mismatch* is never continued from, because a tarball
// whose hash is not the published one is not the package anybody asked for.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The registry, overridable so a test can serve a response without a network. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/**
 * **A name and a version, from one argument.**
 *
 * Split at the last `@`, not the first: `@alibaba-group/open-code-review@1.13.8` has two, and a split at the first would
 * read the scope as the version. A bare name has one `@` or none, and the caller's default is `latest` - which is still
 * recorded in the artifact's install line, because *"whatever latest was that day"* is exactly the version this file
 * exists to stop being installed.
 */
export function parseSpec(spec) {
  const text = String(spec ?? '').trim();
  if (text.length === 0) return { ok: false, reason: 'the install spec is empty' };
  const at = text.lastIndexOf('@');
  if (at <= 0) return { ok: true, name: text, version: 'latest' };
  return { ok: true, name: text.slice(0, at), version: text.slice(at + 1) || 'latest' };
}

/**
 * **Every `algorithm-hash` token in the published integrity, checked against the bytes that arrived.**
 *
 * **The tokens are parsed, not split at the first dash.** npm publishes one token today (`sha512-…`), and the format is
 * a whitespace-separated list - so a string carrying `sha1-… sha512-…` split at its first dash reads `sha1` as the
 * algorithm and the whole of `… sha512-…` as the expected value, which matches nothing and **refuses a package that is
 * intact**. A verifier with that defect is worse than none: it fails closed on packages somebody correctly published two
 * hashes for, and the natural repair is to loosen it.
 *
 * **An algorithm this runtime cannot compute is skipped rather than fatal**, because the question is whether *any*
 * published hash matches; **a string with no parsable token at all is a refusal**, because then nothing was checked.
 */
export function verifyIntegrity(bytes, integrity) {
  const text = String(integrity ?? '').trim();
  const tokens = [...text.matchAll(/([A-Za-z][A-Za-z0-9]*)-([A-Za-z0-9+/=]+)/g)].map((match) => ({
    algorithm: match[1].toLowerCase(),
    expected: match[2],
  }));
  if (tokens.length === 0) {
    return { ok: false, reason: `the registry published no usable integrity ("${text}")` };
  }
  const computed = {};
  for (const token of tokens) {
    if (computed[token.algorithm] === undefined) {
      try {
        computed[token.algorithm] = createHash(token.algorithm).update(bytes).digest('base64');
      } catch {
        computed[token.algorithm] = null;
      }
    }
    if (computed[token.algorithm] === token.expected) {
      return { ok: true, algorithm: token.algorithm, digest: token.expected };
    }
  }
  const computedText = Object.entries(computed)
    .map(([algorithm, digest]) => `${algorithm}-${digest ?? '(not computable)'}`)
    .join(' ');
  return {
    ok: false,
    reason: `the tarball hashes to ${computedText}, and the registry published ${text}`,
    algorithm: tokens[0].algorithm,
    digest: computed[tokens[0].algorithm],
  };
}

/**
 * **The bytes and the hash that describes them, or the reason there are none.**
 *
 * Two requests, both against the registry's own metadata: the version document (which names the tarball and its
 * integrity) and then the tarball. **A version document without an integrity is a refusal**, not a warning - the whole
 * point of the file is that an unverified install does not happen.
 */
export async function fetchPinned({ spec, registry = DEFAULT_REGISTRY, fetchImpl = fetch }) {
  const parsed = parseSpec(spec);
  if (parsed.ok === false) return parsed;
  const url = `${registry.replace(/\/$/, '')}/${parsed.name.replace('/', '%2f')}/${parsed.version}`;
  let meta;
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        reason: `the registry answered ${String(res.status)}`,
      };
    meta = await res.json();
  } catch (error) {
    return { ok: false, reason: `the registry request failed: ${String(error?.message ?? error)}` };
  }
  const tarball = meta?.dist?.tarball;
  const integrity = meta?.dist?.integrity;
  if (typeof tarball !== 'string' || typeof integrity !== 'string') {
    return { ok: false, reason: 'the version document carried no tarball and integrity pair' };
  }
  let bytes;
  try {
    const res = await fetchImpl(tarball);
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        reason: `the tarball answered ${String(res.status)}`,
      };
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    return { ok: false, reason: `the tarball request failed: ${String(error?.message ?? error)}` };
  }
  const checked = verifyIntegrity(bytes, integrity);
  if (checked.ok === false) return checked;
  return {
    ok: true,
    name: parsed.name,
    version: String(meta.version ?? parsed.version),
    tarball,
    integrity,
    bytes,
  };
}

/**
 * **Verify, then install from the verified file.**
 *
 * `npm install -g <file>` reads the same npm this repository already uses, so a lockfile rule, an `npmrc` and a proxy
 * setting all behave as they did before - what changed is where the bytes came from and that somebody checked them.
 */
export async function installPinned({
  spec,
  registry = DEFAULT_REGISTRY,
  fetchImpl = fetch,
  install = (file) =>
    execFileSync('npm', ['install', '-g', '--no-fund', '--no-audit', file], { stdio: 'inherit' }),
  log = (line) => console.log(line),
  optional = false,
}) {
  const pinned = await fetchPinned({ spec, registry, fetchImpl });
  if (pinned.ok === false) {
    // **404 is the only outcome an optional probe may continue from**, because it is the only one that says the package
    // does not exist under that name. A 500, a redirect loop or a hash mismatch are failures about the package that was
    // asked for, and a step that continued past them would report a measurement of something else.
    if (optional && pinned.status === 404) {
      log(`install-pinned: ${spec} is not published under that name - skipped (optional)`);
      return { ok: true, skipped: true, reason: pinned.reason };
    }
    return pinned;
  }
  const dir = mkdtempSync(join(tmpdir(), 'pinned-'));
  try {
    const file = join(dir, `${pinned.name.replace(/[/@]/g, '_')}-${pinned.version}.tgz`);
    writeFileSync(file, pinned.bytes);
    log(
      `install-pinned: ${pinned.name}@${pinned.version} · ${String(pinned.bytes.length)} bytes · ` +
        `${pinned.integrity} verified`,
    );
    install(file);
    return {
      ok: true,
      name: pinned.name,
      version: pinned.version,
      integrity: pinned.integrity,
      file,
    };
  } finally {
    // **The tarball does not outlive the install**, because a verified file left behind is a file the next step can
    // install from without verifying it.
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('install-pinned.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const optional = args.includes('--optional');
  const spec = args.find((arg) => !arg.startsWith('--'));
  const outcome = await installPinned({ spec, optional });
  if (outcome.ok === false) {
    console.error(`install-pinned: ${spec ?? '(no spec)'} failed - ${outcome.reason}`);
    process.exit(1);
  }
}
