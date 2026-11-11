#!/usr/bin/env node
/**
 * Documented-invocation gate.
 *
 * **The defect this exists for.** On 2026-11-09 nine files in this repository told a reader to run `code-analyzer review
 * pr`, `code-analyzer review-pr` or `code-analyzer standards check`, and none of the three was a command: every one of
 * those invocations failed with `error: unknown option '--repo'`. That was not a documentation slip — it was a published
 * interface with nothing behind it, and it survived because **nothing compared the manual with the binary**. The
 * workflows that would have caught it run only on `pull_request`, and the repository was pushing to the default branch.
 *
 * **So the comparison is mechanical, and it is made against the binary rather than against a list.** A configured list
 * of commands is just another document that can go stale; `--help` cannot drift from the parser it prints. The gate
 * reads every `code-analyzer <verb>` in this repository's prose and CI configuration, resolves each verb chain through
 * the CLI's own command tree, and checks that the flags written beside it are flags that command has.
 *
 * **What it does not prove.** That a documented invocation *succeeds* — that needs a token, a checkout and a pull
 * request, which is what the workflows do. This gate proves the narrower and previously unchecked thing: that the verb
 * and its flags exist, so a reader who copies the line does not get a usage error before the real work starts.
 *
 * Usage:  node scripts/docs-cli-gate.js [--json] [--cli <path-to-built-cli>]
 * Exit:   0 every documented invocation exists, 1 one does not, 2 the CLI has not been built.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CLI = path.join(ROOT, 'packages', 'cli', 'dist', 'index.js');

/**
 * An invocation, at the start of a command line.
 *
 * **The name has to be in command position, and that is the whole discrimination.** `kubectl -n code-analyzer create
 * secret`, `docker exec code-analyzer node --version`, `pnpm --filter code-analyzer build`, `chore: initialize
 * code-analyzer repository`, `Use code-analyzer to find …` — every one of those names the product and none of them is an
 * invocation. Requiring the name to be the first word of the line (after a prompt, a bullet, a redirect or an `npx`)
 * separates them, and it is also how a reader reads a code block.
 */
const INVOCATION =
  /^(?:[$>]\s+|-\s+)?(?:(?:npx|pnpm\s+(?:exec|dlx))\s+(?:-\S+\s+)*)?(?:@code-analyzer\/cli|code-analyzer)\s+([a-z][\w-]*)/;

/**
 * A sentence that says the command does not exist.
 *
 * **A gate that cannot read a negation would fail the paragraph that documents the defect**, and `docs/USER_GUIDE.md`
 * says in as many words that `code-analyzer group create` is not a command. Skipping these lines is the one place this
 * gate reads meaning rather than syntax, and it is deliberate: the alternative is to make the reminder unwritable.
 */
const NEGATION =
  /\b(?:not a command|not commands|no such command|never existed|has ever existed|does not exist|not of this CLI|is not the (?:CLI|command))\b/i;

/**
 * The parts of a line that a reader would copy: fenced blocks, inline code spans, and — in a workflow — the whole line.
 *
 * **Prose is where the false positives live.** `the code-analyzer to find all routes`, `use code-analyzer
 * simultaneously`, `the code-analyzer codebase`: every one of those is a sentence with the product's name in it, and a
 * gate that reads them as invocations fails on the documents that describe the product best. A command a reader can
 * copy is in a code span or a fenced block; that is the line this gate draws, and it is why the extraction is a mask
 * rather than a regular expression over raw text.
 */
function codeRegions(text, file) {
  const regions = [];
  const isConfig = /\.ya?ml$/.test(file);
  let fenced = false;

  text.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (NEGATION.test(line)) return;
    if (fenced || isConfig) {
      if (line.trim() === '') return;
      // **`run: code-analyzer status` is an invocation with a YAML key in front of it.** The key is not part of what the
      // reader copies, so it is removed before the command-position test — otherwise the only invocations a workflow
      // makes in one line would be invisible, which is most of them.
      const command = isConfig
        ? line.replace(/^\s*(?:-\s+)?(?:run|command|script|entrypoint|cmd)\s*:\s*/, '')
        : line;
      regions.push({ line: index + 1, text: command });
      return;
    }
    // Inline spans: the odd-indexed pieces of a backtick split are the ones between the ticks.
    const parts = line.split('`');
    for (let i = 1; i < parts.length; i += 2) regions.push({ line: index + 1, text: parts[i] });
  });

  return regions;
}

/** Where a documented invocation can appear. Computed by walking, so a new document is covered without an edit here. */
function sources() {
  const files = [];
  const skip = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', 'test-results']);

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|ya?ml)$/.test(entry.name)) files.push(full);
    }
  };

  for (const file of ['README.md', '.gitlab-ci.yml']) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full)) files.push(full);
  }
  for (const dir of ['docs', '.github', '.circleci']) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return files;
}

/**
 * The command tree, read from the binary itself.
 *
 * `--help` is the only description of the CLI that cannot disagree with the CLI: it is generated from the same objects
 * that parse the arguments. Commander prints one command per line in a `Commands:` section and one option per line in
 * an `Options:` section, and both are parsed here rather than being restated.
 */
function tree(cli) {
  const cache = new Map();

  const describe = (chain) => {
    const key = chain.join(' ');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let help;
    try {
      help = execFileSync(process.execPath, [cli, ...chain, '--help'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(
        `\`${['code-analyzer', ...chain].join(' ')} --help\` failed: ${error.message}`,
      );
    }

    const commands = new Set();
    const options = new Set();
    let section = '';
    for (const line of help.split('\n')) {
      if (/^\S/.test(line) && line.trim().endsWith(':')) {
        section = line.trim();
        continue;
      }
      if (section === 'Commands:') {
        const name = line.match(/^ {2}([a-z][\w-]*)/);
        if (name) commands.add(name[1]);
      } else if (section === 'Options:') {
        for (const flag of line.match(/--[a-z][\w-]*/g) ?? []) options.add(flag);
      }
    }

    const node = { commands, options };
    cache.set(key, node);
    return node;
  };

  return describe;
}

/** One documented invocation, with enough context to point at it. */
function invocations(text, file) {
  const found = [];
  for (const region of codeRegions(text, file)) {
    const match = region.text.trim().match(INVOCATION);
    if (match === null) continue;
    // Everything after the verb in this region is the invocation: `--repo . --pr 12` and so on.
    const rest = region.text.slice(region.text.indexOf(match[0]) + match[0].length);
    found.push({ file: path.relative(ROOT, file), line: region.line, verb: match[1], rest });
  }
  return found;
}

/**
 * Resolve one invocation against the tree.
 *
 * @returns {{chain: string[], unknown: string}} the chain that resolved and, if one did not, the word that failed.
 */
function resolve(describe, verb, rest) {
  const chain = [verb];
  if (!describe([]).commands.has(verb)) return { chain, unknown: verb };

  // **A second word is a subcommand only if it is one.** `analyze ./project` and `review pr` look identical to a regex
  // and only the command tree can tell them apart, which is why this asks rather than guesses.
  const second = rest.trim().split(/\s+/)[0] ?? '';
  if (/^[a-z][\w-]*$/.test(second) && describe(chain).commands.has(second)) {
    chain.push(second);
  }
  return { chain, unknown: '' };
}

/** Flags written beside a documented invocation, and whether that command has them. */
function flagsOf(describe, chain, rest) {
  const node = describe(chain);
  const written = [...rest.matchAll(/--[a-z][\w-]*/g)].map((m) => m[0]);
  return written.filter((flag) => !node.options.has(flag) && flag !== '--help');
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const cliIndex = argv.indexOf('--cli');
  const cli = cliIndex >= 0 ? path.resolve(argv[cliIndex + 1]) : DEFAULT_CLI;

  if (!fs.existsSync(cli)) {
    process.stderr.write(
      `The CLI has not been built: ${path.relative(ROOT, cli)} does not exist.\n` +
        'This gate reads the command tree from the binary, so build it first: pnpm --filter @code-analyzer/cli... build\n',
    );
    // **`exitCode`, not `exit()`.** A write to a pipe is asynchronous: `process.exit` can terminate before the last
    // chunk is flushed, and this gate's own JSON output came back truncated when piped into a reader — the report a
    // consumer could not parse. Setting the code lets the stream drain first.
    process.exitCode = 2;
    return;
  }

  const describe = tree(cli);
  const failures = [];
  let checked = 0;

  for (const file of sources()) {
    for (const invocation of invocations(fs.readFileSync(file, 'utf8'), file)) {
      checked += 1;
      const { chain, unknown } = resolve(describe, invocation.verb, invocation.rest);
      if (unknown !== '') {
        failures.push({ ...invocation, kind: 'verb', detail: unknown });
        continue;
      }
      for (const flag of flagsOf(describe, chain, invocation.rest)) {
        failures.push({ ...invocation, kind: 'flag', chain, detail: flag });
      }
    }
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ checked, failures }, null, 2)}\n`);
  } else if (failures.length === 0) {
    process.stdout.write(
      `✅ ${checked} documented invocation(s), every verb and flag of which the CLI has.\n`,
    );
  } else {
    process.stdout.write(
      `${failures.length} documented invocation(s) the CLI cannot answer, of ${checked} checked:\n\n`,
    );
    for (const failure of failures) {
      const what =
        failure.kind === 'verb'
          ? `\`code-analyzer ${failure.detail}\` is not a command`
          : `\`${failure.detail}\` is not an option of \`code-analyzer ${failure.chain.join(' ')}\``;
      process.stdout.write(`  ${failure.file}:${failure.line}  ${what}\n`);
    }
    process.stdout.write(
      '\nA documented invocation is a promise the binary has to keep: either implement it or stop writing it down.\n',
    );
  }

  process.exitCode = failures.length === 0 ? 0 : 1;
}

// **Exported so the parts that decide can be tested without the binary.** The walk, the mask and the resolution are
// where the judgement lives — what counts as prose, what counts as a command position, what a second word means — and a
// gate whose judgement is untested is a gate that reports whatever its regular expression happens to say.
module.exports = { codeRegions, invocations, resolve, flagsOf, sources, NEGATION, INVOCATION };

if (require.main === module) main();
