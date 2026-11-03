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
