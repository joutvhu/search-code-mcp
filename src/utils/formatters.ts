/**
 * Strip ANSI escape codes from string
 */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Truncate a single line if it exceeds maxLen to avoid token blowup
 */
export function truncateLine(line: string, maxLen: number = 500): string {
  if (line.length <= maxLen) return line;
  const excess = line.length - maxLen;
  return line.slice(0, maxLen) + `... [truncated ${excess} chars]`;
}

export interface MatchItem {
  file: string;
  startLine: number;
  endLine?: number;
  content: string;
  [key: string]: any;
}

export interface CacheFormatInfo {
  searchId: string;
  offset?: number;
  nextOffset: number;
  hasMore: boolean;
}

/**
 * Format match items according to requested outputFormat
 */
export function formatMatchItems(
  matches: MatchItem[],
  totalCount: number,
  outputFormat: "content" | "compact" | "files_only" | "json" = "content",
  maxLineLength: number = 500,
  cacheInfo?: CacheFormatInfo
): string {
  if (!matches || matches.length === 0) {
    return "No matches found.";
  }

  const startOffset = cacheInfo?.offset ?? 1;
  const endOffset = startOffset - 1 + matches.length;
  const remaining = Math.max(0, totalCount - endOffset);

  if (outputFormat === "files_only") {
    const uniqueFiles = Array.from(new Set(matches.map((m) => m.file)));
    let output = uniqueFiles.join("\n");
    if (cacheInfo?.hasMore) {
      output +=
        `\n\n─────────────────────────────────────────────────────────────\n` +
        `📌 Showing matches ${startOffset}-${endOffset} of ${totalCount} (${uniqueFiles.length} files in this page).\n` +
        `👉 View more: search({ searchId: "${cacheInfo.searchId}", offset: ${cacheInfo.nextOffset} })`;
    }
    return output;
  }

  if (outputFormat === "json") {
    return JSON.stringify(
      {
        totalMatches: totalCount,
        offset: startOffset,
        showing: matches.length,
        searchId: cacheInfo?.searchId,
        nextOffset: cacheInfo?.hasMore ? cacheInfo.nextOffset : null,
        matches,
      },
      null,
      2
    );
  }

  if (outputFormat === "compact") {
    const lines: string[] = [];
    for (const m of matches) {
      const lineNum = m.startLine;
      const snippet = truncateLine(m.content.split("\n")[0] || "", maxLineLength).trim();
      lines.push(`${m.file}:${lineNum}: ${snippet}`);
    }
    let output = lines.join("\n");
    if (cacheInfo?.hasMore) {
      output +=
        `\n\n─────────────────────────────────────────────────────────────\n` +
        `📌 Showing ${startOffset}-${endOffset} of ${totalCount} matches (${remaining} remaining).\n` +
        `👉 View more: search({ searchId: "${cacheInfo.searchId}", offset: ${cacheInfo.nextOffset} })`;
    }
    return output;
  }

  // "content" format (default)
  const blocks: string[] = [];
  for (const m of matches) {
    const header =
      m.endLine && m.endLine !== m.startLine
        ? `${m.file}:${m.startLine}-${m.endLine}`
        : `${m.file}:${m.startLine}`;

    const contentLines = m.content
      .split("\n")
      .map((l) => truncateLine(l, maxLineLength))
      .join("\n");

    blocks.push(`${header}\n${contentLines}`);
  }

  let result = `Found ${totalCount} matches`;
  if (matches.length < totalCount) {
    result += ` (showing ${startOffset}-${endOffset} of ${totalCount})`;
  }
  result += ":\n\n" + blocks.join("\n\n");

  if (cacheInfo?.hasMore) {
    result +=
      `\n\n─────────────────────────────────────────────────────────────\n` +
      `📌 ${remaining} more matches remaining.\n` +
      `👉 View next: search({ searchId: "${cacheInfo.searchId}", offset: ${cacheInfo.nextOffset} })`;
  }

  return result;
}

interface DiffOp {
  type: "equal" | "delete" | "insert";
  oldLine?: string;
  newLine?: string;
  oldNum?: number;
  newNum?: number;
}

/**
 * Compute line-level diff operations using LCS over trimmed prefix/suffix
 */
function computeLineDiffOps(origLines: string[], modLines: string[]): DiffOp[] {
  let prefix = 0;
  const minLen = Math.min(origLines.length, modLines.length);
  while (prefix < minLen && origLines[prefix] === modLines[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    origLines[origLines.length - 1 - suffix] === modLines[modLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ type: "equal", oldLine: origLines[i], newLine: modLines[i], oldNum: i + 1, newNum: i + 1 });
  }

  const midOrig = origLines.slice(prefix, origLines.length - suffix);
  const midMod = modLines.slice(prefix, modLines.length - suffix);

  if (midOrig.length * midMod.length <= 40_000) {
    // Standard DP LCS on the changed middle region
    const m = midOrig.length;
    const n = midMod.length;
    const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (midOrig[i] === midMod[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midOrig[i] === midMod[j]) {
        ops.push({
          type: "equal",
          oldLine: midOrig[i],
          newLine: midMod[j],
          oldNum: prefix + i + 1,
          newNum: prefix + j + 1,
        });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: "delete", oldLine: midOrig[i], oldNum: prefix + i + 1 });
        i++;
      } else {
        ops.push({ type: "insert", newLine: midMod[j], newNum: prefix + j + 1 });
        j++;
      }
    }
    while (i < m) {
      ops.push({ type: "delete", oldLine: midOrig[i], oldNum: prefix + i + 1 });
      i++;
    }
    while (j < n) {
      ops.push({ type: "insert", newLine: midMod[j], newNum: prefix + j + 1 });
      j++;
    }
  } else {
    // Fallback for huge middle diffs to stay O(N)
    for (let i = 0; i < midOrig.length; i++) {
      ops.push({ type: "delete", oldLine: midOrig[i], oldNum: prefix + i + 1 });
    }
    for (let j = 0; j < midMod.length; j++) {
      ops.push({ type: "insert", newLine: midMod[j], newNum: prefix + j + 1 });
    }
  }

  const tailOrigStart = origLines.length - suffix;
  const tailModStart = modLines.length - suffix;
  for (let k = 0; k < suffix; k++) {
    ops.push({
      type: "equal",
      oldLine: origLines[tailOrigStart + k],
      newLine: modLines[tailModStart + k],
      oldNum: tailOrigStart + k + 1,
      newNum: tailModStart + k + 1,
    });
  }

  return ops;
}

/**
 * Generate Unified Diff string with ±3 context hunks for replace previews
 */
export function buildUnifiedDiff(
  filePath: string,
  originalText: string,
  modifiedText: string,
  contextLines: number = 3
): string {
  const origLines = originalText.split(/\r?\n/);
  const modLines = modifiedText.split(/\r?\n/);
  const ops = computeLineDiffOps(origLines, modLines);

  const changeIndices: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "equal") {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) {
    return "";
  }

  // Group nearby changes into unified diff hunks
  const hunks: Array<{ startIdx: number; endIdx: number }> = [];
  for (const idx of changeIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const prev = hunks[hunks.length - 1];
    if (prev && start <= prev.endIdx + 1) {
      prev.endIdx = end;
    } else {
      hunks.push({ startIdx: start, endIdx: end });
    }
  }

  const output: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (const hunk of hunks) {
    const slice = ops.slice(hunk.startIdx, hunk.endIdx + 1);
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;

    for (const op of slice) {
      if (op.type === "equal" || op.type === "delete") {
        if (oldStart === 0 && op.oldNum) oldStart = op.oldNum;
        oldCount++;
      }
      if (op.type === "equal" || op.type === "insert") {
        if (newStart === 0 && op.newNum) newStart = op.newNum;
        newCount++;
      }
    }

    if (oldStart === 0) oldStart = 1;
    if (newStart === 0) newStart = 1;

    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) {
      if (op.type === "equal") {
        output.push(` ${truncateLine(op.oldLine ?? "", 500)}`);
      } else if (op.type === "delete") {
        output.push(`-${truncateLine(op.oldLine ?? "", 500)}`);
      } else {
        output.push(`+${truncateLine(op.newLine ?? "", 500)}`);
      }
    }
  }

  return output.join("\n");
}
