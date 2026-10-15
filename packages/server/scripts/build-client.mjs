import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'dist', 'public');
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'client', 'main.tsx')],
  outfile: path.join(out, 'app.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  logLevel: 'warning',
});
fs.copyFileSync(path.join(root, 'src', 'client', 'app.css'), path.join(out, 'app.css'));
console.log(`client bundle: ${fs.statSync(path.join(out, 'app.js')).size} bytes`);
