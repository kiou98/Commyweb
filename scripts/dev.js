import { spawn } from 'node:child_process';
// Build shared assets once, then watch both bundles without deleting each other's output.
const build = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
build.on('exit', code => {
  if (code) { process.exitCode = code; return; }
  const processes = [[], ['--config', 'vite.content.config.ts']].map(args => spawn(process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--watch', ...args], { stdio: 'inherit', env: { ...process.env, COMMYWEB_WATCH: '1' } }));
  const stop = () => processes.forEach(child => child.kill());
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
});
