// What the embedding backend can actually do, reported rather than assumed.
//
// `embed.ts` loads the real ONNX backend from `@agentix-e/embed-code-node` first and falls back to a hash-seeded
// vector when it cannot. The package is installed and its `createFromPackage()` points at
// `models/nomic-embed-code-v1.5.int8.onnx` — a file its own tarball does not contain. So the fallback is what
// actually runs, in CI and on a fresh install, and this script says so.
//
// **A missing model is a state, not a failure.** Exiting non-zero here would leave the build permanently red until
// a third-party package publishes a 137MB file, and a permanently red job teaches people to ignore red. The exit
// code reports whether the check itself worked; the `available` field reports whether the model is there.
//
// Usage:  node scripts/embedding-backend-status.js [--json]

'use strict';

async function probe() {
  const result = {
    packageInstalled: false,
    packageVersion: null,
    modelPath: null,
    modelPresent: false,
    available: false,
    reason: null,
  };

  try {
    // Resolved from the package that depends on it, not from this script's directory. pnpm installs a workspace
    // dependency into the dependent package's own node_modules, so resolving from `scripts/` reported "not
    // installed" for a package that was installed — a report that changed with the working directory.
    const { createRequire } = await import('node:module');
    const path = await import('node:path');
    const require = createRequire(
      path.join(process.cwd(), 'packages', 'intelligence', 'package.json'),
    );
    const pkgPath = require.resolve('@agentix-e/embed-code-node/package.json');
    const pkg = require(pkgPath);
    result.packageInstalled = true;
    result.packageVersion = pkg.version ?? null;

    // createFromPackage resolves the model relative to its own dist directory.
    const fs = await import('node:fs');
    const candidate = path.join(path.dirname(pkgPath), 'models', 'nomic-embed-code-v1.5.int8.onnx');
    result.modelPath = candidate;
    result.modelPresent = fs.existsSync(candidate);

    const { NodeEmbedder } = await import('@agentix-e/embed-code-node');
    if (typeof NodeEmbedder?.createFromPackage !== 'function') {
      result.reason = 'the installed package has no createFromPackage()';
      return result;
    }
    const embedder = await NodeEmbedder.createFromPackage();
    result.available = true;
    if (typeof embedder?.dispose === 'function') await embedder.dispose();
  } catch (err) {
    // The model's absence is the ordinary case, and it is already known from `modelPresent`. Reporting the module
    // resolution error instead would name the wrong cause, so the model is named when it is the reason.
    result.reason = result.modelPresent
      ? err instanceof Error
        ? err.message
        : String(err)
      : 'the model nomic-embed-code-v1.5.int8.onnx is not in the installed package';
  }
  return result;
}

probe().then((result) => {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`embedding backend: ${result.available ? 'onnx' : 'deterministic (fallback)'}`);
  console.log(
    `  package: ${result.packageInstalled ? `@agentix-e/embed-code-node ${result.packageVersion}` : 'not installed'}`,
  );
  if (result.modelPath) console.log(`  model:   ${result.modelPath}`);
  console.log(`  present: ${result.modelPresent}`);
  if (result.reason) console.log(`  reason:  ${result.reason}`);
  if (!result.available) {
    console.log(
      '\n  Embeddings will be hash-seeded pseudo-random vectors, which are reproducible and text-dependent but not\n' +
        '  semantic. `EmbeddingResult.backend` says `deterministic` for every vector, so a caller can tell.\n' +
        '  Making this real needs the model published with the package — outside this repository.',
    );
  }
});
