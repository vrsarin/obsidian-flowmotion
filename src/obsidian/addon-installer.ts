import type { AddonSpec } from './addons';
import { unzip } from './zip';

/** Downloads and removes the optional add-ons. Uses Node modules, so it works on the desktop app only. */

type Https = typeof import('https');
type Fs = typeof import('fs');
type Path = typeof import('path');

const MAX_REDIRECTS = 5;

function get(https: Https, url: string, redirects = MAX_REDIRECTS): Promise<import('http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) return reject(new Error(`refusing to download from a non-https address: ${url}`));
    https.get(url, { headers: { 'user-agent': 'obsidian-flowmotion' } }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects === 0) return reject(new Error('too many redirects'));
        get(https, new URL(res.headers.location, url).href, redirects - 1).then(resolve, reject);
        return;
      }
      if (code !== 200) { res.resume(); return reject(new Error(`download failed: HTTP ${code} from ${new URL(url).host}`)); }
      resolve(res);
    }).on('error', reject);
  });
}

async function text(https: Https, url: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of await get(https, url)) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const active = new Set<string>();

/** Downloads the add-on into `<pluginRoot>/<dir>`. The old copy is replaced only after the new one is complete. */
export async function installAddon(spec: AddonSpec, pluginRoot: string): Promise<void> {
  if (active.has(spec.dir)) throw new Error('this add-on is already being installed');
  active.add(spec.dir);
  const https = require('https') as Https, zlib = require('zlib') as typeof import('zlib');
  const fs = require('fs') as Fs, path = require('path') as Path;
  const dest = path.join(pluginRoot, spec.dir), tmp = `${dest}.installing`;
  try {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await fs.promises.mkdir(tmp, { recursive: true });
    const source = await spec.resolve((u) => text(https, u));
    const res = await get(https, source.url);
    const map = new Map<string, string>();
    let files = 0;
    const save = async (rel: string, data: Uint8Array) => {
      const out = path.resolve(tmp, rel);
      if (!out.startsWith(path.resolve(tmp) + path.sep)) throw new Error(`unsafe path in download: ${rel}`);
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      await fs.promises.writeFile(out, data);
    };
    const select = (p: string) => { const t = spec.target(p); if (t !== null) map.set(p, t); return t !== null; };
    const onFile = async (p: string, data: Uint8Array) => { await save(map.get(p)!, data); map.delete(p); files++; };
    const parts: Buffer[] = [];
    for await (const c of res) parts.push(c as Buffer);
    await unzip(Buffer.concat(parts), select, onFile, (d) => zlib.inflateRawSync(d));
    for (const x of source.extras ?? []) await save(x.name, Buffer.from(await text(https, x.url)));
    if (!fs.existsSync(path.join(tmp, spec.marker)) || files === 0) throw new Error('the download did not contain the expected files');
    await fs.promises.writeFile(path.join(tmp, 'VERSION'), `${source.label}\n`);
    await fs.promises.rm(dest, { recursive: true, force: true });
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  } finally {
    active.delete(spec.dir);
  }
}

/** Deletes the add-on's files. */
export async function removeAddon(spec: AddonSpec, pluginRoot: string): Promise<void> {
  const fs = require('fs') as Fs, path = require('path') as Path;
  await fs.promises.rm(path.join(pluginRoot, spec.dir), { recursive: true, force: true });
}
