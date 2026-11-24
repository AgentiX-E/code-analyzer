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

| benchmark                                      | what it holds                                                                                                                                                                                                                                                                         | leader (its own number)                                                                                                                                                                                                   | we run it?                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Martian Code Review Bench**, offline         | 50 PRs, 173 golden comments, 19 tools, MIT harness                                                                                                                                                                                                                                    | **Qodo Extended 65.8 F1** (67.1 P / 64.6 R)                                                                                                                                                                               | **yes** - `benchmarks/martian-bench.json`, our **27.6** (19.4 P / 48.0 R) over 173 goldens and **26.6** on the board's `core` 158 (§147.4)                                                                                                                         |
| **Martian Code Review Bench**, online          | ~16 000 scored PRs, weighted by whether a developer acted on the comment                                                                                                                                                                                                              | **cubic 65.7** (72.9 P / 59.8 R), Copilot 63.9, Claude 62.5, Greptile 61.9, CodeRabbit 60.8                                                                                                                               | **no** - it scores comments a bot posts on live PRs, and this project has no bot                                                                                                                                                                                   |
| **AACR-Bench** (Alibaba)                       | 200 PRs, 1 505 expert-confirmed issues, 10 languages                                                                                                                                                                                                                                  | built by the vendor whose tool wins on it                                                                                                                                                                                 | **yes** - every figure before §86 was measured on it                                                                                                                                                                                                               |
| **CR-Bench / CR-Bench-Verified** (Nutanix)     | 584 instances, 174 verified, defect-centred, KDDR + usefulness rate                                                                                                                                                                                                                   | best agent **KDDR ≈ 33 %**; Gemini Code Assist 8.1 %                                                                                                                                                                      | **no** - planned (§3)                                                                                                                                                                                                                                              |
| **SWE-PRBench**                                | 350 PRs, 6 languages, **three frozen context configurations**                                                                                                                                                                                                                         | no model detects more than **31 %** of human-flagged issues                                                                                                                                                               | **no** - its finding replicates ours, see §2                                                                                                                                                                                                                       |
| **Qodo Code Review Bench 1.0**                 | 100 PRs, **580 injected issues**, 8 repos, 7 languages                                                                                                                                                                                                                                | vendor-run; Qodo leads                                                                                                                                                                                                    | **no** - corpus is usable, but a vendor-run key is a key about a vendor                                                                                                                                                                                            |
| **Greptile / Augment 50-PR bug-fix set**       | 50 PRs, one known bug each, then expanded goldens                                                                                                                                                                                                                                     | Greptile 82 % catch rate on its own set                                                                                                                                                                                   | **no** - same ancestry as Martian's 50 PRs, so it adds rows and not information                                                                                                                                                                                    |
| **CodeReviewBench**                            | 30 PRs, 95 confirmed bugs                                                                                                                                                                                                                                                             | model-only comparison inside one runner                                                                                                                                                                                   | **no** - it ranks models, and this repository is a product                                                                                                                                                                                                         |
| **CodeScaleBench** (Sourcegraph)               | 370 tasks, paired: local source vs index-backed MCP                                                                                                                                                                                                                                   | index arm **P@5 0.140 → 0.478**, file recall 0.127 → 0.277, cost **−30 %**                                                                                                                                                | **no** - it prices an index, and is the closest published evidence for §89                                                                                                                                                                                         |
| **OWASP Benchmark** / **CoSQA**                | taint cases / query-code pairs                                                                                                                                                                                                                                                        | -                                                                                                                                                                                                                         | **yes** - `benchmarks/owasp-benchmark.json`, `cosqa-retrieval.json`                                                                                                                                                                                                |
| **SWE-bench Verified / Pro**                   | issue → patch generation                                                                                                                                                                                                                                                              | ~70 % / ~23 %                                                                                                                                                                                                             | **not applicable** - it measures writing code, not judging it                                                                                                                                                                                                      |
| **ReviewBench** (GitHub, 2026-10-05)           | 219 PRs from **187 repos, 19 languages**, sampled to match the distribution of 103.9M GitHub PRs; golden set from human reviewers, frontier LLMs and static analysis; judge Claude Sonnet 5, senior-engineer agreement **96.6 %**; MIT, container + own model key                     | **Copilot Code Review (Balanced) 87.8 P / 26.0 R**; Devin 84.0 / 23.8; Qodo 85.3 / 22.1; Codex 86.0 / 18.5; Cubic 85.5 / 16.3; Greptile 86.1 / 16.2; Cursor 87.7 / 9.6. **By severity F1: Codex 81 critical, Copilot 63** | **no, and it is the most promising board to enter** - offline, MIT, and scored on PRs we can fetch; the blocker is a container image, not a bot account                                                                                                            |
| **MacroscopeBench** (Macroscope, 2026)         | 12 000+ validated bugs from 1 500+ public repos, 14 languages, each anchored to the introducing commit; two independent LLM judges; **three runs, reported as the mean**; scores recall, precision, signal-to-noise, **cost and latency**                                             | vendor-run; 2025 tool level: Macroscope 48.31 %, CodeRabbit 45.76 %, Cursor Bugbot 42.37 %, Greptile 23.61 %, Graphite Diamond 18.26 %                                                                                    | **no** - it is the only board that publishes **USD per review**, which is the axis §117 measures, but the key is the vendor's                                                                                                                                      |
| **ArkEval** (SJTU, ASE 2026, arXiv 2602.08866) | **502 real ArkTS / OpenHarmony issue-fix instances** from **9 public source repositories** and **149 OpenHarmony applications**, each with a traceable version pair, the developer's reference patch and **a behaviour-level reproduction test**; separates `Compile@1` from `Pass@1` | 8 models in the main experiment; the benchmark's point is that a patch which compiles is not a patch that fixes                                                                                                           | **no, and it is the only board for the one language this table cannot fill** - it measures repair rather than review, so it does not rank us, but its **9 source repositories are an ArkTS corpus this index can be measured on**, which §115.3 said did not exist |
| **GitGalaxy Language Crucible**                | 45 languages, one fixed corpus, **tree-sitter and Universal Ctags as the two baselines**, 201 recorded disagreement shapes with 200 investigated                                                                                                                                      | GitGalaxy: **100 % function precision on the 31 languages comparable with tree-sitter**, and never the wrong side of a validated disagreement                                                                             | **the method, not the corpus** - `benchmarks/polyglot/` is this repository's 25-file, 11-language version of it, with the same third-party judge (§92)                                                                                                             |

**Two rows added on 2026-11-21, and the reason they are rows rather than a paragraph.** Both are new since this table was
written, and both change what the next device should be.

**ReviewBench is the first board whose shape is the opposite of ours.** Its precision band across seven tools is
**84.0–87.8 %** and its recall band is **9.6–26.0 %**: the field has converged on _staying quiet_. The leader finds one
known problem in four and is right 88 % of the time it speaks. **This project sits at the other end** - 0.209 precision
against 0.181 recall on the forty-seven shared pull requests (§116.2), 8.08 comments per pull request against the
competitor's 2.34. On ReviewBench's own axis we would be a high-recall, low-precision entry, and **that is the entry the
board does not have**. Two consequences worth stating: the accuracy gap to a tool like Copilot is **not** a recall gap -
it is a precision gap of thirty points on their corpus, which is the same sentence §116 wrote about a different
competitor and is now true of the whole field; and **the board's own methodology warns against its augmented columns**
because a tool that talks more inflates its own denominator, which is the failure mode this project already measured for
itself in §116.3.

**MacroscopeBench is the only board that prices a review**, and its number is USD per review per model: GLM 5.3 at
3.86 USD against GPT-6 Astra at 7.87 for a 0.6-point score difference, and DeepSeek V4.1 Flash at **0.75 USD** with the
highest recall (83.1 %) and the worst precision of the leaders (63.5 %). **Those are the two axes §117's figure uses**,
on a corpus we do not have; the board is vendor-run, so its ranking is a rating and its _axes_ are the transferable part.

**ArkEval is a row for a language rather than for a ranking.** It is the only peer-reviewed benchmark that holds ArkTS — 502
issue-fix instances over nine public source repositories and 149 OpenHarmony applications, each with a reproduction test,
accepted at ASE 2026. **It does not rank a reviewer**, so it is not a board this project can be scored on; what it has is
**the corpus**, and §115.3's ArkTS row said _no public checkout this project can fetch_ for eleven sections. That sentence
is now a statement about what was searched for rather than about what exists.

**And the column that had no number until §154.** Every published competitor figure on the offline Martian row was
produced with **its own vendor's model**, so a comparison against one is a comparison across two models as well as two
reviewers. Run `45411086146` removed the second difference: `open-code-review` over the same fifty pull requests on the
same `deepseek-chat` the judge uses, scored by the same judge on the same 173 goldens.

| arm, both on `deepseek-chat`           | P      | R      | F1         |
| -------------------------------------- | ------ | ------ | ---------- |
| ours (the policy that posts)           | 0.1854 | 0.4393 | **0.2607** |
| competitor                             | 0.1599 | 0.6821 | **0.2591** |
| **their findings, our ranking device** | —      | —      | **0.3488** |

**0.0016 is not a lead at a 0.0126 resolution** (McNemar p = 0.8126, 34 findings only we made and 37 only they made), so
the honest cell is **tied, and both arms answer the question the same way**: they find more (0.6821 against 0.4393) and
we are more precise (0.1854 against 0.1599). **The third row is the one that names the bottleneck** - their candidate set,
ranked by our device, is 0.088 F1 above our own review - so the constraint is discovery, not selection (§154.2).

**Two rows are the whole strategy.** The offline Martian key is the only place a competitor's number and ours are the
same **corpus and profile** - and, since §134.1, **not the same instrument**: the board's 65.8 and this project's 27.6
come from different judge models, and the board's own documentation puts an individual tool's judge term at up to nine
F1 points. **The online board is out of reach for a structural reason rather than a technical one**: it scores comments
posted by a bot account on public PRs, and this project has no bot to install.

---

## 2. What each leader's design says, and what of it this repository has taken

**Only the items this repository intends to copy are listed.** A competitor feature that does not bear on the four goals
is left out rather than enumerated.

| competitor / project    | stack and token posture                                                                                                                                                                                                        | borrowed here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | status                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeRabbit**          | clone + **code graph per PR** + 40-50 linters/SAST + distillation of every context source + **model routing** + **prompt caching** + verification agents; published case: **200 000 → 18 000 tokens** for the same bug (−91 %) | prompt caching and order (`prompt_order`, prefix reuse 61 % → 91.7 %); per-file index as the "distilled context"; **verification before the comment** (R-41)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | caching **done**, verification **measured and reverted** (§91: 88.5 % of comments could name the line and F1 fell 0.029)              |
| **Greptile**            | **graph index of the whole repo** + swarm of agents + v4 **multi-hop investigation**, confidence per comment; 80.3 precision at 50.4 recall                                                                                    | `ReviewAgent` (plan → tool loop → finding survives only if its quote is in the file)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **done** (`agent: on`, F1 0.4043 vs 0.2033 on 36 paired PRs)                                                                          |
| **Qodo Extended**       | specialised agents per concern, findings **merged through a verification step**; 65.8 offline                                                                                                                                  | per-lane review then merge (`merge-reviewers.ts`, R-29/R-31)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **done**                                                                                                                              |
| **cubic / Copilot**     | product-level context + filters; 65.7 / 63.9 online                                                                                                                                                                            | **cap and filter discipline** - measured, and it does not reach them (§86.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **measured, rejected**                                                                                                                |
| **Sourcegraph SCIP**    | language-agnostic index of definitions + references, **human-readable symbol IDs**, 8× smaller and 3× faster than LSIF; "precise intelligence as an antihallucinogen"                                                          | symbol identity and extents (`review/index/symbols*.ts`, 16 languages); **the reference half is built for JS/TS/ArkTS** (`review/index/repo-index.ts`: 1 266 edges over 485 files, **1 265/1 265 agreement with `ts.resolveModuleName`**), since §97/§98 for Java, Kotlin, Groovy, Python and CommonJS `require`, since §102 for Go (the `go.mod` module prefix), C/C++ (`#include`, the includer's directory then a unique suffix) and the JVM's `package` declaration (`kotlinx.coroutines`: **2 → 1 888** resolved of 4 421), and since §103 for Swift's module imports (a SwiftPM target is a directory: `Alamofire` **0 → 43 resolved, 265 edges**) and for the document languages (XSD `schemaLocation`, JSON/YAML `$ref`), and since §104 a nested Swift declaration is named by its parent (`Alamofire` **265 → 251** edges: 21 renamed, 19 false ones gone, all 16 of the `Error` kind) and XML reads `xi:include@href` and a `DOCTYPE` system literal (`libxml2` **303 → 336** of 1 728 resolved), all judged by tree-sitter at **46/46**; C#, PHP and Ruby's imports are not read | **partly** - the reference half landed (§95.1, §97, §98, §102, §103); C#, PHP and Ruby are the gap                                    |
| **Difftastic**          | tree-sitter parse → atom/list model → **Dijkstra minimal edit script**; reports _moves_; 30+ languages; MIT                                                                                                                    | declaration extents for context; **moved-code reporting is not done**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **partly** - and the C family now reads a header through `extern \"C\"` (§94.1: 50 zero-symbol files → 2)                             |
| **CodeQL / Semgrep**    | a finding is a **path witness**, not a sentence; rules are checkable artefacts                                                                                                                                                 | heuristics + taint engine; **a per-finding witness was built and replayed**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **measured and retired** (§93: six index-checkable witness facts, best lift **+0.058 at 1.2 σ**, every filter costs F1)               |
| **CR-Bench**            | metric pair: **KDDR** (did it name the known defect) and **usefulness rate** (is the comment actionable)                                                                                                                       | **the metric, not the corpus**: our precision is a usefulness proxy with no usefulness label                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **planned**                                                                                                                           |
| **aoci-spec/aoci-code** | Go, local-first MCP server + CLI; **FRAS** per-file index (`F` responsibility, `R` reads, `A` contract, `S` invariant), band policy per importance, Git-versioned and model-written; **~300K tokens for a 700K-line system**   | the **schema and the band discipline** (`review/index/cognition.ts` ports `policy.go`'s C1-C9 character bands), and **the refusal to derive meaning from a regex**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **schema done, writer not planned**: this index derives structure and refuses meaning, so a written `S` field has nothing to check it |

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

| on 47 shared pull requests, 436 goldens    | this repository | open-code-review (recorded rows) |
| ------------------------------------------ | --------------- | -------------------------------- |
| findings kept                              | 378             | 110                              |
| **protocol true positives** (a matching)   | 79              | 58                               |
| **protocol precision**                     | 0.2090          | **0.5273**                       |
| **protocol recall**                        | **0.1812**      | 0.1330                           |
| **protocol F1**                            | 0.1941          | **0.2125**                       |
| goldens matched, golden basis              | 98              | 77                               |
| precision, golden basis                    | 0.2593          | 0.7000                           |
| recall, golden basis                       | **0.2248**      | 0.1766                           |
| F1, golden basis                           | 0.2408          | 0.2821                           |
| goldens named by all their findings        | 117             | **195**                          |
| pairs a matching can claim across the pool | 97              | **164**                          |
| ceiling at perfect precision               | **0.3640**      | **0.5467**                       |

**The four rows in bold are the only ones on this page computed the way the protocol defines** - one finding to at most
one golden, `F1 = 2·TP/(C+G)` - and they put the gap at **+0.0184** for the competitor. The golden-basis rows below them
put it at **+0.0413**. **Both are true and they are not the same measurement**; §116.1-116.2 is why the artifact printed
the second for a year and why both are printed now.

**Their generator finds 1.67× the goldens ours finds; their selection keeps a third of what ours keeps.** That is the
sentence this table exists for: **at our precision the ceiling is 0.3640, the registered target of 0.4500 is outside it,
and the target is inside theirs** (§96.1 as amended, §116.4). **The cost column is missing on both sides** - their
artifact records findings, not their token bill - and a comparison of quality at unknown cost is a comparison of quality.

## 2c. The same comparison as a figure, and the axis the field does not publish

`docs/figures/` holds five generated charts (`scripts/competitive-position.mjs` over
`benchmarks/competitive-position.json` and `benchmarks/emission-frontier.json`, twelve tests in
`tests/unit/scripts/a-figure-names-every-row.test.ts`):

| figure                                                           | what it plots                                                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`martian-offline.svg`](figures/martian-offline.svg)             | the offline board's twenty-two rows: **F1 against prompt tokens per pull request**                                                                                                       |
| [`aacr-same-corpus.svg`](figures/aacr-same-corpus.svg)           | three rows on **two row sets**, each label carrying its scope: the recorded competitor, our index arm, our no-index arm; it places the three points and draws no gap between them (§121) |
| [`our-budget-frontier.svg`](figures/our-budget-frontier.svg)     | what a larger per-file cap buys in F1, for finding text - the curve this engine can move along itself                                                                                    |
| [`boards-one-per-column.svg`](figures/boards-one-per-column.svg) | seven boards whose seven metrics must not be read as one scale                                                                                                                           |
| [`emission-frontier.svg`](figures/emission-frontier.svg)         | **six cuts of one run under the ceiling none of them reach**: F1 against comments, ceiling 0.45                                                                                          |

**The panel on the right of the first two is the finding.** Of the twenty-two rows on the offline board, **one publishes a
token count for a review: this one.** The rest are drawn as ranked bars at their accuracy with no price, because the
alternative - dropping them, or estimating - is either the crop that flatters whoever has a number or the fabrication this
page exists to avoid.

**And the row this project does have two axes for is 38.2 F1 points below the leader at 155 233 prompt tokens per pull
request**, scored by a different judge than the rest, which the figure says on its own face.

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

### 2d. The one measured cost for the leader, and the corpus it is measured on

**`benchmarks/ocr-on-our-corpus.json` runs the competitor's own harness here**: `open-code-review` 1.12.13,
`scan --path <corpus> --format json`, pointed at DeepSeek's Anthropic-compatible endpoint so that **the model is the one
this repository's own figures use**, over the tree this engine indexes.

| row                        |      value |
| -------------------------- | ---------: |
| files reviewed             |         37 |
| comments filed             |        252 |
| comments per file          |       6.81 |
| prompt + completion tokens |  3 544 985 |
| **tokens per file**        | **95 810** |
| tokens per comment         |     14 067 |
| elapsed                    |     2m 40s |

**This engine's own figure on the AACR run is 11 626 tokens per file** (`137 186` per pull request over 11.8 files) and
**22 563 tokens per comment** on the 304 it posts. **The two are not a head-to-head and this page does not pool them**:
different corpora, different file sets, and the competitor's number is a single scan rather than a scored run. What it
establishes is the one thing no leaderboard says: **the leader's cost per file is in the same order as ours is not** —
8.2× the prompt and completion per file for 1.4× the comments per file.

**Why it is quoted at all.** §2c records that the competitor's cost _on the benchmark_ is unknown, because their
artifact carries findings and goldens rather than tokens. That remains true, and this table is not a substitute for it —
it is the only measurement of its kind that exists, labelled with the corpus it was taken on.

---

## 2e. The one published experiment on whether a repository map is a cost device or an accuracy device

**arXiv 2611.07286, 2026-11-05**, _How Should Agents See Code? Rethinking Code Representations for Agentic Software
Engineering_. Five repository views - AST, call graph, module dependency, documentation-enriched search, and a hybrid -
exposed to one agent (Claude Code with Haiku 4.5) as MCP tools, against a raw-tool baseline, on four repository-level
tasks. **The same harness, the same model, one variable**: what the agent can see.

| task          | metric           | baseline | five views                 | tokens             |
| ------------- | ---------------- | -------: | -------------------------- | ------------------ |
| LinuxFLBench  | recall@10        |    0.717 | **0.757 – 0.829**          | **−25 % to −39 %** |
| SWE-bench Pro | resolution       |   49.0 % | 44.3 – 50.6 %              | −17 % to −26 %     |
| SecBench      | patch resolution |   28.9 % | **call graph 34.3 %**      | fewer              |
| SWT-bench     | reproducing test |   44.7 % | hybrid 47.8 %, docs 47.2 % | **more**           |

**Their conclusion, in their words: the benefit is largest when localisation is the bottleneck, and a map is noise when
the decisive step is authoring.** The paper also names the failure a hybrid view produces - _verbatim-source explosion_ -
which is the same failure this project measured from the other side in §108: a second field of view that spends 1 920
comments to express one.

**What this changes here, and it is a correction to our own plan rather than to theirs.** §116.7 concluded that the
missing column in the shipped ranker is `reach` - a map fact - and priced it as an **accuracy** device because the oracle
left 0.0818 of headroom. **This paper predicts the opposite ordering of benefits for our task**: in code review the
localisation is handed to us by the diff, so the authoring step dominates, which is their SWT-bench column - the one where
every map **cost more tokens and bought nothing**. So the next registration for the index in review should be **a token
device with an F1 guard**, not an accuracy device with a cost note, and R-54 as written would have been read on the wrong
axis.

**And the −25 % to −39 % is the number to replicate, not the recall.** This repository's own §100 reach device adds a line
per changed file describing what the file reaches; **no figure has ever been published for what those lines cost or
saved.** That is a measurable thing on an artifact we already have, and it is the design the paper's AST and call-graph
rows support.

---

## 2f. Two 2026 readings that put a number on the regime this repository is in

**The survey first, because it is the only one with the field's aggregate.** _AI Code Review in 2026_ ([Atlas](https://laoujin.github.io/Atlas/research/2026-06-09-ai-assisted-code-review-in-2026-landscape-tools-evidence-and-limits/risks-limitations-and-adoption-barriers))
reports **200 000 real pull requests, a best tool at 51.7 % F1, and the field near 25 % precision**, with **12 of 13
agents below 60 % signal on 19 450 pull requests**. **Two of its secondary findings matter more than its ranking**:

- **recall against defects per file collapses - 94.4 % at one defect, 46.4 % at nine** (Llama-3.3-70B), and one model's
  file-level accuracy **64.2 % → 4.4 %**. This repository measured the same shape from the rejection side
  (EVAL-CONTRACT §124.3: **37.3 % → 74.1 %** as a file carries one to five goldens).
- **security recall stays below 0.5 even for SOTA models**, with per-CWE F1 collapsing on rarer classes: incorrect
  comparison 0.40, improper exception checking 0.48, protection-mechanism failure 0.52.

**Then the single-family ceiling, which is the one with an actionable effect size.** _A Single LLM Is an Incomplete Code
Reviewer_ ([Zenodo 20519584](https://zenodo.org/records/20519584)) runs 33 artifacts and 294 confirmed issues across
**fifteen model versions from eight providers**: **no model above ≈61 % recall**, **56.8 % of confirmed defects found by
exactly one model**, median cross-family Jaccard **0.29**, and **a second reviewer from another family takes per-artifact
coverage from 47 % to 72 %**.

| reading                                                                                           | best                                                 | the field                                            | this repository (46 rows)             |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| 200 000 PRs, F1                                                                                   | **51.7 %**                                           | ≈25 % precision                                      | 0.2268 F1 / 0.2399 precision          |
| closed-source precision band ([Kodus 2026](https://kodus.io/en/open-source-llms-for-code-review)) | **52.6 – 62.7 %**                                    | —                                                    | 0.2399                                |
| open-source best (**Kimi K3.1 Pro**)                                                              | **68.6 % recall / 49.1 % precision / $1.244 per PR** | GLM-5.3 41.3 % recall at 43.5 % precision            | 0.2152 / 0.2399                       |
| a blind mutation test ([guibai.dev](https://guibai.dev/a/7702064982633152546))                    | 13 of 20 mutants (65 %)                              | **5 of the 7 misses are one deleted defensive step** | 68.5 % of the corpus has no candidate |

**What this repository takes from §2f, and what it refuses to take.** The **+25 points for a second family** is the
largest published effect the campaign has found and is now registered as **R-65** (EVAL-CONTRACT §125.6) - with a bar of
**110 pool true positives** rather than a transplanted 47 %→72 %, because that figure is per-artifact coverage over 33
artifacts with a human key and this corpus is 46 pull requests with a vendor's key. **The 51.7 % F1 is not a target**: it
is the best of 200 000 pull requests by a tool the survey measured, and the same survey puts the field near 25 %
precision, which is where this arm already is.

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
