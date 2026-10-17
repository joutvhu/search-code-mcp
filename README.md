# Search Code MCP

[![npm version](https://img.shields.io/npm/v/search-code-mcp.svg?style=flat-square&color=CB3837)](https://www.npmjs.com/package/search-code-mcp)
[![CI](https://github.com/joutvhu/search-code-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/joutvhu/search-code-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-8A2BE2.svg?style=flat-square)](https://modelcontextprotocol.io/)

A high-performance, unified [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server combining the blazing speed of **ripgrep** (regex/text search) with the deep structural syntax awareness of **ast-grep** (AST pattern matching and refactoring).

Designed specifically for AI Coding Agents (**Cursor**, **Claude Desktop**, **Kiro**, **Antigravity**, **Cline / Roo Code**, **Windsurf**, **Zed**).

---

## ⚡ Highlights & Key Features

- **6 Unified Tools (Zero Prefix Noise)**: Clean tool names without redundant prefixes: `search`, `replace`, `count`, `find_symbols`, `dump_tree`, and `list_files`.
- **Multi-Engine Driver Fallback (Zero Setup Friction)**: Automatically discovers and uses the best available CLI tool on your system without manual configuration:
  - **Text & Regex**: `ripgrep` (`rg`) ➜ `ugrep` ➜ `git grep` *(runs out of the box on any developer machine with Git installed!)*.
  - **Symbol Search**: Universal Ctags (`ctags`) ➜ `ast-grep` ➜ `ripgrep` / `git grep` regex heuristic.
  - **AST Search**: `ast-grep` ➜ alias `sg`.
  - **File Listing**: `rg --files` ➜ `git ls-files` ➜ Native Node.js recursive directory walk.
- **Hybrid 2-Tier Search (`type: "hybrid"`)**: Scans candidate files with ripgrep in ~30ms, then parses AST with ast-grep _only_ on matching files—giving **10x–50x speedups** over pure AST searches on large codebases.
- **Project-Scoped Pagination Cache (`./.cache/search-code/`)**:
  - Automatically activates only when results exceed your chunk limit.
  - Returns a `searchId` for instant sub-millisecond scrolling through next pages (`offset` / `limit`) without re-scanning disk.
  - Creates an isolated `./.cache/search-code/` directory with an auto-generated `.gitignore` so cache files are never committed to git.
- **Gitignore Respected by Default**: Both ripgrep and ast-grep automatically respect your project's `.gitignore` (`noIgnore: false` by default). Pass `noIgnore: true` only when you need to inspect ignored files.
- **Safe Structural Refactoring (`replace`)**: Defaults to `dryRun: true` to generate unified git-style diff previews and safety limits (`maxReplacements: 50`) before writing any changes to disk.
- **Flexible Path Handling**: Supports both relative paths (e.g. `"."`, `"./src"`) and absolute paths as input. By default, tool outputs return absolute paths. Set `RELATIVE_PATHS=true` in environment (or pass `--relative-paths`) to format output paths as clean relative paths to save LLM context window tokens.
- **Token Protection & Truncation**: Automatically trims overly long single lines (`maxLineLength: 500`) and strips ANSI color codes to protect LLM context windows.
- **Actionable Diagnostics**: Syntax errors in AST patterns or YAML rules return helpful self-correction hints (e.g. suggesting `dump_tree` or `stopBy: end`).
- **Agent Skill Included (`skills/search-code`)**: Pre-configured Agent Skill for Claude Code, Cursor, Antigravity, and Cline to automatically write AST patterns, YAML rules, and select optimal engines.
- **Zero-Dependency Single-File Bundle**: Packaged with `esbuild` into a self-contained single executable bundle for instant startup via `npx`.

---

## 📦 Prerequisites & Engine Setup

### 🔧 Interactive Engine Manager (`search-code-mcp engine`)

Instead of installing binaries manually, you can run the built-in interactive engine manager to inspect your environment and automatically install missing tools with arrow keys (`↑` / `↓`) and `[Enter]`:

```bash
npx search-code-mcp engine
```

It automatically detects which text, AST, and symbol engines are installed, and presents an interactive selector to install any missing tools (via `npm`, `choco`, `winget`, or `brew`).

---

### Manual Installation (Optional)

If you prefer to install engines manually, ensure the following CLI binaries are accessible in your system `PATH`:

#### 1. ripgrep (`rg`) — *Text & Regex Search*
- **Windows**: `winget install BurntSushi.ripgrep.MSVC` or `choco install ripgrep`
- **macOS**: `brew install ripgrep`
- **Linux (Debian/Ubuntu)**: `sudo apt install ripgrep`
- **Linux (Arch)**: `sudo pacman -S ripgrep`

#### 2. ast-grep (`ast-grep`) — *Structural AST Search & Refactoring*
- **npm (Recommended)**: `npm install -g @ast-grep/cli`
- **macOS**: `brew install ast-grep`
- **Cargo (Rust)**: `cargo install ast-grep --locked`
- **Windows**: `choco install ast-grep` or `winget install ast-grep`

#### 3. universal-ctags (`ctags`) — *Symbol Search (Optional)*
*Note: If ctags is not installed, the server automatically falls back to ripgrep regex heuristics.*
- **Windows**: `choco install universal-ctags` or `winget install universal-ctags.universal-ctags`
- **macOS**: `brew install universal-ctags`
- **Linux (Debian/Ubuntu)**: `sudo apt install universal-ctags`

---

## 🚀 Quick Start & Configuration

You can run `search-code-mcp` directly via `npx` without manual installation.

Add the following configuration to your client's MCP configuration file:

```json
{
  "mcpServers": {
    "search-code": {
      "command": "npx",
      "args": ["-y", "search-code-mcp"]
    }
  }
}
```

> [!TIP]
> **Token-Saving Relative Paths**: Add `"env": { "RELATIVE_PATHS": "true" }` (or pass `"--relative-paths"` in `args`) if you want tool outputs to return clean relative paths instead of full absolute paths.

### 📍 Configuration File Locations

| Client | Configuration File Path |
| :--- | :--- |
| **Kiro** | **Workspace**: `.kiro/settings/mcp.json`<br>**Global**: `~/.kiro/settings/mcp.json` *(Windows: `%USERPROFILE%\.kiro\settings\mcp.json`)* |
| **Cursor** | **Workspace**: `.cursor/mcp.json`<br>Or in **Settings > Features > MCP > Add New MCP Server** |
| **Claude Desktop** | **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`<br>**Windows**: `%APPDATA%\Claude\claude_desktop_config.json` |
| **Antigravity IDE** | `%USERPROFILE%\.gemini\config\mcp_config.json` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **Cline / Roo Code** | Click **MCP Servers** icon ➜ **Configure MCP Servers** |

---

### 🧠 Install Agent Skill (Optional but Recommended)

Teach your AI coding agent (Cursor, Claude Code, Antigravity, Cline, Kiro) how to write high-precision `ast-grep` patterns, YAML rules, and choose the optimal search engine:

```bash
npx skills add joutvhu/search-code-mcp
```

Or install locally in your project:

```bash
npx skills add ./skills/search-code
```

---

## 🛠️ Tool Reference

### 1. `search`

Unified search engine supporting regex, literal text, AST patterns, relational YAML rules, and hybrid searches.

| Parameter        | Type      | Default     | Description                                                                                  |
| :--------------- | :-------- | :---------- | :------------------------------------------------------------------------------------------- |
| `query`          | `string`  | -           | Search query: text, regex, AST pattern, or YAML rule. _(Optional if `searchId` is provided)_ |
| `path`           | `string`  | `"."`       | Target directory or file to search                                                           |
| `type`           | `enum`    | `"regex"`   | Search engine mode: `"regex"`, `"text"`, `"ast"`, `"ast_rule"`, `"hybrid"`, `"symbol"`       |
| `searchId`       | `string`  | -           | ID of a previous search to view remaining results instantly from cache                       |
| `offset`         | `number`  | `1`         | Starting result index for pagination (1-based)                                               |
| `limit`          | `number`  | `50`        | Maximum matches to return in this chunk                                                      |
| `filePattern`    | `string`  | -           | Glob pattern to filter files (e.g. `"*.{ts,tsx}"`, `"!**/*.spec.ts"`)                        |
| `fileType`       | `string`  | -           | Ripgrep file type filter (e.g. `"ts"`, `"py"`, `"rust"`, `"json"`)                           |
| `excludePattern` | `string`  | -           | Glob pattern to exclude (e.g. `"**/dist/**"`)                                                |
| `noIgnore`       | `boolean` | `false`     | If `true`, searches inside `.gitignore`-ignored files                                        |
| `caseSensitive`  | `boolean` | smart-case  | Case sensitivity                                                                             |
| `context`        | `number`  | `0`         | Number of context lines before and after match (`-C`)                                        |
| `wordMatch`      | `boolean` | `false`     | Match whole words only (`-w`)                                                                |
| `multiline`      | `boolean` | `false`     | Match regex across line breaks (`-U`)                                                        |
| `includeHidden`  | `boolean` | `false`     | Search hidden files and folders (`-.`)                                                       |
| `language`       | `string`  | auto        | Programming language for AST mode (auto-detected from file extension if omitted)             |
| `outputFormat`   | `enum`    | `"content"` | `"content"` (full snippets), `"compact"` (`file:line`), `"files_only"`, or `"json"`          |

#### Examples:

```typescript
// Fast regex or text search
search({ query: "handleRequest", path: "./src" });
search({ query: "class.*Controller", type: "regex", context: 2 });

// AST structural pattern (ignores whitespace & formatting differences)
search({ query: "console.log($$$ARGS)", type: "ast", language: "typescript" });

// Hybrid 2-tier search: 10x-50x faster on huge codebases
search({ query: "class $NAME extends BaseService { $$$ }", type: "hybrid" });

// Complex relational YAML rule
search({
  query: `
id: find-async-arrow
language: typescript
rule:
  all:
    - kind: arrow_function
    - has:
        pattern: await $EXPR
        stopBy: end
`,
  type: "ast_rule",
});

// Retrieve next chunk from cache using searchId
search({ searchId: "s_9f2a7b", offset: 51, limit: 50 });
```

---

### 2. `replace`

Structural code refactoring and replacement engine. Supports AST rewrite patterns and Regex/Text replacements.

| Parameter         | Type      | Default      | Description                                                             |
| :---------------- | :-------- | :----------- | :---------------------------------------------------------------------- |
| `query`           | `string`  | **Required** | Search pattern to replace (AST pattern or regex)                        |
| `replacement`     | `string`  | **Required** | Replacement string or AST rewrite pattern                               |
| `path`            | `string`  | `"."`        | Target directory or file                                                |
| `type`            | `enum`    | `"ast"`      | Replacement mode: `"ast"` (structural rewrite), `"regex"`, `"text"`     |
| `dryRun`          | `boolean` | `true`       | If `true`, outputs unified diff preview without modifying files on disk |
| `maxReplacements` | `number`  | `50`         | Safety limit on maximum matches to replace                              |
| `filePattern`     | `string`  | -            | Glob pattern to filter files                                            |
| `fileType`        | `string`  | -            | File type filter                                                        |
| `excludePattern`  | `string`  | -            | Glob pattern to exclude                                                 |
| `noIgnore`        | `boolean` | `false`      | Whether to modify `.gitignore`-ignored files                            |
| `language`        | `string`  | auto         | Programming language for AST mode                                       |

#### Examples:

```typescript
// 1. Dry run preview (safe default, outputs unified git diff)
replace({
  query: "fetchData($A, $B)",
  replacement: "fetchData({ url: $A, options: $B })",
  type: "ast",
  dryRun: true,
});

// 2. Apply modifications to disk
replace({
  query: "fetchData($A, $B)",
  replacement: "fetchData({ url: $A, options: $B })",
  type: "ast",
  dryRun: false,
});
```

---

### 3. `count`

Count matching occurrences or lines across files without returning match content, saving tokens.

| Parameter        | Type      | Default      | Description                                                  |
| :--------------- | :-------- | :----------- | :----------------------------------------------------------- |
| `query`          | `string`  | **Required** | Search pattern to count                                      |
| `path`           | `string`  | `"."`        | Target directory or file                                     |
| `type`           | `enum`    | `"regex"`    | Engine mode: `"regex"`, `"text"`, `"ast"`                    |
| `countLines`     | `boolean` | `false`      | Count matching lines (`true`) or total occurrences (`false`) |
| `perFile`        | `boolean` | `false`      | Show breakdown of matches per file                           |
| `filePattern`    | `string`  | -            | Glob pattern filter                                          |
| `fileType`       | `string`  | -            | File type filter                                             |
| `excludePattern` | `string`  | -            | Glob exclude filter                                          |
| `noIgnore`       | `boolean` | `false`      | Search inside ignored files                                  |
| `language`       | `string`  | auto         | Language for AST mode                                        |

#### Examples:

```typescript
count({ query: "TODO:", type: "text" });
count({ query: "catch ($ERR) { $$$ }", type: "ast", perFile: true });
```

---

### 4. `find_symbols`

Find and navigate code definitions (functions, classes, interfaces, methods, types, variables, structs, enums) across the codebase. Automatically selects the best available engine: **Universal Ctags** ➜ **ast-grep** ➜ **ripgrep / git-grep regex heuristic**.

| Parameter        | Type      | Default   | Description                                                                                                    |
| :--------------- | :-------- | :-------- | :------------------------------------------------------------------------------------------------------------- |
| `name`           | `string`  | `""`      | Symbol name or substring to find (leave empty to list all symbols in target directory/file)                     |
| `path`           | `string`  | `"."`     | Target directory or file path                                                                                  |
| `kinds`          | `array`   | -         | Filter by symbol kinds: `"function"`, `"class"`, `"interface"`, `"method"`, `"variable"`, `"type"`, `"struct"`, `"enum"` |
| `exactMatch`     | `boolean` | `false`   | If `true`, matches exact symbol name. If `false` (default), matches prefix or substring                        |
| `filePattern`    | `string`  | -         | Glob pattern filter (e.g. `"*.ts"` or `"*.py"`)                                                                |
| `fileType`       | `string`  | -         | Ripgrep file type filter (e.g. `"ts"`, `"py"`, `"rust"`)                                                    |
| `excludePattern` | `string`  | -         | Glob pattern to exclude                                                                                        |
| `noIgnore`       | `boolean` | `false`   | Search inside ignored files                                                                                    |
| `maxResults`     | `number`  | `100`     | Maximum number of symbols to return                                                                            |
| `outputFormat`   | `enum`    | `"table"` | Output format: `"table"` (default markdown table), `"compact"` (`file:line: [kind] name`), or `"json"`            |

#### Examples:

```typescript
// Find exact function or class by name
find_symbols({ name: "handleSearch", exactMatch: true });

// List all functions in a module/directory
find_symbols({ path: "src/handlers", kinds: ["function"] });

// Search across whole repo with compact output
find_symbols({ name: "Schema", outputFormat: "compact" });
```

### 5. `dump_tree`

Inspect concrete syntax trees (CST) or AST node structures to craft precise ast-grep patterns.

| Parameter  | Type     | Default      | Description                                                            |
| :--------- | :------- | :----------- | :--------------------------------------------------------------------- |
| `code`     | `string` | **Required** | Code snippet to inspect                                                |
| `language` | `string` | **Required** | Programming language (e.g. `"typescript"`, `"python"`, `"rust"`)       |
| `format`   | `enum`   | `"cst"`      | Tree format: `"cst"` (syntax tree with kinds), `"ast"`, or `"pattern"` |

#### Example:

```typescript
dump_tree({
  code: "const calculate = (a, b) => a + b;",
  language: "typescript",
  format: "cst",
});
```

---

### 6. `list_files`

Enumerate files matching glob patterns or file types without scanning file contents.

| Parameter        | Type      | Default | Description                                |
| :--------------- | :-------- | :------ | :----------------------------------------- |
| `path`           | `string`  | `"."`   | Directory to search                        |
| `filePattern`    | `string`  | -       | Glob pattern filter (e.g. `"*.config.js"`) |
| `fileType`       | `string`  | -       | Ripgrep file type filter                   |
| `excludePattern` | `string`  | -       | Glob pattern to exclude                    |
| `noIgnore`       | `boolean` | `false` | List files ignored by `.gitignore`         |
| `includeHidden`  | `boolean` | `false` | Include hidden files and folders           |

#### Example:

```typescript
list_files({ path: "./src", filePattern: "*.service.ts" });
```

---

## 🔍 Development & Contributing

```bash
# 1. Clone the repository
git clone https://github.com/joutvhu/search-code-mcp.git
cd search-code-mcp

# 2. Install dependencies
npm install

# 3. Type check
npm run check

# 4. Run automated test suite
npm test

# 5. Build single-file bundle
npm run build

# 6. Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

