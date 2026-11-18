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

async function untar(
  archive: Uint8Array,
  select: (path: string) => boolean,
  onFile: (path: string, data: Uint8Array) => Promise<void>,
): Promise<void> {
  let tarBytes: Buffer;
  try {
    tarBytes = zlib.gunzipSync(archive, { maxOutputLength: MAX_TOTAL_EXTRACTED_BYTES });
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  // npm tarballs use POSIX tar. Parse the small subset needed here directly so
  // archive extraction stays in memory and all writes continue through Obsidian.
  const decoder = new TextDecoder();
  const field = (block: Buffer, start: number, length: number) => {
    const end = block.indexOf(0, start);
    return decoder.decode(block.subarray(start, end < 0 || end >= start + length ? start + length : end));
  };
  const octal = (block: Buffer, start: number, length: number, label: string): number => {
    const value = field(block, start, length).trim().replace(/\0.*$/, '');
    if (!value) return 0;
    if (!/^[0-7]+$/.test(value)) throw new Error(`invalid ${label} in add-on archive`);
    const parsed = Number.parseInt(value, 8);
    if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${label} in add-on archive`);
    return parsed;
  };
  const paxValues = (data: Buffer): Record<string, string> => {
    const values: Record<string, string> = {};
    let offset = 0;
    while (offset < data.length) {
      const space = data.indexOf(0x20, offset);
      if (space < 0) throw new Error('invalid PAX header in add-on archive');
      const recordLength = Number.parseInt(data.toString('ascii', offset, space), 10);
      if (!Number.isSafeInteger(recordLength) || recordLength <= space - offset + 1 || offset + recordLength > data.length)
        throw new Error('invalid PAX header in add-on archive');
      const record = decoder.decode(data.subarray(space + 1, offset + recordLength - 1));
      const equals = record.indexOf('=');
      if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
      offset += recordLength;
    }
    return values;
  };

  let offset = 0;
  let total = 0;
  let longName: string | undefined;
  let localPax: Record<string, string> = {};
  const globalPax: Record<string, string> = {};
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = octal(header, 148, 8, 'header checksum');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (checksum !== expectedChecksum) throw new Error('invalid header checksum in add-on archive');

    const headerName = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${headerName}` : headerName);
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);
    const headerSize = octal(header, 124, 12, 'entry size');
    const dataStart = offset + 512;
    const dataEnd = dataStart + headerSize;
    const paddedEnd = dataStart + Math.ceil(headerSize / 512) * 512;
    if (dataEnd > tarBytes.length || paddedEnd > tarBytes.length) throw new Error(`truncated add-on archive entry: ${name}`);
    const data = tarBytes.subarray(dataStart, dataEnd);

    if (type === 'L') {
      longName = decoder.decode(data).replace(/[\0\n]+$/, '');
    } else if (type === 'x' || type === 'g') {
      const values = paxValues(data);
      if (type === 'g') Object.assign(globalPax, values);
      else localPax = values;
    } else {
      const attrs = { ...globalPax, ...localPax };
      const entryName = attrs.path ?? name;
      const size = attrs.size === undefined ? headerSize : Number(attrs.size);
      if (!Number.isSafeInteger(size) || size < 0)
        throw new Error(`invalid entry size in add-on archive: ${entryName}`);
      const entryEnd = dataStart + size;
      const entryPaddedEnd = dataStart + Math.ceil(size / 512) * 512;
      if (entryEnd > tarBytes.length || entryPaddedEnd > tarBytes.length)
        throw new Error(`truncated add-on archive entry: ${entryName}`);
      const isFile = type === '0' || type === '\0';
      if (isFile && select(entryName)) {
        if (size > MAX_ENTRY_BYTES)
          throw new Error(`archive entry exceeds the ${MAX_ENTRY_BYTES}-byte limit: ${entryName}`);
        if (size > MAX_TOTAL_EXTRACTED_BYTES - total)
          throw new Error(`archive contents exceed the ${MAX_TOTAL_EXTRACTED_BYTES}-byte limit`);
        total += size;
        await onFile(entryName, tarBytes.subarray(dataStart, entryEnd));
      }
      longName = undefined;
      localPax = {};
      offset = entryPaddedEnd;
      continue;
    }
    offset = paddedEnd;
  }
  if (offset + 512 > tarBytes.length && offset !== tarBytes.length)
    throw new Error('truncated add-on archive header');
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
