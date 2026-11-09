// @code-analyzer — Links into this repository, checked against the checkout
//
// **Why this exists, and what it replaces.** `Documentation CI` runs lychee over every markdown file, and on 2026-11-09
// **github.com answered `[504]` to nearly every request from the runner for the better part of an hour** — the CodeQL
// bundle download failed the same way in the same window, which is how the outage was identified as upstream rather
// than as a documentation defect. The links that failed are all **into this repository**: `.../blob/master/packages/x/
// README.md`, `.../issues`. Their health is not something github.com can tell us during an outage, and it is not
// something it needs to: **the file is in the checkout.**
//
// **So the self-links are checked against the filesystem instead of the network.** That is strictly better than the
// HTTP check it replaces: it is deterministic, it needs no token, it cannot be affected by an outage, and **it catches
// the case lychee could never distinguish from a transient error — a link to a file that was renamed or deleted.**
// Paths that do not resolve to this repository (other organisations, other repositories, `issues/123`, `pulls/123`) are
// left to lychee, which is still the right instrument for them.

import { readFileSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// **The first argument that is not a flag**, because `--self-test` is also an argument and resolving it as a path made
// the fixture look for `package.json` inside a directory called `--self-test`.
const ROOT = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? process.cwd(),
);

/**
 * **The host and owner are hard-coded on purpose.** A link checker that guesses which links are "self" from the current
 * git remote would silently stop checking the day the remote moves; the repository is named in its own links.
 */
const SELF =
  /https:\/\/github\.com\/AgentiX-E\/code-analyzer\/(?:blob|tree)\/[^/\s)\]"']+\/([^\s)\]"'#?]+)/g;

/** Every markdown file, without descending into the directories that hold generated or vendored content. */
function markdownFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(absolute, found);
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) found.push(absolute);
  }
  return found;
}

/**
 * **The links, with the line they are on.** The line is what makes the output actionable, and it is the one thing a
 * regex over the whole file cannot produce.
 */
function selfLinks(text) {
  const links = [];
  for (const [at, line] of text.split('\n').entries()) {
    for (const match of line.matchAll(SELF)) {
      links.push({ path: decodeURIComponent(match[1]), line: at + 1 });
    }
  }
  return links;
}

/** Whether a repository path exists in the checkout, resolving either a file or a directory. */
function exists(path) {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

/**
 * **The fixture the self-test runs on**, so this script is provably able to fail.
 *
 * A checker that has only ever been run on a healthy tree has never been checked: **the branch that matters is the one
 * that reports a missing path**, and it is exactly the branch a bug would leave untested.
 */
function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`self-test failed: ${message}`);
  };
  const text = [
    'A [good](https://github.com/AgentiX-E/code-analyzer/blob/master/package.json) link.',
    'A [directory](https://github.com/AgentiX-E/code-analyzer/tree/main/scripts) link.',
    'A [missing](https://github.com/AgentiX-E/code-analyzer/blob/master/no/such/file.md) link.',
    'A [foreign](https://github.com/other/repo/blob/master/README.md) link.',
    'A [numbered](https://github.com/AgentiX-E/code-analyzer/issues/1) link.',
    'A [section](https://github.com/AgentiX-E/code-analyzer/blob/master/README.md#usage) link.',
  ].join('\n');

  const links = selfLinks(text);
  assert(links.length === 4, `four self-links are recognised, not ${links.length}`);
  assert(
    links.map((link) => link.path).join(',') === 'package.json,scripts,no/such/file.md,README.md',
    'the section anchor is stripped and a foreign repository is ignored',
  );
  assert(links[2].line === 3, 'the line number is the line the link is on');
  assert(exists('package.json'), 'a file that exists resolves');
  assert(exists('scripts'), 'a directory resolves');
  assert(!exists('no/such/file.md'), 'a path that does not exist does not resolve');
  assert(exists('README.md#usage'.split('#')[0]), 'an anchored link is checked by its path');

  console.log(`AACR-CHECK-SELF-LINKS self-test ok · ${links.length} links recognised`);
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const files = markdownFiles(ROOT);
  const missing = [];
  let checked = 0;
  for (const file of files) {
    for (const link of selfLinks(readFileSync(file, 'utf8'))) {
      checked += 1;
      if (!exists(link.path)) {
        missing.push({
          file: relative(ROOT, file).split('\\').join('/'),
          line: link.line,
          path: link.path,
        });
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      `AACR-CHECK-SELF-LINKS ${missing.length} link(s) into this repository point at nothing:`,
    );
    for (const item of missing) console.error(`  ${item.file}:${item.line} -> ${item.path}`);
    process.exitCode = 1;
    return;
  }
  console.log(`AACR-CHECK-SELF-LINKS ok · ${checked} links into this repository, all present`);
}

main();
