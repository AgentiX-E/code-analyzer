# The unified knowledge layer: ontology, three projections, four arms, two stores

**Status** design, not implemented. Every figure in this document is either **measured** (with the artifact that measured it)
or **target** (a budget this design must later be held to, and which is `NOT_MEASURED` until the harness runs). The two
words are never used interchangeably.

**What this document replaces.** Thirteen intelligence modules that each parse the same files, produce their own indexes,
and answer in their own units: `cfg`, `community`, `cross-repo`, `cross-service`, `embeddings`, `impact`, `qa`, `search`,
`similarity`, `rules`, `security`, `standards`, `review`. A question that crosses two of them is answered by whichever one
the caller happened to reach.

---

## 1. What is being unified, and what is not

**Unified:** the _facts_ a review, a search, an impact analysis and a question all read, and the _place_ those facts live.

**Not unified:** the analysis itself. A taint engine, a community detector and a review judge do different things to the
same facts; forcing them into one algebra is how a system becomes unable to say anything sharply.

The distinction that matters is **fact vs. projection vs. answer**:

| layer          | what it is                                                            | may be rebuilt from                   | who writes it                     |
| -------------- | --------------------------------------------------------------------- | ------------------------------------- | --------------------------------- |
| **truth**      | the facts an extractor asserted, append-only, with provenance         | nothing - it is the input             | extractors, one writer per tenant |
| **projection** | a derived structure (adjacency, inverted index, vector list, closure) | truth + ontology version + backend id | the projector, idempotently       |
| **answer**     | claims with proof, produced for one question                          | projections + question                | the retriever and the judge       |

**A projection is never truth.** A closure fact carries `ruleId` and is regenerated; if the rule changes, the closure is
thrown away, not patched. This is the only rule that makes the whole design auditable, and it is the rule the previous
attachment violated by writing derived facts back into its truth set.

---

## 2. Layer model

```
L0  ontology/            schema.ts        classes, predicates, rules, constraints - as a source file
        |  compiled into  DDL | TS types | rule programs | constraint checks | fixtures
        v
L1  truth/               facts(seq, subject, predicate, object, ...)   append-only, digested
        |  project       graph | text | vector            versioned by (ontology, analyzer, embedder)
        v
L2  project/             three projections + per-projection digest + a coordinator that rebuilds by partition
        |  retrieve      graph | text | vector | symbolic     four arms, each returns an ordered list
        v
L3  retrieve/fuse.ts     RRF(k = 10)                       ranks only - scores never cross an arm
        |  answer        claims + evidence + proof(ruleId chain) + confidence + degradation note
        v
L4  answer/              AskRequest -> Answer
        |  present       single-file SPA: claims, evidence graph, proof panel, drill = next query
        v
L5  present/
```

`packages/knowledge` is the new package. Its dependency rule is the mirror of the current one: **it imports `shared` and
nothing else**; every third-party package enters through `store/local-sqlite.ts` or `store/remote-pg.ts` and nowhere else.
This is enforced by a lint rule, not by discipline.

---

## 3. The ontology is a source file, not a database

The attachment put the ontology in the truth set as quads. That makes the schema a runtime artifact: a typo in a shape
becomes a data error rather than a compile error, and no test can assert what the schema means.

**Here the ontology is a TypeScript module that is compiled into five artifacts:**

```ts
// packages/knowledge/src/ontology/schema.ts  (abridged)
export const CLASSES = {
  Symbol: {},
  Type: { sub: 'Symbol' },
  Class: { sub: ['Type'] },
  Interface: { sub: ['Type'] },
  Function: { sub: ['Symbol'] },
  Method: { sub: ['Function'] },
  PublicMethod: { sub: ['Method'] },
  Module: { sub: ['Symbol'] },
  File: { sub: ['Symbol'] },
  Service: { sub: ['Class'] },
  Repository: { sub: ['Class'] },
} as const;

export const PREDICATES = {
  calls: { from: 'Symbol', to: 'Symbol', transitive: true },
  dependsOn: { from: 'Symbol', to: 'Symbol', transitive: true },
  implements: { from: 'Class', to: 'Interface', implies: 'dependsOn' },
  extends: { from: 'Class', to: 'Class', implies: 'dependsOn' },
  references: { from: 'Symbol', to: 'Symbol', implies: 'dependsOn' },
  declaredIn: { from: 'Symbol', to: 'File' },
  documentedBy: { from: 'Symbol', to: 'Symbol' },
} as const;

export const RULES = [
  { id: 'rdfs9', body: ['type(x,C)', 'subClassOf(C,D)'], head: 'type(x,D)' },
  { id: 'rdfs5', body: ['subPropertyOf(p,q)', 'subPropertyOf(q,r)'], head: 'subPropertyOf(p,r)' },
  { id: 'rdfs11', body: ['subClassOf(C,D)', 'subClassOf(D,E)'], head: 'subClassOf(C,E)' },
  { id: 'prp-spo1', body: ['subPropertyOf(p,q)', 'p(x,y)'], head: 'q(x,y)' },
] as const;

export const CONSTRAINTS = [
  {
    id: 'svc-not-repo',
    severity: 'violation',
    check: 'NOT exists(dependsOn(Service, Repository))',
    message: 'A service must not depend on a repository',
  },
  {
    id: 'public-doc',
    severity: 'warning',
    minCount: 1,
    check: 'minCount(documentedBy, PublicMethod, 1)',
    message: 'A public method is undocumented',
  },
] as const;
```

Compilation (`ontology/compile.ts`) produces, from that one file:

1. **DDL** - the `NOT NULL`/`CHECK` clauses and the partial indexes the facts table needs.
2. **Types** - `type Fact<S extends Subject, P extends Predicate, O>` so an extractor cannot assert `calls` from a `File` to
   a `Service` without a compile error.
3. **Rule programs** - the four rules above as a stratified, semi-naive evaluator over the facts table.
4. **Constraint checks** - each `check` string is compiled to a parameterised SQL predicate _and_ to a TS predicate; the two
   are asserted equal on a fixture corpus. **A constraint that lives in data is a constraint no test covers; a constraint
   that is generated from data and asserted by tests is both configurable and covered.** This is the resolution of the
   SHACL-vs-coverage conflict: the _authoring_ is declarative, the _execution_ is code.
5. **Fixtures** - one positive and one negative example per rule and per constraint, generated into the test suite so a
   schema edit that breaks a rule fails a test rather than a customer.

**Interoperability is an export, not a storage format.** `export/nquads.ts` emits the facts as N-Quads. That export is what
gets run against the W3C RDF 1.1 / RDFS entailment test suites - so the ontology earns an _external_ conformance statement
without RDF becoming the store. Optional, one function, ~80 lines.

**What was deliberately dropped:** OWL DL, `disjointWith`, SPARQL as an internal API, SHACL as a runtime engine. Each is a
way to pay for generality the product never spends: the classes here are 11, the predicates 16, and the questions asked of
them are known.

---

## 4. Truth: an append-only fact log

```sql
CREATE TABLE facts (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,   -- BIGSERIAL on postgres
  tenant       TEXT    NOT NULL,
  subject      TEXT    NOT NULL,                    -- symbol id: repo:path#qualifiedName
  predicate    TEXT    NOT NULL,                    -- 'calls' | 'dependsOn' | ...
  object       TEXT    NOT NULL,
  state        TEXT    NOT NULL DEFAULT 'asserted', -- asserted | unresolved | retracted
  commit_sha   TEXT,
  extractor    TEXT,
  produced_at  TEXT    NOT NULL,
  idem_key     TEXT    NOT NULL,                    -- sha256(tenant|subject|predicate|object|state)
  UNIQUE (tenant, idem_key)
);
CREATE INDEX facts_spo ON facts (tenant, subject, predicate);
CREATE INDEX facts_pos ON facts (tenant, predicate, object);   -- reverse reachability
```

Five properties, and each one is load-bearing:

1. **`state` is three-valued.** `unresolved` is a fact - "a call exists and we could not resolve its target". It never
   enters a projection as an edge. Silently dropping it is what turns a resolved-zero into a false "no dependents".
2. **`idem_key` makes append idempotent** without a transaction spanning the client and the server: replaying a webhook
   delivery is a no-op, which is the only distributed guarantee this product needs.
3. **`produced_at` + `commit_sha` + `extractor` are on every row**, so any claim can be traced to the code and the tool that
   produced it, per finding, not per answer.
4. **Retraction is a fact, not a delete.** A deleted symbol keeps its history, which is what makes "this was removed in
   this PR" answerable and makes a digest comparable across time.
5. **Truth is small.** Facts are ids and predicates, not text, not vectors. On the 50-pull-request slice of Alibaba's `aacr-bench` that this repository runs, a review pass is ~10^5 facts
   ~ tens of MB. Text and vectors live in projections and can be regenerated from the files at any time.

**Where truth physically lives:** in the _same store_ as the projections - SQLite file for local, Postgres for remote. Not
in a separate log file, not in a frame format, not in an object store. One deployment = one thing to back up.

---

## 5. Projections: three, versioned, digested

| projection | local (SQLite)                         | remote (Postgres)               | versioned by          |
| ---------- | -------------------------------------- | ------------------------------- | --------------------- |
| `graph`    | adjacency over `facts` + closure table | same, plus recursive CTE        | `ontology_version`    |
| `text`     | FTS5 virtual table, `bm25()`           | `tsvector` + GIN, `ts_rank_cd`  | `analyzer_version`    |
| `vector`   | `sqlite-vec` `vec0` table (float32)    | `pgvector` `vector(768)` + HNSW | `embedder_id` + `dim` |

Each projection has a **version tuple** and a **digest**:

```sql
CREATE TABLE projections (
  name       TEXT NOT NULL,          -- graph | text | vector
  version    TEXT NOT NULL,          -- ontology@3|analyzer@7   /   embedder@zhipu-3-768
  digest     TEXT NOT NULL,          -- sha256 over sorted member keys + content hashes
  rows       INTEGER NOT NULL,
  built_at   TEXT NOT NULL,
  PRIMARY KEY (name, version)
);
```

The tuple is the whole trick. **A projection built under a different version is not stale, it is absent** - it is not
consulted, not patched, and not compared. A schema change or an embedder change therefore cannot produce a mixed answer,
which is the defect class the attachment's `placement` idea was reaching for; here it falls out of the key.

### Vector projection, honestly sized

`sqlite-vec` 0.1.x is brute-force KNN: a 768-d scan of 50 000 vectors is ~154 MB of float32 per query. In C with SIMD that
is single-digit milliseconds - acceptable for a 50 k-symbol repository, and the measured version of that claim is a gate,
not a sentence (see §16). Above ~200 k vectors the design switches to `usearch` as an _ephemeral_ accelerator rebuilt from
the `vector` table at startup: still one durable store, one extra in-memory structure. Remote uses `pgvector` HNSW, which
has no such ceiling.

---

## 6. One port, two adapters, no third

```ts
// packages/knowledge/src/store/port.ts
export interface StorePort {
  // truth
  append(facts: NewFact[]): Promise<{ seq: number; inserted: number }>;
  readFacts(fromSeq: number, limit: number): Promise<Fact[]>;
  watermark(): Promise<number>;
  // projections
  writeProjection(name: ProjectionName, version: string, rows: ProjectionRow[]): Promise<void>;
  dropProjection(name: ProjectionName): Promise<void>;
  digest(name: ProjectionName): Promise<string>;
  // retrieval
  graph(
    start: SymbolId,
    predicates: Predicate[],
    maxDepth: number,
    budget: number,
  ): Promise<Path[]>;
  text(terms: string[], k: number): Promise<Hit[]>;
  vector(vec: Float32Array, k: number): Promise<Hit[]>;
  // distributed
  subscribe?(onDelta: (d: DeltaNotice) => void): Promise<Unsubscribe>;
  capabilities(): Capabilities;
}

export interface Capabilities {
  notify: boolean; // pg: true, sqlite: false
  nativeVector: boolean; // pgvector: true, sqlite-vec: true, brute force: false
  ftsRank: 'bm25' | 'ts_rank_cd' | 'none';
}
```

**`LocalSqlite` and `RemotePg` are the only two implementations, and they are tested against the same conformance suite.**
The suite is the product of this interface: every `StorePort` method has a fixture, and a new adapter that passes it is
admissible; an adapter that does not is not.

Two capability differences are real and are not smoothed over:

- `ftsRank` differs (`bm25` vs `ts_rank_cd`). **This is why fusion is rank-based.** `RRF(k=10)` never compares a BM25 score
  to a `ts_rank_cd` score, so the two stores can disagree about magnitudes and still produce the same order. Our own
  measurement selected `k = 10` in all three folds with held-out gains of +0.0316 / +0.0025 / +0.0028 on the language
  folds it was fitted on - that is the evidence this design leans on, and it is why the fusion layer is not negotiable.
- `notify` exists only on Postgres. Local single-process deployments poll the watermark at query time, which costs one
  indexed read.

**What is explicitly not abstracted:** no `StorageDriver` registry, no candidate list, no hot switch. Two adapters, chosen at
construction from a connection string. A third would have to pass the conformance suite and justify itself; the design does
not pre-build the slot for it.

---

## 7. Retrieval: four arms, ranks only

| arm        | input                                   | local              | remote          | returns                                   |
| ---------- | --------------------------------------- | ------------------ | --------------- | ----------------------------------------- |
| `symbolic` | exact id / qualified name / regex       | `facts` lookup     | same            | exact hits, no ranking needed             |
| `graph`    | start symbol + predicate + depth budget | closure table walk | recursive CTE   | paths, each with the fact seqs it crossed |
| `text`     | tokenised question terms                | FTS5 `bm25()`      | `ts_rank_cd`    | symbol hits                               |
| `vector`   | query embedding                         | `sqlite-vec` kNN   | `pgvector` HNSW | symbol hits                               |

Fusion: `score(d) = Σ_arms 1 / (k + rank_arm(d))`, `k = 10`, ties broken by `symbolic > graph > text > vector` and then by
symbol id so the output is deterministic. **A document found by one arm only is not penalised** - RRF is rank-based, and
this is the property that keeps a rare exact match from being buried by a popular vector neighbour.

Each arm is _independently_ ablatable: removing it changes the fused list, and the delta is measurable on the same corpus
with the same paired bootstrap the review score already uses (§16). That is the difference between a retrieval design and a
retrieval opinion.

---

## 8. Reasoning: four rules, bounded, with a proof

The evaluator is ~200 lines: stratified semi-naive evaluation over `facts`, `MAX_ITERATIONS = 64`, no function symbols, no
existentials, no negation across strata. It produces **derived facts that carry `ruleId` and their premises**, and those are
what the `graph` arm returns as a `Path`:

```ts
interface ProofStep {
  ruleId: string;
  premises: FactRef[];
  conclusion: FactRef;
}
interface Path {
  steps: ProofStep[];
  depth: number;
  truncated: boolean;
}
```

`truncated: true` is a first-class output. The current impact analyzer stops at depth 3 and reports "no impact" beyond it;
that is a **false negative the product publishes as a fact**. The new arm either returns a path or returns
`truncated: true` with the budget it hit, and the presentation layer renders it as "unknown beyond 3 hops", never as "none".

Reasoning is where the attachment's O1 number came from, and it is worth restating why that number does not transfer: its
baseline was "asserted edges only", while this product has traversed transitively since it shipped. The gain here is not
from adding closure - closure already exists - **it is from making the closure's boundary explicit and provable.**

---

## 9. Constraints: authored declaratively, executed as code

§3 compiles `CONSTRAINTS` into a SQL predicate and a TS predicate, asserted equal on fixtures. Consequences:

- a customer can add a constraint by editing one file and running `pnpm gen:ontology` - no engine change;
- every constraint is inside the coverage gate, because it exists as code at build time;
- a constraint is ablatable: turn it off, re-run the violation corpus, read the delta (§16).

The attachment's SHACL shapes get the same _capability_ by a different route. What they cannot do here is be invisible to
the coverage instrument, which is the property this repository refuses to give up - `v8 ignore` removal is an ongoing
refactor precisely because untested branches were where the bugs lived.

---

## 10. Answer, proof, presentation

```ts
interface Claim {
  id: string;
  text: string; // the sentence a reviewer would read
  subject: SymbolId;
  evidence: EvidenceRef[]; // file@line, fact seq, commit
  proof: ProofStep[]; // empty for asserted facts
  confidence: 'exact' | 'derived' | 'uncertain';
  arms: ArmId[]; // which arms surfaced it
}
interface Answer {
  question: string;
  claims: Claim[];
  meta: {
    watermark: number;
    digests: Record<string, string>;
    placement: Placement;
    degraded: string[];
  };
  errors: string[];
}
```

**Presentation is a single file.** `present/spa.ts` emits one HTML document with `window.__ANSWER__` embedded, no
`<script src>`, no `<link href>`, no `fetch`, and a CSP that forbids all three. It is checkable by a test rather than by an
assertion: parse the output, fail on any external reference.

Three panes, in the order a person reads:

1. **claims** - one line each, confidence-marked, keyboard-navigable (`j`/`k`), each carrying its own evidence count.
2. **evidence graph** - deterministic radial layout, asserted edges solid, derived edges dashed and labelled with `ruleId`,
   every node clickable to `file@line`.
3. **why panel** - the proof chain for the selected claim, premises expandable down to the fact row, plus the arms that
   surfaced it and the watermark the answer was computed at.

`drill(node)` does not re-render in place: it writes `window.__PENDING_QUERY__` and the host issues the next `AskRequest`
with `focus = node`. **The report is a view of an Answer; the next report is a view of the next Answer.** That indirection
is what makes a report an audit artifact - it can be re-derived later from the watermark and the digests it recorded.

---

## 11. PR indexing, and the blast radius that is actually honest

A PR is a first-class entity in the fact set, not a special case in the analyzer:

```
pr(repo, number, base_sha, head_sha)
hunk(pr, file, start, end, text_digest)
touches(pr, symbol)                 -- symbol identity resolved at head
changes(pr, symbol, kind)           -- added | modified | removed | renamed
affected(pr, symbol, hops)          -- derived, with ruleId + path
```

**The diff is indexed, and it is indexed as facts, not as text.** The `hunk` rows carry a `text_digest`, so a re-push that
changes nothing but whitespace does not invalidate a projection. The review path then asks the `graph` arm for reverse
reachability from `touches(pr, *)` with a depth budget, which yields `affected` with paths.

**Where blast radius lies today, and how it stops lying:**

| today                            | consequence                          | fix                                                                   |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| depth 3, then "no impact"        | a 5-hop breakage is reported as none | `truncated` as a first-class output                                   |
| unresolved imports dropped       | cross-repo dependents invisible      | `state = unresolved` facts, surfaced as "unknown", counted in a probe |
| generated code indexed as source | false dependents                     | `generated-detector` marks them, they never enter `affected`          |
| dynamic dispatch / reflection    | missing edges                        | declared as a known gap, with a per-language recall probe             |

The honest presentation of a blast radius is a **set plus a boundary**: `{k symbols at 1-3 hops} ∪ {truncated at 3 hops} ∪
{unresolved edges: n}`. Three numbers, not one.

---

## 12. Incremental path

```
file changed
  -> content hash differs (cheap, already implemented in infra/cache)
  -> re-extract that file's symbols only            O(fragment)
  -> diff old vs new fact sets for those subjects   O(|Δ|)
  -> append Δ (+ retractions), one seq           O(|Δ|)
  -> graph: rebuild out-edges of dirty subjects;
            reverse BFS to find upstream starts whose paths changed
  -> text: update those rows' FTS entries            O(|Δ| log n)
  -> vector: upsert (symbol, embedder) pairs only    O(|Δ| · batch)
  -> closure: recompute only strata touched by Δ;
              schema/class-hierarchy change -> full closure (rule in schema.ts, not a policy)
  -> digests: xor/sha over changed members only      O(|Δ|)
```

Two constraints that make it correct rather than fast: **the coordinator refuses to publish a digest it cannot recompute
from scratch**, and **a class-hierarchy change always escalates to full closure** (the one case where a local change has a
global consequence). Both are asserted, not documented.

`infra/cache` already does the first step (file-level SHA-256 change detection) and nothing consumes it: `ContentCache` and
`ParseCache` are referenced nowhere outside `packages/infra`. **The single highest-value product fix in this whole design is
plumbing that existing detector into the review path** - it costs a day and it removes the full re-scan that every PR push
currently pays.

---

## 13. Distributed: one writer, a watermark, and a rebuild

Postgres is the remote truth. There is exactly one writer per tenant - the webhook handler - and any number of readers.

```sql
-- write (single statement, idempotent)
INSERT INTO facts (tenant, subject, predicate, object, state, commit_sha, extractor, produced_at, idem_key)
VALUES (...), (...) ON CONFLICT (tenant, idem_key) DO NOTHING
RETURNING seq;

-- notify carries identity, never data (payload limit is 8 kB; a hunk is bigger)
SELECT pg_notify('knowledge_delta', json_build_object(
  'tenant', $1, 'seq', $2, 'digest', $3)::text);
```

Instance loop:

1. `LISTEN knowledge_delta`; on any notice, read `readFacts(localSeq, batch)` - **the notice is a hint, the table is the
   truth**, because `NOTIFY` is not durable and a listener that was down misses it.
2. Apply Δ idempotently (guarded by `seq > localSeq`), then compare the three projection digests against the authority.
3. Match -> done. Mismatch -> drop the projection by name and rebuild from truth. **Never patch a projection.**
4. Every _K_ catch-ups, or on a schedule, sample a projection's digest against a second instance: a disagreement names an
   outlier, which is the only way silent drift (a projection mutated by something other than the projector) is caught.
5. On cold start: load the newest snapshot (below), then replay `seq > snapshot.seq`.

Snapshots are **content-addressed projection dumps**, one per projection, named by digest, written by the projector after a
full rebuild. They are a cache, not a truth: deleting all of them costs a rebuild and nothing else.

**Consistency statement this design makes, and the one it refuses to make:** a reader never sees a projection from a
different ontology/embedder version than the one it asked for (that is enforced by the version tuple in the key). A reader
_may_ see a projection that is a few seconds behind truth during catch-up; the `Answer.meta.watermark` says exactly how far
behind, so a caller can decide. It does not offer linearizability, and pretending otherwise would be the same error as
publishing a truncated blast radius as a complete one.

---

## 14. Corruption: how it is detected, and what a rebuild costs

| failure                                 | detection                                     | recovery                            |
| --------------------------------------- | --------------------------------------------- | ----------------------------------- |
| partial write of a projection           | digest mismatch on catch-up                   | drop + rebuild that projection      |
| wrong version consulted                 | version tuple in the key makes it unreachable | none needed                         |
| silently mutated row                    | second-instance sample disagreement           | name the outlier, rebuild           |
| truncated facts (writer died mid-batch) | `seq` gap                                     | re-read from last contiguous seq    |
| stale snapshot                          | snapshot digest != rebuild digest             | ignore snapshot, rebuild            |
| wrong embedder used                     | `embedder_id` in the vector version           | vector projection absent, not wrong |

**Rebuild time is a measured quantity, not a claim.** The harness (§16) reports, per tier: full rebuild of each projection,
closure rebuild, and cold start, at p50/p95, with RSS. Budgets this design is held to - and which are `NOT_MEASURED` until
the first run:

| tier           | symbols |                       full rebuild (target) | incremental (target) |
| -------------- | ------: | ------------------------------------------: | -------------------: |
| small repo     |   5 000 |                                     <= 10 s |            <= 300 ms |
| monorepo       |  50 000 |                                    <= 120 s |               <= 2 s |
| large monorepo | 500 000 | <= 20 min (snapshot-assisted start <= 60 s) |               <= 5 s |

If the harness says otherwise, the number published is the harness's, and the budget is wrong.

---

## 15. Build vs. buy

**Buy (five packages, all through adapters):**

| package          | version (published)  | why this one                                                                                          | why not the alternative                                                                                                                                                                                     |
| ---------------- | -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `better-sqlite3` | 13.2.0 (2026-11-14)  | synchronous, in-process, prebuilt binaries for every CI target, FTS5 compiled in, one file to back up | `node:sqlite` is still experimental on Node 22 with a thinner API; `sql.js` is WASM with a full copy-in-memory cost; `duckdb` is a second engine with its own file format and no transactional writer story |
| `sqlite-vec`     | 0.1.9 (2026-05-18)   | keeps vectors in the same file as truth, C with SIMD, `vec0` virtual table                            | `hnswlib-node` last published 2024-03 (abandoned); `voyager` last published 2022 (dead); a second store (`@lancedb/lancedb`) means two things to back up and two failure modes                              |
| `pg`             | 8.23.1 (2026-09-30)  | mature pool, `LISTEN/NOTIFY` support, the driver every Postgres tool assumes                          | `postgres` (porsager) is faster but smaller ecosystem and its tagged-template API leaks into call sites                                                                                                     |
| `usearch`        | 2.26.5 (2026-10-18)  | optional in-memory HNSW above ~200 k vectors; active; SIMD                                            | only justified past the ceiling `sqlite-vec` has; kept out of the default path                                                                                                                              |
| `n3`             | 2.13.12 (2026-10-10) | N-Quads export for W3C conformance tests only - **not** a storage format                              | `oxigraph` would be a second truth; it is admitted as a dev dependency _oracle_ for the entailment tests, nothing more                                                                                      |

**Build (everything that decides an answer):** the ontology compiler, the rule evaluator with proofs, the projector and its
digests, the four arms, rank fusion, claim/evidence/proof model, the constraint compiler, the SPA renderer, and both
adapters' SQL. Roughly 4 000 lines, every one of them under the 95 % per-dimension gate.

The dividing line is **"would a bug here be our bug?"** A wrong BM25 score is SQLite's bug and SQLite has tests. A wrong
`affected` set is our bug and nobody else will ever test it. The attachment's "zero third-party dependency" principle is
the opposite rule, and it is why that design had to write its own storage, its own text index and its own snapshot format -
three places where a bug is invisible and unauditable.

---

## 16. Evaluation: authority per capability

| capability                    | authority                                                                                          | what is measured                                              | gate                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ontology entailment (4 rules) | W3C RDF 1.1 / RDFS entailment test suites, run against the N-Quads export                          | pass/fail per test, EARL report                               | 100 % of tests in the declared regime                                                              |
| rule evaluation at scale      | LUBM (UBA, `-index 0 -seed 0`)                                                                     | load + closure time, answer equality vs the reference answers | 14 queries, answers equal                                                                          |
| text retrieval                | BEIR subset (declared) + our own corpus                                                            | nDCG@10, Recall@k                                             | no regression vs FTS-only baseline; TOST equivalence when claiming parity                          |
| vector retrieval              | MTEB retrieval track (declared subset)                                                             | nDCG@10                                                       | same                                                                                               |
| fusion                        | our paired corpus                                                                                  | ΔF1 per arm ablation, bootstrap 2 000, McNemar exact, Holm    | delta must exceed the resolution (0.0126 F1 on the current 50-PR `aacr-bench` slice) to be claimed |
| review quality                | Alibaba `aacr-bench` (two slices) + Martian Core                                                   | P/R/F1, judged by the disclosed judge model                   | no regression; direction claims only above MDE                                                     |
| distributed correctness       | fault injection: dropped NOTIFY, killed writer mid-batch, mutated projection row, delayed instance | convergence, digest equality, no duplicate facts              | every scenario converges; zero duplicate `idem_key`                                                |
| store conformance             | one suite, two adapters                                                                            | same query, same answer, same order                           | 100 % of fixtures on both                                                                          |
| performance                   | tiered harness, p50/p95, RSS                                                                       | rebuild, incremental, query latency                           | budgets in §14; regression > 10 % fails CI                                                         |
| product SLO                   | end-to-end harness                                                                                 | PR time, watch latency, first-run index time                  | the numbers in §14                                                                                 |

Two rules make this more than a list:

1. **Every ablation is paired on the same corpus, and every claim of improvement is compared to the resolution of that
   corpus first.** On the current 50-PR `aacr-bench` artifact the minimum detectable difference is 0.0126 F1 (4.8 true positives); a
   device worth 1-3 comments cannot be shown to work, and the harness says so before it is built.
2. **A capability with no authority is `NOT_MEASURED`, not "done".** This is the discipline whose absence let a 3 242-line
   subsystem be described as 36 passing features with 78 external references, none executed.

---

## 17. Performance monitoring

- **Spans** (`OpenTelemetry`) per phase: extract, project(graph|text|vector), fuse, answer, present. Each span records
  `symbols`, `delta`, `bytes`.
- **Continuous metrics**: watermark lag (seconds behind truth), rebuild count per hour, projection row counts vs. expected,
  p95 query latency per arm, cache hit rate.
- **Alerts** on: watermark lag > 60 s, any rebuild of `vector` in steady state (means the digest is flapping), p95 query
  above budget for 10 minutes, unresolved-edge ratio rising (a resolution regression, not a performance one).
- **Regression gate in CI**: `benchmark-regression.yml` already exists; it gains the tiered index benchmark so a PR that
  makes indexing 30 % slower cannot merge silently.

---

## 18. Migration, without a big bang

The thirteen modules are not deleted; they are **demoted to consumers of the index** in four steps:

1. Ship `packages/knowledge` with the local adapter only, and wire **one** consumer: the review path. Measure.
2. Move `impact` and `search` onto `StorePort`; keep their public signatures. Differential-test old vs new on the corpus
   (same input, compare answers; any difference is investigated, not accepted).
3. Add the remote adapter and the distributed loop; run the fault-injection scenarios.
4. Retire the internal indexes that duplication made unnecessary. **Only after** step 2's differential test is empty.

A module that cannot be moved is allowed to stay. The failure mode to avoid is a half-migrated system where two answers
exist and neither is authoritative.

---

## 19. Decision register

| #   | item                                                      | decision        | reason                                                                      |
| --- | --------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| 1   | Ontology as a compiled source file                        | **accept**      | configurable + covered; the only way to have both                           |
| 2   | Ontology as RDF quads in the truth set                    | reject          | schema becomes runtime data; no test can assert its meaning                 |
| 3   | OWL DL / disjointness / SPARQL internal API               | reject          | pays for generality never spent; 11 classes, 16 predicates                  |
| 4   | N-Quads export + W3C entailment conformance               | **accept**      | external authority at ~80 lines                                             |
| 5   | Append-only fact log with idempotency key                 | **accept**      | the only distributed guarantee the product needs                            |
| 6   | Three-valued fact state (`asserted/unresolved/retracted`) | **accept**      | dropping unresolved facts is what produces false "no dependents"            |
| 7   | Three projections, versioned by tuple                     | **accept**      | a projection under a different version is absent, not stale                 |
| 8   | Five projects / XOR algebra / broadcast摘要               | reject          | three projections and a digest are enough; XOR cannot localise a difference |
| 9   | Custom frame + CRC snapshot format                        | reject          | content-addressed projection dumps; no new binary format to maintain        |
| 10  | `StorePort` with exactly two adapters                     | **accept**      | one conformance suite; no driver registry, no hot switch                    |
| 11  | Rank fusion only (RRF k=10)                               | **accept**      | cross-engine scores are incomparable; k=10 is our own measurement           |
| 12  | Score-level fusion                                        | reject          | mixes BM25 with cosine with no common unit                                  |
| 13  | Four rules, semi-naive, proof-carrying                    | **accept**      | bounded, explainable, ablatable                                             |
| 14  | Closure depth cap without `truncated`                     | reject          | a silent cap is a published false negative                                  |
| 15  | Constraints compiled to SQL + TS + tests                  | **accept**      | declarative authoring, covered execution                                    |
| 16  | SHACL as the runtime engine                               | reject          | invisible to the coverage gate; not ablatable                               |
| 17  | Single-file SPA with embedded answer                      | **accept**      | audit artifact, offline, testable for self-containment                      |
| 18  | `window.__PENDING_QUERY__` as a host protocol             | reject          | product-internal; use the existing `AskRequest`                             |
| 19  | PR as facts; diff indexed as hunks with digests           | **accept**      | re-push with no semantic change costs nothing                               |
| 20  | Blast radius = set + boundary                             | **accept**      | three numbers instead of one false certainty                                |
| 21  | Postgres truth, one writer, `NOTIFY` as hint              | **accept**      | not durable by design; the table is truth                                   |
| 22  | Multi-writer, stateless instances, majority vote          | reject          | no second writer exists; complexity with no user-visible benefit            |
| 23  | Digest-gated rebuild, never patch                         | **accept**      | the only recovery that cannot corrupt                                       |
| 24  | Plumbing `ContentCache` into the review path              | **accept (P0)** | currently nothing consumes it; every push re-scans                          |
| 25  | Vector backend identity in the projection version         | **accept (P0)** | 768-d ONNX and 768-d mock vectors are silently comparable today             |

---

## 20. What would falsify this design

1. If the differential test in migration step 2 shows the new retrieval changes review outcomes by more than the corpus
   resolution and in the wrong direction, the fused arms are wrong and this design's §7 is wrong with them.
2. If `sqlite-vec` brute force exceeds 50 ms p95 at 50 k symbols on the target hardware, the local adapter needs `usearch`
   in the default path, and "one durable store" becomes "one store + one ephemeral index" - an honest, smaller claim.
3. If the W3C entailment suite reveals our four rules are not a coherent subset (e.g. a test needs negation), the rule set
   shrinks and the conformance claim narrows to the tests declared.
4. If `pgvector` HNSW recall at the configured `ef_search` is below the vector arm's measured contribution, the arm is
   compensating for a bad index, not adding evidence.
