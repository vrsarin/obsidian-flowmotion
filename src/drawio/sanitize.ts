import type { Pt } from '../core/geometry';
import { find, parseXml, type XNode } from './parse';

/** Showing a draw.io SVG inside the page: keep the drawing, drop anything that could run code or load from elsewhere. */

export interface Backdrop { inner: string; /** Size of the SVG's own coordinate box. */ w: number; h: number }

const SVG_TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'switch', 'foreignObject', 'image', 'style', 'title', 'desc', 'use', 'symbol',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker', 'filter', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feMerge', 'feMergeNode', 'feFlood', 'feComposite', 'feDropShadow', 'a']);
const HTML_TAGS = new Set(['div', 'span', 'p', 'br', 'b', 'i', 'u', 's', 'strong', 'em', 'font', 'sub', 'sup', 'small', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code']);
const VOID = new Set(['br']);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_CSS_FUNCTIONS = new Set(['var', 'light-dark', 'rgb', 'rgba', 'hsl', 'hsla', 'calc', 'min', 'max', 'clamp']);

/** CSS values may use local fragments and non-resource functions only. */
const cssOk = (v: string) => {
  if (/@|\\|\/\*|<|javascript:|expression\s*\(|behavior\s*:|-moz-binding/i.test(v)) return false;
  const withoutUrls = v.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, _q, href: string) => href.startsWith('#') ? '' : '!');
  if (withoutUrls.includes('!') || /\burl\s*\(/i.test(withoutUrls)) return false;
  return [...withoutUrls.matchAll(/([-\w]+)\s*\(/g)].every((m) => SAFE_CSS_FUNCTIONS.has(m[1]!.toLowerCase()));
};
const refOk = (v: string) => v.startsWith('#') || /^data:image\/(?:png|jpe?g|gif|webp)(?:;[\w=.-]+)*;base64,[A-Za-z0-9+/=\s]*$/i.test(v);

function safeStylesheet(src: string, rootId: string | undefined, scopedId: string): string {
  if (!rootId || !/^[\w.-]+$/.test(rootId)) return '';
  let css = src.trim();
  const supports = /^@supports\s*\(\s*color\s*:\s*light-dark\(\s*#[\da-f]{3,8}\s*,\s*#[\da-f]{3,8}\s*\)\s*\)\s*\{([\s\S]*)\}\s*$/i.exec(css);
  if (supports) css = supports[1]!;
  if (/@|\/\*|\\/.test(css)) return '';
  const output: string[] = [];
  let at = 0;
  while (at < css.length) {
    while (/\s/.test(css[at] ?? '')) at++;
    if (at === css.length) break;
    const open = css.indexOf('{', at), close = open < 0 ? -1 : css.indexOf('}', open + 1);
    if (open < 0 || close < 0 || css.indexOf('{', open + 1) >= 0 && css.indexOf('{', open + 1) < close) return '';
    const selectors = css.slice(at, open).trim().split(',').map((s) => s.trim());
    const body = css.slice(open + 1, close);
    const declarations = body.split(';').map((d) => d.trim()).filter(Boolean);
    const safe = selectors.length > 0 && selectors.every((s) => s === `#${rootId}`) &&
      declarations.length > 0 && declarations.every((d) => {
        const m = /^(--ge-adaptive-(?:bg|fg))\s*:\s*(.+)$/.exec(d);
        return !!m && cssOk(m[2]!);
      });
    if (safe) output.push(`#${scopedId}{${declarations.join(';')}}`);
    at = close + 1;
  }
  return output.join('');
}

/** The sanitised content of a draw.io SVG (without the outer <svg>), with every id prefixed so several copies can share a page. */
export function sanitizeSvg(svg: string, prefix: string): (Backdrop & { rootId?: string }) | undefined {
  let doc: XNode;
  try { doc = parseXml(svg); } catch { return undefined; }
  const root = find(doc, 'svg');
  if (!root) return undefined;
  const vb = (root.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const w = vb.length === 4 && vb.every(Number.isFinite) ? vb[2]! : parseFloat(root.attrs.width ?? ''), h = vb.length === 4 && vb.every(Number.isFinite) ? vb[3]! : parseFloat(root.attrs.height ?? '');
  if (!(w > 0 && h > 0) || w > 100000 || h > 100000) return undefined;
  const rootId = root.attrs.id;
  const pid = (id: string) => `${prefix}-${id}`;
  const rewriteRefs = (v: string) => v.replace(/url\(\s*(['"]?)#([^'")]+)\1\s*\)/g, (_m, _q, id: string) => `url(#${pid(id)})`);

  const out = (n: XNode, inHtml: boolean): string => {
    if (n.tag === '#text') return esc(n.text ?? '');
    const name = n.tag.replace(/^svg:/, '');
    const html = inHtml || name === 'foreignObject' ? inHtml : false;
    const isHtml = inHtml && HTML_TAGS.has(name);
    if (!isHtml && !SVG_TAGS.has(name) && !(inHtml && HTML_TAGS.has(name))) return ''; // unknown element: drop with its children
    if (name === 'style') {
      const css = n.children.map((c) => c.text ?? '').join('');
      return `<style>${safeStylesheet(css, rootId, rootId ? pid(rootId) : '')}</style>`;
    }
    const attrs: string[] = [];
    for (const [k, v] of Object.entries(n.attrs)) {
      const key = k.replace(/^xlink:/, 'xlink:');
      if (!/^[a-zA-Z][\w:.-]*$/.test(k) || /^on/i.test(k) || k === 'xmlns' || k.startsWith('xmlns:') || k === 'content' || k === 'requiredFeatures') continue;
      if (k === 'href' || k === 'xlink:href') {
        if (!refOk(v)) continue;
        attrs.push(`${key}="${esc(v.startsWith('#') ? `#${pid(v.slice(1))}` : v)}"`);
        continue;
      }
      if (k === 'id') { attrs.push(`id="${esc(pid(v))}"`); continue; }
      if (/^(aria-labelledby|aria-describedby|for)$/.test(k)) {
        attrs.push(`${key}="${esc(v.split(/\s+/).filter(Boolean).map(pid).join(' '))}"`);
        continue;
      }
      if (k === 'style' || /^(fill|stroke|filter|clip-path|mask|marker-start|marker-mid|marker-end)$/.test(k)) { if (!cssOk(v)) continue; attrs.push(`${k}="${esc(rewriteRefs(v))}"`); continue; }
      if (/javascript:|data:text|vbscript:/i.test(v)) continue;
      attrs.push(`${k}="${esc(v)}"`);
    }
    const kids = n.children.map((c) => out(c, name === 'foreignObject' ? true : html || inHtml)).join('');
    if (name === 'div' && inHtml) attrs.push('xmlns="http://www.w3.org/1999/xhtml"');
    const tag = name === 'a' ? 'g' : name;
    if (name === 'div' || (inHtml && HTML_TAGS.has(name))) return VOID.has(name) ? `<${name}/>` : `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}>${kids}</${name}>`;
    return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${kids}</${tag}>`;
  };
  const inner = root.children.map((c) => out(c, false)).join('');
  return { inner, w, h, ...(rootId && { rootId: pid(rootId) }) };
}

/** Re-namespace already-sanitized SVG definitions for each rendered copy. */
export function namespaceSanitizedSvg(inner: string, prefix: string, replacement: string): string {
  let doc: XNode;
  try { doc = parseXml(inner); } catch { return ''; }
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ref = new RegExp(`#${escapedPrefix}-([\\w.-]+)`, 'g');
  const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const serialize = (n: XNode, inStyle = false): string => {
    if (n.tag === '#text') return esc(inStyle ? (n.text ?? '').replace(ref, `#${replacement}-$1`) : n.text ?? '');
    const attrs = Object.entries(n.attrs).map(([k, v]) => {
      const value = k === 'id' && v.startsWith(`${prefix}-`)
        ? `${replacement}-${v.slice(prefix.length + 1)}`
        : /^(aria-labelledby|aria-describedby|for)$/.test(k)
          ? v.split(/\s+/).map((id) => id.startsWith(`${prefix}-`) ? `${replacement}-${id.slice(prefix.length + 1)}` : id).join(' ')
          : v.replace(ref, `#${replacement}-$1`);
      return `${k}="${escAttr(value)}"`;
    }).join(' ');
    const children = n.children.map((c) => serialize(c, inStyle || n.tag === 'style')).join('');
    return `<${n.tag}${attrs ? ` ${attrs}` : ''}>${children}</${n.tag}>`;
  };
  return doc.children.map((n) => serialize(n)).join('');
}

/** Flatten an SVG path `d` (absolute or relative M L H V C Q Z) into points. */
export function flattenPath(d: string): Pt[] {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: Pt[] = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const num = () => Number(tok[i++]);
  const cubic = (a: Pt, b: Pt, c: Pt, e: Pt) => { for (let k = 1; k <= 16; k++) { const t = k / 16, u = 1 - t; pts.push({ x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * e.x, y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * e.y }); } };
  let guard = 0;
  while (i < tok.length && guard++ < 5000) {
    if (/[a-zA-Z]/.test(tok[i]!)) cmd = tok[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; pts.push({ x, y }); cmd = rel ? 'l' : 'L'; break;
      case 'L': x = ox + num(); y = oy + num(); pts.push({ x, y }); break;
      case 'H': x = ox + num(); pts.push({ x, y }); break;
      case 'V': y = oy + num(); pts.push({ x, y }); break;
      case 'C': { const b = { x: ox + num(), y: oy + num() }, c = { x: ox + num(), y: oy + num() }, e = { x: ox + num(), y: oy + num() }; cubic({ x, y }, b, c, e); x = e.x; y = e.y; break; }
      case 'Q': { const q = { x: ox + num(), y: oy + num() }, e = { x: ox + num(), y: oy + num() }, a = { x, y };
        cubic(a, { x: a.x + (2 / 3) * (q.x - a.x), y: a.y + (2 / 3) * (q.y - a.y) }, { x: e.x + (2 / 3) * (q.x - e.x), y: e.y + (2 / 3) * (q.y - e.y) }, e); x = e.x; y = e.y; break; }
      case 'Z': x = sx; y = sy; break;
      default: return pts; // arcs and other rare commands: give up, caller falls back
    }
    if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  }
  return pts;
}

const translateOf = (n: XNode): Pt => { const m = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(n.attrs.transform ?? ''); return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 }; };

/** The drawn line of each connector, in the SVG's own coordinates: cell id -> points. */
export function svgEdgeRoutes(svg: string): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>();
  let root: XNode | undefined;
  try { root = find(parseXml(svg), 'svg'); } catch { return out; }
  if (!root) return out;
  const firstLine = (n: XNode, off: Pt): Pt[] | undefined => {
    const o = translateOf(n), at = { x: off.x + o.x, y: off.y + o.y };
    if (n.tag === 'path' && (n.attrs.fill ?? '') === 'none' && n.attrs.d) {
      const pts = flattenPath(n.attrs.d);
      if (pts.length >= 2) return pts.map((p) => ({ x: p.x + at.x, y: p.y + at.y }));
    }
    for (const c of n.children) { const r = firstLine(c, at); if (r) return r; }
    return undefined;
  };
  const walk = (n: XNode, off: Pt) => {
    const o = translateOf(n), at = { x: off.x + o.x, y: off.y + o.y };
    const id = n.attrs['data-cell-id'];
    if (id && !out.has(id)) { const r = firstLine(n, off); if (r) out.set(id, r); }
    for (const c of n.children) walk(c, at);
  };
  walk(root, { x: 0, y: 0 });
  return out;
}
