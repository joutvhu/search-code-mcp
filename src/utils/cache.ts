import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTarget, findProjectRoot, getWorkspaceRoot } from "./paths.js";

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
const SEARCH_ID_REGEX = /^s_[0-9a-f]{8,}$/i;

function getCacheDir(projectPath: string): string {
  const { targetPath, basePath } = resolveTarget(projectPath);
  const root = findProjectRoot(targetPath || basePath);
  return path.join(root, CACHE_DIR_NAME);
}

function getCandidateCacheDirs(projectPath?: string): string[] {
  const dirs = new Set<string>();
  if (projectPath) {
    dirs.add(getCacheDir(projectPath));
  }
  dirs.add(path.join(findProjectRoot(getWorkspaceRoot()), CACHE_DIR_NAME));
  dirs.add(path.join(getWorkspaceRoot(), CACHE_DIR_NAME));
  return Array.from(dirs);
}

export function isValidSearchId(searchId: string): boolean {
  return SEARCH_ID_REGEX.test(searchId);
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
  if (!isValidSearchId(searchId)) return;

  try {
    const cacheDir = getCacheDir(projectPath);
    ensureCacheDirWithGitignore(cacheDir);

    const cacheFile = path.join(cacheDir, `${searchId}.json`);
    const data: CachedSearchData = {
      searchId,
      timestamp: Date.now(),
      projectPath: resolveTarget(projectPath).targetPath,
      query: queryInfo.query,
      type: queryInfo.type,
      totalMatches: matches.length,
      matches,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data), "utf8");

    // Clean old caches
    cleanExpiredCache(cacheDir, DEFAULT_TTL_MS);
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
  if (!isValidSearchId(searchId)) {
    return null;
  }

  for (const cacheDir of getCandidateCacheDirs(projectPath)) {
    const cacheFile = path.join(cacheDir, `${searchId}.json`);
    if (!fs.existsSync(cacheFile)) continue;

    try {
      const content = fs.readFileSync(cacheFile, "utf8");
      const data: CachedSearchData = JSON.parse(content);

      if (typeof data.timestamp === "number" && Date.now() - data.timestamp > DEFAULT_TTL_MS) {
        try {
          fs.unlinkSync(cacheFile);
        } catch {}
        return null;
      }

      const safeOffset = Math.max(1, Math.floor(offset));
      const safeLimit = Math.max(1, Math.floor(limit));
      const startIndex = safeOffset - 1;
      const endIndex = startIndex + safeLimit;
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

  return null;
}

/**
 * Clean cache files older than TTL
 */
export function cleanExpiredCache(cacheDirOrProjectPath: string, ttlMs: number = DEFAULT_TTL_MS): void {
  try {
    const cacheDir = cacheDirOrProjectPath.endsWith(path.normalize(CACHE_DIR_NAME))
      ? cacheDirOrProjectPath
      : getCacheDir(cacheDirOrProjectPath);
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
