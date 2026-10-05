// Maintainer-only. Cube installs the committed artifact and needs no build toolchain.
import { spawnSync } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root, lock } from './paths.mjs';
const env = { ...process.env, COPYFILE_DISABLE: '1', NODE_ENV: 'production', VITE_OPENWORK_DEPLOYMENT: 'web', VITE_OPENWORK_APP_VERSION: lock.version, VITE_OPENWORK_BUILD_SHA: lock.upstream };
// Never freeze credentials, local server addresses, or hosted-login requirements into the UI.
for (const key of Object.keys(env)) if (key.startsWith('VITE_') && !['VITE_OPENWORK_DEPLOYMENT', 'VITE_OPENWORK_APP_VERSION', 'VITE_OPENWORK_BUILD_SHA'].includes(key)) delete env[key];
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
run('pnpm', ['--filter', '@openwork/types', 'build']);
run('pnpm', ['--filter', '@openwork/app', 'exec', 'vite', 'build', '--config', '../../cube/vite.config.mts']);
await cp(path.join(root, 'LICENSE'), path.join(root, 'apps/app/dist/LICENSE'));
await writeFile(path.join(root, 'apps/app/dist/cube-build.json'), JSON.stringify({ upstream: lock.upstream, version: lock.version, eeModules: false, telemetry: 'optional organization task analytics omitted' }, null, 2));
run('tar', ['-czf', path.join(root, 'cube/web-ui.tgz'), '-C', path.join(root, 'apps/app/dist'), '.']);
const hash = createHash('sha256').update(await readFile(path.join(root, 'cube/web-ui.tgz'))).digest('hex');
await writeFile(path.join(root, 'cube/web-ui.sha256'), `${hash}  web-ui.tgz\n`);
