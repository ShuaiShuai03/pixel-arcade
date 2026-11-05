import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'src', 'public'])
  await cp(path, `dist/${path}`, { recursive: true });
await writeFile('dist/.nojekyll', '');
console.log('Static site built in dist/');
