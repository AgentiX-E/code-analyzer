// The embedding backend status, and the property that matters most: absence is not failure.
//
// The ONNX model is not in the published package, so this reports `available: false` on a fresh install and in CI.
// Exiting non-zero for that would leave the build permanently red until a third-party package ships a 137MB file,
// which is how a red job becomes a job people ignore. The exit code reports whether the check ran; `available`
// reports whether the model is there — and the two are different questions.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const SCRIPT = 'scripts/embedding-backend-status.js';

interface Status {
  packageInstalled: boolean;
  packageVersion: string | null;
  modelPresent: boolean;
  available: boolean;
  reason: string | null;
}

describe('embedding-backend-status', () => {
  it('reports the state as JSON and exits zero whether or not the model is present', () => {
    // execFileSync throws on a non-zero exit, so reaching the assertions at all is half the test.
    const out = execFileSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf-8' });
    const status = JSON.parse(out) as Status;

    expect(typeof status.available).toBe('boolean');
    expect(typeof status.modelPresent).toBe('boolean');
  });

  it('finds the package installed, which the fallback decision depends on', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf-8' });
    const status = JSON.parse(out) as Status;

    // The package is a declared dependency of analyzer and intelligence, so it is present in an installed tree.
    expect(status.packageInstalled).toBe(true);
    expect(status.packageVersion).not.toBeNull();
  });

  it('reports a reason whenever the backend is unavailable', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf-8' });
    const status = JSON.parse(out) as Status;

    if (!status.available) expect(status.reason).not.toBeNull();
    if (status.available) expect(status.modelPresent).toBe(true);
  });

  it('prints the human summary without the JSON flag', () => {
    const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf-8' });

    expect(out).toMatch(/embedding backend: (onnx|deterministic \(fallback\))/);
  });
});
