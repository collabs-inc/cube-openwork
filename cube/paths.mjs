import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const lock = JSON.parse(readFileSync(new URL('./runtime-lock.json', import.meta.url), 'utf8'));
export const cache = process.env.CUBE_OPENWORK_CACHE_DIR || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'cube-openwork');
export const data = process.env.CUBE_OPENWORK_DATA_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'cube-openwork');
export const runtime = path.join(cache, `runtime-${lock.version}-${process.platform}-${process.arch}`);
export const engine = path.join(cache, `opencode-${lock.engineVersion}-${process.platform}-${process.arch}`, 'opencode');

export function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('OpenWork requires Node.js 22.13 or newer.');
}
