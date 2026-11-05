import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'vendor/pixel-parkour');
const output = join(root, 'public/parkour');
function cargo(args) {
  const result = spawnSync('cargo', args, {
    cwd: source,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) throw new Error(`cargo ${args[0]} failed (${result.status})`);
  return result.stdout;
}
cargo(['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown']);
const metadata = JSON.parse(cargo(['metadata', '--locked', '--format-version', '1']));
const crate = (name, expected) => {
  const found = metadata.packages.find((p) => p.name === name && p.version === expected);
  if (!found) throw new Error(`Expected locked dependency ${name} ${expected}`);
  return dirname(found.manifest_path);
};
mkdirSync(output, { recursive: true });
copyFileSync(
  join(metadata.target_directory, 'wasm32-unknown-unknown/release/pixel_parkour.wasm'),
  join(output, 'pixel_parkour.wasm'),
);
copyFileSync(join(crate('miniquad', '0.4.11'), 'js/gl.js'), join(output, 'gl.js'));
copyFileSync(join(crate('quad-snd', '0.2.8'), 'js/audio.js'), join(output, 'audio.js'));
copyFileSync(join(source, 'LICENSE'), join(output, 'LICENSE-pixel-parkour.txt'));
copyFileSync(
  join(source, 'LICENSE-ARK-PIXEL-FONT.txt'),
  join(output, 'LICENSE-ARK-PIXEL-FONT.txt'),
);
copyFileSync(
  join(crate('miniquad', '0.4.11'), 'LICENSE-MIT'),
  join(output, 'LICENSE-miniquad-MIT.txt'),
);
copyFileSync(
  join(crate('miniquad', '0.4.11'), 'LICENSE-APACHE'),
  join(output, 'LICENSE-APACHE.txt'),
);
const files = [
  'pixel_parkour.wasm',
  'gl.js',
  'audio.js',
  'bridge.js',
  'parkour.js',
  'parkour.css',
  'index.html',
];
const hashes = Object.fromEntries(
  files.map((file) => [
    file,
    createHash('sha256')
      .update(readFileSync(join(output, file)))
      .digest('hex'),
  ]),
);
writeFileSync(
  join(output, 'build-info.json'),
  JSON.stringify(
    {
      source: JSON.parse(readFileSync(join(source, 'SOURCE.json'), 'utf8')),
      dependencies: { macroquad: '0.4.16', miniquad: '0.4.11', 'quad-snd': '0.2.8' },
      compiler: spawnSync('rustc', ['--version'], { encoding: 'utf8' }).stdout.trim(),
      sha256: hashes,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Built Pixel Parkour: ${readFileSync(join(output, 'pixel_parkour.wasm')).length} bytes`,
);
