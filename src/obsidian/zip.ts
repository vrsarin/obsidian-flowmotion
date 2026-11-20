/** Minimal zip reader for the draw.io download (a .war file is a zip). Supports stored and deflated entries. */

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

export interface ZipLimits { maxEntryBytes: number; maxTotalBytes: number }

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  nextOffset: number;
}

interface ZipReader {
  zip: Uint8Array;
  count: number;
  select: (path: string) => boolean;
  onFile: (path: string, data: Uint8Array) => Promise<void> | void;
  inflateRaw: (data: Uint8Array, maxOutputBytes: number) => Uint8Array;
  limits: ZipLimits;
  decoder: TextDecoder;
}

function readEntry(zip: Uint8Array, offset: number, decoder: TextDecoder): ZipEntry {
  const method = u16(zip, offset + 10);
  const compressedSize = u32(zip, offset + 20);
  const size = u32(zip, offset + 24);
  const nameLength = u16(zip, offset + 28);
  const extraLength = u16(zip, offset + 30);
  const commentLength = u16(zip, offset + 32);
  const localOffset = u32(zip, offset + 42);
  const name = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength));
  return {
    name,
    method,
    compressedSize,
    size,
    localOffset,
    nextOffset: offset + 46 + nameLength + extraLength + commentLength,
  };
}

function extractEntry(
  zip: Uint8Array,
  entry: ZipEntry,
  select: (path: string) => boolean,
  inflateRaw: (data: Uint8Array, maxOutputBytes: number) => Uint8Array,
  limits: ZipLimits,
  totalBytes: number,
): { data?: Uint8Array; totalBytes: number } {
  if (entry.name.endsWith('/') || !select(entry.name)) return { totalBytes };
  if (entry.size > limits.maxEntryBytes)
    throw new Error(`archive entry exceeds the ${limits.maxEntryBytes}-byte limit: ${entry.name}`);
  if (entry.size > limits.maxTotalBytes - totalBytes)
    throw new Error(`archive contents exceed the ${limits.maxTotalBytes}-byte limit`);
  if (u32(zip, entry.localOffset) !== 0x04034b50) throw new Error('corrupt archive: bad zip entry');
  const start = entry.localOffset + 30 + u16(zip, entry.localOffset + 26) + u16(zip, entry.localOffset + 28);
  const raw = zip.subarray(start, start + entry.compressedSize);
  if (entry.method !== 0 && entry.method !== 8)
    throw new Error(`unsupported zip compression (${entry.method}) for ${entry.name}`);
  const maxOutputBytes = Math.max(1, Math.min(limits.maxEntryBytes, limits.maxTotalBytes - totalBytes));
  const data = entry.method === 0 ? raw : inflateRaw(raw, maxOutputBytes);
  if (data.byteLength !== entry.size) throw new Error(`archive entry has an invalid size: ${entry.name}`);
  if (data.byteLength > maxOutputBytes) throw new Error(`archive entry exceeds the extraction limit: ${entry.name}`);
  return { data, totalBytes: totalBytes + data.byteLength };
}

async function writeEntries(
  reader: ZipReader,
  index: number,
  offset: number,
  totalBytes: number,
): Promise<void> {
  if (index >= reader.count) return;
  if (u32(reader.zip, offset) !== 0x02014b50) throw new Error('corrupt archive: bad zip directory');
  const entry = readEntry(reader.zip, offset, reader.decoder);
  const extracted = extractEntry(reader.zip, entry, reader.select, reader.inflateRaw, reader.limits, totalBytes);
  if (extracted.data) await reader.onFile(entry.name, extracted.data);
  await Promise.resolve();
  await writeEntries(reader, index + 1, entry.nextOffset, extracted.totalBytes);
}

/** Calls `onFile` for each selected file, bounding inflated output before it is allocated. */
export async function unzip(
  zip: Uint8Array,
  select: (path: string) => boolean,
  onFile: (path: string, data: Uint8Array) => Promise<void> | void,
  inflateRaw: (data: Uint8Array, maxOutputBytes: number) => Uint8Array,
  limits: ZipLimits,
): Promise<void> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('corrupt archive: no zip directory');
  await writeEntries({
    zip,
    count: u16(zip, eocd + 10),
    select,
    onFile,
    inflateRaw,
    limits,
    decoder: new TextDecoder(),
  }, 0, u32(zip, eocd + 16), 0);
}
