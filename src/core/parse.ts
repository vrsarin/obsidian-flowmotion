import { plain } from './str';
import { parse as parseYaml } from 'yaml';
import { deriveEvents } from './auto';
import { parseView } from './view';
import { buildTimeline } from './timeline';
import { COLOR, DiagramError, ENDS, LIMITS, LINES, SHAPES, type Diagram, type End, type EventDef, type EventType, type FlowDef, type GroupDef, type Line, type NodeDef, type Shape, type Style } from './types';

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const EVENT_TYPES: EventType[] = ['transfer', 'process', 'complete', 'branch', 'fork', 'join', 'wait', 'emit'];
const DIRECTIONS = ['LR', 'RL', 'TB', 'BT'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse + validate a YAML (or JSON) FlowMotion definition. Input is untrusted. */
export function parseDiagram(source: string): Diagram {
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);

  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 20, strict: true }); }
  catch (e) { throw new DiagramError([`YAML error: ${(e as Error).message.split('\n')[0]}`]); }
  if (!isObj(raw)) throw new DiagramError(['Definition must be a YAML mapping with nodes, flows and events.']);

  const str = (v: unknown, where: string, required = true): string | undefined => {
    if (v === undefined || v === null) { if (required) bad(`${where}: required`); return undefined; }
    if (typeof v !== 'string' && typeof v !== 'number') { bad(`${where}: must be text`); return undefined; }
    const s = String(v);
    if (s.length > LIMITS.label) { bad(`${where}: longer than ${LIMITS.label} characters`); return undefined; }
    return s;
  };
  const id = (v: unknown, where: string) => {
    const s = str(v, where);
    if (s !== undefined && !ID.test(s)) { bad(`${where}: "${s}" must match [A-Za-z0-9_.-], max 64 chars`); return undefined; }
    return s;
  };
  const list = (v: unknown, where: string): unknown[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { bad(`${where}: must be a list`); return []; }
    return v;
  };
  const idList = (v: unknown, where: string): string[] => {
    const arr = typeof v === 'string' ? [v] : list(v, where);
    return arr.map((x, i) => id(x, `${where}[${i}]`)).filter((x): x is string => !!x);
  };

  const oneOf = <T extends string>(v: unknown, set: readonly T[], where: string): T | undefined => {
    if (v === undefined) return undefined;
    if (!set.includes(v as T)) { bad(`${where}: "${plain(v)}" is not one of ${set.join(', ')}`); return undefined; }
    return v as T;
  };
  const styleOf = (v: unknown, where: string): Style | undefined => {
    if (v === undefined) return undefined;
    if (!isObj(v)) { bad(`${where}: must be a mapping with fill, stroke, color, strokeWidth`); return undefined; }
    const out: Style = {};
    for (const k of Object.keys(v)) {
      if (k === 'strokeWidth') { const n = v[k]; if (typeof n === 'number' && n >= 0 && n <= 12) out.strokeWidth = n; else bad(`${where}.strokeWidth: number between 0 and 12`); }
      else if (k === 'fill' || k === 'stroke' || k === 'color') { const c = v[k]; if (typeof c === 'string' && COLOR.test(c.trim())) out[k] = c.trim(); else bad(`${where}.${k}: a colour such as #2f6fed or red`); }
      else bad(`${where}.${k}: not allowed (use fill, stroke, color, strokeWidth)`);
    }
    return out;
  };

  const dgm = isObj(raw.diagram) ? raw.diagram : {};
  if (dgm.edgeLabels !== undefined && typeof dgm.edgeLabels !== 'boolean') bad('diagram.edgeLabels: use true or false');
  const dirRaw = dgm.direction === undefined ? 'LR' : plain(dgm.direction).toUpperCase();
  if (!(DIRECTIONS as readonly string[]).includes(dirRaw)) bad(`diagram.direction: must be one of ${DIRECTIONS.join(', ')}`);

  const rawNodes = list(raw.nodes, 'nodes'), rawFlows = list(raw.flows, 'flows'), rawEvents = list(raw.events, 'events');
  if (rawNodes.length > LIMITS.nodes) bad(`nodes: at most ${LIMITS.nodes}`);
  if (rawFlows.length > LIMITS.flows) bad(`flows: at most ${LIMITS.flows}`);
  if (rawEvents.length > LIMITS.events) bad(`events: at most ${LIMITS.events}`);
  if (problems.length) throw new DiagramError(problems);
  if (rawNodes.length === 0) bad('nodes: define at least one node');

  const nodes: NodeDef[] = [];
  rawNodes.forEach((n, i) => {
    if (!isObj(n)) return bad(`nodes[${i}]: must be a mapping`);
    const nid = id(n.id, `nodes[${i}].id`);
    const label = str(n.label ?? n.id, `nodes[${i}].label`);
    const shape = oneOf<Shape>(n.shape, SHAPES, `nodes[${i}].shape`);
    const group = n.group === undefined ? undefined : id(n.group, `nodes[${i}].group`);
    const style = styleOf(n.style, `nodes[${i}].style`);
    const lines = n.lines === undefined ? undefined : list(n.lines, `nodes[${i}].lines`).map((x, j) => str(x, `nodes[${i}].lines[${j}]`)).filter((x): x is string => x !== undefined);
    if (nid && label !== undefined) nodes.push({ id: nid, label, ...(lines?.length && { lines }), ...(shape && { shape }), ...(group && { group }), ...(style && { style }) });
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (nodeIds.size !== nodes.length) bad('nodes: duplicate ids');

  const groups: GroupDef[] = [];
  list(raw.groups, 'groups').forEach((g, i) => {
    if (!isObj(g)) return bad(`groups[${i}]: must be a mapping`);
    const gid = id(g.id, `groups[${i}].id`);
    const label = str(g.label, `groups[${i}].label`, false);
    const parent = g.parent === undefined ? undefined : id(g.parent, `groups[${i}].parent`);
    if (gid) groups.push({ id: gid, ...(label !== undefined && { label }), ...(parent && { parent }) });
  });
  const groupIds = new Set(groups.map((g) => g.id));
  if (groupIds.size !== groups.length) bad('groups: duplicate ids');
  if (groups.some((g) => nodeIds.has(g.id))) bad('groups: an id cannot be both a group and a node');
  groups.forEach((g, i) => { if (g.parent && !groupIds.has(g.parent)) bad(`groups[${i}].parent: unknown group "${g.parent}"`); });
  for (const g of groups) { // nesting must not loop
    const seen = new Set<string>();
    for (let c: GroupDef | undefined = g; c; c = groups.find((x) => x.id === c.parent)) { if (seen.has(c.id)) { bad(`groups: "${g.id}" is nested inside itself`); break; } seen.add(c.id); }
  }
  nodes.forEach((n, i) => { if (n.group && !groupIds.has(n.group)) bad(`nodes[${i}].group: unknown group "${n.group}"`); });

  const flows: FlowDef[] = [];
  rawFlows.forEach((f, i) => {
    if (!isObj(f)) return bad(`flows[${i}]: must be a mapping`);
    const fid = id(f.id, `flows[${i}].id`), from = id(f.from, `flows[${i}].from`), to = id(f.to, `flows[${i}].to`);
    const payload = str(f.payload, `flows[${i}].payload`, false);
    for (const [k, v] of [['from', from], ['to', to]] as const) if (v && !nodeIds.has(v)) bad(`flows[${i}].${k}: unknown node "${v}"`);
    const line = oneOf<Line>(f.line, LINES, `flows[${i}].line`);
    const head = oneOf<End>(f.head, ENDS, `flows[${i}].head`), tail = oneOf<End>(f.tail, ENDS, `flows[${i}].tail`);
    const style = styleOf(f.style, `flows[${i}].style`);
    const headLabel = str(f.headLabel, `flows[${i}].headLabel`, false), tailLabel = str(f.tailLabel, `flows[${i}].tailLabel`, false);
    if (fid && from && to) flows.push({ id: fid, from, to, payload, curve: f.curve === true, ...(headLabel && { headLabel }), ...(tailLabel && { tailLabel }), ...(line && { line }), ...(head && { head }), ...(tail && { tail }), ...(style && { style }) });
  });
  const flowIds = new Set(flows.map((f) => f.id));
  if (flowIds.size !== flows.length) bad('flows: duplicate ids');

  const events: EventDef[] = [];
  const eventAt = new Map<string, number>(); // event id -> index in the source list, for error locations
  rawEvents.forEach((e, i) => {
    const w = `events[${i}]`;
    if (!isObj(e)) return bad(`${w}: must be a mapping`);
    const eid = id(e.id, `${w}.id`);
    const type = String(e.type) as EventType;
    if (!EVENT_TYPES.includes(type)) return bad(`${w}.type: "${String(e.type)}" is not one of ${EVENT_TYPES.join(', ')}`);
    const flow = e.flow === undefined ? undefined : id(e.flow, `${w}.flow`);
    const node = e.node === undefined ? undefined : id(e.node, `${w}.node`);
    if (type === 'transfer') { if (!flow) bad(`${w}: transfer needs "flow"`); else if (!flowIds.has(flow)) bad(`${w}.flow: unknown flow "${flow}"`); }
    if (['process', 'emit', 'complete'].includes(type) && !node) bad(`${w}: ${type} needs "node"`);
    if (node && !nodeIds.has(node)) bad(`${w}.node: unknown node "${node}"`);
    let duration: number | undefined;
    if (e.duration !== undefined) {
      if (typeof e.duration !== 'number' || !(e.duration >= 0) || e.duration > LIMITS.duration) bad(`${w}.duration: number of ms between 0 and ${LIMITS.duration}`);
      else duration = e.duration;
    }
    if (eid) eventAt.set(eid, i);
    if (eid) events.push({
      id: eid, type, flow, node, payload: str(e.payload, `${w}.payload`, false),
      after: idList(e.after, `${w}.after`), until: idList(e.until, `${w}.until`), select: idList(e.select, `${w}.select`),
      duration, fail: e.fail === true,
    });
  });
  if (rawEvents.length === 0) events.push(...deriveEvents(nodes.map((n) => n.id), flows)); // no script: animate the graph itself
  const eventIds = new Set(events.map((e) => e.id));
  if (eventIds.size !== events.length) bad('events: duplicate ids');
  for (const e of events) {
    for (const k of ['after', 'until', 'select'] as const)
      e[k].forEach((ref, j) => { if (!eventIds.has(ref)) bad(`events[${eventAt.get(e.id)}].${k}[${j}]: unknown event "${ref}"`); });
    if (e.type === 'branch') {
      if (e.select.length === 0) bad(`events[${eventAt.get(e.id)}].select: branch needs "select" (the child events to take)`);
      for (const s of e.select) { const c = events.find((x) => x.id === s); if (c && !c.after.includes(e.id)) bad(`events[${eventAt.get(e.id)}].select: "${s}" does not list this branch in "after"`); }
    }
  }

  const an = isObj(raw.animation) ? raw.animation : {};
  const speed = an.speed === undefined ? 1 : Number(an.speed);
  if (!(speed >= 0.1 && speed <= 10)) bad('animation.speed: between 0.1 and 10');

  const view = parseView(raw, bad);
  if (problems.length) throw new DiagramError(problems);

  const diagram: Diagram = {
    id: id(dgm.id ?? 'diagram', 'diagram.id') ?? 'diagram',
    direction: dirRaw as Diagram['direction'],
    edgeLabels: dgm.edgeLabels === true,
    nodes, groups, flows, events, view,
    animation: { autoplay: an.autoplay !== false, loop: an.loop !== false, speed },
  };
  buildTimeline(diagram); // surfaces dependency cycles
  return diagram;
}
