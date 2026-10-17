---
name: search-code
description: "Master code search and structural refactoring using search-code-mcp (ripgrep + ast-grep). Use when searching for code patterns, syntax structures, refactoring with AST replacements, finding symbols, or investigating codebases. Translates natural language questions into high-precision AST patterns, YAML rules, or regex queries."
---

# Search Code & Structural Refactoring Expert

A skill for AI Coding Agents to search, inspect, and refactor codebases with extreme speed and surgical precision using the `search-code-mcp` tools (backed by **ripgrep** and **ast-grep**).

---

## 1. Engine & Tool Decision Matrix

Choose the right tool and `type` based on the user's intent:

| User Intent | Recommended Tool & Params | Why |
| :--- | :--- | :--- |
| **Exact text, log, error message, TODO** | `search(query, type: "text")` | Ripgrep literal search (~5–10ms) |
| **Regex / complex string pattern** | `search(query, type: "regex")` | Ripgrep DFA regex engine, ReDoS-immune |
| **Function, class, interface definition** | `find_symbols(name)` or `search(type: "symbol")` | Fast symbol table lookup across files |
| **Code syntax / structural patterns** | `search(query, type: "ast", language: "...")` | Matches code regardless of formatting, spacing, or variable names |
| **Conditional logic (e.g. A without B)** | `search(query, type: "ast_rule")` | Uses YAML relational rules (`has`, `not`, `inside`, `follows`) |
| **Large repo + structural search** | `search(query, type: "hybrid")` | 2-tier: ripgrep pre-filters candidate files (~30ms) → ast-grep parses precision |
| **Safe structural code rewrite** | `replace(query, replacement, type: "ast", dryRun: true)` | AST rewrite with unified diff preview |
| **Need CST node kinds for AST pattern** | `dump_tree(code, language)` | Inspects Concrete Syntax Tree (CST) — do this first when unsure |
| **Count occurrences without match payload** | `count(query, type: "...")` | Saves context tokens, counts lines/occurrences only |
| **List project files fast** | `list_files(path, filePattern)` | Fast file listing respecting `.gitignore` |

---

## 2. ast-grep Syntax & Meta-Variables

In `ast-grep`, patterns look like real code with **meta-variables** as placeholders:

| Meta-Variable | Meaning | Example Pattern | What It Matches |
| :--- | :--- | :--- | :--- |
| `$NAME` | **Single** AST node (identifier, expression, or literal) | `console.log($MSG)` | `console.log("hello")`, `console.log(err)` |
| `$$$ARGS` | **Zero or more** AST nodes (arguments, params, statements) | `fn($$$ARGS)` | `fn()`, `fn(1)`, `fn(a, b, c)` |

> **Important rules:**
> - `$VAR` and `$NAME` are interchangeable — any `$UPPERCASE` is a named capture.
> - `$$$` captures a sequence; the name after `$$$` is only for readability (`$$$ARGS` = `$$$PARAMS` = `$$$` — all equivalent).
> - There is **no** `$$` syntax — only `$` (single) and `$$$` (multiple).
> - Always pass `language` explicitly (`language: "typescript"`) when the MCP cannot auto-detect from a file extension (e.g., when `path` is a directory with mixed file types).

### Language-Specific Pattern Examples

#### JavaScript / TypeScript
- **All console calls**: `console.$METHOD($$$)`
- **Express route**: `app.post($ROUTE, $$$HANDLERS)`
- **React Hook**: `useEffect($$$, [$$$DEPS])`
- **Async arrow function**: `const $NAME = async ($$$ARGS) => { $$$STMTS }`
- **Import from library**: `import { $$$IMPORTS } from "lodash"`
- **Throw expression**: `throw $ERR`

#### Python
- **Function definition**: `def $NAME($$$ARGS): $$$`
- **Decorator route**: `@app.route($ROUTE, $$$KWARGS)`
> ⚠️ Python patterns are sensitive to indentation in Tree-sitter grammar. Always call `dump_tree` to verify node structure before writing patterns.

#### Go
- **Nil error guard**: `if err != nil { $$$STMTS }`
- **Function declaration**: `func $NAME($$$ARGS) $$$RET { $$$STMTS }`
- **Goroutine launch**: `go $FUNC($$$ARGS)`

---

## 3. Advanced YAML Rules (`type: "ast_rule"`)

Use `ast_rule` when a single pattern isn't enough — e.g., negations, containment checks, or multi-condition queries.

> **Important**: `search-code-mcp` validates YAML rules before execution. Every YAML rule MUST include `id`, `language`, and `rule`. If your pattern contains special characters like `?`, `:`, `{}` or `[]`, always wrap the pattern in quotes (e.g. `pattern: "const $A = $B ? $C : $D"`).

### Key Rule Operators

| Operator | Description | Example |
| :--- | :--- | :--- |
| `pattern` | Match a code pattern | `pattern: console.log($$$)` |
| `kind` | Match a Tree-sitter node kind (get from `dump_tree`) | `kind: function_declaration` |
| `has` | Node must contain a child matching sub-rule | `has: { kind: try_statement }` |
| `not` | Negate any rule | `not: { has: { kind: try_statement } }` |
| `inside` | Node must be contained within a parent matching sub-rule | `inside: { kind: class_declaration }` |
| `follows` | Node must appear after a sibling matching sub-rule | `follows: { pattern: $VAR = require($$$) }` |
| `stopBy` | How far to traverse (`neighbor` = adjacent only, `end` = anywhere in subtree) | `stopBy: end` |

> **Common fix**: If a `has` or `inside` rule doesn't match as expected, add `stopBy: end` to search the full subtree instead of just immediate children.

### Example 1: Async function without a try-catch block
```yaml
id: async-no-try-catch
language: typescript
rule:
  kind: function_declaration
  has:
    kind: async
  not:
    has:
      kind: try_statement
      stopBy: end
```

### Example 2: `console.log` call inside a class method (not at module level)
```yaml
id: console-in-method
language: typescript
rule:
  pattern: console.log($$$)
  inside:
    kind: method_definition
    stopBy: end
```

### Example 3: require() call not assigned to a variable
```yaml
id: unassigned-require
language: typescript
rule:
  pattern: require($MODULE)
  not:
    inside:
      pattern: $VAR = require($MODULE)
```

---

## 4. Structural Refactoring (`replace`) Workflow

Always use the **Dry-Run-First** principle when modifying code:

1. **Step 1: Preview changes with `dryRun: true` (default)**
   ```json
   {
     "path": "src",
     "query": "import { $$$NAMES } from 'lodash'",
     "replacement": "import { $$$NAMES } from 'lodash-es'",
     "type": "ast",
     "language": "typescript",
     "dryRun": true
   }
   ```
2. **Step 2: Inspect the Unified Diff** returned by the tool — verify only the intended files and lines are affected.
3. **Step 3: Apply changes** by setting `"dryRun": false`.

> **Important limits**: `replace` defaults to `maxReplacements: 50` as a safety cap. For large-scale refactors, run in batches by scoping `path` to a specific subdirectory.

---

## 5. Pagination & Result Handling

When searching large projects:
- Results exceeding `limit` (default: 50) return a `searchId` and `hasMore: true`.
- Retrieve the next page by passing `searchId` with the next `offset`:
  ```json
  {
    "searchId": "a1b2c3d4",
    "offset": 51,
    "limit": 50
  }
  ```
- This reads from cache in ~1ms — **do not re-run the original query**.

---

## 6. Golden Rules for Agents

1. **Call `dump_tree` before writing any AST pattern** when you are not certain of the node kind. Pass a 2-3 line snippet and the `language`.
2. **Scope with file filters**: Use `filePattern: "*.{ts,tsx}"` or `fileType: "ts"` — never scan the entire repo with an AST query.
3. **Prefer `ast` / `ast_rule` over `regex` for refactoring**: Regex replacement silently breaks on multi-line code, string literals, or comments. AST rewrites are structure-aware.
4. **Use `type: "text"` for raw token search**: UUIDs, URLs, specific error strings, config keys — ripgrep text search is 10x faster than AST for these.
5. **Prefer `type: "hybrid"` for large repos with structural queries**: It pre-filters with ripgrep before running the expensive AST parse — significant speedup on repos with 10k+ files.
6. **Always `dryRun: true` first for `replace`**: Never write directly without previewing the unified diff.
