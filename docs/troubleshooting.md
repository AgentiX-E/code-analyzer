# Troubleshooting

> Solutions for common issues when using Code Analyzer. If you don't find your issue here, check the [Getting Started guide](getting-started.md) or [file an issue](https://github.com/AgentiX-E/code-analyzer/issues).

---

## "No files found to analyze"

**Symptom:** Analysis completes instantly with zero files processed.

**Causes and solutions:**

1. **No supported source files in the directory.** Code Analyzer supports TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust, and 10 additional languages. Verify your project contains files with recognized extensions.

2. **`.gitignore` is blocking everything.** Code Analyzer respects `.gitignore` by default. If your source files are gitignored (unusual but possible), create a `.code-analyzerignore` file to override:

   ```
   !src/
   !*.ts
   !*.py
   ```

3. **Language filter is too restrictive.** If you ran `code-analyzer analyze . --languages typescript` but your project is Python, no files will match. Check your language filter or remove it to auto-detect.

4. **Check what the include and exclude globs actually match.** There is no `--dry-run`: `analyze` reports what it
   indexed _after_ indexing it, and the population is decided by `--include`/`--exclude` and your ignore files. Ask git,
   which is the same answer the indexer starts from:

   ```bash
   git ls-files | grep -E '\.(ts|tsx|py|java|kt)$'
   ```

---

## "A setting has no effect"

The first thing to run is not the command that is misbehaving — it is the one that says what the command will see:

```bash
code-analyzer config
```

It prints every key of the effective configuration with the layer that set it. Read the `source` column:

| What you see                  | What it means                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `default`                     | no file and no variable set it — the value you wrote is not being read from where you wrote it |
| `global`                      | `~/.code-analyzer/config.json` won; the project file lost                                      |
| `project`                     | the right file, at the right path                                                              |
| `env:CODE_ANALYZER_MAX_FILES` | a variable in your shell or CI job overrode the file                                           |
| `explicit`                    | `--config <file>` was passed, and discovery was skipped                                        |

Three other things the same command tells you:

- **The file it did not read.** `.code-analyzer.json` at the project root is only read when
  `.code-analyzer/config.json` is absent. If both exist, the report names the ignored one in a warning.
- **The key it did not understand.** A key this version does not have — a typo, a key from an older document — appears
  under `Ignored N setting(s)`. Add `--strict` in CI to make an unrecognised key fail the job.
- **The value of the wrong type.** `"maxFiles": "500"` is an error rather than a string that silently loses every
  comparison: the run stops with `...config.json: maxFiles must be a positive integer, got "500"`.

`code-analyzer config --json | jq '.origin'` gives the same per-key origins to a script, and
`code-analyzer config --no-env` answers what the files alone would produce.

---

## "MCP server won't start"

**Symptom:** `npx @code-analyzer/mcp` fails to start or exits immediately.

**Causes and solutions:**

1. **Port conflict.** If using HTTP transport, another process may be using the port:

   ```bash
   lsof -i :3100
   ```

   Change the port: `MCP_PORT=3101 npx @code-analyzer/mcp`. The transport and the port are environment variables
   (`MCP_TRANSPORT`, `MCP_PORT`), not flags — the server is its own binary, `code-analyzer-mcp`.

2. **Authentication misconfiguration.** If `mcp.auth.enabled` is `true` but no API keys are configured, the server may reject all connections. Either disable auth or add valid keys to your config:

   ```yaml
   mcp:
     auth:
       enabled: false
   ```

3. **Node.js version too old.** Verify `node --version` returns >= 20.0.0. If not:

   ```bash
   nvm install 20
   nvm use 20
   ```

4. **Run directly for error output:**

   ```bash
   npx @code-analyzer/mcp --verbose
   ```

---

## "VS Code extension not working"

**Symptom:** Extension is installed but shows no data, sidebar is empty, or Copilot Chat participant doesn't respond.

**Causes and solutions:**

1. **Verify installation.** Check the extension is actually activated:

   - Open VS Code
   - View → Output (or `Ctrl+Shift+U`)
   - Select "Code Analyzer" from the dropdown
   - Look for "Code Analyzer extension activated" in the log

2. **Copilot Chat not available.** The `@code-analyzer` participant requires GitHub Copilot Chat to be installed and active. Verify:

   - GitHub Copilot extension is installed and signed in
   - Copilot Chat is enabled in your GitHub settings
   - You see the Copilot Chat icon in the activity bar

3. **Extension failed to load.** Reload the window:

   ```
   Ctrl+Shift+P → "Developer: Reload Window"
   ```

4. **Check for conflicts.** Another extension may interfere. Disable all extensions except Code Analyzer and GitHub Copilot, then re-enable one by one.

5. **Node.js not on PATH.** The extension requires Node.js >= 20 accessible from the terminal. Verify:

   ```bash
   which node
   node --version
   ```

---

## "Analysis is slow"

**Symptom:** Repository analysis takes several minutes or appears to hang.

**Causes and solutions:**

1. **Tune concurrency settings.** Increase worker threads in `.code-analyzerrc`:

   ```yaml
   concurrency: 8 # or auto (uses all CPUs)
   ```

   Or via environment: `CODE_ANALYZER_PARSE_WORKERS=8`

2. **Reduce file size limits.** Skip very large files that don't benefit from analysis:

   ```yaml
   maxFileSize: 1048576 # 1 MB instead of 10 MB
   ```

3. **Skip unnecessary directories.** Add build artifacts, generated code, and vendor directories:

   ```yaml
   skipDirectories:
     - node_modules
     - dist
     - .next
     - __pycache__
     - generated
     - vendor
   ```

4. **Limit languages.** Analyze only the languages you care about:

   ```bash
   code-analyzer analyze . --languages typescript,python
   ```

5. **Narrow the index.** There is no `--incremental` flag: `analyze` indexes the paths it is given, so the way to
   process only what changed is to give it only that, which is also what makes a re-index cheap:

   ```bash
   code-analyzer analyze ./services/billing --languages typescript
   ```

---

## "Memory usage is high"

**Symptom:** Process crashes with "JavaScript heap out of memory" or uses excessive RAM.

**Causes and solutions:**

1. **Increase Node.js heap limit.** For large repos:

   ```bash
   NODE_OPTIONS="--max-old-space-size=8192" code-analyzer analyze .
   ```

2. **Reduce `maxFiles`.** Cap the number of files processed:

   ```yaml
   maxFiles: 10000
   ```

3. **Use SQLite graph store.** For very large codebases, switch from in-memory to disk-based storage:

   ```yaml
   storage:
     type: sqlite
     dbPath: .code-analyzer/graph.db
   ```

   The SQLite store uses WAL mode and keeps the working set small, trading some query speed for dramatically lower memory usage.

4. **Disable embeddings for large repos.** If you don't need semantic search:

   ```yaml
   embed:
     enabled: false
   ```

5. **Split into smaller units.** For monorepos, analyze one package at a time:

   ```bash
   code-analyzer analyze packages/frontend --project-id frontend
   code-analyzer analyze packages/backend --project-id backend
   ```

---

## "Cypher query returns no results"

**Symptom:** `query_cypher` returns an empty array when you expect results.

**Causes and solutions:**

1. **Verify the schema.** Check available node types and relationship types:

   ```json
   {
     "tool": "pdg_query",
     "arguments": { "query": "MATCH (n) RETURN DISTINCT labels(n) AS label, count(n) AS count" }
   }
   ```

   Cypher is the MCP tool `pdg_query`; `code-analyzer search` takes a text query and has no `--cypher` option.

2. **Validate relationship types.** Relationship types are case-sensitive. Use the exact names from the schema:

   ```
   CORRECT: MATCH (f:Function)-[:CALLS]->(t:Function)
   WRONG:   MATCH (f:Function)-[:calls]->(t:Function)
   ```

3. **Check node label spelling.** Common mistakes:

   ```
   WRONG: MATCH (c:class)
   CORRECT: MATCH (c:Class)
   ```

4. **List all relationship types in your graph:**

   ```json
   {
     "tool": "pdg_query",
     "arguments": {
       "query": "MATCH ()-[r]->() RETURN DISTINCT type(r) AS relationship, count(r) AS count ORDER BY count DESC"
     }
   }
   ```

5. **Start simple and build up.** Test with the broadest query first:

   ```cypher
   MATCH (f:Function) RETURN f.name LIMIT 5
   ```

   Then gradually add filters and relationships.

---

## "Native module errors"

**Symptom:** Installation fails with `node-gyp` or native module compilation errors (e.g., `tree-sitter`, `better-sqlite3`).

**Causes and solutions:**

1. **Node.js version mismatch.** Ensure Node.js >= 20.0.0:

   ```bash
   node --version
   # If too old:
   nvm install 20 && nvm use 20
   ```

2. **Install build tools.** Native modules require a C++ compiler:

   ```bash
   # Ubuntu/Debian
   sudo apt-get install build-essential python3

   # macOS
   xcode-select --install

   # Alpine Linux
   apk add build-base python3
   ```

3. **Rebuild native modules.** Clean and reinstall:

   ```bash
   rm -rf node_modules
   pnpm store prune
   pnpm install
   ```

4. **Platform support.** Some native modules may not work on all platforms. For example, `tree-sitter` requires a supported architecture (x86_64, arm64). If you're on an unsupported platform, use Docker instead:

   ```bash
   docker pull ghcr.io/agentix-e/code-analyzer:latest
   ```

5. **Use prebuilt binaries.** When available, the package ships prebuilt binaries for common platforms. If building from source, ensure you have the latest version:

   ```bash
   pnpm add -g @code-analyzer/cli@latest
   ```

---

## Still Having Issues?

1. Run diagnostics: `code-analyzer status --verbose`
2. Enable debug logging: `CODE_ANALYZER_LOG_LEVEL=debug code-analyzer analyze .`
3. Check [GitHub Issues](https://github.com/AgentiX-E/code-analyzer/issues) for known problems
4. File a new issue with the diagnostic output and steps to reproduce
