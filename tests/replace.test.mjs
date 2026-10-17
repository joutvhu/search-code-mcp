import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleReplace } from "../dist/handlers/replace.js";

describe("Replace Handler Tests", () => {
  it("should generate AST rewrite preview in dryRun mode", async () => {
    const res = await handleReplace({
      query: "const $NAME = $A ? $B : $C",
      replacement: "let $NAME = $A ? $B : $C",
      type: "ast",
      path: "./src/utils/paths.ts",
      dryRun: true,
    });

    assert.ok(!res.isError, "Replace should not return error");
    assert.ok(res.content && res.content[0]?.text, "Should have text content");
    assert.ok(res.content[0].text.includes("[Dry-Run]"), "Should indicate dry-run mode");
    assert.ok(res.content[0].text.includes("replacement"), "Should contain replacement preview");
  });

  it("should generate regex replacement unified diff in dryRun mode", async () => {
    const res = await handleReplace({
      query: "export function isRelativePathsEnabled",
      replacement: "export function checkRelativePaths",
      type: "regex",
      path: "./src/utils/paths.ts",
      dryRun: true,
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("[Dry-Run]"));
    assert.ok(res.content[0].text.includes("-export function isRelativePathsEnabled"));
    assert.ok(res.content[0].text.includes("+export function checkRelativePaths"));
  });
});
