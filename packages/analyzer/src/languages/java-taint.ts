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

import { C_LIKE_SANITIZERS, C_LIKE_VOCABULARY } from './base-c-like.js';

import type { TaintVocabulary } from './base-c-like.js';

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
const JAVA_SANITIZERS: ReadonlyArray<readonly [string, string]> = [
  // OWASP ESAPI, which this benchmark's safe cases use throughout.
  ['encodeForHTML', 'escaping'],
  ['encodeForHTMLAttribute', 'escaping'],
  ['encodeForJavaScript', 'escaping'],
  ['encodeForCSS', 'escaping'],
  ['encodeForURL', 'encoding'],
  ['encodeForSQL', 'escaping'],
  ['encodeForOS', 'escaping'],
  ['encodeForLDAP', 'escaping'],
  ['encodeForDN', 'escaping'],
  ['encodeForXPath', 'escaping'],
  ['encodeForXML', 'escaping'],
  ['getValidSafeHTML', 'validation'],
  ['getValidInput', 'validation'],
  ['getValidFileName', 'path'],
  ['getValidDirectoryPath', 'path'],
  ['getValidNumber', 'validation'],
  ['getValidDate', 'validation'],
  // Apache Commons Text and Lang.
  ['escapeHtml4', 'escaping'],
  ['escapeXml10', 'escaping'],
  ['escapeXml11', 'escaping'],
  ['escapeSql', 'escaping'],
  ['escapeJava', 'escaping'],
  ['escapeJavaScript', 'escaping'],
  // Type conversion: the value that comes out is a number, not the text that went in.
  ['parseInt', 'validation'],
  ['parseLong', 'validation'],
  ['parseDouble', 'validation'],
  ['parseFloat', 'validation'],
  ['parseBoolean', 'validation'],
  ['fromString', 'validation'],
  // Bound parameters, which is how the benchmark writes a safe SQL statement.
  ['setString', 'parameterisation'],
  ['setInt', 'parameterisation'],
  ['setLong', 'parameterisation'],
  ['setDouble', 'parameterisation'],
  ['setBoolean', 'parameterisation'],
  ['setObject', 'parameterisation'],
  ['setDate', 'parameterisation'],
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
