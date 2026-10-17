import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleCount } from "../dist/handlers/count.js";
import { handleDumpTree } from "../dist/handlers/dumpTree.js";
import { handleListFiles } from "../dist/handlers/listFiles.js";
import { handleFindSymbols } from "../dist/handlers/findSymbols.js";

describe("Auxiliary Tools Tests", () => {
  it("should count matches with ripgrep", async () => {
    const res = await handleCount({
      query: "export",
      type: "text",
      path: "./src",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("Found"), "Should report match count");
  });

  it("should inspect CST using dump_tree", async () => {
    const res = await handleDumpTree({
      code: "const a = 1;",
      language: "typescript",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("Debug CST:"));
    assert.ok(res.content[0].text.includes("lexical_declaration"));
  });

  it("should list files using list_files", async () => {
    const res = await handleListFiles({
      path: "./src",
      filePattern: "*.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("index.ts"));
    assert.ok(res.content[0].text.includes("types.ts"));
  });

  it("should find symbols using find_symbols", async () => {
    const res = await handleFindSymbols({
      name: "handleSearch",
      path: "./src",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("handleSearch"));
  });
});
