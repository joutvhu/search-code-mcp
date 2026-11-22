# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-22

### Added
- **Hidden files support (`includeHidden`)**: Propagate `includeHidden` option across `ast-grep` and `ripgrep` search, count, and replace flows while automatically excluding `.git` directories unless `noIgnore` is enabled.
- **Case sensitivity control (`caseSensitive`)**: Added `caseSensitive` parameter to `replace` and `count` tools for explicit case-sensitive or case-insensitive matching.
- **Expanded symbol kinds**: Added `trait`, `module`, and `other` kinds to the `find_symbols` tool and symbol extraction engine.
- **Language aliases in `FILE_TYPE_GLOBS`**: Added support for language aliases (`typescript`, `tsx`, `javascript`, `jsx`, `yml`, `bash`) for AST and hybrid search.
- **Custom engine binary paths**: Added `RIPGREP_PATH`, `AST_GREP_PATH`, and `CTAGS_PATH` environment variable overrides to allow specifying custom executable locations.
- **Windows package manager auto-detection**: Automatically detect `winget`, `scoop`, and `choco` in the CLI `engineManager` to suggest direct installation commands for `ripgrep` and `universal-ctags`.
- **Local development and release scripts**:
  - `scripts/publish-local.mjs` for testing local builds, packing, and installing/uninstalling globally with `--dry-run`, `--pack-only`, `--keep-pack`, and `--uninstall`.
  - Convenient npm scripts: `bump`, `bump:patch`, `bump:minor`, `bump:major`, `local:publish`, `local:pack`, and `local:uninstall`.
  - Dedicated test runner `scripts/test.mjs` to compile TypeScript to `.test-dist`, run tests, and clean up automatically.

### Changed
- **Isolated cache storage**: Relocated pagination cache from project-local `.cache/search-code/` to system temporary storage (`os.tmpdir()`), preventing untracked cache files from polluting git workspaces.
- **Symbol engine parsing**: Refined OOP method extraction to skip control-flow keywords (`if`, `for`, `while`), support nested generic return types, and properly capture `static`/`override` methods in outline mode.
- **Hybrid search optimization**: Accelerated candidate file discovery via `runRipgrepFilesWithMatches` and mapped languages to `FILE_TYPE_GLOBS` for faster 2-tier search on large repositories.
- **AST dump format default**: Default `runAstGrepDump` format to `ast`.
- **CI workflow**: Updated GitHub Actions CI to install `@ast-grep/cli` and run `npm test` before building.
- **Agent Skill documentation**: Streamlined `skills/search-code/SKILL.md` to clarify engine constraints, AST pattern rules, and parameter scoping.

### Removed
- **Deprecated parameters**: Removed legacy `fileType` and `symbol` search types from `search`, `replace`, and `count` schemas to streamline tool interfaces.
- Removed redundant `noIgnore` parameter from the `replace` tool schema.

---

## [1.0.2] - 2026-10-17

### Added
- GitHub Actions workflow (`.github/workflows/publish.yml`) to automatically publish package to npm on GitHub release creation.
- Pre-configured Search Code Agent Skill (`skills/search-code/SKILL.md`) for distribution via `npx skills`.
- Automated test suite using Node.js native test runner (`node:test`).

### Fixed
- Fixed `ast-grep` execution on Windows by discovering the native binary path.
- Fixed command argument escaping when spawning Windows batch scripts via `cmd.exe`.

### Changed
- Dynamically inject package version from `package.json` during the build process.

---

## [1.0.1] - 2026-10-17

### Added
- Relative path support for input paths across all tools, resolved against the workspace/project root.
- Support configuring workspace root via CLI options (`--root`, `--workspace`) or environment variables (`WORKSPACE_ROOT`, `PROJECT_ROOT`).
- Token-saving relative path output mode, enabled via `RELATIVE_PATHS=true` or `--relative-paths` flag.

### Fixed
- Normalized cache directory resolution for relative input paths and single-file targets.
- Removed `--provenance` flag in CI workflow for compatibility with private repositories.

---

## [1.0.0] - 2026-10-16

### Added
- Initial public release of `search-code-mcp`.
- 6 unified MCP tools without redundant prefixes:
  - `search`: Blazing-fast regex/text search (ripgrep) and structural AST search (ast-grep), plus 2-tier hybrid search.
  - `replace`: Safe structural refactoring and code replacement with dry-run unified diff previews.
  - `count`: Instant match and file occurrence counting.
  - `find_symbols`: Multi-engine code symbol search (classes, functions, interfaces, methods, etc.).
  - `dump_tree`: AST syntax tree inspection in AST or pattern format.
  - `list_files`: High-performance file enumeration respecting `.gitignore`.
- Multi-engine driver fallback system:
  - Text/Regex: `ripgrep` ➜ `ugrep` ➜ `git grep`.
  - Symbols: Universal Ctags ➜ `ast-grep` ➜ regex heuristics.
  - AST: `ast-grep` ➜ `sg`.
  - Files: `rg --files` ➜ `git ls-files` ➜ native recursive walk.
- Interactive CLI engine manager (`search-code-mcp engine`) with terminal arrow navigation.
- Proactive engine diagnostics and AI agent fallback suggestions when external binaries are missing.
- Cursor-based pagination with on-demand caching (`searchId`, `offset`, `limit`).
- Context window protection: ANSI color stripping, long-line truncation (`maxLineLength`), and diff previews.
- Single-file zero-dependency bundle using `esbuild`.
