import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

await build({
  entryPoints: [path.join(rootDir, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  minify: true,
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  outfile: path.join(rootDir, "dist/index.js"),
});
console.log("Built dist/index.js with esbuild");
