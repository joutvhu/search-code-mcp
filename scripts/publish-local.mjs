import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";

function runNpm(args, options = {}) {
  const cmd = isWin ? "cmd.exe" : "npm";
  const cmdArgs = isWin ? ["/c", "npm", ...args] : args;
  return spawnSync(cmd, cmdArgs, {
    cwd: rootDir,
    ...options,
  });
}

function printHelp() {
  console.log(`
Usage:
  npm run publish:local [options]
  node scripts/publish-local.mjs [options]

Options:
  --dry-run       Preview packaged files and sizes without installing globally
  --pack-only     Build and pack the .tgz archive locally without installing globally
  --keep-pack     Keep the generated .tgz archive after global installation
  --uninstall     Uninstall the package from global npm (npm uninstall -g)
  -h, --help      Show this help message
`);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseJsonFromOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || start >= end) {
    throw new Error(`Failed to parse JSON from npm output:\n${output}`);
  }
  return JSON.parse(output.slice(start, end + 1));
}

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  printHelp();
  process.exit(0);
}

const isDryRun = args.includes("--dry-run");
const isPackOnly = args.includes("--pack-only");
const keepPack = args.includes("--keep-pack");
const isUninstall = args.includes("--uninstall") || args.includes("--clean");

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

if (isUninstall) {
  console.log(`\nUninstalling ${pkg.name} from global npm...`);
  const uninstRes = runNpm(["uninstall", "-g", pkg.name], { stdio: "inherit" });
  if (uninstRes.status !== 0) {
    console.error(`\nFailed to uninstall ${pkg.name} globally.`);
    process.exit(uninstRes.status ?? 1);
  }
  console.log(`\nSuccessfully uninstalled ${pkg.name} globally.`);
  process.exit(0);
}

console.log(`\n=== 1. Building ${pkg.name} v${pkg.version} ===`);
const buildRes = runNpm(["run", "build"], { stdio: "inherit" });
if (buildRes.status !== 0) {
  console.error("\nBuild failed! Aborting local publish.");
  process.exit(buildRes.status ?? 1);
}

console.log(`\n=== 2. Packaging ${pkg.name} ===`);
const packArgs = ["pack", "--json"];
if (isDryRun) {
  packArgs.push("--dry-run");
}

const packRes = runNpm(packArgs, { encoding: "utf8" });
if (packRes.status !== 0) {
  console.error("\nFailed to package tarball:");
  console.error(packRes.stderr || packRes.stdout);
  process.exit(packRes.status ?? 1);
}

let packData;
try {
  const entries = parseJsonFromOutput(packRes.stdout);
  packData = entries[0];
} catch (err) {
  console.error("Error parsing npm pack output:", err);
  process.exit(1);
}

console.log(`\nTarball: ${packData.filename} (${formatSize(packData.size)}, unpacked: ${formatSize(packData.unpackedSize)})`);
console.log(`Files included in package (${packData.entryCount} files):`);
for (const file of packData.files) {
  console.log(`  - ${file.path.padEnd(35)} [${formatSize(file.size)}]`);
}

if (isDryRun) {
  console.log("\n[--dry-run] Package preview complete. Nothing was installed globally.");
  process.exit(0);
}

const tarballPath = path.join(rootDir, packData.filename);

if (isPackOnly) {
  console.log(`\n[--pack-only] Package archive created at: ${tarballPath}`);
  console.log("Global installation skipped.");
  process.exit(0);
}

console.log(`\n=== 3. Publishing/Installing locally to global npm ===`);
const installRes = runNpm(["install", "-g", packData.filename], { stdio: "inherit" });

if (!keepPack && fs.existsSync(tarballPath)) {
  try {
    fs.unlinkSync(tarballPath);
  } catch {
    // Ignore cleanup errors
  }
}

if (installRes.status !== 0) {
  console.error("\nFailed to install tarball globally.");
  process.exit(installRes.status ?? 1);
}

// Get global root location
let globalRoot = "";
try {
  const rootRes = runNpm(["root", "-g"], { encoding: "utf8" });
  if (rootRes.status === 0) {
    globalRoot = rootRes.stdout.trim();
  }
} catch {
  // Ignore
}

const installedDir = globalRoot ? path.join(globalRoot, pkg.name) : pkg.name;

console.log("\n" + "=".repeat(60));
console.log(` SUCCESS: ${pkg.name}@${pkg.version} published locally!`);
console.log("=".repeat(60));
console.log(`\nInstalled location:`);
console.log(`  ${installedDir}`);
console.log(`\nGlobal command:`);
console.log(`  ${Object.keys(pkg.bin || {})[0] || pkg.name}`);
console.log(`\nVerification & Test commands:`);
console.log(`  1. Test CLI engine manager:`);
console.log(`     search-code-mcp engine`);
console.log(`  2. Test stdio server:`);
console.log(`     npx search-code-mcp`);
console.log(`  3. Check global package list:`);
console.log(`     npm list -g --depth=0 ${pkg.name}`);
console.log(`  4. Uninstall when done:`);
console.log(`     npm run uninstall:local`);
console.log("\n" + "=".repeat(60) + "\n");
