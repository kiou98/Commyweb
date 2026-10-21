import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function siteNeedsBuild(paths, readAt) {
  return paths.some(path => {
    if (/^(site\/|src\/site\/|netlify\/|icons\/|netlify\.toml$|scripts\/(build-site|ignore-site-build)\.mjs$)/.test(path)) return true;
    if (!/^package(-lock)?\.json$/.test(path)) return false;
    const content = ref => {
      const data = JSON.parse(readAt(ref, path));
      delete data.version;
      if (data.packages?.['']) delete data.packages[''].version;
      return JSON.stringify(data);
    };
    return content('before') !== content('after');
  });
}

// Netlify: exit 0 skips the build; exit 1 rebuilds the pages.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const before = process.env.CACHED_COMMIT_REF;
  const after = process.env.COMMIT_REF;
  if (!before || !after) process.exit(1);
  try {
    const changed = execFileSync('git', ['diff', '--name-only', before, after], { encoding: 'utf8' }).trim().split('\n');
    const affectsSite = siteNeedsBuild(changed, (ref, path) => execFileSync('git', ['show', `${ref === 'before' ? before : after}:${path}`], { encoding: 'utf8' }));
    process.exit(affectsSite ? 1 : 0);
  } catch { process.exit(1); }
}
