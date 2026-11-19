# Leaderboards in this field, and what this repository takes from each

**Every number below is somebody else's**, quoted with its source, and **the only row this repository measured is the
one that says so**. The rule `README.md` states is the rule this page follows: a figure this project did not measure is
**not** a comparison, and a leaderboard is a list of questions someone else chose to answer.

**Why the page exists.** `docs/INDUSTRY_COMPARISON.md` is a rubric scored by weights this project picked, and it ranks
this tool first; **that is a description of the rubric.** The honest sentence was already in `docs/EVAL-CONTRACT.md`
§86.5 - **we are 24.4 F1 points under the leader on the only key both a competitor and this engine have been scored
on** - and a page that lists the keys, the leaders and what is worth copying is more useful than a composite score.

---

## 1. The benchmarks, who leads them, and whether this repository runs them

| benchmark                                  | what it holds                                                            | leader (its own number)                                                                     | we run it?                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Martian Code Review Bench**, offline     | 50 PRs, 173 golden comments, 19 tools, MIT harness                       | **Qodo Extended 65.8 F1** (67.1 P / 64.6 R)                                                 | **yes** - `benchmarks/aacr-bench.json`, our **27.6** (19.4 P / 48.0 R)           |
| **Martian Code Review Bench**, online      | ~16 000 scored PRs, weighted by whether a developer acted on the comment | **cubic 65.7** (72.9 P / 59.8 R), Copilot 63.9, Claude 62.5, Greptile 61.9, CodeRabbit 60.8 | **no** - it scores comments a bot posts on live PRs, and this project has no bot |
| **AACR-Bench** (Alibaba)                   | 200 PRs, 1 505 expert-confirmed issues, 10 languages                     | built by the vendor whose tool wins on it                                                   | **yes** - every figure before §86 was measured on it                             |
| **CR-Bench / CR-Bench-Verified** (Nutanix) | 584 instances, 174 verified, defect-centred, KDDR + usefulness rate      | best agent **KDDR ≈ 33 %**; Gemini Code Assist 8.1 %                                        | **no** - planned (§3)                                                            |
| **SWE-PRBench**                            | 350 PRs, 6 languages, **three frozen context configurations**            | no model detects more than **31 %** of human-flagged issues                                 | **no** - its finding replicates ours, see §2                                     |
| **Qodo Code Review Bench 1.0**             | 100 PRs, **580 injected issues**, 8 repos, 7 languages                   | vendor-run; Qodo leads                                                                      | **no** - corpus is usable, but a vendor-run key is a key about a vendor          |
| **Greptile / Augment 50-PR bug-fix set**   | 50 PRs, one known bug each, then expanded goldens                        | Greptile 82 % catch rate on its own set                                                     | **no** - same ancestry as Martian's 50 PRs, so it adds rows and not information  |
| **CodeReviewBench**                        | 30 PRs, 95 confirmed bugs                                                | model-only comparison inside one runner                                                     | **no** - it ranks models, and this repository is a product                       |
| **CodeScaleBench** (Sourcegraph)           | 370 tasks, paired: local source vs index-backed MCP                      | index arm **P@5 0.140 → 0.478**, file recall 0.127 → 0.277, cost **−30 %**                  | **no** - it prices an index, and is the closest published evidence for §89       |
| **OWASP Benchmark** / **CoSQA**            | taint cases / query-code pairs                                           | -                                                                                           | **yes** - `benchmarks/owasp-benchmark.json`, `cosqa-retrieval.json`              |
| **SWE-bench Verified / Pro**               | issue → patch generation                                                 | ~70 % / ~23 %                                                                               | **not applicable** - it measures writing code, not judging it                    |

**Two rows are the whole strategy.** The offline Martian key is the only place a competitor's number and ours are the
same measurement, and **the online board is out of reach for a structural reason rather than a technical one**: it
scores comments posted by a bot account on public PRs, and this project has no bot to install.

---

## 2. What each leader's design says, and what of it this repository has taken

**Only the items this repository intends to copy are listed.** A competitor feature that does not bear on the four goals
is left out rather than enumerated.

| competitor / project | stack and token posture                                                                                                                                                                                                        | borrowed here                                                                                                                                                | status                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **CodeRabbit**       | clone + **code graph per PR** + 40-50 linters/SAST + distillation of every context source + **model routing** + **prompt caching** + verification agents; published case: **200 000 → 18 000 tokens** for the same bug (−91 %) | prompt caching and order (`prompt_order`, prefix reuse 61 % → 91.7 %); per-file index as the "distilled context"; **verification before the comment** (R-41) | caching **done**, verification **in progress**               |
| **Greptile**         | **graph index of the whole repo** + swarm of agents + v4 **multi-hop investigation**, confidence per comment; 80.3 precision at 50.4 recall                                                                                    | `ReviewAgent` (plan → tool loop → finding survives only if its quote is in the file)                                                                         | **done** (`agent: on`, F1 0.4043 vs 0.2033 on 36 paired PRs) |
| **Qodo Extended**    | specialised agents per concern, findings **merged through a verification step**; 65.8 offline                                                                                                                                  | per-lane review then merge (`merge-reviewers.ts`, R-29/R-31)                                                                                                 | **done**                                                     |
| **cubic / Copilot**  | product-level context + filters; 65.7 / 63.9 online                                                                                                                                                                            | **cap and filter discipline** - measured, and it does not reach them (§86.6)                                                                                 | **measured, rejected**                                       |
| **Sourcegraph SCIP** | language-agnostic index of definitions + references, **human-readable symbol IDs**, 8× smaller and 3× faster than LSIF; "precise intelligence as an antihallucinogen"                                                          | symbol identity and extents (`review/index/symbols*.ts`, 16 languages); **cross-file symbol IDs are not done**                                               | **partly**                                                   |
| **Difftastic**       | tree-sitter parse → atom/list model → **Dijkstra minimal edit script**; reports _moves_; 30+ languages; MIT                                                                                                                    | declaration extents for context; **moved-code reporting is not done**                                                                                        | **partly**                                                   |
| **CodeQL / Semgrep** | a finding is a **path witness**, not a sentence; rules are checkable artefacts                                                                                                                                                 | heuristics + taint engine; **a per-finding witness is R-41b**                                                                                                | **partly**                                                   |
| **CR-Bench**         | metric pair: **KDDR** (did it name the known defect) and **usefulness rate** (is the comment actionable)                                                                                                                       | **the metric, not the corpus**: our precision is a usefulness proxy with no usefulness label                                                                 | **planned**                                                  |

**The one thing no competitor publishes is the pipeline.** CodeRabbit, Greptile, Qodo and cubic are closed products:
their prompts, routers and verifiers are described in blog posts and not shipped. **What is open is the benchmark, the
index formats and the parsers** - and those are what this page lists as borrowable, because **a competitor's paragraph
is not a source file.**

---

## 3. What is planned, and the benchmark each plan is checked against

| plan                                                                | borrowed from                                        | checked against                               | why it is the next one                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **R-41**: the lane names the added line it reasoned from            | CR-Bench's KDDR idea; CodeRabbit's verification pass | Martian offline, 50 PRs                       | §88.1: quoting the diff is worth **2.1× precision**, and only 11 % do it                 |
| **R-41b**: the anchor must fall inside the declaration it stands in | SCIP extents; Semgrep witnesses                      | Martian offline + the polyglot index artefact | the index exists (§89) and nothing in the review reads it yet                            |
| **usefulness rate** as a second label beside precision              | CR-Bench                                             | a re-judge of one paid artefact               | precision counts a missed golden as noise; usefulness counts a comment nobody can act on |
| **structure-aware diff** (moves and reformat-only hunks)            | Difftastic                                           | SWE-PRBench's three context configurations    | SWE-PRBench: **2 000 structured tokens beat 2 500 full-context tokens on all 8 models**  |
| **cross-file symbol identity** (SCIP-shaped)                        | SCIP                                                 | CodeScaleBench-style paired retrieval         | the index knows a declaration's extent and not which other file names it                 |

**And the one plan this page argues against.** Running the **online** Martian board would put us beside cubic and
Copilot on the number the field argues about, and it needs a bot account posting on public pull requests. **The cost is
not the tokens, it is the account**, and a benchmark whose rows are comments a bot posted is a benchmark about a
deployment this project does not have. The offline key answers the same question on the same 173 comments.

---

## Sources

- Martian Code Review Bench: `github.com/withmartian/code-review-benchmark` (MIT), and the vendor announcements quoting
  its online board (cubic, Qodo, Greptile, CodeRabbit), retrieved 2026-11-19.
- CR-Bench: arXiv **2603.11078** (v1) and **2611.02566** (v2), "CR-Bench: Evaluating the Real-World Utility of AI Code
  Review Agents", Nutanix.
- SWE-PRBench: arXiv **2603.26130**, "Benchmarking AI Code Review Quality Against Pull Request Feedback".
- Qodo Code Review Bench 1.0, Augment's and Greptile's 50-PR sets, CodeReviewBench: as described by the publishers;
  reported here as vendor-run.
- CodeScaleBench and SCIP: Sourcegraph engineering posts, "Context Engineering for AI Agents" and
  "Cross-repository code navigation", retrieved 2026-11-19.
- CodeRabbit token case (200 000 → 18 000) and pipeline: CodeRabbit engineering post "Out with Tokenmaxxing. In with
  Mergemaxxing", and its architecture page.
- Greptile v4 and the graph index: Greptile's product and engineering pages, retrieved 2026-11-19.
- Difftastic: `github.com/Wilfred/difftastic` (MIT) and its internals documentation on parsing and the shortest-path
  search.
