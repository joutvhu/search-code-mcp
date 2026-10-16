#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  SearchSchema,
  ReplaceSchema,
  CountSchema,
  DumpTreeSchema,
  ListFilesSchema,
} from "./types.js";
import { handleSearch } from "./handlers/search.js";
import { handleReplace } from "./handlers/replace.js";
import { handleCount } from "./handlers/count.js";
import { handleDumpTree } from "./handlers/dumpTree.js";
import { handleListFiles } from "./handlers/listFiles.js";

// Multi-session stability: Ignore SIGINT from Claude Code or Cursor
process.on("SIGINT", () => {
  console.error("Received SIGINT - ignoring for multi-session stability");
});

process.on("SIGTERM", () => {
  console.error("Received SIGTERM - shutting down gracefully");
  process.exit(0);
});

const server = new Server(
  {
    name: "code-search-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register 5 unified tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search",
        description:
          "All-in-one high-performance code search engine. Supports regex, literal text, AST patterns, complex YAML rules, hybrid 2-tier search, and symbol discovery. Automatically respects .gitignore by default and supports instant pagination via searchId for large result sets.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query: plain text, regex, AST pattern (e.g. 'class $NAME', 'fn $NAME($$$)'), or YAML rule",
            },
            path: {
              type: "string",
              description: "Target directory or file (default: '.' workspace root)",
            },
            type: {
              type: "string",
              enum: ["regex", "text", "ast", "ast_rule", "hybrid", "symbol"],
              description:
                "Search mode: 'regex' (default fast regex), 'text' (literal string), 'ast' (structural pattern), 'ast_rule' (YAML relational rule), 'hybrid' (ripgrep filter + ast-grep parse), 'symbol' (function/class/interface definition)",
            },
            searchId: {
              type: "string",
              description: "Optional cached search ID to view next pages without re-scanning files (< 1ms latency)",
            },
            offset: {
              type: "number",
              description: "Pagination starting index (1-based, default: 1)",
            },
            limit: {
              type: "number",
              description: "Number of matches to display per chunk (default: 50)",
            },
            filePattern: {
              type: "string",
              description: "Glob pattern to include, e.g. '*.{ts,tsx}' or '!**/*.test.ts'",
            },
            fileType: {
              type: "string",
              description: "File type filter, e.g. 'ts', 'py', 'rust', 'json'",
            },
            excludePattern: {
              type: "string",
              description: "Comma-separated patterns to exclude, e.g. '**/dist/**, **/*.spec.ts'",
            },
            noIgnore: {
              type: "boolean",
              description: "If true, do NOT respect .gitignore (search ignored files). Default is false (respects .gitignore)",
            },
            caseSensitive: {
              type: "boolean",
              description: "Case-sensitive search (default: smart-case)",
            },
            context: {
              type: "number",
              description: "Number of context lines before and after each match (-C)",
            },
            wordMatch: {
              type: "boolean",
              description: "Match whole words only (-w)",
            },
            multiline: {
              type: "boolean",
              description: "Match regex across line breaks (-U)",
            },
            includeHidden: {
              type: "boolean",
              description: "Search hidden files and folders (-.)",
            },
            language: {
              type: "string",
              description: "Target language for AST/symbol mode (auto-detected from file extension if omitted)",
            },
            outputFormat: {
              type: "string",
              enum: ["content", "compact", "files_only", "json"],
              description: "Output format: 'content' (default), 'compact' (file:line), 'files_only', 'json'",
            },
          },
        },
      },
      {
        name: "replace",
        description:
          "Structural code refactoring and replacement engine. Supports AST rewrite or Regex/Text replacement. By default, runs in dryRun mode producing a unified diff preview to ensure safe operations before writing changes to disk.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Target search pattern to replace (AST pattern or regex)",
            },
            replacement: {
              type: "string",
              description: "Replacement string or AST rewrite pattern",
            },
            path: {
              type: "string",
              description: "Directory or file to perform replacement in (default: '.')",
            },
            type: {
              type: "string",
              enum: ["ast", "regex", "text"],
              description: "Replacement engine: 'ast' (default structural rewrite), 'regex', 'text'",
            },
            dryRun: {
              type: "boolean",
              description: "If true (default), outputs unified diff preview without modifying files on disk",
            },
            maxReplacements: {
              type: "number",
              description: "Safety guardrail: maximum number of matches to replace (default: 50)",
            },
            filePattern: {
              type: "string",
              description: "Glob pattern to filter files",
            },
            fileType: {
              type: "string",
              description: "File type filter",
            },
            excludePattern: {
              type: "string",
              description: "Glob pattern to exclude",
            },
            noIgnore: {
              type: "boolean",
              description: "Whether to search inside gitignored files (default: false)",
            },
            language: {
              type: "string",
              description: "Programming language for AST mode (auto-detected if omitted)",
            },
          },
          required: ["query", "replacement"],
        },
      },
      {
        name: "count",
        description:
          "Count matching lines or total occurrences of a pattern in files without retrieving match content, saving tokens.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search pattern to count",
            },
            path: {
              type: "string",
              description: "Directory or file to count matches in (default: '.')",
            },
            type: {
              type: "string",
              enum: ["regex", "text", "ast"],
              description: "Engine mode: 'regex' (default), 'text', 'ast'",
            },
            countLines: {
              type: "boolean",
              description: "Count matching lines (true) or total occurrences (false)",
            },
            perFile: {
              type: "boolean",
              description: "If true, shows breakdown of matches per file",
            },
            filePattern: {
              type: "string",
              description: "Glob pattern to filter files",
            },
            fileType: {
              type: "string",
              description: "File type filter",
            },
            excludePattern: {
              type: "string",
              description: "Glob pattern to exclude",
            },
            noIgnore: {
              type: "boolean",
              description: "Whether to count inside gitignored files",
            },
            language: {
              type: "string",
              description: "Language for AST mode",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "dump_tree",
        description:
          "Inspect the concrete syntax tree (CST) or AST of code to discover exact node kinds and structure for crafting ast-grep patterns.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Code snippet or pattern to inspect",
            },
            language: {
              type: "string",
              description: "Programming language of the code (e.g. 'typescript', 'python', 'rust')",
            },
            format: {
              type: "string",
              enum: ["cst", "ast", "pattern"],
              description: "Tree dump format: 'cst' (concrete syntax tree), 'ast', or 'pattern'",
            },
          },
          required: ["code", "language"],
        },
      },
      {
        name: "list_files",
        description:
          "Quickly list files matching glob patterns or file types without scanning contents.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory to list files in (default: '.')",
            },
            filePattern: {
              type: "string",
              description: "Glob pattern to filter files",
            },
            fileType: {
              type: "string",
              description: "File type filter",
            },
            excludePattern: {
              type: "string",
              description: "Glob pattern to exclude",
            },
            noIgnore: {
              type: "boolean",
              description: "Whether to list gitignored files (default: false)",
            },
            includeHidden: {
              type: "boolean",
              description: "Include hidden files and directories",
            },
          },
        },
      },
    ],
  };
});

// Dispatch tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = rawArgs || {};

  try {
    switch (name) {
      case "search":
        return await handleSearch(SearchSchema.parse(args));
      case "replace":
        return await handleReplace(ReplaceSchema.parse(args));
      case "count":
        return await handleCount(CountSchema.parse(args));
      case "dump_tree":
        return await handleDumpTree(DumpTreeSchema.parse(args));
      case "list_files":
        return await handleListFiles(ListFilesSchema.parse(args));
      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${error.message || String(error)}` }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("code-search-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
