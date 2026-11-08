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

| layer                    | subject                                                                                            | the question                                                                                | what can falsify it                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **L0 — declaration**     | every Markdown file                                                                                | does every figure resolve to an artifact, and does every artifact still support the figure? | `numbers-gate.js`, `benchmark-dataset-gate.js`, `docs:code-sync`, `baselines:anchors` |
| **L2 — regression**      | the 19-phase pipeline, 32 providers, the graph and the search stack                                | did this commit change what the product returns?                                            | the golden results under `tests/` and `packages/*/src/**/__tests__`                   |
| **L4 — agent surface**   | 51 MCP tools, the permission model                                                                 | does an agent pick the right tool, refuse the wrong one, and stay inside its role?          | `tests/benchmarks/mcp/` — **currently empty; this is the largest open gap**           |
| **L1 — external parity** | OWASP Benchmark, CoSQA, Long Code Arena, Martian, Alibaba `aacr-bench`, 100 public bug-fix commits | how do we stand on corpora we did not author?                                               | the artifact each harness writes, and its gate                                        |
| **L3 / L5**              | retrieval-augmented generation, live traffic                                                       | not applicable                                                                              | the product has no generation path and no deployment                                  |

**L4 is a main layer, not a stretch goal.** The tools are the product's action space: a wrong tool call changes state,
where a missed bad-practice comment does not. It is also the only layer with no measurement at all, which is why it is
written down here as a gap rather than omitted.

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

1. **L4 has no measurement.** 51 tools, 5 roles, zero tool-selection records. The next iteration's first deliverable.
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
