// @code-analyzer/intelligence — Per-language defect checklists
//
// **What this file is, and where it came from.** The competitor whose corpus this repository now measures itself on
// ships, beside its review prompt, **sixty-odd pages of per-language rules in which every rule ends with a sentence
// beginning "do not report"**. That shape is not decoration: a review lane told only *what to look for* spends its
// budget on the language's ordinary idioms, and **an idiom reported as a defect is a false positive with a
// citation** - the most expensive kind, because it reads as competence.
//
// **What was measured before writing it, and what was not.** The two runs of iteration 109 showed the *scope* was not
// the constraint (`capped` zero in both, and the pull-request arm lost 18 goldens to 0). The remaining difference
// between this repository and the competitor is **the prompt's specificity about each language**, which is what this
// file adds. **Whether it helps is not asserted here** - it is registered before the run in `docs/EVAL-CONTRACT.md`
// §8 and measured by `aacr-bench.mjs` with the checklist on and off over the same pull requests.
//
// **Why the exclusions are the load-bearing half.** Every rule below is a *pattern* with a *counter-pattern*, and the
// counter-pattern is written from the language's own semantics: a resource that is returned is not leaked, a `==`
// against `null` is not a loose comparison, a `GlobalScope.launch` in a process-lifetime daemon is not a leak. A rule
// without its exclusion is a rule that fires on correct code, and **a checklist of such rules is a false-positive
// generator with better prose.**

import type { PromptContext } from './prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The eleven languages this repository supports first, in the order the audit lists them. */
export type RuleLanguage =
  | 'java'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'groovy'
  | 'xml'
  | 'yaml'
  | 'json'
  | 'kotlin'
  | 'swift'
  | 'arkts';

/**
 * One defect pattern and the condition under which it is not a defect.
 *
 * **`notWhen` is required, not optional.** A rule without its exclusion is a rule that fires on correct code, and the
 * compiler enforces the distinction the prose argues for.
 */
export interface LanguageRule {
  /** Stable identifier, printed in the prompt so a finding can quote the rule it came from. */
  id: string;
  /** What to report, in one sentence a reviewer can hold against a hunk. */
  report: string;
  /** When the same shape is correct code and must not be reported. */
  notWhen: string;
}

/** A language, its file extensions, and its rules in the order they are printed. */
export interface LanguageDefinition {
  language: RuleLanguage;
  /** How the language is named in the prompt heading. */
  label: string;
  /** Extensions that select this definition, compared case-insensitively and including the dot. */
  extensions: readonly string[];
  rules: readonly LanguageRule[];
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const JAVA: LanguageDefinition = {
  language: 'java',
  label: 'Java',
  extensions: ['.java'],
  rules: [
    {
      id: 'java.resource-leak',
      report:
        'A stream, connection, channel or reader opened in the changed lines and not closed on every path out of the method, including the exception path.',
      notWhen:
        'the value is returned to the caller, stored in a field or passed to a framework that owns its lifetime, or the open call is the resource expression of a try-with-resources.',
    },
    {
      id: 'java.equals-without-hashcode',
      report:
        'A class that overrides equals() in the changed lines without overriding hashCode(), so two equal objects land in different hash buckets.',
      notWhen:
        'hashCode() is inherited from a superclass that already derives it from the same fields, or the class is annotated as an entity whose identity is the database key.',
    },
    {
      id: 'java.nullability-unchecked',
      report:
        'A value that the changed code knows can be null (a Map.get, a findFirst().orElse(null), a boxed return) dereferenced without a check on that path.',
      notWhen:
        'a guard on the same expression dominates the dereference inside the same hunk, or the API is annotated @NonNull and the annotation is enforced.',
    },
    {
      id: 'java.optional-get',
      report: 'Optional.get() on a value that the same hunk has not tested with isPresent().',
      notWhen:
        'the Optional was produced by Optional.of(...) in the same method, or the absence is a documented invariant violation handled by an outer catch.',
    },
    {
      id: 'java.concurrent-modification',
      report:
        'Removing from or adding to a collection while a for-each loop over that same collection is in progress.',
      notWhen:
        'the collection is a concurrent type (ConcurrentHashMap, CopyOnWriteArrayList) or the mutation goes through the iterator.',
    },
    {
      id: 'java.swallowed-exception',
      report: 'A catch block that neither rethrows, wraps, nor records the exception.',
      notWhen:
        'the catch is the documented exit of a control-flow idiom (restoring the interrupt flag on InterruptedException, NumberFormatException as a parse test) or the body explains why silence is correct.',
    },
    {
      id: 'java.mutable-static',
      report:
        'A new static field holding mutable state that is written from an instance method, which makes the class a shared cache without a lock.',
      notWhen:
        'the field is final and refers to an immutable value, or it is a volatile/atomic type, or it is a constant table that is never written after class initialisation.',
    },
  ],
};

const JAVASCRIPT: LanguageDefinition = {
  language: 'javascript',
  label: 'JavaScript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  rules: [
    {
      id: 'js.loose-equality',
      report: 'A `==` or `!=` comparison whose two sides can have different types.',
      notWhen:
        'one side is the literal null, because `x == null` is the idiomatic test for null-or-undefined and `x === null` is the bug.',
    },
    {
      id: 'js.floating-promise',
      report:
        'A promise-returning call whose result is neither awaited, returned, nor given a rejection handler in the changed lines.',
      notWhen:
        'the call is deliberately fire-and-forget and carries a `.catch(...)` on the same expression, or the callee is documented as never rejecting.',
    },
    {
      id: 'js.unguarded-parse',
      report:
        'JSON.parse, a Date parse or a numeric coercion applied to request data without a guard, where the throw leaves the caller with no response.',
      notWhen:
        'the input was produced by a serializer in the same process and the shape is fixed by a schema.',
    },
    {
      id: 'js.prototype-pollution',
      report:
        'A recursive merge or assignment that writes keys taken from request data into an object, so `__proto__` or `constructor` reaches Object.prototype.',
      notWhen: 'the keys are checked against a fixed allow-list before the write.',
    },
    {
      id: 'js.lost-this',
      report:
        'A method passed as a callback without binding, so `this` is the caller rather than the object at call time.',
      notWhen:
        'the function is an arrow function, was bound where it was defined, or does not read `this`.',
    },
    {
      id: 'js.code-from-string',
      report:
        'eval, new Function, or a string passed to setTimeout where any part of the string came from outside the module.',
      notWhen:
        'the argument is a literal in the same statement and cannot be influenced at run time.',
    },
    {
      id: 'js.index-loop-over-array',
      report:
        'A `for` loop whose only use of the index is `array[index]`, which re-implements iteration and hides an early exit.',
      notWhen:
        'the index is used for anything else (a parallel array, a slice boundary, an offset), or the loop mutates the array deliberately.',
    },
  ],
};

const TYPESCRIPT: LanguageDefinition = {
  language: 'typescript',
  label: 'TypeScript',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  rules: [
    {
      id: 'ts.any-at-boundary',
      report:
        'An `any` introduced where a value crosses a boundary (a parameter, a return, a parsed payload), which erases the contract for every caller.',
      notWhen:
        'the value is immediately narrowed to a known type, or the file is a declaration shim for untyped third-party code.',
    },
    {
      id: 'ts.non-null-assertion',
      report:
        'A `!` assertion on a value the compiler says is possibly undefined, on a path where the runtime can actually be undefined.',
      notWhen:
        'a check on the same expression dominates the assertion inside the same hunk, or the value was just assigned in the same block and no call intervenes.',
    },
    {
      id: 'ts.non-exhaustive-switch',
      report:
        'A switch over a union that has no branch for every member and no `never` default, so a new member silently falls through.',
      notWhen: 'the default branch throws or assigns to a `never`-typed value.',
    },
    {
      id: 'ts.async-in-for-each',
      report:
        'An async callback passed to forEach or map whose promise is discarded, so the loop finishes before the work does.',
      notWhen: 'the callback is not async, or the results are collected and awaited.',
    },
    {
      id: 'ts.assertion-instead-of-validation',
      report:
        'An `as` cast applied to a value that came from outside the program (a response body, a file, an environment variable).',
      notWhen: 'a schema or a type guard validated the value on the same path before the cast.',
    },
    {
      id: 'ts.optional-read-without-narrowing',
      report:
        'A read of an optional property chained into a call without a default or a guard, where the absent case has a defined meaning.',
      notWhen:
        'the property is optional only in the type and required by the contract at that call site.',
    },
    {
      id: 'ts.numeric-enum-truthiness',
      report:
        'A numeric enum tested for truthiness, so the member whose value is 0 reads as absent.',
      notWhen: 'the enum is a string enum, or the test is an explicit comparison with a member.',
    },
  ],
};

const PYTHON: LanguageDefinition = {
  language: 'python',
  label: 'Python',
  extensions: ['.py', '.pyi'],
  rules: [
    {
      id: 'py.mutable-default-argument',
      report:
        'A list, dict or set literal as a default argument value, which is created once and shared by every call.',
      notWhen: 'the default is None and the body creates the container, or the value is immutable.',
    },
    {
      id: 'py.bare-except',
      report:
        'A bare `except:` or `except Exception: pass` that hides every failure including KeyboardInterrupt.',
      notWhen:
        'the handler logs or re-raises, or it is a documented probe whose failure is the expected answer and whose comment says so.',
    },
    {
      id: 'py.mutable-class-attribute',
      report:
        'A mutable container defined as a class attribute and then mutated through an instance.',
      notWhen:
        'every instance assigns its own container in __init__, or the attribute is a documented shared registry.',
    },
    {
      id: 'py.late-binding-closure',
      report:
        'A lambda or nested function defined in a loop that closes over the loop variable rather than a copy of it.',
      notWhen:
        'the loop variable is bound as a default argument or the closure is called inside the same iteration.',
    },
    {
      id: 'py.iteration-mutation',
      report: 'Adding to or deleting from a dict or list while iterating over it.',
      notWhen:
        'the iteration is over a copy (`list(x)`, `list(d.items())`) or the container is built during the loop.',
    },
    {
      id: 'py.resource-without-context',
      report:
        'An open() or a session acquired without a `with` block, so the handle survives an exception.',
      notWhen:
        'the handle is returned, stored on an object with a documented close, or owned by the caller.',
    },
    {
      id: 'py.identity-comparison',
      report:
        'An `is` comparison against a literal, which compares identity where equality was meant.',
      notWhen:
        'the other side is None, True, False, or a sentinel object created for identity comparison.',
    },
  ],
};

const GROOVY: LanguageDefinition = {
  language: 'groovy',
  label: 'Groovy and Gradle',
  extensions: ['.groovy', '.gradle', '.gvy'],
  rules: [
    {
      id: 'groovy.gstring-into-query',
      report:
        'A GString ("...${x}...") used to build SQL, a shell command or a file path that is then executed.',
      notWhen:
        'the interpolated value is bound as a parameter and the expression is a constant template.',
    },
    {
      id: 'groovy.dynamic-parameter',
      report:
        'A public method whose parameter has no declared type, so the contract is whatever the first caller passes.',
      notWhen: 'the method is a DSL entry point or a script body by design.',
    },
    {
      id: 'groovy.closure-delegate',
      report:
        'A nested closure that reads `delegate` or `owner` without setting `resolveStrategy`, so the receiver is ambiguous.',
      notWhen:
        'the closure explicitly declares `delegate` and a resolve strategy on the same object.',
    },
    {
      id: 'groovy.side-effect-in-collect',
      report:
        'A collect/each/find block that mutates state outside the collection it is iterating.',
      notWhen:
        'the mutation is the documented purpose (building an index) and the collection is not shared.',
    },
    {
      id: 'groovy.gradle-eager-configuration',
      report:
        'Work executed at configuration time in a Gradle build (reading a file, resolving a dependency, calling a task output) instead of inside doLast or a Provider.',
      notWhen:
        'the block is inside doLast, a Provider mapper, or a configuration-cache-safe value source.',
    },
    {
      id: 'groovy.hardcoded-dependency-version',
      report:
        'A dependency declared with a literal version string in a module that has a version catalog available.',
      notWhen:
        'the file is the catalog itself, a settings pluginManagement block, or the version is deliberately dynamic (a range, a snapshot).',
    },
  ],
};

const XML: LanguageDefinition = {
  language: 'xml',
  label: 'XML and build descriptors',
  extensions: ['.xml', '.pom', '.xsd', '.xsl', '.xslt'],
  rules: [
    {
      id: 'xml.xxe',
      report:
        'A DocumentBuilderFactory, SAXParserFactory or XMLInputFactory created in the changed lines without disabling external entities and DTDs.',
      notWhen:
        'the factory comes from a hardened helper (this repository has one) or the features are set from a constant the same hunk shows.',
    },
    {
      id: 'xml.expression-injection',
      report:
        'User input concatenated into an XPath, XSLT or SQL expression held in an XML descriptor.',
      notWhen: 'the value is bound through a variable resolver or a prepared statement parameter.',
    },
    {
      id: 'xml.transitive-scope-leak',
      report:
        'A dependency declared without a scope in a library module, so it leaks onto the compile classpath of every consumer.',
      notWhen:
        'the artifact is meant to be re-exported (a BOM, an api-style aggregator) and the module is an application.',
    },
    {
      id: 'xml.duplicate-id',
      report:
        'Two elements in the same document carrying the same id, which makes the second unreachable.',
      notWhen:
        'the ids live in different documents assembled later, or the attribute is not an XML id.',
    },
    {
      id: 'xml.namespace-shadowing',
      report:
        'The same prefix bound to two different namespace URIs in one scope, so an element resolves to the wrong schema.',
      notWhen:
        'the inner binding is intentional and the inner elements are all in the inner namespace.',
    },
    {
      id: 'xml.encoding-mismatch',
      report:
        'A declared encoding that disagrees with the bytes in the file, which corrupts non-ASCII text on read.',
      notWhen: 'the file is ASCII-only and the declaration is a default.',
    },
  ],
};

const YAML: LanguageDefinition = {
  language: 'yaml',
  label: 'YAML and CI workflows',
  extensions: ['.yml', '.yaml'],
  rules: [
    {
      id: 'yaml.unpinned-action',
      report:
        'A GitHub Action referenced by a mutable tag or branch, so the code that runs is whatever the tag points at today.',
      notWhen: 'the reference is a full 40-character commit SHA.',
    },
    {
      id: 'yaml.implicit-permissions',
      report:
        'A workflow with no `permissions:` block, which grants the default token every scope the repository allows.',
      notWhen:
        'permissions are declared at job level, or the workflow only runs on workflow_dispatch and reads nothing.',
    },
    {
      id: 'yaml.expression-in-run',
      report:
        'A `${{ }}` expression interpolated directly into a `run:` script, so a value containing a quote or a semicolon becomes shell.',
      notWhen: 'the expression is passed through `env:` and read as a shell variable.',
    },
    {
      id: 'yaml.pull-request-target-checkout',
      report:
        'pull_request_target combined with a checkout of the head ref, which runs untrusted code with a write token.',
      notWhen:
        'the checkout names the base ref, or the job declares `permissions: contents: read` and never executes the head.',
    },
    {
      id: 'yaml.duplicate-key',
      report: 'A mapping key repeated in the same block, where the last one silently wins.',
      notWhen: 'the keys are in different documents of a multi-document stream.',
    },
    {
      id: 'yaml.truthy-key',
      report:
        'An unquoted `on`, `off`, `yes` or `no` used as a key or value, which a YAML 1.1 parser reads as a boolean.',
      notWhen: 'the parser in use is YAML 1.2, or the token is quoted.',
    },
    {
      id: 'yaml.gate-that-cannot-fail',
      report:
        'A verification or gate step carrying continue-on-error, or a command ending in `|| true`, which turns a failure into a pass.',
      notWhen:
        'the step is explicitly a probe whose outcome is reported as data, and the job asserts on that data.',
    },
  ],
};

const JSON_RULES: LanguageDefinition = {
  language: 'json',
  label: 'JSON and configuration',
  extensions: ['.json', '.jsonc', '.json5'],
  rules: [
    {
      id: 'json.duplicate-key',
      report:
        'A key repeated in the same object, where the parser keeps one and the reader expects the other.',
      notWhen: 'the file is JSON5/JSONC and the duplicate is inside a comment.',
    },
    {
      id: 'json.number-precision',
      report:
        'An integer larger than 2^53 stored as a number, which loses digits the moment JavaScript reads it.',
      notWhen: 'the value is a string, or the reader is not a JavaScript runtime.',
    },
    {
      id: 'json.schema-drift',
      report:
        'A field added to a configuration object that the schema or validator beside it does not describe.',
      notWhen:
        'the schema is generated from the same source, or the object is free-form by contract.',
    },
    {
      id: 'json.secret-literal',
      report: 'A credential-shaped literal (a key, a token, a password) committed as a value.',
      notWhen:
        'the value is a placeholder, a documented example, or read from the environment at run time.',
    },
    {
      id: 'json.trailing-comma',
      report:
        'A trailing comma or a comment in a file that is parsed as strict JSON, which fails on the first read.',
      notWhen: 'the file extension or the parser declares JSONC/JSON5 support.',
    },
  ],
};

const KOTLIN: LanguageDefinition = {
  language: 'kotlin',
  label: 'Kotlin',
  extensions: ['.kt', '.kts'],
  rules: [
    {
      id: 'kt.not-null-assertion',
      report:
        'A `!!` on a value that a Java call or a nullable return can actually deliver as null.',
      notWhen: 'a check on the same expression dominates the assertion in the same hunk.',
    },
    {
      id: 'kt.lateinit-unset',
      report:
        'A `lateinit` property read on a path where initialisation is not guaranteed before use.',
      notWhen:
        'the framework guarantees the initialiser (a lifecycle callback) and the read is downstream of it.',
    },
    {
      id: 'kt.global-scope',
      report:
        'GlobalScope.launch or a coroutine started on a scope that outlives the component, so cancellation never reaches it.',
      notWhen:
        'the work must outlive the process by design and the code documents the missing cancellation.',
    },
    {
      id: 'kt.mutable-exposure',
      report:
        'A public function or property returning MutableList/MutableMap, which lets any caller mutate internal state.',
      notWhen: 'the type is an intentional builder or the property is private/internal.',
    },
    {
      id: 'kt.blocking-in-coroutine',
      report: 'runBlocking or a blocking IO call inside a suspend function or a coroutine builder.',
      notWhen:
        'the call is at the top of a program entry point, or it is wrapped in withContext(Dispatchers.IO) and documented.',
    },
    {
      id: 'kt.data-class-mutable-key',
      report:
        'A data class with a var property used as a map key or in a set, so its hash changes after insertion.',
      notWhen: 'the property is a val, or the instance is never stored in a hash-based collection.',
    },
  ],
};

const SWIFT: LanguageDefinition = {
  language: 'swift',
  label: 'Swift',
  extensions: ['.swift'],
  rules: [
    {
      id: 'swift.force-unwrap',
      report:
        'A `!` unwrap of an optional produced by a fallible call (a dictionary lookup, a decode, a URL construction).',
      notWhen:
        'the value is an invariant established in the same initialiser with no early return between assignment and use.',
    },
    {
      id: 'swift.retain-cycle',
      report:
        'A closure stored on a long-lived object that captures self strongly, so neither is released.',
      notWhen:
        'the closure is non-escaping, or the capture list already names `[weak self]` or `[unowned self]`.',
    },
    {
      id: 'swift.ui-off-main-actor',
      report: 'A UI mutation or a published-property write performed outside the main actor.',
      notWhen:
        'the enclosing type or function is annotated @MainActor, or the call is wrapped in a main-queue hop on the same path.',
    },
    {
      id: 'swift.mutation-while-iterating',
      report: 'Removing elements from a collection inside a loop over that collection.',
      notWhen: 'the loop is over a copy, a filtered array, or indices collected first.',
    },
    {
      id: 'swift.swallowed-try',
      report:
        '`try?` discarding an error whose failure the caller needs to distinguish from success.',
      notWhen: 'the API is documented as best-effort and the nil case is handled on the same path.',
    },
    {
      id: 'swift.integer-string-index',
      report:
        'An Int used to index a String, which does not compile and, when worked around, splits grapheme clusters.',
      notWhen: 'the code converts through String.Index deliberately in the same expression.',
    },
  ],
};

const ARKTS: LanguageDefinition = {
  language: 'arkts',
  label: 'ArkTS',
  extensions: ['.ets'],
  rules: [
    {
      id: 'arkts.any-type',
      report:
        '`any` or `unknown` in a .ets file, which the ArkTS strict subset rejects at build time.',
      notWhen:
        'the declaration is in a .ts interop file that .ets code calls through a typed wrapper.',
    },
    {
      id: 'arkts.state-nested-mutation',
      report:
        'Mutating a nested field of an @State object without reassigning the state variable, so no re-render is triggered.',
      notWhen:
        'the nested type is @Observed and the field is tracked, or the assignment replaces the top-level value.',
    },
    {
      id: 'arkts.untyped-literal',
      report:
        'An object literal with no declared interface type, which ArkTS rejects because the shape cannot be checked.',
      notWhen:
        'the literal is contextually typed by a parameter or a return type in the same expression.',
    },
    {
      id: 'arkts.listener-leak',
      report:
        'A listener or subscription registered in aboutToAppear without a matching removal in aboutToDisappear.',
      notWhen:
        'the subscription is owned by a lifecycle-scoped object that the framework disposes.',
    },
    {
      id: 'arkts.heavy-work-on-ui-thread',
      report:
        'Parsing, hashing, image decoding or a synchronous IPC call executed inline in a component callback.',
      notWhen:
        'the work is bounded by a constant and documented as such, or it already runs in a taskpool task.',
    },
  ],
};

/** Every definition, in the order the audit lists the priority languages. */
export const LANGUAGES: readonly LanguageDefinition[] = [
  JAVA,
  JAVASCRIPT,
  TYPESCRIPT,
  PYTHON,
  GROOVY,
  XML,
  YAML,
  JSON_RULES,
  KOTLIN,
  SWIFT,
  ARKTS,
];

/**
 * **How many languages one call may be given rules for, and why a cap rather than all of them.**
 *
 * A pull request that touches a Gradle file, a workflow, a Kotlin source and a JSON fixture matches four definitions.
 * Printing all four is three thousand characters of rules for a diff of eight thousand characters, and **a prompt whose
 * rules outnumber its code is a prompt that reviews the rules.** Three is the number that covers the languages a change
 * is actually about while leaving the diff the larger share; the fourth is reached only by pull requests whose real
 * subject is configuration, and those are the ones where the budget argument in §8 is weakest.
 */
export const MAX_LANGUAGES_PER_CALL = 3;

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** The extension of a path, lower-cased, or an empty string when there is none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** The definition a path selects, or undefined when the extension is not one of the eleven. */
export function languageOf(path: string): LanguageDefinition | undefined {
  const extension = extensionOf(path);
  if (!extension) return undefined;
  return LANGUAGES.find((definition) => definition.extensions.includes(extension));
}

/**
 * **The languages a call is about, most-represented first and alphabetical within a tie.**
 *
 * Ordering by the number of files rather than by extension keeps the cap honest: a pull request with twelve `.java`
 * files and one `.yml` is a Java change, and **a checklist that led with the workflow would spend two thirds of its
 * rules on the file nobody is reviewing.**
 */
export function languagesOf(paths: readonly string[]): LanguageDefinition[] {
  const counts = new Map<RuleLanguage, { definition: LanguageDefinition; files: number }>();
  for (const path of paths) {
    const definition = languageOf(path);
    if (!definition) continue;
    const seen = counts.get(definition.language);
    if (seen) seen.files += 1;
    else counts.set(definition.language, { definition, files: 1 });
  }
  return [...counts.values()]
    .sort((a, b) =>
      b.files === a.files
        ? a.definition.label.localeCompare(b.definition.label)
        : b.files - a.files,
    )
    .map((entry) => entry.definition);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * **The checklist, as the prompt carries it.**
 *
 * Returns an empty string when the call covers no language this file knows - a Markdown-only change, a diff of a
 * binary, a pull request whose files are all lock files. **An empty string rather than a paragraph explaining that
 * there is no checklist**, because a paragraph about the absence of rules is a paragraph the model will search for
 * rules in.
 *
 * **Opt-out is a product flag, not a test seam.** `ctx.languageChecklist === false` removes the section, and that is
 * the switch the registered measurement in `docs/EVAL-CONTRACT.md` §8 turns: the same engine, the same pull requests,
 * the same judge, one variable.
 */
export function defectChecklist(ctx: PromptContext): string {
  if (ctx.languageChecklist === false) return '';
  const paths = ctx.scope === 'pull-request' ? (ctx.paths ?? []) : [ctx.filePath];
  const chosen = languagesOf(paths).slice(0, MAX_LANGUAGES_PER_CALL);
  if (chosen.length === 0) return '';

  const sections = chosen.map((definition) => {
    const rules = definition.rules
      .map((rule) => `- **${rule.id}** ${rule.report}\n  Do not report when ${rule.notWhen}`)
      .join('\n');
    return `### ${definition.label}\n${rules}`;
  });

  return `Defect checklist for the language of this change. **Each rule has a "do not report when" clause, and that
clause outranks the rule**: code that matches the clause is correct in this language, and reporting it spends one of
this call's findings on something a maintainer of the language would not change.

${sections.join('\n\n')}

Report a rule's defect only if the changed lines contain the whole of it. A checklist entry is a reason to look, not a
finding: if the diff does not show the pattern, there is nothing to say.

`;
}
