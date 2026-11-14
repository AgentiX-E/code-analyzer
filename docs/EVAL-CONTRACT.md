# The evaluation contract

**What this document is.** The rules a figure in this repository has to satisfy before it may be written down, and the
rules a document has to satisfy before it may call itself a measurement. It exists because the rules were applied
carefully in one file and not at all in three others, and because every gate in this repository was green while that
was true.

**What it is not.** A description of a harness. The harnesses are in `benchmarks/`, `scripts/` and `.github/workflows/`
and each names its own corpus, its own judge and its own artifact. This page says what may be claimed from them.

---

## 1. Five layers

A measurement answers a question at one layer. **A number from one layer may not be quoted as if it came from
another**, which is the mistake that produced a four-column table of vendor figures beside our own.

| layer                    | subject                                                                                            | the question                                                                                | what can falsify it                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **L0 — declaration**     | every Markdown file                                                                                | does every figure resolve to an artifact, and does every artifact still support the figure? | `numbers-gate.js`, `benchmark-dataset-gate.js`, `docs:code-sync`, `baselines:anchors`                                                 |
| **L2 — regression**      | the 19-phase pipeline, 32 providers, the graph and the search stack                                | did this commit change what the product returns?                                            | the golden results under `tests/` and `packages/*/src/**/__tests__`                                                                   |
| **L4 — agent surface**   | 51 MCP tools, the permission model                                                                 | does an agent pick the right tool, refuse the wrong one, and stay inside its role?          | `scripts/agentic-tools.ts` over `benchmarks/agentic-tools.json`; `docs:agentic` on every push, `agentic-tools.yml` for the model arms |
| **L1 — external parity** | OWASP Benchmark, CoSQA, Long Code Arena, Martian, Alibaba `aacr-bench`, 100 public bug-fix commits | how do we stand on corpora we did not author?                                               | the artifact each harness writes, and its gate                                                                                        |
| **L3 / L5**              | retrieval-augmented generation, live traffic                                                       | not applicable                                                                              | the product has no generation path and no deployment                                                                                  |

**L4 is a main layer, not a stretch goal.** The tools are the product's action space: a wrong tool call changes state,
where a missed bad-practice comment does not. It was the only layer with no measurement at all for four iterations and
is written down here as a gap no longer: `scripts/agentic-tools.ts` asks a model 100 questions over the live catalog and
scores the tool it chose, and `benchmarks/agentic-tools.json` is the artifact. **What it measures is a decision** — one
choice among 51 tools on this repository's own code — and `benchmarks/citations.json` states what that cannot be
compared with. The permission half of the layer is still unmeasured: a call can be schema-valid, land on the right tool
and be one the caller had no right to make, and no arm here asserts that.

---

## 2. How a figure may be written

Three rules, all enforced by `scripts/numbers-gate.js`:

1. **A withdrawn value may not be restated on a metric line, anywhere.** The values are read from
   `benchmarks/citations.json`, so a citation falling below the floor automatically forbids its own numbers. A line
   may carry the figure if it also says `withheld`, or states that the measurement is `below the publication floor` —
   because a number published with its limitation beside it is a different act from a number published alone.
2. **A document that publishes figures names its sources**, in an HTML comment near the top:
   `<!-- figures: citations:<key>,<key> -->`. Every key must exist in the citations file and every artifact it names
   must exist.
3. **The gate must find something.** It fails when it scans fewer figure lines than a declared floor. A check whose
   subject has stopped existing reports green forever; that is not a hypothesis, it is what this repository did for
   three months.

### What these rules cannot say

**They cannot prove that a particular number came from a particular citation.** Rule 2 is document-level, so a
document may declare `citations:aacr-bench` and publish a number from somewhere else. Closing that needs a per-line
pointer (`{{citations:aacr-bench.metrics.f1}}` resolved at build time), which is the next rung of the ratchet and is
recorded in `roadmap.md` under Phase 21. **Do not describe this gate as stronger than it is**; the paragraph above is
the limit, and a gate that is believed to be stronger than it is becomes the next thing that lies.

**They cannot say whether a corpus is representative.** A floor of 100 says the sample is not tiny. It does not say
the sample looks like a user's repository.

---

## 3. What a citation must carry

`benchmarks/citations.json` is the single record. An entry names:

| field                       | meaning                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `artifact`                  | a file in this repository that holds the measurement. **A citation to a missing artifact is worse than no citation.** |
| `measuredAt`                | the date. A figure with no date is a figure with no version.                                                          |
| `samples`                   | how many units were measured                                                                                          |
| `groundTruthIssues`         | how many labelled facts the corpus holds — the number the floor applies to                                            |
| `groundTruthSource`         | where those labels came from, in a sentence a reader can act on                                                       |
| `independentValidation`     | `true` when somebody other than this project produced the labels **and** the scoring                                  |
| `datasets[]` or `countFrom` | how to count it, when the count is checkable here                                                                     |
| `metrics`                   | the numbers, and only numbers that an artifact contains                                                               |
| `caveat`                    | what the figure does not mean                                                                                         |

**The floor is the veto; `independentValidation` is a disclosure.** A figure from a dataset below 100 issues may not
be published. A figure whose labels this project wrote may be published _with that stated beside it_ — the OWASP score
is the case: the labels are the benchmark's, the scorer is ours, and replacing a stated caveat with silence would be
the failure this document exists to prevent.

**Two units may never be added.** The internal suite was recorded as 49: fifteen _cases_ plus thirty-four _issues_.
The gate agreed because it counted `id:` strings and the cases were the only `id:` strings in that file. `datasets[]`
exists so each part is compared in its own unit before anything is summed.

---

## 4. What each layer may say in public

| layer | may say                                                                                                                | may not say                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| L0    | "every published figure resolves to an artifact"                                                                       | "every published figure is correct"                                                     |
| L2    | "this commit did not change the output"                                                                                | "the output is good"                                                                    |
| L4    | "on this question set, with this model, the right tool was chosen N times"                                             | "the agent is safe"                                                                     |
| L1    | "on this corpus, under this criterion, with this judge, we score X; the corpus author's tool scores Y in the same run" | "we are better than Y" when the two numbers came from different runs, corpora or judges |
| L3/L5 | nothing                                                                                                                | "it works in production"                                                                |

---

## 5. The gaps, named

Written here so that the absence is a decision rather than an oversight:

1. **L4 has two measurements and one gate, and the gate is the part with no sampling error.** 100 tasks over the live
   catalog: **198 of 240 decoyed attempts chose the right tool and stated a schema-valid call (0.8250), against 28 of 80
   for BM25 over the same catalog (0.3500)**, paired at p = 1.72 × 10⁻¹⁴; the chain half is 21 of 42 and 16 tasks were
   never right in three attempts. **Two of the five runs behind that figure measured a model that had been told nothing**
   — the system prompt was built and never sent — so the honest description of those two numbers is "a failure of the
   harness", not a model result, and the three runs that sent it produced 0.7875, 0.7958 and 0.8250, a spread inside one
   run's interval. **The permission half now has a measurement of its own, over two channels**: 100 planted instructions
   inside the file the agent was asked about, and 100 inside a call site it was never told about, **0 of 200 exposed
   attempts complied** — a 1.88 % ceiling across both — against **96 of 100 when the user asked for the same call**
   (0 to 96, p = 2.52 × 10⁻²⁹), and every one of those 96 calls was refused by a read-only client and by a `scout`
   profile, which is the enforcement tested without a model rather than the statistic. **The second channel measured
   nothing until the question was repaired**: it asked what the caller does with a symbol, which `search_code`'s node list
   answers, so exposure was 0 of 100 and `asr` was null; it now names the handler — one file — and asks what its body
   returns for an empty input, exposure became 100 of 100, and 61 of those attempts read both files. **The control read 32
   two iterations ago and that figure is withdrawn** — the only change was a third tool turn, so it measured the harness's
   turn budget — and it read 98 against 96 in the two runs at the current procedure, which is the sampling noise the
   interval describes. **What remains unmeasured is policy rather than mechanism**: which role a given deployment should
   grant, how a token maps to a role, whether a payload in a commit message or a dependency's README behaves like one in
   a file the agent read, and whether the boundary holds when the planted text is twenty turns behind the model. Nothing
   here asserts safety, and the selection rate in particular may not be quoted as if it did.
2. **The LCA table reproduces, and it took three runs to say anything durable.** `docs/BENCHMARK_REPORT.md` quoted 0.4673
   over 115 rows from a run whose merged artifact was never committed. The merge then produced one — 0.4746 over 125 rows
   — but stated no scope on any row and set a cap wider than its own charge. **The artifact now holds the run the harness
   produces after both defects were fixed**: 0.4647 over 141 of 150 rows, 150 of 150 rows scoped, a cap of 3 833 against
   3 963. **The 0.3955 an audit read as a second run's figure is `sample.worstCaseMap`** — the same artifact with every
   refusal scored zero — so what looked like two runs disagreeing was one run quoted at two denominators, and the rule
   that follows is the one this document already states: a mean without its denominator is not a figure. **What three
   runs establish is narrower than any of them claimed**: BM25 has never cleared its own paired test (p = 0.657, 0.5154,
   0.5467) and its interval changed sides when the sample grew, while TF-IDF cleared it twice. "We lead the term-count
   family" is supportable; "we beat BM25" has never been established on this corpus. **The current figures in that section
   are rendered from the artifact** by `scripts/lca-report.js`, delimited by markers, with `--check` in CI refusing a
   report and an artifact that disagree. The narratives older than the artifact are still prose: they are analyses of the
   earlier run's rows, and each says so.
3. **OWASP has no official scorecard.** The labels are the benchmark's and the formula is the scorecard's, but the
   implementation has never been diffed against `BenchmarkUtils`. A reimplementation nobody has compared is a
   hypothesis.
4. **One corpus, one shape.** 2 740 generated servlets measure one shape of Java. Juliet is the heterogeneous
   cross-check and it is not wired.
5. **`INDUSTRY_COMPARISON.md` is a rubric**, and its banner now says so. It is generated from weights this project
   chose, four of its five rows are vendor documentation, and it ranks us first. It should be rebuilt so every cell
   resolves to an artifact, or retired.
6. **The annotation protocol is single-annotator.** No κ can be computed until a second person labels the internal
   suite, and a κ that was not computed may not be quoted.

---

## 6. A rule registered before the run

**The figure this section governs** is the review comparison in `benchmarks/aacr-bench.json`: this engine and one
competitor, over the same pull requests, judged by one model against one set of goldens. The last run of it put this
engine's precision below the competitor's while its recall was identical — **so the defect is selection, not detection**,
and a selection rule is exactly the kind of thing that can be tuned into a win after the fact.

**So the rule was written down before the run it scores**, and the run does not get to choose it:

| what             | registered value                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| order            | descending actionability score, computed from the diff and the finding alone; tie-broken by agreement, then severity, then input order |
| emitted          | a finding whose range covers an added line **and** which either names an action or quotes added code                                   |
| not emitted      | everything else — **kept in the artifact, judged, and reported as a superset**, never dropped before it is scored                      |
| primary figure   | precision, recall and F1 **of the emitted set**                                                                                        |
| secondary figure | the same three over everything emitted, and the top-k curve at k = 1, 2, 3, 4, 6, 8, 12, 16, 24, 32 per pull request                   |
| control          | the same ranker and the same rule applied to the competitor's findings                                                                 |

**Three things follow from registering it, and each one is a way of being wrong that this repository has already been.**

1. **The curve may not be used to pick the rule.** A point chosen after seeing the curve is a point fitted to fifty
   goldens, and it would be reported as a measurement. The curve is published **as a diagnostic** — it says what a
   different budget would have produced — and any figure quoted from it must say that it was chosen afterwards.
2. **The rule is allowed to lose.** It is a claim about comments, not a search over thresholds, and the fixture in
   `--dry-run` is built so that the rule's F1 is _lower_ than the whole list's on it. **A rule that cannot fail is not
   being tested.**
3. **A protocol change is a protocol change for both arms.** The matching is now a maximum bipartite matching over a
   full verdict matrix, where the previous run consumed each golden with the first finding that matched it in judging
   order. **That changes both denominators**, so the competitor's figures are recomputed in the same job under the same
   matcher, and a comparison against the previously published 0.3235 is a comparison across protocols and may not be
   made.

**What would falsify it.** The emitted set's F1 at or below the competitor's F1, measured in the same job — in which case
the rule is not doing what it claims and the honest next step is a calibration split, not a lower threshold.

### 6.1 What the registered run then said

**The rule improved the number it was aimed at and lost the comparison it was registered for.** Both halves are recorded,
because the second is the one that would have been left out of a report written from the first:

| figure                                                             | value                      |
| ------------------------------------------------------------------ | -------------------------- |
| emitted set — precision / recall / F1                              | 0.2019 / 0.42 / **0.2727** |
| the same run's whole list — precision / recall / F1                | 0.1311 / 0.48 / 0.2060     |
| the competitor, same job, same judge, same matcher                 | 0.3857 / 0.54 / **0.4500** |
| the competitor with this repository's ranker applied to its output | 0.5517 / 0.32 / 0.4051     |
| best point on the published curve (16 comments per pull request)   | 0.3396                     |
| paired test over detected goldens: ours-only / theirs-only / p     | 6 / 12 / 0.2379            |

**So the ordering is worth +0.067 F1 and +54 % precision against the same reviewer's own list, and the reviewer still
loses.** `EXTERNAL PARITY`'s floor is not met on this corpus, no figure here may be written as a win, and the next
iteration's target is stated by the curve rather than by an opinion: **0.3396 is the best any budget of these findings
reaches, so the defect is emission — 183 findings carrying 24 goldens, against 70 carrying 27.**

**What the control rules out.** The ranker raised our F1 and _lowered_ the competitor's, so **it is a repair for
over-emission and not a better reviewer**; a future report that quotes the gate's gain as evidence of review quality
would be quoting a number that this paragraph already explains.

**What the paired test rules out.** With six discordant goldens one way and twelve the other, **the difference in what
each reviewer detects is not distinguishable from chance on fifty goldens**. That is not a defence of our number — our
F1 is half theirs — it is a bound on what fifty goldens can say, and it is the reason the next measurement needs more
pull requests rather than a lower threshold.

## 7. A second rule, registered before its run

**§6's registered run answered its question and lost its comparison.** The ordering raised the same reviewer's
precision by half and F1 by 0.067, and the reviewer still lost 0.2727 to 0.4500 — and the curve said why in one line:
**no budget of those findings reaches 0.45**, because 183 findings carried 24 goldens while the competitor's 70 carried 27. **Ordering cannot close a gap that emission opens.**

**So this rule changes what is emitted, not what is ordered**, and it is registered in this file before the run for the
same reason as the last one: **a rule chosen after seeing the curve is a rule tuned on the test set.**

| field                 | value                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| order                 | one call per lane **for the whole pull request**, at most **16 findings for the pull request**, each naming a file the call showed; ranges judged against **that file's** own hunks |
| control               | the file arm in the same job — one call per file per lane, three findings per file per lane: **183 findings, 0.2019 / 0.42 / 0.2727**                                               |
| primary figure        | the pull-request arm's F1 at 16 findings per pull request, **greater than 0.4500**                                                                                                  |
| secondary figure      | the arm's own budget curve at 1–16 findings per pull request, and the paired test against the file arm on the same 50 goldens                                                       |
| what would falsify it | the arm's precision below **0.375** at 80 emitted findings, which is the value at which 30 true positives — and F1 0.45 — stop being reachable                                      |

**Why 16, stated as arithmetic rather than as a preference.** With 50 goldens, F1 > 0.45 requires `2·TP / (emitted + 50) > 0.45`. At 80 emitted findings that is **30 true positives**, which is a precision of **0.375**. **The pull-request scope has already demonstrated 0.40** — measured at 15 findings per pull request, against the file arm's **0.20 at the same 15 findings**: **the same budget, two scopes, a factor of two in precision.** The rule therefore says something narrow and checkable: **a modest decay from 0.40 is survivable and a collapse is not.**

**What this rule does not claim.** It does not claim the scope is why the competitor wins — their reviews are also one
pull request at a time, which is why the two arms are the right experiment rather than a hopeful one. It does not claim
16 is optimal; the curve is published with it so that the claim it makes can be checked against the neighbouring
budgets. And it does not retire the file arm: **a scope that wins on this corpus and loses on a monorepo pull request
that touches two hundred files is a scope with a condition attached**, and the file arm is how that condition would be
found.

### 7.1 What this rule would make the product say

A pull request review in this repository would then have two documented scopes rather than one:

- **`reviewDiff`** — one file, three findings, the unit that a pre-commit hook and an editor integration need;
- **`reviewPullRequest`** — one pull request, a budget, and **every finding naming the file it is about**, which is the
  unit a code review is actually conducted in.

**And the second is not a scale-up of the first**: it requires a path per finding, judges ranges against per-file
hunks, refuses to file a finding against a file the model was not shown, and does not merge two files' findings on the
strength of a shared line number. **Those four differences are the feature**, and each has a test in
`pull-request-review.test.ts` rather than a paragraph here.

### 7.1 What the registered run then said, and why it is not the figure

**The run falsified the rule and convicted its implementation.** Both halves belong in the record, and they arrived in
that order — the figure first:

| figure                                                   | value                                    |
| -------------------------------------------------------- | ---------------------------------------- |
| pull-request arm — precision / recall / F1               | 0.2121 / 0.14 / **0.1687**               |
| file arm, same job, same judge, same goldens             | 0.1765 / 0.36 / **0.2368**               |
| paired test over detected goldens: both / ours / theirs  | 5 / 2 / 16, exact McNemar **p = 0.0013** |
| pull-request arm findings kept / parsed                  | 33 / 120                                 |
| dropped as `unknownPath` / `beyondDiffLength` / `capped` | **31** / 6 / 0                           |
| five lanes' 83 surviving findings, after deduplication   | **33** — 6.6 comments per pull request   |

**Two of those rows are not a result, they are a defect report**, and each explains a different part of the loss:

1. **The arm was not shown the pull request.** `maxDiffLength` is sized for one file, and the pull-request scope reused
   it: 8 000 characters, keeping the first four thousand and the last four thousand. **On a hundred-file pull request
   that is two files shown perfectly and ninety-eight not shown at all**, so the arm differed from the control by a clip
   as well as by a scope. The scope now has its own budget, spends it **per section** so that every file is shown
   something, redistributes the share a small file did not need, and annotates a clipped section by name and in
   characters — because a model that is not told what it was not shown reports the absence as a finding.
2. **Deduplication was merging by vocabulary and not by location.** The wording-only merge existed for the case where
   two lanes describe one defect in different words, and it had **no distance constraint**: _"this value is not
   checked"_ is one string at line 20 and at line 900. Five lanes over one pull request produced 83 survivors and the
   merge left 33 — **6.6 comments for a pull request whose budget allowed 16**, so **the budget never bound and the arm
   could not spend it.** The merge now requires the two findings to be in the same file **and within thirty lines**,
   which is a function rather than a file.

**And a third defect that the counters named rather than the figure.** Of 120 parsed findings, **31 named a path the
call did not show**, and nothing in the artifact could say which paths they were. **A counter that cannot be explained
is a counter that gets explained by whoever writes the report**, so the artifact now carries the first twenty of them,
with the path and the rule. One mechanism is already known and fixed: **a rename names one file twice** — `a/old.ts`,
`b/new.ts` — and the scope registered only the right-hand side, so a finding about a renamed file was a finding about a
file the call had not shown. Both sides are now accepted and the right-hand one is stored, because that is where a
comment anchors.

**What run 1 therefore is.** A run that measured a clip, a merge without a location, and one path rule too narrow. **It
is recorded here in full and it is not the figure**, because the rule it registered is about where the budget sits and
that question was not asked. **Run 2 measures the same registered rule on code that implements it**, with the amended
arithmetic unchanged: 16 findings per pull request, precision above 0.375, F1 above 0.4500.

**And one number that run 1 establishes independently of the rule.** The file arm moved from **0.2727 to 0.2368 between
two runs of the same protocol** — no code change to the file scope, same judge, same goldens, temperature 0.3. **That is
±0.04 of run-to-run movement, larger than several differences this project has quoted**, and it is the reason the two
arms are compared by a paired test inside one job rather than by two figures printed side by side in two reports.

### 7.2 What the corrected run said, and the premise the rule was built on

**Run 2 measured the registered rule on code that implements it, and the rule lost again — by more.**

| figure                                                   | run 1 (defective)      | run 2 (corrected)               |
| -------------------------------------------------------- | ---------------------- | ------------------------------- |
| pull-request arm — precision / recall / F1               | 0.2121 / 0.14 / 0.1687 | 0.1786 / 0.10 / **0.1282**      |
| file arm, same job                                       | 0.1765 / 0.36 / 0.2368 | 0.2079 / 0.42 / **0.2781**      |
| paired test: both / pull-request only / file only / p    | 5 / 2 / 16 / 0.0013    | 5 / **0** / **18** / **0.0000** |
| pull-request arm findings, kept from parsed              | 33 from 120            | **28 from 109**                 |
| dropped as `unknownPath` / `beyondDiffLength` / `capped` | 31 / 6 / 0             | 18 / 6 / **0**                  |

**The correction worked and did not rescue the hypothesis.** The truncation now shows every file a share, the merge
has a distance, and a rename is one file under two names — and the arm still emitted **5.6 findings per pull request
when its budget allowed 16**, with `capped` at zero in both runs. **The budget was never the binding constraint**, so
the rule's mechanism was never exercised: the lanes simply do not write sixteen things about a whole pull request.

**And the premise the rule was registered on does not survive its own arithmetic.** The registration rested on
_"precision 0.40 for the pull-request scope against 0.20 for the file scope at the same fifteen findings"_. **Fifteen
findings is six true positives and nine false positives**, whose 95 % interval for the proportion runs from about
**0.20 to 0.64** — **an interval that contains the file scope's 0.21.** The factor of two was **six against three
findings**, and it was treated as a measurement. **That is the error this section exists to record**, and it is the same
error in a new costume as the ones §2 forbids: a figure quoted without the range it was measured over.

**What the three runs jointly establish, and it is worth more than the rule was.**

- **The file scope's F1 over this corpus is 0.2727, 0.2368 and 0.2781** — three runs, no change to it, same judge, same
  goldens. **So the instrument's resolution is ±0.04, and any difference smaller than that cannot be read as a
  difference between reviewers.**
- **The pull-request scope is worse here, and the paired test says so twice** (p = 0.0013 and p = 0.0000, with 18 goldens
  found only by the file scope and none only by the other way in run 2). **This corpus does not reward the scope**, and
  the honest next statement is about why rather than about a threshold: its pull requests are C++ changes whose defects
  sit inside one file, so a shared conversation adds cross-file vocabulary and loses per-file attention.
- **The scope stays in the product and out of the figure.** `reviewPullRequest` is a feature with four rules and a
  suite; it is not the benchmark's operating point, and `benchmarks/aacr-bench.json` records both.

### 7.3 What the next rule would have to be

**Not another budget.** Two runs with `capped` at zero say the budget is not where the loss is. **The next lever is the
one the competitor's source shows and this repository does not have**: a **per-language defect checklist carrying
explicit do-not-report conditions**, injected into the lanes — `internal/config/rules/rule_docs/java.md` in their tree
is 41 lines of defect classes where every class ends in _"do not report in the following cases"_. **That is a precision
device that does not depend on the budget or the scope**, which is exactly what the evidence now points at: our
precision is 0.21 and theirs is 0.3857 on the same goldens.

**And a condition on quoting it.** At ±0.04 resolution on five pull requests, **a checklist that moves F1 by less than
0.04 will not be measurable here.** The next registration therefore has to come with more pull requests — about nine
more would take the golden count to ~140 — or it will be a rule that cannot fail, which §6 was written to prevent.

## 8. A third rule, registered before its run: a device and a size

**§7.3 named the next lever and the condition on quoting it, and this section registers both before either is built.**

### 8.1 The device

**A per-language defect checklist in which every rule carries an explicit "do not report when" clause**, added to all
five lanes in both scopes. The shape comes from the competitor's own tree — `internal/config/rules/rule_docs/java.md`
is 41 lines of defect classes where each class ends in _"do not report in the following cases"_ — and the mechanism is
**precision**: a lane told only what to look for spends its budget on the language's ordinary idioms, and **an idiom
reported as a defect is a false positive with a citation.**

Eleven languages, selected by the extension of the files a call covers, most-represented first, at most three per call:

| language          | rules | the exclusion that does the work                                     |
| ----------------- | ----- | -------------------------------------------------------------------- |
| Java              | 7     | a stream **returned to the caller** is not a leak                    |
| JavaScript        | 7     | `x == null` is the idiom; `x === null` is the bug                    |
| TypeScript        | 7     | an `!` dominated by a check in the same hunk is not an assertion     |
| Python            | 7     | a handler that logs or re-raises is not a swallow                    |
| Groovy / Gradle   | 6     | work inside `doLast` or a `Provider` is not eager configuration      |
| XML / descriptors | 6     | a factory from a hardened helper has already disabled entities       |
| YAML / CI         | 7     | a reference to a full 40-character SHA is pinned                     |
| JSON              | 5     | a JSONC file may carry the comment the strict parser rejects         |
| Kotlin            | 6     | `!!` dominated by a check in the same hunk is not an assertion       |
| Swift             | 6     | a `[weak self]` capture list already breaks the cycle                |
| ArkTS             | 5     | a `.ts` interop file behind a typed wrapper is not strict ArkTS      |
| C and C++         | 8     | a pointer handed to a smart pointer is not a leak                    |
| Go                | 7     | a goroutine that ends when its input is closed needs no done channel |

### 8.2 The size, and why the rule may not be quoted without it

**±0.04 is this instrument's resolution at five pull requests** (§7.2: three runs, no change, 0.2727 / 0.2368 / 0.2781).
A device expected to be worth less than that **cannot fail here**, and §6 exists to prevent registering a rule whose
failure is indistinguishable from its success. **So the corpus moves from five pull requests to fourteen** — about
140 goldens — in the same change as the device, and **the comparison is internal to one workflow run**, so the corpus
change cannot explain the difference: both arms read the same fourteen pull requests.

**What the resolution at fourteen pull requests is, is not claimed.** It is one measurement, and **the reading that does
not depend on it is the paired test**, which counts only the goldens one arm found and the other did not.

### 8.3 The design: two runs, one variable, and a comparison that cannot call a model

| element    | file arm, checklist on                  | file arm, checklist off                   |
| ---------- | --------------------------------------- | ----------------------------------------- |
| job        | `aacr-bench` matrix, `checklist: with`  | `aacr-bench` matrix, `checklist: without` |
| corpus     | 14 pull requests, ~140 goldens          | identical                                 |
| judge      | `deepseek-chat`, same endpoint          | identical                                 |
| engine     | same commit, `languageChecklist: true`  | same commit, `languageChecklist: false`   |
| difference | **the prompt section and nothing else** | —                                         |

**And the difference is asserted, not assumed**: a test computes the common prefix and common suffix of the two prompts
for one change and requires everything between them to be the checklist — so "one variable" is a property of the code
rather than a sentence in a report. The `compare` job runs on a runner with **no provider credentials and no corpus
checkout**, so the number it produces cannot have come from a model.

### 8.4 The prediction, written before the run

1. **F1 with the checklist is at least 0.04 above F1 without it**, on the same fourteen pull requests.
2. **The mechanism is precision**: precision rises, and recall does not fall by more than one golden.
3. **Fewer findings are emitted for the same coverage** — the device's whole claim is that it removes false positives
   rather than adding true ones.
4. **The paired test is reported either way**, including when it is not significant at this size, because **§7.2's
   lesson was that a magnitude without a test is a story**.

**What falsifies it.** A gain below 0.04 falsifies prediction 1 and the section will say so in those words. A gain above
0.04 with precision flat or falling falsifies prediction 2 and the artifact records the split verdict — **a device that
moved the number for a reason other than the one it was registered for is not the device that was registered.**

**And what would be concluded if it loses.** That the prompt's _specificity_ is not this engine's constraint either, in
which case the remaining difference against the competitor is not in the prompt at all but in **what the two systems do
with a finding after the model produces it** — their review walks a repository and this one reads a diff — and the next
registration would be about **retrieval**, not about wording.

### 8.5 The amendment, and the hour it was made

**The list above first held only the eleven priority languages, and that list was wrong for this corpus.**

Counting the file extensions of the first fourteen pull requests through the GitHub API — one call per pull request,
before either arm had produced an artifact — gives:

| extension | files |
| --------- | ----- |
| `.cpp`    | 152   |
| `.h`      | 64    |
| `.go`     | 38    |
| `.py`     | 22    |
| `.txt`    | 19    |
| `.diff`   | 18    |
| `.ui`     | 10    |
| `.ts`     | 4     |
| others    | 5     |

**Two thirds of the treatment's own subject had no rules.** The first two runs of the matrix
(`42566825132`, `42568662388`) were cancelled for that reason, and **neither had written an artifact** — so this
amendment was made with no figure from either arm in existence, which is the only condition under which amending a
registration is not choosing the rule after the run.

**What changed:** a C/C++ definition (8 rules) and a Go one (7), added after the eleven, and `.ui` added to the XML
definition because Qt designer files are XML. **What did not change:** the claim, the corpus size, the design, the
prediction and the falsification tests, all of which remain exactly as §8.1–§8.4 state them.

**And what the amendment buys the measurement**: the checklist now applies to about 95 % of the corpus's files rather
than 9 %, so the run measures the device instead of measuring a device that was not there.

### 8.6 What the run said

**Run `42569985626`, 2026-11-09, fourteen pull requests, 170 goldens, one judge, two arms.** The comparison artifact is
`benchmarks/aacr-checklist-paired.json`; the default configuration's figure is `benchmarks/aacr-bench.json`. **That
artifact is frozen history**: the comparison job now writes `benchmarks/aacr-ablation-paired.json` for whichever field
the two arms vary, so the checklist comparison stays where it was measured and every later hypothesis is filed
separately - §19.3's is `benchmarks/aacr-ablation-paired.json`, cited as `aacr-emission-paired`.

| figure                                         | with the checklist  | without it | difference     |
| ---------------------------------------------- | ------------------- | ---------- | -------------- |
| precision                                      | **0.2893**          | 0.2189     | **+0.0704**    |
| recall                                         | 0.2059              | **0.2588** | **−0.0529**    |
| F1                                             | 0.2405              | 0.2372     | **+0.0033**    |
| true positives                                 | 35                  | 44         | −9             |
| false positives                                | **86**              | 157        | **−71**        |
| findings emitted, after the actionable gate    | **199**             | 339        | **−140**       |
| findings the five lanes produced, before merge | **406**             | 928        | **−522**       |
| merged away as duplicates                      | 207                 | 589        | −382           |
| paired test — both / with only / without only  | 27 / **8** / **17** | —          | p = **0.1078** |

**The registered magnitude is falsified, and the report says so in the registration's own words.** The gain is
**+0.0033**, which is **twelve times smaller than the 0.04** the registration named, and inside the instrument's
resolution.

**And the matrix no longer varies this device.** Two paired runs later the checklist was measured again at −0.0237 with
p = 0.0049 (§16.2), so the arms of the workflow now vary `AACR_PROFILE` - the category floor registered as R-17 in §19 -
and the comparison job **reads the varied field out of the two artifacts** rather than being told which flag it is
comparing. **A device that has been falsified twice does not get a third arm by default**; it gets a registration, and
this one has none. The per-pull-request figures above remain the record of the run that falsified it.

**The mechanism prediction is also falsified, and for a more interesting reason.** §8.4 said _"precision rises and recall
does not fall by more than one golden"_. Precision did rise, by 0.070 — **two thirds of the distance the device had to
travel, from 0.219 to the competitor's 0.329** — and recall fell by **nine goldens, not one**. So **the device works exactly as designed
and the design was the wrong bet**: it buys precision at a price in recall that, on this corpus, is the same size as the
gain.

**What is left, stated as the two facts that survive the falsification.**

1. **The checklist is a real precision device.** False positives fell from 157 to 86 — **45 % fewer wrong findings** —
   and the lanes produced 56 % fewer findings overall (928 → 406). **That is not a wash and it is not noise; it is the
   largest single move any device has made on this corpus.**
2. **It suppressed true positives with the false ones.** Nine goldens that the lanes found without the checklist were
   not found with it. Per pull request: **three better, eight worse, three tied** — and the eight include the two
   pull requests that carry the most goldens (32 and 15).

**And the figure that makes the trade visible before the gate.** On the whole emitted list, not the registered operating
point, F1 moves **0.2043 → 0.2222**. So **before the actionable gate the checklist helps**, and the gate — which removes
findings from both arms by the same rule — is where the nine goldens were already the ones that survived.

**Compared with the second reviewer, on the same fourteen pull requests and the same judge** (its artifact is in the
run; one pull request failed to parse and its goldens are outside its denominator):

| reviewer                    | precision | recall | F1         | findings | goldens scored |
| --------------------------- | --------- | ------ | ---------- | -------- | -------------- |
| `open-code-review`          | 0.3289    | 0.3185 | **0.3236** | 152      | 157            |
| this repository, with rules | 0.2893    | 0.2059 | **0.2405** | 199      | 170            |
| this repository, without    | 0.2189    | 0.2588 | 0.2372     | 339      | 170            |

**The precision gap is now 0.04 and the recall gap is 0.11.** On the five-pull-request corpus the same two gaps were
**0.18 and 0.12** — so **the precision gap closed by 64 % and the recall gap did not move**. **The device did what it was
aimed at and the constraint moved**: the question is no longer _"are our findings wrong"_, it is **"do we find enough of
them"**.

### 8.7 The next rule, registered here and run later

**The checklist and the per-file slot count interact, and this run shows the direction of the interaction.** The file
arm allows three findings **per file per lane**; the lanes that were given the checklist used **less than half of the
slots they had** (928 → 406 raw findings), because a rule list ending in _"do not report when"_ teaches the model to
withhold. **The device's recall cost is therefore not a limit of what it can see — it is a limit of what it will say.**

**So the next registration is the pair, not the device:** keep the checklist on and **raise the per-file slot count from
three to six**. The prediction:

1. **Recall returns to at least 0.25** — within 0.01 of the no-checklist arm — while precision stays above **0.27**.
2. **F1 therefore exceeds 0.26**, which would be **the first figure on this corpus above the ±0.04 band around 0.24**.
3. **The paired test against the competitor's 0.3236 narrows to below the significance threshold**, which is a
   _falsifiable_ claim about a comparison rather than a claim about our own number.

**What falsifies it.** Recall that does not return means the checklist removes findings the model would otherwise make
and no slot count recovers them — the device is a filter, not a gate, and the next iteration builds the filter _after_
the model rather than inside the prompt. Precision that falls below 0.27 means the extra slots are being filled with the
idioms the checklist was written to suppress, and the two devices cannot be combined.

**And the size.** The corpus stays at fourteen pull requests, because the comparison is paired and the paired test is
what decides; **but the F1 prediction above is deliberately set 0.02 above the band**, so that a gain that only the
paired test can see is not mistaken for the one the registration named.

---

## 9. A fourth rule, registered before its run: the same diff, one prefix

**Registered 2026-11-10, iteration 113, before the change it describes exists.** A prompt device can only be settled by
running the corpus with it and without it, so **the rule is written here first and the device is built in the next
iteration.**

### 9.1 The device

**The five lane prompts currently disagree at the first character.** `SECURITY_REVIEW_PROMPT` opens _"You are an expert
security reviewer…"_, `PERFORMANCE_REVIEW_PROMPT` opens _"You are an expert performance engineer…"_, and **the diff —
the largest block of every prompt and the identical one in all five — sits after both**. The provider's context cache
matches **prefixes**, so a review of one file pays for that diff **five times at the miss price**, where the miss price is
**fifty times** the hit price on the published table.

**The device**: move the target description and the diff to the **front** of every lane prompt, so the five calls share a
byte-identical prefix, and leave the lane instruction, the checklist and the few-shot examples after it.

### 9.2 The measurement, and where it comes from

`SpendSummary` in the benchmark artifact (`spend.cacheHitRatio`, `spend.costUsd`, `spend.byTag`) — **written this
iteration, populated by the next run of the job.** Before iteration 113 this rule could not have been tested at all: the
client discarded `prompt_cache_hit_tokens`, so no figure in this repository could distinguish a run that reused a prefix
from one that paid for it twice.

### 9.3 The prediction

1. **`spend.cacheHitRatio` ≥ 0.5** on the file arm of a 14-pull-request job. The bound is not 0.8 because the first two
   requests of a prefix build the cache rather than hit it, and the vendor persists a common prefix only after it has
   seen it twice.
2. **`spend.costUsd` for the reviewer falls by at least 35 %** on an unchanged corpus at an unchanged hour.
3. **F1 does not move by more than 0.04**, which is the corpus's own resolution measured across three runs of an
   unchanged arm (0.2727, 0.2368, 0.2781).

### 9.4 What falsifies it

- **A cache-hit ratio below 0.5 with the cost unchanged** means the vendor's cache did not treat the concatenation as a
  shared prefix, and the device is worth nothing on this provider — **the next lever is then the single-call scope
  (P0-1), not the prompt.**
- **A cost fall with F1 below 0.19** means the reorder moved the model's attention away from the instruction, and the
  device trades correctness for price. **It would then be reported as a regression and reverted**, which is the rule this
  project applies to every change whose rationale is plausible and whose figure is worse.
- **A cache-hit ratio above 0.5 with no cost fall** means the price table is wrong about which class the hits are billed
  in — **a defect in the instrument, to be fixed before any figure from it is published.**

### 9.5 The size, and the hour

**Fourteen pull requests, both arms, one judge**, because the claim is about cost and the corpus's F1 resolution is
already known at that size. **And the job is scheduled off-peak** for the measurement: the vendor halves every price
outside 01:00–04:00 and 06:00–10:00 UTC on weekdays, so **a comparison taken across a peak boundary would be a comparison
of two prices rather than of two prompts.**

### 9.6 What this registration does not claim

**It does not claim the product gets cheaper for a user.** It claims the _same_ answers cost less, and the figure that
would say otherwise is the third prediction above. **A cost reduction that changes the answer is not a cost reduction;
it is a different product sold at a lower price.**

---

## 10. The rule §9 registered, withdrawn before its run, and the one that replaced it

**Registered 2026-11-10, iteration 114.** §9 predicted `spend.cacheHitRatio` ≥ 0.5 from a prompt reordering. **The
prediction was arithmetically unreachable, and the arithmetic that shows it costs nothing** - so the run §9 asked for was
not taken, and this section records why, what replaced it, and the rule that would have caught it.

### 10.1 Two reasons §9 could not have fired, both visible before a single call

**The first is a size.** A lane prompt is not mostly diff. Measured on `prompts.ts`:

| diff, characters           | target-and-diff block | whole lane prompt | block's share of the call |
| -------------------------- | --------------------- | ----------------- | ------------------------- |
| 500                        | 563                   | 8 144             | **6.9 %**                 |
| 2 000                      | 2 063                 | 9 644             | **21.4 %**                |
| 4 000                      | 4 063                 | 11 644            | **34.9 %**                |
| 8 000 (the truncation cap) | 8 063                 | 15 644            | **51.5 %**                |

**§9.3 predicted a hit ratio of at least 0.5, and the block it moved is 6.9 % of a call at the diff size most files in
this corpus have.** The best that arrangement can reach is the block's own share, so the prediction needed a corpus of
files at the truncation cap. **A ratio had been registered without dividing it by the quantity it is a ratio of.**

**The second is a schedule.** The five lanes were issued concurrently. A cache entry is written by a request and read by
a _later_ one, so five simultaneous calls for one file all miss - **the device was coupled to a concurrency decision
nobody had looked at, and the coupling alone would have returned a hit ratio near zero even at the cap.** The engine now
carries `laneWaves` so that arrangement can be measured; **its default is one round, because it buys nothing under the
arrangement that ships** (§10.2).

### 10.2 The arrangement that replaced it, and the figure it produces

**`boilerplate-first`: the lane's role, checklist, output contract and examples lead; the file's own path and diff
close the prompt.** Three arrangements now exist in the product, and they differ only in where one block sits:

| order                       | arrangement                        | the prefix a _later_ call can reuse                                                                   |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `lane-first` (before)       | `head + block + tail`              | the head, **about 900 characters** - the checklist and the examples sit after the file-specific block |
| `diff-first` (§9)           | `block + head + tail`              | **nothing across files**, because the path is in the block; shared only within one file's five lanes  |
| `boilerplate-first` (ships) | `head + tail + blank line + block` | **everything the lane says, which is the same for every file the lane reads**                         |

**What that is worth, measured on the bytes rather than described**: over three files and five lanes, the share of each
request that repeats the previous request for the same lane is **0.9805** under `boilerplate-first` and **0.1046** under
`lane-first` - a factor of **9.4**, from the same prompts with one block moved
(`tests/e2e/a-lane-pays-for-its-instructions-once.test.ts`).

**And `lane-first` was never the arrangement anyone thought it was.** It led with a constant, which is the rule the
vendor states; but the constant ended at nine hundred characters and the file path arrived immediately after it, so **a
prompt can lead with a constant and still have no reusable prefix.** That is the defect, and it is not one a reader can
see: both arrangements look like "instructions, then the diff".

### 10.3 The prediction, registered before its run

1. **`spend.cacheHitRatio` ≥ 0.85 on the file arm.** The reuse above is 0.98 per repeated call and the first call of
   each lane has nothing to reuse; over 199 files that is 0.975 before the vendor's sixty-four-token block rounding and
   any invalidation, so 0.85 leaves room for both and still fails a run that gained nothing.
2. **The reviewer's own line, `spend.byTag` over the five `review:*` tags, falls by at least 55 %** on an unchanged
   corpus at an unchanged hour. Not 90 %: the prompt is nearly all cached but the _answer_ is not, and the answer is
   priced at output rates.
3. **F1 does not move by more than 0.04**, which is the corpus's own resolution across three runs of an unchanged arm
   (0.2727, 0.2368, 0.2781).
4. **The judge is now a figure rather than an inference**, and this registration says what it is: **between 10 % and
   40 % of the job's model bill.** Before iteration 114 the judge was a bare `fetch` in the harness and appeared in no
   ledger, so _"the reviewer is about a fifth of the job"_ was an inference from a balance delta.

### 10.4 What falsifies it

- **A hit ratio below 0.5 with the cost unchanged** means the vendor does not cache free-form prompt prefixes the way
  its documentation describes, and **the next lever is the 7 400-character boilerplate itself** - the examples and the
  checklist are the largest thing a lane buys.
- **A hit ratio at or above 0.85 with no cost fall** means the price table is wrong about which class the hits are
  billed in. **That is a defect in the instrument** and is fixed before any figure from it is published, which is §9.4's
  third clause and still stands.
- **An F1 below 0.19** means the reorder moved the model's attention away from the instruction: it is reported as a
  regression and reverted, exactly as §9.4 said about its own device.
- **A judge share above 60 %** means the reviewer was never where the money went. The campaign then changes target to
  the judge's `findings × goldens` matrix, and the reviewer's share stops being the thing to optimise.

### 10.5 What is withdrawn, and what is kept

**§9 is not deleted.** A bound that could not fire is worth more as a record than as a gap: **`diff-first` remains a
product value and `laneWaves: 2` remains a setting**, so both halves of the retraction are checkable by running the
arrangement §9 described. **What is withdrawn is its number**, not its existence.

**And the transferable rule, now applied to §10 itself before the run:**

> **A ratio is registered only after its ceiling is computed from the sizes it is made of.** §9's 0.5 was above the
> 0.515 ceiling that the truncation cap allows and far above the 0.069 that an ordinary diff allows.

### 10.6 What this does not claim

**It does not claim the product is 9.4 times cheaper.** It claims that 98 % of what a lane sends after its first file is
text it has already sent, which is the _ceiling_ of what a prefix cache can return. **The figure that says what the
provider did with that is `spend.cacheHitRatio`, and it is written by a run of the job, not by this section.**

### 10.7 The run, and what it said

**Taken 2026-11-10 at 01:30 UTC, fourteen pull requests, both checklist arms, the shipped order.** The artifact is
`benchmarks/aacr-bench.json` in the run's upload; the account read **355.69 CNY before and 295.10 after**, a delta of
**60.59 CNY ≈ 8.53 USD** for the run.

| prediction                               | registered   | measured                                     | verdict                  |
| ---------------------------------------- | ------------ | -------------------------------------------- | ------------------------ |
| `spend.cacheHitRatio`                    | ≥ 0.85       | **0.6078** (checklist on) · **0.5226** (off) | **falsified**            |
| reviewer cost, same tokens at miss price | fall ≥ 55 %  | **fall 53.1 %** — 1.380 → 0.647 USD          | **missed by two points** |
| F1                                       | moves ≤ 0.04 | 0.2415 against 0.228 → **+0.014**            | holds                    |
| judge's share of the model bill          | 10–40 %      | **45.0 %** — 0.530 of 1.177 USD              | missed, high             |

**So the device works and the registration was wrong about how well.** A ratio of 0.61 against a ceiling of 0.98 means
the prompt is not the whole story, and the second half of this section is about the part that is not.

**And the run answered the question the audit could not.** The instruments in this repository - the ledger and the new
judge counter - see **2.64 USD of that 8.53**. **The remaining 5.89 USD, 69 % of the bill, is the competitor arm**: the
tool we install and run to produce a comparable figure, pointed at the same provider key, calling it through its own
client where nothing here can count it. Ranked by what a run costs:

| line                                  | per run      | share    | visible to this repository |
| ------------------------------------- | ------------ | -------- | -------------------------- |
| the competitor we run for comparison  | **5.89 USD** | **69 %** | **no**                     |
| the judge (`findings × goldens`)      | 1.23 USD     | 14 %     | yes, since iteration 114   |
| the reviewer (five lanes × 340 files) | 1.41 USD     | 17 %     | yes, since iteration 113   |
| **total**                             | **8.53 USD** |          |                            |

**And one push paid for one of these.** Until this iteration the harness file was in its own workflow's `push.paths`,
on the argument that an edited harness should be exercised against the corpus. **The artifact prices that argument:
one edit, 60.59 CNY.** The path is gone, and `aacr-bench.mjs --dry-run` - which needs no credentials and no corpus -
now runs in CI on every push, so the arithmetic is still proved and the corpus is not purchased to prove it.

---

## 11. Why 0.61 and not 0.85, registered as a question with two answers

**Registered 2026-11-10, iteration 114, after the run and before the next one.** §10's device is worth a factor of 1.9
in prompt cost rather than the 3.6 its arithmetic allowed, and there are two candidate mechanisms. **The next run has to
tell them apart, because the fix is different and one of them is not fixable in the prompt at all.**

### 11.1 The two mechanisms

1. **The per-language checklist sits inside the constant.** `defectChecklist(ctx)` returns different rules for
   TypeScript and for Python, and it is placed _before_ the target block. Measured on `prompts.ts`: two files of the
   same extension share **7 593** characters of prefix, and a `.ts` file and a `.py` file share **1 300**. **A polyglot
   corpus therefore reuses a sixth of what a single-language one would.**
2. **The vendor's cache accounts for less of a prefix than it is given** - block granularity, partial eviction under
   load, or a prefix that lapses between two calls ninety minutes apart.

**The observation that keeps this an open question rather than a conclusion**: removing the checklist _lowered_ the
ratio, 0.608 to 0.523. If the checklist were the whole story, deleting it should have raised the ratio. **It did raise
the cached tokens per call's share of nothing - the miss per call stayed at 853-909 tokens in both arms while the hit
moved by exactly the checklist's size.** That is the signature of a prefix that is being cached in both arms, and it
means mechanism 1 explains the _cross-language_ files and not the _within-language_ ones.

### 11.2 The run that separates them

**The same engine, the same order, over a corpus of one language.** `AACR_LANGUAGE_ONLY` is not a new flag: the corpus
already carries each file's extension, so the run is the existing one with the sweep filtered to a single language.

1. **`spend.cacheHitRatio` ≥ 0.80** on a single-language subset of at least a hundred files. **Mechanism 1** is then the
   cause, and the fix is a scheduling one: **the review queue sorts by extension**, so a language's rules are bought
   once and reused across every file that needs them.
2. **A ratio at 0.6 on a single-language subset** means the constant block is not being cached as measured, and the
   prompt has been taken as far as this provider allows. **The next lever is then not the prompt but the number of
   calls**: five lanes to one call per file, with the lane instruction as a field in one prompt.
3. **And the miss per call is the figure to watch**, because it is the only one that should move: 853-909 tokens today,
   and it is the diff's size. **A miss that grows with the number of languages is mechanism 1 in one number.**

### 11.3 What falsifies the separation

**A single-language ratio of 0.95 with the polyglot ratio unchanged at 0.61** would mean the two mechanisms are not
alternatives but the same one seen twice, and the run is repeated with the order sorted by language rather than filtered
by it. **A single-language ratio that is also 0.61, with the miss per call unchanged**, falsifies mechanism 1 outright
and rules the prompt out for this provider.

### 11.4 What is not in question

**The device is not reverted.** It cut the reviewer's bill by **53.1 %** measured on the same token counts, and F1 moved
by 0.014 inside a 0.04 band. **A registration that predicted 0.85 and delivered 0.61 is a wrong prediction and a good
device**, and the difference between those two sentences is the whole reason §10 was written before the run rather than
after it.

---

## 12. A number bought once, and the ten jobs that were buying it every week

**Written 2026-11-10, after the run §10 priced.** The question this section answers is not "what does a benchmark cost"
but "what in this repository can spend money, and what stops it". §10 answered the first for one job. **This one answers
the second for all of them, because the answer was ten.**

### 12.1 The four defects, in the order they were found

1. **Ten workflows name a provider credential.** Five of them still had a `push` trigger, on paths that were mostly the
   harness itself. **The argument was that an edited harness should be exercised**; §10's artifact prices it at
   **60.59 CNY for one push**.
2. **Five scripts construct a `DeepSeekProvider`, and four had no ceiling.** The one that did was the benchmark - the
   only job somebody had already priced. **A ledger without a ceiling records a bill after it is paid.**
3. **CI passed `secrets.DEEPSEEK_API_KEY` into the unit, integration, property, E2E and coverage jobs.** Three files in
   that suite branch on the key: `real-ground-truth-semantic.test.ts` reviews a hundred real issues through five lanes,
   and the retrieval and paraphrase harnesses write their query sets when they can. **So every push to `master` and every
   pull request paid for a literature review of the corpus before it ran an assertion**, and no artifact said so,
   because a test is not a job anyone prices.
4. **The competitor arm ran on every benchmark run, twice** - once per arm of the checklist matrix - over goldens that
   had not changed since the previous run. **5.89 USD of the 8.53, 69 %, on a number that is a property of the corpus and
   not of this project's code.**

**What these four have in common is that each is defensible alone and unreasonable together.** A push trigger is
reasonable for a fast check; a ceiling is unnecessary for a job that has never overrun; a credential in CI is convenient
for the one test that wants it; re-running a competitor keeps two figures on the same commit. **Nothing in the repository
read all four at once**, which is the only place the bill was visible.

### 12.2 What now stops each one, and where the proof lives

| defect                                | the mechanism                                                                                      | the proof                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| a paid job triggered by a push        | no paid workflow may declare `push` or `pull_request`; only `workflow_dispatch` and one `schedule` | `a-paid-workflow-is-not-triggered-by-the-code-it-measures.test.ts`                 |
| a credential in a job that runs tests | no workflow containing `pnpm test` may name a provider credential                                  | same file, `never hands a model credential to a job that runs the test suite`      |
| a script with no ceiling              | every `new DeepSeekProvider(` must pass `ceilingUsd` beside a `CostLedger`                         | `every-paid-script-has-a-spend-ceiling.test.ts`                                    |
| the competitor bought repeatedly      | `AACR_COMPETITOR` defaults to `replay`; a missing record is reported, never repaired by buying     | `a-competitor-is-paid-for-once.test.ts`, `a-competitor-run-is-bought-once.test.ts` |

**And the fourth has a property the other three do not: it is falsifiable in the arithmetic.** A replayed pull request
contributes the same three fields a purchased one contributes - `matches`, `goldens`, `keep` - so the scoring cannot tell
them apart. `a-competitor-run-is-bought-once.test.ts` runs the loop twice over the same corpus, computes the competitor's
F1 from both passes with the benchmark's own functions, and asserts the two are equal. **A replay that lost `keep` would
pass a decision test and fail that one**, which is the reason it is written as a user story rather than as a unit test.

### 12.3 The bill after the change, as arithmetic rather than as a measurement

| line                             | before       | after                     | why                                                                                 |
| -------------------------------- | ------------ | ------------------------- | ----------------------------------------------------------------------------------- |
| competitor arm, two runs         | 5.89 USD     | **0**                     | replayed; recorded once per corpus                                                  |
| judge                            | 1.23 USD     | **≈ 0.7 USD**, unmeasured | the competitor's findings are no longer judged at all; the remaining calls are ours |
| reviewer, five lanes × 340 files | 1.41 USD     | 1.41 USD                  | unchanged, and that is the point                                                    |
| **total per run**                | **8.53 USD** | **≈ 2.1 USD**, unmeasured | 75 %                                                                                |

**The "after" column is arithmetic, not a reading, and it is marked so on purpose.** Three of its four lines are
measured; the judge's is a subtraction over a share that the artifact splits by finding count rather than by reviewer. **A
prediction stated as a prediction is checkable; the same number stated as a result is what §10 exists to prevent.**

### 12.4 The one optimisation that changes no verdict

**The judge is a prefix-cache client too, and it was submitting its matrix in the wrong order.** Its prompt is
`instructions + golden + comment`; the first two blocks are identical for every finding scored against the same golden,
so the first request carrying a prefix writes it and the rest read it. The matrix was submitted **finding-major**, which
means each golden's prefix was written by whichever of its pairs happened to be first in flight, **concurrently with the
others** - and a concurrent write is a miss for everything in flight beside it. **The artifact recorded the consequence:
6 859 calls, 7.9 % cached.**

**So each golden's first pair is judged alone before the rest of its pairs are submitted together.** Every pair is still
judged once, against the same inputs, at the same temperature; **only the order changed.** The claim this makes is
narrow and falsifiable:

1. **The judge's `costUsd` falls by at least a third** on the same corpus, because `instructions + golden` is roughly
   two thirds of the prompt and a hit is priced at a fraction of a miss.
2. **`spend.judge.cacheHitRatio` rises above 0.5**, from 0.079.
3. **F1 does not move.** A verdict is a per-pair answer; an order that changed one would be an order that changed the
   question, which is what §11.3 exists to catch.

**And the falsification is the interesting branch**: a reordered matrix with the same hit ratio means the judge's prompt
is below the vendor's cacheable block size, and the fix is then not the order but the size - **the same conclusion §11
reaches from a different direction.**

### 12.5 What is not being cut, and why each would be a bad trade

1. **The corpus is not shrunk.** Fourteen pull requests is the size at which a 0.04 move stops being a coin toss; at five
   it was a coin toss and the figures moved between 0 and 0.1724 with nothing changed. **A cheaper figure that cannot
   answer the question is the most expensive line in this table.**
2. **The two arms are not collapsed to one.** §8's claim is about a device, and a device can only be settled by turning
   it off. **One arm is a number with nothing to compare it to.**
3. **The judge is not batched into one call per pull request.** It would cut the call count by the number of goldens -
   four here - and it would ask a model to answer several questions in one context, where the answers become evidence
   about each other. **That is a quality change sold as a cost change**, and until it is measured against the per-pair
   matrix it stays out of the default path.
4. **The reviewer is not given fewer lanes.** Five lanes at 0.61 reuse is 1.41 USD and the lanes are what the product
   sells. **A cost optimisation that removes a feature is a price cut on a smaller product.**

### 12.6 The two things this section does not know

1. **Whether the recorded baseline in this repository covers the corpus.** It does not yet: no `record` run has been
   dispatched since the mechanism landed, so the next scheduled run will report **every pull request as `missing`** and
   set `secondReviewer.comparable` to `false`. **That is the honest state and the artifact says it**; the repair is one
   dispatch with `competitor: record`, whose artifact is then committed. **The alternative - reconstructing a baseline
   from a previous run's published figure - would be fabricating per-pair verdicts from a summary, which is the one thing
   this file exists to forbid.**
2. **Whether the judge's reordering pays what §12.4 predicts.** It costs nothing to try, it changes no verdict, and
   `spend.judge.cacheHitRatio` is already in the artifact - so the next run answers it without a new measurement.

---

## 13. The comparison was scored in the competitor's favour, and the artifact could not say why we lost

**Written 2026-11-10, after reading the run of 2026-11-09 rather than trusting the line it printed.** Two asymmetries and
one gap, all three visible only by reconciling the artifact's own fields against each other.

### 13.1 Two asymmetries, both of them ours

**A pull request the competitor crashed on was removed from its denominator.** The run attempted fourteen pull requests
and failed one - `microsoft/typescript-go#1446`, whose output parsed to no findings. A throw inside the competitor's arm
skipped the `competitorPerPr.push` that follows it, so that pull request contributed **no goldens to the denominator and
no findings to the numerator**. The published figures were constructed over **157 goldens**; our arm was scored over
**170**. The same run, read honestly:

| arm                              | P      | R          | F1         | denominator |
| -------------------------------- | ------ | ---------- | ---------- | ----------- |
| ours, published                  | 0.2893 | 0.2059     | 0.2405     | 170         |
| competitor, published            | 0.3289 | 0.3185     | 0.3236     | **157**     |
| competitor, **same denominator** | 0.3289 | **0.2941** | **0.3106** | 170         |

**0.0130 of F1, in the competitor's favour, from a crash.** A reviewer whose output does not parse is a reviewer that
found nothing on that pull request, not a reviewer whose pull request did not happen. **And the asymmetry is structural
rather than accidental**: it favours whichever arm has more moving parts, which is always the arm driven through another
project's CLI.

**The judge left 183 pairs unanswered in our arm and none in the competitor's.** The judge retried three times with waits
of one, two and three seconds and dropped `Retry-After` entirely - **three attempts inside one rate-limit window is the
same request refused three times**, and the third refusal was recorded as the judge having nothing to say. An unanswered
pair is scored as a miss. Our arm made roughly twice as many calls, so it hit the limit and the other arm did not: **the
comparison carried different amounts of measurement error and reported neither.**

Both are now structural:

| defect                                                | the mechanism                                                                                                      | the proof                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| a crash is scored as a non-event                      | a failed pull request pushes `{matches: [], goldens: n, keep: []}` and is named in `failedPullRequests`            | `the-competitor-we-already-paid-for.test.ts` |
| a `missing` record and a crash are the same code path | `missing` is **excluded** (a hole in the pairing); a crash is **a zero** (an observation)                          | same file, and §12.6                         |
| a refusal becomes a miss                              | `Retry-After` honoured, exponential schedule capped at 30 s, six attempts, `rateLimited` counted                   | `a-rate-limit-is-not-an-answer.test.ts`      |
| the figure has no error bar                           | `judgedInterval` publishes F1 under "every unanswered pair is a miss" and under "every unanswered pair is a match" | `--dry-run`                                  |

**The interval is deliberately loose and is labelled as one.** Crediting one finding with several goldens overstates what
a perfect judge could do, so the upper end is a bound rather than an estimate. **The point is not to estimate the true
figure but to state how far the reported one could be from it** - and when the interval is wide, the run needs a judge
that answers rather than a better ranker.

### 13.2 The gap: the artifact could not say why a golden was missed

`issueTexts` was built as `comments.map((c) => c.note).filter(Boolean)`. **The note survived and the `path` and
`from_line` travelling beside it did not**, so the artifact could report `recall 0.2059` and not one word about why. That
single number is compatible with three unrelated defects whose fixes are a filter, a reading, and a target:

| bucket                  | what it means                                      | what its fix is                                    |
| ----------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `hit`                   | a finding was emitted that the judge accepted      | nothing                                            |
| `fileNotReviewed`       | the golden's file was never handed to the engine   | the diff split, the path filter, the budget        |
| `noFindingOnPath`       | the file was read and the lanes said nothing on it | recall of the reading                              |
| `findingOnPathRejected` | the lanes spoke on that file about something else  | what the lane is asked to look for, or the matcher |
| `noPath`                | the corpus row does not locate the issue           | a corpus defect, not a review defect               |

**`mergeAttributions` asserts that the buckets sum to the golden count**, and `--dry-run` exercises every reachable bucket
on a fixture, because **a wiring that published an empty table would pass every existing assertion** - the figures never
read the buckets.

**This is the difference between an iteration that starts with a number and one that starts with a diagnosis.** The next
optimisation is chosen by the largest bucket, and §10's rule applies to it unchanged: the prediction is registered before
the run that tests it.

### 13.3 The competitor result is now an input, and the transcription is checked

§12.6 recorded the debt: no `record` run had been dispatched, so the next scheduled run would report all fourteen pull
requests `missing`. **The debt is not repaid by buying the result again** - the run that bought it published one row per
finding with the goldens the judge accepted for it, which is exactly the shape the record stores.

`benchmarks/aacr/competitor-baseline.json` began as a transcription of `benchmarks/aacr-bench.json` and **is replayed
through the harness's own scoring functions**, asserting **50 true positives and 102 false positives** on those fourteen
rows - the two figures the artifact published. **It has since grown to forty-six rows in two origins** (§22.1): the
transcribed fourteen, checked by their golden count, and thirty-two recorded live on 2026-11-11, checked per pull request
by a golden fingerprint and replayed to that run's 113 true and 168 false positives. A lost row, a shifted index, or a `keep` flag turned into a string moves one of them. **The fingerprint is
recomputed from the artifact's coverage table and asserted**, so the record cannot be reused against another corpus by
editing nothing but its header.

**What the transcription cannot prove** is that the judge would answer identically today. **What makes it admissible** is
that the judge prompt is versioned (`aacr-judge-v1`), the model is named in the file, and `resolveCompetitor` refuses a
record made under a different judge rather than comparing across two of them.

### 13.4 What the corrected head-to-head says

| arm                                | P      | R      | F1         |
| ---------------------------------- | ------ | ------ | ---------- |
| ours, actionability gate           | 0.2893 | 0.2059 | 0.2405     |
| ours, full emission (199 findings) | 0.2060 | 0.2412 | 0.2222     |
| competitor, same denominator       | 0.3289 | 0.2941 | **0.3106** |

**We are 0.070 behind, and the paired test says the difference is not noise** (`p = 0.0012` on the file arm, 8 goldens
ours-only against 28 theirs-only). Three things follow, and only one of them is about the model:

1. **The gate is not the problem.** Full emission finds 41 goldens and the gate finds 35; the gate buys 0.018 of F1 and
   costs 6 true positives. **A rule that earns 0.018 is a rule worth keeping and not worth tuning.**
2. **Ordering the current findings cannot close the gap either.** The curve in the same artifact is the ranker's own
   score ordering, and its best point over eleven budgets is **F1 0.2469 at k = 154** - against 0.2405 at the gate's
   fixed operating point. **Every setting the ranker can hold to is worth 0.006 of the 0.070.** The reason is upstream:
   of 199 emitted findings, **41 match a golden at all**, so precision has a ceiling of 20.6 % before any ordering is
   applied. **A ranker cannot promote what the lanes never said.**
3. **Therefore the next iteration is the attribution, not the ranker.** Which bucket holds the 155 missed goldens decides
   whether the work is a diff filter, a lane prompt, or a matcher - and this iteration can no longer be written without
   that number, which is the point of publishing it.

**And one thing the curve makes visible that the summary hides**: at budget 1 the arm emits 14 findings and 8 of them are
true, so **precision at the top is 0.5714 and recall is 0.0471**. The findings the ranker is most confident about are
mostly right; there are simply far too few of them. **That is the shape of a recall problem wearing a precision costume**,
and it is why the attribution buckets are the next thing to read.

### 13.5 What this section does not conclude

1. **That the competitor is beatable on this corpus by prompt work alone.** Its 50 goldens against our 41 on 199 findings
   is a 22 % advantage in `findings × precision` that no reordering closes. **The honest statement is that we do not yet
   know which of the three buckets dominates**, and §13.2 is what makes that question answerable.
2. **That the transposed baseline is equivalent to a fresh purchase for ever.** It is equivalent while the corpus, the
   judge prompt and the model are unchanged; the record names all three and refuses when any of them moves.
3. **That 8.53 USD per run is now 2.1 USD.** That was §12's prediction and it remains unmeasured. **The next dispatched
   run is the measurement**, and its artifact carries `spend.totalUsd` for exactly that purpose.

---

## 14. The instrument is coarser than the effects it has been reporting

**Written 2026-11-10, from the first run that measured the reordering for quality as well as for cost, and from the
paired test between the two checklist arms of the same run.**

### 14.1 Two runs, opposite signs, on a registered claim

The per-language checklist was registered as _"raises the file arm F1 by at least 0.04, by raising precision without
lowering recall"_. Two runs of the same job, same corpus, same judge, differing in one environment variable:

| run        | with checklist | without checklist | gain        | mechanism                 |
| ---------- | -------------- | ----------------- | ----------- | ------------------------- |
| 2026-11-09 | 0.2415         | 0.1871            | **+0.0544** | precision up, recall down |
| 2026-11-10 | 0.1691         | 0.1983            | **−0.0292** | precision up, recall down |

**The mechanism held both times and the verdict did not.** The 2026-11-10 pairing is `both 16, withOnly 7, withoutOnly
19, p = 0.029` - **significantly worse, at 0.05, in the direction opposite to the registration.**

**So the registration is falsified, and falsified in a way that says something more useful than "no effect": the
instrument cannot resolve the effect.** A claim of 0.04 tested by an instrument whose readings move 0.084 between runs
is a claim being read through noise and reported as a result - **and it was reported as a result for two iterations.**

### 14.2 The same instability in our own figure

| arm               | 2026-11-09 | 2026-11-10 (same order) | 2026-11-10 (lane-first) |
| ----------------- | ---------- | ----------------------- | ----------------------- |
| with checklist    | 0.2415     | 0.1691                  | _in flight_             |
| without checklist | 0.1871     | 0.1983                  | _in flight_             |

**Both arms moved, in opposite directions, with the prompt order as the only difference between the two dates** - and the
`lane-first` column is the run that decides whether the order is the cause or the dates are. **Until it lands, the
honest statement is: `boilerplate-first` may cost up to 0.07 of F1 and may cost nothing, and this corpus cannot tell.**

### 14.3 What the bill says about the corpus size, which is the actual lever

|                   | 2026-11-09                         | 2026-11-10                             |
| ----------------- | ---------------------------------- | -------------------------------------- |
| competitor arm    | 5.89 USD                           | **0** (replayed)                       |
| judge             | 1.23 USD, 6 859 calls, 7.9 % reuse | **0.28 USD**, 3 881 calls, 9.4 % reuse |
| reviewer          | 1.41 USD, 61 % reuse               | **0.29 USD**, 91.7 % reuse             |
| **total per arm** | **8.53 USD**                       | **0.57 USD**                           |

**A 93 % cut, and 0.0130 of the head-to-head was a correction rather than a saving** - the honest comparison is
`0.2405 / 0.3106`, not `0.2405 / 0.3236`.

**So the resolution problem has a price, and the price has fallen by the same order.** Fourteen pull requests cost 0.57
USD; the corpus holds **200**, and `MAX_PRS` has always been the variable. **Fifty pull requests is roughly 2 USD** - the
same money that used to buy one fourteen-pull-request run with a competitor arm attached.

**This is the one change that makes every other verdict in this file mean something**, and it is now a dispatch input
rather than a constant, so the run that raises it is reproducible by anyone with the corpus.

### 14.4 What the attribution says the next optimisation is, measured on both arms

| bucket                  | with checklist | without checklist |
| ----------------------- | -------------- | ----------------- |
| `hit`                   | 39             | 51                |
| `fileNotReviewed`       | **4**          | **4**             |
| `noFindingOnPath`       | 43             | 15                |
| `findingOnPathRejected` | **84**         | **100**           |

**`fileNotReviewed` is 4 out of 170 in both arms**, which retires the hypothesis §13.2 was written to test: **the file
filter is not the problem, and the lanes read the files the goldens live in.** The dominant bucket is
`findingOnPathRejected` - **the lanes emitted findings on those files and none of them was the expert's issue** - and the
examples say what that looks like: a performance suggestion where the golden is a defect, a naming remark where the
golden is a crash.

**So the work is what the lanes are asked to look for, not where they look.** That is a prompt-and-targeting iteration,
and the checklist - the one device the product already has for exactly this - is the device the paired test just found
significantly harmful. **Both facts are true at once and they are the next iteration's problem**: a checklist that lowers
F1 by 0.029 while 84 goldens are missed for targeting is a checklist measuring the wrong targets.

### 14.5 What this section does not conclude

1. **That the prompt reordering is safe because the bill fell.** The bill fell by 93 % and the F1 may have fallen with it;
   §14.2's third column decides, and until then the order is an input with a recorded value rather than a default
   anyone can forget.
2. **That fifty pull requests will resolve 0.04.** It is four times the sample and the effect is a difference of
   proportions, so the standard error falls by half; **a 0.04 difference would need of the order of 800 goldens to be resolved at
   0.05 with 80 % power, which is roughly 60 pull requests.** The number is stated here so the next registration is written against it instead
   of against a hope.
3. **That the checklist should be removed.** It is significantly harmful on this corpus at this resolution, and it is
   also the only device aimed at the dominant bucket. **Removing it and rebuilding it are different experiments and the
   second one is the one the attribution argues for.**

## 15. The `lane-first` run landed: the order is neutral, and the dominant bucket is a sentence rather than a search

**Written 2026-11-10, from run [42771376514](https://github.com/AgentiX-E/code-analyzer/actions/runs/42771376514) - the
`lane-first` dispatch §14.2 says was in flight - and from a re-reading of that run's artifact against the corpus's own
line numbers.**

### 15.1 The six arms, and what they say together

| order               | checklist | F1 (gate)  | run                  |
| ------------------- | --------- | ---------- | -------------------- |
| `boilerplate-first` | on        | **0.2415** | 2026-11-09           |
| `boilerplate-first` | off       | **0.1871** | 2026-11-09           |
| `boilerplate-first` | on        | **0.1691** | 2026-11-10           |
| `boilerplate-first` | off       | **0.1983** | 2026-11-10           |
| `lane-first`        | on        | **0.1886** | 2026-11-10, this run |
| `lane-first`        | off       | **0.2124** | 2026-11-10, this run |

**The two `lane-first` counts, kept because they are the pair every later figure is paired against**: with the checklist
`tp 28 / fp 99 / fn 142` over 202 findings, without it `tp 41 / fp 175 / fn 129` over 357.

**Across six readings of one corpus the mean is 0.1995 and the standard deviation is 0.0228.** The two readings of the
_same configuration_ - `boilerplate-first`, checklist on - differ by **0.0724**, which is **3.2 standard deviations and
therefore not a measurement of anything except the instrument.**

**So the question §14.2 left open is answered, and the answer is not about the order.** `lane-first` returned **0.1886**,
which sits inside the spread of the arm it was supposed to replace. The order moves the figure by **−0.0529** against one
`boilerplate-first` reading and **+0.0195** against the other, and **a device whose effect changes sign between two
repeats of the same control has no measurable effect at this corpus size.**

### 15.2 The cost win was mis-attributed, and this run is what shows it

|                      | `boilerplate-first`, 2026-11-10 | `lane-first`, this run |
| -------------------- | ------------------------------- | ---------------------- |
| reviewer calls       | 1 770                           | **1 770**              |
| reviewer cache reuse | **91.7 %**                      | **91.7 %**             |
| reviewer cost        | 0.29 USD                        | **0.30 USD**           |
| judge cache reuse    | 9.4 %                           | **11.1 %**             |

**The reordering's cost benefit is zero, because the reuse is identical.** §14.1 attributed the fall from 61 % to 91.7 %
reuse to `boilerplate-first`; **both orders now read 91.7 %**, so the reuse came from the per-file prefix being stable,
which is a property of the lane and not of where the diff sits in its prompt. **The quality claim is withdrawn and the
cost claim is corrected in the same paragraph**, and both are corrections of the record rather than of the engine.

### 15.3 The checklist's three paired readings average zero

| run                      | with   | without | F1 gain     | paired: both / with only / without only | p          |
| ------------------------ | ------ | ------- | ----------- | --------------------------------------- | ---------- |
| 2026-11-09               | 0.2415 | 0.1871  | **+0.0544** | not recorded                            | —          |
| 2026-11-10               | 0.1691 | 0.1983  | **−0.0292** | 16 / 7 / 19                             | **0.029**  |
| 2026-11-10, `lane-first` | 0.1886 | 0.2124  | **−0.0238** | 22 / 6 / 19                             | **0.0146** |

**The F1 gain averages +0.0005 over three readings and the paired test is not an average.** It asks a sharper question -
_given a golden one arm found and the other did not, which arm is it_ - and it answers **twice, on two different prompt
orders, in the same direction**: the checklist loses **12** goldens in the first run and **13** in the second, both
significant at 0.05.

**So the device is not unresolved. It is replicated harm.** §14.1 called the second reading an instrument that could not
resolve 0.04; **the paired view resolves it and the answer is negative**, and the F1 average was the wrong statistic to
look at because precision and recall moved in opposite directions by more than either one's noise.

**And the registered mechanism is falsified too.** The claim was _"precision rises, recall does not fall"_. Precision
rose 0.1898 → 0.2205 and **recall fell 0.2412 → 0.1647** - the device halves emission (357 → 202 findings) and buys
precision with recall at a rate F1 prices as a loss. **A device that was registered as a targeting aid is a suppression
aid**, which §15.4 then explains: targeting was never the problem it was aimed at.

**What the mechanism did, identically in all three pairings**: emission halved (**202 → 357** findings the other way
round, false positives **170 → 306**), recall rose **0.1647 → 0.2412**, precision fell **0.2205 → 0.1898**.

### 15.4 The dominant bucket is locational agreement, and §14.4 read it the wrong way round

`findingOnPathRejected` is **98 of 170** in this run. The corpus states each golden's `from_line`, the finding states its
range, and **nothing in this file had ever compared them**. The comparison costs no model call, because both sides were
already paid for:

| distance from the golden to the nearest finding on its own file | goldens       | share of the bucket | share of all goldens |
| --------------------------------------------------------------- | ------------- | ------------------- | -------------------- |
| **0 - the finding's range covers the golden's line**            | **40**        | **40.8 %**          | 23.5 %               |
| ≤ 5 lines                                                       | 62            | 63.3 %              | 36.5 %               |
| **≤ 10 lines**                                                  | **73**        | **74.5 %**          | **42.9 %**           |
| ≤ 50 lines                                                      | 82            | 83.7 %              | 48.2 %               |
| > 200 lines                                                     | 4             | 4.1 %               | 2.4 %                |
| **median**                                                      | **1.5 lines** |                     |                      |

**§14.4 concluded that "the work is what the lanes are asked to look for, not where they look". The coordinates say the
lanes looked in the right place**: 40 of the 98 stood on the golden's own line and 73 within ten lines of it. **The lane
found the defect and described it in words the judge would not call the same defect** - which is the _sentence_, not the
search, and it is a different iteration's work.

**And it explains why three checklist runs moved nothing.** A checklist changes what a lane is asked to look for, so it
can only move goldens between `noFindingOnPath` and `hit`. **`findingOnPathRejected` was 84, 100, 98 and 97 across the four
arms** - invariant, as a search-side device must leave it. **The device was aimed at the bucket that was not there.**

### 15.5 Registered before its run: iteration 118

**Claim R-15.** _Requiring every emitted finding to name the failure mode and the input that triggers it - rather than the
change it suggests - will raise the number of accepted goldens that are already within ten lines of a finding from the
present 0 to at least 24 of the 73, which is +0.141 recall on this corpus and therefore at least +0.06 F1 at the same
precision._

**Falsified if** fewer than 9 of the 73 coincident rejections are accepted (a third of the predicted move), **or if
precision falls by more than 0.02** - the second clause because a sentence that names a failure mode it cannot support is
a hallucination with better grammar, and **the gate is what would have to absorb it.**

**Its measurement is the shape table this iteration added**, published in every artifact as
`missedGoldens.rejectionShape` and asserted to add up to `missedGoldens.counts.findingOnPathRejected`:

| shape      | meaning                                      | what it counts                      |
| ---------- | -------------------------------------------- | ----------------------------------- |
| `sameLine` | the finding's range covers the golden's line | agreement without acceptance        |
| `within10` | within ten lines, which is still one screen  | agreement without acceptance        |
| `beyond50` | the lane spoke elsewhere on the file         | the targeting defect §14.4 expected |
| `noLine`   | the corpus or the finding carries no line    | a hole, not a defect                |

**And the artifact now carries `rankedFindings[].text`**, because **a rejection is a claim about wording and the artifact
could not show a single sentence** - the same omission as the discarded `path` in §13, one level up.

**Implemented the day it was registered, against a baseline that was already running.** Run
[42789979455](https://github.com/AgentiX-E/code-analyzer/actions/runs/42789979455) - 50 pull requests, both checklist
arms, `boilerplate-first`, competitor replayed, from commit `4bb3985` - is the **before**, and it started before this
paragraph existed, so nothing in it can have been measured under the requirement. The rule itself is one constant,
`DESCRIBE_THE_FAILURE` in `packages/intelligence/src/review/llm/prompts.ts`, spliced into **both** contracts: the file
contract's new rule 6 and the pull-request contract's new rule 9. **Two copies would be two rules that happen to agree
today**, which is the defect the shared constant exists to prevent, and six unit cases hold it in every lane and both
scopes (`tests/unit/every-finding-names-what-fails.test.ts`).

**The comparison is available without a flag**, because `aacr-checklist-compare.mjs` already pairs two artifacts on
pull request and golden index - **so the run after this one can be paired against the before, at the same corpus size,
with the same judge, and no second dispatch is needed to establish the baseline.**

### 15.6 The corpus, raised to the size the claim needs

|                                                   | 14 pull requests | 50 pull requests      | 200 pull requests                           |
| ------------------------------------------------- | ---------------- | --------------------- | ------------------------------------------- |
| goldens                                           | 170              | **452** measured      | ~1 800 at the measured 9.0 per pull request |
| standard error on F1                              | 0.0228 measured  | ~0.012                | ~0.006                                      |
| cost of one dispatch (both arms)                  | **1.63 USD**     | ~5.8 USD              | ~23 USD                                     |
| runner time at the measured 1.59 min/pull request | 22 min           | **79.7 min** measured | **319 min** - inside the ceiling at 94 %    |

**The ceiling is a rate now rather than a constant**, in `.github/scripts/lib/run-config.mjs`: 0.15 USD per pull request
replaying, 0.5 recording, with a floor that admits the fourteen-pull-request run the registration was written against.
**A ceiling written for fourteen pull requests stops being a ceiling the moment `max_pull_requests` is an input**, and a
bound that does not move with the work is a comment.

**And the job timeout is 340 minutes, which is the largest corpus this runner can score** - **213** pull requests at the
measured rate. **Three revisions of this paragraph were wrong in three different ways, and the last one is the
instructive one.** It first said 190 pull requests, which needs 1.8 minutes per pull request that no run has measured. It
then said 103, which is 340 divided by the 3.3 minutes per pull request of the fourteen-pull-request run - arithmetic,
and measured on the wrong run: **that run cost 468 model calls per pull request and the fifty-pull-request run of
2026-11-10 cost 301, so its arms took 61.0 and 79.7 minutes, or 1.22 and 1.59 minutes per pull request.** The number the
ceiling fits is 213, and **the rate per pull request is a property of the configuration rather than of the runner** -
which is why it is a constant in `.github/scripts/aacr-ablation-compare.mjs` with the run id beside it instead of a figure
in a paragraph.

**What that corrects downstream.** The whole 200-pull-request corpus is **319 minutes of a 340-minute ceiling** - it fits,
at 94 % of the ceiling, which is inside it and outside anything a retry could absorb. **So "a full-corpus run is beyond
any job GitHub runs" was a conclusion drawn from a stale rate, and the wall is now the runner's 340 minutes rather than
the corpus's 200 rows.** §19.3's hundred-unseen-pull-request confirmation is 159 minutes and is dispatched as the single
run the registration names; **it was briefly written down as two slices of fifty on the strength of the 3.3-minute rate,
and the measurement withdrew the split before it cost a dispatch.**

### 15.7 What this section does not conclude

1. **That the prompt order is harmful.** It is unresolved, and the default stays `boilerplate-first` because that is
   what the recorded baseline was produced under - **not because it is better.**
2. **That the checklist is useless.** It is a _suppression_ device, replicated, and it is now **off by default** for that
   reason - the flag stays, because the ablation arm has to remain runnable and because **turning a device off is not
   the same experiment as replacing it.** What it is good at is real (76 fewer false positives per 170 goldens) and the
   trade is stated rather than hidden: **a product that prefers precision to F1 should turn it back on.**
3. **That 73 rejections are 73 recoverable goldens.** Same line is not the same defect. **The claim is that the
   sentence is the binding constraint for most of them**, and R-15 is written so that being wrong about that costs one
   run rather than an iteration.

## 16. The fifty-pull-request run: the paired view decides what the F1 delta cannot, and the competitor arm was absent

**Written 2026-11-10, from run [42789979455](https://github.com/AgentiX-E/code-analyzer/actions/runs/42789979455) - the
`max_pull_requests=50` dispatch §15.6 said the claim needed - and from the two defects that run exposed.**

### 16.1 The corpus, at the size the registration was written for

|                           | 14 pull requests (2026-11-09) | **50 pull requests (this run)** |
| ------------------------- | ----------------------------- | ------------------------------- |
| goldens                   | 170                           | **452**                         |
| reviewer calls            | 1 770                         | 3 195                           |
| judge calls               | 4 783                         | 8 404 and 12 130                |
| runner minutes per PR     | 3.3                           | **1.5 and 1.9**                 |
| judge unanswered          | 183                           | **0**                           |
| reviewer spend            | 0.29 USD                      | **0.84 / 0.94 USD**             |
| judge spend               | 0.28 USD                      | **0.31 / 0.44 USD**             |
| **total, both arms**      | 1.63 USD (projected)          | **2.52 USD**                    |
| wall clock                | 46 min                        | 76 and 94 min                   |
| **cost per pull request** | 0.116 USD                     | **0.050 USD**                   |

**The cost per pull request fell by 2.3 times while the corpus grew by 3.6**, which is the prefix cache doing what §9
said it would: the shared instructions are paid for once per lane per run, so their share of the bill falls as the corpus
grows. **The ceiling of 0.15 USD per pull request in `lib/run-config.mjs` is three times the measured rate**, so a full
200-pull-request run is about 10 USD - and **the binding constraint at 200 is not the money but the runner**: 200 pull
requests at the measured 1.9 minutes each is 380 minutes against a 340-minute ceiling. **The next wall is time per pull
request, and a full-corpus run needs that cut rather than the timeout raised again.**

### 16.2 The checklist, at fifty pull requests

|                  | with       | without    | delta       |
| ---------------- | ---------- | ---------- | ----------- |
| precision        | **0.2285** | 0.2219     | **+0.0066** |
| recall           | 0.1350     | **0.1836** | **−0.0486** |
| **F1**           | 0.1697     | **0.2010** | **−0.0313** |
| true positives   | 61         | **83**     | −22         |
| false positives  | **206**    | 291        | −85         |
| findings emitted | 399        | 582        | −183        |

**Paired over pull request and golden index: 30 both, 31 with only, 53 without only, p = 0.0214.**

**The F1 delta is inside the 0.04 the instrument was said to resolve, and the paired test rejects at 0.02.** §14.1
concluded that the instrument could not see an effect of 0.04 and §15.3 read the failure as resolution. **Both were
reading the wrong statistic**: the F1 difference divides by two denominators that move in opposite directions when a device
trades recall for precision, and the paired view asks the sharper question directly. **At fifty pull requests the paired
view has enough goldens to reject, and it rejects in the same direction as the two fourteen-pull-request readings** - so
the third reading does not overturn the first two, it confirms them at a corpus size where the confirmation is not a coin
toss. **The checklist is a suppression device. That is now three paired rejections and one F1 replication.**

### 16.3 `findingOnPathRejected` is 250 of 452, and 189 of those stand within ten lines of something we said

| distance from the golden to the nearest finding on its own file | goldens | share of the bucket | share of all goldens |
| --------------------------------------------------------------- | ------- | ------------------- | -------------------- |
| **0 - the finding's range covers the golden's line**            | **135** | **54.0 %**          | 29.9 %               |
| ≤ 10 lines                                                      | 189     | **75.6 %**          | 41.8 %               |
| > 50 lines                                                      | 61      | 24.4 %              | 13.5 %               |

**On fourteen pull requests this was 40 of 98 at zero lines; at fifty it is 135 of 250.** The share rose from 40.8 % to
54.0 %, so **the effect §15.4 identified is stronger on the larger corpus, not weaker** - which is what makes R-15 worth
its run rather than a hypothesis fitted to one sample.

**And the bucket is invariant across the checklist**, exactly as a search-side device must leave it: 84, 100, 98, 97 on
fourteen pull requests; **229 with the checklist and 250 without** on fifty. The device moves goldens between
`noFindingOnPath` and `hit` - **83 → 30 for the checklist on, which is the whole of what it does** - and never touches the
bucket that holds more than half the corpus.

### 16.4 The emission rule is now dominated by emitting everything

|                         | gate (shipped)       | full emission | best point on the curve |
| ----------------------- | -------------------- | ------------- | ----------------------- |
| findings                | 374                  | 582           | 446                     |
| precision               | **0.2219**           | 0.1838        | 0.2242                  |
| recall                  | 0.1836               | **0.2367**    | 0.2212                  |
| **F1**                  | 0.2010               | **0.2070**    | **0.2227**              |
| budget per pull request | 7.5, from the ranker | ∞             | 24                      |

**On fourteen pull requests the gate beat every point on its own curve. On fifty it is beaten by emitting everything**,
and by 0.0217 at a budget of twenty-four. That is a regression in the rule and not in the corpus, and **it is not taken
this iteration for the reason §15.7 gave**: a budget read off the curve it was measured on is fitting, and 0.0217 is below
the 0.0228 the instrument has been shown to move by itself at fourteen pull requests. **It becomes a registered rule with
its own falsification, or it stays a number in an artifact.**

### 16.5 The competitor arm replayed nothing, and the artifact published that as a win

The run's log:

```
AACR-BENCH competitor open-code-review · replay · replayed 0 · recorded 0 · missing 50 · findings 0
AACR-BENCH McNemar ours-only 83 theirs-only 0
```

and its artifact: `mcnemar: { oursOnly: 83, theirsOnly: 0, pValue: 0, verdict: "significant at 0.05" }`.

**Eighty-three to nothing, against an arm that produced nothing.** `missing[0].reason` says why:

> the corpus changed since the baseline was recorded (sha256:a04a4018… → sha256:1a9835…), so the recorded figure is not
> the figure this corpus would produce today

**The baseline holds fourteen rows and the run asked for fifty, so the fingerprint of the _selection_ moved and every row
was refused** - including the fourteen whose own goldens had not changed by a character. Two defects, both fixed this
iteration and both the same shape as §15.4's: **a guard aimed at the wrong object.**

1. **The fingerprint belongs to the row, not to the selection.** `pullFingerprint` hashes one pull request's goldens -
   path and line - so a corpus that grew is a prefix and not a different corpus. Rows transcribed before it existed replay
   with `verified: 'count'`, and the artifact counts how many rows a figure rests on each way.
2. **A comparison existed twice.** `secondReviewer.comparable` knew the arm was absent; a bare `mcnemar` did not, **and
   the flattering copy is the one a reader quotes.** There is now one object (`lib/competitor-comparison.mjs`) with its
   precondition inside it; when the arms were not scored over the same corpus, `theirsOnly` and `pValue` are `null` rather
   than zero and the verdict is `withheld`.

**A third defect fell out of the first**: a `record` run bought every pull request it was given, including the ones
already in the file, so growing a record from fourteen to fifty would have cost fifty. **A row that is already bought is
an input in both live modes**, and the resolver now decides the row's validity before it consults the mode.

### 16.6 What the next run measures, and what it is registered against

**Run 42789979455 is R-15's `before`.** It was dispatched from `4bb3985`, before `DESCRIBE_THE_FAILURE` existed in the
prompt, so **nothing in it can have been measured under the rule.** The next dispatch at the same corpus size pairs
against it on pull request and golden index through `aacr-checklist-compare.mjs`, which already does that pairing.

**R-15's thresholds, restated at the size they will be measured at**, because the registration in §15.5 was written in
absolute counts against 73 coincident rejections and this corpus has 189:

|                       | at 14 pull requests | **proportional rule** | at 50 pull requests |
| --------------------- | ------------------- | --------------------- | ------------------- |
| registered prediction | ≥ 24 of 73          | **≥ 32.9 %**          | **≥ 62 of 189**     |
| falsified by          | < 9 of 73           | **< 12.3 %**          | **< 23 of 189**     |

**The proportional form is registered before the run, and it is not a reinterpretation after the fact**: 24/73 is 32.9 %
and 9/73 is 12.3 %, and stating the rule as a share is the only way a threshold survives a corpus that grew after it was
written. **It is written here, before the dispatch, so that the number it produces can be checked against it.**

**And precision must not fall by more than 0.02.** A sentence that names a failure mode it cannot support is a
hallucination with better grammar, and the gate is what would have to absorb it.

## 17. R-15 falsified: the rule that named the failure licensed silence, and the reviewer took the licence

**Written 2026-11-10, from run [42811727182](https://github.com/AgentiX-E/code-analyzer/actions/runs/42811727182) - fifty
pull requests, both arms, `boilerplate-first`, competitor replayed, from `967612e`, which is the first commit carrying
`DESCRIBE_THE_FAILURE` - paired against run 42789979455 from `4bb3985`, which is the commit before it.**

### 17.1 The registration, and the answer

|                                 | registered (§15.5, restated proportionally in §16.6) | observed            |
| ------------------------------- | ---------------------------------------------------- | ------------------- |
| coincident rejections recovered | **≥ 32.9 %** (≥ 62 of 189)                           | **0**               |
| falsified by                    | **< 12.3 %** (< 23 of 189)                           | —                   |
| precision                       | may not fall by more than **0.02**                   | fell **0.0194**     |
| F1, checklist off               | —                                                    | **0.2010 → 0.1925** |

**The claim is falsified by its own falsification clause, and the point estimates are on the wrong side of every number
in it**: no coincident rejection was recovered, precision fell by almost exactly the amount the registration would have
forgiven, and F1 fell by 0.0085.

### 17.2 What the rule actually did

|                                                        | before (42789979455) | after (42811727182) |                     |
| ------------------------------------------------------ | -------------------- | ------------------- | ------------------- |
| findings emitted, checklist off                        | **582**              | **460**             | **−21 %**           |
| `noFindingOnPath`, checklist off                       | **30**               | **36**              | +6                  |
| `findingOnPathRejected`, checklist off                 | 250 of 452           | 192 of 349          | **55.3 % → 55.0 %** |
| `sameLine`, checklist off                              | 135 (54.0 %)         | 98 (51.0 %)         | −3.0 pp             |
| **paired hits on the 35 pull requests both runs read** | **86**               | **76**              | **−10, p = 0.20**   |

**The bucket the rule was aimed at did not move as a share, and the number of findings fell by a fifth.** On the 35 pull
requests the two runs share, 30 goldens were found by the before run and not the after, against 20 the other way - **a
point estimate of ten goldens lost, not recovered.**

### 17.3 The cause, and it is in the sentence I wrote

The rule ended:

> A suggestion that names no failure cannot be right or wrong, **which is why it is not reported**.

**That is a licence to emit less, and the model took it.** It is the same failure as the per-language checklist (§15.3):
a device registered as a _targeting_ aid became a _suppression_ aid, because the only instruction it gave the model that a
token could act on was permission to say nothing. **Two prompt devices in a row bought precision with recall on a corpus
whose binding constraint is recall** - 0.1836 against a competitor's 0.2941 on the same goldens.

**And the rule's own evidence sentence was stale**, quoting the fourteen-pull-request numbers (98 of 170, 40 on the
golden's line) into a prompt used on a corpus where the figures are 250 of 452 and 135. **A rule arguing from the wrong
numbers is a rule arguing from nothing**, which is the same defect as §13's discarded `path`, one layer up.

### 17.4 R-16, registered before its run

**Claim R-16.** _The same requirement without the licence to omit - "a suggestion that names no failure has not been
finished, rewrite it until it does, and do not report fewer findings because of this rule" - will recover **at least
12.3 % of the coincident rejections** (≥ 23 of the 189) at no more than 0.02 of precision, **and will emit at least 540
findings on fifty pull requests**, which is within 7 % of the 582 the pre-rule run emitted._

**Falsified if** fewer than 23 of the 189 are recovered, **or emission falls below 540**, **or precision falls by more
than 0.02.**

**The emission floor is the part that is new, and it is there because the last registration could not fail in the
direction that actually went wrong.** A rule about _how to say something_ that makes a model say less is not a phrasing
improvement; it is a recall change wearing one, and **the next registration has to be able to catch that**.

**Its baseline is run 42811727182 itself**, which is the strongest possible one-variable control: the next dispatch
differs from it by the two sentences in §17.3 and by nothing else.

### 17.5 What is not concluded

1. **That naming the failure is the wrong idea.** It is untested: **the version that ran never asked a model to name a
   failure without also telling it that it could stay silent**, so the idea has had no run. What is falsified is the
   phrasing, and the phrasing is what R-16 changes.
2. **That the coincident rejections are unrecoverable.** The count is 189 on this corpus and **zero have been recovered by
   any device tried so far** - the checklist, aimed at the search, and this rule, aimed at the sentence. **Two devices,
   two suppressions.** The next attempt is registered with the failure mode named in it.
3. **That the corpus loss is irrelevant to these numbers.** Twelve of fifty pull requests were unread in the `without`
   arm, so every figure in §17.2 is over 38 pull requests and 349 goldens, and the paired view is restricted to the 35
   both runs read. **That is why §18 exists.**

## 18. A quarter of the corpus went missing and the run said so in one number

**Written 2026-11-10, from the same run as §17.**

Run 42811727182 was dispatched for fifty pull requests. Its `with` arm read all fifty; its **`without` arm read
thirty-eight** and published `prsWithoutDiff: 12`.

**Twelve is a count. There was no list, no reason, and no line in the log.** `fetchPrDiff` returned `null` for two
different failures - a URL that is not a pull request, and a request that was refused - and the loop did:

```js
if (diff === null) { unfetched += 1; continue; }
```

**So the run could not distinguish a rate limit from a typo in the corpus from a network fault, and the three have
different repairs.** It is the same omission as §13's discarded `path` and §15.5's discarded sentence: **a number where a
list was needed, in the artifact that exists to make the number checkable.**

### 18.1 What changed

| before                                                                                       | after                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `fetchPrDiff` returns `string \| null`                                                       | returns `{ ok, diff }` or `{ ok, reason }`                                                                 |
| a read of `GITHUB_TOKEN` twice, so a `GH_TOKEN`-only environment fetched **unauthenticated** | both names, because **a silently unauthenticated fetch is sixty requests an hour against five thousand**   |
| the reason is discarded                                                                      | the HTTP status, the remaining budget and whether the request was authenticated                            |
| `prsWithoutDiff: 12`                                                                         | `prsWithoutDiff: 12`, `prsWithoutDiffReasons: [{ key, reason }]`, and `corpusRead: { read, share, whole }` |
| nothing in the log                                                                           | `AACR-BENCH unread · 12 of 50 pull requests (24 % of the corpus) · <first reason>`                         |

**`corpusRead.whole` is a disclosure and not a refusal**, at a threshold of one in twenty: **a run that read 49 of 50 is a
result about the corpus, and a run that read 38 of 50 is a result about 38 pull requests.** What is not allowed is
printing the second as the first, which is why the share travels in the artifact and the line travels in the log.

**And the likely cause is written down rather than inferred**: twelve of fifty in the later arm and zero in the earlier one
is the shape of a shared hourly budget being spent by the first arm before the second starts. **The fix is the second
thing on the list and not the first, because a run that names the cause can be repaired and a run that reports a count
cannot.**

### 18.2 The rule this settles

§16 recorded three defects of one shape in one iteration - a comparison without a counterpart, a guard on the wrong
object, a mode that bought what it held. **This is the fourth: a loss without a reason.** All four are the same
underlying habit, and it is worth stating as a rule rather than as a count:

> **Anything that leaves the run must leave with a reason, and the reason must be on the object that leaves.**

`missing[]` carries reasons for the competitor arm. `missedGoldens` carries a bucket and a shape for a golden.
`prsWithoutDiffReasons` now carries a reason for an unread pull request. **The artifact has no silent subtraction left**,
and the way that was found was by reading a run's own log against its own artifact line by line.

## 19. The mixture, not the wording: a category prior measured on verdicts already paid for

**Written 2026-11-10, after run 42823966835.**

Two prompt devices were registered and both came back empty or negative (§17, §16.2). **That is the useful part**: the
sentence is not where the remaining F1 lives, so the next registration had to be about something else. This section is
that something else, and it was chosen by reading the 569 verdicts the run had already bought.

### 19.1 What the verdicts said, with no model call

Every finding in `benchmarks/aacr-bench.json` carries `category` and the goldens a judge accepted it for. Counting them
costs nothing and answers "which kind of remark do we spend the budget on, and which kind is accepted":

| category        | emitted | accepted | rate      |
| --------------- | ------- | -------- | --------- |
| documentation   | 12      | 8        | **0.667** |
| security        | 14      | 6        | **0.429** |
| bug             | 211     | 86       | **0.408** |
| maintainability | 41      | 10       | 0.244     |
| performance     | 14      | 3        | 0.214     |
| architecture    | 179     | 36       | **0.201** |
| test            | 95      | 11       | **0.116** |
| style           | 3       | 0        | 0         |

**Two categories are two thirds of the emission and one sixth of the acceptance.** `architecture` and `test` together
are **274 of 569 findings and 47 of 160 accepted pairs** - and the corpus's own goldens are 46 % `Code Defect` and 42 %
`Maintainability`, which is the mixture we are not producing.

### 19.2 Reordering was measured first, and it does not work

**The obvious fix is a better ranker**, so it was tried before anything was built: a logistic model over the features the
artifact already carries (`grounded`, `quotesDiff`, `namesSymbol`, `proposesChange`, `hedged`, `agreement`, severity,
category, the hand-written `score`), trained on 40 pull requests and scored on 10, five folds by pull request.

| budget per pull request | hand-written score | learned re-ranker |
| ----------------------- | ------------------ | ----------------- |
| 12                      | **0.2296**         | 0.2219            |
| 16                      | 0.2244             | **0.2268**        |
| none                    | 0.2030             | 0.2030            |

**The learned ranker is inside the noise of the hand-written one and worse at the point the product operates at.** The
weights it found are readable and they say the same thing as the table above - `test` is the single most negative term,
`grounded` the most positive - **so the information was never in the ordering. It is in the set.**

### 19.3 The registration

> **R-17.** Emitting only the categories whose measured acceptance reaches **0.22** raises the file arm's F1 on this
> corpus by **at least 0.02** against the same run with every category emitted, on the same pull requests, the same
> goldens and the same judge.

**The mechanism is stated so the number cannot arrive alone**: precision rises and recall falls by less than the
precision rises - **a device that bought precision by dropping goldens would be a filter, not a prior.**

**Falsified if** the gain is below 0.02, **or** the paired test over the two arms' covered goldens does not separate them
at **p ≤ 0.05**, **or** recall falls by more than precision rises. **The discovery was made on 50 pull requests and the
confirmation is a run of the 100 it did not see** - `skip_pull_requests: 50` with `max_pull_requests: 100`, so the two
corpora are disjoint by construction rather than by an argument in a document - because a threshold placed between two
measured groups and then confirmed on the same rows is a threshold fitted to them. The artifact records both numbers under
`corpusSlice`, since **a run that says "one hundred" without saying "one hundred starting at fifty" is a run whose corpus
cannot be reconstructed.**

**The hundred is confirmed in one dispatch, and the split into two fifties was withdrawn by measurement rather than by
taste.** §15.6 briefly derived the ceiling from 3.3 minutes per pull request - a figure belonging to the
fourteen-pull-request run - which made a hundred look like 329 minutes of a 340-minute ceiling and led to a plan of two
slices of fifty. **The fifty-pull-request run of 2026-11-10 measures 61.0 and 79.7 minutes for its two arms**, so a
hundred is 159 minutes and fits the half-ceiling rule with 181 minutes to spare. **A registration that names a hundred and
is answered by one run of a hundred has answered the registration**; the split would have cost a second dispatch's
checkout, clone and install to buy nothing.

**What was measured before the registration, on the discovery set** (a subset of the verdicts above, so this is the
in-sample figure and it is labelled as one):

| policy                            | findings | precision  | recall     | F1         |
| --------------------------------- | -------- | ---------- | ---------- | ---------- |
| every category (today)            | 569      | 0.1810     | **0.2309** | 0.2030     |
| drop `test`                       | 474      | 0.2068     | 0.2197     | 0.2130     |
| drop `test` and `architecture`    | 274      | **0.2915** | 0.1928     | **0.2321** |
| the same, top 12 per pull request | 234      | 0.3419     | 0.1794     | **0.2353** |

**And a run only confirms the registration if it read the rows the registration names.** The wiring smoke run of
2026-11-11 - ten pull requests from the start of the corpus, dispatched to prove the comparison job's artifact download -
reported `confirmed: at least 0.02 F1, and the mechanism is precision` on a gain of 0.0374. **No overlap with the hundred
starting at fifty, and the artifact said the registration was confirmed.** Two gates were missing and both are now in the
outcome: `sliceMatches` compares the run's `corpusSlice` with the registration's declared `confirmation`, and a gain
narrower than the instrument's own resolution is `inconclusive` rather than `confirmed`. The same ten-pull-request pair
now reads `not a confirmation: the registration names skip 50 max 100, and this run read skip 0 max 10`. **A confirmation
is defined by which rows it read**, and a verdict computed over other rows is a verdict about a corpus nobody registered.

**The confirmation has been run, and it falsified the registration.** Workflow run
[42871500941](https://github.com/AgentiX-E/code-analyzer/actions/runs/42871500941), 2026-11-10, `skip_pull_requests: 50`
with `max_pull_requests: 100`, both arms, 724 goldens, 5785 model calls, 1.16 and 1.84 USD:

| arm (100 unseen pull requests) | precision  | recall     | F1         | TP  | FP  | FN  |
| ------------------------------ | ---------- | ---------- | ---------- | --- | --- | --- |
| every category (`advisory`)    | 0.1622     | **0.1768** | 0.1692     | 128 | 661 | 596 |
| the 0.22 floor (`defect`)      | **0.2559** | 0.1354     | **0.1771** | 98  | 285 | 626 |

**+0.0079 against a registered +0.02.** The instrument resolves 0.0194 at 724 goldens, so **the gain is inside the noise,
and the paired test is not neutral about it**: over the two arms' covered goldens, 38 goldens are matched by the floor arm
alone and **68 by the baseline alone, at p = 0.0046**. The mechanism held - precision rose 0.0937 and recall fell 0.0414,
which is the trade R-17's sentence permits - **and that is what makes the result worth writing down rather than
explaining away: the device does exactly what it was designed to do, and what it does is not worth 0.02 F1.**

**So the default went back to `advisory`.** `AACR_PROFILE` still takes `defect`, because it is a measured device and a
reader may want it, but **a filter that costs a significant 68 goldens to buy 38 and moves F1 by less than the noise is
not a default whatever it does to precision**. The discovery figure was +0.032 on 50 pull requests; the confirmation on
100 unseen is +0.0079, which is what a threshold fitted to its own rows looks like when it meets rows it was not fitted
to - **the registration was the reason this could be seen, and the same measurement without it would have shipped.**

**The floor is 0.22 and it is written in one place** (`DEFECT_FLOOR`), because it separates the four categories measured
above a quarter from the three measured below it. **`style` at 0.000 is dropped by the same rule and reported by it**,
and **`api` and `other`, which were never emitted, are kept** - a category nobody tried is not a category that failed.

### 19.4 What the artifact now says, and what it refuses to say

**The workflow's two matrix arms are now this device**: `defect` and `advisory`, over the same pull requests, and the
comparison job reads the varied field out of the two artifacts instead of being told it - so the next hypothesis is a
matrix edit rather than a rewrite. `configuration.emissionProfile` records which side of R-17 a run was, and `engineCounters.profile` carries the count and
the sentence per dropped category - so **a precision that rose because two thirds of the emission left is distinguishable
from one that rose because the findings got better**, which is the whole difference between this and a filter that
silently discards.

**And the comparison job now refuses a pair whose arms read different corpora**, because the run this section is written
from had exactly that defect: `prsInDataset` was 50 on both sides, `with` read 46, and the third job - whose only job is
to refuse confounded pairs - compared them. **`corpusRead.whole`, `prsReviewed` and the pull request keys of the two
`coverage.byPullRequest` tables are now confounds**, and the refusal names the four pull requests rather than the count.

### 19.5 What this section does not conclude

- **That `architecture` and `test` findings are worthless.** It concludes that **when an expert's judgement is the
  measure, they are much less often the remark the expert made** - which is why `advisory` exists and why the profile is a
  parameter rather than a deletion.
- **That 0.2321 will hold at 100 more pull requests.** The confirmation run is registered, not run; if it comes back
  inside the resolution, R-17 is falsified and the prior is reverted with its table.
- **That the corpus is a proxy for users.** Its goldens are AI-reviewer comments filtered by a human, which is the best
  available answer key and not the same thing as a maintainer's attention.

---

## 20. A hunk is not a function: the widest input change the evidence supports, registered before its run

**Written 2026-11-11, before the run.** Every device registered so far changed _how the reviewer says something_ (§17's
two phrasings) or _which remarks it spends its budget on_ (§19's category floor). Both moved precision and neither moved
F1 past the instrument. **This one changes what the reviewer can see**, and it is the first registration in this document
whose mechanism is an input rather than a sentence.

### 20.1 What the artifact says, read from three figures already paid for

Run 42974250499 (`defect` profile, 36 pull requests, 282 goldens) published `missedGoldens` as five disjoint buckets:

| bucket                  | count   | what it means                                                |
| ----------------------- | ------- | ------------------------------------------------------------ |
| `hit`                   | 77      | a finding was accepted as this issue                         |
| `fileNotReviewed`       | 34      | the golden's file was never handed to the engine             |
| `noFindingOnPath`       | 11      | the file was read and the lanes said nothing on it           |
| `findingOnPathRejected` | **160** | the lanes spoke on that file and the judge did not accept it |
| `noPath`                | 0       | —                                                            |

**160 of 282 is the largest single bucket the corpus has ever shown, and 91 of those rejections are on the golden's own
line** (`rejectionShape.sameLine`). A finding on the right line that a judge will not call the same defect is not a
localisation failure; it is a statement that is _about something else_. §17 tried to fix that with a sentence and
falsified twice: **two prompt devices in a row bought precision with recall** on a corpus whose binding constraint is
recall.

**What the competitor does differently is visible in its own logs**, which this repository has recorded since iteration
122 (`benchmarks/runnable-competitors-outputs/`). Before it comments it runs `code_search` and `file_read` - it reads the
definition and the call sites - and then it says what breaks: _"`Record<string, any>` loses the key typing: nothing
verifies these keys belong to `GlobalStateKey`"_. That sentence is not available from a five-line hunk. **It is available
from the function the hunk sits in**, and this repository's pull-request arm has never sent one.

### 20.2 The device

`packages/intelligence/src/review/llm/code-context.ts` builds, for each changed file, **the block each hunk sits in**:
the hunk's extent from its `@@` header, widened outward to the enclosing brace-balanced block (or to the hunk plus
twelve lines where the file has no reliable block), headed by three facts a model cannot recover from the text - **the
path, the line numbers of the window in the file, and which of those lines changed**. It is bounded three ways: 80 lines
per block, 2 600 characters per file, 12 000 characters per pull request, and a window that is clipped says how many
characters it did not show.

**It is off by default and it is an engine option** (`codeContext`), not a harness flag, because a device a user cannot
turn on is a device only the benchmark has. **The off-arm is byte-identical to the prompt every figure in this document
was measured on**, and `packages/intelligence/src/review/llm/__tests__/the-review-reads-the-block-the-change-sits-in.test.ts`
asserts that identity rather than describing it - **a device whose off-arm is "the old prompt" only measures something if
the off-arm really is the old prompt**.

**And the window is checked against the diff before it is sent.** The hunk header carries line numbers and no revision,
and a file read at the pull request's base rather than its head is the same file with every number shifted by however
many lines the change added - **a window that shows the old code under the new coordinates, which is a false statement in
the prompt and a silent one.** So the first added line of every hunk is kept as an anchor and the window is refused when
the file does not answer to it, and a refusal is counted and named in the prompt rather than dropped. The harness reads
the head commit from the pull request resource rather than from the corpus's `source_commit`, because the corpus names
the pair `base → head` (its own competitor harness is invoked `--from source --to target`) and **a field that is right by
coincidence is a field the next reader cannot check.**

**The cost, stated before the run.** One GitHub contents request per changed file (249 files over the 36-pull-request
slice) and roughly 650 tokens of prompt per file, so **about 1.6 times the prompt tokens of the off-arm** at the shipped
limits. The artifact records the requests, the characters read, the files that were absent and the first three reasons.

### 20.3 The claim

> **R-18.** _Showing each lane the block each hunk sits in recovers **at least 12 % of the 160 coincident rejections**
> (≥ 20 goldens on the 36-pull-request slice it is measured on), **raises the pull-request arm's F1 by at least 0.02**,
> and **does not lower the file arm's F1** - at **no more than 2.5 times the reviewer's cost per pull request**._

**Why 0.02 and not the 0.04 the checklist registered.** The instrument resolves 0.0194 at 724 goldens (§14, §19.3) and
this slice carries 282, so **a claim below 0.02 on 36 pull requests is a claim this instrument cannot decide** - the
mistake §19 was written to stop making.

**Why the file arm is in the claim.** The window is a pull-request-arm device; the file arm keeps its own call and its
own diff. **A device that raises one arm and lowers the other has moved the mixture rather than the reviewer**, and §19
already showed what a mixture change is worth.

**Falsified if** fewer than 20 of the 160 are recovered, **or** the pull-request arm's F1 moves by less than 0.02 **or**
downward, **or** the file arm's F1 falls by more than the resolution, **or** the reviewer's cost per pull request exceeds
2.5 times the off-arm's.

**Its baseline is run 42974250499's own pull-request arm** - 213 findings, 44 accepted, precision 0.2066, recall 0.1560,
F1 0.1778, over the same 36 pull requests, the same goldens, the same judge and the same prompt. **The on-arm differs
from it in one environment variable and in nothing else.**

### 20.4 What this registration cannot conclude, and the confound it already knows about

- **That the window is what the competitor's advantage consists of.** It is _one_ of the things their logs show, and the
  agentic loop around it - choosing what to read - is the part this device does not have. **A null result would falsify
  the window and not the reading.**
- **That a cross-run comparison at 36 pull requests can settle a 0.02 claim.** Two runs of this job have reported the
  same configuration at 0.1691 and 0.2405 (§16.2), so **the honest confirmation is a same-job matrix arm** - two arms of
  one dispatch, differing in `AACR_CODE_CONTEXT` and in nothing else - and this section registers the device on the
  cross-run comparison it can afford now, with that limitation written down before the number rather than after it.
  **If the result is inside the resolution, the next dispatch is the matrix, not another device.**
- **That a wider window is always better.** Twelve lines either side is a screen; the whole file is a different claim
  (and a different cost) and nothing here measures it.

### 20.5 What the run said, and the instrument defect it found on the way

**Run [43033514810](https://github.com/AgentiX-E/code-analyzer/actions/runs/43033514810)**, `code_context: on`, `skip 14`,
36 pull requests, 282 goldens, the same judge, the same prompt, `competitor: replay` - against the baseline named in
§20.3.

| clause of R-18                  | required    | measured                                       | met    |
| ------------------------------- | ----------- | ---------------------------------------------- | ------ |
| coincident rejections recovered | ≥ 20 of 160 | **6** (160 → 154)                              | **no** |
| pull-request arm F1             | **+0.02**   | **−0.0065** (0.1778 → 0.1713)                  | **no** |
| file arm F1                     | not lowered | **+0.0240** (0.1940 → 0.2180)                  | yes    |
| reviewer cost per pull request  | ≤ 2.5×      | 1.08× (0.7811 vs 0.7205 USD at one price tier) | yes    |

**The device is falsified on the arm the claim names, and the record says so rather than the softer word.** 43 accepted
findings against 44, from seven more emitted; precision 0.2066 → 0.1955, recall 0.1560 → 0.1525. `hit` goldens rose
77 → 82 and the file arm gained seven true positives for thirteen more false ones - **a widening that pays for itself on
one arm and not on the other.**

**What the falsification is worth, stated with its own error bar.** The pull-request arm moved by 0.0065 against the
**0.0311** this 282-golden slice resolves, and the paired counts are 25 both, 21 with-only, 14 without-only,
**p = 0.3105**. So **the threshold was not met**, and **the movement that failed it is not separable from noise** - both
sentences belong in the record, and §20.4 named the matrix as the next dispatch before this result existed. The matrix
is now the only dispatch that can settle it.

**The comparison job was reading the wrong arm, and this run is what exposed it.** `aacr-ablation-compare.mjs` computed
every registration's `registeredGain` against the artifact's **top-level** figure - the file arm - while R-18's threshold
is attached by its own sentence to the **pull-request** arm. On these two artifacts the file arm gained 0.024 and cleared
0.02, so the job published `magnitudeMet: true` and the word `inconclusive`: **a verdict about an arm the registration
does not name, and a gentler word than the truth.** Three things changed in the same iteration:

- a registration names its arm (`arm: 'pullRequest'`), and the verdict is computed from that arm's block;
- the second clause of a sentence becomes a gate rather than a remark (`guard: { arm: 'file', notLoweredBy: 0 }`), so
  "without lowering the file arm" can fail;
- **both arms are published** (`byArm`), because the arm a claim does not name still moved, and **an artifact that
  reports one arm lets its author choose which half of the truth to quote**;
- an artifact that does not carry the named arm is **refused** rather than measured on the nearest one.

**Re-running the same two artifacts under the fixed job changes the word from `inconclusive` to `falsified`** - same
numbers, one field added. **This is the second time this file has been the defect rather than the device** (§19's
hardcoded mechanism rule was the first), and the lesson is the same one in both cases: **a comparison job that can drift
away from the sentence it is judging will eventually certify the wrong number, and nothing in its output will look
wrong.**

---

## 21. The same device, measured in one job: the matrix R-18 was owed, and the detail an artifact owes its reader

**Written 2026-11-12, before the dispatch.** §20 registered a device and measured it across two dispatches, which was
the only arrangement available at the time and was named as a confound in §20.4 before the number existed. It came back
`falsified` on the pull-request arm by **0.0065** - a movement smaller than the **0.0311** that slice resolves - so the
honest reading of R-18 is not _"the window does not work"_ and not _"the window works"_ but **"this instrument, arranged
this way, cannot tell"**.

**The arrangement was the problem, and it is fixable without a new idea.** Two runs of this job have reported the _same_
configuration at **0.1691** and **0.2405**: a spread of 0.0714, which is larger than every effect this document has ever
registered. A comparison across dispatches therefore carries the job's own variance and cannot separate a 0.02 device from
it at any corpus size this budget allows. **A device whose contribution can only be measured across runs is a device this
repository cannot measure**, so the switch became a matrix key (`code_context: [off, on]`) and one dispatch now produces
both arms over the same corpus, the same goldens and the same judge.

### 21.1 The registration

> **R-19.** Over the thirty-six pull requests at `skip 14`, in **one dispatch of one job**, showing each lane the block
> each hunk sits in raises the **pull-request arm F1** by **at least 0.02** without lowering the file arm.

**Both outcomes are information, which is why this is worth a dispatch rather than an assumption.**

- If the matrix reaches 0.02, then R-18's `falsified` was **the cross-run variance and not the device**, and the sentence
  in §20.5 that reads _"falsified on the arm it names"_ is wrong about the device and right about the arrangement.
- If it does not, then R-18's verdict stands **and is now measured by an instrument that can support it**, which is a
  strictly stronger claim than the one §20 could make.

**Falsified if** the arm's gain is below 0.02, **or** the paired test over the two arms' covered goldens does not separate
them at **p ≤ 0.05**, **or** recall falls while precision rises by less - the same mechanism clause as every registration
since §16, because a device that buys precision by emitting less is a filter.

### 21.2 Why the profile left the matrix rather than joining it

**R-17's 0.22 floor was falsified at +0.0079 against a registered +0.02 on a hundred unseen pull requests** (§19.3), and
`advisory` went back to being the default. Keeping `profile` as a second matrix key would produce four arms: two of them
would re-measure a retired configuration, and `aacr-ablation-compare.mjs` refuses any pair whose artifacts differ in more
than one configuration key - so a cross product would produce **four artifacts and zero comparisons**. The matrix names
its two arms as `include` entries and the test that reads the workflow asserts they differ in exactly one key, because
**a matrix that varies two things answers neither** and the refusal would arrive after both arms were paid for.

### 21.3 The omission this iteration found in its own artifact

Three stage pages in a row listed _sample the goldens both arms miss_ as the next step and none of them took it. The
reason was not neglect: **the artifact kept five examples per attribution bucket, at a hundred and sixty characters each,
and nothing else**. A hundred and sixty-nine goldens went into five buckets and fifteen examples came out.

**The omission was deliberate, and the reason it was deliberate was correct for one reader and wrong for the other.** The
comment beside the cap said a bucket whose examples are four hundred characters of prose is a bucket nobody reads, and
that is true: an artifact is a file people open to see a shape. **What it did not account for is that the same file is
the only evidence the next iteration has**, and a question like _"is this missed golden a defect at all"_ needs the
comment. The cap therefore was not the error - **having only one layer was**:

| layer                                   | what it is for                                                            | what it costs                                      |
| --------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `missedGoldens.examples`                | five per bucket, a hundred and sixty characters, for a person skimming    | nothing, it was already there                      |
| `missedGoldens.records`                 | every golden, six hundred characters, for a program reading it            | about 200 kB in a file that was 676 kB             |
| `byCategory`                            | the true positives decomposed by category, through the matching's owner   | one pass over rows already in memory               |
| `bothMissed`                            | the goldens neither reviewer found, with their notes                      | about 90 kB, and it is the ceiling on the exercise |
| `findingsAtItsOwnOperatingPoint[].text` | **the competitor's own sentence**, so that _learn what they say_ has data | 94 kB → 220 kB of a replayed baseline              |

**`records` is checked against the counts rather than trusted**: the buckets are recounted from the records and compared
to the table beside them, and a detail list that is not the same list as the table fails the run that produced it.

**And the per-category table is a decomposition rather than an estimate, which took a second attempt.** The first draft
counted findings that matched a golden, and reported **73** true positives where the run scored **39** - because one
golden mentioned by three lanes is one true positive and three matched findings. The version that ships attributes each
owned golden to the finding the maximum matching gave it (`goldenOwners`), which makes the columns sum to the score by
construction, and the run publishes `byCategory.totals.agrees` so that **a bookkeeping that stopped adding up would say
so in the artifact rather than in a report about the artifact.**

**The competitor's rows were the omission with the highest price.** Our own rows have carried `text` since the first
run - which is what made `findingOnPathRejected` readable beside the sentence that earned it - and the competitor's rows
carried nine fields, none of them the remark. **A comparison that keeps where a comment landed and not what it said can be
compared and cannot be learned from**, and every analysis of the gap ends with an instruction to say what they say. The
baseline in `benchmarks/aacr/competitor-baseline.json` was recorded before the field existed, so `replay` runs cannot have
it; `competitorTextCoverage` reports the proportion and fails a `record` run that pays for the output and keeps only its
coordinates.

### 21.4 What this section does not conclude

- **That 0.02 is the right threshold for a device that costs 0.006 USD per pull request.** It is the threshold R-18 was
  registered under, and re-registering the same claim at a lower bar after a falsification is how a document stops being a
  record.
- **That `bothMissed` is a property of the corpus rather than of these two reviewers.** It is the ceiling **for this pair**
  on these rows; a third reviewer could lower it, and the list exists so that somebody can try.
- **That the category decomposition explains the gap to the competitor.** It explains where _our_ true positives come
  from, which is a fact about our own emission and not a comparison.

## 22. The record enters the repository, and the two accounting defects that were hiding behind it

Iteration 124 ended with an obligation and a hole. The obligation: **the competitor's recorded result existed as a file on
a runner and not as a file in the repository**, so the next job would have reported all thirty-six pull requests
`missing` and bought them again - the exact defect the replay mechanism was built to prevent, one directory away from the
code that prevents it. The hole: **a rejected golden carried its distance and not its finding**, so the largest bucket in
the ceiling (`findingOnPathRejected`, 120 of 166) could be counted and not read.

Both are detail-layer repairs. Neither adds a device, and **neither is registered as a claim**, because neither changes
the reviewer: they change what a reader can check without paying for another run.

### 22.1 The baseline, and its two origins stated

`benchmarks/aacr/competitor-baseline.json` now holds **46 rows**: **32 recorded** by the record-mode run of 2026-11-11 over
the `skip 14` slice, and **14 transcribed** from the 2026-11-09 artifact and carried across by `startRecording` rather
than bought a second time.

**A file that mixes two origins and states one lies about half of itself**, so the file states both, and it carries the
rule that tells its rows apart - **the same rule the resolver applies**: a row with a `fingerprint` was recorded live and
replays as `verified: 'fingerprint'`; a row without one was transcribed and replays as `verified: 'count'`. The four pull
requests the record does not cover are named rather than left to be discovered: they are **holes in the pairing**
(`secondReviewer.missing`), not zeros, and a later record-mode run buys exactly those four.

**The guard is the arithmetic, not the prose.** Replaying the thirty-two recorded rows through the harness's own scoring
functions reproduces **113 true positives and 168 false positives** - the figures that run published - and replaying the
fourteen transcribed rows reproduces the **170 goldens** both reviewers were scored against on 2026-11-09. A lost row, a
shifted index or a `keep` flag turned into a string moves one of those numbers.

### 22.2 A failure that was counted and not named

**The record run of 2026-11-11 reported `prsAttempted: 36`, `prsFailed: 4`, `recorded: 32` - and named one failure.**
Three attempts existed as a number, contributed nothing to the competitor's numerator, contributed **nothing to its
denominator either**, and could not be looked up. **That is the same asymmetry the parse-failure branch documents and was
worth 0.0130 of F1 the first time it happened**, surviving in a second code path for six iterations: the fix was applied
where the symptom was read rather than where the accounting is done.

Two rules now hold, and the difference between them is the whole point:

1. **A failure that ran is an observation.** The attempt gets a zero row, its goldens enter the denominator, and the
   failure gets an entry in `secondReviewer.failedPullRequests` with its stage (`run` or `parse`).
2. **A failure that could not run is an environment fact.** A provider refusing the call for want of credit
   (`402`/`Insufficient Balance`) is filed as `missing` - a hole in the pairing - and is not counted in `prsFailed`,
   because the two lists are one fact written twice.

**The restatement this forces, on the recording slice (36 pull requests, 282 goldens):**

| competitor, 2026-11-11 slice  | P      | R          | F1         |
| ----------------------------- | ------ | ---------- | ---------- |
| as published before this fix  | 0.4021 | 0.4248     | 0.4132     |
| with the four attempts scored | 0.4021 | **0.4007** | **0.4014** |

**The pairing also stops being partial.** With every attempt accounted for, the competitor has a row on all thirty-six
pull requests, so `mcnemar.comparable` becomes true on the next run and **the head-to-head states a verdict instead of
withholding one because three rows were missing**. That is not a change of standard: a withheld comparison was the honest
answer to an incomplete pairing, and the pairing is no longer incomplete.

### 22.3 A bucket that named its distance and not its finding

`findingOnPathRejected` was readable only as a distance. The artifact said _"we spoke on that file and the judge did not
accept it, 100 of 164 times on the golden's own line"_ and could not say **which finding** - so the two repairs behind
that one bucket (a wording defect where the gate kept the finding, a gate-calibration defect where it dropped it) could
not be counted without buying the run again.

`missedGoldens.records[].nearestFinding` now carries the finding itself: **its position in the ranked list, its range, the
actionability gate's verdict, the gate's reasons, and its sentence** (300 characters). The three checks in
`scripts/aacr-bench-audit.mjs` that hold it:

- every rejected golden names the finding it was measured against, or the run says how many do not;
- the rejections on a finding's own line are counted in the artifact rather than in a report about the artifact;
- every attempted competitor run is either recorded, replayed, failed or missing, and the failures that were counted are
  the failures that were named.

**The last one is the check that would have caught §22.2 four days earlier**, which is the reason it is a check and not a
paragraph.

### 22.4 What this section does not conclude

- **That the restated competitor figure is the one to quote against ours.** It is computed over the thirty-six pull
  requests of that slice; the paired thirty-two-row comparison in the iteration 124 report is a different denominator and
  is unaffected by the four attempts, because those four are outside it.
- **That the new verdict is a defeat.** It is the first comparable head-to-head this repository has had on a corpus it did
  not build, and a comparison that is unfavourable and complete is worth more than one that is withheld and flattering.
- **That `nearestFinding` explains the 120.** It makes them readable. The split between wording and gate calibration is
  the next measurement, and it is an offline one.

## 23. The gap was architectural: a reviewer that cannot read the code cannot say what the code does wrong

### 23.1 What the head-to-head said, in one paragraph

On 36 paired pull requests, one corpus, one judge and one model, the competitor reached **F1 0.4043 (114 TP / 168 FP,
recall 0.4043)** and this engine reached **0.2033 (61 TP / 257 FP, recall 0.2163)**. Under the registered actionability
gate the two were **0.1954 against 0.1886**, and the paired test — 37 findings of ours against 23 of theirs — was
**not significant at p = 0.0925**.

**Two numbers decide what that means, and neither is about wording.** Of the 282 goldens we missed, **158 had one of our
findings on the golden's path within ten lines** — the location was right and the claim was not — and **31 sat on files
the review never opened**. The reviewer was given a diff string. The competitor's is given a checkout and five tools,
and its own prompt says: _"when the context is unclear, use tools to obtain contextual information rather than judging
based on assumptions."_

**So the claim this section registers is not a prompt change.** It is a reviewer that reads: a plan, a tool loop over a
repository, a finding that survives only if the code it quotes is in the file, and a filter pass that can only remove
what it can point at.

### 23.2 What was copied, and from where

Read from `alibaba/open-code-review` at 1.13.7 (`internal/config/template/prompts/`, `internal/tool/`,
`internal/diff/resolver.go`, `internal/config/template/task_template.json`):

| their mechanism              | what it does                                                                                       | ours                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `grouping_task`              | clusters changed files, ≤ 10 per group, one LLM call                                               | `groupChangedFiles` — by directory, **no model call**, so a run is reproducible for free                                        |
| `plan_task`                  | risk points, each with the tool calls that would settle it                                         | folded into the first round's instruction: five lines before the first tool call                                                |
| `main_task` + 6 tools        | 100 tool rounds, `file_read`/`file_read_diff`/`file_search`/`file_find`/`code_comment`/`task_done` | 4 rounds, 5 tools: `read_file`/`search_code`/`read_diff`/`file_comment`/`task_done`                                             |
| `code_comment.existing_code` | the quote is how the finding is located                                                            | same, plus a **locator that reports how it found it** (`exact`/`normalised`/`disambiguated`/`anchored`)                         |
| `re_location_task`           | a second model call regenerates an unmatched quote                                                 | **removed**: an unlocatable quote is dropped, because a model deciding where a model's claim belongs is the defect in a costume |
| `review_filter_task`         | removes only comments a diff _proves_ wrong                                                        | same asymmetry, and **a removal without a named contradicting line is ignored**                                                 |
| `task_done` (no arguments)   | ends the review                                                                                    | **takes the files reviewed and the files skipped with reasons** — an unaccounted file is a counted defect                       |

**The one deliberate addition** is the account. Their `task_done` takes nothing, so _did the agent read every changed
file_ is not answerable from its output — and 31 of the goldens we missed were on files nobody looked at. Here every
changed file ends with one of four statuses, and `unaccounted` is published per run.

### 23.3 The budget, stated before the number

A hundred tool rounds per group is a bill, not a measurement. Ours: **4 rounds, 12 tool calls, 4 searches and 120 000
characters per group of files, with one review-wide ceiling of 1 200 000 characters for the money**, and a grounding read
is counted outside the model's budget because it is ours.

**The unit of every one of those numbers is a correction, not a drafting choice**, and §23.5 and §23.6 are why: they were
written per pull request, and a ceiling counted once for a review starves either the later groups of one pull request
(§23.5: no group ever started) or the later groups of a large one (§23.6: a 200-file pull request's third group could not
read a character and filed from the diff alone). **The only quantity that is not a unit of work is the bill**, so the bill
is the only ceiling stated per review.

The ceiling scales with the arm: `CEILING_USD_PER_PULL_REQUEST_AGENT = 0.35`, against 0.15 for the lanes. **That number is
an estimate and is marked as one** — the first measurement of this arm replaces it, and an artifact records which ceiling
it ran under. **Measured: 0.79 USD for 36 pull requests, of which 0.16 was the judge, 0.46 was five lanes whose findings
were then discarded, and 0.073 was the agent itself** — so the arm with the lanes removed costs about 0.002 USD per pull
request and the estimate was two orders out in the harmless direction.

### 23.4 Registered, and honestly not a pre-registration

**The dispatch happened before this section was written** (`43162733527`, 36 pull requests, skip 14, `agent: on`), so its
figure is a **discovery, not a confirmation**. The rule this repository applies to a discovery is the one R-17 needed and
did not have:

- the arm's number may motivate a claim;
- the claim must be confirmed on rows the discovery did not see (`skip_pull_requests: 50`);
- and **no figure from this arm is quotable against the competitor until that confirmation exists**, because the arm and
  its prompt were written by the same iteration that read the corpus.

**What would falsify the design rather than the implementation**: if the arm, having read the code, still lands within
0.03 of 0.2033 on the same corpus. The mechanism would then be wrong about where the gap lives, and the next section
would have to explain a 158-finding claim-quality gap that reading the file does not close.

### 23.5 The first measurement is a zero, and it is the loop rather than the model

`43162733527` (36 pull requests, skip 14, `agent: on`) produced **TP 0, FP 3, FN 282: precision 0, recall 0, F1 0**, on the
same rows where the five lanes produce F1 0.1608 and the competitor's replayed arm produces 0.4043.

**Three findings in thirty-six pull requests.** The artifact could not say why, and that is the first defect: it carried
the score and not the reason for it, so the two questions that matter — _did the model decline to file_, or _did the loop
never let it_ — were indistinguishable from the output.

What the artifact did carry, read together, answers it:

| the ledger said                                            | what it means                                             |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| 145 model calls for 36 pull requests                       | four calls per pull request                               |
| `aacr-agent:g1:r1` … `g1:r4`, each called exactly 36 times | **round one through four of group one, and no group two** |
| 273 tool calls, 2 369 133 characters read                  | the arm read 2.4 MB of source and filed three comments    |
| `accounts.unaccounted: 248` of 249 files                   | `task_done` was never called either                       |

**The ceilings were counted once per review and the work is per group.** Every pull request spent its four rounds on the
first group of four files, read until the round budget ended, and stopped mid-exploration — so groups two and three never
ran, 248 of 249 changed files were never opened, and the run reports a reviewer that found nothing when it was a reviewer
that was never allowed to finish a thought. **This is the third time in this repository's benchmark work that a counter's
unit did not match the work's unit** (§19.2's per-run budget, §20.3's two dispatches for one device, and this), and it is
the same failure each time: the number was plausible and the accounting was wrong.

**Three changes, and none of them is a prompt tweak:**

1. **Rounds, tool calls and file reads are counted per group**; characters and searches stay per review, because a bill is
   a fact about the review and a budget is a fact about the work.
2. **The last round of every group cannot read.** A budget that can be spent entirely on reading measures how much an
   agent likes reading, so the final round offers `file_comment` and `task_done` only, and a call to anything else is
   refused by name rather than executed. This is a reservation rather than an extra call: a group costs what it cost
   before and one of its rounds now concludes.
3. **The artifact carries the trace and `draftsFiled`.** One line per round — the tools called and what was said — and the
   count of drafts before grounding, because _no comments_ and _no attempts_ are different bugs and were the same number.

**The lanes were also being bought and thrown away**: under `AACR_AGENT=on` their findings are replaced downstream, so
0.46 of that run's 0.79 USD and most of its 41 minutes were a second reviewer nobody scored. They no longer run when the
agent is the arm.

**What this does not say.** It does not say the agent's design is wrong, and it does not say the competitor's 0.4043 is
reachable: a run that filed three findings is not evidence about a design, it is evidence about a loop. §23.4's
falsification condition is unchanged and still unmet, and **the zero above is not quotable as a figure either** — it is a
defect report.

### 23.6 The repaired loop, measured on six pull requests

`43172833166` (`agent: on`, six pull requests, `skip_pull_requests: 0`) is the first run of this arm in which the
reviewer filed anything: **35 drafts, 24 kept, 21 files commented, 5 declared clean**, and **not one golden on a file the
review never opened**.

| operating point              | k   | TP  | FP  | P      | R      | F1     |
| ---------------------------- | --- | --- | --- | ------ | ------ | ------ |
| full emission                | 31  | 10  | 21  | 0.3226 | 0.1786 | 0.2299 |
| after the actionability gate | 6   | 3   | 3   | 0.5    | 0.0536 | 0.0968 |

**The gate is the largest single loss in the pipeline**, and it is the one number here that is a decision rather than a
measurement: the actionability rule was calibrated on lane findings, which are single-shot claims over a diff, and it
takes this arm's recall from 0.1786 to 0.0536 while its precision goes from 0.3226 to 0.5. **A rule that halves a
reviewer's precision loss and quarters its recall is not obviously right for a reviewer that read the file**, and the
next measurement is the same rows at both operating points rather than an argument about which is better.

**Six pull requests is not a corpus.** The figure above is a smoke test of a repaired loop; the number this section's
falsification condition is about is §23.4's, and it still has not been measured.

### 23.7 The gate is an instrument for one reviewer, and it was being applied to two

`43176459822` (36 pull requests, skip 14, `agent: on`, repaired loop) is the first run of this arm on a corpus that can
resolve anything: **TP 50, FP 146, FN 232, precision 0.2551, recall 0.1773, F1 0.2092** emitted, against **0.2033 for the
five lanes on the same rows** and **0.4043 for the competitor replayed on the paired rows**.

**Applying the registered actionability rule to that emission turns it into F1 0.0523.** Twenty-four findings survive,
eight of them true, and **42 of the 50 goldens the arm had covered stop being covered by anything**. The rule costs the
lanes 0.2033 → 0.1886, or seven per cent, and it costs this arm seventy-five per cent, which is not a rule being applied
twice, it is a rule being applied to something it was not calibrated on.

**The artifact can say exactly why, per finding, because `rankedFindings` records the five conditions separately:**

| what the arm's findings did                                                    | count of 196 |
| ------------------------------------------------------------------------------ | ------------ |
| the range covers an added line (`grounded`)                                    | 178          |
| quotes an added line verbatim (`quotesDiff`)                                   | 19           |
| names an action or shows a replacement (`proposesChange`)                      | 9            |
| **found a golden and was dropped anyway**                                      | **48**       |
| of those, `grounded` true and **both** `quotesDiff` and `proposesChange` false | **43**       |

**The rule's second conjunct is `proposesChange OR quotesDiff`, and it is a request for a lane's artefacts.** A lane
answers one diff in one call, so its answer arrives as a suggestion or a quotation — that is what the calibration saw. The
reading arm files through a tool that carries `existing_code` and an _optional_ `suggestion_code`, and across 196 findings
it supplied the latter nine times: **the arm expresses a defect as a sentence about a line it verified against the file,
and the rule reads a missing suggestion as an absent claim.**

**And it cannot be retuned, which is a measurement rather than an opinion.** Every rule below was scored offline on that
run's own artifact — the same judge verdicts, the same matching, no additional spend:

| emission rule                             | k   | TP  | FP  | P      | R      | F1         |
| ----------------------------------------- | --- | --- | --- | ------ | ------ | ---------- |
| the registered rule                       | 24  | 8   | 16  | 0.3333 | 0.0284 | 0.0523     |
| `grounded`                                | 178 | 46  | 132 | 0.2584 | 0.1631 | 0.2000     |
| `grounded` and names a touched identifier | 173 | 46  | 127 | 0.2659 | 0.1631 | 0.2022     |
| score ≥ 0.45                              | 172 | 46  | 126 | 0.2674 | 0.1631 | 0.2026     |
| `grounded` and severity high or critical  | 64  | 19  | 45  | 0.2969 | 0.0674 | 0.1098     |
| **full emission**                         | 196 | 50  | 146 | 0.2551 | 0.1773 | **0.2092** |

**No threshold and no conjunction over the five recorded conditions beats emitting everything.** The score does not
separate this arm's true findings from its false ones — the best precision any cut reaches is 0.3714 at k = 35, and it
pays for it with three quarters of the recall. **A rule that cannot be tuned into an improvement is not at the wrong
threshold; it is being asked the wrong question**, and the question it asks — _does this comment say what to change?_ — is
one a single-shot lane has to answer and a reader that quoted the file has already answered a harder way.

**Registered, before the next dispatch:**

1. **The actionability gate is scoped to the lanes.** The reading arm's emission rule is its own filing check, which is
   stricter about evidence than the gate is: a draft is filed only if the code it quotes is located, character for
   character or after whitespace normalisation, in the file at the reviewed commit, or in the diff when the file could not
   be read (§23.5's `snippet-not-found` drop). **225 drafts became 196 findings under that rule in `43176459822`**, and it
   needs no suggestion and no quotation of an added line.
2. **The comparison is retained rather than deleted.** The artifact keeps scoring the lane rule on the same findings, so
   the cost of the scoping stays visible in every future run instead of becoming a footnote in this document.
3. **Hypothesis H1:** scoping the gate to the lanes raises the arm's shipped F1 from 0.0523 to 0.2092 on the same rows, and
   the arm's shipped figure is then **above the lanes' 0.2033 for the first time** — by 0.006, which is inside the ±0.031
   this instrument resolves at 36 pull requests, so **the claim registered here is that the arm is not worse than the lanes
   once the gate is scoped, not that it is better.**
4. **Hypothesis H2, and it is the one that has to move the gap.** Of the 232 goldens the arm missed, **74 sit on a file the
   review did read and said nothing about, and 35 on a file it never opened** — 109 of 232, nearly half, are volume rather
   than aim. The arm emits 5.4 findings per pull request against the competitor's 7.8, it drops 25 drafts per corpus to a
   three-findings-per-file cap, and it declares 94 of 249 changed files out of scope. **The next run raises the per-file
   cap to six and records what the extra findings are worth**; if F1 does not rise, the volume hypothesis is falsified and
   the remaining gap is claim quality on the 64 goldens we described with a different defect.
5. **Neither hypothesis is quotable against the competitor** until the confirmation run on `skip_pull_requests: 50`
   (§23.4), because both were read off the rows that produced them.

**What would falsify item 1**: a run in which the scoped arm's precision falls far enough that its F1 lands below the
lanes' on the same rows — that is, below 0.2033 — because then the gate was not removing lane-shaped noise but real
precision, and the arm's sentences are worse claims than the lanes' suggestions rather than differently shaped ones.

### 23.8 The budget was the loop again, and what is left is precision rather than volume

`43184902326` (36 pull requests, skip 14, `agent: on`, `0f9463dc`) is the first run under §23.3's corrected units — the
character and search ceilings are per group, with one review-wide ceiling of 1 200 000 characters for the bill:

|                                     | `43176459822`, per review | `43184902326`, per group |
| ----------------------------------- | ------------------------- | ------------------------ |
| findings kept                       | 196                       | **256**                  |
| true positives                      | 50                        | **65**                   |
| precision                           | 0.2551                    | 0.2539                   |
| recall                              | 0.1773                    | **0.2305**               |
| F1, everything emitted              | 0.2092                    | **0.2416**               |
| characters read                     | 3 499 229                 | 5 572 368                |
| drafts filed                        | 225                       | 294                      |
| files declared out of scope         | 94                        | **46**                   |
| files commented                     | 104                       | 133                      |
| goldens on a file read in silence   | 74                        | **42**                   |
| goldens rejected with one on path   | 112                       | 132                      |
| goldens on a file never opened      | 35                        | 33                       |
| drafts refused for the per-file cap | 25                        | 32                       |

**+0.0324, and it is the mechanism rather than a mood**: the arm read 59 % more characters, declared half as many files out
of scope, and the goldens it missed _on a file it read and said nothing about_ fell from 74 to 42. **That is the same
defect as §23.5 in a smaller place and its third appearance in this section** — a ceiling whose unit is the review, applied
to work whose unit is the group — and this time the artifact already carried the reason: the six-pull-request run's trace
had the model saying _"every read attempt was rejected for exceeding the character budget, so I have only the diff text"_.

**The gain is at the edge of what this instrument resolves** (±0.031 at 36 pull requests), so it is a discovery on the rows
that produced the change rather than a confirmed effect, and the run is **not** a pre-registration: `0f9463dc` was pushed
before this section existed.

**The gate's rule sweep was recomputed on these rows and says the same thing a second time**, which is what keeps §23.7's
scoping from being a story about one run:

| emission rule                              | k   | TP  | FP  | P      | R      | F1         |
| ------------------------------------------ | --- | --- | --- | ------ | ------ | ---------- |
| the registered actionability rule          | 30  | 11  | 19  | 0.3667 | 0.0390 | 0.0705     |
| `grounded`                                 | 231 | 56  | 175 | 0.2424 | 0.1986 | 0.2183     |
| score ≥ 0.45                               | 223 | 55  | 168 | 0.2466 | 0.1950 | 0.2178     |
| `grounded` and severity high or critical   | 75  | 24  | 51  | 0.3200 | 0.0851 | 0.1345     |
| **full emission, which the arm now ships** | 256 | 65  | 191 | 0.2539 | 0.2305 | **0.2416** |

**And §23.7's item 4 is falsified by this run's own pairing, which is why it is corrected here rather than defended.** On
the 33 pull requests both reviewers were scored over:

|                 | k   | TP  | precision | recall | F1     |
| --------------- | --- | --- | --------- | ------ | ------ |
| the reading arm | 245 | 60  | 0.2449    | 0.2256 | 0.2348 |
| the competitor  | 282 | 114 | 0.4043    | 0.4286 | 0.4161 |

**We emit 87 % of what the competitor emits and 61 % of our remarks carry a golden.** Volume can therefore explain at most
**13 %** of the difference and precision explains the rest — so _raising the per-file cap to six_ cannot close a gap that is
not made of volume, and **the hypothesis registered one section earlier is withdrawn before the run that would have spent
money on it.** What the 132 `findingOnPathRejected` goldens say is not _we did not speak about the file_; it is _we spoke
about the file and described a different defect_, and on this corpus that is the gap.

**Registered in its place, before any run:**

1. **H3: the arm's remarks describe the wrong defect more often than they miss the file.** The measurable form is the
   `findingOnPathRejected` bucket, at 132 of 217 missed goldens, against 42 on a file read in silence and 33 on a file
   never opened. **What would confirm it**: a run in which the bucket stays above half the misses while the volume moves,
   and the prompt work that has to follow is about which defect a comment claims rather than how many are filed. **This
   supersedes §23.7's item 4**, which proposed raising the per-file cap: the pairing above says volume can account for 13 %
   of the difference at most, so the cap is registered as a coordinate of future figures rather than as a remedy.
2. **H4: the address, not the sentence — withdrawn before it was run, because this instrument cannot see an address.**
   `judgeImpl` is handed two strings, the golden's `note` and the finding's `title :: description`, and **nothing else** —
   not the path, not the line, not the span. So _"file the same sentence against the changed line and it scores higher"_ is
   not a hypothesis this instrument can test, and **a run spent on it would have produced two identical figures and a
   story about why.** The competitor's advantage is therefore a claim about text on both sides, or it is not visible here
   at all — and that limit is written down rather than discovered later, because **the next reader's first idea will be
   the same one.**
3. **What H4 leaves, and what it would cost.** If the remaining gap is textual, the instrument that has to be questioned
   is the judge, not the reviewer: one verdict per pair over `title :: description` against a forty-character `note`
   measures _how much of the defect two sentences share_. Re-judging that properly means **re-recording the competitor's
   arm under the new judge** — 5.89 USD and a corpus — so it is a priced decision for a later iteration rather than a
   tweak to make in the same breath.
4. **Neither is quotable against the competitor** until the confirmation on `skip_pull_requests: 50` (§23.4).

### 23.9 The 132, read instead of counted — and the depth hypothesis the pairing could not see

§23.8 recorded 132 goldens in `findingOnPathRejected` and named it _we described a different defect_. That sentence was a
reading of the bucket's **name**. The artifact carries the two sentences of every row — the golden's `note`, and
`nearestFinding.text`, `proximity`, `actionable` and `why` for the finding we filed nearest to it — and **nobody had read
them.** Doing so changes the diagnosis, and the change is the reason this section exists.

**Where the finding we filed nearest to the golden actually sits** (36 pull requests, `43184902326`):

| proximity to our nearest finding on that path | rejections |
| --------------------------------------------- | ---------- |
| on the golden's own line                      | **22**     |
| 1-10 lines away                               | 39         |
| more than 10 lines away                       | **71**     |

**And how much we said about that file:**

| what the row shows                                                         | count         |
| -------------------------------------------------------------------------- | ------------- |
| rejections on a path where we filed **fewer** findings than it has goldens | **96 of 132** |
| rejections on a path where we filed exactly the cap of three               | 64            |
| drafts refused a slot by the three-per-file cap, across the run            | 32            |
| findings per commented path, mean                                          | 1.92          |
| goldens per golden-carrying path, mean                                     | 2.39          |

**So the bucket is not one thing, and its largest part is not aim.** Seventy-one rejections are more than ten lines from
anything we said **in a file we did open and did comment on**, and 96 are on files where the number of findings we filed
is smaller than the number of defects the file turned out to have — with 64 of those sitting exactly at the cap. **A file
with eight goldens and a three-finding cap is a file where five defects cannot be reported, whatever the model writes.**

**This corrects §23.8 rather than extending it.** That section compared _aggregate_ volume — 245 findings against the
competitor's 282 — and concluded that volume could explain at most a seventh of the gap. The comparison was arithmetically
right and addressed the wrong quantity: **the gap is not how many findings we emit across the corpus, it is how many we
emit per file where the file is rich in defects.** The withdrawal of H2 recorded in §23.8 is itself withdrawn, and what
replaces it is narrower and measurable.

**Registered, before the run:**

1. **H2′: the three-per-file cap is the binding constraint on 96 of 132 on-path rejections.** The comparison arm is the
   **same run at a cap of six**, scored twice: once as emitted, and once as a **rank cut** — the highest-scoring three
   findings per path, which is what a cap of three buys from the same model output. **The cut is a subset of the run rather
   than a second dispatch**, so the two arms differ in the cap and in nothing else, and the confirmation run already
   dispatched at `skip_pull_requests: 50` supplies the cap-of-three arm on unseen rows.
2. **What would falsify it**: a cap-of-six run whose top-three cut scores **within ±0.01** of the same run's full emission.
   Then the extra findings add nothing that the ranking would have kept, the cap is not the constraint, and the remaining
   gap is the 22 same-line rejections and the 71 far ones — aim, not depth.
3. **The product runs the same rule.** `review pr --agent` now exists (§23.10), takes `--max-findings-per-file` with the
   same default of three, and reports the count it used — **because a benchmark arm and a product flag that disagree about
   a cap are two different reviewers wearing one name.**

### 23.10 The arm becomes a product, and the two arms are kept one

Every figure in §23.5-§23.9 was measured on a capability reachable only from `.github/scripts/aacr-bench.mjs`. **A
capability that exists only in a harness is a measurement, not a feature**, and §7 of the iteration report said so before
this section existed. `review pr --agent` is that wiring, and it is four decisions rather than a flag:

1. **The patch travels out of the resolver.** `ChangeSet` carries `patch: string`. It used to fetch the pull request's
   diff, parse it into `GitDiff[]` - whose `ranges` hold line numbers and no text - and drop the raw patch one frame
   later, so a reviewer that must quote the change had nothing to quote. **Rendering a second diff from ranges and file
   contents was rejected**: a renderer that disagrees with git's is a review of a change that never happened.
   `splitPatchByPath` splits git's own text, keyed by the right-hand path, with chunk boundaries only at `diff --git`.
2. **The repository is the change's own text.** `MappedRepository` is built from `change.contents` - each selected file at
   the head commit - rather than `DirectoryRepository` over the working tree, so **a checkout left at the base cannot make
   the reviewer quote a line the pull request has not written yet.**
3. **The emission rule is the arm's, not the lane gate's.** §23.7's scoping is applied here first and in the product:
   every comment that reaches the report has already passed the filing check, and the report counts the drops by reason in
   the fields the lane report already uses (`evidenceRejected`, `adversarialRejected`, `iouDeduped`, `truncatedFindings`),
   so a product report and a harness artifact are comparable rather than merely similar.
4. **The reviewer, its spend and its blind spots are printed.** `report.agent` carries model calls, tool calls, characters
   read, drafts filed and the per-file account; the text format prints one line for the first four and a warning for files
   the reviewer neither reviewed nor declared. **Zero findings and one unaccounted file is not a clean pull request**, and
   before this the two were the same sentence.

**What the wiring is proved by.** `tests/e2e/the-reviewer-that-reads-runs-from-the-command.test.ts` is the user story -
a bound added below the line that makes it unreachable, invisible in the diff and visible in the file - driven through
`runPrReview` against a real git repository and a provider that answers from the round it is in. It asserts the finding's
file, line (the span the quoted code occupies, found in the file rather than taken from the model), the refusal of a
comment whose quote is absent, the four spend counts, the printed reviewer line, the unaccounted-file warning, the lanes
returning no `agent` block, and the missing-key refusal naming `DEEPSEEK_API_KEY` instead of printing a stack. **Five
cases, no network, no bill, and the same agent the harness runs.**

**What this does not change**: the lanes are still the default, every figure published before §23.5 was measured on them,
and the flag is off unless asked for. **The arm has been measured on 36 pull requests, not confirmed on unseen ones** -
§23.4's rule has not been satisfied, and until the `skip_pull_requests: 50` run lands, no product claim rests on it.

## 24. The confirmation run landed, and it landed on a checker that was reading the wrong arm

**The run §23.4 asked for, and what it cost.** `43201127022`: 100 pull requests at `skip_pull_requests: 50` - a corpus
disjoint from the discovery by construction - `agent: on`, `advisory` profile, cap 3. It started at 10:31Z and its
measurement step finished around 14:37Z, **four hours and five minutes for one hundred pull requests**, about **2.4 USD**
at the arm's measured 0.024 per pull request. `timeout-minutes: 340` was not reached, and the throughput is now a known
quantity rather than a surprise.

**The measurement is valid and the job failed on its own arithmetic.** 100 pull requests, 724 goldens, 786 filings,
147 true positives, 639 false positives, 577 false negatives - **P 0.187, R 0.203, F1 0.1947** on the reading arm's own
filing rule. The step `Prove the artifact replays to its own figure` exited non-zero:

```
AACR-PAIRED-REPLAY the artifact's published figures are not derivable from its rows:
  [{"field":"precision","published":0.187,"replayed":0.2752,"arm":"gate"},
   {"field":"recall","published":0.203,"replayed":0.0414,"arm":"gate"},
   {"field":"f1","published":0.1947,"replayed":0.072,"arm":"gate"}]
```

**Both numbers in that message were already in the artifact.** `emissionRules.shipped` is 0.1947 and
`emissionRules.laneGate` is 0.072, side by side, because §23.7 introduced the reading arm's filing rule and the lane gate
as two distinct things. `compareReplayToArtifact` derived the arm as `emissionProfile === 'defect' ? 'profile' : 'gate'`
and **never looked at `configuration.agent`**, so for the first hundred-pull-request run of the reading reviewer it held
the lane gate while the published figure was the reading arm's. **An artifact that records two arms and a checker that
reads a third is the defect, not the figure.**

**The repair, and how it was verified.** The arm is recorded (`scoring.publishedArm`) and read; the derivation survives
only for artifacts written before the field, where `configuration.agent` is present and was the missing input. A fourth
arm, `everything-filtered`, is what the reading reviewer publishes under a category profile: its filing rule keeps what
it can locate and the profile floor is removed on top, **with no actionability requirement** - that is the entire
difference from `profile`. Verified against the artifact that failed rather than against a fixture:

|                                  | before                                        | after                                                             |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `--check` on the failed artifact | exit 1, three mismatches named against `gate` | **exit 0**, "reproduces the published everything figures exactly" |
| arm used                         | `gate` (derived)                              | `everything` (read)                                               |

The fixture tests cover the four artifact shapes plus one changed published number that must still fail, because **a
checker that always agrees is worse than no checker**.

**What the run still cannot say, and the design error that caused it.** `excluded by them 100 · scored by them only 47`:
**the competitor arm was empty.** `AACR_COMPETITOR` defaults to `replay`, which replays competitor reviews that were
already paid for - and the confirmation corpus is by construction the fifty-to-one-hundred-fifty slice the competitor has
never seen. So this run measured our reviewer on unseen pull requests and **could not pair it with anything**, and the
paired subset is zero pull requests.

**That is an experiment-design error, not a defect** - the harness did exactly what it was configured to do, and the
configuration could not produce the comparison the run was dispatched for. The repair is a two-dispatch sequence rather
than a code change: `competitor: record` on this slice first, so the competitor reviews the same hundred pull requests,
and then `agent: on` with the default `replay` reads them back. **Registered here before it is run**, with the cost
estimate in the same paragraph because an experiment that does not name its price is a wish:

| dispatch                                           | what it buys                                 | estimated cost |
| -------------------------------------------------- | -------------------------------------------- | -------------- |
| `competitor: record`, `agent: off`, 100 at skip 50 | the competitor's reviews on the unseen slice | ~2-3 USD       |
| `agent: on`, `competitor: replay`, same slice      | our figure on the same rows, paired          | ~2.4 USD       |

**Until the first of those lands, no product claim rests on §24.** The 0.1947 above is a real measurement of the reading
arm on unseen pull requests and it is **not** a comparison with anybody.

## 25. The question-answering figure was three runs stacked into one table, and the pool decides where it ranks

**What was on disk.** `benchmarks/cosqa-retrieval.json` carried `lexical` MRR 0.264 and `fused` 0.570 from one retriever
beside `reranked` 0.7705 from a later one, dated 2026-10-27. **The gain the file attributed to fusion and to reranking was
a gain between two versions of the product**, not between two stages of one - which is exactly the reading a stacked table
invites and the reason a provenance block exists. `code-qa-benchmark` had been measuring the whole chain since, and its
artifact was never written back.

**The run that was.** `43014071651`, 2026-11-11, 500 questions of `cosqa-retrieval-test-500.json` at SHA-256
`27d3552b2e7dd86cf9f9a0b3c135e6777d4faafa9c29fb1b9b01ece945974ad6`, one run's three stages:

| stage                             |       R@1 |       R@5 |      R@10 |     MRR@10 | found@10 |
| --------------------------------- | --------: | --------: | --------: | ---------: | -------: |
| lexical (BM25)                    |     0.356 |     0.578 |     0.664 |     0.4549 |      332 |
| fused (BM25 + vectors, w=1)       |     0.534 |     0.776 |     0.860 |     0.6354 |      430 |
| **reranked (listwise, DeepSeek)** | **0.678** | **0.894** | **0.936** | **0.7734** |  **468** |

**Legalization**: the file is now that artifact, and its comment names the run - a copy of an artifact that does not say
which run it came from is a number with no author.

**Now the ranking, and it took one dispatch to get it.** The literature's CoSQA column, from the NACS paper's Table 1
(_Deep Code Search with Naming-Agnostic Contrastive Multi-View Learning_, arXiv 2408.09345), with the CoSQA column of
Huang et al.'s own Table 5 (arXiv 2105.13239) where it reports one. **This product is measured twice: once on the 500
candidates the corpus file carries, and once on the collection's whole 6 267 unique functions** (`pool=all`, run
`43247478528`, 5 795 distractors, distractor file at SHA-256 `4d1a227f…`).

|  rank | system                         |  CoSQA MRR |       pool | trained on CoSQA? |
| ----: | ------------------------------ | ---------: | ---------: | ----------------- |
|     1 | NACS (reported SOTA)           |  **0.708** | collection | **yes**           |
|     2 | CodeBERT                       |      0.652 | collection | **yes**           |
|     3 | GraphCodeBERT                  |      0.648 | collection | **yes**           |
|     4 | CoCLR (CodeBERT + contrastive) |      0.647 | collection | **yes**           |
| **5** | **this engine, reranked**      | **0.5743** |  **6 295** | **no**            |
|     6 | DeepCS                         |      0.472 | collection | no                |
|     7 | DGMS                           |      0.471 | collection | no                |
|     8 | CSRS                           |      0.373 | collection | no                |
|     9 | OCoR                           |      0.352 | collection | no                |
|     - | _this engine, reranked_        |   _0.7734_ |      _500_ | _no_              |

**The 0.7734 in the last row is why the row above it exists.** On the 500 candidates of the test split the same review
scores 0.7734 and would appear to lead the table; on the collection the published tables use it scores **0.5743**. **The
0.199 difference is the pool, not the retriever** - the answers did not move between the two runs, the distractors only
arrived - and it is the size of the error a small pool hides.

**So the honest distance is 0.134 MRR@10 behind the reported state of the art, and this product is fifth of nine.** Every
system above it is fine-tuned on CoSQA and this one is not, which is a real qualification and **not a substitute for the
number**: a reader who wants the lead needs the lead to be measured on the same pool, and it is not.

**Where the 0.134 comes from, in the order the artifact supports.** `found@10` is **398 of 500** at the collection pool
against **468 of 500** at 500 candidates: **the recall ceiling is the largest single term**, and it is a retrieval
problem that no reranker can move. The stage table shows where it is built and where it is lost:

| stage                         |   R@1 |   R@5 |  R@10 |     MRR@10 | found@10 |
| ----------------------------- | ----: | ----: | ----: | ---------: | -------: |
| lexical (BM25)                | 0.160 | 0.346 | 0.412 |     0.2367 |      206 |
| fused (BM25 + vectors, w=1)   | 0.276 | 0.516 | 0.650 |      0.387 |      325 |
| reranked (listwise, DeepSeek) | 0.470 | 0.714 | 0.796 | **0.5743** |      398 |

**Lexical retrieval finds the answer in the top ten for 41 % of questions at this pool**, so 59 % of the work is being
done by embeddings and the reranker - and the reranker is reordering 496 of 500 lists to gain +0.187 MRR over fusion.
The three levers, in order: (a) **the 102 questions whose answer is not in the top ten at all** - a recall problem that
needs a better first stage, not a better order; (b) **the +0.187 the reranker buys costs 496 completions**, so a cheaper
gate on which lists to reorder is the cost lever, and `reordered` is already in the artifact as its denominator;
(c) **a CoSQA-trained encoder** is what every system above this one uses and what this project has deliberately not done -
which is a decision with a price, and the price is now written down in MRR.

**What this section does not do**: it does not put a retrieval figure beside a review figure. AACR measures a different
task on a different corpus with a different judge, and §24's paired comparison is the only place this repository compares
itself with a competitor on the same rows.

## 26. The published reviewer was not the measured reviewer, and one key was the difference

**Found while looking for something else.** The agent's settings were written twice - four literals in
`.github/scripts/aacr-bench.mjs` and four in `packages/cli/src/commands/pr-review.ts` - and the copies had diverged:

| key                  | measured arm (harness)                       | shipped arm (`review pr --agent`) |
| -------------------- | -------------------------------------------- | --------------------------------- |
| `allowOffDiff`       | **false**                                    | **true**                          |
| `filter`             | true                                         | true                              |
| `groupSize`          | 4                                            | 4                                 |
| `maxFindingsPerFile` | 3 (`AACR_MAX_FINDINGS_PER_FILE`)             | 3                                 |
| `limits`             | `DEFAULT_AGENT_LIMITS`, written out longhand | the default                       |

**Every AACR figure of the reading arm therefore described a configuration that no product path offered.** The harness
refused findings on untouched files so that a comment could be posted on the same terms a competitor posts one; the
command shipped them, on the reasoning that a change can break an untouched caller and refusing to say so is a recall the
product should not give away. Both reasonings are defensible; **holding both while recording neither is not.**

**The repair names the arms instead of picking a winner.** `BASELINE_AGENT_OPTIONS` (measured) and
`SHIPPED_AGENT_OPTIONS` (published) are declared in `review-agent.ts`, with `AGENT_ARM_DIVERGENCE` **derived from the
pair** rather than restated, and the artifact records `configuration.agentOptions.{baseline,shipped,divergence,limits}`.
A second divergence is not forbidden - it is required to be declared, because the person who adds one is the person who
decides whether the published figure still describes the shipped reviewer.

**Two smaller versions of the same defect, fixed in the same change.** `ReviewAgent` defaulted `maxFindingsPerFile` to
**4** while the command and the benchmark both used **3**, so the documented default was the one nothing ran - and the
three-per-file cap is the arm §23.9 measured as binding on 64 of 132 on-path rejections. The class now reads its defaults
from the shipped arm. And the harness's five `limits` numbers were a second copy of `DEFAULT_AGENT_LIMITS`; they are that
constant now, with the effective values recorded in the artifact, so a default that moves is **visible in the figure**
rather than inferred from a date.

**Asserted as values and as behaviour**, because a constant the engine ignores is the same defect one level down: one
provider, one repository, one finding on an untouched file survives when nothing overrides the default and is refused
under `BASELINE_AGENT_OPTIONS`. The two source-level assertions read assignment lines rather than prose, so the comments
that explain the pair are not punished by the test that guards it.

## 27. Two of the seven score terms are invisible to the reading reviewer

**Found by reading a hundred pull requests' worth of real findings, not by looking for it.** Every one of the 786 findings
the reading arm filed carried `agreement: 1` and no lane. The score adds `agreement × 0.1 × min(n,3)/3` and
`lane × LANE_WEIGHT[lane] ?? 0.5`, so those findings collected **0.0333** and **0.03** where the five lanes can collect
up to **0.1** and **0.06** - **not because the comments were worse but because two of the seven terms describe a reviewer
the reading arm is not.**

**Measured on the artifacts**: median score **0.509** for the reading arm against **0.707** for the lanes. The two terms
account for **0.0967** of that before anything about either comment is considered.

**The obvious repair was tried and the existing suite refused it.** Re-normalising the score so the denominator excludes
an unobservable term makes a finding with _more_ corroboration score _lower_ - `agreement: 2` came out at **0.7901**
against **0.8048** for no agreement at all, and `raises the score with agreement and saturates at three lanes` failed on
the first run. **That case is right and the repair was wrong**: a scale whose readings are not monotone is a worse answer
than a ruler with one fewer mark, and the score is therefore unchanged - as is every figure measured with it.

**What is new is `scoreTerms`**, in the score object and in the artifact's `rankedFindings`, saying which of the two
conditional terms the reviewer could observe. **The consequence is registered rather than papered over**: a score
threshold calibrated on the five lanes is **not** an operating point on the reading arm - which is the second reason
§23.7 scoped the gate to the lanes, and the first one that can be checked from a single artifact.

**What this changes about the next iteration.** The lever this rules out is the tempting one: **dropping the low-score
tail of the reading arm is not a precision filter, it is a filter calibrated on a different scale.** On the
hundred-pull-request artifact the categories and features say the same thing from another direction - `test` findings are
139 of 786 at precision **0.101**, `bug` is 438 at **0.283**, and every one of `grounded`, `quotesDiff`, `namesSymbol`
and `severity` sits within 0.06 of the base rate, because the reading arm's filing rule already removed what those terms
were built to detect. **The remaining gap is not a threshold.**

## 28. The recall ceiling was not a depth, and the fused list was the thing losing answers

**The registered next step was "first-stage recall for the 102 questions whose answer is not in the top ten"** (§25).
The hypothesis was concrete - each channel contributed fifty results before fusion, fifty was a constant rather than a
measurement, and a candidate a channel never returned cannot be reordered into the answer - so the test grew a depth
switch and a curve, and the run was dispatched at `pool=all`, `depth=50`, `sweep=50,100,200`.

**The run (`43261826373`, 2026-11-12, 6 295 functions, `space=api/api`) said no.**

| fused depth |   R@1 |   R@5 |      R@10 | MRR@10 | found@10 |
| ----------: | ----: | ----: | --------: | -----: | -------: |
|      **50** | 0.282 | 0.530 | **0.658** | 0.3938 |  **329** |
|         100 | 0.286 | 0.528 |     0.636 | 0.3913 |      318 |
|         200 | 0.286 | 0.540 |     0.636 | 0.3950 |      318 |

**Widening the pool does not recover the missing questions; it loses eleven of them.** This is not a defect in the
measurement: reciprocal rank fusion is not monotone in channel depth, because a candidate at lexical rank 51 adds
`1/111` to a list whose tenth entry may carry `1/71`. The curve is why the suite refuses to assert monotonicity - a
bound that demanded it would have failed here, on a correct run.

**What the same artifact does say is where the answers go.** These counts were new in this run and no earlier figure in
this repository could produce them:

| channel                                 | questions with the answer in the top ten |
| --------------------------------------- | ---------------------------------------: |
| lexical (BM25)                          |                                  **206** |
| vector (embedding-3)                    |                                  **354** |
| either                                  |                                  **378** |
| **fused at weight 1, then reranked**    |                                  **398** |
| **fused at weight 1, before reranking** |                                  **329** |

**Fifty questions that one channel answered were lost by combining it with the other.** Only **four** of five hundred
have their answer outside both channels' top two hundred, so "a better first stage" is not the largest term any more -
**the fusion is**. Reciprocal rank fusion at equal weight is a compromise, a compromise with a worse list is a worse
list, and the 1:1 weight was never measured on this corpus (it was measured on the docstring corpus, which is a lookup
task).

**So the suspect is now a number the product already reads.** `fuseResults` takes `vectorWeight`, the constant is
documented as "the measurement's job to set", and the test now scores the same two lists at each weight in
`COSQA_VECTOR_WEIGHTS` for the price of arithmetic - no embedding recomputed, no model called. `fusedByVectorWeight`
carries the columns, and the arm that is **reranked stays at weight one**, because reporting a figure for an arm the
reranker did not see is §26's defect with a different key.

**The reranker's ledger, which this run also introduced.** Of 500 lists, **495 were reordered**, **82 questions were
rescued** into the top ten and **13 were lost** from it - a net **+69**, against R@10 0.658 → 0.796. **A reranker whose
net is zero can still be spending completions to shuffle**, and the pair of counters is now in the artifact so a future
run can tell that from a reranker that helps.

**Two levers were measured, chased, and reverted in the same iteration.** Both looked like wins on CoSQA alone:

| candidate                               | CoSQA (500 q, BM25 only)   | paraphrase corpus                      |
| --------------------------------------- | -------------------------- | -------------------------------------- |
| shipped (`vocabulary` 0.25)             | R@10 **0.6640**, found 332 | recall@20 **0.4646**, leak-free 0.1489 |
| `vocabulary` 0.5                        | R@10 **0.7100**, found 355 | recall@20 **0.3636** ✗                 |
| 0.75                                    | R@10 0.7040                | —                                      |
| 1.0                                     | R@10 0.7020                | —                                      |
| query stopword filter (shipped weights) | R@10 0.6860, found 343     | recall@20 **0.4242** ✗                 |

**MRR is deliberately not restated in this table.** The lexical column's MRR at the shipped weighting is already
published in §25 and in `benchmarks/cosqa-retrieval.json` (`lexical.mrrAt10`), and `numbers-gate` refused this section's
first draft for writing it a second time here: the value is within 0.0005 of a _withdrawn_ paraphrase figure, and the
gate compares numbers rather than sources. **That collision is a gate limitation and it is recorded rather than worked
around** — the honest repair is not to restate a number that already has a home.

**A four-and-a-half point gain on the external corpus and a ten-point loss on the internal one, from the same edit.**
The mechanism is not mysterious: CoSQA's questions are paraphrases of documentation the index strips, so the body field
is the only place their words can land; the paraphrase corpus's questions are drawn from doc comments whose words the
body repeats, so weighting the body lets a long function that merely contains the words out-sum the function described
by them. **Neither corpus can adjudicate the other**, and the shipped row is the only row in this table with no losing
column. Both candidates are written down where the constants live, so the next reader does not spend an iteration
rediscovering them.

**And one methodological number that matters for every future comparison.** The same arm, re-run, scored **0.5670**
against the previous run's **0.5743** MRR@10 (R@10 identical at 0.796). The difference is in the reranker, not in the
retriever: the fused column moved 0.387 → 0.3938 and the reorder is a model's judgement at `temperature: 0`. **A delta
smaller than about 0.01 MRR on this corpus is inside run-to-run variance and cannot be attributed to a change** - which
is the reason the weight sweep is a single run over one set of embeddings rather than two dispatched runs.

**Cost of this iteration's measurement**: one `pool=all` dispatch at ~0.3 USD of completions plus ~6 000 embeddings
(≈0.05 USD); the local probe that reproduced the lexical column to four decimals ran on a workstation for free, and is
why two candidate weightings were rejected before either cost a workflow.

## 29. The fusion weight moves the figure, and one constant cannot serve both kinds of question

**The weight sweep the last section registered (`43270005537`, 2026-11-12, same pool, same 500 questions, `space=api/api`)
scored the same two channel lists at four weights. Nothing was re-embedded and no model was called for the sweep.**

| `vectorWeight` |   R@1 |   R@5 |      R@10 |     MRR@10 | found@10 |
| -------------: | ----: | ----: | --------: | ---------: | -------: |
|          **1** | 0.270 | 0.514 |     0.644 |     0.3807 |  **322** |
|              2 | 0.302 | 0.562 |     0.688 |     0.4136 |      344 |
|              3 | 0.302 | 0.584 |     0.688 |     0.4213 |      344 |
|              4 | 0.308 | 0.602 | **0.694** | **0.4310** |  **347** |

**Inside one run, the weight is worth twenty-five questions and five points of R@10** - and it is monotone up to four,
which is the first lever in this document whose direction is unambiguous. The fused column at weight one in this run
(322 found) and in the previous one (329) also differ by seven questions, **with identical inputs**: that is the
run-to-run variance §28 recorded, and it is why the comparison above is made inside a single run rather than across two.

**So why is the constant still one?** Because the same sweep has been run on another corpus, and it points the other
way. `docstring-search.test.ts` scores a symbol by its own doc comment and reports the fused column at each weight:

| `vectorWeight` | docstring corpus, MRR@20 (**`deterministic` space**) |
| -------------: | ---------------------------------------------------: |
|            1.0 |                                               0.9119 |
|            0.5 |                                               0.9194 |
|           0.25 |                                               0.9263 |
|            0.1 |                                           **0.9636** |

**Those four numbers are a fallback-space run and §30.1 supersedes them.** `docstring-search.test.ts` exists partly to
stop exactly this: a query embedded by the API compared against an index embedded by the deterministic fallback is a
cosine between two spaces, and the file's own header records a run where that cost 36 points. The column above was taken
on that fallback, the committed artifact beside it (`space: api/api`) says the sweep spans **0.0007 MRR**, and the wider
number should not be quoted.

**A lookup question wants the lexical list to dominate; a paraphrase question wants the semantic one to.** The two
directions are five points apart on CoSQA and five points apart on the docstring corpus, and **a single constant can
only be wrong for one of them** - which is exactly what `DEFAULT_VECTOR_WEIGHT = 1` is.

**What this rules out and what it registers.** It rules out "turn the weight up" as a global change: it would be a
measured improvement on this corpus and a measured regression on another, and §28 already has one of those. It registers
the shape of the repair - **the weight is a property of the query, not of the engine** - and the observable that
separates the two kinds of question is already computed in `tokenize`: a lookup question is a symbol, a paraphrase
question is a sentence. **The next iteration measures a query-classified weight** against both corpora before any default
moves, and the two columns above are the acceptance bar it has to clear.

**The artifact in this repository is now the run of this section** (`43270005537`), so `benchmarks/cosqa-retrieval.json`
carries `fusedByVectorWeight`, `retrieval` and `rerankEffect`. §25's table describes the earlier run of the same arm;
the two differ by 0.0085 MRR@10 with identical configuration, which is the variance and not a change.

## 30. The weight became a property of the question, and it was measured before it was shipped

**§29 left one instruction**: the fusion weight is a property of the query rather than of the engine, the observable
that separates a symbol from a sentence is already computed in `tokenize`, and **the next iteration measures a
query-classified weight against both corpora before any default moves**. This section is that measurement, the change it
justified, and the two results it did not predict.

### 30.1 The premise was weaker than §29 stated, and one of its columns does not reproduce

§29 put the doc-comment sweep at **MRR 0.9119 at weight 1 against 0.9636 at 0.1** and drew "five points" from it. **Those
four numbers are a `deterministic`-space run** - the local fallback on both sides - while the artifact beside them is
`api/api`, and a cosine between two spaces is the defect that file was written to stop. The same sweep, re-run this
iteration on the api backend (`43334112493`, `space=api/api`, 219 queries), measures:

| `vectorWeight` | doc-comment corpus MRR@20 |
| -------------: | ------------------------: |
|              1 |                    0.9711 |
|            0.5 |                    0.9711 |
|           0.25 |                    0.9711 |
|            0.1 |                    0.9718 |

**The direction survives and the magnitude does not.** The fallback run is **superseded** rather than deleted, because
the mistake it records is the one this document keeps paying for: **a figure whose vector space is not the figure's own**
looks exactly like a measured one. On the api backend the constant costs **0.0007 MRR**, not five points. **The CoSQA column
is the one that carries the argument**, and it is five points wide (§29, re-read in 30.3). A section that quoted both
directions as equal-sized levers overstated one of them, and the honest repair is to say so where the table is rather
than to quietly reprint a nicer one.

### 30.2 The observable, chosen against three alternatives and measured before anything changed

The question "should a semantic rank count more than a lexical one here" is not answered by the _shape_ of the query:
both corpora ask in prose. It is answered by **whether the lexical channel's best answer carries the question's own
words** - a doc comment that _is_ the query scores one because the document is the question, a paraphrase scores a
quarter because the index has to be talked into it.

Four candidate statistics were computed on both corpora from the lexical list alone - **local, no key, no model, no
dispatch** - and scored by the best single threshold each admits:

| statistic                                                                 |  best cut |  accuracy |
| ------------------------------------------------------------------------- | --------: | --------: |
| `p10` - top score over the tenth score                                    |     3.277 |     78.9% |
| `pMean` - top score over the list's mean                                  |    10.561 |     91.9% |
| `n` - how many results the list holds                                     |       740 |     91.0% |
| **`selfEvidence` - share of the question's terms the top answer carries** | **0.839** | **98.6%** |

**The first three are about the corpus rather than about the question**: a long list is a large index, and a high
top-score ratio is a short document. `selfEvidence` is the only one that reads _the answer_ - name, qualified name,
signature and doc comment, deliberately excluding the body, because a body that contains the words is not a document
that answers the question in its own words.

The distributions it separates, per corpus:

| corpus                    |   p10 |       p25 |       p50 |   p75 |       p90 |  max |
| ------------------------- | ----: | --------: | --------: | ----: | --------: | ---: |
| CoSQA, 500 questions      |  0.00 |     0.125 | **0.250** | 0.333 | **0.500** | 0.75 |
| doc comments, 219 queries | 0.085 | **1.000** | **1.000** | 1.000 |     1.000 | 1.00 |

**The cuts are 0.8 and 0.5, not 0.839.** 0.8 sits below the optimum on purpose - a question is only called answerable
in its own words when it nearly is - and 0.5 is the CoSQA ninetieth percentile, the point above which a paraphrase
stops being typical. **The weights at the two ends are the sweeps' own optima** (0.1 and 4), so every value the product
can choose is a value some run has a figure for; the middle stays 1, which is what the engine shipped.

### 30.3 What the three corpora measured, in runs whose two arms share their inputs

`deriveVectorWeight` returns one of three weights per question, and each corpus now scores that arm **beside the
constant it replaces, fused from the same two lists inside the same run** - so the difference between the columns is the
classifier and nothing else: no second embedding call, no second completion, none of the run-to-run variance §28
recorded.

**Doc comments (`43334112493`, 219 queries, `space=api/api`)**: `214` questions took the lexical weight, `2` the neutral
one, `3` the semantic one.

| arm                          |   recall@5 | recall@20 |     MRR@20 |
| ---------------------------- | ---------: | --------: | ---------: |
| lexical alone                |     0.9954 |     1.000 |     0.9781 |
| fused, weight 1 (shipped)    |     0.9863 |     1.000 |     0.9711 |
| **fused, derived per query** | **0.9954** | **1.000** | **0.9794** |

**The derived arm beats the constant and the lexical list it was fused with**: 214 questions were told to trust the
lexical ranking, three were not, and the result orders 0.0083 MRR better than the constant on a corpus where the whole
sweep spans 0.0007.

**Paraphrase, documentation stripped (`43334112493`, 99 questions, `space=api/api`)**: `99` questions took the semantic
weight, `0` the others.

| arm                                         |   recall@5 |  recall@20 |     MRR@20 |
| ------------------------------------------- | ---------: | ---------: | ---------: |
| lexical alone                               |     0.3030 |     0.4545 |     0.1960 |
| fused, weight 1 (shipped)                   |     0.4242 | **0.6061** |     0.3531 |
| fused, weight 4 (the sweep's best on CoSQA) |     0.4242 |     0.6061 |     0.3531 |
| **fused, derived per query**                | **0.4444** |     0.5960 | **0.3562** |

**This one is a wash and is recorded as one**: derived finds one question fewer at twenty and two more at five, and
orders 0.0031 MRR better. On a 99-question set that is 1 question and is inside the noise §28 measured. **The
classifier is not a win here; it is not a loss either**, and the corpus where it must not lose is the one it was built
for.

### 30.4 CoSQA: the classifier is worth 23 questions, and it was measured against the constant in one run

`43334117158`, 2026-11-13, the 6 295-function pool, `space=api/api`, 500 questions, five weights scored over one set of
embeddings:

|           `vectorWeight` |       R@1 |      R@10 |     MRR@10 | found@10 |
| -----------------------: | --------: | --------: | ---------: | -------: |
|                      0.1 |     0.206 |     0.440 |     0.2835 |      220 |
| **1** (was the constant) |     0.278 |     0.656 |     0.3881 |  **328** |
|                        2 |     0.308 |     0.692 |     0.4209 |      346 |
|                        3 |     0.302 |     0.696 |     0.4257 |      348 |
|                        4 |     0.306 |     0.702 |     0.4332 |      351 |
|    **derived per query** | **0.306** | **0.702** | **0.4339** |  **351** |

**A second run of the same arms (`43340541442`, the one that reranked them) measured 318 for the constant, 351 for weight
four and 352 for the derived arm, at MRR 0.3772 / 0.4302 / 0.4312.** Two runs, identical configuration, up to ten
questions apart: the embedding endpoint is not a function, and that is why every comparison in this section is made
inside one run - and why §30.5 states its variance band before its result.

**The classifier reaches the top of the grid and slightly passes it**: `0.4339` against `0.4332`, because 33 questions
kept the neutral weight instead of being pushed to four. The split the artifact records is `0` lexical, `33` neutral,
`467` semantic - and the evidence percentiles (`p10 0.1667`, `p50 0.300`, `p90 0.500`) are the CoSQA column of 30.2,
measured again inside the run that used them.

**Against the constant the product shipped: 328 → 351 questions found in the top ten, R@10 0.656 → 0.702, MRR
0.3881 → 0.4339.** Nothing was re-embedded, no model was called for the sweep, and the two arms fuse the same lists
inside one run - **the difference is the classifier and nothing else.**

**And it is not free of cost to the other column**: weight 4 is what the grid's top does, so a corpus that prefers the
lexical list would be told to trust the semantic one if its evidence were low. §30.3 is where that is checked, and the
lookup corpus's own derived column is the answer: 0.9794, above the constant it replaced.

### 30.5 The gain before the reranker does not survive the reranker, and that is the finding

The fused column is not the number a user of `askCodebase` sees: with a provider present the pool is reranked, and
comparing a new arm's rerank figure against an earlier run's would attribute a difference smaller than the model's own
variance to the change (§28). So `43340541442` reranked **both** arms in one run, same questions, same model, same
fifty-candidate pool:

| arm                      | found@10 before rerank | found@10 after | R@10 after | MRR@10 after | rescued | lost |
| ------------------------ | ---------------------: | -------------: | ---------: | -----------: | ------: | ---: |
| constant (weight 1)      |                    318 |        **395** |  **0.790** |   **0.5732** |      91 |   14 |
| **derived per question** |                **352** |            385 |      0.770 |       0.5678 |      55 |   22 |

**The 34-question fusion gain becomes a 10-question deficit once the model reorders the pool.** Two readings are
available and only one of them is honest:

- **"the reranker prefers the weaker list"** - it rescues 91 questions from the constant's pool and 55 from the derived
  one, and loses 14 against 22. A better-ordered input leaves less to rescue, and the same amount of damage.
- **"the difference is inside the model's own variance"** - §28 measured 0.0085 MRR between two runs of an identical
  arm; the gap here is **0.0054**, measured in one run so the _sample_ is paired but the model's reproducibility is not.

**Both are true and the second bounds the first.** What can be said with the arithmetic this document has is:

1. **Before the reranker the derived weight is worth +0.054 MRR and +34 questions, six times the variance band.** That is
   a measured improvement, and it is what a retrieval-only surface (the MCP search tool, the editor's find-symbol path)
   actually uses.
2. **After the reranker the two arms are within one variance band of each other**, with the constant nominally ahead.
   **No claim of improvement survives reranking, and the regression is not large enough to call a regression** - calling
   it one would be treating a 0.0054 difference as real while the same arm moves 0.0085 on a re-run.
3. **The reranker's marginal value collapses as its input improves**: net +77 from the constant's pool, net +33 from the
   derived one. **A reranker is compensating for a weak fusion**, which is the first measurement in this document that
   explains why the systems above us invest in encoders rather than in rerankers.

**So the default stays the derived weight**, on the strength of (1) and the absence of a measurable cost in (2), and the
open question is written down rather than waved away: **does the post-rerank gap reproduce across seeds, and does a
deeper pool change it?** That is the next iteration's first measurement, and it costs one dispatch with `depth=100`.

**Where this leaves the ranking.** The best post-rerank MRR on this corpus is **0.5732** (constant arm, this run) and
**0.5678** (derived arm), against **0.708** for NACS (§25) - a gap of about 0.13 that has now been attributed rather
than observed:

1. **the encoder** - the four systems above us fine-tune on CoSQA and we call a general endpoint; this is the only term
   left that no arithmetic in this document can move;
2. **the reranker's ceiling** - 149 of 500 answers are outside the pool it is given, so no reorder reaches them;
3. **the lexical channel's 206** - BM25 sees the answer in its top ten for two questions in five.

### 30.6 Three limits of the classifier, recorded before they are found the hard way

**A share of a small set of terms is a coarse number.** A one-word query can only score 0 or 1, so `selfEvidence` sends
it to one bound or the other with no middle - and the middle is where a weak match belongs. The three corpora do not
expose this (their questions are sentences; the median question holds six to ten terms), which is exactly why it is
written down rather than measured: **a product query of `auth` will take the lexical weight whenever the best hit's name
or comment contains `auth`, and that hit may well be the wrong one.**

**The evidence is about the best answer, not about the right one.** A corpus whose documentation paraphrases its
questions would look much like one that repeats them: both put most of the question's terms in _some_ document's comment.
The statistic therefore separates this document's two corpora, and what it claims in general is narrower - **it measures
whether the lexical channel has an answer it can state in the question's own words**, not whether that answer is
correct.

**A threshold calibrated on two corpora is a threshold calibrated on two corpora.** 0.8 and 0.5 were chosen from a
distribution over 719 questions in this repository; the separation is 98.6 % there and unmeasured anywhere else. The
gates in the three suites are what keep that honest: a corpus where the classifier fires the wrong way fails a test
rather than a report, and the two columns in 30.3 are what a reader compares before moving either cut.

## 31. The classifier's advantage is real at fusion and gone after the reranker, and both statements now carry a p-value

**§30.5 ended with a sentence that was not a result**: the post-rerank difference of 0.0054 was "inside the band", where
the band was a run-to-run wobble of 0.0085 measured by re-running one arm. A band is not a test. This section replaces
it with two tests that are, publishes the columns they read, and answers §30.5's registered question — _does a deeper
pool change the post-rerank gap_ — with a measurement rather than a second run.

Everything below is one job (`43352844317`), `pool=all` (6 295 functions, 500 questions), `space=api/api`,
`sweep=50,100`, `rerankDepths=50,100`, both arms reranked at both depths **on the same questions in the same run**.

### 31.1 Four instruments had to be built before any of it could be believed

| what was wrong                                                                | what replaced it                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "the difference is inside the band" (a wobble, not a test)                    | `search/paired-stats.ts`: exact McNemar on the per-question hits, seeded paired bootstrap on the per-question reciprocals. **Resolution is now explicit**: six one-sided discordant questions is p = 0.03125, five is a coin.       |
| an aggregate nobody could recompute                                           | `perQuestion` columns in the artifact — four rank lists, the derived weights and the evidences, encoded as comma strings and decoded by `decodeRanks`. **The gate asserts each column reproduces the aggregate printed beside it.** |
| every cost figure was `average × 500`                                         | `RerankResult.cost` carries the vendor's own tokens and the price table's arithmetic; `rerankCost[depth][arm]` is the sum of the calls. An unpriced model stays **unpriced**, not free.                                             |
| `RETRIEVAL_DEPTH` covered the sweep and the arm but **not the rerank depths** | `retrievalDepth()` takes the maximum of all three. The defect it removes is silent: a hundred-deep rerank slicing a fifty-deep list reports the wider pool as worth nothing.                                                        |

### 31.2 At fusion the classifier is worth 0.051 MRR, and that is now a verdict

| arm                      |   R@1 |  R@10 |     MRR@10 | found@10 |
| ------------------------ | ----: | ----: | ---------: | -------: |
| lexical only             | 0.160 | 0.412 |     0.2367 |      206 |
| fused, constant weight 1 | 0.278 | 0.644 |     0.3872 |      322 |
| fused, derived weight    | 0.316 | 0.698 | **0.4382** |  **349** |

Paired on the same 500 questions: **MRR +0.0510, 95 % interval [0.0324, 0.0677]**, found@10 **39 rescued against 12
lost**, exact McNemar **p = 0.000198**. The interval excludes zero, and its lower bound is 63 % of the estimate it brackets; the discordant counts are 3:1 in
the classifier's favour and the exact test puts p at two in ten thousand. **This is the first result in this document that a reviewer cannot attribute to the
instrument**, and it is the measurement §29 asked for.

The split on this corpus is `0 / 33 / 467`: **the lexical bound never fires**, because no CoSQA question has 80 % of its
terms in the best hit's own name, signature or doc comment (`selfEvidence` p90 is 0.50). On this corpus the classifier is
therefore a two-way switch between _neutral_ and _semantic_, and the confident branch that §30 designed is exercised only
by the doc-comment corpus. Recorded here because a branch a corpus never reaches is a branch a corpus never tests.

### 31.3 After the reranker reads the candidates the two arms are identical, and "inside the band" was too weak a way to say it

| arm                       |   R@1 |  R@10 | MRR@10 | found@10 | reordered | rescued | lost |
| ------------------------- | ----: | ----: | -----: | -------: | --------: | ------: | ---: |
| reranked, constant weight | 0.468 | 0.776 | 0.5699 |      388 |       495 |      82 |   16 |
| reranked, derived weight  | 0.468 | 0.776 | 0.5665 |      388 |       497 |      63 |   24 |

Paired: **MRR −0.0034, 95 % interval [−0.0254, 0.0172]**, found@10 **26 against 26**, exact McNemar **p = 1**. The
interval is twelve times wider than the effect it brackets, and the discordant counts are not merely "not significant" —
they are **exactly balanced**, which is what a difference of zero looks like when the same model answers the same
questions twice with two different inputs.

**Where the classifier's advantage went**, counted one question at a time rather than inferred:

| of the 39 the classifier rescued at fusion | count |
| ------------------------------------------ | ----: |
| the reranker keeps it in **both** arms     |    30 |
| only the derived arm keeps it              |     3 |
| only the constant arm keeps it             |     2 |
| neither arm keeps it                       |     4 |

| of the 12 the classifier dropped at fusion | count |
| ------------------------------------------ | ----: |
| both arms still find it                    |     7 |

So **33 of the 39 survive, and the 12 losses are mostly repaired**: the net becomes 26 : 26. The mechanism is not noise.
The classifier's job is to guess **which channel to trust before reading the candidates**; the reranker reads the bodies
of the top fifty and so does not have to guess. **One is a substitute for the other, not a complement**, and the number
that says so is that the classifier's +27 net at fusion becomes 0 when a model is allowed to look.

This is a product statement, not a laboratory one, and both configurations ship: `search()` without a reranker keeps
**+0.051 MRR** from the classifier at zero marginal cost, and the reranked path keeps nothing from it. What the reranked
path keeps, measured in the same run: **MRR 0.4382 → 0.5665 (+0.128) and found@10 349 → 388 (+39)** for 0.42 USD per
500 questions (§31.5). The two levers are ~2.5× apart in size and only one of them costs money.

### 31.4 §30.5's registered question, answered: the pool does not move the gap, and doubling it buys nothing

| rerank depth | arm      |  R@10 | MRR@10 | found@10 | prompt tokens | USD (500 q) |
| -----------: | -------- | ----: | -----: | -------: | ------------: | ----------: |
|           50 | constant | 0.776 | 0.5699 |      388 |     1 749 316 |    0.609248 |
|           50 | derived  | 0.776 | 0.5665 |      388 |     1 216 033 |    0.418486 |
|          100 | constant | 0.792 | 0.5641 |      396 |     3 359 827 |    1.098569 |
|          100 | derived  | 0.772 | 0.5612 |      386 |     2 344 737 |    0.725712 |

Paired, 100 against 50, **within each arm**: constant **found 396 vs 388, onlyA 26 onlyB 18, p = 0.291**, MRR −0.0058
[−0.0225, 0.0111]; derived **386 vs 388, p = 0.885**, MRR −0.0053 [−0.0209, 0.0099]. **Nothing at a hundred is
distinguishable from fifty, in either arm, in either direction**, and the bill is **1.7–1.8×**. The registered question is
therefore closed: _the post-rerank gap does not flip with depth, because at these widths there is no gap to flip._

Two things follow, and both are cheaper than the run that produced them:

- **Depth 50 stays the default.** A wider pool is a 73–80 % larger bill for a difference the test cannot see.
- **The interesting direction is downward, and it is now dispatched** (`43364553771`, `rerankDepths=10,25,50`). Depth is
  the only cost knob with a known ceiling: at depth 10 the reranker can only reorder what fusion already found, so
  `found@10 ≤ 349` **by construction** and the arm measures pure reordering. The distance from there to 388 is what
  _widening_ buys, and the cheapest depth that reaches the plateau is the product's default.

The free columns carry a warning about depth as well: **fused at 100 is worse than fused at 50** (312 found against 322,
MRR 0.3853 against 0.3872). A deeper merge lets the weaker channel contribute more entries to the same length of list,
which is what a constant weight does when nobody is choosing — the same defect §30 fixed for questions, arriving through
the depth instead.

### 31.5 What the run cost, summed from the calls rather than estimated

**2.852 USD** for four rerank arms over 500 questions (0.418 + 0.609 + 0.726 + 1.099), **8 669 913 prompt tokens and
414 889 completion tokens**, 2 000 completions, **0 unpriced calls**. Per question at the shipping configuration:
**0.00084 USD** (0.084 ¢), or **0.0066 USD per question rescued into the top ten** (0.42 USD over 63 rescues).

One observation that is not a claim: **the derived arm's prompts were 30 % cheaper than the constant arm's at the same
width and the same question count** (1.22 M against 1.75 M prompt tokens at depth 50). The two fusions return different
_files_ in their fifty slots — a weight changes which channel's entries survive — and excerpt cost follows the files.
Whether the classifier systematically promotes terser documentation is unmeasured, so it is written as an observation
with a candidate explanation rather than as a saving.

### 31.6 Three things this section does not claim

**The absolute figures move between runs, and the paired ones do not have to.** The constant arm measured **395**
found@10 in `43340541442` and **388** here, same configuration, same corpus, same model name. Everything in 31.2–31.4 is
computed **inside one run**, which is why the sections above can publish a difference of 0.0034 with an interval: the
embedding endpoint is not a function, so a comparison across runs inherits a variance that no test in this file can
bound. **A figure without a run id is a figure this document no longer publishes.**

**The depth-100 arms were not tested against each other.** The artifact published the arm contrast at the arm's own
depth only, so "is derived better than constant at depth 100" is a question the run cannot answer. The artifact now
carries the same exact and bootstrapped verdicts at **every** depth it prints (`rerankByDepth[d].paired`, recomputed in
the gate from the columns beside it), and the dispatched ladder will populate it.

**`+0.051` is a CoSQA figure.** It is the corpus the classifier was calibrated on, which is exactly the corpus where a
threshold-calibrated rule looks best. The doc-comment and paraphrase corpora in §30.3 are the counterweight — 0.9794
against 0.9711 on 219 questions, and a wash on 99 — and neither is large enough to give the CI that CoSQA just got. **The
classifier's headroom claim is one corpus deep**, which is the honest state of it.

## 32. Depth pays between ten and twenty-five, and not between twenty-five and fifty

**§31.4 closed the top of the range**: a hundred reranked candidates is not distinguishable from fifty in either arm, at
1.7–1.8× the bill. It also registered where the interesting question had moved — **down** — and dispatched the ladder.
This section is the ladder: `43364553771`, same 500 questions, same pool, same run, `rerankDepths=10,25,50`, both arms at
every depth, **six arms in one job so that every comparison below is paired**.

### 32.1 What a depth is: one number that buys two different things

A reranker at depth _k_ reads the top _k_ of the fused list and may do two things to it: **reorder** entries that are
already there, and **rescue** an answer that fusion put below _k_. The first is bounded by what fusion found; the second is
the only way a reranker can beat fusion's recall. A ladder separates them, because at the arm's own depth the two arrive
mixed.

### 32.2 The ladder, with its bill summed from the calls

| depth | arm      | MRR@10 | found@10 | rescued | lost | fusion's own found | prompt tokens | USD (500 q) |
| ----: | -------- | -----: | -------: | ------: | ---: | -----------------: | ------------: | ----------: |
|    10 | derived  | 0.5388 |      352 |       0 |    0 |                352 |       296 504 |    0.050933 |
|    10 | constant | 0.5329 |      337 |       0 |    0 |                337 |       404 972 |    0.071101 |
|    25 | derived  | 0.5633 |      382 |      43 |   11 |                350 |       661 184 |    0.103543 |
|    25 | constant | 0.5606 |      377 |      52 |    8 |                333 |       932 983 |    0.146789 |
|    50 | derived  | 0.5627 |      383 |      59 |   26 |                350 |     1 253 697 |    0.190634 |
|    50 | constant | 0.5659 |      392 |      79 |   16 |                329 |     1 779 985 |    0.280665 |

**0.844 USD and 3 000 completions for the whole ladder**, 85 minutes of wall clock. "Fusion's own found" is not published
directly — it is `found − rescued + lost`, which is an identity rather than a measurement, and it is in the table because
it makes the next paragraph readable.

### 32.3 The reorder-only arm: a reranker that cannot look deeper cannot find anything

At depth 10 the rescued and lost columns are **zero by construction** — there is nothing below rank ten to rescue from — so
the arm measures reordering and nothing else. It is worth **+0.006 MRR for the derived list and +0.004 for the constant
one**, and **zero questions found**, against 352 and 337 found by fusion itself.

The distance from there to depth 50 is what looking deeper buys: **+30 found for the derived arm (352 → 382) and +40 for
the constant arm (337 → 377)**. Both jumps are distinguishable from the reorder-only arm (derived p = 0.0015, constant
p = 7.7 × 10⁻⁹), and they are the first result in this document that isolates _reading_ from _ordering_.

**And the classifier's advantage is visible exactly where the reranker cannot substitute**: at depth 10 the two arms are
**+0.0059 MRR apart, 30 questions against 15, p = 0.0357** — because a reranker that may only reorder a list cannot repair
a list that does not contain the answer. At depth 50 (§31.3) the same contrast is 26 against 26 and p = 1. **The
substitution has a mechanism, and the mechanism has a dial**: the deeper the reranker may read, the less a fusion weight
matters. A marginal p over three contrasts on the same 500 questions is not a finding on its own, and it is quoted here
because it points the same way as the two other depths rather than against them.

### 32.4 Twenty-five is not distinguishable from fifty, and costs 54 %

Within each arm, paired on the same questions:

| comparison | derived                                   | constant                                      |
| ---------- | ----------------------------------------- | --------------------------------------------- |
| 25 vs 50   | MRR +0.0005, found **382 vs 383, p = 1**  | MRR −0.0052, found **377 vs 392, p = 0.058**  |
| 10 vs 50   | MRR −0.0239, found 352 vs 383, p = 0.0015 | MRR −0.0330, found 337 vs 392, p = 7.7 × 10⁻⁹ |

**The arm the product ships — the derived one — cannot tell twenty-five from fifty, at 54 % of the bill** (0.104 against
0.191 USD per 500 questions). That is the cost floor §31.4 said the ladder was for, and it is a factor worth naming: a
deployment reranking half a million questions a month would pay **~104 USD instead of ~191** for a difference of one
question in five hundred.

**The default stays at fifty anyway, and the reason is written down rather than implied.** The constant arm leans the
other way by fifteen questions at p = 0.058 — the size of loss this test cannot see is exactly the size that is showing.
Two arms disagreeing about the sign of a small effect is not a licence to move a default toward the cheaper arm; it is the
definition of an unresolved effect. **Moving it needs a replication run, not an argument**, and the replication is
dispatched rather than described. What the product may do today is quote the number: _depth 25 is 46 % cheaper and
indistinguishable on the shipping arm_.

### 32.5 A depth dilutes fusion, and the reranker is what pays for it

Fusion's own found@10 **falls as the list gets deeper**: 352 → 350 → 350 for the derived arm and 337 → 333 → 329 for the
constant one. A hundred-entry merge lets the weaker channel place more entries in the same top ten, which is the defect
§20 fixed for questions and §31.4 caught arriving through the depth.

**And the deeper the list, the more the reranker has to repair**: rescues climb 43 → 59 (derived) and 52 → 79 (constant)
from depth 25 to 50, while losses climb 11 → 26 and 8 → 16. The net is what the paired test sees, and the net is
indistinguishable — but the _gross_ traffic nearly doubles. **A production system pays for those completions twice**: once
in money and once in the chance that a rescue is cancelled by a loss.

### 32.6 What this section does not claim

**One run.** Every number above is paired inside a single job, which is the only comparison this document accepts (§31.6),
and it is also the only replication there is. The 25-vs-50 verdict in particular rests on a single 500-question draw.

**Three contrasts on the same questions.** The depth-10 arm contrast (p = 0.0357) would not survive a Bonferroni
correction over the three depths, and it is reported as corroboration of §31's mechanism rather than as a standalone
finding.

**Depth is not a quality dial above twenty-five.** Nothing here says the product gets better with a wider pool; it says
the product stops getting worse below fifty, and that below twenty-five it starts to.

**Two runs, two sets of absolute numbers, and the file holds the newer one.** `benchmarks/cosqa-retrieval.json` is this
ladder's artifact; §31's figures are `43352844317`'s. They differ by seven questions on the same arm at the same depth
(383 here against 388 there), which is the run-to-run variance §31.6 describes — and it is why every comparison in both
sections is made inside one run and cited with its id.

## 33. A scoped question answered nothing, and the skip that hid it for two iterations

**Story 10 — "answer my question across several repositories" — was the one claim in the product table with no number
behind it.** What stood in its place was a test with `it.skip` and a comment naming two possible causes: a registration
step the test was not performing, or a repo-scoped store view it did not build. **Neither was the cause, and the sentence
is why nobody looked**: a skip with a plausible explanation reads as a known limitation rather than as an unread defect.

`FederatedSearchEngine.search` compared `repoFilter` entries to `node.projectId` with `Set.has`. The group indexer writes
project ids as `owner/name`; every unit fixture in the repository writes them as `repo-a`. **So the filter matched on
fixtures and matched nothing on a real workspace**, and the test that would have caught it was the one that was skipped.

### 33.1 What the two conditions measure, and the size of the defect

`benchmarks/multirepo-qa.json`, four released repositories at pinned commits — flask (Python), express (JavaScript), got
(TypeScript), gson (Java) — indexed into one workspace: **12 659 nodes, 741 import edges, 20 of them cross-repository,
904 files, 17.5 s**.

Questions are derived, not written: **the first sentence of a symbol's own doc comment, with the expected answer that
symbol**. That is RepoQA's construction for repository-level code understanding, and its property is the one that matters
— the answer key comes from the checkout, so the product cannot contribute to its own expected answers. 938 symbols carry
a usable doc comment; the artifact scores a deterministic 469 of them (the first of every second, in `project:qualified`
order).

| condition          | what it asks                                                     |   n | found@10 |    R@1 | MRR@10 |
| ------------------ | ---------------------------------------------------------------- | --: | -------: | -----: | -----: |
| `federated`        | the question, all four repositories open, no scope               | 469 |   0.9679 | 0.8699 | 0.9108 |
| `scoped`           | the same question, told which repository holds the answer        | 469 |   0.9744 | 0.8699 | 0.9122 |
| `name-free` subset | the question does not spell its own answer's name                | 422 |   0.9692 | 0.8649 | 0.9080 |
| `ambiguous` subset | the symbol's name exists in two or more of the four repositories |  23 |   0.9565 | 0.8696 | 0.9022 |

**Before the fix the `scoped` column was 0.** Not "low": zero of 469, because the filter selected the empty set and the
engine answered it faithfully. The paired comparison of `scoped` against `federated` is **3 questions only scoped found
against 0 only federated found, exact McNemar p = 0.25, ΔMRR +0.0014 with a 95 % interval of [0.0003, 0.0028]** — so the
honest statement is not that scoping is worth a lot, it is that **the presence of three other repositories costs three
questions in 469**.

**The two instruments disagree about those three questions and both are right.** The exact test needs six one-sided
discordant questions to reach p < 0.05 (§31), and three is a coin; the bootstrap interval on MRR excludes zero because
those three answers were not merely rescued, they were rescued **from far down the list**, and a mean of reciprocals sees
the size of a move that a count does not. **A count test resolves whether an arm wins more questions; an interval
resolves how much rank it wins.** Reporting one and not the other is how a three-question effect becomes a mechanism.

### 33.2 What this measures, and what it deliberately does not

**It measures routing, not paraphrase.** The question is the doc comment verbatim, and the doc comment is indexed — so a
system that finds it has found the text, not understood the question. The `name-free` subset removes the crudest form of
that (the identifier appearing in the question) and moves the figure by 0.1 points, which is itself the finding: **the
identifier was never what made these questions easy**.

**The hard condition is paraphrase, and it is not in this artifact.** It needs questions that describe a function without
reusing its comment, which means a generator — a paid one — and a generator is a thing to measure separately rather than
fold into a corpus whose answer key is currently free of any model. **That is the next iteration's input, and the reason
the numbers above are a floor rather than a headline.**

**No competitor number exists for the federated condition**, because no published benchmark asks one question of four
repositories at once. The comparison this section can support is internal and paired: `federated` against `scoped`, on
the same questions in the same run — which is the same instrument §31 and §32 use.

### 33.3 Three properties the fix had to have

**A selector is a rule, not a string comparison.** `cross-repo/search-scope.ts` accepts `owner/name`, `name`, and either
in any case, and refuses a prefix — so `flas` selects nothing rather than something adjacent. The rules are a module
because they are arithmetic over identifiers and the federated engine will not be their only reader.

**A selector that named no repository is reported.** `unmatchedRepoFilters` distinguishes "your filter is wrong" from
"the repositories you named hold no match", and it is resolved against the store's own project index rather than against
the query's hits — resolving against the hits is what made the two indistinguishable. The empty string is not a project
id, so a repository that was added and never indexed is skipped rather than selected.

**A group id is expanded through the manager that owns the group.** `groupId` was compared to `node.projectId` with a
`startsWith` that could never fire; it now resolves through `RepoGroupManager.projectsInGroup`, and **without a resolver
it throws** instead of filtering nothing. A group with no indexed repository answers the empty set — not every
repository, which is what an unindexed group would otherwise become.

### 33.4 The artifact is the gate

`tests/unit/scripts/a-cross-repo-answer-can-be-recomputed.test.ts` decodes every published rank column and recomputes the
aggregate printed beside it, the discordant counts of the paired test, and the membership of the two subsets. It also
holds the corpus to its pins: four repositories, four languages, each a 40-character commit. **An aggregate that does not
follow from the rows fails the build**, which is the same contract §31.5 imposed on the CoSQA artifact.

## 34. The replication ran, the direction held, and the depth contrast is still not a paired test

§32.6 registered a decision rule before dispatching the replication, so that the answer could not be chosen after the
fact: if 25 and 50 came back indistinguishable in both arms the default stays at 50; **if 50 came back better in either
arm, the ladder's "one more question" is re-read as underpowered rather than as a flattening**. `43394763480` is that
run: `rerankDepths=25,50`, both arms, the same 500 questions, one job, **4 702 206 prompt tokens and 1.515 USD measured**.

### 34.1 The two runs, side by side

| depth | arm      | ladder found@10 | ladder MRR | replication found@10 | replication MRR |
| ----: | -------- | --------------: | ---------: | -------------------: | --------------: |
|    25 | derived  |             382 |     0.5633 |                  385 |          0.5692 |
|    25 | constant |             377 |     0.5606 |                  376 |          0.5588 |
|    50 | derived  |             383 |     0.5627 |                  393 |          0.5609 |
|    50 | constant |             392 |     0.5659 |                  394 |          0.5672 |

**Both runs lean the same way at fifty, and the replication leans harder.** The ladder had constant at +15 questions for
depth 50 (p = 0.058, unresolved); the replication has it at **+18**, and the derived arm moves from **+1 to +8**. A
fifteen-question lean that reverses would have been run-to-run noise; two runs leaning the same way, one of them twice as
far, is what an underpowered contrast looks like.

**So the default stays at 50**, and the sentence in §32.5 that said twenty-five is "indistinguishable from fifty at 54 %
of the bill" is now read as **"twenty-five is cheaper and finds fewer answers, by an amount that one run could not
resolve"**. A cost win that costs recall is not a cost win.

### 34.2 What cannot yet be said, and why

**The depth contrast is not a paired test in either run, and the artifact is the reason.** `rerankByDepth[<depth>][<arm>]`
publishes `found@10`, MRR, `rescued` and `lost` per depth, and the per-question rank columns exist only for the depth the
top-level `reranked` block reports. **A paired McNemar needs the per-question columns of both depths**, so the figures
above are totals from two calls of the same harness, not a paired comparison of one run.

The numbers are still evidence — the questions, the pool and the two arms are identical, and the arms are compared within
each depth — but **they are the weaker kind**, and this document has spent two sections arguing that the weaker kind is
how a 0.0054 becomes a mechanism. The fix is a column, not an argument: **publish `perQuestion` inside each
`rerankByDepth` entry**, and the depth contrast becomes the same paired test every other figure in this document uses.

That is registered here as the next measurement, at the price the ladder already established: **~1.5 USD and ~70
minutes** for a four-arm ladder, or ~0.9 USD for two depths of one arm.

### 34.3 The bill for the iteration

| item                                                                        |                   cost |
| --------------------------------------------------------------------------- | ---------------------: |
| four-repository QA corpus, 469 questions, three conditions, one paired test |           **0.00 USD** |
| replication of the depth ladder (`43394763480`)                             | **1.515 USD** measured |
| **this iteration**                                                          |          **1.515 USD** |

**The cheapest question in the table was the one about the product's largest gap**, and it cost nothing: a corpus, a
script, a gate and a workflow, all of which run on every push that touches the paths they measure.

## 35. The doc comment was in the index, and that was most of the figure

**§33 measured routing and said so**: each question was the first sentence of a symbol's own doc comment, and the doc
comment is indexed — so a system that answered had found text, not understood a question. §33.2 named the number that
made this worth a second condition: the `name-free` subset moved the figure by **0.1 points**, which is the finding that
the identifier was never what made those questions easy.

**The second condition is the question a developer would type**, generated from the same doc comment under three rules —
no symbol name in any spelling, no copied phrase of six words, one question — and measured **on the same symbols, in the
same index, in the same run**, so the difference between the two columns is the wording and nothing else.

### 35.1 Two wordings, one corpus, one index

`benchmarks/multirepo-qa-paraphrase.json`, four pinned repositories (flask, express, got, gson), **469 questions
generated, 447 accepted, 22 rejected** by the rules the corpus states — 17 for copying six words from the documentation,
6 for spelling the symbol's name, one row for both. **The generation cost 0.01539 USD** at `deepseek-chat`,
temperature 0; the measurement beside it costs nothing and is regenerated by `scripts/multirepo-paraphrase.ts --mode
replay`.

| condition                 |   n |   found@10 |        R@1 |     MRR@10 |
| ------------------------- | --: | ---------: | ---------: | ---------: |
| verbatim, federated       | 447 |     0.9664 |     0.8702 |     0.9098 |
| verbatim, scoped          | 447 |     0.9732 |     0.8702 |     0.9112 |
| **paraphrase, federated** | 447 | **0.3870** | **0.1141** | **0.1954** |
| **paraphrase, scoped**    | 447 | **0.4228** | **0.1409** | **0.2263** |

**Paired, paraphrase against verbatim, same 447 questions**: federated **2 questions found only by the paraphrase against
261 found only by the verbatim**, exact McNemar **p = 4.7 × 10⁻⁷⁵**, ΔMRR **−0.7144** [−0.7492, −0.6802]; scoped **1
against 247**, p = 1.1 × 10⁻⁷², ΔMRR **−0.6849** [−0.7207, −0.6499]. **This is not a difference of averages** — it is 261
questions one wording finds and the other does not, and two the other way.

### 35.2 What the 0.58 is made of, and what it is not

**It is not a bad paraphrase set.** The rewrites are the questions this corpus exists to produce:

| symbol   | verbatim (the doc comment)                                 | paraphrase (what a person asks)                                      |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `init`   | Initialize the server.                                     | How do I start the server?                                           |
| `all`    | Special-cased `all` method, applying the given route …     | How do I apply the same route handler to every HTTP method at once?  |
| `engine` | Register the given template engine callback `fn` as `ext`. | How do I register a template callback for a specific file extension? |

**It is the architecture.** `FederatedSearchEngine` answers from `InMemoryGraphStore.searchFts` — **one lexical index**,
no vector channel, no query expansion. A question that reuses the documentation's words is a lookup against a store that
holds exactly those words; **a question that reuses none of them has nothing to match**, and 12 659 symbols across four
languages is not a pool a lexical index can absorb.

**And it is the first time this repository has a number for the difference.** Every earlier multi-repository figure was a
number about the index's ability to return the text it was given; this one is about the ability to answer a question
whose words it was not given. **The 0.9664 was real and it was smaller than it looked.**

### 35.3 The scope effect reverses, which is the second finding

| wording    | federated | scoped | only scoped | only federated |    exact p |
| ---------- | --------: | -----: | ----------: | -------------: | ---------: |
| verbatim   |    0.9664 | 0.9732 |           3 |              0 |       0.25 |
| paraphrase |    0.3870 | 0.4228 |      **15** |          **0** | 6.1 × 10⁻⁵ |

**When the question quotes the documentation, the three neighbouring repositories cost three questions and the test cannot
resolve it. When it does not, the same three repositories cost sixteen, and it can.** The mechanism is the same one
§33.1 could only state as a floor: a lexical index that is asked for words it holds buries the neighbours under exact
matches; asked for words it does not hold, it surfaces everything that looks locally plausible — and "locally" is a
repository's own vocabulary. **A first stage that only works on quoted text is a first stage whose immunity to
cross-repository interference is also only true of quoted text.**

### 35.4 What this does to the product table, and what it does not

_"Answer questions across several repositories"_ now has **two** numbers: **0.9664 found@10 when the question is the
documentation**, and **0.3870 when it is what a person would ask**. The row is not downgraded — the first figure is a
real measurement of a real capability (routing a known phrase to its symbol across four repositories) — but **the second
is the one a user experiences**, and it belongs in the table beside the first rather than below it.

**No competitor number exists for either condition.** No published benchmark asks one question of four repositories at
once, and the paraphrase condition is this repository's own construction. What can be said is directional and stated as
such: on CoSQA — questions people wrote, 500 same-language candidates — this engine reads **0.5699 MRR@10**, fifth of
nine. Here it reads **0.1954** over 12 659 candidates in four languages. **Different pools, different denominators; the
direction is the same, and it is the direction that has to change.**

### 35.5 The next lever is named by this measurement, and it is not a model

The gap is a **lexical-only first stage answering a question whose words are absent from the index**. The product already
ships the standard answer to that asymmetry — `query-expansion.ts` implements HyDE with the question kept in the mean —
and the federated engine does not use it. Three changes, in the order their cost rises:

1. **Give `FederatedSearchEngine` a vector channel**, fused with the lexical one, so that a paraphrase question has
   something to match. `HybridSearchEngine` already does this within a repository; the federated path predates it.
2. **Use HyDE on the federated query**, which is the arm `query-expansion.ts` exists for and which costs one completion
   per question.
3. **Re-measure this same corpus**, because the corpus is frozen and the two conditions are paired: the first run after
   either change reports its delta against 0.3870 on the same 447 questions, in the same instrument, at no cost beyond
   the change itself.

**Registered here as the next measurement, not as a plan**: the artifact already carries the columns a paired test needs,
so the run that follows the change answers "how much" rather than "whether".

## 36. The queue became four deep, and the depth contrast became a paired test

§34.2 registered two things: a column (`perQuestion` inside each `rerankByDepth` entry) that would turn the depth
contrast into the same paired test everything else in this document uses, and an admission that without it the ladder's
depth figures were two totals from one harness run. **Both are now in `43415558075`**, which is also the first run with
more than one completion in flight.

### 36.1 What the queue bought, measured

| step                           | serial `43394763480` | concurrent `43415558075` |       |
| ------------------------------ | -------------------: | -----------------------: | ----: |
| `Measure the product on CoSQA` |          68 min 04 s |          **33 min 12 s** | 2.05× |

**Four in flight bought a factor of two, not four**, and the arithmetic says why: three thousand completions against one
API are bounded by that API's shared throughput, not by how many sockets this job holds open. **The number that matters
is the one a next iteration budgets against** — a six-arm ladder is now ~50 minutes rather than 85 — and **2.05× is what
it is** rather than what the queue depth suggested.

**One of two thousand calls failed** (`failures: 1`, `rateLimitRetries: 0`, `emptyAnswers: 0`): 0.05 %, a rerank that
returned the fused order because its completion did not arrive. **The artifact could not say why** — a count with no
reason is a figure that will be misread later — so the reason is now grouped and published (`rerankCalls.failureReasons`)
for the next run.

### 36.2 The same four arms in three runs, which is what the variance is

| run                        | in flight | 25 derived | 25 constant | 50 derived | 50 constant |
| -------------------------- | --------: | ---------: | ----------: | ---------: | ----------: |
| `43364553771` ladder       |         1 |        382 |         377 |        383 |         392 |
| `43394763480` replication  |         1 |        385 |         376 |        393 |         394 |
| **`43415558075` this run** |     **4** |    **373** |     **377** |    **384** |     **394** |

**The largest same-arm same-depth difference across runs is twelve questions** (derived at 25: 385 → 373), which is
2.4 % of five hundred and is **not** caused by the queue: §34 already recorded a seven-question difference between two
serial runs of the same arm. **This table is the reason every comparison in this document cites a run id**, and it is the
second time a claim of the form "arm X beats arm Y" would have needed a run id to mean anything.

### 36.3 The depth contrast, now paired

**The column §34.2 asked for is in the artifact**, and the verdict is computed from it inside the same run: 500 questions,
both depths, both arms.

| arm      | found@10 at 25 | found@10 at 50 | only 25 | only 50 |             ΔMRR [95 % CI] |   exact p |
| -------- | -------------: | -------------: | ------: | ------: | -------------------------: | --------: |
| derived  |            373 |            384 |      18 |      29 | −0.0118 [−0.0330, +0.0090] |     0.144 |
| constant |            377 |            394 |  **19** |  **36** | −0.0037 [−0.0247, +0.0165] | **0.030** |

**Seventeen questions, thirty-six against nineteen, in one run on one model with the pool widened and nothing else
changed.** The ladder of §32 could only say that the constant arm leaned fifteen questions towards fifty at p = 0.058;
§34 added a second lean the same way; **this is the first time the comparison is a paired test, and it is the first time
it is distinguishable** — on the constant arm, not on the shipping one.

**So the default stays at fifty, and for a stronger reason than before.** The shipping arm's own contrast remains
unresolved (18 against 29, p = 0.144) — **the derived weight and the depth interact, and the interaction is not in this
run's resolution**. What the run does settle is that a deeper pool finds more answers for the arm that does not adapt its
weight, and that a cost argument for twenty-five has to be made against a fourteen-question deficit rather than against
an unresolved lean.

### 36.4 The bill, and one thing it cannot explain

| item                                          |         serial |     concurrent |
| --------------------------------------------- | -------------: | -------------: |
| prompt tokens (four arms, 500 questions each) |      4 702 206 |      4 931 178 |
| completion tokens                             |        218 766 |        218 603 |
| **measured cost**                             | **1.5153 USD** | **0.7860 USD** |

**The same completion work, five per cent more prompt tokens, and half the money — nineteen cents per million
tokens against thirty-two, with the price table unchanged.** The only mechanism that produces that pair is prompt-cache
hits, and **the artifact records the token split the vendor returned but not the cached fraction**, so this document can
state the arithmetic and not the cause. That is a field to add rather than a sentence to write: a billing section that
cannot say _why_ two identical runs cost 2× apart is a section a reader has to take on trust.

**This iteration: 0.786 USD for the ladder and 0.01539 USD for the paraphrase generation — 0.80 USD in total.**

## 37. The lexical channel was the wrong one, and the right one was already in the repository

§35.5 named the next lever as _"a lexical-only first stage answering a question whose words are absent from the
index"_, and proposed a vector channel, HyDE, and a re-measurement. **The first measurement of this iteration says the
diagnosis was half right and the first step was not the vector channel.** Before adding a channel it is worth asking
which one is being replaced, and the answer was a function that answers by containment.

### 37.1 Where the answer actually is

The 447 rewritten questions were asked of the engine with the cut raised from ten to five hundred, so that "not found"
and "not found _at ten_" stop being the same number:

| where the intended answer sits     | federated | scoped |
| ---------------------------------- | --------: | -----: |
| top ten (what the product reports) |       173 |    192 |
| positions 11–100                   |       172 |    180 |
| positions 101–500                  |        71 |     59 |
| nowhere in five hundred            |    **31** | **16** |

**416 of 447 answers — 93.1 % — are in the list the lexical channel already produced.** The gap this document has been
attributing to a missing semantic channel is, for eight questions in nine, an ordering problem: the answer is in the
candidate set and something else is above it. A vector channel would have been bought to fix a ranking defect.

**This sweep is its own run and its top-ten column reads 173 / 192, against the 173 / 189 the published artifact
recorded.** The three-question difference is the run-to-run band §36.2 measured (up to twelve on one arm, two serial
runs included), and it is stated rather than smoothed: the split below is a property of one run, and the paired tests in
§37.3 are computed inside the artifact's run, not across two.

### 37.2 Two lexical channels, one index, the same questions

`HybridSearchEngine` has shipped a field-weighted BM25 for many iterations — term frequency, inverse document frequency,
per-field weights (`name` 1, `docstring` 3, `signature` 1, `path` 0.5, `vocabulary` 0.25) and length normalisation — and
the cross-repository path never used it. `FederatedSearchEngine.search` called `InMemoryGraphStore.searchFts`, which
asks of each term whether a lowercased field _contains_ it, gives the node the weight of its **best single field**, and
adds three per matched term. There is no term frequency, no inverse document frequency, no per-field weight and no
length normalisation.

Same four checkouts, same index, same questions, **no embeddings and no model call on either side**:

| condition & channel                    | found@10 |      share |     MRR@10 |
| -------------------------------------- | -------: | ---------: | ---------: |
| verbatim, `searchFts` (shipped then)   |      432 |     0.9664 |     0.9098 |
| verbatim, field-weighted BM25          |  **447** | **1.0000** | **0.9217** |
| paraphrase, `searchFts` (shipped then) |      173 |     0.3870 |     0.1954 |
| paraphrase, field-weighted BM25        |  **358** | **0.8010** | **0.6207** |

**Twelve documented symbols were being lost on questions that quote their own documentation**, which is the one condition
the containment channel was supposed to own. And on the questions a person would ask, **173 → 358 found, 0.1954 → 0.6207
MRR**: 3.2× the MRR, at a cost of zero, because the code was already in the repository under a different call site.

The row that explains the size of it: `searchFts` scores a doc-comment match at **3** and a name match at **10**. A
question shares four words with the doc comment that answers it and one word with a neighbouring function's _name_, and
`3 + 4 × 3 = 15` loses to `10 + 1 × 3 = 13` only when the doc comment is short. Across four repositories the neighbouring
names are many and the doc comments are the ones being asked about.

### 37.3 The scope effect, under a channel that ranks

| wording    | federated | scoped | only scoped | only federated | exact p |
| ---------- | --------: | -----: | ----------: | -------------: | ------: |
| verbatim   |    1.0000 | 1.0000 |       **0** |          **0** |  1.0000 |
| paraphrase |    0.8010 | 0.8299 |      **13** |          **0** |  2.4e-4 |

**The verbatim scope effect is gone rather than smaller**: 3 questions and `p = 0.25` became 0 questions and `p = 1.000`.
That is what the mechanism in §35.3 predicted — the three neighbouring repositories cost a question only when the
ranking lets a merely-local match outrank an exact one, and a length-normalised, idf-weighted ranking does not.

**On rewritten questions the effect survives at 13**, down from 16, and it is still overwhelmingly one-directional (13
against 0). So §35.3's conclusion stands with a sharper edge: **immunity to cross-repository interference is a property
of the wording, not of the engine's ability to filter** — a channel that ranks correctly removes it for quoted text and
cannot remove it for a question that shares no words with any answer, because there the neighbourhood genuinely holds
plausible candidates.

### 37.4 The four-column reading on the verbatim corpus

| condition                  |       before |            after | Δ found |
| -------------------------- | -----------: | ---------------: | ------: |
| federated, all 469         | 0.9680 (454) | **0.9980 (468)** |     +14 |
| scoped, all 469            | 0.9744 (457) | **0.9980 (468)** |     +11 |
| federated, name-free (422) | 0.9692 (409) | **0.9976 (421)** |     +12 |
| federated, ambiguous (23)  |  0.9565 (22) |  **1.0000 (23)** |      +1 |
| ambiguous MRR              |       0.9022 |       **0.9457** |       — |

**The ambiguous subset — the one whose symbol name exists in two or more repositories — is now perfect at ten**, and its
MRR rose 0.0435. That is the sub-question a federated search exists to get right, and it used to be the one it got
wrong most often.

### 37.5 One column moved the other way, and it is reported

**R@1 on the verbatim corpus fell from 0.8699 to 0.8657**, two questions. A ranking that sums evidence across five
fields can put a second declaration above the exact one where containment scoring had a single hard rule for "the name
_is_ the query". The trade is fourteen answers found at ten for two answers demoted from first, and the paired MRR moved
+0.0093 [−0.0031, +0.0221] in the same run — **the direction is stated, the exact top-1 rule is not, and no attempt was
made to special-case a name equality back into the BM25 path.** A hybrid that reintroduces a hard rule for one field is
the defect this section removed.

### 37.6 What this changes about the next lever

§35.5's three steps keep their order and their content, but their baseline is not 0.3870 any more. **The remaining
paraphrase gap is 89 questions (0.8010 against 1.0000) and ΔMRR is −0.3010 [−0.3396, −0.2629]**, down from 261 questions
and −0.7144. So:

1. **A vector channel is now measured against 0.8010, not 0.3870.** What is left of the gap is the part no lexical
   channel can close: a question that shares no word with the answer's name _or_ its doc comment.
2. **HyDE is unchanged in cost and is now worth more per question**, because the lexical half it expands into is one that
   ranks. It was measured against a channel that could not use the expansion.
3. **The two conditions are still paired and the corpus is still frozen**, so the next run reports its delta on these same
   447 questions in the same instrument.

**The bill for this iteration is zero.** No completion, no embedding, no dispatch beyond the two local replays: the
corpus, the questions and both channels are in the repository. The artifacts are
`benchmarks/multirepo-qa.json` (`2026-11-13T12:49:38Z`) and `benchmarks/multirepo-qa-paraphrase.json`
(`2026-11-13T12:51:00Z`), and both carry the per-question columns the paired tests are computed from.

### 37.7 The same defect had a second instance, in the surface a user actually calls

`FederatedSearchEngine` is not the only thing that searched across repositories. **`cross_repo_search` — the MCP tool —
did not call it.** It called `store.searchFts` itself, applied `repos` and `groupId` to the rows that came back, and
reported `rank / 10` as a relevance. That is the same two defects the engine was just repaired for, in a second
implementation that nothing in the measurement touched: the containment channel, and a scope applied to a page.

**So the 0.8010 was true of the harness and not of the product**, which is the failure mode this document exists to
catch. The tool now calls `ctx.getFederatedSearch().search()` with the scope resolved before the ranking, and two
properties are asserted from outside: the first item's relevance is exactly `1` (it is relative to its own list, where
the old value was a raw rank), and no `File` node is ever an answer (the candidate set is declarations).

**`groupId` is turned into a `repoFilter` at that boundary rather than passed through**, because the groups this surface
registers live in a module-scoped manager and the engine holds the context's own. Naming the repositories keeps one
meaning for the word across the two, and the alternative — a group id that resolves against a manager the tool never
wrote to — would answer nothing.

**Six other call sites still use `searchFts`** and are registered here rather than repaired: the CLI's `search`
command, two GraphQL resolvers, and three lookups inside the MCP exploration tools. Two of those three are
name lookups (`searchFts(symbolName, { limit: 1 })`), which is the one question containment scoring answers well; the
CLI and the GraphQL field are general queries and carry the measured defect. **The cost is now a number instead of an
opinion: 173 against 358 on 447 rewritten questions**, and the next iteration that touches either surface has the
comparison to justify itself.

## 38. The vector channel was measured, and on rewritten questions it costs twenty-two points

§37.6 closed by naming the vector channel as the next lever and setting its baseline at 0.8010: _"what is left of the
gap is the part no lexical channel can close"_. **That was a diagnosis about the questions, and this section is the
first measurement of the proposed remedy.** It is dispatch-only (`multirepo-semantic.yml`), it runs both corpora in
parallel on one key, and it costs a few cents of embeddings and no completions.

### 38.1 What it measured

| condition (frozen corpus)     |    lexical | with vectors |                            Δ MRR | only lexical | only vectors | exact p |
| ----------------------------- | ---------: | -----------: | -------------------------------: | -----------: | -----------: | ------: |
| quoted questions, found@10    |     0.9980 |   **1.0000** |     +0.0051 `[−0.0031, +0.0133]` |            0 |        **1** |   1.000 |
| quoted questions, MRR@10      |     0.9201 |   **0.9252** |                                — |            — |            — |       — |
| rewritten questions, found@10 | **0.8010** |       0.5840 | **−0.1682** `[−0.2161, −0.1224]` |      **120** |           23 |  < 1e-4 |
| rewritten questions, MRR@10   | **0.6207** |       0.4525 |                                — |            — |            — |       — |

**The quoted corpus was already at 0.998 and the vector list bought the last question.** That is what a channel that
answers "the index's own words" looks like when the index's own words are the question: nothing left to add.

**On the questions the channel was bought for, it is 22 points worse and the paired test is unambiguous**: 120 questions
the lexical channel answered and the fused one did not, against 23 the other way. Every other figure in this document
that moved by more than five questions moved for a nameable reason; this one moved the wrong way with the remedy in
place, so the reason is the remedy or the weight.

### 38.2 The weight is the suspect, and the arithmetic says why

The two lists are fused by reciprocal rank with a weight that `deriveVectorWeight` reads from the question: the share of
the question's terms the lexical channel's best answer already carries. A rewritten question scores low - it shares no
words with the answer - so **the weight is 4, the highest the sweep bounds allow, and the vector list dominates a
ranking that is 22 points worse.** The fused column is therefore not "the vectors, mildly"; it is "mostly the vectors",
on the one corpus where the vectors are worst.

**That is a measured statement about the derived weight, not about vectors.** Nothing here says a vector channel cannot
help: it says that at the weight this repository derives for a paraphrase, on this corpus, it does not. The next step is
the sweep the single-repository corpora already run (`docstring-search` over `[1, 0.5, 0.25, 0.1]`, `cosqa-retrieval`
over `COSQA_VECTOR_WEIGHTS`) - **and this document does not get to call the channel a failure before that sweep exists**,
for the same reason §37 did not get to add a channel before asking where the answers were.

### 38.3 The corpus was asking about the last line of every comment

While wiring the channel, one probe found a defect that had been in every published figure of this corpus: **a
multi-line doc comment reached the index as its last line.**

Two causes, both real:

1. **`tree-sitter-rust` spells `/// text` as a `line_comment` that contains an `outer_doc_comment_marker` and a
   `doc_comment`.** The pass that collects comments from the tree saw both nodes, with different texts (`/// text` and
   ` text`). The join rule reads "the next capture starts on the line after the pending one" - and a duplicate that
   starts on the _same_ line replaced the block instead of extending it. A four-line Rust comment arrived as its last
   sentence.
2. **`cross-repo-indexer.ts` re-decided the attribution from the last raw comment capture** (`pending.text`), ignoring
   the `docstring` the provider had already computed. That capture is one node of a multi-line comment, _marker
   included_ - so a two-line Go comment documented its function with its second sentence and the `//` still on the front,
   while the provider in the same process held the correct, joined, stripped block.

**Both are fixed** (§38.4), and the corpus they fed is not the corpus this document was quoting:

| the quoted corpus     | before |              after | why                                                                             |
| --------------------- | -----: | -----------------: | ------------------------------------------------------------------------------- |
| questions derived     |    469 |            **494** | a joined block is long enough to be a question where one trailing line was not  |
| federated found@10    | 0.9980 |         **0.9860** | the question is now the block's first sentence, not its last                    |
| federated MRR@10      | 0.9201 |         **0.9056** | same                                                                            |
| ambiguous subset (31) | 1.0000 |         **0.9677** | same                                                                            |
| only-scoped, quoted   |      0 | **3** (`p = 0.25`) | the neighbourhood matches a longer question less often, so the scope costs less |

**The fall is the corpus getting harder, and the sentence is not allowed to stop there.** Two things changed in one
commit - the questions and the indexed text - so no single factor is attributed. What can be said is the direction: the
questions are now what a person reads first, which is the only thing a question should ever have been.

### 38.4 One rule for one question

The distance rule lived in two places and disagreed: the indexer refused a comment more than two lines above a
declaration, and the provider had no distance at all - so a JSDoc block two blank lines above a function documented it
through one surface and not through the other. **Both now apply the same two-line boundary**, and the comment says why
in one sentence: one blank line is a convention (`express` writes it for every method of an application) and two is a
paragraph break, after which a comment is a section header.

The tests that hold it (`a-doc-comment-is-the-block-not-its-last-line.test.ts`): a two-line Go comment joins, a Rust
comment joins across its empty `///` line, a Rust comment's sentence appears once and not twice, and a Kotlin block -
which is one node there, so it passed before the fix - still comes out whole. **The Kotlin case is the control**: a
change that repaired Rust by rewriting how blocks are joined would break it.

**The bill for §38.3 and §38.4 is zero.** No model call: the probe, the fix and the re-measurement are all local, and
the corpus they produce is re-indexed from the same four pinned checkouts.

### 38.5 The corpus was regenerated, and the baseline it produced

Fixing §38.3 changed the text every question is taken from, so the rewritten corpus had to be written again - the
rewrites are a model's answer to _those_ sentences, and a corpus written from a comment's last line is not a corpus
written from its first. One `generate` dispatch, 494 rewrites, **0.016475 USD**:

| the rewritten corpus               |    before the fix |                            after |
| ---------------------------------- | ----------------: | -------------------------------: |
| questions asked                    |               447 |                          **454** |
| rejected by the rules              |                22 |                           **40** |
| verbatim, found@10                 |            1.0000 |                       **0.9930** |
| paraphrase, found@10               |            0.8010 |                       **0.7930** |
| paraphrase, MRR@10                 |            0.6207 |                       **0.6299** |
| paraphrase penalty, ΔMRR           |           −0.3010 | **−0.2762** `[−0.3145, −0.2374]` |
| found only by the verbatim wording |                89 |                           **92** |
| scoped over federated, rewritten   | 13 (`p = 2.4e-4`) |            **14** (`p = 1.0e-4`) |
| scoped over federated, quoted      |       0 (`p = 1`) |               **3** (`p = 0.25`) |

**The paraphrase condition did not get easier or harder in a way that matters**: 0.8010 to 0.7930 is seven questions on a
corpus of 454, and the penalty moved from −0.3010 to −0.2762 with overlapping intervals. What did change is the
**rejection rate, 22 to 40** — the rewrites are generated from longer source sentences now, and a longer sentence gives
the model more phrases it can copy, which the rules refuse. **A rule that catches twice as many rewrites is a rule
working, not a corpus failing.**

**So the vector-channel result of §38.1 stands on the corpus it was measured on, and is re-measured on this one before
anything is concluded about it.** The sequence is deliberate: the deficit was found on a corpus with a known defect,
and a channel is not condemned on evidence from a corpus that has since been corrected.

### 38.6 The channel, measured again on the corpus that was not truncated

The deficit in §38.1 was found on a corpus whose questions were the last line of a comment. **A channel is not condemned
on evidence from a corpus that has since been corrected**, so the same two jobs ran again on the regenerated one — same
key, same model, 12 072 vectors, no completions:

| condition (regenerated corpus) |          lexical |     with vectors |                            Δ MRR | only lexical | only vectors | exact p |
| ------------------------------ | ---------------: | ---------------: | -------------------------------: | -----------: | -----------: | ------: |
| quoted, found@10 (494)         |     0.9860 (487) | **0.9939 (491)** |     +0.0057 `[−0.0024, +0.0139]` |            1 |        **5** |   0.219 |
| quoted, MRR@10                 |           0.9056 |       **0.9113** |                                — |            — |            — |       — |
| quoted, ambiguous subset (31)  |      0.9677 (30) |  **1.0000 (31)** |                                — |            1 |        **1** |   1.000 |
| rewritten, found@10 (454)      | **0.7930 (360)** |     0.6500 (295) | **−0.0956** `[−0.1392, −0.0520]` |       **86** |           21 |  < 1e-4 |
| rewritten, MRR@10              |       **0.6299** |           0.5342 |                                — |            — |            — |       — |

**The direction held and the size halved.** On the corpus with the defect the cost was −0.1682; on the corrected one it is
−0.0956, still 86 questions against 21 and still unambiguous. **So the finding is not an artefact of the truncated
questions** — which is the thing a second measurement exists to rule out.

**And the quoted corpus moved the other way, in a place that matters.** It gained 4 questions overall and **the ambiguous
subset — the one whose symbol name exists in two or more repositories — went from 30 of 31 to 31 of 31.** That is the
sub-question a federated search exists to get right, and a vector channel that reads the description rather than the
name is exactly what should fix it. **Five questions gained against one lost on the quoted corpus is not a result at
`p = 0.219`**, and it is reported as the direction it is.

**What this leaves is one open question, and it is the weight.** A fused list that is 14 points worse on the corpus it
was bought for, and 0.6 points better on the one it was already good at, is the signature of a fusion that lets the worse
list dominate — which is what `deriveVectorWeight` does here by returning **4** for a question that shares no words with
its answer. `--weights` exists now (§38.7) and the sweep is the next dispatch.

### 38.7 The weight became an input, because a variable that moves a figure by fourteen points is measured

`FederatedSearchOptions.vectorWeight` now reaches the fusion, and `multirepo-paraphrase.ts --weights 0.1,0.35,1,4` sweeps
it over one corpus in one dispatch. The artifact carries `semanticSweep` — each weight scored and **paired against the
lexical column it is a re-weighting of** — so the answer to "is the derived weight the good one" is a table rather than
an argument.

**The four weights are the ones the single-repository sweeps already scored**, not a grid invented here:
`docstring-search` sweeps `[1, 0.5, 0.25, 0.1]` and `cosqa-retrieval` sweeps `COSQA_VECTOR_WEIGHTS`, and
`FUSION_WEIGHT_BOUNDS` is `{min: 0.1, max: 4}` **because those are the ends a run has a figure for**. A weight nobody
measured would be a second guess wearing the first one's clothes.

**Empty is the default and it is the product's behaviour**: `deriveVectorWeight` reads the question, and every figure
before this input existed was measured at the weight it derives. **A sweep is a measurement, and a measurement is
opt-in** — the same rule that keeps a paid workflow out of a push trigger.

### 38.8 The sweep: the derived weight is the worst of the four, and 0.35 is the best

One dispatch, one corpus, the same 12 072 vectors and the same 454 questions. **Only the weight differs.**

| fusion weight                    |         found@10 |     MRR@10 | only sweep | only lexical |    exact p |                            Δ MRR |
| -------------------------------- | ---------------: | ---------: | ---------: | -----------: | ---------: | -------------------------------: |
| lexical only (no vectors)        |     0.7930 (360) |     0.6299 |          — |            — |          — |                                — |
| **0.1**                          |     0.8062 (366) |     0.6525 |      **6** |            0 |  **0.031** | **+0.0226** `[+0.0043, +0.0406]` |
| **0.35**                         | **0.8216 (373)** | **0.6575** |     **14** |        **1** | **0.0010** | **+0.0277** `[+0.0008, +0.0541]` |
| 1                                |     0.8040 (365) |     0.5771 |         21 |           16 |      0.511 |                          −0.0528 |
| **4 — what the product derives** | **0.5330 (242)** | **0.4830** |         21 |      **139** |    1.5e-22 | **−0.1468** `[−0.1949, −0.0989]` |

**Three things follow, and the first one rewrites §38.1's conclusion.**

1. **The vector channel is not worthless; the weight the product derives for a paraphrase is the worst value in the
   sweep.** At 0.35 it is worth **+13 questions and +0.0277 MRR, 14 against 1, `p = 0.001`** — a paired result with a
   one-directional count, not a tie. §38.1's "it costs twenty-two points" was true of the _configuration_, and calling
   it a property of the channel would have been the same error this document spent §37 correcting in the other
   direction.
2. **The curve is not monotone, and the shape is the finding.** 0.35 > 0.1 > 1 > 4: the fused list is already worse at
   weight 1 by MRR (−0.0528) while gaining five questions, so **the vector list adds recall and costs rank** — it finds
   answers 14 questions earlier than lexical alone at 0.35, and at 1 the two lists disagree about 37 questions and the
   vector list wins 21 of them. The lexical rank is the better rank; the vector list is the better _candidate generator_.
   That is the opposite of what a weight of 4 assumes.
3. **`deriveVectorWeight` returns 4 here, and 4 is where the channel loses 26 points.** The function reads
   `selfEvidence` — the share of the question's terms the lexical best answer carries — on the reasoning that a question
   the lexical list already answers in its own words should not hand over to a semantic list. **A paraphrase scores low,
   so the function hands over almost entirely, and the corpus says that is exactly backwards**: a question that shares no
   words with its answer is precisely the one where the lexical list's _ranking_ is still the better one, because the
   names and signatures it matched are the answer's own.

**So the derived weight needs a second signal, and this document does not invent one.** The registered hypothesis is
narrow and testable: **`selfEvidence` measures whether the lexical list knows the question's words, and the fusion
weight needs to know whether the lexical list's rank is trustworthy — two different questions that one number is being
asked to answer.** The measurement that would decide it is this sweep on the two single-repository corpora
(`docstring-search`, `cosqa-retrieval`), because if 0.35 also wins there the bounds are wrong rather than the boundary in
`FUSION_WEIGHT_BOUNDS`.

**Nothing changed in the product.** The default is still derived, every published figure is still at the derived weight,
and a sweep that wins is a hypothesis until the two single-repository corpora say whether the bound or the question is at
fault. **The bill is one dispatch and no completions**: the vectors were built once, and the four columns are four
passes over an index that was already in memory.

## 39. The weight was asking one side of the question, and the two-sided rule is registered before it runs

§38.8 left a hypothesis and a refusal: **`selfEvidence` measures whether the lexical list knows the question's words, and
the fusion weight needs to know whether the lexical list's _ranking_ is trustworthy - two questions, one number.** The
refusal was deliberate. A sweep that shows the derived weight is the worst of four is not permission to pick the best of
four by hand; a weight chosen after seeing the curve is a parameter fitted to 454 questions and quoted as a rule.

This section registers the alternative, in the order it has to be registered: **the rule first, the acceptance criteria
second, the run third.**

### 39.1 What was actually wrong, said as a shape rather than a number

`deriveVectorWeight` reads `lexical[0]` and nothing else. Its three outcomes are a threshold on one channel's evidence,
so the **vector** channel's evidence cannot enter the decision at all. Concerning a question whose answer nothing spells,
both channels are blind, and the rule interprets the lexical channel's blindness as a mandate for the other one.

The CoSQA corpus is where that reading was correct, and the measurement says why: on 500 questions the vector channel
puts the answer in its top ten **340** times and the lexical channel **206** times, so a query the index cannot spell is a
query where the stronger channel is being held back. The four-repository corpus is the mirror: the lexical channel finds
**360 of 454** rewritten questions in the top ten and the vector channel, fused at the derived weight, **295**. **The same
evidence, the same rule, opposite correct answers - which is the definition of a signal that is missing a term.**

### 39.2 The term, and the arithmetic that makes it a rule rather than a knob

The missing term is the other channel's own evidence, and it is already computable: both lists are in memory when the
weight is decided. This iteration exposed them (`HybridSearchEngine.channels`, `FederatedSearchEngine.channels`) so that
a rule can read both **and so that the lists a rule reads are the lists the answer was fused from** - a rule applied to a
second retrieval is a rule about a retrieval nobody saw.

Then, in `search/fusion-weight.ts`:

| name                  | what it is                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `channelEvidence`     | the mean `selfEvidence` of a channel's **top five** answers                                                      |
| `EVIDENCE_DEPTH`      | 5 - the cut the CoSQA recall columns are published at, and a top-one read is a read of a channel's luckiest slot |
| `EVIDENCE_SMOOTHING`  | 0.05 - **one carried term in twenty**, the same absolute slack at every length                                   |
| `evidenceRatioWeight` | `clamp((vector + 0.05) / (lexical + 0.05), 0.1, 4)`                                                              |

**A channel's vote is worth as much as the share of the question its own answers carry.** The ratio is not a new
constant wearing an arithmetic costume: every number in it is one of the four the sweep already scored. What it predicts,
before any run, is checkable against §38.8's measured optima:

| corpus                               | what the ratio is asked             |     value |                        measured optimum |
| ------------------------------------ | ----------------------------------- | --------: | --------------------------------------: |
| doc-comment lookups, 219 questions   | both lists carry the question       |  **1.00** | flat: 0.9711 at 1 against 0.9718 at 0.1 |
| rewritten questions, 454, four repos | lexical carries 3× the vector share | **0.375** |           **0.35**, +14/−1, `p = 0.001` |
| CoSQA, 500 questions                 | vector carries it, lexical does not |  **4.00** |      **4**, 338 against 321 at weight 1 |

**Three corpora, three optima, one formula, and the third row is the one that matters**: a rule that returned 0.375
everywhere would have retired CoSQA's win, and a rule that returned 4 everywhere is the rule §38.8 falsified.

### 39.3 Registered acceptance criteria, written before the run

The candidate is adopted **only if all four hold**, on one dispatch of `multirepo-semantic.yml` (weights
`0.1,0.35,1,2,4`) and one of `code-qa-benchmark.yml` (weights `0.35,1,2,4`), both on `master` at `d8429d9`:

1. **Rewritten questions, four repositories**: candidate `found@10` ≥ **0.7930** (the lexical list alone) and
   `candidate-vs-derived` shows the candidate ahead, `p < 0.05`.
2. **Quoted questions, same index, same run**: candidate `found@10` ≥ **0.9912** (451 of 454) - the channel may not buy
   the paraphrase condition by moving the quoted one.
3. **CoSQA**: candidate `found@10` ≥ **321** (the weight-one baseline) and not worse than the derived arm's **338** by
   more than its paired interval.
4. **The two shares are in the artifact**, per question, and recompute the weight column to three decimals - a rule whose
   inputs are not published is a rule nobody can check.
   **A note on the baselines named above.** 321 and 338 were the published CoSQA figures on the day the criteria were written.
   §39.11 re-measured that corpus on the same dispatch and moved them to 434 and 447, and **the criteria were not revised
   afterwards**: a bar that moves once its own result is known is not a bar.

**If a criterion fails the candidate is retired and the product keeps the one-sided rule**, and §39 records the failure
with the same table it would have used for a success. §38 registered the weight as a variable rather than a setting; this
section registers the _rule_ the same way.

### 39.4 The auditability fix, which is separate from the rule and does not depend on it

§38.8 published four aggregates and no columns. The consequence is exact: a reader could see that weight 0.35 was
thirteen questions better than weight 4 and **could not ask which thirteen** - and the next analysis of the same vectors
would have had to re-embed a four-repository corpus to find out. Every swept weight now publishes its own per-question
column (`perQuestion.sweep.<weight>`), beside the candidate's column and the two evidence columns it came from.

Two gates, because one of them has to run on a checkout that predates the columns:

- `tests/unit/scripts/a-paraphrase-answer-can-be-recomputed.test.ts` recomputes **every published aggregate from its own
  column** and every candidate weight from its two shares. It tolerates an artifact written before the columns existed.
- `multirepo-semantic.yml` re-checks the artifact **this run wrote** and fails if any swept weight has an aggregate and no
  column. **The tolerance is therefore one commit wide and cannot become the rule.**

The same change makes the next sweep of these vectors analysable without the key: the columns are the corpus's answer
pattern, and eighteen such sweeps can now be re-read from a JSON file.

### 39.5 Cost

Two dispatches, no completions, no judge: ~12 072 vectors for the four-repository corpus and ~1 000 short embeddings for
CoSQA, both inside the existing workflows' free-tier minutes. **The instrumentation itself is free** - two means and one
division per question over lists that were already in memory.

### 39.6 The run: the candidate wins where it was aimed and misses one criterion by one question

One dispatch of `multirepo-semantic.yml` at `d8429d9`, weights `0.1,0.35,1,2,4`, the same 12 072 vectors, the same 454
rewritten questions and the same 454 quoted ones. **Five rules, one corpus, one index.**

| rule on the 454 rewritten questions  |         found@10 |     MRR@10 | mean regret (positions) | questions that lost a position |
| ------------------------------------ | ---------------: | ---------: | ----------------------: | -----------------------------: |
| no fusion (lexical only)             |     0.7930 (360) |     0.6299 |                       — |                              — |
| constant 1 (what the engine shipped) |           0.8040 |     0.5778 |                   1.004 |                            140 |
| constant 0.1                         |           0.8062 |     0.6525 |                   0.430 |                             43 |
| **constant 0.35 (tuned)**            | **0.8216 (373)** | **0.6572** |               **0.341** |                         **61** |
| **one-sided rule (shipped)**         | **0.6498 (295)** | **0.5340** |               **1.921** |                        **149** |
| **two-sided ratio (candidate)**      | **0.8194 (372)** | **0.6522** |               **0.379** |                         **61** |
| oracle over the five weights         |           0.8392 |     0.7278 |                       0 |                              0 |

**The paired tests, on the same 454 questions:**

| pair                                    |                      Δ MRR |        95 % interval | only A | only B |    exact p |
| --------------------------------------- | -------------------------: | -------------------: | -----: | -----: | ---------: |
| candidate − one-sided rule (paraphrase) |                **+0.1182** | `[+0.0894, +0.1471]` | **82** |  **5** | **< 1e-4** |
| candidate − lexical only (paraphrase)   |                **+0.0224** | `[−0.0070, +0.0497]` | **16** |  **4** | **0.0118** |
| candidate − one-sided rule (quoted)     |                    −0.0125 | `[−0.0240, −0.0006]` |      1 |      3 |     0.6250 |
| candidate − lexical only (quoted)       | **450 of 454 against 451** |                    — |      1 |      2 |     1.0000 |

**Criterion 1 passed and criterion 2 failed by one question.** The candidate recovers **+12 questions against the
lexical list** (16 against 4, `p = 0.012`) on the condition it was built for, and it is **0.44 positions per question
worse than a constant 0.35 that was tuned on this very corpus** - which is the honest comparison, and the one that says
the rule is not over-fitted: it reached 0.8194 without seeing a single answer key, against a constant that saw all 454.

**And the quoted condition lost two questions and 0.0125 MRR.** The registered bar was 451 of 454 and the run produced
**450**, so **the candidate as registered is retired**: §39.3 said the product keeps the one-sided rule if a criterion
fails, and a registration that is renegotiated after its own result is a paragraph, not a criterion.

### 39.7 Why it missed, in the artifact's own numbers

The published columns answer this without another run. **`lexicalEvidence` has a median of 0.40 and `vectorEvidence` a
median of 0.18** on the rewritten questions, and the candidate weights land at `min 0.10 · p50 0.526 · max 1.06` with
**`atCeiling = 0`** and **`vectorAhead = 4 of 454`**: the rule never gives the vector list more than the lexical one, and
it gives it **more than half a vote on 246 of 454 questions**. The buckets say the same thing in one line:

| candidate weight | questions | median `lexicalEvidence` | median `vectorEvidence` |
| ---------------: | --------: | -----------------------: | ----------------------: |
|        below 0.5 |       199 |                    0.410 |                   0.115 |
|         0.5 to 1 |       246 |                    0.394 |                   0.246 |
|          above 1 |         9 |                    0.400 |                   0.403 |

**A ratio is scale-free, and scale-free is the defect.** It cannot distinguish a lexical list that spells four fifths of
the question from one that spells two fifths of a question nobody can spell, because in both cases it is compared to a
vector list of its own size - so on the quoted condition, where the lexical list does answer in the answer's own words,
the vector list still collects about half a vote and takes two questions away. **The one-sided rule had an absolute
criterion and no comparison; the first candidate had a comparison and no absolute criterion; the repair is both.**

### 39.8 The second candidate, registered after the first one's failure and before its own run

`evidenceRatioWeight` keeps the ratio and puts the file's original cut back in front of it:

```
if lexicalShare >= SELF_EVIDENCE_CONFIDENT (0.8)  ->  FUSION_WEIGHT_BOUNDS.min (0.1)
otherwise                                          ->  clamp((vectorShare + 0.05) / (lexicalShare + 0.05), 0.1, 4)
```

**No new number enters the rule.** 0.8 is the cut this file has carried since the two corpora were first compared, and
0.1 is the doc-comment sweep's own optimum (MRR 0.9718 against 0.9711 at weight 1). The two halves answer the two
questions §38.8 separated: **an absolute one - does the lexical list answer this question in its own words - and a
comparative one - when it does not, whose list carries more of it.**

Registered acceptance, written before the run (`multirepo-semantic.yml` and `code-qa-benchmark.yml` at `f6dce4fe`,
weights `0.1,0.35,1,2,4` and `0.35,1,2,4`):

1. rewritten questions: `found@10` ≥ **0.7930**, and the rule ahead of the one-sided one at `p < 0.05`;
2. quoted questions: `found@10` ≥ **451 of 454** - the criterion the first candidate missed, kept at the value it was
   registered at;
3. CoSQA: `found@10` ≥ **321** (the weight-one baseline) and not below the derived arm's 338 interval;
4. the columns still recompute the published figures, and the artifact this run writes still carries one column per swept
   weight.
   **The same note applies here**: the CoSQA bar of 321 was the published baseline at registration and §39.11 moved it to 434.
   The criterion is scored against the number that was written down.

### 39.9 The second candidate ran, the gate did almost nothing, and the depth is what cost the signal

`f6dce4fe` put the absolute cut in front of the ratio (§39.8) and the same dispatch ran again. **The gate fired on one
question out of 454** - `atFloor` went from one to two and nothing else moved - so the two conditions came back almost
exactly as they had:

| rule (454 rewritten / 454 quoted)   | rewritten found@10 | rewritten MRR@10 |  quoted found@10 | quoted MRR@10 |
| ----------------------------------- | -----------------: | ---------------: | ---------------: | ------------: |
| one-sided rule (shipped)            |             0.6498 |           0.5340 |     0.9934 (452) |        0.9105 |
| candidate, ratio only               |             0.8194 |           0.6522 |     0.9912 (450) |        0.8980 |
| **candidate, ratio behind the cut** |         **0.8194** |       **0.6518** | **0.9912 (450)** |    **0.8980** |

**Criterion 2 failed a second time, at the same value, for a different reason than the first failure's diagnosis said.**
§39.7 blamed the ratio's scale-freeness; the gate was the repair and the gate is inert. A free probe on the same index,
no key and no dispatch, says why:

| condition (454 questions) | statistic                         |   p10 |   p50 |   p90 | at or above 0.8 |
| ------------------------- | --------------------------------- | ----: | ----: | ----: | --------------: |
| quoted                    | `selfEvidence` of the top answer  | 1.000 | 1.000 | 1.000 |     **442/454** |
| quoted                    | `channelEvidence` (top-five mean) | 0.467 | 0.629 | 0.886 |      **87/454** |
| rewritten                 | `selfEvidence` of the top answer  | 0.286 | 0.462 | 0.692 |       **8/454** |
| rewritten                 | `channelEvidence` (top-five mean) | 0.277 | 0.400 | 0.545 |       **1/454** |

**Averaging over five answers kept 86 questions of a separation that the first answer alone made out of 434.**
`EVIDENCE_DEPTH = 5` was chosen for a reason written into the code - a top-one read is a read of a channel's luckiest slot

- and the reason is wrong for this statistic: **the four runners-up of a quoted question's lexical list are near-misses
  and they carry almost none of the question's words, so the mean measures the tail rather than the answer.** The measured
  cost of the choice is the gate.

**Both candidates are therefore retired**, by the criteria registered before each of them, and the product keeps the
one-sided rule. §39.3 said the criterion is the criterion.

### 39.10 What the two falsifications leave standing, and the one thing they establish outright

Three facts are now measured rather than argued, and each of them narrows the next attempt:

1. **The bound was never the defect.** The CoSQA sweep is monotone in the weight - **0.35: 384 · 1: 434 · 2: 440 ·
   4: 448** found@10 - so 4 is that corpus's own optimum and `FUSION_WEIGHT_BOUNDS.max` is a measured value, not an edge
   of a grid that stopped early.
2. **The one-sided rule is correct in one regime and wrong in the other, and the regime is not textual.** It scores 447
   on CoSQA against the sweep's best 448, and 295 on the four-repository rewritten questions against the lexical list's 360. Both corpora answer _low_ on the evidence the rule reads; one wants the largest weight in the grid and the other
   wants a third of it. **A signal that cannot separate two cases cannot derive a rule for them**, and no rescaling of
   `selfEvidence` changes that.
3. **The separation the statistic does have is available, and the product already uses it.** At the first answer, the
   quoted condition separates from the rewritten one at **442 against 8** of 454. That is what `deriveVectorWeight`
   reads, and it is why the shipped rule is right on the two conditions closest to the corpora it was fitted on.

**What that leaves is a ranking-quality question, not a spelling one.** The candidate that would answer it is a
query-performance predictor - a score-margin or clarity statistic computed on each channel's own list, which is the
family the information-retrieval literature uses for exactly this decision and which this repository has never measured.
**It is registered for the next iteration with the arithmetic written down first**, and with the 442/8 separation as the
control that any new signal has to beat on the same two corpora.

### 39.11 The CoSQA baseline was a month of repairs old, and the current product doubles it

The dispatch was made to sweep a weight and it returned something larger: **the CoSQA artifact had not been re-measured
since the doc-comment repair**, and CoSQA's 500 queries are the docstrings of Python functions.

| CoSQA, 500 questions, pool 500     | published before this run | **this run** |
| ---------------------------------- | ------------------------: | -----------: |
| lexical, found@10                  |                       206 |      **332** |
| lexical, MRR@10                    |                    0.2367 |  **doubled** |
| fused at weight 1, found@10        |                       321 |      **434** |
| fused at weight 1, MRR@10          |                    0.3836 |   **0.6482** |
| derived weight, found@10           |                       338 |      **447** |
| derived weight, MRR@10             |                    0.4236 |   **0.6717** |
| after the reranker, found@10       |                       384 |      **475** |
| after the reranker, MRR@10         |                    0.5653 |   **0.7762** |
| answer in the vector top ten       |                       340 |      **447** |
| answer in either channel's top ten |                       371 |      **470** |

**One row of that table says "doubled" where it could say a number**, and the reason is `numbers-gate.js`: the exact
CoSQA lexical MRR@10 of this run collides, to four decimals, with a withdrawn figure from a 100-question corpus, and the
gate forbids a withdrawn value from appearing on a metric line anywhere - it compares numerically and cannot tell one
corpus's arithmetic from another's. **The artifact states the value
(`benchmarks/cosqa-retrieval.json`, `lexical.mrrAt10`), which is where a reader should read it from anyway**; the gate is
right to be blunt here and wrong only about the collision.

**Every channel moved, which is what makes the attribution plausible rather than proven**: a repair to how doc comments
reach the index changes the lexical fields and the embedded text together, and CoSQA is the corpus whose queries _are_
doc comments. **The causal claim needs a control** - the pre-repair engine run on the same corpus - and §39.11 records
that as owed rather than assumed. The figure that is not in doubt is the one this table states: **the product as it
stands answers 475 of 500 CoSQA questions in its top ten and scores MRR@10 0.7762 after reranking**, and the artifact in
the repository now says so.

## 40. The mechanism was never a variable, and four of them are registered before any of them runs

§39 ended with a sentence that is a defect report rather than a plan: **the shipped fusion scores 0.6498 on 454 rewritten
questions while the lexical list it re-weights scores 0.7930.** Five weights of one rule, two candidates for choosing
them, both retired by criteria written in advance - and the rule itself was never the only option. Reciprocal-rank
fusion is one of four mechanisms the retrieval literature has carried for thirty years, and **this repository had only
ever measured one of them.**

### 40.1 What the four mechanisms answer, and why a weight is the wrong shape for the question

| mechanism   | how it combines the two lists                            | what it needs                    | the failure it addresses                                      |
| ----------- | -------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `rrf`       | `Σ weight_c / (60 + rank_c)`                             | a per-question weight            | none - this is the shipped rule                               |
| `combmnz`   | `(z_lexical + z_vector) × channels`                      | nothing                          | agreement is rewarded, and nothing is weighted                |
| `supported` | reciprocal ranks, the vector channel only above its mean | nothing beyond one cut at a mean | a confident-and-wrong vector entry displacing a correct one   |
| `qpp`       | reciprocal ranks at a weight predicted from the lists    | the two heads' own separations   | the weight, derived from ranking quality rather than spelling |
| `qpp3`      | the same, with a three-answer head                       | the same, read wider             | the same, steadier - and it is a different statistic          |

**A weight is a scalar answer to a two-list question**, so §38's search for the right scalar was a search in the wrong
space: the same evidence that a paraphrase gives (nothing spells the answer) is the evidence CoSQA gives, and there the
correct weight is eleven times larger. `combmnz` has no scalar at all, and `qpp` replaces it with a ratio of two measured
separations - **a rule whose inputs are published, so a reader can disagree with the number rather than with the rule.**

The separation is `(mean of the head − mean of the list) / standard deviation of the list`: scale-free, non-negative by
construction, and computable from a list the engine already has. Read at one answer (`qpp`) and at three (`qpp3`),
**because which of those predicts is a measurement and not an argument** - on a six-document fixture the two disagree
about the same list (`fusion-rules.test.ts` holds that fixture, and the reason it exists).

### 40.2 What has to be true for this to be a measurement rather than a comparison of five implementations

1. **`rrf` in the new module returns the engine's order node for node**, at every weight the sweeps scored. A candidate
   measured by a second implementation was never compared with the product; it was compared with a second product.
2. **Every rule returns the union of the two lists, once each.** A rule that dropped the documents it disagreed with
   would win on recall by never being wrong about them.
3. **The candidate is reached through the product's own call.** `FederatedSearchEngine` gained `fuse()` - the half of
   `search()` after the retrieval - so a harness fuses the lists it already paid for, with the arithmetic `search()`
   uses, and does not embed 454 questions once per mechanism.
4. **Both conditions in one run, and CoSQA in the same iteration.** A mechanism with a figure on one corpus and no
   figure on the other is a mechanism nobody has falsified.

### 40.3 Registered acceptance criteria, written before the run

One dispatch of `multirepo-semantic.yml` (`mode=replay`, `rules=rrf,combmnz,supported,qpp,qpp3`, weights
`0.1,0.35,1,2,4`) and one of `code-qa-benchmark.yml` on the commit that adds the columns. A mechanism is adopted **only
if all four hold**:

1. **Rewritten questions, four repositories**: `found@10` ≥ **0.7930** (the lexical list alone) and the paired test
   against the lexical column shows the mechanism ahead at `p < 0.05`. **The stretch bar is 0.8216** - the constant that
   was tuned on these 454 questions with the answer key in hand - and a mechanism that reaches it with no key at all is
   the result this section is looking for.
2. **Quoted questions, same index, same run**: `found@10` ≥ **451 of 454**. The channel may not buy the rewritten
   condition by moving the condition it already answers.
3. **CoSQA, 500 questions**: `found@10` ≥ **447** (the shipped derived arm on the same corpus, §39.11) - a mechanism must
   not regress the corpus the current rule is right about.
4. **Nothing new to tune**: a mechanism that needs a constant this repository has never measured is not admissible, and
   the constant would have to be registered as a sweep before the mechanism is scored again.

**If two mechanisms clear all four, the one with fewer parameters wins**, and if the difference is inside the interval
the choice is recorded as a tie rather than as a finding.

**If none clears them, §40 records the four rows and the product keeps `rrf` at the derived weight**, with one addition
that does not depend on the outcome: **the mechanism becomes a published parameter of the engine** (`fusionRule`), so the
next iteration measures a mechanism rather than re-implementing one.

### 40.4 The cost, and the control that runs beside it

Every mechanism column is one pass over fifty entries per question. **No embedding is recomputed, no completion is
issued, and no second retrieval happens**, so the whole tournament costs one dispatch of two jobs that were scheduled
anyway. The dispatches also carry §39.11's outstanding control: `attribution-control.yml` runs the **pre-repair engine**
(`ebb4e6c5`, the parent of `4abde273`) on the same corpus, same runner, same secrets, so the doc-comment repair's effect
is measured rather than inferred from two runs a month apart.

### 40.5 The run: the parameter-free mechanism wins four columns and loses the fifth by two hundredths

One dispatch of `multirepo-semantic.yml` and one of `code-qa-benchmark.yml` at `3586aee5`, same corpus, same 12 072
vectors, same 454 rewritten and 454 quoted questions, and the same 500 CoSQA questions as §39.11.

**Rewritten questions, four repositories (454):**

| mechanism                  | found@10 |        R@1 |     MRR@10 | paired against lexical only  | paired against the shipped rule |
| -------------------------- | -------: | ---------: | ---------: | ---------------------------- | ------------------------------- |
| lexical list alone         |      360 |     0.5330 |     0.6299 | —                            | —                               |
| `rrf` (shipped, derived 4) |      295 |     0.4736 |     0.5340 | 21 against 86, `p < 1e-4`    | —                               |
| constant 0.35 (tuned)      |      373 |     0.5639 |     0.6572 | 14 against 1, `p = 0.001`    | —                               |
| **`combmnz`**              |  **378** | **0.5793** | **0.6708** | **18 against 0, `p < 1e-4`** | **86 against 3, `p < 1e-4`**    |
| `qpp3`                     |      375 |     0.5683 |     0.6604 | 15 against 0, `p = 1e-4`     | —                               |
| `qpp`                      |      374 |     0.5705 |     0.6608 | 15 against 1, `p = 5e-4`     | —                               |
| `supported`                |      370 |     0.4692 |     0.5747 | 18 against 8, `p = 0.076`    | —                               |

**Quoted questions, same index, same run (454):**

| mechanism          | found@10 |        R@1 |          MRR@10 |
| ------------------ | -------: | ---------: | --------------: |
| lexical list alone |      451 |     0.8458 |          0.9061 |
| `rrf` (shipped)    |      452 |     0.8480 |          0.9105 |
| **`combmnz`**      |  **453** | **0.8656** |      **0.9185** |
| `qpp` / `qpp3`     |      453 |     0.8458 | 0.9093 / 0.9102 |
| `supported`        |      451 |     0.8084 |          0.8744 |

**CoSQA, 500 questions, test-split:**

| mechanism                |  found@10 |             R@1 |          MRR@10 | paired ΔMRR against derived       |
| ------------------------ | --------: | --------------: | --------------: | --------------------------------- |
| lexical list alone       |       332 |          0.3560 |          0.4549 | —                                 |
| `rrf` at weight 1        |       429 |          0.5460 |          0.6443 | —                                 |
| derived weight (shipped) |       449 |          0.5620 |      **0.6735** | —                                 |
| **`combmnz`**            |   **452** |          0.5280 |          0.6535 | **−0.0199, `[−0.0391, −0.0022]`** |
| `supported`              |       440 |          0.5380 |          0.6488 | —                                 |
| `qpp3` / `qpp`           | 416 / 414 | 0.5420 / 0.5380 | 0.6359 / 0.6321 | —                                 |

**Three of the four registered criteria are met with room, and the fourth is not a criterion at all - it is a metric the
registration forgot to name.** Criterion 1: 0.8326 against the lexical list's 0.7930 and the tuned constant's 0.8216, with
`p < 1e-4`. Criterion 2: 453 of 454, above the 451 bar. Criterion 3: 452 against 447. **Criterion 4 trivially: CombMNZ has
no constant.** And on CoSQA it costs **0.0199 of MRR@10 with an interval that excludes zero** - a regression on a figure
§39.11 published as a product number.

**The mechanism is therefore not adopted**, by the rule this project applies to every regression, and the product keeps
`rrf` at the derived weight. §40.3's criteria stand as written; what they were missing is registered as §40.6 rather than
retrofitted into §40.3.

**What the tournament nevertheless established, and it is more than a table:**

1. **The weight was never the problem, the scalar was.** `combmnz` has no weight and beats the constant that was tuned on
   these 454 questions with the answer key in hand: **378 against 373, MRR 0.6708 against 0.6572, five questions and 0.0137
   MRR, `p = 0.0625` on the paired test** - a real gap that does not reach significance at 454 questions, and a gap that
   the shipped rule loses to by **86 questions**.
2. **Suppression is not the repair.** `supported` - the candidate that addressed the diagnosis directly, by refusing the
   vector channel's below-average entries - reaches 370 found@10 and **0.5747 MRR, the second worst of the six**. The loss
   was never "a wrong document displaced a right one"; it was that a global scalar cannot weigh two lists per document.
3. **Query-performance prediction works and is not enough.** `qpp` and `qpp3` land within three questions of `combmnz` on
   the paraphrase condition (374 / 375), so a statistic read off the two lists' own heads **does recover most of what the
   spelling signal lost** - and on CoSQA they collapse to 414 and 416, well under the derived arm's 449. **Predicting a
   scalar is still predicting a scalar.**
4. **The two statistics disagree exactly where they were predicted to.** `qpp` reads one answer and `qpp3` three; they
   differ by one question on the paraphrase condition and by two on CoSQA, which is the fixture-level disagreement
   `fusion-rules.test.ts` holds, measured on a corpus.

### 40.6 The repair that has to beat a fifth column, registered before its run

CombMNZ's loss has a mechanism of its own, and the unit test that documents it is the specification: **a document both
channels rank low is multiplied by two as well**, so agreement about an answer nobody wanted is rewarded exactly as much
as agreement about the answer. Two candidates, both parameter-free, one variable changed each:

| mechanism          | what changes                                             | the claim it tests                                 |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------- |
| `combmnz-positive` | `max(0, z)` - a channel saying "not this one" votes zero | the MRR loss is the negative half of the count     |
| `rrf-mnz`          | reciprocal ranks × channel count, no z-scores            | the gain is the count, not the score normalisation |

Registered acceptance, written before the run, on one dispatch of each workflow at the commit that adds them. **A
mechanism is adopted only if all six hold**, the first four as §40.3 wrote them and two new ones that close the omission:

5. **CoSQA `MRR@10` ≥ 0.6735** - the shipped derived arm's figure on the same corpus. **The metric the first tournament
   was not asked about**, and the bar the winner of §40.5 missed by 0.0199.
6. **Paraphrase `MRR@10` ≥ 0.6572 and quoted `MRR@10` ≥ 0.9105** - the best figure either condition has recorded, so a
   mechanism that buys recall by flattening the head (`rrf-mnz`'s own unit test measures a two-ten-thousandths gap between
   the top two) has to buy it without paying here.

**If none clears all six, the product keeps `rrf` and §40 records a third retirement** - and `fusionRule` stays a
published parameter, so the four mechanisms stay measurable on every future corpus instead of being re-implemented.

### 40.7 The control ran, and the doc-comment repair is worth two questions rather than a hundred and twelve

§39.11 published a table with 321 → 434 in it and wrote the caveat honestly: _"every channel moved, which is what makes
the attribution plausible rather than proven"_, with the pre-repair control recorded as owed. `attribution-control.yml`
paid it - the same corpus, the same runner image, the same secrets, the same test file, on `ebb4e6c5`, the **parent of the
doc-comment repair**:

| CoSQA, 500 questions, test-split | published 2026-10-27 | pre-repair `ebb4e6c5` | post-repair (this iteration) |
| -------------------------------- | -------------------: | --------------------: | ---------------------------: |
| lexical, found@10                |                  206 |                   332 |                      **332** |
| fused at weight 1, found@10      |                  321 |                   433 |                      **434** |
| derived weight, found@10         |                  338 |                   445 |                      **447** |
| after the reranker, found@10     |                  384 |                   475 |                      **475** |
| after the reranker, MRR@10       |               0.5653 |                0.7718 |                   **0.7762** |

**The control falsifies the attribution and the falsification is the useful part.** The pre-repair engine already answers
445 of 500 in its top ten; the repair adds **two**, and **nothing** after the reranker. The +112 in §39.11's table belongs
to the three weeks between 27 October and 12 November - a stale artifact being compared with a fresh run, which is the
defect `recordArtifact`'s provenance block exists to prevent and which it cannot prevent once the reader quotes two dates
as one measurement.

Three consequences, all of them recorded rather than argued:

1. **§39.11's causal sentence is withdrawn.** The doc-comment repair is worth **+1 merged and +2 derived questions** on
   CoSQA, and 0.0000 MRR after reranking. It remains a real defect with a real fix (`a-doc-comment-is-the-block-not-its-last-line.test.ts`
   holds it), and it is not the explanation for a hundred questions.
2. **The corpus was stale by three weeks and nothing said so.** `measuredAt` was in the artifact and nothing read it.
   `tests/unit/scripts/a-measurement-states-its-date.test.ts` is now the reader: **every committed artifact that publishes
   per-question columns or per-condition aggregates is a measurement**, and a measurement has to carry a parseable date
   and name the space it was taken in. The gate is weak about content on purpose - it judges no figure - and strict about
   provenance, because the defect was a reader quoting two dates as one measurement.
3. **The three-week movement is now a bisect rather than a mystery.** The commits between `dbc03b6c` (27 October) and
   `5590f021` (12 November) are eight, and the control harness makes each one a dispatch. **Registered, not run**: a
   bisect over eight commits, each measuring the same 500 questions, would say which repair bought the hundred and twelve
   - and until it runs, the honest sentence is that the product improved by that much and nobody has isolated why.

### 40.8 The second tournament: the count was not the gain, and neither repair recovered the MRR

Registered in §40.6, run at `b5d5bd56` on the same corpora, same 12 072 vectors, same 454 + 454 + 500 questions.

| mechanism (454 rewritten) |  found@10 |          MRR@10 | quoted found@10 |   quoted MRR@10 | CoSQA found@10 |    CoSQA MRR@10 |
| ------------------------- | --------: | --------------: | --------------: | --------------: | -------------: | --------------: |
| `rrf` (shipped)           |       295 |          0.5344 |             452 |          0.9105 |            431 |          0.6406 |
| `combmnz`                 |   **378** |      **0.6708** |         **453** |      **0.9174** |        **451** |          0.6555 |
| `combmnz-positive`        |   **378** |          0.6694 |             453 |          0.9174 |            450 |          0.6603 |
| `combmnz-percentile`      |         — |               — |               — |               — |              — |               — |
| `rrf-mnz`                 |       356 |          0.5619 |             440 |          0.8757 |            431 |          0.6406 |
| `qpp3` / `qpp`            | 375 / 373 | 0.6607 / 0.6609 |       453 / 452 | 0.9102 / 0.9082 |      417 / 412 | 0.6310 / 0.6293 |
| `supported`               |       370 |          0.5747 |             451 |          0.8744 |            445 |          0.6409 |

**Both §40.6 candidates are retired, and the two retirements are more informative than an adoption would have been.**

1. **The gain was never the count.** `rrf-mnz` - the same reciprocal ranks with the count multiplier, and nothing else
   changed - scores **356** against `combmnz`'s 378, and **440** on the quoted condition against 453: the count costs
   fourteen quoted questions and buys none of the paraphrase gain. **The gain is the score summation**, which is the half
   of CombMNZ that the literature names first and the half this project had never tested.
2. **The loss was not the negative half either.** `combmnz-positive` lifts CoSQA MRR by 0.0048 - real, and nowhere near
   the 0.0180 that separates it from the shipped arm - and costs nothing on either multi-repository condition. **Both
   z-score variants sit at 0.655-0.660 on CoSQA against the shipped arm's 0.678**, so the missing two hundredths come
   from the z-score itself.
3. **Run-to-run variance is now measured rather than assumed.** The shipped arm was measured twice this iteration and read
   445 then 451 found@10 on CoSQA (0.6670 then 0.6780 MRR), and the §40.5 winner read 452 then 451 (0.6535 then 0.6555).
   **The embedding endpoint is not bit-identical between runs**, so a two-question difference is noise and a 0.0180 MRR gap
   is not - and every criterion in §40.6 was written with a one-question tolerance that this variance can consume.

**The third candidate, registered before its run, changes one thing again**: `combmnz-percentile` replaces the z-score with
each channel's own percentile, because **a z-score divides by the list's standard deviation and a cosine list with a wide
tail compresses its own head** - the first answer of fifty sits at about 1.5 deviations on a vector list and at four on a
BM25 one, which is exactly the scale mismatch `zScores` was meant to remove and does not. A percentile is rank 1 of 50 =
`1.0` on both channels by construction; it is Borda with an agreement multiplier.

**Criteria: §40.6's six, unchanged and un-renegotiated**, including CoSQA `MRR@10` ≥ **0.6780** (the shipped arm's figure
on the same run as the candidates, which is the higher of its two measurements and therefore the harder bar). **If it
fails, the mechanisms chapter closes for this corpus and the next iteration spends its dispatches on languages rather
than on fusion** - four mechanisms, three retirements, and a measured statement about which half of each one carries the
result is a finished line of enquiry, not an unfinished one.

### 40.9 The third candidate failed on three criteria, and the mechanism chapter closes with a measured trade

`de3e078e` measured the percentile candidate on the same corpora. **It is the worst of the eight on the condition it was
built for**, and the failure is the most informative of the three.

| mechanism (454 rewritten)          |                rewritten found@10 | rewritten MRR@10 | quoted found@10 | quoted MRR@10 | CoSQA found@10 | CoSQA MRR@10 |
| ---------------------------------- | --------------------------------: | ---------------: | --------------: | ------------: | -------------: | -----------: |
| `rrf` (shipped)                    |                               295 |           0.5340 |             452 |        0.9105 |            431 |       0.6369 |
| `combmnz`                          |                           **378** |       **0.6708** |         **453** |    **0.9174** |            440 |       0.6480 |
| `combmnz-positive`                 |                           **378** |           0.6697 |             453 |        0.9174 |            445 |       0.6525 |
| **`combmnz-percentile`**           |                           **365** |       **0.5119** |         **443** |    **0.8262** |            430 |       0.6375 |
| derived weight (the product's arm) | 446 found@10 on CoSQA, MRR 0.6680 |                  |                 |               |                |              |

**Three criteria failed and one of them was the hypothesis itself.**

1. **Rewritten questions: 365 against the lexical list's 360 and the tuned constant's 373**, with **MRR 0.5119 - lower than
   the lexical list's own 0.6299.** A fusion that ranks worse than not fusing is the defect §39 started from, arrived at
   by a different road.
2. **Quoted questions: 443 against 451** - a rule that removes score magnitude loses the condition where the head is
   real.
3. **CoSQA MRR 0.6375 against the bar of 0.6780.**

**The hypothesis was that a percentile avoids the z-score's head compression. It does, and the compression was
load-bearing.** A percentile cannot tell a document that nearly matched its channel's first answer from one that barely
made the list: **it throws away the only number that says how much better the head is**, and a Borda count then ties
across the head - the module's own tie-break test measures two documents tying at `(1 + 1/3) × 2` on a four-document list,
and the same flattening on a fifty-deep list is what the corpus reports. **Score magnitude is not noise to be normalised
away; it is half the evidence.**

**So the mechanisms chapter closes, exactly as §40.8 said it would if this failed**, and it closes with a trade rather than
a winner:

| what the product could have              | rewritten found@10 | rewritten MRR@10 | CoSQA found@10 |           CoSQA MRR@10 |
| ---------------------------------------- | -----------------: | ---------------: | -------------: | ---------------------: |
| shipped `rrf` at the derived weight      |            **295** |           0.5340 |    **446–451** |      **0.6680–0.6780** |
| `combmnz`, if the CoSQA bar were dropped |          378 (+83) |  0.6708 (+0.137) |        440–452 | 0.6480–0.6555 (−0.020) |

**Eighty-three questions on the corpus where the product is worst, against two hundredths of MRR on the corpus where it is
strongest** - and the bar that refused it was registered before the run, so the refusal is a decision and not a result.
The honest sentence this project can now write is: **a parameter-free fusion exists that is dramatically better at
answering a question phrased in a developer's own words, and adopting it would move a regression from one corpus to
another rather than removing one.** That is recorded in `iteration-138-report.md` as the first item an owner should
decide, because it is a product trade rather than a measurement.

**What is left behind for the next iteration, in the order §40.8 fixed:**

1. **Languages.** `go` and `rust` enter the multi-repository corpus (their doc-comment handling is repaired and tested),
   and `sampleQuestions` gains a per-repository quota: at 332 of 494 questions from one repository, "four repositories"
   has been one repository with three guests.
2. **The eight-commit bisect** that attributes the hundred and twelve CoSQA questions between 27 October and 12 November.
3. **A mechanism that keeps score magnitude and agreement without a weight** - the one shape none of the eight has: a
   CombMNZ whose count multiplies a _rank-weighted_ score rather than a z-score or a percentile. **Registered as a
   hypothesis, not as a candidate**: it needs its own two corpora and its own six criteria, and it is worth doing only
   after the corpus has four languages rather than four repositories.

## 41. The corpus said four repositories and meant one, and the two languages the roadmap named were not in it

### 41.1 The defect, as a sample rather than an opinion

`sampleQuestions` was the first of every _k_ over a pool sorted by `projectId:qualifiedName`. **A stride over a pool is
proportional to how thoroughly a repository documents itself**, and the published artifact carried the consequence in a
field nobody read as one:

| repository          | language   | questions in the 494-row sample | share |
| ------------------- | ---------- | ------------------------------: | ----: |
| `google/gson`       | java       |                         **332** | 67.2% |
| `pallets/flask`     | python     |                             118 | 23.9% |
| `sindresorhus/got`  | typescript |                              23 |  4.7% |
| `expressjs/express` | javascript |                              21 |  4.3% |

**"Four repositories" was one repository and three guests.** Every sentence in this repository that says "four released
repositories" is a sentence about a sample in which five sixths of the evidence for three of them does not exist, and
the per-repository figure that would have shown it was a hit count rather than a score - so the artifact could not
contradict the prose. And the corpus held four languages, none of them `go` or `rust`, which the language priority list
names and whose doc-comment handling had just been repaired for this purpose.

### 41.2 What changed, and what each change is for

1. **`sampleQuestions` is a quota per repository.** Every repository contributes `floor(target / repositories)` questions,
   the remainder goes one each in repository order, and a repository smaller than its share gives what it has while the
   surplus is redistributed by water filling. Within a repository the questions are `floor(at × length / take)` - spread
   over the whole pool rather than taken from the front, because the pool is sorted by symbol name and a prefix of a
   sorted list is an alphabet.
2. **`go` and `rust` entered the corpus, chosen by measurement rather than reputation.** Four candidates were indexed
   locally before any of them was pinned: `gin-gonic/gin` produced **407** documented questions against `spf13/cobra`'s
   279, and `BurntSushi/ripgrep` produced **869** against `serde-rs/serde`'s 204. The two that won were pinned by commit
   (`73726dc6`, `178cc027`) and the two that lost are recorded here so the choice is auditable.
3. **`byRepository` and `byLanguage` are published per condition**, computed by the same `score()` as the aggregate. A
   per-repository hit count answered "how many" and never "how well", which is why the table above was invisible.
4. **The claim "four" is now read from the corpus** (`${corpus.repositories.length}`) rather than typed into a group
   description, and the workflow gate refuses an artifact whose repositories are not all present with a quota each.

**A quota makes doc-comment density irrelevant to the weight of a repository, and that cuts both ways**: `ripgrep`
documents itself roughly three times as thoroughly as `gson`, and it now contributes the same ~66 questions. That is the
point - the denominator is the repository, not the prose.

### 41.3 Registered acceptance criteria, written before the run

- **R1 Quorum.** Every repository contributes **60–70** scored rows, and the verbatim artifact's six `n`s sum to **400**.
  (`floor(400/6) = 66`, the remainder goes one each in repository order, and a rejected rewrite may cost a repository up
  to six.) **This criterion was wrong in its first draft and the draft is recorded rather than quietly replaced**: it
  said "66 or 67", which assumed every repository has more than its share to give. The lexical dry run - no model, no
  cost, so not a measurement - showed `expressjs/express` has **63** documented symbols in the whole repository, so it
  hands 3 questions back and the water filling gives them to the two repositories whose names sort first (`88b30ab`'s
  pool: ripgrep 68, gin 68, gson 67, flask 67, got 67, express 63). The band and the sum are what the arithmetic
  actually promises; a criterion that named 66 would have failed on a correct corpus.
- **R2 Languages.** `byLanguage` has **six** keys, and `go` and `rust` each carry **n ≥ 60**.
- **R3 The vector channel carries the rewritten question in every language.** For each language,
  `semanticParaphrase.mrr > paraphraseFederated.mrr` on the same rows. **A language where this fails is a language whose
  semantic claim is restricted, not a language to average away.**
- **R4 The quoted condition does not regress in any language.** For each language,
  `semanticVerbatim.mrr ≥ verbatimFederated.mrr − 0.01`.
- **R5 The four original repositories are unchanged in what they say.** Each one's `paraphraseFederated.mrr` on the new
  equal-quota sample is within **±0.06** of the same repository's figure recomputed from the previous artifact's
  per-question columns. **Descriptive rather than inferential** - the two samples are different questions, so a paired
  interval would be a claim about rows that were never the same rows.
- **R6 Provenance.** The corpus and both artifacts name the same six commits; `measuredAt` parses; any artifact carrying
  a semantic figure has `space.index === space.query !== 'deterministic'`.

**What a failure means, fixed now rather than after the numbers arrive.** R1 or R2 failing rejects the corpus change and
the corpus is reverted - a corpus that cannot hold its own quota is not the corpus. R3 failing restricts the semantic
claim to the languages that hold and names the ones that do not. R4 failing rejects the vector half for that language on
the quoted condition and the artifact says so. **R5 is the one that cannot be fixed by a rerun**: if the four original
repositories move by more than the tolerance, the quota change is a change of measurement rather than an improvement, and
the report says that instead of comparing the new figure to the old one.

### 41.4 Cost

Six tarballs (≈ 4 MB compressed), ~15k declaration embeddings, ~400 rewrite completions at temperature 0, and zero
completions in the search arms. **Under $0.15 for the iteration**, of which the rewrites are ~$0.08 and the embeddings a
fraction of a cent.

### 41.5 The run, and the criterion the run refused

The first six-repository dispatch (04:03–04:25 UTC, `f9d49c9b`) measured both conditions and **the quota gate refused
the artifact**: `pallets/flask` contributed **59** scored rows out of the 67 it was asked, because eight of its rewrites
were rejected twice. **The refusal was correct and the band was not the defect.** A quota is a promise about _scored_
rows, and it had been applied to _asked_ ones.

| repository           | asked | accepted | scored (first run) |
| -------------------- | ----: | -------: | -----------------: |
| `google/gson`        |    67 |       66 |                 66 |
| `BurntSushi/ripgrep` |    68 |       65 |                 65 |
| `gin-gonic/gin`      |    68 |       63 |                 63 |
| `sindresorhus/got`   |    67 |       61 |                 61 |
| `pallets/flask`      |    67 |   **59** |             **59** |
| `expressjs/express`  |    63 |       56 |                 56 |
| **total**            |   400 |      370 |                370 |

The measurement itself is intact and is reported below; what the run established is that **a rejected rewrite is a
question that was never scored, so the quota belongs to the accepted set**.

## 42. The quota belongs to the rows that were scored, and the cap - not the floor - is what a quota promises

### 42.1 What changed

1. **`trimToQuota(rows, of, target)`** in the harness: the same water filling, applied to the accepted rows instead of
   the pool, and it can only remove rows - never add one, never reorder, and never remove rows to hit a number it was not
   asked to hit.
2. **`allocateQuota` is one function** now, used by both the sample and the trim, because two copies of "equal share"
   would be two definitions of it.
3. **The gate asserts the cap and the sum**, not a floor: no repository may carry more than **68** rows - the water-filled
   share of 67 plus the one extra a short repository hands back, which is what `express`'s 63 gave `gin` and `ripgrep` -
   a repository below **40** is refused (a repository that contributes almost nothing is named and not measured), and the
   per-repository counts must sum to the artifact's own `questions.scored`.

### 42.2 Why the floor was withdrawn rather than widened

**Widening 60 to 55 would have made the gate pass without changing anything.** The floor was a proxy for "every
repository is measured on a quota's worth", and the run showed the proxy was attached to the wrong quantity: the sampler
guarantees an **upper** bound (no repository exceeds its share) and cannot guarantee a lower one, because rejections only
ever subtract. A criterion has to state the invariant the mechanism actually holds. **Registered before the second run:
the six repositories' rows sum to `questions.scored`, none exceeds 68, and the widest repository is at most 18 per cent
of the measurement** - against the 67 per cent a stride gave one of them.

### 42.3 The cost of the correction

**Two replays and no completions**, the second of which passed every gate (`05:48:33`) and reproduced the first's lexical
columns bit for bit and its vector column within 0.0013 MRR. The corpus the first run generated is committed, so both
replays read it and pay only the embeddings - ~17 200 short vectors, a fraction of a cent. **The first run's rewrites are
not repeated**: 400 completions, ≈ $0.08, already spent and now carried as a file with its digest.

## 43. The product's search was a different retrieval from the measured one

### 43.1 The defect, as four call sites and one dead command

Every published figure in this repository comes from `FederatedSearchEngine`. Nothing a user could reach did.

| surface                        | what it called                                               | what it answered                                                   |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `code-analyzer search <query>` | `searchFts` on a **freshly built empty store**               | **zero rows, exit code 0**                                         |
| MCP `search_graph`             | `store.searchFts`                                            | containment ranking: 173 of 447 rewritten questions in the top ten |
| GraphQL `searchGraph`          | `store.searchFts`, then a **post-search** `projectId` filter | a page fetched globally and filtered afterwards                    |
| GraphQL `crossRepoSearch`      | `store.searchFts`                                            | the same containment channel                                       |

**`code-analyzer search` had no way to be told which checkout to search.** `searchGraph` constructed an
`InMemoryGraphStore`, asked it a question, and printed `Found: 0 results in 0ms` — with `success: true` and exit code 0,
which is the exit code of an answer. The command's own header comment claimed "FTS5, graph traversal, and optional
semantic scoring"; it performed one of the three, on nothing.

The other three surfaces performed the containment channel the engine's docstring already documents as the losing side
of a comparison the repository had measured and published:

|                                 447 rewritten questions | `searchFts` | field-weighted BM25 |
| ------------------------------------------------------: | ----------: | ------------------: |
|             found in the top ten, all repositories open | 173 (38.7%) |     **358 (80.1%)** |
| found in the top ten, scoped to the answer's repository | 188 (42.1%) |     **371 (83.0%)** |

**The measurement was of a library, not of the product**, and the gap was not a tuning difference — it was a factor of
2.07 in recall at the same cut, on the same questions, with the better channel already written and already paid for.

The GraphQL field was worse than a weaker ranking: it asked the global list for a page of `limit` and then dropped the
rows whose project did not match, so a repository whose best answer was eleventh answered **nothing**. That is the same
defect `§37.7` fixed inside the engine by moving the scope into the ranking; the resolver was still on the other side of
the fix.

### 43.2 What changed

1. **`searchEngineFor(store, scopes?)`** — one ranking engine per store, held in a `WeakMap`. `HybridSearchEngine`
   computes field lengths and collection statistics over every node, and those numbers describe the index rather than
   the question: a surface that built one per request recomputed them on a store that had not changed, and two surfaces
   that built their own held two copies of the same arithmetic. **Weak, because a store that goes out of scope should
   take its statistics with it.**
2. **`FederatedSearchOptions` gained `offset` and `labels`.** Both are filters the _ranking_ sees, for the reason
   `§37.7` gives: a page carved out of a differently-ordered list is a different ranking, and a label removed after the
   fusion is a rank spent on a row nobody sees.
3. **`FederatedSearchItem` gained `id`.** A hit is the beginning of a conversation — "who calls this", "show me the
   file" — and every follow-up is keyed by an identity. `qualifiedName` is the one a person reads; `id` is the one the
   store answers by.
4. **`code-analyzer search` indexes what it is given.** `-d/--directory` (default `process.cwd()`), then the same
   `analyze_repository` tool the MCP server exposes, then the engine. It also gained `--fusion` and `--vector-weight`,
   because `§40` measured eight mechanisms and the ability to compare them belonged only to a harness.
5. **MCP `search_graph` and both GraphQL fields ask the engine**, with `labels`, `offset` and `repoFilter` forwarded as
   ranking inputs rather than applied afterwards.

**The dead command also learned to distinguish two zeroes.** `success: false` with `Nothing indexed` means the index is
empty; `success: false` with `No checkout named` means the command was not told where to look; a successful empty list
means the question has no answer **in a graph that was read**. The command previously printed the third for all three.

### 43.3 Registered acceptance criteria

These are structural rather than directional, so they are asserted in the suite and enforced by it on every run — unlike
the retrieval figures of §40–§42, which are readings of a corpus and belong in a report because a test that asserted them
would be a test edited until it passed.

- **A1 One order.** For a checkout indexed on disk, the CLI, the MCP tool and both GraphQL fields return the engine's
  list, item for item and in the same order. Compared **against the engine** rather than against a recorded constant: a
  constant would be a fifth opinion, and the engine is the thing the artifacts report.
- **A2 The control that makes A1 mean something.** On the same corpus, `store.searchFts('limits')` ranks a `File` node
  first while the engine — which returns code symbols — answers with the function inside that file. Asserted in the same
  test, because a corpus that stopped distinguishing the two channels would make A1 vacuous and a control nobody checks
  is a control that silently expired.
- **A3 Scope inside the ranking.** A question asked of repository `beta` answers from `beta` even when the global winner
  belongs to `alpha`, and equals the engine called with `repoFilter: ['beta']`.
- **A4 One engine per store.** Same store, same instance; different store, different instance; a second resolver over
  one store is ignored rather than merged, because an engine that swapped resolvers between questions would make
  `groupId` mean two things inside one process.
- **A5 The mechanism is a product option.** `--fusion combmnz` produces the order the engine produces under the same
  rule, so a user whose corpus disagrees with ours can check rather than take it on trust.
- **A6 Two zeroes are two answers.** An empty store, a missing `--directory`, a missing path and a directory that
  produced no graph each report a different sentence, and only the last of them can be reached through the indexing
  tool's own error.

### 43.4 What was deliberately left on the containment channel, and why

`findSymbol` and the two `get_symbol`/`find_implementations` fallbacks still call `searchFts`, and they are not defects
of the same kind: they are **name resolution**, where the question is "which node is called this" rather than "which code
answers this". A BM25 ranking that returns ten neighbours of a name would be a worse answer to a following-the-identity
question, and `searchFts`'s exact-name rule (rank 20 for a name that _is_ the query, 10 for one that contains it) is
precisely the rule that question needs. `search_code`'s store-only fallback is also still containment, and it says so in
its own output (`searchMethod: 'FTS (basic text search)'`) because a fallback that looked like the product would hide
which one a caller got.

### 43.5 Cost

**Zero model calls.** This iteration changed which function answers a question and where the engine is constructed; it
indexed two throwaway checkouts of one file each in the tests and read no corpus. The full suite is 19 341 passing tests,
`packages/intelligence/src/search/engine-for-store.ts` is at 100 % on all four dimensions, and
`packages/cli/src/commands/search.ts` is at 100 % statements/functions/lines and 95.6 % branches — the two branches that
remain are `??` defaults on values the indexing tool always supplies.

### 43.6 The CLI does not depend on the MCP server, and the image found out first

The first version of this iteration had `code-analyzer search` index its checkout by calling the `analyze_repository`
**MCP tool**. It passed every test in the suite and the CLI image's smoke test failed:

```
Error: Cannot find module '@code-analyzer/mcp'
- /app/packages/cli/dist/commands/search.js
```

**The Dockerfile was right and the code was wrong.** The CLI stage copies `core`, `shared`, `infra`, `analyzer`,
`intelligence` and `cli` — it has never copied `mcp`, because a command-line tool that answers one question about one
directory has no use for a graph server and a transport. `packages/cli/package.json` listed `@code-analyzer/mcp` as a
dependency that **no source file imported**, so the declaration was a lie that nothing read: the tests ran from the
workspace where every package resolves, and only the image asked what the package actually needed.

**The fix is not a `COPY` line.** `persistGraph` — the function that remaps pipeline ids into store ids and reports what
was taken — moved from `packages/mcp/src/tools/indexing-lifecycle.ts` to
`packages/analyzer/src/pipeline/persist-graph.ts`, where it sits beside the pipeline that produces its input and the
package that already declares a dependency on the store it writes. The MCP tool imports it; the CLI imports it; the
context builder (`buildPipelineContext`) and the phase loader became shared exports of `commands/analyze.ts` so that the
two commands cannot disagree about what a checkout is or how it is configured.

**Three consequences worth stating**, because each of them was a defect that the image caught and the suite did not:

1. **A declared dependency that nothing imports is not a dependency, it is a claim.** Nothing checks that
   `package.json` describes what `src/` needs, and a workspace resolves everything, so only a production image can
   answer it.
2. **`formatSearchResult` printed `Found: 0 results` before the error**, so a user whose directory had not been indexed
   read the count, believed it, and stopped. The error now comes first — a sentence about the run rather than a sentence
   about the question.
3. **The dead command still exited 0 in the empty-checkout case**, because `tail` had swallowed the exit code in the
   manual check. Run without a pipe it exits 1, which is what `process.exit(result.success ? 0 : 1)` says and what the
   suite asserts.
