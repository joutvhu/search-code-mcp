import yaml from "yaml";
import path from "node:path";

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".scala": "scala",
  ".lua": "lua",
  ".html": "html",
  ".css": "css",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "bash",
  ".bash": "bash",
  ".sol": "solidity",
  ".elixir": "elixir",
  ".ex": "elixir",
  ".exs": "elixir",
};

/**
 * Auto-detect programming language for ast-grep from file path
 */
export function detectLanguageFromPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext];
}

/**
 * Validate an inline ast-grep YAML rule before passing to CLI
 */
export function validateYamlRule(yamlStr: string): { valid: boolean; error?: string } {
  try {
    const parsed = yaml.parse(yamlStr);
    if (!parsed || typeof parsed !== "object") {
      return { valid: false, error: "YAML rule must be an object." };
    }

    if (!parsed.id) {
      return { valid: false, error: "Missing required 'id' field in YAML rule." };
    }
    if (!parsed.language) {
      return { valid: false, error: "Missing required 'language' field in YAML rule (e.g. language: typescript)." };
    }
    if (!parsed.rule) {
      return { valid: false, error: "Missing required 'rule' field in YAML rule." };
    }

    return { valid: true };
  } catch (err: any) {
    return {
      valid: false,
      error: `YAML syntax error: ${err.message || String(err)}`,
    };
  }
}

/**
 * Enhance ast-grep raw stderr with actionable suggestions
 */
export function enhanceAstGrepError(stderr: string): string {
  const clean = stderr.trim();
  let hint = "";

  if (clean.includes("kind") || clean.includes("Unknown node kind")) {
    hint = "\n💡 Hint: Use 'dump_tree' tool on a sample code snippet to discover exact node kinds for this language.";
  } else if (clean.includes("stopBy") || clean.includes("inside") || clean.includes("has")) {
    hint = "\n💡 Hint: For relational rules (inside/has), add 'stopBy: end' to ensure complete AST tree traversal.";
  }

  return clean + hint;
}
