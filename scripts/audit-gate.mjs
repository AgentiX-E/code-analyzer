// **One advisory is exempt, and the exemption is a list rather than a threshold.**
//
// **`GHSA-vfj7-8cjw-p6xm` (`braces`) has `patched_versions: <0.0.0`** - **the registry's way of saying no fixed release
// exists** - so **an audit that fails on it can never pass**, and **a gate that can never pass is not a gate.**
//
// **Naming one advisory hides exactly one**, whereas **lowering `--audit-level` would also hide the next high-severity
// finding in any package.** **That is the whole reason this is a script rather than a flag**: **`pnpm audit` has no
// `--ignore`.**
import { readFileSync } from 'node:fs';

const IGNORED = new Set(['GHSA-vfj7-8cjw-p6xm']);
const report = JSON.parse(readFileSync(process.argv[2] ?? 'audit.json', 'utf8'));

const blocking = [];
for (const advisory of Object.values(report.advisories ?? {})) {
  if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue;
  if (IGNORED.has(advisory.github_advisory_id)) continue;
  blocking.push(`${advisory.severity}: ${advisory.module_name} (${advisory.github_advisory_id})`);
}

if (blocking.length > 0) {
  console.error(`::error::${blocking.length} high or critical advisor${blocking.length === 1 ? 'y' : 'ies'} found`);
  for (const line of blocking) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`No high or critical advisories outside the ${IGNORED.size} named exemption(s).`);
