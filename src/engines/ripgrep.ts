import fs from "node:fs";
import path from "node:path";
import { detectTextEngine, safeSpawn } from "../utils/exec.js";
import { stripAnsi, MatchItem } from "../utils/formatters.js";
import { SearchParams, CountParams, ListFilesParams } from "../types.js";
import {
  resolveTarget,
  toRelativePath,
  formatOutputPath,
  globToRegExp,
  splitGlobList,
} from "../utils/paths.js";

interface ActiveMatch {
  item: MatchItem;
  lastLine: number;
  contextAfterCount: number;
}

/**
 * Parse ripgrep --json output unambiguously.
 * When context lines are present, they are attached to their corresponding match
 * instead of being counted as independent matches.
 */
function parseRgJsonOutput(stdout: string, basePath?: string, requestedContext: number = 0): MatchItem[] {
  if (!stdout) return [];
  const matches: MatchItem[] = [];
  let pendingContextBefore: Array<{ line: number; text: string }> = [];
  let lastMatch: ActiveMatch | null = null;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("{")) continue;

    try {
      const event = JSON.parse(line);
      if (event.type === "begin" || event.type === "end") {
        pendingContextBefore = [];
        lastMatch = null;
        continue;
      }

      if (event.type !== "match" && event.type !== "context") continue;

      const data = event.data;
      const fileText: string | undefined = data?.path?.text;
      if (!fileText) continue;

      const lineNumber: number = data.line_number ?? 1;
      const rawText: string =
        typeof data.lines?.text === "string"
          ? data.lines.text.replace(/\r?\n$/, "")
          : "";

      if (event.type === "context") {
        if (
          lastMatch &&
          requestedContext > 0 &&
          lineNumber === lastMatch.lastLine + 1 &&
          lastMatch.contextAfterCount < requestedContext
        ) {
          lastMatch.item.content += `\n  ${lineNumber}- ${rawText}`;
          lastMatch.lastLine = lineNumber;
          lastMatch.contextAfterCount++;
        } else {
          lastMatch = null;
        }

        if (requestedContext > 0) {
          pendingContextBefore.push({ line: lineNumber, text: rawText });
          if (pendingContextBefore.length > requestedContext) {
            pendingContextBefore.shift();
          }
        }
      } else if (event.type === "match") {
        const lineCount = rawText.includes("\n") ? rawText.split("\n").length : 1;
        const endLine = lineCount > 1 ? lineNumber + lineCount - 1 : lineNumber;
        let content = "";
        if (requestedContext > 0 && pendingContextBefore.length > 0) {
          content = pendingContextBefore.map((c) => `  ${c.line}- ${c.text}`).join("\n") + "\n";
        }
        pendingContextBefore = [];

        if (requestedContext > 0) {
          content += `> ${lineNumber}: ${rawText}`;
        } else {
          content = rawText;
        }

        const matchItem: MatchItem = {
          file: formatOutputPath(fileText, basePath),
          startLine: lineNumber,
          ...(lineCount > 1 ? { endLine } : {}),
          content,
        };
        matches.push(matchItem);
        lastMatch = { item: matchItem, lastLine: endLine, contextAfterCount: 0 };
      }
    } catch {
      // Skip malformed JSON line
    }
  }

  return matches;
}

/**
 * Standard output parser for ugrep and git grep.
 * Attaches context lines to matches cleanly.
 */
function parseGrepOutput(cleanOutput: string, basePath?: string, requestedContext: number = 0): MatchItem[] {
  if (!cleanOutput) return [];
  const matches: MatchItem[] = [];
  const lines = cleanOutput.split(/\r?\n/);

  let pendingContextBefore: Array<{ line: number; text: string }> = [];
  let lastMatch: ActiveMatch | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^((?:[a-zA-Z]:)?[^:\n]+):(\d+):(?:\d+:)?(.*)$/);
    if (match) {
      const file = formatOutputPath(match[1], basePath);
      const startLine = parseInt(match[2], 10);
      const rawText = match[3];

      let content = "";
      if (requestedContext > 0 && pendingContextBefore.length > 0) {
        content = pendingContextBefore.map((c) => `  ${c.line}- ${c.text}`).join("\n") + "\n";
      }
      pendingContextBefore = [];

      if (requestedContext > 0) {
        content += `> ${startLine}: ${rawText}`;
      } else {
        content = rawText;
      }

      const matchItem: MatchItem = {
        file,
        startLine,
        content,
      };
      matches.push(matchItem);
      lastMatch = { item: matchItem, lastLine: startLine, contextAfterCount: 0 };
    } else {
      const ctxMatch = line.match(/^((?:[a-zA-Z]:)?[^:\n]+?)-(\d+)-(?:(?:\d+)-)?(.*)$/);
      if (ctxMatch) {
        const lineNum = parseInt(ctxMatch[2], 10);
        const text = ctxMatch[3];
        if (
          lastMatch &&
          requestedContext > 0 &&
          lineNum === lastMatch.lastLine + 1 &&
          lastMatch.contextAfterCount < requestedContext
        ) {
          lastMatch.item.content += `\n  ${lineNum}- ${text}`;
          lastMatch.lastLine = lineNum;
          lastMatch.contextAfterCount++;
        } else {
          lastMatch = null;
        }

        if (requestedContext > 0) {
          pendingContextBefore.push({ line: lineNum, text });
          if (pendingContextBefore.length > requestedContext) {
            pendingContextBefore.shift();
          }
        }
      }
    }
  }

  return matches;
}

/**
 * 1. ripgrep search implementation (uses --json for unambiguous path/context parsing)
 */
async function runRgSearch(binary: string, params: Partial<SearchParams>): Promise<MatchItem[]> {
  const { targetPath, basePath } = resolveTarget(params.path);
  const args: string[] = ["--json"];

  if (params.caseSensitive === true) args.push("-s");
  else if (params.caseSensitive === false) args.push("-i");
  else args.push("-S"); // Smart-case when caseSensitive is omitted

  if (params.multiline) args.push("-U");
  if (params.type === "text") args.push("-F");
  if (params.wordMatch) args.push("-w");
  const ctx = params.context ?? 0;
  if (ctx > 0) args.push("-C", String(ctx));

  if (params.filePattern) {
    for (const pat of splitGlobList(params.filePattern)) {
      args.push("-g", pat);
    }
  }

  if (params.excludePattern) {
    for (const pat of splitGlobList(params.excludePattern)) {
      args.push("-g", pat.startsWith("!") ? pat : `!${pat}`);
    }
  }

  if (params.noIgnore) args.push("--no-ignore");
  if (params.includeHidden) {
    args.push("-.");
    if (!params.noIgnore) {
      args.push("-g", "!.git/**", "-g", "!.git");
    }
  }
  args.push("-e", params.query || "", "--", targetPath);

  const result = await safeSpawn(binary, args, undefined, basePath);
  return parseRgJsonOutput(result.stdout, basePath, ctx);
}

/**
 * 2. ugrep search implementation
 */
async function runUgrepSearch(binary: string, params: Partial<SearchParams>): Promise<MatchItem[]> {
  const { targetPath, basePath } = resolveTarget(params.path);
  const args: string[] = ["-n", "-H", "--color=never"];

  if (params.caseSensitive === true) args.push("-s");
  else if (params.caseSensitive === false) args.push("-i");
  else args.push("-j"); // ugrep smart-case

  if (params.type === "text") args.push("-F");
  else args.push("-P"); // PCRE2 regex
  if (params.wordMatch) args.push("-w");
  const ctx = params.context ?? 0;
  if (ctx > 0) args.push("-C", String(ctx));

  if (params.filePattern) {
    for (const pat of splitGlobList(params.filePattern)) {
      args.push("-g", pat);
    }
  }

  if (params.excludePattern) {
    for (const pat of splitGlobList(params.excludePattern)) {
      args.push("-g", pat.startsWith("!") ? pat : `!${pat}`);
    }
  }

  if (params.noIgnore) args.push("--no-ignore");
  if (params.includeHidden) {
    args.push("-.");
    if (!params.noIgnore) {
      args.push("-g", "!.git/**", "-g", "!.git");
    }
  }
  args.push("-e", params.query || "", "--", targetPath);

  const result = await safeSpawn(binary, args, undefined, basePath);
  return parseGrepOutput(stripAnsi(result.stdout).trim(), basePath, ctx);
}

/**
 * 3. git grep search implementation
 */
async function runGitGrepSearch(binary: string, params: Partial<SearchParams>): Promise<MatchItem[]> {
  const { targetPath, basePath } = resolveTarget(params.path);
  const query = params.query || "";
  const args: string[] = ["grep", "--no-index", "-n", "-I", "--color=never"];
  if (!params.noIgnore) args.push("--exclude-standard");

  if (params.caseSensitive === false || (params.caseSensitive === undefined && !/[A-Z]/.test(query))) {
    args.push("-i");
  }
  if (params.type === "text") args.push("-F");
  else args.push("-E");
  if (params.wordMatch) args.push("-w");
  const ctx = params.context ?? 0;
  if (ctx > 0) args.push("-C", String(ctx));
  args.push("-e", query);

  const relTarget = toRelativePath(targetPath, basePath);
  const pathspecs: string[] = [];

  if (params.filePattern) {
    for (const pat of splitGlobList(params.filePattern)) {
      const pattern =
        relTarget && relTarget !== "."
          ? `${relTarget.replace(/[/\\]+$/, "")}/${pat}`
          : pat;
      pathspecs.push(pattern);
    }
  } else if (relTarget && relTarget !== ".") {
    pathspecs.push(relTarget);
  }

  if (params.excludePattern) {
    for (const pat of splitGlobList(params.excludePattern)) {
      pathspecs.push(pat.startsWith(":") ? pat : `:!${pat.replace(/^!/, "")}`);
    }
  }

  if (pathspecs.length > 0) {
    args.push("--", ...pathspecs);
  }

  const result = await safeSpawn(binary, args, undefined, basePath);
  return parseGrepOutput(stripAnsi(result.stdout).trim(), basePath, ctx);
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
 * Fast file discovery returning candidate files containing a keyword (rg -l / git grep -l)
 */
export async function runRipgrepFilesWithMatches(
  params: Partial<SearchParams>
): Promise<string[]> {
  const engine = await detectTextEngine();
  const { targetPath, basePath } = resolveTarget(params.path);

  if (engine.name === "rg") {
    const args: string[] = ["-l", "--color=never"];
    if (params.type === "text") args.push("-F");
    if (params.caseSensitive === true) args.push("-s");
    else if (params.caseSensitive === false) args.push("-i");
    else args.push("-S");

    if (params.multiline) args.push("-U");

    if (params.filePattern) {
      for (const pat of splitGlobList(params.filePattern)) {
        args.push("-g", pat);
      }
    }

    if (params.excludePattern) {
      for (const pat of splitGlobList(params.excludePattern)) {
        args.push("-g", pat.startsWith("!") ? pat : `!${pat}`);
      }
    }
    if (params.noIgnore) args.push("--no-ignore");
    if (params.includeHidden) {
      args.push("-.");
      if (!params.noIgnore) {
        args.push("-g", "!.git/**", "-g", "!.git");
      }
    }
    args.push("-e", params.query || "", "--", targetPath);

    const result = await safeSpawn(engine.binary, args, undefined, basePath);
    const clean = stripAnsi(result.stdout).trim();
    if (!clean) return [];
    return clean
      .split(/\r?\n/)
      .map((f) => formatOutputPath(f.trim(), basePath))
      .filter(Boolean);
  }

  // Fallback for ugrep / git grep: run search and take unique files
  const matches = await runRipgrepSearch({ ...params, context: 0 });
  return Array.from(new Set(matches.map((m) => m.file)));
}

/**
 * Unified count matches (rg -> ugrep -> git grep)
 */
export async function runRipgrepCount(params: Partial<CountParams>): Promise<{ total: number; output: string }> {
  const engine = await detectTextEngine();
  const { targetPath, basePath } = resolveTarget(params.path);

  if (engine.name === "git") {
    const args: string[] = ["grep", "--no-index", "-c", "--color=never"];
    if (!params.noIgnore) args.push("--exclude-standard");
    if (params.caseSensitive === false || (params.caseSensitive === undefined && !/[A-Z]/.test(params.query || ""))) {
      args.push("-i");
    }
    if (params.type === "text") args.push("-F");
    else args.push("-E");
    args.push("-e", params.query || "");

    const relTarget = toRelativePath(targetPath, basePath);
    const pathspecs: string[] = [];
    if (params.filePattern) {
      for (const pat of splitGlobList(params.filePattern)) {
        const pattern =
          relTarget && relTarget !== "."
            ? `${relTarget.replace(/[/\\]+$/, "")}/${pat}`
            : pat;
        pathspecs.push(pattern);
      }
    } else if (relTarget && relTarget !== ".") {
      pathspecs.push(relTarget);
    }

    if (params.excludePattern) {
      for (const pat of splitGlobList(params.excludePattern)) {
        pathspecs.push(pat.startsWith(":") ? pat : `:!${pat.replace(/^!/, "")}`);
      }
    }

    if (pathspecs.length > 0) {
      args.push("--", ...pathspecs);
    }

    const result = await safeSpawn(engine.binary, args, undefined, basePath);
    const clean = stripAnsi(result.stdout).trim();

    let total = 0;
    const formattedLines: string[] = [];
    for (const line of clean.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split(":");
      const countStr = parts.pop();
      const file = parts.join(":");
      const count = parseInt(countStr || "0", 10);
      if (!isNaN(count)) total += count;
      formattedLines.push(`${formatOutputPath(file, basePath)}: ${countStr}`);
    }
    return { total, output: formattedLines.join("\n") };
  }

  // rg or ugrep (-H ensures filename is always emitted even for a single target file)
  const args: string[] = ["-H", "--color", "never", "-c"];
  if (params.caseSensitive === true) args.push("-s");
  else if (params.caseSensitive === false) args.push("-i");
  else if (engine.name === "rg") args.push("-S");
  else if (engine.name === "ugrep") args.push("-j");

  if (params.type === "text") args.push("-F");

  if (params.filePattern) {
    for (const pat of splitGlobList(params.filePattern)) {
      args.push("-g", pat);
    }
  }

  if (params.excludePattern) {
    for (const pat of splitGlobList(params.excludePattern)) {
      args.push("-g", pat.startsWith("!") ? pat : `!${pat}`);
    }
  }
  if (params.noIgnore) args.push("--no-ignore");

  args.push("-e", params.query || "", "--", targetPath);

  const result = await safeSpawn(engine.binary, args, undefined, basePath);
  const clean = stripAnsi(result.stdout).trim();

  let total = 0;
  const formattedLines: string[] = [];
  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const lastColon = line.lastIndexOf(":");
    if (lastColon === -1) continue;
    const file = line.slice(0, lastColon);
    const countStr = line.slice(lastColon + 1).trim();
    const count = parseInt(countStr || "0", 10);
    if (!isNaN(count)) total += count;
    formattedLines.push(`${formatOutputPath(file, basePath)}: ${countStr}`);
  }

  return { total, output: formattedLines.join("\n") };
}

/**
 * Fallback native Node.js recursive file listing
 */
function nativeNodeListFiles(targetDir: string, basePath: string, params: Partial<ListFilesParams>): string[] {
  const fullPath = path.resolve(targetDir || ".");
  if (!fs.existsSync(fullPath)) return [];

  const includeRegexes = params.filePattern
    ? splitGlobList(params.filePattern).map(globToRegExp)
    : [];

  const excludeRegexes = params.excludePattern
    ? splitGlobList(params.excludePattern)
        .map((p) => (p.startsWith("!") ? p.slice(1) : p))
        .map(globToRegExp)
    : [];

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
      const rel = toRelativePath(full, basePath);
      if (excludeRegexes.some((rx) => rx.test(rel))) continue;

      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        if (includeRegexes.length > 0 && !includeRegexes.some((rx) => rx.test(rel))) continue;
        files.push(formatOutputPath(full, basePath));
      }
    }
  }

  if (fs.statSync(fullPath).isFile()) {
    return [formatOutputPath(fullPath, basePath)];
  }
  walk(fullPath);
  return files;
}

/**
 * Unified list files (rg -> git ls-files -> native Node fallback)
 */
export async function runRipgrepListFiles(params: Partial<ListFilesParams>): Promise<string[]> {
  const { targetPath, basePath } = resolveTarget(params.path);
  try {
    const engine = await detectTextEngine();

    if (engine.name === "rg") {
      const args: string[] = ["--files", "--color", "never"];
      if (params.filePattern) {
        for (const pat of splitGlobList(params.filePattern)) {
          args.push("-g", pat);
        }
      }

      if (params.excludePattern) {
        for (const pat of splitGlobList(params.excludePattern)) {
          args.push("-g", pat.startsWith("!") ? pat : `!${pat}`);
        }
      }
      if (params.noIgnore) args.push("--no-ignore");
      if (params.includeHidden) {
        args.push("-.");
        if (!params.noIgnore) {
          args.push("-g", "!.git/**", "-g", "!.git");
        }
      }
      args.push("--", targetPath);

      const result = await safeSpawn(engine.binary, args, undefined, basePath);
      const clean = stripAnsi(result.stdout).trim();
      if (!clean) return [];
      return clean
        .split(/\r?\n/)
        .map((f) => formatOutputPath(f.trim(), basePath))
        .filter(Boolean);
    }

    if (engine.name === "git") {
      const args = ["ls-files", "--cached", "--others"];
      if (!params.noIgnore) args.push("--exclude-standard");
      const relTarget = toRelativePath(targetPath, basePath);
      if (relTarget && relTarget !== ".") args.push("--", relTarget);

      const result = await safeSpawn(engine.binary, args, undefined, basePath);
      const clean = stripAnsi(result.stdout).trim();
      if (!clean) return [];

      const includeRegexes = params.filePattern
        ? splitGlobList(params.filePattern).map(globToRegExp)
        : [];

      const excludeRegexes = params.excludePattern
        ? splitGlobList(params.excludePattern)
            .map((p) => (p.startsWith("!") ? p.slice(1) : p))
            .map(globToRegExp)
        : [];

      return clean
        .split(/\r?\n/)
        .map((f) => f.trim())
        .filter(Boolean)
        .filter((f) => {
          const rel = f.replace(/\\/g, "/");
          if (includeRegexes.length > 0 && !includeRegexes.some((rx) => rx.test(rel))) return false;
          if (excludeRegexes.some((rx) => rx.test(rel))) return false;
          return true;
        })
        .map((f) => formatOutputPath(f, basePath));
    }
  } catch {
    // If CLI engine fails, seamlessly fall back to native Node
  }

  return nativeNodeListFiles(targetPath, basePath, params);
}
