import { spawnSync } from 'node:child_process';

// Capture actual extension screens with fictitious data, never a user's profile.
for (const script of ['tests/browser.mjs', 'tests/realtime-browser.mjs']) {
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit', env: { ...process.env, COMMYWEB_CAPTURE_SITE: '1' }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
