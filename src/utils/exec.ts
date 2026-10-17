import { formatMissingEngineError } from "./diagnostics.js";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type TextEngineName = "rg" | "ugrep" | "git";
export type AstEngineName = "ast-grep" | "sg";
export type SymbolEngineName = "ctags" | "ast-grep" | "ripgrep";

export interface ResolvedTextEngine {
  name: TextEngineName;
  binary: string;
}

export interface ResolvedAstEngine {
  name: AstEngineName;
  binary: string;
}

export interface ResolvedSymbolEngine {
  name: SymbolEngineName;
  binary: string;
}

function findWindowsNativeAstGrep(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const res = spawnSync("where.exe", ["ast-grep"], { encoding: "utf8" });
    if (res.status === 0 && res.stdout) {
      const lines = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.toLowerCase().endsWith(".exe") && fs.existsSync(line)) {
          return line;
        }
        const dir = path.dirname(line);
        const nestedExe = path.join(dir, "node_modules", "@ast-grep", "cli", "ast-grep.exe");
        if (fs.existsSync(nestedExe)) {
          return nestedExe;
        }
      }
    }
  } catch {}
  return null;
}

let cachedTextEngine: ResolvedTextEngine | null = null;
let cachedAstEngine: ResolvedAstEngine | null = null;
let cachedSymbolEngine: ResolvedSymbolEngine | null = null;

/**
 * Detect available text search engine (rg -> ugrep -> git)
 */
export async function detectTextEngine(): Promise<ResolvedTextEngine> {
  if (cachedTextEngine) return cachedTextEngine;

  // 1. Explicit env override
  if (process.env.RIPGREP_PATH) {
    cachedTextEngine = { name: "rg", binary: process.env.RIPGREP_PATH };
    return cachedTextEngine;
  }

  // 2. Check ripgrep (rg)
  try {
    await safeSpawn("rg", ["--version"]);
    cachedTextEngine = { name: "rg", binary: "rg" };
    return cachedTextEngine;
  } catch {}

  // 3. Check ugrep
  try {
    await safeSpawn("ugrep", ["--version"]);
    cachedTextEngine = { name: "ugrep", binary: "ugrep" };
    return cachedTextEngine;
  } catch {}

  // 4. Check git (git grep fallback)
  try {
    await safeSpawn("git", ["--version"]);
    cachedTextEngine = { name: "git", binary: "git" };
    return cachedTextEngine;
  } catch {}

  const errorMsg = await formatMissingEngineError("text");
  throw new Error(errorMsg);
}

/**
 * Detect available AST search engine (ast-grep -> sg)
 */
export async function detectAstEngine(): Promise<ResolvedAstEngine> {
  if (cachedAstEngine) return cachedAstEngine;

  // 1. Explicit env override
  if (process.env.AST_GREP_PATH) {
    cachedAstEngine = { name: "ast-grep", binary: process.env.AST_GREP_PATH };
    return cachedAstEngine;
  }

  // 2. On Windows, prefer native .exe if discovered (e.g. from global @ast-grep/cli)
  if (process.platform === "win32") {
    const nativeExe = findWindowsNativeAstGrep();
    if (nativeExe) {
      cachedAstEngine = { name: "ast-grep", binary: nativeExe };
      return cachedAstEngine;
    }
  }

  // 3. Check ast-grep
  try {
    await safeSpawn("ast-grep", ["--version"]);
    cachedAstEngine = { name: "ast-grep", binary: "ast-grep" };
    return cachedAstEngine;
  } catch {
    if (process.platform === "win32") {
      try {
        await safeSpawn("ast-grep.cmd", ["--version"]);
        cachedAstEngine = { name: "ast-grep", binary: "ast-grep.cmd" };
        return cachedAstEngine;
      } catch {}
    }
  }

  // 4. Check alias 'sg'
  try {
    await safeSpawn("sg", ["--version"]);
    cachedAstEngine = { name: "sg", binary: "sg" };
    return cachedAstEngine;
  } catch {
    if (process.platform === "win32") {
      try {
        await safeSpawn("sg.cmd", ["--version"]);
        cachedAstEngine = { name: "sg", binary: "sg.cmd" };
        return cachedAstEngine;
      } catch {}
    }
  }

  const errorMsg = await formatMissingEngineError("ast");
  throw new Error(errorMsg);
}

/**
 * Legacy resolver for backward compatibility
 */

/**
 * Detect available symbol search engine (ctags -> ast-grep -> ripgrep heuristic)
 */
export async function detectSymbolEngine(): Promise<ResolvedSymbolEngine> {
  if (cachedSymbolEngine) return cachedSymbolEngine;

  // 1. Explicit env override
  if (process.env.CTAGS_PATH) {
    cachedSymbolEngine = { name: "ctags", binary: process.env.CTAGS_PATH };
    return cachedSymbolEngine;
  }

  // 2. Check universal-ctags / ctags
  try {
    const res = await safeSpawn("ctags", ["--version"]);
    if (res.stdout.includes("Universal Ctags") || res.stdout.includes("Exuberant Ctags")) {
      cachedSymbolEngine = { name: "ctags", binary: "ctags" };
      return cachedSymbolEngine;
    }
  } catch {}

  // 3. Check ast-grep / sg
  try {
    const ast = await detectAstEngine();
    cachedSymbolEngine = { name: "ast-grep", binary: ast.binary };
    return cachedSymbolEngine;
  } catch {}

  // 4. Fallback to ripgrep (or git grep)
  try {
    const text = await detectTextEngine();
    cachedSymbolEngine = { name: "ripgrep", binary: text.binary };
    return cachedSymbolEngine;
  } catch {}

  const errorMsg = await formatMissingEngineError("symbol");
  throw new Error(errorMsg);
}

export function resolveBinary(name: "rg" | "ast-grep"): string {
  if (name === "rg") {
    return process.env.RIPGREP_PATH || "rg";
  } else {
    return process.env.AST_GREP_PATH || "ast-grep";
  }
}

/**
 * Execute subprocess safely without shell: true
 */
export function safeSpawn(
  executable: string,
  args: string[],
  inputText?: string,
  cwd?: string
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    let targetCmd = executable;
    const isBatchScript = isWindows && (targetCmd.toLowerCase().endsWith(".cmd") || targetCmd.toLowerCase().endsWith(".bat"));

    // When running batch scripts on Windows, quote arguments containing spaces/special characters
    const spawnArgs = isBatchScript
      ? args.map((a) => (/[\s^&|<>"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
      : args;

    let child: any;
    try {
      child = spawn(targetCmd, spawnArgs, {
        shell: isBatchScript,
        cwd: cwd || process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: any) {
      if (isWindows && (err.code === "ENOENT" || err.code === "EINVAL") && !targetCmd.endsWith(".cmd") && !targetCmd.endsWith(".exe")) {
        safeSpawn(`${targetCmd}.cmd`, args, inputText, cwd)
          .then(resolve)
          .catch(() => reject(err));
        return;
      }
      return reject(err);
    }

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err: any) => {
      if (isWindows && (err.code === "ENOENT" || err.code === "EINVAL") && !targetCmd.endsWith(".cmd") && !targetCmd.endsWith(".exe")) {
        // Try fallback to .cmd on Windows if not already tried
        safeSpawn(`${targetCmd}.cmd`, args, inputText, cwd)
          .then(resolve)
          .catch(() => {
            reject(err);
          });
        return;
      }
      reject(err);
    });

    child.on("close", (code: number | null) => {
      const exitCode = code ?? 0;
      // Exit code 0 (success) and 1 (standard "no matches" from rg/ugrep/git-grep/ast-grep) are normal
      if (exitCode === 0) {
        resolve({ stdout, stderr, exitCode });
      } else if (exitCode === 1) {
        // Verify it's not a syntax or unrecognized command error
        if (stderr && (stderr.includes("error:") || stderr.includes("Error:") || stderr.includes("not recognized"))) {
          const error = new Error(`Command '${executable}' failed:\n${stderr}`);
          Object.assign(error, { exitCode, stdout, stderr });
          reject(error);
        } else {
          resolve({ stdout, stderr, exitCode });
        }
      } else {
        const error = new Error(`Command '${executable}' failed with exit code ${exitCode}:\n${stderr || stdout}`);
        Object.assign(error, { exitCode, stdout, stderr });
        reject(error);
      }
    });

    if (inputText !== undefined) {
      child.stdin.write(inputText);
      child.stdin.end();
    }
  });
}
