import { resolveBinary, safeSpawn } from "../utils/exec.js";
import { stripAnsi, MatchItem } from "../utils/formatters.js";
import { SearchParams, CountParams, ListFilesParams } from "../types.js";

/**
 * Execute ripgrep search and parse output lines into structured MatchItems
 */
export async function runRipgrepSearch(params: Partial<SearchParams>): Promise<MatchItem[]> {
  const binary = resolveBinary("rg");
  const args: string[] = ["-n", "-H", "--color", "never"];

  // Case sensitivity
  if (params.caseSensitive === true) args.push("-s");
  else if (params.caseSensitive === false) args.push("-i");

  // Multiline
  if (params.multiline) args.push("-U");

  // Literal / fixed strings
  if (params.type === "text") args.push("-F");

  // Whole word match
  if (params.wordMatch) args.push("-w");

  // Context lines
  if (params.context && params.context > 0) args.push("-C", String(params.context));

  // File globs & types
  if (params.filePattern) args.push("-g", params.filePattern);
  if (params.fileType) args.push("-t", params.fileType);

  // Exclude pattern
  if (params.excludePattern) {
    for (const pat of params.excludePattern.split(",")) {
      const trimmed = pat.trim();
      if (trimmed) args.push("-g", `!${trimmed}`);
    }
  }

  // Gitignore handling: default is to respect gitignore. If noIgnore is true, pass --no-ignore
  if (params.noIgnore) args.push("--no-ignore");

  // Include hidden files
  if (params.includeHidden) args.push("-.");

  // Query & Path
  args.push(params.query || "", params.path || ".");

  const result = await safeSpawn(binary, args);
  const cleanOutput = stripAnsi(result.stdout).trim();
  if (!cleanOutput) return [];

  const matches: MatchItem[] = [];
  const lines = cleanOutput.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    // Typical ripgrep line: "path/to/file.ts:12:line content"
    // Handle Windows drive colon: "C:\path\to\file.ts:12:line content"
    const match = line.match(/^((?:[a-zA-Z]:)?[^:]+):(\d+):(.*)$/);
    if (match) {
      matches.push({
        file: match[1],
        startLine: parseInt(match[2], 10),
        content: match[3],
      });
    } else {
      // For context lines or non-standard format
      const ctxMatch = line.match(/^((?:[a-zA-Z]:)?[^:-]+)-(\d+)-(.*)$/);
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
 * Execute ripgrep count matches
 */
export async function runRipgrepCount(params: Partial<CountParams>): Promise<{ total: number; output: string }> {
  const binary = resolveBinary("rg");
  const args: string[] = ["--color", "never"];

  if (params.countLines) args.push("-c");
  else args.push("--count-matches");

  if (params.type === "text") args.push("-F");
  if (params.filePattern) args.push("-g", params.filePattern);
  if (params.fileType) args.push("-t", params.fileType);
  if (params.excludePattern) {
    for (const pat of params.excludePattern.split(",")) {
      const trimmed = pat.trim();
      if (trimmed) args.push("-g", `!${trimmed}`);
    }
  }
  if (params.noIgnore) args.push("--no-ignore");

  args.push(params.query || "", params.path || ".");

  const result = await safeSpawn(binary, args);
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
 * Execute ripgrep list files
 */
export async function runRipgrepListFiles(params: Partial<ListFilesParams>): Promise<string[]> {
  const binary = resolveBinary("rg");
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

  const result = await safeSpawn(binary, args);
  const clean = stripAnsi(result.stdout).trim();
  if (!clean) return [];

  return clean.split("\n").map((f) => f.trim()).filter(Boolean);
}
