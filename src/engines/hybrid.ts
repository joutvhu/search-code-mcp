import { MatchItem } from "../utils/formatters.js";
import { runRipgrepSearch } from "./ripgrep.js";
import { runAstGrepPattern } from "./astgrep.js";
import { SearchParams } from "../types.js";
import { searchSymbols } from "./symbols.js";

/**
 * Extract words/identifiers from an AST pattern to use as coarse filter for ripgrep
 */
function extractKeywords(pattern: string): string[] {
  const words = pattern
    .replace(/\$[A-Z0-9_]+/g, "")
    .replace(/\$\$\$[A-Z0-9_]*/g, "")
    .match(/[a-zA-Z_][a-zA-Z0-9_]{2,}/g);

  return words ? Array.from(new Set(words)) : [];
}

/**
 * 2-tier Hybrid Search:
 * 1. Coarse filter with ripgrep to find candidate files (~30ms)
 * 2. Fine precision parsing with ast-grep only on candidate files
 */
export async function runHybridSearch(params: SearchParams): Promise<MatchItem[]> {
  const query = params.query || "";
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return runAstGrepPattern(params);
  }

  const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0];

  const rgMatches = await runRipgrepSearch({
    ...params,
    query: primaryKeyword,
    type: "text",
  });

  const candidateFiles = Array.from(new Set(rgMatches.map((m) => m.file)));
  if (candidateFiles.length === 0) {
    return [];
  }

  const allMatches: MatchItem[] = [];
  for (const file of candidateFiles) {
    try {
      const fileMatches = await runAstGrepPattern({
        ...params,
        path: file,
      });
      allMatches.push(...fileMatches);
    } catch {
      // Continue with other files if one fails
    }
  }

  return allMatches;
}

/**
 * Multi-engine Symbol Search (ctags -> ast-grep -> ripgrep regex heuristic)
 */
export async function runSymbolSearch(params: SearchParams): Promise<MatchItem[]> {
  const symbol = (params.query || "").trim();
  const { symbols } = await searchSymbols({
    name: symbol,
    path: params.path,
    filePattern: params.filePattern,
    fileType: params.fileType,
    excludePattern: params.excludePattern,
    noIgnore: params.noIgnore,
    exactMatch: params.wordMatch ?? false,
    maxResults: params.limit || 50,
  });

  return symbols.map((s) => ({
    file: s.file,
    startLine: s.line,
    column: s.column,
    content: s.signature || `[${s.kind}] ${s.name}`,
    symbolKind: s.kind,
    symbolName: s.name,
    containerName: s.containerName,
  }));
}
