import { MatchItem } from "../utils/formatters.js";
import { runRipgrepSearch } from "./ripgrep.js";
import { runAstGrepPattern, runAstGrepRule } from "./astgrep.js";
import { SearchParams } from "../types.js";

/**
 * Extract words/identifiers from an AST pattern to use as coarse filter for ripgrep
 */
function extractKeywords(pattern: string): string[] {
  // Extract words that are not meta-variables ($NAME, $$$ARGS) and not punctuation
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

  // If no substantial keywords can be extracted, fallback to standard AST search
  if (keywords.length === 0) {
    return runAstGrepPattern(params);
  }

  // Pick the longest keyword as the primary coarse filter
  const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0];

  // Step 1: Ripgrep candidate file discovery
  const rgMatches = await runRipgrepSearch({
    ...params,
    query: primaryKeyword,
    type: "text",
  });

  const candidateFiles = Array.from(new Set(rgMatches.map((m) => m.file)));
  if (candidateFiles.length === 0) {
    return [];
  }

  // Step 2: ast-grep scan on candidate files
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
 * Symbol Search: Automatically resolves function/class/interface/type declaration
 */
export async function runSymbolSearch(params: SearchParams): Promise<MatchItem[]> {
  const symbol = (params.query || "").trim();
  const lang = params.language || "typescript";

  // Build a generic AST rule targeting declarations having the symbol name
  const ruleYaml = `
id: find-symbol-${symbol.toLowerCase()}
language: ${lang}
rule:
  any:
    - pattern: "function ${symbol}($SS$)"
    - pattern: "class ${symbol} { $$$ }"
    - pattern: "class ${symbol} extends $BASE { $$$ }"
    - pattern: "interface ${symbol} { $$$ }"
    - pattern: "type ${symbol} = $TYPE"
    - pattern: "const ${symbol} = $VALUE"
    - pattern: "let ${symbol} = $VALUE"
    - pattern: "enum ${symbol} { $$$ }"
    - pattern: "def ${symbol}($SS$):"
    - pattern: "fn ${symbol}($SS$)"
`;

  return runAstGrepRule({
    ...params,
    query: ruleYaml,
    type: "ast_rule",
  });
}
