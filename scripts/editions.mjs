import { promises as fs } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareEditions() {
  const root = process.cwd();
  const original = JSON.parse(await fs.readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
  for (const [edition, label] of [['admin', 'Admin'], ['user', 'Utilisateur']]) {
    const target = resolve(root, `dist-${edition}`);
    if (target !== `${root}${sep}dist-${edition}`) throw new Error('Unexpected build directory.');
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(resolve(root, 'dist'), target, { recursive: true });
    const manifest = { ...original, name: `Commyweb (${label})`, short_name: `Commyweb ${label}`,
      description: edition === 'admin' ? 'Configurez les projets et invitez les utilisateurs avec un lien magique.' : 'Ouvrez votre lien magique et commentez les pages web, sans configurer GitHub.' };
    if (edition === 'user') manifest.host_permissions = original.host_permissions.filter(host => !host.includes('api.github.com'));
    await fs.writeFile(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prepareEditions();
