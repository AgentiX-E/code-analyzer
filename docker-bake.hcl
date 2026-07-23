#
# Code Analyzer — Docker Bake multi-arch build configuration
#
# Usage:
#   docker buildx bake
#   VERSION=0.2.0 docker buildx bake
#

variable "VERSION" {
  default = "latest"
}

group "default" {
  targets = ["code-analyzer"]
}

target "code-analyzer" {
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  tags = [
    "agentix-e/code-analyzer:latest",
    "agentix-e/code-analyzer:${VERSION}",
  ]
  annotations = [
    "org.opencontainers.image.title=Code Analyzer",
    "org.opencontainers.image.description=Code intelligence platform — knowledge graph analysis, PR review, and cross-repo intelligence for AI agents",
    "org.opencontainers.image.version=${VERSION}",
    "org.opencontainers.image.authors=Lambertyan",
    "org.opencontainers.image.licenses=MIT",
    "org.opencontainers.image.source=https://github.com/AgentiX-E/code-analyzer",
    "org.opencontainers.image.documentation=https://github.com/AgentiX-E/code-analyzer",
  ]
}
