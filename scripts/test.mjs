import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const testDistDir = path.join(rootDir, ".test-dist");

function runNode(args) {
  const res = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

try {
  fs.rmSync(testDistDir, { recursive: true, force: true });

  const tscEntry = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
  runNode([tscEntry, "--outDir", ".test-dist", "--declaration", "false"]);
  runNode(["--test", "tests/search.test.mjs", "tests/replace.test.mjs", "tests/tools.test.mjs"]);
} finally {
  fs.rmSync(testDistDir, { recursive: true, force: true });
}
