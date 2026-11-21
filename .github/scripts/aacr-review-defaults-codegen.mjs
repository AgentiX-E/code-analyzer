// @code-analyzer/scripts — renders the shipped configuration into the module the engine compiles
//
// **Why a renderer rather than a JSON import.** `tsc` resolves `import defaults from './x.json'` by emitting
// `require("./x.json")` relative to the *output*, and the build never copies `config/` into `dist/` - so the import
// would resolve at compile time and throw at run time, which is the worst possible place for it to fail. A rendered
// module is inlined and cannot point anywhere.
//
// **Why this is a command and not a build step.** The rendered file is committed, so a reader of the engine sees the
// numbers without a build and a diff of a promotion is a diff of two files that say the same thing. `--check` is what
// CI runs: it renders in memory and fails when the committed module and the JSON disagree, which makes a hand edit to
// either one a red build rather than a slow divergence.

import { readFileSync, writeFileSync } from 'node:fs';

import {
  GENERATED_PATH,
  readReviewDefaults,
  renderDefaultsModule,
} from './lib/review-defaults.mjs';

const rendered = renderDefaultsModule(readReviewDefaults());
const check = process.argv.includes('--check');

let current = null;
try {
  current = readFileSync(GENERATED_PATH, 'utf8');
} catch {
  current = null;
}

if (check) {
  if (current !== rendered) {
    process.stderr.write(
      'review-defaults.generated.ts is not what review-defaults.json renders. Run `node .github/scripts/aacr-review-defaults-codegen.mjs` and commit the result.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('review-defaults: the committed module is what the JSON renders\n');
  }
} else if (current === rendered) {
  process.stdout.write('review-defaults: unchanged\n');
} else {
  writeFileSync(GENERATED_PATH, rendered);
  process.stdout.write('review-defaults: rendered\n');
}
