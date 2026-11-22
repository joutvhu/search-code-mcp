import fs from "node:fs";
import path from "node:path";
import { ReplaceParams } from "../types.js";
import { runAstGrepRewrite } from "../engines/astgrep.js";
import { buildUnifiedDiff } from "../utils/formatters.js";
import { runRipgrepFilesWithMatches } from "../engines/ripgrep.js";
import { resolveTarget, formatOutputPath } from "../utils/paths.js";

export async function handleReplace(params: ReplaceParams) {
  if (!params.query) {
    return {
      isError: true,
      content: [{ type: "text", text: "Error: 'query' parameter is required and cannot be empty for replace." }],
    };
  }

  const isDryRun = params.dryRun !== false;
  const maxLimit = params.maxReplacements ?? 50;

  if (params.type === "regex" || params.type === "text") {
    const isMultiline =
      params.type === "regex" &&
      (params.multiline === true ||
        params.query.includes("\n") ||
        /\\n|\\[sSwWdD]/.test(params.query));

    // Validate regex upfront so invalid JS RegExp fails loudly instead of silently
    let regex: RegExp;
    const baseFlags = params.type === "text" ? "g" : (isMultiline ? "gms" : "gm");
    const flags = params.caseSensitive === false ? `${baseFlags}i` : baseFlags;
    if (params.type === "text") {
      regex = new RegExp(params.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } else {
      regex = new RegExp(params.query, flags);
    }

    const candidateFiles = await runRipgrepFilesWithMatches({
      path: params.path,
      query: params.query,
      type: params.type,
      filePattern: params.filePattern,
      excludePattern: params.excludePattern,
      caseSensitive: params.caseSensitive ?? true,
      multiline: isMultiline,
      noIgnore: params.noIgnore,
      includeHidden: params.includeHidden,
    });

    if (candidateFiles.length === 0) {
      return {
        content: [{ type: "text", text: "No matches found to replace." }],
      };
    }

    const uniqueFiles = Array.from(new Set(candidateFiles));
    const diffs: string[] = [];
    let totalReplaced = 0;
    let truncatedByLimit = false;

    const { basePath } = resolveTarget(params.path);

    for (const filePath of uniqueFiles) {
      if (totalReplaced >= maxLimit) {
        truncatedByLimit = true;
        break;
      }

      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath);
      const originalContent = fs.readFileSync(absPath, "utf8");

      let fileReplacements = 0;
      const modifiedContent = originalContent.replace(regex, (...args) => {
        const fullMatch = args[0] as string;
        let repStr = params.replacement;

        if (params.type !== "text") {
          // Emulate standard String.prototype.replace substitution ($&, $$, $`, $', $1..$n, $<name>)
          const offset = args[args.length - 2] as number;
          const input = args[args.length - 1] as string;
          const maybeGroups = typeof args[args.length - 1] === "object" ? (args[args.length - 1] as Record<string, string>) : undefined;
          const captureArgs = maybeGroups ? args.slice(1, -3) : args.slice(1, -2);
          const srcStr = maybeGroups ? (args[args.length - 2] as string) : input;
          const matchOffset = maybeGroups ? (args[args.length - 3] as number) : offset;

          repStr = params.replacement.replace(/\$(?:\$|&|`|'|\d{1,2}|<([^>]+)>)/g, (token, groupName) => {
            if (token === "$$") return "$";
            if (token === "$&") return fullMatch;
            if (token === "$`") return srcStr.slice(0, matchOffset);
            if (token === "$'") return srcStr.slice(matchOffset + fullMatch.length);
            if (groupName) return maybeGroups?.[groupName] ?? "";

            const numStr = token.slice(1);
            const idx = parseInt(numStr, 10);
            if (idx >= 1 && idx <= captureArgs.length) {
              return captureArgs[idx - 1] ?? "";
            }
            // If 2 digits, fallback to $1 + "0" if single digit exists
            if (numStr.length === 2) {
              const firstDigit = parseInt(numStr[0], 10);
              if (firstDigit >= 1 && firstDigit <= captureArgs.length) {
                return (captureArgs[firstDigit - 1] ?? "") + numStr[1];
              }
            }
            return token;
          });
        }

        if (repStr === fullMatch) {
          return fullMatch;
        }

        if (totalReplaced + fileReplacements >= maxLimit) {
          truncatedByLimit = true;
          return fullMatch;
        }
        fileReplacements++;
        return repStr;
      });

      if (fileReplacements > 0 && originalContent !== modifiedContent) {
        totalReplaced += fileReplacements;
        const displayPath = formatOutputPath(absPath, basePath);
        const diff = buildUnifiedDiff(displayPath, originalContent, modifiedContent);
        if (diff) diffs.push(diff);

        if (!isDryRun) {
          fs.writeFileSync(absPath, modifiedContent, "utf8");
        }
      }
    }

    if (totalReplaced === 0) {
      return {
        content: [{ type: "text", text: "No matches found to replace." }],
      };
    }

    const limitNote = truncatedByLimit
      ? `\n⚠️ Stopped at maxReplacements safety cap (${maxLimit}). Narrow 'path' or increase 'maxReplacements' for remaining matches.`
      : "";

    const summary = isDryRun
      ? `🔍 [Dry-Run] Previewing ${totalReplaced} replacement(s) across ${diffs.length} file(s). No files were modified.${limitNote}\n\n`
      : `✅ Successfully applied ${totalReplaced} replacement(s) across ${diffs.length} file(s).${limitNote}\n\n`;

    const footer = isDryRun ? "\n\n(To apply changes to disk, run again with dryRun: false)" : "";

    return {
      content: [{ type: "text", text: summary + diffs.join("\n\n") + footer }],
    };
  }

  // AST Rewrite mode (ast-grep)
  const result = await runAstGrepRewrite(params);

  if (result.totalMatchesFound === 0 || result.diffs.length === 0) {
    return {
      content: [{ type: "text", text: "No AST matches found to replace." }],
    };
  }

  const limitNote = result.truncatedByLimit
    ? `\n⚠️ Capped at maxReplacements (${maxLimit} of ${result.totalMatchesFound} total matches). Narrow 'path' or increase 'maxReplacements' for remaining matches.`
    : "";

  if (isDryRun) {
    return {
      content: [
        {
          type: "text",
          text:
            `🔍 [Dry-Run] Previewing ${result.appliedReplacements} AST replacement(s) across ${result.modifiedFiles.length} file(s). No files were modified.${limitNote}\n\n` +
            result.diffs.join("\n\n") +
            "\n\n(To apply changes to disk, run again with dryRun: false)",
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text:
          `✅ Successfully applied ${result.appliedReplacements} AST replacement(s) across ${result.modifiedFiles.length} file(s).${limitNote}\n\n` +
          result.diffs.join("\n\n"),
      },
    ],
  };
}
