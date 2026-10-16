import { runEngineCli } from "./cli/engineManager.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

// Multi-session stability: Ignore SIGINT from Claude Code or Cursor
process.on("SIGINT", () => {
  console.error("Received SIGINT - ignoring for multi-session stability");
});

process.on("SIGTERM", () => {
  console.error("Received SIGTERM - shutting down gracefully");
  process.exit(0);
});

const server = new McpServer({
  name: "search-code-mcp",
  version: "1.0.0",
});

server.registerTool(
  "search",
  {
    description:
      "High-performance unified code search engine combining ripgrep (regex/text) and ast-grep (AST patterns and YAML rules). Supports pagination with searchId and offset/limit for large results.",
    inputSchema: SearchSchema.shape,
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
    description:
      "Structural code refactoring and replacement engine. Supports AST rewrite or Regex/Text replacement. By default, runs in dryRun mode producing a unified diff preview to ensure safe operations before writing changes to disk.",
    inputSchema: ReplaceSchema.shape,
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
    description:
      "Count matching lines or total occurrences of a pattern in files without retrieving match content, saving tokens.",
    inputSchema: CountSchema.shape,
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
    description:
      "Inspect the concrete syntax tree (CST) or AST of code to discover exact node kinds and structure for crafting ast-grep patterns.",
    inputSchema: DumpTreeSchema.shape,
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
    description:
      "Find code symbols (functions, classes, interfaces, methods, types, variables, structs, enums) across the codebase. Automatically selects best available engine: Universal Ctags -> ast-grep -> ripgrep regex heuristic.",
    inputSchema: FindSymbolsSchema.shape,
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
    description:
      "Quickly list files matching glob patterns or file types without scanning contents.",
    inputSchema: ListFilesSchema.shape,
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

import { setWorkspaceRoot, setRelativePaths } from "./utils/paths.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("engine") || args.includes("--engine") || args.includes("doctor")) {
    await runEngineCli();
    process.exit(0);
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--relative-paths" || args[i] === "--relative-path" || args[i] === "--relative-paths=true" || args[i] === "--relative-paths=1") {
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
