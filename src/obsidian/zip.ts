/** Minimal zip reader for the draw.io download (a .war file is a zip). Supports stored and deflated entries. */

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

export interface ZipLimits { maxEntryBytes: number; maxTotalBytes: number }

/** Calls `onFile` for each selected file, bounding inflated output before it is allocated. */
export async function unzip(
  zip: Uint8Array,
  select: (path: string) => boolean,
  onFile: (path: string, data: Uint8Array) => Promise<void> | void,
  inflateRaw: (data: Uint8Array, maxOutputBytes: number) => Uint8Array,
  limits: ZipLimits,
): Promise<void> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('corrupt archive: no zip directory');
  const count = u16(zip, eocd + 10);
  let at = u32(zip, eocd + 16);
  let totalBytes = 0;
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(zip, at) !== 0x02014b50) throw new Error('corrupt archive: bad zip directory');
    const method = u16(zip, at + 10), csize = u32(zip, at + 20), usize = u32(zip, at + 24), nameLen = u16(zip, at + 28), extraLen = u16(zip, at + 30), commentLen = u16(zip, at + 32), local = u32(zip, at + 42);
    const name = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || !select(name)) continue;
    if (usize > limits.maxEntryBytes) throw new Error(`archive entry exceeds the ${limits.maxEntryBytes}-byte limit: ${name}`);
    if (usize > limits.maxTotalBytes - totalBytes) throw new Error(`archive contents exceed the ${limits.maxTotalBytes}-byte limit`);
    if (u32(zip, local) !== 0x04034b50) throw new Error('corrupt archive: bad zip entry');
    const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    const raw = zip.subarray(start, start + csize);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression (${method}) for ${name}`);
    const maxOutputBytes = Math.max(1, Math.min(limits.maxEntryBytes, limits.maxTotalBytes - totalBytes));
    const data = method === 0 ? raw : inflateRaw(raw, maxOutputBytes);
    if (data.byteLength !== usize) throw new Error(`archive entry has an invalid size: ${name}`);
    if (data.byteLength > maxOutputBytes) throw new Error(`archive entry exceeds the extraction limit: ${name}`);
    totalBytes += data.byteLength;
    await onFile(name, data);
  }
}
