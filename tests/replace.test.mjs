import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleReplace } from "../.test-dist/handlers/replace.js";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "search-code-mcp-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Replace Handler Tests", () => {
  it("should generate unified diff preview for AST rewrite in dryRun mode", async () => {
    const res = await handleReplace({
      query: "const $NAME = $A ? $B : $C",
      replacement: "let $NAME = $A ? $B : $C",
      type: "ast",
      path: "./src/utils/paths.ts",
      dryRun: true,
    });

    assert.ok(!res.isError, "Replace should not return error");
    const text = res.content[0].text;
    assert.ok(text.includes("[Dry-Run]"), "Should indicate dry-run mode");
    assert.ok(text.includes("--- a/"), "Should include unified diff header");
    assert.ok(text.includes("+++ b/"), "Should include unified diff target header");
    assert.ok(text.includes("@@"), "Should include unified diff hunk header");
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

  it("should treat $ sequences literally in text replacement mode", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "sample.ts");
    fs.writeFileSync(file, 'const msg = "OLD_TOKEN";\n', "utf8");

    const res = await handleReplace({
      query: "OLD_TOKEN",
      replacement: "$1$&$$",
      type: "text",
      path: file,
      dryRun: false,
    });

    assert.ok(!res.isError);
    assert.equal(fs.readFileSync(file, "utf8"), 'const msg = "$1$&$$";\n');
  });

  it("should enforce maxReplacements by match count in both text and AST modes", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "multi.ts");
    fs.writeFileSync(
      file,
      [
        "console.log(1);",
        "console.log(2);",
        "console.log(3);",
        "console.log(4);",
      ].join("\n") + "\n",
      "utf8"
    );

    // AST mode capped at 2
    const astRes = await handleReplace({
      query: "console.log($X)",
      replacement: "logger.info($X)",
      type: "ast",
      path: file,
      maxReplacements: 2,
      dryRun: false,
    });

    assert.ok(!astRes.isError);
    assert.ok(astRes.content[0].text.includes("2 AST replacement(s)"));
    assert.equal(
      fs.readFileSync(file, "utf8"),
      [
        "logger.info(1);",
        "logger.info(2);",
        "console.log(3);",
        "console.log(4);",
      ].join("\n") + "\n"
    );

    // Regex mode capped at 1
    const rxRes = await handleReplace({
      query: "console\\.log\\((\\d+)\\)",
      replacement: "logger.warn($1)",
      type: "regex",
      path: file,
      maxReplacements: 1,
      dryRun: false,
    });

    assert.ok(!rxRes.isError);
    assert.ok(rxRes.content[0].text.includes("1 replacement(s)"));
    assert.equal(
      fs.readFileSync(file, "utf8"),
      [
        "logger.warn(1);",
        "logger.info(2);",
        "logger.warn(3);",
        "console.log(4);",
      ].join("\n")
        .replace("logger.warn(1);", "logger.info(1);") + "\n"
    );
  });

  it("should respect excludePattern in AST replace mode", async () => {
    const dir = makeTempDir();
    const mainFile = path.join(dir, "app.ts");
    const testFile = path.join(dir, "app.test.ts");
    fs.writeFileSync(mainFile, "console.log('a');\n", "utf8");
    fs.writeFileSync(testFile, "console.log('b');\n", "utf8");

    const res = await handleReplace({
      query: "console.log($X)",
      replacement: "logger.info($X)",
      type: "ast",
      path: dir,
      language: "typescript",
      excludePattern: "**/*.test.ts",
      dryRun: false,
    });

    assert.ok(!res.isError);
    assert.equal(fs.readFileSync(mainFile, "utf8"), "logger.info('a');\n");
    assert.equal(fs.readFileSync(testFile, "utf8"), "console.log('b');\n");
  });

  it("should replace all matching lines when using multiline anchors in regex mode", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "multiline-anchors.ts");
    fs.writeFileSync(
      file,
      [
        "import a from 'a';",
        "const x = 1;",
        "import b from 'b';",
      ].join("\n") + "\n",
      "utf8"
    );

    const res = await handleReplace({
      query: "^import ",
      replacement: "// import ",
      type: "regex",
      path: file,
      dryRun: false,
    });

    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("2 replacement(s)"));
    assert.equal(
      fs.readFileSync(file, "utf8"),
      [
        "// import a from 'a';",
        "const x = 1;",
        "// import b from 'b';",
      ].join("\n") + "\n"
    );
  });

  it("should replace $10 as $1 followed by literal 0 when only 1 capture group exists", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "backref.ts");
    fs.writeFileSync(file, 'const val = "test";\n', "utf8");

    const res = await handleReplace({
      query: '"(test)"',
      replacement: '"$10"',
      type: "regex",
      path: file,
      dryRun: false,
    });

    assert.ok(!res.isError);
    assert.equal(fs.readFileSync(file, "utf8"), 'const val = "test0";\n');
  });

  it("should replace multiline pattern across newlines in regex mode", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "multiline-replace.ts");
    fs.writeFileSync(file, "foo\nbar\n", "utf8");

    const res = await handleReplace({
      query: "foo\\nbar",
      replacement: "foobar",
      type: "regex",
      path: file,
      dryRun: false,
    });

    assert.ok(!res.isError);
    assert.equal(fs.readFileSync(file, "utf8"), "foobar\n");
  });

  it("should throw error on invalid regex in regex replace mode", async () => {
    await assert.rejects(
      () =>
        handleReplace({
          query: "(unclosed",
          replacement: "x",
          type: "regex",
          path: "./src/index.ts",
          dryRun: true,
        }),
      /Invalid regular expression|SyntaxError/i
    );
  });

  it("should reject empty query for replace", async () => {
    const res = await handleReplace({
      query: "",
      replacement: "bar",
      type: "text",
      path: "./src/index.ts",
      dryRun: true,
    });

    assert.equal(res.isError, true);
    assert.ok(res.content[0].text.includes("cannot be empty"));
  });

  it("should support case-insensitive replacement when caseSensitive is false", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "case.ts");
    fs.writeFileSync(file, "Hello WORLD\n", "utf8");

    const res = await handleReplace({
      query: "world",
      replacement: "there",
      type: "text",
      path: file,
      caseSensitive: false,
      dryRun: false,
    });

    assert.ok(!res.isError);
    assert.equal(fs.readFileSync(file, "utf8"), "Hello there\n");
  });

  it("should support multiline regex replacement with [\\w\\W] and explicit multiline option", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "block.ts");
    fs.writeFileSync(file, "/*start*/\nhello\n/*end*/\n", "utf8");

    const res = await handleReplace({
      query: "/\\*start\\*/[\\w\\W]*?/\\*end\\*/",
      replacement: "/*replaced*/",
      type: "regex",
      path: dir,
      multiline: true,
      dryRun: false,
    });

    assert.ok(!res.isError);
    assert.equal(fs.readFileSync(file, "utf8"), "/*replaced*/\n");
  });

  it("should support includeHidden in replace across text and ast modes while excluding .git", async () => {
    const dir = makeTempDir();
    const hiddenDir = path.join(dir, ".hidden");
    const gitDir = path.join(dir, ".git");
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.mkdirSync(gitDir, { recursive: true });

    const hiddenFile = path.join(hiddenDir, "config.ts");
    const gitFile = path.join(gitDir, "info.ts");
    fs.writeFileSync(hiddenFile, "const flag = OLD_VAL;\n", "utf8");
    fs.writeFileSync(gitFile, "const flag = OLD_VAL;\n", "utf8");

    const defaultRes = await handleReplace({
      query: "OLD_VAL",
      replacement: "NEW_VAL",
      type: "text",
      path: dir,
      dryRun: false,
    });
    assert.ok(defaultRes.content[0].text.includes("No matches found"));
    assert.equal(fs.readFileSync(hiddenFile, "utf8"), "const flag = OLD_VAL;\n");

    const hiddenAstRes = await handleReplace({
      query: "const flag = OLD_VAL;",
      replacement: "const flag = NEW_VAL;",
      type: "ast",
      path: dir,
      language: "typescript",
      includeHidden: true,
      dryRun: false,
    });
    assert.ok(!hiddenAstRes.isError);
    assert.equal(fs.readFileSync(hiddenFile, "utf8"), "const flag = NEW_VAL;\n");
    assert.equal(fs.readFileSync(gitFile, "utf8"), "const flag = OLD_VAL;\n");

    const hiddenTextRes = await handleReplace({
      query: "NEW_VAL",
      replacement: "FINAL_VAL",
      type: "text",
      path: dir,
      includeHidden: true,
      dryRun: false,
    });
    assert.ok(!hiddenTextRes.isError);
    assert.equal(fs.readFileSync(hiddenFile, "utf8"), "const flag = FINAL_VAL;\n");
    assert.equal(fs.readFileSync(gitFile, "utf8"), "const flag = OLD_VAL;\n");
  });
});
