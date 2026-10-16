import { safeSpawn } from "./exec.js";

export interface SystemCapabilities {
  text: boolean;
  ast: boolean;
  symbol: boolean;
}

let cachedCaps: SystemCapabilities | null = null;

/**
 * Actively probe which capabilities are currently functional on this machine
 */
export async function probeSystemCapabilities(): Promise<SystemCapabilities> {
  if (cachedCaps) return cachedCaps;

  let text = false;
  try {
    await safeSpawn("rg", ["--version"]);
    text = true;
  } catch {
    try {
      await safeSpawn("ugrep", ["--version"]);
      text = true;
    } catch {
      try {
        await safeSpawn("git", ["--version"]);
        text = true;
      } catch {}
    }
  }

  let ast = false;
  try {
    await safeSpawn("ast-grep", ["--version"]);
    ast = true;
  } catch {
    try {
      await safeSpawn("sg", ["--version"]);
      ast = true;
    } catch {}
  }

  let symbol = false;
  try {
    const res = await safeSpawn("ctags", ["--version"]);
    if (res.stdout.includes("Universal Ctags") || res.stdout.includes("Exuberant Ctags")) {
      symbol = true;
    }
  } catch {}

  if (!symbol && (ast || text)) {
    symbol = true;
  }

  cachedCaps = { text, ast, symbol };
  return cachedCaps;
}

/**
 * Format an actionable English error message telling the agent exactly what it can call
 */
export async function formatMissingEngineError(
  category: "ast" | "text" | "symbol",
  contextHint?: string
): Promise<string> {
  const caps = await probeSystemCapabilities();
  const lines: string[] = [];

  if (category === "ast") {
    lines.push(
      "[Missing Engine] AST search engine ('ast-grep' or 'sg') is not installed on this system.",
      "",
      "• User Installation Guide (to enable structural AST features):",
      "  - npm (recommended): npm install -g @ast-grep/cli",
      "  - Homebrew (macOS): brew install ast-grep",
      "  - Cargo: cargo install ast-grep --locked",
      "  - Windows: choco install ast-grep (or winget install ast-grep)",
      "",
      "• AVAILABLE ALTERNATIVES FOR AI AGENT (Call these directly without re-checking PATH):"
    );

    if (caps.text) {
      lines.push(
        "  - search: use type: 'regex' or type: 'text' to match code patterns:",
        '    👉 search({ query: "<pattern>", type: "regex", path: "..." })',
        "  - replace: use type: 'regex' or type: 'text' for safe code replacements:",
        '    👉 replace({ query: "<pattern>", replacement: "<new>", type: "regex", dryRun: true })',
        "  - count: count occurrences with type: 'regex' or type: 'text':",
        '    👉 count({ query: "<pattern>", type: "regex" })'
      );
    }

    if (caps.symbol) {
      lines.push(
        "  - find_symbols: find function, class, interface, method, or variable definitions:",
        '    👉 find_symbols({ name: "...", kinds: ["function", "class"] })'
      );
    }

    lines.push(
      "  - list_files: list matching files across the codebase:",
      '    👉 list_files({ path: ".", filePattern: "*.ts" })'
    );
  } else if (category === "text") {
    lines.push(
      "[Missing Engine] No text search engine found ('ripgrep', 'ugrep', or 'git').",
      "",
      "• User Installation Guide (to enable fast text search):",
      "  - Windows: winget install BurntSushi.ripgrep.MSVC (or choco install ripgrep)",
      "  - macOS: brew install ripgrep",
      "  - Linux: sudo apt install ripgrep (or sudo pacman -S ripgrep)",
      "  - Git: https://git-scm.com/",
      "",
      "• AVAILABLE ALTERNATIVES FOR AI AGENT (Call these directly without re-checking PATH):"
    );

    if (caps.ast) {
      lines.push(
        "  - search: use type: 'ast' for structural syntax queries:",
        '    👉 search({ query: "...", type: "ast", language: "..." })',
        "  - replace: use type: 'ast' for structural code rewriting:",
        '    👉 replace({ query: "...", replacement: "...", type: "ast" })'
      );
    }

    lines.push(
      "  - list_files: list files across the project (powered by native Node.js walk):",
      '    👉 list_files({ path: ".", filePattern: "*" })',
      "  - Inspect files directly using your IDE's built-in file viewing tools."
    );
  } else {
    lines.push(
      "[Missing Engine] No symbol search engine available ('ctags', 'ast-grep', or 'ripgrep').",
      "",
      "• User Installation Guide:",
      "  - Universal Ctags: choco install universal-ctags (or brew install universal-ctags)",
      "  - ripgrep: winget install BurntSushi.ripgrep.MSVC (or brew install ripgrep)",
      "",
      "• AVAILABLE ALTERNATIVES FOR AI AGENT:",
      '  - list_files({ path: "." })'
    );
  }

  if (contextHint) {
    lines.push("", "Context: " + contextHint);
  }

  return lines.join("\n");
}
