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
| graph  | 3 600 nodes when analysed by the code in this commit                                                                           |

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
**3 357 nodes**. This snapshot is the tree of 2026-10-29 and today's graph builder counts **3 600** nodes on it — the
directory gained code in between, and the phases that build the graph have changed since. So both figures are
**re-measured once** on the pinned corpus, and from then on they can only move with the retriever, which is the property
that was missing.

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
