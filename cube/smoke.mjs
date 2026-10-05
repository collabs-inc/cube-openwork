import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { root, cache } from './paths.mjs';

const testDir = await mkdtemp('/tmp/cube-openwork-smoke-');
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const data = path.join(testDir, 'state');
const env = { PATH: process.env.PATH, HOME: os.homedir(), PORT: String(port), CUBE_OPENWORK_CACHE_DIR: cache, CUBE_OPENWORK_DATA_DIR: data,
  XDG_CONFIG_HOME: path.join(testDir, 'config'), XDG_DATA_HOME: path.join(testDir, 'data'), XDG_CACHE_HOME: path.join(testDir, 'cache'), XDG_STATE_HOME: path.join(testDir, 'xdg-state') };
for (const dir of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME]) await mkdir(dir, { recursive: true });
let child;
let output = '';
const ownedPids = new Set();
const endpoint = `http://127.0.0.1:${port}`;
async function start() {
  const started = Date.now();
  child = spawn(process.execPath, [path.join(root, 'cube/start.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  while (Date.now() - started < 55000) {
    if (child.exitCode !== null) throw new Error(`Adapter exited before ready: ${output}`);
    try {
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { console.log(`Ready in ${Date.now() - started} ms.`); return await response.json(); }
    } catch {}
    await delay(200);
  }
  throw new Error('OpenWork smoke startup timed out.');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit'); child.kill(process.env.CUBE_OPENWORK_SMOKE_STOP_SIGNAL || 'SIGTERM');
  await Promise.race([exited, delay(8000).then(() => { throw new Error('Adapter did not stop.'); })]);
  assert.equal(child.exitCode, 0);
}
try {
  const health = await start();
  assert.equal(health.ok, true);
  const html = await (await fetch(endpoint)).text();
  assert.match(html, /__OPENWORK_BOOTSTRAP__/);
  assert.match(html, /\/assets\//);
  const workspaces = await (await fetch(`${endpoint}/workspaces`)).json();
  assert.ok(Array.isArray(workspaces.items) && workspaces.items.length === 1, 'persistent default workspace');
  const first = workspaces.items[0];
  const marker = path.join(data, 'workspace/persistence-fixture.txt');
  await writeFile(marker, 'preserved across restarts');
  const tokenBefore = await readFile(path.join(data, 'gateway-tokens.json'), 'utf8');
  const beforeStatus = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' });
  const rows = beforeStatus.trim().split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean);
  ownedPids.add(child.pid);
  for (let count = 0; count < 5; count++) for (const row of rows) if (ownedPids.has(Number(row[2]))) ownedPids.add(Number(row[1]));
  const rss = rows.filter(row => ownedPids.has(Number(row[1]))).reduce((sum, row) => sum + Number(row[3]), 0);
  console.log(`Owned processes: ${ownedPids.size}; idle RSS: ${Math.round(rss / 1024)} MiB.`);
  if (process.env.CUBE_OPENWORK_PLAYWRIGHT) {
    const { chromium } = await import(process.env.CUBE_OPENWORK_PLAYWRIGHT);
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
      await page.goto(endpoint);
      await page.waitForTimeout(6000);
      await page.screenshot({ path: process.env.CUBE_OPENWORK_SCREENSHOT || path.join(testDir, 'openwork.png') });
      const body = await page.locator('body').innerText();
      assert.ok(body.length > 80, 'the app renders an interactive page');
      console.log(`Browser page rendered (${body.length} characters).`);
      if (process.env.CUBE_OPENWORK_UI_TEXT) await writeFile(process.env.CUBE_OPENWORK_UI_TEXT, body);
    } finally { await browser.close(); }
  }
  await stop();
  await delay(250);
  for (const pid of ownedPids) assert.throws(() => process.kill(pid, 0), 'owned processes exit with the adapter');
  await start();
  const after = await (await fetch(`${endpoint}/workspaces`)).json();
  assert.equal(after.items[0].id, first.id);
  assert.equal(await readFile(marker, 'utf8'), 'preserved across restarts');
  assert.equal(await readFile(path.join(data, 'gateway-tokens.json'), 'utf8'), tokenBefore);
  assert.equal(output.includes(JSON.parse(tokenBefore).token), false, 'client credentials stay out of Cube output');
  assert.equal(output.includes(JSON.parse(tokenBefore).hostToken), false, 'owner credentials stay out of Cube output');
  console.log('OpenWork smoke passed: UI/API, persistent workspace/tokens, credential-safe logs and owned-process shutdown.');
} finally {
  await stop();
  if (process.env.CUBE_OPENWORK_KEEP_SMOKE) console.log(`Smoke fixture kept at ${testDir}`);
  else await rm(testDir, { recursive: true, force: true });
}
