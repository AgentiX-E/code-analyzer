#!/usr/bin/env node
/**
 * Action-pin gate.
 *
 * A workflow that runs `uses: actions/checkout@v7` executes whatever `v7` points at on the day it runs. The tag is a
 * promise the action's owner can rewrite, and the run that did it leaves no record of what actually executed —
 * GitHub's own `PinnedDependenciesID` query reported **97 of these** in this repository, which is what this gate
 * exists to keep at zero.
 *
 * A pin is a 40-character commit **and** the release it came from:
 *
 *   uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
 *
 * The comment is not decoration. A bare hash is unreadable by the person deciding whether to move it, and the
 * question "is this the version with the fix" has no answer from the hash alone. Dependabot understands the same
 * form and moves both halves together, so the record stays true.
 *
 * The third check is the one the alerts did not name. **One repository, one commit.** `docker-publish.yml` ran
 * `docker/setup-qemu-action@v3` while `publish-docker.yml` ran `@v4`, the same action at two majors in two workflows
 * that are meant to build the same image; the same had happened to `setup-buildx-action` and `metadata-action`. Both
 * pinned correctly would still be wrong, and a per-line check cannot see it.
 *
 * Usage:
 *   node scripts/action-pin-gate.js [--repo .] [--json]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PINNED =
  /^\s*(?:-\s+)?uses:\s+([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)@([0-9a-f]{40})(?:\s+#\s*(\S+))?\s*$/;

function parseArgs(argv) {
  const args = { repo: '.', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

function analyse(repo) {
  const dir = path.join(repo, '.github', 'workflows');
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
        .sort()
    : [];

  const failures = [];
  const references = [];
  const byRepository = new Map();

  for (const name of files) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf-8').split('\n');
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(?:-\s+)?uses:\s+(\S+?)(?:\s+#.*)?\s*$/);
      if (!match) return;
      const reference = match[1];
      if (reference.startsWith('./') || reference.startsWith('docker://')) return;

      const where = `${name}:${index + 1}`;
      const pinned = line.match(PINNED);
      if (!pinned) {
        const [, repository, ref] = reference.match(/^([^@]+)@(.+)$/) ?? [];
        if (repository === undefined) {
          failures.push(`${where}: "${reference}" is not an action reference this gate can read`);
        } else if (!/^[0-9a-f]{40}$/.test(ref)) {
          failures.push(
            `${where}: ${repository}@${ref} — a tag or short hash runs whatever it points at. Pin the full ` +
              '40-character commit and name the release in a comment.',
          );
        } else {
          failures.push(
            `${where}: ${repository}@${ref} names a commit but not which release — add "# vN" so the next person ` +
              'can tell what they are moving.',
          );
        }
        return;
      }

      const [, repository, sha, release] = pinned;
      references.push({ where, repository, sha, release });
      if (release === undefined) {
        failures.push(
          `${where}: ${repository}@${sha} names a commit but not which release — add "# vN" so the next person ` +
            'can tell what they are moving.',
        );
      }
      const seen = byRepository.get(repository);
      if (!seen) byRepository.set(repository, { sha, release, where });
      else {
        if (seen.sha !== sha) {
          failures.push(
            `${repository} is pinned to two commits: ${seen.sha} (${seen.where}) and ${sha} (${where}) — one ` +
              'repository, one pin, or the two workflows are running different code.',
          );
        }
        if (seen.release !== release) {
          failures.push(
            `${repository} is described as two releases: ${seen.release} (${seen.where}) and ${release} (${where})` +
              ' — the same commit cannot be two versions.',
          );
        }
      }
    });
  }

  return { files: files.length, references, repositories: byRepository.size, failures };
}

function main() {
  const args = parseArgs(process.argv);
  const result = analyse(args.repo);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.failures.length === 0 ? 0 : 1);
  }

  console.log(
    `${result.references.length} action reference${result.references.length === 1 ? '' : 's'} · ` +
      `${result.repositories} repositor${result.repositories === 1 ? 'y' : 'ies'} · ${result.files} workflow files`,
  );
  if (result.failures.length > 0) {
    console.error(
      `\n❌ Action pin check failed:\n${result.failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  console.log('✅ every action runs a named commit, and each repository is pinned once.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { analyse };
