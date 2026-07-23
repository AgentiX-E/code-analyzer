#!/usr/bin/env bash
#
# Code Analyzer — One-Click Install Script
#
# Detects OS, installs prerequisites, clones the repository,
# builds all packages, and configures the MCP server.
#

set -euo pipefail

#
# Color helpers
#
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { printf "${BLUE}[INFO]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
err()   { printf "${RED}[ERR]${NC} %s\n" "$*"; exit 1; }

REPO_URL="https://github.com/AgentiX-E/code-analyzer.git"
INSTALL_DIR="${HOME}/code-analyzer"
NODE_MIN_VERSION=20

echo ""
echo "============================================"
echo "  Code Analyzer — One-Click Install"
echo "============================================"
echo ""

#
# 1. Detect OS
#
detect_os() {
  case "$(uname -s)" in
    Linux*)   OS="linux" ;;
    Darwin*)  OS="macos" ;;
    *)        err "Unsupported operating system: $(uname -s)" ;;
  esac
  info "Detected OS: ${OS}"
}

#
# 2. Install Node.js 20+ if missing
#
install_node() {
  if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "${NODE_VERSION}" -ge "${NODE_MIN_VERSION}" ]; then
      ok "Node.js $(node -v) already installed"
      return
    fi
    warn "Node.js $(node -v) is below minimum version ${NODE_MIN_VERSION}"
  fi

  info "Installing Node.js ${NODE_MIN_VERSION}+ via NodeSource..."

  case "${OS}" in
    linux)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
      ;;
    macos)
      if command -v brew &>/dev/null; then
        brew install node@22
      else
        curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash
        brew install node@22
      fi
      ;;
  esac

  ok "Node.js $(node -v) installed"
}

#
# 3. Install pnpm if missing
#
install_pnpm() {
  if command -v pnpm &>/dev/null; then
    ok "pnpm $(pnpm -v) already installed"
    return
  fi

  info "Installing pnpm..."
  corepack enable
  corepack prepare pnpm@9 --activate

  ok "pnpm $(pnpm -v) installed"
}

#
# 4. Install Git if missing
#
install_git() {
  if command -v git &>/dev/null; then
    ok "Git $(git --version | cut -d' ' -f3) already installed"
    return
  fi

  info "Installing Git..."

  case "${OS}" in
    linux) sudo apt-get install -y git ;;
    macos) brew install git ;;
  esac

  ok "Git installed"
}

#
# 5. Clone or update the repository
#
clone_repo() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    info "Repository already exists at ${INSTALL_DIR}, updating..."
    cd "${INSTALL_DIR}"
    git pull origin main
    ok "Repository updated"
  else
    info "Cloning repository to ${INSTALL_DIR}..."
    git clone "${REPO_URL}" "${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    ok "Repository cloned"
  fi
}

#
# 6. Install dependencies and build
#
build_project() {
  cd "${INSTALL_DIR}"

  info "Installing dependencies..."
  pnpm install --frozen-lockfile

  info "Building all packages..."
  pnpm turbo build

  ok "Build complete"
}

#
# 7. Configure MCP server in common AI editors
#
configure_mcp() {
  local MCP_CONFIG
  MCP_CONFIG=$(cat <<EOF
{
  "mcpServers": {
    "code-analyzer": {
      "command": "node",
      "args": ["${INSTALL_DIR}/packages/mcp/dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
EOF
)

  # Cursor
  local CURSOR_MCP="${HOME}/.cursor/mcp.json"
  if [ -d "${HOME}/.cursor" ]; then
    info "Configuring MCP server for Cursor..."
    mkdir -p "$(dirname "${CURSOR_MCP}")"
    echo "${MCP_CONFIG}" > "${CURSOR_MCP}"
    ok "Cursor MCP configured"
  fi

  # Claude Desktop
  local CLAUDE_MCP="${HOME}/Library/Application Support/Claude/claude_desktop_config.json"
  if [ "${OS}" = "macos" ] && [ -d "$(dirname "${CLAUDE_MCP}")" ]; then
    info "Configuring MCP server for Claude Desktop..."
    echo "${MCP_CONFIG}" > "${CLAUDE_MCP}"
    ok "Claude Desktop MCP configured"
  fi

  # Windsurf
  local WINDSURF_MCP="${HOME}/.windsurf/mcp.json"
  if [ -d "${HOME}/.windsurf" ]; then
    info "Configuring MCP server for Windsurf..."
    mkdir -p "$(dirname "${WINDSURF_MCP}")"
    echo "${MCP_CONFIG}" > "${WINDSURF_MCP}"
    ok "Windsurf MCP configured"
  fi

  # Continue (VS Code extension)
  local CONTINUE_MCP="${HOME}/.continue/config.json"
  if [ -d "${HOME}/.continue" ]; then
    info "Configuring MCP server for Continue..."
    echo "${MCP_CONFIG}" > "${CONTINUE_MCP}"
    ok "Continue MCP configured"
  fi

  # Generic: print config for manual setup
  echo ""
  info "MCP server configuration (save to your editor's mcp.json):"
  echo "----------------------------------------"
  echo "${MCP_CONFIG}"
  echo "----------------------------------------"
}

#
# 8. Run tests to verify
#
verify_installation() {
  cd "${INSTALL_DIR}"

  info "Running unit tests to verify installation..."
  if pnpm test:unit 2>/dev/null; then
    ok "All tests passed — installation verified"
  else
    warn "Some tests failed. Check the output above for details."
    warn "The installation may still work — try running the CLI manually."
  fi
}

#
# Main
#
main() {
  detect_os
  install_git
  install_node
  install_pnpm
  clone_repo
  build_project
  configure_mcp
  verify_installation

  echo ""
  echo "============================================"
  echo "  Installation Complete!"
  echo "============================================"
  echo ""
  echo "  Repository:   ${INSTALL_DIR}"
  echo "  CLI Commands:"
  echo "    cd ${INSTALL_DIR}"
  echo "    pnpm code-analyzer --help"
  echo ""
  echo "  Test the MCP server:"
  echo "    cd ${INSTALL_DIR}"
  echo "    node packages/mcp/dist/index.js"
  echo ""
  echo "  Run the MCP server via Docker:"
  echo "    cd ${INSTALL_DIR}"
  echo "    docker compose up -d"
  echo ""
  echo "  Next steps:"
  echo "    1. Open your AI editor (Cursor, Windsurf, etc.)"
  echo "    2. Restart the editor to connect the MCP server"
  echo "    3. Try: 'Analyze this codebase' in chat"
  echo ""
}

main "$@"
