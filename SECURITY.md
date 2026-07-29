# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, report them via email to **security@agentix.dev** (or the project maintainer's security contact).

We aim to:

- Acknowledge receipt within 24 hours
- Provide an initial assessment within 72 hours
- Release a fix within 7 days for critical vulnerabilities
- Coordinate disclosure with the reporter

## Security Measures

### Supply Chain

- **All dependencies pinned** with exact versions in `pnpm-lock.yaml`
- **CodeQL static analysis** runs on every push to main and every PR (security-extended + security-and-quality queries)
- **Dependency review** runs on every PR, blocking known-vulnerable dependencies
- **SBOM generation** produces SPDX 2.3-compliant bills of materials for every release
- **npm provenance** enabled — packages are built and published with verifiable build attestations
- **Cosign signing** for Docker images — all container images are cryptographically signed
- Regular `npm audit` / `pnpm audit` runs on every PR via CI

### Code Security

- CodeQL static analysis runs on every push to main and every PR
- No secrets or credentials in source code
- All user input is validated and sanitized
- SQL injection prevention via parameterized queries
- No `eval()` or dynamic code execution on untrusted input

### Runtime Security

- MCP server supports API key authentication
- Rate limiting on all MCP tools
- Tool-level access policies (read-only, read-write, admin profiles)
- Request logging for audit trails
- Worker processes run in isolated child processes
- File system access is scoped to configured project directories
- No arbitrary command execution from external input

### Data Security

- No user code leaves the machine (all analysis is local)
- Embedding vectors are stored locally
- Knowledge graphs are stored in local SQLite databases
- Network requests only for GitHub API (when configured) and optional LLM features

### Vulnerability Disclosure Timeline

| Severity | Response | Fix | Disclosure |
|----------|----------|-----|------------|
| Critical | 24 hours | 7 days | Coordinated |
| High     | 48 hours | 14 days | Coordinated |
| Medium   | 1 week   | 30 days | Public |
| Low      | 2 weeks  | 90 days | Public |

## Security Best Practices for Users

1. **API Keys**: Always use API key authentication when exposing the MCP server
2. **Network Binding**: Bind MCP server to `localhost` only unless you have a specific need
3. **Rate Limiting**: Configure appropriate rate limits for your use case
4. **Tool Policies**: Use the most restrictive tool policy profile that meets your needs
5. **Regular Updates**: Keep Code Analyzer updated to the latest version
6. **GitHub Tokens**: Use fine-grained GitHub tokens with minimal scopes

## OWASP Top 10 Compliance

Code Analyzer implements controls aligned with the OWASP Top 10 (2021):

| OWASP Category | Mitigation |
|----------------|-----------|
| A01: Broken Access Control | API key authentication, RBAC engine, tool-level access policies, rate limiting |
| A02: Cryptographic Failures | TLS/mTLS support, credential redaction in logs, no plaintext secrets in source |
| A03: Injection | Input validation, parameterized Cypher queries, path sanitization |
| A04: Insecure Design | Security audit framework, threat modeling, countermeasure verification |
| A05: Security Misconfiguration | Default-deny MCP tool profiles, non-root Docker containers, minimal exposed ports |
| A06: Vulnerable Components | Pinned dependencies, automated dependency audit, SBOM generation |
| A07: Auth Failures | API key validation, rate limiting on auth endpoints, audit logging |
| A08: Software & Data Integrity | SLSA Level 3 provenance, Cosign container signing, lockfile integrity checks |
| A09: Logging & Monitoring | Structured JSON logging, request audit trails, security event recording |
| A10: SSRF | File system access scoped to project directories, no arbitrary URL fetching from external input |

## CWE Top 25 Alignment

Countermeasures address the following CWE Top 25 weaknesses:

- **CWE-22**: Path Traversal — Path sanitization in all file operations
- **CWE-78**: OS Command Injection — No shell execution from external input
- **CWE-79**: Cross-Site Scripting — Content-type enforcement in HTTP responses
- **CWE-89**: SQL Injection — Parameterized queries in SQLite graph store
- **CWE-200**: Sensitive Data Exposure — Secret redaction, local-only processing
- **CWE-287**: Improper Authentication — API key validation, mTLS support
- **CWE-798**: Hard-coded Credentials — Secret scanning with 15+ built-in patterns
- **CWE-918**: Server-Side Request Forgery — Network request scoping

## GPG Key

Releases are signed with the following GPG key:

```
Key ID: to-be-published
Fingerprint: to-be-published
```

To verify a release:

```bash
gpg --verify code-analyzer-{version}.tar.gz.sig code-analyzer-{version}.tar.gz
```

## Responsible Disclosure

We follow a coordinated disclosure process:

1. Reporter submits vulnerability via email to **security@agentix.dev**
2. We acknowledge within 24 hours
3. We investigate and validate within 72 hours
4. We develop and test a fix
5. We coordinate a release date with the reporter
6. We publish an advisory after the fix is available

We do not offer monetary bounties at this time, but we publicly acknowledge reporters in our security advisories (with permission).
