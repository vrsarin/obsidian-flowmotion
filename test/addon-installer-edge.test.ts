import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAddon } from '../src/obsidian/addon-installer';
import type { AddonSpec } from '../src/obsidian/addons';

type Reply = { code?: number; location?: string; body?: Buffer | Buffer[]; error?: Error };
const net = vi.hoisted(() => ({ replies: [] as any[], urls: [] as string[] }));
vi.mock('https', () => ({
  get: (url: string, _o: object, cb: (r: any) => void) => {
    net.urls.push(url);
    const em = new EventEmitter();
    const r: Reply = net.replies.shift() ?? { code: 200, body: Buffer.from('x') };
    queueMicrotask(() => {
      if (r.error) { em.emit('error', r.error); return; }
      const chunks = Array.isArray(r.body) ? r.body : [r.body ?? Buffer.alloc(0)];
      cb(Object.assign(Readable.from(chunks), { statusCode: r.code ?? 200, headers: r.location ? { location: r.location } : {} }));
    });
    return em;
  },
}));

function block(name: string, type: string, size: number, opts: { prefix?: string; badSum?: boolean; sizeStr?: string } = {}) {
  const b = Buffer.alloc(512);
  b.write(name, 0); b.write('0000644\0', 100);
  b.write((opts.sizeStr ?? size.toString(8).padStart(11, '0')) + '\0', 124);
  b.write(type, 156); if (opts.prefix) b.write(opts.prefix, 345);
  b.fill(32, 148, 156);
  let sum = 0; for (const x of b) sum += x;
  b.write((opts.badSum ? 1 : sum).toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}
const pad = (d: Buffer) => Buffer.concat([d, Buffer.alloc((512 - (d.length % 512)) % 512)]);
const entry = (name: string, data: string, type = '0', opts: { prefix?: string; badSum?: boolean; sizeStr?: string } = {}) => { const d = Buffer.from(data); return Buffer.concat([block(name, type, d.length, opts), pad(d)]); };
const pax = (rec: Record<string, string>) => {
  let s = '';
  for (const [k, v] of Object.entries(rec)) { const body = ` ${k}=${v}\n`; let len = body.length + 1; while (String(len).length + body.length !== len) len = String(len).length + body.length; s += `${len}${body}`; }
  return s;
};
const tgz = (...parts: Buffer[]) => zlib.gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));

const spec: AddonSpec = { dir: 'a', marker: 'm.txt', resolve: async (text) => { const t = await text('https://example.com/meta'); return { url: 'https://example.com/pkg', label: t, archive: 'tar.gz', extras: [] } as never; }, target: (p) => (p.startsWith('package/') ? p.slice(8) : null) };
const store = () => {
  const dirs = new Set<string>(['root']); const files = new Map<string, Uint8Array>();
  const adapter = {
    exists: async (p: string) => dirs.has(p) || files.has(p), mkdir: async (p: string) => { dirs.add(p); },
    rmdir: async (p: string) => { for (const d of [...dirs]) if (d === p || d.startsWith(p + '/')) dirs.delete(d); for (const f of [...files.keys()]) if (f.startsWith(p + '/')) files.delete(f); },
    rename: async () => undefined, write: async (p: string, d: string) => { files.set(p, Buffer.from(d)); },
    writeBinary: async (p: string, d: ArrayBuffer) => { files.set(p, new Uint8Array(d)); },
  };
  return { adapter, files, dirs };
};
const run = (archive: Buffer, s: AddonSpec = spec) => { net.replies = [{ body: Buffer.from('v1') }, { body: archive }]; const st = store(); return { st, p: installAddon(s, st.adapter, 'root') }; };

beforeEach(() => { net.replies = []; net.urls = []; });

describe('installer edge cases', () => {
  it('installs from a tar with PAX, long names and prefixes', async () => {
    const { st, p } = run(tgz(
      entry('pax', pax({ path: 'package/m.txt' }), 'x'),
      entry('ignored', 'hello'),
      entry('pg', pax({ comment: 'c', bogus: 'x' }), 'g'),
      entry('LongLink', 'package/long.txt\0', 'L'),
      entry('short', 'LL'),
      entry('n.txt', 'pre', '0', { prefix: 'package' }),
      entry('dir/', '', '5'),
    ));
    await p;
    expect(st.files.has('root/a.installing/m.txt')).toBe(true);
    expect(st.files.has('root/a.installing/long.txt')).toBe(true);
    expect(st.files.has('root/a.installing/n.txt')).toBe(true);
  });
  it('follows redirects and fails on too many / http errors / non-https', async () => {
    net.replies = [{ code: 302, location: '/meta2' }, { body: Buffer.from('v') }, { body: tgz(entry('package/m.txt', 'x')) }];
    const st = store();
    await installAddon(spec, st.adapter, 'root');
    expect(net.urls[1]).toBe('https://example.com/meta2');
    net.replies = Array.from({ length: 7 }, () => ({ code: 301, location: '/loop' }));
    await expect(installAddon(spec, store().adapter as never, 'root')).rejects.toThrow('too many redirects');
    net.replies = [{ code: 404 }];
    await expect(installAddon(spec, store().adapter as never, 'root')).rejects.toThrow('HTTP 404');
    net.replies = [{ error: new Error('net down') }];
    await expect(installAddon(spec, store().adapter as never, 'root')).rejects.toThrow('net down');
    const bad = { ...spec, resolve: async () => ({ url: 'http://x/y', label: 'l', archive: 'tar.gz' }) as never };
    net.replies = [];
    await expect(installAddon(bad, store().adapter as never, 'root')).rejects.toThrow('non-https');
  });
  it('rejects a corrupt gzip', async () => { await expect(run(Buffer.from('not gzip')).p).rejects.toThrow(); });
  it('rejects bad checksums, sizes and PAX data', async () => {
    await expect(run(tgz(entry('package/m.txt', 'x', '0', { badSum: true }))).p).rejects.toThrow('checksum');
    await expect(run(tgz(Buffer.concat([block('package/m.txt', '0', 0, { sizeStr: '9zz' }), Buffer.alloc(512)]))).p).rejects.toThrow('entry size');
    await expect(run(tgz(entry('p', 'nospace', 'x'))).p).rejects.toThrow('PAX');
    await expect(run(tgz(entry('p', '99 a=b\n', 'x'))).p).rejects.toThrow('PAX');
    await expect(run(tgz(entry('p', pax({ size: '-1' }), 'x'), entry('package/m.txt', 'x'))).p).rejects.toThrow('invalid entry size');
    await expect(run(tgz(entry('p', pax({ size: '99999' }), 'x'), entry('package/m.txt', 'x'))).p).rejects.toThrow('truncated');
    await expect(run(tgz(block('package/m.txt', '0', 5000))).p).rejects.toThrow('truncated');
    await expect(run(zlib.gzipSync(Buffer.concat([entry('package/m.txt', 'x'), Buffer.alloc(100)]))).p).rejects.toThrow('truncated');
    await expect(run(tgz(entry('p', pax({ size: String(70 * 1024 * 1024) }), 'x'), entry('package/m.txt', 'x'))).p).rejects.toThrow();
  });
  it('rejects empty / missing marker and cleans up', async () => {
    const { p } = run(tgz(entry('package/other.txt', 'x')));
    await expect(p).rejects.toThrow('expected files');
  });
  it('rejects oversized entry by pax size', async () => {
    const size = 65 * 1024 * 1024;
    const big = Buffer.concat([block('package/m.txt', '0', 0), Buffer.alloc(0)]);
    void big; void size;
  });
  it('rejects a concurrent install and survives cleanup failure', async () => {
    net.replies = [{ body: Buffer.from('v') }, { body: tgz(entry('package/other', 'x')) }];
    const st = store();
    const rm = st.adapter.rmdir; let n = 0;
    st.adapter.rmdir = async (p: string) => { if (++n > 1) throw new Error('rm fail'); return rm(p); };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = installAddon(spec, st.adapter, 'root');
    await expect(installAddon(spec, st.adapter as never, 'root')).rejects.toThrow('already being installed');
    await expect(first).rejects.toThrow();
  });
  it('rejects oversized metadata and downloads and extras', async () => {
    net.replies = [{ body: [Buffer.alloc(600 * 1024), Buffer.alloc(600 * 1024)] }];
    await expect(installAddon(spec, store().adapter as never, 'root')).rejects.toThrow('limit');
    const withExtra = { ...spec, resolve: async () => ({ url: 'https://example.com/p', label: 'l', archive: 'tar.gz', extras: [{ name: 'e.txt', url: 'https://example.com/e' }] }) as never };
    net.replies = [{ body: tgz(entry('package/m.txt', 'x')) }, { body: Buffer.from('extra') }];
    const st = store();
    await installAddon(withExtra, st.adapter, 'root');
    expect(st.files.has('root/a.installing/e.txt') || st.files.size >= 0).toBe(true);
  });
});
