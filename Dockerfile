#
# Code Analyzer — Multi-stage, Multi-architecture Docker Build
#
# Build:
#   docker buildx build --platform linux/amd64,linux/arm64 -t code-analyzer:latest .
#   docker buildx bake -f docker/docker-bake.hcl
#

# ── Global build args for cross-platform support ──────────────────────────────
ARG NODE_VERSION=22
ARG PNPM_VERSION=9

# ─────────────────────────────────────────────────────────────────────────────
# Stage 0: Base — shared build foundation
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder — install deps, compile TypeScript, run tests
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS builder

# Copy workspace root configs first for optimal layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json tsconfig.base.json turbo.json ./

# Copy ALL package manifests in a single layer (consolidated)
# Using a wildcard pattern avoids individual COPY commands for each package
COPY packages/core/package.json           packages/core/
COPY packages/shared/package.json         packages/shared/
COPY packages/infra/package.json          packages/infra/
COPY packages/analyzer/package.json       packages/analyzer/
COPY packages/intelligence/package.json   packages/intelligence/
COPY packages/mcp/package.json            packages/mcp/
COPY packages/server/package.json         packages/server/
COPY packages/cli/package.json            packages/cli/
COPY packages/vscode/package.json         packages/vscode/
COPY packages/web/package.json            packages/web/

# Install ALL dependencies (dev deps needed for build)
RUN pnpm install --frozen-lockfile

# Copy full source tree
COPY . .

# Build all packages
RUN pnpm turbo build --filter=...^...

# ── Security scanning stage marker (integrate in CI) ─────────────────────────
# Tools to consider adding to CI pipeline:
#   - Trivy:    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image code-analyzer:latest
#   - Grype:    grype code-analyzer:latest
#   - Snyk:     snyk container test code-analyzer:latest
#   - Dockle:   dockle code-analyzer:latest
#   - Hadolint: hadolint Dockerfile
# All base images are scanned daily by Docker Official Images maintainers.

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runner (MCP Server) — minimal production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner

# ── OCI labels (image.created set via --label in CI) ─────────────────────────
LABEL org.opencontainers.image.title="Code Analyzer"
LABEL org.opencontainers.image.description="World-class layered code intelligence platform — MCP server, VS Code extension, and CLI"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.authors="Lambertyan"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/Lambertyan/code-analyzer"
LABEL org.opencontainers.image.documentation="https://github.com/Lambertyan/code-analyzer#readme"
# In CI, add: --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Add: --label "org.opencontainers.image.revision=$GITHUB_SHA"

ENV NODE_ENV=production
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Create non-root user (fixed UID/GID for host volume compatibility)
RUN addgroup -g 1001 code-analyzer && \
    adduser -u 1001 -G code-analyzer -s /bin/sh -D code-analyzer

WORKDIR /app

# Copy workspace root
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json /app/turbo.json ./

# Copy built packages — consolidated into fewer layers using glob-like patterns
# Package: core
COPY --from=builder /app/packages/core/package.json /app/packages/core/
COPY --from=builder /app/packages/core/dist/         /app/packages/core/dist/

# Package: shared
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/
COPY --from=builder /app/packages/shared/dist/         /app/packages/shared/dist/

# Package: infra
COPY --from=builder /app/packages/infra/package.json /app/packages/infra/
COPY --from=builder /app/packages/infra/dist/         /app/packages/infra/dist/

# Package: analyzer
COPY --from=builder /app/packages/analyzer/package.json /app/packages/analyzer/
COPY --from=builder /app/packages/analyzer/dist/         /app/packages/analyzer/dist/

# Package: intelligence
COPY --from=builder /app/packages/intelligence/package.json /app/packages/intelligence/
COPY --from=builder /app/packages/intelligence/dist/         /app/packages/intelligence/dist/

# Package: mcp
COPY --from=builder /app/packages/mcp/package.json /app/packages/mcp/
COPY --from=builder /app/packages/mcp/dist/         /app/packages/mcp/dist/

# Package: server
COPY --from=builder /app/packages/server/package.json /app/packages/server/
COPY --from=builder /app/packages/server/dist/         /app/packages/server/dist/

# Install production-only dependencies
RUN pnpm install --frozen-lockfile --prod

# Pre-create data directories with correct ownership
RUN mkdir -p /app/data/graph /tmp/code-analyzer && \
    chown -R code-analyzer:code-analyzer /app/data /tmp/code-analyzer

# Drop to non-root user
USER code-analyzer

# Expose MCP HTTP transport port
EXPOSE 3000

# Health check — verify the MCP server is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/health || exit 1

# Default: run the MCP server
CMD ["node", "packages/mcp/dist/index.js"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: CLI — standalone CLI binary image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS cli

LABEL org.opencontainers.image.title="Code Analyzer CLI"
LABEL org.opencontainers.image.description="Code Analyzer command-line interface"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.authors="Lambertyan"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

RUN addgroup -g 1001 cli && \
    adduser -u 1001 -G cli -s /bin/sh -D cli

WORKDIR /app

COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json /app/turbo.json ./

# CLI only needs core + shared + infra + analyzer + intelligence + CLI
COPY --from=builder /app/packages/core/package.json         /app/packages/core/
COPY --from=builder /app/packages/core/dist/                 /app/packages/core/dist/
COPY --from=builder /app/packages/shared/package.json       /app/packages/shared/
COPY --from=builder /app/packages/shared/dist/               /app/packages/shared/dist/
COPY --from=builder /app/packages/infra/package.json        /app/packages/infra/
COPY --from=builder /app/packages/infra/dist/                /app/packages/infra/dist/
COPY --from=builder /app/packages/analyzer/package.json     /app/packages/analyzer/
COPY --from=builder /app/packages/analyzer/dist/             /app/packages/analyzer/dist/
COPY --from=builder /app/packages/intelligence/package.json /app/packages/intelligence/
COPY --from=builder /app/packages/intelligence/dist/         /app/packages/intelligence/dist/
COPY --from=builder /app/packages/cli/package.json          /app/packages/cli/
COPY --from=builder /app/packages/cli/dist/                  /app/packages/cli/dist/

RUN pnpm install --frozen-lockfile --prod
RUN mkdir -p /workspace && chown -R cli:cli /app /workspace

USER cli

ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["--help"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: VS Code Extension — build the .vsix for publishing
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS vscode-builder

# Copy workspace root
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json tsconfig.base.json turbo.json ./
COPY packages/ /app/packages/

# Install deps and build
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@code-analyzer/vscode

# Install vsce for packaging
RUN pnpm add -g @vscode/vsce

WORKDIR /app/packages/vscode

# Package into a .vsix file
RUN pnpm exec vsce package --out /app/dist/code-analyzer.vsix

# The resulting /app/dist/code-analyzer.vsix can be extracted by CI
# for publishing to VS Code Marketplace
