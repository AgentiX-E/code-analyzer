# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities to security@agentix.dev.

Do NOT create public GitHub issues for security vulnerabilities.

We aim to acknowledge reports within 48 hours and provide a fix within 14 days.

## Supply Chain Security

Code Analyzer implements multiple layers of supply chain security:

- **CodeQL SAST**: Static analysis on every push and PR
- **Dependency Review**: All dependency changes are reviewed for known vulnerabilities
- **SLSA Level 3**: Cryptographic build provenance via GitHub Actions
- **Sigstore Cosign**: Keyless signatures on all release artifacts
- **SHA-256 Checksums**: Published with every release
- **Zero Telemetry**: No usage data is collected

## Security Features

- **RBAC**: 5 roles with 26 granular permissions
- **Audit Logging**: SHA-256 hash chain with tamper detection
- **Secret Scanning**: 16 pattern categories + Shannon entropy detection
- **Rate Limiting**: Token bucket algorithm per user/tool
- **100% Local Processing**: Code never leaves the machine
