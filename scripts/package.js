import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import { prepareEditions } from './editions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
if (manifest.version !== version) throw new Error('Manifest and package versions must match.');
const output = path.join(root, 'release');
fs.mkdirSync(output, { recursive: true });

function zip(filename, append) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(path.join(output, filename));
    const archive = archiver('zip', { zlib: { level: 9 } });
    stream.on('close', () => resolve(archive.pointer()));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    append(archive);
    void archive.finalize().catch(reject);
  });
}

const filename = `commyweb-extension-v${version}.zip`;
const size = await zip(filename, archive => archive.directory(dist, false));
fs.copyFileSync(path.join(output, filename), path.join(output, 'commyweb-extension.zip'));
await prepareEditions();
for (const edition of ['admin', 'user']) {
  const name = `commyweb-${edition}-v${version}.zip`;
  await zip(name, archive => archive.directory(path.join(root, `dist-${edition}`), false));
  fs.copyFileSync(path.join(output, name), path.join(output, `commyweb-${edition}.zip`));
}
await zip(`commyweb-source-v${version}.zip`, archive => archive.glob('**/*', {
  cwd: root, dot: true, ignore: ['.git/**', '**/node_modules/**', 'dist/**', 'site-dist/**', 'dist-admin/**', 'dist-user/**', 'release/**', 'test-results/**', '.test-profile/**']
}));
await zip(`commyweb-realtime-relay-v${version}.zip`, archive => archive.glob('**/*', {
  cwd: path.join(root, 'relay'), dot: true, ignore: ['node_modules/**', '*.log']
}));
console.log(`Commyweb ${version}: ${(size / 1024).toFixed(1)} KB — ${path.join(output, filename)}`);
console.log('Separate Admin and Utilisateur editions built in dist-admin/ and dist-user/.');
