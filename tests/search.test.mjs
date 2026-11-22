import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSearch } from "../.test-dist/handlers/search.js";
import { globToRegExp } from "../.test-dist/utils/paths.js";

describe("Search Handler Tests", () => {
  it("should perform text search with ripgrep", async () => {
    const res = await handleSearch({
      query: "handleSearch",
      type: "text",
      path: "./src",
    });

    assert.ok(!res.isError, "Search should not return error");
    assert.ok(res.content?.[0]?.text.includes("handleSearch"), "Result should contain match");
  });

  it("should safely search queries starting with dashes without hanging or flag injection", async () => {
    const res = await handleSearch({
      query: "--no-ignore",
      type: "text",
      path: "./src/engines/ripgrep.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("--no-ignore"), "Should find literal --no-ignore flag");
  });

  it("should preserve context lines even when path contains hyphens", async () => {
    const res = await handleSearch({
      query: "handleSearch",
      type: "text",
      path: "./src/index.ts",
      context: 1,
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("handleReplace"), "Should include neighboring context lines");
  });

  it("should not bleed context lines between distant matches in same file", async () => {
    const res = await handleSearch({
      query: "safeSpawn",
      type: "text",
      path: "./src/engines/astgrep.ts",
      context: 2,
    });

    assert.ok(!res.isError);
    const text = res.content[0].text;
    // Line 3 is import { safeSpawn }... neighboring lines 1-5
    // Line 121 is inside runAstGrepPattern
    // Line 121's context before should NOT bleed into Line 3's context after
    assert.ok(text.includes("> 3:"));
    assert.ok(text.includes("> 118:"));
    assert.ok(!text.includes("117-   try {\n\nsrc"), "Context lines of next match should not be attached to match at line 3");
  });

  it("should use smart-case when caseSensitive is omitted", async () => {
    const res = await handleSearch({
      query: "handlesearch",
      type: "text",
      path: "./src/index.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("handleSearch"), "Lowercase query should match mixed-case with smart-case");
  });

  it("should perform regex search with ripgrep", async () => {
    const res = await handleSearch({
      query: "export\\s+async\\s+function\\s+handleSearch",
      type: "regex",
      path: "./src",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("export async function handleSearch"));
  });

  it("should perform AST search with ast-grep", async () => {
    const res = await handleSearch({
      query: "const $NAME = $A ? $B : $C",
      type: "ast",
      path: "./src/utils/paths.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("Found"), "Should find matches");
    assert.ok(res.content[0].text.includes("paths.ts"));
  });

  it("should perform YAML rule search with ast-grep", async () => {
    const yamlRule = `
id: ternary-search
language: typescript
rule:
  pattern: "const $NAME = $A ? $B : $C"
`;

    const res = await handleSearch({
      query: yamlRule,
      type: "ast_rule",
      path: "./src/utils/paths.ts",
    });

    assert.ok(!res.isError, `YAML rule error: ${res.content?.[0]?.text}`);
    assert.ok(res.content[0].text.includes("Found"), "Should find matches with YAML rule");
  });

  it("should perform hybrid search", async () => {
    const res = await handleSearch({
      query: "const $NAME = $A ? $B : $C",
      type: "hybrid",
      path: "./src/utils",
      language: "typescript",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("Found"));
  });

  it("should support pagination caching across subdirectories even when follow-up omits path", async () => {
    const firstPage = await handleSearch({
      query: "export",
      type: "text",
      path: "./src",
      limit: 1,
    });

    assert.ok(!firstPage.isError);
    const text = firstPage.content[0].text;
    assert.ok(text.includes("searchId:"), "Should provide searchId hint");

    const match = text.match(/searchId:\s*"([^"]+)"/);
    assert.ok(match?.[1], "Should have a searchId");
    const searchId = match[1];

    // Follow-up omits 'path' just like the pagination hint suggests
    const nextPage = await handleSearch({
      searchId,
      offset: 2,
      limit: 2,
    });

    assert.ok(!nextPage.isError, `Pagination failed: ${nextPage.content?.[0]?.text}`);
    assert.ok(nextPage.content[0].text.includes("showing 2-3 of"), "Should show accurate range 2-3");
  });

  it("should reject invalid or traversal searchId cleanly", async () => {
    const res = await handleSearch({
      searchId: "../../package",
      offset: 1,
    });

    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.includes("expired or not found"));
  });

  it("should handle brace expansion in filePattern for ast-grep and ripgrep", async () => {
    const res = await handleSearch({
      query: "const $A = $B",
      type: "ast",
      path: "./src",
      language: "typescript",
      filePattern: "*.{ts,tsx}",
      limit: 2,
    });

    assert.ok(!res.isError, `Should not error on brace glob: ${res.content?.[0]?.text}`);
    assert.ok(res.content[0].text.includes("Found"));
  });

  it("should match brace expansion with wildcard using globToRegExp", () => {
    const rx = globToRegExp("{*.ts,*.js}");
    assert.ok(rx.test("foo.ts"));
    assert.ok(rx.test("bar.js"));
    assert.ok(!rx.test("baz.json"));
  });

  it("should return valid JSON when search has 0 matches with outputFormat json", async () => {
    const res = await handleSearch({
      query: "nonexistent_pattern_random_xyz_987",
      type: "text",
      path: "./src",
      outputFormat: "json",
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.totalMatches, 0);
    assert.deepEqual(parsed.matches, []);
  });

  it("should paginate files_only format by unique files", async () => {
    const res = await handleSearch({
      query: "export",
      type: "text",
      path: "./src",
      outputFormat: "files_only",
      limit: 3,
    });

    assert.ok(!res.isError);
    const lines = res.content[0].text.split("\n").filter((l) => l && !l.startsWith("─") && !l.startsWith("📌") && !l.startsWith("👉"));
    assert.equal(lines.length, 3, "Should show 3 distinct files");
    assert.ok(res.content[0].text.includes("Showing files 1-3 of"));
  });
});
