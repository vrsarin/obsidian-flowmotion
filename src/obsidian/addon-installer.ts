import * as https from 'https';
import * as zlib from 'zlib';
import * as tar from 'tar-stream';
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

function untar(
  archive: Uint8Array,
  select: (path: string) => boolean,
  onFile: (path: string, data: Uint8Array) => Promise<void>,
): Promise<void> {
  const extract = tar.extract();
  let total = 0;
  return new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      if (header.type !== 'file' || !select(header.name)) {
        stream.resume();
        stream.once('end', () => next());
        return;
      }
      if (header.size < 0 || header.size > MAX_ENTRY_BYTES) {
        next(new Error(`archive entry exceeds the ${MAX_ENTRY_BYTES}-byte limit: ${header.name}`));
        return;
      }
      if (header.size > MAX_TOTAL_EXTRACTED_BYTES - total) {
        next(new Error(`archive contents exceed the ${MAX_TOTAL_EXTRACTED_BYTES}-byte limit`));
        return;
      }
      total += header.size;
      const chunks: Buffer[] = [];
      let size = 0;
      let invalidSize = false;
      stream.on('data', (value: unknown) => {
        if (!(value instanceof Uint8Array)) {
          stream.destroy(new Error(`archive entry has invalid data: ${header.name}`));
          return;
        }
        const chunk = value;
        size += chunk.byteLength;
        if (size > header.size && !invalidSize) {
          invalidSize = true;
          stream.destroy(new Error(`archive entry has an invalid size: ${header.name}`));
        } else {
          chunks.push(Buffer.from(chunk));
        }
      });
      stream.once('end', () => {
        if (invalidSize) return;
        if (size !== header.size) {
          next(new Error(`archive entry has an invalid size: ${header.name}`));
          return;
        }
        void onFile(header.name, Buffer.concat(chunks, size)).then(
          () => next(),
          (error: unknown) => next(error instanceof Error ? error : new Error(String(error))),
        );
      });
      stream.once('error', (error: Error) => next(error));
    });
    extract.once('finish', resolve);
    extract.once('error', reject);
    try {
      extract.end(zlib.gunzipSync(archive, { maxOutputLength: MAX_TOTAL_EXTRACTED_BYTES }));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
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
export async function installAddon(spec: AddonSpec, adapter: AddonStorage, pluginDir: string, version?: string): Promise<void> {
  if (active.has(spec.dir)) throw new Error('this add-on is already being installed');
  active.add(spec.dir);
  const dest = `${pluginDir}/${spec.dir}`, tmp = `${dest}.installing`;
  try {
    await removeDirectory(adapter, tmp);
    await ensureDirectory(adapter, tmp);
    const source = await spec.resolve(text, version);
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
    if (source.archive === 'tar.gz') {
      await untar(await download(source.url, MAX_ARCHIVE_BYTES), select, onFile);
    } else if (spec.file) {
      await save(spec.file, await download(source.url, MAX_ARCHIVE_BYTES));
      files++;
    } else {
      const res = await get(source.url);
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
    }
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
