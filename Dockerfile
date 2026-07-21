#
# Code Analyzer — Multi-stage Docker Build
#

#
# Stage 1: Builder
#
FROM node:22-alpine AS builder

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace configuration and lockfile first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json tsconfig.base.json turbo.json ./

# Copy all package manifests
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/ 2>/dev/null || :
COPY packages/infra/package.json packages/infra/
COPY packages/analyzer/package.json packages/analyzer/
COPY packages/intelligence/package.json packages/intelligence/
COPY packages/mcp/package.json packages/mcp/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/ 2>/dev/null || :

# Install all dependencies (including dev deps for build)
RUN pnpm install --frozen-lockfile

# Copy full source tree
COPY . .

# Build all packages
RUN pnpm turbo build --filter=...^...

#
# Stage 2: Runner
#
FROM node:22-alpine AS runner

# Labels (org.opencontainers metadata)
LABEL org.opencontainers.image.title="Code Analyzer"
LABEL org.opencontainers.image.description="World-class layered code intelligence platform — MCP server, VS Code extension, and CLI"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.authors="Lambertyan"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/lambertyan/code-analyzer"

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 code-analyzer && \
    adduser -u 1001 -G code-analyzer -s /bin/sh -D code-analyzer

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace configuration and lockfile
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json /app/turbo.json ./

# Copy only the built packages we need
COPY --from=builder /app/packages/core/package.json /app/packages/core/
COPY --from=builder /app/packages/core/dist /app/packages/core/dist

COPY --from=builder /app/packages/shared/package.json /app/packages/shared/
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist

COPY --from=builder /app/packages/infra/package.json /app/packages/infra/
COPY --from=builder /app/packages/infra/dist /app/packages/infra/dist

COPY --from=builder /app/packages/analyzer/package.json /app/packages/analyzer/
COPY --from=builder /app/packages/analyzer/dist /app/packages/analyzer/dist

COPY --from=builder /app/packages/intelligence/package.json /app/packages/intelligence/
COPY --from=builder /app/packages/intelligence/dist /app/packages/intelligence/dist

COPY --from=builder /app/packages/mcp/package.json /app/packages/mcp/
COPY --from=builder /app/packages/mcp/dist /app/packages/mcp/dist

COPY --from=builder /app/packages/server/package.json /app/packages/server/
COPY --from=builder /app/packages/server/dist /app/packages/server/dist

# Install production-only dependencies
RUN pnpm install --frozen-lockfile --prod

# Switch to non-root user
USER code-analyzer

# Expose port for HTTP transport
EXPOSE 3000

# Health check — verify the MCP server is reachable
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Default command: run the MCP server
CMD ["node", "packages/mcp/dist/index.js"]
