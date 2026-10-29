// The security bugs that are a property of a call rather than of a path.
//
// **Why this file exists, in one measurement.** `benchmarks/owasp-benchmark.json` scores the taint engine over eleven
// categories, and four of them — `crypto`, `hash`, `weakrand`, `securecookie` — are not flows: the bug is that the
// program picked a broken algorithm, a predictable random source, or forgot a cookie flag. The engine found **95 of
// their 513** vulnerable cases, and the 95 were accidents: a weak-cipher test case also writes a request value to the
// page, so the case counted as detected for a reason unrelated to its label. No amount of flow work moves any of them.
//
// Two of the four are local (`new java.util.Random()`, `setSecure(false)`) and two are **not decidable from the file
// alone**: the corpus reads `benchmark.properties` at runtime and passes the value to `MessageDigest.getInstance`. The
// same source is vulnerable or safe depending on a file beside it — which makes this the first rule family that needs
// the index rather than a file, and the reason it takes configuration as an input rather than inferring it.

/** One file the rules are evaluated over. */
export interface RuleSourceFile {
  /** Repository-relative path, used for configuration lookup and reported back on every finding. */
  readonly path: string;
  /** Language id, matching the providers' (`java`, `typescript`, …). */
  readonly language: string;
  readonly text: string;
}

/** A finding from a rule rather than from a flow. */
export interface SecurityRuleFinding {
  readonly ruleId: string;
  readonly category: SecurityRuleCategory;
  /** The CWE the OWASP Benchmark scores this category as. */
  readonly cweId: number;
  readonly severity: 'high' | 'medium';
  readonly filePath: string;
  /** 1-based line of the call that carries the bug, not of the file. */
  readonly line: number;
  /**
   * What decided it — the algorithm, or the configuration key and the value it resolved to.
   *
   * Reported because a rule that says "weak hash" and cannot say *which* algorithm leaves the reader to work it out,
   * and because the two cases that need the index are exactly the ones where the answer is not in the file.
   */
  readonly evidence: string;
}

export type SecurityRuleCategory = 'crypto' | 'hash' | 'weak_random' | 'insecure_cookie';

/** Algorithms whose only remaining property is that they are fast. Matched against the resolved name. */
const WEAK_HASH = /^(md2|md4|md5|sha-?1|sha1)$/i;

/**
 * Weak ciphers, by name and by mode.
 *
 * **ECB is on the list and it is not a cipher name.** `AES/ECB/PKCS5Padding` names the strongest block cipher in the
 * corpus and is still broken — the mode encrypts every block independently, so equal plaintext blocks produce equal
 * ciphertext blocks — and a rule that only looked at the algorithm would call it safe. `DES/ECB/PKCS5Padding` matches
 * both and is reported once.
 */
const WEAK_CIPHER_NAME =
  /(^|[/-])(des|desede|tripledes|rc2|rc4|arcfour|blowfish|skipjack)($|[/-])/i;
const WEAK_CIPHER_MODE = /(^|\/)ecb($|\/)/i;

/**
 * The configuration the rules read, keyed by property name.
 *
 * Built from every `.properties` and `.env` file in the index, because that is where a Java web application puts the
 * algorithm it selected at build time. **Last file wins on a duplicate key**, which matches the classpath order a
 * servlet gets when two resources of the same name are present.
 */
export type RuleConfiguration = ReadonlyMap<string, string>;

/**
 * Evaluate every rule family this module implements over `files`, against the configuration in the same index.
 *
 * **Absent from the result is not the same as clean.** A language with no evaluator here contributes nothing, and the
 * module reports which languages those are through `ruleCoverage()` rather than letting a caller read an empty array as
 * "no security bugs in this repository".
 */
export function evaluateSecurityRules(
  files: readonly RuleSourceFile[],
): readonly SecurityRuleFinding[] {
  const configuration = buildConfiguration(files);
  const findings: SecurityRuleFinding[] = [];

  for (const file of files) {
    const evaluate = EVALUATORS[file.language];
    if (!evaluate) continue;
    findings.push(...evaluate(file, configuration));
  }

  return findings;
}

/** The languages this module states rules for, and the rules each one carries. */
export function ruleCoverage(): ReadonlyMap<string, readonly string[]> {
  return new Map(
    Object.entries(EVALUATORS).map(([language, evaluate]) => [language, evaluate.ruleIds]),
  );
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIGURATION_EXTENSIONS = ['.properties', '.env'] as const;

function buildConfiguration(files: readonly RuleSourceFile[]): RuleConfiguration {
  const configuration = new Map<string, string>();
  for (const file of files) {
    if (!CONFIGURATION_EXTENSIONS.some((extension) => file.path.endsWith(extension))) continue;
    for (const [key, value] of parseProperties(file.text)) configuration.set(key, value);
  }
  return configuration;
}

/** `key=value`, `key: value`, `# comment`, blanks, and the trailing-whitespace the format allows. */
function parseProperties(text: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) continue;
    const separator = line.search(/[=:]/);
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key.length > 0) entries.set(key, value);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Language dispatch
// ---------------------------------------------------------------------------

interface RuleEvaluator {
  (file: RuleSourceFile, configuration: RuleConfiguration): readonly SecurityRuleFinding[];
  readonly ruleIds: readonly string[];
}

const EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  java: Object.assign(evaluateJavaRules, {
    ruleIds: ['weak-cipher', 'weak-hash', 'weak-random', 'insecure-cookie'],
  }),
};

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

/**
 * The statements of a Java file, each with the line it starts on.
 *
 * **Split on `;` at depth zero, and on braces**, because the two shapes that matter here are a call statement and a
 * class or method header, and neither ends in a semicolon-free way that a line split would find. A block comment is
 * blanked first: the corpus writes its expected failure text in comments — `"Problem executing crypto -
 * Cipher.getInstance(...) Test Case"` — and reading that as code reported a weak cipher in files that had none.
 */
function javaStatements(text: string): readonly { text: string; line: number }[] {
  const source = stripComments(text);
  const statements: { text: string; line: number }[] = [];
  let start = 0;
  let depth = 0;

  const flush = (end: number): void => {
    const body = source.slice(start, end);
    const trimmed = body.trim();
    if (trimmed.length > 0) statements.push({ text: trimmed, line: lineAt(source, start, body) });
    start = end + 1;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    // **A string literal is not code.** `"Problem executing Cipher.getInstance(...)"` appears in this corpus's console
    // writes, and its parentheses would unbalance the depth counter that `;` splitting depends on.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) flush(i);
  }
  flush(source.length);

  return statements;
}

/** The 1-based line of the first non-whitespace character in `body`, which starts at `offset`. */
function lineAt(source: string, offset: number, body: string): number {
  const leading = body.length - body.trimStart().length;
  let line = 1;
  for (let i = 0; i < offset + leading; i++) if (source[i] === '\n') line++;
  return line;
}

/** Blank `//` and `/* *\/` comments, keeping the newlines so line numbers survive. */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * What a local name holds, where that is knowable without running the program.
 *
 * Three sources, in the order a Java reader would resolve them: a string literal, a `getProperty` call whose key is in
 * the index, and another local that already resolved. **Anything else is `undefined`**, and a rule that cannot resolve
 * an algorithm name stays silent rather than guessing — the corpus is full of `getInstance(someStaticField)`.
 */
function resolveJavaNames(
  statements: readonly { text: string; line: number }[],
  configuration: RuleConfiguration,
): ReadonlyMap<string, { value: string; evidence: string }> {
  const names = new Map<string, { value: string; evidence: string }>();
  // Two passes, because `byte[] a = b.getBytes()` and `String b = props.getProperty(...)` are separate statements and
  // the corpus writes them in that order.
  for (let pass = 0; pass < 2; pass++) {
    for (const statement of statements) {
      const text = statement.text;
      const literal = /^\s*(?:final\s+)?String\s+(\w+)\s*=\s*"([^"]*)"\s*$/.exec(text);
      if (literal) {
        names.set(literal[1]!, { value: literal[2]!, evidence: `"${literal[2]!}"` });
        continue;
      }
      const fromConfiguration =
        /^\s*(?:final\s+)?String\s+(\w+)\s*=\s*[\w.]*getProperty\(\s*"([^"]*)"\s*(?:,\s*"([^"]*)"\s*)?\)\s*$/.exec(
          text,
        );
      if (fromConfiguration) {
        const [, name, key, fallback] = fromConfiguration;
        const value = configuration.get(key!) ?? fallback;
        // **The key travels with the value.** A finding that says `MD5` and not which property asked for it leaves the
        // reader to find the file, which is the whole distance between this rule and a grep.
        if (value !== undefined) names.set(name!, { value, evidence: `${key!}=${value}` });
        continue;
      }
      const alias = /^\s*(?:final\s+)?String\s+(\w+)\s*=\s*(\w+)\s*$/.exec(text);
      if (alias && names.has(alias[2]!)) names.set(alias[1]!, names.get(alias[2]!)!);
    }
  }
  return names;
}

/** The argument of a call, resolved through the local names, with the text that decided it. */
function resolveArgument(
  argument: string,
  names: ReadonlyMap<string, { value: string; evidence: string }>,
  configuration: RuleConfiguration,
): { value: string; evidence: string } | undefined {
  const trimmed = argument.trim();
  const literal = /^"([^"]*)"$/.exec(trimmed);
  if (literal) return { value: literal[1]!, evidence: trimmed };

  // **Anchored, so the call has to be the whole argument.** `getInstance(choose(props.getProperty("a", "MD5"), "b"))`
  // contains a property read and the algorithm is still `choose`'s to decide; matching the read inside it would report
  // a weak hash the program may never use.
  const fromConfiguration = /^[\w.]*getProperty\(\s*"([^"]*)"\s*(?:,\s*"([^"]*)"\s*)?\)$/.exec(
    trimmed,
  );
  if (fromConfiguration) {
    const key = fromConfiguration[1]!;
    const value = configuration.get(key) ?? fromConfiguration[2];
    if (value !== undefined) return { value, evidence: `${key}=${value}` };
    return undefined;
  }

  return names.get(trimmed);
}

function evaluateJavaRules(
  file: RuleSourceFile,
  configuration: RuleConfiguration,
): readonly SecurityRuleFinding[] {
  const statements = javaStatements(file.text);
  const names = resolveJavaNames(statements, configuration);
  const findings: SecurityRuleFinding[] = [];

  for (const statement of statements) {
    for (const invoked of firstArguments(statement.text, /MessageDigest\.getInstance\(/g)) {
      const resolved = resolveArgument(invoked, names, configuration);
      if (resolved && WEAK_HASH.test(resolved.value)) {
        findings.push(
          ruleFinding(file, 'weak-hash', 'hash', 328, statement.line, resolved.evidence),
        );
      }
    }

    for (const invoked of firstArguments(
      statement.text,
      /(?:Cipher|KeyGenerator|KeyAgreement)\.getInstance\(/g,
    )) {
      const resolved = resolveArgument(invoked, names, configuration);
      if (
        resolved &&
        (WEAK_CIPHER_NAME.test(resolved.value) || WEAK_CIPHER_MODE.test(resolved.value))
      ) {
        findings.push(
          ruleFinding(file, 'weak-cipher', 'crypto', 327, statement.line, resolved.evidence),
        );
      }
    }

    // **`SecureRandom` is a `Random` by inheritance and by name.** The corpus's safe cases are written with it, so the
    // negative lookbehind is the whole difference between a rule that separates them and one that does not.
    if (
      /new\s+(?:[\w.]+\.)?Random\s*\(/.test(statement.text) &&
      !/SecureRandom/.test(statement.text)
    ) {
      findings.push(
        ruleFinding(file, 'weak-random', 'weak_random', 330, statement.line, 'new Random()'),
      );
    } else if (/Math\.random\s*\(/.test(statement.text)) {
      // **`java.lang.Math.random()` is the same bug as `Math.random()`**, and the corpus writes it in full. An earlier
      // form of this pattern excluded any `Math` preceded by `.` to avoid matching a qualified name it had not thought
      // of; the only qualified name that occurs is this one, and it is 25 of the 218 cases in the category.
      findings.push(
        ruleFinding(file, 'weak-random', 'weak_random', 330, statement.line, 'Math.random()'),
      );
    }
  }

  findings.push(...evaluateJavaCookieFlags(file, statements));

  return dedupeByLineAndRule(findings);
}

/**
 * A cookie is insecure when its `setSecure` is `false`, or when it is added without one.
 *
 * **Tracked per variable, not per file.** Half of the corpus's cookie cases open with a template cookie that does set
 * the flag and then build the real one a few lines later; a file-level "is there a `setSecure(true)` anywhere" test
 * calls every one of them safe.
 */
function evaluateJavaCookieFlags(
  file: RuleSourceFile,
  statements: readonly { text: string; line: number }[],
): readonly SecurityRuleFinding[] {
  const created = new Map<string, number>();
  const secure = new Set<string>();
  const insecure = new Set<string>();
  const added = new Map<string, number>();

  for (const statement of statements) {
    const declaration =
      /(\w+)\s*=\s*new\s+(?:[\w.]+\.)?Cookie\s*\(/.exec(statement.text) ??
      /(?:[\w.]+\.)?Cookie\s+(\w+)\s*=\s*new\s+(?:[\w.]+\.)?Cookie\s*\(/.exec(statement.text);
    if (declaration) created.set(declaration[1]!, statement.line);

    for (const match of statement.text.matchAll(/\.setSecure\(\s*(true|false)\s*\)/g)) {
      const receiver = /([\w.]+)\.setSecure/.exec(statement.text)?.[1];
      if (!receiver) continue;
      const name = receiver.split('.').pop()!;
      if (match[1] === 'true') secure.add(name);
      else insecure.add(name);
    }

    for (const match of statement.text.matchAll(/\.addCookie\(\s*(\w+)\s*\)/g)) {
      added.set(match[1]!, statement.line);
    }
  }

  const findings: SecurityRuleFinding[] = [];
  for (const name of created.keys()) {
    const addedAt = added.get(name);
    if (addedAt === undefined) continue;
    if (insecure.has(name)) {
      findings.push(
        ruleFinding(
          file,
          'insecure-cookie',
          'insecure_cookie',
          614,
          addedAt,
          `${name}.setSecure(false)`,
        ),
      );
    } else if (!secure.has(name)) {
      findings.push(
        ruleFinding(
          file,
          'insecure-cookie',
          'insecure_cookie',
          614,
          addedAt,
          `${name} added without setSecure`,
        ),
      );
    }
  }
  return findings;
}

/**
 * The first argument of every call the pattern matches, read to its own closing parenthesis.
 *
 * **The argument can be a call.** `getInstance(props.getProperty("hashAlg", "MD5"))` has a comma inside its only
 * argument, and a pattern that stopped at the comma captured `props.getProperty("hashAlg"` — which resolves to nothing,
 * so the file looked as though its algorithm were unknowable when the default was spelled out in the call.
 */
function firstArguments(text: string, call: RegExp): readonly string[] {
  const out: string[] = [];
  for (const match of text.matchAll(call)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    let firstEnd = -1;
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 1 && firstEnd < 0) firstEnd = i;
    }
    const end = firstEnd >= 0 ? firstEnd : i - 1;
    out.push(text.slice(start, end));
  }
  return out;
}

function ruleFinding(
  file: RuleSourceFile,
  ruleId: string,
  category: SecurityRuleCategory,
  cweId: number,
  line: number,
  evidence: string,
): SecurityRuleFinding {
  return { ruleId, category, cweId, severity: 'high', filePath: file.path, line, evidence };
}

/**
 * One finding per rule per line.
 *
 * `Cipher.getInstance("DES/ECB/PKCS5Padding")` matches the weak name **and** the weak mode, and a reader does not want
 * to be told twice. The line is the identity a reader acts on; two different algorithms cannot be called on the same
 * line by the same rule in code that compiles.
 */
function dedupeByLineAndRule(
  findings: readonly SecurityRuleFinding[],
): readonly SecurityRuleFinding[] {
  const seen = new Set<string>();
  const kept: SecurityRuleFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.ruleId}|${finding.filePath}|${finding.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(finding);
  }
  return kept;
}
