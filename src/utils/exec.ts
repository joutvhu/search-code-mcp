import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type TextEngineName = "rg" | "ugrep" | "git";
export type AstEngineName = "ast-grep" | "sg";

export interface ResolvedTextEngine {
  name: TextEngineName;
  binary: string;
}

export interface ResolvedAstEngine {
  name: AstEngineName;
  binary: string;
}

let cachedTextEngine: ResolvedTextEngine | null = null;
let cachedAstEngine: ResolvedAstEngine | null = null;

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

  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const installCmd = isWin
    ? "winget install BurntSushi.ripgrep.MSVC (or 'choco install ripgrep')"
    : isMac
    ? "brew install ripgrep"
    : "sudo apt install ripgrep";

  throw new Error(
    [
      "No text search engine found in system PATH (checked: 'rg', 'ugrep', 'git').",
      `• To install ripgrep (recommended): '${installCmd}'.`,
      "• Or ensure 'git' is installed and accessible in system PATH.",
    ].join("\n")
  );
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

  // 2. Check ast-grep
  try {
    await safeSpawn("ast-grep", ["--version"]);
    cachedAstEngine = { name: "ast-grep", binary: "ast-grep" };
    return cachedAstEngine;
  } catch {}

  // 3. Check alias 'sg'
  try {
    await safeSpawn("sg", ["--version"]);
    cachedAstEngine = { name: "sg", binary: "sg" };
    return cachedAstEngine;
  } catch {}

  throw new Error(
    [
      "Binary 'ast-grep' (or alias 'sg') not found in PATH.",
      "• For AI Agent: Fall back to `type: 'regex'` or `type: 'text'` (powered by ripgrep/git-grep) if you only need string or pattern matching.",
      "• To enable structural AST features, install ast-grep: 'npm install -g @ast-grep/cli' or 'cargo install ast-grep --locked' or 'brew install ast-grep'.",
    ].join("\n")
  );
}

/**
 * Legacy resolver for backward compatibility
 */
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

    const child = spawn(targetCmd, args, {
      shell: false,
      cwd: cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err: any) => {
      if (err.code === "ENOENT") {
        // Try fallback to .cmd on Windows if not already tried
        if (isWindows && !targetCmd.endsWith(".cmd") && !targetCmd.endsWith(".exe")) {
          safeSpawn(`${targetCmd}.cmd`, args, inputText, cwd)
            .then(resolve)
            .catch(() => {
              reject(err);
            });
          return;
        }
        reject(err);
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
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
