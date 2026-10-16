import { SearchParams } from "../types.js";
import { runRipgrepSearch } from "../engines/ripgrep.js";
import { runAstGrepPattern, runAstGrepRule } from "../engines/astgrep.js";
import { runHybridSearch, runSymbolSearch } from "../engines/hybrid.js";
import { formatMatchItems, MatchItem } from "../utils/formatters.js";
import { validateYamlRule } from "../utils/validation.js";
import {
  generateSearchId,
  readSearchCache,
  saveSearchCache,
} from "../utils/cache.js";

export async function handleSearch(params: SearchParams) {
  const projectPath = params.path || ".";

  // 1. Pagination from Cache
  if (params.searchId) {
    const cached = readSearchCache(
      projectPath,
      params.searchId,
      params.offset || 1,
      params.limit || 50
    );

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
      params.maxLineLength,
      {
        searchId: params.searchId,
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
    case "symbol":
      matches = await runSymbolSearch(params);
      break;
    default:
      matches = await runRipgrepSearch(params);
  }

  const limit = params.limit || 50;
  const totalMatches = matches.length;

  // On-demand caching if results exceed limit
  if (totalMatches > limit) {
    const searchId = generateSearchId();
    saveSearchCache(projectPath, searchId, matches, {
      query: params.query,
      type: params.type || "regex",
    });

    const chunk = matches.slice(0, limit);
    const formatted = formatMatchItems(
      chunk,
      totalMatches,
      params.outputFormat,
      params.maxLineLength,
      {
        searchId,
        nextOffset: limit + 1,
        hasMore: true,
      }
    );

    return {
      content: [{ type: "text", text: formatted }],
    };
  }

  // Standard direct response (0 cache files created)
  const formatted = formatMatchItems(
    matches,
    totalMatches,
    params.outputFormat,
    params.maxLineLength
  );

  return {
    content: [{ type: "text", text: formatted }],
  };
}
