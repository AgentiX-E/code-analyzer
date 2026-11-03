#!/usr/bin/env node
// The gate over `benchmarks/callgraph-quality.json` and `benchmarks/callgraph-ts-quality.json`.
//
// **Every other gate in this repository holds a count.** This one holds an accuracy, because the call graph had
// counts and no accuracy: the pass that produced most of its edges was a cartesian product, and nothing in the
// repository could tell. The figures are produced by two independent implementations that read nothing this one
// writes - `scripts/callgraph-oracle.py`, which parses the checkout with CPython's `ast`, and
// `scripts/callgraph-oracle-ts.mjs`, which asks the TypeScript checker.
//
// **Precision and recall are both floors, and the floor on precision is the higher of the two.** A graph can raise
// its recall by guessing and its precision by staying silent, so a gate that watched one would be satisfied by the
// other. Recall has the lower floor because the resolution is deliberately conservative: it refuses a name declared
// twice rather than picking one.
//
// **The arm floors are the reason this gate has a second dimension.** An aggregate hides a bad arm inside a good one:
// `redis/ioredis` once read 92 % precision while an arm that resolved a name unique to the whole graph contributed
// nothing correct at all, and only a per-arm floor could say so. That arm is gone - it claimed 16 edges across the two
// TypeScript checkouts of which **0** were right - and the floors below are what hold its replacement, the class chain,
// to the same scrutiny.
//
// **An arm that stops firing is also a failure**, because a missing arm has no precision to compare and the gate
// reports it as absent rather than skipping it. That is what holds the newest arm - `receiverType`, the one that reads
// a field's declared type - to the thing it was built for: resolving calls, not merely being present in the code.
//
// Usage: node scripts/callgraph-gate.js [--file benchmarks/callgraph-quality.json]

const { readFileSync, appendFileSync } = require('node:fs');

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'benchmarks/callgraph-quality.json';

/**
 * Floors per corpus, measured on the released checkout of that corpus.
 *
 * **A single global floor would be set by the weakest corpus and would then never move.** These are the measured
 * values with the smallest headroom that still tolerates parser drift: the figure a regression has to move by more
 * than one edge to trip.
 */
const PYTHON_FLOORS = {
  // **The recall floors fell when the oracle learned to read annotations, and that is the figure moving, not the
  // graph.** `call_target` used to require a bare name as the receiver, so `self.field.m()` was never classified and
  // the product's resolution of it could only be scored wrong; the oracle now derives an expected pair for those
  // sites - 4 more on flask and 28 more on werkzeug - and the product does not answer all of them. Precision did not
  // fall: it rose, on 7 new edges of which all 7 are correct.
  //
  // **The class chain is what raised these again.** `inherited` and `super` answer the calls a base class declares -
  // `self._find_error_handler(...)` in `flask/app.py` reaching `App` in `sansio/app.py`, `super().__init__(...)` in
  // werkzeug's middleware - and both read a statement the source makes rather than a name that happens to be unique:
  // 9 of 9 right on flask and 3 of 3. The floors follow the measurement, not the other way round.
  //
  // **Recall rose ten points on flask when the project's own import roots were read from its files.** The arm had
  // been there since the iteration before and resolved nothing, because it recorded a package's own directory as that
  // package's root; `examples/tutorial/flaskr/__init__.py` therefore made the resolver look for
  // `examples/tutorial/flaskr/flaskr/db.py`. A test asking where the root of `flaskr` is found the defect, and 51
  // import edges - the whole example and test suite of the checkout - followed.
  // **And the class a call names, which the oracle could not see at all.** `MultiDict.add(self, key, value)` in
  // `werkzeug/datastructures/structures.py` is a call to a method the class declares, and CPython resolves it by
  // searching the class dict and then the MRO - but `callgraph-oracle.py` had no arm for a receiver that names a
  // class, so it answered `silent` and **7 correct edges on werkzeug were scored as 7 wrong claims**. The arm is in
  // the oracle now and the product answers 32 of the pairs it produces, all 32 correct.
  //
  // **The namespace arm has a floor now, because it has a name now.** `cli.load_dotenv()` and `z.parse(…)` were
  // recorded as `import` for as long as the arm existed - the label was the variable's default rather than a statement
  // about the rule - so the gate's `import` figure was an average of two rules and this one had nowhere to be measured.
  // Separating them found the four edges that were wrong: `tests/test_cli.py` imports `cli` and then opens two tests
  // with `def cli(): …` and `@cli.command()`, and the decorator names that local function. With the alias required to
  // still be a module at the call site, flask's precision moved 97.1 % -> 98.2 % on 4 fewer claims and recall did not
  // move at all.
  // **Iteration 55 moved both figures, and the one edge that moved precision down is a correct one.** Four rules
  // landed together and they are one idea: an ambiguity has to mean *two different things*, not two spellings of one.
  //
  // - A `.pyi` stub beside a module is that module restated, not a rival class: **33 class names in this checkout** were
  //   unanswerable because both files declare them, and `self.headers.get(...)` - whose annotation sits four lines above
  //   the class - resolved to nothing.
  // - A name a package re-exports is the package's name: `from werkzeug.wrappers import Request` reaches
  //   `wrappers/request.py` through `wrappers/__init__.py`, which declares nothing.
  // - A name declared more than once is one name, and the last declaration runs: `flask/cli.py`'s three `locate_app`s
  //   are one function, and refusing the name left `load_app`'s two calls with no target.
  // - A bare call the file binds - by import or by `const` - is not a member of the enclosing class.
  //
  // werkzeug: recall 94.5 % -> 96.7 % on 30 more claims, precision 98.2 % -> 98.0 %. flask: recall 97.7 % -> 97.9 %,
  // precision 98.2 % -> 97.9 % on **one** additional claim - `app.app_context()` in `examples/celery`, where `app` is a
  // parameter of an enclosing function and the report records the cause as `silent-receiver`: CPython's `ast` cannot
  // type a closure-captured parameter, so it neither corraborates the edge nor contradicts it. The arm floor below
  // follows the measurement at that scale rather than pretending a ratio of one claim means what a ratio of a
  // thousand does.
  'pallets/flask': {
    precision: 0.975,
    recall: 0.97,
    claimed: 335,
    arms: {
      import: 0.9,
      inherited: 0.99,
      namespace: 0.99,
      receiverType: 0.8,
      sameFile: 0.96,
      static: 0.99,
      super: 0.99,
    },
  },
  'pallets/werkzeug': {
    precision: 0.97,
    recall: 0.96,
    claimed: 1260,
    arms: {
      import: 0.97,
      inherited: 0.99,
      namespace: 0.96,
      receiverType: 0.95,
      sameFile: 0.95,
      static: 0.99,
    },
  },
};

/**
 * Floors for the TypeScript corpora, measured on `colinhacks/zod@v3.23.8` and `redis/ioredis@v5.4.2`.
 *
 * **`claimed` is the crash floor as well as a volume floor.** A corpus that produced no call graph at all - which is
 * what `redis/ioredis` did before the doc-comment pass stopped overflowing the stack - reports zero claimed edges,
 * and a floor on the count is the only figure that notices.
 *
 * **Recall on both is the honest gap, not a floor that was chosen.** `zod` writes most of its calls as generic
 * `Type.ast` dispatch on union members, and ioredis routes through a command table it builds at runtime; neither is a
 * name a resolver can walk to. The product answers 79.1 % and 85.2 % of what the checker expects and refuses the rest
 * rather than guessing, which is why precision on the same corpora is 100 % on both.
 *
 * **Ten points of that recall came from two spellings of a named function that were not declarations.** `const f =
 * function (args) {…}` was captured as a constant and `class C { static m = () => {…} }` as a field type, so neither
 * body had a declaration to belong to: ioredis's fifteen argument and reply transformers and zod's thirty-five field
 * arrows were invisible as callers. With them captured, zod's recall moved 66.9 % -> 78.7 % and ioredis's 71.9 % ->
 * 73.8 %, on precision that did not fall.
 */
const TYPESCRIPT_FLOORS = {
  // **Recall 74 % -> 78 %, and precision to 100 %.** Iteration 52 gave a receiver a *path*: a parameter property, a
  // local bound to `new`, a local bound to `this`, an annotation on a local, and a field of the class the previous hop
  // landed on - plus a union whose only other members are values. It also stopped the import arm from answering a call
  // that writes a receiver, which is the rule that had `new this.Command(…)` pointing at the imported base class.
  //
  // **Precision did not pay for it, and that is the point of the arms below.** Every claim on both TypeScript corpora
  // is correct; `import` moved 96.4 % -> 100 % and `sameFile` 98.0 % -> 100 % because the two rules that used to
  // absorb a name coincidence no longer answer a question they were never evidence for.
  //
  // **And ioredis's recall then moved again, 80.4 % -> 84.4 %, from the fix that consequence forced.** Withdrawing the
  // file-level index for own-scope receivers cost eleven correct edges inside `Cluster.connect`'s arrows - the index
  // had been answering `this.setStatus(...)` inside `const readyHandler = () => {…}` by finding the one `setStatus` in
  // the file. The question that rule was answering by accident is "which class does this `this` refer to", and the
  // answer is the scope chain: the nearest enclosing declaration whose container is a class, walked across the
  // declarations that keep the receiver and stopping at a `function` expression, which rebinds it.
  // **Iteration 54 gave the resolver a module's export chain, and the arms below moved with it.** `z.parse(…)` in
  // every test file of `colinhacks/zod` names `src/index.ts`, which re-exports `src/external.ts`, which re-exports
  // `src/types.ts`; the resolver walked one hop and then answered nothing. A barrel is not one hop, so the chain is
  // walked to its end, refusing a name two files publish and stopping at a cycle. Recall moved 79.1 % -> 80.6 % on zod
  // and 85.2 % -> 86.7 % on ioredis with precision still 100 % on both.
  //
  // **Iteration 55 answered the names an interface declares more than once.** `RedisCommander` declares `info` eleven
  // times and `cluster` forty-two; every one of them was filed as `@ambiguous`, so `this.info(…)`, `this.cluster(…)`,
  // `this.quit(…)` and `this.readonly(…)` resolved to nothing. An overload set is one member, and the last declaration
  // is the one with the body. ioredis's recall moved 86.7 % -> 90.0 % with precision still 100 % - the first version of
  // the rule claimed 15 more edges that were wrong, because a bare `debug(…)` in `lib/Redis.ts` is a module-level
  // `const` and a bare `exists(…)` is a package import, and both were being answered by the inherited member. That is
  // the guard the iteration added, and it is why the figure below is 243 of 243 rather than 243 of 258.
  //
  // **Iteration 65 read the declarations the grammar writes and the walk did not file.** Four of them, and eight rules
  // in all: `abstract class` is a class (zod declares its entire type system on one, ioredis its `AbstractConnector`),
  // a **named class expression** is a class (ioredis writes `Script` that way, inside a constructor), an **arrow keeps
  // `this`** while a `function` expression rebinds it, and a **type alias names a type** (`type ZodTypeAny =
  // ZodType<…>`, which is how zod's own test helpers type their parameters). Three more answered a receiver written on
  // a name bound to a class's static function - `const stringType = ZodString.create` - which needs the field-arrow's
  // return type, the binding, and the module scope every declaration in a file can reach. Recall moved 80.6 % -> 89.9 %
  // on zod (104 -> 116 edges) and 90.0 % -> 92.2 % on ioredis (243 -> 249), with precision still 100 % on both.
  //
  // **The rows of the ablation do not add up to the total, and that is the finding rather than an accounting error.**
  // Ablated one at a time: 11 + 0 + 3 + 0 + 4 + 3 + 3 + 4 = 28 on zod against a total of 12, because the families are
  // conjunctions - `type: ZodTypeAny` needs the evidence *and* the reader that reads it through the alias. Every row
  // below is the delta of removing that one rule from the full build, which is what an ablation table can claim.
  'colinhacks/zod': {
    precision: 0.99,
    recall: 0.89,
    claimed: 110,
    arms: { import: 0.99, inherited: 0.99, namespace: 0.99, sameFile: 0.99, receiverType: 0.99 },
  },
  'redis/ioredis': {
    precision: 0.99,
    recall: 0.915,
    claimed: 245,
    arms: { import: 0.99, inherited: 0.99, namespace: 0.99, sameFile: 0.99, receiverType: 0.99 },
  },
};

/**
 * Floors for the Java corpora, measured on `apache/commons-lang@3.14.0` and `apache/commons-io@2.16.1`.
 *
 * **The first reading of Java was 82.5 % precision, and 100 % of it was the instrument.** The `import` arm claimed 33
 * edges and scored 0, all 33 of them constructions - a site the oracle declined to judge, which a scoring rule counts
 * as a wrong claim rather than as an abstention. Once a construction was scored, and once a name-level self-edge was
 * told apart from a real overload call, precision was 94.7 % and every arm but one read above 95 %.
 *
 * **The graph then earned the rest.** Java emitted no declared types at all - no field type, no parameter type, no
 * local type - so `receiverType` was not an arm that scored badly, it was an arm that could not fire: `set.contains(c)`
 * had no evidence that `set` is a `CharSet`. With the provider emitting what the source states, the arm claimed 356
 * edges of which **356 are right**, and recall moved 82.6 % -> 89.9 %. `implements` became a link in the same
 * iteration, so a class that inherits a default method from a contract now has an edge to it.
 *
 * **Recall is the figure that is still short, and the reason is named**: 328 pairs on `commons-lang` are calls the
 * oracle sees and the graph does not, and the largest groups are a constructor of a nested class and an overload call
 * whose caller and callee share a name - the second of which the graph refuses by policy in one arm and emits in three
 * others. Making that policy uniform is the next measurement, not this one.
 *
 * **Iteration 60 answered a call by the signature it writes**, and the floor on precision moved to where no wrong edge
 * remains. A declaration states how many arguments it takes and a call site states how many it passes; a name that
 * several declarations answer is now resolved by those two numbers rather than by refusing the name outright, which
 * added 66 edges on `commons-lang` and 40 on `commons-io`. Precision on `commons-lang` is **2194 of 2194**, so the
 * floor is 1.0: a single wrong edge now trips it. `commons-io` reads 1600 of 1602 and the floor of 0.9985 admits
 * exactly those two - the pair `AbstractFileFilter.preVisitDirectory` calls `accept(dir, attrs)`, which `IOFileFilter`
 * declares and the inherited arm answers out of the wrong class chain. Fixing that moves the floor, not loosening it.
 *
 * **Iteration 61 read four declarations Java writes and this product stepped past** - a try-with-resources `resource`,
 * an `enum_constant`, a type parameter's bound, and `Outer.this` - plus the factory call a receiver may be rooted at.
 * Together they are **2213 of 2213** on `commons-lang` (recall 97.1 % -> **97.9 %**) and **1635 of 1637** on
 * `commons-io` (95.8 % -> **97.9 %**). Each rule was ablated alone, and the two corpora decompose exactly:
 * `commons-io`'s 35 edges are **13** from the bound (every one of them in `UncheckedIOBaseStream`), **10** from the
 * resource, **8** from the enum constant (four enums: `IOCase`, `FileSystem`, `RandomAccessFileMode`,
 * `StandardLineSeparator`) and **4** from the factory call; `commons-lang`'s 19 are **7** from `Outer.this` (all in
 * `StrBuilder`) and **12** from the factory call. 35 + 19 is the whole gain, which is how a per-rule claim is meant to
 * be checkable: if one of them were wrong the arithmetic would not close. The two remaining wrong edges are the same
 * pair as before, and the floor of 0.9985 still admits exactly them.
 *
 * **Iteration 62 read the type a call passes and the type a cast states**, and both floors moved to 1.0 because no
 * wrong edge remains anywhere: **2222 of 2222** on `commons-lang` (recall 97.9 % -> **98.3 %**) and **1649 of 1649** on
 * `commons-io` (97.9 % -> **98.7 %**). The 23 new correct edges were ablated one rule at a time, and the three groups
 * close the sum exactly:
 *
 * | rule disabled alone | `commons-lang` | `commons-io` |
 * | --- | --- | --- |
 * | a cast names the class it casts to | 2217 (-5) | 1646 (-3) |
 * | a call is answered by the types it passes | 2222 (0) | 1646 correct, **2 wrong** (-3, +2) |
 * | a container's one type argument is its element | 2218 (-4) | 1641 (-8) |
 * | a lambda parameter is bound to that element | 2218 (-4) | 1641 (-8) |
 *
 * 5 + 4 is `commons-lang`'s nine and 3 + 3 + 8 is `commons-io`'s fourteen. **The last two rows are one rule read from
 * two ends**: the lambda rule records `ELEMENT_OF` against the receiver, and the element rule is what resolves that
 * record, so disabling either half loses the same twelve edges and neither half is sufficient on its own - which is
 * exactly why they are reported as two rows rather than as one gain claimed twice.
 *
 * The signature pass claims nothing new on `commons-lang` and everything it claims on `commons-io` is a repair rather
 * than an addition: without it, the inherited arm answers `AbstractFileFilter.preVisitDirectory`'s `accept(dir, attrs)`
 * out of `FileFilter.accept(File)` and the graph writes two wrong edges. That is the pair iteration 60 could not fix
 * and iteration 61 named; it is gone, and the floor of 1.0 is what keeps it gone.
 *
 * ---
 *
 * **Iteration 63 read what a declaration states about the code it does not write**: the constructor the language
 * supplies, the element a lambda is handed, the result a generic factory returns, and the member a hop is read from.
 * **2240 of 2240** on `commons-lang` (recall 98.3 % -> **99.1 %**) and **1662 of 1662** on `commons-io` (98.7 % ->
 * **99.5 %**), with no wrong edge anywhere and every arm at 100.0 %. Ablated one rule at a time, the two corpora close
 * the sum exactly again:
 *
 * | rule disabled alone | `commons-lang` | `commons-io` |
 * | --- | --- | --- |
 * | a class that writes no constructor still has one | 2225 (-15) | 1659 (-3) |
 * | a stream has the element of the collection it was opened from | 2239 (-1) | 1660 (-2) |
 * | a functional parameter types the lambda passed to it | 2240 (0) | 1659 (-3) |
 * | a hop reads a member of the class or of a base | 2238 (-2) | 1662 (0) |
 * | a generic factory's result is bound by the argument that fills it | 2240 (0) | 1657 (-5) |
 *
 * 15 + 1 + 2 is `commons-lang`'s eighteen and 3 + 2 + 3 + 5 is `commons-io`'s thirteen. **The two vertical sums are the
 * whole of the claim**: a rule that no corpus asks for shows up as a zero and is reported as one rather than dropped,
 * which is why the generic-factory row is here with a zero in the first column.
 */
const JAVA_FLOORS = {
  'apache/commons-lang': {
    precision: 1,
    recall: 0.992,
    claimed: 2243,
    arms: {
      // **The arm that answers a name in the class that lexically contains the caller.** `Builder.setDirectory` calls
      // the outer class's private static `toPath`, and `StrategyParser.letterPattern` calls the outer class's
      // `getStrategy`; neither is a base of the class the call sits in. Two claims, both right, on this corpus.
      enclosing: 1,
      import: 0.99,
      inherited: 0.995,
      // **The arm that answers a name out of the file's own directory.** Measured 69 of 69 on this corpus and 83 of
      // 83 on `commons-io`; the floor is where a regression would have to lose more than one claim to trip.
      package: 0.99,
      receiverType: 0.999,
      sameFile: 0.995,
      // **`static` carries what `namespace` used to claim on this corpus, and it is the right arm for it.** A Java
      // import binds a name, and when the name is a class the call on it is the class's member - so the guard that
      // refuses a class name in the module arm moved 291 claims here, where 581 of 581 are right. `namespace` is
      // measured where it exists, which is Python and TypeScript, where an alias really does name a module.
      static: 0.999,
      super: 0.99,
    },
  },
  'apache/commons-io': {
    precision: 1,
    recall: 0.998,
    claimed: 1668,
    arms: {
      // Four claims, all right: `DeferredFileOutputStream`'s two nested-`Builder` calls to the outer `toPath`.
      enclosing: 1,
      import: 0.99,
      inherited: 0.995,
      package: 0.99,
      receiverType: 0.999,
      sameFile: 0.995,
      static: 0.999,
      super: 0.99,
    },
  },
};

function floorsFor(record) {
  // **`includes('ts')` matched `scripts`.** Every record names its oracle as `scripts/callgraph-oracle…`, so the
  // substring test selected the TypeScript floors for the Python record and the gate reported both Python corpora
  // absent from a record that contained them. The file name decides, not a substring of the path.
  if (typeof record.oracle === 'string' && record.oracle.includes('oracle-java'))
    return JAVA_FLOORS;
  return typeof record.oracle === 'string' && record.oracle.includes('oracle-ts')
    ? TYPESCRIPT_FLOORS
    : PYTHON_FLOORS;
}

function main() {
  let record;
  try {
    record = JSON.parse(readFileSync(FILE, 'utf-8'));
  } catch (error) {
    console.error(`callgraph gate: cannot read ${FILE}: ${error.message}`);
    process.exit(1);
  }

  const corpora = Array.isArray(record.corpora) ? record.corpora : [];
  const floors = floorsFor(record);
  const rows = [];
  const failures = [];

  for (const [name, floor] of Object.entries(floors)) {
    const corpus = corpora.find((entry) => entry.corpus === name);
    if (!corpus) {
      failures.push(`${name}: absent from the record`);
      rows.push(`| ${name} | absent | — | — | ✗ |`);
      continue;
    }
    const figures = [
      ['precision', corpus.precision?.value, floor.precision],
      ['recall', corpus.recall?.value, floor.recall],
      ['claimed', corpus.claimedPairs, floor.claimed],
    ];
    for (const [figure, value, minimum] of figures) {
      // **A missing figure is a failure, not a skip.** The oracle always writes these keys; a record without one was
      // produced by something else.
      if (typeof value !== 'number' || Number.isNaN(value)) {
        failures.push(`${name} ${figure}: absent`);
        rows.push(`| ${name} | ${figure} | absent | ≥ ${minimum} | ✗ |`);
        continue;
      }
      const ok = value >= minimum;
      const shown = figure === 'claimed' ? String(value) : `${(value * 100).toFixed(1)}%`;
      rows.push(
        `| ${name} | ${figure} | ${shown} | ≥ ${figure === 'claimed' ? minimum : `${(minimum * 100).toFixed(1)}%`} | ${ok ? '✓' : '✗'}`,
      );
      if (!ok) failures.push(`${name} ${figure}: ${value} < ${minimum}`);
    }
    for (const [arm, minimum] of Object.entries(floor.arms ?? {})) {
      const value = corpus.byArm?.[arm]?.precision;
      if (typeof value !== 'number' || Number.isNaN(value)) {
        failures.push(`${name} arm ${arm}: absent`);
        rows.push(`| ${name} | ${arm} precision | absent | ≥ ${minimum} | ✗ |`);
        continue;
      }
      const ok = value >= minimum;
      rows.push(
        `| ${name} | ${arm} precision | ${(value * 100).toFixed(1)}% | ≥ ${(minimum * 100).toFixed(1)}% | ${ok ? '✓' : '✗'}`,
      );
      if (!ok) failures.push(`${name} arm ${arm}: ${value} < ${minimum}`);
    }
  }

  const summary = [
    '| corpus | figure | measured | floor | |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    `oracle: ${record.oracle ?? 'absent'} (independent of the code under test)`,
    ...corpora.map(
      (corpus) =>
        `${corpus.corpus}: ${corpus.claimedPairs} claimed against ${corpus.expectedPairs} the parser expects, ` +
        `${corpus.sites?.silent ?? 0} sites the oracle declines to judge, ` +
        `${corpus.definitions?.simpleNameCollisionsPerFile ?? 0} names one file declares twice`,
    ),
  ].join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (failures.length > 0) {
    console.error(
      `callgraph gate: ${failures.length} figure(s) below the floor\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
}

main();
