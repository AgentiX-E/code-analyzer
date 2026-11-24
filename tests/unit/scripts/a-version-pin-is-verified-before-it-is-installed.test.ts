// **A version pin is not a pin.** `npm install -g pkg@1.2.3` names a version and trusts the registry to serve the same
// bytes under it - which is the class `PinnedDependenciesID` reported on every install line of the jobs that produce the
// competitor figures. `scripts/install-pinned.mjs` fetches the version document, checks the tarball against the
// integrity the registry published, and installs from the file it checked.
//
// **The order is the claim**, so the tests are written around it: an install that runs first and a verification that
// runs after has measured the wrong thing whatever it reports.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  fetchPinned,
  installPinned,
  parseSpec,
  verifyIntegrity,
} from '../../../scripts/install-pinned.mjs';

// **A string, not a `Buffer`, for the response body.** A `Buffer` is a view onto a pooled `ArrayBuffer`, and a
// `Response` built from one can hand back the pool rather than the view - which is exactly the kind of quiet
// disagreement between bytes and hash that this file exists to refuse.
const BYTES = 'the bytes that were published';
const DIGEST = createHash('sha512').update(Buffer.from(BYTES, 'utf8')).digest('base64');

/** A registry that answers the two requests, and a fetch that never touches the network. */
function registry({
  version = '1.2.3',
  // **`null` means the document carries no integrity at all**, which a default parameter cannot express: passing
  // `undefined` would silently take the default and the test would check the happy path twice.
  integrity = `sha512-${DIGEST}` as string | null,
  tarballBytes = BYTES,
  metaStatus = 200,
  tarballStatus = 200,
  meta = {},
} = {}) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(String(url));
    // **The tarball is recognised by its extension, not by a substring of its name.** The first version of this fixture
    // matched `/tarball` against a URL containing `pkg-tarball.tgz`, served the metadata document for the tarball
    // request instead, and **the only reason it failed loudly was the integrity check** - which is the property the file
    // is for, demonstrated by accident.
    if (String(url).endsWith('.tgz')) {
      return new Response(tarballBytes, { status: tarballStatus });
    }
    if (metaStatus !== 200) return new Response('{}', { status: metaStatus });
    return new Response(
      JSON.stringify({
        version,
        dist: {
          tarball: 'https://registry.invalid/pkg/-/pkg.tgz',
          ...(integrity === null ? {} : { integrity }),
          ...meta,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { calls, fetchImpl };
}

describe('the spec names a package and a version', () => {
  it('splits at the last @, so a scope is not read as a version', () => {
    expect(parseSpec('@alibaba-group/open-code-review@1.13.8')).toEqual({
      ok: true,
      name: '@alibaba-group/open-code-review',
      version: '1.13.8',
    });
    expect(parseSpec('greptile@3.8.0')).toEqual({ ok: true, name: 'greptile', version: '3.8.0' });
    // **A bare name is still recorded as `latest`**, because "whatever latest was that day" is exactly the version this
    // file exists to stop being installed.
    expect(parseSpec('node-gyp')).toEqual({ ok: true, name: 'node-gyp', version: 'latest' });
    expect(parseSpec('  ').ok).toBe(false);
  });
});

describe('the bytes are checked against the published integrity', () => {
  it('accepts the published hash', () => {
    expect(verifyIntegrity(Buffer.from(BYTES, 'utf8'), `sha512-${DIGEST}`)).toMatchObject({
      ok: true,
      algorithm: 'sha512',
    });
  });

  it('refuses a tarball that hashes to something else, and says both numbers', () => {
    const outcome = verifyIntegrity(Buffer.from('different bytes', 'utf8'), `sha512-${DIGEST}`);
    expect(outcome.ok).toBe(false);
    // **Both values, because "integrity mismatch" is a sentence a reader cannot check** and the two hashes are the
    // whole of what the check computed.
    expect(outcome.reason).toContain(`sha512-${DIGEST}`);
    expect(outcome.reason).toContain('hashes to sha512-');
  });

  it('refuses an integrity it cannot compute rather than substituting one', () => {
    // A verifier that silently swaps the algorithm is a verifier that always agrees, which is why the algorithm is read
    // from the string and an unknown one is a refusal.
    const bytes = Buffer.from(BYTES, 'utf8');
    expect(verifyIntegrity(bytes, 'sha999-abc').ok).toBe(false);
    expect(verifyIntegrity(bytes, 'no-dash-here').ok).toBe(false);
    expect(verifyIntegrity(bytes, '').ok).toBe(false);
  });

  it('accepts any of several published hashes', () => {
    // npm publishes one, but the format is a space-separated list and a package that lists two must not be refused for
    // listing the other one first.
    expect(verifyIntegrity(Buffer.from(BYTES, 'utf8'), `sha1-AAAA sha512-${DIGEST}`).ok).toBe(true);
  });
});

describe('a version document without an integrity is a refusal', () => {
  it('refuses rather than warning', async () => {
    const { fetchImpl } = registry({ integrity: null });
    const outcome = await fetchPinned({ spec: 'pkg@1.2.3', fetchImpl });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('no tarball and integrity pair');
  });

  it('reports a 404 as a status, because that is the one outcome an optional probe may continue from', async () => {
    const { fetchImpl } = registry({ metaStatus: 404 });
    const outcome = await fetchPinned({ spec: 'greptile@3.8.0', fetchImpl });
    expect(outcome).toMatchObject({ ok: false, status: 404 });
  });

  it('returns the bytes, the version the registry resolved and the integrity it checked', async () => {
    const { fetchImpl, calls } = registry({ version: '1.2.3' });
    const outcome = await fetchPinned({ spec: 'pkg@1.2.3', fetchImpl });
    expect(outcome).toMatchObject({
      ok: true,
      name: 'pkg',
      version: '1.2.3',
      integrity: `sha512-${DIGEST}`,
    });
    // **Two requests, in this order**: the document that names the tarball, then the tarball itself.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/pkg/1.2.3');
    expect(calls[1] ?? '').toMatch(/\.tgz$/);
  });
});

describe('the install reads from the file that was checked', () => {
  it('writes the verified bytes and hands that path to npm', async () => {
    const { fetchImpl } = registry();
    const installed: string[] = [];
    const outcome = await installPinned({
      spec: 'pkg@1.2.3',
      fetchImpl,
      install: (file: string) => installed.push(file),
      log: () => {},
    });
    expect(outcome.ok).toBe(true);
    expect(installed).toHaveLength(1);
    expect(installed[0] ?? '').toContain('pkg-1.2.3.tgz');
    // **The file is gone afterwards**, because a verified tarball left on disk is a tarball the next step can install
    // from without verifying it.
    const { existsSync } = await import('node:fs');
    expect(existsSync(installed[0] ?? '')).toBe(false);
  });

  it('never installs when the hash is wrong', async () => {
    const { fetchImpl } = registry({ tarballBytes: 'tampered' });
    const installed: string[] = [];
    const outcome = await installPinned({
      spec: 'pkg@1.2.3',
      fetchImpl,
      install: (file: string) => installed.push(file),
      log: () => {},
    });
    expect(outcome.ok).toBe(false);
    expect(installed).toHaveLength(0);
  });

  it('continues past an absence and not past a failure', async () => {
    const absent = registry({ metaStatus: 404 });
    const skipped = await installPinned({
      spec: 'greptile@3.8.0',
      fetchImpl: absent.fetchImpl,
      install: (): never => expect.unreachable('an absent package must not be installed'),
      log: () => {},
      optional: true,
    });
    expect(skipped).toMatchObject({ ok: true, skipped: true });

    const broken = registry({ metaStatus: 500 });
    const failed = await installPinned({
      spec: 'greptile@3.8.0',
      fetchImpl: broken.fetchImpl,
      install: (): never => expect.unreachable('a 500 is not an absence'),
      log: () => {},
      optional: true,
    });
    expect(failed.ok).toBe(false);
    expect(failed.status).toBe(500);
  });
});
