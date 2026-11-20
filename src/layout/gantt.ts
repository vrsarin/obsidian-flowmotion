import { makePath, textWidth } from '../core/geometry';
import type { Diagram } from '../core/types';
import type { LaidEdge, LaidGroup, LaidNode, Layout } from './types';

const GUTTER = 150, ROW = 34, BAR = 20, TOP = 70, DAY_MIN = 16;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Time-axis layout: one row per task, x from the schedule. No graph layout engine involved. */
export function layoutGantt(d: Diagram): Layout {
  const g = d.gantt!;
  const spans = d.nodes.map((n) => g.tasks[n.id]!);
  const total = Math.max(1, ...spans.map((s) => s.end));
  const perDay = Math.min(40, Math.max(DAY_MIN, 760 / total));
  const x0 = GUTTER + 14, X = (day: number) => x0 + day * perDay;
  const base = g.startDay;
  const step = [1, 2, 7, 14, 30, 60, 90, 180, 365].find((s) => (total / s) <= 14) ?? 365;
  const ticks: { x: number; label: string }[] = [];
  for (let day = 0; day <= total; day += step) {
    const dt = new Date((base + day) * 86400000);
    ticks.push({ x: X(day), label: `${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}` });
  }

  // Rows grouped by section, in the order tasks were written.
  let lastGroup: string | undefined;
  const bands = new Map<string, { y0: number; y1: number }>();
  const gap = 10;
  let y = TOP;
  const nodes: LaidNode[] = d.nodes.map((n) => {
    if (n.group !== lastGroup && lastGroup !== undefined) y += gap;
    lastGroup = n.group;
    const s = g.tasks[n.id]!;
    const cy = y + ROW / 2;
    y += ROW;
    if (n.group) { const b = bands.get(n.group); if (b) b.y1 = y; else bands.set(n.group, { y0: y - ROW, y1: y }); }
    const w = s.milestone ? BAR + 6 : Math.max(8, (s.end - s.start) * perDay);
    const x = s.milestone ? X(s.start) - (BAR + 6) / 2 : X(s.start);
    const fits = textWidth(n.label, 14) + 20 <= w;
    return { id: n.id, label: n.label, x, y: cy - BAR / 2, w, h: BAR, shape: s.milestone ? 'diamond' : 'round', ...(!fits && { outside: true }), ...(n.style && { style: n.style }) };
  });
  const width = Math.max(X(total) + 40, ...nodes.filter((n) => n.outside).map((n) => n.x + n.w + 16 + textWidth(n.label, 14)));
  const bottom = y + 16;
  const groups: LaidGroup[] = (d.groups ?? []).map((gr) => {
    const b = bands.get(gr.id) ?? { y0: TOP, y1: TOP + ROW };
    return { id: gr.id, label: gr.label, x: 8, y: b.y0 - 4, w: width - 16, h: b.y1 - b.y0 + 8, depth: 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidEdge[] = d.flows.map((f) => {
    const a = byId.get(f.from)!, b = byId.get(f.to)!;
    const ay = a.y + a.h / 2, by = b.y + b.h / 2, ax = a.x + a.w, bx = b.x;
    const mid = Math.max(ax + 8, Math.min(bx - 8, ax + 8));
    const route = [{ x: ax, y: ay }, { x: mid, y: ay }, { x: mid, y: by }, { x: bx, y: by }];
    return { id: f.id, from: f.from, to: f.to, path: makePath(route, {}), head: 'arrow', ...(f.style && { style: f.style }) };
  });
  return { width, height: bottom + 12, nodes, groups, edges, axis: { ticks, top: TOP - 6, bottom, ...(g.title && { title: g.title }) } };
}
