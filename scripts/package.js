import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '1.5.0';

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const distAdminDir = path.resolve(rootDir, 'dist-admin');
const distUserDir = path.resolve(rootDir, 'dist-user');
const outDir = path.resolve(rootDir, 'release');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function copyDirRecursive(src, dest) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function packageAll() {
  console.log(`\n📦 Packaging Commyweb v${version} (Dual Plugin Architecture: Admin & Collaborateur)...`);

  // 1. Prepare dist-admin (Admin Edition)
  copyDirRecursive(distDir, distAdminDir);
  const adminManifestPath = path.join(distAdminDir, 'manifest.json');
  if (fs.existsSync(adminManifestPath)) {
    const adminManifest = JSON.parse(fs.readFileSync(adminManifestPath, 'utf-8'));
    adminManifest.name = 'Commyweb (Admin)';
    adminManifest.description = 'Commyweb Admin - Configuration du dépôt GitHub et gestion des annotations web';
    fs.writeFileSync(adminManifestPath, JSON.stringify(adminManifest, null, 2), 'utf-8');
  }

  // 2. Prepare dist-user (Collaborator / User Edition)
  copyDirRecursive(distDir, distUserDir);
  const userManifestPath = path.join(distUserDir, 'manifest.json');
  if (fs.existsSync(userManifestPath)) {
    const userManifest = JSON.parse(fs.readFileSync(userManifestPath, 'utf-8'));
    userManifest.name = 'Commyweb (Collaborateur)';
    userManifest.description = 'Commyweb Collaborateur - Annotez et commentez directement sur les sites web de votre équipe';
    fs.writeFileSync(userManifestPath, JSON.stringify(userManifest, null, 2), 'utf-8');
  }

  // Strip settings button and drawer from dist-user/popup.html
  const popupUserPath = path.join(distUserDir, 'popup.html');
  if (fs.existsSync(popupUserPath)) {
    let userHtml = fs.readFileSync(popupUserPath, 'utf-8');

    // Remove settings button
    const btnStart = userHtml.indexOf('<button class="icon-btn" id="btn-toggle-settings"');
    if (btnStart !== -1) {
      const btnEnd = userHtml.indexOf('</button>', btnStart) + '</button>'.length;
      userHtml = userHtml.slice(0, btnStart) + userHtml.slice(btnEnd);
    }

    // Remove settings drawer
    const drawerStartMarker = '<!-- Settings Drawer -->';
    const drawerMarkerIdx = userHtml.indexOf(drawerStartMarker);
    const drawerElIdx = userHtml.indexOf('<div class="drawer" id="settings-drawer"');
    const joinCardIdx = userHtml.indexOf('<div id="join-project-card"');

    if (drawerElIdx !== -1 && joinCardIdx !== -1) {
      const cutStart = drawerMarkerIdx !== -1 && drawerMarkerIdx < drawerElIdx ? drawerMarkerIdx : drawerElIdx;
      userHtml = userHtml.slice(0, cutStart) + userHtml.slice(joinCardIdx);
    }

    fs.writeFileSync(popupUserPath, userHtml, 'utf-8');
  }

  // 3. Create Admin Zip Archives
  const adminVersionedZip = path.resolve(outDir, `commyweb-admin-v${version}.zip`);
  const adminGenericZip = path.resolve(outDir, 'commyweb-admin.zip');
  const adminSize = await zipDirectory(distAdminDir, adminVersionedZip);
  fs.copyFileSync(adminVersionedZip, adminGenericZip);

  // 4. Create User / Collaborator Zip Archives
  const userVersionedZip = path.resolve(outDir, `commyweb-user-v${version}.zip`);
  const userGenericZip = path.resolve(outDir, 'commyweb-user.zip');
  const legacyVersionedZip = path.resolve(outDir, `commyweb-extension-v${version}.zip`);
  const legacyGenericZip = path.resolve(outDir, 'commyweb-extension.zip');

  const userSize = await zipDirectory(distUserDir, userVersionedZip);
  fs.copyFileSync(userVersionedZip, userGenericZip);
  fs.copyFileSync(userVersionedZip, legacyVersionedZip);
  fs.copyFileSync(userVersionedZip, legacyGenericZip);

  console.log(`\n🎉 Dual packages created successfully!`);
  console.log(`👑 Commyweb Admin:`);
  console.log(`   - Archive: ${adminVersionedZip} (${(adminSize / 1024).toFixed(2)} KB)`);
  console.log(`   - Generic: ${adminGenericZip}`);
  console.log(`   - Folder:  dist-admin/ (load unpacked in Chrome for Admin)`);
  console.log(`\n👥 Commyweb Collaborateur:`);
  console.log(`   - Archive: ${userVersionedZip} (${(userSize / 1024).toFixed(2)} KB)`);
  console.log(`   - Generic: ${userGenericZip} & ${legacyGenericZip}`);
  console.log(`   - Folder:  dist-user/ (load unpacked in Chrome for Collaborator)`);
}

packageAll().catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
