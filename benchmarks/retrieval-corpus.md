# The pinned corpus

The fifty-two source files in `retrieval-corpus/` are a **snapshot**, not a copy that is kept in step with the product.
This note lives beside that directory rather than inside it on purpose: the walk reaches a `.md` file too, and the first
attempt at documenting the corpus from within it added **53 nodes** to the graph the measurement runs on — a corpus that
documents itself is not the corpus that was measured.

|        |                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| source | `packages/analyzer/src/languages`                                                                                              |
| commit | `4ae5c62` (2026-10-29)                                                                                                         |
| files  | 52 — 40 sources and the 12 test files inside `__tests__`, which the walk reaches and therefore the measurement always included |
| graph  | 3 600 nodes when analysed by the code of `4ae5c62`, **5 735 nodes when analysed by the code of iteration 65**                  |

## Why it is pinned

`paraphrase-search.test.ts` measures a retriever on a set of questions that is **frozen in
`benchmarks/paraphrase-queries.json`**. A frozen question set and a moving corpus are two halves of one measurement: the
questions were written from the languages directory on 2026-10-26, and on 2026-10-29 two refactors renamed four of the
symbols they ask about —

- `ArkTSProvider.walkAndCapture` became `captureTypes` (`818f9bd`),
- the three `collectCLikeTaint*` helpers in `base-c-like.ts` became one `collectCLikeTaint` (`e0d5f68`).

A question whose answer no longer exists scores as a miss for every column, so the measurement silently understated both,
and once the guard was added it failed outright. **Neither column had changed; the corpus had.** Pinning both inputs is
what makes a figure from one commit comparable with a figure from another.

`docstring-search.test.ts` derives its queries from the corpus at run time, so it cannot go stale — but its _figure_ was
equally a property of whichever tree happened to be checked out, and it moved twice for that reason alone. It measures
this same snapshot now, with the opposite protocol: there the doc comment is the query and the index holds it; here the
query is a paraphrase and the index holds no doc comment at all.

## The one figure that moves

`benchmarks/paraphrase-search.json` was recorded on **2026-10-27**, against the live directory as it stood that day:
**3 357 nodes**. This snapshot is the tree of 2026-10-29 and the builder of that commit counts **3 600** nodes on it — the
directory gained code in between, and the phases that build the graph have changed since. So both figures were
**re-measured once** on the pinned corpus, and the expectation was that from then on they could only move with the
retriever.

**They could not, and the correction is worth stating in full.** Pinning the corpus pins its _text_. It does not pin the
**graph built from that text**, and the graph is the corpus of a lexical ranking: document lengths, term frequencies and
every IDF. Between the recording of 2026-10-31 and iteration 65 the builder went from **3 600 to 5 735 nodes** on this
same fifty-two files — a container model, declared types on fields, parameters and locals, class expressions, aliases —
and the lexical column moved **0.3030 -> 0.2424** (30 -> 24 of 99 answers inside the top twenty) **with every file and
every question unchanged**. The three controls that separate this from a defect in the re-keying:

| control                                                                                         | result                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the **key form** — matching an answer by its declared name rather than by its qualified name    | **24 of 99**, the same figure: the container prefix is not the cause                                                                                                        |
| stripping the container from the **indexed** path, i.e. what the index held before iteration 65 | **25 of 99**, and **108 qualified names collide** in the store once the prefix is gone                                                                                      |
| the two model-backed arms                                                                       | `hyde` **0.6566** and `rerank` **0.6869** are unchanged to four decimal places, because a reranker re-orders a fifty-deep pool instead of reading a length-normalised score |

So the figure below was re-recorded from the run at `3e850de`, and **the honest description of the column is "the graph
of the day"**: a lexical ranking over a graph that grows is not comparable with one over a graph that was smaller, and
separating the two is a property of the _measurement_, not of the retriever. The next step was named as a weighted-field
index, measured on these same ninety-nine questions, and iteration 66 built it.

### The fix, and what it recovered

**One bag of tokens cannot tell where a word was written.** The index concatenated the declared name, the file and
container path, the signature and the doc comment, then scored the concatenation — so `Parser.sanitize` living in
`sanitize.ts` mentioned `sanitize` twice (once because it is declared, once because of the file it is declared in) and
BM25 summed the two, for no reason a reader could see. Three changes, each measured on the same ninety-nine questions:

| change                                                      | what it was before                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **four fields, weighted and normalised separately** (BM25F) | one bag, one document length, one `b`                                                     |
| **`:` and `/` are token separators**                        | `file:types:ZodType` was a single token, so a query for `types` matched nothing           |
| **the signature field is written for the first time**       | `GraphNode.signature` was `null` for **5 735 of 5 735 nodes**: no provider ever filled it |

| column               | before | after      |
| -------------------- | ------ | ---------- |
| recall at 5          | 0.0808 | 0.1515     |
| recall at 20         | 0.2424 | **0.3030** |
| mean reciprocal rank | 0.0729 | 0.0980     |

**The weighting was not chosen on the questions it is reported on.** `PARAPHRASE_SWEEP=1` measures eighty-one
configurations and writes `paraphrase-field-sweep.json`; the choice is `dev` recall at 20 (then `dev` MRR) and the figure
reported is always `test`. Re-derived on that half, the rule selects `name: 1, path: 0.5, signature: 1, b_name: 0` —
**`b = 0` on the name field, because a long identifier is not a worse identifier** — with `dev` 0.3191 against `test`
**0.2885** on the other forty-seven and fifty-two questions.

**And the column is now a gate rather than a note.** It fell by 0.06 across four iterations without a red run, because
the only assertion on it lived inside a block that is skipped when no API key is present — even though the lexical column
needs no key at all. `paraphrase-search.test.ts` now asserts the three figures above on a machine with no credential, so
the next regression costs a run.

**The arms that need a model moved with it**, measured on the runner at `16ec359`:

| arm                                             | before | after      |
| ----------------------------------------------- | ------ | ---------- |
| fused, weight 1                                 | 0.5657 | **0.5960** |
| `hyde` (the query vector averages a hypothesis) | 0.6566 | **0.6667** |
| `rerank`, cut at 20                             | 0.6869 | 0.6768     |
| pool a reranker is given                        | 0.6970 | 0.6869     |

**The reranker lost one question and gained on order** (MRR 0.4801 → 0.4815) — inside the ±1 resolution of a
ninety-nine-question set, and stated rather than smoothed: a column that moves by one question is not evidence of a
cause in either direction. **What the row does say is where the ceiling is**: the reranker answers 0.6768 of 0.6869, so
**98 % of what it was given reached the top twenty**, and no amount of reordering can exceed the pool. The next lever is
the pool's depth and not its order.

### Where the answer actually sits

**Ninety-eight per cent of a pool reaching the top twenty is not a reranker that works; it is a reranker with nothing
left to do.** The pool was fifty deep because _"fifty fits one prompt"_ — a claim about a prompt, used for two
iterations as though it were a claim about the retriever. Nothing had ever asked where the answers were. The lexical
list answers that, and it needs no credential, because BM25 returns every match:

| cut                  | 5      | 10     | 20        | 30     | 50     | 75     | 100        | 150    | 200    |
| -------------------- | ------ | ------ | --------- | ------ | ------ | ------ | ---------- | ------ | ------ |
| recall, 99 questions | 0.1515 | 0.2323 | **0.303** | 0.3333 | 0.3838 | 0.4444 | **0.5051** | 0.5455 | 0.5556 |

**Sixty-one of the ninety-nine answers are in the list somewhere, and the top twenty shows thirty of them.** The other
**thirty-one sit below the cut** — and **the median found answer is at rank 24**, so the typical answer the index can
find is one the head does not show. The remaining **thirty-eight are in no position at all**: no term of the question
matches the document as the index tokenises it, so no pool depth reaches them. That split is the whole measurement:

| quantity                      | value      | what it bounds                                       |
| ----------------------------- | ---------- | ---------------------------------------------------- |
| recall at 20                  | 0.3030     | what the product promises today                      |
| recall at 100                 | 0.5051     | what a hundred-deep pool could show a reranker       |
| **reachable at any rank**     | **0.6162** | **the ceiling no pool depth can pass**               |
| headroom (reachable − at 20)  | 0.3131     | the most a deeper pool could ever buy, on this index |
| absent from the list entirely | 38 of 99   | where only a better query or a better index can help |

**The same defect was in the tool, and it was not a measurement artefact.** `search_code` computed its retrieval depth as
`min(RERANK_POOL, maxLimit)` — the constant that describes how long a prompt can be, used to decide how deep to search —
so `limit: 100` with `rerank: true` returned **fifty** items and reported `pool: 50`. A requested limit went unmet by a
factor of two and **nothing said so**: `rerank.pool` reads as the pool the order came from, not as the size of the
answer. It is `max(limit, RERANK_POOL)` now, and the case that would have caught it is a regression test.

**So the pool is measured at five depths rather than chosen at one.** `paraphrase-search.json` carries a `poolDepth`
array — the share of answers each depth puts in front of a reranker — computed from two candidate lists that are already
in memory, at no cost in completions; and two rerank arms read the shallow and the deep end of it, **with the same
index, the same questions, the same fusion weight and the same answer budget**, so the difference between their columns
is the depth of the list and nothing else. `rerank-deep` reads **150**, which is where the lexical curve stops paying:
it gains one question between 150 and 200 while the prompt grows by a third.

### What the depth bought

The ceiling of the fused pool, at every depth a reranker could be given:

| pool depth | 20     | 50         | 100        | 150        | 200        |
| ---------- | ------ | ---------- | ---------- | ---------- | ---------- |
| ceiling    | 0.5960 | **0.6869** | **0.7879** | **0.8283** | **0.8485** |
| questions  | 59     | 68         | 78         | 82         | 84         |

**Ten questions arrive between fifty and a hundred, four more by a hundred and fifty, and two more by two hundred.**
The shallow arm was not a bad ordering — it was a complete one over a list that had already thrown the answers away:

| arm                      | pool | recall@5   | recall@20  | MRR        | of its own pool |
| ------------------------ | ---- | ---------- | ---------- | ---------- | --------------- |
| fused, weight 1          | —    | 0.3737     | 0.5960     | 0.2748     | —               |
| `rerank`, cut at 20      | 50   | 0.5859     | 0.6869     | 0.4800     | **68 of 68**    |
| `rerank-deep`, cut at 20 | 150  | **0.6566** | **0.7576** | **0.5424** | **75 of 82**    |

**Seven more questions at the top of the list and seven more at the top five, for the same one completion.** Against the
competitor reference quoted by the whitepaper (`Cody`, 0.75) the column reads **0.7576** — above it for the first time,
and by a margin larger than any figure in this file has moved by accident.

**And the ordering is no longer free**: at fifty the arm recovered **100 %** of its pool, at a hundred and fifty it
recovers **91 %**, so a deeper list costs the model some of its judgement. That is the next measurement rather than a
disappointment: 0.8283 is still above 0.7576, and the two-stage version of the arm is the shape that can close it.

### What this instrument can resolve

The shallow arm reproduced **0.6869 of a pool of 0.6869** against 0.6768 of 0.6869 the run before — one question, on
code that did not change. **The same one-question drift appears in every column that consumes a service**, and in no
column that does not:

| column                 | before | after  | consumes                   |
| ---------------------- | ------ | ------ | -------------------------- |
| lexical                | 0.3030 | 0.3030 | nothing                    |
| fused, weight 1        | 0.5960 | 0.5960 | the index vectors          |
| `no-path`, recall at 5 | 0.2424 | 0.2323 | a second embedding pass    |
| `hyde`                 | 0.6667 | 0.6566 | a completion, per question |
| `rerank`               | 0.6768 | 0.6869 | a completion, per question |

**So ±1 question is this instrument's resolution on the model arms and zero on the deterministic ones**, and a
difference inside it is not a finding. It is written down here because iteration 66 reported a one-question loss as if
it were one, and the honest reading — visible only once the same code had been measured twice — is that the arm did not
move at all.

## The third input, which nobody wrote

**Pinning the corpus pins its text, not the names derived from it.** A question in `paraphrase-queries.json` does not
name a line range; it names a **qualified name**, and that string is produced from the corpus by the resolver on every
run. An improvement to the resolver therefore renames answers that are the same declarations — and the tripwire fires,
correctly, because the keys no longer name anything.

Iteration 65 was the first change of that kind. It reads `abstract class` as a container, where before the abstract class
node was not a container at all and its members fell back to file scope, so the twelve questions about
`TreeSitterBaseProvider` moved from `checkExported` to `TreeSitterBaseProvider.checkExported`. **No declaration changed
and no question changed; the derivation did.**

`PARAPHRASE_REQUALIFY=1` is the mechanical exit, and it is an explicit act for the same reason regeneration is: it
rewrites a committed dataset. It needs no credential, because no model is asked anything.

```bash
PARAPHRASE_REQUALIFY=1 pnpm vitest run packages/intelligence/src/__tests__/paraphrase-search.test.ts
```

The rewrite is deliberately narrow. It moves `file::X` to `file::*.X` only when that suffix names **exactly one** node,
and it refuses everything else — a name the corpus has lost, and a suffix two symbols share. The one collision it does
resolve is the case that produced it: `extractSanitizers` is declared both by the class and by the `TaintProvider`
interface, and a key with **no** container in it could only have been written for a member of a body that was not a
container when the key was made — an `abstract class` or a class expression, both labelled `Class`. That reading is not a
guess about which symbol the question meant; it is the scoping rule that wrote the key, replayed.

Every move is recorded under `requalified` in the question set, with the reason and the date, so a reader of the file can
see that the derivation moved without having to find this note.

## Changing it

Editing a file here is the same kind of act as regenerating the questions, and has the same consequence: every figure
measured before the edit becomes incomparable. Two ways to do it on purpose:

1. **Adopt a newer snapshot** — replace this directory with the languages directory at the chosen commit, delete
   `benchmarks/paraphrase-queries.json`, and run the workflow with `PARAPHRASE_REGENERATE=1` so DeepSeek writes a
   question set for the corpus it will be measured on. Record the new baseline in `benchmarks/paraphrase-search.json`.
2. **Correct a mistake here** — fix only what is wrong, then regenerate the questions for the affected symbols.
3. **Re-qualify after a derivation change** — the section above. Nothing here and nothing in the questions changes; only
   the keys the questions are answered by, and `PARAPHRASE_REQUALIFY=1` writes them.

Editing this directory **without** doing one of those turns the assertion in `the frozen questions and the frozen corpus`
red, by design: it is the tripwire that says the two inputs have come apart.
