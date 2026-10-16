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

/**
 * Format match items according to requested outputFormat
 */
export function formatMatchItems(
  matches: MatchItem[],
  totalCount: number,
  outputFormat: "content" | "compact" | "files_only" | "json" = "content",
  maxLineLength: number = 500,
  cacheInfo?: { searchId: string; nextOffset: number; hasMore: boolean }
): string {
  if (!matches || matches.length === 0) {
    return "No matches found.";
  }

  if (outputFormat === "files_only") {
    const uniqueFiles = Array.from(new Set(matches.map((m) => m.file)));
    let output = uniqueFiles.join("\n");
    if (cacheInfo?.hasMore) {
      output += `\n\n─────────────────────────────────────────────────────────────\n` +
        `📌 Showing ${uniqueFiles.length} files (total ${totalCount} matches).\n` +
        `👉 View more: search({ searchId: "${cacheInfo.searchId}", offset: ${cacheInfo.nextOffset} })`;
    }
    return output;
  }

  if (outputFormat === "json") {
    return JSON.stringify(
      {
        totalMatches: totalCount,
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
      output += `\n\n─────────────────────────────────────────────────────────────\n` +
        `📌 Showing ${matches.length} of ${totalCount} matches.\n` +
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
    result += ` (showing ${matches.length} of ${totalCount})`;
  }
  result += ":\n\n" + blocks.join("\n\n");

  if (cacheInfo?.hasMore) {
    const remaining = totalCount - matches.length;
    result += `\n\n─────────────────────────────────────────────────────────────\n` +
      `📌 ${remaining} more matches remaining.\n` +
      `👉 View next: search({ searchId: "${cacheInfo.searchId}", offset: ${cacheInfo.nextOffset} })`;
  }

  return result;
}

/**
 * Generate Unified Diff string for replace previews
 */
export function buildUnifiedDiff(
  filePath: string,
  originalText: string,
  modifiedText: string
): string {
  const origLines = originalText.split("\n");
  const modLines = modifiedText.split("\n");

  const diffLines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${origLines.length} +1,${modLines.length} @@`,
  ];

  const maxLines = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = origLines[i];
    const newLine = modLines[i];

    if (oldLine === newLine) {
      if (oldLine !== undefined) diffLines.push(` ${oldLine}`);
    } else {
      if (oldLine !== undefined) diffLines.push(`-${oldLine}`);
      if (newLine !== undefined) diffLines.push(`+${newLine}`);
    }
  }

  return diffLines.join("\n");
}
