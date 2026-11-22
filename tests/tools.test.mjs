import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { handleCount } from "../.test-dist/handlers/count.js";
import { handleDumpTree } from "../.test-dist/handlers/dumpTree.js";
import { handleListFiles } from "../.test-dist/handlers/listFiles.js";
import { handleFindSymbols } from "../.test-dist/handlers/findSymbols.js";

describe("Auxiliary Tools Tests", () => {
  it("should count matches with ripgrep including filename on single file", async () => {
    const res = await handleCount({
      query: "handleSearch",
      type: "text",
      path: "./src/index.ts",
      perFile: true,
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("index.ts:"), "Should include filename for single-file perFile count");
  });

  it("should count AST matches with excludePattern", async () => {
    const res = await handleCount({
      query: "const $NAME = $A ? $B : $C",
      type: "ast",
      path: "./src",
      language: "typescript",
      excludePattern: "**/formatters.ts",
      perFile: true,
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("paths.ts"));
    assert.ok(!res.content[0].text.includes("formatters.ts"));
  });

  it("should inspect CST, AST, and pattern using dump_tree", async () => {
    const cstRes = await handleDumpTree({
      code: "const a = 1;",
      language: "typescript",
      format: "cst",
    });
    assert.ok(!cstRes.isError);
    assert.ok(cstRes.content[0].text.includes("lexical_declaration"));

    const astRes = await handleDumpTree({
      code: "const a = 1;",
      language: "typescript",
      format: "ast",
    });
    assert.ok(!astRes.isError);
    assert.ok(astRes.content[0].text.includes("lexical_declaration"));

    const patRes = await handleDumpTree({
      code: "const $A = $B;",
      language: "typescript",
      format: "pattern",
    });
    assert.ok(!patRes.isError);
    assert.ok(patRes.content[0].text.includes("MetaVar"));
  });

  it("should list files and return empty message when no files match", async () => {
    const res = await handleListFiles({
      path: "./src",
      filePattern: "*.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("index.ts"));
    assert.ok(res.content[0].text.includes("types.ts"));

    const emptyRes = await handleListFiles({
      path: "./src",
      filePattern: "*.nonexistent_ext_xyz",
    });
    assert.ok(!emptyRes.isError);
    assert.equal(emptyRes.content[0].text, "No files found matching criteria.");
  });

  it("should list files with includeHidden and exclude .git directory", async () => {
    const res = await handleListFiles({
      path: ".",
      includeHidden: true,
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes(".gitignore"), "Should include .gitignore");
    assert.ok(!res.content[0].text.includes(".git/objects") && !res.content[0].text.includes(".git\\objects"), "Should exclude .git objects");
  });

  it("should filter out local variables by default in find_symbols outline", async () => {
    const res = await handleFindSymbols({
      path: "./src/handlers/search.ts",
      name: "",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("handleSearch"));
    // Local variables like "cached", "seen", "val", "m" inside handleSearch should be excluded by default
    assert.ok(!res.content[0].text.includes("[variable] cached") && !res.content[0].text.includes("[variable] seen"));
  });

  it("should find symbols and respect kinds filter", async () => {
    const res = await handleFindSymbols({
      name: "handleSearch",
      path: "./src",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("handleSearch"));

    // Asking for class only should not return function handleSearch
    const filtered = await handleFindSymbols({
      name: "handleSearch",
      path: "./src",
      kinds: ["class"],
    });
    assert.ok(!filtered.isError);
    assert.ok(filtered.content[0].text.includes("No symbols found"));
  });

  it("should use smart-case in count matching search behavior", async () => {
    const res = await handleCount({
      query: "handlesearch",
      type: "text",
      path: "./src/index.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("Found 2 match(es)"));
  });

  it("should filter find_symbols by filePattern and classify type alias as type", async () => {
    const res = await handleFindSymbols({
      name: "SearchParams",
      path: "./src/types.ts",
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("SearchParams"));
    assert.ok(res.content[0].text.includes("[type]"), "SearchParams should be classified as type, not other");

    const noMatchRes = await handleFindSymbols({
      name: "SearchParams",
      path: "./src",
      filePattern: "*.json",
    });

    assert.ok(!noMatchRes.isError);
    assert.ok(noMatchRes.content[0].text.includes("No symbols found"));
  });

  it("should serve valid MCP stdio protocol from bundled dist/index.js", async () => {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`MCP stdio timeout. stderr: ${stderr}`));
      }, 5000);

      proc.stdout.on("data", (d) => {
        stdout += d.toString();
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        if (lines.length >= 3) {
          clearTimeout(timer);
          proc.kill();
          resolve(lines.map((l) => JSON.parse(l)));
        }
      });
      proc.stderr.on("data", (d) => {
        stderr += d.toString();
      });

      proc.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        }) + "\n"
      );
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "count", arguments: { query: "registerTool", type: "text", path: "src/index.ts" } },
        }) + "\n"
      );
    });

    const [initMsg, listMsg, callMsg] = result;
    assert.equal(initMsg.result.serverInfo.name, "search-code-mcp");
    assert.ok(initMsg.result.serverInfo.description.length > 20);
    assert.ok(initMsg.result.instructions.includes("search-code"));

    assert.equal(listMsg.result.tools.length, 6);
    const searchTool = listMsg.result.tools.find((t) => t.name === "search");
    const replaceTool = listMsg.result.tools.find((t) => t.name === "replace");
    assert.equal(searchTool.annotations.readOnlyHint, true);
    assert.equal(replaceTool.annotations.destructiveHint, true);

    assert.ok(!callMsg.result.isError);
    assert.ok(callMsg.result.content[0].text.includes("6 match(es)"));
  });
});
