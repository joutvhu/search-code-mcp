import esbuild from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minify: true,
  outfile: 'dist/index.js',
  banner: {
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
  },
});

const content = fs.readFileSync('dist/index.js', 'utf8');
const cleanContent = content.replace(/^(#!.*\r?\n)+/, '');
fs.writeFileSync('dist/index.js', '#!/usr/bin/env node\n' + cleanContent, 'utf8');

if (process.platform !== 'win32') {
  fs.chmodSync('dist/index.js', '755');
}

console.log('Build completed: dist/index.js (' + (fs.statSync('dist/index.js').size / 1024).toFixed(1) + ' KB)');
