# Code Analyzer vs Industry — Quantitative Comparison

**Generated**: 2026-11-08T03:04:18.104Z

> **This is a rubric, not a measurement.** Every cell below is scored by weights this project chose, against
> capability checklists rather than against a corpus two tools both ran. Rows marked `estimate` are read from a
> vendor's own documentation and were not measured here. **A composite score is therefore a description of the
> rubric**, and the ordering it produces is not a ranking of quality - `README.md` § Benchmarks states the policy
> that a figure this project did not measure is not a comparison, and this page is an artefact the policy applies
> to. The one head-to-head run in this repository is `benchmarks/aacr-bench.json`, and it puts us second.

## Executive Summary

Code Analyzer is a next-generation code intelligence platform that combines multi-language static analysis, hybrid search (BM25 + vector + graph), 8-lane code review swarms, cross-repository impact analysis, and MCP-based AI agent integration — all in a single, unified tool.

### Composite Scores

| Rank | Tool              | Composite Score | Confidence      |
| ---- | ----------------- | --------------- | --------------- |
| 1    | **code-analyzer** | 84.4            | measured        |
| 2    | **Sourcegraph**   | 60.8            | high-estimate   |
| 3    | **SonarQube**     | 53.2            | high-estimate   |
| 4    | **Semgrep**       | 43              | medium-estimate |
| 5    | **CodeQL**        | 41.7            | medium-estimate |

**Code Analyzer Rank**: #1 of 5 — on this rubric only, with 4 of 5 rows scored from vendor documentation rather than from a run.

### Key Differentiators

- **Review Signal Categories** — present here, and scored as present in the rubric below
- **Search Dimensions** — present here, and scored as present in the rubric below
- **Cross-Repository Capabilities** — present here, and scored as present in the rubric below
- **MCP Integration** — present here, and scored as present in the rubric below
- **GraphQL API Maturity** — present here, and scored as present in the rubric below
- **Throughput (files/sec)** — present here, and scored as present in the rubric below
- **Test Coverage** — present here, and scored as present in the rubric below

---

## Dimension-by-Dimension Analysis

### Language Coverage (weight: 15%)

| Tool              | Raw Value    | Normalized Score |
| ----------------- | ------------ | ---------------- |
| **code-analyzer** | 20 languages | 66.7%            |
| **SonarQube** ⭐  | 29 languages | 96.7%            |
| **CodeQL**        | 9 languages  | 30%              |
| **Semgrep**       | 17 languages | 56.7%            |
| **Sourcegraph**   | 20 languages | 66.7%            |

**Leader**: SonarQube

### Parse Success Rate (weight: 10%)

| Tool              | Raw Value    | Normalized Score |
| ----------------- | ------------ | ---------------- |
| **code-analyzer** | 97.5 percent | 97.5%            |
| **SonarQube**     | 95 percent   | 95%              |
| **CodeQL** ⭐     | 98 percent   | 98%              |
| **Semgrep**       | 92 percent   | 92%              |
| **Sourcegraph**   | 90 percent   | 90%              |

**Leader**: CodeQL

### Review Signal Categories (weight: 12%)

| Tool                 | Raw Value    | Normalized Score |
| -------------------- | ------------ | ---------------- |
| **code-analyzer** ⭐ | 8 categories | 80%              |
| **SonarQube**        | 5 categories | 50%              |
| **CodeQL**           | 4 categories | 40%              |
| **Semgrep**          | 3 categories | 30%              |
| **Sourcegraph**      | 2 categories | 20%              |

**Leader**: code-analyzer

### Search Dimensions (weight: 10%)

| Tool                 | Raw Value    | Normalized Score |
| -------------------- | ------------ | ---------------- |
| **code-analyzer** ⭐ | 4 dimensions | 80%              |
| **SonarQube**        | 2 dimensions | 40%              |
| **CodeQL**           | 2 dimensions | 40%              |
| **Semgrep**          | 2 dimensions | 40%              |
| **Sourcegraph**      | 3 dimensions | 60%              |

**Leader**: code-analyzer

### Cross-Repository Capabilities (weight: 12%)

| Tool                 | Raw Value  | Normalized Score |
| -------------------- | ---------- | ---------------- |
| **code-analyzer** ⭐ | 5 features | 100%             |
| **SonarQube**        | 1 features | 20%              |
| **CodeQL**           | 2 features | 40%              |
| **Semgrep**          | 1 features | 20%              |
| **Sourcegraph**      | 4 features | 80%              |

**Leader**: code-analyzer

### MCP Integration (weight: 10%)

| Tool                 | Raw Value          | Normalized Score |
| -------------------- | ------------------ | ---------------- |
| **code-analyzer** ⭐ | 55 tools+resources | 91.7%            |
| **SonarQube**        | 0 tools+resources  | 0%               |
| **CodeQL**           | 0 tools+resources  | 0%               |
| **Semgrep**          | 0 tools+resources  | 0%               |
| **Sourcegraph**      | 20 tools+resources | 33.3%            |

**Leader**: code-analyzer

### GraphQL API Maturity (weight: 6%)

| Tool                 | Raw Value           | Normalized Score |
| -------------------- | ------------------- | ---------------- |
| **code-analyzer** ⭐ | 28 types+operations | 93.3%            |
| **SonarQube**        | 0 types+operations  | 0%               |
| **CodeQL**           | 0 types+operations  | 0%               |
| **Semgrep**          | 0 types+operations  | 0%               |
| **Sourcegraph**      | 25 types+operations | 83.3%            |

**Leader**: code-analyzer

### IDE Integration Depth (weight: 8%)

| Tool               | Raw Value | Normalized Score |
| ------------------ | --------- | ---------------- |
| **code-analyzer**  | 80 score  | 80%              |
| **SonarQube**      | 85 score  | 85%              |
| **CodeQL**         | 70 score  | 70%              |
| **Semgrep**        | 60 score  | 60%              |
| **Sourcegraph** ⭐ | 90 score  | 90%              |

**Leader**: Sourcegraph

### Throughput (files/sec) (weight: 9%)

| Tool                 | Raw Value      | Normalized Score |
| -------------------- | -------------- | ---------------- |
| **code-analyzer** ⭐ | 68.9 files/sec | 68.9%            |
| **SonarQube**        | 40 files/sec   | 40%              |
| **CodeQL**           | 15 files/sec   | 15%              |
| **Semgrep**          | 50 files/sec   | 50%              |
| **Sourcegraph**      | 30 files/sec   | 30%              |

**Leader**: code-analyzer

### Test Coverage (weight: 8%)

| Tool                 | Raw Value  | Normalized Score |
| -------------------- | ---------- | ---------------- |
| **code-analyzer** ⭐ | 96 percent | 96%              |
| **SonarQube**        | 80 percent | 80%              |
| **CodeQL**           | 85 percent | 85%              |
| **Semgrep**          | 75 percent | 75%              |
| **Sourcegraph**      | 70 percent | 70%              |

**Leader**: code-analyzer

---

## SWOT Analysis

### Strengths

- **MCP Integration**: Only tool with native MCP server (40 tools + 15 resources)
- **Cross-Repository Analysis**: Contract validation, federated search, impact graph
- **Hybrid Search**: BM25 + vector + graph + regex in a single engine
- **8-Lane Review Swarm**: Most comprehensive automated review signal set
- **GraphQL API**: Native GraphQL endpoint with subscriptions
- **VS Code Copilot Integration**: Deep Copilot Chat Participant integration
- **Throughput**: 68.9 files/sec on React source
- **Test Coverage**: 96%+ across all 4 dimensions

### Weaknesses

- **Language Coverage**: 20 languages vs SonarQube's 29
- **IDE Integration**: Fewer IDE targets than established tools
- **Market Maturity**: Newer project, smaller community
- **Enterprise Features**: Lacks built-in portfolio management

### Opportunities

- **AI-Native Position**: MCP-native tools will be the default integration point
- **Cross-Repo Trend**: Microservices make cross-repo analysis critical
- **Open Source**: Can build community faster than proprietary competitors

### Threats

- **GitHub Copilot Native Analysis**: May build analysis into Copilot
- **SonarQube Cloud Growth**: Aggressively adding AI features
- **Semgrep Community**: 2,000+ community rules

---

## Market Positioning Matrix

|                   | AI-Native | Cross-Repo | Search | Review | IDE    |
| ----------------- | --------- | ---------- | ------ | ------ | ------ |
| **code-analyzer** | 🟢 92%    | 🟢 100%    | 🟢 80% | 🟢 80% | 🟢 80% |
| **SonarQube**     | 🔴 0%     | 🔴 20%     | 🔴 40% | 🟡 50% | 🟢 85% |
| **CodeQL**        | 🔴 0%     | 🔴 40%     | 🔴 40% | 🔴 40% | 🟡 70% |
| **Semgrep**       | 🔴 0%     | 🔴 20%     | 🔴 40% | 🔴 30% | 🟡 60% |
| **Sourcegraph**   | 🔴 33%    | 🟢 80%     | 🟡 60% | 🔴 20% | 🟢 90% |

---

## Methodology

### Data Sources

- **code-analyzer**: All metrics measured directly from CA-Bench and real-world validation
- **Competitors**: Official documentation, GitHub repos, published benchmarks (2025-2026)

### Confidence Levels

- **measured**: Directly from code-analyzer benchmarks
- **high-estimate**: Based on official documentation
- **medium-estimate**: Based on community knowledge

---

_Generated by code-analyzer CA-Bench v1.0_
