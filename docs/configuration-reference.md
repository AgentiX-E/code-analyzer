# Configuration Reference

> **One file, one schema, one loader — and a command that shows which value won.** `.code-analyzer/config.json` is read by
> `analyze` and printed by `config`. Everything in this page can be checked against a checkout in one command:
>
> ```bash
> npx @code-analyzer/cli config
> ```

---

## The files, and which one wins

| Layer                | Path                           | Written by                       | Read when                              |
| -------------------- | ------------------------------ | -------------------------------- | -------------------------------------- |
| **global**           | `~/.code-analyzer/config.json` | you                              | always, when it exists                 |
| **project**          | `.code-analyzer/config.json`   | `code-analyzer init`             | always, when it exists                 |
| **project (legacy)** | `.code-analyzer.json`          | an earlier version of these docs | only when the canonical file is absent |

Precedence, lowest to highest:

```
defaults  <  global  <  project  <  CODE_ANALYZER_* environment  <  command-line flags
```

Two rules that are worth knowing before they surprise you:

- **The two project paths are not merged.** If both exist, `.code-analyzer/config.json` is used and the other file is
  named in a warning. A merge of two documents cannot be reasoned about by the person editing either of them.
- **`--config <file>` replaces discovery** rather than adding a layer: the explicit file is the project layer, and no
  project file is looked for. `--without-config` on `analyze` skips files entirely and uses the built-in defaults.

---

## Proving which value won

```console
$ code-analyzer config
Configuration for /home/you/project

Layers, in increasing precedence:
  default   ✓ built in
  global    · not found
  project   ✓ /home/you/project/.code-analyzer/config.json
  explicit  · not found

  flags on the command line win over every layer above.

key              value                                    source
---------------  ---------------------------------------  ------------
cacheDir         .code-analyzer                           default
excludePatterns  node_modules/**, .git/**, … (9 items)    project
maxFileSize      1048576                                  project
maxFiles         100                                      project
projectId        my-project                               project
```

The `source` column is the answer to "why is this value not what I wrote": `project`, `global`, `explicit`,
`env:CODE_ANALYZER_MAX_FILES`, or `default`. `code-analyzer config --json` prints the same information as
`{ config, origin, layers, ignored, warnings }` for a script to read.

**Keys that are present in a file and not in the schema are reported, not dropped:**

```console
$ code-analyzer config --strict
Ignored 1 setting(s) — this version has no such key:
  /home/you/project/.code-analyzer/config.json: index — unknown setting, and this version has no such key
```

Without `--strict` the exit code is 0 — the configuration is still usable, and the point of printing it is to let you
decide. With `--strict` an unrecognised key is an error, which is what a CI job should run.

A value of the wrong type is always an error, because it is never usable: `"maxFiles": "100"` fails with
`...config.json: maxFiles must be a positive integer, got "100"` rather than travelling through the run as a string that
compares wrong against every number it meets.

---

## Keys

`read by` says which code path consumes the key. **A key that no path consumes is listed here anyway**, because hiding it
would be the defect this table exists to prevent.

| Key                     | Type            | Default                                              | Environment                                        | Read by                                                                                                                                              |
| ----------------------- | --------------- | ---------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`             | string          | `""` (derived from the path)                         | `CODE_ANALYZER_PROJECT_ID`                         | `analyze`                                                                                                                                            |
| `excludePatterns`       | string[]        | 9 globs (`node_modules/**`, `.git/**`, `dist/**`, …) | `CODE_ANALYZER_EXCLUDE_PATTERNS` (comma-separated) | `analyze` (scan)                                                                                                                                     |
| `includePatterns`       | string[]        | `[]` (everything)                                    | `CODE_ANALYZER_INCLUDE_PATTERNS`                   | `analyze` (scan)                                                                                                                                     |
| `maxFileSize`           | integer (bytes) | `10485760` (10 MB)                                   | `CODE_ANALYZER_MAX_FILE_SIZE`                      | `analyze` (scan)                                                                                                                                     |
| `maxFiles`              | integer         | `50000`                                              | `CODE_ANALYZER_MAX_FILES`                          | `analyze` (scan)                                                                                                                                     |
| `rootPath`              | string          | the working directory                                | `CODE_ANALYZER_ROOT_PATH`                          | **overridden by the run** — `analyze` uses the path it was given, because a configuration that disagrees with the checkout it was found in is a trap |
| `cacheDir`              | string          | `.code-analyzer`                                     | `CODE_ANALYZER_CACHE_DIR`                          | _nothing yet_ — reserved                                                                                                                             |
| `parseWorkers`          | integer         | half the CPU count                                   | `CODE_ANALYZER_PARSE_WORKERS`                      | _nothing yet_ — the parallel phases size their own pool                                                                                              |
| `language`              | string          | _absent_                                             | `CODE_ANALYZER_LANGUAGE`                           | _nothing yet_ — `analyze --languages` is the flag that works                                                                                         |
| `ignorePaths`           | string[]        | 9 directories                                        | `CODE_ANALYZER_IGNORE_PATHS`                       | _nothing_ — `excludePatterns` is the list the walk reads                                                                                             |
| `mcp.name`              | string          | _absent_                                             | `CODE_ANALYZER_MCP_NAME`                           | the MCP server's identity                                                                                                                            |
| `mcp.version`           | string          | _absent_                                             | `CODE_ANALYZER_MCP_VERSION`                        | the MCP server's identity                                                                                                                            |
| `mcp.toolProfile`       | string          | _absent_                                             | `CODE_ANALYZER_MCP_TOOL_PROFILE`                   | which MCP tools are exposed                                                                                                                          |
| `mcp.readOnly`          | boolean         | `false`                                              | —                                                  | refuses every `write` and `destroy` tool                                                                                                             |
| `mcp.maxResults`        | integer         | _absent_                                             | `CODE_ANALYZER_MCP_MAX_RESULTS`                    | result cap                                                                                                                                           |
| `mcp.enableStreaming`   | boolean         | _absent_                                             | `CODE_ANALYZER_MCP_ENABLE_STREAMING`               | transport                                                                                                                                            |
| `mcp.enableResources`   | boolean         | _absent_                                             | `CODE_ANALYZER_MCP_ENABLE_RESOURCES`               | capability                                                                                                                                           |
| `mcp.enablePrompts`     | boolean         | _absent_                                             | `CODE_ANALYZER_MCP_ENABLE_PROMPTS`                 | capability                                                                                                                                           |
| `review.enabled`        | boolean         | _absent_                                             | `CODE_ANALYZER_REVIEW_ENABLED`                     | review pipeline default                                                                                                                              |
| `review.maxComments`    | integer         | _absent_                                             | `CODE_ANALYZER_REVIEW_MAX_COMMENTS`                | comment budget                                                                                                                                       |
| `review.severityFilter` | string[]        | _absent_                                             | —                                                  | which severities survive                                                                                                                             |
| `review.categoryFilter` | string[]        | _absent_                                             | —                                                  | which categories survive                                                                                                                             |
| `embed.enabled`         | boolean         | _absent_                                             | `CODE_ANALYZER_EMBED_ENABLED`                      | semantic search                                                                                                                                      |
| `embed.model`           | string          | _absent_                                             | `CODE_ANALYZER_EMBED_MODEL`                        | embedding backend                                                                                                                                    |
| `embed.batchSize`       | integer         | _absent_                                             | `CODE_ANALYZER_EMBED_BATCH_SIZE`                   | embedding backend                                                                                                                                    |
| `embed.dimensions`      | integer         | _absent_                                             | `CODE_ANALYZER_EMBED_DIMENSIONS`                   | embedding backend                                                                                                                                    |
| `pruner.enabled`        | boolean         | _absent_                                             | `CODE_ANALYZER_PRUNER_ENABLED`                     | context pruning                                                                                                                                      |
| `pruner.keepTests`      | boolean         | _absent_                                             | `CODE_ANALYZER_PRUNER_KEEP_TESTS`                  | context pruning                                                                                                                                      |
| `pruner.keepInternal`   | boolean         | _absent_                                             | `CODE_ANALYZER_PRUNER_KEEP_INTERNAL`               | context pruning                                                                                                                                      |

The `mcp`, `review`, `embed` and `pruner` blocks are consumed **programmatically** — by `@code-analyzer/mcp`, the review
pipeline and the embedding backends — and are not read by the `analyze` command. Setting them in the project file changes
what those components do when they are configured from a loaded configuration; the CLI's own review flags
(`review --severity`, `review pr --max-comments`) are what decide a review run.

---

## A file to start from

`code-analyzer init` writes exactly this, and every value in it is already the default:

```json
{
  "projectId": "",
  "excludePatterns": [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    ".next/**",
    ".nuxt/**",
    "__pycache__/**",
    "*.pyc",
    "target/**",
    ".gradle/**"
  ],
  "includePatterns": [],
  "maxFileSize": 10485760,
  "maxFiles": 50000
}
```

Two properties of that file are deliberate:

- **It is equivalent to no file at all.** Nothing changes the moment you run `init`; the file is a place to start writing.
- **Deleting a key restores its default.** A missing key is not "unset"; it falls back through the layers, which is why
  `code-analyzer config` can always name a source for every key.

`rootPath`, `parseWorkers` and `ignorePaths` are not written: the first two describe the machine that ran `init` rather
than the project, and the third is a list nothing reads.

---

## Environment variables

Every `CODE_ANALYZER_*` variable in the table above is applied after the files, and `code-analyzer config` reports the
variable **by name** (`env:CODE_ANALYZER_MAX_FILES`), because "the environment overrode it" is not a useful sentence when
a CI job sets a dozen of them. `code-analyzer config --no-env` ignores all of them.

A variable that does not parse is an error, not a silent no-op: `CODE_ANALYZER_MAX_FILES=none` fails the run with
`CODE_ANALYZER_MAX_FILES must be a positive integer, got "none"`.

---

## What this page used to claim, and does not

An earlier version of this document described a `.code-analyzerrc` file in JSON, YAML **or TOML**; a `--profile` flag that
selected named profiles; a `code-analyzer init` that "walks you through the options interactively"; and a VS Code settings
bridge. **None of those has ever existed** — not deprecated, never written. The page named `.code-analyzerrc`, the loader
read `.code-analyzer.json`, `init` wrote `.code-analyzer/config.json`, and no command called the loader at all, so the
three could disagree indefinitely without anyone noticing.

If you need one of those shapes, the honest workaround is a small script that writes `.code-analyzer/config.json` from
whatever your team already keeps.

---

## See also

- [Configuring Code Analyzer](./CONFIGURATION.md) — the guide: how precedence plays out in a real project, CI examples.
- [Troubleshooting](./troubleshooting.md) — when a value is not the one you set.
