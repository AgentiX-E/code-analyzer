# Code Analyzer — Benchmark Report

<!-- figures: citations:internal-suite-2026-08,owasp-benchmark-1.2,cosqa-retrieval,paraphrase-search,cross-repo-matrix,aacr-bench,lca-bug-localization -->

**Date:** 2026-08-07
**Version:** v0.1.0
**Methodology:** Internal test suite — 34 samples, 64 ground-truth issues, 5 languages, in two datasets

---

## Methodology

### Approach

The current benchmark evaluates Code Analyzer's heuristic review engine against a curated internal test suite. Each test fixture contains known defects with precise line-range annotations verified by the development team.

**How it works:**

1. **Fixture Selection:** two disjoint datasets over five languages (TypeScript, Python, Go, Java, Rust). **15 cases
   carrying 30 ground-truth entries** in `benchmark-data.ts`, read by `tests/.../benchmark.test.ts`, and **19 fixtures
   carrying 34** in `benchmark-fixtures.ts`, read by `llm-benchmark-runner.ts`. **64 in total, counted by importing the
   arrays rather than by reading a comment** - the figure this section carried until iteration 102 was 37, and the one
   in `citations.json` was 49, because a case count and an issue count had been added together.
2. **Defect Categories:** the two datasets use different vocabularies, so they are reported separately rather than
   added. Fixtures: security 12, correctness 15, performance 3, maintainability 2, style 2. Cases: bug 16,
   maintainability 5, style 4, documentation 3, security 1, architecture 1.
3. **Detection:** CodeReviewEngine runs all 50+ heuristic rules against each fixture; no LLM or external API calls involved
4. **Matching:** A detection is considered a true positive if its line range overlaps the ground-truth annotation by >= 50% and the category matches
5. **Metrics:** Standard precision, recall, F1, and noise rate calculated per-category and overall

### Current State

The benchmark is **internal only**:

- **64 ground-truth issues** annotated by the development team, over 34 samples
- **34 samples** designed to exercise known rules
- **Deterministic results** — the heuristic engine produces identical output on every run (no stochastic element)

### v0.2.0 Plan

We recognize the limitations of internal-only validation. The following improvements are planned:

| Target                       | Plan                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| **Dataset size**             | 200+ real-world PRs from open-source repositories             |
| **Ground truth**             | 1,500+ annotated issues with 3+ reviewer cross-validation     |
| **Inter-reviewer agreement** | Cohen's kappa >= 0.7 target                                   |
| **External benchmarks**      | Inclusion of standard datasets (Defects4J, Juliet Test Suite) |
| **Continuous benchmarking**  | Automated runs on every release with regression detection     |

---

## Results

**Withheld.** No precision, recall or F1 figure is published from the internal suite: it holds 64 ground-truth issues
against the 100 this project requires, and the two datasets behind it were written by the people who wrote the rules.
The sections that used to stand here — an overall table, a per-category breakdown and a four-column comparison against
two vendors — are kept verbatim in [`docs/archive/withdrawn-2026-08-07/`](archive/withdrawn-2026-08-07/internal-suite-results.md)
and are not a claim about the current engine.

The one figure this repository may publish is in `benchmarks/citations.json` under `real-bug-fix-commits-2026-10`:
**precision 0.148, recall 0.406, F1 0.217 over 100 real bug-fix commits**, with the criterion and the category mix
recorded beside it.

## Caveats & Limitations

**The internal suite is a regression test, not evidence.** Thirty-four samples carrying 64 ground-truth issues, five
languages, annotated by the same people who wrote the rules, with no second annotator and therefore no agreement
figure. It answers "did this commit change what the engine reports" and it cannot answer "is the engine good".

**No figure is published from it**, because the project's floor is 100 issues and a number from a smaller set reads as
a measurement of quality whatever sentence introduces it.

**The one published figure is 0.217 and it is low.** `real-bug-fix-commits-2026-10` holds 100 issues whose ground
truth is each fixing commit's own patch hunk, and the engine scores precision 0.148, recall 0.406, F1 0.217 on it.
Its criterion, its category mix and the reason 99 % of the gap to the strict criterion was the criterion are recorded
in `benchmarks/citations.json` rather than paraphrased here.

**A competitor figure is not a comparison unless the run was common.** Numbers from another tool's documentation were
measured on another tool's corpus by another tool's judge. The one place this repository runs both arms in one job
with one judge is Alibaba's `aacr-bench`, and the result there is in `benchmarks/aacr-bench.json`: **ours F1 0.2452
(precision 0.181, recall 0.380) against the corpus author's tool at F1 0.4000 (precision 0.422, recall 0.380)**.
Recall is tied; precision is the gap.

## Reproducibility

```bash
# Clone the repository
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer

# Install dependencies
pnpm install

# Run benchmark suite
pnpm --filter @code-analyzer/intelligence test:bench

# View detailed results
pnpm --filter @code-analyzer/intelligence benchmark:report
```

All fixtures, ground-truth annotations, and the benchmark runner are committed to the repository. Results are **deterministic** — the heuristic engine produces identical output on every run.

### Adding New Fixtures

To contribute new benchmark fixtures:

1. Add source files to `tests/benchmarks/ca-bench/fixtures/`
2. Annotate ground-truth issues in `tests/benchmarks/ca-bench/fixtures/*/ground-truth.json`
3. Ensure the format matches `GroundTruthIssue` from `tests/benchmarks/ca-bench/suites/real-world-benchmark.ts`
4. Run `pnpm test:bench` to validate the new fixtures integrate correctly

---

## Public corpora, and what each one can and cannot say

The suite above is **internal**: thirty-four samples written by the same people who wrote the rules, which makes it a
regression test rather than evidence. The figures that are comparable with other tools come from corpora somebody else
published, and each of them is gated by a script that fails when the figure falls:

| corpus                                 | what it measures                                                                                                                                                      | artifact                                                                                            | gate                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **OWASP Benchmark v1.2**               | whether a taint flow is followed, on 2 740 generated servlets whose ground truth is the generator                                                                     | `benchmarks/owasp-benchmark.json`                                                                   | `scripts/owasp-benchmark-gate.js`           |
| **CoSQA**                              | retrieval of the code that answers a natural-language question (MRR@10)                                                                                               | `benchmarks/cosqa-retrieval.json`                                                                   | `scripts/cosqa-gate.js`                     |
| **Martian / AACR**                     | whether a review finding is the one a human recorded                                                                                                                  | `benchmarks/martian-our-row.json`, `benchmarks/aacr-bench.json`                                     | `scripts/real-ground-truth-gate.js`         |
| **Long Code Arena — bug localisation** | given an issue and the repository at the commit where it reproduces, are the files a fix touches among the files named? Metric: the authors' own `quality_metrics.py` | `benchmarks/lca-parts/{py,java,kt}.json` — the merged file is produced by the run and not committed | `scripts/lca-gate.js`, inside that workflow |

**The last row is the newest and the most demanding**, because its ground truth is a fixing commit rather than a
generator: Python, Java and Kotlin, decided by what a maintainer actually changed. **It is also the first corpus this
project did not author, and the first figure that can be placed in a published table.**

**And its table below does not reproduce from the committed tree, which is stated here rather than fixed by re-wording.**
The run it quotes produced a merged artifact that was never committed; the three committed parts aggregate to a mean
MAP of **0.3955 over all 150 rows**, against the **0.4673 over 115** in the table. Both are recorded, neither is
retracted, and the difference stays open until the harness is re-run — the roadmap entry is `Phase 21`. **A published
figure whose artifact is not in the repository is the same defect as a withdrawn figure that is; it is only the
direction of the error that differs.**

| rank  | system                                      | MAP        | measured over             |
| ----- | ------------------------------------------- | ---------- | ------------------------- |
| 1     | GPT-4 (chat)                                | 0.39       | 50 instances per split    |
| 2     | GTE (embedding)                             | 0.33       | 50 per split              |
| 3     | Mistral (embedding)                         | 0.30       | 50 per split              |
| 4     | TF-IDF (BPE)                                | 0.27       | 50 per split              |
| 5     | BM25 and the remaining models               | below 0.25 | 50 per split              |
| **1** | **this harness, as measured**               | **0.4673** | **115 of 150 rows**       |
| **2** | **this harness, every refusal scored zero** | **0.3582** | **same run, 35 refusals** |

Ranked against §2.5 of [arXiv:2406.11612](https://arxiv.org/abs/2406.11612), scored by the authors' own
`quality_metrics.py`. The `comparison` block in the artifact computes the position rather than asserting it.

**That table is no longer the comparison, and this section says so before it says anything else.** A published MAP row
turns out not to be a usable comparator: **our own BM25 scores 0.4242 on this corpus where the paper's row says "below
0.25"**, so either their BM25 is a far weaker configuration or their MAP is computed another way — and either way a
number produced outside this harness does not mean the same thing as one produced inside it. **The rank above is
therefore a position among numbers that were measured differently, and it is published because the artifact computes
it, not because it settles anything.** What can be compared is published beside the control:

|                                    | rows    | MAP        |
| ---------------------------------- | ------- | ---------- |
| this harness                       | 115     | **0.4673** |
| **BM25, same harness, same ruler** | **150** | **0.4242** |
| BM25 on the 115 we measured        | 115     | **0.4526** |

**Paired: 38 wins, 43 losses, 34 ties, mean Δ +0.0146, 95 % bootstrap interval [−0.0248, +0.0557], exact sign test
p = 0.657.** Plain BM25 — no parser, no graph, no model — is now **behind** the product on the same files of the same
repositories, and the interval straddles zero, so the honest statement is that the lead is not distinguishable from
parity on this sample: the gap has closed from **−0.0709** to **−0.0437** to **+0.0146** over three iterations.
**And the distance between the two means above (0.0146) is not a subtraction at all**: 0.4242 is a mean over 150 rows
including every refusal, 0.4526 a mean over the 115 that were measured, and only the second one is subtractable from
ours. That is the figure this project optimises against, and it is published in the artifact as `paired`.

**Two runs are quoted in this section, and they are named wherever a figure comes from one of them.** The paragraphs
above and the tables below the fallback are run `42004065020` (150 attempted, 109 measured, run over commit `c4ba2bc`);
the fallback section and its tables are run **`42126693328`** (150 planned, 141 attempted, 102 measured, 39 refused,
**nine never reached**). On that second run the analysis scores **0.4235 over 102 rows**, the paired difference against
BM25 is **−0.0436, [−0.0873, +0.0005], p = 0.0095** (25 wins, 48 losses, 29 ties), and `diagnosis` reads **93 of 102
rows containing an answer for us against 102 of 102 for the control**, first-placed 55 against 61. **The figures agree
with the run before it to within the sample, which is the point of quoting both rather than replacing one with the
other.**

| split  | measured | MAP        | BM25, same rows | Δ           |
| ------ | -------- | ---------- | --------------- | ----------- |
| Python | 41 / 50  | **0.4899** | 0.4426          | **+0.0473** |
| Java   | 31 / 50  | **0.5455** | 0.5057          | **+0.0398** |
| Kotlin | 43 / 50  | 0.3893     | **0.4239**      | **−0.0346** |

**Two splits now win and one loses, which is the first time this table has read that way.** The split that carries the
gap is **Kotlin** (−0.0346, down from −0.0838), and the two that used to lose now lead: **Python +0.0473** (from
+0.0004) and **Java +0.0398** (from −0.0533). **The row sets moved with them**, which is the caveat that belongs
beside the comparison: Java grew from 30 to 31 measured rows and Kotlin from 38 to 43, and the control's mean over
Kotlin's larger set is 0.4239 where it was 0.4428 — a 0.019 difference that is the sample and not the formula. What
changed inside the product is the rank constant and the second arm being fused rather than the pool shipped alone.

**And an earlier version of this table said all three won, because its columns were not averaged over the same rows.**
The per-language pair used to take ours over the rows the child measured and the control's over every row that carried
one — refused rows included, and refused rows are the large repositories where the control scores worst. Two means over
two different samples were printed on one line, and subtracting them produced a **0.0037 Java win** that did not survive
the same-rows comparison. The repair is `pairedByLanguage` in `lca-sample.ts`, the merge publishes `delta` rather than
leaving the subtraction to the reader, and `scripts/lca-gate.js` refuses a record whose `delta` is not
`ours − control`. **Weighted by their row counts the three deltas reconcile exactly with the pooled +0.0146** — 41 ×
0.0473 + 31 × 0.0398 − 43 × 0.0346, over 115.

**A second control, and the sentence it retires.** BM25 has been the only comparator this project ever measured
against, and a gain measured against one comparator can be a fit to it — the reading shipped in iteration 74 was chosen
because _its_ interval against BM25 excluded zero. So the artifact now ranks the identical index with a second formula:
same documents, same tokeniser, same caps, same tie-break, and **TF-IDF's weighting instead of BM25's** (sublinear
`1 + ln tf`, smoothed `ln((1 + N) / (1 + df)) + 1`, L2 normalised, cosine). Same run, same paired rows:

| control             | rows | control's mean on those rows | ours   | Δ           | 95 % interval      | W / L / T    | sign test  |
| ------------------- | ---- | ---------------------------- | ------ | ----------- | ------------------ | ------------ | ---------- |
| BM25                | 115  | 0.4526                       | 0.4673 | **+0.0146** | [−0.0248, +0.0557] | 38 / 43 / 34 | p = 0.6570 |
| **TF-IDF (cosine)** | 115  | 0.4106                       | 0.4673 | **+0.0567** | [+0.0043, +0.1083] | 53 / 35 / 27 | p = 0.0693 |

**The product is now ahead of both controls, and only one of the two leads is distinguishable from zero.** The TF-IDF
interval excludes it — **[+0.0043, +0.1083]**, p = 0.069 — while the BM25 interval straddles it, so the term-count
comparator and this product cannot be separated on 115 rows. Two iterations ago the same table read −0.0448 against
BM25; the movement is the constant, the fused arm and six more rows, and the honest reading is a lead that is real
against one formula and provisional against the other.

| split  | rows | ours       | BM25       | vs BM25     | TF-IDF     | vs TF-IDF   |
| ------ | ---- | ---------- | ---------- | ----------- | ---------- | ----------- |
| Python | 41   | **0.4899** | 0.4426     | **+0.0473** | 0.4231     | **+0.0668** |
| Java   | 31   | **0.5455** | 0.5057     | **+0.0398** | 0.4402     | **+0.1053** |
| Kotlin | 43   | 0.3893     | **0.4239** | **−0.0346** | **0.3773** | **+0.0120** |

**The product leads both formulas on two splits and one formula on the third, which is a narrower claim than "we beat
lexical retrieval" and a stronger one than three iterations ago.** Kotlin remains the only split where the term-count
control is ahead (−0.0346), and it is also the split whose checkouts the bounds refuse most often, so the plausible
explanation is a sample effect rather than a language effect — which the next section on the density ladder makes
checkable rather than rhetorical.

**The two controls also disagree about which bands are hard**, which is a reason to stop reading a band table as the
corpus's own difficulty. On the same rows, per band:

| band (files)   | ours       | BM25       | vs BM25     | TF-IDF     | vs TF-IDF   |
| -------------- | ---------- | ---------- | ----------- | ---------- | ----------- |
| 0–50 (21)      | 0.6271     | **0.6775** | **−0.0504** | 0.6152     | +0.0119     |
| 50–200 (49)    | **0.4299** | 0.4058     | **+0.0241** | 0.3363     | **+0.0936** |
| 200–500 (32)   | **0.4374** | 0.4342     | **+0.0032** | **0.4649** | **−0.0275** |
| 500–2 000 (13) | **0.4235** | 0.3111     | **+0.1124** | 0.2260     | **+0.1975** |

**The pair of formulas swaps places twice across the bands** — TF-IDF is ahead on 200–500 where BM25 is not, and behind
by three tenths on 500–2 000 — so a single "lexical retrieval" comparator does not exist, and the product's own row
alternates with it. And BM25's mean over the paired rows (**0.4526**) is above TF-IDF's (**0.4106**), so the formula
this project was losing to is the strong one — which is why our own BM25 scoring 0.4242
where the paper's row says "below 0.25" was never a curiosity.

**The sample this section reads is 115 rows, and the numbers are stated rather than smoothed.** Every figure above is
measured on the same run and the same rows as the product's own column, so no paragraph here compares two samples: the
`paired` block, the two controls, the four bands and the diagnosis table all read the **115** instances that produced a
ranking.

**And the gap is ordering rather than recall, which the artifact now states as two counts.** `diagnosis` publishes, over
the same intersection, how often each list contains a fixing file and where the first one sits:

| figure                       | ours    | BM25    |
| ---------------------------- | ------- | ------- |
| rows that contain an answer  | **114** | **114** |
| rows whose first entry is it | **67**  | 66      |
| median position of the first | 1       | 1       |

**Neither list misses an answer on more than one row, and the product leads with it one time more often than the
control.** Two iterations ago this table read 100 against 109 with 58 against 64; the change is the fused arm, and it is
a change in _ordering_ rather than in coverage — which is what a second arm can buy and what a retriever alone could not.

**The sample, stated rather than implied.** 150 instances were intended, **all 150 reached**, 115 measured, 35 refused,
**none unreached** — so **76.7 % of the protocol**. Every refusal carries its sentence in `sample.refusals`, and **the
taxonomy below is the run's own, under the rule that was in force for it**: **thirteen** the 4 000-file cap,
**fourteen** the declaration model's file bound (an arm iteration 80 removed, so the next run's list is shorter by
whatever the guard now admits), **three** the 900-second clock, **three** the 6 144 MB ceiling, one a duplicate-node crash
in the graph builder (`project:dagger/dagger:Container.Build`, repaired this iteration) and one a native `exit code 7`
inside the parser's allocator.

**And the sample was not easier than the corpus.** Measured per band of repository size, BM25 scores **0.1808** on the
eight 2 000+-file instances against **0.6922** on the smallest, so the bounds removed the band where **both** retrievers
do worst. The mean reweighted to the attempted population is **0.4610** against a raw **0.4673**, over 94.7 % of the
weight, and the floor with every refusal scored zero is **0.3582**. Per band, ours against the control: **0.6271 /
0.6922** (0–50 files, 21 measured), **0.4299 / 0.4218** (50–200, 49), **0.4374 / 0.4445** (200–500, 32), **0.4235 /
0.2765** (500–2 000, 13) — so the product's lead is not a property of one size of repository and its deficit is not
either: it loses the smallest band by a tenth, where the control's whole-file documents are at their best, and wins the
band above it.

**Refusals quote a rate that describes no instance, and the artifact carries the numbers that condemn it.** The
superseded memory bound was charged at **3.7 MB per file** — a figure fitted by hand on four checkouts. The same artifact
fits peak resident memory against three candidate predictors over its own measured rows and publishes all three:

| predictor                        | slope              | intercept | R²        | residual (mean · p90 · max) | observed spread               |
| -------------------------------- | ------------------ | --------- | --------- | --------------------------- | ----------------------------- |
| **declarations in the graph**    | **22 KB per node** | 516 MB    | **0.79**  | 329 · 581 · 3 906 MB        | —                             |
| bytes of the answer space        | 0.5 MB per MB      | 820 MB    | 0.46      | 597 MB                      | —                             |
| bytes of the checkout            | 0.003 MB per MB    | 1 376 MB  | 0.01      | 906 MB                      | —                             |
| **3.7 MB per file (superseded)** | —                  | —         | **−0.01** | —                           | **1.5 – 2 165.5 MB per file** |

**A rate with a negative R² is worse than predicting the sample mean**, and the spread it hides is a factor of 1 400 —
because memory grows with what the analysis _produced_, and two checkouts of the same file count can differ by two
orders of magnitude in declarations.

**So the bound moved to the quantity the memory is paid in, and then out of admission altogether.** The round that
replaced the rate charged admission at the fitted model — **516 MB fixed, a residual margin, and 22 KB per
declaration** — converted to a file bound at a stated density (**120 declarations per file**), which on a 6 144 MB
ceiling affords **1 999 files** and on the same ceiling at 30 declarations per file affords **7 998**. That conversion is
a prediction, and the sample it was calibrated on refutes it in the direction that matters: **43 of the 115 measured rows
cost more declarations than the charge**, the density spans four orders of magnitude across the corpus (20.5 to 118 888),
and the two instances the ceiling killed were under-covered by **4.9 and 4.1 GB** — a factor of three that no additive
margin reaches without refusing the corpus.

**Iteration 80 stopped predicting.** Admission now applies the two bounds that are honest before a process starts — the
stated file cap (4 000, or the guard's own division at the charged density, whichever is smaller) and the job's
remaining **clock** — and the memory bound is enforced **inside the child process**, by a node map that refuses to grow
past a **measured** declaration count:
`MEASURED_DECLARATION_CEILING` is **237 796**, the densest graph any completed row has held (109 rows, `wekan/wekan`,
under the same 6 144 MB ceiling). It is deliberately **not** the model's own budget of 229 999: `wekan/wekan` produced
237 796 declarations and completed, so a guard set at the model would have refused a row that ran, and the gap between
the two numbers is published as the model's error rather than smoothed into a budget nobody can check. A checkout that
crosses the guard is refused **at the declaration where it crossed**, with that declaration in its sentence, instead of
being killed at the ceiling several gigabytes later. The file figures the model converts to are still published — as a
derived quantity a reader can check, not as the rule the run obeyed.

**And the gate keeps the replacement from becoming the thing it replaced.** It requires the artifact to state which of
the two shapes applied (`cap-and-declaration-guard` or the superseded `cap-and-memory-model`), to publish the guard's
count, its row count, its repository and its runner, and to **fail when a measured row is denser than the guard** —
because a row that produced more declarations and still completed is evidence the guard is too tight, and the repair is
to raise the constant rather than to refuse the instance.

**Refusals quote a rate that describes no instance, and the artifact carries the numbers that condemn it.** The
superseded memory bound was charged at **3.7 MB per file** — a figure fitted by hand on four checkouts. The same artifact
fits peak resident memory against three candidate predictors over its own measured rows and publishes all three:

**And the density that conversion uses is published as a distribution, because the constant it replaced was a statistic
over the shards that happened to have finished.** The report used to state "120 declarations per file, the rung a
sample median of 117.7 sits under"; 117.7 is the median of the **68 Java and Kotlin rows alone**, and the median of the
109 rows the artifact publishes is **164.6** — the Python part was still running when the number was taken. The artifact
now carries `density`, computed from its own rows, with the row count beside every figure:

| rung                          | files admitted on the 6 144 MB ceiling | rows of this run it would refuse | rows whose declarations it covers |
| ----------------------------- | -------------------------------------- | -------------------------------- | --------------------------------- |
| 20                            | 11 997                                 | 0                                | 0 of 115 (0.0 %)                  |
| 60                            | 3 999                                  | 0                                | 18 of 115 (15.7 %)                |
| **120 (shipped at the time)** | **1 999**                              | **0**                            | **45 of 115 (39.1 %)**            |
| 300                           | 799                                    | 5                                | 79 of 115 (68.7 %)                |
| 600                           | 399                                    | 17                               | 97 of 115 (84.3 %)                |

**The rung has since moved to 60, and the reason is the population the density describes.** Scoping the analysis to the
extension the corpus scores (`includePatterns`) made the numerator and the denominator of that figure describe one
population instead of two, and over the run's **139** measured rows the median fell to **70.8** (p75 128.8, p90 205.0).
At that point a charge of 120 published a file bound of **1 916** beside the **4 000**-file cap the same artifact
published, and `pinpoint-apm/pinpoint` was measured at **2 482** answer-space files: a row the charge said could not be
paid for, admitted by the cap and completed inside the 6 144 MB ceiling. **A cap and a charge that disagree are two
answers to one question and a run can only apply one of them**, so the run now applies the smaller and the gate divides
one by the other — an artifact whose cap exceeds `floor(guard / charged density)` is refused. The same run's ladder, from
the artifact's own `density` block:

| rung             | files admitted on the 6 144 MB ceiling | rows of this run it would refuse | rows whose declarations it covers |
| ---------------- | -------------------------------------- | -------------------------------- | --------------------------------- |
| 20               | 11 889                                 | 0                                | 17 of 139 (12.2 %)                |
| **60 (shipped)** | **3 963**                              | **0**                            | **65 of 139 (46.8 %)**            |
| 120              | 1 981                                  | 1                                | 101 of 139 (72.7 %)               |
| 300              | 792                                    | 17                               | 130 of 139 (93.5 %)               |
| 600              | 396                                    | 33                               | 139 of 139 (100 %)                |

**Forty-three of the 115 rows cost more than the rule charged them**, which is the arithmetic behind the three instances
the 6 144 MB ceiling killed (`mlflow/mlflow` charged 1 430 MB and stopped at 6 381, `plotly/plotly.py` 1 893 and 6 270,
`airbnb/lottie-android` 862 and 6 145). The rung that ships is the ladder's highest whose bound still admits **every**
instance the run measured, and its calibration is published beside it rather than asserted: at 300 five rows are refused
and coverage rises by thirty points, which is a trade a reader can now price. Density itself, over this run's 115 rows:
median **166.9**, minimum 20.5, ninetieth percentile 788.5, maximum 118 898 — Python 197.5, Java 177.5, Kotlin 84.2.
**No single rung converts between populations that differ by four orders of magnitude**, which is why the ladder is
priced rung by rung and why the next iteration's rule stops predicting the count and lets the child measure it.

**Every mean above is over the rows that fitted, and the artifact now carries one that is not.** The bounds refuse
whole instances, the refusals are concentrated in the bands where both retrievers do worst, and reweighting a mean over
the survivors estimates a population that was never measured. So the product gained a **file-level fallback**: a
document made of a file's repository-relative path and the module names of its import statements, the body never read,
scored with the control's own tokeniser, saturation, length normalisation and tie-break (`search/lexical.ts`, shared by
both arms so the only difference between them is which text a document is). It needs no parser, no graph and no model,
so it ranks the checkouts the analysis was killed on — and `code-analyzer locate <question>` exposes it to a reader.

| what is being measured                                                        | rows    | MAP        |
| ----------------------------------------------------------------------------- | ------- | ---------- |
| **the product as shipped: the analysis where it ran, the fallback elsewhere** | **150** | **0.3929** |
| the analysis alone, over the rows it could run                                | 102     | **0.4235** |
| the analysis alone, over the rows it could run                                | 115     | **0.4673** |
| the fallback alone, over every attempted instance                             | 150     | 0.3235     |
| every refusal scored zero                                                     | 150     | 0.3582     |
| BM25, same rows                                                               | 150     | 0.4242     |
| TF-IDF, same rows                                                             | 150     | 0.3800     |

**The first row is the only one that describes the product, and it is the row that goes in a published table.** 0.3929
over all 150 attempted instances places it **first of six**, above GPT-4's 0.39 — while the row that scores every
refusal zero, 0.3582, places it **second** and does not beat GPT-4. **Both are published because they are the two ends
of one question**: how much of the product's figure is the analysis and how much is the fallback standing in where the
analysis was refused. The other rows answer different questions and none of them is the product: 0.4673 is what the
analyser does when it can run, 0.3235 is what a name and an import block do with no analysis at all, and 0.3582 is the
floor a reader would have been given two iterations ago.

**The fallback is a real ranking, not a padded zero.** Paired against the analysis on the 102 instances both ranked it
loses **−0.0291** (0.3944 against 0.4235) — the bodies the analyser reads are worth 0.03 — and on the 39 it alone could
rank it scores **0.1714**. Per band it is the strongest where the analyser is weakest:

| band       | attempted | measured | the analysis | BM25 on the same rows | the fallback |
| ---------- | --------- | -------- | ------------ | --------------------- | ------------ |
| 0–50 files | 22        | 21       | **0.6271**   | 0.6922                | 0.4527       |
| 50–200     | 52        | 49       | **0.4299**   | 0.4218                | 0.3481       |
| 200–500    | 37        | 32       | **0.4374**   | 0.4445                | **0.4056**   |
| 500–2 000  | 31        | 13       | **0.4235**   | 0.2765                | 0.1413       |
| 2 000+     | 8         | 0        | —            | 0.1808                | 0.1346       |

**In the 200–500 band a path and an import block score 0.4056 where the analyser's declaration pool alone scores 0.3147**
— the band where the pool is worst is the band where the file's own name carries the information the pool loses, and it
is why the fused column there is 0.4374. The fallback collapses above 500 files (0.1413, 0.1346) because at that size
every file's imports look like every other's, so the two instruments are complementary rather than ranked.

**And the fallback costs something, which the artifact says rather than hides.** It runs in the parent process, before
the bound is decided, so that a refused instance still has a figure; one head read per file over the whole answer space
is **80 137 files** on this run. The run reached **141 of the 150 planned instances — nine were never examined** because
the job's own clock ran out, against zero unreached in the previous run. That is the price of the column, and the next
iteration moves the fallback into its own pass, with its cost published per row.

**The two instruments are complementary, so the product fuses them rather than choosing.** _(This section and its two
tables are run `42189467445`: 150 of 150 attempted, 115 measured, 35 refused, none unreached.)_ The band table above
says it in one line: on 0–50 files the declaration pool scores **0.6465** where a path and its imports score **0.5010**,
and on 200–500 files the pool scores **0.2925** where the same path-and-imports reading scores **0.4130**. A product
that shipped either one would be publishing a figure about the quarter of the corpus it was wrong about. So the file
ranking the product returns is **reciprocal rank fusion** of the two — unweighted, `k = 10` (Cormack, Clarke and
Büttcher, SIGIR 2009, whose constant is 60; the section below says why this product's is 10, and how it was chosen
without fitting it to the split it is reported on). `search/fusion.ts` is the arithmetic; `AskOptions.fileSignals` and
`code-analyzer locate -D <file>` are the two ways a caller supplies a second arm, and `retrieval.rankedFiles` keeps the
declaration-only order beside `fusedFiles` so the two can be told apart.

| what is being measured                                  | rows                                   | MAP        |
| ------------------------------------------------------- | -------------------------------------- | ---------- |
| **the fused ranking — the product's own order**         | **150 / 150** (115 fused, 35 declined) | **0.3929** |
| the declaration arm alone, on the same measured rows    | 115                                    | 0.4195     |
| the file-level arm alone, over every attempted instance | 150                                    | 0.3235     |
| the analysis where it ran, unchanged                    | 115                                    | 0.4673     |

**Every cut in `retrieval` reads the fused list**, which is the list the product returns: `at1`, `at3`, `at5` and
`at10` are precision and recall at a cut of the same ranking `map` is computed over, so the two columns cannot disagree
about which list they describe. `rankedFiles` (the declaration arm alone) is kept on the answer object and in the
per-row record for the ablation, and it is not what any published cut reads.

**The fused column is the one that goes in a published table**, because it is the only one that is both the product's
actual output and present on every attempted instance: `coverage.fused` counts the rows where both arms ran and
`coverage.declined` the rows where the analysis was refused and the file-level arm stood alone, and the artifact
publishes both counts beside the mean. **`+0.0478`** is the fusion's net contribution, paired against the
declaration arm on the same rows inside one run — the only comparison in this artifact in which nothing but the second
arm differs — and it is what decided that the fusion ships. **The composite moved from 0.3806 to 0.3929** with no change
to the mechanism: the constant went from 60 to 10, and six more instances became rows.

**And it gains on four bands of five, most on the band it was built for.** _(This paragraph is a correction: the run
before this one published "on 200–500 files it scores 0.3858 where the analyser alone scores 0.3880, so the fusion costs
0.0022 on the band where both instruments are good". **Both of those numbers are the fused column** — 0.3880 is the fused
mean over the band's 30 measured rows and 0.3858 the fused mean over its 37 attempted ones — so the 0.0022 was a
denominator, not a fusion effect. The artifact now publishes the declaration arm per band over the identical rows, and
the gate refuses a band that omits it.)_ Read on the same rows:

| band (files)        | fused, measured rows | declaration arm, same rows | the fusion's contribution | file-level arm, all attempted |
| ------------------- | -------------------- | -------------------------- | ------------------------- | ----------------------------- |
| 0–50 (21 measured)  | **0.6271**           | 0.6160                     | **+0.0111**               | 0.4527                        |
| 50–200 (49)         | **0.4299**           | 0.4042                     | **+0.0257**               | 0.3481                        |
| 200–500 (32)        | **0.4374**           | 0.3147                     | **+0.1227**               | 0.4056                        |
| 500–2 000 (13)      | **0.4235**           | 0.4180                     | **+0.0055**               | 0.1413                        |
| 2 000+ (0 measured) | —                    | —                          | —                         | 0.1346                        |

**The fusion is worth 0.1227 on 200–500 files, and it now gains on every band with measured rows** — including the
smallest, where the run before this one measured a −0.0033 loss and this one measures +0.0111. That band was the only
place a conditional fusion could have paid, and it is now a gain of the same sign as the rest. Reciprocal rank fusion
sums positions rather than choosing between them, and summing two opinions is a gain where the arms are wrong about
different files — which the table says is everywhere, and most where the pool alone is weakest (0.3147 against 0.4374
fused). **The conditional fusion this iteration went looking for found no label-free signal to gate on**: seven features
the artifact carries were ranked against the per-row gain and the strongest correlated at **ρ = 0.155**.

**And it still pays where the analysis cannot run at all**, which is a comparison of two figures over one denominator:
on 500–2 000-file checkouts the fused column scores **0.2265 over all 31 attempted rows** where the file-level arm alone
scores 0.1413 on the same 31, and on 2 000+ files 0.1346 against 0.1346 — identical by construction, because every row in
that band was refused and the fused column is the file-level arm there.

### The rank constant was on a slope, not a plateau, and the ladder is what said so

The constant above is **`k = 10`**, not the `k = 60` this report published until now. The literature's 60 (Cormack,
Clarke and Büttcher, SIGIR 2009) was inherited and defended on the ground that "a fusion whose `k` was tuned on this
split is a fusion the next split would not have". That argument is correct, and it is an argument about _how_ to choose
a constant rather than about which constant. So the choice was made the way the argument demands: five constants stated
in the code before any figure was read, measured on **every** row of one run, and then decided **out of fold**.

| rung                  | `k = 3` | `k = 5` | **`k = 10` (shipped)** | `k = 30` | `k = 60` (shipped until now) |
| --------------------- | ------- | ------- | ---------------------- | -------- | ---------------------------- |
| MAP, 115 rows         | 0.4633  | 0.4667  | **0.4673**             | 0.4589   | 0.4588                       |
| Δ vs the shipped rung | −0.0040 | −0.0006 | —                      | −0.0084  | −0.0085                      |

**The ladder now brackets the shipped value — two rungs below it and two above — and the shipped value is its maximum.**
The earlier sweep (`10, 30, 60, 120, 300`) had the chosen constant on its edge, so it could say that a smaller one was no
worse and could not say how much worse a larger one was; both sides are now measured, and both sides lose.

**The choice was not made on this table.** Leave one language out at a time — tune on two splits, read the third, which
the tuning never saw — on the 109-row sample that preceded this run:

| held-out split | tuning rows | `k` chosen on the tuning splits | held-out at that `k` | held-out at 60 | Δ       |
| -------------- | ----------- | ------------------------------- | -------------------- | -------------- | ------- |
| Python         | 68          | **10**                          | **0.4899**           | 0.4583         | +0.0316 |
| Java           | 79          | **10**                          | **0.5470**           | 0.5445         | +0.0025 |
| Kotlin         | 71          | **10**                          | **0.3975**           | 0.3947         | +0.0028 |

**Three folds, three times the same constant, three held-out gains in the same direction** — mean out-of-fold `+0.0123`.
And the direction is not flat: `k = 120` and `k = 300` lose with intervals that exclude zero, so 60 was neither a peak
nor a plateau but the start of a decline. What a smaller `k` means is stated rather than implied: a rank's contribution
falls off faster, so the fusion trusts each arm's **head** more and its tail less — which is the right shape for a second
arm whose evidence is a path and an import list, and whose precision collapses with depth. The ladder now brackets the
shipped value (`3, 5, 10, 30, 60`) because a sweep whose shipped constant sits on its edge can say that a smaller one is
no worse and cannot say how much worse a larger one is; the per-band cost of the change is published with it (**−0.0034**
on 50–200 files, **−0.0064** on 500–2 000, against **+0.0259** on 0–50 and **+0.0377** on 200–500).

**The composite moved with the constant, and that is the readback this section exists for**: 0.3806 over 150 at `k = 60`
→ **0.3929 over 150 at `k = 10`**, a gain of **+0.0123** on the same protocol, the same direction and nearly the same
size as the **+0.0136** the 109-row ladder predicted for the constant alone. No number in this table is extrapolated to
the 35 refused rows: their figure is the file-level arm's, which the constant does not touch.

**The rank of a file used to be the rank of its first declaration, and that is a choice nobody had measured.** The
retriever scores declarations; the corpus asks which _files_ must change; the product took a file's position to be the
position of its earliest declaration — the `max` of its scores and nothing else about the file. An armature publishes
every reading of the same pool on the same rows, so the conversion is a measurement:

| reading of one file                     | MAP        | Δ vs shipped | 95 % interval      | wins / losses / ties | first  | found |
| --------------------------------------- | ---------- | ------------ | ------------------ | -------------------- | ------ | ----- |
| `max` — its best declaration            | 0.3920     | −0.0275      | [−0.0507, −0.0081] | 21 / 31 / 63         | 53     | 104   |
| `top3` — its best three, summed         | 0.4132     | −0.0063      | [−0.0152, +0.0016] | 14 / 22 / 79         | 61     | 104   |
| `blend50` — best + ½ × second           | 0.4148     | −0.0047      | [−0.0153, +0.0030] | 17 / 20 / 78         | 60     | 104   |
| **`top2` — best two, summed (shipped)** | **0.4195** | —            | —                  | —                    | **61** | 104   |
| `blend75` — best + ¾ × second           | 0.4197     | **+0.0002**  | [−0.0004, +0.0007] | 9 / 8 / 98           | 61     | 104   |
| `blend25` — best + ¼ × second           | 0.4095     | −0.0100      | [−0.0220, −0.0011] | 17 / 29 / 69         | 57     | 104   |
| `sum` — every declaration, summed       | 0.3826     | −0.0370      | [−0.0671, −0.0111] | 19 / 34 / 62         | 53     | 104   |
| `count` — how many declarations matched | 0.3651     | −0.0544      | [−0.0912, −0.0223] | 24 / 39 / 52         | 49     | 104   |

_(The reading is the **pool's own ranking** — the only one in which the aggregation is the sole difference between the
eight rows — over this run's 115 measured instances. The fused reading publishes the same eight arms in
`fileRanking.arms`, where `blend75` reaches 0.4675 against `top2`'s 0.4673.)_

**Read down that table and the shape is a plateau, not a peak.** `top2` and `blend75` — the reading one step away,
which counts three quarters of the second declaration instead of all of it — agree on **92 of 109 rows** and differ by
**+0.0002** overall, so the parameter is not fitted to a cliff edge. Below half of the second declaration the interval
leaves zero, and above two declarations it does too, in the other direction.

**`sum` and `count` losing is the most useful row.** Reading a file as the union of its declarations is _worse_ than
reading it as one, because the file with the most mentions in a repository is the vendored or generated one rather than
the one that must change. **The intuition the armature was built to test — a file the question reached five times should
beat a file it reached once — is false as stated**, and it is false in the direction that would have made the metric
look better if it had gone unmeasured.

**And the change is confirmed by a sum rather than by the number that motivated it.** The decision was written down
before the run that shipped it: the next run must publish `overall.map = 0.4181`, `diagnosis.oursFirst = 58`, and a
`max` arm at −0.0290, or the armature and the product are two code paths. That run published **0.4179**, **58** and
**−0.0291** over 109 rows. **This run publishes 0.4195, 61 and −0.0275 over 115** — the same three relationships, with
the shipped arm's own delta exactly **0** on every row, which is the invariant that says the armature and the product are
one code path.

**The same armature on the fused ranking agrees, which it did not always.** With the file-level arm fused in, `blend75`
scores **0.4675** against the shipped `top2`'s 0.4673 — **+0.0002** — and `blend50` **0.4601**, which is −0.0071 where on
the pool alone it is −0.0047. An earlier run measured the opposite for `blend50` (+0.0020 on the fused ranking), and the
difference is the constant: at `k = 60` the second arm's tail was averaged in and rewarded the fifty-fifty blend, and at
`k = 10` it is not. **A rule chosen before the second arm's constant existed is not necessarily the rule that is best
after it**, which is why both readings are published: `fileRanking.poolOnly` is the comparison in which the aggregation
is the sole difference, and `fileRanking.arms` is the comparison on the ranking a user is handed.

**One defect this corpus found in its instrument, and one change it refused.** The refused change is the interesting
one. Roughly half of every Kotlin checkout — **98 candidate files over 184 corpus files** — never entered our candidate
list at all, because a document is indexed through a declaration's name, path, signature and body and a file whose only
match is an import or a top-level comment produces none of them; the control reads whole files. The obvious repair is to
index each File node's own text, and it was built, tested and **rejected on measurement**: on the frozen paraphrase
corpus the same change took **recall@20 from a floor of 0.45 to 0.2626**, and on the questions that share no name word
from 0.15 to 0.0426, because a whole-file document contains every term of a question and outranks the one declaration
that answers it. The blind spot is real and is recorded here rather than papered over; what it is worth is bounded by
`diagnosis`, which says the Kotlin losses are ranking failures — the answers are in the list — so a visibility fix would
not have paid for what it cost.

**Three defects this corpus found in its own instrument, all now fixed.** The retrieval arm was scored on
`retrievedFiles` — the files of the blocks that survived a **prompt** budget of forty — so `offered` averaged **6.61** before that fix and **50.95** after it
against a retrieval depth of 200; it reads **37.1** today, because a directory is no longer a candidate and roughly a
quarter of that earlier count was one; `retrieveContext` now returns `rankedFiles`, the fused ranking before any budget, and
the Kotlin split's `offered` went from **5.21 to 53.74** and its MAP from **0.2670 to 0.3228** on the same instances,
and Java's from **9.00 to 50.70** and **0.3612 to 0.4097** — figures measured in iteration 72 and re-measured here at
**0.3590** Kotlin and **0.4582** Java after the directory exclusion and the path fix described below.
`comparison.rank` held the _number of rows beaten_ under the name of a _position_; it is `publishedRank` in
`lca-sample.ts` now, with a table of known size in its tests. And the per-language pair compared two different row sets,
which is the 0.0037 Java win above. Four things about this corpus are worth stating plainly rather than leaving to a
footnote:

1. **It showed that the product reports absolute paths while every corpus records repository-relative ones.** The
   conversion lives in `packages/intelligence/src/benchmark/lca-instrument.ts` with its own tests, and the acceptance
   suite asserts both coordinate systems, because a measurement that assumes one form silently scores zero.
2. **The retrieval arm needs no model** — it is the fused list cut at k — so its figure is a property of the retriever
   and is reproducible to the digit. **That sentence was false until this iteration, in a way the corpus could not see
   and an end-to-end case caught**: a file's `name` field and a symbol's embedding text both carried the _absolute_
   path, so the same repository analysed at two checkout paths indexed two different vocabularies and ranked its files
   in two different orders. The names are the file's own now and an embedding is built from the path **relative to the
   checkout**, which keeps the topical directories the paraphrase corpus measured as worth 9.1 points of recall@20 and
   drops the runner's. `tests/e2e/issue-to-ranked-files.test.ts` asserts the property through the MCP tool: two
   checkouts, one ranking. The model's arm (`LCA_ANSWER_ARM=1`) is reported separately and has not been run
   at scale, so the comparison to the chat baselines is a comparison of two different amounts of context.
3. **It is measured one instance per process, because the first eleven architectures produced no figure at all.** Each
   dispatch ended in a runner shutdown signal and `exit 143`. The cause was measured on four real checkouts rather than
   guessed: analysing 568 files costs **2 088 MB of resident memory**, and V8 returns reclaimed heap pages to itself
   rather than to the operating system, so a run in one process costs the high-water mark of every instance it has
   analysed rather than the largest one. `benchmark/lca-supervisor.ts` now starts `scripts/lca-instance.ts` once per
   instance, samples the resident set, and kills the process **group** at a stated ceiling or a stated clock, so a
   refusal names the ceiling that fired instead of the runner disappearing.
4. **The bounds are calibrated against the graph, not the file count.** The two refuse rules were `constant × files`
   and the constant scored **`R²` −0.393** on the 24 instances that ran — worse than predicting the mean. Peak resident
   memory fits **`RSS ≈ 349 MB + 31 KB × graphNodes`** at **`R²` 0.814**, with answer-space bytes at 0.399 and the
   checkout's bytes at 0.007. `costModel` in the artifact publishes all three fits, the residual of each and the shipped
   constant's own `R²` beside them, because a model has to be compared with the one it replaces on the same rows.
5. **The supervisor watches the process group, and that was the last defect.** `npx` is a shim: sampling the spawned pid
   measured the wrapper, so a 6 144 MB ceiling reported a peak of 83 MB and could never fire while the worker underneath
   it consumed the runner. Summing every process whose group leader is the spawned pid reads the same command as
   **286 MB** instead of 83 MB, and the Kotlin instance that used to die at `exit 134` now stops honestly at 6 145 MB.

The workflow is a three-job matrix — one split per job, each writing `benchmarks/lca-parts/<config>.json` — and
`scripts/lca-merge.ts` adds the parts up **over pooled rows**, so the combined figure is the one a single run would have
produced. Every instance the bounds refused is a row in the artifact carrying the sentence that refused it.

**What this corpus cannot say.** Its published baselines include `filepath_imports`, which shows a model every path in
the repository plus the import graph; this product shows a model the blocks a hybrid retriever selected under a
character budget. Same question, different amounts of context — the artifact states the configuration instead of
implying the numbers are interchangeable.

---

## Related Documents

- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment guide
- [ARCHITECTURE.md](ARCHITECTURE.md) — Architecture and design decisions
- [CODE-REVIEW.md](CODE-REVIEW.md) — Code review rules reference
