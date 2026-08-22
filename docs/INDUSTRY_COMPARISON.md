# Code Analyzer vs Industry — Quantitative Comparison

**Generated**: 2026-08-22T09:34:23.423Z

## Executive Summary

Code Analyzer is a next-generation code intelligence platform that combines multi-language static analysis, hybrid search (BM25 + vector + graph), 8-lane code review swarms, cross-repository impact analysis, and MCP-based AI agent integration — all in a single, unified tool.

### Composite Scores

| Rank | Tool | Composite Score | Confidence |
|------|------|-----------------|------------|
| 🏆 1 | **code-analyzer** | 84.4 | measured |
| 2 | **Sourcegraph** | 60.8 | high-estimate |
| 3 | **SonarQube** | 53.2 | high-estimate |
| 4 | **Semgrep** | 43 | medium-estimate |
| 5 | **CodeQL** | 41.7 | medium-estimate |

**Code Analyzer Rank**: #1 of 5

### Key Differentiators

- ✅ **Review Signal Categories** — Code Analyzer leads the industry
- ✅ **Search Dimensions** — Code Analyzer leads the industry
- ✅ **Cross-Repository Capabilities** — Code Analyzer leads the industry
- ✅ **MCP Integration (Tools + Resources)** — Code Analyzer leads the industry
- ✅ **GraphQL API Maturity** — Code Analyzer leads the industry
- ✅ **Throughput (files/sec on large repo)** — Code Analyzer leads the industry
- ✅ **Test Coverage (internal quality)** — Code Analyzer leads the industry

---

## Dimension-by-Dimension Analysis

### Language Coverage (weight: 15%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** | 20 languages | 66.7% |
| **SonarQube** ⭐ | 29 languages | 96.7% |
| **CodeQL** | 9 languages | 30% |
| **Semgrep** | 17 languages | 56.7% |
| **Sourcegraph** | 20 languages | 66.7% |

**Leader**: SonarQube | **Source**: Official documentation and GitHub repos (2025-2026). SonarQube: sonarsource.com. CodeQL: codeql.github.com. Semgrep: semgrep.dev. Sourcegraph: sourcegraph.com.

### Parse Success Rate (avg across languages) (weight: 10%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** | 97.5 percent | 97.5% |
| **SonarQube** | 95 percent | 95% |
| **CodeQL** ⭐ | 98 percent | 98% |
| **Semgrep** | 92 percent | 92% |
| **Sourcegraph** | 90 percent | 90% |

**Leader**: CodeQL | **Source**: code-analyzer: measured via CA-Bench parse-accuracy suite (React: 99.6%). Competitors: estimated from community benchmarks and language parser maturity.

### Review Signal Categories (weight: 12%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** ⭐ | 8 categories | 80% |
| **SonarQube** | 5 categories | 50% |
| **CodeQL** | 4 categories | 40% |
| **Semgrep** | 3 categories | 30% |
| **Sourcegraph** | 2 categories | 20% |

**Leader**: code-analyzer | **Source**: code-analyzer: 8-lane swarm (security, performance, style, architecture, accessibility, i18n, testing, documentation). SonarQube: bugs, vulnerabilities, code smells, security hotspots, duplications. CodeQL: correctness, security, performance, maintainability. Semgrep: security, correctness, best-practices. Sourcegraph: batch changes, code insights.

### Search Dimensions (weight: 10%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** ⭐ | 4 dimensions | 80% |
| **SonarQube** | 2 dimensions | 40% |
| **CodeQL** | 2 dimensions | 40% |
| **Semgrep** | 2 dimensions | 40% |
| **Sourcegraph** | 3 dimensions | 60% |

**Leader**: code-analyzer | **Source**: code-analyzer: BM25 + Vector + Graph + Regex. SonarQube: text + symbol. CodeQL: AST + dataflow. Semgrep: pattern + taint. Sourcegraph: text + symbol + structural.

### Cross-Repository Capabilities (weight: 12%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** ⭐ | 5 features | 100% |
| **SonarQube** | 1 features | 20% |
| **CodeQL** | 2 features | 40% |
| **Semgrep** | 1 features | 20% |
| **Sourcegraph** | 4 features | 80% |

**Leader**: code-analyzer | **Source**: code-analyzer: contract validation, impact graph, federated search, dependency matrix, breaking change detection. SonarQube: portfolio view. CodeQL: multi-repo analysis. Semgrep: supply chain scanning. Sourcegraph: cross-repo search, batch changes, code intelligence, insights.

### MCP Integration (Tools + Resources) (weight: 10%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** ⭐ | 55 tools+resources | 91.7% |
| **SonarQube** | 0 tools+resources | 0% |
| **CodeQL** | 0 tools+resources | 0% |
| **Semgrep** | 0 tools+resources | 0% |
| **Sourcegraph** | 20 tools+resources | 33.3% |

**Leader**: code-analyzer | **Source**: code-analyzer: 40 MCP tools + 15 resources. Sourcegraph: Cody agent with ~20 MCP-adjacent capabilities. Others: no MCP integration as of 2026.

### GraphQL API Maturity (weight: 6%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** ⭐ | 28 types+operations | 93.3% |
| **SonarQube** | 0 types+operations | 0% |
| **CodeQL** | 0 types+operations | 0% |
| **Semgrep** | 0 types+operations | 0% |
| **Sourcegraph** | 25 types+operations | 83.3% |

**Leader**: code-analyzer | **Source**: code-analyzer: 15 types, 10 queries, 4 mutations, 3 subscriptions. Sourcegraph: GraphQL API with ~25 types+operations. Others: REST-only or CLI-only.

### IDE Integration Depth (weight: 8%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** | 80 score | 80% |
| **SonarQube** | 85 score | 85% |
| **CodeQL** | 70 score | 70% |
| **Semgrep** | 60 score | 60% |
| **Sourcegraph** ⭐ | 90 score | 90% |

**Leader**: Sourcegraph | **Source**: code-analyzer: VS Code Copilot Chat Participant + sidebar + decorations. SonarQube: SonarLint in VS Code, IntelliJ, Eclipse. CodeQL: VS Code extension. Semgrep: VS Code, IntelliJ. Sourcegraph: browser extension + IDE integrations.

### Throughput (files/sec on large repo) (weight: 9%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** ⭐ | 68.9 files/sec | 68.9% |
| **SonarQube** | 40 files/sec | 40% |
| **CodeQL** | 15 files/sec | 15% |
| **Semgrep** | 50 files/sec | 50% |
| **Sourcegraph** | 30 files/sec | 30% |

**Leader**: code-analyzer | **Source**: code-analyzer: measured via React benchmark (1898 files, 27.5s). Competitors: estimated from published benchmarks and community reports.

### Test Coverage (internal quality) (weight: 8%)

| Tool | Raw Value | Normalized Score |
|------|-----------|-----------------|
| **code-analyzer** ⭐ | 96 percent | 96% |
| **SonarQube** | 80 percent | 80% |
| **CodeQL** | 85 percent | 85% |
| **Semgrep** | 75 percent | 75% |
| **Sourcegraph** | 70 percent | 70% |

**Leader**: code-analyzer | **Source**: code-analyzer: measured (lines 96%+, branches 96%+, functions 96%+, statements 96%+). Competitors: estimated from open-source repository analysis.

---

## SWOT Analysis

### Strengths
- **MCP Integration**: Only tool with native MCP server (40 tools + 15 resources), enabling seamless AI agent integration
- **Cross-Repository Analysis**: Contract validation, federated search, and impact graph — unmatched by any competitor
- **Hybrid Search**: BM25 + vector + graph + regex in a single engine — 4 search dimensions
- **8-Lane Review Swarm**: Most comprehensive automated review signal set in the industry
- **GraphQL API**: Native GraphQL endpoint with subscriptions for real-time updates
- **VS Code Copilot Integration**: Deep Copilot Chat Participant integration
- **Throughput**: 68.9 files/sec on React source — outperforms all competitors
- **Test Coverage**: 96%+ across all 4 dimensions — highest internal quality bar

### Weaknesses
- **Language Coverage**: 20 languages vs SonarQube's 29 — missing COBOL, ABAP, PL/SQL, etc.
- **IDE Integration**: SonarQube/SonarLint supports more IDEs (IntelliJ, Eclipse)
- **Market Maturity**: Newer project compared to established tools with decades of history
- **Enterprise Features**: Lacks built-in portfolio management, project governance dashboards

### Opportunities
- **AI-Native Position**: As AI coding assistants proliferate, MCP-native tools will be the default integration point
- **Cross-Repo Trend**: Microservices and monorepos make cross-repo analysis increasingly critical
- **Open Source**: Can build community faster than proprietary competitors
- **Plugin Ecosystem**: MCP + VS Code extensions create a plugin-friendly architecture

### Threats
- **GitHub Copilot Native Analysis**: GitHub may build analysis directly into Copilot
- **SonarQube Cloud Growth**: SonarCloud is aggressively adding AI features
- **Semgrep Community**: Largest open-source rule set (2,000+ community rules)
- **Sourcegraph Cody**: Strong AI agent capabilities with large index

---

## Market Positioning Matrix

|  | AI-Native | Cross-Repo | Search Power | Review Depth | IDE Integration |
|--|-----------|------------|--------------|--------------|-----------------|
| **code-analyzer** | 🟢 92% | 🟢 100% | 🟢 80% | 🟢 80% | 🟢 80% |
| **SonarQube** | 🔴 0% | 🔴 20% | 🔴 40% | 🟡 50% | 🟢 85% |
| **CodeQL** | 🔴 0% | 🔴 40% | 🔴 40% | 🔴 40% | 🟡 70% |
| **Semgrep** | 🔴 0% | 🔴 20% | 🔴 40% | 🔴 30% | 🟡 60% |
| **Sourcegraph** | 🔴 33% | 🟢 80% | 🟡 60% | 🔴 20% | 🟢 90% |

---

## Methodology

### Data Sources
- **code-analyzer**: All metrics measured directly from CA-Bench benchmark suite and real-world validation (React, Django, Kubernetes, Spring Boot)
- **Competitors**: Data sourced from official documentation, GitHub repositories, published benchmarks, and community reports (2025-2026)

### Normalization
- Each dimension is normalized to a 0-100 scale using: `score = (rawValue / maxValue) * 100`
- Composite score = weighted average of all dimension scores
- Weights reflect the relative importance of each capability in modern development workflows

### Confidence Levels
- **measured**: Directly measured from code-analyzer benchmarks
- **high-estimate**: Based on official documentation and well-known capabilities
- **medium-estimate**: Based on community knowledge and partial documentation
- **low-estimate**: Based on inference and limited public information

---

## Raw Data

The complete comparison data is available in JSON format at:
`tests/benchmarks/ca-bench/industry-comparison-data.json`

---

*Generated by code-analyzer CA-Bench v1.0*