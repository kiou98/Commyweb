import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '1.0.0';

const distDir = path.resolve(__dirname, '../dist');
const outDir = path.resolve(__dirname, '../release');

const versionedZipName = `commyweb-extension-v${version}.zip`;
const genericZipName = 'commyweb-extension.zip';

const versionedZipPath = path.resolve(outDir, versionedZipName);
const genericZipPath = path.resolve(outDir, genericZipName);

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const output = fs.createWriteStream(versionedZipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  // Also create a copy with generic name for backwards-compatible download links
  fs.copyFileSync(versionedZipPath, genericZipPath);

  console.log(`\n🎉 Package created successfully!`);
  console.log(`📦 Versioned Archive: ${versionedZipPath} (${(archive.pointer() / 1024).toFixed(2)} KB)`);
  console.log(`📦 Generic Archive:   ${genericZipPath}`);
  console.log(`Ready to distribute or load in Chrome via chrome://extensions/ !`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();
