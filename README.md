# Code Search MCP

[![npm version](https://img.shields.io/npm/v/code-search-mcp.svg?style=flat-square&color=CB3837)](https://www.npmjs.com/package/code-search-mcp)
[![CI](https://github.com/joutvhu/code-search-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/joutvhu/code-search-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-8A2BE2.svg?style=flat-square)](https://modelcontextprotocol.io/)

A high-performance, unified [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server combining the blazing speed of **ripgrep** (regex/text search) with the deep structural syntax awareness of **ast-grep** (AST pattern matching and refactoring).

Designed specifically for AI Coding Agents (**Cursor**, **Claude Desktop**, **Antigravity**, **Cline / Roo Code**, **Windsurf**, **Zed**).

---

## ⚡ Highlights & Key Features

- **5 Unified Tools (Zero Prefix Noise)**: Clean tool names without redundant prefixes: `search`, `replace`, `count`, `dump_tree`, and `list_files`.
- **Hybrid 2-Tier Search (`type: "hybrid"`)**: Scans candidate files with ripgrep in ~30ms, then parses AST with ast-grep _only_ on matching files—giving **10x–50x speedups** over pure AST searches on large codebases.
- **Project-Scoped Pagination Cache (`./.cache/code-search/`)**:
  - Automatically activates only when results exceed your chunk limit.
  - Returns a `searchId` for instant sub-millisecond scrolling through next pages (`offset` / `limit`) without re-scanning disk.
  - Creates an isolated `./.cache/code-search/` directory with an auto-generated `.gitignore` so cache files are never committed to git.
- **Gitignore Respected by Default**: Both ripgrep and ast-grep automatically respect your project's `.gitignore` (`noIgnore: false` by default). Pass `noIgnore: true` only when you need to inspect ignored files.
- **Safe Structural Refactoring (`replace`)**: Defaults to `dryRun: true` to generate unified git-style diff previews and safety limits (`maxReplacements: 50`) before writing any changes to disk.
- **Token Protection & Truncation**: Automatically trims overly long single lines (`maxLineLength: 500`) and strips ANSI color codes to protect LLM context windows.
- **Actionable Diagnostics**: Syntax errors in AST patterns or YAML rules return helpful self-correction hints (e.g. suggesting `dump_tree` or `stopBy: end`).
- **Zero-Dependency Single-File Bundle**: Packaged with `tsup` into a self-contained single executable bundle for instant startup via `npx`.

---

## 📦 Prerequisites

Ensure the following native CLI binaries are installed and accessible in your system `PATH`:

### 1. ripgrep (`rg`)

- **Windows**: `winget install BurntSushi.ripgrep.MSVC` or `choco install ripgrep`
- **macOS**: `brew install ripgrep`
- **Linux (Debian/Ubuntu)**: `sudo apt install ripgrep`
- **Linux (Arch)**: `sudo pacman -S ripgrep`

### 2. ast-grep (`ast-grep`)

- **npm (Recommended)**: `npm install -g @ast-grep/cli`
- **macOS**: `brew install ast-grep`
- **Cargo (Rust)**: `cargo install ast-grep --locked`

---

## 🚀 Quick Start & Configuration

You can run `code-search-mcp` directly via `npx` without manual installation.

### Claude Desktop

Add to your configuration file:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "code-search": {
      "command": "npx",
      "args": ["-y", "code-search-mcp"]
    }
  }
}
```

### Cursor IDE

Add to your project's `.cursor/mcp.json` or in Cursor **Settings > Features > MCP > Add New MCP Server**:

```json
{
  "mcpServers": {
    "code-search": {
      "command": "npx",
      "args": ["-y", "code-search-mcp"]
    }
  }
}
```

### Antigravity IDE / Cline / Roo Code / Windsurf

Add to your MCP settings file:

```json
{
  "mcpServers": {
    "code-search": {
      "command": "npx",
      "args": ["-y", "code-search-mcp"]
    }
  }
}
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

### 4. `dump_tree`

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

### 5. `list_files`

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
git clone https://github.com/joutvhu/code-search-mcp.git
cd code-search-mcp

# 2. Install dependencies
npm install

# 3. Type check
npm run check

# 4. Build single-file bundle
npm run build

# 5. Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
