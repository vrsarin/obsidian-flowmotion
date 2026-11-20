import { makePath, pathFromPoints, pointAt, type Pt } from '../core/geometry';
import type { Diagram } from '../core/types';
import type { LaidEdge, LaidGroup, LaidNode, Layout } from './types';

const MARGIN = 28;

/** Where a ray from the box centre towards `to` leaves the box. */
function exit(b: { x: number; y: number; w: number; h: number }, to: Pt): Pt {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = to.x - cx, dy = to.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const k = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k };
}

/** Layout for diagrams that bring their own coordinates (draw.io imports): no solver, boxes stay where the author put them. */
export function layoutFixed(d: Diagram): Layout {
  const fx = d.fixed!;
  const nodes: LaidNode[] = d.nodes.map((n) => {
    const b = fx.nodes[n.id]!;
    return { id: n.id, label: n.label, x: b.x, y: b.y, w: b.w, h: b.h, ...(n.shape && { shape: n.shape }), ...(n.lines && { lines: n.lines }), ...(n.href && { href: n.href }), ...(n.tooltip && { tooltip: n.tooltip }), ...(n.style && { style: n.style }) };
  });
  const depth = (id: string): number => { const g = d.groups.find((q) => q.id === id); return g?.parent ? 1 + depth(g.parent) : 0; };
  const groups: LaidGroup[] = d.groups.map((g) => { const b = fx.groups[g.id]!; return { id: g.id, label: g.label, ...b, depth: depth(g.id) }; });
  const edges: LaidEdge[] = d.flows.map((f) => {
    const a = fx.nodes[f.from]!, b = fx.nodes[f.to]!;
    const via = fx.routes[f.id] ?? [];
    const first = via[0] ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 }, last = via.at(-1) ?? { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    let mid: Pt[] = via;
    // No waypoints and not aligned: one elbow pair, so lines stay orthogonal like draw.io's default connectors.
    if (!via.length) {
      const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const aligned = Math.abs(ac.x - bc.x) < 6 || Math.abs(ac.y - bc.y) < 6;
      if (!aligned && !f.curve) {
        const mx = (ac.x + bc.x) / 2, my = (ac.y + bc.y) / 2; // Z-shaped: leave and enter on facing sides
        mid = Math.abs(bc.x - ac.x) >= Math.abs(bc.y - ac.y) ? [{ x: mx, y: ac.y }, { x: mx, y: bc.y }] : [{ x: ac.x, y: my }, { x: bc.x, y: my }];
      }
    }
    const start = exit(a, mid[0] ?? first), end = exit(b, mid.at(-1) ?? last);
    const path = makePath([start, ...mid, end], { curve: f.curve, horizontal: true });
    const at = d.edgeLabels && f.payload && path.points.length ? pointAt(path, 0.5) : undefined;
    return { id: f.id, from: f.from, to: f.to, path, ...(at && { label: { text: f.payload!, x: at.x, y: at.y - 6 } }), ...(f.line && { line: f.line }), ...(f.head && { head: f.head }), ...(f.tail && { tail: f.tail }), ...(f.style && { style: f.style }) };
  });
  const xs = [...nodes.flatMap((n) => [n.x, n.x + n.w]), ...groups.flatMap((g) => [g.x, g.x + g.w]), ...edges.flatMap((e) => e.path.points.map((p) => p.x))];
  const ys = [...nodes.flatMap((n) => [n.y, n.y + n.h]), ...groups.flatMap((g) => [g.y, g.y + g.h]), ...edges.flatMap((e) => e.path.points.map((p) => p.y))];
  const minX = Math.min(...xs) - MARGIN, minY = Math.min(...ys) - MARGIN;
  const mv = <T extends { x: number; y: number }>(l: T | undefined) => l && { ...l, x: l.x - minX, y: l.y - minY };
  return {
    origin: { x: minX, y: minY },
    width: Math.max(...xs) - minX + MARGIN, height: Math.max(...ys) - minY + MARGIN,
    nodes: nodes.map((n) => ({ ...n, x: n.x - minX, y: n.y - minY })),
    groups: groups.map((g) => ({ ...g, x: g.x - minX, y: g.y - minY })),
    edges: edges.map((e) => ({ ...e, path: pathFromPoints(e.path.points.map((p) => mv(p)!)), ...(e.label && { label: mv(e.label)! }) })),
  };
}
