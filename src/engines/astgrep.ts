import fs from "node:fs";
import path from "node:path";
import { detectAstEngine, safeSpawn } from "../utils/exec.js";
import { buildUnifiedDiff, MatchItem } from "../utils/formatters.js";
import { detectLanguageFromPath, enhanceAstGrepError } from "../utils/validation.js";
import { SearchParams, ReplaceParams, DumpTreeParams } from "../types.js";
import { resolveTarget, formatOutputPath, splitGlobList } from "../utils/paths.js";

export const FILE_TYPE_GLOBS: Record<string, string> = {
  ts: "*.{ts,tsx,mts,cts}",
  js: "*.{js,jsx,mjs,cjs}",
  py: "*.{py,pyi}",
  python: "*.{py,pyi}",
  rust: "*.rs",
  rs: "*.rs",
  go: "*.go",
  java: "*.java",
  c: "*.{c,h}",
  cpp: "*.{cpp,cc,cxx,hpp,hh,h}",
  cs: "*.cs",
  csharp: "*.cs",
  rb: "*.rb",
  ruby: "*.rb",
  php: "*.php",
  kt: "*.{kt,kts}",
  kotlin: "*.{kt,kts}",
  swift: "*.swift",
  scala: "*.scala",
  lua: "*.lua",
  html: "*.html",
  css: "*.css",
  json: "*.json",
  yaml: "*.{yaml,yml}",
  sh: "*.{sh,bash}",
};

function getBaseArgs(): string[] {
  const config = process.env.AST_GREP_CONFIG;
  return config ? ["--config", config] : [];
}

function appendAstFilterArgs(
  args: string[],
  params: { filePattern?: string; fileType?: string; excludePattern?: string; noIgnore?: boolean }
): void {
  if (params.noIgnore) {
    args.push("--no-ignore", "vcs", "--no-ignore", "dot");
  }

  if (params.filePattern) {
    for (const pat of splitGlobList(params.filePattern)) {
      if (pat) args.push("--globs", pat);
    }
  } else if (params.fileType) {
    const mapped = FILE_TYPE_GLOBS[params.fileType.toLowerCase()];
    args.push("--globs", mapped || `*.${params.fileType}`);
  }

  if (params.excludePattern) {
    for (const pat of splitGlobList(params.excludePattern)) {
      if (pat) {
        args.push("--globs", pat.startsWith("!") ? pat : `!${pat}`);
      }
    }
  }
}

/**
 * Parse JSONL output from ast-grep (--json=stream)
 */
function parseAstGrepJsonStream(stdout: string, basePath?: string): MatchItem[] {
  const matches: MatchItem[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("{")) continue;

    try {
      const obj = JSON.parse(line);
      const startLine = (obj.range?.start?.line ?? 0) + 1;
      const endLine = (obj.range?.end?.line ?? 0) + 1;
      matches.push({
        file: formatOutputPath(obj.file || "", basePath),
        startLine,
        endLine,
        content: (obj.text || "").trimEnd(),
        metaVariables: obj.metaVariables,
        ruleId: obj.ruleId,
      });
    } catch {
      // Skip malformed JSON lines
    }
  }
  return matches;
}

/**
 * Run simple pattern search using ast-grep run (or sg run)
 */
export async function runAstGrepPattern(
  params: Partial<SearchParams> & { paths?: string[] }
): Promise<MatchItem[]> {
  const { binary } = await detectAstEngine();
  const { targetPath, basePath } = resolveTarget(params.path);
  const targets =
    params.paths && params.paths.length > 0
      ? params.paths.map((p) => (path.isAbsolute(p) ? p : path.resolve(basePath, p)))
      : [targetPath];

  const args: string[] = [...getBaseArgs(), "run", "--pattern", params.query || ""];

  // Language resolution (auto-detect when single file, or use explicit language)
  const lang = params.language || (targets.length === 1 ? detectLanguageFromPath(targets[0]) : undefined);
  if (lang) {
    args.push("--lang", lang);
  }

  appendAstFilterArgs(args, params);
  args.push("--json=stream", ...targets);

  try {
    const result = await safeSpawn(binary, args, undefined, basePath);
    return parseAstGrepJsonStream(result.stdout, basePath);
  } catch (err: any) {
    const enhanced = enhanceAstGrepError(err.message || String(err));
    throw new Error(enhanced);
  }
}

/**
 * Run advanced rule search using ast-grep scan --inline-rules
 */
export async function runAstGrepRule(params: Partial<SearchParams>): Promise<MatchItem[]> {
  const { binary } = await detectAstEngine();
  const { targetPath, basePath } = resolveTarget(params.path);
  const args: string[] = [...getBaseArgs(), "scan", "--inline-rules", params.query || ""];

  appendAstFilterArgs(args, params);
  args.push("--json=stream", targetPath);

  try {
    const result = await safeSpawn(binary, args, undefined, basePath);
    return parseAstGrepJsonStream(result.stdout, basePath);
  } catch (err: any) {
    const enhanced = enhanceAstGrepError(err.message || String(err));
    throw new Error(enhanced);
  }
}

interface AstReplacementEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface AstRewriteResult {
  totalMatchesFound: number;
  appliedReplacements: number;
  truncatedByLimit: boolean;
  modifiedFiles: string[];
  diffs: string[];
}

/**
 * Run AST rewrite with accurate maxReplacements guardrail and unified diff generation
 */
export async function runAstGrepRewrite(params: ReplaceParams): Promise<AstRewriteResult> {
  const { binary } = await detectAstEngine();
  const { targetPath, basePath } = resolveTarget(params.path);
  const args: string[] = [
    ...getBaseArgs(),
    "run",
    "--pattern",
    params.query,
    "--rewrite",
    params.replacement,
  ];

  const lang = params.language || (targetPath ? detectLanguageFromPath(targetPath) : undefined);
  if (lang) {
    args.push("--lang", lang);
  }

  appendAstFilterArgs(args, params);
  args.push("--json=stream", targetPath);

  let stdout = "";
  try {
    const result = await safeSpawn(binary, args, undefined, basePath);
    stdout = result.stdout;
  } catch (err: any) {
    throw new Error(enhanceAstGrepError(err.message || String(err)));
  }

  const allEditsByFile = new Map<string, AstReplacementEdit[]>();
  let totalMatchesFound = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("{")) continue;

    try {
      const obj = JSON.parse(line);
      if (
        typeof obj.file !== "string" ||
        typeof obj.replacement !== "string" ||
        !obj.replacementOffsets ||
        typeof obj.replacementOffsets.start !== "number" ||
        typeof obj.replacementOffsets.end !== "number"
      ) {
        continue;
      }

      totalMatchesFound++;
      const absFile = path.isAbsolute(obj.file) ? obj.file : path.resolve(basePath, obj.file);
      const list = allEditsByFile.get(absFile) || [];
      list.push({
        start: obj.replacementOffsets.start,
        end: obj.replacementOffsets.end,
        replacement: obj.replacement,
      });
      allEditsByFile.set(absFile, list);
    } catch {
      // Skip malformed JSON line
    }
  }

  const maxLimit = params.maxReplacements ?? 50;
  let appliedReplacements = 0;
  let truncatedByLimit = false;
  const modifiedFiles: string[] = [];
  const diffs: string[] = [];
  const isDryRun = params.dryRun !== false;

  for (const [absFile, edits] of allEditsByFile.entries()) {
    if (appliedReplacements >= maxLimit) {
      truncatedByLimit = true;
      break;
    }

    const remainingBudget = maxLimit - appliedReplacements;
    const selectedEdits = edits.slice(0, remainingBudget);
    if (edits.length > remainingBudget) {
      truncatedByLimit = true;
    }

    const originalText = fs.readFileSync(absFile, "utf8");
    const originalBuf = Buffer.from(originalText, "utf8");

    // Apply edits from highest byte offset to lowest to preserve earlier offsets
    const sortedDesc = [...selectedEdits].sort((a, b) => b.start - a.start);
    let currentBuf = originalBuf;
    let lastStart = Infinity;
    let fileEditsCount = 0;

    for (const edit of sortedDesc) {
      // Skip overlapping edits safely
      if (edit.end > lastStart) continue;
      const before = currentBuf.subarray(0, edit.start);
      const rep = Buffer.from(edit.replacement, "utf8");
      const after = currentBuf.subarray(edit.end);
      currentBuf = Buffer.concat([before, rep, after]);
      lastStart = edit.start;
      fileEditsCount++;
    }

    const modifiedText = currentBuf.toString("utf8");
    if (modifiedText !== originalText) {
      appliedReplacements += fileEditsCount;
      const displayPath = formatOutputPath(absFile, basePath);
      modifiedFiles.push(displayPath);
      const diff = buildUnifiedDiff(displayPath, originalText, modifiedText);
      if (diff) diffs.push(diff);

      if (!isDryRun) {
        fs.writeFileSync(absFile, modifiedText, "utf8");
      }
    }
  }

  return {
    totalMatchesFound,
    appliedReplacements,
    truncatedByLimit,
    modifiedFiles,
    diffs,
  };
}

/**
 * Dump syntax tree for debugging rules
 */
export async function runAstGrepDump(params: DumpTreeParams): Promise<string> {
  const { binary } = await detectAstEngine();
  const args: string[] = [
    ...getBaseArgs(),
    "run",
    "--pattern",
    params.code,
    "--lang",
    params.language,
    `--debug-query=${params.format || "cst"}`,
  ];

  try {
    const result = await safeSpawn(binary, args);
    return (result.stderr || result.stdout).trim() || "No syntax tree output.";
  } catch (err: any) {
    throw new Error(enhanceAstGrepError(err.message || String(err)));
  }
}
