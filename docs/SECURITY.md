# Security

**What this document is for.** Every open security finding on this repository has a place here that says what was measured
about it, because **a finding whose status is "triaged" and whose measurement is missing is a finding nobody has looked
at** - and this repository had twenty-five of those for three iterations.

The rule this file exists to enforce: **an alert is closed by a test that reproduces its input, not by a paragraph that
describes its shape.** Where the test exists, this file names it. Where it does not, this file says so.

---

## 1. `js/polynomial-redos`: twenty-five alerts, measured rather than classified

### 1.1 What was measured

CodeQL reported twenty-five regular expressions as polynomial-time on adversarial input. The audit called them
"triaged" three times and never attached a number. So each pattern was fed an input built for **its own** shape - a run
of keywords with no declaration after them, an unterminated delimiter, a block comment opener with no closer, a single
long identifier with no `=` - at roughly 60-160 KB, which is a plausible single-file size in the repositories this
product reviews.

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

### 1.5 What is not covered

- **`compile-evidence.ts` and `style-lens.ts`** have their own patterns (a compiler-output line, a string literal) and
  neither has a hostile-file test, because neither takes a whole source file. Both measured under 3 ms. **Stated here as
  a gap rather than as a pass.**
- **A regex that is linear in the number of matches but quadratic in the number of failures inside one match** is not
  covered by any input in this file that has not been tried against it. The nine inputs above are a floor.

---

## 2. `js/insecure-temporary-file`: nineteen alerts

Nineteen open. Every one is in test scaffolding or a script that writes to `os.tmpdir()` without a unique name. **Not yet
fixed, and not yet measured**, which by the rule at the top of this file means it is not triaged either. It is the next
security item.

## 3. `PinnedDependenciesID` (twelve), `TokenPermissionsID` (five), and the rest

`PinnedDependenciesID` counts GitHub Actions references that are not pinned to a commit SHA. `TokenPermissionsID` counts
workflows without an explicit `permissions:` block. Both are configuration findings with a mechanical remedy and neither
is exploitable without write access to the repository, which is why they have sat behind the regex work.

**The order in this document is the order of the work, not the order of the severity labels**: a source file can reach the
regexes, and a source file cannot reach a workflow's `permissions:` block by itself.
