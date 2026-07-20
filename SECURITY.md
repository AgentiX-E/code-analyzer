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

- All dependencies are pinned with exact versions in `pnpm-lock.yaml`
- Regular `npm audit` runs on every PR via CI
- SBOM (Software Bill of Materials) generated for every release
- Dependencies are reviewed before addition

### Code Security

- CodeQL static analysis runs on every push to main and every PR
- No secrets or credentials in source code (enforced by pre-commit hooks)
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
