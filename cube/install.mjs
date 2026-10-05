import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, rename, cp, chmod, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, lock, cache, runtime, engine, checkNode } from './paths.mjs';

checkNode();
const engineAsset = lock.engines[`${process.platform}-${process.arch}`];
if (!engineAsset) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
await mkdir(cache, { recursive: true, mode: 0o700 });
const staging = await mkdtemp(path.join(cache, '.install-'));
const run = (bin, args) => {
  const result = spawnSync(bin, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} failed (${result.status}).`);
};
async function extract(asset, destination, strip = false) {
  const file = path.join(staging, path.basename(new URL(asset.url).pathname));
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Runtime download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = asset.integrity.split('-');
  const actual = createHash(algorithm).update(bytes).digest(algorithm === 'sha512' ? 'base64' : 'hex');
  if (actual !== expected) throw new Error('Runtime download checksum mismatch.');
  await writeFile(file, bytes);
  await mkdir(destination, { recursive: true });
  if (file.endsWith('.zip')) run('unzip', ['-q', file, '-d', destination]);
  else run('tar', ['-xzf', file, '-C', destination, ...(strip ? ['--strip-components=1'] : [])]);
  await rm(file);
}
try {
  if (!await stat(path.join(runtime, '.complete')).catch(() => null)) {
    console.log(`Installing the pinned OpenWork ${lock.version} server.`);
    const server = path.join(staging, 'server');
    await extract(lock.server, server, true);
    await extract(lock.jsoncParser, path.join(server, 'node_modules/jsonc-parser'), true);
    // The npm UI contains optional EE analytics contracts. Never serve it.
    await rm(path.join(server, 'web'), { recursive: true, force: true });
    await cp(path.join(root, 'LICENSE'), path.join(server, 'LICENSE'));
    await writeFile(path.join(server, '.complete'), `${lock.upstream}\n`);
    await rm(runtime, { recursive: true, force: true });
    await rename(server, runtime);
  }
  if (!await stat(engine).catch(() => null)) {
    console.log(`Installing the pinned OpenCode ${lock.engineVersion} engine.`);
    const engineDir = path.join(staging, 'engine');
    await extract(engineAsset, engineDir);
    await chmod(path.join(engineDir, 'opencode'), 0o755);
    const version = spawnSync(path.join(engineDir, 'opencode'), ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (version.status !== 0 || version.stdout.trim() !== lock.engineVersion) throw new Error('OpenCode version check failed.');
    await rm(path.dirname(engine), { recursive: true, force: true });
    await rename(engineDir, path.dirname(engine));
  }
  const archive = path.join(root, 'cube/web-ui.tgz');
  const expected = (await readFile(path.join(root, 'cube/web-ui.sha256'), 'utf8')).trim().split(/\s/)[0];
  if (createHash('sha256').update(await readFile(archive)).digest('hex') !== expected) throw new Error('Web UI checksum mismatch.');
  const web = path.join(root, 'cube/.web');
  await rm(web, { recursive: true, force: true });
  await mkdir(web, { recursive: true });
  run('tar', ['-xzf', archive, '-C', web]);
  console.log('OpenWork is installed. Runtime dependencies are private; no global commands were changed.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
