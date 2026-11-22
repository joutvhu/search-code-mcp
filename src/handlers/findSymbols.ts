import { FindSymbolsParams } from "../types.js";
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

  const lines = symbols.map((s) => {
    const scope = s.containerName ? ` (${s.containerName})` : "";
    const sig = s.signature ? `: ${truncateLine(s.signature, 100)}` : "";
    return `${s.file}:${s.line}: [${s.kind}] ${s.name}${scope}${sig}`;
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
