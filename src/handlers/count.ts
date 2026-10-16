import { CountParams } from "../types.js";
import { runRipgrepCount } from "../engines/ripgrep.js";
import { runAstGrepPattern } from "../engines/astgrep.js";

export async function handleCount(params: CountParams) {
  if (params.type === "ast") {
    const matches = await runAstGrepPattern({
      path: params.path,
      query: params.query,
      language: params.language,
      noIgnore: params.noIgnore,
    });

    if (params.perFile) {
      const fileCounts: Record<string, number> = {};
      for (const m of matches) {
        fileCounts[m.file] = (fileCounts[m.file] || 0) + 1;
      }

      const lines = Object.entries(fileCounts).map(([f, c]) => `${f}: ${c}`);
      return {
        content: [
          {
            type: "text",
            text: `Found ${matches.length} AST matches across ${Object.keys(fileCounts).length} file(s):\n\n` + lines.join("\n"),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Found ${matches.length} AST match(es).` }],
    };
  }

  // Regex / Text count
  const result = await runRipgrepCount(params);
  if (params.perFile) {
    return {
      content: [
        {
          type: "text",
          text: `Total: ${result.total} match(es):\n\n` + (result.output || "0 matches"),
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: `Found ${result.total} match(es).` }],
  };
}
