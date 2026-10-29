// What a Java web application calls a source and a sink, and why it is a list of its own.
//
// **Measured, before this existed: zero sources and zero sinks on sixty OWASP Benchmark test cases.** The shared
// C-family vocabulary named `System.getenv` and `query`, and a servlet reads its input through
// `request.getParameter(...)` and writes it through `response.getWriter().print(...)`. Both were invisible, so a
// benchmark used by every competing scanner scored this engine at nothing — not because the engine cannot follow a
// flow, but because it had never been told where a Java flow starts.
//
// The list is separate from `C_LIKE_VOCABULARY` because some of its entries are sinks *only here*: `print` and
// `write` are what a servlet response does with a value, and they are ordinary calls in Python and Ruby. Putting
// them in the shared list would have made every other language report `print(userInput)` as cross-site scripting.

import { C_LIKE_SANITIZERS, C_LIKE_VOCABULARY, TYPE_CONVERSION_KINDS } from './base-c-like.js';

import type { SanitizerVocabulary, TaintVocabulary } from './base-c-like.js';

/**
 * Untrusted input in a servlet request, and in the cookie that 1.2beta's vectors travel in.
 *
 * The matcher compares the last dotted segment of the callee, which is what makes a list of method names work: the
 * receiver is `request`, `req` or a subclass, and its declared type is not known from the call.
 */
const JAVA_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['getParameter', 'http_request'],
  ['getParameterValues', 'http_request'],
  ['getParameterMap', 'http_request'],
  ['getParameterNames', 'http_request'],
  ['getHeader', 'http_request'],
  ['getHeaders', 'http_request'],
  ['getHeaderNames', 'http_request'],
  ['getQueryString', 'http_request'],
  ['getInputStream', 'http_request'],
  ['getReader', 'http_request'],
  ['getPathInfo', 'http_request'],
  ['getRequestURI', 'url'],
  ['getRequestURL', 'url'],
  ['getServletPath', 'url'],
  ['getCookies', 'cookie'],
  // `Cookie.getValue` is how a servlet reads a cookie's contents, and the matcher sees only the segment. It is the
  // broadest entry in this list — `x.getValue()` on a map matches it too — and it is kept because a cookie vector is
  // a quarter of this benchmark's request surface, and because a flow still has to reach a sink to be reported.
  ['getValue', 'cookie'],
];

/**
 * Where servlet code passes a value into an interpreter.
 *
 * Constructors are listed by their type name: `new FileInputStream(name)` reaches the walk as the callee
 * `new FileInputStream`, and `sinkFor` drops the keyword before comparing.
 */
const JAVA_SINKS: ReadonlyArray<readonly [string, string]> = [
  // SQL. `executeQuery`/`executeUpdate` are the JDBC entry points a servlet uses; `execute` covers both and the
  // framework calls.
  ['executeQuery', 'sql_exec'],
  ['executeUpdate', 'sql_exec'],
  ['execute', 'sql_exec'],
  ['prepareStatement', 'sql_exec'],
  ['prepareCall', 'sql_exec'],
  ['addBatch', 'sql_exec'],
  // OS command. `Runtime.getRuntime().exec(cmd)` and `new ProcessBuilder(cmd).start()`.
  ['exec', 'os_command'],
  ['ProcessBuilder', 'os_command'],
  ['start', 'os_command'],
  // Path traversal. Every one of these opens a file named by its argument.
  ['File', 'file_read'],
  ['FileInputStream', 'file_read'],
  ['FileOutputStream', 'file_write'],
  ['FileReader', 'file_read'],
  ['FileWriter', 'file_write'],
  ['RandomAccessFile', 'file_read'],
  ['Paths.get', 'file_read'],
  ['Files.readAllBytes', 'file_read'],
  ['Files.readAllLines', 'file_read'],
  ['Files.write', 'file_write'],
  ['Files.copy', 'file_write'],
  ['Files.newInputStream', 'file_read'],
  ['Files.newOutputStream', 'file_write'],
  // Cross-site scripting: a servlet writes the value into the response body or the error page.
  ['print', 'html'],
  ['println', 'html'],
  ['write', 'html'],
  ['format', 'html'],
  ['append', 'html'],
  ['sendError', 'html'],
  // LDAP and XPath injection.
  ['search', 'ldap_query'],
  ['lookup', 'ldap_query'],
  ['evaluate', 'xpath_query'],
  ['compile', 'xpath_query'],
  // Trust boundary: the value is stored in the session, where a later request trusts it.
  ['setAttribute', 'trust_boundary'],
  ['putValue', 'trust_boundary'],
];

/**
 * What removes the danger from a value, in the libraries a Java web application actually calls.
 *
 * **This list is the difference between a finding and a false alarm on half of this benchmark.** A safe test case
 * reads the same `request.getParameter(...)` a vulnerable one does and then passes the value through
 * `ESAPI.encoder().encodeForHTML(...)` or binds it with `PreparedStatement.setString(...)`. Without these entries the
 * engine reported every one of them: measured with the sinks above and no sanitizers, **FPR was 0.226 against a TPR
 * of 0.291**, which is the shape of a scanner that finds everything and tells you nothing.
 *
 * The type-conversion entries are a different kind of neutraliser and are listed for the same reason: `Integer.parseInt`
 * cannot carry a path or a SQL fragment onward, so a flow through it is over.
 */
const JAVA_SANITIZERS: SanitizerVocabulary = [
  // OWASP ESAPI, which this benchmark's safe cases use throughout.
  ['encodeForHTML', 'escaping', ['html']],
  ['encodeForHTMLAttribute', 'escaping', ['html']],
  ['encodeForJavaScript', 'escaping', ['html']],
  ['encodeForCSS', 'escaping', ['html']],
  ['encodeForURL', 'encoding', ['html', 'path']],
  ['encodeForSQL', 'escaping', ['sql_exec']],
  ['encodeForOS', 'escaping', ['os_command']],
  ['encodeForLDAP', 'escaping', ['ldap_query']],
  ['encodeForDN', 'escaping', ['ldap_query']],
  ['encodeForXPath', 'escaping', ['xpath_query']],
  ['encodeForXML', 'escaping', ['html']],
  ['getValidSafeHTML', 'validation', ['html']],
  ['getValidInput', 'validation', ['html']],
  ['getValidFileName', 'path', ['file_read', 'file_write']],
  ['getValidDirectoryPath', 'path', ['file_read', 'file_write']],
  ['getValidNumber', 'validation', TYPE_CONVERSION_KINDS],
  ['getValidDate', 'validation', TYPE_CONVERSION_KINDS],
  // Apache Commons Text and Lang.
  ['escapeHtml4', 'escaping', ['html']],
  ['escapeXml10', 'escaping', ['html']],
  ['escapeXml11', 'escaping', ['html']],
  ['escapeSql', 'escaping', ['sql_exec']],
  ['escapeJava', 'escaping', ['html']],
  ['escapeJavaScript', 'escaping', ['html']],
  // Type conversion: the value that comes out is a number, not the text that went in.
  ['parseInt', 'validation', TYPE_CONVERSION_KINDS],
  ['parseLong', 'validation', TYPE_CONVERSION_KINDS],
  ['parseDouble', 'validation', TYPE_CONVERSION_KINDS],
  ['parseFloat', 'validation', TYPE_CONVERSION_KINDS],
  ['parseBoolean', 'validation', TYPE_CONVERSION_KINDS],
  ['fromString', 'validation', TYPE_CONVERSION_KINDS],
  // Bound parameters, which is how the benchmark writes a safe SQL statement.
  ['setString', 'parameterisation', ['sql_exec']],
  ['setInt', 'parameterisation', ['sql_exec']],
  ['setLong', 'parameterisation', ['sql_exec']],
  ['setDouble', 'parameterisation', ['sql_exec']],
  ['setBoolean', 'parameterisation', ['sql_exec']],
  ['setObject', 'parameterisation', ['sql_exec']],
  ['setDate', 'parameterisation', ['sql_exec']],
];

/**
 * Callees that end in a sink's name and are not one.
 *
 * `System.out.println(value)` and `response.getWriter().println(value)` both reduce to `println`, and only the second
 * is cross-site scripting. Measured on the 1.2beta checkout: ninety-eight of the 297 flagged safe cases contained a
 * console write.
 */
const JAVA_IGNORED_SINKS: readonly string[] = ['System.out.', 'System.err.'];

/** The C family's list, extended with the servlet API. */
export const JAVA_TAINT_VOCABULARY: TaintVocabulary = {
  sources: [...C_LIKE_VOCABULARY.sources, ...JAVA_SOURCES],
  sinks: [...C_LIKE_VOCABULARY.sinks, ...JAVA_SINKS],
  // Composed from the shared list rather than from `C_LIKE_VOCABULARY.sanitizers`, so that the dependency is on a
  // named list that exists at this point in the module graph. When the vocabulary was written the other way the
  // shared entries were absent, and `escape(input)` — recognised in nine languages — was not recognised in Java.
  sanitizers: [...C_LIKE_SANITIZERS, ...JAVA_SANITIZERS],
  ignoreSinkPrefixes: JAVA_IGNORED_SINKS,
};

/**
 * Types whose `write`/`append`/`print` does not reach a browser.
 *
 * **`html` is a claim about the destination, not about the method.** A servlet writing a value into the response body
 * is cross-site scripting; the same method name on a `FileWriter` writes into a file whose path was fixed when the
 * writer was constructed, and the same name on a `StringBuilder` writes into memory. The sink list can only see the
 * method name, so the destination has to come from somewhere else — and in Java it is one statement away, in the
 * variable's declared type.
 *
 * **Measured on OWASP Benchmark v1.2: this is 85 of the 490 false positives.** Every one of them is a `Crypto` case
 * that encryption output, or an encoder's output, to a file: `fw.write("secret_value=" + encoded)`. The case's own
 * label is about the cipher, and no competing scanner reports the write, because no competing scanner calls a file
 * write cross-site scripting.
 *
 * **A builder is on the list for the same reason and with a caveat.** `sb.append(param)` is an intermediate step, and
 * the value is caught where the builder's contents are written to the response. It is not caught if the builder is
 * never written anywhere, which is exactly the case where it should not be.
 */
const NON_RESPONSE_WRITER_TYPES: ReadonlySet<string> = new Set([
  'FileWriter',
  'FileOutputStream',
  'BufferedWriter',
  'OutputStreamWriter',
  'PrintStream',
  'StringWriter',
  'ByteArrayOutputStream',
  'StringBuilder',
  'StringBuffer',
]);

/**
 * Every local variable this file declares with an initialiser, mapped to the simple type it is constructed as.
 *
 * **Deliberately narrow.** The pattern is `Type name = new Type(...)`, which is how a writer is declared when the
 * declaration and the construction are the same statement; a variable assigned later, from a parameter, or declared
 * without an initialiser is absent and therefore keeps its sink. **An unknown destination is not a safe one**, and the
 * default has to be the conservative one or the filter becomes a way to lose findings quietly.
 */
/** The last dot-separated segment of a name, and the whole name when it has no dot. */
function afterLastDot(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(dot + 1);
}

export function declaredConstructedTypes(source: string): ReadonlyMap<string, string> {
  const types = new Map<string, string>();
  const pattern =
    /\b([A-Za-z_$][\w$.]*)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$.]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    // **Three mandatory groups, and a match always carries all three.** `match[i]` is typed `string | undefined`
    // because an array index is, not because this pattern can omit a group — so the guard this used to have was a
    // branch no input could take, and the assertion below states the pattern rather than guessing at it.
    const [, , variable, constructed] = match as unknown as [string, string, string, string];
    // **The simple type name, taken from the last dot.** `new java.io.FileWriter(...)` declares a `FileWriter`, and
    // what the filter asks is whether that simple name is a non-response writer.
    types.set(variable, afterLastDot(constructed));
  }
  return types;
}

/**
 * Whether a matched `html` sink really writes to the response body.
 *
 * Every other kind is left alone: `file_write` names a path position and `sql_exec` names a statement, and the
 * receiver tells us nothing about either that the argument does not.
 *
 * @param sink the sink the vocabulary matched.
 * @param declaredTypes the file's constructed variables, from {@link declaredConstructedTypes}.
 */
export function writesToResponseBody(
  sink: { readonly name: string; readonly sinkType: string },
  declaredTypes: ReadonlyMap<string, string>,
): boolean {
  if (sink.sinkType !== 'html') return true;
  const segments = sink.name.split('.');
  // **A bare `write(...)` has no receiver to ask about**, and a chain (`x.getWriter().write`) has a call in the
  // receiver position rather than a variable — neither can be resolved to a declaration, so both keep the sink.
  // Written as a single `at(-2)` test rather than a length guard plus an index: the two are the same question, and
  // the second form left a fallback arm (`?? ''`) that no input could reach.
  const receiver = segments.at(-2);
  if (receiver === undefined) return true;
  const declared = declaredTypes.get(receiver);
  return declared === undefined || !NON_RESPONSE_WRITER_TYPES.has(declared);
}
