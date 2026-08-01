// CA-Bench Fixtures — Known Vulnerabilities
// Curated code snippets containing well-known vulnerability patterns:
// SQL Injection, XSS, CSRF, Path Traversal, Hardcoded Secrets, Command Injection.
// Used by the review-quality and search-quality benchmark suites.

// ---------------------------------------------------------------------------
// SQL Injection Vulnerabilities
// ---------------------------------------------------------------------------

export const SQL_INJECTION_JS = `
// VULNERABILITY: SQL Injection via string concatenation
function getUserById(userId) {
  const query = "SELECT * FROM users WHERE id = '" + userId + "'";
  return db.execute(query);
}
`;

export const SQL_INJECTION_TS = `
// VULNERABILITY: SQL Injection via template literal
async function getUserById(userId: string) {
  const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
  return db.execute(query);
}
`;

export const SQL_INJECTION_PY = `
# VULNERABILITY: SQL Injection via string formatting
def get_user_by_id(user_id):
    query = f"SELECT * FROM users WHERE id = '{user_id}'"
    return cursor.execute(query)
`;

export const SQL_INJECTION_JAVA = `
// VULNERABILITY: SQL Injection via string concatenation
public User getUserById(String userId) {
    String query = "SELECT * FROM users WHERE id = '" + userId + "'";
    return jdbcTemplate.queryForObject(query, User.class);
}
`;

// ---------------------------------------------------------------------------
// XSS Vulnerabilities
// ---------------------------------------------------------------------------

export const XSS_JS_DOM = `
// VULNERABILITY: DOM-based XSS via innerHTML
function displayMessage(msg) {
  document.getElementById('output').innerHTML = msg;
}
`;

export const XSS_TS_REACT = `
// VULNERABILITY: XSS via dangerouslySetInnerHTML
function UserComment({ comment }: { comment: string }) {
  return <div dangerouslySetInnerHTML={{ __html: comment }} />;
}
`;

// ---------------------------------------------------------------------------
// Path Traversal Vulnerabilities
// ---------------------------------------------------------------------------

export const PATH_TRAVERSAL_JS = `
// VULNERABILITY: Path traversal via unsanitized user input
function readFile(filename) {
  return fs.readFileSync('/app/data/' + filename, 'utf-8');
}
`;

export const PATH_TRAVERSAL_PY = `
# VULNERABILITY: Path traversal via unsanitized input
def read_file(filename):
    with open(f"/app/data/{filename}", "r") as f:
        return f.read()
`;

// ---------------------------------------------------------------------------
// Hardcoded Secrets
// ---------------------------------------------------------------------------

export const HARDCODED_SECRET_JS = `
// VULNERABILITY: Hardcoded API key
const API_KEY = "sk-1234567890abcdef1234567890abcdef";
const STRIPE_SECRET = "sk_live_51ABCDEF1234567890";
`;

export const HARDCODED_SECRET_PY = `
# VULNERABILITY: Hardcoded credentials
DB_PASSWORD = "super_secret_password_123!"
AWS_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
`;

// ---------------------------------------------------------------------------
// Command Injection
// ---------------------------------------------------------------------------

export const COMMAND_INJECTION_JS = `
// VULNERABILITY: Command injection via child_process
function ping(host) {
  require('child_process').exec('ping -c 1 ' + host);
}
`;

export const COMMAND_INJECTION_PY = `
# VULNERABILITY: Command injection via os.system
def ping(host):
    import os
    os.system(f"ping -c 1 {host}")
`;

// ---------------------------------------------------------------------------
// All Vulnerabilities Map
// ---------------------------------------------------------------------------

export const ALL_VULNERABILITIES: Record<string, { code: string; language: string; vulnType: string; severity: string }> = {
  'sql-injection-js': { code: SQL_INJECTION_JS, language: 'javascript', vulnType: 'sql-injection', severity: 'critical' },
  'sql-injection-ts': { code: SQL_INJECTION_TS, language: 'typescript', vulnType: 'sql-injection', severity: 'critical' },
  'sql-injection-py': { code: SQL_INJECTION_PY, language: 'python', vulnType: 'sql-injection', severity: 'critical' },
  'sql-injection-java': { code: SQL_INJECTION_JAVA, language: 'java', vulnType: 'sql-injection', severity: 'critical' },
  'xss-dom': { code: XSS_JS_DOM, language: 'javascript', vulnType: 'xss', severity: 'high' },
  'xss-react': { code: XSS_TS_REACT, language: 'typescript', vulnType: 'xss', severity: 'high' },
  'path-traversal-js': { code: PATH_TRAVERSAL_JS, language: 'javascript', vulnType: 'path-traversal', severity: 'high' },
  'path-traversal-py': { code: PATH_TRAVERSAL_PY, language: 'python', vulnType: 'path-traversal', severity: 'high' },
  'hardcoded-secret-js': { code: HARDCODED_SECRET_JS, language: 'javascript', vulnType: 'hardcoded-secret', severity: 'critical' },
  'hardcoded-secret-py': { code: HARDCODED_SECRET_PY, language: 'python', vulnType: 'hardcoded-secret', severity: 'critical' },
  'command-injection-js': { code: COMMAND_INJECTION_JS, language: 'javascript', vulnType: 'command-injection', severity: 'critical' },
  'command-injection-py': { code: COMMAND_INJECTION_PY, language: 'python', vulnType: 'command-injection', severity: 'critical' },
};
