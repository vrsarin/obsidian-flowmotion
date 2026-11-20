import { textWidth } from '../core/geometry';
import type { Item } from '../core/timeline';
import { SAFE_HREF, type End, type NodeState, type Style } from '../core/types';
import type { LaidNode, Layout } from '../layout/types';
import { FADE, frameAt, type Frame } from './frame';
import type { Model } from './model';
import { layoutRows, wrap } from './rows';
import { themes, type Theme, type ThemeName } from './theme';
import { namespaceSanitizedSvg } from '../drawio/sanitize';
import { arrowPresentation, groupPresentation, nodePresentation, presentationAt, presentationOpacity, presentationVisibility } from './presentation';
import type { ArrowPresentation } from '../story/types';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r9 = (n: number) => Number(n.toFixed(9));

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

function css(p: string, th: Theme, transparent: boolean, nodes: LaidNode[] = [], sceneSmil = false): string {
  const s = (st: NodeState) => {
    const v = th.states[st];
    return `.${p} [data-state="${st}"] .fm-box{fill:var(--fm-scene-fill,${v.fill});stroke:var(--fm-scene-stroke,${v.stroke});stroke-width:${v.width}}` +
      `.${p} [data-state="${st}"] .fm-rim{stroke:var(--fm-scene-stroke,${v.stroke});stroke-width:${v.width}}`;
  };
  const background = transparent ? '' : `background:${th.bg};`;
  const groupPaint = sceneSmil ? '' : `fill:var(--fm-scene-fill,none);stroke:var(--fm-scene-stroke,${th.edge});`;
  const edgePaint = sceneSmil ? '' : `stroke:${th.edge};stroke-width:1.75`;
  const activePaint = sceneSmil ? '' : `stroke:${th.packetFill};stroke-width:2.75;`;
  return [
    `.${p}{font-family:var(--font-interface,system-ui,-apple-system,"Segoe UI",sans-serif);${background}display:block;max-width:100%;height:auto}`,
    `.${p} .fm-label{fill:${th.text};font-size:14px;font-weight:600}`,
    `.${p} .fm-sub{fill:${th.muted};font-size:11.5px}`,
    `.${p} .fm-group{${groupPaint}stroke-opacity:.5;stroke-dasharray:4 4}`,
    `.${p} .fm-group.fm-gfill{fill:${th.edge};fill-opacity:.07;stroke-dasharray:none;stroke-opacity:.4}`,
    `.${p} .fm-edge.fm-dotted{stroke-dasharray:2 5;stroke-linecap:round}`,
    `.${p} .fm-glabel{fill:${th.muted};font-size:11.5px;font-weight:700;letter-spacing:.05em}`,
    `.${p} .fm-edge{fill:none;${edgePaint}}`,
    `.${p} .fm-edge.fm-quiet{stroke-dasharray:3 4;opacity:.6}`,
    `.${p} .fm-edge[data-active="true"]{${activePaint}opacity:1}`,
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
    sceneSmil ? '' : `.${p} .fm-box{transition:fill .15s,stroke .15s}`,
    sceneSmil ? `.${p} .fm-box{fill:var(--fm-node-fill)}.${p} .fm-box,.${p} .fm-rim{stroke:var(--fm-node-stroke);stroke-width:var(--fm-node-width)}` : '',
    ...(sceneSmil ? [] : STATES.map(s)),
    ...(sceneSmil ? [] : [`.${p} [data-state="idle"] .fm-box.fm-solid{fill:${th.edge};stroke:${th.edge}}`]),
    `.${p} .fm-grid{stroke:${th.edge};stroke-opacity:.25;stroke-dasharray:2 4}.${p} .fm-tick{fill:${th.muted};font-size:11px}.${p} .fm-gtitle{fill:${th.text};font-size:16px;font-weight:700}`,
    `.${p} .fm-member{fill:${th.text};font-size:12px}.${p} .fm-divider{stroke:${th.edge};stroke-opacity:.55;stroke-width:1}`,
    `.${p} .fm-endlabel{fill:${th.muted};font-size:11px;font-weight:600;paint-order:stroke;stroke:${th.halo};stroke-width:3px;stroke-linejoin:round}`,
    // Custom node colours apply to the idle state; active states keep their highlight.
    ...(sceneSmil ? [] : nodes.filter((n) => n.style && (n.style.fill || n.style.stroke || n.style.strokeWidth !== undefined))).map((n) =>
      `.${p} [data-node="${n.id}"][data-state="idle"] .fm-box,.${p} [data-node="${n.id}"][data-state="idle"] .fm-rim{${idleCss(n.style!, th)}}`),
    `@media (prefers-reduced-motion: reduce){.${p} .fm-box{transition:none}}`,
  ].join('');
}

/** Piecewise-constant values over one loop cycle -> SMIL discrete animate. */
function discrete(attr: string, total: number, pts: [number, string][]): string {
  const merged: [number, string][] = [];
  for (const [t, v] of [...pts].filter((p) => p[0] < total).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last?.[0] === t) last[1] = v; else if (last?.[1] !== v) merged.push([t, v]);
  }
  if (merged.length < 2) return '';
  const css = ['fill', 'stroke', 'stroke-width'].includes(attr) ? ' attributeType="CSS"' : '';
  return `<animate attributeName="${attr}"${css} calcMode="discrete" dur="${total}ms" repeatCount="indefinite" ` +
    `values="${merged.map((m) => m[1]).join(';')}" keyTimes="${merged.map((m) => r9(m[0] / total)).join(';')}"/>`;
}
const showHide = (total: number, start: number, end: number) => discrete('opacity', total, [[0, '0'], [start, '1'], [end, '0']]);

function packetMotion(path: string, total: number, item: Item): string {
  const { start, end, back } = item;
  if (end <= start) return '';
  const from = back ? 1 : 0, to = 1 - from;
  const keys: [number, number][] = [[0, from]];
  if (start > 0) keys.push([start, from]);
  keys.push([end, to]);
  if (end < total) keys.push([total, to]);
  return `<animateMotion path="${path}" dur="${total}ms" repeatCount="indefinite" calcMode="linear" ` +
    `keyPoints="${keys.map(([, point]) => point).join(';')}" keyTimes="${keys.map(([time]) => r9(time / total)).join(';')}"/>` +
    showHide(total, start, end);
}
function rowFade(total: number, start: number, end: number): string {
  const fadeEnd = Math.min(start + FADE, total);
  const points: [number, number][] = [[0, 0]];
  if (start > 0) points.push([start, 0]);
  points.push([fadeEnd, Math.min(1, (fadeEnd - start) / FADE)]);
  const clear = end + FADE;
  if (clear < total) points.push([clear, 1], [clear, 0], [total, 0]);
  else if (fadeEnd < total) points.push([total, 1]);
  return `<animate attributeName="opacity" calcMode="linear" dur="${total}ms" repeatCount="indefinite" ` +
    `values="${points.map((p) => p[1]).join(';')}" keyTimes="${points.map((p) => r9(p[0] / total)).join(';')}"/>`;
}
const sceneTimes = (m: Model) => m.timeline.scenes?.map((scene) => scene.start) ?? [];
const visualStyle = (s: { fill?: string; stroke?: string }) =>
  [s.fill && `--fm-scene-fill:${s.fill}`, s.stroke && `--fm-scene-stroke:${s.stroke}`].filter(Boolean).join(';');

function nodeSmil(m: Model, id: string, th: Theme, style?: Style) {
  const tl = m.timeline;
  const times = new Set<number>([0, ...sceneTimes(m)]);
  for (const i of tl.items) if (!i.skipped && (i.node === id || i.to === id)) { times.add(i.start); times.add(i.end); }
  const ts = [...times].filter((t) => t < tl.total).sort((a, b) => a - b);
  const names = ts.map((t) => frameAt(m, t).nodes[id] ?? 'idle');
  const mk = (attr: string, pick: (s: Theme['states'][NodeState], idle: boolean, t: number) => string) =>
    discrete(attr, tl.total, ts.map((t, k) => [t, pick(th.states[names[k]!], names[k] === 'idle', t)] as [number, string]));
  return {
    fill: mk('fill', (s, idle, t) => nodePresentation(presentationAt(m, t), id).fill ?? ((idle && style?.fill) || s.fill)),
    stroke: mk('stroke', (s, idle, t) => nodePresentation(presentationAt(m, t), id).stroke ?? ((idle && style?.stroke) || s.stroke)),
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

const HEADS = new Set<End>(['arrow', 'circle', 'cross', 'triangle', 'diamond', 'diamond-filled']);
const colorKey = (c?: string) => c ? [...c].map((ch) => ch.codePointAt(0)!.toString(16).padStart(2, '0')).join('') : '';
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
  kind && kind !== 'none' && HEADS.has(kind) ? `url(#${markerId(p, kind, e.style?.stroke, edgeWidth(e))})` : '';

export function edgeMarkerRefs(p: string, e: Layout['edges'][number], settings: ArrowPresentation): { head: string; tail: string } {
  const styled = settings.color ? { ...e, style: { ...e.style, stroke: settings.color } } : e;
  const head = resolveHead(settings.arrowheads, e.head);
  const tail = resolveTail(settings.arrowheads, e.tail);
  return { head: markerRef(p, head, styled), tail: markerRef(p, tail, styled) };
}

function resolveHead(setting: ArrowPresentation['arrowheads'], original: End | undefined): End | undefined {
  if (setting === undefined) return original ?? 'arrow';
  return setting === 'end' || setting === 'both' ? 'arrow' : 'none';
}

function resolveTail(setting: ArrowPresentation['arrowheads'], original: End | undefined): End | undefined {
  if (setting === undefined) return original;
  return setting === 'start' || setting === 'both' ? 'arrow' : 'none';
}

interface RowRenderContext {
  node: LaidNode;
  item: Item;
  theme: Theme;
  opacity: number;
  visible: string;
  prefix: string;
  smil: boolean;
  model: Model;
}

function renderGraphPart(part: NonNullable<ReturnType<typeof layoutRows>['parts'][number]['graph']>, x0: number, y: number, th: Theme): string {
  const out: string[] = [];
  out.push('<g>');
  for (const [a, b] of part.links) {
    const source = part.nodes[a]!, target = part.nodes[b]!;
    out.push(`<line class="fm-glink" x1="${r2(x0 + source.x)}" y1="${r2(y + source.y)}" x2="${r2(x0 + target.x)}" y2="${r2(y + target.y)}"/>`);
  }
  for (const node of part.nodes) {
    const fill = node.lit ? th.packetFill : th.states.idle.fill;
    const stroke = node.lit ? th.packetFill : th.states.idle.stroke;
    const textStyle = node.lit ? `fill:${th.packetText}` : '';
    out.push(`<rect x="${r2(x0 + node.x - node.w / 2)}" y="${r2(y + node.y - 9)}" width="${r2(node.w)}" height="18" rx="9" style="fill:${fill};stroke:${stroke}"/>` +
      `<text class="fm-gl" x="${r2(x0 + node.x)}" y="${r2(y + node.y)}" dominant-baseline="central" style="${textStyle}">${esc(node.name)}</text>`);
  }
  out.push('</g>');
  return out.join('');
}

function renderTextPart(part: ReturnType<typeof layoutRows>['parts'][number], x0: number, y: number, innerW: number, th: Theme): string {
  const r = part.spec, col = th.tones[r.tone], out = [`<rect x="${r2(x0)}" y="${r2(y)}" width="${r2(innerW)}" height="${r2(part.h)}" rx="8" style="fill:${col};fill-opacity:.13;stroke:${col};stroke-opacity:.55"/>`];
  let textY = y + 7;
  if (r.tag) out.push(`<text class="fm-rtag" x="${r2(x0 + 8)}" y="${r2(textY + 7)}" dominant-baseline="central" style="fill:${col}">${esc(r.tag)}</text>`);
  if (r.mark) out.push(`<text class="fm-rtag" x="${r2(x0 + innerW - 8)}" y="${r2(textY + 7)}" text-anchor="end" dominant-baseline="central" style="fill:${col}">${esc(r.mark)}</text>`);
  if (r.tag || r.mark) textY += 15;
  part.lines.forEach((line, index) => {
    const mono = r.mono ? ' fm-rmono' : '';
    out.push(`<text class="fm-rtext${mono}" x="${r2(x0 + 8)}" y="${r2(textY + 7.25 + index * 14.5)}" dominant-baseline="central">${esc(line)}</text>`);
  });
  if (r.meta) out.push(`<text class="fm-rmeta" x="${r2(x0 + 8)}" y="${r2(textY + Math.max(1, part.lines.length) * 14.5 + 7)}" dominant-baseline="central">${esc(r.meta)}</text>`);
  return out.join('');
}

function renderRowContents(context: RowRenderContext, innerW: number, x0: number, y0: number): string {
  const { parts } = layoutRows(context.item.rows ?? [], innerW);
  return parts.map((part) => {
    const y = y0 + part.y;
    return part.graph
      ? renderGraphPart(part.graph, x0, y, context.theme)
      : renderTextPart(part, x0, y, innerW, context.theme);
  }).join('');
}

function renderStoryboardRows(context: RowRenderContext, content: string, visible: string): string {
  const { model: m, node: n, item } = context;
  const times = sceneTimes(m);
  const initial = nodePresentation(presentationAt(m, 0), n.id);
  const anim = discrete('opacity', m.timeline.total, times.map((t) => [t, String(presentationOpacity(nodePresentation(presentationAt(m, t), n.id)))])) +
    discrete('visibility', m.timeline.total, times.map((t) => [t, presentationVisibility(nodePresentation(presentationAt(m, t), n.id))]));
  return `<g class="fm-show" data-show="${esc(item.id)}" data-show-node="${esc(n.id)}" opacity="${presentationOpacity(initial)}" visibility="${visible}">` +
    `<g opacity="0">${content}${rowFade(m.timeline.total, item.start, item.end)}</g>${anim}</g>`;
}

function renderStaticRows(context: RowRenderContext, content: string, visible: string): string {
  const { model: m, node: n, item, opacity, smil } = context;
  const times = [...new Set([0, item.start, item.end, ...sceneTimes(m)])].sort((a, b) => a - b);
  const opacityAnim = smil ? discrete('opacity', m.timeline.total, times.map((t) => {
    const active = t >= item.start && t < item.end;
    return [t, String(active ? presentationOpacity(nodePresentation(presentationAt(m, t), n.id)) : 0)] as [number, string];
  })) : '';
  const visibilityAnim = smil ? discrete('visibility', m.timeline.total, times.map((t) =>
    [t, presentationVisibility(nodePresentation(presentationAt(m, t), n.id))] as [number, string])) : '';
  return `<g class="fm-show" data-show="${esc(item.id)}" data-show-node="${esc(n.id)}" opacity="${r2(opacity)}" visibility="${visible}">${content}${opacityAnim}${visibilityAnim}</g>`;
}

function renderRows(context: RowRenderContext): string {
  const { node, model, smil, visible } = context;
  const innerW = node.w - 20, x0 = node.x + 10, y0 = node.y + (node.headerH ?? 30) + 2;
  const content = renderRowContents(context, innerW, x0, y0);
  if (smil && model.timeline.scenes) return renderStoryboardRows(context, content, visible);
  return renderStaticRows(context, content, visible);
}

function backdropEdgeTimes(m: Model, id: string): number[] {
  const times = [0, ...m.timeline.items
    .filter((item) => !item.skipped && item.type === 'transfer' && item.flow === id && item.until !== undefined)
    .flatMap((item) => [item.start, item.until!])];
  return [...new Set(times)].filter((time) => time < m.timeline.total).sort((a, b) => a - b);
}

function backdropNodeTimes(m: Model, id: string): number[] {
  const times = [0, ...m.timeline.items
    .filter((item) => !item.skipped && (item.node === id || item.to === id))
    .flatMap((item) => [item.start, item.end])];
  return [...new Set(times)].filter((time) => time < m.timeline.total).sort((a, b) => a - b);
}

function packetElement(id: string, pos: { x: number; y: number } | undefined, body: string, motion: string, smil: boolean): string {
  const opacity = pos ? 1 : 0;
  const transform = pos && !smil ? ` transform="translate(${r2(pos.x)} ${r2(pos.y)})"` : '';
  return `<g class="fm-packet" data-packet="${esc(id)}" opacity="${opacity}"${transform}>${body}${motion}</g>`;
}

function packetBody(label: string): string {
  if (!label) return '<circle class="fm-dot" r="6"/>';
  const width = packetWidth(label);
  return `<rect class="fm-pkt-box" x="${r2(-width / 2)}" y="${-PACKET_H / 2}" width="${width}" height="${PACKET_H}" rx="${PACKET_H / 2}"/>` +
    `<text class="fm-pkt-text" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`;
}

function backdropEdgeAnimation(m: Model, edge: Layout['edges'][number], smil: boolean): string {
  if (!smil) return '';
  const values = backdropEdgeTimes(m, edge.id).map((time) => {
    const opacity = frameAt(m, time).edges[edge.id] ? '.9' : '0';
    return [time, opacity] as [number, string];
  });
  return discrete('opacity', m.timeline.total, values);
}

function backdropNodeAnimation(m: Model, node: LaidNode, smil: boolean): string {
  if (!smil) return '';
  const values = backdropNodeTimes(m, node.id).map((time) => {
    const visible = frameAt(m, time).nodes[node.id] !== 'idle';
    return [time, visible ? '1' : '0'] as [number, string];
  });
  return discrete('opacity', m.timeline.total, values);
}

function appendBackdropEdges(m: Model, opts: RenderOptions, frame: Frame, out: string[]): void {
  out.push('<g class="fm-edges">');
  for (const edge of m.layout.edges) {
    const active = backdropEdgeAnimation(m, edge, !!opts.smil);
    const isActive = frame.edges[edge.id];
    let activeOpacity = '';
    if (opts.smil) activeOpacity = isActive ? ' opacity=".9"' : ' opacity="0"';
    out.push(`<path class="fm-overlay-edge" data-edge="${esc(edge.id)}" data-active="${isActive ? 'true' : 'false'}"${activeOpacity} d="${edge.path.d}">${active}</path>`);
  }
  out.push('</g>');
}

function appendBackdropNodes(m: Model, opts: RenderOptions, th: Theme, frame: Frame, out: string[]): void {
  out.push('<g class="fm-nodes">');
  for (const node of m.layout.nodes) {
    const state = frame.nodes[node.id] ?? 'idle';
    const opacity = backdropNodeAnimation(m, node, !!opts.smil);
    const activeOpacity = state === 'idle' ? '0' : '1';
    const style = opts.smil
      ? ` style="fill:${th.states.processing.stroke};stroke:${th.states.processing.stroke};stroke-width:2" opacity="${activeOpacity}"`
      : '';
    const rect = `<rect class="fm-obox" x="${r2(node.x)}" y="${r2(node.y)}" width="${r2(node.w)}" height="${r2(node.h)}" rx="8"${style}>${opacity}</rect>`;
    out.push(`<g class="fm-node" data-node="${esc(node.id)}" data-state="${state}"><title>${esc(node.label)}</title>${rect}</g>`);
    const body = out.at(-1)!;
    if (node.href && SAFE_HREF.test(node.href)) {
      out[out.length - 1] = `<a href="${esc(node.href)}" target="_blank" rel="noopener noreferrer" class="fm-link">${body}</a>`;
    }
  }
  out.push('</g>');
}

function appendBackdropPackets(m: Model, opts: RenderOptions, frame: Frame, live: Item[], out: string[]): void {
  out.push('<g class="fm-packets">');
  for (const item of live) {
    if (item.type !== 'transfer') continue;
    const edge = m.layout.edges.find((candidate) => candidate.id === item.flow);
    if (!edge) continue;
    const motion = opts.smil ? packetMotion(edge.path.d, m.timeline.total, item) : '';
    out.push(packetElement(item.id, frame.packets[item.id], packetBody(item.label ?? ''), motion, !!opts.smil));
  }
  out.push('</g>');
}

function appendBackdrop(m: Model, opts: RenderOptions, th: Theme, p: string, frame: Frame, live: Item[], out: string[]): void {
  const backdrop = m.backdrop!;
  const activeStyle = opts.smil ? '' : `.${p} .fm-overlay-edge[data-active="true"]{opacity:.9}`;
  const stateStyles = opts.smil ? '' : [
    `.${p} [data-state="receiving"] .fm-obox,.${p} [data-state="processing"] .fm-obox{stroke:${th.states.processing.stroke};stroke-width:2;fill:${th.states.processing.stroke};fill-opacity:.07}`,
    `.${p} [data-state="completed"] .fm-obox{stroke:${th.states.completed.stroke};stroke-width:2;fill:${th.states.completed.stroke};fill-opacity:.07}`,
    `.${p} [data-state="error"] .fm-obox{stroke:${th.states.error.stroke};stroke-width:2;fill:${th.states.error.stroke};fill-opacity:.1}`,
    `.${p} [data-state="waiting"] .fm-obox{stroke:${th.states.waiting.stroke};stroke-width:2;stroke-dasharray:5 4}`,
  ].join('');
  const edgeOpacity = opts.smil ? '' : 'opacity:0;transition:opacity .15s';
  out.push(`<style>.${p}.fm-overlay{background:transparent}` +
    `.${p} .fm-overlay-edge{fill:none;stroke:${th.packetFill};stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;${edgeOpacity}}` +
    `${activeStyle}.${p} .fm-obox{fill:none;stroke:none;pointer-events:all}${stateStyles}</style>`);
  const paper = m.view?.paper ?? 'light';
  if (paper !== 'none') {
    const fill = paperFill(paper);
    out.push(`<rect class="fm-paper" x="${r2(backdrop.ox)}" y="${r2(backdrop.oy)}" width="${r2(backdrop.w)}" height="${r2(backdrop.h)}" style="fill:var(--fm-paper,${fill})" rx="6"/>`);
  }
  const backdropPrefix = `${p}-bd`;
  const markup = namespaceSanitizedSvg(backdrop.inner, 'fmbd', backdropPrefix);
  const rootId = backdrop.rootId?.replace(/^fmbd-/, `${backdropPrefix}-`);
  const idAttr = rootId ? ` id="${esc(rootId)}"` : '';
  out.push(`<g${idAttr} class="fm-backdrop" transform="translate(${r2(backdrop.ox)} ${r2(backdrop.oy)})">${markup}</g>`);
  appendBackdropEdges(m, opts, frame, out);
  appendBackdropNodes(m, opts, th, frame, out);
  appendBackdropPackets(m, opts, frame, live, out);
}

interface SvgRenderContext {
  model: Model;
  options: RenderOptions;
  theme: Theme;
  prefix: string;
  frame: Frame;
  sceneSmil: boolean;
  live: Item[];
  nodeById: Map<string, LaidNode>;
}

function appendAxis(context: SvgRenderContext, out: string[]): void {
  const axis = context.model.layout.axis;
  if (!axis) return;
  const ticks = axis.ticks.map((tick) =>
    `<line class="fm-grid" x1="${r2(tick.x)}" x2="${r2(tick.x)}" y1="${r2(axis.top)}" y2="${r2(axis.bottom)}"/><text class="fm-tick" x="${r2(tick.x)}" y="${r2(axis.top - 8)}" text-anchor="middle">${esc(tick.label)}</text>`).join('');
  const title = axis.title ? `<text class="fm-gtitle" x="14" y="${r2(axis.top - 34)}">${esc(axis.title)}</text>` : '';
  out.push(`<g class="fm-axis">${ticks}${title}</g>`);
}

function groupAnimations(context: SvgRenderContext, group: Layout['groups'][number]): { opacity: string; visibility: string; fill: string; stroke: string } {
  const { model: m, options, theme: th } = context;
  if (!options.smil) return { opacity: '', visibility: '', fill: '', stroke: '' };
  const times = [...new Set([0, ...sceneTimes(m)])];
  const presentation = (time: number) => groupPresentation(presentationAt(m, time), group.id);
  const defaultFill = group.depth !== undefined ? th.edge : 'transparent';
  return {
    opacity: discrete('opacity', m.timeline.total, times.map((time) => [time, String(presentationOpacity(presentation(time)))])),
    visibility: discrete('visibility', m.timeline.total, times.map((time) => [time, presentationVisibility(presentation(time))])),
    fill: discrete('fill', m.timeline.total, times.map((time) => {
      const settings = presentation(time);
      return [time, settings.fill ?? defaultFill];
    })),
    stroke: discrete('stroke', m.timeline.total, times.map((time) => [time, presentation(time).stroke ?? th.edge])),
  };
}

function renderGroup(context: SvgRenderContext, group: Layout['groups'][number]): string {
  const { model: m, frame, options, theme: th } = context;
  const settings = groupPresentation(frame.presentation, group.id);
  const animation = groupAnimations(context, group);
  const style = visualStyle(settings);
  const styleAttr = style ? ` style="${esc(style)}"` : '';
  const groupClass = group.depth !== undefined ? ' fm-gfill' : '';
  const groupFill = group.depth !== undefined ? th.edge : 'transparent';
  const fill = settings.fill ?? groupFill;
  const sceneAttrs = options.smil && m.timeline.scenes
    ? ` fill="${esc(fill)}" stroke="${esc(settings.stroke ?? th.edge)}"`
    : '';
  const rect = `<rect class="fm-group${groupClass}" x="${r2(group.x)}" y="${r2(group.y)}" width="${r2(group.w)}" height="${r2(group.h)}" rx="16"${sceneAttrs}>${animation.fill}${animation.stroke}</rect>`;
  const label = `<text class="fm-glabel" x="${r2(group.x + 14)}" y="${r2(group.y + 17)}">${esc((group.label ?? '').toUpperCase())}</text>`;
  return `<g data-group="${esc(group.id)}" opacity="${presentationOpacity(settings)}" visibility="${presentationVisibility(settings)}"${styleAttr}>${rect}${label}${animation.opacity}${animation.visibility}</g>`;
}

function appendGroups(context: SvgRenderContext, out: string[]): void {
  out.push('<g class="fm-groups">');
  for (const group of context.model.layout.groups) out.push(renderGroup(context, group));
  out.push('</g>');
}

function edgeTimes(context: SvgRenderContext, edge: Layout['edges'][number], hits: Item[]): number[] {
  const times = [0, ...sceneTimes(context.model), ...hits.flatMap((item) => [item.start, item.until!])];
  return [...new Set(times)].sort((a, b) => a - b);
}

function edgeOpacityAnimations(context: SvgRenderContext, edgeId: string, times: number[]): string {
  const { model: m } = context;
  const items = times.map((time) => {
    const settings = arrowPresentation(presentationAt(m, time), edgeId);
    return [time, String(presentationOpacity(settings))] as [number, string];
  });
  const visibility = times.map((time) =>
    [time, presentationVisibility(arrowPresentation(presentationAt(m, time), edgeId))] as [number, string]);
  return discrete('opacity', m.timeline.total, items) + discrete('visibility', m.timeline.total, visibility);
}

function edgeAnimations(context: SvgRenderContext, edge: Layout['edges'][number], times: number[], baseWidth: number, baseColor: string): string {
  const { model: m, options, theme: th, prefix } = context;
  if (!options.smil) return '';
  const stateAt = (time: number) => frameAt(m, time);
  const color = times.map((time) => {
    const settings = arrowPresentation(presentationAt(m, time), edge.id);
    return [time, settings.color ?? (stateAt(time).edges[edge.id] ? th.packetFill : baseColor)] as [number, string];
  });
  const width = times.map((time) => [time, String(stateAt(time).edges[edge.id] ? baseWidth + 1 : baseWidth)] as [number, string]);
  const head = times.map((time) => {
    const settings = arrowPresentation(presentationAt(m, time), edge.id);
    return [time, edgeMarkerRefs(prefix, edge, settings).tail || 'none'] as [number, string];
  });
  const tail = times.map((time) => {
    const settings = arrowPresentation(presentationAt(m, time), edge.id);
    return [time, edgeMarkerRefs(prefix, edge, settings).head || 'none'] as [number, string];
  });
  return discrete('stroke', m.timeline.total, color) +
    discrete('stroke-width', m.timeline.total, width) +
    discrete('marker-start', m.timeline.total, head) +
    discrete('marker-end', m.timeline.total, tail);
}

function edgeInlineStyle(context: SvgRenderContext, edge: Layout['edges'][number], active: boolean, settings: ArrowPresentation, baseWidth: number): string {
  if (context.sceneSmil) return '';
  let stroke = '';
  if (settings.color) stroke = `stroke:${settings.color}`;
  else if (edge.style?.stroke && !active) stroke = `stroke:${edge.style.stroke}`;
  const width = (edge.line === 'thick' || edge.style?.strokeWidth !== undefined) && !active ? `stroke-width:${baseWidth}` : '';
  const values = [
    stroke,
    width,
  ];
  return values.filter(Boolean).join(';');
}

function renderEdge(context: SvgRenderContext, edge: Layout['edges'][number], edgeText: string[]): string {
  const { frame, theme: th, prefix } = context;
  const hits = context.live.filter((item) => item.type === 'transfer' && item.flow === edge.id && item.until !== undefined);
  const baseWidth = edgeWidth(edge), baseColor = edge.style?.stroke ?? th.edge;
  const settings = arrowPresentation(frame.presentation, edge.id);
  const times = edgeTimes(context, edge, hits);
  const opacityAnim = context.options.smil ? edgeOpacityAnimations(context, edge.id, times) : '';
  const anim = edgeAnimations(context, edge, times, baseWidth, baseColor);
  const inline = edgeInlineStyle(context, edge, !!frame.edges[edge.id], settings, baseWidth);
  const { head, tail } = edgeMarkerRefs(prefix, edge, settings);
  const pathClass = `fm-edge${edge.quiet ? ' fm-quiet' : ''}${edge.line === 'dotted' ? ' fm-dotted' : ''}`;
  const activeColor = frame.edges[edge.id] ? th.packetFill : baseColor;
  const sceneColor = settings.color ?? activeColor;
  const sceneWidth = frame.edges[edge.id] ? baseWidth + 1 : baseWidth;
  const sceneAttrs = context.sceneSmil ? ` stroke="${esc(sceneColor)}" stroke-width="${sceneWidth}"` : '';
  const markerAttrs = (head ? ` marker-end="${head}"` : '') + (tail ? ` marker-start="${tail}"` : '');
  const styleAttr = inline ? ` style="${esc(inline)}"` : '';
  const path = `<path class="${pathClass}" data-edge="${esc(edge.id)}" data-active="${frame.edges[edge.id] ? 'true' : 'false'}" d="${edge.path.d}"${sceneAttrs}${markerAttrs}${styleAttr}>${anim}</path>`;
  const wrapped = `<g data-edge-wrap="${esc(edge.id)}" opacity="${presentationOpacity(settings)}" visibility="${presentationVisibility(settings)}">${path}${opacityAnim}</g>`;
  edgeText.push(renderEdgeLabels(edge, settings, opacityAnim));
  return wrapped;
}

function renderEdgeLabels(edge: Layout['edges'][number], settings: ArrowPresentation, animation: string): string {
  const labels: string[] = [];
  for (const label of [edge.headLabel, edge.tailLabel]) {
    if (label) labels.push(`<text class="fm-endlabel" x="${r2(label.x)}" y="${r2(label.y)}">${esc(label.text)}</text>`);
  }
  if (edge.label) labels.push(`<text class="fm-elabel" x="${r2(edge.label.x)}" y="${r2(edge.label.y)}" text-anchor="middle">${esc(edge.label.text)}</text>`);
  if (!labels.length) return '';
  return `<g data-edge-label="${esc(edge.id)}" opacity="${presentationOpacity(settings)}" visibility="${presentationVisibility(settings)}">${labels.join('')}${animation}</g>`;
}

function appendEdges(context: SvgRenderContext, out: string[]): string {
  const edgeText: string[] = [];
  out.push('<g class="fm-edges">');
  for (const edge of context.model.layout.edges) out.push(renderEdge(context, edge, edgeText));
  out.push('</g>');
  return edgeText.join('');
}

function appendEdgeLabels(labels: string, out: string[]): void {
  out.push(`<g class="fm-edge-labels">${labels}</g>`);
}

function nodeAnimations(context: SvgRenderContext, node: LaidNode): string {
  if (!context.options.smil) return '';
  const { model: m } = context;
  const times = [0, ...sceneTimes(m)];
  const opacity = times.map((time) => [time, String(presentationOpacity(nodePresentation(presentationAt(m, time), node.id)))] as [number, string]);
  const visibility = times.map((time) => [time, presentationVisibility(nodePresentation(presentationAt(m, time), node.id))] as [number, string]);
  return discrete('opacity', m.timeline.total, opacity) + discrete('visibility', m.timeline.total, visibility);
}

function nodeStateStyle(context: SvgRenderContext, node: LaidNode, state: NodeState, settings: ReturnType<typeof nodePresentation>): string {
  const { theme: th } = context;
  if (context.sceneSmil) {
    const base = th.states[state];
    const idle = state === 'idle';
    const fill = settings.fill ?? (idle ? node.style?.fill : undefined) ?? base.fill;
    const stroke = settings.stroke ?? (idle ? node.style?.stroke : undefined) ?? base.stroke;
    const width = idle ? node.style?.strokeWidth ?? base.width : base.width;
    return `--fm-node-fill:${fill};--fm-node-stroke:${stroke};--fm-node-width:${width}`;
  }
  return visualStyle(settings);
}

function nodeLabelMarkup(node: LaidNode, labelY: number): string {
  if (node.outside) {
    return `<text class="fm-label" x="${r2(node.x + node.w + 8)}" y="${r2(node.y + node.h / 2)}" dominant-baseline="central" style="font-weight:500">${esc(node.label)}</text>`;
  }
  if (node.shape === 'start' || node.shape === 'end' || node.shape === 'bar') return '';
  if (!node.kind) {
    const colorStyle = node.style?.color ? ` style="fill:${esc(node.style.color)}"` : '';
    return `<text class="fm-label" x="${r2(node.x + node.w / 2)}" y="${r2(labelY)}" text-anchor="middle" dominant-baseline="central"${colorStyle}>${esc(node.label)}</text>`;
  }
  const title = `<text class="fm-label" x="${r2(node.x + node.w / 2)}" y="${r2(labelY)}" text-anchor="middle" dominant-baseline="central">${esc(node.label)}</text>`;
  const subtitle = node.subtitle
    ? `<text class="fm-sub" x="${r2(node.x + node.w / 2)}" y="${r2(labelY + 17)}" text-anchor="middle" dominant-baseline="central">${esc(node.subtitle)}</text>`
    : '';
  return title + subtitle;
}

function nodeShape(context: SvgRenderContext, node: LaidNode): { shape: string; labelY: number } {
  const { options, theme: th } = context;
  const sm = options.smil ? nodeSmil(context.model, node.id, th, node.style) : { fill: '', stroke: '', width: '' };
  const animation = sm.fill + sm.stroke + sm.width;
  if (node.kind === 'cylinder') {
    const paths = cylinderPaths(node);
    return {
      shape: `<path class="fm-box" d="${paths.body}">${animation}</path><path class="fm-rim" d="${paths.rim}">${sm.stroke}${sm.width}</path>`,
      labelY: node.y + 2 * CYL_RY + 14,
    };
  }
  if (node.kind === 'rect') {
    return {
      shape: `<rect class="fm-box" x="${r2(node.x)}" y="${r2(node.y)}" width="${r2(node.w)}" height="${r2(node.h)}" rx="12">${animation}</rect>`,
      labelY: node.y + 18,
    };
  }
  const result = shapeSvg(node, animation, sm);
  if (node.lines?.length && node.shape !== 'class') {
    const top = node.y + 24;
    const style = node.style?.color ? ` style="fill:${esc(node.style.color)};fill-opacity:.9"` : '';
    const details = node.lines.map((line, index) =>
      `<text class="fm-sub" x="${r2(node.x + node.w / 2)}" y="${r2(top + 20 + index * 16)}" text-anchor="middle" dominant-baseline="central"${style}>${esc(line)}</text>`).join('');
    return { shape: result.svg + details, labelY: top };
  }
  return { shape: result.svg, labelY: result.labelY };
}

function renderNode(context: SvgRenderContext, node: LaidNode): string {
  const state = context.frame.nodes[node.id] ?? 'idle';
  const settings = nodePresentation(context.frame.presentation, node.id);
  const { shape, labelY } = nodeShape(context, node);
  const labels = nodeLabelMarkup(node, labelY);
  const tip = node.tooltip ? `<title>${esc(node.tooltip)}</title>` : '';
  const style = nodeStateStyle(context, node, state, settings);
  const styleAttr = style ? ` style="${esc(style)}"` : '';
  const animation = nodeAnimations(context, node);
  const body = `<g class="fm-node" data-node="${esc(node.id)}" data-state="${state}" opacity="${presentationOpacity(settings)}" visibility="${presentationVisibility(settings)}"${styleAttr}>${tip}${shape}${labels}${animation}</g>`;
  if (node.href && SAFE_HREF.test(node.href)) {
    return `<a href="${esc(node.href)}" target="_blank" rel="noopener noreferrer" class="fm-link" style="cursor:pointer">${body}</a>`;
  }
  return body;
}

function appendNodes(context: SvgRenderContext, out: string[]): void {
  out.push('<g class="fm-nodes">');
  for (const node of context.model.layout.nodes) out.push(renderNode(context, node));
  out.push('</g>');
}

function appendRows(context: SvgRenderContext, out: string[]): void {
  out.push('<g class="fm-rows">');
  for (const item of context.live) {
    const node = item.type === 'show' && item.node ? context.nodeById.get(item.node) : undefined;
    if (!node) continue;
    const settings = nodePresentation(context.frame.presentation, node.id);
    out.push(renderRows({
      node,
      item,
      theme: context.theme,
      opacity: (context.frame.shows[item.id] ?? 0) * presentationOpacity(settings),
      visible: presentationVisibility(settings),
      prefix: context.prefix,
      smil: !!context.options.smil,
      model: context.model,
    }));
  }
  out.push('</g>');
}

function renderBar(context: SvgRenderContext, item: Item, node: LaidNode): string {
  const { model: m, options, frame } = context;
  const full = node.w - 24, progress = frame.bars[item.id];
  const animation = options.smil
    ? `<animate attributeName="width" calcMode="linear" dur="${m.timeline.total}ms" repeatCount="indefinite" values="0;0;${r2(full)};${r2(full)}" keyTimes="0;${r2(item.start / m.timeline.total)};${r2(item.end / m.timeline.total)};1"/>` +
      showHide(m.timeline.total, item.start, item.end)
    : '';
  const width = progress === undefined ? 0 : r2(full * progress);
  const opacity = progress === undefined ? 0 : 1;
  return `<rect class="fm-bar" data-bar="${esc(item.id)}" x="${r2(node.x + 12)}" y="${r2(node.y + node.h - 12)}" width="${width}" height="${BAR_H}" rx="2" data-full="${r2(full)}" opacity="${opacity}">${animation}</rect>`;
}

function appendBars(context: SvgRenderContext, out: string[]): void {
  out.push('<g class="fm-bars">');
  for (const item of context.live) {
    const node = item.node ? context.nodeById.get(item.node) : undefined;
    if (!node || (item.type !== 'process' && item.type !== 'emit') || item.end <= item.start) continue;
    out.push(renderBar(context, item, node));
  }
  out.push('</g>');
}

function appendPackets(context: SvgRenderContext, out: string[]): void {
  const { model: m, options, frame } = context;
  out.push('<g class="fm-packets">');
  for (const item of context.live) {
    if (item.type !== 'transfer') continue;
    const edge = m.layout.edges.find((candidate) => candidate.id === item.flow);
    if (!edge) continue;
    const motionEnabled = options.smil && arrowPresentation(presentationAt(m, item.start), edge.id).packet !== false;
    const motion = motionEnabled ? packetMotion(edge.path.d, m.timeline.total, item) : '';
    out.push(packetElement(item.id, frame.packets[item.id], packetBody(item.label ?? ''), motion, !!options.smil));
  }
  out.push('</g>');
}

function appendCaptions(context: SvgRenderContext, out: string[]): void {
  const { model: m, options, frame } = context;
  if (!m.layout.story) return;
  const story = m.layout.story;
  out.push('<g class="fm-captions">');
  for (const item of context.live.filter((entry) => entry.type === 'caption')) {
    const lines = wrap(item.label ?? '', story.captionW, 15, false, 3);
    const opacity = frame.captions[item.id] ? 1 : 0;
    const step = m.view?.header ? `<text class="fm-step" x="28" y="${story.headerY}">${esc(item.step ?? '')}</text>` : '';
    const caption = m.view?.footer
      ? lines.map((line, index) => `<text class="fm-caption" x="28" y="${r2(story.captionY + 12 + index * 21)}">${esc(line)}</text>`).join('')
      : '';
    const animation = options.smil ? showHide(m.timeline.total, item.start, item.end) : '';
    out.push(`<g class="fm-cap" data-caption="${esc(item.id)}" opacity="${opacity}">${step}${caption}${animation}</g>`);
  }
  out.push('</g>');
}

function markerEdgesForScenes(m: Model): Layout['edges'] {
  const markerEdges = [...m.layout.edges];
  for (const scene of m.timeline.scenes ?? []) {
    for (const edge of m.layout.edges) {
      const color = arrowPresentation(scene.presentation, edge.id).color;
      if (color) markerEdges.push({ ...edge, style: { ...edge.style, stroke: color } });
    }
  }
  return markerEdges;
}

function colorScheme(paper: string): string {
  return paper === 'dark' ? 'dark' : 'light';
}

function paperFill(paper: string): string {
  if (paper === 'dark') return '#1e1e1e';
  if (paper === 'light') return '#ffffff';
  return esc(paper);
}

function appendSvgHeader(context: SvgRenderContext, out: string[]): void {
  const { model: m, options, theme: th, prefix: p, sceneSmil } = context;
  const story = m.layout.story, padding = 14;
  const viewTop = story && !m.view?.header ? Math.max(0, story.contentTop - padding) : 0;
  const viewBottom = story && !m.view?.footer ? story.contentBottom + padding : m.layout.height;
  const backdrop = m.backdrop;
  const paper = m.view?.paper ?? 'light';
  const [x, width, height] = backdrop ? [backdrop.ox, backdrop.w, backdrop.h] : [0, m.layout.width, viewBottom - viewTop];
  const y = backdrop ? backdrop.oy : viewTop;
  const overlay = backdrop ? ' fm-overlay' : '';
  const aria = esc('FlowMotion diagram ' + m.id);
  const rootStyle = backdrop && paper !== 'none' ? ` style="color-scheme:${colorScheme(paper)}"` : '';
  const root = `<svg xmlns="http://www.w3.org/2000/svg" class="fm-root ${p}${overlay}" data-marker-prefix="${esc(p)}" viewBox="${r2(x)} ${r2(y)} ${r2(width)} ${r2(height)}" ` +
    `width="${r2(width)}" role="img" aria-label="${aria}" data-fm-id="${esc(m.id)}"${rootStyle}>`;
  const title = backdrop ? '' : `<title>${esc(m.id + ': ' + m.layout.nodes.map((node) => node.label).join(', '))}</title>`;
  const stylesheet = `<style>${css(p, th, !!options.transparent, m.layout.nodes, sceneSmil)}</style>`;
  const definitions = `<defs>${markerDefs(p, markerEdgesForScenes(m), th)}</defs>`;
  out.push(root, title, stylesheet, definitions);
}

function appendStandardDiagram(context: SvgRenderContext, out: string[]): void {
  appendAxis(context, out);
  appendGroups(context, out);
  const labels = appendEdges(context, out);
  appendNodes(context, out);
  appendEdgeLabels(labels, out);
  appendRows(context, out);
  appendBars(context, out);
  appendPackets(context, out);
  appendCaptions(context, out);
}

export function renderSvg(m: Model, opts: RenderOptions): string {
  const th = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  if (opts.smil && !th.concrete) throw new Error('Animated SVG export needs the "light" or "dark" theme.');
  const timeline = m.timeline;
  const context: SvgRenderContext = {
    model: m,
    options: opts,
    theme: th,
    prefix: opts.idPrefix,
    frame: frameAt(m, opts.smil ? 0 : (opts.at ?? 0)),
    sceneSmil: !!opts.smil && !!timeline.scenes,
    live: timeline.items.filter((item) => !item.skipped),
    nodeById: new Map(m.layout.nodes.map((node) => [node.id, node])),
  };
  const out: string[] = [];
  appendSvgHeader(context, out);
  if (m.backdrop) appendBackdrop(m, opts, th, opts.idPrefix, context.frame, context.live, out);
  else appendStandardDiagram(context, out);
  out.push('</svg>');
  return out.join('');
}
