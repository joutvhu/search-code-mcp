import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSearch } from "../dist/handlers/search.js";

describe("Search Handler Tests", () => {
  it("should perform text search with ripgrep", async () => {
    const res = await handleSearch({
      query: "handleSearch",
      type: "text",
      path: "./src",
    });

    assert.ok(!res.isError, "Search should not return error");
    assert.ok(res.content && res.content[0]?.text, "Should have text content");
    assert.ok(res.content[0].text.includes("handleSearch"), "Result should contain match");
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

  it("should support pagination caching", async () => {
    // Search with limit 1 to trigger pagination cache
    const firstPage = await handleSearch({
      query: "export",
      type: "text",
      path: "./src",
      limit: 1,
    });

    assert.ok(!firstPage.isError);
    const text = firstPage.content[0].text;
    assert.ok(text.includes("searchId:"), "Should provide searchId hint");

    // Extract searchId
    const match = text.match(/searchId:\s*"([^"]+)"/);
    assert.ok(match && match[1], "Should have a searchId");
    const searchId = match[1];

    // Fetch next page with searchId
    const nextPage = await handleSearch({
      searchId,
      offset: 2,
      limit: 1,
      path: "./src",
    });

    assert.ok(!nextPage.isError);
    assert.ok(nextPage.content[0].text.includes("Found"), "Should return cached results");
  });
});
