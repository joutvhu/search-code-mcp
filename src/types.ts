import { z } from "zod";

export const SearchTypeSchema = z.enum([
  "regex",
  "text",
  "ast",
  "ast_rule",
  "hybrid",
  "symbol",
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
  searchId: z.string().optional().describe("Previous search result ID to view remaining results instantly without re-scanning"),
  offset: z.number().optional().default(1).describe("Starting index for pagination (1-based, default: 1)"),
  limit: z.number().optional().default(50).describe("Maximum matches to return for this chunk (default: 50)"),

  // Fresh search parameters
  query: z.string().optional().describe("Search query: plain text, regex, AST pattern, or YAML rule"),
  path: z.string().optional().default(".").describe("Directory or file to search in (default: current directory '.')"),
  type: SearchTypeSchema.optional().default("regex").describe("Search engine/type: 'regex' (default), 'text', 'ast', 'ast_rule', 'hybrid', 'symbol'"),

  // File filtering & Gitignore
  filePattern: z.string().optional().describe("Glob pattern to filter files, e.g. '*.{ts,tsx}' or '!**/*.test.ts'"),
  fileType: z.string().optional().describe("Ripgrep file type filter, e.g. 'ts', 'py', 'rust', 'json'"),
  excludePattern: z.string().optional().describe("Pattern to exclude, e.g. '**/dist/**', '**/*.spec.ts'"),
  noIgnore: z.boolean().optional().default(false).describe("If true, do NOT respect .gitignore (search ignored files). Default is false (respects .gitignore)"),

  // Ripgrep options (for 'regex', 'text', 'hybrid')
  caseSensitive: z.boolean().optional().describe("Match case sensitively. If omitted, smart-case is used"),
  context: z.number().optional().describe("Number of context lines before and after match (-C)"),
  wordMatch: z.boolean().optional().describe("Match whole words only (-w)"),
  multiline: z.boolean().optional().describe("Match regex across multiple lines (-U)"),
  includeHidden: z.boolean().optional().describe("Search hidden files and folders (-.)"),

  // ast-grep options (for 'ast', 'ast_rule', 'hybrid', 'symbol')
  language: z.string().optional().describe("Target language (e.g. 'typescript', 'python'). If omitted, auto-detected from file extension"),
  outputFormat: OutputFormatSchema.optional().default("content").describe("Output format: 'content' (default), 'compact' (file:line only), 'files_only', 'json'"),
  maxLineLength: z.number().optional().default(500).describe("Max characters per line before truncating long lines (default: 500)"),
});

export type SearchParams = z.infer<typeof SearchSchema>;

export const ReplaceTypeSchema = z.enum(["ast", "regex", "text"]);
export type ReplaceType = z.infer<typeof ReplaceTypeSchema>;

export const ReplaceSchema = z.object({
  path: z.string().optional().default(".").describe("Directory or file to perform replacement in (default: '.')"),
  query: z.string().describe("Target search pattern to replace (AST pattern or regex)"),
  replacement: z.string().describe("Replacement string or AST rewrite pattern"),
  type: ReplaceTypeSchema.optional().default("ast").describe("Replacement engine: 'ast' (default structural rewrite), 'regex', 'text'"),
  dryRun: z.boolean().optional().default(true).describe("If true (default), outputs unified diff preview without modifying files on disk"),
  maxReplacements: z.number().optional().default(50).describe("Safety guardrail: maximum number of matches to replace (default: 50)"),
  filePattern: z.string().optional().describe("Glob pattern to filter files"),
  fileType: z.string().optional().describe("File type filter"),
  excludePattern: z.string().optional().describe("Glob pattern to exclude"),
  noIgnore: z.boolean().optional().default(false).describe("Whether to search inside gitignored files"),
  language: z.string().optional().describe("Programming language for AST mode (auto-detected if omitted)"),
});

export type ReplaceParams = z.infer<typeof ReplaceSchema>;

export const CountSchema = z.object({
  path: z.string().optional().default(".").describe("Directory or file to count matches in (default: '.')"),
  query: z.string().describe("Search pattern to count"),
  type: z.enum(["regex", "text", "ast"]).optional().default("regex").describe("Engine mode: 'regex' (default), 'text', 'ast'"),
  filePattern: z.string().optional().describe("Glob pattern to filter files"),
  fileType: z.string().optional().describe("File type filter"),
  excludePattern: z.string().optional().describe("Glob pattern to exclude"),
  noIgnore: z.boolean().optional().default(false).describe("Whether to count inside gitignored files"),
  countLines: z.boolean().optional().default(true).describe("Count matching lines (true) or total occurrences (false)"),
  perFile: z.boolean().optional().default(false).describe("If true, shows breakdown of matches per file"),
  language: z.string().optional().describe("Language for AST mode"),
});

export type CountParams = z.infer<typeof CountSchema>;

export const DumpTreeSchema = z.object({
  code: z.string().describe("Code snippet or query pattern to inspect"),
  language: z.string().describe("Programming language of the code (e.g. 'typescript', 'python', 'rust')"),
  format: z.enum(["cst", "ast", "pattern"]).optional().default("cst").describe("Tree dump format: 'cst' (concrete syntax tree), 'ast', or 'pattern'"),
});

export type DumpTreeParams = z.infer<typeof DumpTreeSchema>;

export const ListFilesSchema = z.object({
  path: z.string().optional().default(".").describe("Directory to list files in (default: '.')"),
  filePattern: z.string().optional().describe("Glob pattern to filter files"),
  fileType: z.string().optional().describe("File type filter"),
  excludePattern: z.string().optional().describe("Glob pattern to exclude"),
  noIgnore: z.boolean().optional().default(false).describe("Whether to list gitignored files"),
  includeHidden: z.boolean().optional().default(false).describe("Include hidden files and directories"),
});

export type ListFilesParams = z.infer<typeof ListFilesSchema>;
