import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function resolveBinary(name: "rg" | "ast-grep"): string {
  if (name === "rg") {
    return process.env.RIPGREP_PATH || "rg";
  } else {
    return process.env.AST_GREP_PATH || "ast-grep";
  }
}

function getInstallHint(binName: string): string {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (binName.includes("ast-grep")) {
    return "Please install ast-grep using: 'npm install -g @ast-grep/cli' or 'cargo install ast-grep --locked' or 'brew install ast-grep'.";
  }
  if (binName.includes("rg") || binName.includes("ripgrep")) {
    if (isWin) {
      return "Please install ripgrep using: 'winget install BurntSushi.ripgrep.MSVC' or 'choco install ripgrep'.";
    } else if (isMac) {
      return "Please install ripgrep using: 'brew install ripgrep'.";
    } else {
      return "Please install ripgrep using your package manager, e.g. 'sudo apt install ripgrep'.";
    }
  }
  return `Please ensure '${binName}' is installed and in PATH.`;
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

    // On Windows, if calling a batch script (like ast-grep.cmd from npm), we can check or pass .cmd
    let targetCmd = executable;
    if (isWindows && !targetCmd.endsWith(".exe") && !targetCmd.endsWith(".cmd")) {
      // If ast-grep is called without extension on Windows, prefer ast-grep.cmd if from npm
      // Native child_process on Windows will find .exe or .cmd automatically when windowsVerbatimArguments or proper path is used
    }

    // Never use shell: true to prevent command injection and DEP0190 warnings
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
              const hint = getInstallHint(executable);
              reject(new Error(`Binary '${executable}' not found in PATH.\n${hint}`));
            });
          return;
        }

        const hint = getInstallHint(executable);
        reject(new Error(`Binary '${executable}' not found in PATH.\n${hint}`));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      const exitCode = code ?? 0;
      // Exit code 0 (success) and 1 (standard "no matches" from rg/ast-grep) are normal
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
