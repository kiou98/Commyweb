import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import archiver from 'archiver';
import sharp from 'sharp';

const target = resolve('site-dist');
await fs.mkdir(target, { recursive: true });
await fs.cp(resolve('site'), target, { recursive: true });
await fs.copyFile(resolve('icons/logotype.png'), resolve(target, 'logotype.png'));
await sharp(resolve('icons/logo.png')).resize(48, 48).png().toFile(resolve(target, 'favicon.png'));
await sharp(resolve('site/social-card.svg')).png().toFile(resolve(target, 'social-card.png'));
await fs.mkdir(resolve(target, 'downloads'), { recursive: true });
await build({ entryPoints: ['src/site/join.ts'], outfile: resolve(target, 'join.js'), bundle: true, format: 'esm', minify: true, target: 'es2022' });
const zip = (file, directory) => new Promise((done, reject) => {
  const stream = createWriteStream(file);
  const archive = archiver('zip', { zlib: { level: 9 } });
  stream.on('close', done); stream.on('error', reject); archive.on('error', reject);
  archive.pipe(stream); archive.directory(directory, false); void archive.finalize().catch(reject);
});
await zip(resolve(target, 'downloads/commyweb-extension.zip'), resolve('dist'));
await fs.mkdir(resolve('release'), { recursive: true });
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
await zip(resolve(`release/commyweb-netlify-v${version}.zip`), target);
console.log('Netlify guide, invitation page and extension download built in site-dist/.');
