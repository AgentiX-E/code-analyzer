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
`benchmarks/aacr-checklist-paired.json`; the default configuration's figure is `benchmarks/aacr-bench.json`.

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
