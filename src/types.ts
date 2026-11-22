import { z } from "zod";

export const SearchTypeSchema = z.enum([
  "regex",
  "text",
  "ast",
  "ast_rule",
  "hybrid",
]);

export type SearchType = z.infer<typeof SearchTypeSchema>;

export const OutputFormatSchema = z.enum([
  "content",
  "compact",
  "files_only",
  "json",
]);

export type OutputFormat = z.infer<typeof OutputFormatSchema>;

export const SearchSchema = z.object({
  // Cache pagination parameters
  searchId: z
    .string()
    .optional()
    .describe(
      "Pagination ID (e.g. 's_a1b2c3d4') returned by a previous search when results exceeded 'limit'. When provided, omit 'query' and pass 'offset'/'limit' to read cached results instantly."
    ),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe("1-based starting match index for pagination (default: 1)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe("Maximum matches to return per page (1-500, default: 50)."),

  // Fresh search parameters
  query: z
    .string()
    .optional()
    .describe(
      "Required for a new search (omit when using 'searchId'). Interpretation depends on 'type': PCRE2/Rust regex ('regex'), literal substring ('text'), ast-grep code pattern with $VAR / $$$ARGS ('ast'/'hybrid'), or YAML rule with id/language/rule ('ast_rule')."
    ),
  path: z
    .string()
    .optional()
    .default(".")
    .describe("File or directory to search in (relative to workspace root or absolute; default: '.')."),
  type: SearchTypeSchema.optional()
    .default("regex")
    .describe(
      "Search mode: 'regex' (default, ripgrep regex), 'text' (exact literal match), 'ast' (structural AST pattern), 'ast_rule' (YAML rule with relational checks like inside/has/not), or 'hybrid' (ripgrep pre-filter + ast-grep for large repos)."
    ),

  // File filtering & Gitignore
  filePattern: z
    .string()
    .optional()
    .describe("Glob pattern(s) to include, comma-separated, e.g. '*.{ts,tsx}' or 'src/**/*.py'."),
  excludePattern: z
    .string()
    .optional()
    .describe("Comma-separated glob patterns to exclude, e.g. '**/dist/**,**/*.test.ts'."),
  noIgnore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, also search files ignored by .gitignore. Default: false (respects .gitignore)."),

  // Ripgrep options (for 'regex', 'text', 'hybrid')
  caseSensitive: z
    .boolean()
    .optional()
    .describe("[regex/text/hybrid] Force case-sensitive (true) or case-insensitive (false). Omitting uses smart-case (insensitive unless query has uppercase)."),
  context: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("[regex/text only] Number of context lines before and after each match (0-20)."),
  wordMatch: z
    .boolean()
    .optional()
    .describe("[regex/text] Match whole words only."),
  multiline: z
    .boolean()
    .optional()
    .describe("[regex/text only] Allow pattern to match across multiple lines."),
  includeHidden: z
    .boolean()
    .optional()
    .describe("Include hidden dotfiles and dot-directories (excludes .git unless noIgnore is true)."),

  // ast-grep & output options
  language: z
    .string()
    .optional()
    .describe(
      "[ast/hybrid only] Target language (e.g. 'typescript', 'tsx', 'javascript', 'python', 'rust', 'go', 'java'). Auto-detected from extension when 'path' is a single file; pass explicitly when searching a directory to avoid multi-language ambiguity."
    ),
  outputFormat: OutputFormatSchema.optional()
    .default("content")
    .describe(
      "Output format: 'content' (default, file:line + full match text), 'compact' (file:line: first-line snippet), 'files_only' (unique file paths), 'json' (structured JSON)."
    ),
});

export type SearchParams = z.infer<typeof SearchSchema>;

export const ReplaceTypeSchema = z.enum(["ast", "regex", "text"]);
export type ReplaceType = z.infer<typeof ReplaceTypeSchema>;

export const ReplaceSchema = z.object({
  path: z
    .string()
    .optional()
    .default(".")
    .describe("File or directory to modify (relative or absolute; default: '.'). Narrow to a subdirectory for large refactors."),
  query: z
    .string()
    .describe(
      "Pattern to match: ast-grep pattern with $VAR/$$$ARGS ('ast'), JavaScript RegExp ('regex'), or exact literal string ('text')."
    ),
  replacement: z
    .string()
    .describe(
      "Replacement template: reuse captured meta-variables like $VAR/$$$ARGS ('ast'), $1/$& capture groups ('regex'), or exact literal text ('text')."
    ),
  type: ReplaceTypeSchema.optional()
    .default("ast")
    .describe(
      "Replacement engine (NOTE: defaults to 'ast', unlike 'search' and 'count' which default to 'regex'). Use 'ast' for structural rewrites, 'regex' for JS regex replacement, or 'text' for literal string replacement."
    ),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe("Safety preview mode. Default true: returns unified diff without modifying files. Set false only after inspecting the diff."),
  maxReplacements: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(50)
    .describe("Safety guardrail: maximum number of individual match occurrences to replace per call (default: 50)."),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("[regex/text only] Force case-sensitive (true) or case-insensitive (false). Default: true."),
  multiline: z
    .boolean()
    .optional()
    .describe("[regex only] Allow pattern to match across multiple lines. Automatically enabled when query contains \\n or multiline character classes."),
  filePattern: z
    .string()
    .optional()
    .describe("Glob pattern(s) to include, comma-separated, e.g. '*.ts' or 'src/**/*.tsx'."),
  excludePattern: z
    .string()
    .optional()
    .describe("Comma-separated glob patterns to exclude, e.g. '**/dist/**,**/*.test.ts'."),
  noIgnore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, also replace in files ignored by .gitignore. Default: false (respects .gitignore)."),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include hidden dotfiles and dot-directories (excludes .git unless noIgnore is true). Default: false."),
  language: z
    .string()
    .optional()
    .describe("[ast only] Target language (e.g. 'typescript', 'python'). Auto-detected when 'path' is a single file; recommended when 'path' is a directory."),
});

export type ReplaceParams = z.infer<typeof ReplaceSchema>;

export const CountSchema = z.object({
  path: z
    .string()
    .optional()
    .default(".")
    .describe("File or directory to count matches in (relative or absolute; default: '.')."),
  query: z.string().describe("Pattern to count (regex, literal text, or AST pattern)."),
  type: z
    .enum(["regex", "text", "ast"])
    .optional()
    .default("regex")
    .describe("Counting engine: 'regex' (default), 'text' (literal), or 'ast' (structural pattern)."),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("[regex/text] Force case-sensitive (true) or case-insensitive (false). Omitting uses smart-case (insensitive unless query has uppercase)."),
  filePattern: z
    .string()
    .optional()
    .describe("Glob pattern(s) to include, comma-separated, e.g. '*.{ts,tsx}'."),
  excludePattern: z
    .string()
    .optional()
    .describe("Comma-separated glob patterns to exclude, e.g. '**/dist/**,**/*.spec.ts'."),
  noIgnore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include gitignored files. Default: false."),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include hidden dotfiles and dot-directories (excludes .git unless noIgnore is true). Default: false."),
  perFile: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, returns match counts broken down per file."),
  language: z
    .string()
    .optional()
    .describe("[ast only] Target language (e.g. 'typescript', 'python'). Recommended when 'path' is a directory."),
});

export type CountParams = z.infer<typeof CountSchema>;

export const DumpTreeSchema = z.object({
  code: z
    .string()
    .describe("Short representative code snippet (2-5 lines) or an ast-grep pattern (when format='pattern') to inspect."),
  language: z
    .string()
    .describe("Tree-sitter language name, e.g. 'typescript', 'tsx', 'javascript', 'python', 'rust', 'go', 'java'."),
  format: z
    .enum(["cst", "ast", "pattern"])
    .optional()
    .default("ast")
    .describe(
      "Tree format: 'ast' (default, named AST nodes only—best for finding 'kind:' names for ast_rule), 'cst' (full concrete syntax tree with punctuation), 'pattern' (shows how ast-grep parses your pattern with $VAR/$$$)."
    ),
});

export type DumpTreeParams = z.infer<typeof DumpTreeSchema>;

export const ListFilesSchema = z.object({
  path: z
    .string()
    .optional()
    .default(".")
    .describe("Directory to list files in (relative or absolute; default: '.')."),
  filePattern: z
    .string()
    .optional()
    .describe("Glob pattern to include, e.g. '*.{ts,tsx}' or '**/*.config.js'."),
  excludePattern: z
    .string()
    .optional()
    .describe("Comma-separated glob patterns to exclude, e.g. '**/dist/**,**/*.test.ts'."),
  noIgnore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include files ignored by .gitignore. Default: false."),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include hidden dotfiles and dot-directories (excludes .git by default). Default: false."),
});

export type ListFilesParams = z.infer<typeof ListFilesSchema>;

export const SymbolKindSchema = z.enum([
  "function",
  "class",
  "interface",
  "method",
  "variable",
  "type",
  "struct",
  "enum",
  "trait",
  "module",
  "other",
]);

export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export interface SymbolItem {
  name: string;
  kind: string;
  file: string;
  line: number;
  column?: number;
  containerName?: string;
  signature?: string;
}

export const FindSymbolsSchema = z.object({
  name: z
    .string()
    .optional()
    .default("")
    .describe("Symbol name or substring to match (case-insensitive unless exactMatch=true). Leave empty ('') with a file or folder 'path' to list all symbols as an outline."),
  path: z
    .string()
    .optional()
    .default(".")
    .describe("File or directory to inspect (relative or absolute; default: '.'). Pass a single file path with empty 'name' to get that file's symbol outline."),
  kinds: z
    .array(SymbolKindSchema)
    .optional()
    .describe("Optional filter by symbol kinds: 'function', 'class', 'interface', 'method', 'variable', 'type', 'struct', 'enum', 'trait', 'module', 'other'."),
  exactMatch: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, matches exact symbol name; if false (default), matches substring."),
  filePattern: z
    .string()
    .optional()
    .describe("Glob pattern to filter files, e.g. '*.ts' or '*.{ts,tsx}'."),
  excludePattern: z
    .string()
    .optional()
    .describe("Comma-separated glob patterns to exclude, e.g. '**/node_modules/**,**/dist/**'."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(100)
    .describe("Maximum number of symbols to return (1-500, default: 100)."),
  includeLocals: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include local function/method variables. Default: false (focuses on top-level declarations, classes, interfaces, functions, methods, types)."),
});

export type FindSymbolsParams = z.infer<typeof FindSymbolsSchema>;
