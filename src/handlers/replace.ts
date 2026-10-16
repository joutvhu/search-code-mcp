import fs from "node:fs";
import path from "node:path";
import { ReplaceParams } from "../types.js";
import { runAstGrepRewrite } from "../engines/astgrep.js";
import { buildUnifiedDiff } from "../utils/formatters.js";
import { runRipgrepSearch } from "../engines/ripgrep.js";
import { resolveTarget, toRelativePath, formatOutputPath } from "../utils/paths.js";

export async function handleReplace(params: ReplaceParams) {
  const isDryRun = params.dryRun !== false;

  if (params.type === "regex" || params.type === "text") {
    // Regex/Text replacement via ripgrep discovery + in-memory replacement
    const matches = await runRipgrepSearch({
      path: params.path,
      query: params.query,
      type: params.type,
      filePattern: params.filePattern,
      fileType: params.fileType,
      excludePattern: params.excludePattern,
      noIgnore: params.noIgnore,
    });

    if (matches.length === 0) {
      return {
        content: [{ type: "text", text: "No matches found to replace." }],
      };
    }

    const uniqueFiles = Array.from(new Set(matches.map((m) => m.file)));
    const diffs: string[] = [];
    let totalReplaced = 0;

    const { basePath } = resolveTarget(params.path);

    for (const filePath of uniqueFiles) {
      if (totalReplaced >= (params.maxReplacements || 50)) break;

      try {
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath);
        const originalContent = fs.readFileSync(absPath, "utf8");
        const regex =
          params.type === "text"
            ? new RegExp(params.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
            : new RegExp(params.query, "g");

        const modifiedContent = originalContent.replace(regex, params.replacement);
        if (originalContent !== modifiedContent) {
          totalReplaced++;
          const displayPath = formatOutputPath(absPath, basePath);
          diffs.push(buildUnifiedDiff(displayPath, originalContent, modifiedContent));

          if (!isDryRun) {
            fs.writeFileSync(absPath, modifiedContent, "utf8");
          }
        }
      } catch (err) {
        // Skip unreadable files
      }
    }

    const summary = isDryRun
      ? `🔍 [Dry-Run] Previewing ${totalReplaced} replacement(s) across ${diffs.length} file(s). No files were modified.\n\n`
      : `✅ Successfully replaced ${totalReplaced} match(es) across ${diffs.length} file(s).\n\n`;

    return {
      content: [{ type: "text", text: summary + diffs.join("\n\n") }],
    };
  }

  // AST Rewrite mode (ast-grep)
  const result = await runAstGrepRewrite(params);

  if (isDryRun) {
    const output = result.stdout.trim() || "No AST matches found to replace.";
    return {
      content: [
        {
          type: "text",
          text: `🔍 [Dry-Run] AST rewrite preview:\n\n${output}\n\n(To apply changes to disk, run with dryRun: false)`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `✅ AST rewrite applied successfully.\n${result.stdout.trim() || ""}`,
      },
    ],
  };
}
