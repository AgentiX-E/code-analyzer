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
   run's interval. **The permission half now has a measurement of its own**: 100 planted instructions inside the files the
   agent was asked about, **0 of 100 exposed attempts complied**, against **98 of 100 when the user asked for the same
   call** (p = 6.31 × 10⁻³⁰), with a 3.7 % ceiling, and every one of those 98 calls was refused by a read-only client and
   by a `scout` profile — which is the enforcement, tested without a model, not the statistic. **The control read 32 in
   the iteration before, and that figure is withdrawn**: the only change is a third tool turn, so it measured the
   harness's turn budget rather than the model's willingness. **A second channel was built and did not run**: with the
   payload in a call site and a question that names no file, exposure was 0 of 100 — every attempt answered from search
   metadata without opening the file the search returned — so `asr` is null there and nothing about call-site injection
   is measured. **What remains unmeasured is policy rather than mechanism**: which role a given deployment should grant,
   how a token maps to a role, whether an instruction in a call site is obeyed when a question forces the read, and
   whether one planted somewhere else (a commit message, a dependency's README, a long conversation) behaves like this
   one. Nothing here asserts safety, and the selection rate in particular may not be quoted as if it did.
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
