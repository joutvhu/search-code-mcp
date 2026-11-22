import { formatMissingEngineError } from "./diagnostics.js";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SafeSpawnOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
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

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024; // 16 MB

export function findWindowsNativeAstGrep(): string | null {
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

  if (process.env.APPDATA) {
    const appDataExe = path.join(process.env.APPDATA, "npm", "node_modules", "@ast-grep", "cli", "ast-grep.exe");
    if (fs.existsSync(appDataExe)) {
      return appDataExe;
    }
  }
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
    const res = await safeSpawn("ast-grep", ["--version"]);
    if (res.exitCode === 0 && /ast-grep/i.test(res.stdout)) {
      cachedAstEngine = { name: "ast-grep", binary: "ast-grep" };
      return cachedAstEngine;
    }
  } catch {
    if (process.platform === "win32") {
      try {
        const res = await safeSpawn("ast-grep.cmd", ["--version"]);
        if (res.exitCode === 0 && /ast-grep/i.test(res.stdout)) {
          cachedAstEngine = { name: "ast-grep", binary: "ast-grep.cmd" };
          return cachedAstEngine;
        }
      } catch {}
    }
  }

  // 4. Check alias 'sg' (ensure it is ast-grep, not Linux shadow-utils /usr/bin/sg)
  try {
    const res = await safeSpawn("sg", ["--version"]);
    if (res.exitCode === 0 && /ast-grep/i.test(res.stdout)) {
      cachedAstEngine = { name: "sg", binary: "sg" };
      return cachedAstEngine;
    }
  } catch {
    if (process.platform === "win32") {
      try {
        const res = await safeSpawn("sg.cmd", ["--version"]);
        if (res.exitCode === 0 && /ast-grep/i.test(res.stdout)) {
          cachedAstEngine = { name: "sg", binary: "sg.cmd" };
          return cachedAstEngine;
        }
      } catch {}
    }
  }

  const errorMsg = await formatMissingEngineError("ast");
  throw new Error(errorMsg);
}

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

  // 2. Check Universal Ctags (--output-format=json requires Universal Ctags)
  try {
    const res = await safeSpawn("ctags", ["--version"]);
    if (res.stdout.includes("Universal Ctags")) {
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

function quoteWinCmdArg(arg: string): string {
  if (/[\r\n]/.test(arg)) {
    throw new Error("Newlines in arguments are not supported when invoking Windows .cmd/.bat shims.");
  }
  if (/[\s^&|<>()%!"]/.test(arg)) {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return arg;
}

/**
 * Execute subprocess safely without shell: true (except unavoidable .cmd/.bat shims on Windows)
 */
export function safeSpawn(
  executable: string,
  args: string[],
  inputText?: string,
  cwd?: string,
  options?: SafeSpawnOptions
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const targetCmd = executable;
    const isBatchScript =
      isWindows && (targetCmd.toLowerCase().endsWith(".cmd") || targetCmd.toLowerCase().endsWith(".bat"));

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBufferBytes = options?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

    let spawnArgs: string[];
    try {
      spawnArgs = isBatchScript ? args.map(quoteWinCmdArg) : args;
    } catch (err) {
      return reject(err);
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(targetCmd, spawnArgs, {
        shell: isBatchScript,
        cwd: cwd || process.cwd(),
        stdio: [inputText !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      });
    } catch (err: any) {
      if (
        isWindows &&
        (err.code === "ENOENT" || err.code === "EINVAL") &&
        !targetCmd.endsWith(".cmd") &&
        !targetCmd.endsWith(".exe")
      ) {
        safeSpawn(`${targetCmd}.cmd`, args, inputText, cwd, options).then(resolve).catch(() => reject(err));
        return;
      }
      return reject(err);
    }

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (isBatchScript && child.pid) {
          spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
      reject(new Error(`Command '${executable}' timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const finishSuccess = (res: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      totalBytes += Buffer.byteLength(chunk, "utf8");
      if (totalBytes > maxBufferBytes) {
        try {
          if (isBatchScript && child.pid) {
            spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
          } else {
            child.kill("SIGTERM");
          }
        } catch {
          try {
            child.kill("SIGTERM");
          } catch {}
        }
        finishError(
          new Error(
            `Command '${executable}' output exceeded max buffer (${Math.round(maxBufferBytes / (1024 * 1024))}MB). Narrow your search path or add filePattern/excludePattern.`
          )
        );
        return;
      }
      stdout += chunk;
    });

    child.stderr?.on("data", (chunk: string) => {
      totalBytes += Buffer.byteLength(chunk, "utf8");
      if (totalBytes > maxBufferBytes) {
        try {
          if (isBatchScript && child.pid) {
            spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
          } else {
            child.kill("SIGTERM");
          }
        } catch {
          try {
            child.kill("SIGTERM");
          } catch {}
        }
        finishError(
          new Error(
            `Command '${executable}' output exceeded max buffer (${Math.round(maxBufferBytes / (1024 * 1024))}MB). Narrow your search path or add filePattern/excludePattern.`
          )
        );
        return;
      }
      stderr += chunk;
    });

    child.on("error", (err: any) => {
      if (settled) return;
      clearTimeout(timer);
      if (
        isWindows &&
        (err.code === "ENOENT" || err.code === "EINVAL") &&
        !targetCmd.endsWith(".cmd") &&
        !targetCmd.endsWith(".exe")
      ) {
        settled = true;
        safeSpawn(`${targetCmd}.cmd`, args, inputText, cwd, options).then(resolve).catch(() => reject(err));
        return;
      }
      settled = true;
      reject(err);
    });

    child.on("close", (code: number | null) => {
      const exitCode = code ?? 0;
      if (exitCode === 0) {
        finishSuccess({ stdout, stderr, exitCode });
      } else if (exitCode === 1) {
        if (stderr && (/error:|fatal:|exception:|not recognized/i.test(stderr))) {
          const error = new Error(`Command '${executable}' failed:\n${stderr}`);
          Object.assign(error, { exitCode, stdout, stderr });
          finishError(error);
        } else {
          finishSuccess({ stdout, stderr, exitCode });
        }
      } else {
        const error = new Error(`Command '${executable}' failed with exit code ${exitCode}:\n${stderr || stdout}`);
        Object.assign(error, { exitCode, stdout, stderr });
        finishError(error);
      }
    });

    if (inputText !== undefined && child.stdin) {
      child.stdin.write(inputText);
      child.stdin.end();
    }
  });
}
