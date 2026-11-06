# Code Analyzer — Benchmark Report

**Date:** 2026-08-07
**Version:** v0.1.0
**Methodology:** Internal test suite — 20 fixtures, 37 ground-truth issues, 5 languages

---

## Methodology

### Approach

The current benchmark evaluates Code Analyzer's heuristic review engine against a curated internal test suite. Each test fixture contains known defects with precise line-range annotations verified by the development team.

**How it works:**

1. **Fixture Selection:** 20 test files across 5 programming languages (TypeScript, Python, Go, Java, Rust) containing 37 known defects
2. **Defect Categories:** Security (12), Correctness/Bug (16), Performance (4), Maintainability (3), Style (2)
3. **Detection:** CodeReviewEngine runs all 50+ heuristic rules against each fixture; no LLM or external API calls involved
4. **Matching:** A detection is considered a true positive if its line range overlaps the ground-truth annotation by >= 50% and the category matches
5. **Metrics:** Standard precision, recall, F1, and noise rate calculated per-category and overall

### Current State

The benchmark is **internal only**:

- **37 ground-truth issues** annotated by the development team
- **20 test fixtures** designed to exercise known rules
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

## Results (Internal Test Suite)

### Overall

| Metric         |            Code Analyzer v0.1.0             |
| -------------- | :-----------------------------------------: |
| **Precision**  |                    79.4%                    |
| **Recall**     |                    73.0%                    |
| **F1 Score**   |                    0.761                    |
| **Noise Rate** | 0.3x (0.3 false positives per true finding) |
| **Token Cost** |    $0.00 (fully local heuristic engine)     |

### Per-Category Breakdown

| Category        | TP  | FP  | FN  | Precision | Recall |  F1   |
| --------------- | :-: | :-: | :-: | :-------: | :----: | :---: |
| Security        |  8  |  2  |  4  |    80%    |  67%   | 0.727 |
| Correctness     | 11  |  3  |  5  |    79%    |  69%   | 0.733 |
| Performance     |  3  |  1  |  1  |    75%    |  75%   | 0.750 |
| Maintainability |  3  |  0  |  0  |   100%    |  100%  | 1.000 |
| Style           |  2  |  1  |  0  |    67%    |  100%  | 0.800 |

---

## Comparison with Other Tools

Code Analyzer is competitive in specific dimensions on the internal test suite. Results below combine Code Analyzer's scores with competitor data sourced from published documentation and independent studies (aitoollab.cn, May 2026).

| Metric              | Code Analyzer | SonarQube | Semgrep  |  CodeRabbit  |
| ------------------- | :-----------: | :-------: | :------: | :----------: |
| **Precision**       |     79.4%     |    72%    |    —     |     58%      |
| **Recall**          |     73.0%     |    48%    |    —     |     52%      |
| **F1 Score**        |     0.761     |   0.576   |    —     |    0.549     |
| **Noise Rate**      |     0.3x      |   0.8x    |    —     |     2.1x     |
| **Cost per Review** |      $0       | API cost  | Free OSS |   API cost   |
| **Languages**       |      20       |    30+    |   30+    |  All (LLM)   |
| **Security Rules**  |      12       |   200+    |   100+   | Prompt-based |

> **Note on Semgrep:** Semgrep's strength is pattern-based static analysis, not general-purpose code review. It reports zero false positives on known patterns but does not surface the same class of issues as heuristic or LLM-based reviewers. A direct precision/recall comparison is not meaningful without a controlled experiment on identical datasets.

---

## Caveats & Limitations

### Internal vs External Validation

The current results reflect performance on a **curated internal test suite**, not on real-world PR datasets. This has several implications:

1. **Selection bias:** Fixtures were designed to test rules that are known to work well. Rules with known false-positive problems may not be equally represented.
2. **No inter-reviewer validation:** Ground truth was annotated by the development team without independent cross-validation, which can inflate recall metrics.
3. **Small sample size:** 37 issues across 5 languages is insufficient for statistical significance on per-language or per-category breakdowns.
4. **Different datasets, different scores:** Competitor numbers come from different datasets and studies. Direct comparison on a common benchmark is needed for meaningful conclusions.

### What These Numbers Mean

| If you see...     | It means...                                               |
| ----------------- | --------------------------------------------------------- |
| Precision = 79.4% | ~8 out of 10 comments Code Analyzer posts are real issues |
| Recall = 73.0%    | It finds ~3 out of every 4 known issues in the test suite |
| Noise Rate = 0.3x | For every 3 true issues found, expect ~1 false positive   |

### Areas for Improvement

- **Security recall (67%):** Some CWE categories (authentication bypass, race conditions) require deeper semantic analysis not yet implemented
- **Style false positives:** One of the style fixtures produces a false positive due to an overly broad regex pattern
- **Correctness recall (69%):** Multi-file logical errors that span >2 files are not yet detectable

---

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

The suite above is **internal**: twenty fixtures written by the same people who wrote the rules, which makes it a
regression test rather than evidence. The figures that are comparable with other tools come from corpora somebody else
published, and each of them is gated by a script that fails when the figure falls:

| corpus                                 | what it measures                                                                                                                                                      | artifact                                                        | gate                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| **OWASP Benchmark v1.2**               | whether a taint flow is followed, on 2 740 generated servlets whose ground truth is the generator                                                                     | `benchmarks/owasp-benchmark.json`                               | `scripts/owasp-benchmark-gate.js`   |
| **CoSQA**                              | retrieval of the code that answers a natural-language question (MRR@10)                                                                                               | `benchmarks/cosqa-retrieval.json`                               | `scripts/cosqa-gate.js`             |
| **Martian / AACR**                     | whether a review finding is the one a human recorded                                                                                                                  | `benchmarks/martian-our-row.json`, `benchmarks/aacr-bench.json` | `scripts/real-ground-truth-gate.js` |
| **Long Code Arena — bug localisation** | given an issue and the repository at the commit where it reproduces, are the files a fix touches among the files named? Metric: the authors' own `quality_metrics.py` | `benchmarks/lca-bug-localization.json`                          | `scripts/lca-gate.js`               |

**The last row is the newest and the most demanding**, because its ground truth is a fixing commit rather than a
generator: Python, Java and Kotlin, decided by what a maintainer actually changed. **It is also the first corpus this
project did not author, and the first figure that can be placed in a published table.**

| rank  | system                                      | MAP        | measured over             |
| ----- | ------------------------------------------- | ---------- | ------------------------- |
| 1     | GPT-4 (chat)                                | 0.39       | 50 instances per split    |
| 2     | GTE (embedding)                             | 0.33       | 50 per split              |
| 3     | Mistral (embedding)                         | 0.30       | 50 per split              |
| 4     | TF-IDF (BPE)                                | 0.27       | 50 per split              |
| 5     | BM25 and the remaining models               | below 0.25 | 50 per split              |
| **1** | **this harness, as measured**               | **0.4179** | **109 of 150 rows**       |
| **3** | **this harness, every refusal scored zero** | **0.3037** | **same run, 41 refusals** |

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
| this harness                       | 109     | **0.4179** |
| **BM25, same harness, same ruler** | **150** | **0.4242** |
| BM25 on the 109 we measured        | 109     | **0.4616** |

**Paired: 27 wins, 53 losses, 29 ties, mean Δ −0.0437, 95 % bootstrap interval [−0.0853, +0.0003], exact sign test
p = 0.0049.** Plain BM25 — no parser, no graph, no model — beats the product on the same files of the same repositories,
**and the distance between the two means above (0.0437) is a coincidence of the sample: 0.4242 is a mean over 150 rows
including every refusal, 0.4616 is a mean over the 109 that were measured, and only the second one is subtractable from
ours.** That is the figure this project now optimises against, and it is published in the artifact as `paired`. The
interval's upper bound touching zero is the honest state of it: **the gap has closed from −0.0709 to −0.0437 in one
iteration and a 109-row sample can no longer rule out parity.**

**Two runs are quoted in this section, and they are named wherever a figure comes from one of them.** The paragraphs
above and the tables below the fallback are run `42004065020` (150 attempted, 109 measured, run over commit `c4ba2bc`);
the fallback section and its tables are run **`42126693328`** (150 planned, 141 attempted, 102 measured, 39 refused,
**nine never reached**). On that second run the analysis scores **0.4235 over 102 rows**, the paired difference against
BM25 is **−0.0436, [−0.0873, +0.0005], p = 0.0095** (25 wins, 48 losses, 29 ties), and `diagnosis` reads **93 of 102
rows containing an answer for us against 102 of 102 for the control**, first-placed 55 against 61. **The figures agree
with the run before it to within the sample, which is the point of quoting both rather than replacing one with the
other.**

| split  | measured | MAP    | BM25, same rows | Δ           |
| ------ | -------- | ------ | --------------- | ----------- |
| Python | 41 / 50  | 0.4430 | 0.4426          | **+0.0004** |
| Java   | 30 / 50  | 0.4582 | **0.5115**      | **−0.0533** |
| Kotlin | 38 / 50  | 0.3590 | **0.4428**      | **−0.0838** |

**Two splits lose and one is level, and the earlier version of this table said all three won because its columns were
not averaged over the same rows.** The per-language pair used to take ours over the rows the child measured and the
control's over every row that carried one — refused rows included, and refused rows are the large repositories where the
control scores worst. Two means over two different samples were printed on one line, and subtracting them produced a
**0.0037 Java win** that does not survive the same-rows comparison: on the 30 instances both lists were computed on,
Java is a **0.0533 loss**. The repair is `pairedByLanguage` in `lca-sample.ts`, the merge publishes `delta` rather than
leaving the subtraction to the reader, and `scripts/lca-gate.js` refuses a record whose `delta` is not
`ours − control`. Weighted by their row counts the three deltas reconcile exactly with the pooled −0.0437.

**Python is now level with the control, and that is a result rather than a rounding.** 0.4430 against 0.4426 over the
same 41 instances — four ten-thousandths, which is not a claim of superiority and is a claim that the Python split no
longer loses. **Kotlin carries the gap** (−0.0838) and Java most of the rest (−0.0533), and the two are different
problems: Kotlin is the split whose checkouts the caps refuse most often, Java the split where the control's advantage
is largest on the rows both could read.

**A second control, and the sentence it retires.** BM25 has been the only comparator this project ever measured
against, and a gain measured against one comparator can be a fit to it — the reading shipped in iteration 74 was chosen
because _its_ interval against BM25 excluded zero. So the artifact now ranks the identical index with a second formula:
same documents, same tokeniser, same caps, same tie-break, and **TF-IDF's weighting instead of BM25's** (sublinear
`1 + ln tf`, smoothed `ln((1 + N) / (1 + df)) + 1`, L2 normalised, cosine). Same run, same paired rows:

| control             | rows | control's mean on those rows | ours   | Δ           | 95 % interval      | W / L / T    | sign test  |
| ------------------- | ---- | ---------------------------- | ------ | ----------- | ------------------ | ------------ | ---------- |
| BM25                | 105  | 0.4697                       | 0.4248 | **−0.0448** | [−0.0895, −0.0001] | 26 / 50 / 29 | p = 0.0079 |
| **TF-IDF (cosine)** | 105  | 0.4274                       | 0.4248 | **−0.0025** | [−0.0597, +0.0503] | 37 / 45 / 23 | p = 0.4397 |

**BM25 beats this product and TF-IDF does not.** The second interval contains zero, its sign test is p = 0.44, and the
per-split table says it with more resolution — ours against each control on the rows both scored:

| split  | rows | ours       | BM25       | vs BM25     | TF-IDF     | vs TF-IDF   |
| ------ | ---- | ---------- | ---------- | ----------- | ---------- | ----------- |
| Python | 37   | **0.4654** | 0.4635     | **+0.0019** | 0.4480     | **+0.0174** |
| Java   | 30   | 0.4582     | **0.5115** | **−0.0533** | 0.4511     | **+0.0071** |
| Kotlin | 38   | 0.3590     | **0.4428** | **−0.0838** | **0.3885** | **−0.0295** |

**So the claim is narrower than every earlier version of this section made it, and the narrowing is the finding.**
_Plain lexical retrieval beats this product_ is not what two controls say. **One BM25 configuration beats it by 0.045 and
a second lexical formula is level with it**, with the product ahead on two of the three splits. The gap is a property of
the formula rather than of the family, which is why the next iterations target the formula's mechanism — the file as a
document with a length prior — instead of "lexical retrieval" as a whole.

**The two controls also disagree about which bands are hard**, which is a reason to stop reading a band table as the
corpus's own difficulty: on 200–500 files TF-IDF scores **0.4716** where BM25 scores **0.4445**, and on 500–2 000 it
scores **0.1588** where BM25 scores **0.2765**. And BM25's mean over the paired rows (**0.4697**) is well above TF-IDF's
(**0.4274**), so the formula this project has been losing to is the strong one — which is why our own BM25 scoring 0.4242
where the paper's row says "below 0.25" was never a curiosity.

**This run measured 105 rows rather than the 109 quoted above, and the difference is stated rather than smoothed.**
**Six instances were refused because the job's fifty-minute budget ran out**, four of them Python — the split where this
product is strongest. The raw mean therefore reads 0.4248 against 0.4179 with no product change between the commits,
while the paired BM25 delta moved from −0.0437 to −0.0448. **Only the paired column is comparable across samples**, and
that is the third iteration in a row whose headline number moved for a reason that was not the product.

**And the gap is ordering rather than recall, which the artifact now states as two counts.** `diagnosis` publishes, over
the same intersection, how often each list contains a fixing file and where the first one sits:

| figure                       | ours    | BM25    |
| ---------------------------- | ------- | ------- |
| rows that contain an answer  | **100** | **109** |
| rows whose first entry is it | **58**  | **64**  |
| median position of the first | 1       | 1       |

**Nine instances where our list does not contain the answer at all, against none for the control.** The other
**0.0437** is the order of a list that already holds the answer: on the 100 rows we did find, the control leads with it
**64** times and we lead **58**. A retriever that has the answer at position 31 is not a retriever that could not see
the file, and the difference decides what to repair — **and six of the nine misses are the Kotlin split's** (two are
Python's, one Java's), where a file whose only match is an import or a comment produces no declaration to index.

**The sample, stated rather than implied.** 150 instances were intended, **all 150 reached**, 109 measured, 41 refused,
**none unreached** — so **72.7 % of the protocol**, the first run in which the harness saw every instance it asked for.
Every refusal carries its sentence in `sample.refusals`: **twenty-seven** the 2 000-file cap, **seven** the
`3.7 MB per file` estimate, two the 900-second clock, two the 6 144 MB ceiling, one the job's own time budget, one a
`SIGABRT`, one a duplicate-node crash in the graph builder (`project:dagger/dagger:Container.Build`).

**And the sample was not easier than the corpus.** Measured per band of repository size, BM25 scores **0.1808** on the
eight 2 000+-file instances against **0.6922** on the smallest, so the bounds removed the band where **both** retrievers
do worst. The mean reweighted to the attempted population is **0.4182** against a raw **0.4179**, over 94.7 % of the
weight, and the floor with every refusal scored zero is **0.3037**. Per band, ours against the control: **0.6160 /
0.6922** (0–50 files, 21 measured), **0.4042 / 0.4218** (50–200, 49), **0.2912 / 0.4445** (200–500, 30), **0.4529 /
0.2765** (500–2 000, nine rows) — so the loss is not a property of one size of repository, and the band where we lead is
the one the control finds hardest.

**Seven of those refusals quoted a rate that describes no instance, and the artifact carried the numbers that condemn
it.** The memory bound was charged at **3.7 MB per file** — a figure fitted by hand on four checkouts. The same run
fits peak resident memory against three candidate predictors over its own 109 measured rows and publishes all three:

| predictor                      | slope              | intercept | R²        | mean residual | observed spread               |
| ------------------------------ | ------------------ | --------- | --------- | ------------- | ----------------------------- |
| **declarations in the graph**  | **22 KB per node** | 511 MB    | **0.77**  | 325 MB        | —                             |
| bytes of the answer space      | 0.5 MB per MB      | 820 MB    | 0.46      | 597 MB        | —                             |
| bytes of the checkout          | 0.003 MB per MB    | 1 376 MB  | 0.01      | 906 MB        | —                             |
| **3.7 MB per file (in force)** | —                  | —         | **−0.01** | —             | **1.5 – 2 165.5 MB per file** |

**A rate with a negative R² is worse than predicting the sample mean**, and the spread it hides is a factor of 1 400 —
because memory grows with what the analysis _produced_, and two checkouts of the same file count can differ by two
orders of magnitude in declarations. So admission is now charged at the fitted model: **511 MB fixed, 325 MB of margin
for the model's own error, and 22 KB per declaration**, converted to a file bound at a stated density
(**120 declarations per file**, the rung of a published ladder the sample's median of 117.7 sits under). The same 6 144 MB
ceiling now affords **1 999 files** at that density and **7 998** at 30, so the cap rises from 2 000 to 4 000 and the two
bounds swap roles: the cap states what will be attempted, the model refuses what will not fit, and every refusal quotes
the density and the arithmetic behind it. The gate refuses an artifact whose rule is charged per file, whose units are
unstated, whose ladder is not monotone, whose published bound is not its own division, or whose recommended fit does not
beat the rate it replaced — **the last of which the previous artifact would have failed**.

**Every mean above is over the rows that fitted, and the artifact now carries one that is not.** The bounds refuse
whole instances, the refusals are concentrated in the bands where both retrievers do worst, and reweighting a mean over
the survivors estimates a population that was never measured. So the product gained a **file-level fallback**: a
document made of a file's repository-relative path and the module names of its import statements, the body never read,
scored with the control's own tokeniser, saturation, length normalisation and tie-break (`search/lexical.ts`, shared by
both arms so the only difference between them is which text a document is). It needs no parser, no graph and no model,
so it ranks the checkouts the analysis was killed on — and `code-analyzer locate <question>` exposes it to a reader.

| what is being measured                                                        | rows    | MAP        |
| ----------------------------------------------------------------------------- | ------- | ---------- |
| **the product as shipped: the analysis where it ran, the fallback elsewhere** | **141** | **0.3538** |
| the analysis alone, over the rows it could run                                | 102     | **0.4235** |
| the fallback alone, over every attempted instance                             | 141     | 0.3327     |
| every refusal scored zero                                                     | 141     | 0.3064     |
| BM25, same rows                                                               | 141     | 0.4232     |
| TF-IDF, same rows                                                             | 141     | 0.3771     |

**The first row is the only one that describes the product, and it is the row that goes in a published table.** It is
0.12 below the figure the artifact used to quote, and it moves this product from first of six to **second, level with
the embedding baselines and behind GPT-4's 0.39** — which is what an honest comparison with a table measured over fifty
instances per split looks like when our own sample stops being the part of the corpus that fitted. The other three rows
are published beside it because each of them answers a different question and none of them is the product: 0.4235 is
what the analyser does when it can run, 0.3327 is what a name and an import block do with no analysis at all, and
0.3064 is the floor a reader would have been given before this iteration.

**The fallback is a real ranking, not a padded zero.** Paired against the analysis on the 102 instances both ranked it
loses **−0.0291** (0.3944 against 0.4235) — the bodies the analyser reads are worth 0.03 — and on the 39 it alone could
rank it scores **0.1714**. Per band it is the strongest where the analyser is weakest:

| band       | attempted | measured | the analysis | BM25 on the same rows | the fallback |
| ---------- | --------- | -------- | ------------ | --------------------- | ------------ |
| 0–50 files | 18        | 18       | **0.6465**   | 0.7068                | 0.5010       |
| 50–200     | 50        | 47       | **0.4106**   | 0.4057                | 0.3601       |
| 200–500    | 35        | 28       | 0.2925       | **0.4414**            | **0.4130**   |
| 500–2 000  | 30        | 9        | **0.4529**   | 0.3892                | 0.1451       |
| 2 000+     | 8         | 0        | —            | —                     | 0.1346       |

**In the 200–500 band a path and an import block score 0.4130 where the whole analyser scores 0.2925**, which is the
largest single figure in this section and the next iteration's target: it says the declaration-level pool loses
information the file's own name carries, exactly where the pool is worst. The fallback collapses above 500 files
(0.1451, 0.1346) because at that size every file's imports look like every other's, so the two instruments are
complementary rather than ranked.

**And the fallback costs something, which the artifact says rather than hides.** It runs in the parent process, before
the bound is decided, so that a refused instance still has a figure; one head read per file over the whole answer space
is **80 137 files** on this run. The run reached **141 of the 150 planned instances — nine were never examined** because
the job's own clock ran out, against zero unreached in the previous run. That is the price of the column, and the next
iteration moves the fallback into its own pass, with its cost published per row.

**The two instruments are complementary, so the product fuses them rather than choosing.** _(This section and its two
tables are run `42166473302`: 150 of 150 attempted, 109 measured, 41 refused, none unreached. The composite row in the
table above is the same quantity from the run before it — 0.3538 over 141 — and it has moved to **0.3806 over 150**
because the analysis column inside it is now fused rather than the pool alone.)_ The band table above
says it in one line: on 0–50 files the declaration pool scores **0.6465** where a path and its imports score **0.5010**,
and on 200–500 files the pool scores **0.2925** where the same path-and-imports reading scores **0.4130**. A product
that shipped either one would be publishing a figure about the quarter of the corpus it was wrong about. So the file
ranking the product returns is **reciprocal rank fusion** of the two — unweighted, `k = 10` (Cormack, Clarke and
Büttcher, SIGIR 2009, whose constant is 60; the section below says why this product's is 10, and how it was chosen
without fitting it to the split it is reported on). `search/fusion.ts` is the arithmetic; `AskOptions.fileSignals` and
`code-analyzer locate -D <file>` are the two ways a caller supplies a second arm, and `retrieval.rankedFiles` keeps the
declaration-only order beside `fusedFiles` so the two can be told apart. **The table below is the `k = 60` run**; the
ladder that moved the constant is measured inside it.

| what is being measured                                  | rows                                   | MAP        |
| ------------------------------------------------------- | -------------------------------------- | ---------- |
| **the fused ranking — the product's own order**         | **150 / 150** (109 fused, 41 declined) | **0.3806** |
| the declaration arm alone, on the same measured rows    | 109                                    | 0.4179     |
| the file-level arm alone, over every attempted instance | 150                                    | 0.3235     |
| the analysis where it ran, unchanged                    | 109                                    | 0.4598     |

**Every cut in `retrieval` reads the fused list**, which is the list the product returns: `at1`, `at3`, `at5` and
`at10` are precision and recall at a cut of the same ranking `map` is computed over, so the two columns cannot disagree
about which list they describe. `rankedFiles` (the declaration arm alone) is kept on the answer object and in the
per-row record for the ablation, and it is not what any published cut reads.

**The fused column is the one that goes in a published table**, because it is the only one that is both the product's
actual output and present on every attempted instance: `coverage.fused` counts the rows where both arms ran and
`coverage.declined` the rows where the analysis was refused and the file-level arm stood alone, and the artifact
publishes both counts beside the mean. **`+0.0419`** is the fusion's net contribution, paired against the
declaration arm on the same rows inside one run — the only comparison in this artifact in which nothing but the second
arm differs — and it is what decided that the fusion ships.

**And it gains where the analysis cannot run, not where it can.** On 500–2 000-file checkouts the fused column scores
**0.2181** where the file-level arm alone scores 0.1413; on 200–500 files it scores **0.3858** where the analyser alone
scores 0.3880, so the fusion costs 0.0022 on the one band where both instruments are individually good. Reciprocal rank
fusion sums positions rather than choosing between them, and summing two opinions is a gain only where the arms are
wrong about different files. The band table in the artifact is what says so, per band, on paired rows.

### The rank constant was on a slope, not a plateau, and the ladder is what said so

The constant above is **`k = 10`**, not the `k = 60` this report published until now. The literature's 60 (Cormack,
Clarke and Büttcher, SIGIR 2009) was inherited and defended on the ground that "a fusion whose `k` was tuned on this
split is a fusion the next split would not have". That argument is correct, and it is an argument about _how_ to choose
a constant rather than about which constant. So the choice was made the way the argument demands: five constants stated
in the code before any figure was read, measured on **every** row of one run, and then decided **out of fold**.

| rung                  | `k = 10`           | `k = 30`           | `k = 60` (shipped until now) | `k = 120`          | `k = 300`          |
| --------------------- | ------------------ | ------------------ | ---------------------------- | ------------------ | ------------------ |
| MAP, 109 rows         | **0.4734**         | 0.4599             | 0.4598                       | 0.4494             | 0.4482             |
| Δ vs 60               | **+0.0136**        | +0.0001            | —                            | −0.0104            | −0.0117            |
| 95 % interval         | [−0.0007, +0.0320] | [−0.0027, +0.0027] | —                            | [−0.0228, −0.0019] | [−0.0272, −0.0013] |
| rows up / down / flat | 30 / 24 / 55       | 22 / 17 / 70       | —                            | 8 / 24 / 77        | 13 / 24 / 72       |

**The full-sample interval straddles zero, which is why the full sample is not what decided it.** Leave one language out at
a time — tune on two splits, read the third, which the tuning never saw:

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

**The 150-row composite above is the `k = 60` figure** — 0.3806 — because that is the run this section reads. The same
run's ladder measures the fused column at **0.4734 over the 109 measured rows** at `k = 10`, and the next artifact
republishes the composite with the new constant and the new ladder around it. No number in this table is extrapolated to
the 41 refused rows: their figure is the file-level arm's, which the constant does not touch.

**The rank of a file used to be the rank of its first declaration, and that is a choice nobody had measured.** The
retriever scores declarations; the corpus asks which _files_ must change; the product took a file's position to be the
position of its earliest declaration — the `max` of its scores and nothing else about the file. An armature publishes
every reading of the same pool on the same rows, so the conversion is a measurement:

| reading of one file                     | MAP        | Δ vs shipped | 95 % interval      | wins / losses / ties | first  | found |
| --------------------------------------- | ---------- | ------------ | ------------------ | -------------------- | ------ | ----- |
| `max` — its best declaration (before)   | 0.3888     | −0.0291      | [−0.0537, −0.0075] | 20 / 31 / 58         | 50     | 100   |
| `top3` — its best three, summed         | 0.4112     | −0.0067      | [−0.0163, +0.0018] | 14 / 22 / 73         | 58     | 100   |
| `blend50` — best + ½ × second           | 0.4130     | −0.0049      | [−0.0161, +0.0033] | 16 / 20 / 73         | 57     | 100   |
| **`top2` — best two, summed (shipped)** | **0.4179** | —            | —                  | —                    | **58** | 100   |
| `blend75` — best + ¾ × second           | 0.4181     | **+0.0002**  | [−0.0004, +0.0008] | 9 / 8 / 92           | 58     | 100   |
| `blend25` — best + ¼ × second           | 0.4073     | −0.0106      | [−0.0235, −0.0008] | 16 / 29 / 64         | 54     | 100   |
| `sum` — every declaration, summed       | 0.3824     | −0.0355      | [−0.0667, −0.0099] | 18 / 33 / 58         | 51     | 100   |
| `count` — how many declarations matched | 0.3686     | −0.0493      | [−0.0843, −0.0178] | 23 / 37 / 49         | 48     | 100   |

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
`max` arm at −0.0290, or the armature and the product are two code paths. It published **0.4179**, **58** and
**−0.0291** over 109 rows, with the shipped arm's own delta **0** on every one of them — the 0.0002 is the extra row the
run reached, and both statistics that identify the _ranking_ are unmoved.

**The same armature on the fused ranking reverses one of those rows, which is why it is published twice.** With the
file-level arm fused in, `blend50` scores **0.4619** against the shipped `top2`'s 0.4598 — **+0.0020**, where on the pool
alone it was −0.0049 — and `blend75`, the neighbour that agreed with `top2` on 92 of 109 rows, is now −0.0006. A rule
chosen before the second arm existed is not necessarily the rule that is best after it, and a single-column armature
could not have said so: `fileRanking.poolOnly` is the comparison in which the aggregation is the sole difference, and
`fileRanking.arms` is the comparison on the ranking a user is handed.

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
