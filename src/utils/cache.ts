import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface CachedSearchData {
  searchId: string;
  timestamp: number;
  projectPath: string;
  query: string;
  type: string;
  totalMatches: number;
  matches: any[];
}

const CACHE_DIR_NAME = ".cache/search-code";
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

import { resolveTarget } from "./paths.js";

function getCacheDir(projectPath: string): string {
  const { targetPath, basePath } = resolveTarget(projectPath);
  let resolvedBase = basePath;
  try {
    if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isFile()) {
      resolvedBase = targetPath;
    }
  } catch {}
  return path.join(resolvedBase, CACHE_DIR_NAME);
}

/**
 * Ensure the cache directory exists and contains a .gitignore with '*'
 */
function ensureCacheDirWithGitignore(cacheDir: string): void {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const gitignorePath = path.join(cacheDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    try {
      fs.writeFileSync(gitignorePath, "*\n", "utf8");
    } catch {
      // Ignore write errors if read-only
    }
  }
}

/**
 * Generate a unique searchId
 */
export function generateSearchId(): string {
  return `s_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Save search results to project-scoped cache
 */
export function saveSearchCache(
  projectPath: string,
  searchId: string,
  matches: any[],
  queryInfo: { query: string; type: string }
): void {
  try {
    const cacheDir = getCacheDir(projectPath);
    ensureCacheDirWithGitignore(cacheDir);

    const cacheFile = path.join(cacheDir, `${searchId}.json`);
    const data: CachedSearchData = {
      searchId,
      timestamp: Date.now(),
      projectPath: path.resolve(projectPath || "."),
      query: queryInfo.query,
      type: queryInfo.type,
      totalMatches: matches.length,
      matches,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data), "utf8");

    // Clean old caches asynchronously
    cleanExpiredCache(projectPath, DEFAULT_TTL_MS);
  } catch (err) {
    console.error("Failed to write search cache:", err);
  }
}

/**
 * Read a paginated slice from search cache
 */
export function readSearchCache(
  projectPath: string,
  searchId: string,
  offset: number = 1,
  limit: number = 50
): { chunk: any[]; totalMatches: number; hasMore: boolean; nextOffset: number } | null {
  try {
    const cacheDir = getCacheDir(projectPath);
    const cacheFile = path.join(cacheDir, `${searchId}.json`);

    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const content = fs.readFileSync(cacheFile, "utf8");
    const data: CachedSearchData = JSON.parse(content);

    const startIndex = Math.max(0, offset - 1);
    const endIndex = startIndex + limit;
    const chunk = data.matches.slice(startIndex, endIndex);
    const hasMore = endIndex < data.totalMatches;
    const nextOffset = endIndex + 1;

    return {
      chunk,
      totalMatches: data.totalMatches,
      hasMore,
      nextOffset,
    };
  } catch (err) {
    console.error(`Failed to read search cache '${searchId}':`, err);
    return null;
  }
}

/**
 * Clean cache files older than TTL
 */
export function cleanExpiredCache(projectPath: string, ttlMs: number = DEFAULT_TTL_MS): void {
  try {
    const cacheDir = getCacheDir(projectPath);
    if (!fs.existsSync(cacheDir)) return;

    const now = Date.now();
    const files = fs.readdirSync(cacheDir);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(cacheDir, file);
      try {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > ttlMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Skip busy files
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}
