import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const outDir = path.resolve(__dirname, '../release');
const zipPath = path.resolve(outDir, 'commyweb-extension.zip');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`\n🎉 Package created successfully!`);
  console.log(`📦 Archive: ${zipPath} (${(archive.pointer() / 1024).toFixed(2)} KB)`);
  console.log(`Ready to distribute or load in Chrome via chrome://extensions/ !`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();
