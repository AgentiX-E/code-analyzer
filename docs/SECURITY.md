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

## 1. `js/polynomial-redos` (79) and `js/redos` (4): fourteen measured and fixed, sixty-nine classified

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

**This section was written when fifty-eight of the seventy-nine findings had never been probed, and it is kept as
written so that the next reader can see what a gap looks like before it is closed.** §1.9 closes it: every open finding
is measured by `scripts/redos-assay.mjs` on every push, and the job fails if one of them is still quadratic.

- `rule-runner.ts` (11) and `ast-rule-checker.ts` (8) are the two largest single-file populations and neither has been
  measured. They take **rule definitions from disk and compile them**, which is a different threat model from the
  language providers: the pattern is not written by this repository.
- **`compile-evidence.ts` and `style-lens.ts`** have their own patterns (a compiler-output line, a string literal) and
  neither has a hostile-file test, because neither takes a whole source file. Both measured under 3 ms. **Stated here as
  a gap rather than as a pass.**
- **A regex that is linear in the number of matches but quadratic in the number of failures inside one match** is not
  covered by any input that has not been tried against it. The nine inputs above are a floor.

**Where those three became facts rather than gaps**: `rule-runner.ts` and `ast-rule-checker.ts` between them held
nineteen findings, and the assay measured **eleven of them quadratic** - including a method-header matcher that cost
855 ms on forty kilobytes of spaces. Both files are corrected and their patterns are in the table in §1.9.

### 1.6 The third pass: CodeQL's own adversarial string, and 22 of 35 were real

**The first two passes built inputs from each pattern's shape. This pass used the input the rule names.** Every
`js/polynomial-redos` message carries the string that made it fire - _"may run slow on strings starting with `X` and with
many repetitions of `Y`"_ - so the probe replays exactly that and the rule's own claim becomes the measurement:

1. the string is taken out of the message, not composed by the author of the test;
2. every finding runs in **its own process with a 5-second kill**, because a catastrophic pattern hangs the harness that
   measures it - the first attempt did exactly that, for nine minutes, on one pattern;
3. a finding is real if the 40 KB run crosses 200 ms **or does not return at all**;
4. a ratio is printed beside the time, because ×10 of input costing ×95 is the fingerprint of a quadratic and ×10 costing
   ×10 is not.

**Twenty-two of the thirty-five patterns the probe could locate were real**, and the ratios cluster at ×93-×100 - which
is the exponent, not an opinion. Two did not return at all.

| pattern                                               | 40 KB    | ratio |
| ----------------------------------------------------- | -------- | ----- |
| `^import\s+.*?\s+from\s+['"]([^'"]+)['"]` (two sites) | **hang** | —     |
| `import\s+.*\s+from\s+['"](.+)['"]`                   | **hang** | —     |
| `^@@\s+-(\d+),?(\d+)?\s+\+(\d+),?(\d+)?\s+@@`         | 2 675 ms | ×96   |
| `(\w+)\s*:\s*(?:async\s*)?\(`                         | 2 079 ms | ×99   |
| `\?.*:` in the branch counter                         | 1 511 ms | ×96   |
| `^\s*(?:public\|private\|…)?\s*(\w+)\s*\(`            | 1 206 ms | ×94   |
| `^a\/(.+?)\s+b\/(.+)$`                                | 940 ms   | ×97   |
| `^.*?\(([^)]*)\).*$`                                  | 700 ms   | ×93   |

### 1.7 Eight patterns corrected, and one replaced by a scanner

Each has a stopwatch case in `packages/intelligence/src/__tests__/a-hostile-line-does-not-take-quadratic-time.test.ts`,
measured at 20 KB and 40 KB against a 500 ms ceiling **and** against the ratio, so neither a fast machine nor a slow one
can decide the answer.

| site                                | before   | after     | the correction                                                                            |
| ----------------------------------- | -------- | --------- | ----------------------------------------------------------------------------------------- |
| `lenses/structure-lens.ts` branches | 1 512 ms | **1 ms**  | a ternary is `?` not followed by `.` or `?` - one character, no scan across the line      |
| `lenses/structure-lens.ts` imports  | hang     | **1 ms**  | **the pattern replaced by `review/import-specifier.ts`**                                  |
| `review/diff-parser.ts` hunk        | 2 724 ms | **0 ms**  | git writes one space and one comma; the pattern says that instead of `\s+` and `,?`       |
| `lenses/api-lens.ts` routes         | 2 079 ms | **50 ms** | the token is bounded at 128 characters, four times the longest published field name       |
| `lenses/api-lens.ts` types          | 1 081 ms | —         | one whitespace run, inside the optional group, instead of two around it                   |
| `lenses/api-lens.ts` fields         | —        | —         | the same correction                                                                       |
| `git/git-operations.ts` hunk        | 750 ms   | —         | as `diff-parser`, and the same correction `review/actionability.ts` already carries       |
| `git/git-operations.ts` header      | 940 ms   | —         | `a/(.+?) b/(.+)` - one space, which is what git writes and what a path with a space needs |

**The import matcher is the case worth reading.** Bounding the two whitespace runs took it from "did not return" to
514 ms on 40 KB: linear, and still not shippable, because forty thousand candidate positions each tried sixty-four widths
before giving up. **The pattern was the wrong instrument.** "Find the keyword `from` that follows whitespace and is
followed by a quote" is a scan, and `readImportSpecifier` is one cursor that only moves forward - every character examined
a bounded number of times, whatever the line contains. It carries its own contract test, because a scanner is a function
and a function's contract should not be inferred from its caller.

### 1.8 Which of the remaining sixty-nine are reachable, measured rather than assumed

**A finding is not a defect, and the difference is the call site.** Three `rule-runner.ts` sites carry the same import
pattern and measure **0 ms** on the same 40 KB input, because the line reaches them through `line.trim()` - **and `trim()`
deletes exactly the adversarial string**, turning `import` and forty thousand spaces into a four-character word. The
finding is real; the defect is not reachable. Saying so is cheaper and more honest than editing three files to change
nothing.

`git-operations.ts` takes a `git diff` this process invoked itself, and a path cannot be 40 KB - the filesystem bounds a
path at 4 096 bytes - so its measured 940 ms is unreachable too. It is corrected anyway, because the same correction
already exists in `review/actionability.ts` and consistency is free.

**What remains clusters into six shapes, and the shapes are the plan**: a leading unbounded quantifier that needs an
exclusion rather than a length bound (`\s+as\s+` in the Python importer); `(.+)` followed by a character class that has
to appear at the end (`require(…['"](.+)['"]\s*\))`); an alternation containing `.*` (`lenses/style-lens.ts` string
scanning); and the family of `^\s*(?:mods)?\s*(\w+)\s*\(` signature matchers in `rule-runner.ts` and
`review/heuristics.ts`, where the cure is to move the whitespace inside the optional group so there is one run and one way
to reach the paren.

### 1.9 The seventy-six, measured by a program instead of by hand

**§1.6 sorted thirty-five findings in a scratch file and wrote the answer into a paragraph.** The paragraph cannot be
re-run, so the next reader has to take "twenty-two of thirty-five" on trust - and the paragraph's own numbers were
produced by two different thresholds in two different hours. **A measurement that lives only in prose is a measurement
with no provenance.**

The sort is now `scripts/redos-assay.mjs`, and it runs as the `redos-assay` job in `security-audit.yml` on every push
and pull request, with `--fail-if-quadratic`:

```
node scripts/redos-assay.mjs                     # every open ReDoS finding, measured
node scripts/redos-assay.mjs --json redos.json   # and written down
node scripts/redos-assay.mjs --fail-if-quadratic # exit 1 if any measured pattern is still quadratic
```

Four things about it matter more than its output.

1. **The input is CodeQL's claim, not this repository's guess.** The pump is read out of the message - _"strings starting
   with `X` and with many repetitions of `Y`"_ - and a message the parser cannot read is reported as `no-claim` rather
   than measured against an invented string.
2. **The verdict is not a wall clock alone.** §1.6 called a finding real at 200 ms at 40 KB, and that rule **missed
   `structure-lens` at 94 ms with a growth of ×95** - a quadratic pattern with a small constant, which is 225 times the
   cost on the 600 KB line a generated file can supply. The rule is now _did not return_, **or** crossed 200 ms, **or**
   grew by more than ×30 over ten times the input.
3. **The locator resolves the name, not the line.** CodeQL reports the line a pattern is _used_ on. A locator that
   matched by adjacency found sixteen of seventy-six and called sixty unmeasurable - which reads in a summary as "the
   corpus is small" rather than "the locator is blind". It reads `pattern.exec(...)` and finds `const pattern = /…/`.
4. **`unlocated` is a value.** A finding that falls out of the table between the API and the summary is the counting
   error §1.6 was written about.

**The first pass measured 76 findings: 54 quadratic, 21 linear, 1 unlocated.** After the corrections below: **0
quadratic, 73 linear, 3 unlocated** - and the three are findings whose pattern this iteration deleted, so the next
CodeQL analysis closes them rather than moving them.

**Five rules, and every correction in this iteration is one of them.**

| rule                                                              | what it looked like                                         | what it is now                                                 | sites |
| ----------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- | ----- |
| **a terminator's opener may not be in the class that runs to it** | `\{[^}]*\}` scanning to a `}` that never comes              | `\{[^{}]*\}`, which fails on the next opener                   | 8     |
| **two whitespace runs around an optional group are one too many** | `\)\s*(?::\s*\w+)?\s*\{` — every split of the run is a path | `\)(?:\s*:\s*\w+)?\s*\{` — one run, one way to reach the brace | 5     |
| **a name, a parameter list and a type annotation have a length**  | `(\w+)`, `\([^)]*\)`, `(?::[^=\n]+)?` unbounded             | `\w{1,128}`, `\([^)]{0,512}\)`, `{0,256}` — past anything real | 19    |
| **when the search is for a terminator, write a scan**             | `\/\*\*([\s\S]*?)\*\/` and `import\s+.*?\s+from`            | `readDocComments`, `readImportSpecifier` — one forward cursor  | 4     |
| **`(X+)+` is never a description of a token**                     | `(?:::\|\s+)+`, `(?:\w+[*]*\s+)+`                           | `(?:::\|\s)+`, `(?:\w{1,128}[*]*\s+)+`                         | 3     |

**Two of these are worth naming individually.**

`doc-comments.ts` is a scanner because **the pattern could not be made linear at all**. The unrolled form - the one a
careful author writes to replace a lazy body - still walks to the end of the file from every opening `/**` and gives the
walk back one character at a time; measured at **502 ms on forty kilobytes with the same constant as before**. "Find the
next `*/` after this `/**`" is `indexOf`, and `indexOf` examines every character a bounded number of times. It carries
its own contract test, including the case that made the first draft wrong: **the four characters of an empty block share
one `*` between the opener and the closer, so the search for the closer starts at `at + 2` and not `at + 3`.**

`\s+as\s+` became `\bas\b` in the Python importer. A leading `\s+` before a literal is quadratic on a line of spaces
because each of n candidate positions consumes the rest of the run; a **word boundary needs no run at all**, and `as` is
a word. The first version of that change left the trailing space on the imported name - `'thing '` instead of `'thing'` -
and a fallback-parser test caught it, which is the argument for a scanner-shaped change arriving with the test that
already existed.

**Three findings the table could not place, and why that is the right answer**: `php.ts:531`, `rule-runner.ts:291` and
`rule-runner.ts:1653` are the doc-comment and import patterns this iteration deleted. Their alerts are attached to lines
that no longer hold a pattern, and the assay says so instead of measuring a neighbour.

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

## 3. `TokenPermissionsID`: 10 reported, 16 in the tree, 0 now

`TokenPermissionsID` counts a `write` scope granted **above the job that uses it** — at the top of a workflow, or on a
job that does nothing with it. It is not, as an earlier version of this section said, a workflow without a
`permissions:` block.

The rule as Scorecard applies it reports one finding per file, and this repository had sixteen. The five it named at
workflow level were the ones whose unused scope happened to be the one the query looks at first; the other six were the
same defect in files it did not report. All sixteen are on the job that uses them now, and one was **used by nothing at
all** — `real-world-validation.yml` granted `issues: write` to a workflow that opens no issue, writes its summary to
`$GITHUB_STEP_SUMMARY` and uploads reports as artifacts.

Two things about the shape of the defect are worth keeping:

- **A job-level `permissions` map replaces the workflow-level one rather than extending it.** `pr-review.yml` granted
  `checks: write`, `issues: write` and `pull-requests: write` at the top to four jobs that each declared their own map;
  the grant was inert, and would have become live the moment a fifth job was added without one. It is
  `permissions: {}` — a new job gets no token until someone writes down what it needs.
- **A narrowing can break a job that was relying on the grant it inherited.** Moving `security-events: write` to the
  job that uploads SARIF left `redos-assay`, the only job in that file that reads `code-scanning/alerts`, with
  `contents: read`; its next run failed with `HTTP 403 on page 1`. The job declares `security-events: read` now.

`scripts/workflow-permission-gate.js` asks it of all 41 workflows on every push: no workflow-level `write`, no
`write-all`, and no workflow that states nothing (absence inherits the repository default, and the file does not say
which that is). It reports the 30 remaining job-level writes rather than failing them, because a job that publishes a
release or uploads an alert is doing what the scope is for.

## 4. `PinnedDependenciesID` (20), and what is left

`PinnedDependenciesID` counts GitHub Actions, `pip`/`npm` commands and container images that are not pinned to a
digest. Every **action** in this repository is pinned by the `action-pin-gate` (281 references, 30 repositories, one
commit each); the twenty open are the other three kinds — a base image per `Dockerfile` stage, six `npm`/`pip`
installations inside benchmark workflows, and one `downloadThenRun` in `scripts/setup.sh`. A digest is resolved per
reference and a wrong one is a broken job, so each lands with a green run behind it rather than beside one.

**The rest of the ledger, read on 2026-11-11: 72 open.** `js/file-system-race` (7), `js/file-access-to-http` (6) and
`js/http-to-file-access` (5), `js/template-syntax-in-string-literal` (4), the 20 above, `js/polynomial-redos` (2,
both measured linear at 40 KB and 400 KB and recorded as a choice rather than hidden), `js/call-to-non-callable` (2, in
a fixture that exists to be wrong), and fourteen single instances listed in
`audits/2026-11-11-the-scope-and-the-name.md` §11. **What is not in this document is not triaged**, and §11 of that
page is where the untriaged ones are named rather than counted.
