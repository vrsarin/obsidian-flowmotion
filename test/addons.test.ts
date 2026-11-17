import { describe, expect, it } from 'vitest';
import { DRAWIO } from '../src/obsidian/addons';
import { unzip } from '../src/obsidian/zip';

const enc = new TextEncoder();

describe('add-on downloads', () => {
  it('keeps only what draw.io needs from draw.war, without the xml stencil sources', () => {
    expect(DRAWIO.target('index.html')).toBe('index.html');
    expect(DRAWIO.target('js/app.min.js')).toBe('js/app.min.js');
    expect(DRAWIO.target('js/shapes-14-6-5.min.js')).toBe('js/shapes-14-6-5.min.js');
    expect(DRAWIO.target('resources/dia_en.txt')).toBe('resources/dia_en.txt');
    expect(DRAWIO.target('resources/dia_fr.txt')).toBeNull();
    expect(DRAWIO.target('stencils/clipart/a.png')).toBe('stencils/clipart/a.png');
    expect(DRAWIO.target('stencils/android/android.xml')).toBeNull();
    expect(DRAWIO.target('js/viewer.min.js')).toBeNull();
    expect(DRAWIO.target('WEB-INF/web.xml')).toBeNull();
  });

  it('finds the current draw.io release from its VERSION file', async () => {
    const asked: string[] = [];
    const src = await DRAWIO.resolve(async (u) => { asked.push(u); return '32.6.10\n'; });
    expect(asked).toEqual(['https://raw.githubusercontent.com/jgraph/drawio/dev/VERSION']);
    expect(src.url).toBe('https://github.com/jgraph/drawio/releases/download/v32.6.10/draw.war');
    expect(src.extras?.[0]?.url).toContain('/v32.6.10/LICENSE');
    await expect(DRAWIO.resolve(async () => '<html>')).rejects.toThrow('draw.io version');
  });

  it('reads stored and deflated entries from a zip', async () => {
    const zlib = await import('node:zlib');
    const crc = 0; const nameA = enc.encode('a.txt'), nameB = enc.encode('dir/b.txt');
    const A = enc.encode('hello'), B = zlib.deflateRawSync(enc.encode('x'.repeat(50)));
    const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255);
    const local = (name: Uint8Array, method: number, data: Uint8Array) => [...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4), ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(name.length, 2), ...le(0, 2), ...name, ...data];
    const l1 = local(nameA, 0, A), l2 = local(nameB, 8, B);
    const central = (name: Uint8Array, method: number, data: Uint8Array, off: number) => [...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4), ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(name.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(off, 4), ...name];
    const c = [...central(nameA, 0, A, 0), ...central(nameB, 8, B, l1.length)];
    const end = [...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(2, 2), ...le(2, 2), ...le(c.length, 4), ...le(l1.length + l2.length, 4), ...le(0, 2)];
    const zip = Uint8Array.from([...l1, ...l2, ...c, ...end]);
    const got: Record<string, string> = {};
    await unzip(zip, () => true, (p, d) => { got[p] = new TextDecoder().decode(d); }, (d) => zlib.inflateRawSync(d));
    expect(got).toEqual({ 'a.txt': 'hello', 'dir/b.txt': 'x'.repeat(50) });
  });
});
