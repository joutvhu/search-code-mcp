import fs from "node:fs";
import path from "node:path";

let configuredWorkspaceRoot: string | null = null;
let configuredRelativePaths: boolean | null = null;

/**
 * Explicitly set the workspace / project root directory
 */
export function setWorkspaceRoot(rootPath: string): void {
  try {
    configuredWorkspaceRoot = path.resolve(rootPath);
  } catch {
    configuredWorkspaceRoot = rootPath;
  }
}

/**
 * Configure whether outputs should format file paths as relative or absolute
 */
export function setRelativePaths(enabled: boolean): void {
  configuredRelativePaths = enabled;
}

/**
 * Check if output should return relative paths.
 * Enabled via:
 * 1. Explicitly configured (CLI arg --relative-paths)
 * 2. Environment variable: RELATIVE_PATHS=true / 1, OUTPUT_RELATIVE_PATHS=true / 1, RELATIVE_PATH=true / 1
 * Default is false (returns absolute paths).
 */
export function isRelativePathsEnabled(): boolean {
  if (configuredRelativePaths !== null) return configuredRelativePaths;
  const envVal = (
    process.env.RELATIVE_PATHS ||
    process.env.OUTPUT_RELATIVE_PATHS ||
    process.env.RELATIVE_PATH
  )?.toLowerCase();
  return envVal === "true" || envVal === "1";
}

/**
 * Detect the workspace root directory:
 * 1. Explicitly configured via CLI argument (--root / --workspace / positional)
 * 2. Environment variable WORKSPACE_ROOT or PROJECT_ROOT
 * 3. Fallback to process.cwd()
 */
export function getWorkspaceRoot(): string {
  if (configuredWorkspaceRoot) return configuredWorkspaceRoot;
  if (process.env.WORKSPACE_ROOT) return path.resolve(process.env.WORKSPACE_ROOT);
  if (process.env.PROJECT_ROOT) return path.resolve(process.env.PROJECT_ROOT);
  return process.cwd();
}

/**
 * Walk up directory tree to find project root (containing .git, package.json, Cargo.toml, etc.)
 */
export function findProjectRoot(startPath: string): string {
  const resolved = path.resolve(startPath);
  let current = resolved;
  try {
    if (fs.existsSync(current) && fs.statSync(current).isFile()) {
      current = path.dirname(current);
    }

    let dir = current;
    while (true) {
      if (
        fs.existsSync(path.join(dir, ".git")) ||
        fs.existsSync(path.join(dir, "package.json")) ||
        fs.existsSync(path.join(dir, "Cargo.toml")) ||
        fs.existsSync(path.join(dir, "go.mod")) ||
        fs.existsSync(path.join(dir, "pyproject.toml"))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  return current;
}

/**
 * Resolve target path and base directory for a given tool input path.
 * - Handles relative paths (resolved against workspace root)
 * - Handles absolute paths (determines project root for clean relative output)
 */
export function resolveTarget(inputPath?: string): { targetPath: string; basePath: string } {
  const wsRoot = getWorkspaceRoot();

  if (!inputPath || inputPath === ".") {
    return { targetPath: wsRoot, basePath: wsRoot };
  }

  if (path.isAbsolute(inputPath)) {
    const absTarget = path.resolve(inputPath);
    const projRoot = findProjectRoot(absTarget);
    return { targetPath: absTarget, basePath: projRoot };
  }

  // Relative path (e.g. "src", "./src/index.ts")
  const resolved = path.resolve(wsRoot, inputPath);
  return { targetPath: resolved, basePath: wsRoot };
}

/**
 * Normalize any file path (absolute or relative) into a clean, relative path
 * with forward slashes (e.g. "src/index.ts").
 */
export function toRelativePath(filePath: string, basePath?: string): string {
  if (!filePath) return filePath;

  const base = basePath ? path.resolve(basePath) : getWorkspaceRoot();
  const absFile = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(base, filePath);

  const rel = path.relative(base, absFile);

  if (!rel) {
    return path.basename(absFile);
  }

  // If outside base or on different drive on Windows
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return absFile.replace(/\\/g, "/");
  }

  return rel.replace(/\\/g, "/");
}

/**
 * Format file path for tool outputs (search, replace, list_files, count, find_symbols).
 * - If RELATIVE_PATHS is enabled (env or CLI), returns relative path with forward slashes.
 * - Otherwise (default), returns absolute path.
 */
export function formatOutputPath(filePath: string, basePath?: string): string {
  if (!filePath) return filePath;

  const base = basePath ? path.resolve(basePath) : getWorkspaceRoot();
  const absFile = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(base, filePath);

  if (isRelativePathsEnabled()) {
    return toRelativePath(absFile, base);
  }

  return absFile;
}

/**
 * Split a comma-separated list of glob patterns, respecting nested brace expansions like '*.{ts,tsx}'.
 */
export function splitGlobList(pattern?: string): string[] {
  if (!pattern) return [];
  const result: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "{" || ch === "[") {
      depth++;
      current += ch;
    } else if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) result.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) result.push(trimmed);
  return result.map((p) => p.replace(/\\/g, "/"));
}

/**
 * Convert simple glob pattern fragment (supporting **, *, ?, [a-z], {a,b}) to RegExp fragment
 */
function globFragmentToRegex(glob: string): string {
  const normalized = glob.replace(/\\/g, "/").trim();
  let regexStr = "";
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
          continue;
        }
        regexStr += ".*";
        i += 2;
        continue;
      }
      regexStr += "[^/]*";
    } else if (ch === "?") {
      regexStr += "[^/]";
    } else if (ch === "[") {
      const closeIdx = normalized.indexOf("]", i);
      if (closeIdx !== -1) {
        const inner = normalized.slice(i, closeIdx + 1);
        regexStr += inner;
        i = closeIdx + 1;
        continue;
      }
      regexStr += "\\[";
    } else if (ch === "{") {
      const closeIdx = normalized.indexOf("}", i);
      if (closeIdx !== -1) {
        const inner = normalized.slice(i + 1, closeIdx);
        const parts = inner.split(",").map((p) => globFragmentToRegex(p.trim()));
        regexStr += `(?:${parts.join("|")})`;
        i = closeIdx + 1;
        continue;
      }
      regexStr += "\\{";
    } else {
      regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    i++;
  }
  return regexStr;
}

/**
 * Convert simple glob pattern (supporting **, *, ?, {a,b}, [a-z]) to RegExp
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").trim();
  const regexStr = globFragmentToRegex(normalized);
  const hasSlash = normalized.includes("/");
  return hasSlash ? new RegExp(`^${regexStr}$`) : new RegExp(`(?:^|/)${regexStr}$`);
}

