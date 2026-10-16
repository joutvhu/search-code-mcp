# code-search-mcp

An all-in-one, high-performance [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server combining the blazing speed of **ripgrep** with the deep structural syntax awareness of **ast-grep**.

Designed specifically for AI Coding Agents (Cursor, Claude Desktop, Antigravity, Roo/Cline, Zed).

---

## ⚡ Highlights & Key Features

- **5 Unified Tools (No Prefixes)**: Streamlined into 5 core tools: `search`, `replace`, `count`, `dump_tree`, and `list_files`.
- **Flexible Modes**: Switch search engines dynamically using `type: "regex" | "text" | "ast" | "ast_rule" | "hybrid" | "symbol"`.
- **Hybrid 2-Tier Search (`type: "hybrid"`)**: Runs ripgrep to find candidate files in ~30ms, then parses AST with ast-grep only on those files—giving you 10x-50x speedups on large repos.
- **Gitignore Respected by Default**: Automatically respects `.gitignore` rules across both ripgrep and ast-grep (`noIgnore: false` by default). Pass `noIgnore: true` only when you need to search ignored files.
- **Project-Scoped Pagination Cache (`./.cache/code-search/`)**:
  - Zero-waste: Never creates cache files for small result sets.
  - When results exceed chunk limit, saves results in project-scoped cache with auto-generated `.gitignore` (`*`) so it never gets committed to git.
  - Return `searchId` for instant (< 1ms) scrolling without re-scanning disk.
- **Safe Structural Refactoring (`replace`)**: Supports AST rewrites and regex replacements. Defaults to `dryRun: true` providing unified diff previews (`git diff` style) before applying changes to disk.
- **Token Protection**: Automatically truncates excessively long lines (`maxLineLength: 500`) and strips ANSI color codes to protect LLM context windows.
- **Actionable Diagnostics**: Catches YAML errors and unknown AST node kinds immediately with self-correcting hints (e.g. suggesting `dump_tree` or `stopBy: end`).
- **Multi-session Stability**: Tolerates `SIGINT` signals sent by IDEs when opening new terminal tabs/sessions.

---

## 📦 Prerequisites

1. **Node.js**: v18 or higher.
2. **ripgrep (`rg`)**: Available in `PATH`.
   - Windows: `winget install BurntSushi.ripgrep.MSVC` or `choco install ripgrep`
   - macOS: `brew install ripgrep`
   - Linux: `sudo apt install ripgrep`
3. **ast-grep (`ast-grep`)**: Available in `PATH`.
   - Install via npm: `npm install -g @ast-grep/cli`
   - Install via cargo: `cargo install ast-grep --locked`
   - macOS: `brew install ast-grep`

---

## 🚀 Installation & Setup

1. Clone or navigate to the repository:
   ```bash
   cd code-search-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

---

## ⚙️ Configuration

### 1. Claude Desktop
Add to your Claude Desktop configuration file:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "code-search": {
      "command": "node",
      "args": ["F:/Documents/Library/AI/code-search-mcp/dist/index.js"]
    }
  }
}
```

### 2. Cursor IDE
Add to `.cursor-mcp/settings.json` or in **Settings > Features > MCP**:

```json
{
  "mcpServers": {
    "code-search": {
      "command": "node",
      "args": ["F:/Documents/Library/AI/code-search-mcp/dist/index.js"]
    }
  }
}
```

### 3. Antigravity IDE / Cline / Roo Code
Add to your client MCP settings:

```json
{
  "mcpServers": {
    "code-search": {
      "command": "node",
      "args": ["F:/Documents/Library/AI/code-search-mcp/dist/index.js"]
    }
  }
}
```

---

## 🛠️ Tool Reference

### 1. `search`
All-in-one search engine.

```typescript
// 1. Fast regex or literal search
search({ query: "handleRequest", path: "./src" })
search({ query: "class.*Controller", type: "regex", context: 2 })
search({ query: "TODO:", type: "text", fileType: "ts" })

// 2. AST structural pattern search (tolerates whitespace/comments)
search({ query: "console.log($$$ARGS)", type: "ast", language: "typescript" })

// 3. Complex YAML relational rule
search({
  query: `
id: find-async-await
language: typescript
rule:
  all:
    - kind: arrow_function
    - has:
        pattern: await $EXPR
        stopBy: end
`,
  type: "ast_rule"
})

// 4. Hybrid 2-tier search for huge codebases
search({ query: "class $NAME extends BaseService { $$$ }", type: "hybrid" })

// 5. Symbol definition discovery
search({ query: "UserService", type: "symbol" })

// 6. View next chunk using searchId
search({ searchId: "s_9f2a7b", offset: 51, limit: 50 })
```

### 2. `replace`
Structural code refactoring and regex replacement.

```typescript
// Preview diff with dryRun: true (default)
replace({
  query: "oldFunc($A, $B)",
  replacement: "newFunc({ a: $A, b: $B })",
  type: "ast",
  dryRun: true
})

// Apply changes to disk
replace({
  query: "oldFunc($A, $B)",
  replacement: "newFunc({ a: $A, b: $B })",
  type: "ast",
  dryRun: false
})
```

### 3. `count`
Count matching occurrences or lines without pulling contents into context.

```typescript
count({ query: "FIXME", path: "./src" })
count({ query: "catch($E)", type: "ast", perFile: true })
```

### 4. `dump_tree`
Inspect concrete syntax trees to discover exact node kinds.

```typescript
dump_tree({ code: "const x = 1;", language: "typescript", format: "cst" })
```

### 5. `list_files`
Quickly enumerate files with glob and type filters.

```typescript
list_files({ path: "./src", filePattern: "*.service.ts" })
```

---

## 🧪 Testing with MCP Inspector

Test your server visually with the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## 📄 License

MIT
