import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSearch } from "../.test-dist/handlers/search.js";

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

  it("should perform symbol search", async () => {
    const res = await handleSearch({
      query: "resolveTarget",
      type: "symbol",
      path: "./src/utils/paths.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("resolveTarget"));
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
});
