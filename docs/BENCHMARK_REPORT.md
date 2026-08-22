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

## Related Documents

- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment guide
- [ARCHITECTURE.md](ARCHITECTURE.md) — Architecture and design decisions
- [CODE-REVIEW.md](CODE-REVIEW.md) — Code review rules reference
