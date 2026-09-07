import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify: true, outfile: 'dist/app.js', legalComments: 'linked', target: ['es2022'] });
await cp('src/style.css', 'dist/style.css');
const html = (await readFile('index.html', 'utf8')).replace('/src/main.js', '/app.js').replace('/src/style.css', '/style.css');
await writeFile('dist/index.html', html);
console.log('Neiva Abierta compilada en dist/');
