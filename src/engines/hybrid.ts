import { MatchItem } from "../utils/formatters.js";
import { runRipgrepFilesWithMatches } from "./ripgrep.js";
import { runAstGrepPattern, FILE_TYPE_GLOBS } from "./astgrep.js";
import { SearchParams } from "../types.js";

const AST_BATCH_SIZE = 50;

/**
 * Extract words/identifiers from an AST pattern to use as coarse filter for ripgrep
 */
function extractKeywords(pattern: string): string[] {
  const words = pattern
    .replace(/\$\$\$[A-Z0-9_]*/g, "")
    .replace(/\$[A-Z0-9_]+/g, "")
    .match(/[a-zA-Z_][a-zA-Z0-9_]{2,}/g);

  return words ? Array.from(new Set(words)) : [];
}

/**
 * 2-tier Hybrid Search:
 * 1. Coarse filter with ripgrep to find candidate files (~30ms)
 * 2. Fine precision parsing with ast-grep in batches on candidate files
 */
export async function runHybridSearch(params: SearchParams): Promise<MatchItem[]> {
  const query = params.query || "";
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return runAstGrepPattern(params);
  }

  const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0];

  let filePattern = params.filePattern;
  if (!filePattern && params.language) {
    const mapped = FILE_TYPE_GLOBS[params.language.toLowerCase()];
    if (mapped) {
      filePattern = mapped;
    }
  }

  const candidateFiles = await runRipgrepFilesWithMatches({
    ...params,
    query: primaryKeyword,
    type: "text",
    filePattern,
    context: undefined,
  });

  if (candidateFiles.length === 0) {
    return [];
  }

  const allMatches: MatchItem[] = [];
  for (let i = 0; i < candidateFiles.length; i += AST_BATCH_SIZE) {
    const batch = candidateFiles.slice(i, i + AST_BATCH_SIZE);
    const batchMatches = await runAstGrepPattern({
      ...params,
      paths: batch,
    });
    allMatches.push(...batchMatches);
  }

  return allMatches;
}
