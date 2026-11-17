import { DiagramError } from '../core/types';

/** Reading draw.io files: `.drawio` (mxfile XML), `.drawio.svg` / `.drawio.flow` (SVG that carries the mxfile in `content`). */

export interface MxCell {
  id: string; parent?: string; value: string; style: string; vertex: boolean; edge: boolean; source?: string; target?: string;
  x: number; y: number; w: number; h: number; points: { x: number; y: number }[];
}

export interface XNode { tag: string; attrs: Record<string, string>; children: XNode[]; /** Set on `#text` nodes. */ text?: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescapeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

/** Small XML reader: elements and attributes only (that is all draw.io models use). No DTD or entity expansion beyond the five basics. */
export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  let nodes = 0, last = 0;
  const text = (t: string) => { if (t.trim() && stack.length > 1) stack[stack.length - 1]!.children.push({ tag: '#text', attrs: {}, children: [], text: t }); };
  while ((m = re.exec(src))) {
    text(unescapeXml(src.slice(last, m.index)));
    last = re.lastIndex;
    if (m[0].startsWith('<![CDATA[')) { text(m[0].slice(9, -3)); continue; }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (!m[2]) continue;
    if (++nodes > 20000) throw new DiagramError(['draw.io file is too large (over 20000 elements).']);
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = unescapeXml(a[2] ?? a[3] ?? '');
    const n: XNode = { tag: m[2], attrs, children: [] };
    stack[stack.length - 1]!.children.push(n);
    if (!m[4]) stack.push(n);
  }
  return root;
}

export const find = (n: XNode, tag: string): XNode | undefined => { for (const c of n.children) { if (c.tag === tag) return c; const r = find(c, tag); if (r) return r; } return undefined; };

/** Pull the XML text out of whichever container the file uses. */
export function extractMxfile(text: string): string | undefined {
  const t = text.trimStart();
  if (/^<(\?xml[^>]*\?>\s*)?<?(mxfile|mxGraphModel)\b/i.test(t) || /^<mxfile\b|^<mxGraphModel\b/.test(t)) return t;
  const svg = /<svg\b[^>]*>/i.exec(t);
  if (svg) {
    const c = /\scontent\s*=\s*"([^"]*)"/.exec(svg[0]) ?? /\scontent\s*=\s*'([^']*)'/.exec(svg[0]);
    if (c) return unescapeXml(c[1]!);
  }
  return undefined;
}

export const isDrawioSource = (text: string) => extractMxfile(text.slice(0, 4_000_000)) !== undefined;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const writing = writer.write(bytes as unknown as BufferSource).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20_000_000) {
        await reader.cancel();
        await writing.catch(() => undefined);
        throw new DiagramError(['draw.io diagram is too large once decompressed.']);
      }
      chunks.push(value);
    }
    await writing;
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    await writing.catch(() => undefined);
    throw e;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/** The `<mxGraphModel>` element of the first page, decompressing it when draw.io stored it compressed. */
export async function modelXml(mx: string): Promise<string> {
  if (/<mxGraphModel\b/.test(mx)) return mx;
  const d = /<diagram\b[^>]*>([\s\S]*?)<\/diagram>/.exec(mx);
  const body = d?.[1]?.trim();
  if (!body) throw new DiagramError(['No diagram found in the draw.io file.']);
  let raw: Uint8Array;
  try {
    const bin = atob(body.replace(/\s+/g, ''));
    raw = await inflateRaw(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch (e) {
    if (e instanceof DiagramError) throw e;
    throw new DiagramError(['Could not decompress the draw.io diagram (is the file damaged?).']);
  }
  try { return decodeURIComponent(new TextDecoder().decode(raw)); } catch { throw new DiagramError(['Could not decode the draw.io diagram.']); }
}

const num = (v: string | undefined, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Every vertex and edge of the first page. `<object>`/`<UserObject>` wrappers contribute their label and id. */
export async function parseDrawio(text: string): Promise<MxCell[]> {
  const mx = extractMxfile(text);
  if (!mx) throw new DiagramError(['This is not a draw.io file (no mxfile found).']);
  const model = find(parseXml(await modelXml(mx)), 'mxGraphModel');
  const rootEl = model && find(model, 'root');
  if (!rootEl) throw new DiagramError(['draw.io file has no diagram content.']);
  const cells: MxCell[] = [];
  for (const el of rootEl.children) {
    const wrapped = el.tag === 'object' || el.tag === 'UserObject';
    const c = wrapped ? el.children.find((x) => x.tag === 'mxCell') : el.tag === 'mxCell' ? el : undefined;
    if (!c) continue;
    const a = c.attrs, id = (wrapped ? el.attrs.id : a.id) ?? '';
    if (!id) continue;
    const geo = c.children.find((x) => x.tag === 'mxGeometry');
    const arr = geo?.children.find((x) => x.tag === 'Array');
    cells.push({
      id, parent: a.parent, value: (wrapped ? el.attrs.label ?? '' : a.value) ?? '', style: a.style ?? '', vertex: a.vertex === '1', edge: a.edge === '1',
      source: a.source, target: a.target,
      x: num(geo?.attrs.x), y: num(geo?.attrs.y), w: num(geo?.attrs.width), h: num(geo?.attrs.height),
      points: (arr?.children ?? []).filter((p) => p.tag === 'mxPoint').map((p) => ({ x: num(p.attrs.x), y: num(p.attrs.y) })),
    });
  }
  return cells;
}

/** `key=value;key=value` style string. */
export function styleMap(style: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of style.split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) m.set(part, ''); else m.set(part.slice(0, i), part.slice(i + 1));
  }
  return m;
}

/** Visible text of a draw.io label: HTML labels are flattened to one line. */
export function plainLabel(value: string, html: boolean): string {
  let s = value;
  if (html || /<[a-z][\s\S]*>/i.test(s)) s = unescapeXml(s.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '));
  return s.replace(/\s+/g, ' ').trim();
}
