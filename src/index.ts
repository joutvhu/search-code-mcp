import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runEngineCli } from "./cli/engineManager.js";
import {
  SearchSchema,
  ReplaceSchema,
  CountSchema,
  DumpTreeSchema,
  ListFilesSchema,
  FindSymbolsSchema,
} from "./types.js";
import { handleSearch } from "./handlers/search.js";
import { handleReplace } from "./handlers/replace.js";
import { handleCount } from "./handlers/count.js";
import { handleDumpTree } from "./handlers/dumpTree.js";
import { handleListFiles } from "./handlers/listFiles.js";
import { handleFindSymbols } from "./handlers/findSymbols.js";
import { setWorkspaceRoot, setRelativePaths } from "./utils/paths.js";

declare const __APP_VERSION__: string | undefined;

function getVersion(): string {
  if (typeof __APP_VERSION__ !== "undefined") {
    return __APP_VERSION__;
  }
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgUrl, "utf8"));
    return pkg.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

const SERVER_INSTRUCTIONS = [
  "Unified code search, symbol lookup, and structural AST refactoring server powered by ripgrep and ast-grep.",
  "If the 'search-code' skill is available in your agent environment, load it first for ast-grep syntax rules, YAML constraints, and non-obvious engine behaviors.",
  "Key usage rules:",
  "- Use 'search' with type='text' for exact strings, 'regex' (default) for patterns, 'ast'/'ast_rule' for syntax-aware queries, and 'hybrid' for AST queries on large repositories.",
  "- Use 'find_symbols' to locate definitions or get a file outline (pass a file path with name='').",
  "- In ast-grep patterns, use $NAME for a single AST node and $$$ARGS for zero or more nodes (there is no $$ syntax). Always pass 'language' when running AST queries on a directory.",
  "- Call 'dump_tree' (format='ast' or 'pattern') before writing complex 'ast_rule' YAML queries when unsure of Tree-sitter node kinds.",
  "- IMPORTANT: 'replace' defaults to type='ast' (unlike 'search' and 'count' which default to 'regex'). Keep dryRun=true first to inspect the unified diff before setting dryRun=false.",
].join("\n");

const server = new McpServer(
  {
    name: "search-code-mcp",
    title: "Search Code MCP",
    version: getVersion(),
    description:
      "High-performance code search, symbol discovery, and structural AST refactoring MCP server combining ripgrep and ast-grep.",
    websiteUrl: "https://github.com/joutvhu/search-code-mcp",
  },
  {
    instructions: SERVER_INSTRUCTIONS,
  }
);

server.registerTool(
  "search",
  {
    title: "Search Code",
    description:
      "Search code across files using ripgrep ('regex' default, 'text'), ast-grep ('ast' pattern, 'ast_rule' YAML rule), or 'hybrid' (ripgrep pre-filter + ast-grep for large repos). Returns paginated results with a 'searchId' when total matches exceed 'limit'. Prefer 'find_symbols' when you want structured symbol tables or a single-file outline, and 'count' when you only need match counts.",
    inputSchema: SearchSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return (await handleSearch(args as any)) as any;
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Search Error: ${err.message || String(err)}` }],
      };
    }
  }
);

server.registerTool(
  "replace",
  {
    title: "Replace / Refactor Code",
    description:
      "Refactor or replace code using structural AST rewrites ('ast', DEFAULT) or regex/literal matching ('regex', 'text'). Runs in dryRun=true by default to return a unified diff preview without modifying files; inspect the diff first, then re-run with dryRun=false to write changes. Capped at maxReplacements (default 50) matches per call. Note: 'regex' mode uses ripgrep for discovery and JavaScript RegExp for replacement.",
    inputSchema: ReplaceSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return (await handleReplace(args as any)) as any;
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Replace Error: ${err.message || String(err)}` }],
      };
    }
  }
);

server.registerTool(
  "count",
  {
    title: "Count Matches",
    description:
      "Count matching lines or occurrences of a regex, literal text, or AST pattern without returning match content. Use before 'search' or 'replace' to gauge blast radius and save context tokens.",
    inputSchema: CountSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return (await handleCount(args as any)) as any;
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Count Error: ${err.message || String(err)}` }],
      };
    }
  }
);

server.registerTool(
  "dump_tree",
  {
    title: "Inspect Syntax Tree",
    description:
      "Inspect the Tree-sitter syntax tree of a short code snippet or pattern via ast-grep. Call this BEFORE writing 'ast_rule' YAML queries (use format='ast' to discover exact node 'kind' names) or when debugging why an 'ast' pattern didn't match (use format='pattern').",
    inputSchema: DumpTreeSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return (await handleDumpTree(args as any)) as any;
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `DumpTree Error: ${err.message || String(err)}` }],
      };
    }
  }
);

server.registerTool(
  "find_symbols",
  {
    title: "Find Symbols",
    description:
      "Locate symbol definitions (functions, classes, interfaces, methods, types, variables, structs, enums, traits, modules) with filtering by 'kinds' and 'exactMatch'. Pass a single file as 'path' with empty 'name' to get a full symbol outline without reading the whole file.",
    inputSchema: FindSymbolsSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return (await handleFindSymbols(args as any)) as any;
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `FindSymbols Error: ${err.message || String(err)}` }],
      };
    }
  }
);

server.registerTool(
  "list_files",
  {
    title: "List Files",
    description:
      "Fast file enumeration matching glob patterns or file types without scanning file contents. Respects .gitignore and excludes hidden files by default.",
    inputSchema: ListFilesSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return (await handleListFiles(args as any)) as any;
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `ListFiles Error: ${err.message || String(err)}` }],
      };
    }
  }
);

async function main() {
  const args = process.argv.slice(2);
  const firstArg = args[0]?.toLowerCase();
  if (firstArg === "engine" || firstArg === "--engine" || firstArg === "doctor") {
    await runEngineCli();
    process.exit(0);
  }

  // Multi-session stability for MCP stdio mode: Ignore SIGINT from clients like Claude Code or Cursor
  process.on("SIGINT", () => {
    console.error("Received SIGINT - ignoring for multi-session stability");
  });

  process.on("SIGTERM", () => {
    console.error("Received SIGTERM - shutting down gracefully");
    process.exit(0);
  });

  for (let i = 0; i < args.length; i++) {
    if (
      args[i] === "--relative-paths" ||
      args[i] === "--relative-path" ||
      args[i] === "--relative-paths=true" ||
      args[i] === "--relative-paths=1"
    ) {
      setRelativePaths(true);
    } else if (args[i] === "--relative-paths=false" || args[i] === "--relative-paths=0") {
      setRelativePaths(false);
    } else if (args[i] === "--root" || args[i] === "--workspace") {
      if (args[i + 1]) {
        setWorkspaceRoot(args[i + 1]);
        i++;
      }
    } else if (args[i].startsWith("--root=")) {
      setWorkspaceRoot(args[i].slice(7));
    } else if (args[i].startsWith("--workspace=")) {
      setWorkspaceRoot(args[i].slice(12));
    } else if (!args[i].startsWith("-")) {
      setWorkspaceRoot(args[i]);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("search-code-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
