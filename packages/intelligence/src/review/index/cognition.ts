// @code-analyzer/intelligence — the checkable half of a written index
//
// **`aoci-code`'s index is 628 lines for a 188 020-line repository**, one line per file, carrying four fields that no
// scanner can produce: `F` what the file is for, `R` the files that must be read with it, `A` what callers depend on,
// `S` the constraint that cannot be inferred but must not be violated. Its `s-field-discipline` forbids generating those
// from an AST, an import scan, a path, a filename or a regular expression, on the stated ground that **a regex-extracted
// invariant is not an invariant; it is a string that happens to sit next to one.**
//
// **What that discipline does not forbid is refusing the result.** A model-written index is worth its build cost only if
// its lines can be checked, and the checks are not opinions:
//
// | Check | Where it comes from |
// | --- | --- |
// | every field present | a line missing `S` is a file nobody read, not a file with nothing to break |
// | importance 1-9 | the tag `C{importance}{module}{size}` is a scale, and a scale with a tenth step is not one |
// | `F`/`R`/`A`/`S` inside their band | `aoci-code`'s own `cognitionbudget/policy.go`: `C9` may spend 90 / 100 characters, `C1-C4` only 25 / 20 |
// | one line per path | two lines about one file is a reader that cannot say which it read |
//
// **The bands are the point rather than the tidiness.** An index whose entries are unbounded becomes a summary, a
// summary is read instead of the file, and a summary read instead of a file is how a review becomes confident about code
// it never saw. **A 25-character `F` cannot be a summary**; it can only be a claim about the file's job.

/** What a written index says about one file. */
export interface CognitionEntry {
  /** Repository-relative, and the key the row is found by. */
  readonly path: string;
  /** 1-9. Higher means more is spent on the row and more care is expected of it. */
  readonly importance: number;
  /** `L`/`M`/`S`/`T` - the file's size class, which is context rather than a budget. */
  readonly size: 'L' | 'M' | 'S' | 'T';
  /** `F`: what the file is for, in the band its importance buys. */
  readonly responsibility: string;
  /** `R`: the files that must be read with this one. Empty is a statement, not an omission. */
  readonly readWith: readonly string[];
  /** `A`: what callers depend on. */
  readonly dependedOnBy: readonly string[];
  /** `S`: the constraint that must not be violated. `none` is allowed; empty is not. */
  readonly constraint: string;
}

/** A line the index cannot keep, with the reason a reader can act on. */
export interface CognitionProblem {
  readonly line: number;
  readonly path: string;
  readonly reason: string;
}

/** The characters an importance band allows, per `aoci-code`'s policy file. */
const BAND: Record<number, { readonly responsibility: number; readonly constraint: number }> = {
  9: { responsibility: 90, constraint: 100 },
  8: { responsibility: 80, constraint: 90 },
  7: { responsibility: 70, constraint: 80 },
  6: { responsibility: 60, constraint: 70 },
  5: { responsibility: 50, constraint: 60 },
  4: { responsibility: 25, constraint: 20 },
  3: { responsibility: 25, constraint: 20 },
  2: { responsibility: 25, constraint: 20 },
  1: { responsibility: 25, constraint: 20 },
};

const TAG = /^C([1-9])([LMST])$/u;
const FIELD = /^([FRAS])=(.*)$/u;

/**
 * **Read an index, keeping the lines that can be checked and naming the ones that cannot.**
 *
 * **A problem does not discard the file's other lines**, because an index of two hundred rows where one is malformed is
 * an index with one defect rather than an unusable index - and a parser that returned nothing on the first error would
 * make the defect cost a rebuild.
 *
 * **Comments and blank lines are neither.** `#` at the start of a line is a note to a reader, which is what makes the
 * file reviewable in a diff; treating it as an entry would refuse every index that explained itself.
 */
export function parseCognitionIndex(text: string): {
  entries: CognitionEntry[];
  problems: CognitionProblem[];
} {
  const entries: CognitionEntry[] = [];
  const problems: CognitionProblem[] = [];
  const seen = new Set<string>();

  const lines = text.split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const raw = lines[at]!;
    if (raw.trim().length === 0 || raw.trimStart().startsWith('#')) continue;

    const line = at + 1;
    const columns = raw.split('\t');
    const path = columns[0]?.trim() ?? '';
    if (path.length === 0) {
      problems.push({ line, path: '(none)', reason: 'the row has no path in its first column' });
      continue;
    }

    const tag = columns[1] ?? '';
    const tagMatch = TAG.exec(tag.trim());
    if (tagMatch === null) {
      problems.push({
        line,
        path,
        reason: `the tag "${tag}" is not an importance 1-9 followed by a size in L|M|S|T`,
      });
      continue;
    }
    const importance = Number(tagMatch[1]);
    const size = tagMatch[2] as CognitionEntry['size'];

    const fields = new Map<string, string>();
    for (const column of columns.slice(2)) {
      const match = FIELD.exec(column);
      if (match !== null) fields.set(match[1]!, match[2]!);
    }

    const missing = ['F', 'R', 'A', 'S'].filter((key) => !fields.has(key));
    if (missing.length > 0) {
      problems.push({
        line,
        path,
        reason: `the row is missing ${missing.join(', ')} - a file with no stated constraint was not read`,
      });
      continue;
    }

    const responsibility = fields.get('F')!.trim();
    const constraint = fields.get('S')!.trim();
    if (responsibility.length === 0) {
      problems.push({ line, path, reason: 'F is empty, and an empty F is a row nobody wrote' });
      continue;
    }
    if (constraint.length === 0) {
      problems.push({
        line,
        path,
        reason:
          'S is empty - write `none` when the file has no constraint, because silence is not that word',
      });
      continue;
    }

    const band = BAND[importance]!;
    if (responsibility.length > band.responsibility) {
      problems.push({
        line,
        path,
        reason: `F spends ${String(responsibility.length)} characters and C${String(importance)} allows ${String(band.responsibility)} - a longer F is a summary, and a summary is read instead of the file`,
      });
      continue;
    }
    if (constraint.length > band.constraint) {
      problems.push({
        line,
        path,
        reason: `S spends ${String(constraint.length)} characters and C${String(importance)} allows ${String(band.constraint)}`,
      });
      continue;
    }

    if (seen.has(path)) {
      problems.push({
        line,
        path,
        reason: 'the path is named twice, so a reader cannot say which row it read',
      });
      continue;
    }
    seen.add(path);

    entries.push({
      path,
      importance,
      size,
      responsibility,
      readWith: listOf(fields.get('R')!),
      dependedOnBy: listOf(fields.get('A')!),
      constraint,
    });
  }

  return { entries, problems };
}

/** A comma-separated field as a list, with the empty field meaning an empty list rather than one empty name. */
function listOf(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * **The row as the format writes it**, so that a parsed index renders back to the bytes it came from.
 *
 * The round trip is not decoration: the index is committed and reviewed in a diff, and **an index that cannot be written
 * back is an index whose diffs are unreadable** - every regeneration would rewrite every row whether or not anything
 * changed, and a reviewer would meet two hundred lines of churn to find the one that moved.
 */
export function renderCognitionEntry(entry: CognitionEntry): string {
  return [
    entry.path,
    `C${String(entry.importance)}${entry.size}`,
    `F=${entry.responsibility}`,
    `R=${entry.readWith.join(',')}`,
    `A=${entry.dependedOnBy.join(',')}`,
    `S=${entry.constraint}`,
  ].join('\t');
}
