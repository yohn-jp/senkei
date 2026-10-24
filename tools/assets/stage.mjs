import { mkdir, copyFile, readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const hero = process.argv[2] ?? 'f01';
if (!/^[fr]0[1-6]$/.test(hero)) throw new Error('Invalid hero key');
const manifest = JSON.parse(await readFile(new URL(`assets/manifests/${hero}.json`, root)));
for (const lod of manifest.lods) {
  const dest = new URL(`apps/web/public${lod.url}`, root);
  await mkdir(new URL('.', dest), { recursive: true });
  await copyFile(new URL(lod.file, root), dest);
}
console.log(`Staged ${hero.toUpperCase()} GLBs from manifest`);
