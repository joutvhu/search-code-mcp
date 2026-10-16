import { FindSymbolsParams, SymbolItem, SymbolKind } from "../types.js";
import {
  detectSymbolEngine,
  ResolvedSymbolEngine,
  safeSpawn,
} from "../utils/exec.js";
import { runRipgrepSearch } from "./ripgrep.js";
import { runAstGrepPattern } from "./astgrep.js";

export function normalizeSymbolKind(raw: string): SymbolKind {
  raw = raw.toLowerCase().trim();
  if (["function", "func", "fn", "def", "subroutine"].includes(raw)) return "function";
  if (["method", "m", "member"].includes(raw)) return "method";
  if (["class", "c"].includes(raw)) return "class";
  if (["interface", "i"].includes(raw)) return "interface";
  if (["variable", "var", "v", "const", "constant"].includes(raw)) return "variable";
  if (["type", "typedef", "t"].includes(raw)) return "type";
  if (["struct", "s", "record"].includes(raw)) return "struct";
  if (["enum", "e", "enumerator"].includes(raw)) return "enum";
  if (["trait"].includes(raw)) return "trait";
  if (["module", "package", "namespace"].includes(raw)) return "module";
  return "other";
}

export function extractSymbolFromLine(line: string): { kind: SymbolKind; name: string } | null {
  const trimmed = line.trim();
  if (
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
    /(?:export\s+)?(?:async\s+)?(?:pub\s+)?(function\*?|class|interface|type|enum|struct|trait|def|fn|func)\s+([a-zA-Z0-9_$]+)/
  );
  if (m) {
    return { kind: normalizeSymbolKind(m[1]), name: m[2] };
  }

  // 2. const/let arrow function
  m = trimmed.match(
    /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/
  );
  if (m) {
    return { kind: "function", name: m[1] };
  }

  // 3. const/let declarations (variables, schemas, objects)
  m = trimmed.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/);
  if (m) {
    return { kind: "variable", name: m[1] };
  }

  // 4. Method definitions in OOP languages (Java, C#, C++, class methods)
  m = trimmed.match(
    /(?:public|private|protected|static|override|\s)+[a-zA-Z0-9_<>\[\]]+\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/
  );
  if (m) {
    return { kind: "method", name: m[1] };
  }

  return null;
}

async function runCtagsSymbols(
  binary: string,
  params: Partial<FindSymbolsParams>
): Promise<SymbolItem[]> {
  const args = [
    "-R",
    "--output-format=json",
    "--fields=+n+K+S",
    "--quiet=yes",
    "-f",
    "-",
  ];

  if (params.excludePattern) {
    args.push(`--exclude=${params.excludePattern}`);
  }

  args.push(params.path || ".");

  const res = await safeSpawn(binary, args);
  const lines = res.stdout.split("\n");
  const items: SymbolItem[] = [];

  const targetName = (params.name || "").trim().toLowerCase();
  const allowedKinds = params.kinds?.map((k) => k.toLowerCase());

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const tag = JSON.parse(line);
      if (tag._type !== "tag") continue;

      const name: string = tag.name || "";
      if (targetName) {
        if (params.exactMatch) {
          if (name.toLowerCase() !== targetName) continue;
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
        file: tag.path,
        line: tag.line || 1,
        containerName: tag.scope || undefined,
        signature: tag.pattern
          ? tag.pattern.replace(/^\/\^?|\$?\/$/g, "").trim()
          : undefined,
      });

      if (items.length >= (params.maxResults || 100)) break;
    } catch {}
  }

  return items;
}

async function runAstGrepSymbols(
  binary: string,
  params: Partial<FindSymbolsParams>
): Promise<SymbolItem[]> {
  const targetName = (params.name || "").trim();
  const matches = await runAstGrepPattern({
    path: params.path,
    query: targetName ? `function ${targetName}($$$)` : "function $NAME($$$)",
    filePattern: params.filePattern,
  });

  const items: SymbolItem[] = [];
  for (const m of matches) {
    const firstLine = m.content.split("\n")[0] || "";
    const extracted = extractSymbolFromLine(firstLine);
    items.push({
      name: extracted?.name || targetName || "anonymous",
      kind: extracted?.kind || "function",
      file: m.file,
      line: m.startLine,
      signature: firstLine.trim(),
    });

    if (items.length >= (params.maxResults || 100)) break;
  }

  return items;
}

async function runRipgrepSymbols(
  params: Partial<FindSymbolsParams>
): Promise<SymbolItem[]> {
  const targetName = (params.name || "").trim();
  const allowedKinds = params.kinds?.map((k) => k.toLowerCase());

  let query = "\\b(function|class|interface|type|enum|struct|trait|def|fn|func|const|let|var)\\b";
  if (targetName) {
    query = params.exactMatch ? `\\b${targetName}\\b` : targetName;
  }

  const rgMatches = await runRipgrepSearch({
    path: params.path || ".",
    query,
    type: "regex",
    filePattern: params.filePattern,
    fileType: params.fileType,
    excludePattern: params.excludePattern,
    noIgnore: params.noIgnore,
    context: 0,
  });

  const items: SymbolItem[] = [];
  const targetLower = targetName.toLowerCase();

  for (const match of rgMatches) {
    const line = match.content.trim();
    const extracted = extractSymbolFromLine(line);
    if (!extracted) continue;

    if (targetLower) {
      const matchNameLower = extracted.name.toLowerCase();
      if (params.exactMatch) {
        if (matchNameLower !== targetLower) continue;
      } else {
        if (!matchNameLower.includes(targetLower)) continue;
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

    if (items.length >= (params.maxResults || 100)) break;
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
      const symbols = await runAstGrepSymbols(engine.binary, params);
      if (symbols.length > 0) {
        return { symbols, engine: "ast-grep" };
      }
    } catch {}
  }

  const symbols = await runRipgrepSymbols(params);
  return { symbols, engine: "ripgrep (heuristic)" };
}