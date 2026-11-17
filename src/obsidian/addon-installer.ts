import * as https from 'https';
import * as zlib from 'zlib';
import type { DataAdapter } from 'obsidian';
import type { AddonSpec } from './addons';
import { unzip } from './zip';

/** Downloads and removes the optional add-ons on desktop. */

const MAX_REDIRECTS = 5;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 256 * 1024 * 1024;

type AddonStorage = Pick<DataAdapter, 'exists' | 'mkdir' | 'rmdir' | 'rename' | 'write' | 'writeBinary'>;

function get(url: string, redirects = MAX_REDIRECTS): Promise<import('http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) return reject(new Error(`refusing to download from a non-https address: ${url}`));
    https.get(url, { headers: { 'user-agent': 'obsidian-flowmotion' } }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects === 0) return reject(new Error('too many redirects'));
        get(new URL(res.headers.location, url).href, redirects - 1).then(resolve, reject);
        return;
      }
      if (code !== 200) { res.resume(); return reject(new Error(`download failed: HTTP ${code} from ${new URL(url).host}`)); }
      resolve(res);
    }).on('error', reject);
  });
}

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of await get(url)) {
    const chunk = c as Buffer;
    size += chunk.length;
    if (size > maxBytes) throw new Error(`download exceeds the ${maxBytes}-byte limit`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function text(url: string): Promise<string> {
  return (await download(url, MAX_METADATA_BYTES)).toString('utf8');
}

const active = new Set<string>();

async function removeDirectory(adapter: AddonStorage, path: string): Promise<void> {
  if (await adapter.exists(path)) await adapter.rmdir(path, true);
}

async function ensureDirectory(adapter: AddonStorage, path: string): Promise<void> {
  if (await adapter.exists(path)) return;
  const parent = path.lastIndexOf('/');
  if (parent > 0) await ensureDirectory(adapter, path.slice(0, parent));
  await adapter.mkdir(path);
}

/** Downloads the add-on into the vault-relative plugin directory. */
export async function installAddon(spec: AddonSpec, adapter: AddonStorage, pluginDir: string): Promise<void> {
  if (active.has(spec.dir)) throw new Error('this add-on is already being installed');
  active.add(spec.dir);
  const dest = `${pluginDir}/${spec.dir}`, tmp = `${dest}.installing`;
  try {
    await removeDirectory(adapter, tmp);
    await ensureDirectory(adapter, tmp);
    const source = await spec.resolve(text);
    const res = await get(source.url);
    const map = new Map<string, string>();
    let files = 0;
    const save = async (rel: string, data: Uint8Array) => {
      if (!rel || rel.includes('\\') || rel.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`unsafe path in download: ${rel}`);
      const out = `${tmp}/${rel}`;
      await ensureDirectory(adapter, out.slice(0, out.lastIndexOf('/')));
      await adapter.writeBinary(out, Uint8Array.from(data).buffer);
    };
    const select = (p: string) => { const t = spec.target(p); if (t !== null) map.set(p, t); return t !== null; };
    const onFile = async (p: string, data: Uint8Array) => { await save(map.get(p)!, data); map.delete(p); files++; };
    const parts: Buffer[] = [];
    let archiveBytes = 0;
    for await (const c of res) {
      const chunk = c as Buffer;
      archiveBytes += chunk.length;
      if (archiveBytes > MAX_ARCHIVE_BYTES) throw new Error(`add-on archive exceeds the ${MAX_ARCHIVE_BYTES}-byte limit`);
      parts.push(chunk);
    }
    await unzip(Buffer.concat(parts, archiveBytes), select, onFile, (d, maxOutputBytes) => zlib.inflateRawSync(d, { maxOutputLength: maxOutputBytes }), {
      maxEntryBytes: MAX_ENTRY_BYTES,
      maxTotalBytes: MAX_TOTAL_EXTRACTED_BYTES,
    });
    for (const x of source.extras ?? []) await save(x.name, Buffer.from(await text(x.url)));
    if (!(await adapter.exists(`${tmp}/${spec.marker}`)) || files === 0) throw new Error('the download did not contain the expected files');
    await adapter.write(`${tmp}/VERSION`, `${source.label}\n`);
    await removeDirectory(adapter, dest);
    await adapter.rename(tmp, dest);
  } catch (e) {
    try { await removeDirectory(adapter, tmp); } catch (cleanupError) { console.error('FlowMotion: could not remove incomplete add-on download', cleanupError); }
    throw e;
  } finally {
    active.delete(spec.dir);
  }
}

/** Deletes the add-on's files. */
export async function removeAddon(spec: AddonSpec, adapter: AddonStorage, pluginDir: string): Promise<void> {
  await removeDirectory(adapter, `${pluginDir}/${spec.dir}`);
}
