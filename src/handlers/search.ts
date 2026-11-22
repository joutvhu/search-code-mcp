import { SearchParams } from "../types.js";
import { runRipgrepSearch } from "../engines/ripgrep.js";
import { runAstGrepPattern, runAstGrepRule } from "../engines/astgrep.js";
import { runHybridSearch } from "../engines/hybrid.js";
import { formatMatchItems, MatchItem } from "../utils/formatters.js";
import { validateYamlRule } from "../utils/validation.js";
import {
  generateSearchId,
  readSearchCache,
  saveSearchCache,
} from "../utils/cache.js";

const DEFAULT_MAX_LINE_LENGTH = 500;

export async function handleSearch(params: SearchParams) {
  const projectPath = params.path || ".";
  const offset = Math.max(1, Math.floor(params.offset || 1));
  const limit = Math.max(1, Math.floor(params.limit || 50));

  // 1. Pagination from Cache
  if (params.searchId) {
    const cached = readSearchCache(projectPath, params.searchId, offset, limit);

    if (!cached) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Search session '${params.searchId}' expired or not found. Please run your search query again.`,
          },
        ],
      };
    }

    const formatted = formatMatchItems(
      cached.chunk,
      cached.totalMatches,
      params.outputFormat,
      DEFAULT_MAX_LINE_LENGTH,
      {
        searchId: params.searchId,
        offset,
        nextOffset: cached.nextOffset,
        hasMore: cached.hasMore,
      }
    );

    return {
      content: [{ type: "text", text: formatted }],
    };
  }

  // 2. Fresh Search
  if (!params.query) {
    return {
      isError: true,
      content: [{ type: "text", text: "Error: 'query' parameter is required for a new search." }],
    };
  }

  // Early YAML validation for ast_rule
  if (params.type === "ast_rule") {
    const val = validateYamlRule(params.query);
    if (!val.valid) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${val.error}` }],
      };
    }
  }

  let matches: MatchItem[] = [];

  switch (params.type) {
    case "text":
    case "regex":
      matches = await runRipgrepSearch(params);
      break;
    case "ast":
      matches = await runAstGrepPattern(params);
      break;
    case "ast_rule":
      matches = await runAstGrepRule(params);
      break;
    case "hybrid":
      matches = await runHybridSearch(params);
      break;
    default:
      matches = await runRipgrepSearch(params);
  }

  // Deduplicate by file when files_only format is requested so pagination pages through files
  if (params.outputFormat === "files_only") {
    const seen = new Set<string>();
    const uniqueFileMatches: MatchItem[] = [];
    for (const m of matches) {
      if (!seen.has(m.file)) {
        seen.add(m.file);
        uniqueFileMatches.push({
          file: m.file,
          startLine: m.startLine,
          content: m.file,
        });
      }
    }
    matches = uniqueFileMatches;
  }

  const totalMatches = matches.length;
  const startIndex = offset - 1;
  const endIndex = startIndex + limit;
  const chunk = matches.slice(startIndex, endIndex);
  const hasMore = endIndex < totalMatches;

  // On-demand caching if results exceed current window or pagination is needed
  if (totalMatches > limit || offset > 1) {
    const searchId = generateSearchId();
    const saved = saveSearchCache(projectPath, searchId, matches, {
      query: params.query,
      type: params.type || "regex",
    });

    const formatted = formatMatchItems(
      chunk,
      totalMatches,
      params.outputFormat,
      DEFAULT_MAX_LINE_LENGTH,
      saved
        ? {
            searchId,
            offset,
            nextOffset: endIndex + 1,
            hasMore,
          }
        : undefined
    );

    return {
      content: [{ type: "text", text: formatted }],
    };
  }

  // Standard direct response (0 cache files created)
  const formatted = formatMatchItems(
    chunk,
    totalMatches,
    params.outputFormat,
    DEFAULT_MAX_LINE_LENGTH
  );

  return {
    content: [{ type: "text", text: formatted }],
  };
}
