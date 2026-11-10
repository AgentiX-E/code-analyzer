# Security

**What this document is for.** Every open security finding on this repository has a place here that says what was measured
about it, because **a finding whose status is "triaged" and whose measurement is missing is a finding nobody has looked
at**.

The rule this file exists to enforce: **an alert is closed by a test that reproduces its input, not by a paragraph that
describes its shape.** Where the test exists, this file names it. Where it does not, this file says so.

---

## 0. The count, and how this file got it wrong for three iterations

The first version of this file reported "twenty-five `js/polynomial-redos` alerts" and "nineteen
`js/insecure-temporary-file`". Both numbers came from one request:

```
GET /repos/AgentiX-E/code-analyzer/code-scanning/alerts?state=open&per_page=100
```

**The repository held 367 open alerts.** The request returned an array of a hundred, the array had a length, and every
count below it was correct about eleven per cent of the population. Nothing threw. That is the shape worth recording:
the arithmetic was right, the query was right, and **a page had been read as a set**.

| rule                             | what this file said | what was open |
| -------------------------------- | ------------------- | ------------- |
| `js/polynomial-redos`            | 25                  | **79**        |
| `js/insecure-temporary-file`     | 19                  | **130**       |
| `js/redos`                       | —                   | 4             |
| `js/regex/missing-regexp-anchor` | —                   | 27            |

The instrument is now a script rather than a habit: `scripts/code-scanning-corpus.mjs` walks the corpus page by page and
prints the total before the table, and `.github/scripts/lib/paginate.mjs` is the walk itself - it returns only when a
page arrives shorter than the page size, and it raises rather than returning when a page is not an array or when it has
asked for `MAX_PAGES` and never seen a short one. `tests/unit/scripts/a-page-of-results-is-not-the-corpus.test.ts` pins
the exact arithmetic of the error above: the same 367-item corpus read as one page gives 100 and read as a walk gives
367, and the rule this file was written about comes out as 100 against 130.

**Every number below is from the walk.** Where a number is still a page, this file says so.

---

## 1. `js/polynomial-redos` (79) and `js/redos` (4): six measured, six fixed, seventy-seven unmeasured

### 1.1 What was measured

Twenty-five of the eighty-three patterns were fed an input built for **their own** shape - a run of keywords with no
declaration after them, an unterminated delimiter, a block comment opener with no closer, a single long identifier with no
`=` - at roughly 60-160 KB, which is a plausible single-file size in the repositories this product reviews.

**Six were catastrophic and nineteen were not.** A pattern that finishes in two milliseconds as a 120 KB file goes by is
not a vulnerability, and calling it one is how a real one gets missed.

### 1.2 The six, before and after

| where                                | shape                            | hostile input              | before                   | after  | fix                                                         |
| ------------------------------------ | -------------------------------- | -------------------------- | ------------------------ | ------ | ----------------------------------------------------------- |
| `languages/signatures.ts`            | `(\s*(=>\|:\|;\|\{\|=\s*))+\$`   | `'= '.repeat(20000) + 'a'` | **> 15 000 ms** (killed) | < 1 ms | hand-written right-to-left scan                             |
| `languages/ruby.ts`                  | `[A-Z][A-Z_]*[A-Z]\w*`           | `'CONST_'.repeat(12000)`   | **> 25 000 ms**          | 0.4 ms | word boundary + one greedy class                            |
| `languages/kotlin.ts`                | `(?:(?:kw)\s+)*class`            | `'data '.repeat(20000)`    | **988 ms**               | 1 ms   | modifier run bounded to eight                               |
| `languages/kotlin.ts`                | `(?:(?:kw)\s+)*fun`              | `'private '.repeat(20000)` | **1 272 ms**             | 1.3 ms | modifier run bounded to eight                               |
| `languages/html.ts`                  | `[^>]*` after an opening bracket | `'<a '.repeat(30000)`      | **1 539 ms**             | 0.2 ms | `[^<>]*`, because `<` in an attribute value is invalid HTML |
| `benchmarks/retrieval-corpus/cpp.ts` | `(?:(?:kw)\s+)*(?:…)?(\w+)\s*\(` | `'static '.repeat(20000)`  | **7 205 ms**             | 9 ms   | modifier run bounded to eight                               |

**Two of these were worth more than the other four combined, and neither looked like the dangerous one.** The signature
stripper ran on every declaration in every file, and the Ruby constant pattern is a single line that reads like a
character class. **A severity label would have put the Kotlin ones first and the Ruby one last.**

### 1.3 Why the first pass missed the Ruby one

The first measurement probed **ten** of the twenty-five shapes and concluded "five slow, twenty fast". The remaining
fifteen were safe **by omission**, which is not a measurement. The Ruby pattern was in that fifteen and turned out to be
the second worst.

**So the second pass was built the other way round**: instead of a hostile input per regex, nine languages each received a
whole hostile _file_, built from the shapes their own alerts describe, and the assertion is on the total scan time. That
is also the property a user experiences - "the review never finished" - and it survives a refactor that replaces a regex
with a hand-written scanner.

The measurement is now a test: `tests/unit/a-source-file-cannot-stop-the-parser.test.ts`, sixteen cases, 35 ms.

| language   | hostile file                                            | size   | scanned in |
| ---------- | ------------------------------------------------------- | ------ | ---------- |
| Kotlin     | 12 000 `data ` + 12 000 `private `                      | 156 KB | 4.2 ms     |
| PHP        | 12 000 `use App\`                                       | 96 KB  | 1.0 ms     |
| Python     | 8 000 unmatched `"""` + 8 000 `import `                 | 80 KB  | 4.1 ms     |
| R          | 12 000 `x <- `                                          | 60 KB  | 4.8 ms     |
| Ruby       | 12 000 `CONST_`                                         | 72 KB  | 0.4 ms     |
| Rust       | 12 000 `use a::`                                        | 84 KB  | 1.3 ms     |
| Swift      | 12 000 `let a = `                                       | 96 KB  | 8.0 ms     |
| TypeScript | 12 000 `const a = ` + a 20 000-character comment opener | 140 KB | 9.0 ms     |
| HTML       | 12 000 `<a `                                            | 36 KB  | 0.3 ms     |

### 1.4 The nineteen that measured fast

`compile-evidence.ts`, `style-lens.ts`, `php.ts` (three sites), `python.ts` (four sites), `r.ts` (two), `rust.ts`,
`swift.ts`, `typescript.ts` (five), `html.ts` (the same file, a second pattern) and `kotlin.ts` (a third pattern) are
covered by the whole-file test above wherever their language is in it.

**They are not dismissed.** An alert that is dismissed cannot come back; an alert that stays open next to a test is a
reminder that the test covers the file and not necessarily the line. **The difference matters the day someone adds a
pattern to `python.ts` that the hostile file does not exercise** - the alert is still there to say so.

### 1.5 What is not covered, stated as a number

**Fifty-eight of the seventy-nine `js/polynomial-redos` alerts and the four `js/redos` alerts have never been probed.**
Twenty-five were, and that is 30% of the corpus. The counts by file are what the walk prints:

```
node scripts/code-scanning-corpus.mjs --rule js/polynomial-redos
```

- `rule-runner.ts` (11) and `ast-rule-checker.ts` (8) are the two largest single-file populations and neither has been
  measured. They take **rule definitions from disk and compile them**, which is a different threat model from the
  language providers: the pattern is not written by this repository.
- **`compile-evidence.ts` and `style-lens.ts`** have their own patterns (a compiler-output line, a string literal) and
  neither has a hostile-file test, because neither takes a whole source file. Both measured under 3 ms. **Stated here as
  a gap rather than as a pass.**
- **A regex that is linear in the number of matches but quadratic in the number of failures inside one match** is not
  covered by any input that has not been tried against it. The nine inputs above are a floor.

---

## 2. `js/insecure-temporary-file`: 130 alerts, all 130 accounted for

The rule is about a file written to a name that anyone can predict in a directory anyone can write to. The remedy is the
same everywhere and it is not a comment: **create the directory atomically**, so that the name and the ownership are
decided in one call and there is no window between "is it there" and "make it".

| disposition                                 | alerts  | files | what it was                                                                     |
| ------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------- |
| atomic creation (`mkdtempSync` / `mkdtemp`) | **110** | 23    | a directory named from the clock, or from the clock and a counter               |
| moved out of the shared namespace           | **11**  | 5     | a fixed name that is a **correctness requirement**, so only the directory moved |
| production code                             | **2**   | 2     | the daemon's pid file, and a session checkpoint's temporary file                |
| false positive, left open                   | **7**   | 5     | a write to a caller's path, or a read                                           |
|                                             | **130** | 33    |                                                                                 |

### 2.1 The 110 that were a clock reading

`Date.now()` plus a short base-36 suffix reads like a unique name and is a clock reading. Two vitest workers that start in
the same millisecond are handed the same path, and `mkdirSync(dir, { recursive: true })` **does not object to a directory
that is already there** - so one worker's `afterEach` removed the other's fixture, and the failure surfaced somewhere
else entirely, if it surfaced at all. `packages/cli/src/__tests__/review.test.ts` alone had thirty-five of these.

`mkdtempSync` decides the name and creates the directory in one call. The mechanical part of this rewrite is not the
interesting part; what is worth recording is that **none of these were "just tests"** - a shared fixture directory is how
a suite becomes flaky, and a flaky suite is how a real regression gets re-run until it passes.

### 2.2 The 11 that had to keep a fixed name

Five e2e fixtures index a checkout by its **absolute** path, so a random suffix puts a different token into the index on
every run and the ranking of the same source changes between two analyses. `issue-to-ranked-files.test.ts` says so in its
own header, and its first version used `mkdtempSync` and failed for that reason. **The name cannot be randomised, so the
directory had to move**: `tests/e2e/scratch-root.ts` puts the fixture at `<checkout>/.cache/test-scratch/<fixed name>`,
which is stable across runs, ignored by git, and - the point - **owned by the user running the test rather than shared
with everyone on the machine**. A fixed name in `os.tmpdir()` is a name someone else can take first.

### 2.3 The two in production code

| where                                        | what was wrong                                                                                                            | what it is now                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mcp/src/daemon/daemon.ts`                   | default pid file `/tmp/code-analyzer.pid`: a predictable name in a world-writable directory, written with mode `0644`     | `$XDG_RUNTIME_DIR/code-analyzer/daemon.pid` when the session provides one, else a per-uid directory created **0700 and then checked**, pid file `0600` |
| `intelligence/src/review/session-manager.ts` | temporary file `${session}.json.tmp`: one fixed name per session, so two overlapping checkpoints write into the same file | `${session}.json.<pid>.<8 hex>.tmp` opened with `flag: 'wx'`, so an existing file is an error rather than a target                                     |

**The pid file name cannot be randomised** and that is the feature, not a gap: a pid file exists so a second process can
find the first, so both ends must agree on the path. What can change is the directory, and the check after the create is
the part that matters - `mkdirSync(..., { recursive: true })` succeeds on a directory someone else made, so ownership and
type are read back with `lstatSync` and a mode wider than `0700` is narrowed.

**The attack is replayed rather than described**: `packages/mcp/src/__tests__/a-pid-file-is-only-as-private-as-its-directory.test.ts`
plants a symlink where the daemon directory should be, starts a daemon with default options, and asserts both that the
refusal is reported and that the victim directory gained no pid file. That is what closes the alert.

### 2.4 The 7 left open, one judgment each

These stay open on purpose. An alert that is dismissed cannot come back to say that the file changed shape; an alert left
open next to a reason can.

| alert                                                                   | why it is not a temporary file                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search/file-head.ts:42` (`openSync(O_RDONLY \| O_NONBLOCK)`)           | it **reads**. The path is the caller's, and `O_NONBLOCK` is the guard that stops a read on a FIFO from blocking the review. There is no write to make atomic.                                                                                                                        |
| `infra/workers/parallel-indexer.ts:872`                                 | writes the project's hash cache inside the project's own data directory. Not `os.tmpdir()`, not a shared namespace.                                                                                                                                                                  |
| `cross-repo/repo-group-manager.ts:126`                                  | writes a project's config file at the path the project gave it.                                                                                                                                                                                                                      |
| `.github/scripts/run-martian-harness.mjs:212` and `:241`                | write the harness's own artifacts under the model directory in this checkout - the same place every other artifact in `benchmarks/` goes.                                                                                                                                            |
| `analyzer/src/__tests__/benchmarks/fixture-generator.ts:234` and `:255` | the function is **given** an output directory and writes into it; it chooses no name and no location. Its callers are the ones that decide, and both of them now use `mkdtempSync` (the two alerts taint from `pipeline-benchmark.test.ts`'s old fixed `BENCH_DIR`, which is fixed). |

---

## 3. `PinnedDependenciesID` (20), `TokenPermissionsID` (10), and the rest

`PinnedDependenciesID` counts GitHub Actions and image references that are not pinned to a commit SHA.
`TokenPermissionsID` counts workflows without an explicit `permissions:` block. Both are configuration findings with a
mechanical remedy and neither is exploitable without write access to the repository.

The two numbers moved for the same reason as everything else on this page: the previous version said twelve and five, and
the walk says twenty and ten.

**The remainder of the 367 - `js/regex/missing-regexp-anchor` (27, all in `graphql-linking.ts`), the shell-construction
findings (13 + 3 + 1), `js/file-system-race` (7), `js/unused-local-variable` (14), the sanitization findings, and the
Scorecard checks - is not in this document yet**, and by the rule at the top of this file that means it is not triaged
either. It is what `scripts/code-scanning-corpus.mjs` exists to stop anyone from losing track of again.

**The order in this document is the order of the work, not the order of the severity labels**: a source file can reach the
regexes, and a source file cannot reach a workflow's `permissions:` block by itself.
