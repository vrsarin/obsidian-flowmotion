import ELK from 'elkjs/lib/elk.bundled.js';
import { makePath, pathFromPoints, pointAt, textWidth, type Pt } from '../core/geometry';
import { layoutFixed } from './fixed';
import { layoutGantt } from './gantt';
import type { LaidEdge, LaidGroup, LaidNode, Layout } from './types';
import type { Diagram, Shape } from '../core/types';

export type { Layout, LaidNode, LaidEdge, LaidGroup } from './types';

const DIR = { LR: 'RIGHT', RL: 'LEFT', TB: 'DOWN', BT: 'UP' } as const;
const MARGIN = 28;

/** Node box size for its label and outline. */
function sizeOf(label: string, shape: Shape = 'rect', lines: string[] = [], horizontal = true) {
  const tw = textWidth(label, 14);
  if (shape === 'start' || shape === 'end') return { w: 26, h: 26 };
  if (shape === 'bar') return horizontal ? { w: 8, h: 72 } : { w: 72, h: 8 };
  if (lines.length) return { w: Math.max(150, tw + 44, ...lines.map((l) => textWidth(l, 12) + 28)), h: 38 + lines.length * 18 + 10 };
  switch (shape) {
    case 'diamond': return { w: Math.max(130, tw * 1.5 + 50), h: 84 };
    case 'circle': { const d = Math.max(72, tw + 36); return { w: d, h: d }; }
    case 'hexagon': return { w: Math.max(130, tw + 80), h: 56 };
    case 'cylinder': return { w: Math.max(120, tw + 44), h: 68 };
    case 'parallelogram': return { w: Math.max(130, tw + 70), h: 52 };
    case 'stadium': return { w: Math.max(120, tw + 56), h: 52 };
    default: return { w: Math.max(120, tw + 44), h: 52 };
  }
}

interface ElkBox { id: string; x?: number; y?: number; width?: number; height?: number; children?: ElkBox[]; [k: string]: unknown }

export async function layoutDiagram(d: Diagram): Promise<Layout> {
  if (d.gantt) return layoutGantt(d);
  if (d.fixed) return layoutFixed(d);
  const sizes = new Map(d.nodes.map((n) => [n.id, sizeOf(n.label, n.shape, n.lines, d.direction === 'LR' || d.direction === 'RL')]));
  const groups = d.groups ?? [];
  const hasGroups = groups.length > 0;

  // Build the containment tree: groups hold nodes and sub-groups.
  const box = (id: string, w: number, h: number): ElkBox => ({ id, width: w, height: h });
  const gBox = new Map<string, ElkBox>(groups.map((g) => [g.id, {
    id: g.id, children: [],
    layoutOptions: { 'elk.padding': '[top=38,left=18,bottom=18,right=18]', 'elk.layered.spacing.nodeNodeBetweenLayers': '90', 'elk.spacing.nodeNode': '40', 'elk.nodeLabels.placement': 'INSIDE V_TOP H_LEFT' },
    ...(g.label ? { width: Math.max(80, textWidth(g.label, 12) + 36) } : {}),
  }]));
  const root: ElkBox[] = [];
  for (const g of groups) (g.parent ? gBox.get(g.parent)!.children! : root).push(gBox.get(g.id)!);
  for (const n of d.nodes) (n.group ? gBox.get(n.group)!.children! : root).push(box(n.id, sizes.get(n.id)!.w, sizes.get(n.id)!.h));

  const elk = new ELK();
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': DIR[d.direction],
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.layered.spacing.edgeNodeBetweenLayers': '30',
      'elk.layered.feedbackEdges': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      ...(hasGroups ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
    },
    children: root,
    edges: d.flows.map((f) => ({ id: f.id, sources: [f.from], targets: [f.to] })),
  }) as ElkBox & { edges?: unknown[] };

  // Child coordinates are relative to their parent: flatten to absolute positions.
  const abs = new Map<string, { x: number; y: number; w: number; h: number; depth: number }>();
  const walk = (b: ElkBox, ox: number, oy: number, depth: number) => {
    for (const c of b.children ?? []) {
      const x = ox + (c.x ?? 0), y = oy + (c.y ?? 0);
      abs.set(c.id, { x, y, w: c.width ?? 0, h: c.height ?? 0, depth });
      walk(c, x, y, depth + 1);
    }
  };
  walk(res, 0, 0, 0);

  const horizontal = d.direction === 'LR' || d.direction === 'RL';
  const nodes: LaidNode[] = d.nodes.map((n) => {
    const b = abs.get(n.id)!;
    return { id: n.id, label: n.label, x: b.x, y: b.y, w: b.w, h: b.h, ...(n.shape && { shape: n.shape }), ...(n.lines && { lines: n.lines }), ...(n.href && { href: n.href }), ...(n.tooltip && { tooltip: n.tooltip }), ...(n.style && { style: n.style }) };
  });
  const laidGroups: LaidGroup[] = groups.map((g) => { const b = abs.get(g.id)!; return { id: g.id, label: g.label, x: b.x, y: b.y, w: b.w, h: b.h, depth: b.depth }; });
  const edges: LaidEdge[] = d.flows.map((f) => {
    const e = (res.edges ?? []).find((x) => (x as { id: string }).id === f.id) as { container?: string; sections?: { startPoint: Pt; endPoint: Pt; bendPoints?: Pt[] }[] } | undefined;
    const s = e?.sections?.[0];
    // Edge points are relative to the group that contains the edge ("root" = none).
    const o = abs.get(e?.container ?? '') ?? { x: 0, y: 0 };
    const at = (q: Pt) => ({ x: q.x + o.x, y: q.y + o.y });
    const route = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(at) : [];
    const path = makePath(route, { curve: f.curve, horizontal });
    const mid = d.edgeLabels && f.payload && path.points.length ? pointAt(path, 0.5) : undefined;
    const endLabel = (text: string | undefined, atEnd: boolean) => {
      if (!text || path.length < 1) return undefined;
      const q = pointAt(path, atEnd ? Math.max(0.5, 1 - 26 / path.length) : Math.min(0.5, 26 / path.length));
      return { text, x: q.x + 8, y: q.y - 4 };
    };
    const hl = endLabel(f.headLabel, true), tl = endLabel(f.tailLabel, false);
    return {
      id: f.id, from: f.from, to: f.to, path,
      ...(hl && { headLabel: hl }), ...(tl && { tailLabel: tl }),
      ...(mid && { label: { text: f.payload!, x: mid.x, y: mid.y - 6 } }),
      ...(f.line && { line: f.line }), ...(f.head && { head: f.head }), ...(f.tail && { tail: f.tail }), ...(f.style && { style: f.style }),
    };
  });

  // Bounds including groups and edge routes, then shift to a positive margin.
  const xs = [...nodes.flatMap((n) => [n.x, n.x + n.w]), ...laidGroups.flatMap((g) => [g.x, g.x + g.w]), ...edges.flatMap((e) => e.path.points.map((p) => p.x))];
  const ys = [...nodes.flatMap((n) => [n.y, n.y + n.h]), ...laidGroups.flatMap((g) => [g.y, g.y + g.h]), ...edges.flatMap((e) => e.path.points.map((p) => p.y))];
  const minX = Math.min(...xs) - MARGIN, minY = Math.min(...ys) - MARGIN;
  const shift = (p: Pt) => ({ x: p.x - minX, y: p.y - minY });
  return {
    width: Math.max(...xs) - minX + MARGIN, height: Math.max(...ys) - minY + MARGIN,
    nodes: nodes.map((n) => ({ ...n, x: n.x - minX, y: n.y - minY })),
    groups: laidGroups.map((g) => ({ ...g, x: g.x - minX, y: g.y - minY })),
    edges: edges.map((e) => {
      const mv = <T extends { x: number; y: number }>(l: T | undefined) => l && { ...l, x: l.x - minX, y: l.y - minY };
      return { ...e, path: pathFromPoints(e.path.points.map(shift)), ...(e.label && { label: mv(e.label)! }), ...(e.headLabel && { headLabel: mv(e.headLabel)! }), ...(e.tailLabel && { tailLabel: mv(e.tailLabel)! }) };
    }),
  };
}
