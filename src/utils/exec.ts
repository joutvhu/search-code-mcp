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
    return [
      "Binary 'ast-grep' not found in PATH.",
      "• For AI Agent: Fall back to `type: 'regex'` or `type: 'text'` (powered by ripgrep) if you only need string or pattern matching.",
      "• To enable structural AST features, install ast-grep: 'npm install -g @ast-grep/cli' or 'cargo install ast-grep --locked' or 'brew install ast-grep'."
    ].join("\n");
  }

  if (binName.includes("rg") || binName.includes("ripgrep")) {
    const installCmd = isWin
      ? "winget install BurntSushi.ripgrep.MSVC (or 'choco install ripgrep')"
      : isMac
      ? "brew install ripgrep"
      : "sudo apt install ripgrep";

    return [
      "Binary 'rg' (ripgrep) not found in PATH.",
      "• For AI Agent: If ast-grep is installed, you can use `type: 'ast'` to search by AST structure.",
      `• To install ripgrep: '${installCmd}'.`
    ].join("\n");
  }

  return `Binary '${binName}' not found in PATH. Please ensure it is installed and added to system PATH.`;
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
              const hint = getInstallHint(executable);
              reject(new Error(hint));
            });
          return;
        }

        const hint = getInstallHint(executable);
        reject(new Error(hint));
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
