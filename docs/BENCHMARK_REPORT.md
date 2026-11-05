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

| rank  | system                        | MAP        | measured over          |
| ----- | ----------------------------- | ---------- | ---------------------- |
| 1     | GPT-4 (chat)                  | 0.39       | 50 instances per split |
| 2     | GTE (embedding)               | 0.33       | 50 per split           |
| 3     | Mistral (embedding)           | 0.30       | 50 per split           |
| 4     | TF-IDF (BPE)                  | 0.27       | 50 per split           |
| 5     | BM25 and the remaining models | below 0.25 | 50 per split           |
| **2** | **this harness**              | **0.3951** | **102 of 150 rows**    |

Ranked against §2.5 of [arXiv:2406.11612](https://arxiv.org/abs/2406.11612), scored by the authors' own
`quality_metrics.py`. The `comparison` block in the artifact computes the position rather than asserting it.

**That table is no longer the comparison, and this section says so before it says anything else.** A published MAP row
turns out not to be a usable comparator: **our own BM25 scores 0.4271 on this corpus where the paper's row says "below
0.25"**, so either their BM25 is a far weaker configuration or their MAP is computed another way — and either way a
number produced outside this harness does not mean the same thing as one produced inside it. What can be compared is
published beside the control:

|                                    | rows    | MAP        |
| ---------------------------------- | ------- | ---------- |
| this harness                       | 102     | **0.3951** |
| **BM25, same harness, same ruler** | **141** | **0.4232** |
| BM25 on the 102 we measured        | 102     | 0.4672     |

**Paired: 23 wins, 56 losses, 23 ties, mean Δ −0.0721, 95 % bootstrap interval [−0.1221, −0.0220], exact sign test
p = 0.0003.** Plain BM25 — no parser, no graph, no model — beats the product on the same files of the same repositories.
That is the figure this project now optimises against, and it is published in the artifact as `paired`.

| split  | measured | MAP        | BM25       |
| ------ | -------- | ---------- | ---------- |
| Python | 34 / 50  | **0.4629** | 0.4571     |
| Java   | 30 / 50  | **0.4097** | 0.4060     |
| Kotlin | 38 / 50  | **0.3228** | **0.4127** |

**The gap is one language.** The product beats the control on Python by 0.0058 and on Java by 0.0037, and loses to it on
Kotlin by **0.0899**. A single combined figure averages a narrow win and a large loss into a moderate loss, which is why
the split is published beside it. **Kotlin is the next iteration's target, and the reason is now a number rather than an
impression.**

**The sample, stated rather than implied.** 150 instances were intended, 141 reached, 102 measured, 39 refused, 9 never
reached — so **68.0 % of the protocol**. Every refusal carries its sentence in `sample.refusals`: fifteen the 2 000-file
cap, nine the `3.7 MB per file` estimate, two the 900-second clock, two the 6 144 MB ceiling, one a `SIGABRT`.

**And the sample was not easier than the corpus.** Measured per band of repository size, BM25 scores **0.1808** on the
eight 2 000+-file instances against **0.6897** on the smallest, so the bounds removed the band where **both** retrievers
do worst. The mean reweighted to the attempted population is **0.4046** against a raw **0.3951**, over 94.4 % of the
weight, and the floor with every refusal scored zero is **0.2858**.

**Two defects this corpus found in its own instrument, both now fixed.** The retrieval arm was scored on
`retrievedFiles` — the files of the blocks that survived a **prompt** budget of forty — so `offered` averaged **6.61** before that fix and **50.95** after it
against a retrieval depth of 200; `retrieveContext` now returns `rankedFiles`, the fused ranking before any budget, and
the Kotlin split's `offered` went from **5.21 to 53.74** and its MAP from **0.2670 to 0.3228** on the same instances,
and Java's from **9.00 to 50.70** and **0.3612 to 0.4097**.
And `comparison.rank` held the _number of rows beaten_ under the name of a _position_; it is `publishedRank` in
`lca-sample.ts` now, with a table of known size in its tests.
Four things about this corpus are worth stating plainly rather than leaving to a footnote:

1. **It showed that the product reports absolute paths while every corpus records repository-relative ones.** The
   conversion lives in `packages/intelligence/src/benchmark/lca-instrument.ts` with its own tests, and the acceptance
   suite asserts both coordinate systems, because a measurement that assumes one form silently scores zero.
2. **The retrieval arm needs no model** — it is the fused list cut at k — so its figure is a property of the retriever
   and is reproducible to the digit. The model's arm (`LCA_ANSWER_ARM=1`) is reported separately and has not been run
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
