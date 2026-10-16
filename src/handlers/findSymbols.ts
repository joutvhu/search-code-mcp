import { FindSymbolsParams, SymbolItem } from "../types.js";
import { searchSymbols } from "../engines/symbols.js";
import { truncateLine } from "../utils/formatters.js";

/**
 * Handle find_symbols tool request
 */
export async function handleFindSymbols(params: FindSymbolsParams) {
  const { symbols, engine } = await searchSymbols(params);

  if (symbols.length === 0) {
    const hint = params.name ? `matching '${params.name}'` : "";
    return {
      content: [
        {
          type: "text",
          text: `No symbols found ${hint} in '${params.path || "."}' (Engine: ${engine}).`,
        },
      ],
    };
  }

  // 1. JSON output format
  if (params.outputFormat === "json") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              engine,
              totalSymbols: symbols.length,
              symbols,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // 2. Compact output format
  if (params.outputFormat === "compact") {
    const lines = symbols.map((s) => {
      const sig = s.signature ? `: ${truncateLine(s.signature, 80)}` : "";
      return `${s.file}:${s.line}: [${s.kind}] ${s.name}${sig}`;
    });
    return {
      content: [
        {
          type: "text",
          text: `Found ${symbols.length} symbols (Engine: ${engine}):\n\n${lines.join("\n")}`,
        },
      ],
    };
  }

  // 3. Table output format (default markdown table)
  const rows = symbols.map((s) => {
    const loc = `${s.file}:${s.line}`;
    const scope = s.containerName ? ("`" + s.containerName + "`") : "-";
    const sig = s.signature ? ("`" + truncateLine(s.signature.replace(/\|/g, "\\|"), 60) + "`") : "-";
    return `| \`${s.name}\` | \`${s.kind}\` | ${loc} | ${scope} | ${sig} |`;
  });

  const tableHeader = [
    `Found ${symbols.length} symbols (Engine: ${engine}):`,
    "",
    "| Name | Kind | Location | Scope | Signature |",
    "| :--- | :--- | :--- | :--- | :--- |",
    ...rows,
  ].join("\n");

  return {
    content: [{ type: "text", text: tableHeader }],
  };
}
