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

| benchmark                                  | what it holds                                                                                                                                    | leader (its own number)                                                                                                                       | we run it?                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Martian Code Review Bench**, offline     | 50 PRs, 173 golden comments, 19 tools, MIT harness                                                                                               | **Qodo Extended 65.8 F1** (67.1 P / 64.6 R)                                                                                                   | **yes** - `benchmarks/aacr-bench.json`, our **27.6** (19.4 P / 48.0 R)                                                                                 |
| **Martian Code Review Bench**, online      | ~16 000 scored PRs, weighted by whether a developer acted on the comment                                                                         | **cubic 65.7** (72.9 P / 59.8 R), Copilot 63.9, Claude 62.5, Greptile 61.9, CodeRabbit 60.8                                                   | **no** - it scores comments a bot posts on live PRs, and this project has no bot                                                                       |
| **AACR-Bench** (Alibaba)                   | 200 PRs, 1 505 expert-confirmed issues, 10 languages                                                                                             | built by the vendor whose tool wins on it                                                                                                     | **yes** - every figure before §86 was measured on it                                                                                                   |
| **CR-Bench / CR-Bench-Verified** (Nutanix) | 584 instances, 174 verified, defect-centred, KDDR + usefulness rate                                                                              | best agent **KDDR ≈ 33 %**; Gemini Code Assist 8.1 %                                                                                          | **no** - planned (§3)                                                                                                                                  |
| **SWE-PRBench**                            | 350 PRs, 6 languages, **three frozen context configurations**                                                                                    | no model detects more than **31 %** of human-flagged issues                                                                                   | **no** - its finding replicates ours, see §2                                                                                                           |
| **Qodo Code Review Bench 1.0**             | 100 PRs, **580 injected issues**, 8 repos, 7 languages                                                                                           | vendor-run; Qodo leads                                                                                                                        | **no** - corpus is usable, but a vendor-run key is a key about a vendor                                                                                |
| **Greptile / Augment 50-PR bug-fix set**   | 50 PRs, one known bug each, then expanded goldens                                                                                                | Greptile 82 % catch rate on its own set                                                                                                       | **no** - same ancestry as Martian's 50 PRs, so it adds rows and not information                                                                        |
| **CodeReviewBench**                        | 30 PRs, 95 confirmed bugs                                                                                                                        | model-only comparison inside one runner                                                                                                       | **no** - it ranks models, and this repository is a product                                                                                             |
| **CodeScaleBench** (Sourcegraph)           | 370 tasks, paired: local source vs index-backed MCP                                                                                              | index arm **P@5 0.140 → 0.478**, file recall 0.127 → 0.277, cost **−30 %**                                                                    | **no** - it prices an index, and is the closest published evidence for §89                                                                             |
| **OWASP Benchmark** / **CoSQA**            | taint cases / query-code pairs                                                                                                                   | -                                                                                                                                             | **yes** - `benchmarks/owasp-benchmark.json`, `cosqa-retrieval.json`                                                                                    |
| **SWE-bench Verified / Pro**               | issue → patch generation                                                                                                                         | ~70 % / ~23 %                                                                                                                                 | **not applicable** - it measures writing code, not judging it                                                                                          |
| **GitGalaxy Language Crucible**            | 45 languages, one fixed corpus, **tree-sitter and Universal Ctags as the two baselines**, 201 recorded disagreement shapes with 200 investigated | GitGalaxy: **100 % function precision on the 31 languages comparable with tree-sitter**, and never the wrong side of a validated disagreement | **the method, not the corpus** - `benchmarks/polyglot/` is this repository's 25-file, 11-language version of it, with the same third-party judge (§92) |

**Two rows are the whole strategy.** The offline Martian key is the only place a competitor's number and ours are the
same measurement, and **the online board is out of reach for a structural reason rather than a technical one**: it
scores comments posted by a bot account on public PRs, and this project has no bot to install.

---

## 2. What each leader's design says, and what of it this repository has taken

**Only the items this repository intends to copy are listed.** A competitor feature that does not bear on the four goals
is left out rather than enumerated.

| competitor / project    | stack and token posture                                                                                                                                                                                                        | borrowed here                                                                                                                                                                                                                                                                                                                                                                                                       | status                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeRabbit**          | clone + **code graph per PR** + 40-50 linters/SAST + distillation of every context source + **model routing** + **prompt caching** + verification agents; published case: **200 000 → 18 000 tokens** for the same bug (−91 %) | prompt caching and order (`prompt_order`, prefix reuse 61 % → 91.7 %); per-file index as the "distilled context"; **verification before the comment** (R-41)                                                                                                                                                                                                                                                        | caching **done**, verification **measured and reverted** (§91: 88.5 % of comments could name the line and F1 fell 0.029)              |
| **Greptile**            | **graph index of the whole repo** + swarm of agents + v4 **multi-hop investigation**, confidence per comment; 80.3 precision at 50.4 recall                                                                                    | `ReviewAgent` (plan → tool loop → finding survives only if its quote is in the file)                                                                                                                                                                                                                                                                                                                                | **done** (`agent: on`, F1 0.4043 vs 0.2033 on 36 paired PRs)                                                                          |
| **Qodo Extended**       | specialised agents per concern, findings **merged through a verification step**; 65.8 offline                                                                                                                                  | per-lane review then merge (`merge-reviewers.ts`, R-29/R-31)                                                                                                                                                                                                                                                                                                                                                        | **done**                                                                                                                              |
| **cubic / Copilot**     | product-level context + filters; 65.7 / 63.9 online                                                                                                                                                                            | **cap and filter discipline** - measured, and it does not reach them (§86.6)                                                                                                                                                                                                                                                                                                                                        | **measured, rejected**                                                                                                                |
| **Sourcegraph SCIP**    | language-agnostic index of definitions + references, **human-readable symbol IDs**, 8× smaller and 3× faster than LSIF; "precise intelligence as an antihallucinogen"                                                          | symbol identity and extents (`review/index/symbols*.ts`, 16 languages); **the reference half is built for JS/TS/ArkTS** (`review/index/repo-index.ts`: 1 290 edges over 485 files, **1 265/1 265 agreement with `ts.resolveModuleName`**), and since §97/§98 for Java, Kotlin, Groovy, Python and CommonJS `require`, all judged by tree-sitter at 38/38; Go, C#, PHP, Ruby and Swift's module imports are not read | **partly** - the reference half landed (§95.1, §97, §98); the five languages above are the gap                                        |
| **Difftastic**          | tree-sitter parse → atom/list model → **Dijkstra minimal edit script**; reports _moves_; 30+ languages; MIT                                                                                                                    | declaration extents for context; **moved-code reporting is not done**                                                                                                                                                                                                                                                                                                                                               | **partly** - and the C family now reads a header through `extern \"C\"` (§94.1: 50 zero-symbol files → 2)                             |
| **CodeQL / Semgrep**    | a finding is a **path witness**, not a sentence; rules are checkable artefacts                                                                                                                                                 | heuristics + taint engine; **a per-finding witness was built and replayed**                                                                                                                                                                                                                                                                                                                                         | **measured and retired** (§93: six index-checkable witness facts, best lift **+0.058 at 1.2 σ**, every filter costs F1)               |
| **CR-Bench**            | metric pair: **KDDR** (did it name the known defect) and **usefulness rate** (is the comment actionable)                                                                                                                       | **the metric, not the corpus**: our precision is a usefulness proxy with no usefulness label                                                                                                                                                                                                                                                                                                                        | **planned**                                                                                                                           |
| **aoci-spec/aoci-code** | Go, local-first MCP server + CLI; **FRAS** per-file index (`F` responsibility, `R` reads, `A` contract, `S` invariant), band policy per importance, Git-versioned and model-written; **~300K tokens for a 700K-line system**   | the **schema and the band discipline** (`review/index/cognition.ts` ports `policy.go`'s C1-C9 character bands), and **the refusal to derive meaning from a regex**                                                                                                                                                                                                                                                  | **schema done, writer not planned**: this index derives structure and refuses meaning, so a written `S` field has nothing to check it |

**The one thing no competitor publishes is the pipeline.** CodeRabbit, Greptile, Qodo and cubic are closed products:
their prompts, routers and verifiers are described in blog posts and not shipped. **What is open is the benchmark, the
index formats and the parsers** - and those are what this page lists as borrowable, because **a competitor's paragraph
is not a source file.**

---

## 2b. The one head-to-head on identical pull requests, and the two halves it separates

**The rows above quote each vendor's own number on its own corpus.** `benchmarks/aacr/competitor-baseline.json` is the
one place a competitor's _findings_ were recorded on pull requests this repository also reviewed, judged by the same
judge, with the goldens each finding matched. **Restricting both reviewers to the 47 pull requests they share - 436
goldens - is the only comparison on this page that is one measurement rather than two** (§96.3):

| on 47 shared pull requests, 436 goldens | this repository | open-code-review (recorded rows) |
| --------------------------------------- | --------------- | -------------------------------- |
| findings kept                           | 378             | 110                              |
| goldens matched                         | 98              | 77                               |
| precision                               | 0.2593          | **0.7000**                       |
| recall                                  | **0.2248**      | 0.1766                           |
| F1                                      | 0.2408          | **0.2821**                       |
| goldens matched by all their findings   | 117             | **195**                          |
| ceiling at perfect precision            | 0.4231          | **0.6181**                       |

**Their generator finds 1.67× the goldens ours finds; their selection keeps a third of what ours keeps.** That is the
sentence this table exists for, and it is the reason the plan below is one arm about sentences and not a fifth arm about
ranking: **at our precision the ceiling is 0.4231, the registered target of 0.4500 is outside it, and the target is
inside theirs** (§96.1, §96.2). **The cost column is missing on both sides** - their artifact records findings, not their
token bill - and a comparison of quality at unknown cost is a comparison of quality.

---

## 2c. The cost side of the same comparison, which no vendor publishes but this repository can measure

**The row above compares quality at unknown cost, on both sides.** This repository can fill in one half of that: the
budget it writes per pull request, priced in the finding text it produces (`scripts/budget-frontier.mjs`, §99).

| budget per pull request | F1 (452 goldens) | goldens per 1k tokens | what the next step buys                      |
| ----------------------- | ---------------- | --------------------- | -------------------------------------------- |
| 4                       | 0.2102           | 5.10                  | +30 goldens for +5 189 tokens                |
| 8                       | 0.2548           | 4.71                  | +9 goldens for +3 346 tokens                 |
| **12 (shipped)**        | **0.2648**       | 4.40                  | **+0 goldens for +1 280 tokens**             |
| 16                      | 0.2583           | 4.06                  | 26 findings bought 1 golden for 2 080 tokens |

**Twelve is the last budget that pays, and it is the one the engine ships** - chosen by a replay in §95.4 and confirmed
here on the golden basis, which is the only reason to believe either reading. **The competitor's cost remains unknown**:
their artifact records 110 findings and their goldens, not their tokens, so **a head-to-head on goldens per token cannot
be run against them** and this page does not pretend otherwise.

---

## 3. What is planned, and the benchmark each plan is checked against

| plan                                                           | borrowed from                                                       | checked against                                               | why it is the next one                                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~R-41b: a witness the lane must establish~~ **done, retired** | SCIP extents; Semgrep and CodeQL path witnesses                     | Martian offline, replayed at **0 CNY**                        | **§93**: six engine-computed witness facts, none above 1.2 σ; `inDeclaration` is the exact null (73.03 % vs 73.13 %). **The index selects nothing and covers everything** - which is §94.3's 93.9 % token cut  |
| **The index as coverage, not as a judge** (rewritten by §93)   | CodeScaleBench's paired arms (index-backed P@5 0.478 against 0.140) | Martian offline, `codeContext: on` against off                | §93 closed the judge reading at zero lift; **363 characters replace 6 000 with 100 % of non-blank claims covered** (§94.3), so the arm to run is the one that measures _that_                                  |
| **usefulness rate** as a second label beside precision         | CR-Bench                                                            | a re-judge of one paid artefact                               | precision counts a missed golden as noise; usefulness counts a comment nobody can act on                                                                                                                       |
| **structure-aware diff** (moves and reformat-only hunks)       | Difftastic                                                          | SWE-PRBench's three context configurations                    | SWE-PRBench: **2 000 structured tokens beat 2 500 full-context tokens on all 8 models**; **still not built** - the cross-file diff facts (§95.2) are the part of it that paid nothing and selected nothing     |
| ~~cross-file symbol identity~~ **built for JS/TS/ArkTS**       | SCIP                                                                | **`ts.resolveModuleName` itself** (1 258/1 258, §95.1, §98.4) | done at zero cost, and **the judge found a defect on its first run**: the one unresolved import in this repository was a fixture inside a template literal, so `missing` 1 → 0 and 36 false edges went with it |

| **A rewriter, not a filter** (rewrite the surviving comment against the declaration's contract) | CodeRabbit's verification agent; Qodo's multi-lane merge | Martian offline, same corpus, same judge; **registered target ≥0.55 precision with ≥173 matched goldens** (§96.4), **and priced in goldens per thousand tokens rather than in F1** (§99.3) | **§95.3 is the argument**: 254 of 452 goldens (56.2 %) were lost with a finding already standing on the right path, so **selection is exhausted and the sentences are the constraint**. Four selection devices are null (§88.1, §91, §93, §95.2); none of them could have been anything else |

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
