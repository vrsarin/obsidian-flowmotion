import { deriveEvents } from '../core/auto';
import { COLOR, DiagramError, LIMITS, type Diagram, type End, type FixedLayout, type FlowDef, type GroupDef, type Line, type NodeDef, type Shape, type Style } from '../core/types';
import { parseDrawio, plainLabel, styleMap, type MxCell } from './parse';

const END: Record<string, End> = { none: 'none', block: 'arrow', classic: 'arrow', open: 'arrow', openThin: 'arrow', blockThin: 'arrow', classicThin: 'arrow', oval: 'circle', cross: 'cross', diamond: 'diamond-filled', diamondThin: 'diamond', triangle: 'triangle' };

const shapeOf = (st: Map<string, string>, w: number, h: number): Shape | undefined => {
  const sh = st.get('shape') ?? '';
  if (st.has('ellipse') || sh === 'ellipse') return Math.abs(w - h) < 8 ? 'circle' : 'stadium';
  if (st.has('rhombus') || sh === 'rhombus') return 'diamond';
  if (/^cylinder/.test(sh)) return 'cylinder';
  if (sh === 'hexagon') return 'hexagon';
  if (sh === 'parallelogram') return 'parallelogram';
  if (st.get('rounded') === '1') return 'round';
  return undefined;
};

const colour = (v: string | undefined) => (v && COLOR.test(v) && v !== 'none' && v !== 'default' ? v : undefined);

/** draw.io file text -> the shared Diagram model, keeping draw.io's own coordinates. */
export async function importDrawio(text: string): Promise<Diagram> {
  const cells = await parseDrawio(text);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const vertices = cells.filter((c) => c.vertex && c.w > 0 && c.h > 0);
  const vset = new Set(vertices.map((c) => c.id));
  const kids = new Map<string, MxCell[]>();
  for (const v of vertices) if (v.parent && vset.has(v.parent)) (kids.get(v.parent) ?? kids.set(v.parent, []).get(v.parent)!).push(v);

  const abs = (c: MxCell): { x: number; y: number } => {
    let x = c.x, y = c.y, p = c.parent ? byId.get(c.parent) : undefined, guard = 0;
    while (p && vset.has(p.id) && guard++ < 50) { x += p.x; y += p.y; p = p.parent ? byId.get(p.parent) : undefined; }
    return { x, y };
  };
  const used = new Set<string>();
  const ids = new Map<string, string>();
  const idOf = (raw: string) => {
    let id = ids.get(raw);
    if (!id) {
      const base = `n_${raw.replace(/[^A-Za-z0-9_]/g, '_')}`;
      id = base; let k = 1;
      while (used.has(id)) id = `${base}_${++k}`;
      used.add(id); ids.set(raw, id);
    }
    return id;
  };

  const nodes: NodeDef[] = [], groups: GroupDef[] = [];
  const fixed: FixedLayout = { nodes: {}, groups: {}, routes: {} };
  const firstLeaf = new Map<string, string>();
  const leafOf = (c: MxCell): string | undefined => {
    if (!kids.has(c.id)) return idOf(c.id);
    for (const k of kids.get(c.id)!) { const r = leafOf(k); if (r) return r; }
    return undefined;
  };
  for (const v of vertices) {
    const st = styleMap(v.style), label = plainLabel(v.value, st.get('html') === '1').slice(0, LIMITS.label);
    const { x, y } = abs(v), id = idOf(v.id), box = { x, y, w: v.w, h: v.h };
    if (kids.has(v.id)) {
      const par = v.parent && kids.has(v.parent) ? idOf(v.parent) : undefined;
      groups.push({ id, label, ...(par && { parent: par }) });
      fixed.groups[id] = box;
      continue;
    }
    const style: Style = {};
    const fill = colour(st.get('fillColor')), stroke = colour(st.get('strokeColor')), fc = colour(st.get('fontColor'));
    if (fill) style.fill = fill; if (stroke) style.stroke = stroke; if (fc) style.color = fc;
    const shape = shapeOf(st, v.w, v.h);
    nodes.push({ id, label: label || ' ', ...(shape && { shape }), ...(v.parent && kids.has(v.parent) && { group: idOf(v.parent) }), ...(Object.keys(style).length && { style }) });
    fixed.nodes[id] = box;
    firstLeaf.set(v.id, id);
  }
  // Groups hold nodes and sub-groups; draw.io lists children after parents, ELK-style order is not needed here.
  const flows: FlowDef[] = [];
  for (const e of cells.filter((c) => c.edge)) {
    const s = e.source ? byId.get(e.source) : undefined, t = e.target ? byId.get(e.target) : undefined;
    const from = s && vset.has(s.id) ? leafOf(s) : undefined, to = t && vset.has(t.id) ? leafOf(t) : undefined;
    if (!from || !to || from === to) continue;
    const st = styleMap(e.style);
    let id = `${from}__${to}`, k = 1;
    while (flows.some((f) => f.id === id)) id = `${from}__${to}_${++k}`;
    const line: Line | undefined = st.get('dashed') === '1' ? 'dotted' : undefined;
    const head = END[st.get('endArrow') ?? 'classic'], tail = END[st.get('startArrow') ?? 'none'];
    const label = plainLabel(e.value, st.get('html') === '1').slice(0, LIMITS.label);
    const stroke = colour(st.get('strokeColor'));
    fixed.edgeCell ??= {}; fixed.edgeCell[id] = e.id;
    flows.push({ id, from, to, curve: st.get('curved') === '1', ...(label && { payload: label }), ...(line && { line }), ...(head && head !== 'arrow' && { head }), ...(tail && tail !== 'none' && { tail }), ...(stroke && { style: { stroke } }) });
    if (e.points.length) {
      const o = e.parent ? byId.get(e.parent) : undefined;
      const off = o && vset.has(o.id) ? abs(o) : { x: 0, y: 0 };
      fixed.routes[id] = e.points.map((p) => ({ x: p.x + off.x, y: p.y + off.y }));
    }
  }
  if (!nodes.length) throw new DiagramError(['The draw.io diagram has no shapes.']);
  const pts = [...vertices.map((v) => abs(v)), ...Object.values(fixed.routes).flat()];
  fixed.offset = { x: Math.min(...pts.map((q) => q.x)), y: Math.min(...pts.map((q) => q.y)) };
  if (nodes.length > LIMITS.nodes || flows.length > LIMITS.flows) throw new DiagramError([`Too large: at most ${LIMITS.nodes} shapes and ${LIMITS.flows} connectors.`]);
  const events = deriveEvents(nodes.map((n) => n.id), flows);
  return { id: 'drawio', direction: 'TB', edgeLabels: true, nodes, groups, flows, events, animation: { autoplay: true, loop: true, speed: 1 }, fixed };
}
