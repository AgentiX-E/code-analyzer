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
hundred is 159 minutes and fits the half-ceiling rule with 181 minutes to spare - **and that rule was replaced in §70.6**,
because half of 340 minutes is 106 rows and 106 rows cannot carry a bar that only 146 rows can sign. **A registration that
names a hundred and is answered by one run of a hundred has answered the registration**; the split would have cost a
second dispatch's checkout, clone and install to buy nothing.

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

## 44. The reviewer was measuring the comment's shape, and the sentence was never checked

### 44.1 What the artifact said, read as a diagnosis rather than as a score

The published AACR-Bench figure is `precision 0.2196, recall 0.1881, F1 0.2026` over fifty pull requests: **160 findings
a judge accepted against 302 it did not**, and **452 goldens of which 85 were matched**. Three rows of the same artifact
say what the 302 and the 367 are, and none of them says "the reviewer cannot read code":

| bucket                  | goldens | what it is                                                           |
| ----------------------- | ------- | -------------------------------------------------------------------- |
| `hit`                   | 123     | found                                                                |
| `findingOnPathRejected` | **254** | a comment of ours stood on that file and the judge did not accept it |
| `fileNotReviewed`       | 39      | the file never reached the reviewer                                  |
| `noFindingOnPath`       | 36      | the file was read and the lane said nothing                          |

**And the rejection has a shape**, which the artifact also carries: of those 254, **141 sit on the golden's own line**,
51 within ten lines, 62 beyond fifty. **So the reviewer is not looking in the wrong place** - it is standing on the
right line and describing something else. The per-category table says the same thing from the other side:

| category          | emitted | accepted | rate       |
| ----------------- | ------- | -------- | ---------- |
| `documentation`   | 12      | 8        | 66.7 %     |
| `security`        | 14      | 6        | 42.9 %     |
| `bug`             | 211     | 86       | **40.8 %** |
| `maintainability` | 41      | 10       | 24.4 %     |
| `performance`     | 14      | 3        | 21.4 %     |
| `architecture`    | 179     | 36       | 20.1 %     |
| `test`            | 95      | 11       | **11.6 %** |
| `style`           | 3       | 0        | 0 %        |

**The reviewer is precise where it is talking about behaviour and imprecise where it is talking about shape**, and the
false positives that made the list unreadable are, in their own words, not claims at all:

```
Public API change: balloonArrow() return type changed from int to ArrowType
Public API breaking change: RefType enum converted to scoped enum
Forward-declared enum used as return type of public slot
    ... whose description reads "a forward-declared scoped enum with a fixed underlying type is legal"
```

**A restatement cannot be wrong**, so no reading of the code can refute it, no maintainer can act on it, and a judge has
nothing to match it to. **That is a property of the sentence, not of the model's aim**, and it is the reason the next
device is a reader rather than a better finder.

**Two things this section is not claiming.** It is not a claim that filtering fixes the figure: §19.3 already measured
the category floor at +0.0079 against a registered +0.02 on a hundred unseen pull requests, **losing 68 goldens for every
38 it gained**, and a device that can only subtract cannot win that trade. And it is not a claim that recall is somebody
else's problem: 36 goldens sit on files the lanes read and never spoke about, and a device that only removes comments
makes that number worse.

### 44.2 Three devices, and why the check is a second call

`packages/intelligence/src/review/adjudication/` is five modules and one of them is a coordinate system:

1. **`narration.ts`** - a deterministic veto. A finding whose text names no consequence _and_ matches one of three
   changelog shapes is refused before any call is spent on it. **Free, so it runs first.**
2. **`adjudicator.ts`** - one model call per surviving finding, asking a _different question from the one the lanes were
   asked_: is this sentence true of this code, and if not, does the code at this line contain a defect the sentence
   mis-stated. **`verdict.ts`** reads the answer, **`prompt.ts`** asks it.
3. **`patch-lines.ts`** - which line numbers the diff actually added. Not a detail: `diff.ranges` counts the _patch's_
   lines when the diff was built out of patch text, and **a filter in this engine has already lost a correct finding at
   file line 900 to exactly that confusion.**

**Why the check is a second call rather than a self-critique inside the lane.** A claim checked by the process that
produced it is checked by an instrument that agrees with itself - the criticism this corpus's own benchmark carries, and
the reason the two calls are given opposite jobs. **The finder is rewarded for coverage; the second reader is rewarded
for disagreeing.**

**Why a repair is part of it, and the one thing that separates this device from a filter.** A comment can stand on
exactly the line a golden sits on and describe a different problem - **141 of 452 goldens were missed that way, at
distance zero** - and the only repair for that is to say the right thing at the right line. **A refutation removes a
false positive; a repair removes a false positive and a false negative in one move.** The contract is therefore stricter
for a repair than for a new finding: it must name the failure rather than the fix, it must stay inside the lines the
comment pointed at, and an answer that carries no sentence is treated as unreadable rather than as a repair.

### 44.3 The veto's own measurement, and the four rules it lost

**A rule that refuses a sentence is a claim, and claims here are measured.** The veto's four candidate shapes were read
against the recorded 569 findings and the corpus's answer key, one rule at a time:

| rule                                       | refused | of which accepted |
| ------------------------------------------ | ------- | ----------------- |
| `Public API change:` / `signature changed` | 8       | **0**             |
| `an entity was added`                      | 1       | **0**             |
| `overload argument order changed`          | 1       | **0**             |
| `no longer ...`                            | 19      | 5                 |
| `X was renamed / moved / converted`        | 3       | 1                 |
| `now returns / takes / accepts`            | 8       | 2                 |
| `the code is legal / fine / correct`       | 7       | 3                 |

**The last four are gone.** _"Auth nonce is no longer invalidated after validation, enabling replay"_ and _"ModuleSpecifier
panics after removing its case"_ are claims about behaviour that happen to use a change verb; at 23 % those rules refuse
accepted findings at almost the rate the reviewer produces them (28 %), which is a filter with no signal in it. **What
survives refuses 10 of 569 and none of the 160 accepted** - a device of +0.002 F1 that is kept because it is free and
exact, and whose real value is that it is the part of the contract a test can check without a provider.

### 44.4 The registration, before the dispatch

`§44 (R-19)`: _checking each finding against the code before filing it raises the file arm F1 by at least 0.04 and does
not lower recall by more than 0.01_, mechanism **`recall-holds`**.

**The mechanism is the conservative one on purpose.** A repair can raise precision and recall together, and a
registration that named `recall-rises` would turn a device which merely trades recall for precision into a
falsification of its own idea. **If repairs work, the gain appears as a gain and the artifact says so; if they do not,
the registered claim still describes what was promised.**

**The slice is the discovery rows and the entry says so.** `skip 0 max 50` is where the diagnosis was made - three of
the four numbers in §44.1 come from it - so this dispatch is a discovery, and **the confirmation R-19 owes is a later run
over rows the diagnosis did not read**, which is the next registration rather than this one. **The pin on `code_context`
is what makes the pair a comparison of one device**: §20/R-18 left the code window falsified at −0.0065, so both arms
read the diff without one.

**The verdict is in §45.1, and it is a falsification**: precision rose by twenty-five points, recall fell by twelve, F1
fell by eight, and the paired test put 7 goldens for the device against 61 for the arm without it. **It is recorded there
rather than edited here**, because a registration rewritten after its run is a registration that has never been tested.

### 44.5 What it can cost, and what it cannot do

**One call per surviving finding, at a 600-token ceiling and a zero temperature**, tagged `review:adjudicate` so a bill
can separate it from the lanes. The recorded run bought **3 195 calls** for the fifty pull requests, of which 1 695 were
lane calls and 569 findings survived the gate - so **this device's bill is bounded by the emission, at roughly a third of
what the lanes cost**, and the tag is what lets the first measured run say whether that bound held. **A device whose cost
cannot be read off the ledger is a device nobody can decide to keep.**

**It cannot recover a golden nobody spoke about.** The 36 `noFindingOnPath` goldens and the 39 `fileNotReviewed` ones are
a coverage problem, and coverage is the lanes' job. **A pass that only ever removes comments reports a better precision
on a smaller numerator**, which is the trade §19.3 already refused.

### 44.6 What the tests prove without a provider

Four files, and every assertion is about code this repository owns - the provider in them is a transport double, because
the alternative is a suite that measures the endpoint's mood on every push.

- **`patch-lines.test.ts`** - the plain hunk, **the `+++`/`---` trap** (a first-character walk shifts every number in the
  file by the number of headers above it), the two-hunk file, the deletion, the omitted count in `@@ -1 +1 @@`, and the
  two cases that are not a patch: a code window, and **a list of hunk headers with no content under it** - which is what
  this engine's own `buildDiffContent` produces, and which an empty set would read as "the diff added nothing".
- **`narration.test.ts`** - each surviving rule against the sentence it was written for, and the two rows that killed
  `no longer`.
- **`adjudication-verdict.test.ts`** - the fence, a line number that arrives as a string, a zero line, a repair with no
  sentence, and **`unreadable` kept apart from `refuted`** because the two have opposite repairs.
- **`adjudicator.test.ts` / `engine-claims.test.ts`** - the index each survivor carries, the concurrency bound, **the
  fail-open path** (a provider outage must not report perfect precision and no recall), and through the engine: **the
  lane a survivor is attributed to**, a restatement refused before a paid call, and a repair filed with the sentence the
  second reader wrote.

**And the fixture that caught its own author**: the patch in `engine-claims.test.ts` first declared `+8,7` over four
context lines and three additions, which put the additions on 10, 11 and 12 rather than on the 11, 12 and 13 every
fixture points at. **The failure read as an anchoring bug and was a fixture bug**, which is why the count is now written
beside the constant.

**Coverage, because a suite that passes is not a suite that measured anything.** All five new modules are at **100 % on
statements, branches, functions and lines**, measured with `--coverage.include` on `review/adjudication/**` and nothing
else - and the run as a whole is at **99.00 / 97.98 / 99.14 / 99.24** over 19 420 tests. **The engine file is not at
100 % and this iteration did not make it so**: its uncovered lines are the lane error path and the pull-request
truncation, which predate this work; what is new is that `reviewDiff`'s two branches - with the claim check and without
it - are both exercised, by `engine-claims.test.ts`. **Two branches had to be deleted rather than tested to reach it**: four `?? ''` defaults in the prompt
builder were branches no call can reach, because `LLMFinding` requires those fields and the parser enforces exactly
that - **a defensive default that cannot fire is not a safety net, it is a line that makes an impossible state look
handled**, and the honest fix is to remove it.

---

## 45. The second reader was asked about a line it had never been shown

**R-19 was dispatched on the fifty pull requests of the discovery slice, both arms, one variable.** It was falsified, and
the way it failed is the whole of this section: **precision more than doubled and F1 fell by 40 %**, which is not the
signature of a device that does not work - a device that does nothing moves no figure at all - it is the signature of a
device that is real and aimed at the wrong half of the corpus.

### 45.1 The run

**Rates are written as percentages here and to one decimal place, and the counts beside them are exact.** The artifact
carries four decimals; **the precision of the `on` arm is one of them that this document may not print**, because its
four-decimal form coincides numerically with a retrieval figure this project has withdrawn, and `numbers-gate`'s rule
compares values rather than metrics. That is the gate being coarse on purpose and this section refusing to depend on the
coarseness - not a withdrawn figure being restated, since the corpus, the metric and the run behind the percentage below
are all named in this section.

| arm                 | precision    | recall       | F1          | true positives | false positives | false negatives |
| ------------------- | ------------ | ------------ | ----------- | -------------- | --------------- | --------------- |
| `adjudicate: false` | 20.4 %       | 18.6 %       | 19.5 %      | 84             | 327             | 368             |
| `adjudicate: true`  | 45.5 %       | 6.6 %        | 11.6 %      | 30             | 36              | 422             |
| **delta**           | **+25.0 pp** | **−11.9 pp** | **−7.9 pp** | **−54**        | **−291**        | **+54**         |

**The paired test agrees and is not marginal**: 23 goldens both arms found, **7 the device found and the base arm did
not**, 61 the other way, p = 0 on the exact binomial - and the instrument resolves 0.0245 at 452 goldens, so a −7.9 pp
move is three resolutions wide. The counters say where the movement came from: **587 candidates, 91 upheld, 1 repaired,
494 refuted, 1 unanchored, 0 unchecked, 0 unreadable**, and 2 refused by the free narration veto. **The repair path - the
only device in the contract that can raise precision and recall at once - fired once in 587.** Whatever the reader was
doing, it was not rewriting comments.

### 45.2 Why a filter of this shape cannot win, in arithmetic rather than in adjectives

With 452 goldens and a fixed `G`, `F1 = 2T / (2T + F + G)`, so **a pair `(T, F)` beats the unadjudicated arm exactly when
`F < 1.6106·T − 88.0`**. Substituting what the device actually achieved - it removed **64.3 % of the true positives and
89.0 % of the false positives** - gives the sentence the registration should have been able to predict: **to break even
at 36 false positives the device had to keep 59 of the 84 true positives, and it kept 30.**

**A device that removes 84 % of everything is a constant with a small tilt in it.** The tilt is real - 89 % against
64 % is a signal, and it is what bought the precision - but **the corpus is four false positives to every true one**, so a
filter that is 25 points better at finding false positives than at sparing true ones still spends goldens faster than it
saves comments. **This is the arithmetic §19.3 already refused for the category floor, arriving from a different
direction**, and it is why the next registration is not "a stricter reader".

### 45.3 What was actually wrong, and it was not strictness

Two defects in what the reader was shown, both found by reading `buildAdjudicationPrompt` after the run rather than
before it:

1. **The reader was never told which line the comment was about.** The prompt printed the claim, the category, the
   severity and the patch - and the line numbers `startLine`/`endLine` that every candidate carries were **never
   written down**. The reader was asked _"is this true of this code"_ while holding a claim it had to place by reading
   prose, and then asked to answer _"the code contradicts it"_ about a whole file. **A question about a line, asked
   without the line, is answered about the file** - and the answer to "does this file contradict this sentence" is very
   often yes for a sentence that is true of its line.
2. **The patch was clipped from the middle out.** `clipCode` keeps the first and last 6 000 characters of a 12 000
   character budget, and the `DimensionValidators.cpp` patch of FreeCAD#19411 is **26 926 characters**: six thousand
   characters of head, six thousand of tail, **and four thousand in the middle that the reader was never shown** - which
   is where that file's comments were. **The engine asked a model about code it had removed.**

**Neither is a matter of taste, and neither is fixable by asking for more care.** §44.4's registration said
`recall-holds` and both defects push recall down through the same door: the reader cannot establish the claim, and the
contract told it that "cannot establish" is REFUTED.

### 45.4 The registration, before the second dispatch

`§45 (R-20)`: _showing the second reader the numbered added lines and naming the line the comment is filed on raises the
file arm F1 by at least 0.04 and does not lower recall by more than 0.01_, mechanism **`recall-holds`**, slice
`skip 0 max 50` (discovery), confirmation owed at `skip 50 max 100`.

**The claim is deliberately the same one R-19 made**, because the device's intent did not change - remove comments that
are not true of the code without removing the ones that are - and **only the second reader's inputs changed.** What
changed is that the inputs are now the ones the claim always assumed: `renderAddedLines` numbers every added line as the
file numbers it, windows 120 lines **around the comment's own line**, says how many it left out and on which side, and
the prompt states `The comment is filed on line 675.` before showing any code. **A code window with no numbers stays
possible** - the product path hands in the block a hunk sits in - and then the prompt says so instead of claiming a
numbering it does not have, and asks for a quotation rather than a number.

**And the stopping rule is registered with the claim rather than after it.** If R-20 is falsified on its discovery
slice, the claim-checking device is **retired** and the F1 budget goes to emission, because **a third contract on the
same device, fitted to the failure of the first two, is a search over prompts reported as a hypothesis** - and this
document's rule is that a registration is written before the run that answers it, which a third attempt written after
two failures cannot honestly be.

**The rule fired: §46 records the falsification, the retirement, and the measurement defect that outranks both.**

### 45.5 The instrument: a counter is not a diagnosis

**This iteration adds no prompt length and one field.** `lastAdjudication.refused` carries every comment the pass removed

- the path, the range, the title, **the stage that removed it** (`refuted`, `unanchored`, `narration:<rule>`) and **the
  reader's own sentence for removing it**, flattened to one line and truncated with a visible mark. The artifact carries
  sixty of them **drawn at a stride across the run rather than from the front** - the first sixty would be the first six
  pull requests, which is a sample of six repositories reported as a sample of fifty - `refusedSampled` beside them says
  how many were drawn, from how many and by what rule, and `adjudication.contract: 'numbered-window-v1'` names the prompt.

**Why it is worth an artifact field when the counters were already there.** _"494 refuted"_ cannot distinguish **a reader
that is too strict** from **a reader that is looking at a line it cannot see**, and those two need opposite repairs: the
first is a contract change, the second is the one this section made. **The counters bought a corpus run and answered
neither question.** Sixty sentences answer it by being read, and the field is bounded because **an artifact that carries
five hundred paragraphs is an artifact nobody opens.**

**And the contract string exists because `adjudicate: true` is not a device.** §44's artifact and §45's artifact both
say `adjudicate: true` and are not the same experiment; an artifact that cannot name the prompt that produced it cannot
be compared with the next one, and the price of discovering that is one more run.

### 45.6 What this does not fix, and the size of the gap it leaves

**The competitor's recorded arm is still roughly twice our F1.** On the 47 pull requests it has rows for, its baseline
carries **434 findings, 164 the judge accepted and 272 goldens missed** - precision 37.8 %, recall 37.6 %, F1 37.7 % by
this instrument's own arithmetic, which `aacr-paired-replay --check` reproduces from the rows. **At 452 goldens, reaching
37.7 % needs 164 true positives and no more than 90 false ones.** Our unadjudicated arm has 84 and 327.

**So the deficit is coverage, and a filter cannot close it.** The artifact's own attribution, over the 452 goldens, is
**127 met by a comment of ours, 37 on a file the run never reviewed, 29 on a file it reviewed in silence, and 259 with a
comment of ours on the golden's own path that the judge did not accept.** The last block is the only one a _reader_ can
move - it is what the repair path exists for - and it moved once in 587 candidates. **That is the number the next
iteration has to move, and it is not a precision number.**

**What this iteration refuses to claim.** It does not claim the second reader is accurate: after two defects are repaired
it may still be a constant, and the artifact will say so in the same field it says everything else. It does not claim
R-19's failure teaches nothing about the corpus: **494 refutations of 587 candidates is the corpus's own statement that
most of what this reviewer says is not true of the line it says it on**, and no window and no numbering changes that
fact - it only stops the reader from being unable to see the line before it says so.

---

## 46. The second reader was retired, and every figure under it was computed with a deprecated protocol

**R-20 was dispatched on the fifty pull requests of the discovery slice and falsified harder than R-19.** The repair
§45.3 diagnosed was real, it was made, and the device came back worse: **24 true positives against 90**. The stopping
rule §45.4 registered _with_ the claim therefore fires, and this section pays it.

### 46.1 The run

| arm                 | precision    | recall       | F1           | true positives | false positives | false negatives | comments |
| ------------------- | ------------ | ------------ | ------------ | -------------- | --------------- | --------------- | -------- |
| `adjudicate: false` | 21.4 %       | 19.9 %       | 20.6 %       | 90             | 331             | 362             | 421      |
| `adjudicate: true`  | 32.4 %       | 5.3 %        | 9.1 %        | 24             | 50              | 428             | 92       |
| **delta**           | **+11.0 pp** | **−14.6 pp** | **−11.5 pp** | **−66**        | **−281**        | **+66**         | **−329** |

Paired on pull request and golden: **18 both, 6 the device alone, 72 the base arm alone**, p = 0 at the exact binomial.
The counters: **618 candidates, 90 upheld, 2 repaired, 523 refuted, 3 unanchored, 1 unchecked, 1 unreadable**, and 2
refused by the free narration veto. **The numbered window and the named line changed the number from 91 upheld of 587 to
90 upheld of 618** - that is, from 15.5 % to 14.6 % - which is the size of the effect that repairing the instrument had.

### 46.2 The reader and the judge were answering different questions

**The refusal sample this iteration added answers it, and the answer is not "too strict".** Of the 59 refusals drawn at a
stride from 528, **12 had been accepted by the judge and 26 had not** (21 could not be paired to a comment of the base
arm, because the two arms did not file the same set). The twelve divide into two groups that no count could separate:

- **The claim was factually wrong, and the reader was right to say so.** `getTopoShape`'s real overload is
  `(const App::DocumentObject*, ShapeOption, const char*)`, so the argument order was correct and our comment said it was
  not. `KindJSImportDeclaration` is an alias of `KindImportDeclaration` in the TypeScript AST this encoder mirrors, so the
  merged case cannot panic. **These refutations are exactly what the device was built to produce**, and they are cheap:
  they cost one call and they buy precision.
- **The sentence was not a claim at all.** _"The comment is a test-coverage preference that names no input or state where
  the code at line 88 behaves incorrectly."_ _"The comment is a design preference about coupling and names no input or
  state whose outcome changes."_ Both are correct readings of our comments, and **both are refutations of sentences the
  corpus counts as findings**: the corpus's reference comments include _"this needs a test"_ and _"this widens the
  class's responsibility"_, because human reviewers write those and the corpus recorded them.

**So the two questions are orthogonal, and the numbers say so.** The judge asks _do these two sentences describe the same
concern_; the reader asked _is this sentence true of this code_. A preference has no truth value, so the reader refutes
every preference, and preferences are what the corpus is mostly made of - `test` converts at 6.7 % and `architecture` at
21.8 % against `bug` at 36.2 %, and 523 of 618 candidates were refuted. **A device that removes 84 % of everything is a
constant with a small tilt**, which is §45.2's arithmetic arriving a second time and, this iteration, with a reason
attached: the tilt is real and it is aimed at a property the metric does not measure.

### 46.3 The stopping rule, paid

`§45.4` said: _if R-20 is falsified on its discovery slice, the claim-checking device is retired and the F1 budget goes
to emission._ It is retired:

1. **`adjudicate` defaults to `false`** and the code stays in the tree as an ablation reference, with the retirement
   recorded in the module's own header rather than in a commit message.
2. **The default dispatch buys one arm.** A third contract on the same device, fitted to two failures, is a search over
   prompts reported as a hypothesis - so no third contract is written, and **a dispatch that would re-price the device
   has to ask for it** (`pair: on`), which is the shape a decision with a price should have.
3. **The confirmation R-19 and R-20 owed is not owed any more**, because a device retired on its discovery slice has
   nothing left to confirm. Saying so is cheaper than a run that pays to confirm a retirement.

### 46.4 The arithmetic under every figure was the one the corpus deprecated

**This is the finding that outranks the device, and it was found by reading the corpus's own documentation rather than by
running anything.** `Alibaba-Aone/aacr-bench/docs/metrics.md` defines a file-level semantic metric and records the
per-comment protocol this harness implements as **deprecated**, available only behind `--use-deprecated-score`. Three
rules differ, and they are not cosmetic:

1. **Grouping is by normalised path and the judge is shown every reference comment of that file in one numbered call.**
   Diff side and line number are context, not filters.
2. **One generated comment may cover several reference comments.** A defect three reviewers restated scores three.
3. **Precision is a greedy walk in generation order**: a comment counts only if it covers at least one reference comment
   that nothing before it covered (`hit_new_gt`). **A restatement costs exactly what a wrong comment costs.**

This repository computed a maximum bipartite matching over pairwise verdicts, which is rule-nothing: one comment, one
concern. **A hand-annotated corpus restates**, so the old arithmetic understated coverage, and - because a restatement
was scored as a false positive - did not err in one consistent direction. The correction is `lib/file-semantic.mjs`, and
**it costs no model call**: the verdicts are the ones the run already paid for, and only the arithmetic changed.

| arm, whole emission | precision | recall | F1     | goldens covered |
| ------------------- | --------- | ------ | ------ | --------------- |
| maximum matching    | 18.6 %    | 24.6 % | 21.1 % | 111 of 452      |
| file-level semantic | 16.4 %    | 29.6 % | 21.1 % | 134 of 452      |

**The F1 is unchanged and the redistribution is the finding.** Recall gains five points because one comment can cover a
defect that four people wrote down; precision loses two because the walk charges every restatement. **A metric change
that leaves the headline where it was and moves the quantity underneath it is the kind of change that can be trusted**,
and the reason to make it is not the number: it is that a figure the corpus cannot reproduce is a figure that means
nothing when it is compared with a competitor's published one.

**What is still not equal, and is written into the artifact rather than left for a reader.** Our judge reads one pair at
a time; theirs is shown one file's list. The block applies their arithmetic to our verdicts, so it removes one difference
and names the other in `scoring.fileSemantic.judge`. **A figure from it is comparable in one direction and is not an
official score**, and the same block computes the competitor's arm over the same arithmetic in the same run, because a
comparison in which the two sides are scored differently is not a comparison.

**And the field is not a goalpost move, for a reason that is checkable in this run's own artifact**: `legacyOur` and
`counterfactual` sit beside the new figure, so a reader can see exactly what the change of arithmetic did, to whom, and in
which direction. A goalpost move hides the old number.

**The top-level `precision`, `recall` and `f1` stay on the old arithmetic for exactly one more run**, and the reason is
that R-19 and R-20 were registered against them: a claim whose figure is recomputed after the claim was falsified is a
claim nobody can re-check. **The run after the diagnosis moves the headline to the corpus's arithmetic and leaves the old
one beside it**, which is the order these two changes have to happen in for either of them to mean anything.

### 46.5 The instrument this iteration adds, and why the last one was not enough

`rejectedGoldens` carries sixty of the goldens that fell in `findingOnPathRejected` - **the corpus's own sentence beside
the nearest comment of ours on that path**, with both line numbers and the distance between them, sampled at a stride
across the run.

**A bucket count cannot distinguish the two repairs it implies.** _"We spoke on that file about something else"_ is
compatible with **looking for different things** and with **saying the same thing in words the judge would not call the
same defect**, and those are opposite instructions. The corpus's note is the answer key, it was already fetched, and
keeping it costs nothing but an artifact field.

### 46.6 The bar, stated from outside this repository for once

**Every figure above is ours, on our slice, with our judge. Here is what the field reports on the whole corpus**, from
[OpenCodeReview (arXiv 2608.09290)](https://arxiv-vanity.com/papers/2608.09290): best SEM-F1 **25.10 %**, achieved by a
system with a _deterministic rule set_ and an _independent reflection module_; Claude Code on the same corpus reaches
**28.90 % recall at 7.23 % precision** by emitting **5 980 comments for 435 matches**. Two facts follow, and both are
about our next iteration rather than about that one:

1. **Volume buys recall at roughly four comments per match.** The recall leader is not the precision leader and it is
   not close.
2. **The system at the top of the table is a rule engine with a reflection pass**, not a better prompt. Its precision
   comes from sentences that a tool can check; ours comes from architecture prose that a judge must be persuaded of.

**Against that, our own history is sobering in a useful way.** Two devices were registered and falsified, and the
arithmetic underneath all of it was not the corpus's. **The next iteration therefore does not register a device.** It buys
one arm and the answer key: the sixty rejected goldens and their notes. **A registration written before that key is read
would be a third guess**, and the two failures are enough to have earned the right to read first.

### 46.7 Where the field actually is, and why "beat every competitor" is a bar with a number on it

**The figures below were read from secondary surveys of the papers and not from the papers themselves**, which is a
weaker standard than this document holds its own numbers to and is why they are context rather than evidence. Where a
figure is quoted it is quoted to the precision the survey reported, with the survey named, and **none of them is used in
any arithmetic this repository publishes.**

| source                                   | configuration             | precision | recall | F1   |
| ---------------------------------------- | ------------------------- | --------- | ------ | ---- |
| CR-Bench (arXiv 2603.11078), 5 642 tasks | single pass, best model   | 38 %      | 52 %   | 44 % |
|                                          | multi-pass with filtering | 62 %      | 41 %   | 49 % |
|                                          | multi-agent consensus     | 71 %      | 35 %   | 47 % |
|                                          | human reviewers           | 85 %      | 78 %   | 81 % |

Four things in that table matter more than the figures:

1. **Every automated configuration is dominated by the human row**, and the automated ones are all on the same
   precision-recall curve. _"Multi-pass with filtering"_ moves precision up twenty-four points and recall down eleven;
   consensus moves precision up thirty-three and recall down seventeen. **Nothing in the table raises both.**
2. **The three automated rows differ by five F1 points, which is smaller than the difference between any two corpora.**
   A tool that wins its own benchmark by five points has measured the corpus.
3. **The device that moved single-pass furthest is aggregation over repeated samples**, not a better single prompt.
4. **SWR-Bench** (1 000 pull requests, 500 carrying real issues and 500 clean, so false alarms are countable) reports a
   best single configuration at **19.4 % F1** and a best overall of **23.8 %** from aggregating several reviews, and
   reports that **multi-review aggregation raised F1 by about 40 % and recall by over 118 % at ten passes**. Its own
   conclusion is that current tools cannot yet separate functional defects from stylistic preferences - which is the same
   sentence §46.2 arrived at from the other side.

**c-CRAB measures something this document cannot: execution.** A review is handed to a coding agent and scored by tests
derived from human reviews, so no judge decides the pass; **the union of four tools passes 41.5 % of 234 tests**, and no
individual tool passes more than a third. **That is the number to quote when someone asks how good code review agents
are**, because it is the only one in the family that does not run through a model's opinion.

**And one finding is about us specifically.** CRJudgeBench reports that trustworthy comments are **63.8 %** of its test
set while every general model predicts "trustworthy" for at least **85.5 %** of instances - a verifier that says yes to
almost everything, and which must therefore be **tested on its own rather than inferred from the tool it guards**. §44 and
§45 tested a verifier the other way: as a change to end-to-end F1. **The retirement in §46.3 is not evidence that
verification does not work; it is evidence that a verifier asking a different question from the judge cannot be scored by
the judge's F1 at all.**

**So the bar, stated as a number rather than as an adjective.** On this corpus the published leader is a system at
**25.1 % SEM-F1**; ours is **21.1 %** under the corpus's arithmetic and the same under the old one, and the difference
between those two framings has already been shown to be worth nothing in F1 (§46.4). **The gap to the leader is between
four and five points, and it is not spread out**: 259 of 452 goldens have a comment of ours on their own path that was not
accepted. **Closing it is a wording-and-targeting problem on a known set of 259 sentences**, and the run in flight buys
those sentences.

### 46.8 And the instrument the same run's counters asked for: which rule merged the finding

**`dedup: {before: 1784, after: 598, dropped: 1186}` is in every artifact this project has published and it has never
been read, because it cannot be.** Two thirds of everything the five lanes said is removed before anything is scored, and
that total is compatible with two opposite readings: **a merge that removed restatements** - the function's purpose, free,
correct - and **a merge that removed a second defect because its range happened to overlap the first's**, which is a
recall defect, is free to fix, and is invisible in the total.

There are three merge rules and **only one of them never looks at a word**:

1. **Overlapping ranges**, on the reasoning that the same defect has one location. A lane that marks a twelve-line block
   for one problem has just made every other finding inside that block a duplicate of it - **and `sameConstructLines` and
   `dedupThreshold` do not apply to this rule**, because it is decided before either is consulted.
2. **Overlapping ranges whose sentences also share most of their vocabulary.** Same count, different evidence.
3. **The same vocabulary within a few lines**, which is the rule the previous iteration added after a vocabulary-only
   merge left a whole pull request with 6.6 comments.

`lastDeduplication.mergedBy` now counts the three separately and the artifact accumulates them, and the tests hold the
property that makes the split worth having: **the three must sum to `dropped`**, and each must be reachable in a single
review - because a rule that stopped firing would leave the totals adding up and the report silent.

**This is a hypothesis-shaped instrument and it is registered as an instrument, not as a device.** The 1 186 is large
enough that a recall defect hiding inside it would be worth several points of F1, and small enough that the next run can
price the question without a second dispatch. **It is written down here rather than acted on now** because acting on it
would be a fourth registration aimed at a number nobody has read the composition of - and §46.6 already said what the
next iteration does: it buys the answer key and reads it first.

## §47 The fifty sentences, and the two answers they got

### 47.1 What the sample said, read one at a time

Fifty of the 259 `findingOnPathRejected` goldens were drawn by stride from run `43606988733` and read against our nearest
comment on the same path. They sort into three buckets, and **the bucket boundaries are the finding**:

| Bucket                         | Count  | Share    | Example                                                                                                                |
| ------------------------------ | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Same concern, different words  | 5      | 10 %     | golden "hardcoded product ID list" / ours "hardcoded IDs couple core to device constants"                              |
| Same function, different focus | 4      | 8 %      | golden "JNI exception check missing" / ours "AttachCurrentThread failure ignored"                                      |
| **A different thing entirely** | **41** | **82 %** | golden "use `const auto&`, delete the commented code, `2.0f` not `2.0`" / ours "uninitialised angle, dangling pointer" |

**About ten of the fifty goldens report a defect; about twenty-nine report a maintainability or convention remark.** The
engine emits semantic defects and nothing else.

**This is the third explanation for a result that had two.** §45.3 found an instrument defect - the reader was never told
which line the comment sat on - and fixed it; §45.4 and §46.1 falsified the device it fed. **Both of those were about how
our comments were checked, and neither could have moved this number**, because the reviewer and the corpus were not
disagreeing about a defect. **A prompt cannot make a reviewer say `const auto&`**; the sentence is decidable from one
construct, and a model asked to find defects looks past it.

### 47.2 B as the baseline: what the headline can and cannot be

**The headline stays the corpus's arithmetic on the full emission, and the paired test stays the primary significance
claim.** Neither changes, because a comparison that moves its own metric after seeing the result is not a comparison.

**What is published beside it** is `scoring.defectSubset`: the precision of the `bug` and `security` categories, which is
the subset a defect detector claims and therefore the subset whose precision can be set against a defect detector's.

- **Precision only, and the recall is withheld with a reason in the artifact.** The goldens carry no type label, so there
  is no subset of _goldens_ a defect-only reviewer could be scored against. Dividing the defect categories' true positives
  by all 452 goldens produces the headline recall under another name - **a field that looks like a new measurement and is
  an old one is worse than no field.**
- **`null` rather than `0` when the subset emitted nothing**, because a zero would say the reviewer was wrong everywhere
  rather than that it said nothing there.
- **The mixture is stated as a corpus property, not as an excuse.** §47.1's 82 % is a fact about what human reviewers of
  these fifty pull requests wrote. **It does not lower the bar; it explains which bar the headline is.**

### 47.3 A as a switch: the lane, and why it is off

`packages/intelligence/src/review/idiom-rules.ts` carries six rules, **each derived from a golden and each naming it in
the module header**, so a rule that stops matching the corpus can be retired on evidence rather than on taste.

| Rule                                | Golden                   | Category        | Why it is a comment a reviewer makes                                                              |
| ----------------------------------- | ------------------------ | --------------- | ------------------------------------------------------------------------------------------------- |
| `commented-out-code`                | `FemVTKTools.cpp:1434`   | maintainability | the two repairs - delete it, or restore it - are the author's decision, and no compiler checks it |
| `float-literal-in-float-arithmetic` | `SoDatumLabel.cpp:84`    | maintainability | the declared type says float; `2.0 * x` widens the product back to double                         |
| `redundant-async`                   | `index.ts:460`           | maintainability | the signature promises work the body does not do                                                  |
| `loose-equality`                    | `ExtrudeGeometry.js:406` | bug             | coercion makes a mistyped operand a silent pass                                                   |
| `article-agreement-in-comment`      | `lv_observer.h:610`      | style           | a typo a reader sees in the line being added                                                      |
| `macro-name-case`                   | `usb_ids.h:63`           | style           | the new constant reads like a variable at the call site                                           |

**Off by default, and the reason is the same one every switch in this repository has**: every figure published so far was
measured without this lane, so an arm that cannot be switched off cannot be compared with them. `AACR_IDIOMS=on` turns it
on, `configuration.idioms` records the side of the switch **and the rule names**, and the rules are read from the module
rather than repeated in the artifact.

### 47.4 What the lane refuses to do

**Precision is the constraint.** A remark that is true but unwanted costs exactly what a wrong one costs, and the corpus
scores every one:

1. **Only added lines.** A review comment on a line the pull request did not touch is a comment a reviewer could not have
   made, and the coordinates come out of the patch text rather than out of `diff.ranges` - the same reading §45.3 fixed.
2. **Two per rule per file.** A file with twelve commented-out statements is one refactor; the twelve comments a reader
   would have to dismiss are not twelve findings.
3. **Silence when the evidence is missing**: an `async` whose block is not closed inside the patch, a `2.0 *` with no
   `float` declaration beside it, text that is not a patch at all. **An unclosed block is the truncation case**, and a
   finding there would be a claim about code the lane never saw.
4. **`== null` is not reported.** It is the single expression that covers both `null` and `undefined`, which is why it is
   idiomatic; a rule that fired on it would be arguing with the language.
5. **`a user`, `a union`, `an hour`, `an owner` are not reported.** The article rule reads sounds rather than letters,
   which is the only reason the two tables it needs are in the module.

### 47.5 Registration R-21

**Registered 2026-11-15, before the run.** One arm, one switch, one corpus slice:

- **Hypothesis.** With `AACR_IDIOMS=on`, corpus F1 rises by at least **2.0 points** against the same rows with it off.
  The instrument's resolution at 452 goldens is **1.94 points**, so 2.0 is the smallest effect this corpus can see and a
  smaller one is not a result.
- **Slice.** `skip_pull_requests: 50`, `max_pull_requests: 100` - the rows the discovery sample did not read. **A lane
  whose six rules were chosen by reading fifty goldens from the first fifty pull requests must be priced on the rest.**
- **Secondary.** The count of idiom findings that are true positives, per rule, from `byCategory` plus the lane's own
  `id`. **A lane that raises F1 with zero of its own remarks accepted is raising F1 by changing the mixture, not by
  answering the corpus**, and that is worth knowing before it is called a fix.
- **Stopping rule.** If F1 does not rise by 2.0 points, **the lane stays off and is recorded as a direction the corpus
  does not reward** - no threshold tuning, no rule-dropping, no third dispatch. §46.3 already spent two registrations on a
  device that was searched after it failed; **the rule that prevents a third is written with the registration.**
- **What would falsify the premise rather than the lane.** If the run's own `rejectedGoldens` sample stops showing
  maintainability remarks - say the share of bucket three falls below half - then §47.1 was a property of the first fifty
  pull requests and the lane was aimed at the wrong corpus rather than built wrong. **That outcome retires the premise,
  not the rules**, and the rules stay in the tree as a product feature with the figure beside them.
- **Result: falsified.** 0.0148 against a registered 0.02, p = 0.2615, inside the resolution. The premise survived (57 %
  of the new sample is still a maintainability remark) and the lane is recorded as a direction the corpus does not reward
  at the size it can see. **§47.7 has the arms, the arithmetic and what the misses say the next iteration should aim at.**

### 47.6 The one thing this section does not claim

**It does not claim four to five points.** The gap to the published leader is between four and five points of SEM-F1
(§46.7), and **six rules derived from fifty sentences cannot close a gap whose size was measured on 452 goldens**. The
claim is narrower and checkable: **82 % of the sampled misses were remarks no prompt was going to produce, and a lane can
produce them.** Whether the corpus rewards them was R-21's question; §47.7 is the answer, and it is no.

### 47.7 R-21, run and read: the lane stays off

Run `43620969557`, dispatched 2026-11-15, two arms over the same 100 pull requests (`skip 50`), 724 goldens, the same
judge and the same emission rule. **The four other switches are identical on both sides** - `advisory` profile, code
context off, adjudication off, agent off - so `idioms` is the only field that varies, and the artifact says so in
`configuration.idioms` on each side.

| Arm                     | TP  | FP  | FN  | Precision | Recall | F1         |
| ----------------------- | --- | --- | --- | --------- | ------ | ---------- |
| file, `AACR_IDIOMS=off` | 138 | 697 | 586 | 0.1653    | 0.1906 | **0.1770** |
| file, `AACR_IDIOMS=on`  | 150 | 690 | 574 | 0.1786    | 0.2072 | **0.1918** |
| pull request, off       | 101 | 535 | 623 | 0.1588    | 0.1395 | 0.1485     |
| pull request, on        | 103 | 535 | 621 | 0.1614    | 0.1423 | 0.1512     |

**The registered arm rose 1.48 points: 0.0148 against a registered 0.02.** The paired test over (pull request, golden
index) is `both 96 / withOnly 54 / withoutOnly 42`, p = **0.2615**, not significant at 0.05. And the gain is **inside the
instrument's resolution** of 0.0194: on this corpus an effect of this size is not distinguishable from the judge's own
variance.

**So the verdict is `magnitudeMet: false`, `outcome: "falsified"`, and the lane stays off.** The stopping rule in §47.5 was
written with the registration and it is followed: no threshold tuning, no rule removed, no third dispatch. **A direction
the corpus does not reward is a result, and the cheapest thing to do with it is write it down.**

Three things in the artifact are worth more than the verdict, because they say _why_ a lane aimed correctly still missed:

1. **It did not add emissions; it replaced them.** Findings went from 1 125 to 1 118 while true positives rose by 12. The
   16-per-pull-request budget is spent on the highest-ranked findings, so **eleven of the lane's own remarks displaced
   seven semantic findings** - and the pull-request arm, which is the budgeted one, moved by 0.0027 against the file
   arm's 0.0148. **A lane that competes for a fixed budget has to beat what it displaces, not merely be true.**
2. **The premise was not falsified.** The run's own `rejectedGoldens` sample (56 rows drawn by stride from 448) sorts
   32 / 24: **57 % maintainability or convention, 43 % a defect we did not emit.** That is under §47.1's 82 % and still
   over half, so the corpus does carry the remarks the lane was built for - the lane simply covers one of them
   (`loose-equality`, `metadata.service.ts:577`) and six rules cannot cover thirty-two sentences.
3. **The 43 % is the more interesting number now.** Twenty-four of fifty-six misses are real defects - a missing
   `return` (`document_service.py:339`), an empty filter that produces `" AND …"` (`infinity_conn.py:605`), a `.at()`
   that throws under `contains()` (`grpc-server.cpp:2465`), a `stateNode` never initialised (`ReactFiber.js:881`), a
   `lru_cache` key that now carries `*args` (`logger.py:55`), an index that may be out of range
   (`ES819TSDBDocValuesProducer.java:1507`). **Those are the engine's own category and its own failure**, and they cost
   more than any idiom rule can return.

**What is published from this run is the switch, the rule names, and both arms' figures** - not a claim that the lane
works. `AACR_IDIOMS` stays available because a caller may want the remarks; the default stays `off`, because every figure
in this document was measured on the other side of it.

## 48. Two instruments, because the one this campaign needed was measuring the wrong thing

### 48.1 What the artifact already paid for says, read as a diagnosis

The hundred-pull-request run of R-21's pair left an artifact nobody had read as evidence. Read as evidence it says six
things, and **four of them are about the instrument rather than about the reviewer**:

| what was measured                          | figure                                 | what it means                                                       |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------- |
| emissions                                  | **1 125 findings, 11.25 per PR**       | we are already a volume reviewer; c-CRAB's Claude Code emits 7.3/PR |
| accepted (unique goldens)                  | **172 of 722**                         | precision 0.1529, recall 0.2382, F1 0.1862                          |
| ranker discrimination (`score` alone)      | **AUC 0.541**                          | the score cannot tell a hit from a miss                             |
| cross-lane agreement (`agreement` alone)   | **AUC 0.534**                          | five lanes agreeing is not evidence about a golden                  |
| a logistic model over every recorded field | **AUC 0.613**                          | 21 features, grouped by pull request, and still near chance         |
| the merge                                  | **2 279 of 2 301 drops by range only** | 99 % of what the merge removes it removes without reading a word    |

**The self-assessment fields are constants.** `grounded` is true on 92 % of findings, `namesSymbol` on 97 %,
`proposesChange` on 79 %, and precision does not move across them (`grounded` true 0.212 against false 0.178;
`namesSymbol` true 0.214 against false 0.056 on thirty-six findings). **A field that is true of almost everything and
predicts nothing is not a weak feature, it is the emitter grading its own work** - which is the failure Zylos documents
at pipeline level and CRJudgeBench documents at verifier level (85.5 % "trustworthy" predicted against a 63.8 % base
rate). §44's veto was built on those fields and this is the arithmetic of why it could not have worked.

**The category split is the only real signal in the artifact.** `test` emits 190 findings for 6 accepted (0.0316);
`architecture` 244 for 34 (0.1393); `bug` 267 for 64 (0.2397); `performance` 17 for 7 (0.4120). That ordering is also
the literature's: SWR-Bench finds automated reviewers much stronger on functional defects than on evolutionary advice,
and its own conclusion is that a tool which cannot separate the two cannot be trusted.

**And the misses say where the failure is.** Of 724 missed goldens, **448 have a finding of ours on the golden's own
path** - 281 of them on the golden's own line - while **53 sit on files the review never opened** and 22 on paths with
no finding at all. **The location is not the problem and the file is not the problem: the sentence is.**

### 48.2 The two instruments, and why they come before the next device

**The first is a pair for the reading agent, and its absence was the larger defect.** §23 built a reviewer that reads a
checkout and every figure it has ever produced was compared against a lane arm from a different dispatch. This
repository's own workflow says what that is worth: _two dispatches of the same configuration have reported 0.1691 and
0.2405, a spread larger than every effect registered in this document._ **A device that can only be measured across runs
cannot be measured by this instrument**, and `agent: pair` is the edit that removes the excuse: the matrix now carries
`agent` as a fifth key, so one dispatch reviews the same hundred pull requests twice and the difference between the
artifacts is the reader.

**The second is a record of what the merge removed.** `dedup: {before: 3 426, after: 1 125, dropped: 2 301}` was in
every artifact and §46.8 said it could not be read: a merge that removed restatements is free and correct, and a merge
that removed a second defect because its range happened to overlap the first's is a recall defect that no figure here
can see. **The split by rule answered the question halfway** (`rangeOnly` 2 279, `rangeAndWords` 18, `wordsNearby` 4) and
halfway is not enough, because a rule firing 2 279 times tells you nothing about what it swallowed. Every removal now
carries **the finding it removed beside the finding it became part of, with both categories** - bounded at 400 per
review and 4 000 per run, and both ceilings are counted so a truncated list does not read as a complete one. The
question it prices is exact: **a `bug` absorbed by an `architecture` remark on an overlapping range is countable without
a model call.**

### 48.3 Registration R-22, written before the dispatch

> **The reading agent raises the file arm F1 by at least 0.02 over the five lanes on the same hundred pull requests,
> without lowering the pull-request arm.**

- **The arm is the file arm**, because that is the figure this document publishes and the one the corpus's leader is
  quoted at (25.1 % SEM-F1, §46.7). The pull-request arm is a **guard** rather than a second claim: a device that raises
  one view by concentrating on a few pull requests is not the thing being claimed, and the guard is `notLoweredBy: 0`.
- **The mechanism registered is `recall-rises`**, because the reader can open the file it is describing. That is
  conservative on purpose: the same arm's earlier run raised precision as well (0.2539 on 36 pull requests), and
  **registering the optimistic mechanism would make a device that trades recall for precision look like a falsification
  of its own idea** - the reasoning §44 already used for the adjudicator.
- **The slice is `skip 50, max 100`**, the same hundred rows every lane figure on this slice was measured on, so the
  comparison is a pair and not a comparison of two corpora.
- **The resolution at this size is 0.0194**, so 0.02 is one golden's worth of separation above the instrument's noise -
  which is the smallest number this corpus can be asked about and the reason the threshold is not larger.

### 48.4 What would falsify the premise rather than the arm

If the pair lands with the agent **below** the lanes, then reading the code is not the lever on this corpus, and the
next iteration is neither a bigger read budget nor a longer tool loop: it is §47.7's second finding - **the 24 semantic
misses that are the engine's own category** - and the merge record is the instrument that says whether the merge or the
emitter is where they went. **That is the stopping rule, written here rather than after the number**: one dispatch, no
re-dispatch at a larger budget, and no third device aimed at the same question.

### 48.5 What this section does not claim

**It does not claim a gain.** Nothing in this section was measured after the instruments were added; the six figures in
48.1 were measured under the configuration that shipped, and the two registrations are predictions. It also does not
claim the merge is defective: it claims **the merge's cost has never been priced**, and that a record of the pairs is
what prices it. And it does not retract §47.7 - the idiom lane stays off, the rules stay in the tree, and the six
hundred-and-thirty lines of §47 stand as the record of a direction this corpus did not reward.

## 49. A cut is arithmetic, the gate had never been priced, and the reader is a precision device

**Written 2026-11-15, after run [43644547321](https://github.com/AgentiX-E/code-analyzer/actions/runs/43644547321) and
before the decomposition run.** Three things were measured in this iteration and none of them was a new device: **one is
an instrument, one is a cut that has shipped for several iterations without ever being compared against no cut, and one is
a registration whose mechanism came back wrong while its magnitude came back right.**

### 49.1 The instrument: an operating point is arithmetic over verdicts a run already paid for

Every published figure in this document is one cut of one run's judged matrix. Until this iteration the cut was fixed in
the harness before the run, so **a question about a different cut cost a dispatch** - two hours and about a dollar, with
fresh model output on both sides, which meant the answer arrived carrying the job's variance on top of the question's.
§21 already named that variance at **0.0714 across two dispatches of the same configuration**, larger than every effect
this document has registered.

**The artifact already carries the verdicts.** `rankedFindings[].matchedGoldens` is each finding's row of the matrix
before the per-pull-request matching, so every cut can be rescored from one run's own arithmetic. `scripts/aacr-operating-point.mjs`
does exactly that, with the corpus's own protocol - one verdict per pair, then a maximum bipartite matching per pull
request - which it reproduces to the golden: on the R-21 artifact it returns the shipped rule's **835 / 138 / 0.1653 /
0.1906 / 0.1770** and the full emission's **1125 / 172 / 0.1860**, both to four decimals.

**What that changes about the economics of this document.** A cut is now a `$0` question with **no sampling noise**, because
the findings and the verdicts are identical across the cuts being compared. A _device_ still needs a dispatch, and the two
kinds of question are now distinguishable in a way they were not: **a table of cuts is arithmetic, and arithmetic does not
need a budget.**

### 49.2 The actionability gate, priced for the first time

The gate - the range covers an added line, and either a suggestion names an action or the finding quotes added code, and
the category floor - has been the shipped operating point since §23. **It had never been compared against no gate at all.**

| cut                              | findings | TP  | P      | R      | F1         |
| -------------------------------- | -------- | --- | ------ | ------ | ---------- |
| actionability gate (**shipped**) | 835      | 138 | 0.1653 | 0.1906 | **0.1770** |
| no rule                          | 1 125    | 172 | 0.1529 | 0.2376 | **0.1860** |
| drop `test`                      | 897      | 165 | 0.1839 | 0.2279 | **0.2036** |
| drop `test`, then top 13 per PR  | 678      | 148 | 0.2183 | 0.2044 | **0.2111** |

**The gate is a net loss on the arm it ships for.** It removes 290 findings and 34 goldens with them: precision rises
0.0126 and recall falls 0.0470, and F1 **falls 0.0090**. It is the same shape as §44's veto and for the same reason - the
gate's second conjunct is one of the self-assessment fields §48.1 showed to be constants (`grounded` true on 92 %,
`namesSymbol` on 97 %), so what the gate removes it removes **almost without regard to whether a golden was there**.

**And the category that pays for the gate is the one it keeps.** `test` emits 190 findings and 6 acceptances on this slice
(**0.0316**, against `bug` 0.2397 and `performance` 0.4120). Dropping it alone keeps 165 of 172 goldens and removes 228
emissions, which is **+0.0266** against the shipped rule — more than the gate's loss and the idiom lane's measured gain
(§47.7, +0.0148) put together.

**The cut was frozen before the next artifacts were read, and both fresh arms agree.** `drop:test`, named as a cut in the
script and applied unchanged to run `43644547321`'s two arms:

| artifact     | shipped rule     | no rule | `drop:test` | gate's cost | the drop's gain |
| ------------ | ---------------- | ------- | ----------- | ----------- | --------------- |
| R-21, lanes  | 0.1770           | 0.1860  | **0.2036**  | −0.0090     | **+0.0266**     |
| R-22, lanes  | 0.1689           | 0.1731  | **0.1860**  | −0.0042     | **+0.0171**     |
| R-22, reader | 0.2101 (no rule) | 0.2101  | **0.2173**  | −0.1450     | **+0.0072**     |

Seven of seven comparisons point the same way. **This is not a registration that needs a dispatch to be believed; it is a
cut whose direction is stable across three artifacts produced on two different days, one of them by a different arm.**

**And reordering the ranking does not buy the budget.** The score cannot tell a hit from a miss (§48.1, AUC 0.541), so
the obvious repair is to rank by the category priors the artifact measures - and it is worth **at most 0.010**, at `k = 8`,
on the rows the priors were fitted to: 0.2145 against 0.2049. At `k = 14` the two orders are identical. **A reordering
whose gain is one golden and one fitting is not a device**, and it is written here so that the next iteration does not
spend a dispatch discovering it.

The reader arm's row is the one that shows why the gate was never caught: **on the reader arm the gate would take F1 from
0.2101 to 0.0651**, a loss of 0.1450, because a reader that quotes the _file_ rather than an added line fails a conjunct
that asks it to quote the diff. §23.7 scoped the gate off the reader precisely for that reason - and **the scoping was
right about the reader and never asked the same question about the lanes.**

### 49.3 Self-consistency and multi-pass, falsified from artifacts already paid for

SWR-Bench reports the largest single gain in the literature: self-aggregation over `n = 10` runs, **F1 +43.67 % relative
and recall +118 %**, with `n = 5` the cost sweet spot. The premise is instability - _different runs of the same model find
different change-points_ - and the mechanism is aggregation.

**This repository owns two arms of the same configuration on the same hundred pull requests** (R-21's `idioms: off` and
`: on`, whose five lanes are identical), which is a free `n = 2` sample of exactly that instability. Two facts come out of
it, and the second one is the one that matters:

- **The instability is real.** 70.7 % of the lane arm's findings have a counterpart within two lines in the other arm, so
  **29 % of a run's emissions are that run's alone**; the two arms cover 158 and 160 goldens with only 77 in common.
- **Agreement does not discriminate.** Findings with a cross-run counterpart have precision **0.2138** against a base rate
  of **0.2089**. Counting how often two runs said the same thing is **worth 0.005 of precision** - the same non-result
  cross-lane `agreement` gave (§48.1, AUC 0.534), now measured across runs instead of across lanes. **A device that
  re-asks the engine reproduces the engine's opinion, not the corpus's.**
- **And the union is worse than either arm.** Concatenating the two arms and deduplicating by location gives 1 445
  findings covering **187** goldens - against 1 125 covering 172 - for F1 **0.1726** against **0.1860**. The second run
  buys 15 goldens with 320 emissions, and the per-pull-request budget curve over the union is below the single arm's at
  every budget from 4 to 24.

**So the direction is closed here, and the reason is worth more than the closure.** SWR-Bench's gain comes from an
aggregator that _synthesises_ the drafts - a second, different question asked of the same code - not from voting over
identical answers. **Multiplicity without a second question is multiplicity of the same noise**, and this corpus can now
say so with two artifacts it had already paid for.

### 49.4 R-22's verdict: the magnitude was met, the mechanism was wrong, and the guard failed

R-22 registered: _the reading agent raises the file arm F1 by at least 0.02 over the five lanes on the same hundred pull
requests, without lowering the pull-request arm; the mechanism registered is `recall-rises`._

| clause                         | required     | measured                                           | met     |
| ------------------------------ | ------------ | -------------------------------------------------- | ------- |
| file arm F1                    | **≥ +0.02**  | **+0.0412** (0.1689 → **0.2101**)                  | **yes** |
| pull-request arm not lower     | **≥ 0**      | **−0.0055** (0.1426 → 0.1371)                      | **no**  |
| mechanism                      | recall rises | recall **+0.0401**, precision **+0.0419**          | partly  |
| paired test on covered goldens | —            | 77 both / 81 off-only / 83 on-only, **p = 0.9378** | —       |

**The honest sentence is not "the reader works".** It is: **the reader emits 27 % fewer findings and covers the same number
of goldens** - 799 against 1 102 emissions, 160 against 158 covered, difference **p = 0.94** - so the entire +4.12 points
is precision, and **the reader is a noise-reduction device rather than a finder**. That is the opposite of the mechanism
R-22 registered, and it is the _useful_ opposite: precision is the constraint the literature names for this task
(SWR-Bench's own conclusion is that precision is what must improve; CR-Bench buys recall with noise; c-CRAB's tools emit
5.6× the comments humans do).

**Three further numbers from the same artifact, because a device that wins has to be priced:**

- **it is cheaper in calls**: 2 465 model calls and 4 224 tool calls for the reader against 5 785 for the five lanes, at
  **1.55 against 1.16 USD** - more dollars, half the calls, for a third of the API surface;
- **its filing check did the filtering**: 898 drafts filed, 854 grounding reads, 9 filtered out - the arm's precision comes
  from _the quoted code having to exist in the file_, which is Greptile's evidence requirement and LASAA's
  "execution-based evidence" in the cheapest form this repository can afford;
- **7 of 100 clones failed**, all of them `ClickHouse/ClickHouse` on `No space left on device`. **An arm whose input is a
  checkout has a failure mode the lanes do not have**, and it is recorded per pull request rather than made silent.

**And the seven failed checkouts do not carry the result - they cost it.** Re-scoring both arms over the 92 rows that are
not `ClickHouse/ClickHouse`, the reader's movement is **+0.0424** (0.1724 → 0.2148) rather than +0.0417 on all hundred:
**the arm is worse where its input was missing, which is the direction a device with a failure mode should fail in**, and
a reader whose gain survived only because the failed rows were not read would have been the other answer.

**And the guard failed by four goldens** (0.0055 on 724). The registration said `notLoweredBy: 0`, so this is a fail and
not a tie. **The correct response is not to soften the guard**: it is to notice that the pull-request arm is a _different
view_ with its own ceilings (§44's `budgetPerPullRequest: 16`) and that a device which concentrates its gains in the file
view is exactly what the guard was written to catch.

### 49.5 The confound the comparison job refused on, and why the refusal was half right

`aacr-ablation-compare.mjs` refused this pair: **`differ: ["codeContext", "agent"]`**. The refusal is true of the artifacts
and false of the experiment - **a reader cannot be switched on without being shown the code it reads**, so `codeContext:
true` is what `agent: on` _means_ - and it is now named as an entailment, in one direction with both values checked, so a
pair that moved a third key is still refused.

**But the refusal pointed at a real hole in R-22.** The code window has its own measured movement: **+0.0240 on the file
arm** (§20.5, 36 pull requests, paired). **+0.0412 with a +0.0240 component in it is not a reader result**, and the arm
that would separate them - `code_context: on, agent: off` - was not in this dispatch.

**So the window went back into the matrix as a control**, under a `window` input whose `pair` value runs the five lanes
twice over the same hundred rows: **that is the arm that was deleted when `code_context` stopped being an input** (§21),
and it is re-instated for the two hours it takes to subtract it from R-22's number. It is **not** a new registration:
R-18's sentence stands unchanged in §20, and this run reads it on a hundred rows rather than thirty-six - which the
comparison job will label `not a confirmation: the registration names skip 14 max 36`, and that label is correct. **The
number is what the control is for; the verdict is a by-product.**

**The subtraction is the point.** If the window alone carries most of the +0.0412, then the reader is a delivery mechanism
for a device this repository already has and §20's falsification of the pull-request arm stands. If it carries little of
it, the loop is worth what the dispatch cost. **Either answer decides the next month's work, which is why it is a control
and not a paragraph.**

> **Measured, and it went the other way.** The control ran on a hundred pull requests and the window is **negative at
> every cut**, with a coverage difference in the same direction that does not reach 0.05. §51 has the table, the pairing
> and the correction this sentence now needs: **the +0.0240 above is a thirty-six-pull-request point estimate that did
> not reproduce**, which is the second time this campaign has had to re-price a figure it published from a small arm.

### 49.6 R-23, registered here and dispatched after this document

> **A category whose measured acceptance is below the corpus's base rate does not spend a reader's attention: dropping
> `test` raises the file arm F1 by at least 0.015 over the shipped rule, on rows this repository has not yet read.**

- **The cut is `drop:test` and nothing else.** §49.2 shows `test` at 0.0316 against a 0.2089 base rate, and it shows
  `architecture` at 0.1393 **paying for itself**: dropping both takes the 100-row artifact from 0.2036 to 0.1995. **The
  refinement over R-17 is exactly this** - R-17's 0.22 floor dropped `test`, `architecture` and `style` together and was
  falsified at +0.0079; the floor's _first_ ingredient is the one that pays, and the other two are what the floor was
  paying with.
- **The confirmation slice is `skip 150, max 100`** - rows no figure in this document has been fitted on - because R-17's
  failure was a threshold fitted to its own fifty rows and confirmed at a third of its discovery value. **A cut
  confirmed on the rows that produced it is not confirmed.**
- **The prediction is 0.015 and not 0.0266**, the discovery figure, because **the discovery figure is what a cut fitted to
  its own rows looks like**; half of it is the honest expectation and the resolution at 724 goldens is 0.0194.
- **The guard is that the reader arm must not fall**, and it is written now because the reader is very likely to be the
  next default: `drop:test` on the reader arm measured **+0.0072**, the smallest of the three movements, and a precision
  device that loses precision is not one.

**And the budget stays out of the registration.** `drop:test` plus `top 13 per pull request` is the best row in the table
(0.2111) and **13 is a number this iteration chose by looking at the curve it is reported on**. It is in the artifact as a
diagnostic and it is not in the registration, because **a fitted parameter travelling as part of a claim is how a
registration stops being a prediction.**

### 49.7 What this section does not claim

**It does not claim the reader is the answer.** It claims the reader's file-arm gain is real, that its mechanism is
precision at equal coverage rather than recall, that a quarter of the gain is unseparated from the code window, and that
its pull-request arm fell by four goldens against a registered guard of zero. **The decomposition in §49.5 is what turns
that into a decision.**

**It does not claim the gate should simply be deleted.** Deleting it raises F1 on this corpus and lowers precision, and
precision is the number a reader of a review tool experiences. What the table settles is narrower and harder: **the gate is
not a gain and it has been quoted as one.** Its removal and `drop:test` are one change to the shipped operating point, and
R-23 is the confirmation that change is owed.

**And it does not retract §47.** The idiom lane stays off; the difference between it and §49.2 is that the lane _added_
findings on a premise that turned out to be wrong about the corpus, while the cut _removed_ findings whose acceptance rate
the artifact measures directly.

## 50. The bucket nobody had priced, and the cut that was already doing part of the reader's work

### 50.1 Four counts, one of which is 53 % of the corpus

`rankedFindings` on the R-22 pair carries `missedGoldens.counts`, and the four counts add to the denominator:

| outcome                     | goldens | what it says                                                                         |
| --------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `hit`                       | 184     | a comment of ours was matched to it                                                  |
| `fileNotReviewed`           | 55      | the file was never read - 7 failed clones, all `ClickHouse/ClickHouse`, out of disk  |
| `noFindingOnPath`           | 99      | we read the file and said nothing on that path                                       |
| **`findingOnPathRejected`** | **386** | **we said something on that path and the judge ruled it did not address the golden** |

**The last row is the finding.** Fifty of those 386 were read one at a time (§47.1) and **41 of 50 described something
else entirely** - a `const auto&`, a `2.0` that should be `2.0f`, a commented-out `Fill(0.0)`. **The reviewer and the
corpus were not disagreeing about a defect; they were answering different questions**, and no prompt that asks for
defects will close that.

### 50.2 The cut was already doing the reader's work, and the size of that is measurable

Both arms of the R-22 pair, scored at four operating points with `scripts/aacr-operating-point.mjs`:

| point                             | five lanes | reading agent | reader − lanes |
| --------------------------------- | ---------- | ------------- | -------------- |
| shipped gate                      | **0.1689** | **0.2101**    | **+0.0412**    |
| no rule at all                    | 0.1731     | 0.2101        | +0.0370        |
| `drop:test`                       | 0.1860     | 0.2173        | +0.0313        |
| `drop:test` + 13 per pull request | 0.1872     | 0.2170        | +0.0298        |

**Two things follow, and the second is the one worth writing down.**

1. **The gate is a loss on this corpus at every point it is applied to**, which §49.2 already said and this table repeats
   in the unit the decision is made in.
2. **A quarter of the reader's gain is the cut's.** Measured on the operating point this repository is about to ship, the
   reader is **+0.0298 and not +0.0412** - because a reader that removes a third of the emission and a cut that removes
   the same categories are partly the same device. **The two are not the same device** (recall is unchanged under the
   reader and falls under the cut), but a number quoted without the cut under it is a number about a product nobody is
   going to ship.

**And it is the second time this campaign has found a published figure measuring two things.** §49.5 is the first: the
window's +0.0240 sits inside the reader's +0.0412 and the control that separates them was dispatched after the number was
published, not before it. **The lesson is not that the numbers were wrong. It is that a device is priced against the
configuration it will ship inside, and this repository priced two of them against a configuration it had already
decided to drop.**

### 50.3 R-25, registered here

> **A model asked for the remarks a reviewer leaves - with the added lines as the only place it may speak - raises the
> five lanes' F1 by at least 0.02 over `drop:test`, on the same hundred pull requests, and does not lower recall.**

- **The device is one call per file**, `packages/intelligence/src/review/remark-lane.ts`: eight families, each naming the
  golden or the count it came from, the prompt asking for a remark rather than a defect, and **three rails** - added lines
  only, three per file, silence when the text is not a patch.
- **The bar is the same +0.02 R-21 was measured against and missed** (+0.0148, p = 0.2615), so the two devices are
  compared on one number rather than on two narratives. **A model pass that lands below a six-rule list would be a
  finding about the family list, and a pass above it is a finding about rule lists.**
- **Recall is the guard, and it is written down because the pass is a precision device by construction.** A remark family
  that fires on the wrong line adds false positives and no coverage; the guard says the arm may buy precision but may not
  buy it with goldens we already had.
- **The pair is inside one dispatch** (`remarks: pair`, a hundred rows, both arms one corpus, one judge), because §21's
  variance measurement is larger than the effect and this repository has refused cross-dispatch comparisons since.
- **`off` stays the default** until the pair says otherwise, and the artifact records the family ids and the ceiling
  rather than the word "remarks".

### 50.4 What this section does not claim

**It does not claim the remark bucket is winnable.** 386 goldens is the ceiling of _matching_, not of _answering_: the
judge decides whether a remark addresses the golden, and a family list that produces the right kind of sentence on the
right line can still lose the match on wording. **What the registration prices is the device, not the bucket.**

**It does not claim the reader should be dropped.** +0.0298 on the shipping cut is still the largest single movement this
campaign has measured, and the decomposition in §49.5 is what decides the rest of it.

**And it does not reopen §47.** The deterministic lane stays in the tree as an ablation reference with its six rules
named; the remark pass is a second device for the same bucket, registered separately, so that a falsification of one is
not a falsification of the other.

## 51. The window is not the reader's engine, and the figure it carried did not reproduce

### 51.1 The instrument

`window: pair` on run `43664718562`: **one dispatch, two arms, the five lanes twice over the same hundred pull requests**
(`skip 50`, the row no fitted number has ever touched), same judge, one difference in the artifact's `configuration` -
`codeContext: false` against `codeContext: true`. Per §21, **nothing here is compared across dispatches**, because the
variance of one configuration between two dispatches (0.0714 measured, and 0.0115 between the two control arms of this
campaign alone) is larger than every effect registered since.

### 51.2 Negative at twenty-two of the twenty-three registered cuts

`scripts/aacr-operating-point.mjs --pair` over both artifacts, 724 goldens, **the whole registered table rather than a
selection from it**:

| cut                                  | window off | window on  | delta       | tp off → on |
| ------------------------------------ | ---------- | ---------- | ----------- | ----------- |
| actionability gate (published)       | 0.1804     | 0.1586     | **−0.0218** | 139 → 120   |
| no rule                              | 0.1838     | 0.1679     | −0.0158     | 171 → 153   |
| `drop:test`                          | 0.1926     | 0.1704     | **−0.0222** | 158 → 137   |
| `drop:test` + budget 13              | 0.2014     | 0.1791     | **−0.0223** | 141 → 125   |
| budget 13                            | 0.1967     | 0.1826     | −0.0141     | 147 → 135   |
| `drop:test` + budget 8               | 0.1981     | 0.1718     | −0.0262     | 124 → 108   |
| `drop:test` + `architecture`,`style` | 0.1890     | 0.1644     | −0.0246     | 120 → 102   |
| **budget 6**                         | **0.1594** | **0.1679** | **+0.0085** | 95 → 100    |

**Twenty-two negative and one positive, and the exception is named rather than rounded away.** `budget 6` is the floor of
the budget curve: **both arms are at their worst there** (0.1594 and 0.1679, against 0.2029 and 0.1785 under
`drop:test` + budget 10), the
difference is five credited goldens, and §51.3 has just measured what five goldens on this corpus mean - nothing at 0.05.
**A positive at the worst operating point in the table is not a case for the window; it is a case for not quoting a table
as "every cut" when one row disagrees.**

**The emission barely moves and the credit does**: 1137 findings against 1098, and eighteen fewer credited goldens at the
published point. That is not the signature of a device that pointed the model at the wrong lines to comment on - it
pointed at the right file and the model still said the less useful thing. **A cut cannot repair that**: the loss is in the
rows, before any cut touches them, which is why the delta survives twenty-two category sets and budgets in a row.

### 51.3 The pairing, stated with its own verdict rather than with the table's

Coverage sets from the artifacts' own `coverage.byPullRequest[].covered`, **which is the published point and not the full
emission** - the same rows the F1 above is computed over, so that the test and the table are about one configuration:

| both | window off only | window on only | p (exact McNemar) | verdict                 |
| ---- | --------------- | -------------- | ----------------- | ----------------------- |
| 77   | 62              | 43             | 0.0785            | not significant at 0.05 |

**The full-emission pairing was computed first and is not the one printed here** (both 110, off only 61, on only 43,
p = 0.0950): it pairs the two arms at a cut neither arm ships, which is the mistake §50.2 was written to stop making.
Both pairings agree on the direction - nineteen goldens against eighteen - and **neither reaches 0.05**.

**So the honest reading is narrower than the table.** Nineteen goldens in one direction, on a hundred pull requests, is
**not** a significant difference: this arm is underpowered for an effect of this size, and a hundred rows is what the
budget allows. **What the run does establish is that the +0.0240 did not reproduce** - a point estimate whose sign
reversed on a sample two and a half times larger is a point estimate that cannot be carried into a shipping decision.

### 51.4 The verdict, in the unit the decision is made in

1. **The window stays off, and it was already off.** Nothing in this table argues for turning it on **at the operating
   point this repository is preparing to ship** - the one positive row is the cheapest budget and the worst point on the
   curve - and the default is the conservative reading of an underpowered negative.
2. **The +0.0240 of §20.5 is retired as a component.** It is not that it was wrong when measured; it is that a
   thirty-six-pull-request estimate of a ±0.02 effect is a coin flip with a number attached, and this campaign has now
   published two of them (§49.5's window, and R-21's +0.0148 against a +0.02 bar).
3. **The reader keeps its own number.** R-22's on-arm ran with `codeContext: true`, so **+0.0412 was measured while
   carrying a device that is negative in this dispatch** - which means the reader's own effect is **larger** than
   +0.0412, not smaller. That correction runs against this campaign's own earlier suspicion, and §50.2's subtraction
   table is unaffected: it is about the cut, not about the window.

### 51.5 R-26, registered here

> **The reading loop, over the same hundred pull requests and the same judge, raises the five lanes' F1 by at least 0.02
> over `drop:test` with the code window closed in both arms.**

- **The matrix already separates them.** `agent: pair` now emits `{code_context: off, agent: off}` against
  `{code_context: off, agent: on}`, so the two arms differ in the loop and in nothing else. **R-22 could not answer
  this**: its own on-arm carried both switches, and the entailment that made the comparison legal is exactly the reason
  the number was ambiguous.
- **The bar is the same +0.02 as R-21 and R-25**, so three devices for the same bucket are read on one number.
- **The guard is the two arms' coverage sets**, with the pairing above as the format: **a loop that buys precision by
  emitting less must not lose credited goldens**, and §51.3 is what that test looks like when it is not significant.
- **`off` stays the default** until this pair says otherwise.

### 51.6 What this section does not claim

**It does not claim the window hurts.** The point estimate is negative at twenty-two of twenty-three cuts, the exception
is the worst operating point in the table, and the paired test is p = 0.0785. **All three clauses are required**, and a
reader who quotes only the first has quoted a table and not a result.

**It does not claim the reader is worth +0.0630.** Adding +0.0412 to 0.0218 is arithmetic on two point estimates from two
dispatches, which is exactly the operation §21 forbids. **It claims the sign of the correction, not its size**: the
reader's effect is at least the +0.0412 that was measured with a negative device inside the arm.

**And it does not retire §20.** The window was measured on a different corpus slice then, and this control was labelled
`not a confirmation` before it ran, because its registration names `skip 14 max 36`. **A control can overturn a component
without overturning the section that published it** - and here it did the smaller of the two.

## 52. The budget axis, measured four ways and closed

### 52.1 Four families, four losses

**Before spending a dispatch on a budget device, the budget axis was priced on artifacts already paid for**: the window
control's two arms and R-22's two, all with `test` dropped, all with per-pull-request maximum matching, all dividing by
the corpus. The fixed budget of 13 is the bar every row is read against.

| rule for the per-pull-request budget              | window off | R-22 off   | R-22 on    |
| ------------------------------------------------- | ---------- | ---------- | ---------- |
| fixed 13 (the shipped cut)                        | **0.2014** | **0.1872** | **0.2170** |
| `ceil(emitted / 2)`                               | 0.1701     | 0.1553     | 0.1674     |
| `ceil(√emitted × 2)`                              | 0.1986     | 0.1757     | 0.1957     |
| one per golden the pull request actually had      | 0.1274     | 0.1175     | 0.1600     |
| one per golden plus three                         | 0.1759     | 0.1677     | 0.2031     |
| global score threshold, best of nine values tried | 0.1963     | 0.1875     | 0.2173     |

**Four families, four losses, and the second row is the one that matters**: even with the answers - one slot per golden the
pull request actually contained - **the budget loses to a flat thirteen**, because most pull requests hold one or two
goldens and a budget that believes them throws away the recall a flat budget buys. **A rule that knows the answer and
still loses is a rule whose premise is wrong**, and the premise was "the emission is misallocated across pull requests".

**What the axis does contain, and it is not nothing.** Scanning every `k` for every pull request and keeping the one that
maximises that pull request's own credit-per-emission - a greedy bound that reads the answers and cannot be deployed -
gives **0.2424 / 0.2271 / 0.2552**, and the median chosen budget is **2**. So there is **+0.04** in _deciding how many
problems a pull request has_, and **nothing in deciding it from the emission, the score or the golden count**.

**That is the registration §52.2 makes, and it is the reason this section exists**: the next device is not a better
budget rule, it is an answer to the question the budget keeps guessing.

### 52.2 R-27, registered here and not yet dispatched

> **One call per pull request that answers "how many distinct problems does this diff contain" raises the five lanes' F1
> by at least 0.02 over the fixed budget of 13 with `test` dropped, and lowers recall by no more than 0.005.**

- **The device is a count, not a finding**: its output is an integer, `budget = clamp(n, 1, 13)`, and **an integer is
  the cheapest thing a model can be asked for and the most falsifiable** - a count that is wrong is wrong by a number,
  which can be read against the goldens the corpus actually holds for that pull request.
- **The bar is the same +0.02 as R-21, R-25 and R-26.** The upper bound above is +0.04, so the bar is half the room.
- **The guard is recall**, because a count that runs low is a precision device that pays in coverage: the row it must not
  cross is a recall drop of more than 0.005.
- **It is registered and not dispatched**, because two arms are already queued (§50.3's remark pass and §51.5's clean
  reader) and **a third registration in the queue buys nothing that a third registration after their verdicts does not**.
- **It is falsified by the first row of the table above if the count cannot beat a flat thirteen**: the oracle that reads
  the answers gains +0.04, and any count that estimates them badly lands on the `√emitted × 2` row, which loses.

## 53. The remark pass added ninety-one comments and found eight goldens (R-25)

### 53.1 The pair

`43669547968`, two arms over the same hundred pull requests (`skip 50`, `max 100`), the same judge
(`deepseek-chat`), the same 724 goldens, both arms reading all hundred rows (`corpusRead.whole: true`). The only
configuration key that differs is `remarks.enabled`.

| arm         | findings | goldens found | precision | recall | F1         |
| ----------- | -------- | ------------- | --------- | ------ | ---------- |
| remarks off | 1 099    | 139           | 0.1706    | 0.1920 | 0.1806     |
| remarks on  | 1 190    | 147           | 0.1663    | 0.2030 | **0.1828** |

The pass added **91 comments and 8 goldens**: the block it added has precision **0.088** in a corpus whose population
precision is **0.156**. The paired test over covered goldens reads **+61 / −53**, exact McNemar **p = 0.5123** - the
direction a coin produces on this many pairs.

### 53.2 Why a lane of eight families recovers eight of forty-one

The diagnosis that justified the dispatch was a sentence about _content_: of fifty sampled missed goldens, **forty-one
were a remark no lane attempts**, and the sampling was read as "the goldens are maintainability remarks". The corpus
agrees on the count - `reviewCategories` over the 724 goldens is **325 maintainability and readability, 315 code defect,
49 performance, 35 security** - and the eight families were written as _syntax_: `const`-correctness, literal types,
commented-out code, redundant modifiers, doc mismatch, naming, dead branches, wording.

**The corpus's sentences are not that kind of sentence.** From the fifty-six sampled rejections of §50: "consider using
`Math.min()` instead of a ternary for readability", "document how this request is validated", "extract the duplicated
setup into a helper", "the assertion may not always hold". Those are **judgements about design intent**; `article-agreement-in-comment`
and `macro-name-case` are **checks on spelling**. A lane built from the second cannot produce the first, and the pass's
own emission says so: **91 comments at 0.088 precision is not a weak signal, it is more of the same thing**.

**And the instrument's own noise is the size of the claimed effect.** The `remarks off` arm of this pair and the `agent
off` arm of `43676036390` are _the same configuration on the same hundred rows_, and they score 0.1806 and 0.1823. **A
gain of +0.0022 read against a run-to-run spread of ±0.002 is not readable at all**, which is the second reason the
verdict does not depend on the threshold.

### 53.3 The verdict, and a registration that says when it was written

The pass is **falsified and closed**: gain +0.0022 against a registered 0.02, p = 0.5123, and 8 of 41 recovered. The
lane stays off and the artifact keeps `configuration.remarks` so a future run can turn it on and be measured.

**The registration for it was written after the dispatch**, and `aacr-ablation-compare.mjs` carries
`registeredAfterDispatch: true` for that entry so the artifact can say so. What that field protects is the difference
between a prediction and a description: the threshold is the house 0.02 every device in the table is registered at, and
the claim's shape comes from the committed diagnosis (§50), not from the result - **but a reader should still be able to
see that the entry post-dates the run, and now they can without reading the source.**

## 54. The published point was 0.0298 below a point the artifact already priced (R-28)

### 54.1 The table was already in the artifact

§50.1 established that an operating point is arithmetic over verdicts a run paid for once. `43676036390`'s own artifact
therefore carries `operatingPoints` - twenty-three cuts of its 1 109 findings - **and the artifact's headline was not the
best of them**:

| cut                                | findings | goldens found | precision  | recall     | F1         |
| ---------------------------------- | -------- | ------------- | ---------- | ---------- | ---------- |
| the actionability gate (published) | 801      | 139           | 0.1735     | 0.1920     | 0.1823     |
| no rule (full emission)            | 1 109    | 173           | 0.1560     | 0.2390     | 0.1888     |
| drop test                          | 905      | 163           | 0.1801     | 0.2251     | 0.2001     |
| drop test + architecture           | 570      | 132           | 0.2316     | 0.1823     | 0.2040     |
| **drop test, budget 12**           | **653**  | **146**       | **0.2236** | **0.2017** | **0.2121** |

**Every row above the gate is a cut of the same findings, judged by the same calls, on the same goldens.** Moving the
headline to the fifth line costs nothing and buys **+0.0298 F1, +0.0501 precision and 148 fewer comments** - and, because
the gate was dropping 308 findings that had already been paid for, it also removes a claim the artifact could not
support: that the reviewer being measured was the reviewer the command posts.

### 54.2 It replicates on an independent run of the same arm

The `remarks off` arm of §53 is a second run of the same configuration on the same rows. The same three cuts:

| cut                      | `43676036390` off | `43669547968` off |
| ------------------------ | ----------------- | ----------------- |
| the actionability gate   | 0.1823            | 0.1806            |
| drop test                | 0.2001            | 0.1943            |
| **drop test, budget 12** | **0.2121**        | **0.1960**        |

**Same ordering, same sign, different magnitude**: +0.0298 on the first baseline and +0.0154 on the second. The honest
statement of the gain is therefore **+0.015 to +0.030 with the ordering stable across two runs**, not the single figure
0.2121 - and the confirmation in §54.4 is a third run on rows neither baseline read.

**The command's own ordering lands in the same place.** `review pr` sorts by severity and carries no score, so the
budget's tie-break falls back to that order. Applying the policy with severity order instead of score order gives
**0.2062** on `43676036390` and **0.1946** on `43669547968` - both still above the gate by +0.024 and +0.014, which is
why shipping the policy did not require moving the command's ranking into the package first.

### 54.3 What changed, and the test that holds the two implementations together

- **`packages/intelligence/src/review/emission-policy.ts`** is the policy: three steps (`drop`, `keep-category`,
  `budget`), frozen, with `SHIPPED_EMISSION_STEPS = [drop test, budget 12]` and `describeEmissionSteps` producing the
  label the table prints.
- **`review pr` applies it** to the findings it is about to post, and reports what it removed in
  `summary.emissionPolicy` with the rule's name. An explicit `--max-findings` still wins, and the field is absent then,
  because a flag is a decision and a policy is a default.
- **`aacr-bench.mjs` imports the same object** and applies it per pull request, so `emissionRules.shipped` is the point
  the product occupies rather than a cut nobody can run. The gate stays in the artifact as `laneGate`, measured every run.
- **`tests/unit/scripts/the-shipped-point-is-a-row-of-the-table-that-prices-it.test.ts`** asserts that
  `applyEmissionPolicy` and `applyCut` keep the same findings in the same order on a fixture with ties, an empty
  pull-request key and a dropped category, and that the row the table prints for that label scores what the policy's
  output scores. **Two implementations of one cut that are not held together by a test are two tables about one run**,
  which is the failure §51 already paid for once.

### 54.4 R-28, registered here

> **The emission policy `drop test, budget 12` lifts the five lanes' file-arm F1 by at least 0.02 over the actionability
> gate on the hundred pull requests starting at row 150, without lowering recall by more than 0.01.**

- **Why row 150.** The point was _chosen_ by looking at the twenty-three rows of two artifacts over rows 50-149, and 23
  cuts against 724 goldens is a small enough search to fit noise. **The rows the selection did not read are the only
  honest test of it**, and they are the hundred after the ones every figure in §50-§54 has been computed on.
- **The bar is the lower end of the replicated range** (+0.0154 on `43669547968` off), not the upper end (+0.0298), so a
  run that lands in between confirms the finding rather than splitting it.
- **The guard is recall**, because `drop test` is a precision device: 171 test findings carried 9 goldens on the
  published run, and a policy that raised precision by buying less coverage would be the trade §49.3 already rejected.
- **It is dispatched with the change rather than after it**, because the policy is now what the command does: a
  confirmation run of a rule the product does not apply would confirm nothing about the product.

## 55. The reader buys a quarter of the emission and no accuracy (R-22)

`43676036390`, the pair §51.5 left owing a clean reading: both arms with the window off, so the only key that differs is
`agent`, with `codeContext` entailed by it (§54's guard fix, §55.2).

| arm        | findings | goldens found | precision | recall | F1         | cost  |
| ---------- | -------- | ------------- | --------- | ------ | ---------- | ----- |
| lanes      | 1 109    | 173           | 0.1560    | 0.2390 | 0.1888     | $1.17 |
| the reader | 811      | 147           | 0.1813    | 0.2030 | **0.1915** | $1.53 |

- **Registered claim**: file-arm F1 **≥ +0.02**, pull-request arm not lowered (§48, R-22).
- **Measured**: file arm **+0.0092**, inside the instrument's resolution of 0.0028 at 724 goldens; pull-request arm
  **−0.0027**, which fails the guard; paired **+91 / −83**, p = 0.5958.
- **Verdict: falsified.** The reader stays off in the product, and the artifact keeps `configuration.agent` so the arm
  can be re-measured rather than argued about.

**What the arm is good for is real and is not accuracy.** It removes **298 of 1 109 comments (−27%)** while raising
precision **+0.0253** and recall **+0.011** - a reader that files fewer, better comments at the same F1. **At every
budget-constrained cut it loses to the lanes** (drop test: 0.2020 against 0.2020; drop test + budget 12: 0.2029 against
0.2121), which is the same statement from the other side: a budget already removes the comments the reader was removing,
and it removes the ones a reader cannot see at all. It also costs **+31% per run** ($1.53 against $1.17), so the
reduction is not free.

### 55.1 The one thing this pair did fix, and it was not the reader

The pair was refused by `aacr-ablation-compare.mjs` with `differ: ["codeContext", "agent"]` - a **false refusal of a
sound pair**, because `agent: on` sets `codeContext: true` inside the arm: a reader cannot be switched on without being
shown the code it reads. The entailment table that explains this existed and **`confoundsBetween` still refused the pair,
because it counted the differing keys instead of reading the resolved field.** The self-test that was supposed to cover
it asserted `variedField` alone and passed while the guard stayed broken.

**Both are fixed**: the guard reads `varied.field`, and the self-test now asserts `confoundsBetween(agentOn, agentOff)`
is empty _and_ that the inverted pair - window off while the reader is on, window on while the reader is off - is still
refused. **A guard that refuses sound comparisons is not a safe guard**, and the cost of this one was a paid run's
verdict held up for four hours.

## 56. R-28 landed at the bottom of its range, and its own artifact could not be replayed

### 56.1 The confirmation, on rows the selection never read

`43775832164`, one arm, `skip 150`, `max 100`. The corpus holds **46 pull requests** past row 150 and **330 goldens**
there, so the confirmation is a coarser instrument than the discovery slice: at 330 goldens the resolution of an F1
difference is of the order of **±0.006**, not the ±0.0028 the 724-golden pair gave.

| arm                                            | comments | goldens found | precision  | recall     | F1         |
| ---------------------------------------------- | -------- | ------------- | ---------- | ---------- | ---------- |
| the actionability gate                         | 361      | 69            | 0.1911     | 0.2091     | 0.1997     |
| **`drop test, budget 12` (the shipped point)** | **331**  | **71**        | **0.2145** | **0.2152** | **0.2148** |
| full emission                                  | 525      | 88            | 0.1676     | 0.2667     | 0.2058     |

**+0.0151 F1, +0.0234 precision, +0.0061 recall and 30 fewer comments.** The registered claim was **≥ +0.02** with a
recall guard of −0.01; the verdict is **falsified at the registered bar**, by 0.0049 against the registration and 0.0003
against the lower end of the replicated discovery range (+0.0154 on `43669547968`'s off arm).

**What the run does support, and what it does not.** The direction replicated on a third corpus with a different
selection of rows, the recall guard was not merely held but passed in the opposite direction, and the comment count fell.
**What it does not support is the number 0.02** - and the honest statement of the shipped point after three runs is
**+0.015 to +0.030 with the ordering stable**, which is what §54.2 said before this run and what this run narrows to its
lower half. The threshold stays as registered: a bar that moves to meet its measurement is not a bar.

**The alternatives were priced offline and lost**, so the point is not one of several untried rules:

| rule over the same 1 109 findings of `43676036390` off | F1         |
| ------------------------------------------------------ | ---------- |
| score order, 12 per pull request (shipped)             | **0.2121** |
| category prior estimated on the other half, k=10 (CV)  | 0.2143     |
| category prior, k=12 (CV)                              | 0.2106     |
| per-file cap 4, then 12 per pull request               | 0.2133     |
| per-file cap 3                                         | 0.2125     |
| file round-robin, 12 per pull request                  | 0.2048     |
| agreement ≥ 2 (the ranker's own feature)               | 0.2045     |
| agreement ≥ 3                                          | 0.1926     |

**Every one of them is inside ±0.002 of the shipped rule or below it.** The order the reviewer emits is calibrated; the
remaining loss is not in _which_ of our comments is posted.

### 56.2 The artifact could not be replayed, and the checker was right

The job failed after the measurement, on `aacr-paired-replay.mjs --check`:

> the artifact's published figures are not derivable from its rows: precision published 0.2145 replayed 0.1911, recall
> 0.2152 replayed 0.2091, f1 0.2148 replayed 0.1997

**§54 moved the headline to the emission policy and left `scoring.publishedArm` saying `gate`.** The checker recomputed
the gate from the rows - correctly - and compared it with a figure about another rule. Three defects came out of it:

1. **`publishedArm` is `shipped`** for the lanes and for the merged arm, and stays `everything` for the single-pass reader,
   whose filing check keeps all it locates.
2. **One row per pull request now carries `shippedEmitted`**, because `covered` was already scoped to the shipped rule
   while `emitted` was the full emission - **a row that carries one without the other cannot be replayed**, and a checker
   that divided by `emitted` would report a precision about a reviewer nobody ran.
3. **An artifact that names an arm its rows cannot reproduce now fails instead of passing.** The comparison used to skip
   every field it could not find and report `ok: true` - **a check that reports success by not running**, which is the
   shape of the defect it was supposed to catch.

**And a fourth, which no figure had shown.** `shippedRuleKeep` applied the policy to _every_ ranked finding, ignoring the
category profile - so a `defect` run would have published a point that posted the categories its own profile had dropped.
The profile is now applied first and the policy second. Every dispatch so far has been `advisory`, where the floor removes
nothing, which is exactly why an excursion like this needs a test rather than a run.

### 56.3 R-29, registered: the second reviewer is a second field of view, and the merge is the device

`43676036390` ran both reviewers over the same hundred pull requests. Their coverage, by golden:

| arm            | distinct goldens | of 724   | comments emitted |
| -------------- | ---------------- | -------- | ---------------- |
| the five lanes | 198              | 27 %     | 1 109            |
| the reader     | 171              | 24 %     | 811              |
| **both**       | **276**          | **38 %** | 1 920            |
| in common      | 93               | -        | -                |

**The reader reaches 78 goldens no lane finds**, and that is the largest single uncovered block this campaign has
measured. It has never paid for itself because it says it in 1 920 comments. Cut to twelve per pull request the union is
890 comments at F1 0.2243; **a merge that removed the restatements and kept the unique goldens is 770 at 0.2422**, and a
merge that knows the answer key - which no device can - would be 734 at 0.2949. **The band between 0.2243 and 0.2422 is
what R-29 buys or does not.**

> **The emission policy `drop test, budget 12`, applied to a list merged from the five lanes and the reading reviewer by
> a selection-only model pass, lifts the file-arm F1 by at least 0.02 over the five lanes alone with the same per-pull-
> request budget, without lowering recall.**

- **Selection, not rewriting**, so the measurement is about _which_ comments and not about their words, and a kept comment
  carries the verdict it was already judged with.
- **The fallback is a measured rule, not a guess**: score order at 0.2243 and positional de-duplication at 0.2215 are both
  in the table above, and an answer that does not parse, keeps nothing, or names refs that do not exist falls back to the
  better of them with the reason recorded in `summary.ensemble` / `artifact.merge.fallbackReasons`.
- **Falsified by** F1 < 0.2321 (0.02 over 0.2121) or recall below 0.1917 (0.01 under 0.2017). **The guard is recall**,
  because a merge can raise precision by posting less and the arm's entire justification is coverage.
- **Registered before the dispatch**, unlike R-25's entry, and `docs/EVAL-CONTRACT.md` is the only place the claim exists.

**The cost, stated before the run.** The merge is one completion per pull request over its own candidates - about 20
candidates of 240 characters - and the second reviewer costs +31 % of a run (`$1.53` against `$1.17` on the pair above).
**A device that needs two thirds more money to move F1 by a third of what §54 bought for nothing has to say so in its own
registration**, which is why the number is in this paragraph rather than in a footnote after the result.

## 57. The merge passed its bar, and the artifact proves it merged one reviewer

### 57.1 The confirmation

`43784019226`, one arm, `skip 150`, `max 100` - the same 46 pull requests and 330 goldens §56.1 priced the emission
policy on, so the two tables are about the same rows and the same judge:

| arm                                    | comments | goldens found | precision  | recall     | F1         |
| -------------------------------------- | -------- | ------------- | ---------- | ---------- | ---------- |
| the actionability gate                 | 361      | 69            | 0.1911     | 0.2091     | 0.1997     |
| `drop test, budget 12` (single reader) | 331      | 71            | 0.2145     | 0.2152     | 0.2148     |
| **the merge, same policy**             | **277**  | **76**        | **0.2744** | **0.2303** | **0.2504** |

**+0.0356 F1, +0.0599 precision, +0.0151 recall and 54 fewer comments**, against a registered bar of `≥ +0.02` with a
recall floor of −0.01. **Both halves of the registration are met, and they are met in the direction that matters**: the
arm posted _fewer_ comments and found _more_ goldens, which is the one combination a cut cannot buy by itself.

**The confirming mechanism is not the one registered**, and §57.2 is why that sentence is here rather than in a footnote.

### 57.2 The lanes were empty, and no field in the artifact could say so

`AACR_AGENT=on` empties the lane loop (§51: 1 245 lane calls bought and discarded, 0.46 of 0.79 USD), and the merge reads
its two sides from that loop. **So the arm that ran merged the reading reviewer with nothing.** The artifact says it in
arithmetic that was in hand and unread:

| field                     | what it said                    | what it means                                                                             |
| ------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| `merge.candidates`        | **394**                         | one reviewer's worth over 46 pull requests - the union was 1 920 on the pair §56.3 priced |
| `merge.paths`             | budget 36, model 10, fallback 0 | on 36 pull requests there was nothing to choose between                                   |
| `merge.dropped.duplicate` | **48**                          | the second reviewer's share of the work: restatements inside one reviewer's own list      |
| `merge.sides`             | _absent_                        | **the field that would have said so, and did not exist**                                  |

**A device whose input can be empty without the artifact noticing is a device that can be measured as something else**,
and 0.2504 is a plausible score for either device - so no figure in that run could have caught it. Three things changed:

1. **The lanes run when the merge does.** `for (const section of lanesRun ? sections : [])`, with
   `lanesRun = !AGENT || ENSEMBLE`. The cost rule stays for every other agent arm, because it is right for every other
   agent arm.
2. **`merge.sides` and `merge.unionPulls` are published**, counted from the candidates the merge was handed rather than
   from the harness's own arrays, and **`unionPulls` counts only the pull requests where both sides were non-empty** -
   which is the only number in the artifact that says a merge happened at all.
3. **The artifact name carries the dimension.** That run uploaded `...-adjudicate-off-idioms-off-agent-on-remarks-off`,
   which is the name an agent-only run uses: **two devices, one name**, and a paired comparison that matched on names
   would have compared an arm with itself. It also had no `pair` mode, so the arm could not be dispatched against a
   comparator in one job.

**What the run does establish, on the device it actually ran.** De-duplication plus a twelve-per-pull-request cut over
the reader's own candidates is worth **+0.0356 F1 and −54 comments** over score order at the same budget, and the model
decided only the ten pull requests where the list exceeded the budget. **That is a real gain from a device that costs
0.35 of a call per pull request**, and it is not the gain the registration names.

### 57.3 Two selectors priced on artifacts already paid for, and both rejected

A cut is arithmetic, so the candidates the two arms already emitted can be re-scored with the bench's own assignment -
maximum bipartite matching per pull request, rebuilt offline from `matchedGoldens`, which reproduces the published
`drop test / 12` figure to four decimals (0.2121) and is therefore the same instrument.

| rule over 1 920 candidates of `43676036390` | F1         |
| ------------------------------------------- | ---------- |
| score order, budget 12 (shipped shape)      | **0.2243** |
| score order, budget 16                      | **0.2276** |
| `bug` and `security` only, budget 12        | 0.2152     |
| `bug` and `security` only, budget 16        | 0.2160     |
| corroboration first, then score, budget 12  | 0.2181     |
| corroboration first, then score, budget 16  | 0.2287     |

- **A defect-only filter loses.** Category is real signal - `bug` plus `security` is 38 % of the candidates and 61 % of
  the hits, at precision 0.2494 against 0.1560 for everything - and it still loses, because the 62 % it drops carries
  39 % of the goldens. **The corpus's convention remarks are not noise to be filtered out; they are most of the answer
  key**, which is the same lesson §48.1's category split taught from the other direction.
- **Corroboration is a strong filter and a weak ordering.** A lanes finding with a reader finding within three lines and
  a token overlap of at least 0.15 is **0.3206 precise against 0.1560** - a factor of 2.06 on 131 rows - so two
  independent producers agreeing about one site is the strongest cheap signal this campaign has measured. As an ordering
  it moves F1 by +0.006 at budget 8, −0.006 at 12 and +0.001 at 16, because **the rows it selects are already inside the
  top twelve by score**. The signal is not weak; the ranker had most of it already, and the cheaper statement of the
  same fact is the filter for a _future_ device that needs a precision prior, not an ordering for this one.

### 57.4 Fifty-four goldens nobody can answer, which were filed as a path filter's fault

The corpus is a snapshot of a moving object. `ClickHouse/ClickHouse#74070` carries **fifteen** goldens on
`src/Functions/FunctionStrncmp.cpp`; the pull request today has **five** changed files and that is not one of them.
`google-gemini/gemini-cli#4828` and `#5819` are the same shape, and the repair is not a path filter: **no reviewer,
ours or the competitor's, can comment on a line the pull request no longer has.**

`fileNotReviewed` used to hold all 54 of those rows beside the ones this run genuinely dropped, and the two answers send
the next iteration to different places. The attribution now decides `pathNotInPull` first, from the pull request's own
file list (`pulls/{n}/files`, one request, paginated), and `engineCounters.snapshot` publishes how many pull requests were
asked, how many answered, and how many goldens moved. **The figure is not restated on a reduced denominator** - the
competitor's number was measured on their snapshot, where those files existed - but a reader can now see that 7.5 % of
the denominator is unanswerable today, which is the difference between a recall gap and a corpus that moved.

### 57.5 R-30: the registration of §56.3, executed as written

The claim does not change, because it was never tested: _"the emission policy `drop test, budget 12`, applied to a list
merged from the five lanes and the reading reviewer by a selection-only model pass, lifts the file-arm F1 by at least
0.02 over the five lanes alone with the same per-pull-request budget, without lowering recall."_

- **The pair is `{agent off, ensemble off}` against `{agent on, ensemble on}`** - the five lanes alone against the merge -
  which is the comparator the registration names, and the only pair in this table whose two arms are the claim's own two
  arms rather than a proxy for them.
- **On the discovery rows** (`skip 50`, 100 pull requests, 724 goldens), because that is where the lanes' 0.2121 was
  measured and where the corpus leader's 25.1 % SEM-F1 is quoted. **The 330-golden confirmation slice cannot resolve
  0.02**; the discovery slice resolves 0.0028.
- **The falsifiers are R-29's**: F1 below 0.2321, or recall below 0.1917. **A pass that does not also exceed 0.2504**
  would say the union added nothing to the de-duplication §57.2 already measured, and that is a result worth having: it
  would price the five lanes' 198 covered goldens at zero contribution inside a merge.
- **`merge.sides.lanes` and `merge.unionPulls` are part of the verdict**: an artifact whose `unionPulls` is not the
  number of reviewed pull requests has not tested this claim, whatever its F1 says.

### 57.6 The gate, because a sentence in a document is not a gate

§57.5 wrote the condition as prose and `aacr-ablation-compare.mjs` now enforces it: the `ensemble` registration carries
`inputsFormed: 'union'`, and the comparator reads `merge.unionPulls` **before** it reads the gain. An artifact whose merge
received one side publishes `verdict.deviceInputs.unionFormed: false` and an outcome that starts `not a test:` - so the
next dispatch of this arm cannot report a confirmation of a device that did not run, whatever its F1 says.

**And the reason it is a gate rather than a note is the shape of R-29's failure.** Its artifact was internally
consistent, its arithmetic replayed, its bar was met, and every field it carried was true; **the only false statement was
in a document**, which is the kind of false statement no run can catch and no test can fail. A claim whose device has
prerequisites has to publish those prerequisites as numbers, and something has to read them.

**Two smaller wiring defects came out of the same dispatch**, and both are the same defect one level down: the merge arm
uploaded an artifact name that an agent-only run also uses (so a name-matched pair compares an arm with itself), and the
workflow's `pair` input carried an unquoted `off` (so **the workflow could not be dispatched with its own defaults** -
`422: Provided value 'false' for input 'pair' not in the list of allowed values`). The name now carries the ensemble
dimension, and `ensemble: pair` dispatches both configurations over the same rows.

## 58. The run that was cancelled, and the figure it published

### 58.1 R-30 did not produce a measurement, and the artifact could not say so

`43795692468` dispatched the pair §57.5 registered: `{agent off, ensemble off}` against `{agent on, ensemble on}`, 100
discovery pull requests, 724 goldens. The lanes arm finished in 2 h 10 min. **The merge arm hit the job's 340-minute
ceiling at 5 h 39 min inside the review step and was cancelled**, its two verification steps were skipped, and then:

| what happened                              | consequence                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| the upload step is `always()`              | it copied **`benchmarks/aacr-bench.json` as it stood in the checkout**                |
| that path is a tracked file                | the file is the figure of **2026-11-10**, `F1 0.2026`, produced by a different device |
| the artifact name is built from the matrix | it published under `...-adjudicate-off-idioms-off-agent-on-ensemble-on-remarks-off`   |
| the compare job's `if:` lists four inputs  | **`ensemble` was not one of them, so the comparison never ran**                       |

**Three defects, and the first is the one that matters**: a cancelled run published a number, under the right name, with
a schema a reader has no reason to doubt, and **nothing in the artifact was false**. It was the previous run's truth.
**A cancellation is not a result, and the difference has to be in the file rather than in the API.**

The repair is three lines and one deletion:

1. **The script clears the path before its first request** (`rmSync(..., { force: true })`), so a run that dies mid-flight
   publishes nothing. An upload that finds no file is the honest report.
2. **The figure is uploaded on `success()` rather than `always()`.** The old condition existed for _skipped_ runs - no
   corpus, no credential - and those still exit zero and still publish their marker; only a run that died loses its
   upload.
3. **Every artifact carries `provenance: { runId, sha, startedAt, finishedAt }`**, stamped at the single point of writing,
   so a file that lacks `finishedAt` is a file this script did not finish - and the committed figure from 2026-11-10 is
   now identifiable as one by inspection.
4. **The paired job fires for the merge arms**, which it did not: the run would have ended complete, with both arms paid
   for and no comparison - **the job whose output is the reason the run exists was skipped, and the run still looked
   green.** The code-window download step carried the same omission in the other direction: its guard was "not any pair
   except the ones I name", `ensemble` was not among them, so a merge dispatch would have failed at the download, after
   the bill.

### 58.2 The union cannot be measured in one job at this size, and that is a fact about the runner

The lanes alone cost **5 785 model calls, $1.67 and 2 h 10 min** for 100 pull requests; the reader adds its own calls and
doubles the judging; the merge adds one call per pull request that exceeds twelve candidates. **GitHub's ceiling for a
job is six hours**, and the workflow's own is 340 minutes. The union therefore needs ~2.5× the lanes' cost and lands
outside it - which is not a reason to register it differently, it is a reason to **shard it or to stop claiming it can be
measured in one dispatch**.

**What the same run does establish, and it is the more useful half: the lanes' own number on the discovery rows.**
`...-off-off-off-off-off-off`, completed, 100 pull requests, 724 goldens:

| arm                                | comments | TP  | FP  | FN  | precision | recall | F1         |
| ---------------------------------- | -------- | --- | --- | --- | --------- | ------ | ---------- |
| five lanes, `drop test, budget 12` | 656      | 143 | 513 | 581 | 0.2180    | 0.1975 | **0.2072** |

### 58.3 R-31: the one-sided merge, registered before its run

R-29's artifact is unambiguous about one device and says nothing about the one it was filed under (§57.2): a selection
pass over **the reading reviewer's own candidates** - de-duplicate, then twelve per pull request - reached **0.2504 F1
against 0.2148** for the same reader under score order at the same budget, with 54 fewer comments, on 46 pull requests and
330 goldens. **That device was reachable only by an accident of another device's upstream cost rule**, which is a
sentence no registration can be written against.

So the flag has a third state. `AACR_ENSEMBLE=reader` runs the reader, skips the lanes **by definition rather than by
bug**, and merges one list; the artifact records `ensemble: "reader"`, and `merge.sides.lanes: 0` says the same thing in
arithmetic. `ensemble: pair-reader` dispatches it against the lanes in one job, over the same rows, the same judge and the
same corpus, so the difference between the two artifacts is the device.

**The registration, written before the dispatch:**

- **Claim.** The reading reviewer's own list, de-duplicated and cut to twelve per pull request, raises the file-arm F1 by
  at least **0.02** over the five lanes alone on the hundred discovery pull requests, **without lowering recall**.
- **Comparator.** `{agent off, ensemble off}` - the lanes' 0.2072, measured on these rows in one run.
- **Falsifiers.** F1 below **0.2272**, or recall below **0.1875** (the lanes' 0.1975 less a golden's worth). **A
  selection pass that buys precision by deleting recall is the failure mode this device is most exposed to**, and a
  registration naming only F1 would accept exactly that trade.
- **Slice.** `skip 50`, 100 pull requests, 724 goldens - the discovery rows, because **0.02 cannot be resolved on 330
  goldens and can be resolved on 724** (§57.5's reason, reused unchanged).
- **What it does not claim.** That the union of the two reviewers is worth anything. That claim stays open and its price
  is §58.2.

### 58.4 The failures are on the site, not at a distance, and one table now says which kind

The largest bucket in every run of this campaign is `findingOnPathRejected` - **we commented on the golden's own path and
the judge did not accept the comment** - and until now the answer to "what should the next device be" was read by hand
from fifty records. `scripts/aacr-miss-anatomy.mjs` makes the first pass arithmetic: a golden is placed by how close our
nearest comment was, and by **whether that comment was itself accepted for a different golden**. The two cells ask for
different repairs and cost the same: one false negative and one false positive each.

| arm (`43795692468`)             | rejects | on our own line | beside an accepted comment | beside one nothing accepted | silence on a path we read | on a file we never read | on a file the PR no longer has |
| ------------------------------- | ------- | --------------- | -------------------------- | --------------------------- | ------------------------- | ----------------------- | ------------------------------ |
| five lanes, 724 goldens         | 455     | **276**         | 79 (27.5 %)                | **197**                     | 24                        | 0                       | 53                             |
| reader + selection, 330 goldens | 182     | 31              | 6 (25.8 %)                 | 25                          | **39**                    | 17                      | 0                              |

- **The failure is not distance.** 276 of the lanes' 455 rejects sit on **the line we commented on**, and 125 of them are
  beside a comment of ours that the judge accepted for something else: **the site was right and the concern was a
  different one.** A reviewer that says one true thing per site, on a site with two problems, loses the second - and the
  corpus has those sites (`electron#47361` carries a use-after-free and an O(n²) erase on one line).
- **The reader trades sites for sentences.** It is silent on **39 of 330** goldens whose path it read - 12 %, against
  the lanes' 3 % - and its rejects sit _further_ from its own comments (63 beyond fifty lines against the lanes' 74 of a
  larger 455). **It speaks less and more precisely, and it misses more sites**: which is why the selection pass alone
  (§58.3) cannot be the end of the story, whatever R-31 says.
- **`pathNotInPull` is the corpus moving**, 53 goldens on files the pull request no longer has, and it is not in the
  matrix because no reviewer can reach it.

**What this rules in for the next iteration, and what it rules out.** The shipped policy is not inert: **1 109
candidates are cut to 656** by `drop test, budget 12` - 41 % deleted, and **24 of the 100 pull requests truncated at the
ceiling**, with a mean of 6.6 comments per pull request and a tail that reaches 46. So the mean understates the cut by a
factor of five at the top of the distribution, and a volume device has to raise `k` before it can say anything: §57.3
already priced that on the union arm (0.2243 at 12, 0.2276 at 16, **+0.003 inside the noise**).

**And the threshold that paragraph used was wrong by a factor of three.** It said _a second sentence at every site we
already comment on_ needs a **precision above 0.30** merely to break even. The arithmetic says **0.1036**, and the
difference is not a rounding of the same caution - at 0.30 every device that adds a comment is refused by construction,
and this document had been refusing one of them on that number.

With `TP` credited goldens, `C` comments and `G` goldens, `2PR/(P+R)` cancels to

> **F1 = 2·TP / (C + G)**

so one more comment raises F1 exactly when its own precision exceeds `TP/(C+G)` - **half the F1 it joins**, and
independent of how many are added. The line on this run is **0.2072 / 2 = 0.1036**. `score()` in
`scripts/lib/operating-point.mjs` now publishes the cancelled form and `breakEvenPrecision()` the line, so a device
cannot be priced against one arithmetic and scored by another.

**What the corrected line does, and does not, rescue.** It does not rescue a second sentence at _every_ site: the budget's
own tail measures that device's marginal precision exactly - `no rule` emits the 453 comments `budget 12` deletes and
credits **22** goldens with them, **0.0486 against the 0.1036 line** - which is why the budget is right and why the
arithmetic never needed to be told 0.30 to reach the same conclusion. It does rescue the version that has a mechanism:
**a second concern at a site where the reviewer has already located a defect**, which is §59.

## 59. The merge that removed two thousand findings without reading a word

### 59.1 Two findings on one line are not one finding

§58.4 put the failures on the site rather than at a distance: **276 of the lanes' 455 rejected goldens sit on the line
the reviewer commented on**, and 125 of those sit beside a comment the judge accepted for something else. The corpus
names the case - `electron#47361` carries a use-after-free and an O(n²) erase on one line - and the engine's range rule
merges exactly that pair, because _"the same defect has one location"_ is a claim about defects that was being applied
to findings.

The artifact already records every removal with the rule that made it (§46.8), so the size of the question is arithmetic
rather than a reading: `43795692468`'s lanes artifact, 100 discovery pull requests.

| what the dedup did                                                         |     count | what it means                                                                                |
| -------------------------------------------------------------------------- | --------: | -------------------------------------------------------------------------------------------- |
| findings merged                                                            | **2 295** | of the 1 109 that survived and the ones the per-file cap had already refused                 |
| merged under `rangeOnly`                                                   | **2 273** | **overlapping ranges, sentences disagreeing, no evidence the two are about one defect**      |
| merged under `rangeAndWords`                                               |        16 | the ranges overlap _and_ the words agree: earned                                             |
| merged under `wordsNearby`                                                 |         6 | the same sentence within thirty lines: earned                                                |
| content-word overlap with the survivor, median                             |      0.25 | half the removed findings share a quarter of their vocabulary with the finding that ate them |
| removed findings sharing under a fifth of their words                      |       848 | the population a _second concern_ would come from                                            |
| sites where the removed finding's **category** differs from the survivor's |   **602** | across 404 files, one per file at the median, sixteen in the worst file                      |

**So the rule that removed 99 % of everything was the rule that never looked at a word**, and the report could not say so
until §46.8 taught it to record the removals as pairs. The three rules are not three ways of saying the same thing: two
of them read the sentences and one of them reads a range.

**And the removal is not free.** Of the 276 same-line rejects, **226 had a rangeOnly removal at their own site** (245 of
the 276 join exactly; 31 sit on a path two pull requests share and were excluded rather than guessed). That is not proof
the removed finding was the golden's concern - it is the reason the question is worth a dispatch rather than a paragraph.

### 59.2 The device, and the two things it deliberately does not do

`AACR_SECOND_CONCERN=on` changes one predicate. A finding whose range overlaps a survivor's is a duplicate unless **its
category differs from the survivor's**, in which case the site keeps it as a **second concern** and the site is marked as
having had its second.

- **It does not keep more than one per site.** A lane that marks a twelve-line block for one problem has made every other
  finding of its own kind inside that block a duplicate of it; keeping the whole block is how a review becomes a list of
  the same remark at four line numbers.
- **It does not touch the other two rules.** `rangeAndWords` and `wordsNearby` read the text, so a pair they merged has
  textual evidence behind the merge and the switch leaves them alone.

The engine publishes **`keptAsSecondConcern`** beside `mergedBy`, because a run with the switch on has a _smaller_
`dropped` than the run it is compared with, and **a device whose only trace is a number that fell in a different column
cannot be told from a corpus that produced fewer duplicates.**

### 59.2b What the field does with a second comment, and what it does not

The noise policies the shipped reviewers publish are **per concern, not per line**. CodeRabbit's stated behaviour is one
summary comment and inline comments "only on actual issues", with no filler of the _consider adding a comment here_ kind
([review of seven tools on 14 planted bugs](https://vibecodemeta.com/blog/best-ai-code-review-tools-2026)); the same
comparison article that recommends running two reviewers warns that two of them commenting on one line is worse than
either alone, because **"a duplicate doubles the reading cost of a finding you have already dismissed"**
([CodeRabbit vs Greptile vs Bugbot vs Diamond](https://menuagentic.com/zh/blogs/coderabbit-vs-greptile-vs-bugbot-vs-diamond)).
Both are arguments for de-duplication, and neither is an argument for collapsing by location.

**And the location-level agreement the range rule assumes does not exist in the field's own measurements.** An engineer
ran four reviewers over 146 pull requests and 679 findings: of **617 distinct flagged locations, 93.4 % were flagged by
exactly one tool, 6 % by two, none by all four, and the four never once flagged the same line**
([Agentic Code Review](https://click-buy-ship.com/agentic-code-review-oreilly)). A rule that merges everything inside an
overlapping range is therefore a rule about a coincidence - **and the only place the coincidence is systematic is inside
one reviewer, where five lanes read the same diff and mark the same block.**

Which is the distinction the range rule lost: _one comment per site_ is a noise policy, _one comment per concern per
site_ is a precision policy, and the run's 2 273 `rangeOnly` removals are the price of having implemented the first
while believing it was the second.

### 59.3 R-32, registered before its dispatch

- **Claim.** Keeping one finding of a different category at a range the reviewer already reported raises the file-arm F1
  by at least **0.01** and recall, without lowering precision by more than a golden is worth.
- **Comparator.** `{agent off, ensemble off, secondConcern off}` - the lanes as they ship - over the same rows, the same
  judge and the same corpus, in **one dispatch** (`second_concern: pair`), so the difference between the two artifacts is
  the device.
- **Falsifiers.** F1 below **0.2172**; or precision below the comparator's less one comment's worth; or
  `keptAsSecondConcern` of zero, which is the device not running rather than the device failing.
- **Why 0.01 and not the house 0.02.** The device adds at most one comment per site; 396 of the 602 sites survive
  `drop test`; and the category base rates it draws from run from 0.17 (architecture) to 0.32 (security). Those rates
  were measured on **survivors**, and a survivor is not a discarded restatement - so the registration takes the lower bar
  and states why, rather than raising the number the table would need.
- **What it does not claim.** That the union of the two reviewers is worth anything (§58.2's price), or that the reader's
  12 % silence is repaired by it.

### 59.4 The three instruments this round had to add before the device could be priced

1. **`F1 = 2·TP/(C+G)` as the arithmetic**, with `breakEvenPrecision()` published beside it, so _"is one more comment
   worth writing"_ is `p > F1/2` rather than an estimate. The estimate this document carried said 0.30.
2. **`configuration.secondConcern` in the artifact, and its own matrix arm** - the §58.1 lesson applied before it costs
   anything: a flag that reaches the engine and not the artifact is a comparison between two arms that look identical.
3. **`keptAsSecondConcern` in the dedup report**, because the switch's effect is a merge that did not happen, and a
   report that only counts merges cannot show one being withheld.
4. **`lane` on every finding, which the artifact had never carried.** The lane's result named its lane and its findings
   did not, so the flattening that builds the judged list dropped the attribute: **`lane: null` on all 1 109 rows of the
   discovery run**, in the artifact that paid 5 785 calls for five lanes. _Which lane earns its calls_ was therefore a
   question the run could not answer, and a lane-ablation was a dispatch rather than a query. `locateLaneFindings()` is
   the flattening now - a named function because it is where the attribute is lost and the only version a test can call -
   and it keeps a finding's own stamp when it has one, so the reading agent's rows are not relabelled as a lane's.

## 60. The same run twice, and the two things it found that no single run could

### 60.1 A repeat nobody asked for, on the corpus everyone quotes

R-31 dispatched a paired runner arm, and its first arm was **the lanes as they ship** - the same configuration as R-30's
lanes arm, the same slice (`skip 50`, `max 100`), the same judge, the same corpus. That is a repeat, and it is the first
one this document has had on a corpus it quotes:

|                         | R-30 (`43795692468`) | R-31 (`43839753881`) |
| ----------------------- | -------------------: | -------------------: |
| pull requests asked for |                  100 |                  100 |
| pull requests read      |              **100** |               **98** |
| goldens                 |                  724 |                  715 |
| true positives          |                  143 |                  139 |
| comments                |                  656 |                  638 |
| precision               |               0.2180 |               0.2179 |
| recall                  |               0.1975 |               0.1944 |
| **F1**                  |           **0.2072** |           **0.2055** |

**Per pull request the corpus did not move at all**: the 98 shared rows carry goldens that differ in **0** of 98. What
moved is the reviewer - **47 of the 98 rows covered a different number of goldens, between one and three each way** - and
that is sampling, because nothing else differs.

So **the instrument's error bar at 715 goldens is 0.0017 in F1**, and one credit at that corpus is worth 0.0013. **A
device worth a single golden is inside the noise, and a device worth eight is not.**

### 60.2 The error bar was eleven times too wide, and it was hiding the verdicts

`resolutionFor()` carried `0.04 measured at 170 goldens`, from three runs over **the same five pull requests**, where one
true positive is four percent of the figure. Scaling that by `sqrt(170 / goldens)` predicted **0.0195 at 715 goldens**;
the repeat measured **0.0017**. The old anchor priced a runner's bad minute over a corpus too small to price anything;
the new one prices the reviewer with everything else held.

**What the over-estimate cost is a class of registration that could never be confirmed.** A comparison is confirmed only
when the gain exceeds the resolution, so at this corpus **every bar under 0.0195 was unfalsifiable by construction** - and
R-32's 0.01 was dispatched against exactly that. A bar below the error bar is not a strict bar; it is a bar that cannot
be cleared, and no amount of evidence repairs it.

Three changes, and the third is the one that matters:

1. **`REPRODUCTION` is the anchor**, exported with the two runs' figures, the golden count and the per-pull-request
   comparison, so the number in the formula is the number in the table.
2. **`MINIMUM_REGISTERED_GAIN`** is that error bar, and **`registrationResolvable()`** refuses a registration under it
   with the sentence that says so - _unfalsifiable_, not _inconclusive_, because the two want different repairs: a failed
   device is dropped, a meaningless bar is rewritten.
3. **The `inconclusive` outcome is gone**, because it is entailed. A magnitude is met only when
   `gain >= registeredGain`, and every registration now has `registeredGain >= resolution`, so **a met magnitude is
   outside the error bar by construction**. A branch that can only be reached by a registration the file refuses is a
   branch nobody can test; the self-test asserts the entailment instead of a fixture that reached it.

**What this does not do.** It does not confirm anything retroactively: every published verdict was computed against its
own registered bar, and the bar is what a device has to clear. It changes which _sentences_ a comparison is allowed to
print, and the noise guard it leaves in place is the **paired test** - `pValue` beside every row - which was always the
stronger instrument and is unaffected by any of this.

### 60.3 The two pull requests the corpus lost to a 500

R-31 asked for 100 pull requests and read 98. The two it lost are named in `prsWithoutDiffReasons`:

| pull request              | what the diff request said                 |
| ------------------------- | ------------------------------------------ |
| `infiniflow/ragflow#5065` | `500`, **4 615 requests left in the hour** |
| `bitcoin/bitcoin#32425`   | `500`, **4 486 requests left in the hour** |

Neither is a corpus with a typo in it and neither is a rate limit. **They are requests that failed**, and the harness
filed them under "the corpus could not supply it" - which moved the denominator from 724 goldens to 715, made two arms of
a comparison non-comparable, and left a re-dispatch as the only repair. A 2.5-hour dispatch, 2.10 USD, to fetch two
patches that a second attempt would have returned.

`fetchPrDiff` now retries **only the statuses that are worth it** - 408, 425, 429 and the 5xx family - four times with a
doubling wait capped at five seconds, and **not** 401/403/404/422, where four attempts spend the hour's budget to learn
what the first response already said. The attempt brings its own verdict (`retryable`), because a socket error and a wrong
URL are both `ok: false` here and only one of them is worth a second request; and **the last reason survives the
attempts**, so a pull request that is finally lost still says why. **A retry costs four orders of magnitude less than the
dispatch it replaces, and it is the same line of code either way.**

## 61. A rejected golden is not a missed defect, and the judge was never asked to say what it rejected

### 61.1 The largest block, read by hand

On R-31's lanes arm, of 715 goldens: **195 hit, 434 rejected on a file we commented on, 30 on a file we commented on
without touching the line, 56 in a file the pull request does not change.** So **60.7 % of what the reviewer misses is a
golden it stood in front of and was not credited for**, and 263 of those are on the exact line its comment sits on.

Eight of the 263, read against our own comment at the same line:

| pull request · file                                   | the golden's concern                                                               | our comment's concern                                                            | what the pair is                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `browser-use#857` `docs/customize/agent-settings.mdx` | the doc still says Playwright after the import moved to patchright                 | the example imports from patchright but builds the context through Playwright    | **the same defect**, said from the other end    |
| `electron#46982` `persistent_dictionary.h`            | `ValueOrDefault` is surprising: it needs `T{}`, it copies, `Get()` wants a pointer | `ValueOrDefault` returns the default when conversion fails, masking a type error | **the same defect**, ours sharper               |
| `electron#47361` `electron_api_session.cc`            | direct `delete this` bypasses normal destruction; use `CleanedUpAtExit`            | `ClearDataTask` deletes itself while `operations_` still holds live observers    | **the same defect**, ours about the consequence |
| `electron#47361` `electron_api_session.cc`            | `OnOperationFinished` erases with `remove_if` per completion, so O(n²)             | a use-after-free: the erase destroys the operation while its method runs         | **different defects on one line** - §59's case  |
| `electron#46982` `electron_api_web_contents.cc`       | `scaleFactor`, `copies`, margins are unvalidated user input                        | the chained `Set` on a temporary may not compile                                 | **different defects on one block**              |
| `cline#5524` `gemini.ts`                              | adjust the deprecation warning's wording to name both terms                        | the telemetry call site couples the handler to a concrete service                | different concerns                              |
| `cline#5524` `BrowserSession.ts`                      | the doc comment says "task ID", rename it to ULID                                  | a public API break: `setTaskId` renamed without a shim                           | different concerns                              |
| `electron#46982` `blink_converter.cc`                 | inline the `ValueOrDefault` call for conciseness                                   | `canScroll=false` no longer overrides `delta_units`                              | different concerns                              |

**Three of eight are the same concern in two vocabularies, two are a second defect at one site, three are a nit this
reviewer does not write** - and a reviewer that emitted the three nits would buy two credits at the price of 263 comments.
The split is the whole question: **the first row set is a matcher repair, the second is §59's device, the third is
nothing.**

### 61.2 The instrument, registered before its run

`scripts/aacr-rejudge.mjs` reads a **downloaded artifact** and re-reads its rejected same-line pairs. It costs judge calls
(~530) and no review pass, which is why it runs against a run that already happened rather than as a dispatch of its own.

- **The question is different from the judge's.** The run's judge is asked for `{"match": true|false}` and answers in four
  tokens. This reader is asked **to write the shared claim first, then decide**, and to reject in three named cases: the
  two are about different things, one is about _how something is written_ rather than what the code does, or the shared
  sentence would be equally true of any two comments on the same function.
- **Every real pair is read beside three controls, and the first is the weakest.** A crossed pair - our comment against
  a golden from another pull request - **can be rejected from the file extension alone**, so a zero there is not evidence
  that the reader read anything. The two hard controls live inside the pull request: **`sameFile`** is another golden from
  the same file of the same pull request - the pair §58.4 found 276 of, sharing the vocabulary, the module and the change
  and differing only in the defect - and **`samePull`** is a golden from another file of the same pull request, which a
  reader keying on the feature rather than the defect will accept.
- **`beyondControl` is the only number that may be quoted as recovery**: the real acceptance share minus **the highest
  control share**, times the pairs. **A reader that says yes to any two statements about one file has a lift of zero and
  recovers nothing**, however many real pairs it accepts; and because the controls differ in difficulty, the floor is the
  one that accepts the most, **named in the report** rather than assumed to be the hard one.
- **`null` is not a rejection.** A call that did not answer is counted as unanswered, and the share is computed over the
  answered pairs - the same distinction the judge loop makes, one instrument further out.

**Stopping rule, written before the reading.** The first reading, on the crossed control alone, returned **48 of 263
accepted against 0 of 263 crossed** - and that zero is exactly the number a reader should distrust, because the crossed
pair can be rejected without reading either sentence. **So the rule is stated against the hardest control that can be
built**, and the instrument was extended before anything was concluded from it. If the lift against `sameFile` is below
0.10 - the reader is not distinguishing two statements about one file from two statements about one defect by more than a
tenth - then **the matcher is not the repair**, the 434 stay as missed defects, and the next dispatch is §59's device. If the lift is above 0.30, the instrument has been understating recall by
more than a quarter of the goldens and the next dispatch is a wording device that states the defect in the vocabulary the
corpus uses - **not a looser matcher**, because a looser matcher raises recall by definition and precision only on paper.

**What this cannot decide.** Whether a _human_ would call the pair the same defect. The reader is a model with a prompt,
the same kind of instrument as the judge it is checking, and **the control is what keeps it from being a second opinion
that agrees with us.**

### 61.3 The hard control ate the finding, and that is the result

The re-read ran on R-31's lanes artifact - 263 pairs, four readings each:

| reading                                        | pairs | accepted |      share |
| ---------------------------------------------- | ----: | -------: | ---------: |
| the pairs the run rejected                     |   263 |       49 | **18.6 %** |
| crossed: golden from another pull request      |   263 |        1 |      0.4 % |
| **same file, same pull request, another line** |   219 |   **35** | **16.0 %** |
| same pull request, another file                |   222 |       12 |      5.4 % |

**A reader that accepts 18.6 % of the real pairs and 16.0 % of pairs made of our comment and a _different_ golden from the
same file is not detecting a shared concern. It is detecting a shared file.** The crossed control was 0.4 % because it
could be passed without reading either sentence, and the first reading's "48 recovered" was the instrument's bias, not
the judge's conservatism.

The paired form is the one to quote, because both readings exist on the same 219 pairs:

| discordance                                            |        count |
| ------------------------------------------------------ | -----------: |
| accepted the real pair, rejected the same-file pairing |       **28** |
| rejected the real pair, accepted the same-file pairing |       **28** |
| two-sided exact binomial                               | **p = 1.00** |

**Exactly balanced.** On the pairs where both readings exist, this reader is as likely to call a deliberately wrong
pairing a shared concern as the real one, and **the two-sided test cannot distinguish the split from a coin.**

So the stopping rule fires, and it fires on the number it was written against:

- **The matcher is not the repair.** The upper bound of the judge's undercount is **7 credits** - 49 observed against the
  42 the 16.0 % floor predicts - which is **+0.010 F1**, and a paired test that returns 1.00 cannot license it. An
  instrument change claiming those seven would be claiming a coin.
- **The bare four-token judge was right, and a looser matcher would have been a measurement made to flatter us.** This is
  the one direction that cannot be allowed, and it took a control to see it: without `sameFile`, the same reading reports
  a **+0.0707** re-scoring of the lanes arm (F1 0.2055 → 0.2762) that is **entirely an artifact**.
- **So the 434 are genuinely rejected**: our comments are about something in that file, and not about what the human
  reviewer was about. The 263 on the exact line are §59's case - two defects at one site - and R-32 is already in flight
  to price it.

**What this changes about how the other claims in this document should be read.** Every device registered here is measured
against a comparator arm, and the comparator is what makes the difference the device. **A reader - a judge, a matcher, an
anatomy tool - is the same kind of instrument and needs the same kind of control**, because the failure mode is identical:
a second reading that agrees with us about one file and one pull request, and is reported as agreeing with us about one
defect. The cross-pair control was invented here for a matcher and it belongs beside every readback in this document.

## 62. The reader-only arm, read on the rows it shares with its own baseline (R-31)

### 62.1 What was registered, and what the run costs

R-29 produced one number that no run had asked for: **0.2504 against 0.2148** on 46 pull requests and 330 goldens, for a
device that de-duplicates the reading reviewer's own list and cuts it to twelve per pull request. It was an accident of a
different experiment - the lanes arm had been emptied by an upstream cost rule, so the run compared the reader against
nothing and the comparison fell back to what the artifacts happened to hold.

**A device reachable only through an accident cannot be registered, repeated or falsified**, so R-31 made it a switch with
three states and registered the claim before dispatch:

| field        | value                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| claim        | the reader's own list, de-duplicated and cut to twelve per pull request, raises the file arm F1 by **at least 0.02** over the five lanes alone |
| bar          | F1 ≥ **0.2272**                                                                                                                                |
| recall floor | **0.1875** = the lanes' 0.1975 less one golden                                                                                                 |
| comparator   | `{agent off, ensemble off}` - the same dispatch, corpus, judge and commit                                                                      |
| slice        | `skip 50`, 100 pull requests, 715 goldens                                                                                                      |

**The recall floor is the part that matters.** A claim written as F1 alone licenses the most dangerous trade in this
document - delete comments until precision rises - and a device that buys a tenth of a point of F1 with two goldens of
recall has made the reviewer worse while the number went up.

### 62.2 The two totals, and the reason they are not subtracted

Run `43839753881`, both arms on `3f5bab58`, twenty-three minutes apart:

| arm                                  | reviewed |  TP |  FP |  FN | precision | recall |         F1 |
| ------------------------------------ | -------: | --: | --: | --: | --------: | -----: | ---------: |
| lanes (`agent off, ensemble off`)    |       98 | 139 | 499 | 576 |    0.2179 | 0.1944 | **0.2055** |
| reader (`agent on, ensemble reader`) |      100 | 122 | 443 | 602 |    0.2159 | 0.1685 | **0.1893** |

**The lanes arm is the R-30 arm re-run, and the two figures differ by one error bar.** R-30 measured 0.2072 on the same
configuration; this run measured 0.2055. The 0.0017 is the instrument's own resolution (§60), which is what makes the
0.0162 gap between the arms four times something rather than one measurement of nothing.

**The two arms did not read the same corpus, and the run is why.** The lanes arm lost two pull requests to `.diff`
requests that returned **500 with 4 615 and 4 486 requests left in the hour** - `infiniflow/ragflow#5065` and
`bitcoin/bitcoin#32425` - and the reader arm, dispatched twenty-three minutes later, lost none. The retry this document
records in §60 landed in `f6ab5a58`, twelve hours after this run was dispatched, so the gap is a fossil of a defect that
is already fixed rather than a difference between the devices.

**So the totals are not a comparison and this document does not treat them as one.** An F1 over 98 rows cannot be
subtracted from an F1 over 100, and the comparison job refused to do it - correctly, and for the first time in this
repository, loudly.

### 62.3 The paired reading on the 98 rows both arms read

The refusal now prints what a corpus gap does not touch. A `(pull request, golden)` pair on a shared row is a pair: both
arms were given the same code, the same goldens and the same judge there, so a golden one arm found and the other did not
is a discordance the corpus cannot explain.

| reading on the 98 shared rows |         pairs |
| ----------------------------- | ------------: |
| covered by both arms          |        **57** |
| covered by the reader only    |        **63** |
| covered by the lanes only     |        **82** |
| two-sided exact binomial      | **p = 0.135** |

**The point estimate favours the lanes and the test will not sign it.** 145 discordant pairs split 63:82 is a 19-pair
edge, and the two-sided exact test puts it at p = 0.135 - inside the noise this instrument can see, and nowhere near the
+0.02 the registration asked for. The registration is falsified on its own bar, not on a technicality: **0.1893 against a
floor of 0.2272, and 0.1685 recall against a floor of 0.1875.** Both halves of the claim fail, and they fail in the
direction the paired test points.

**The golden-level coverage says the same thing more directly**, because it needs no denominator: on the same 715 goldens
the reader found **120** and the lanes found **139**.

### 62.4 What this does and does not falsify

**It does not falsify "de-duplication and a twelve-comment cut are worthless".** The arm that ran differs from its
baseline in `agent` as well as `ensemble`, and it must: `CODE_CONTEXT` is `AGENT || AACR_CODE_CONTEXT`, so a reading
reviewer is shown the code it reads (§44's entailment). The experiment this run bought is **the reader as a whole against
the lanes**, one device with a switch, and that is the device that lost.

**What it falsifies is the whole-device claim, and that is the one that was registered.** A later registration for the cut
alone would need a baseline this matrix does not build - `agent on, ensemble off` - and that arm does not exist yet.
Writing the claim down as "the cut is worthless" would be reading a two-key experiment as a one-key one, which is §44's
defect wearing the opposite mask.

### 62.5 Why 0.2504 was not evidence, in one line

46 pull requests, 330 goldens, one arm, and an artifact that had already lost its comparator to an upstream rule. Against
a resolution of 0.0017 (§60), R-29's +0.0356 is twenty times the instrument and was **still wrong by 0.016 in the
direction of the device** - which is the cheapest possible demonstration that a number without a comparator is a rumour,
and that the comparator is what costs the money.

### 62.6 The instrument this run changed

`aacr-ablation-compare.mjs` refused the pair and said one sentence. It still refuses - **the totals really are not
comparable** - and it now computes `pairedOnCommonPullRequests` before refusing: the covered pairs restricted to the rows
both arms read, the dropped keys named on both sides, and a line in the log that a reader can act on:

```
AACR-ABLATION paired on the 98 pull requests both arms read · +63/-82 · p=0.13468540318097638 · dropped 2 with, 0 without
```

Three tests hold it: a pair read the whole corpus is not turned into a paired-only comparison, a golden on a row only one
arm read is not a discordant pair, and two goldens on one row are two pairs. **The failure this prevents is not a wrong
number, it is a paid run that has to be paid for again** - because a job that answers "not the same experiment" and
nothing else gets dispatched unchanged by whoever needs the answer.

### 62.7 Where 0.2055 sits against what is published

**These are not the same denominator and the table is not a leaderboard.** The corpus paper reports on the full 200 pull
requests; this document reports a `skip 50` slice of 100. What the table is for is the width of the field:

| system, as published                              |         F1 |  precision |     recall |
| ------------------------------------------------- | ---------: | ---------: | ---------: |
| AACR-Bench paper, Claude-4.5-Sonnet in agent mode |     0.1612 |     0.3990 |     0.1010 |
| AACR-Bench paper, no context, GLM-4.7             |     0.1603 |     0.1130 |     0.2757 |
| AACR-Bench paper, embedding retrieval, GLM-4.7    |     0.1563 |     0.1100 |     0.2698 |
| **this repository, lanes, 100 pull requests**     | **0.2055** | **0.2179** | **0.1944** |

**The published field tops out at 0.1612 and every entry in it trades one of the two rates for the other.** The agent
column is 0.3990 precision at 0.1010 recall - "contextual tunnel vision", in the paper's phrase - and the no-context
column is the mirror. This repository's 0.2179 / 0.1944 is the only row in the table that holds both above 0.19, which is
what a merge of lanes and a reader was supposed to buy and what §62.2 shows it did not.

**And F1 is not the whole instrument.** CR-Bench's finding is that a reviewer's usefulness and its signal-to-noise ratio
move apart as recall is pushed: their single-shot agent scores 0.2701 recall at SNR 5.11, and the same model under
reflexion reaches 0.3276 recall at **SNR 1.95** - more defects found, at half the trust. That is the trade §62.1 wrote a
recall floor against, measured on a different corpus by different people.

### 62.8 The next device, and the number it must beat

The reader is closed. The lane reviewer stands at **0.2055 ± 0.0017** on this slice, with 434 of its 715 goldens rejected
on a path it had already commented on and **263 of those on the exact line** (§61). R-32 is in flight on that number, with
its mechanism registered in advance: `F1 = 2TP/(C+G)`, so **an added comment raises F1 exactly when its own precision
exceeds F1/2 = 0.1028**, and a second concern at a site draws from category base rates of 0.17 to 0.32.

The bar R-32 has to clear is **0.2172**, and the field it has to beat is **0.1612**. Those are different numbers and only
the first one decides whether the device is real.

## 63. The same device, two slices, two signs

### 63.1 The reading that does not fit

R-29 measured the reader's de-duplicated, twelve-per-pull-request list at **0.2504 against 0.2148** on `skip 150` - 46
pull requests, 330 goldens, `+0.0356` F1, and §57.1 confirmed it against a registered bar of 0.02. R-31 measured the same
selector on `skip 50` - 100 pull requests, 715 goldens - at **0.1893 against 0.2055**, `-0.0162`.

| slice                    | rows | goldens | comparator |     device |       delta |
| ------------------------ | ---: | ------: | ---------: | ---------: | ----------: |
| `skip 150` (§57.1, R-29) |   46 |     330 |     0.2148 | **0.2504** | **+0.0356** |
| `skip 50` (§62.2, R-31)  |  100 |     715 |     0.2055 | **0.1893** | **-0.0162** |

**Both figures are real readings of their own rows, and they disagree about the sign of the device.** The gap between them
is 0.0518, which is **thirty times the 0.0017 this instrument resolves when the same configuration is run twice** (§60).
The measurement is not the problem: two runs of one configuration land 0.0017 apart, and one device lands 0.05 apart
between two corpora drawn from the same dataset.

### 63.2 What that does to the error bar, and to every confirmation in this document

**The error bar in §60 is sampling noise on one slice, and it is not the error bar of a claim.** A claim in this document
is a sentence about _this corpus_, and the corpus has two halves that do not agree. So a confirmation measured on one
slice is a verdict about that slice - which is what every registration here already says in its `confirmation` field, and
what none of them was read as until these two numbers sat beside each other.

That has three consequences, and they are all expensive:

- **A confirmed device has to be confirmed twice**, on two slices, before this document may call it a property of the
  reviewer rather than of a corpus. The second confirmation is not a formality: 0.0356 and -0.0162 are the two answers
  the same arithmetic gave.
- **A falsified device has to be falsified twice as well**, for the same reason in the other direction. R-31's verdict on
  `skip 50` does not overrule §57.1's reading on `skip 150`; **it makes the slice part of the finding**, and the reader is
  therefore closed as _unstable_ rather than as _harmful_.
- **The comparison job cannot see any of this**, because it compares one pair at a time and has no field for "the same
  device disagreed with itself across corpora". That field is a table in this document and nothing else, which is a
  weaker instrument than the one §62.6 built - and naming the gap is the first step to closing it.

**§62.5 called 0.2504 a rumour and that was too strong.** It was a reading of 46 pull requests with an empty lane side
(§57.2), and it was reproducible arithmetic on the rows it named. What it was not is general: on the rows this document's
later runs used, the same selector cost 0.0162. The word to retire is not "rumour" but "confirmation".

### 63.3 The confound that has to be ruled out before the slice is blamed

**Two things differ between those two rows, and only one of them is the corpus.** R-29's arm was `ensemble: on` with the
lanes emptied by the upstream cost rule (§57.2), so its selection ran over one reviewer's candidates through the merge
path. R-31's arm is `ensemble: reader`, a switch written afterwards to make the same selection reachable on purpose.
**An artifact that records a device under a different name is not thereby the same device**, and the possibility that the
two implementations differ is not excluded by any field either run published.

So the honest form of §63.1 is: **either the slice changed the sign of the device, or the two implementations are not the
same device.** Distinguishing them needs one dispatch the matrix can already build - `ensemble: reader` on `skip 150`,
against the same comparator §57.1 used - and it is the cheapest 0.02 this document has ever had the chance to buy: if the
selector scores 0.2504 there again, the device is real and slice-dependent, and if it scores 0.19 the two implementations
differ and §57.1's number belongs to a device that no longer exists.

> **The confound is excluded, and the artifact excluded it.** `merge.sides` - the field §57.2 added for exactly this
> question - reads **`{lanes: 0, reader: 802}`** on R-31's reader arm: the merge was handed one reviewer's candidates
> and nothing else, which is the shape R-29's empty-lane arm ran. 802 candidates became 666 after the duplicate rule and
> the twelve-per-pull-request cut (104 duplicates, 32 not kept, 79 pull requests decided by budget and 21 by the model),
> and that is the whole of the device. **The two arms are the same selector, and the sign changed with the rows.**

**And the same arm was 25 % more expensive than the one it lost to.** R-31's reader arm spent **1.83 USD against 1.46** -
2 980 calls against 5 730, at a cache-hit ratio of 0.74 against 0.91 - of which **0.65 was 500 lane calls whose findings
never reached the merge**, because reader mode still ran the lane loop and then discarded it. `lanesRun` is
`!AGENT || (ENSEMBLE && !ENSEMBLE_READER_ONLY)` in the tree today, so that half is already fixed; the run bought it at the
old price. **A device that costs more and scores lower is not a device to iterate on**, which is the second reason the
reader is closed rather than repaired.

### 63.4 What the field publishes, and why the comparison is still worth making

The published systems in §62.7 sit between 0.1563 and 0.1612 on the full corpus. **Whatever the slice does to a
difference of 0.05, it does less than that to the distance between 0.2055 and 0.1612**, because the second number is a
property of a whole system measured on 200 pull requests and the first is a property of this system on 100. The field is
still the field; the error bar on our own number is now the width of our own corpus, and that is what the next
registration has to be written against.

## 64. The error bar was the error bar of one slice, and it was ten times too small

### 64.1 Two corrections that walked past each other

This document has now carried three error bars, and the sequence is worth more than any one of them:

| #   |                            Bar | Where it came from                                         | What it actually measures       |
| --- | -----------------------------: | ---------------------------------------------------------- | ------------------------------- |
| 1   |            0.04 at 170 goldens | three runs over **five** pull requests                     | a runner's bad minute           |
| 2   |          0.0017 at 715 goldens | one configuration dispatched **twice** on one corpus (§60) | the reviewer, corpus held fixed |
| 3   | **0.0191 at 98 pull requests** | **resampling the corpus from one artifact** (§64.2)        | **the corpus**                  |

Correction 2 was written against correction 1 and was right about the method: 0.04 was extrapolated from five pull
requests where one true positive is four percent of the figure, and two dispatches of one configuration is a
measurement. **It was wrong about the question.** A registration is not a claim about the reviewer - "this reviewer is
stable" - it is a claim about a corpus - "this device raises F1 on review data" - and a two-run repeat holds the corpus
_still_. The number it returns is the floor of the instrument, not its resolution.

**And the arithmetic is a warning about which error is cheaper.** The old anchor resolves **0.0195** at 715 goldens -
within three percent of the 0.0191 computed below. Its derivation was wrong and its number was right. The replacement's
derivation was right and its number was **eleven times too small**. A number right for the wrong reason and a number
wrong for the right reason are both wrong, and this document preferred the second for one iteration because it could
point at a repeat.

### 64.2 What the corpus is worth, computed rather than argued

Every artifact carries its figure per pull request: goldens on the row, which of them were covered, how many comments
were posted. Those are whole contingency-table rows, so they can be resampled - **with replacement, one pull request at
a time, keeping its three numbers together** - and F1 recomputed from the resampled totals on each draw. The spread of
that distribution is what a second corpus of the same size would move the figure by. `scripts/lib/corpus-resolution.mjs`
does it; the reading on R-31's 98 rows is:

| Quantity                                     |                             Value |
| -------------------------------------------- | --------------------------------: |
| Paired difference (reader − lanes)           |                       **−0.0162** |
| Standard deviation of that difference        |                        **0.0191** |
| 95 % interval, 4000 resamples, seed 20260816 |            **[−0.0531, +0.0221]** |
| Share of draws where the reader wins         |                        **0.2008** |
| Standard deviation of one arm alone          |                            0.0162 |
| Seeds 20260816 / 1 / 2 / 99                  | 0.0193 / 0.0189 / 0.0191 / 0.0188 |

**The unit is the pull request and that is the whole point.** Goldens inside one row are not independent: a reviewer
that understood a file covers several of them, one that missed it misses several. Resampling goldens would treat 715
draws as 715 independent observations and return a bar about three times too small - **an error bar that flatters every
device, which is the same defect as 0.0017 with better arithmetic behind it.**

**Two instruments, one verdict.** The bootstrap says `P(reader ahead) = 0.20`; McNemar on the 63:82 golden-level pairs
says `p = 0.135`. Neither signs the reader's deficit and neither calls it a win, which is what §63 recorded before the
corpus bar existed. The bootstrap is the more conservative of the two and the one a bar has to clear.

**And pairing bought almost nothing.** A paired design is supposed to shrink the difference's variance below the sum of
the arms'; here one arm's spread is **0.0162** and the difference's is **0.0191** - the reviewer's errors on the two arms
are nearly independent, so there is nothing to cancel. That is asserted in the self-test rather than left as a hope:
`CORPUS_SAMPLING.armSd < CORPUS_SAMPLING.deltaSd`.

### 64.3 A field called `emitted` that means "considered"

The first version of this analysis read `emitted` from each row and produced **lanes 0.1523, reader 0.1752** - the arm
that lost, winning. `emitted` is the full emission before the actionability gate and the per-pull-request budget (1110
comments on the lanes arm); `shippedEmitted` is what was posted (638). Reading the first counts 472 comments the budget
discarded as false positives, and it penalises the arm that emits more **for doing the thing the budget exists to
control**.

**A sign that flips on a field name is the most expensive kind of bug in this file**, because it looks like a finding.
`perPullRequestOutcome` reads `shippedEmitted`, falls back to `emitted` only with `estimated: true`, and a test asserts
both branches on a row where the two differ by a factor of twenty.

### 64.4 What this does to the registrations on file

| Registration                            |      Bar | Against 0.0191 | Read as                                 |
| --------------------------------------- | -------: | -------------- | --------------------------------------- |
| §8 languageChecklist                    |     0.04 | clears         | answerable                              |
| §45 adjudicate                          |     0.04 | clears         | answerable                              |
| §19 / §20 / §47 / §48 / §53 / §56 / §58 |     0.02 | clears by 5 %  | answerable, and only just               |
| **§59 (R-32) secondConcern**            | **0.01** | **inside**     | **unfalsifiable — point estimate only** |

`MINIMUM_REGISTERED_GAIN` moves from 0.0017 to **0.0191**, and `resolutionForPullRequests()` is the function to ask what a
smaller bar would cost: **a 0.01 bar needs 358 pull requests**, which is 3.7 times the corpus this project buys for
$1.46 an arm.

**R-32 is not re-registered and not withdrawn.** It was dispatched on 2026-11-16 against §60's 0.0017, its two arms are
running, and its artifact will arrive. Rewriting its bar upward after seeing the design is the one thing worse than
registering it too low, so the entry carries `registeredBelowResolution: true`, `registrationResolvable` returns `false`
for it, and its outcome may only be recorded as **a point estimate that no amount of evidence could confirm**. What the
run still buys is the first measurement of `secondConcern` and a reading of `keptAsSecondConcern`, which is a question
about whether the device ran rather than about how much it is worth.

### 64.5 Answerable is not confirmable, and 0.02 clears by five percent

A bar at 0.0191 sits one standard deviation from zero. **A device that truly does nothing reads past it about fifteen
percent of the time** - `P(Z ≥ 1.05) = 0.147` - so "answerable" and "confirmable" are two different gates and this
document had only the first. The seven 0.02 registrations clear the bar by five percent, which means a `confirmed` verdict
on any of them is a coin-flip's cousin.

**The gate that is missing is the one already in the artifact.** `pairedTest.pValue` is computed on every comparison and
no branch reads it: a run can reach `magnitudeMet` with `p = 0.4` and be filed as `confirmed`. Closing that is §65, and
it is the reason 64.4's table is a table of bars rather than of devices.

## 65. The job computed a p-value on every comparison and no branch read it

### 65.1 Two questions, one of them asked

A registration asks **"is the gain at least what was written down"**. The corpus asks **"could this gain have arrived by
resampling the pull requests"**. Until this section the comparison job answered the first and printed the second:
`pairedTest.pValue` has been in every artifact since §51 and no branch of `summarise` consulted it. **A run could reach
`magnitudeMet` with `p = 0.4` and be filed as `confirmed`**, which is a table of noise with a threshold attached - and
§64 showed the threshold was one standard deviation from zero, where a device that does nothing reads past it 14.7 % of
the time.

### 65.2 Which test, and why not the one already there

The artifact already carried McNemar's p over the goldens the two arms agree and disagree on. **It is not the test a bar
should clear**, because goldens inside a pull request are not independent: a reviewer that understood a file covers
several of them, one that missed it misses several. A golden-level test treats 724 draws as 724 observations and is too
optimistic by however much the rows cluster.

So `significance` resamples **pull requests**, with replacement, keeping each row's goldens, coverage and posted comments
together, and reports the standard deviation, the interval and the z of the paired difference. Both numbers are published
because they disagree and the disagreement is informative:

| Instrument                               | R-32                                        | Reads                   |
| ---------------------------------------- | ------------------------------------------- | ----------------------- |
| McNemar, 84 : 48 goldens                 | p = 0.0022                                  | significant             |
| Clustered bootstrap, 100 rows            | z = 1.97, p = 0.0485, CI [−0.0005, +0.0582] | signed, on the boundary |
| Share of resamples where the device wins | 0.9728                                      | 97 %                    |

**The clustered one is the one a bar has to clear**, and it is 45 times less impressed by the same evidence.

### 65.3 Three things `signed` means, and the one that is not a formality

- **The rows have to reproduce the published figure.** If the resampled mean misses the delta by more than one standard
  deviation, the rows and the totals are about two different corpora - an artifact with no `shippedEmitted`, a total
  written beside rows instead of summed from them - and `inconsistent: true` refuses to sign. **A bootstrap that
  disagrees with the number it is qualifying is not an error bar, it is a second opinion.** This is how the self-test's
  own fixtures were found to be two corpora in one artifact.
- **The difference has to be outside the resampling noise**, which is `p <= 0.05` on the clustered z.
- **A corpus of width zero is signed on its point estimate**, because a distribution that never moves does not change
  sign under resampling - `sd: 0` is published for a reader to weigh rather than hidden.

`confirmable` is the _ex ante_ version and belongs in the registration: **a bar needs 1.96 standard deviations of the
corpus it will be judged on**, which is 0.0372 on R-31's 98 rows and 0.0294 on R-32's. Every 0.02 registration on file
clears `resolvable` and cannot clear `confirmable`, and **that is the sentence that should have been written before the
dispatch rather than after it.**

### 65.4 The new outcome, and why it is not `inconclusive` returning

```
met but not signed: 0.0343 F1 on the file arm clears the 0.02 registered, and over 100 pull requests the paired
difference is 0.021 wide, so the gain is 1.48 standard deviations (p = 0.1376)
```

`inconclusive` was deleted in §60 because it could only be reached by a registration the file refuses. **This sentence is
reachable by a real device on a real corpus** - a gain that meets its bar and cannot be signed - and it is the honest name
for the state this project will be in whenever a device is smaller than the corpus can see. A job that folded it into
`confirmed` would publish noise; one that folded it into `falsified` would throw away a device that works.

## 66. R-32: the first device that moved the figure and the registration that cannot sign it

### 66.1 The reading

Run `43854378420`, both arms on `skip 50 max 100`, 100 pull requests, **724 goldens** (R-31 read 715 because two diffs
returned 500; §60's retry fixed that, so this run read the whole slice), same judge, same configuration except the switch:

| Arm                    |      TP |  FP |      FN |       P |           R |          F1 |   Cost |
| ---------------------- | ------: | --: | ------: | ------: | ----------: | ----------: | -----: |
| `secondConcern: false` |     140 | 514 |     584 |  0.2141 |      0.1934 |  **0.2032** |  $1.17 |
| `secondConcern: true`  |     176 | 612 |     548 |  0.2234 |      0.2431 |  **0.2328** |  $1.15 |
| **Δ**                  | **+36** | +98 | **−36** | +0.0093 | **+0.0497** | **+0.0296** | −$0.02 |

**The mechanism is the registered one and it is recall.** 36 more goldens found, 98 more comments paid for them, and
precision rose anyway - because the second concern is kept only at a range the reviewer already reported, so it costs one
comment per site rather than one per finding.

**The device demonstrably ran**: `engineCounters.dedup.keptAsSecondConcern` is **596** on the arm that has it and **0** on
the arm that does not. Of 3 372 merged findings, 1 714 were removed by the range rule alone (1 701 of them `rangeOnly`)
and **596 survived as a second concern** instead of being swallowed by a cross-category overlap. On the control arm the
same rule removed 2 306 of 3 401 and kept none.

### 66.2 The verdict, and the two gates that disagree

| Gate                                            | Value                    | Reads                    |
| ----------------------------------------------- | ------------------------ | ------------------------ |
| Magnitude (≥ 0.01)                              | +0.0296                  | met                      |
| Mechanism (recall rises, precision not lowered) | +0.0497 / +0.0093        | met                      |
| Slice (`skip 50 max 100`)                       | matches                  | met                      |
| Device inputs                                   | not required             | —                        |
| **Signed (clustered, p ≤ 0.05)**                | **z = 1.97, p = 0.0485** | **met, on the boundary** |
| **Answerable (bar ≥ corpus resolution 0.019)**  | **0.01 < 0.019**         | **not met**              |
| `confirms`                                      | **false**                | **unfalsifiable**        |

**So the artifact says something no earlier artifact in this document could say: the device works and the registration
was written too low to say so.** §60 replaced a 0.0195 anchor with 0.0017 and R-32 was registered at 0.01 against the
second one; §64 measured the corpus at 0.0191 and the bar fell underneath it. **The result is exploratory, not
confirmatory, and the difference is not a technicality** - a bar that cannot be resolved cannot distinguish a device
from the noise it sits in, however large the point estimate turns out to be.

What it does establish, on 100 pull requests with a clustered test and a McNemar beside it: **keeping a second concern
at a site is worth about three points of F1 and five points of recall, at no cost in precision or dollars.** What it does
not establish is that a gain of that size would be found again on a corpus this project has not read.

### 66.3 Where 0.2328 stands

| System                                       |         F1 | Note                         |
| -------------------------------------------- | ---------: | ---------------------------- |
| Claude-4.5-Sonnet, agent, no context (§62.7) |     0.1612 | the published leader         |
| this project, `secondConcern: false`         |     0.2032 | the same slice, the same day |
| **this project, `secondConcern: true`**      | **0.2328** | **+44 % over the leader**    |

The comparison is not a like-for-like benchmark - the leader's number is over the full 200-pull-request corpus and ours
over the hundred starting at fifty - and it is the only number this project has that is both measured on a public corpus
and above every published figure on it.

### 66.4 What has to happen next

1. **R-33 is dispatched** (`43898771717`, `skip 150`, `second_concern: pair`) to test the direction on rows no second
   concern experiment has read. Two slices agreeing is what §63 requires before a device is called real, and it is now
   the only thing standing between this reading and a confirmation.
2. **Nothing is re-registered before R-33 lands.** Writing a 0.0374 bar now, having seen +0.0296, would be fitting the
   threshold to the result - the exact defect the `skip 50 / skip 150` split exists to prevent.
3. **A confirmation of this device needs a corpus, not a bar.** At 100 pull requests a 0.03 effect is a 1.97-sigma
   effect; the same effect on 358 pull requests would be 3.7 sigma. The next dispatch after R-33 should buy rows, not
   switches.

## 67. Two hundred pull requests were always available and the instrument could only read a hundred

### 67.1 The corpus this project already owns

§63 requires a device to be confirmed on two slices, because one slice moved the sign of a device by 0.0518. That rule
buys a second reading and, until this section, threw away its arithmetic: **`skip 50 max 100` and `skip 150 max 100` are
disjoint halves of one two-hundred-pull-request corpus**, the registration names both, and the effect measured on either
half estimates the same effect.

**The consequence is arithmetic, not opinion.** A standard error falls with the square root of the sample:

| Corpus          |    Rows | Standard deviation at R-32's spread | +0.0296 is               |
| --------------- | ------: | ----------------------------------: | ------------------------ |
| one slice       |     100 |                              0.0150 | 1.97 sigma, p = 0.0485   |
| **both slices** | **200** |                          **0.0106** | **2.8 sigma, p = 0.005** |

**So the second slice is not only a direction check. It is 100 more rows of the same experiment**, and the corpus this
project can afford is already twice the corpus it has been testing on. Nothing in the instrument could say so, because
`sliceMatches` read one artifact's single slice and there was no way to hand the job two.

### 67.2 What merging has to refuse

`mergeSlices` in `scripts/lib/slice-merge.mjs` concatenates the coverage rows, **re-derives the totals from the rows
rather than adding the two totals**, and records which dispatches the corpus came from. Three refusals, each naming what
failed, because each wants a different repair:

| Refusal                               | Why                                                               |
| ------------------------------------- | ----------------------------------------------------------------- |
| a pull request appears in both slices | a row counted twice is a corpus that weighs it twice              |
| the configurations differ             | two arms of two devices summed is a device that never ran         |
| a slice does not say where it started | a merge of unrecorded slices is a merge into one anonymous corpus |

**Totals are re-derived and not added** for the reason §65 found in the self-test: an artifact can publish a total that
its rows do not support, and a merge that added the totals would carry both errors into the corpus the bar is computed
on.

### 67.3 The slice gate, restated

`sliceMatches` asked whether **any** declared slice was the one this artifact read. It now asks whether **every** slice
the registration names **is among the rows the artifact read**, which is the same answer for a single dispatch and the
only sensible one for a merge: more data bearing on the same sentence is not a confound, and the run that read both
halves has read the half the sentence was about.

A merged artifact carries `corpusSlice.slices`, `prsReviewed` equal to the sum, and `mergedFrom` naming each input's
slice, row count and totals - because a corpus assembled from two dispatches has to be able to say which two.

### 67.4 What this changes about the next result

Nothing is re-registered on the strength of R-32's +0.0296, and the merge does not make a 0.01 bar resolvable. **What it
does is make the effect signable without buying another experiment**: R-33 is already dispatched on `skip 150` with the
same two arms, and merging its artifacts with R-32's gives 200 rows, one device, one configuration, and a standard
deviation of 0.0106 instead of 0.0150.

**The registration that merge can answer has to be written before R-33's number is read** - which is the only thing that
keeps this from being a threshold fitted to a result. It is written in §68 when R-33 lands, against 0.0106 and not
against whatever the second slice happens to show.

## 68. A bar written before the second slice, and the lookup that lets two sentences share one switch

### 68.1 Why this section is written now rather than when R-33 lands

R-33 is running on `skip 150` with the same two arms. Its number will be a gain, and **any bar written after seeing a
gain is a description of that gain**. §67 puts the standard deviation of a 200-row corpus at 0.0106; signing needs 1.96 of
them; the bar is therefore **0.021**, and it is arithmetic rather than an observation:

| Quantity                                   |      Value | Source                                |
| ------------------------------------------ | ---------: | ------------------------------------- |
| Standard deviation, one slice of 100 rows  |     0.0150 | R-32's own rows, resampled            |
| Standard deviation, two slices of 200 rows | **0.0106** | √(100/200) × 0.0150                   |
| Smallest signable gain                     | **0.0208** | 1.96 × 0.0106                         |
| **R-34's registered bar**                  |  **0.021** | this table, written before the result |

If R-33's gain lands under 0.021 the registration is falsified and that is the answer. If it lands above it, the corpus
is signed - and **the reading will be one sentence about 200 pull requests rather than two sentences about 100 each**,
which is the only way this project's corpus produces a signable result.

### 68.2 The lookup had to change, and it is not a convenience

`REGISTRATIONS` is keyed by the configuration field a device varies, so `secondConcern` mapped to exactly one sentence.
One switch now needs two - the 0.01 bar R-32 was dispatched against, and the 0.021 bar for the corpus two dispatches
make - and **the choice between them is a fact about rows, not about which key is spelled first**:

- a single-slice artifact is judged against §59's 0.01, so **a published verdict stays reproducible**;
- a merged artifact is judged against §68's 0.021, because it holds the rows that sentence names;
- ties go to the sentence naming more slices, and a field's own entry is the fallback so an artifact whose rows nobody
  named still gets an answer rather than a silence.

`registrationFor(field, readSlices)` is that rule, tested in both directions: **the same two artifacts, differing only in
whether they are one dispatch or a merge of two, are judged against different bars** - and neither reading is allowed to
borrow the other's.

### 68.3 What would make this section wrong

Three things, and each has a test rather than a sentence:

1. **Reading R-33 first and adjusting 0.021 afterwards.** The commitment is that this number is a function of 0.0106; the
   test asserts the registration's bar and confirmation literally, so a later edit is a visible diff.
2. **Applying the wider bar to a narrower corpus.** A single dispatch measures at 0.01 whatever the new entry says, and
   the test asserts that its outcome is still `unfalsifiable`.
3. **Reading a merge whose inputs disagree.** `mergeSlices` refuses overlapping pull requests, differing configurations
   and unrecorded slices; a merge that let any of those through would produce a corpus whose error bar is computed on rows
   that are not an experiment.

## 69. The second slice reversed the sign, and the pairs were read again

### 69.1 R-33, and the corpus it was merged into

R-33 (`43902714209`) ran the same two arms on `skip 150` and read **46 pull requests**, not the hundred the slice
asked for, because the dataset holds 196 and the first 150 have already been spent. Its own reading is negative:

| reading          | rows | goldens | device off | device on |       delta |
| ---------------- | ---: | ------: | ---------: | --------: | ----------: |
| R-32, `skip 50`  |  100 |     724 |     0.2032 |    0.2328 | **+0.0296** |
| R-33, `skip 150` |   46 |     330 |     0.2319 |    0.1975 | **−0.0344** |

**Two slices, two signs, and each is a real reading of its own rows.** The gap between them is 0.0640 across a device whose
whole claim was 0.01, which is §63's rule arriving at the device §59 registered: a confirmation on one slice is a sentence
about that slice. §68 was written before R-33 landed precisely so that the answer would be this table and not a bar chosen
from it.

`scripts/aacr-merge-slices.mjs` then joined them into one corpus of **146 pull requests and 1 054 goldens**, and the
comparison job was asked the question §68 was written for:

| quantity                       |                value |
| ------------------------------ | -------------------: |
| file arm, device off           |               0.2125 |
| file arm, device on            |               0.2214 |
| **delta**                      |          **+0.0089** |
| cluster bootstrap sd, 146 rows |               0.0130 |
| 95 % interval                  |   −0.0167 to +0.0346 |
| paired, exact McNemar          | +105/−75, p = 0.0304 |
| z against zero                 |                 0.68 |
| **registered bar (§68)**       |            **0.021** |
| outcome                        |        **falsified** |

**The paired test and the bootstrap disagree, and the bootstrap is the one the registration named.** The exact McNemar
counts _which_ goldens changed hands and calls 180 discordant pairs 0.03; the bootstrap resamples the _pull requests_ and
asks how much the figure would move if the corpus were drawn again, and 146 rows cannot distinguish +0.0089 from zero. A
golden inside a pull request is not an independent observation, and a test that counts goldens counts one pull request's
twelve findings twelve times.

### 69.2 The arithmetic in §67 assumed rows that do not exist

§67 projected 200 rows and a standard deviation of 0.0106. **The corpus is 196 pull requests and the second slice could
only supply 46**, so the merged reading is 146 rows and 0.0130 - not 0.0106:

|    rows |         sd | smallest signable gain | §68's 0.021 bar is   |
| ------: | ---------: | ---------------------: | -------------------- |
|     100 |     0.0150 |                 0.0294 | unusable             |
| **146** | **0.0130** |             **0.0255** | **below resolution** |
|     196 |     0.0113 |                 0.0221 | signable             |

**So §68's bar was written under the resolution of the corpus that would judge it**, which is the defect
`registrationResolvable` was written to refuse and which the artifact now reports on its own verdict as
`insideResolution: true` and `confirmable.needs: 0.0255`. The prediction was falsified on the magnitude it named _and_ it
could not have been confirmed at 146 rows whatever the device did. **Both sentences are true and only one of them is the
finding**: the device is not real, and the bar was unreachable.

**The repair is arithmetic rather than a new threshold.** A registration's bar has to be the larger of the effect it
claims and the smallest gain the corpus it will be judged on can sign - `MINIMUM_REGISTERED_GAIN` is 0.0191 for that
reason, and 0.021 should have been 0.026. Writing 0.026 now, having seen +0.0089, is not the defect §68.1 guarded
against: the number is a function of 146 rows, not of this reading.

### 69.3 The cut space is closed, and that is a measurement rather than an opinion

Every device that only reshuffles or subtracts has now been priced on the merged corpus. Per-category precision over the
shipped rows of both slices:

| category        | shipped | goldens credited | precision |
| --------------- | ------: | ---------------: | --------: |
| bug             |     510 |              134 |     0.263 |
| architecture    |     307 |               50 |     0.163 |
| maintainability |      58 |                7 |     0.121 |
| documentation   |      43 |                9 |     0.209 |
| security        |      44 |               10 |     0.227 |
| performance     |      15 |                5 |     0.333 |
| style           |      11 |                2 |     0.182 |

and the best single cut is the arithmetic no reader wants:

| cut                    |     F1 | delta against 0.2125 |
| ---------------------- | -----: | -------------------: |
| drop `style`           | 0.2117 |              −0.0008 |
| drop `maintainability` | 0.2117 |              −0.0008 |
| drop `performance`     | 0.2092 |              −0.0034 |
| drop `architecture`    | 0.1925 |              −0.0200 |
| drop `bug`             | 0.1084 |              −0.1042 |

**Nothing to drop.** `test` is already dropped by the emission rule, the smallest categories cost more than they save,
and the two that carry 85 % of the credits carry 85 % of the volume with them. This closes §19.3's question with the
corpus rather than with a slice: a device that can only subtract cannot win the trade, and there is no cut in the
artifact that wins it either.

### 69.4 The rejected pairs were read again, and the matcher is not the bottleneck

The largest bucket in the miss anatomy is not a miss at all: **449 goldens sat in a file we had commented on and the judge
rejected the comment**, 263 of them on the golden's exact line. If those are the same defect said in other words, the
repair is a better matcher and the finder is fine. `aacr-rejudge.yml` reads each pair beside three controls, and its run
(`43869953158`, over the artifact of `43839753881`) answered:

| reading                                   | pairs | accepted |  share |
| ----------------------------------------- | ----: | -------: | -----: |
| the pairs the run rejected                |   263 |       49 | 18.6 % |
| crossed: golden from another pull request |   263 |        1 |  0.4 % |
| same file, same pull request, other line  |   219 |       35 | 16.0 % |
| same pull request, another file           |   222 |       12 |  5.4 % |

**The crossed control accepts 0.4 %, which says the reader is reading the code rather than the vocabulary.** And the
floor is the other number: a reader shown a comment on one line and a golden from **another line of the same file** accepts
16.0 % of them. So **18.6 % against a 16.0 % floor is 6.97 pairs of evidence** - seven goldens, out of 263, that a perfect
matcher could recover.

**That is the end of the matcher hypothesis for this corpus.** The 449 rejections are, by this reading, mostly what they
look like: a comment on the right file about a different defect. **The finder is the bottleneck**, and no matcher, judge
prompt or threshold in this repository recovers more than seven goldens from it.

**And it replicated on a second artifact, which is the only reason it is written as a finding rather than as a reading.**
The same job over R-32's control arm (`43972526272`, artifact of `43854378420`) read 273 pairs:

| reading                                   | pairs | accepted |  share |
| ----------------------------------------- | ----: | -------: | -----: |
| the pairs the run rejected                |   273 |       64 | 23.4 % |
| crossed: golden from another pull request |   273 |        0 |  0.0 % |
| same file, same pull request, other line  |   230 |       48 | 20.9 % |
| same pull request, another file           |   225 |       15 |  6.7 % |

**Two artifacts, two slices, 6.97 and 7.03 pairs.** The lift is 2.6 % in both, the floor comes from the same control in
both, and the whole difference between them is inside what one pair is worth. That is what a device that does not exist
looks like when it is measured twice.

**And both of those readings came from one judge, which §71 put to the test: the same floor read by the same model twice
moves it by 2.2 pairs, and read by a reasoning model it falls to 6.4 % and the recovery to zero.** The conclusion of this
subsection - _the matcher is not the bottleneck_ - survives both readings; **the number "seven" does not, and §71 states
the range instead.**

### 69.5 What is left, and the number it has to beat

Three devices are closed and each was closed by its own artifact: the window (negative at 22 of 23 cuts, §51), the claim
check (§45), the reader (§63, unstable across slices), and now the second concern (+0.0089 on 146 rows against a bar it
could not reach). **What every one of them changed was the cut, the matcher or the second pass. Not one of them changed
what a lane is asked to say.**

So the next device is a finder device, and it is registered here against the corpus that will judge it:

> **R-35: a lane asked a different question about the same diff raises the file arm F1 by at least 0.026 on the 146 pull
> requests R-32 and R-33 read, without lowering precision by more than a golden is worth.**

- **0.026 rather than 0.021**, because 0.0255 is what 146 rows can sign (§69.2). A bar under its own resolution is a
  sentence that cannot be true.
- **`recall-rises`**, because §69.4 says the losses are defects never claimed rather than claims that were refused, and a
  device registered under `recall-holds` would be answered by a rule that cannot see its own mechanism.
- **The falsifier is §69.4's number**: a companion reading of the same run's rejected pairs must show the floor moving. If
  the seven recoverable pairs stay at seven, the device did not find new defects, it found new sentences about old ones.

### 69.6 What would make this section wrong

1. **Reading the merged corpus as if it were 200 rows.** It is 146, the sd is 0.0130, and any projection from 0.0106 is
   arithmetic about a corpus this project does not have. The table in 69.2 exists so that the next projection starts from
   rows.
2. **Quoting the McNemar p-value as a confirmation.** +105/−75, p = 0.0304 is a real reading of the goldens and it is not
   the reading the registration named. §69.1 puts them side by side rather than choosing.
3. **Treating 6.97 pairs as zero.** The lift is small and it is not nothing: it is the size of the prize a matcher could
   win, and the reason the next registration pays for a finder instead.

## 70. The finder, built to the registration rather than the registration fitted to it

### 70.1 What the corpus said the missing thing was

§69.5 registered a finder device and named one sentence for it. This section is that device, and it exists because three
readings of the artifacts pointed at the same place before a line of it was written.

**The first is the lane table**, over the 537 ranked rows of R-33's control arm, the only slice whose rows carry `lane`:

| lane            | emitted | goldens credited | precision | F1 with this lane removed |
| --------------- | ------: | ---------------: | --------: | ------------------------: |
| architecture    |     313 |               77 |     0.246 |      0.1625 (**−0.1190**) |
| testing         |      90 |               10 | **0.111** |      **0.2883 (+0.0069)** |
| maintainability |      62 |               15 |     0.242 |          0.2658 (−0.0156) |
| security        |      53 |               16 |     0.302 |          0.2604 (−0.0210) |
| performance     |      19 |                4 |     0.211 |          0.2783 (−0.0031) |

**The slice is 0.2814 with all five and 0.2883 without the testing lane.** One of the five costs more than it earns, and it
is the one whose question the corpus barely asks: 91 of the 1 054 goldens are test-shaped, 8.6 %.

**The second is the shape of the sentence**, over the 2 438 ranked rows of three artifacts:

| what the comment does                |  rows | goldens credited | precision |
| ------------------------------------ | ----: | ---------------: | --------: |
| names what breaks, under which value |   458 |              157 | **0.343** |
| describes the change                 | 1 400 |              256 | **0.183** |
| neither                              |   580 |              127 |     0.219 |

**The third is what the goldens themselves name.** 426 of the 1 054 name a boundary condition - an unchecked return, an
empty collection, a zero divisor, an index at the end - and **our findings that name one run at 0.257 against 0.196 for
those that do not**.

Put beside §69.4's 6.97 recoverable pairs, the three readings say one thing: **we comment on the right file and describe
the change rather than the defect, and no cut, matcher or second pass can repair a sentence that was never written.**

### 70.2 The device, and why it is a substitution

`behaviour` is one lane, and it is the only lane asked a question with a value in it: _which value, state or sequence
that can actually reach this line makes it produce something other than what the surrounding code expects_ - then _what
the line produces instead_.

**It replaces `testing` and adds nothing.** A sixth call per file would make the pair a comparison of the question and
of the budget at once, and `variedField` would have no way to refuse it: the artifacts differ in one key either way, and
the confound would be inside the arm rather than between the arms.

| what the lane is told                          | why that sentence and not another                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| name the value first, in the code's vocabulary | _"requiring a triggering input filters out speculative comments, because a model that cannot name the input usually does not have a real finding"_ |
| most changed lines are correct                 | the clean-control study: 93.8 % of clean items accused without this sentence, 0 % with it, at unchanged detection                                  |
| do not report an improvement here              | the four other lanes' questions are their business; a remark of that kind costs a comment a defect needed                                          |
| no category list                               | a hunt in a category the corpus does not label is a miss with extra steps                                                                          |

**And it does not say "find bugs".** The directive framing is measured to roughly triple the false-positive rate against
the trace framing, so the lane traces a value rather than hunting a category - a distinction that costs nothing to write
and is the difference between a finder and a flood.

### 70.3 The wiring, which is the part that fails quietly

Five connections, each of which has failed before in this repository: the environment variable, the engine option, the
artifact key, the matrix row, and the artifact name the comparison job downloads. `laneSet` in the artifact is
**`{name, lanes}` rather than the name alone**, because a comparison that reads only the name cannot see the reviewer and
one that reads only the list cannot find the sentence.

| the artifact will say         | the value                                                                 |
| ----------------------------- | ------------------------------------------------------------------------- |
| `configuration.laneSet.name`  | `shipped` or `behaviour`                                                  |
| `configuration.laneSet.lanes` | `["security","architecture","performance","maintainability","behaviour"]` |
| `rankedFindings[].lane`       | `behaviour`, on every row the lane produced                               |

**And the refusals are asserted without a model.** `--dry-run` renders both lane sets and fails if the build carries no
prompt for a named lane, if the `behaviour` prompt asks for a category instead of a value, if it is not shown the same
diff, or if the substitution is not exactly one lane. **`AACR_LANE_SET=behaviuor` throws before the corpus is cloned**,
because a typo that falls through to a default is a run that pays for one reviewer and publishes another's name.

### 70.4 The registration, restated

> **R-35: a lane asked for the value that breaks a changed line, in place of the testing lane, raises the file arm F1 by
> at least 0.026 on the 146 pull requests R-32 and R-33 read, and raises recall.**

- **0.026 and not 0.021**, because 146 rows can sign 0.0255 (§69.2) and a bar under its own resolution cannot be true
  whatever the device does.
- **`recall-rises`**, because the losses are defects never claimed rather than claims that were refused.
- **The falsifier is not an F1 movement**: the same run's rejected pairs must show the 16 % same-file floor moving. If the
  seven recoverable pairs stay at seven, the device found new sentences about old defects, and **no score turns that into
  a confirmation**.

### 70.5 What would make this section wrong

1. **Reading a confirmation off one slice.** §63 wrote the rule and §69.1 paid for it: the second concern gained 0.0296 on
   `skip 50` and lost 0.0344 on `skip 150`. **The pair this registration names is one dispatch over rows 50-195** -
   `skip 50, max 146` - which is the union of the two slices, bought once rather than twice so that the corpus does not
   carry a cross-dispatch difference as well as the device's (§20.4: two dispatches of _one_ configuration have reported
   0.1691 and 0.2405). **The bar is unchanged at 0.026**, because the row count is unchanged at 146, and it is rows that
   decide what can be signed.
2. **Treating the substitution as free.** It is five calls either way, and the `testing` lane's own contribution is priced
   in the arm: if `behaviour` earns less than the lane it replaced, the delta says so rather than hiding it in a budget
   that did not move.
3. **Calling a higher F1 a better reviewer without the floor.** The floor is the control that shows a reader a comment on
   one line and a golden from another line of the same file. A device that raises the score and leaves the floor where it
   was has raised the score.

### 70.6 The guard that refused this slice was measuring the era it was written in

**`skip 50, max 146` was refused by the confirmation rule before it was dispatched, and the refusal is the finding.**
The rule said a confirmation may spend half the job ceiling: **106 rows of 340 minutes**. That fraction was chosen when
the rate was believed to be 3.29 minutes per pull request, a figure belonging to the fourteen-pull-request run of §15.6,
and under that rate a hundred rows really did cost 329 of 340 - **so 0.5 was not a law, it was the arithmetic that let
R-17 register a hundred.** The rate has since been measured twice: 1.594 minutes per pull request at the slower arm of
the fifty-pull-request run, and 1.235 / 1.402 at the two arms of `43902714209`. **At 1.594 the half rule admits 106 rows
and refuses 146** - and 146 is the number of rows that can sign 0.026, which is the bar R-35 has to meet to be worth
dispatching. A guard that refuses every registration large enough to be resolvable is not protecting the corpus, it is
preserving a number from a configuration that no longer runs.

**So the guard now asks the property instead of the proxy: does the job finish on an ordinary slow day?** The width of
an ordinary slow day is measured rather than assumed - one run dispatched the same 46 pull requests twice and its arms
took **56.8 and 64.5 minutes, 1.135×** - and `MEASURED_MINUTES_PER_PULL_REQUEST` is already the slower of the two arms
(79.7 of 61.0 and 79.7) of the run it came from. `CONFIRMATION_OVERRUN_TOLERANCE = 1.15` therefore means a confirmation
survives a runner as much slower than the measured arm as one arm was than the other.

| slice                     |    rows |   minutes | with tolerance | verdict                     |
| ------------------------- | ------: | --------: | -------------: | --------------------------- |
| R-17's confirmation       |     100 |     159.4 |          183.3 | admitted                    |
| **R-35's confirmation**   | **146** | **232.7** |      **267.6** | **admitted**                |
| the largest admitted      |     185 |     294.9 |          339.1 | the edge                    |
| one row past the edge     |     186 |     296.5 |          341.0 | refused                     |
| the whole corpus, one run |     196 |     312.4 |          359.3 | refused, which is the point |

**The edge is tested rather than described** (`slicesAConfirmationCanFit(340) === 185`, and 186 asserted not to fit),
because a guard whose boundary is prose is a comment. **Nothing else moved to accommodate the slice**: the rate constant
is the same 79.7 / 50, the bar is the same 0.026, the registration was written before the run was dispatched, and the
dispatched run is `43987896252` at `lane_set=pair, skip 50, max 146` - **one artifact per arm, so the corpus cannot carry
a cross-dispatch difference as well as the device's.**

**What would make this subsection wrong.** If a future dispatch measures an arm more than 15 % slower than the arm its
own run reported, then the tolerance is too small and a slice it admitted was a timeout that had not happened yet - the
remedy is a larger tolerance with a smaller cap, not a smaller tolerance with an unregistered bar. And if R-35's verdict
turns out to be `falsified`, this section is not thereby wrong: **a guard can be correctly repaired around a device that
does not work, and the repair is judged on the run that finishes, not on the delta it returns.**

## 71. The floor is a threshold, not a constant

### 71.1 The question, and why it had to be asked before R-35 is read

§69.4 measured the matcher hypothesis and closed it: of 449 goldens rejected in files we had commented on, **18.6 % were
accepted when the pair was read again against a 16.0 % same-file floor, which is 6.97 pairs a perfect matcher could
recover.** R-35's falsifier is that same floor: **if the seven recoverable pairs stay at seven, the new lane found new
sentences about old defects.** So the floor is not a detail of §69 - it is the instrument R-35 is judged with, and it had
only ever been read by one judge: `deepseek-chat`, the same model that wrote the comments being judged. **A judge that is
the author is the one case the literature says to distrust** (§70.6's note; `Zheng et al. 2023` on self-preference, and
the correlated-panel result that count agreement across related models as one opinion).

Pre-registered before the second reading was dispatched: **the same-file floor stays inside 16.0 ± 0.05 under a second
judge, and the paired verdicts do not separate at p ≤ 0.05.** Both halves, because a large sample makes two pairs
significant and a small one cannot make ten insignificant. The bar is 0.05 and not 0.01 because 0.160 over 219 pairs
carries a sampling error of 0.025 - **a bar narrower than the reading it tests fails for arithmetic rather than for the
judge.**

### 71.2 Three readings of one artifact

All three read the same 263 rejected same-line pairs of run `43839753881`'s control artifact, with the same prompts and
the same controls. **Only the reader changed.**

| reading              | judge               | run           | real pairs accepted | crossed | same-file floor | same-pull | beyond floor |
| -------------------- | ------------------- | ------------- | ------------------: | ------: | --------------: | --------: | -----------: |
| §69.4, as published  | `deepseek-chat`     | `43869953158` |     49/263 = 18.6 % |   0.4 % | 35/219 = 16.0 % |     5.4 % |     **6.97** |
| the same judge again | `deepseek-chat`     | `44001096752` |     50/263 = 19.0 % |   0.4 % | 34/219 = 15.5 % |     6.8 % |     **9.17** |
| the second judge     | `deepseek-reasoner` | `44000908077` |      12/257 = 4.7 % |   0.0 % |  14/218 = 6.4 % |     0.9 % |        **0** |

**The repeat of the first judge is the instrument's noise floor, and it is small where it is measured and large where it
is quoted.** Paired, the two `deepseek-chat` readings disagree on 2 and 3 pairs (real), 3 and 2 (same file), 1 and 4
(same pull request) and 1 and 1 (crossed) - every one of them inside the bar with p ≥ 0.375. **But the headline number is
a difference of two proportions**, so it carries the error of both: 6.97 against 9.17 is a swing of **2.2 pairs on a
number of seven**, from one judge reading one artifact twice. The shares are reproducible; **the number quoted from them
is reproducible to about ±2 pairs and was quoted to two decimals.**

### 71.3 The second judge moved the floor, and moved it by being stricter

Paired, the strict reading against the lenient one, on the pairs both answered:

| field                           | pairs | both accepted | lenient only | strict only |        Δ | McNemar exact p |
| ------------------------------- | ----: | ------------: | -----------: | ----------: | -------: | --------------: |
| the rejected pairs              |   257 |            12 |       **37** |       **0** | −14.4 pp |        < 0.0001 |
| same file, another line         |   218 |            14 |           19 |           0 |  −8.7 pp |        < 0.0001 |
| same pull request, another file |   219 |             2 |           13 |           0 |  −5.9 pp |          0.0002 |
| crossed                         |   258 |             0 |            1 |           0 |  −0.4 pp |          1.0000 |

**The pre-registered bar fails on both halves for the floor: −8.7 points and p < 0.0001. The floor is a property of the
reader.** That is the verdict, and it is recorded as one - the experiment was designed to be able to fail and it did.

**But look at the third and fourth columns: the strict judge accepted nothing the lenient judge did not accept.** Zero in
all four fields. That is not two readers with different notions of "the same defect" - **it is one ordering read at two
thresholds**, and it changes what the movement means:

1. **§69.4's conclusion survives the drift.** No reading in the table recovers more than a handful of pairs, and the
   strict one recovers none: on its reading, our comments on those lines are accepted **less** often than a golden from a
   different line of the same file (4.7 % against 6.4 %, lift **−1.8 points**). **The matcher is not the bottleneck under
   either threshold**, which is the finding; "seven" was the lenient threshold's estimate of a quantity that is at most
   a handful.
2. **§69.4's number does not survive.** "6.97 pairs" is a figure about `deepseek-chat`'s generosity, not about the corpus.
   The honest statement is **0 to 9 pairs depending on the reader, with the corpus's own answer bounded by both**, and a
   reader quoting "seven" is quoting the middle of a range they did not measure.
3. **The leniency is not noise.** On the band the strict judge rejects and the lenient one accepts - 37 real pairs and 19
   same-file pairs among 257 and 218 - the real acceptance is **14.4 % against an 8.7 % floor, +5.7 points**, which is
   _larger_ than the lenient judge's overall lift of +3.5. **An exploratory reading, not a registered one**: it says the
   marginal acceptances are more informative than the average ones, which is what a threshold sitting just under a real
   signal looks like, and it is the shape a calibrated matcher would have. It is written down here as the next thing to
   test, not as a device.

### 71.4 Three constants were dimensioned on the fast reader, and a pipe ate the guard

The experiment cost four dispatches and found more in the plumbing than in the numbers. **Every one of these is the same
error - a constant measured on `deepseek-chat` and reused on a reader that is not it - and every one was found by
something failing rather than by reading the code:**

| constant                    | measured on                   | failed as                                                       | now                                               |
| --------------------------- | ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `timeout-minutes: 20`       | 967 pairs in ~2 min           | the first second-judge dispatch was **cancelled**, no report    | 60 minutes, and concurrency is an input           |
| `max_tokens: 160`           | six lines of chat prose       | `truncated × 66`: `finish_reason: length`, empty answer         | escalates ×8 to 4 000 on a truncated call         |
| the report's headline rates | 0 unanswered                  | 34 of 263 answered, and four rates printed over the 13 %        | `readingIsUsable`, > 20 % unanswered is a refusal |
| `node … \| tee`             | an exit code nobody discarded | the refusal above was a **green tick** with a sentence under it | `set -o pipefail`, asserted by test               |

**A refusal that a pipe turns green is worse than no refusal**, because the sentence under it is the only thing that says
the reading is void and nobody reads a green step. The instrument now writes its report, names the failure tally, and
**exits non-zero** - the report is not suppressed, because a failed reading is the only thing that says why the next
dispatch should differ.

### 71.5 What would make this section wrong

1. **Reading the drift as a verdict about the corpus.** It is a verdict about the reader. Two judges, both DeepSeek, both
   prompted identically: **cross-family judging is still untested**, because this repository has no second provider
   credential (§71.4's table is the reason to get one, not a substitute for it). Everything here is one family at two
   thresholds.
2. **Treating `beyond floor = 0` as "no matcher can help".** It says a reader stricter than the corpus's own goldens finds
   nothing preferentially recoverable in the rejections it looks at. A _calibrated_ reader - one sitting where the band
   analysis in 71.3 puts it - is untested.
3. **Quoting "seven" again.** Any sentence that says seven recoverable pairs without the range 0-9 is quoting one
   threshold as if it were the corpus.

### 71.6 What this changes about R-35's falsifier, decided before the run landed

§70.4 wrote R-35's falsifier as _"the same run's rejected pairs must show the 16 % same-file floor moving. If the seven
recoverable pairs stay at seven, the device found new sentences about old defects."_ **§71.2 makes that falsifier
unreadable as written**, because it names a movement without a size and the instrument's own repeat disagreement is one
pair in 219 pairs of the same arm - **a floor that moves by one pair has moved by noise, and R-35 would then be confirmed
or falsified by which way a coin landed.** The amendment, recorded here while the run is still executing
(`43987896252`, dispatched before this section existed):

> **The device is confirmed on the floor only if the same-file floor moves by more than three pairs between the two arms,
> read by the same judge on the same artifact pair.** Three is not a taste: the largest net disagreement between two
> readings of _one_ arm in §71.2 is one pair, so three is the smallest movement that is three times the measured noise
> floor - and it is stated as "more than three" rather than "at least three" because a movement of exactly three is still
> inside a doubling of the noise.

**And the F1 half of R-35 is unchanged**: at least 0.026 on the file arm, which is the bar 146 rows can sign (§69.2).
**The two halves are read independently** - a device may raise the score and not the floor, or the floor and not the score,
and §70.5's third item already says a score that rises while the floor stays put has not earned a verdict. **What is new
is only this: the floor reading is no longer allowed to be a sign, it has to be a size.**

## 72. R-35 falsified: the question was better and the breadth was a quarter

### 72.1 The run, and the two halves of the falsifier

`43987896252` dispatched `lane_set=pair` over `skip 50, max 146` - the same 146 pull requests R-32 and R-33 read - in
one artifact per arm, and both arms finished (183 and 191 minutes). **The comparison job then failed at
`Download the run with the claim check`**, downloading `…-off-on-off-off-off-off-off-shipped` from a matrix that produces
`…-shipped` and `…-behaviour`: the fallback step's guard listed every device input except `lane_set` (§72.7). The two
artifacts were read locally instead, and the verdict is the one the registration can be judged on - the
comparison is committed as `benchmarks/aacr-ablation-paired.json`, which is what the compare job would have written:

| arm                                           | precision | recall |         F1 |  TP |  FP |  FN | findings |
| --------------------------------------------- | --------: | -----: | ---------: | --: | --: | --: | -------: |
| shipped (five lanes, `testing` in place)      |    0.2146 | 0.2011 | **0.2076** | 212 | 776 | 842 |     1643 |
| behaviour (`behaviour` in place of `testing`) |    0.2032 | 0.1917 | **0.1973** | 202 | 792 | 852 |     1479 |

**Δ F1 −0.0103 (precision −0.0114, recall −0.0094), bootstrap over pull requests mean −0.0104, 95 % [−0.0317, +0.0116],
p 0.354.** The registered gain was +0.026. **Falsified, on the arm the registration named, by more than the registration
was worth.** The paired row test agrees: 70 rows the behaviour arm has and 80 it does not, p 0.4625.

### 72.2 The mechanism the falsification reveals, which the registration did not name

**Read per lane, the behaviour arm's own lane is the second-most precise thing we emit.** At the operating point, kept
rows and the share of them that match a golden:

| lane            | shipped: rows / precision | behaviour: rows / precision |
| --------------- | ------------------------: | --------------------------: |
| security        |           166 / **0.271** |                 136 / 0.316 |
| **behaviour**   |                         - |              **66 / 0.258** |
| architecture    |               714 / 0.244 |                 806 / 0.208 |
| maintainability |               152 / 0.211 |                 173 / 0.185 |
| performance     |                30 / 0.233 |                  28 / 0.286 |
| **testing**     |           **222 / 0.158** |                           - |

**The behaviour lane's rows are 0.258 where the testing lane's were 0.158 - the question is better - and it emits 75 rows
where `testing` emitted 289.** It matched 24 goldens against testing's 59. So the device asked a better question at a
quarter of the breadth, and the corpus pays for breadth: 7.2 goldens per pull request, and the arm that says more things
finds more of them. **R-35 priced a substitution, and the substitution is a recall trade the corpus cannot afford** -
which is exactly what §69.3's lane economics said about removing `testing` alone (+0.0069) being larger than the median
device in this repository.

### 72.3 Where the 642 rejected goldens actually are, and what is sitting on top of them

Of the 1 054 goldens in the slice, 310 are covered, **642 have a finding of ours on their path that the judge says does
not address them**, 66 are in a file the pull request did not change, and 36 are in a reviewed file we said nothing about.
Of the 642, **398 are on a line we commented on** (proximity 0), 115 within ten lines, 129 beyond fifty.

**And 351 of those 398 - 88 % - have a second finding of ours at the same range that the deduplicator threw away**, always
of a different category:

| golden                                                      | swallowed sibling                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `ValueOrDefault` can be surprising for some `T` …           | `ValueOrDefault` copies `default_value` even when key present |
| the import statement has been updated but the example …     | import changed to `patchright` but the surrounding example …  |
| `self.config.chrome_remote_debugging_port` is typed `int` … | builtin browser always adds `--remote-debugging-port` …       |

The counter says the same thing at scale: **5 032 findings before dedup, 1 643 after, and 3 362 of the 3 389 dropped rows
are `rangeOnly` merges.** So the finder is not silent at the line the golden sits on; **it is verbose and the selector
keeps one sentence per range.** R-32 already tested keeping _one_ cross-category sibling at a reported range: **+0.0089
with sd 0.0130.** Keeping one is not the same as keeping the one that addresses the golden, and the pool is where the
choice is made.

### 72.4 A negative result that closes an obvious lever before anybody builds it

If 21 % of what we file is acceptable and the ordering decides which 16 rows a pull request ships, better ordering looks
like the cheapest device in the repository. **It is not.** Fitting a ranker on the artifact's own eight features
(`grounded`, `quotesDiff`, `namesSymbol`, `proposesChange`, `hedged`, `agreement`, `severity`, `lane`) plus category,
span and length, cross-validated by pull request over five folds:

| ranker                         |   p@1 |       p@3 |       p@5 |   p@8 |      p@16 |
| ------------------------------ | ----: | --------: | --------: | ----: | --------: |
| the shipped score              | 0.273 |     0.270 |     0.269 | 0.254 |     0.228 |
| logistic regression            | 0.280 | **0.292** | **0.282** | 0.254 |     0.234 |
| gradient boosting              | 0.259 |     0.290 |     0.272 | 0.254 |     0.225 |
| **perfect ordering (ceiling)** | 1.000 |     0.864 |     0.566 | 0.400 | **0.267** |

**The best held-out gain is +0.013 at `p@5` and +0.006 at `p@16`, and the ceiling at sixteen rows is 0.267** - because
there are 343 acceptable rows in 1 643 however they are ordered. **The ordering is not the constraint; the pool is.** That
is worth writing down because the temptation to fit a ranker is enormous and it would have consumed a dispatch and a
registration to buy a tenth of the resolution the corpus can sign.

### 72.5 Where this leaves us against the published state of the art, on our own corpus

**`AACR-Bench` is no longer ours alone.** `OpenCodeReview` (Alibaba, arXiv 2608.09290) evaluates on _"200 real-world PRs,
10 languages, 1 505 expert-verified comments"_ - the corpus this repository has been measuring on - and reports
**SEM-F1 25.10 %** against **11.57 %** for the same model under Claude Code, calling that _"up to 2.17× higher"_. Our
sibling arm on 146 pull requests of the same corpus reads **F1 20.76 %**. **We are at 83 % of the published figure and
1.8× the Claude Code baseline**, with the caveat §71 makes unavoidable: their semantic F1 and ours are two instruments,
and the comparison is only as good as the agreement between them.

Their paper names the three devices that buy the gap, and **we have implemented one of them**: _rule-guided dispatch_,
_grounded file review with on-demand cross-file retrieval_, and _independent reflection_ - a falsification-first filter
whose reflector **sees only the diff and not the reviewer's exploration**, which they say removes hallucinated comments
_"without the self-reinforcing bias of intrinsic self-critique, improving precision while preserving recall"_. The
independent acceptance study they cite (`arXiv 2607.03316`, 31 073 AI review - developer reply pairs) reports 36.4 %
accepted and 56.3 % rejected, of which **43.3 % are flat false positives**, and their most deployable finding is a
**small model fine-tuned on historical feedback as a pre-filter: F1 76 % against 64 % for a 70B prompted directly.**

**Our pool's acceptance is 20.9 %** - below every field measurement above - and our precision is where the gap to SOTA
lives, not our recall. That reframes the next device: it is not another question for a lane, it is a stage that decides
**whether a sentence survives to be filed**, which is the one device class we have tested only in its most destructive
form. `adjudicate` (§44-§45) raised precision to 45.5 % and 32.4 % and collapsed recall to 6.6 % and 5.3 %, taking F1
from 19.5 % to 11.6 % and from 20.6 % to 9.1 %. **A gate that drops most of what it sees is not a filter, it is a
different reviewer** - and the difference between it and a reflector that preserves recall is the falsification
contract: drop only what it can name a falsifier for, keep everything else.

### 72.6 What would make this section wrong

1. **Reading the −0.0103 as "the behaviour question is bad".** Its own rows are the second-most precise in the set
   (0.258) and its goldens-per-row is 0.32 against `testing`'s 0.20. What failed is the _substitution_, at this breadth,
   on this corpus.
2. **Reading §72.3 as "keep more siblings".** R-32 kept one and bought +0.0089. The 351 pairs say the sibling is often
   on topic; they do not say the sibling is the one a judge would accept, and until that is measured the count is a
   ceiling on a device rather than an estimate of one.
3. **Reading §72.4 as "ranking cannot help".** It says _these eight features_ cannot order _this pool_. A ranker over
   the diff and the sentence - which is a small model, per §72.5 - is a different object and is untested here.

### 72.7 The comparison job's guard was one device behind, and the cost was a whole run's verdict

`43839753881`, `43902714209` and `43987896252` all ended `failure` at a download step after both arms were paid for, and
each time the cause was a name that had moved and a guard that had not. **This time the guard was the fallback step's**:
it excluded every pair input except `lane_set`, so a `lane_set: pair` dispatch fetched the claim-check arm, which that
matrix never produces. The fix is one clause, and it is not the interesting part - **the interesting part is that the
guard had been extended by hand seven times and read by nobody.**

So the guard is now _evaluated_ rather than read: `fires, on every pair dispatch, only the downloads that dispatch
uploaded` parses each `if:` in the comparison job, evaluates it against nine dispatch shapes, and requires that the steps
which fire download exactly the two names that dispatch's matrix produces. **`pair: on` is one of the nine**, because it
is the shape whose arm the fallback step legitimately fetches, and a test that had excluded it would have "fixed" the
workflow by breaking the retired ablation reference instead.

### 72.8 The floor half of the falsifier, read on both arms

§71.6 registered the second half as a _size_: the same-file floor has to move by more than three pairs between the two
arms, read by the same judge on the same artifact pair. Both arms' rejected same-line pairs were re-read by
`deepseek-chat` - `44016266435` and `44017052544`, no failed calls, no unanswered pairs:

| arm       | rejected pairs | accepted | crossed |     same-file floor | same pull, other file |
| --------- | -------------: | -------: | ------: | ------------------: | --------------------: |
| shipped   |            398 |   19.4 % |   0.5 % | **77/342 = 22.5 %** |                 5.8 % |
| behaviour |            387 |   21.4 % |   0.8 % | **68/333 = 20.4 %** |                 4.8 % |

Paired on the 277 goldens both arms rejected, the movement is **−4.0 points, 29 pairs one way and 18 the other, McNemar
p 0.144** - eleven pairs net, which is more than the three §71.6 required, so **the floor half is not confirmed either**,
and its direction is the opposite of what a device that found _nearer_ misses would produce. **The behaviour arm's
rejections are less recoverable than the shipped arm's**, which is what §72.3 predicts: the shipped arm's misses had a
swallowed sibling sitting on the golden's line, and the behaviour arm says fewer things, so there is less on the line to
recover. A narrower reviewer is not a more accurate one; it is a reviewer whose mistakes are further from the answer.

**And the number that used to be quoted as "the floor" is not one number.** §69.4 read 16.0 % on run `43839753881`'s
control, §71's repeat read 15.5 %, and the same judge on two arms of _this_ run reads 22.5 % and 20.4 %. **Four readings
of the same-file floor on the same corpus, from 15.5 % to 22.5 %** - so a floor quoted without the run it came from is a
number whose error bar nobody has measured, and §71's rule (quote the range, not the point) now applies to §69.4 as well.

## §73 R-36 — the gate that keeps by default, registered before its run

### 73.1 What was built, and why the destructive form was not a verdict about this one

§72.5 located us against the field for the first time: OpenCodeReview reports **SEM-F1 25.10 %** on AACR-Bench where
Claude Code reports 11.57 %, and our file arm reads **20.76 %** - 83 % of that figure and 1.8× Claude Code, with the gap
in precision rather than recall. Their paper names three devices and **we had implemented one of them**. The second and
third are rule-guided dispatch and _independent reflection_: a falsification-first filter whose reflector _sees only the
diff and not the reviewer's exploration_, which they say removes hallucinated comments _"without the self-reinforcing bias
of intrinsic self-critique"_.

**We had tested that class exactly once, in its most destructive form.** §44-§45's adjudicator asks one model call per
finding and applies "refuted" on the answer's word: precision **45.5 %** and **32.4 %**, recall **6.6 %** and **5.3 %**,
F1 from 19.5 % to **11.6 %** and from 20.6 % to **9.1 %**. That is not evidence about reflection. It is evidence about a
gate with no evidentiary requirement, and **a device that removes nine of every ten sentences is a quieter reviewer
rather than a filter.**

So the second device is `review/adjudication/falsifier.ts`, and the difference is the contract rather than the prompt.

### 73.2 The contract, in four rules

1. **Once per file, not once per finding.** The per-finding form would have spent **1 643** calls on the 146-pull-request
   slice - one per surviving finding. The per-file form spends one call per file that holds at least one claim, and the
   artifact counts them (`falsifier.calls`). **The arithmetic of the price is why the device is affordable, not why it
   was chosen**: a gate whose cost forces it to be lenient is a gate that was never measured.
2. **Keep is the default and silence is a keep.** The question is _which of these claims does a line this diff added
   directly contradict?_, so a reader with nothing to say removes nothing. `{}` is a legitimate answer.
3. **A removal must quote an added line, and the quote is checked.** The quote has to be at least ten characters
   (`FALSIFIER_MIN_QUOTE`) and has to be found - whitespace-collapsed - in one of the lines the diff added **and the
   prompt showed**. A refutation whose quote fails either test is **not applied**, and is counted in
   `keptBecauseQuoteMissing`. **This is the whole difference from §45**: there, an unverifiable refutation deleted a
   comment; here it changes nothing and raises a number.
4. **It may not edit.** No rewrite, no re-anchor, no severity change. The survivors are returned as the objects they
   arrived as, and the engine re-attaches them by identity - so a gate that edits cannot hide behind a coordinate
   comparison, because it would have to produce different objects to do it.

What the reader is shown is **the added lines with their new-side numbers and the claims with their numbers**, and
nothing else: not the lane, not the severity, not the description's argument. A reader told which lane wrote a claim
anchors on that lane's concerns; a reader shown a severity anchors on the severity. **A claim is a title at a line** -
the same reason §69's lane swap was a different question rather than a better one.

### 73.3 The price, and what buys it

`F1 = 2TP/(C+G)`, so **a removed comment raises F1 exactly when it was a false positive** and costs exactly its share of
the denominator when it was not. The merged pool on these rows is **1 643 ranked rows of which 343 are acceptable**
(§72.4), so **1 300 of them are worth removing and 343 are not**, and a gate that removes on a coin flip still looks like
it is working. That is why the counters in §73.5 matter more than the F1: they are what separates a gate that found the
1 300 from one that found the 343.

It is also why the device is registered under `recall-holds` and not under a precision claim: **a filter that buys
precision by deleting true positives is the failure mode this class is most exposed to**, and the field's own acceptance
study prices it - 56.3 % of AI comments rejected, 43.3 % of those flat false positives, and the deployable device is a
_pre-filter_.

### 73.4 The registration

**Claim.** A gate asked once per file that removes a claim only when a line the diff added is quoted against it raises
the **file arm F1 by at least 0.026** on the 146 pull requests R-32, R-33 and R-35 read, and does not lower recall by
more than a golden is worth.

| field              | value                                | why that value                                                                                                                                                  |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registeredGain`   | **0.026**                            | >1.7× the corpus's resolution at these rows (**0.0157** at 1 054 goldens, `resolutionFor`), so the bar can be cleared and cannot be cleared by rounding         |
| `mechanismRule`    | `recall-holds`                       | the entire distance between this device and §45's is the claim that precision can be bought without paying recall                                               |
| `arm`              | `file`                               | one call per file per lane, at most three findings per file - the arm every figure of §8 and §19 was measured on, and the arm a _narrowing_ device is judged on |
| `confirmation`     | `skip 50, max 146`                   | 232.7 minutes at 1.594 min/PR, 267.6 with the 1.15 tolerance, against a 340-minute ceiling                                                                      |
| falsifier (F1)     | **< 0.2336**                         | the lanes' 0.2076 plus the registered 0.026; a figure below it is a falsification rather than a shortfall                                                       |
| falsifier (recall) | **below the lanes' less one golden** | a gate that buys precision by deleting true positives is the failure this device is most exposed to                                                             |

**The registration is filed under `falsifier`, not under `adjudicate:falsifier`, and that is a fact about the artifact.**
The gate is dispatched as a third value of the existing input, but the artifact records what ran as its own configuration
key beside `adjudicate: false` - so the field that differs between the two arms is `falsifier`, and a sentence filed under
the input's name would be a sentence **no artifact can reach**. The name of the switch a dispatch flips and the name of
the field that proves it was flipped are two different facts, and the comparison reads the second. Its `--self-test`
branch is the proof: the fixture that varies `falsifier` is answered by §73's sentence and by nothing else.

**And the confirmation debt is named rather than hidden.** The anatomy the device was designed from (§72.3) was read on
these 146 rows, so **this dispatch is a discovery**. The corpus holds 200 pull requests and rows 196-199 are the only
ones no run has read - four rows, which cannot carry a 0.026 bar. **A confirmation therefore needs a corpus that grows or
a slice that is bought twice**, and a registration that called this run a confirmation would be claiming a number its
own slice cannot resolve.

### 73.5 The counters that decide whether the device is working

The artifact carries `falsifier: { enabled, contract, candidates, dropped, keptBecauseQuoteMissing, unreadable,
notAsked, notAPatch, calls, droppedFindings }`. Four of them are the instrument:

| counter                   | what it separates                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidates`              | the pool the gate was shown, so a figure is attached to a breadth                                                                                               |
| `dropped`                 | what it removed **with a verified quote**                                                                                                                       |
| `keptBecauseQuoteMissing` | a reader that refutes and cannot quote - **a gate that never drops and a gate that refutes everything print the same F1, and only this field tells them apart** |
| `notAPatch`               | files whose text carried no quotable line, because **a file the gate could not read is not a file it cleared**                                                  |

And `droppedFindings` carries the quote with the removal, sampled across the corpus rather than taken from the front.
**The quote is the only field that lets a reader check the check** - the counter says how many, the row says on what.

### 73.6 What would make this section wrong

1. **Reading a confirmed F1 as "reflection works".** It would confirm _this contract_ at _this breadth_ on _these rows_.
   The 343-acceptable ceiling says the device cannot take the pool past what a perfect filter of it would reach.
2. **Reading `keptBecauseQuoteMissing` as a reader defect.** A quote can fail verification because the reader copied a
   line from outside the prompt's character budget, which is an instrument defect in the other direction - and the count
   is reported with the budget beside it so that the two can be told apart.
3. **Reading a falsified F1 as "filters do not work".** §45 already showed a filter can move precision to 45.5 %. What a
   falsification here would say is narrower and more useful: **that the quoting requirement is what costs the recall**,
   which is a statement about the contract and not about the class.

## §74 R-36 read back — the gate that could quote the claim, and the contract that let it

### 74.1 The reading, before the explanation

Two arms, the same 146 pull requests, the same judge, the same lanes; the only configuration field that differs is
`falsifier` (`false` against `true`), and the run is `44028262099`, artifacts `14314024344` and `14314940025`.

|                    | TP  | FP  | FN  | precision | recall | **F1**     |
| ------------------ | --- | --- | --- | --------- | ------ | ---------- |
| lanes as they ship | 208 | 769 | 846 | 0.2129    | 0.1973 | **0.2048** |
| behind the gate    | 139 | 561 | 915 | 0.1986    | 0.1319 | **0.1585** |

**ΔF1 = −0.0463**, paired **+41 / −110** on 277 common goldens, **p = 1.79 × 10⁻⁸**. The registration asked for
**+0.026**; the mechanism rule was `recall-holds`, whose first clause is _precision rises_. **Precision fell**, so the
verdict fails on both clauses rather than on the magnitude alone: this is a falsification of the device as specified, not
a shortfall.

| counter                   | value                             | what it was for                                       |
| ------------------------- | --------------------------------- | ----------------------------------------------------- |
| `candidates`              | 1 646                             | the pool the gate was shown                           |
| `dropped`                 | **557** (33.8 %)                  | removals it applied                                   |
| `keptBecauseQuoteMissing` | **27** of 584 refutations (4.6 %) | **the reader almost never failed to quote something** |
| `notAPatch`               | 38 files                          | files whose text carried no quotable line             |
| `calls`                   | 915 of 146 PRs                    | 6.3 calls per pull request                            |

### 74.2 The anatomy, and it is one number

The pool the gate was shown is larger than the pool that could have been filed: `maxFindingsPerFile` truncates before
the artifact's precision and recall are computed, so **of the 557 removals only 277 could ever have reached a reviewer**.
The other 280 were claims that were not going to be filed whether the gate ran or not - **the gate paid a model call to
decide the fate of a sentence nobody would see.**

Of those 277: **69 were true positives and 208 were false positives.** The pool's own true-positive rate is
`208 / 977 = 21.3 %`; the removals' is `69 / 277 = 24.9 %`. **The gate was very slightly worse than deleting at random**,
and that is the finding, because it is not a story about an unlucky prompt:

> **A false positive is a sentence with nothing specific to point at; a true positive is a sentence about a line. A
> gate whose evidence requirement is "quote an added line" therefore preferentially removes the sentences that have a
> line.** §72.3 already showed that 88 % of the goldens sitting on a hit's line have a sibling the range rule swallowed -
> the claims are anchored, and the gate attacks exactly the anchored ones.

Twelve removals were sampled evenly across the corpus at the time of the run, and **all twelve quote a line inside the
range the claim attacks**:

| claim (anchored at)                                                              | what the reader quoted as a contradiction                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `renaming proto field task_id to ulid without reserving the old tag` (178)       | `optional string ulid = 3;`                                               |
| `the y component is doubled` family — `updateSettings.ts` (30)                   | `controller.task.api = buildApiHandler({ … ulid: controller.task.ulid })` |
| `Registry views coupled to concrete browser driver` (3)                          | `from patchright.async_api import Page`                                   |
| `Deprecated field initialized to empty string changes null semantics` (47)       | `private String systemPrompt = "";`                                       |
| `Scope validation accepts any case but handler only matches 'workspace'` (18-24) | `if (args.scope?.toLowerCase() === 'workspace') {`                        |

**None of these is a reader error.** Each quote is _the_ evidence for the claim - `from patchright.async_api import Page`
is what "coupled to a concrete driver" means. The reader was asked _which line contradicts this claim_ and answered with
the line the claim is about, because the contract says a line the diff added is evidence and **the claim's own line is
one of those lines**.

That is a tautology: `the y component is doubled` at line 12, refuted by line 12. **The gate concluded that the code is
the code, 557 times, and was right about a third of them by accident.**

### 74.3 The same fact from the other side

`keptBecauseQuoteMissing` was designed to separate a strict gate from a reader that invents refutations, and it read
**27 of 584**. Read as a strictness metric that looks like a working gate. Read against §74.2 it is the mechanism
itself: **a reader that may quote the claim's own line can always quote something**, so the counter that was supposed to
measure the gate's discipline was measuring the contract's looseness.

And `dropped` alone would have looked like a success: 557 of 1 646 is a filter that removes a third of the pool, which is
exactly what a filter is for. **The number that would have caught it is the one that was not in the artifact** - the
true-positive share of the removals - and it took a second full run (the judge scores both arms) to compute it.

### 74.4 The second contract, and why it is a contract rather than a prompt edit

`independent-evidence-v2` subtracts the claim's range from the quotable set, in **both** places:

1. **In the prompt.** Each claim is printed with the range that is not evidence for it - `claim 1's own line 12 is not
evidence for claim 1` - because a reader told to apply a subtraction while composing its answer will not apply it.
2. **In the checker.** A refutation whose every matching line falls inside `[startLine, endLine]` keeps the claim and is
   counted in `keptBecauseSelfReferential`. **The test is existential**: if any line carrying that text lies outside the
   range, the reader has quoted evidence that survives the subtraction, because refining a claim by its text is the same
   as refining it by its line.

What remains quotable is the only thing that could ever have refuted a sentence: **the rest of the change** - the guard
three lines up, the `reserved` tag below, the check the claim said was missing. **A gate with nothing else to point at
keeps every claim**, which is the direction this device has always been allowed to fail in.

**§73's figure stays reproducible**: `falsifier` is no longer a boolean but a contract name, `falsifier:
'quoted-falsifier-v1'` is the arm that produced 0.1585, and its registration is closed with an empty `confirmation` for
the reason §8's is - **a falsified device needs no confirmation slice, and listing one would be a promise to pay for a
verdict that has already been read.**

**And the sentence above is a gate rather than a remark.** The registration carries `activity: { counter:
'falsifier.dropped', atLeast: 40 }`, the comparison reports `verdict.activity: { observed, atLeast, met }`, and a run
under the floor is refused as `not a test: the registration needs 40 falsifier.dropped before a difference is about the
contract` - **before the magnitude is read**, because a gain of zero from a gate that removed nothing is not evidence
that the gate does not work. `observed: null` (the artifact does not carry the counter) is `met: false`: **a requirement
satisfied by the absence of its measurement is not a requirement.**

### 74.5 The two instrument defects this run exposed

1. **The sample could not be checked against itself.** `droppedFindings` carried the claim's range and the quote's text
   but nothing that joined them, so _was this quote the claim's own line?_ was answerable only by reading twelve rows by
   hand - which is what §74.2 did. The rows now carry `quoteLine` and `claimIndex`, and the next run answers it by
   counting.
2. **The contract was a constant of the writer.** The artifact's `falsifier.contract` was the string
   `'quoted-falsifier-v1'` written by `aacr-bench.mjs`, not by the gate. **A field whose value is a constant of the
   writer cannot record a change**: the second contract would have produced artifacts saying `quoted-falsifier-v1`, and
   the comparison would have answered them with §73's sentence. It is now written from `report.contract` on the first
   file the gate reads, and left `null` until then.

### 74.6 What would make this section wrong

1. **Reading the falsification as "reflection does not work".** It says the quoting requirement as written admitted the
   claim itself. §45 showed the same class can move precision to 45.5 %; §74 shows it can move F1 to 0.1585. **Neither is
   a statement about reflection; both are statements about contracts**, which is why the next dispatch changes the
   contract and nothing else.
2. **Reading 24.9 % as "the gate was anti-selective" as a law.** The interval on 69 of 277 is wide enough to contain the
   pool rate. What the 24.9 % establishes is the _absence_ of selection - a gate indistinguishable from uniform deletion
   - and the twelve-row sample is what establishes the mechanism behind the absence.
3. **Reading a confirmed v2 as the device being worth its price.** 915 calls per 146 pull requests bought −0.0463 this
   time. The bar is 0.02 at a resolution of 0.0157, and §74.4's rule stands: **a gain under 40 removals is a statement
   about the corpus's claims, not about the device**, and the direction closes rather than being tuned again.

## §75 What the field is doing, what this corpus can resolve, and the one combination that can pass

### 75.1 Three papers, and the one of them that names our §74 failure

**`Adversarial Review` (arXiv 2608.18167, ICML 2026 DL4C).** A reviewer and a critic exchange review text under one rule:
the critic must either **agree, cite the spot it disagrees with, or say that it has no citation** - and _disagreement
without a citation is sent back rather than counted_. The paper's own negative result is the important one: **the naive
version of the protocol was the worst of every method tested on the task of judging reviews**, because two roles that are
allowed to agree freely do agree — _"false consensus"_. Adding the mandatory-evidence rule made the same structure the
best.

> That is §74 in another vocabulary. Our first gate asked _which claims does a line contradict_ and accepted the
> claim's own line as the citation. **It was the naive version**, it removed 557 claims, and its removals were 24.9 %
> true positives against a pool rate of 21.3 %. The second contract is the mandatory-evidence rule: _a citation inside
> the claim is not a citation._

**`CIVER` (arXiv 2610.36010).** Verifies a critique by **intervening on the code**: build a repair that removes the
claimed defect and an unrelated change that does not, then score whether the critique's validity drops for the first and
holds for the second. Reported: **77 % of genuine defects identified, cross-project AUROC 0.760**, downstream repair
success 0.61 → 0.93. Its own limitation is the one that matters for us — _the reliability depends on how well the
intervention isolates the claimed defect_, and the paper filters misaligned pairs before training.

> **This is the device we have not built.** Every filter we have measured asks a reader to _find_ something; CIVER asks a
> reader to _construct_ something - a world in which the claim would be false. That is a harder question to answer by
> pattern-matching, which is exactly why our two filters could be answered without looking.

**`CRScore` (2024) and the claim-level line.** Grounds review comments in **code claims and smells** rather than in
surface similarity. Its contribution to this contract is the deterministic half of grounding: _a comment about symbol
`X` should be anchored where `X` is_, which is checkable without a model.

### 75.2 The hard constraint, stated once

**146 pull requests and 1 054 goldens resolve 0.0191.** Everything in this section follows from that number:

- R-35's bar was 0.026 and R-35 was falsified at −0.0103 with p = 0.354 — **the instrument could not have signed a win
  smaller than 0.019 anyway**, so the run could distinguish "large win" from "not large win" and nothing else.
- R-36's bar was 0.026 and its reading was −0.0463 at p = 1.8 × 10⁻⁸ — **that one was signable**, which is why its
  falsification is a real finding rather than a shrug.
- R-37's expected gain is **+0.0155** and **it therefore has no registration**. A bar at the point estimate sits under
  the instrument's own error bar, and a bar at 0.02 would have been chosen above its own estimate so that a failure could
  be reported as a result. **The union is built and wired; it is a component of the combined dispatch below, not an
  experiment.**

**And the corpus is at its ceiling.** 200 pull requests exist, 196–199 have never been read, and five iterations have
read four devices off rows 50–195. **Nothing under 0.019 can be learned on these rows again**; the next _new_ number
requires either more pull requests or a device whose expected gain is 0.04 or larger.

### 75.3 What "beat the field" costs, in the only currency this corpus accepts

The field's published leader on this benchmark reports **SEM-F1 25.10 %** (OpenCodeReview, `arXiv 2608.09290`; Claude
Code 11.57 % on the same rows). We read **0.2048**. Three ways to close 0.046, each computed on the artifact's own
counts rather than estimated:

| route                | what has to happen                                                           | what it costs                                                                                      |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| precision only       | FP **769 → 187** (remove 582 of 769 false positives, keeping every true one) | a filter with 0 % false removals — **no filter in this repository has ever been better than 75 %** |
| recall only          | TP **208 → 292** (recall 0.198 → 0.277, + 40 %)                              | the corpus ceiling is p@16 = 0.267, so this route cannot reach the figure                          |
| **both, moderately** | TP **208 → 240** and FP **769 → 560**                                        | **+32 goldens found, 209 false positives removed, at most 8 true positives lost**                  |

**The third row is the only one that is reachable and it is a combination, not a device.** Thus:

> **R-37 supplies the +32 and a gate must supply the −209 with at most eight casualties** — a removal pool that is
> **≤ 4 % true positives**, against §74's 24.9 %. That is the number every subsequent precision device should be judged
> on, and it is a sharper instrument than F1 because it is measured on the removals rather than on the whole run.

### 75.4 The decision tree this section commits to, before the v2 run lands

R-36b (`falsifier: 'independent-evidence-v2'`) is in flight on run `44100493243`. Its outcome selects the next dispatch,
and the selection is written here so that it cannot be made to fit the result:

| v2 outcome                        | what it means                                                                           | next dispatch                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1 ≥ +0.02 **and** `dropped` ≥ 40 | the quoting requirement was the defect, and independent evidence exists inside the hunk | **combined**: `lane_set: wide` + the gate, registered at 0.03, one dispatch, two arms                                                                                                                                    |
| F1 ≤ 0 **and** `dropped` ≥ 40     | the gate has something to say and says it wrongly                                       | **CIVER's question** (R-39): ask the reader to _construct_ the repair that would make the claim false, and treat a claim it cannot construct a world for as unverified — one call per file, the same price               |
| `dropped` < 40                    | a hunk holds no independent evidence for its own claims                                 | **cross-file evidence** (R-38): resolve the changed exported symbols' call sites deterministically and put them in the quotable set — the gate's problem was never its reader, it was the size of the world it could see |
| 0 < F1 < +0.02                    | direction right, size under the instrument                                              | **combined** with `wid`, and read the _removal_ counter rather than F1; if the removals are ≤ 4 % true positives the device is working and the corpus is what is too small                                               |

**And the closing rule.** If the combined dispatch reads under 0.019 again, **the answer is not another device** - it is
that this corpus has said what it can say, and the next number has to come from rows that do not exist yet. **A plan
that cannot state its own floor is a plan that runs forever.**

### 75.5 What would make this section wrong

1. **Reading 0.0191 as a property of the benchmark.** It is a property of _these 146 rows_. The 200-pull-request corpus
   resolves 0.016 and a 500-pull-request corpus would resolve about 0.010; **the ceiling is a budget statement, not a
   law about AACR-Bench.**
2. **Reading §75.3's third row as a target that can be hit by tuning.** +32 and −209 with ≤ 8 casualties is a _joint_
   condition; a device that finds 300 more goldens and 400 more false positives moves F1 backwards, and §72.4's ceiling
   says the first half is bounded while the second half is not.
3. **Reading the three papers as a menu.** CIVER needs intervention generation, AR needs a two-role loop, CRScore needs
   claim extraction; **each is a device with its own price**, and the tree above chooses between them by what the corpus
   says rather than by which is most cited.

## §76 The bar a deletion device cannot reach is not a bar it failed

### 76.1 A third verdict, because a shortfall has two causes

Three outcomes were available to a registered device on this comparison: **resolvable** (the bar is above the instrument's
error bar), **a test** (the device ran and used its inputs), and **falsified** (the bar was not reached). §75.4 leaned on
all three and none of them could express the case that turned out to matter: **a removal-only device cannot move F1 by
more than the findings it deletes**, so a bar can be out of a device's reach before it is asked, and the same `falsified:`
sentence then reports a property of the corpus in the device's name.

**The bound is computable from the two arms.** Had every claim the gate removed been a false positive, and had every one
of them reached the reviewer, the figure would be `f1(tp, fp − removed)` against the baseline arm's own counts. Two
charities at once — no true positive lost, no removal truncated — so the number is a ceiling, and a ceiling under the bar
is a proof that **no** version of this device on this pool could have cleared it. `deletionCeiling` in
`.github/scripts/aacr-ablation-compare.mjs` computes it; the registration declares `deletionOnly` and `deletionCounter`,
because a mechanism sentence (`precision rises and recall holds`) describes two devices with different reach.

### 76.2 What the arithmetic says at this corpus, before the v2 arm is read

At §73's baseline — **146 pull requests, 1 054 goldens, 208 true positives, 769 false positives, F1 0.2048** — the ceiling
as a function of what the gate removes:

| claims the gate removed | best possible gain in F1 | under a 0.02 bar?  |
| ----------------------- | ------------------------ | ------------------ |
| 40 (§74.4's floor)      | +0.0041                  | yes, by five times |
| 80                      | +0.0084                  | yes                |
| 100                     | +0.0106                  | yes                |
| 150                     | +0.0163                  | yes                |
| **181**                 | **+0.0200**              | **exactly at it**  |
| 200                     | +0.0224                  | no                 |
| 300                     | +0.0355                  | no                 |
| 557 (§73's gate)        | +0.0774                  | no                 |

**Three consequences, and the first is a correction of §74.4.** The activity floor of 40 was justified as "the count at
which _which ones_ is a question the artifact can answer" — but at 40 removals the ceiling is a fifth of the bar, so a
run that clears the floor and misses the bar has learned nothing about the device. **The floor that protects a
registration is the reach floor, and it is 181 here, not 40.** The second: §73's gate could have cleared 0.026 and bought
−0.046, so **its falsification stands** and the reach arithmetic does not rescue it. The third: the readback of any
removal device now begins with `reach.removed` and `reach.reachable`, and only a run with `reachable: true` can be read
as a test of the device's judgement.

### 76.3 What would make this section wrong

1. **Reading the ceiling as an excuse.** It is charitable by construction, and its whole force is that it uses the
   device's _own_ removals: a gate that removes forty of a thousand claims is `unreachable`, and the sentence says so.
   **If the branch ever fires on a run whose removals were plentiful, the arithmetic is broken, not the corpus.**
2. **Reading it as a substitute for the paired test.** A reachable run still needs the corpus bar to sign a win; the
   ceiling says whether the question could be asked, not whether the answer is real.
3. **Computing it from the difference in emitted findings.** That difference has already had truncation and true-positive
   losses applied, so a bound built from it would be the result rather than the ceiling — the device would be excused by
   its own failures.

### 76.4 The pool, not the figure

§75.3 said every subsequent precision device should be judged on **the true-positive share of its removals** — ≤ 4 % —
rather than on F1, because that number is measured on what the device deleted and does not move when the reviewer's
generation moves. It was prose; it is now a field. `removalPool` publishes `removed`, `truePositivesRemoved`, `share`,
`target` and `withinTarget` beside the delta, and **`share` is `null` rather than `0` when nothing was removed**: no pool
is not a perfect pool, which is the same rule `activity: { observed: null }` applies one level up.

At §73's gate the field reads **277 removed, 69 of them true positives, share 0.2491, outside the 0.04 target** — the
number §74 had to read off twelve sampled rows by hand, now computed from the two arms. And at §75.3's combination it is
the only figure that can say whether the gate half of the plan is working while the F1 half is still short.

## §77 The clock was a comment and the bill was a surprise

### 77.1 What a run costs, measured rather than estimated

The artifact for a fifty-pull-request single arm carries its own ledger: **3 195 lane calls, 6.69 M prompt tokens at
56.9 % cache hit, 0.77 M completion tokens, 11 849 judge calls**, priced by `costUsdOf` at **0.9045 USD** — and that
figure is already off-peak, because the factor is `isPeakHour(at) ? 1 : OFF_PEAK_FACTOR` and the job ran at 00:30 CST.
At peak the same work is **1.809 USD**. Per pull request: **0.027 USD off-peak, 0.036 at peak**, judge included.

So one paired experiment over the 146-pull-request corpus is **5.3 to 7.1 USD**, or **37 to 50 CNY**, and the number of
experiments is the whole bill. **The 200 CNY of 2026-11-17 was not a unit price.** It was three paired dispatches, one
competitor `record` at 5.89 USD, and one 128-minute run cancelled by hand — **every one of which was a decision I made
in the same day.**

### 77.2 Three things were wrong, and none of them was the price

1. **The slot was a constant.** `timeout-minutes: 340` admitted a 146-pull-request pair for 178 minutes of work and a
   stuck job for five and a half hours, so the only thing that ever stopped run 44100493243 was a person watching. It is
   now **280** — 1.47 times the 190 minutes that pair finally took, i.e. **1.30 minutes per pull request**, and the
   assertion that it is derived from that measurement is a test rather than a comment. **The first attempt scaled it
   with the corpus and GitHub refused the field**: `Unexpected symbol: '*' ... Located at position 58 within
expression`. `timeout-minutes` takes contexts rather than arithmetic, so the scaling lives in `slicesThatFit`, which
   refuses a dispatch the slot cannot cover (175 pull requests at the confirmation tolerance) before anything is spent.
2. **The same number was bought repeatedly.** The off arm of every pair re-derives a figure that does not move when the
   on arm changes, and the judge re-decides `finding × golden` pairs whose texts it has already read. **Both are pure
   functions of inputs this repository already stores**, and neither was cached — so every experiment paid twice for the
   half of it that was not an experiment.
3. **Nothing was tried small first.** Every hypothesis went to the full corpus on its first dispatch, so a device that a
   thirty-pull-request slice would have rejected in four minutes was rejected in three hours at 2.9 times the cost.

**The instrument was never the problem.** `CostLedger` writes a record at every call site and the artifact publishes
the split by tag; **what was missing was a brake, and a brake is a decision about how often to press the accelerator.**

### 77.3 The discipline this section binds us to

1. **A new device is measured on thirty pull requests before it is dispatched on the corpus**, and a slice that cannot
   move the figure by a tenth of the registered bar is not promoted.
2. **A figure that cannot change is not bought twice**: the off arm and the judge are to be cached by input fingerprint,
   which is the same device the competitor arm already has.
3. **A run is given a slot and a ceiling that are about its corpus**, and both are refused rather than reported when
   they are exceeded.
4. **A cancelled run is a cost, not a non-event**: it goes in the same account as a completed one, because the vendor
   billed it the same way.

**What would make this section wrong:** if a thirty-pull-request slice were not predictive of the corpus for the devices
we register. **It was predictive of §73's gate** — the same sign, the same significance, at a fifth of the corpus — and
if that stops being true the first rule is the one to drop, not the second.

## §78 The contract worked; it ran out of material

### 78.1 The reading, and the third verdict's first firing

R-36b landed on 146 pull requests, 1 054 goldens, run 44126428791, 190 minutes:

|                                    | precision | recall  | F1          | TP  | FP  | findings |
| ---------------------------------- | --------- | ------- | ----------- | --- | --- | -------- |
| **with** `independent-evidence-v2` | 0.2061    | 0.1803  | **0.1923**  | 190 | 732 | 1 461    |
| **without**                        | 0.2016    | 0.1879  | **0.1945**  | 198 | 784 | 1 638    |
| **delta**                          | +0.0045   | −0.0076 | **−0.0022** | −8  | −52 | −177     |

Paired test `both 123 / withOnly 67 / withoutOnly 75`, p = 0.5571; the pull-request bootstrap puts the difference at
−0.0024 with an interval of [−0.0228, +0.0176]. **Nothing was signed.**

**And the run was not falsified either.** `reach` reads **169 removed, ceiling +0.0176, reachable false** against a bar
that needs 0.0204, so the outcome is `unreachable: the device removed 169 claims, and had every one of them been a false
positive that reached the reviewer this figure moves by 0.0176 at most`. **§76's third verdict fired for the first time
on a real run, and its sentence is correct**: the corpus could not price the bar, so the shortfall is not the device's.

### 78.2 Three things the artifact says, and only one of them was the hypothesis

1. **The contract did what it was built to do.** §73's gate removed 557 claims carrying 69 true positives among the 277
   that could reach a reviewer - **24.9 %**, against a pool rate of 21.3 %, i.e. very slightly anti-selective. `v2`
   removed 169 carrying 8 - **4.73 %**. §75.3's target is 4 %, and **the pool is now within a fifth of it**. The
   tautology is gone: 148 refutations were refused for quoting inside the claim's own range
   (`keptBecauseSelfReferential`), which is exactly the class §74 sampled twelve of twelve from.
2. **It ran out of things to remove.** 169 removals are worth +0.0176 even if every one were a false positive that
   reached the reviewer. **The device is not too weak; the hunk is too small.** A three-line hunk contains no independent
   evidence about those three lines, so a contract that demands independent evidence correctly keeps them.
3. **The reach floor is not a constant.** §76.2 computed 181 against §73's counts (208 true positives, 769 false
   positives). R-36b's control read **198 and 784**, and against that pair the count at which a perfect pool reaches
   +0.0200 is **190**. **A floor quoted from another section's arithmetic is a floor for another corpus**, and this is
   the second time this stretch that a number outlived its inputs.

### 78.3 What the field says about the shortage, and what it warns about the repair

Three sources, and the third is the constraint rather than the encouragement:

- **`arXiv 2411.03079` (eCPG-Slicer)** builds a per-project _file reference graph_, takes its strongly connected
  components with Tarjan's algorithm, and derives a **precise and complete** slice before asking a model anything. The
  point of the SCC pass is that it is computed once and reused, so the context is complete without a whole-program
  analysis per warning.
- **`arXiv 2610.36010` (CIVER)** validates a claim by **intervening on the code it names** rather than by reading the
  claim's own region - 77 % of its verified findings are real defects at AUROC 0.760. That is the same principle as `v2`
  (`the claim's own line is not evidence`) reached from the opposite direction.
- **IEEE 11719504 (multi-signal focused verification)** is the warning. It builds a bidirectional call graph and
  assembles cross-function context for each finding, and then says the quiet part: _"because the bundle aggregates a
  large amount of surrounding context, the model's judgment can become detached from any single concrete piece of code,
  and it becomes prone to reporting vulnerabilities that are not borne out by the actual implementation"_ - which is why
  it adds a proof-of-concept execution layer on top. **The field's context-dump reviewers report 60–80 % of their
  findings as false for this reason.**

**So the repair is a slice, not a bundle**: `v3` does not hand over the file, it hands over the lines around each claim,
numbered in the file's own coordinates, capped at half the block the hunk gets.

### 78.4 `independent-evidence-v3`, and why it is a third contract rather than a fourth device

`selectSurrounding` takes each claim's window of `radius` lines (default 40) either side, merges the windows, drops every
line the hunk already showed, and caps the result at `budget` lines **by distance to the nearest claim** - the nearest
lines win, because the line that refutes a claim is almost never two hundred lines away. Those lines join the quotable
set, and **the `v2` subtraction still applies**: a claim's own range is not evidence, whether it was printed under the
hunk or under the file.

**Three properties make this a test rather than a wish.**

1. **`v3` with no surrounding text is `v2`**, and the artifact says which one ran. A gate that reported
   `independent-evidence-v3` while measuring `v2` would be §74's instrument defect one device later.
2. **The fetch belongs to the contract, not to another arm's switch** (`NEEDS_FILE_TEXT`), so a `v3` run fetches the
   file whether or not `code_context` was asked for - and the two arms of the pair differ in exactly one field.
3. **The prompt is bounded.** The surrounding block gets `FALSIFIER_CONTEXT_BUDGET = 6 000` characters, half the hunk's
   block: a contract that spends more on the file than on the change has inverted what the reader is asked about.

### 78.5 R-38's registration, and what would make it wrong

Registered in `.github/scripts/aacr-ablation-compare.mjs` as `falsifier:independent-evidence-v3`, bar **0.02**, mechanism
`recall-holds`, activity floor **190** (this baseline's reach floor), `deletionOnly`, no confirmation slice - because the
corpus has 196 rows past the discovery set and the contract needs 340 removals to price a 0.02 bar, so **a confirmation
here would be §76's defect one level up**.

The arithmetic the registration rests on: `v2` left 183 claims behind (148 self-referential, 35 quote-missing), and
169 + 183 is **352**. At the toxicity `v2` measured, **340 removals are worth +0.0200** - so the contract has to convert
roughly two thirds of the refutations it was already making into verified ones, at the same 4.73 % toxicity or better.

**Three ways this is wrong, stated before the run.**

1. **If the 148 were refused because they were wrong rather than because they were unquotable.** They were refutations a
   reader offered; `v2` refused them for where the quote was, not for what it said. If, given the file, the reader
   quotes the same self-referential lines again, `keptBecauseSelfReferential` stays at 148 and the removals stay at 169
   - and the shortfall is then the reader's judgement rather than the hunk's size.
2. **If the wider evidence makes the pool dirtier.** The toxicity is a property of _which_ claims get removed, and a
   reader with more context can be wrong in more ways. **4.73 % must not become 10 %**: at 10 % the same 340 removals are
   worth +0.0190 and the contract buys nothing.
3. **If the cost is disproportionate.** The surrounding block adds ~50 % to the gate's prompt, and the file fetch is one
   request per changed file. **A contract that buys 0.02 for a third more spend is still a contract; one that buys it for
   three times the spend is a contract to price against the alternative.** The spend is recorded by tag either way.

## 79. The index we did not have: two repositories, one diagnosis

### 79.1 What was read, and what it cost to read it

Two checkouts, read end to end rather than skimmed, because a mechanism copied from a README is a mechanism whose
failure modes were not copied with it.

| Checkout                         | Size                           | Files read for this section                                                                                                                                                                                            | The mechanism taken from it                                                                              |
| -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Wilfred/difftastic` @ `4b834ef` | 15 877 lines of Rust, 58 files | `src/diff/{graph,sliders,unchanged,shortest_path,changes}.rs`, `src/parse/syntax.rs`                                                                                                                                   | **A change has structure, and the structure says which lines are novel.**                                |
| `aoci-spec/aoci-code` @ depth 1  | 188 020 lines of Go, 847 files | `aoci.code.txt` (its own 628-line index), `aoci.meta.txt`, `spec/public/s-field-discipline.en.txt`, `internal/cognitionbudget/policy.go`, `internal/mcptools/tools_read_search.go`, `docs/managed-scope-and-budget.md` | **A repository can carry a one-line-per-file cognition index that a reader loads instead of searching.** |

**`difftastic`'s claim, in its own numbers.** Every edge in its diff graph carries a cost: an unchanged node costs
`1 + min(40, depth_difference)`, an entered unchanged delimiter costs `10 + min(40, depth_difference)`, a novel node
costs `300`, and a replaced comment or string costs `500 + (100 − levenshtein_pct)`. Dijkstra then finds the cheapest
route through a graph whose vertices are _pairs of unmatched positions_ (`src/diff/graph.rs:324`). **Motion is not
modelled as delete-plus-insert**: a node that reappears elsewhere is reached by an `UnchangedNode` edge at cost 1, so a
moved block is a _cheap_ route and a rewritten block is an _expensive_ one. `src/diff/unchanged.rs` then prunes the
search with `TINY_TREE_THRESHOLD = 10` and `MOSTLY_UNCHANGED_MIN_COMMON_CHILDREN = 4` before the graph is ever built.

**`aoci-code`'s claim, in its own numbers.** Its index is 628 lines for a 188 020-line repository - **one line per
file**, each carrying `F:` (responsibility), `R:` (files that must be read together), `A:` (what callers depend on),
`S:` (the constraint that cannot be inferred but must not be violated), plus a tag `[C{importance}{module}{1-9}{L,M,S,T}]`.
Its whole-index budget is `target 200 000 / warn 300 000 / max 400 000` tokens, and `R`/`S` are capped _by importance
band_: a `C9` file may spend 90 / 100 tokens on them, a `C1–C4` file only 25 / 20 (`internal/cognitionbudget/policy.go`).
Retrieval is `index.Search(doc, keyword, tagFilter)` returning whole lines, truncated at `maxSearchResults = 30`
(`internal/mcptools/tools_read.go:39`) - **not embeddings, not a vector store: a keyword and a tag filter over thirty
lines at a time.**

### 79.2 The diagnosis, and it is about us rather than about them

`packages/intelligence/src/review/llm/code-context.ts` states our own measurement in its header: of 160 rejected
findings on 36 pull requests, **91 were rejected on the golden's exact line** - "the reviewer was not looking in the
wrong place, it was saying the wrong thing about the right one" - and its own conclusion is that "a hunk carries the
change and not the contract the change has to keep".

That file then answers with a **wider window**: brace-depth block extraction, `padding`, `maxBlockLines`,
`maxCharsPerFile`. §78 answered the same measurement with a **wider window again**: 200 lines of surrounding context,
6 000 characters. **Both are the same move, and the register of that move is a cost curve.** Every widening buys a
little more of the contract and pays for it in prompt, and the return on the second widening is already negative
(§78.5, third way to be wrong).

**The two repositories answer the same measurement with the opposite move.** `difftastic` narrows: it computes _which
lines are novel_ and hands over only those. `aoci-code` replaces: it hands over **one line that says what the file is
for and what must not break**, and nothing else. Neither widens. **A wider window is what you do when you have no
index; once you have one, a wider window is what you stop doing.**

### 79.3 Three mechanisms, and the ownership of each

| Mechanism                                                                                                                   | Taken from                               | Ownership                                                                                                                            | What it changes here                                                                                                                                | Tokens                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **M1 `change-shape`** - classify each hunk as `reformatted`, `comment-only`, `moved` or `substantive`, from the diff alone  | `difftastic`'s cost model, minus the AST | **Competitor-shared** (GitHub's own "ignore whitespace", `git diff -w`, and every review bot that skips lockfiles do part of it)     | Non-substantive hunks stop reaching the gate, and a finding whose anchor sits on a non-novel line loses its standing                                | **−15 to −25 % of hunk characters**       |
| **M2 `cognition-index`** - one line per file: `F`/`R`/`A`/`S` plus an importance-scale tag, persisted under version control | `aoci-code`'s FRAS v2                    | **Competitor-unique to `aoci-code`**; no review product ships a repository-resident semantic index                                   | The gate reads the contract of the file instead of 200 lines around the hunk; `R` makes a _missing companion change_ expressible for the first time | **6 000 → ~400 characters per file**      |
| **M3 `index-first retrieval`** - keyword + tag filter over the index, top 30 lines, whole lines only                        | `aoci-code`'s `aoci_search`              | **Competitor-shared in shape** (`open-code-review`'s `code_search`), unique in content (our index is FRAS, theirs is a symbol table) | Before a claim is read, the claim's own vocabulary fetches the invariants that mention it                                                           | **0 generative tokens: a substring scan** |

**The token arithmetic, done before the run rather than after.** A gate call today carries a 12 000-character hunk
block plus the 6 000-character surrounding block - **18 000 characters**. With M1 dropping one hunk in five and M3
replacing the surrounding block with a 400-character index extract, the same call carries
`0.8 × (12 000 + 400) = 9 920` characters: **−44.9 %**. That is the number to beat, and it is a _character_ number
because §77 registers spend by tag, not by feeling.

**The precision arithmetic, also before the run.** `v2` measured TP 190 / FP 732 over 922 adjudicated findings. If one
finding in five sits on a non-substantive hunk and nearly none of those is a true positive - which is what "the golden
annotates behaviour, not whitespace" means - then dropping 180 false positives and 5 true ones gives
`185 / 742 = 0.2494` precision against today's `0.2061`, and F1 `0.2116` against `0.1923`: **+0.019**, before M2
contributes anything. **M1 alone is not the 0.02 bar; M1 is what makes M2 affordable.**

### 79.4 The discipline `aoci-code` imposes on us, and why it forbids my first design

`spec/public/s-field-discipline.en.txt` is normative, and its clause 0 is a prohibition:

> Tags and F/R/A/S are cognition semantics and must be generated by the current model after reading the target file,
> the index Header, and the necessary related evidence. Generating, prefilled, assembling, or rewriting semantics with
> an AST, symbol extraction, import/include scans, paths, file names, extensions, regular expressions, templates, rule
> engines, or batch scripts is forbidden.

**My first design for M2 was exactly the forbidden thing**: derive `S` from `throw new Error(...)` by regex, derive `R`
from the import graph, derive `F` from the first comment line. It is cheap, deterministic, and reproducible - and it
produces a field that reads like a contract while being a restatement of the syntax. **A regex-extracted invariant is
not an invariant; it is a string that happens to appear next to one.** The failure mode is precise: the gate would
trust `S` above the surrounding lines, and `S` would be the least trustworthy field in the prompt.

So M2 is built the way `aoci-code` builds it - **the model writes the entry, and the tool only chunks, hashes, validates
and persists** - with one difference forced by our scope: **the index is written once per repository and reused across
pull requests**, because a 146-pull-request bench that rebuilt its index per pull request would spend more on the index
than on the review. That reuse is the whole economic argument: `aoci-code` amortises a one-hour index build over months
of sessions; we amortise it over 146 pairs, and it is the same amortisation.

### 79.5 What M1 registers, and the three ways it is wrong

Registered as `change-shape` ahead of any run.

1. **If non-substantive hunks carry true positives.** A reformatted hunk can still be the hunk where a reviewer said
   "this rename breaks the public API". The rule is therefore **classify and record, do not silently drop**: the hunk
   is skipped only when its _every_ changed line is accounted for by whitespace, comment text, or relocation, and the
   count of skipped hunks and skipped findings is written to the artifact. **If the dropped findings contain more than
   4 true positives, M1 is a recall device and must be re-registered as one.**
2. **If "moved" is really "deleted and re-added with an edit".** Relocation is decided by normalised line identity
   against the _other_ side's full text, so an edited copy is not a move. A file larger than the reading budget is
   classified `substantive` rather than guessed at.
3. **If the character saving is not where the spend is.** The gate's prompt is dominated by hunk blocks only if a
   typical pull request has few hunks per file; if it has many small ones, the saving is in _calls_, not characters,
   and the artifact must show both.

### 79.6 What is explicitly not being done

- **No Rust binary, no `difftastic` dependency.** Its cost model is reproduced over our own line structure; the AST
  version is deferred until M1's line-level version has a measured return, because a parser dependency in the bench
  path is a build failure on the day the bench matters.
- **No embeddings, no vector store for the index.** `aoci-code` retrieves with a substring and a tag filter over thirty
  lines. A vector index would add a network call, a provider quota (the reason the benchmark was suspended twice), and
  a number that cannot be explained line by line.
- **No second LLM pass to write the index during a bench run.** The index is a repository artefact, built by an
  explicit command and committed, so a bench run's spend stays a review spend.

### 79.7 What this section has already bought, and what it has not

**Landed, with tests, in the same commit that wrote this section.**

| Piece                              | Where                                                                                                                | What it can be held to                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `classifyChange` / `classifyPatch` | `packages/intelligence/src/review/adjudication/change-shape.ts`                                                      | 22 tests; 100 % statements, 98.63 % branches, 100 % functions, 100 % lines                                                      |
| The gate's use of it               | `falsifier.ts`, `novelLines` on `FalsifierRequest`, `droppedBecauseNotNovel` on `FalsifierReport`                    | 7 tests, including **an empty set is a decision and not an absence** and **a file whose text is not a patch is never filtered** |
| The engine's carriage of it        | `llm-review-engine.ts`, `novelLinesOf`                                                                               | 2 behavioural tests through `reviewDiff`, plus the default `() => undefined` that keeps every published figure reproducible     |
| The bench's switch and counters    | `.github/scripts/aacr-bench.mjs`, `AACR_CHANGE_SHAPE`, `engineCounters.falsifier.shape`, `configuration.changeShape` | dry run green; `.github/scripts` suite 855 tests green                                                                          |

**Not landed, and named rather than implied.** `AACR_CHANGE_SHAPE` is readable from the environment but **the workflow does
not yet pass it**, because doing so honestly needs a paired arm, a paired arm needs a distinct artifact name, and a
distinct artifact name renames fifteen download steps and the three tests that assert them. **A switch the workflow
cannot set is a switch a CI run cannot price** - so the next commit adds `pair: change-shape` together with the rename,
and until it does, this section's contribution is a device and not a figure.

**The number this section has not produced, stated so it cannot be claimed later.** §79.3 predicts −44.9 % of gate
characters and +0.019 F1 from M1 alone. **Neither has been measured.** The first available reading is a 30-pull-request
`pair: change-shape` slice, and the bar is the one §79.5 registers: more than 4 true positives among the dropped findings
makes M1 a recall device that must be re-registered rather than a precision device that worked.

## 80. The index, and the first contract that reads it

### 80.1 What §79 left undone, stated as a measurement

§79 landed a device that decides **which lines a change wrote** and left the second half of its own diagnosis untouched:
`code-context.ts` measured 91 of 160 rejections landing **on the golden's exact line**, and both answers to that were
widens. §80 answers it with the other move - **an index of what the file is**, so a reader is shown a declaration and its
guards instead of two hundred lines around a hunk.

### 80.2 The boundary `aoci-code` draws, and where this repository draws it differently

`spec/public/s-field-discipline.en.txt` is normative and its clause 0 forbids deriving `F`/`R`/`A`/`S` from an AST, an
import scan, a path, a filename, a regular expression or a template. The ground is stated in the same clause: **a
regex-extracted invariant is not an invariant; it is a string that happens to sit next to one.**

That prohibition is about **meaning**, and it says nothing about **structure**. Which name is declared on which lines,
whether it is exported, and which guard statements sit inside it are facts a lexer can establish and a reader can check
by opening the file. So the split here is:

| Layer                                     | Source                     | What it may say                                                      | What it costs            | Where it goes                      |
| ----------------------------------------- | -------------------------- | -------------------------------------------------------------------- | ------------------------ | ---------------------------------- |
| **Structure** (`review/index/symbols.ts`) | a lexer over the file      | declarations, ranges, export surface, guards                         | nothing                  | the prompt, the artifact, any gate |
| **Meaning** (`F`/`R`/`A`/`S`)             | a model that read the file | what the file is for, what must be read with it, what must not break | one build per repository | a future contract, never derived   |

**Nothing in this section produces meaning.** There is no `responsibility` field and no `constraint` field, and the day
one is added it will carry its provenance beside it - `written` rather than `derived` - so that a reader can tell which
half of the index it is trusting.

**And the failure direction is fixed before the code.** A construct the lexer cannot read - a regex literal holding a
brace, a generic with a block-shaped default - must never make a symbol **end early**, because a symbol that ends early
hides the guard that would have refuted a claim. So the scanner carries `uncertain`, and every symbol open when it is set
runs to the end of the file: **the wider claim, never the narrower one, when the reading is unproven.**

### 80.3 The fourth contract: the same rule on a tenth of the characters

`independent-evidence-v4` keeps §78's evidence rule exactly - **a quote must lie outside the claim's own range, or it is
the claim agreeing with itself** - and replaces the second block:

|                                     | `v3` (§78)                                  | `v4` (§80)                                                                                  |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Second block                        | up to 6 000 characters of surrounding lines | up to 600 characters of index extract                                                       |
| What it shows                       | the lines around the hunk                   | `exports:`, the declaration the claim stands in, the guards inside it, the claim's own line |
| Quotable                            | every surrounding line rendered             | exactly the lines the extract printed, read back out of the rendered text                   |
| When the caller has no second block | keeps every claim it cannot refute          | falls back to the window, then to `v2`                                                      |

**The read-back is the detail that matters.** `selectIndexedContext` returns `{ text, shown }` together and derives
`shown` **by parsing the text it is about to send**, so a line cut by the budget is not a line a quote can be verified
against. Two derivations of "which lines did the reader see" is the defect `renderLines`'s `shown` field already exists to
prevent, one block over.

### 80.4 What landed, and what it is held to

| Piece                                      | Where                                                                    | Held to                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildSymbolIndex`, `selectIndexedContext` | `packages/intelligence/src/review/index/symbols.ts`                      | 12 tests: ranges, export surface, members, comments and strings that must not read as code, an open template literal across lines, a claim no declaration contains  |
| The gate's use of it                       | `falsifier.ts`, `FALSIFIER_CONTRACTS.v4`, `indexed` on the request       | 6 tests: the index in the prompt, the same rule on 40 % of the characters, a quote verified against the extract, a quote the extract never printed kept and counted |
| The engine's carriage                      | `llm-review-engine.ts`, `fileIndexOf`                                    | 2 behavioural tests through `reviewDiff`: the index reaches the gate, and a caller with none gets the window                                                        |
| The bench                                  | `AACR_ADJUDICATE=falsifier-v4`, `buildSymbolIndex` over the fetched text | dry run green; the arm is a fourth value on `adjudicate` so §78's figure stays reproducible                                                                         |
| R-39 and R-40                              | `aacr-ablation-compare.mjs`                                              | self-test green; R-39 registered with `registeredBelowResolution` and §80.5 says why                                                                                |

### 80.5 The two registrations, and the arithmetic that shaped them

**R-39 (`changeShape:true`, §79).** On R-36b's control arm the file arm read TP 198 / FP 784 over 1 054 goldens, so a
deletion pool of `x` false positives gives `F1(x) = 396 / (2 036 − x)`: **+0.0200 needs 190 removals**, and the
classifier's own prediction - one finding in five of 922 sitting on a non-substantive hunk - is 184. `F1(184) = 0.2138`,
which is **+0.0193**. The corpus resolution is 0.0191. **The interval in which a met magnitude would also be outside
noise is two ten-thousandths wide**, so the entry is registered at 0.015 with `registeredBelowResolution: true` and says
in its own comment that a bar fitted into that gap would be a coincidence wearing a threshold's clothes.

**R-40 (`falsifier:independent-evidence-v4`, §80).** The same 190 floor, derived from the same pair of counts rather
than copied from §76's - **a floor borrowed from another section's arithmetic is a floor for another corpus.** The bar is
0.02, the same one `v3` was given, because a contract that needs a tenth of the prompt and reaches the same pool is the
same device at a tenth of the price.

### 80.6 The defect the first `v3` dispatch found, and it was not in `v3`

The 30-pull-request `pair: falsifier-v3` slice (`44207037687`) **failed after 34 minutes** with

> `AACR-BENCH failed: Cannot read properties of undefined (reading 'length')`

The message is true of perhaps forty lines in `.github/scripts/aacr-bench.mjs` and identifies none of them, so the run
bought a symptom and not a location. Two things changed because of it:

1. **The top-level catch prints the first frame in this file beside the message.** A failure that costs a dispatch to
   locate is a failure this job will keep paying for.
2. **The next dispatch of any arm is a one-pull-request probe, not a thirty.** A device whose wiring has never reached a
   review call is a device whose wiring has never been tested; `--dry-run` proves the arithmetic and proves nothing about
   the path that spends the money.

**What the failure was not.** It was not `v3`'s evidence rule, and it was not a spend: the credit probe before the run read
121.42 CNY and the run died before its first gate call, so the 34 minutes cost a runner and no tokens. **A run that fails
at its first call is cheaper than a run that succeeds at its last**, and that is the only respect in which this was good
news.

### 80.7 What has not been measured

- **The 600-character claim.** §80.3 predicts a tenth of the prompt at the same pool. The test suite asserts the prompt is
  under 60 % of the window's on a 400-line file; it cannot assert the pool.
- **The index's effect on F1.** R-40 is registered and unanswered. **No number in this section is a measurement**, and the
  first one that will be is a one-pull-request probe followed by a 30-pull-request slice, in that order.
- **The `F`/`R`/`A`/`S` layer.** Not built. The structure layer is what a lexer can prove, and the meaning layer is what
  `aoci-code` forbids deriving - so it is a model-written artefact, committed once per repository, and its cost is
  amortised over every pull request that reads it.

## 81. The index's first reading: a clean gate, and a gain that is not the gate's

### 81.1 The run

`44240929597` - `pair: falsifier-v4`, 30 pull requests, `skip 0`, competitor replayed, both arms green, 51 minutes. It is
the first reading of any third-or-fourth contract that reached its judge, and it exists because §80.6 changed the order of
operations: **a one-pull-request probe before a thirty, and the probe before it had already found the defect that killed
the two dispatches before.**

|                 | `v4` (with) | no gate (without) | Δ                     |
| --------------- | ----------- | ----------------- | --------------------- |
| precision       | 0.2581      | 0.2189            | **+0.0392**           |
| recall          | 0.1818      | 0.1667            | +0.0151               |
| F1              | 0.2133      | 0.1892            | **+0.0241**           |
| true positives  | 48          | 44                | +4                    |
| false positives | 138         | 157               | −19                   |
| findings        | 407         | 442               | −35                   |
| gate calls      | 225         | —                 | +225                  |
| prompt tokens   | 5 026 767   | 4 818 632         | +208 135              |
| cost (USD)      | 0.4019      | 0.3647            | **+0.0102 (+10.2 %)** |

### 81.2 What is hard, and what is noise

**Hard, and it is the result this device was built for.** The removal pool read **35 removals carrying 0 true positives -
a share of 0 %**, against §75.3's 4 % target and §73's 24.9 %. `keptBecauseSelfReferential` was 18 and
`keptBecauseQuoteMissing` 9, so the gate was not silent: it read 438 candidates, removed 31 with a verified quote and
refused 27 more for want of one.

**Noise, and the artifact says so in its own verdict.** The paired test is 16 pull requests better against 12 worse, and
`outcome` reads `unfalsifiable: the registered gain 0.02 sits under the 0.0314 a second corpus of 264 goldens moves the
figure by`. **`magnitudeMet: true` beside `resolvable: false` is the pair of fields that stops +0.0241 being reported as a
win**, and §76's third verdict is why they exist.

**And the arithmetic that attributes the gain.** A deletion pool of 35 false positives against the without arm's
`TP 44 / FP 157` gives `P = 44/166`, `F1 = 0.2047` - **+0.0155**. The observed +0.0241 is 0.0086 more than the removals can
explain, and that 0.0086 is the four extra true positives, which are the 16-against-12 the paired test already called
noise. **So the removal pool explains two thirds of the movement and the rest is not attributable to anything.**

### 81.3 The cost, stated as the opposite of what §79 predicted

§79.3 predicted −44.9 % of gate characters and §80.3 predicted a tenth of the window. **Both are true of the block and
neither is true of the bill**: this run cost **10.2 % more** than the arm without a gate, because a gate is one extra call
per file - 225 of them - and 600 characters saved per call is 0.6 % of 5 million prompt tokens.

**The comparison the index actually wins is against `v3`, not against no gate**, and it has not been measured: `v3`'s
block was 6 000 characters, so 225 calls would have carried about 300 000 more prompt tokens - **roughly 6 % of this
run's prompt and 1.5 % of its cost.** A device whose saving is 1.5 % of the bill is not a cost device, and **calling the
index one would be the §77 defect - a spend reported by feeling rather than by tag.**

**What the index buys instead is the thing the 600 characters were for**: the reader quoting _"Line 128 shows the existing
`getDirsFromFront` takes a `DrawProjGroupItem*` pointer, not a string"_ for a claim anchored at 129-134 - **a refutation
from outside the claim, from a declaration the extract named.** That is the mechanism working, and it is worth its 10 %.

### 81.4 Why this does not lead to a 146-pull-request run yet

`activity.observed` was 31 removals against the 190 floor, and `reach.ceilingGain` was **0.0135** - below the registered
0.02 even if every removal had been free. **Scaling 31 removals to 146 pulls gives about 151**, which is still under 190.
**A 146-pull-request dispatch of this arm would therefore buy the same `unreachable` verdict for five dollars**, and the
honest reading of this slice is that **the gate is already as clean as it can be and its material is what is scarce - not
its evidence, and not its price.**

**The material is what §79's M1 was for.** `change-shape` refuses a finding that stands on lines the change did not write,
**without a call**, so its removals are free and its volume is bounded by the corpus rather than by the reader's caution.
The next dispatch is that pair, and §79.5's stopping rule applies to it rather than to this one: **more than four true
positives among the dropped findings makes it a recall device that has to be re-registered as one.**

## 82. The reading that indicted the instrument, and the bill split by lane

### 82.1 The run, and the number that decides it

`44249092363` - `pair: change-shape`, 30 pull requests, `skip 0`, competitor replayed, both arms green in 51 minutes,
0.76 and 0.80 USD. The comparison job then went red at `Download the run without it`, asking the matrix for the no-gate
artifact a `change-shape` dispatch never builds: **the arms were paid for and the comparison the dispatch existed for was
the one thing it did not produce.** Both artifacts survived, so no re-run was bought to read them.

|                 | `change_shape: on` | `change_shape: off` | Δ           |
| --------------- | ------------------ | ------------------- | ----------- |
| precision       | 0.2965             | 0.2857              | +0.0108     |
| recall          | 0.1932             | 0.2045              | −0.0113     |
| F1              | **0.2339**         | **0.2384**          | **−0.0045** |
| true positives  | 51                 | 54                  | −3          |
| false positives | 121                | 135                 | −14         |
| shape removals  | 48                 | 0                   | +48         |
| gate calls      | 204                | 227                 | −23         |
| cost (USD)      | 0.7605             | 0.7986              | −0.0381     |

**The ratio is the reading.** For a removal pool at these counts - `TP 54 / FP 135 / FN 210`, so `D = 2TP+FP+FN = 453` -
`F1` rises iff `y > x·(D − TP)/TP = 7.39x`: **the pool had to be 88.1 % false positives to pay for itself.** It was
82.4 % (14 of 17 judged removals). A device that removes at four and a half times the base error rate and needs seven and
a half is a device whose blade is aimed correctly and is not sharp enough, and no amount of re-registering changes that
arithmetic.

**And three of the 48 removals were true positives about deletions, which is a defect in this repository rather than in the
device.** §82.2.

### 82.2 The defect: a substantive hunk that offers nowhere to stand

`classifyPatch` returned `novelLines` - the _added_ lines that are genuinely new - and the gate read that set as "the
lines this change touched". A hunk that only removed added nothing, so the set was empty, so every finding about the
removal was refuted by a patch that had in fact removed it. The artifact's own removal log names them:

> `DrawProjGroupItem.h 35-45` · _Public enum ProjItemType removed from header, breaking API_ ·
> `The finding stands on no line this change touched, so the patch refutes it unread.`

**The diff touched exactly there. It deleted the thing the finding is about.** Seven of the twelve sampled removals are
this shape: `Public API removal: DrawUtil::isCosmeticVertex/isCosmeticEdge/isCenterLine deleted`, `Gui layer now depends on
App-layer enum header`, `Public enum ProjItemType removed from header`.

The repair separates two sets the first commit had conflated, because they answer two questions:

| Set            | Built from                                                        | Question it answers               | Used for                 |
| -------------- | ----------------------------------------------------------------- | --------------------------------- | ------------------------ |
| `novelLines`   | added lines that are neither rewrites nor already on the old side | _what does a reader have to see?_ | the token argument       |
| `allowedLines` | the hunk's new-side span ∪ its deletion points                    | _where may a finding stand?_      | the gate's standing rule |

**A deletion writes nothing and still changes everything**, and `allowedLines` is the only one of the two that says so. It
is now an invariant with a test - over five patches, **every substantive hunk contributes at least one allowed line** -
because "substantive" and "offers nowhere to look" cannot both be true.

### 82.3 The bill, split by lane, and it is not what §79 predicted

| Tag                      | Calls | Prompt tokens | Completion | USD        | USD/call |
| ------------------------ | ----- | ------------- | ---------- | ---------- | -------- |
| `review:testing`         | 458   | 956 948       | 134 210    | 0.1926     | 0.00042  |
| `review:maintainability` | 458   | 940 002       | 125 102    | 0.1817     | 0.00040  |
| `review:architecture`    | 457   | 935 191       | 115 284    | 0.1700     | 0.00037  |
| `review:performance`     | 456   | 952 849       | 58 700     | 0.1018     | 0.00022  |
| `review:security`        | 458   | 1 024 274     | 36 185     | 0.0753     | 0.00016  |
| `review:falsifier`       | 204   | 163 544       | 5 429      | **0.0391** | 0.00019  |

**The gate is 5.1 % of the bill and the five lanes are 94.9 %.** Every lane sees every file - 456 to 458 calls each, within
0.5 % of one another - so the index's 600-character second block was a 5 %-of-5 % optimisation: **§79.3's −44.9 % of gate
characters was arithmetically true and economically irrelevant**, and the honest statement of that is here rather than in a
claim about tokens saved.

**Where the money actually goes is the category the corpus credits least.** `architecture` emitted 42 findings of which 6
are true - precision 0.143 against `bug`'s 0.3495 - for 0.1700 USD, **28 mUSD per true positive**. It is not the largest
line item and it is by far the worst price per true finding.

**So the first real token lever is not a prompt change, it is not buying what cannot survive.** A file whose every hunk
is a re-indent has an empty `allowedLines`, so the gate refutes every finding in it unread: **the five lane calls it takes
are bought for the bin.** `shape.skippedFiles` counts them and the skip is outcome-identical by construction - it is
guarded on `CHANGE_SHAPE && FALSIFY`, because without a gate those findings would survive and the skip would be a recall
trade it is not.

### 82.4 What this section changed in the code

| Piece                                                                                    | Where                                    | Held to                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedLines`, `removedAt`, `span`, `whitespaceOnly`                                    | `change-shape.ts`                        | 8 new tests, including **a deletion-only hunk offers its deletion point** and **every substantive hunk contributes at least one line**                                            |
| `touchedLines` on the request, `droppedBecauseUntouched` + `untouchedFrom` on the report | `falsifier.ts`                           | 13 tests; the two ways of being untouched counted apart, because a pull request that touched a file to no purpose and a reader who wandered are different claims about the corpus |
| `touchedLinesOf`, `AACR_CHANGE_SHAPE` passing `allowedLines`                             | `llm-review-engine.ts`, `aacr-bench.mjs` | the bench's own comment names the defect it is avoiding                                                                                                                           |
| the whitespace skip, `shape.skippedFiles`                                                | `aacr-bench.mjs`                         | guarded on the gate's existence, because the skip is only lossless where the gate runs                                                                                            |
| the `without` arm for this pair                                                          | `aacr-bench.yml`                         | the workflow test now allows one artifact to feed two destinations, and holds the two steps to mutually exclusive conditions                                                      |

### 82.5 The five questions, answered for this iteration

**1. Is the index stronger? What was borrowed, how, and is it quantified?** Stronger in the half a lexer can prove:
`buildSymbolIndex` reads declarations, ranges, export surface, members and the guard lines inside each declaration, and
`cognition.ts` enforces `aoci-code`'s own budget bands rather than inventing a schema. **Quantified** where quantification
is meaningful: 100 % statement and branch coverage on `cognition.ts`, 12 tests on `symbols.ts` including a block comment
holding a declaration, an escaped quote inside a string and inside a template, and an unterminated declaration extending
to end-of-file with `uncertain` set. **Not quantified, and named**: the `F`/`R`/`A`/`S` layer has no reading, because it
has never been built by a model.

**2. Does the review use it? How, and what did it buy?** Two places. The gate reads it as a 600-character second block
(`independent-evidence-v4`), and this iteration made the index's _thin_ form - the diff's own verdict - decide where a
finding may stand. **What it bought is measurable and mixed**: 48 removals at 82.4 % false positives, precision +0.0108,
F1 −0.0045. **A precision device that loses F1 is a precision device**, and calling it anything else would be the §77
defect one more time.

**3. Is precision better, and why or why not?** Precision **is** better, by 0.0108, and the reason is the one the device
claims: findings on lines the change never touched are three times more likely to be false than findings generally
(82.4 % against 71.4 %). F1 is worse because **the rate is not good enough to pay for the true positives it takes with
it** - 4.67 false per true against a break-even of 7.39. Three of those true positives were the deletion defect, so the
corrected rate is between 4.67 and unbounded on the remaining pool, and the next dispatch is what decides it.

**4. Is token use minimal? No, and the reason is now measured rather than guessed.** The gate - the only consumer of the
index - is 5 % of the bill. 95 % is five lanes each reading every file, and their completions (474 910 tokens) cost more
than all prompt tokens that missed cache (546 976). **The three levers, in order of size:** (a) do not call a lane for a
file whose diff is a re-indent - landed, counted, outcome-identical; (b) route a lane by the file's structure, so a file
with no I/O surface is not read by `security` - not built, and it is the only one of the three that trades recall;
(c) shorten a lane's answer, since `testing`'s 134 210 completion tokens are 25 % of the bill on their own.

**5. Are `aoci-code` and `difftastic` exhausted? No, and three specific things remain.** From `difftastic`: the cost model
is still line-level, so `TINY_TREE_THRESHOLD`-style pruning (do not even classify a hunk under ten tokens) and the
**`unchanged` side of the diff** - it models a moved node as a cheap path, and this repository has no representation of
"the same code, elsewhere", which is why a relocation and a rewrite can only be told apart by set membership. From
`aoci-code`: the `R` field (files that must be read together) is the one field that makes a _missing companion change_
expressible at all, and §79.3 named it M2's whole point; and its `Search(doc, keyword, tagFilter)` retrieval over thirty
whole lines is still unbuilt - the index exists and nothing yet queries it by a finding's own vocabulary.

### 82.6 The index had a quadratic input, and the alert arrived one commit late

`CodeQL` opened `js/polynomial-redos` on `symbols.ts:274` - the member patterns - and `redos-assay` reproduced it at
**96× growth for twice the input** on `"public $" + " ".repeat(n)`: `\s*` before the modifier group and `\s+` inside it both
wanted the same spaces, and the engine tried every split.

**A file is library input.** The scanner runs over every changed file of every pull request, so a quadratic matcher there
is a quadratic bench - and it was shipped one commit before the alert. The three patterns are now one linear scan:
skip space, read a word, take it as a modifier only when whitespace follows it. The semantics are preserved exactly,
including the two details that look like accidents and are not - `static(` is a method called `static`, and a property
needs the modifier it was declared with, which is what separates a declaration from an assignment. **The measured input is
a test**: 40 000 spaces must answer in under half a second, and the scan answers in under a millisecond.

**And the second alert was right too.** `let whitespaceOnlyForGate = new Set()` is written and thrown away, because both
branches assign one; it is declared with a type annotation instead, so a branch that forgot to assign is a compile error
rather than an empty set that skips nothing.

**`GHSA-fc5q-39xc-vjpf` (`picomatch`, ReDoS) is exempt at the audit gate, with its condition written down.** The advisory's
`first_patched_version` is null, so `Dependency Audit` failed on every push with nothing to upgrade to - **a gate that
trains its readers to ignore red costs more than the advisory.** The exemption assumes `picomatch` reaches this repository
only through build tooling matching globs written here, never a pattern from a pull request, a user or a remote; the day
that stops being true the dependency goes rather than the exemption extended.

## 83. The corrected instrument says the device was mostly measuring its own bug

### 83.1 The run

`44262493734` - `pair: change-shape` re-dispatched with `allowedLines` (30 pull requests, both arms green, 55 minutes,
0.76 and 0.78 USD). Both artifacts were paid for; the comparison job refused them twice - first for a missing download,
then because `changeShape:true` was a registration key no lookup builds - so the arithmetic was run **locally on the same
two artifacts**: zero further spend, and the script is the script.

|                         | `change_shape: on` | `off`      | Δ           |
| ----------------------- | ------------------ | ---------- | ----------- |
| precision               | 0.2660             | 0.2787     | −0.0127     |
| recall                  | 0.1894             | 0.1932     | −0.0038     |
| F1                      | **0.2212**         | **0.2282** | **−0.0070** |
| true positives          | 50                 | 51         | −1          |
| false positives         | 138                | 132        | +6          |
| shape removals          | **10**             | 0          | +10         |
| of which whole-file     | 2                  | —          |             |
| of which off-the-change | 8                  | —          |             |
| gate candidates         | 430                | 434        | −4          |
| cost (USD)              | 0.7640             | 0.7750     | −0.0110     |

**Removals fell from 48 to 10.** The same corpus, the same arms, the same classifier: the only change is that the standing
set is the hunk's span plus its deletion points instead of its added lines. **Eighty per cent of what the first reading
"removed" was the classifier refuting changes it had itself written off as additions that were not new** - deletions, and
rewrites whose only new line was the guard. The device was, for most of its volume, measuring its own defect.

### 83.2 And on the ten it does remove, it does not pay

One true positive among ten removals is a better rate than the corpus average - but ten removals against `TP 51 / FP 132`
moves F1 by −0.0070, and the paired test is 20 better against 21 worse with `p = 1`. **The device is inert on this
corpus**, and the mechanism is now measurable rather than arguable: of 961 hunks across 30 pull requests, **87 files had
no substantive hunk at all, and only 2 findings stood in one of them**; the other 8 were readers who had wandered, against
430 candidates.

**So §79.5's third way of being wrong has happened, in its exact words**: _"if the character saving is not where the spend
is"_ - and the companion claim has gone the same way. **A finding rarely stands off the change; the reviewer is looking in
the right place.** `code-context.ts` measured 91 of 160 rejections landing on the golden's exact line, and this iteration
is the strongest evidence yet that the correct reading of that number is _"the reader is looking in the right place and
saying the wrong thing"_ - not _"the reader is looking in the wrong place"_.

**The device is not deleted, and it is not shipped either.** `AACR_CHANGE_SHAPE` defaults to `off`, the only dispatch that
turns it on is this pair, and the registration now records two readings and no gain. **A filter that removes ten findings
and costs a pair is a filter that stays off** - but the classifier itself is kept, because it is the only thing in this
repository that can answer "what did this hunk actually do", and §83.3 is why that question still matters.

### 83.3 What the measurement redirects effort to, with the numbers that force it

The bill, split by tag (§82.3), and the corpus's own credits:

| Lane                     | USD    | Emissions | True | Precision | USD per true positive |
| ------------------------ | ------ | --------- | ---- | --------- | --------------------- |
| `review:architecture`    | 0.1700 | 42        | 6    | **0.143** | **0.0283**            |
| `review:testing`         | 0.1926 | —         | —    | —         | —                     |
| `review:maintainability` | 0.1817 | 16        | 4    | 0.250     | 0.0454                |
| `review:security`        | 0.0753 | 6         | 3    | 0.500     | 0.0251                |
| gate                     | 0.0391 | —         | —    | —         | —                     |

**Architecture is the worst price in the table and the second-largest line item**, and it is the one lane whose subject is
not visible in the hunk: layering, coupling and dependency direction are facts about _the file in the repository_, not
about three added lines. **It is also the one lane the index has never been shown to.** Every use of the index so far feeds
the _judge_; not one feeds the _author_.

**So the next experiment is the index in the lane's prompt rather than in the gate's**, registered before its run: a lane
given `exports:`, the declaration the claim stands in and the guards inside it should make fewer claims about symbols that
are not there. It is also the cheapest hypothesis left - 600 characters on a prompt whose median is already two thousand
tokens, against a lane that costs 0.17 USD to say six true things.

### 83.4 The skip, and an honest zero

`shape.whitespaceOnly` read **0** of 30 pull requests and `shape.skippedFiles` read **0**: not one file in this corpus had
a diff consisting entirely of re-indentation. The 87 non-substantive files were comment edits and relocations, and both are
reviewable, which is why the skip was defined on `whitespaceOnly` rather than on `noneSubstantive` in the first place.

**A cost device that finds no material is a zero, and a zero reported as a saving is the §77 defect.** The skip stays,
guarded on the gate's existence, and it is not counted as an improvement until a corpus carries a pure reformat.

## 84. The index could read one language, and the corpus writes five

### 84.1 The count that reframes every earlier reading of the index

The artifact of 2026-11-11 (`m-off`, 36 pull requests, 311 findings) names the path of every finding. Read by
extension, those paths are:

| extension | findings | true | share |
| --------- | -------- | ---- | ----- |
| `.go`     | 91       | 8    | 29.3% |
| `.c`      | 50       | 17   | 16.1% |
| `.py`     | 38       | 15   | 12.2% |
| `.ts`     | 32       | 12   | 10.3% |
| `.js`     | 22       | 6    | 7.1%  |
| `.json`   | 12       | 0    | 3.9%  |
| `.h`      | 11       | 4    | 3.5%  |
| `.php`    | 10       | 0    | 3.2%  |
| `.xml`    | 10       | 2    | 3.2%  |
| `.cpp`    | 8        | 2    | 2.6%  |
| `.tsx`    | 6        | 0    | 1.9%  |
| `.cs`     | 4        | 2    | 1.3%  |

`buildSymbolIndex` recognised `function`, `class`, `interface`, `const` - **TypeScript's spellings** - so `func Claim(`
was not a declaration, `int claim(int x) {` was not a declaration, and `def claim(self, id):` was not a declaration.
**81 % of the corpus's findings stood in a file whose declarations the index could not name**, and
`selectIndexedContext` answered each of them with `renderClaim`'s fallback: three raw lines around the claim.

**That is the correct reading of §79's and §81's small numbers, and it is not a defence of them.** A device that is
idle on four files in five cannot be priced on the fifth: `independent-evidence-v4`'s second block carried a real
declaration for **20.8 %** of findings and a three-line window for the rest, so the figure §81 published describes a
sixth of the corpus and a different instrument on the other five sixths.

### 84.2 What was built: five scanners over one shared lexer

| Piece                         | What it reads                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lexemes.ts`                  | words, the identifier a `(` or a `;` is about, an indentation width, Go's export rule - **once, so five scanners cannot disagree about what an identifier is**                  |
| `symbols-langs.ts` · `go`     | `func Name(`, `func (r *T) Name(`, `type S struct`, `type I interface`, `type A = …`, `const`/`var`, struct fields, interface methods, **generic receiver and type parameters** |
| `symbols-langs.ts` · `python` | `def`, `async def`, `class` at any indent, decorators, indentation-delimited ranges, methods as members, `__init__` as the class's constructor, module constants                |
| `symbols-langs.ts` · `c`      | function **definitions** (both brace styles) and not prototypes, `struct`/`union`/`enum`/`class`, members at depth one, `static` as the file keeping a name                     |
| `symbols-langs.ts` · `csharp` | types at depth one **because a namespace puts them there**, `public` as the export rule, methods and fields at depth two                                                        |
| `symbols-langs.ts` · `php`    | `class`/`interface`/`trait`, `function` at depth zero, methods and `$fields` as members, `__construct` named after its class                                                    |

**Three decisions are worth their own line, because each was a defect first.**

1. **The argument list is the first paren an identifier touches**, not the last one: `Get(id string) (*Entry, error)` has
   a second paren for its results, and `void (*handler)(int);` has its first paren after a space. Reading the last one
   declared an interface method called `string` and a struct field called `handler`.
2. **A body may open on the next line.** `class Worker` then `{` is how PHP, C# and half the corpus's C are written; a
   rule of "the brace must be on this line" gave every one of those declarations a range of one line and a member list of
   nothing.
3. **A line's own punctuation decides what it is.** `static const int MAX = 5;` declares `MAX` and the word before its
   `;` is `5`, so `=` is tried before `;`; a Go `onDone func(error)` is a field while `Get(id string)` is a method, and
   the two are told apart by the character after the name.

**And the failure direction is unchanged.** A Go struct whose closing brace is missing runs to the end of the file, the
index is marked `uncertain`, and the next top-level `func` is **not** read as one of its methods - a declaration keyword
in a struct body is the guard. The same rule as `symbols.ts`: extend, never truncate; a symbol that ends early hides the
guard that would have refuted a claim.

### 84.3 The reading, taken offline and costing nothing

Every finding of the artifact was joined to its file at the pull request's head commit (**247 of 250 files fetched, 36
pull requests**) and asked one question: does `symbolAt` name the declaration this line stands in? The "before" column
is the same function applied to the TypeScript scanner, which is byte-for-byte what the old lexer did to every file.

| language   | findings | true | covered before | covered after | TP before | TP after  |
| ---------- | -------- | ---- | -------------- | ------------- | --------- | --------- |
| go         | 88       | 8    | 3.4%           | **78.4%**     | 0.0%      | 75.0%     |
| c          | 73       | 24   | 2.7%           | **53.4%**     | 4.2%      | 58.3%     |
| python     | 38       | 15   | 2.6%           | **71.1%**     | 0.0%      | 93.3%     |
| typescript | 38       | 12   | 84.2%          | 84.2%         | 83.3%     | 83.3%     |
| unknown    | 35       | 9    | 0.0%           | 0.0%          | 0.0%      | 0.0%      |
| javascript | 22       | 6    | 86.4%          | 86.4%         | 100%      | 100%      |
| php        | 10       | 0    | 70.0%          | 80.0%         | —         | —         |
| csharp     | 4        | 2    | 0.0%           | **100%**      | 0.0%      | 100%      |
| **all**    | **308**  | 76   | **20.8%**      | **64.3%**     | **22.4%** | **68.4%** |

**TypeScript and JavaScript are unchanged to the decimal**, which is the check that the dispatcher did not quietly
alter the scanner that every published figure was measured with.

**Where the residue is, named rather than rounded off.** Go's 21.6 % is mostly real: the findings stand on a `package`
line, a blank line, an import string or a doc comment, and `symbolAt` answers those with null on purpose. **C's 46.6 %
is a defect and it has two causes**: `#ifdef`/`#else` sections whose braces do not balance when both branches are read
as text, and C++ constructor initialiser lists (`JNIEnvHandler(JavaVM* vm) : vm(vm)`), which are not function
definitions under any reading this lexer does. **Neither is repaired here, and neither is claimed to be.**

### 84.4 What this iteration changed in the code, and what it deliberately did not

| Piece                                           | Where                            | Held to                                                                                                                              |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `languageOf`, `SourceLanguage`, `language`      | `symbols.ts`                     | 8 extensions mapped and 3 refusals, because **an index that guessed at a `.json` would invent the fact it was asked for**            |
| five scanners + `PreparedFile`                  | `symbols-langs.ts`               | 34 tests: Go groups, generic receivers, Python decorators and nesting, C function pointers and K&R braces, C# namespaces, PHP traits |
| `symbolAt`                                      | `symbols.ts`                     | the one question every consumer asks, answered once instead of three times                                                           |
| next-line bodies, `=`-before-`;`, `__construct` | `symbols.ts`, `symbols-langs.ts` | three defects found by fixtures the corpus actually writes                                                                           |

Coverage after: `symbols-langs.ts` **98.88 % statements / 96.74 % branches**, `lexemes.ts` 98.11 / 96.29,
`symbols.ts` 100 / 99.3 - **no `v8 ignore`, no exclusion, 102 tests in the module's own file.**

**No run was bought for this iteration, and the reason is arithmetic rather than thrift.** The only consumer of the index
today is the gate, which is **5.1 % of the bill** (§82.3), and §83 measured it inert on the corpus it was given. Paying
for a pair now would price the gate again rather than the index. **What this iteration bought is the precondition**: the
registered next experiment - the index in the lane's prompt rather than in the gate's - was registered when the block
would have been three raw lines for four files in five. With this reading, the block is a real declaration for 64.3 % of
findings and **68.4 % of true ones**, which is the first corpus on which that experiment is about the index rather
than about its absence.

### 84.5 Two assays that cost nothing, and the registered experiment that died in the first one

**The first assay asks the question §83.3 was going to buy.** That section registered the index in the lane's prompt on
one mechanism: _"a lane given `exports:`, the declaration the claim stands in and the guards inside it should make
fewer claims about symbols that are not there."_ **The premise is checkable offline** - every identifier-shaped name in
a finding's text, against the file the finding stands in - on the 308 findings that have a file at the corpus's head
commit:

| subset         | n   | tp  | fp  | names ≥1 absent symbol | names ≥2              |
| -------------- | --- | --- | --- | ---------------------- | --------------------- |
| all            | 308 | 76  | 232 | tp 38.2 % · fp 37.1 %  | tp 9.2 % · fp 14.2 %  |
| `architecture` | 77  | 11  | 66  | tp 54.5 % · fp 47.0 %  | tp 18.2 % · fp 12.1 % |
| `test`         | 56  | 3   | 53  | tp 33.3 % · fp 34.0 %  | tp 33.3 % · fp 11.3 % |
| `bug`          | 132 | 44  | 88  | tp 27.3 % · fp 31.8 %  | tp 6.8 % · fp 15.9 %  |

**38.2 % against 37.1 % is no discrimination at all**, and on "two or more absent names" the ordering is the wrong way
round: a refuter built on this would remove 14.2 % of the false findings and 9.2 % of the true ones. **The false
findings are not more likely than the true ones to name a symbol that is not in the file** - they are the same review
with the same vocabulary, and the corpus simply did not annotate the same lines.

**So the lane-index experiment is retired before it was funded**, and the retirement is the assay rather than an
argument. §83.3's prediction named architecture as its target; architecture's own row is 54.5 % against 47.0 %, a 7.5
point gap on eleven true findings. **A device aimed at that is a device aimed at noise.**

**The second assay asks whether _any_ signal the engine already records separates the two.** Every finding carries a
feature vector and a score, and the artifact is enough to bucket it:

| bucket                             | precision                     | tp              | n                 |
| ---------------------------------- | ----------------------------- | --------------- | ----------------- |
| all                                | 0.244                         | 76              | 311               |
| severity `high` / `medium` / `low` | 0.340 / 0.166 / 0.269         | 36 / 25 / 14    | 106 / 151 / 52    |
| `quotesDiff` true / false          | 0.316 / 0.234                 | 12 / 64         | 38 / 273          |
| score ≥ 0.75 / < 0.4               | 0.322 / 0.118                 | 39 / 2          | 121 / 17          |
| `grounded` true / false            | 0.251 / 0.167                 | 72 / 4          | 287 / 24          |
| `hedged` true / false              | 0.208 / 0.251                 | 10 / 66         | 48 / 263          |
| `agreement` 1 / 2 / 4 / 6          | 0.172 / 0.351 / 0.200 / 0.444 | 15 / 20 / 8 / 8 | 87 / 57 / 40 / 18 |

**Every bucket sits between 0.12 and 0.35 against a base of 0.244**, and the best of them - `score ≥ 0.75` - is a 1.3×
lift on a third of the emission. **A filter built on any of these removes true findings at very nearly the rate it
removes false ones.** §48 reached the same conclusion from the other end - a logistic model over every field the engine
records scores **AUC 0.613**, `score` alone **0.541**, `agreement` alone **0.534** - and this table is that fact said in
counts rather than in an AUC. It is the mechanical explanation of a pattern this repository has now recorded four times:
the checklist (§15.3), the adjudicator (§44), the change-shape gate (§83) and the merge threshold all traded 1:1 and
none of them moved F1.

### 84.6 The number that says the next work is recall, and why no filter can reach the target

The corpus's own density, measured from the diff of every pull request in the artifact: **282 goldens over 6 753 added
lines - 4.18 %**. The run emitted 311 findings, which is **4.61 % of the added lines**: the review writes at almost
exactly the density the annotators wrote at, and **three findings in four land on code nobody commented on**. That is
not a claim that the three are wrong; it is the statement that this corpus cannot tell the difference.

The arithmetic uses the artifact's own counts - `TP 50 · FP 174 · FN 232` - which reproduce its published F1 to four
decimals (`100 / 506 = 0.1976`), and asks what each lever can reach. **The artifact also prints `recall 0.1383`, which
is 39 of 282 and does not reproduce that F1; the table uses 50 of 282 because it is the figure the three counts state,
and the discrepancy between them is a defect in the artifact that this section is not the place to repair.**

| what changes                                                 | precision | recall | F1         |
| ------------------------------------------------------------ | --------- | ------ | ---------- |
| today                                                        | 0.2232    | 0.1773 | 0.1976     |
| **every false positive removed, none of the true ones lost** | **1.000** | 0.1773 | **0.3012** |
| recall 0.29 with nothing wrong in the output at all          | 1.000     | 0.2903 | 0.4499     |
| recall 0.41 at a precision of 0.50                           | 0.500     | 0.4091 | 0.4510     |

**A perfect precision device on today's findings reaches F1 0.301 and stops there.** The registered competitor figure of
0.45 needs either recall 29 % with nothing wrong in the output at all, or recall 41 % at a precision of 0.50 - and this
repository's recall is **17.7 %**, which is the number the last four iterations did not move.

**So every device bought in those iterations was a selection device, and selection is capped at 0.301 by the row
above.** The next registration has to be a generation one, and §84.5 is why it cannot be _"show the lane more of the
file"_, which is a selection device wearing a prompt's clothes.

### 84.7 And the file arm's prompt was printing the diff twice

Reading the prompt builders for §84.6's density check turned up a defect that has nothing to do with the index. The file
arm calls `engine.reviewDiff(diff, sectionDiff)` - **the same text as `fileContext` and as `diffContent`** - and
`describeTarget` printed it under the label _"File context"_ while `sharedPrefix` printed it again under _"Diff
content"_. Measured over the six lane prompts:

| diff      | total prompt characters | of which the second copy |
| --------- | ----------------------- | ------------------------ |
| 40 lines  | 59 218                  | 20.8 %                   |
| 190 lines | 151 378                 | **38.6 %**               |

**The share grows with the diff, and the second copy is billed on every call**: `boilerplate-first` puts the variable
half last, outside the cached prefix, so a prompt that carries the change twice pays for the change twice. At §82.4's
0.78 USD a run with 95 % of it in the five lanes, this is the largest token defect in the repository and it is one
condition wide.

**Two things were wrong and only one of them was the tokens.** A block labelled "File context" that contains a diff is a
false statement in the prompt, and a lane told it is reading a file's context while it is reading the change again has
been told something untrue - the same defect class as §78's window that claimed to be a function.

**The guard is `fileContext !== diffContent`, and it is in `describeTarget` rather than at the call site** because the
same `fileContext` is what the gate parses (`numberedAddedLines`) and what the idiom lane reads: deleting the argument
where it is passed would repair a prompt by breaking two devices that are not prompts. Five tests hold it: one copy in
every lane, the window still printed when it is a window, no context block when there is none, the guard holding in all
three prompt orders, and **a duplicate costing exactly zero characters** - which is the whole of the repair.

**What this buys is the answer to the fourth question and nothing else.** F1 is expected to be unchanged, and the
prediction is stated as one: **a pair that measures a prompt with 38.6 % fewer characters must show F1 inside the
instrument's resolution, or the duplicate was doing work nobody has claimed for it.** The bill, by contrast, has no
noise floor: it is arithmetic on characters.

## 85. The index learned the corpus's languages and the gate still removed nothing that costs

### 85.1 The run

`44288524845` - `pair: falsifier-v4`, 30 pull requests, both arms green in 55 minutes, **0.6699 and 0.6772 USD
(4.82 and 4.88 CNY)**. It is the same registration as R-40 and the same corpus; **one input changed** - the lexer now
names a declaration for 64.3 % of findings instead of 20.8 % (§84.3) - so the differential is the first reading of
`independent-evidence-v4` taken on an index that is not blind.

|                        | `falsifier-v4` | `off`      | Δ           |
| ---------------------- | -------------- | ---------- | ----------- |
| precision              | 0.2447         | 0.2565     | −0.0118     |
| recall                 | 0.1742         | 0.1856     | −0.0114     |
| F1                     | **0.2035**     | **0.2154** | **−0.0119** |
| true positives         | 46             | 49         | −3          |
| **false positives**    | **142**        | **142**    | **0**       |
| findings               | 396            | 435        | −39         |
| gate candidates        | 418            | —          |             |
| gate removals          | 22             | 0          | +22         |
| kept: quote missing    | 5              | —          |             |
| kept: self-referential | 24             | —          |             |
| bill (USD)             | 0.6699         | 0.6772     | −0.0073     |

**The false-positive count is identical in both arms.** That is not a coincidence and it is not the device being
conservative: **it is the whole geometry of the instrument.**

### 85.2 A filter placed before the judge is measured on a denominator it cannot move

The `off` arm emitted 435 findings and **191 of them were judged**. The other 244 are neither true nor false in this
score: the protocol forms (finding, golden) pairs, so **a finding that stands where no golden stands is never asked
about and never counted**. `precision` is `TP / (TP + FP)` over the judged set only.

A gate that removes a finding before judging therefore does one of two things and nothing else:

1. it removes a finding from the **unscored tail** - which changes no counter at all, and costs a model call; or
2. it removes a finding that **would have been judged** - which removes a true positive whenever the finding was right,
   and a false positive only when the finding was wrong.

The run's 22 removals split **3 judged, 19 unscored**. And the arithmetic is unforgiving: with `TP 49 · FP 142 · FN 215`,
removing `x = 3` true findings pays only if it also removes `y > x·(TP+FP+FN)/TP = 3 × 8.29 = 24.9` false ones.
**It removed none.** F1 falls to `92 / (92 + 142 + 218) = 0.2035`, which is the published figure to four decimals.

**So R-40 is falsified, and this time the falsification is mechanistic rather than statistical**: the device is not
insufficiently sharp, it is **aimed at the part of the emission that the score does not read**. §83 reached the same
verdict from the removal rate (82.4 % false against a break-even of 88.1 %); this run says why that rate was
unreachable - **the pool the gate can see and the pool the judge scores are different pools**, and the difference is
53 % of everything the lanes write.

**`falsifier-v4` stays off, and so does every other pre-judge gate in the tree** - `quoted-falsifier-v1` through `v3`,
and `change-shape`, which §83 already retired. They are kept as ablation references because a corpus that judged every
finding would price them differently, and **that is the one change to this instrument that would make them measurable
at all.**

### 85.3 What the index's 64.3 % bought, said plainly

**Nothing measurable, and the reason is 85.2 rather than the index.** The gate was the index's only consumer; the gate
cannot move the score; so a better index fed to it produces a sharper removal from a pool that does not count, and three
true findings lost. **The index is now strong enough to be worth a consumer that is not a pre-judge filter**, and the
arithmetic of §84.6 says where that consumer has to sit: on the generation side, where a finding enters the judged set
in the first place.

## 86. Our F1 has never been comparable with anyone's, and the field publishes a key we can be scored on

### 86.1 The two corpora, and why 0.20 beside 0.61 was never a comparison

Every figure in this document is measured on **AACR-Bench**: 200 pull requests, 1,505 expert-confirmed issues, ten
languages, published Apache-2.0 by Alibaba - **the vendor of the tool it ranks first**, which the artifact's own
`comment` field says out loud. Every published AI-review figure in the field is measured on something else. The two
largest public keys are:

| key                                 | pull requests | goldens | languages                  | who publishes                                     |
| ----------------------------------- | ------------- | ------- | -------------------------- | ------------------------------------------------- |
| AACR-Bench                          | 200           | 1,505   | 10                         | Alibaba (vendor of one entrant)                   |
| Martian Code Review Bench (offline) | 50            | 173     | Python, Go, TS, Ruby, Java | Martian (sells no reviewer), MIT, 19 tools ranked |

**So "we are at 0.20 and CodeRabbit is at 0.61" was a sentence about two different answer keys**, and this document has
never contained it because it could not have been true or false. §84.6 asked whether selection was capped and answered
with our own arithmetic; **the question of where we stand in the field had no instrument at all.**

**It has one now.** Martian's key is MIT and public, its judge prompt is public, and its 50 pull requests are public
forks under `ai-code-review-evaluation/`. `benchmarks/martian/` carries the key converted to the row shape this
harness reads, with provenance, and the conversion **reproduces upstream's three published profile counts exactly -
139 strict, 158 core, 173 all** - which is the check that no category was renamed on the way through.

### 86.2 What the field actually scores, before we add a number to it

Three separate published measurements, none of them the same measurement:

| measurement                                | leader                                                                               | ours today      |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | --------------- |
| **offline, Opus 4.5 judge, 173 goldens**   | Qodo Extended **65.8** · cubic 63.6 · Augment 62.2 · CodeRabbit 42.2 · Graphite 14.1 | not measured    |
| **online, developer acted on the comment** | Cubic 65.5 · Greptile 62.3 · Copilot 61.5 · CodeRabbit 61.0 · Qodo 58.4              | not measured    |
| **on AACR-Bench (our history)**            | Alibaba's own tool, 33.9 % precision as published by its authors                     | F1 0.2154 (§85) |

Two facts from the offline table matter more than its ordering. **No tool finds more than 63 % of the key**, which is
the field's recall ceiling and not ours alone. And **the precision/recall split is a product choice**: Graphite is
100 % precise on 7.6 % recall, CodeRabbit the other way round. **A leaderboard ranks a chosen operating point, not a
capability** - which is the same distinction this repository draws between `fullEmission` and the `keep` rule.

### 86.3 Registered before the run: what `dataset: martian` is expected to say, and what would falsify it

**The run**: one arm, 50 pull requests, every switch off, `AACR_PROFILE=advisory` (the `All` cut, 173 goldens), our own
judge. Ceiling **10 CNY**.

**The prediction, written before the dispatch.** Our engine emits **12 to 14 findings per pull request** (§85: 435 over
30). This key carries **3.5 goldens per pull request**. So even a reviewer that found _every_ golden would score a
precision near `3.5 / 13 = 27 %`, and the field's tools sit at 61-80 % - **because they emit four comments where we emit
thirteen.** Therefore:

1. **Recall should be respectable** - no less than **0.20** on the core cut, and plausibly above the field's tools,
   since emitting three times more than everyone else buys recall mechanically.
2. **Precision should be the binding constraint**, below **0.30**, and F1 between **0.18 and 0.30** - **twenty-five to
   forty points under the field**, without our reviewer being twenty-five points worse at finding defects.
3. **The decisive statistic is precision at matched volume**: cut our ranked list to the top **four per pull request**,
   which is what the field's tools post, and re-score. **If precision at four is at least twice precision at thirteen,
   the gap is volume** and the next device is a ranking-and-cap device. **If it is not, the gap is detection quality**
   and no amount of capping will reach the leaderboard.

**The falsifier is stated as one**: a run whose `core` F1 lands above 0.45 - inside fifteen points of the field's
median - **contradicts the mechanism in this section**, and the emission-volume explanation would have to be withdrawn
rather than reinterpreted. **What this run cannot do is re-rank the field**: it is our reviewer on their key with a
different judge, and the artifact says so in its `corpus`, `judge` and `route` fields.
