import { resolveBinary, safeSpawn } from "../utils/exec.js";
import { MatchItem } from "../utils/formatters.js";
import { detectLanguageFromPath, enhanceAstGrepError } from "../utils/validation.js";
import { SearchParams, ReplaceParams, DumpTreeParams } from "../types.js";

function getBaseArgs(): string[] {
  const config = process.env.AST_GREP_CONFIG;
  return config ? ["--config", config] : [];
}

/**
 * Parse JSONL output from ast-grep (--json=stream)
 */
function parseAstGrepJsonStream(stdout: string): MatchItem[] {
  const matches: MatchItem[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("{")) continue;

    try {
      const obj = JSON.parse(line);
      const startLine = (obj.range?.start?.line ?? 0) + 1;
      const endLine = (obj.range?.end?.line ?? 0) + 1;
      matches.push({
        file: obj.file || "",
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
 * Run simple pattern search using ast-grep run
 */
export async function runAstGrepPattern(params: Partial<SearchParams>): Promise<MatchItem[]> {
  const binary = resolveBinary("ast-grep");
  const args: string[] = [...getBaseArgs(), "run", "--pattern", params.query || ""];

  // Language resolution
  const lang = params.language || (params.path ? detectLanguageFromPath(params.path) : undefined);
  if (lang) {
    args.push("--lang", lang);
  }

  if (params.noIgnore) {
    args.push("--no-ignore");
  }

  args.push("--json=stream", params.path || ".");

  try {
    const result = await safeSpawn(binary, args);
    return parseAstGrepJsonStream(result.stdout);
  } catch (err: any) {
    const enhanced = enhanceAstGrepError(err.message || String(err));
    throw new Error(enhanced);
  }
}

/**
 * Run advanced rule search using ast-grep scan --inline-rules
 */
export async function runAstGrepRule(params: Partial<SearchParams>): Promise<MatchItem[]> {
  const binary = resolveBinary("ast-grep");
  const args: string[] = [...getBaseArgs(), "scan", "--inline-rules", params.query || ""];

  if (params.noIgnore) {
    args.push("--no-ignore");
  }

  args.push("--json=stream", params.path || ".");

  try {
    const result = await safeSpawn(binary, args);
    return parseAstGrepJsonStream(result.stdout);
  } catch (err: any) {
    const enhanced = enhanceAstGrepError(err.message || String(err));
    throw new Error(enhanced);
  }
}

/**
 * Run AST rewrite
 */
export async function runAstGrepRewrite(
  params: ReplaceParams
): Promise<{ modifiedFiles: string[]; stdout: string }> {
  const binary = resolveBinary("ast-grep");
  const args: string[] = [
    ...getBaseArgs(),
    "run",
    "--pattern",
    params.query,
    "--rewrite",
    params.replacement,
  ];

  const lang = params.language || (params.path ? detectLanguageFromPath(params.path) : undefined);
  if (lang) {
    args.push("--lang", lang);
  }

  if (params.noIgnore) {
    args.push("--no-ignore");
  }

  // If dryRun, use --json to get affected nodes without changing files
  // If not dryRun, use --update-all to modify files in place
  if (params.dryRun) {
    args.push("--json=stream", params.path || ".");
  } else {
    args.push("--update-all", params.path || ".");
  }

  try {
    const result = await safeSpawn(binary, args);
    return {
      modifiedFiles: [],
      stdout: result.stdout,
    };
  } catch (err: any) {
    throw new Error(enhanceAstGrepError(err.message || String(err)));
  }
}

/**
 * Dump syntax tree for debugging rules
 */
export async function runAstGrepDump(params: DumpTreeParams): Promise<string> {
  const binary = resolveBinary("ast-grep");
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
