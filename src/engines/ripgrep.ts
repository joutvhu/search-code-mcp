import fs from "node:fs";
import path from "node:path";
import { detectTextEngine, safeSpawn } from "../utils/exec.js";
import { stripAnsi, MatchItem } from "../utils/formatters.js";
import { SearchParams, CountParams, ListFilesParams } from "../types.js";

/**
 * Standard output parser for rg, ugrep, and git grep
 */
function parseGrepOutput(cleanOutput: string): MatchItem[] {
  if (!cleanOutput) return [];
  const matches: MatchItem[] = [];
  const lines = cleanOutput.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    // Typical line: "path/to/file.ts:12:content" or "path/to/file.ts:12:34:content"
    const match = line.match(/^((?:[a-zA-Z]:)?[^:]+):(\d+):(?:\d+:)?(.*)$/);
    if (match) {
      matches.push({
        file: match[1],
        startLine: parseInt(match[2], 10),
        content: match[3],
      });
    } else {
      // Context lines: "path/to/file.ts-12-content"
      const ctxMatch = line.match(/^((?:[a-zA-Z]:)?[^:-]+)-(\d+)-(?:(?:\d+)-)?(.*)$/);
      if (ctxMatch) {
        matches.push({
          file: ctxMatch[1],
          startLine: parseInt(ctxMatch[2], 10),
          content: ctxMatch[3],
        });
      }
    }
  }

  return matches;
}

/**
 * 1. ripgrep search implementation
 */
async function runRgSearch(binary: string, params: Partial<SearchParams>): Promise<MatchItem[]> {
  const args: string[] = ["-n", "-H", "--color", "never"];

  if (params.caseSensitive === true) args.push("-s");
  else if (params.caseSensitive === false) args.push("-i");
  if (params.multiline) args.push("-U");
  if (params.type === "text") args.push("-F");
  if (params.wordMatch) args.push("-w");
  if (params.context && params.context > 0) args.push("-C", String(params.context));
  if (params.filePattern) args.push("-g", params.filePattern);
  if (params.fileType) args.push("-t", params.fileType);

  if (params.excludePattern) {
    for (const pat of params.excludePattern.split(",")) {
      const trimmed = pat.trim();
      if (trimmed) args.push("-g", `!${trimmed}`);
    }
  }

  if (params.noIgnore) args.push("--no-ignore");
  if (params.includeHidden) args.push("-.");
  args.push(params.query || "", params.path || ".");

  const result = await safeSpawn(binary, args);
  return parseGrepOutput(stripAnsi(result.stdout).trim());
}

/**
 * 2. ugrep search implementation
 */
async function runUgrepSearch(binary: string, params: Partial<SearchParams>): Promise<MatchItem[]> {
  const args: string[] = ["-n", "-H", "--color=never"];

  if (params.caseSensitive === true) args.push("-s");
  else if (params.caseSensitive === false) args.push("-i");
  if (params.type === "text") args.push("-F");
  else args.push("-P"); // PCRE2 regex
  if (params.wordMatch) args.push("-w");
  if (params.context && params.context > 0) args.push("-C", String(params.context));
  if (params.filePattern) args.push("-g", params.filePattern);

  if (params.excludePattern) {
    for (const pat of params.excludePattern.split(",")) {
      const trimmed = pat.trim();
      if (trimmed) args.push("-g", `!${trimmed}`);
    }
  }

  if (params.noIgnore) args.push("--no-ignore");
  if (params.includeHidden) args.push("-.");
  args.push(params.query || "", params.path || ".");

  const result = await safeSpawn(binary, args);
  return parseGrepOutput(stripAnsi(result.stdout).trim());
}

/**
 * 3. git grep search implementation
 */
async function runGitGrepSearch(binary: string, params: Partial<SearchParams>): Promise<MatchItem[]> {
  const args: string[] = ["grep", "--no-index", "-n", "-I", "--color=never"];

  if (params.caseSensitive === false) args.push("-i");
  if (params.type === "text") args.push("-F");
  else args.push("-E"); // Extended POSIX regex
  if (params.wordMatch) args.push("-w");
  if (params.context && params.context > 0) args.push("-C", String(params.context));
  args.push("-e", params.query || "");

  const targetPath = (params.path && params.path !== ".") ? params.path : "";
  const pathspecs: string[] = [];

  if (params.filePattern) {
    const pattern = targetPath ? `${targetPath.replace(/[/\\]+$/, "")}/${params.filePattern}` : params.filePattern;
    pathspecs.push(pattern);
  } else if (targetPath) {
    pathspecs.push(targetPath);
  }

  if (params.excludePattern) {
    for (const pat of params.excludePattern.split(",")) {
      const trimmed = pat.trim();
      if (trimmed) pathspecs.push(`:!${trimmed}`);
    }
  }

  if (pathspecs.length > 0) {
    args.push("--", ...pathspecs);
  }

  const result = await safeSpawn(binary, args);
  return parseGrepOutput(stripAnsi(result.stdout).trim());
}

/**
 * Unified text search with automatic driver fallback (rg -> ugrep -> git grep)
 */
export async function runRipgrepSearch(params: Partial<SearchParams>): Promise<MatchItem[]> {
  const engine = await detectTextEngine();
  if (engine.name === "git") {
    return runGitGrepSearch(engine.binary, params);
  } else if (engine.name === "ugrep") {
    return runUgrepSearch(engine.binary, params);
  } else {
    return runRgSearch(engine.binary, params);
  }
}

/**
 * Unified count matches (rg -> ugrep -> git grep)
 */
export async function runRipgrepCount(params: Partial<CountParams>): Promise<{ total: number; output: string }> {
  const engine = await detectTextEngine();

  if (engine.name === "git") {
    const args: string[] = ["grep", "--no-index", "-c", "--color=never"];
    if (params.type === "text") args.push("-F");
    else args.push("-E");
    args.push("-e", params.query || "");

    const targetPath = (params.path && params.path !== ".") ? params.path : "";
    const pathspecs: string[] = [];
    if (params.filePattern) {
      const pattern = targetPath ? `${targetPath.replace(/[/\\]+$/, "")}/${params.filePattern}` : params.filePattern;
      pathspecs.push(pattern);
    } else if (targetPath) {
      pathspecs.push(targetPath);
    }

    if (params.excludePattern) {
      for (const pat of params.excludePattern.split(",")) {
        const trimmed = pat.trim();
        if (trimmed) pathspecs.push(`:!${trimmed}`);
      }
    }

    if (pathspecs.length > 0) {
      args.push("--", ...pathspecs);
    }

    const result = await safeSpawn(engine.binary, args);
    const clean = stripAnsi(result.stdout).trim();

    let total = 0;
    for (const line of clean.split("\n")) {
      const parts = line.split(":");
      const count = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(count)) total += count;
    }
    return { total, output: clean };
  }

  // rg or ugrep
  const args: string[] = ["--color", "never"];
  if (params.countLines || engine.name === "ugrep") args.push("-c");
  else args.push("--count-matches");

  if (params.type === "text") args.push("-F");
  if (params.filePattern) args.push("-g", params.filePattern);
  if (params.fileType && engine.name === "rg") args.push("-t", params.fileType);

  if (params.excludePattern) {
    for (const pat of params.excludePattern.split(",")) {
      const trimmed = pat.trim();
      if (trimmed) args.push("-g", `!${trimmed}`);
    }
  }
  if (params.noIgnore) args.push("--no-ignore");

  args.push(params.query || "", params.path || ".");

  const result = await safeSpawn(engine.binary, args);
  const clean = stripAnsi(result.stdout).trim();

  let total = 0;
  for (const line of clean.split("\n")) {
    const parts = line.split(":");
    const count = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(count)) total += count;
  }

  return { total, output: clean };
}

/**
 * Fallback native Node.js recursive file listing
 */
function nativeNodeListFiles(targetDir: string, params: Partial<ListFilesParams>): string[] {
  const fullPath = path.resolve(targetDir || ".");
  if (!fs.existsSync(fullPath)) return [];

  const files: string[] = [];
  function walk(current: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (!params.includeHidden && name.startsWith(".")) continue;
      if (!params.noIgnore && (name === "node_modules" || name === ".git" || name === "dist")) continue;
      const full = path.join(current, name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const rel = path.relative(fullPath, full).replace(/\\/g, "/");
        if (params.filePattern && !rel.includes(params.filePattern.replace(/\*/g, ""))) continue;
        files.push(rel);
      }
    }
  }
  walk(fullPath);
  return files;
}

/**
 * Unified list files (rg -> git ls-files -> native Node fallback)
 */
export async function runRipgrepListFiles(params: Partial<ListFilesParams>): Promise<string[]> {
  try {
    const engine = await detectTextEngine();

    if (engine.name === "rg") {
      const args: string[] = ["--files", "--color", "never"];
      if (params.filePattern) args.push("-g", params.filePattern);
      if (params.fileType) args.push("-t", params.fileType);
      if (params.excludePattern) {
        for (const pat of params.excludePattern.split(",")) {
          const trimmed = pat.trim();
          if (trimmed) args.push("-g", `!${trimmed}`);
        }
      }
      if (params.noIgnore) args.push("--no-ignore");
      if (params.includeHidden) args.push("-.");
      args.push(params.path || ".");

      const result = await safeSpawn(engine.binary, args);
      const clean = stripAnsi(result.stdout).trim();
      if (clean) return clean.split("\n").map((f) => f.trim()).filter(Boolean);
    }

    if (engine.name === "git") {
      const args = ["ls-files", "--cached", "--others"];
      if (!params.noIgnore) args.push("--exclude-standard");
      if (params.path && params.path !== ".") args.push(params.path);

      const result = await safeSpawn(engine.binary, args);
      const clean = stripAnsi(result.stdout).trim();
      if (clean) {
        let list = clean.split("\n").map((f) => f.trim()).filter(Boolean);
        if (params.filePattern) {
          const pat = params.filePattern.replace(/\*/g, "");
          list = list.filter((f) => f.includes(pat));
        }
        return list;
      }
    }
  } catch {
    // If CLI engine fails, seamlessly fall back to native Node
  }

  return nativeNodeListFiles(params.path || ".", params);
}
