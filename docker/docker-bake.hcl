# ─────────────────────────────────────────────────────────────────────────────
# Code Analyzer — Docker Bake File (docker buildx bake)
#
# Usage:
#   docker buildx bake                          # Build all targets
#   docker buildx bake code-analyzer            # Build full image
#   docker buildx bake code-analyzer-cli        # Build CLI image
#   docker buildx bake --push                   # Push to registry
#   VERSION=0.1.0 docker buildx bake --push     # Tagged release
# ─────────────────────────────────────────────────────────────────────────────

variable "VERSION" {
  default = "latest"
}

variable "REGISTRY" {
  default = "ghcr.io"
}

variable "REPO" {
  default = "lambertyan/code-analyzer"
}

variable "BUILD_DATE" {
  default = ""
}

variable "VCS_REF" {
  default = ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Group: default — everything a developer or CI should build
# ───���─────────────────────────────────────────────────────────────────────────
group "default" {
  targets = [
    "code-analyzer",
    "code-analyzer-cli",
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Group: release — full release with all variants
# ─────────────────────────────────────────────────────────────────────────────
group "release" {
  targets = [
    "code-analyzer",
    "code-analyzer-alpine",
    "code-analyzer-cli",
    "code-analyzer-cli-alpine",
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Target: code-analyzer (MCP Server + HTTP API, multi-arch)
# ─────────────────────────────────────────────────────────────────────────────
target "code-analyzer" {
  dockerfile = "Dockerfile"
  target     = "runner"
  platforms  = ["linux/amd64", "linux/arm64"]

  tags = [
    "${REGISTRY}/${REPO}:${VERSION}",
    "${REGISTRY}/${REPO}:latest",
  ]

  labels = {
    "org.opencontainers.image.title"       = "Code Analyzer"
    "org.opencontainers.image.description" = "World-class layered code intelligence platform — MCP server, VS Code extension, and CLI"
    "org.opencontainers.image.version"     = "${VERSION}"
    "org.opencontainers.image.created"     = "${BUILD_DATE}"
    "org.opencontainers.image.revision"    = "${VCS_REF}"
    "org.opencontainers.image.source"      = "https://github.com/Lambertyan/code-analyzer"
    "org.opencontainers.image.licenses"    = "MIT"
  }

  args = {
    NODE_VERSION = "22"
    PNPM_VERSION = "9"
  }

  cache-from = [
    "type=registry,ref=${REGISTRY}/${REPO}:buildcache",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/${REPO}:buildcache,mode=max",
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Target: code-analyzer-alpine (Alpine 3.20, for edge/small-footprint users)
# ─────────────────────────────────────────────────────────────────────────────
target "code-analyzer-alpine" {
  inherits  = ["code-analyzer"]
  target    = "runner"
  platforms = ["linux/amd64", "linux/arm64"]

  tags = [
    "${REGISTRY}/${REPO}:${VERSION}-alpine",
    "${REGISTRY}/${REPO}:latest-alpine",
  ]

  args = {
    NODE_VERSION = "22"
    PNPM_VERSION = "9"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Target: code-analyzer-cli (standalone CLI binary, multi-arch)
# ─────────────────────────────────────────────────────────────────────────────
target "code-analyzer-cli" {
  dockerfile = "Dockerfile"
  target     = "cli"
  platforms  = ["linux/amd64", "linux/arm64"]

  tags = [
    "${REGISTRY}/${REPO}:${VERSION}-cli",
    "${REGISTRY}/${REPO}:latest-cli",
  ]

  labels = {
    "org.opencontainers.image.title"       = "Code Analyzer CLI"
    "org.opencontainers.image.description" = "Code Analyzer command-line interface"
    "org.opencontainers.image.version"     = "${VERSION}"
    "org.opencontainers.image.created"     = "${BUILD_DATE}"
    "org.opencontainers.image.revision"    = "${VCS_REF}"
    "org.opencontainers.image.source"      = "https://github.com/Lambertyan/code-analyzer"
    "org.opencontainers.image.licenses"    = "MIT"
  }

  args = {
    NODE_VERSION = "22"
    PNPM_VERSION = "9"
  }

  cache-from = [
    "type=registry,ref=${REGISTRY}/${REPO}:buildcache-cli",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/${REPO}:buildcache-cli,mode=max",
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Target: code-analyzer-cli-alpine (CLI on latest Alpine)
# ─────────────────────────────────────────────────────────────────────────────
target "code-analyzer-cli-alpine" {
  inherits  = ["code-analyzer-cli"]
  target    = "cli"

  tags = [
    "${REGISTRY}/${REPO}:${VERSION}-cli-alpine",
    "${REGISTRY}/${REPO}:latest-cli-alpine",
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Target: vscode — builds the VS Code extension .vsix artifact
# ─────────────────────────────────────────────────────────────────────────────
target "vscode" {
  dockerfile = "Dockerfile"
  target     = "vscode-builder"
  platforms  = ["linux/amd64"]

  output = ["type=local,dest=./dist"]

  args = {
    NODE_VERSION = "22"
    PNPM_VERSION = "9"
  }

  cache-from = [
    "type=registry,ref=${REGISTRY}/${REPO}:buildcache-vscode",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/${REPO}:buildcache-vscode,mode=max",
  ]
}
