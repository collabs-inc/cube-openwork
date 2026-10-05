import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { root, runtime, engine, data, checkNode } from './paths.mjs';
import { createProxy } from './proxy.mjs';

checkNode();
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
await mkdir(data, { recursive: true, mode: 0o700 });
const workspace = process.env.CUBE_OPENWORK_WORKSPACE || path.join(data, 'workspace');
await mkdir(workspace, { recursive: true });
const configFile = path.join(data, 'server.json');
if (!await stat(configFile).catch(() => null)) {
  await writeFile(configFile, JSON.stringify({ workspaces: [{ path: workspace, name: 'Workspace' }], authorizedRoots: [os.homedir(), workspace] }, null, 2), { mode: 0o600, flag: 'wx' });
}
const tokenFile = path.join(data, 'gateway-tokens.json');
let credentials;
try { credentials = JSON.parse(await readFile(tokenFile, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  credentials = { token: randomBytes(32).toString('hex'), hostToken: randomBytes(32).toString('hex') };
  await writeFile(tokenFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
}
if (!credentials.token || !credentials.hostToken) throw new Error('The OpenWork gateway token file is invalid.');
const reservation = net.createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const innerPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(OPENWORK_|VITE_|DEN_|OPENCODE_SERVER_)/.test(key)) delete env[key];
Object.assign(env, {
  OPENWORK_DATA_DIR: data,
  OPENWORK_SERVER_CONFIG: configFile,
  OPENWORK_RUNTIME_DB: path.join(data, 'runtime.sqlite'),
  OPENWORK_SERVER_LOG_FILE: path.join(data, 'server.log'),
  OPENWORK_TOKEN_STORE: path.join(data, 'token-store.json'),
  OPENWORK_PACKAGE_ROOT: runtime,
  OPENWORK_WEB_ROOT: path.join(root, 'cube/.web'),
  OPENWORK_OPENCODE_BIN: engine,
  OPENWORK_TOKEN: credentials.token,
  OPENWORK_HOST_TOKEN: credentials.hostToken,
  OPENWORK_NO_UPDATE_CHECK: '1',
  // A truthy empty list stops web mode injecting cwd as a CLI workspace;
  // resolveServerConfig then loads the user's persistent workspaces instead.
  OPENWORK_WORKSPACES: '[]',
  OPENCODE_CONFIG_DIR: path.join(data, 'opencode-config'),
});
await mkdir(env.OPENCODE_CONFIG_DIR, { recursive: true, mode: 0o700 });
const child = spawn(process.execPath, [path.join(runtime, 'bin/openwork-server.mjs'), 'web', '--host', '127.0.0.1', '--port', String(innerPort), '--approval', 'auto'], {
  cwd: workspace, env, stdio: 'ignore', detached: true,
});
// Upstream can log authentication material; only our bounded status reaches Cube.
let childExited = false;
let stopping = false;
const proxy = createProxy({ port: innerPort, ...credentials });
const killGroup = signal => { if (child.pid) try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  proxy.close();
  killGroup('SIGTERM');
  if (!childExited) await Promise.race([once(child, 'exit'), delay(5000)]);
  killGroup('SIGKILL');
  process.exit(code);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
child.on('error', () => { childExited = true; console.error('Unable to launch OpenWork. Run its install step.'); void stop(1); });
child.on('exit', code => { childExited = true; if (!stopping) { console.error(`OpenWork exited (${code ?? 'signal'}).`); void stop(1); } });
try {
  const deadline = Date.now() + 45000;
  let ready = false;
  while (!childExited && Date.now() < deadline) {
    try { ready = (await fetch(`http://127.0.0.1:${innerPort}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw new Error('OpenWork did not become ready within 45 seconds.');
  proxy.server.listen(port, '127.0.0.1');
  await once(proxy.server, 'listening');
  console.log(`OpenWork is ready on 127.0.0.1:${port}.`);
} catch (error) {
  console.error(error.message);
  await stop(1);
}
