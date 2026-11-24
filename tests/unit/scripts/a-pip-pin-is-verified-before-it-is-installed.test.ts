// **The same finding as the npm installer, and a different order because the resolver is different.**
//
// npm resolves one tarball from a version document, so `install-pinned.mjs` can fetch, verify and install in that order.
// pip resolves a *set* of files against the interpreter's platform and ABI, and re-implementing that resolution would be
// a second resolver that disagrees with the first.
//
// So pip resolves (`pip download --no-deps --dest`), this file hashes every downloaded file against the digest the index
// publishes for that filename, and only then does pip install - from those files and nothing else. **`--no-deps` on both
// calls is what keeps the verified set and the installed set the same set.**

import { mkdirSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  installPipPinned,
  parsePipSpec,
  publishedDigests,
  sha256Of,
} from '../../../scripts/install-pinned-pip.mjs';

const WHEEL = 'pyarrow-26.0.1-cp311-cp311-manylinux_2_28_x86_64.whl';
const BYTES = Buffer.from('the wheel that was published', 'utf8');
const DIGEST = sha256Of(BYTES);

/** An index that publishes one file, and a fetch that never touches the network. */
function index({ files = { [WHEEL]: DIGEST }, status = 200 } = {}) {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        info: { version: '26.0.1' },
        urls: Object.entries(files).map(([filename, sha256]) => ({
          filename,
          digests: { sha256 },
        })),
      }),
      { status, headers: { 'content-type': 'application/json' } },
    );
  return { fetchImpl };
}

/** A download that writes the file into the temp directory the installer made, and an install that records its paths. */
function runner({ bytes = BYTES } = {}) {
  const installed: string[][] = [];
  return {
    installed,
    download: (_spec: string, dir: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${WHEEL}`, bytes);
    },
    install: (files: string[]) => installed.push(files),
  };
}

describe('a python pin is `==` and nothing else', () => {
  it('reads name and version, and refuses a range', () => {
    expect(parsePipSpec('pyarrow==26.0.1')).toEqual({
      ok: true,
      name: 'pyarrow',
      version: '26.0.1',
    });
    expect(parsePipSpec('pr-agent==0.50.0')).toEqual({
      ok: true,
      name: 'pr-agent',
      version: '0.50.0',
    });
    // **A range is the defect the file exists to refuse**, and a bare name is a range whose upper bound is the newest
    // thing published that day.
    expect(parsePipSpec('pyarrow>=26').ok).toBe(false);
    expect(parsePipSpec('pyarrow').ok).toBe(false);
    expect(parsePipSpec('pyarrow==').ok).toBe(false);
    // **Extras and markers change what is installed**, so a pin carrying one is not a pin this file can verify.
    expect(parsePipSpec('uvicorn[standard]==0.30.0').ok).toBe(false);
    expect(parsePipSpec('pyarrow==26.0.1 ; python_version>"3.10"').ok).toBe(false);
  });
});

describe('the index publishes the digest, by filename', () => {
  it('returns the sha256 of every file in the release', async () => {
    const { fetchImpl } = index();
    const published = await publishedDigests({ name: 'pyarrow', version: '26.0.1', fetchImpl });
    expect(published.ok).toBe(true);
    expect(published.files?.get(WHEEL)).toBe(DIGEST);
  });

  it('refuses a release that publishes no digest at all', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ info: {}, urls: [{ filename: WHEEL, digests: {} }] }), {
        status: 200,
      });
    const published = await publishedDigests({ name: 'x', version: '1', fetchImpl });
    expect(published.ok).toBe(false);
    expect(published.reason).toContain('no sha256 for any file');
  });
});

describe('the install reads only files that were checked', () => {
  it('verifies the download and installs exactly those paths', async () => {
    const { fetchImpl } = index();
    const { installed, download, install } = runner();
    const outcome = await installPipPinned({
      spec: 'pyarrow==26.0.1',
      fetchImpl,
      download,
      install,
      log: () => {},
      digestOf: () => DIGEST,
    });
    expect(outcome.ok).toBe(true);
    expect(installed).toHaveLength(1);
    expect(installed[0]?.[0]).toContain(WHEEL);
  });

  it('refuses a wheel whose bytes differ from the published digest, and installs nothing', async () => {
    const { fetchImpl } = index();
    const { installed, download, install } = runner();
    const outcome = await installPipPinned({
      spec: 'pyarrow==26.0.1',
      fetchImpl,
      download,
      install,
      log: () => {},
      digestOf: () => 'f'.repeat(64),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain(DIGEST);
    expect(installed).toHaveLength(0);
  });

  it('refuses a file pip produced that the index never published a digest for', async () => {
    // **A locally built artifact is not something the index can vouch for**, and installing it would be the same defect
    // one level down: the set that was checked and the set that ran would differ.
    const { fetchImpl } = index();
    const { installed, install } = runner();
    const outcome = await installPipPinned({
      spec: 'pyarrow==26.0.1',
      fetchImpl,
      download: (_spec: string, dir: string) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/pyarrow-26.0.1.tar.gz`, BYTES);
      },
      install,
      log: () => {},
      digestOf: () => DIGEST,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('published no sha256');
    expect(installed).toHaveLength(0);
  });
});
