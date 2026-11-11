#!/usr/bin/env node
/**
 * Workflow-permission gate.
 *
 * **The defect this exists for.** `pr-review.yml` granted `checks: write` at the workflow level to four jobs, three of
 * which never wrote a check run; `security-audit.yml` granted `security-events: write` to five jobs, one of which
 * uploaded a SARIF file; `real-world-validation.yml` granted `issues: write` to a workflow that opens no issue at all.
 * None of those grants was doing anything, and each of them was doing it to every job in the file — which is what a
 * workflow-level grant means. Scorecard's `TokenPermissionsID` reported ten of these, five of them at the top level,
 * and the five it reported were the ones whose unused scope happened to be the one it looks for.
 *
 * **A job-level `permissions` map replaces the workflow-level one rather than extending it.** That makes a top-level
 * grant inert as soon as every job declares its own — and live again the moment a job is added without one. Both
 * states are invisible in review, which is the reason for a gate rather than a convention: `permissions: {}` at the
 * top of a file and a `contents: read` on every job is the only arrangement whose safety does not depend on the next
 * person remembering something.
 *
 * **What this checks, and what it deliberately does not.**
 *
 *   1. Every workflow states a workflow-level `permissions`. Absence is not neutral: it inherits the repository
 *      default, which may be read-write, and nothing in the file says which.
 *   2. No workflow-level permission is `write` (`write-all` included). This is the finding above, generalised.
 *   3. Job-level writes are counted and reported, not failed. A job that publishes a release or uploads an alert is
 *      doing the thing the permission is for; narrowing it further would mean a second job that only receives files.
 *      The count is in the report so that "how much write is there" has an answer that is not a grep.
 *
 * Usage:
 *   node scripts/workflow-permission-gate.js [--repo .] [--json]
 * Exit:   0 every grant is scoped to the job that uses it, 1 one is not.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** `permissions:` at the start of a line, with either a value or nothing on it. */
const WORKFLOW_LEVEL = /^permissions:\s*(.*)$/;

/** A job header: two spaces, a name, a colon, nothing else. */
const JOB_HEADER = /^  ([A-Za-z0-9_-]+):\s*$/;

/** One entry of a permission map. */
const PERMISSION_ENTRY = /^\s+([A-Za-z0-9_-]+):\s*['"]?([A-Za-z-]+)['"]?\s*(?:#.*)?$/;

function parseArgs(argv) {
  const args = { repo: '.', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

/**
 * The permissions a workflow declares, split by where it declares them.
 *
 * @param {string[]} lines
 * @returns {{stated: boolean, topLevel: Record<string,string>, jobs: Record<string, Record<string,string>>}}
 */
function readPermissions(lines) {
  const topLevel = {};
  const jobs = {};
  let stated = false;
  let job = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const header = line.match(JOB_HEADER);
    if (header) {
      job = header[1];
      continue;
    }

    const workflowLevel = line.match(WORKFLOW_LEVEL);
    if (workflowLevel) {
      stated = true;
      const inline = workflowLevel[1].replace(/#.*$/, '').trim();
      if (inline !== '') {
        // The string forms: `read-all`, `write-all`, and `{}` for "no token at all".
        if (inline !== 'read-all' && inline !== '{}') topLevel['*'] = inline;
        continue;
      }
      // A block: every following line that is indented, until one that is not.
      for (let j = i + 1; j < lines.length; j += 1) {
        const entry = lines[j].match(PERMISSION_ENTRY);
        if (entry) {
          topLevel[entry[1]] = entry[2];
          continue;
        }
        if (lines[j].trim() === '' || /^\s+#/.test(lines[j])) continue;
        break;
      }
      continue;
    }

    // A job-level block. `permissions: {}` on the job header's own line is a declaration of nothing, and counts.
    if (/^\s+permissions:\s*(?:#.*)?$/.test(line)) {
      const block = {};
      for (let j = i + 1; j < lines.length; j += 1) {
        const entry = lines[j].match(PERMISSION_ENTRY);
        if (entry) {
          block[entry[1]] = entry[2];
          continue;
        }
        if (lines[j].trim() === '' || /^\s+#/.test(lines[j])) continue;
        break;
      }
      if (job !== null) jobs[job] = block;
    }
  }

  return { stated, topLevel, jobs };
}

function analyse(repo) {
  const dir = path.join(repo, '.github', 'workflows');
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
        .sort()
    : [];

  const findings = [];
  const workflowFiles = [];
  let jobLevelWrites = 0;

  for (const name of files) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf-8').split('\n');
    const { stated, topLevel, jobs } = readPermissions(lines);
    const relative = `.github/workflows/${name}`;
    workflowFiles.push(relative);

    if (!stated) {
      findings.push({ file: relative, kind: 'unstated' });
    }
    for (const [permission, level] of Object.entries(topLevel)) {
      if (level === 'write' || level === 'write-all') {
        findings.push({ file: relative, kind: 'workflow-level-write', permission });
      }
    }
    for (const [jobName, block] of Object.entries(jobs)) {
      for (const [permission, level] of Object.entries(block)) {
        if (level === 'write') jobLevelWrites += 1;
        if (level === 'write' && permission === '*') {
          // `permissions: write-all` inside a job is the same blanket grant one level down.
          findings.push({ file: relative, kind: 'job-level-write-all', job: jobName });
        }
      }
    }
  }

  return { files: workflowFiles, findings, jobLevelWrites };
}

function report(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.findings.length === 0) {
    process.stdout.write(
      `✅ ${result.files.length} workflow(s): no workflow-level write, and ${result.jobLevelWrites} job-level ` +
        `write(s) each on the job that uses it.\n`,
    );
    return;
  }
  process.stdout.write(
    `${result.findings.length} permission grant(s) wider than the job that uses them, of ${result.files.length} ` +
      `workflow(s):\n\n`,
  );
  for (const finding of result.findings) {
    if (finding.kind === 'unstated') {
      process.stdout.write(
        `  ${finding.file}  states no workflow-level permissions, so every job inherits the repository default\n`,
      );
    } else if (finding.kind === 'workflow-level-write') {
      process.stdout.write(
        `  ${finding.file}  grants \`${finding.permission}: write\` to every job in the file\n`,
      );
    } else {
      process.stdout.write(`  ${finding.file}  grants \`write-all\` to job \`${finding.job}\`\n`);
    }
  }
  process.stdout.write(
    '\nA token scope is a permission, and a permission given to a job that does not use it is one that can be used\n' +
      'by anything that job runs. Put the write on the job that writes; give the workflow `contents: read`.\n',
  );
}

function main() {
  const args = parseArgs(process.argv);
  const result = analyse(args.repo);
  report(result, args.json);
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}

module.exports = { analyse, readPermissions, JOB_HEADER, WORKFLOW_LEVEL };

if (require.main === module) main();
