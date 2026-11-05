import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { catalog, loadGame } from '../src/catalog.js';
const root = resolve(import.meta.dirname, '..');
let checked = 0;
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = resolve(path, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (entry.name.endsWith('.js')) {
      const source = await readFile(target, 'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
        if (match[1].includes('${')) continue;
        await stat(resolve(dirname(target), match[1]));
      }
      if (/\bdebugger\s*;/.test(source)) throw Error(`Debug statement: ${target}`);
      checked++;
    }
  }
}
await walk(resolve(root, 'src'));
for (const game of catalog) {
  const module = await loadGame(game.id);
  if (module.meta.id !== game.id) throw Error(`Catalog mismatch: ${game.id}`);
}
const html = await readFile(resolve(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) await stat(resolve(root, m[1]));
const wasm = await readFile(resolve(root, 'public/parkour/pixel_parkour.wasm'));
if (wasm.subarray(0, 4).toString('hex') !== '0061736d')
  throw Error('Pixel Parkour WASM is invalid');
console.log(
  `Checked ${checked} JavaScript files, ${catalog.length} games, local links, and Pixel Parkour WASM.`,
);
