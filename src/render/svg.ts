import { textWidth } from '../core/geometry';
import type { Item } from '../core/timeline';
import { SAFE_HREF, type End, type NodeState, type Style } from '../core/types';
import type { LaidNode, Layout } from '../layout/types';
import { frameAt, type Frame } from './frame';
import type { Model } from './model';
import { layoutRows, wrap } from './rows';
import { themes, type Theme, type ThemeName } from './theme';
import { namespaceSanitizedSvg } from '../drawio/sanitize';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RenderOptions {
  /** Unique prefix for ids/classes (several diagrams per page). */
  idPrefix: string;
  theme?: ThemeName | Theme;
  /** Initial simulated time shown by the static markup (default 0). */
  at?: number;
  /** Embed declarative SMIL animation (standalone animated SVG). Requires a concrete theme. */
  smil?: boolean;
  transparent?: boolean;
}

const PACKET_H = 24, BAR_H = 4, CYL_RY = 9;
export const packetWidth = (label: string) => Math.max(36, textWidth(label, 12) + 20);
const STATES: NodeState[] = ['idle', 'receiving', 'processing', 'completed', 'waiting', 'error'];

const idleCss = (st: Style, th: Theme) =>
  [st.fill && `fill:${st.fill}`, st.stroke && `stroke:${st.stroke}`, st.strokeWidth !== undefined && `stroke-width:${st.strokeWidth}`].filter(Boolean).join(';') || `stroke-width:${th.states.idle.width}`;

function css(p: string, th: Theme, transparent: boolean, nodes: LaidNode[] = []): string {
  const s = (st: NodeState) => {
    const v = th.states[st];
    return `.${p} [data-state="${st}"] .fm-box{fill:${v.fill};stroke:${v.stroke};stroke-width:${v.width}}` +
      `.${p} [data-state="${st}"] .fm-rim{stroke:${v.stroke};stroke-width:${v.width}}`;
  };
  return [
    `.${p}{font-family:var(--font-interface,system-ui,-apple-system,"Segoe UI",sans-serif);${transparent ? '' : `background:${th.bg};`}display:block;max-width:100%;height:auto}`,
    `.${p} .fm-label{fill:${th.text};font-size:14px;font-weight:600}`,
    `.${p} .fm-sub{fill:${th.muted};font-size:11.5px}`,
    `.${p} .fm-group{fill:none;stroke:${th.edge};stroke-opacity:.5;stroke-dasharray:4 4}`,
    `.${p} .fm-group.fm-gfill{fill:${th.edge};fill-opacity:.07;stroke-dasharray:none;stroke-opacity:.4}`,
    `.${p} .fm-edge.fm-dotted{stroke-dasharray:2 5;stroke-linecap:round}`,
    `.${p} .fm-glabel{fill:${th.muted};font-size:11.5px;font-weight:700;letter-spacing:.05em}`,
    `.${p} .fm-edge{fill:none;stroke:${th.edge};stroke-width:1.75}`,
    `.${p} .fm-edge.fm-quiet{stroke-dasharray:3 4;opacity:.6}`,
    `.${p} .fm-edge[data-active="true"]{stroke:${th.packetFill};stroke-width:2.75;opacity:1}`,
    `.${p} .fm-elabel{fill:${th.muted};font-size:11px;font-weight:600;paint-order:stroke;stroke:${th.halo};stroke-width:4px;stroke-linejoin:round}`,
    `.${p} .fm-arrow{fill:${th.edge}}`,
    `.${p} .fm-rim{fill:none}`,
    `.${p} .fm-pkt-box{fill:${th.packetFill}}`,
    `.${p} .fm-pkt-text{fill:${th.packetText};font-size:12px;font-weight:600}`,
    `.${p} .fm-dot{fill:${th.packetFill}}`,
    `.${p} .fm-bar{fill:${th.bar}}`,
    `.${p} .fm-rtext{fill:${th.text};font-size:12px}.${p} .fm-rmono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}`,
    `.${p} .fm-rmeta{fill:${th.muted};font-size:10.5px}.${p} .fm-rtag{font-size:10.5px;font-weight:700}`,
    `.${p} .fm-gl{fill:${th.text};font-size:11px;text-anchor:middle}.${p} .fm-glink{stroke:${th.edge};stroke-width:1.5}`,
    `.${p} .fm-step{fill:${th.muted};font-size:13px;font-weight:700}.${p} .fm-caption{fill:${th.text};font-size:15px}`,
    `.${p} .fm-box{transition:fill .15s,stroke .15s}`,
    ...STATES.map(s),
    `.${p} [data-state="idle"] .fm-box.fm-solid{fill:${th.edge};stroke:${th.edge}}`,
    `.${p} .fm-grid{stroke:${th.edge};stroke-opacity:.25;stroke-dasharray:2 4}.${p} .fm-tick{fill:${th.muted};font-size:11px}.${p} .fm-gtitle{fill:${th.text};font-size:16px;font-weight:700}`,
    `.${p} .fm-member{fill:${th.text};font-size:12px}.${p} .fm-divider{stroke:${th.edge};stroke-opacity:.55;stroke-width:1}`,
    `.${p} .fm-endlabel{fill:${th.muted};font-size:11px;font-weight:600;paint-order:stroke;stroke:${th.halo};stroke-width:3px;stroke-linejoin:round}`,
    // Custom node colours apply to the idle state; active states keep their highlight.
    ...nodes.filter((n) => n.style && (n.style.fill || n.style.stroke || n.style.strokeWidth !== undefined)).map((n) =>
      `.${p} [data-node="${n.id}"][data-state="idle"] .fm-box,.${p} [data-node="${n.id}"][data-state="idle"] .fm-rim{${idleCss(n.style!, th)}}`),
    `@media (prefers-reduced-motion: reduce){.${p} .fm-box{transition:none}}`,
  ].join('');
}

/** Piecewise-constant values over one loop cycle -> SMIL discrete animate. */
function discrete(attr: string, total: number, pts: [number, string][]): string {
  const merged: [number, string][] = [];
  for (const [t, v] of [...pts].filter((p) => p[0] < total).sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && last[0] === t) last[1] = v; else if (!last || last[1] !== v) merged.push([t, v]);
  }
  if (merged.length < 2) return '';
  return `<animate attributeName="${attr}" calcMode="discrete" dur="${total}ms" repeatCount="indefinite" ` +
    `values="${merged.map((m) => m[1]).join(';')}" keyTimes="${merged.map((m) => r2(m[0] / total)).join(';')}"/>`;
}
const showHide = (total: number, start: number, end: number) => discrete('opacity', total, [[0, '0'], [start, '1'], [end, '0']]);

function nodeSmil(m: Model, id: string, th: Theme, style?: Style) {
  const tl = m.timeline;
  const times = new Set<number>([0]);
  for (const i of tl.items) if (!i.skipped && (i.node === id || i.to === id)) { times.add(i.start); times.add(i.end); }
  const ts = [...times].filter((t) => t < tl.total).sort((a, b) => a - b);
  const names = ts.map((t) => frameAt(m, t).nodes[id] ?? 'idle');
  const mk = (attr: string, pick: (s: Theme['states'][NodeState], idle: boolean) => string) =>
    discrete(attr, tl.total, ts.map((t, k) => [t, pick(th.states[names[k]!], names[k] === 'idle')] as [number, string]));
  return {
    fill: mk('fill', (s, idle) => (idle && style?.fill) || s.fill),
    stroke: mk('stroke', (s, idle) => (idle && style?.stroke) || s.stroke),
    width: mk('stroke-width', (s, idle) => String(idle && style?.strokeWidth !== undefined ? style.strokeWidth : s.width)),
  };
}

function cylinderPaths(n: LaidNode): { body: string; rim: string } {
  const { x, y, w, h } = n, ry = CYL_RY, rx = w / 2;
  return {
    body: `M${r2(x)} ${r2(y + ry)}V${r2(y + h - ry)}A${rx} ${ry} 0 0 0 ${r2(x + w)} ${r2(y + h - ry)}V${r2(y + ry)}A${rx} ${ry} 0 0 0 ${r2(x)} ${r2(y + ry)}Z`,
    rim: `M${r2(x)} ${r2(y + ry)}A${rx} ${ry} 0 0 0 ${r2(x + w)} ${r2(y + ry)}`,
  };
}

/** SVG for a diagram node's outline, plus the y of its label. All parts carry fm-box so state colours apply. */
function shapeSvg(n: LaidNode, anim: string, sm: { stroke: string; width: string }): { svg: string; labelY: number } {
  const { x, y, w, h } = n, cx = x + w / 2, cy = y + h / 2;
  const box = (el: string) => `<${el} class="fm-box"`;
  const pts = (list: [number, number][]) => list.map(([a, b]) => `${r2(a)},${r2(b)}`).join(' ');
  const skew = Math.min(18, w / 6);
  switch (n.shape) {
    case 'diamond': return { svg: `${box('polygon')} points="${pts([[cx, y], [x + w, cy], [cx, y + h], [x, cy]])}" stroke-linejoin="round">${anim}</polygon>`, labelY: cy };
    case 'circle': return { svg: `${box('ellipse')} cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(w / 2)}" ry="${r2(h / 2)}">${anim}</ellipse>`, labelY: cy };
    case 'hexagon': return { svg: `${box('polygon')} points="${pts([[x + 16, y], [x + w - 16, y], [x + w, cy], [x + w - 16, y + h], [x + 16, y + h], [x, cy]])}" stroke-linejoin="round">${anim}</polygon>`, labelY: cy };
    case 'parallelogram': return { svg: `${box('polygon')} points="${pts([[x + skew, y], [x + w, y], [x + w - skew, y + h], [x, y + h]])}" stroke-linejoin="round">${anim}</polygon>`, labelY: cy };
    case 'stadium': return { svg: `${box('rect')} x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(h / 2)}">${anim}</rect>`, labelY: cy };
    case 'round': return { svg: `${box('rect')} x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="22">${anim}</rect>`, labelY: cy };
    case 'subroutine': return {
      svg: `${box('rect')} x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="4">${anim}</rect>` +
        `<path class="fm-rim" d="M${r2(x + 10)} ${r2(y)}V${r2(y + h)}M${r2(x + w - 10)} ${r2(y)}V${r2(y + h)}">${sm.stroke}${sm.width}</path>`, labelY: cy,
    };
    case 'start': return { svg: `<circle class="fm-box fm-solid" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(Math.min(w, h) / 2 - 1)}">${anim}</circle>`, labelY: cy };
    case 'end': return { svg: `<circle class="fm-box" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(Math.min(w, h) / 2 - 1)}" style="fill:none">${anim}</circle><circle class="fm-box fm-solid" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(Math.min(w, h) / 2 - 6)}">${anim}</circle>`, labelY: cy };
    case 'bar': return { svg: `${box('rect')} x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="2" class="fm-box fm-solid">${anim}</rect>`.replace('<rect class="fm-box" ', '<rect '), labelY: cy };
    case 'class': {
      const ls = n.lines ?? [], top = y + 28;
      const firstMethod = ls.findIndex((l) => l.includes('('));
      const rows = ls.map((l, k) => l === '' ? '' : `<text class="fm-member" x="${r2(x + 12)}" y="${r2(top + 14 + k * 18)}" dominant-baseline="central">${esc(l)}</text>`).join('');
      const div = (yy: number) => `<line class="fm-divider" x1="${r2(x)}" x2="${r2(x + w)}" y1="${r2(yy)}" y2="${r2(yy)}"/>`;
      const sep = firstMethod > 0 ? div(top + 5 + firstMethod * 18) : '';
      return { svg: `${box('rect')} x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="4">${anim}</rect>${div(top)}${sep}${rows}`, labelY: y + 14 };
    }
    case 'cylinder': {
      const c = cylinderPaths(n);
      return { svg: `<path class="fm-box" d="${c.body}">${anim}</path><path class="fm-rim" d="${c.rim}">${sm.stroke}${sm.width}</path>`, labelY: cy + CYL_RY / 2 };
    }
    default: return { svg: `${box('rect')} x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="12">${anim}</rect>`, labelY: cy - 3 };
  }
}

const HEADS: End[] = ['arrow', 'circle', 'cross', 'triangle', 'diamond', 'diamond-filled'];
const colorKey = (c?: string) => (c ? c.replace(/[^A-Za-z0-9]/g, '') : '');
const BASE_W = 1.75;
const edgeWidth = (e: Layout['edges'][number]) => (e.line === 'thick' ? 3.5 : (e.style?.strokeWidth ?? BASE_W));
/** Marker id for a decoration, line colour and line width (markers scale with stroke width, so each width gets its own size). */
const markerId = (p: string, kind: string, color?: string, width = BASE_W) =>
  `${p}-${kind}${colorKey(color) ? '-' + colorKey(color) : ''}${width !== BASE_W ? '-w' + String(width).replace('.', '_') : ''}`;
/** Arrow-head markers: one per decoration, colour and width used. */
function markerDefs(p: string, edges: Layout['edges'], th: Theme): string {
  const variants = new Map<string, { color?: string; width: number }>();
  for (const e of [undefined, ...edges]) {
    const color = e?.style?.stroke, width = e ? edgeWidth(e) : BASE_W;
    variants.set(markerId(p, 'v', color, width), { color, width });
  }
  const out: string[] = [];
  for (const { color: c, width } of variants.values()) {
    const k = BASE_W / width, col = c ?? th.edge, id = (n: string) => markerId(p, n, c, width);
    const cls = c ? '' : ' class="fm-arrow"', fill = c ? ` fill="${esc(col)}"` : '';
    out.push(
      `<marker id="${id('arrow')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${r2(8 * k)}" markerHeight="${r2(8 * k)}" orient="auto-start-reverse"><path${cls}${fill} d="M0 0L10 5L0 10z"/></marker>` +
      `<marker id="${id('circle')}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="${r2(7 * k)}" markerHeight="${r2(7 * k)}" orient="auto"><circle${cls}${fill} cx="5" cy="5" r="4"/></marker>` +
      `<marker id="${id('cross')}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="${r2(8 * k)}" markerHeight="${r2(8 * k)}" orient="auto"><path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" fill="none" stroke="${esc(col)}" stroke-width="1.8" stroke-linecap="round"/></marker>` +
      `<marker id="${id('triangle')}" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="${r2(11 * k)}" markerHeight="${r2(11 * k)}" orient="auto-start-reverse"><path d="M1 1L11 6L1 11z" fill="${esc(th.halo)}" stroke="${esc(col)}" stroke-width="1.3" stroke-linejoin="round"/></marker>` +
      `<marker id="${id('diamond')}" viewBox="0 0 16 12" refX="15" refY="6" markerWidth="${r2(15 * k)}" markerHeight="${r2(11 * k)}" orient="auto-start-reverse"><path d="M1 6L8 1L15 6L8 11z" fill="${esc(th.halo)}" stroke="${esc(col)}" stroke-width="1.3" stroke-linejoin="round"/></marker>` +
      `<marker id="${id('diamond-filled')}" viewBox="0 0 16 12" refX="15" refY="6" markerWidth="${r2(15 * k)}" markerHeight="${r2(11 * k)}" orient="auto-start-reverse"><path d="M1 6L8 1L15 6L8 11z" fill="${esc(col)}" stroke="${esc(col)}" stroke-width="1.3" stroke-linejoin="round"/></marker>`,
    );
  }
  return out.join('');
}
const markerRef = (p: string, kind: End | undefined, e: Layout['edges'][number]) =>
  kind && kind !== 'none' && HEADS.includes(kind) ? `url(#${markerId(p, kind, e.style?.stroke, edgeWidth(e))})` : '';

function renderRows(n: LaidNode, item: Item, th: Theme, opacity: number, p: string, smil: boolean, total: number): string {
  const innerW = n.w - 20, x0 = n.x + 10, y0 = n.y + (n.headerH ?? 30) + 2;
  const { parts } = layoutRows(item.rows ?? [], innerW);
  const out: string[] = [];
  for (const part of parts) {
    const r = part.spec, col = th.tones[r.tone], y = y0 + part.y;
    if (part.graph) {
      out.push(`<g>`);
      for (const [a, b] of part.graph.links) {
        const A = part.graph.nodes[a]!, B = part.graph.nodes[b]!;
        out.push(`<line class="fm-glink" x1="${r2(x0 + A.x)}" y1="${r2(y + A.y)}" x2="${r2(x0 + B.x)}" y2="${r2(y + B.y)}"/>`);
      }
      for (const g of part.graph.nodes) {
        out.push(`<rect x="${r2(x0 + g.x - g.w / 2)}" y="${r2(y + g.y - 9)}" width="${r2(g.w)}" height="18" rx="9" style="fill:${g.lit ? th.packetFill : th.states.idle.fill};stroke:${g.lit ? th.packetFill : th.states.idle.stroke}"/>` +
          `<text class="fm-gl" x="${r2(x0 + g.x)}" y="${r2(y + g.y)}" dominant-baseline="central" style="${g.lit ? `fill:${th.packetText}` : ''}">${esc(g.name)}</text>`);
      }
      out.push('</g>');
      continue;
    }
    let ty = y + 7;
    out.push(`<rect x="${r2(x0)}" y="${r2(y)}" width="${r2(innerW)}" height="${r2(part.h)}" rx="8" style="fill:${col};fill-opacity:.13;stroke:${col};stroke-opacity:.55"/>`);
    if (r.tag || r.mark) {
      if (r.tag) out.push(`<text class="fm-rtag" x="${r2(x0 + 8)}" y="${r2(ty + 7)}" dominant-baseline="central" style="fill:${col}">${esc(r.tag)}</text>`);
      if (r.mark) out.push(`<text class="fm-rtag" x="${r2(x0 + innerW - 8)}" y="${r2(ty + 7)}" text-anchor="end" dominant-baseline="central" style="fill:${col}">${esc(r.mark)}</text>`);
      ty += 15;
    }
    part.lines.forEach((ln, k) => out.push(`<text class="fm-rtext${r.mono ? ' fm-rmono' : ''}" x="${r2(x0 + 8)}" y="${r2(ty + 7.25 + k * 14.5)}" dominant-baseline="central">${esc(ln)}</text>`));
    if (r.meta) out.push(`<text class="fm-rmeta" x="${r2(x0 + 8)}" y="${r2(ty + Math.max(1, part.lines.length) * 14.5 + 7)}" dominant-baseline="central">${esc(r.meta)}</text>`);
  }
  const anim = smil ? showHide(total, item.start, item.end) : '';
  return `<g class="fm-show" data-show="${esc(item.id)}" opacity="${r2(opacity)}">${out.join('')}${anim}</g>`;
}

export function renderSvg(m: Model, opts: RenderOptions): string {
  const th = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  if (opts.smil && !th.concrete) throw new Error('Animated SVG export needs the "light" or "dark" theme.');
  const p = opts.idPrefix, { layout, timeline: tl } = m;
  const frame: Frame = frameAt(m, opts.smil ? 0 : (opts.at ?? 0));
  const live = tl.items.filter((i) => !i.skipped);
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const mid = (cond: boolean, s: string) => (cond ? s : '');

  // Storyboards reserve a step label above and caption text below. Crop them away unless the view asks for them.
  const st0 = layout.story, pad = 14;
  const vy = st0 && !m.view?.header ? Math.max(0, st0.contentTop - pad) : 0;
  const vb = st0 && !m.view?.footer ? st0.contentBottom + pad : layout.height;
  const bd = m.backdrop, paper = m.view?.paper ?? 'light';
  // With a backdrop the drawing stays as authored: show exactly its area; animation layers sit on top.
  const [vx, vw, vh] = bd ? [bd.ox, bd.w, bd.h] : [0, layout.width, vb - vy];
  const vyy = bd ? bd.oy : vy;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="fm-root ${p}${bd ? ' fm-overlay' : ''}" viewBox="${r2(vx)} ${r2(vyy)} ${r2(vw)} ${r2(vh)}" ` +
    `width="${r2(vw)}" role="img" aria-label="${esc(`FlowMotion diagram ${m.id}`)}" data-fm-id="${esc(m.id)}"${bd && paper !== 'none' ? ` style="color-scheme:${paper === 'dark' ? 'dark' : 'light'}"` : ''}>`);
  if (!m.backdrop) out.push(`<title>${esc(`${m.id}: ${layout.nodes.map((n) => n.label).join(', ')}`)}</title>`);
  out.push(`<style>${css(p, th, !!opts.transparent, layout.nodes)}</style>`);
  out.push(`<defs>${markerDefs(p, layout.edges, th)}</defs>`);
  if (bd) {
    out.push(`<style>.${p}.fm-overlay{background:transparent}` +
      `.${p} .fm-overlay-edge{fill:none;stroke:${th.packetFill};stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;${opts.smil ? '' : 'opacity:0;transition:opacity .15s'}}` +
      `${opts.smil ? '' : `.${p} .fm-overlay-edge[data-active="true"]{opacity:.9}`}` +
      `.${p} .fm-obox{fill:none;stroke:none;pointer-events:all}` +
      `${opts.smil ? '' :
        `.${p} [data-state="receiving"] .fm-obox,.${p} [data-state="processing"] .fm-obox{stroke:${th.states.processing.stroke};stroke-width:2;fill:${th.states.processing.stroke};fill-opacity:.07}` +
        `.${p} [data-state="completed"] .fm-obox{stroke:${th.states.completed.stroke};stroke-width:2;fill:${th.states.completed.stroke};fill-opacity:.07}` +
        `.${p} [data-state="error"] .fm-obox{stroke:${th.states.error.stroke};stroke-width:2;fill:${th.states.error.stroke};fill-opacity:.1}` +
        `.${p} [data-state="waiting"] .fm-obox{stroke:${th.states.waiting.stroke};stroke-width:2;stroke-dasharray:5 4}`}</style>`);
    // CSS: override the sheet colour with `--fm-paper`, e.g. `.fm-wrap { --fm-paper: #fafafa }` in a snippet.
    if (paper !== 'none') out.push(`<rect class="fm-paper" x="${r2(bd.ox)}" y="${r2(bd.oy)}" width="${r2(bd.w)}" height="${r2(bd.h)}" style="fill:var(--fm-paper,${paper === 'dark' ? '#1e1e1e' : paper === 'light' ? '#ffffff' : esc(paper)})" rx="6"/>`);
    const backdropPrefix = `${p}-bd`;
    const backdrop = namespaceSanitizedSvg(bd.inner, 'fmbd', backdropPrefix);
    const backdropId = bd.rootId?.replace(/^fmbd-/, `${backdropPrefix}-`);
    out.push(`<g${backdropId ? ` id="${esc(backdropId)}"` : ''} class="fm-backdrop" transform="translate(${r2(bd.ox)} ${r2(bd.oy)})">${backdrop}</g>`);
    out.push('<g class="fm-edges">');
    const edgeTimes = (id: string) => [...new Set([0, ...tl.items.filter((i) => !i.skipped && i.type === 'transfer' && i.flow === id && i.until !== undefined).flatMap((i) => [i.start, i.until!])])]
      .filter((t) => t < tl.total).sort((a, b) => a - b);
    const nodeTimes = (id: string) => [...new Set([0, ...tl.items.filter((i) => !i.skipped && (i.node === id || i.to === id)).flatMap((i) => [i.start, i.end])])]
      .filter((t) => t < tl.total).sort((a, b) => a - b);
    for (const e of layout.edges) {
      const active = opts.smil ? discrete('opacity', tl.total, edgeTimes(e.id).map((t) => [t, frameAt(m, t).edges[e.id] ? '.9' : '0'])) : '';
      out.push(`<path class="fm-overlay-edge" data-edge="${esc(e.id)}" data-active="${frame.edges[e.id] ? 'true' : 'false'}"${opts.smil ? ` opacity="${frame.edges[e.id] ? '.9' : '0'}"` : ''} d="${e.path.d}">${active}</path>`);
    }
    out.push('</g><g class="fm-nodes">');
    for (const n of layout.nodes) {
      const state = frame.nodes[n.id] ?? 'idle';
      const opacity = opts.smil ? discrete('opacity', tl.total, nodeTimes(n.id).map((t) => [t, frameAt(m, t).nodes[n.id] === 'idle' ? '0' : '1'])) : '';
      const rect = `<rect class="fm-obox" x="${r2(n.x)}" y="${r2(n.y)}" width="${r2(n.w)}" height="${r2(n.h)}" rx="8"${opts.smil ? ` style="fill:${th.states.processing.stroke};stroke:${th.states.processing.stroke};stroke-width:2" opacity="${state === 'idle' ? '0' : '1'}"` : ''}>${opacity}</rect>`;
      const body = `<g class="fm-node" data-node="${esc(n.id)}" data-state="${state}"><title>${esc(n.label)}</title>${rect}</g>`;
      out.push(body);
      if (n.href && SAFE_HREF.test(n.href)) out[out.length - 1] = `<a href="${esc(n.href)}" target="_blank" rel="noopener noreferrer" class="fm-link">${out[out.length - 1]}</a>`;
    }
    out.push('</g><g class="fm-packets">');
    for (const i of live) {
      if (i.type !== 'transfer') continue;
      const edge = layout.edges.find((e) => e.id === i.flow);
      if (!edge) continue;
      const label = i.label ?? '', w = packetWidth(label), pos = frame.packets[i.id];
      const pb = label
        ? `<rect class="fm-pkt-box" x="${r2(-w / 2)}" y="${-PACKET_H / 2}" width="${w}" height="${PACKET_H}" rx="${PACKET_H / 2}"/><text class="fm-pkt-text" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`
        : `<circle class="fm-dot" r="6"/>`;
      const kp = i.back ? '1;1;0;0' : '0;0;1;1';
      const motion = opts.smil
        ? `<animateMotion path="${edge.path.d}" dur="${tl.total}ms" repeatCount="indefinite" calcMode="linear" keyPoints="${kp}" keyTimes="0;${r2(i.start / tl.total)};${r2(i.end / tl.total)};1"/>` + showHide(tl.total, i.start, i.end)
        : '';
      out.push(`<g class="fm-packet" data-packet="${esc(i.id)}" opacity="${pos ? 1 : 0}"${pos ? ` transform="translate(${r2(pos.x)} ${r2(pos.y)})"` : ''}>${pb}${motion}</g>`);
    }
    out.push('</g></svg>');
    return out.join('');
  }

  if (layout.axis) {
    const a = layout.axis;
    out.push('<g class="fm-axis">' + a.ticks.map((t) => `<line class="fm-grid" x1="${r2(t.x)}" x2="${r2(t.x)}" y1="${r2(a.top)}" y2="${r2(a.bottom)}"/><text class="fm-tick" x="${r2(t.x)}" y="${r2(a.top - 8)}" text-anchor="middle">${esc(t.label)}</text>`).join('') +
      (a.title ? `<text class="fm-gtitle" x="14" y="${r2(a.top - 34)}">${esc(a.title)}</text>` : '') + '</g>');
  }
  out.push('<g class="fm-groups">');
  for (const g of layout.groups) {
    out.push(`<rect class="fm-group${g.depth !== undefined ? ' fm-gfill' : ''}" x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}" rx="16"/>` +
      `<text class="fm-glabel" x="${r2(g.x + 14)}" y="${r2(g.y + 17)}">${esc((g.label ?? '').toUpperCase())}</text>`);
  }
  const edgeText: string[] = [];
  out.push('</g><g class="fm-edges">');
  for (const e of layout.edges) {
    const hits = live.filter((i) => i.type === 'transfer' && i.flow === e.id && i.until !== undefined);
    const baseW = edgeWidth(e), baseC = e.style?.stroke ?? th.edge;
    const anim = opts.smil && hits.length
      ? discrete('stroke', tl.total, [[0, baseC], ...hits.flatMap((i): [number, string][] => [[i.start, th.packetFill], [i.until!, baseC]])]) +
        discrete('stroke-width', tl.total, [[0, String(baseW)], ...hits.flatMap((i): [number, string][] => [[i.start, String(baseW + 1)], [i.until!, String(baseW)]])])
      : '';
    const inline = [e.style?.stroke && !frame.edges[e.id] && `stroke:${e.style.stroke}`, (e.line === 'thick' || e.style?.strokeWidth !== undefined) && !frame.edges[e.id] && `stroke-width:${baseW}`].filter(Boolean).join(';');
    const head = markerRef(p, e.head ?? 'arrow', e), tail = markerRef(p, e.tail, e);
    out.push(`<path class="fm-edge${e.quiet ? ' fm-quiet' : ''}${e.line === 'dotted' ? ' fm-dotted' : ''}" data-edge="${esc(e.id)}" data-active="${frame.edges[e.id] ? 'true' : 'false'}" d="${e.path.d}"` +
      `${head ? ` marker-end="${head}"` : ''}${tail ? ` marker-start="${tail}"` : ''}${inline ? ` style="${esc(inline)}"` : ''}>${anim}</path>`);
    for (const l of [e.headLabel, e.tailLabel]) if (l) edgeText.push(`<text class="fm-endlabel" x="${r2(l.x)}" y="${r2(l.y)}">${esc(l.text)}</text>`);
    if (e.label) edgeText.push(`<text class="fm-elabel" x="${r2(e.label.x)}" y="${r2(e.label.y)}" text-anchor="middle">${esc(e.label.text)}</text>`);
  }
  out.push('</g><g class="fm-nodes">');
  for (const n of layout.nodes) {
    const st = frame.nodes[n.id] ?? 'idle';
    const sm = opts.smil ? nodeSmil(m, n.id, th, n.style) : { fill: '', stroke: '', width: '' };
    const anyAnim = sm.fill + sm.stroke + sm.width;
    let shape: string, labelY: number;
    if (n.kind === 'cylinder') {
      const c = cylinderPaths(n);
      shape = `<path class="fm-box" d="${c.body}">${anyAnim}</path><path class="fm-rim" d="${c.rim}">${sm.stroke}${sm.width}</path>`;
      labelY = n.y + 2 * CYL_RY + 14;
    } else if (n.kind === 'rect') {
      shape = `<rect class="fm-box" x="${r2(n.x)}" y="${r2(n.y)}" width="${r2(n.w)}" height="${r2(n.h)}" rx="12">${anyAnim}</rect>`;
      labelY = n.y + 18;
    } else {
      ({ svg: shape, labelY } = shapeSvg(n, anyAnim, sm));
      // Cards with detail text (C4 elements): title on top, centred lines below.
      if (n.lines?.length && n.shape !== 'class') {
        const top = n.y + 24, col = n.style?.color ? ` style="fill:${esc(n.style.color)};fill-opacity:.9"` : '';
        shape += n.lines.map((l, k) => `<text class="fm-sub" x="${r2(n.x + n.w / 2)}" y="${r2(top + 20 + k * 16)}" text-anchor="middle" dominant-baseline="central"${col}>${esc(l)}</text>`).join('');
        labelY = top;
      }
    }
    const outsideLabel = n.outside ? `<text class="fm-label" x="${r2(n.x + n.w + 8)}" y="${r2(n.y + n.h / 2)}" dominant-baseline="central" style="font-weight:500">${esc(n.label)}</text>` : '';
    const labels = n.outside ? outsideLabel : n.shape === 'start' || n.shape === 'end' || n.shape === 'bar' ? '' : n.kind
      ? `<text class="fm-label" x="${r2(n.x + n.w / 2)}" y="${r2(labelY)}" text-anchor="middle" dominant-baseline="central">${esc(n.label)}</text>` +
        mid(!!n.subtitle, `<text class="fm-sub" x="${r2(n.x + n.w / 2)}" y="${r2(labelY + 17)}" text-anchor="middle" dominant-baseline="central">${esc(n.subtitle ?? '')}</text>`)
      : `<text class="fm-label" x="${r2(n.x + n.w / 2)}" y="${r2(labelY)}" text-anchor="middle" dominant-baseline="central"${n.style?.color ? ` style="fill:${esc(n.style.color)}"` : ''}>${esc(n.label)}</text>`;
    const tip = n.tooltip ? `<title>${esc(n.tooltip)}</title>` : '';
    const body = `<g class="fm-node" data-node="${esc(n.id)}" data-state="${st}">${tip}${shape}${labels}</g>`;
    out.push(n.href && SAFE_HREF.test(n.href) ? `<a href="${esc(n.href)}" target="_blank" rel="noopener noreferrer" class="fm-link" style="cursor:pointer">${body}</a>` : body);
  }
  out.push(`</g><g class="fm-edge-labels">${edgeText.join('')}</g><g class="fm-rows">`);
  for (const i of live) {
    const n = i.type === 'show' && i.node ? nodeById.get(i.node) : undefined;
    if (n) out.push(renderRows(n, i, th, frame.shows[i.id] ?? 0, p, !!opts.smil, tl.total));
  }
  out.push('</g><g class="fm-bars">');
  for (const i of live) {
    const n = i.node ? nodeById.get(i.node) : undefined;
    if (!n || (i.type !== 'process' && i.type !== 'emit') || i.end <= i.start) continue;
    const full = n.w - 24, prog = frame.bars[i.id];
    const anim = opts.smil
      ? `<animate attributeName="width" calcMode="linear" dur="${tl.total}ms" repeatCount="indefinite" values="0;0;${r2(full)};${r2(full)}" keyTimes="0;${r2(i.start / tl.total)};${r2(i.end / tl.total)};1"/>` + showHide(tl.total, i.start, i.end)
      : '';
    out.push(`<rect class="fm-bar" data-bar="${esc(i.id)}" x="${r2(n.x + 12)}" y="${r2(n.y + n.h - 12)}" width="${prog === undefined ? 0 : r2(full * prog)}" height="${BAR_H}" rx="2" data-full="${r2(full)}" opacity="${prog === undefined ? 0 : 1}">${anim}</rect>`);
  }
  out.push('</g><g class="fm-packets">');
  for (const i of live) {
    if (i.type !== 'transfer') continue;
    const edge = layout.edges.find((e) => e.id === i.flow);
    if (!edge) continue;
    const label = i.label ?? '', w = packetWidth(label), pos = frame.packets[i.id];
    const kp = i.back ? '1;1;0;0' : '0;0;1;1';
    const motion = opts.smil
      ? `<animateMotion path="${edge.path.d}" dur="${tl.total}ms" repeatCount="indefinite" calcMode="linear" keyPoints="${kp}" keyTimes="0;${r2(i.start / tl.total)};${r2(i.end / tl.total)};1"/>` + showHide(tl.total, i.start, i.end)
      : '';
    const body = label
      ? `<rect class="fm-pkt-box" x="${r2(-w / 2)}" y="${-PACKET_H / 2}" width="${w}" height="${PACKET_H}" rx="${PACKET_H / 2}"/><text class="fm-pkt-text" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`
      : `<circle class="fm-dot" r="6"/>`;
    out.push(`<g class="fm-packet" data-packet="${esc(i.id)}" opacity="${pos ? 1 : 0}"${pos ? ` transform="translate(${r2(pos.x)} ${r2(pos.y)})"` : ''}>${body}${motion}</g>`);
  }
  out.push('</g>');

  if (layout.story) {
    const st = layout.story;
    out.push('<g class="fm-captions">');
    for (const i of live.filter((x) => x.type === 'caption')) {
      const lines = wrap(i.label ?? '', st.captionW, 15, false, 3);
      out.push(`<g class="fm-cap" data-caption="${esc(i.id)}" opacity="${frame.captions[i.id] ? 1 : 0}">` +
        mid(!!m.view?.header, `<text class="fm-step" x="28" y="${st.headerY}">${esc(i.step ?? '')}</text>`) +
        mid(!!m.view?.footer, lines.map((ln, k) => `<text class="fm-caption" x="28" y="${r2(st.captionY + 12 + k * 21)}">${esc(ln)}</text>`).join('')) +
        `${opts.smil ? showHide(tl.total, i.start, i.end) : ''}</g>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}
