import { FindSymbolsParams, SymbolItem, SymbolKind } from "../types.js";
import { detectSymbolEngine, safeSpawn } from "../utils/exec.js";
import { runRipgrepSearch } from "./ripgrep.js";
import { runAstGrepPattern, FILE_TYPE_GLOBS } from "./astgrep.js";
import {
  resolveTarget,
  formatOutputPath,
  toRelativePath,
  globToRegExp,
  splitGlobList,
} from "../utils/paths.js";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSymbolKind(raw: string): SymbolKind {
  raw = raw.toLowerCase().trim().replace(/\*+$/, "");
  if (["function", "func", "fn", "def", "subroutine"].includes(raw)) return "function";
  if (["method", "m", "member"].includes(raw)) return "method";
  if (["class", "c"].includes(raw)) return "class";
  if (["interface", "i"].includes(raw)) return "interface";
  if (["variable", "var", "v", "const", "constant", "let"].includes(raw)) return "variable";
  if (["type", "typedef", "t", "alias"].includes(raw)) return "type";
  if (["struct", "s", "record"].includes(raw)) return "struct";
  if (["enum", "e", "enumerator"].includes(raw)) return "enum";
  if (["trait"].includes(raw)) return "trait";
  if (["module", "package", "namespace"].includes(raw)) return "module";
  return "other";
}

const CONTROL_FLOW_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "switch",
  "catch",
  "with",
  "return",
  "throw",
  "await",
  "new",
  "typeof",
  "sizeof",
]);

export function extractSymbolFromLine(line: string): { kind: SymbolKind; name: string } | null {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("--")
  ) {
    return null;
  }

  // 1. Standard declaration keywords (JS/TS, Python, Rust, Go, Java, C#, PHP, etc.)
  let m = trimmed.match(
    /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:pub(?:\([^)]*\))?\s+)?(function\*?|class|interface|type|enum|struct|trait|def|fn|func)\s+([a-zA-Z0-9_$]+)/
  );
  if (m) {
    return { kind: normalizeSymbolKind(m[1]), name: m[2] };
  }

  // 2. const/let/var arrow function
  m = trimmed.match(
    /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/
  );
  if (m) {
    return { kind: "function", name: m[1] };
  }

  // 3. const/let/var declarations (variables, schemas, objects)
  m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*(?::[^=]+)?=/);
  if (m) {
    return { kind: "variable", name: m[1] };
  }

  // 4. Method definitions in OOP languages (Java, C#, C++, TS/JS class methods)
  m = trimmed.match(
    /^(?:(?:public|private|protected|static|override|readonly|virtual|final|async)\s+)+(?:[a-zA-Z0-9_<>\[\]]+\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/
  );
  if (m && !CONTROL_FLOW_KEYWORDS.has(m[1])) {
    return { kind: "method", name: m[1] };
  }

  return null;
}

async function runCtagsSymbols(
  binary: string,
  params: Partial<FindSymbolsParams>
): Promise<SymbolItem[]> {
  const { targetPath, basePath } = resolveTarget(params.path);
  const args = ["-R", "--output-format=json", "--fields=+n+K+S", "--quiet=yes", "-f", "-"];

  if (!params.noIgnore) {
    args.push("--exclude=.git", "--exclude=node_modules", "--exclude=dist");
  }

  if (params.excludePattern) {
    for (const pat of splitGlobList(params.excludePattern)) {
      args.push(`--exclude=${pat.replace(/^!/, "")}`);
    }
  }

  args.push(targetPath);

  const res = await safeSpawn(binary, args, undefined, basePath);
  const lines = res.stdout.split(/\r?\n/);
  const items: SymbolItem[] = [];

  const rawTargetName = (params.name || "").trim();
  const targetName = rawTargetName.toLowerCase();
  const allowedKinds = params.kinds?.map((k) => k.toLowerCase());
  const maxResults = params.maxResults || 100;

  const includeRegexes = params.filePattern
    ? splitGlobList(params.filePattern).map(globToRegExp)
    : [];
  const typeGlob = params.fileType
    ? FILE_TYPE_GLOBS[params.fileType.toLowerCase()] || `*.${params.fileType}`
    : null;
  const typeRegex = typeGlob ? globToRegExp(typeGlob) : null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const tag = JSON.parse(line);
      if (tag._type !== "tag") continue;

      if (tag.path) {
        const rel = toRelativePath(tag.path, basePath);
        if (includeRegexes.length > 0 && !includeRegexes.some((rx) => rx.test(rel))) continue;
        if (typeRegex && !typeRegex.test(rel)) continue;
      }

      const name: string = tag.name || "";
      if (rawTargetName) {
        if (params.exactMatch) {
          if (name !== rawTargetName) continue;
        } else {
          if (!name.toLowerCase().includes(targetName)) continue;
        }
      }

      const kind = normalizeSymbolKind(tag.kind || "");
      if (allowedKinds && allowedKinds.length > 0 && !allowedKinds.includes(kind)) {
        continue;
      }

      items.push({
        name,
        kind,
        file: formatOutputPath(tag.path, basePath),
        line: tag.line || 1,
        containerName: tag.scope || undefined,
        signature: tag.pattern ? tag.pattern.replace(/^\/\^?|\$?\/$/g, "").trim() : undefined,
      });

      if (items.length >= maxResults) break;
    } catch {}
  }

  return items;
}

async function runAstGrepSymbols(params: Partial<FindSymbolsParams>): Promise<SymbolItem[]> {
  const rawTargetName = (params.name || "").trim();
  const targetLower = rawTargetName.toLowerCase();
  const allowedKinds = params.kinds?.map((k) => k.toLowerCase());

  // Only handle function queries via ast-grep when kinds are unrestricted or include 'function'
  if (allowedKinds && allowedKinds.length > 0 && !allowedKinds.includes("function")) {
    return [];
  }

  const matches = await runAstGrepPattern({
    path: params.path,
    query: rawTargetName && params.exactMatch ? `function ${rawTargetName}($$$)` : "function $NAME($$$)",
    filePattern: params.filePattern,
    fileType: params.fileType,
    excludePattern: params.excludePattern,
    noIgnore: params.noIgnore,
  });

  const items: SymbolItem[] = [];
  const maxResults = params.maxResults || 100;

  for (const m of matches) {
    const firstLine = m.content.split(/\r?\n/)[0] || "";
    const extracted = extractSymbolFromLine(firstLine);
    const name = extracted?.name || rawTargetName || "anonymous";
    const kind = extracted?.kind || "function";

    if (rawTargetName) {
      if (params.exactMatch) {
        if (name !== rawTargetName) continue;
      } else {
        if (!name.toLowerCase().includes(targetLower)) continue;
      }
    }

    if (allowedKinds && allowedKinds.length > 0 && !allowedKinds.includes(kind)) {
      continue;
    }

    items.push({
      name,
      kind,
      file: m.file,
      line: m.startLine,
      signature: firstLine.trim(),
    });

    if (items.length >= maxResults) break;
  }

  return items;
}

async function runRipgrepSymbols(params: Partial<FindSymbolsParams>): Promise<SymbolItem[]> {
  const rawTargetName = (params.name || "").trim();
  const targetLower = rawTargetName.toLowerCase();
  const allowedKinds = params.kinds?.map((k) => k.toLowerCase());
  const maxResults = params.maxResults || 100;

  let query = "\\b(function|class|interface|type|enum|struct|trait|def|fn|func|const|let|var)\\b";
  if (rawTargetName) {
    const escaped = escapeRegExp(rawTargetName);
    query = params.exactMatch ? `\\b${escaped}\\b` : escaped;
  } else {
    // Outline mode: include methods and declarations
    query = "\\b(function|class|interface|type|enum|struct|trait|def|fn|func|const|let|var)\\b|(?:public|private|protected|async)\\s+[a-zA-Z0-9_]+\\s*\\(";
  }

  const rgMatches = await runRipgrepSearch({
    path: params.path || ".",
    query,
    type: "regex",
    filePattern: params.filePattern,
    fileType: params.fileType,
    excludePattern: params.excludePattern,
    noIgnore: params.noIgnore,
    caseSensitive: params.exactMatch ? true : false,
    context: 0,
  });

  const items: SymbolItem[] = [];

  for (const match of rgMatches) {
    const line = match.content.trim();
    const extracted = extractSymbolFromLine(line);
    if (!extracted) continue;

    if (rawTargetName) {
      if (params.exactMatch) {
        if (extracted.name !== rawTargetName) continue;
      } else {
        if (!extracted.name.toLowerCase().includes(targetLower)) continue;
      }
    }

    if (allowedKinds && allowedKinds.length > 0 && !allowedKinds.includes(extracted.kind)) {
      continue;
    }

    items.push({
      name: extracted.name,
      kind: extracted.kind,
      file: match.file,
      line: match.startLine,
      column: match.column,
      signature: line,
    });

    if (items.length >= maxResults) break;
  }

  return items;
}

export async function searchSymbols(
  params: Partial<FindSymbolsParams>
): Promise<{ symbols: SymbolItem[]; engine: string }> {
  const engine = await detectSymbolEngine();

  if (engine.name === "ctags") {
    try {
      const symbols = await runCtagsSymbols(engine.binary, params);
      return { symbols, engine: "universal-ctags" };
    } catch {}
  }

  if (engine.name === "ast-grep" && params.name) {
    try {
      const symbols = await runAstGrepSymbols(params);
      if (symbols.length > 0 && params.kinds?.length === 1 && params.kinds[0] === "function") {
        return { symbols, engine: "ast-grep" };
      }
    } catch {}
  }

  const symbols = await runRipgrepSymbols(params);
  return { symbols, engine: "ripgrep (heuristic)" };
}
