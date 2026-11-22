---
name: search-code
description: "Non-obvious syntax rules, engine constraints, and gotchas for search-code-mcp (ripgrep + ast-grep). Load when writing ast-grep patterns, YAML ast_rule queries, hybrid searches, or AST/regex replacements."
---

# Search Code MCP — Engine Rules & Gotchas

Use this guide for `search-code-mcp` quirks and `ast-grep` syntax rules that are not obvious from the tool schemas alone.

---

## 1. Server-Specific Gotchas

- **`replace` defaults to `type: "ast"`**, whereas `search` and `count` default to `type: "regex"`. Always pass `type: "text"` or `type: "regex"` explicitly for non-AST replacements.
- **`replace(type: "regex")` engine split:** File discovery runs through `ripgrep` (Rust regex), while the actual replacement executes in Node.js (`RegExp`). Stick to standard regex constructs compatible with both (avoid Rust-only flags like `(?-i)` or `\A`).
- **`language` auto-detection scope:** `language` is only auto-detected from extension when `path` points to a **single file**. Always pass `language` when running `ast` or `hybrid` over a directory to avoid multi-language ambiguity.
- **Filter parameters by mode:**
  - `caseSensitive`, `context`, `wordMatch`, `multiline`, `includeHidden` only apply to `ripgrep` (`regex`/`text`).
  - `excludePattern` and `filePattern` accept **comma-separated** globs (e.g. `"**/dist/**,**/*.test.ts"`).
- **Pagination cache:** Results exceeding `limit` are cached for 30 minutes under `<project-root>/.cache/search-code/`. Follow up with `search({ searchId, offset, limit })` without re-sending `query`.
- **Single-file outline:** Call `find_symbols({ path: "path/to/file.ts", name: "" })` to list all declarations in a file without reading the entire file.

---

## 2. `ast-grep` Pattern Syntax Rules

- **Meta-variables:**
  - `$NAME` — matches **one** named AST node (`$A`, `$EXPR`, `$BODY`). Reusing the same name (e.g. `$A === $A`) enforces structural equality.
  - `$$$ARGS` — matches **zero or more** nodes (arguments, parameters, statements). `$$$`, `$$$ARGS`, and `$$$STMTS` behave identically.
  - `$_` — anonymous wildcard (does not enforce equality if repeated).
  - **No `$$` syntax exists** — only `$` and `$$$`.
- **Valid parseable code required:** `ast-grep` parses your pattern as standalone code. Fragments that are invalid standalone syntax (e.g. a bare class method `foo() {}`, object property `key: $VAL`, or TypeScript interface member) will fail to parse as a bare pattern — use `ast_rule` with `kind:` or `context` + `selector` instead.
- **Indentation-sensitive languages (Python, YAML):** Ensure pattern indentation matches valid syntax, and verify with `dump_tree(code, language, format: "pattern")` if a pattern unexpectedly returns 0 matches.

---

## 3. `ast_rule` (Inline YAML Rules) Constraints

Every `type: "ast_rule"` query is pre-validated before execution and **must** contain top-level `id`, `language`, and `rule`:

```yaml
id: async-fn-without-try
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

Non-obvious YAML rule behaviors:
1. **`stopBy: end` on relational rules (`inside`, `has`, `follows`, `precedes`):** Defaults to `stopBy: neighbor` (immediate child/parent only). Almost every missed match in `inside` or `has` happens because `stopBy: end` was omitted.
2. **YAML quoting:** Always quote `pattern:` strings containing `:`, `?`, `{`, `}`, `[`, or `]` (e.g. `pattern: "const $X = $A ? $B : $C"`), otherwise YAML parsing fails.
3. **Matching non-standalone fragments:** In YAML rules, wrap the pattern with `context` and `selector` (discovered via `dump_tree`):
   ```yaml
   pattern:
     context: "class C { async $M($$$) { $$$BODY } }"
     selector: method_definition
   ```
4. **Never guess Tree-sitter `kind` names:** Different languages use non-obvious names (e.g. TypeScript uses `lexical_declaration` for `const`/`let`, `call_expression`, `arrow_function`). Call `dump_tree(code, language, format: "ast")` first.

---

## 4. `hybrid` Mode & Fallback Behavior

- `type: "hybrid"` extracts identifiers (≥3 chars, excluding `$VAR`/`$$$`) from your AST pattern, filters candidate files with `ripgrep`, then runs `ast-grep` in batches on matching files.
- If your AST pattern contains no literal identifiers (e.g. `$A = $B`), `hybrid` automatically falls back to a full `ast` scan.
- If `ast-grep` or `ctags` is missing on the machine, the error message lists which alternative tools (`regex`/`text` or `find_symbols`) are active so you can switch immediately.
