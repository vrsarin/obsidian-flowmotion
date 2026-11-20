import { DiagramError } from '../core/types';

/** Reading draw.io files: `.drawio` (mxfile XML), `.drawio.svg` / `.drawio.flow` (SVG that carries the mxfile in `content`). */

export interface MxCell {
  id: string; parent?: string; value: string; style: string; vertex: boolean; edge: boolean; source?: string; target?: string;
  x: number; y: number; w: number; h: number; points: { x: number; y: number }[];
}

export interface XNode { tag: string; attrs: Record<string, string>; children: XNode[]; /** Set on `#text` nodes. */ text?: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescapeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e.startsWith('#')) { const n = e[1]!.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

/** Small XML reader: elements and attributes only (that is all draw.io models use). No DTD or entity expansion beyond the five basics. */
const xmlName = (c: string | undefined) => c !== undefined && /[\w:.-]/.test(c);
const xmlSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

type TagEnd = { end: number; selfClosing: boolean };
type XmlToken = { end: number; cdata?: boolean; closing?: boolean; name?: string; nameEnd?: number; selfClosing?: boolean };

class XmlScanner {
  private readonly quotes: Int32Array[];
  private readonly tails = new Map<number, TagEnd | null>();
  private readonly endings = new Map<string, number>();

  constructor(private readonly src: string) {
    this.quotes = [new Int32Array(src.length + 1), new Int32Array(src.length + 1)];
    let single = -1, double = -1;
    for (let i = src.length - 1; i >= 0; i--) {
      if (src[i] === "'") single = i;
      if (src[i] === '"') double = i;
      this.quotes[0]![i] = single; this.quotes[1]![i] = double;
    }
    this.quotes[0]![src.length] = this.quotes[1]![src.length] = -1;
  }

  private skipSpace(pos: number): number {
    while (xmlSpace(this.src[pos])) pos++;
    return pos;
  }

  private skipName(pos: number): number {
    while (xmlName(this.src[pos])) pos++;
    return pos;
  }

  private attributeEnd(pos: number): number {
    pos = this.skipSpace(this.skipName(pos));
    if (this.src[pos++] !== '=') return -1;
    pos = this.skipSpace(pos);
    const quote = this.src[pos++];
    if (quote !== "'" && quote !== '"') return -1;
    const end = this.quotes[quote === "'" ? 0 : 1]![pos] ?? -1;
    return end < 0 ? -1 : end + 1;
  }

  private tagEnd(start: number): TagEnd | null {
    const visited: number[] = [];
    let pos = start, result: TagEnd | null;
    while (true) {
      if (this.tails.has(pos)) { result = this.tails.get(pos)!; break; }
      visited.push(pos);
      const next = this.skipSpace(pos);
      if (this.src[next] === '>') { result = { end: next + 1, selfClosing: false }; break; }
      if (this.src[next] === '/' && this.src[next + 1] === '>') { result = { end: next + 2, selfClosing: true }; break; }
      if (next === pos || !xmlName(this.src[next])) { result = null; break; }
      pos = this.attributeEnd(next);
      if (pos < 0) { result = null; break; }
    }
    for (const p of visited) this.tails.set(p, result);
    return result;
  }

  private specialEnd(delimiter: string, from: number): number {
    let end = this.endings.get(delimiter) ?? -1;
    if (end < from) end = this.src.indexOf(delimiter, from);
    if (end < 0) end = Number.POSITIVE_INFINITY;
    this.endings.set(delimiter, end);
    return end + delimiter.length;
  }

  token(start: number): XmlToken | undefined {
    const src = this.src;
    if (src.startsWith('<!--', start)) return { end: this.specialEnd('-->', start + 4) };
    if (src.startsWith('<![CDATA[', start)) return { end: this.specialEnd(']]>', start + 9), cdata: true };
    if (src.startsWith('<?', start)) return { end: this.specialEnd('?>', start + 2) };
    if (src.startsWith('<!DOCTYPE', start)) return { end: this.specialEnd('>', start + 9) };
    const closing = src[start + 1] === '/';
    const nameStart = start + (closing ? 2 : 1);
    const nameEnd = this.skipName(nameStart);
    if (nameEnd === nameStart) return undefined;
    const name = src.slice(nameStart, nameEnd);
    if (closing) {
      const pos = this.skipSpace(nameEnd);
      return src[pos] === '>' ? { end: pos + 1, closing: true } : undefined;
    }
    const tail = this.tagEnd(nameEnd);
    return tail ? { ...tail, name, nameEnd } : undefined;
  }

  attributes(start: number, end: number): Record<string, string> {
    const attrs: Record<string, string> = {};
    let pos = start;
    while (pos < end) {
      pos = this.skipSpace(pos);
      if (!xmlName(this.src[pos])) break;
      const attrStart = pos;
      pos = this.skipName(pos);
      const attr = this.src.slice(attrStart, pos);
      pos = this.skipSpace(this.skipSpace(pos) + 1);
      const quote = this.src[pos++]!;
      const quoteEnd = this.quotes[quote === "'" ? 0 : 1]![pos]!;
      attrs[attr] = unescapeXml(this.src.slice(pos, quoteEnd));
      pos = quoteEnd + 1;
    }
    return attrs;
  }
}

function appendXmlToken(src: string, start: number, token: XmlToken, stack: XNode[], scanner: XmlScanner): void {
  if (token.cdata) {
    const text = src.slice(start + 9, token.end - 3);
    if (text.trim() && stack.length > 1) stack.at(-1)!.children.push({ tag: '#text', attrs: {}, children: [], text });
  } else if (token.closing) {
    if (stack.length > 1) stack.pop();
  } else if (token.name) {
    const n: XNode = { tag: token.name, attrs: scanner.attributes(token.nameEnd!, token.end), children: [] };
    stack.at(-1)!.children.push(n);
    if (!token.selfClosing) stack.push(n);
  }
}

export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [] };
  const stack = [root], scanner = new XmlScanner(src);
  let nodes = 0, last = 0;
  const text = (t: string) => { if (t.trim() && stack.length > 1) stack.at(-1)!.children.push({ tag: '#text', attrs: {}, children: [], text: t }); };
  let cursor = 0;
  while (cursor < src.length) {
    const start = src.indexOf('<', cursor);
    if (start < 0) break;
    cursor = start + 1;
    const token = scanner.token(start);
    if (!token || !Number.isFinite(token.end)) continue;
    text(unescapeXml(src.slice(last, start)));
    last = cursor = token.end;
    if (token.name && ++nodes > 20000) throw new DiagramError(['draw.io file is too large (over 20000 elements).']);
    appendXmlToken(src, start, token, stack, scanner);
  }
  return root;
}

export const find = (n: XNode, tag: string): XNode | undefined => {
  for (const c of n.children) {
    if (c.tag === tag) return c;
    const r = find(c, tag);
    if (r) return r;
  }
  return undefined;
};

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
  const read = (): Promise<void> => reader.read().then(({ done, value }) => {
    if (done) return;
    size += value.byteLength;
    if (size > 20_000_000) throw new DiagramError(['draw.io diagram is too large once decompressed.']);
    chunks.push(value);
    return read();
  });
  try {
    await read();
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
    raw = await inflateRaw(Uint8Array.from(bin, (c) => c.codePointAt(0)!));
  } catch (e) {
    if (e instanceof DiagramError) throw e;
    throw new DiagramError(['Could not decompress the draw.io diagram (is the file damaged?).']);
  }
  try { return decodeURIComponent(new TextDecoder().decode(raw)); } catch { throw new DiagramError(['Could not decode the draw.io diagram.']); }
}

const num = (v: string | undefined, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function cellOf(el: XNode): MxCell | undefined {
  const wrapped = el.tag === 'object' || el.tag === 'UserObject';
  const c = wrapped ? el.children.find((x) => x.tag === 'mxCell') : el;
  if (c?.tag !== 'mxCell') return undefined;
  const a = c.attrs, id = (wrapped ? el.attrs.id : a.id) ?? '';
  if (!id) return undefined;
  const geo = c.children.find((x) => x.tag === 'mxGeometry');
  const arr = geo?.children.find((x) => x.tag === 'Array');
  return {
    id, parent: a.parent, value: (wrapped ? el.attrs.label ?? '' : a.value) ?? '', style: a.style ?? '', vertex: a.vertex === '1', edge: a.edge === '1',
    source: a.source, target: a.target,
    x: num(geo?.attrs.x), y: num(geo?.attrs.y), w: num(geo?.attrs.width), h: num(geo?.attrs.height),
    points: (arr?.children ?? []).filter((p) => p.tag === 'mxPoint').map((p) => ({ x: num(p.attrs.x), y: num(p.attrs.y) })),
  };
}

/** Every vertex and edge of the first page. `<object>`/`<UserObject>` wrappers contribute their label and id. */
export async function parseDrawio(text: string): Promise<MxCell[]> {
  const mx = extractMxfile(text);
  if (!mx) throw new DiagramError(['This is not a draw.io file (no mxfile found).']);
  const model = find(parseXml(await modelXml(mx)), 'mxGraphModel');
  const rootEl = model && find(model, 'root');
  if (!rootEl) throw new DiagramError(['draw.io file has no diagram content.']);
  const cells: MxCell[] = [];
  for (const el of rootEl.children) {
    const c = cellOf(el);
    if (c) cells.push(c);
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
  const lastClose = s.lastIndexOf('>');
  if (html || (lastClose >= 0 && /<[a-z]/i.test(s.slice(0, lastClose)))) {
    s = s.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ');
    let result = '', pos = 0;
    while (pos < s.length) {
      const start = s.indexOf('<', pos);
      if (start < 0) break;
      const end = s.indexOf('>', start + 1);
      if (end < 0) break;
      result += s.slice(pos, start);
      pos = end + 1;
    }
    s = unescapeXml((result + s.slice(pos)).replaceAll('&nbsp;', ' '));
  }
  return s.replace(/\s+/g, ' ').trim();
}
