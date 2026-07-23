# typed: true
# frozen_string_literal: true

# Code Analyzer — Homebrew Formula
# Install: brew install lambertyan/tap/code-analyzer
class CodeAnalyzer < Formula
  desc "World-class layered code intelligence platform — MCP server, VS Code extension, and CLI"
  homepage "https://github.com/Lambertyan/code-analyzer"
  license "MIT"
  version "0.1.0"
  revision 1

  # This formula installs the CLI package via npm.
  # Once pre-built binaries are available, switch to url/sha256 approach.
  url "https://registry.npmjs.org/@code-analyzer/cli/-/cli-0.1.0.tgz"
  # NOTE: sha256 must be updated for each release. Obtain via:
  #   curl -sL https://registry.npmjs.org/@code-analyzer/cli/-/cli-0.1.0.tgz | sha256sum
  sha256 "REPLACE_WITH_ACTUAL_SHA256"

  depends_on "node@22"

  def install
    # Add Homebrew's node to PATH
    ENV.prepend_path "PATH", Formula["node@22"].opt_bin

    # Install the CLI package globally into the prefix
    system "npm", "install", "--prefix", libexec, "--global", "--omit=dev", "."

    # Ensure all executables are wrapped correctly
    bin.install_symlink Dir[libexec/"bin/*"]

    # Create a wrapper script to set NODE_PATH so the CLI can find
    # its workspace dependencies at runtime
    (bin/"code-analyzer").write <<~SH
      #!/bin/bash
      export NODE_PATH="#{libexec}/lib/node_modules"
      exec "#{libexec}/bin/code-analyzer" "$@"
    SH
    chmod 0755, bin/"code-analyzer"

    # Install shell completions if bundled
    bash_completion.install_symlink libexec/"share/bash-completion/completions/code-analyzer" => "code-analyzer" if (libexec/"share/bash-completion/completions/code-analyzer").exist?
    zsh_completion.install_symlink  libexec/"share/zsh/site-functions/_code-analyzer"  => "_code-analyzer"  if (libexec/"share/zsh/site-functions/_code-analyzer").exist?
    fish_completion.install_symlink libexec/"share/fish/vendor_completions.d/code-analyzer.fish" => "code-analyzer.fish" if (libexec/"share/fish/vendor_completions.d/code-analyzer.fish").exist?
  end

  test do
    # Verify the binary runs and prints version
    assert_match "Code Analyzer", shell_output("#{bin}/code-analyzer --version")
  end

  def caveats
    <<~EOS
      Code Analyzer has been installed.

      Quick start:
        code-analyzer analyze .            # Analyze the current directory
        code-analyzer mcp start            # Start the MCP server
        code-analyzer review --pr <num>    # Review a pull request

      For VS Code integration, install the extension from the marketplace:
        ext install agentix.code-analyzer

      Full documentation: #{homepage}
    EOS
  end
end
