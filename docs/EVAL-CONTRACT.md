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

`benchmarks/aacr/competitor-baseline.json` is transcribed from `benchmarks/aacr-bench.json` and **replayed through the
harness's own scoring functions**, asserting **50 true positives and 102 false positives** - the two figures the artifact
published. A lost row, a shifted index, or a `keep` flag turned into a string moves one of them. **The fingerprint is
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
