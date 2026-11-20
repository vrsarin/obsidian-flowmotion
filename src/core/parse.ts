import { plain } from './str';
import { parse as parseYaml } from 'yaml';
import { deriveEvents } from './auto';
import { parseView } from './view';
import { buildTimeline } from './timeline';
import { isColor, DiagramError, ENDS, LIMITS, LINES, SHAPES, type Diagram, type End, type EventDef, type EventType, type FlowDef, type GroupDef, type Line, type NodeDef, type Shape, type Style } from './types';

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const EVENT_TYPES: EventType[] = ['transfer', 'process', 'complete', 'branch', 'fork', 'join', 'wait', 'emit'];
const DIRECTIONS = ['LR', 'RL', 'TB', 'BT'] as const;

type Obj = Record<string, unknown>;
type Bad = (message: string) => void;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Readers {
  str: (value: unknown, where: string, required?: boolean) => string | undefined;
  id: (value: unknown, where: string) => string | undefined;
  list: (value: unknown, where: string) => unknown[];
  idList: (value: unknown, where: string) => string[];
  oneOf: <T extends string>(value: unknown, set: readonly T[], where: string) => T | undefined;
  styleOf: (value: unknown, where: string) => Style | undefined;
}

function createReaders(bad: Bad): Readers {
  const str = (value: unknown, where: string, required = true): string | undefined => {
    if (value === undefined || value === null) {
      if (required) bad(`${where}: required`);
      return undefined;
    }
    if (typeof value !== 'string' && typeof value !== 'number') { bad(`${where}: must be text`); return undefined; }
    const text = String(value);
    if (text.length > LIMITS.label) { bad(`${where}: longer than ${LIMITS.label} characters`); return undefined; }
    return text;
  };
  const id = (value: unknown, where: string) => {
    const text = str(value, where);
    if (text !== undefined && !ID.test(text)) {
      bad(`${where}: "${text}" must match [A-Za-z0-9_.-], max 64 chars`);
      return undefined;
    }
    return text;
  };
  const list = (value: unknown, where: string): unknown[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) { bad(`${where}: must be a list`); return []; }
    return value;
  };
  const idList = (value: unknown, where: string): string[] => {
    const values = typeof value === 'string' ? [value] : list(value, where);
    return values.map((entry, index) => id(entry, `${where}[${index}]`)).filter((entry): entry is string => !!entry);
  };
  const oneOf = <T extends string>(value: unknown, set: readonly T[], where: string): T | undefined => {
    if (value === undefined) return undefined;
    if (!set.includes(value as T)) {
      bad(`${where}: "${plain(value)}" is not one of ${set.join(', ')}`);
      return undefined;
    }
    return value as T;
  };
  const styleOf = (value: unknown, where: string) => parseStyle(value, where, bad);
  return { str, id, list, idList, oneOf, styleOf };
}

function parseStyle(value: unknown, where: string, bad: Bad): Style | undefined {
  if (value === undefined) return undefined;
  if (!isObj(value)) { bad(`${where}: must be a mapping with fill, stroke, color, strokeWidth`); return undefined; }
  const style: Style = {};
  for (const key of Object.keys(value)) parseStyleProperty(style, key, value[key], where, bad);
  return style;
}

function parseStyleProperty(style: Style, key: string, value: unknown, where: string, bad: Bad): void {
  if (key === 'strokeWidth') {
    if (typeof value === 'number' && value >= 0 && value <= 12) style.strokeWidth = value;
    else bad(`${where}.strokeWidth: number between 0 and 12`);
    return;
  }
  if (key === 'fill' || key === 'stroke' || key === 'color') {
    if (typeof value === 'string' && isColor(value.trim())) style[key] = value.trim();
    else bad(`${where}.${key}: a colour such as #2f6fed or red`);
    return;
  }
  bad(`${where}.${key}: not allowed (use fill, stroke, color, strokeWidth)`);
}

interface DiagramSettings { diagram: Obj; direction: string }

function readDiagramSettings(raw: Obj, bad: Bad): DiagramSettings {
  const diagram = isObj(raw.diagram) ? raw.diagram : {};
  if (diagram.edgeLabels !== undefined && typeof diagram.edgeLabels !== 'boolean') bad('diagram.edgeLabels: use true or false');
  const direction = diagram.direction === undefined ? 'LR' : plain(diagram.direction).toUpperCase();
  if (!(DIRECTIONS as readonly string[]).includes(direction)) bad(`diagram.direction: must be one of ${DIRECTIONS.join(', ')}`);
  return { diagram, direction };
}

interface RawLists { nodes: unknown[]; flows: unknown[]; events: unknown[] }

function readRawLists(raw: Obj, readers: Readers, bad: Bad): RawLists {
  const nodes = readers.list(raw.nodes, 'nodes');
  const flows = readers.list(raw.flows, 'flows');
  const events = readers.list(raw.events, 'events');
  if (nodes.length > LIMITS.nodes) bad(`nodes: at most ${LIMITS.nodes}`);
  if (flows.length > LIMITS.flows) bad(`flows: at most ${LIMITS.flows}`);
  if (events.length > LIMITS.events) bad(`events: at most ${LIMITS.events}`);
  return { nodes, flows, events };
}

interface ParsedEntities { nodes: NodeDef[]; groups: GroupDef[]; flows: FlowDef[]; events: EventDef[] }

function parseEntities(raw: Obj, lists: RawLists, readers: Readers, bad: Bad): ParsedEntities {
  const nodes = parseNodes(lists.nodes, readers, bad);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) bad('nodes: duplicate ids');
  const groups = parseGroups(raw.groups, nodes, readers, bad);
  const flows = parseFlows(lists.flows, nodeIds, readers, bad);
  const flowIds = new Set(flows.map((flow) => flow.id));
  if (flowIds.size !== flows.length) bad('flows: duplicate ids');
  const events = parseEvents(lists.events, nodeIds, flowIds, readers, bad, nodes, flows);
  return { nodes, groups, flows, events };
}

function parseYamlSource(source: string): unknown {
  try {
    return parseYaml(source, { maxAliasCount: 20, strict: true });
  } catch (error) {
    throw new DiagramError([`YAML error: ${(error as Error).message.split('\n')[0]}`]);
  }
}

function parseNodes(rawNodes: unknown[], readers: Readers, bad: Bad): NodeDef[] {
  const nodes: NodeDef[] = [];
  rawNodes.forEach((value, index) => {
    if (!isObj(value)) { bad(`nodes[${index}]: must be a mapping`); return; }
    const where = `nodes[${index}]`;
    const id = readers.id(value.id, `${where}.id`);
    const label = readers.str(value.label ?? value.id, `${where}.label`);
    const shape = readers.oneOf<Shape>(value.shape, SHAPES, `${where}.shape`);
    const group = value.group === undefined ? undefined : readers.id(value.group, `${where}.group`);
    const style = readers.styleOf(value.style, `${where}.style`);
    const lines = value.lines === undefined
      ? undefined
      : readers.list(value.lines, `${where}.lines`)
        .map((line, lineIndex) => readers.str(line, `${where}.lines[${lineIndex}]`))
        .filter((line): line is string => line !== undefined);
    if (id && label !== undefined) nodes.push({ id, label, ...(lines?.length && { lines }), ...(shape && { shape }), ...(group && { group }), ...(style && { style }) });
  });
  return nodes;
}

function parseGroups(rawGroups: unknown, nodes: NodeDef[], readers: Readers, bad: Bad): GroupDef[] {
  const groups: GroupDef[] = [];
  readers.list(rawGroups, 'groups').forEach((value, index) => {
    if (!isObj(value)) { bad(`groups[${index}]: must be a mapping`); return; }
    const id = readers.id(value.id, `groups[${index}].id`);
    const label = readers.str(value.label, `groups[${index}].label`, false);
    const parent = value.parent === undefined ? undefined : readers.id(value.parent, `groups[${index}].parent`);
    if (id) groups.push({ id, ...(label !== undefined && { label }), ...(parent && { parent }) });
  });
  const groupIds = new Set(groups.map((group) => group.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (groupIds.size !== groups.length) bad('groups: duplicate ids');
  if (groups.some((group) => nodeIds.has(group.id))) bad('groups: an id cannot be both a group and a node');
  groups.forEach((group, index) => {
    if (group.parent && !groupIds.has(group.parent)) bad(`groups[${index}].parent: unknown group "${group.parent}"`);
  });
  checkGroupCycles(groups, bad);
  nodes.forEach((node, index) => {
    if (node.group && !groupIds.has(node.group)) bad(`nodes[${index}].group: unknown group "${node.group}"`);
  });
  return groups;
}

function checkGroupCycles(groups: GroupDef[], bad: Bad): void {
  for (const group of groups) {
    const seen = new Set<string>();
    let current: GroupDef | undefined = group;
    while (current) {
      if (seen.has(current.id)) {
        bad(`groups: "${group.id}" is nested inside itself`);
        break;
      }
      seen.add(current.id);
      current = groups.find((candidate) => candidate.id === current!.parent);
    }
  }
}

function parseFlows(rawFlows: unknown[], nodeIds: Set<string>, readers: Readers, bad: Bad): FlowDef[] {
  const flows: FlowDef[] = [];
  rawFlows.forEach((value, index) => {
    if (!isObj(value)) { bad(`flows[${index}]: must be a mapping`); return; }
    const where = `flows[${index}]`;
    const id = readers.id(value.id, `${where}.id`);
    const from = readers.id(value.from, `${where}.from`);
    const to = readers.id(value.to, `${where}.to`);
    const payload = readers.str(value.payload, `${where}.payload`, false);
    for (const [key, nodeId] of [['from', from], ['to', to]] as const) {
      if (nodeId && !nodeIds.has(nodeId)) bad(`${where}.${key}: unknown node "${nodeId}"`);
    }
    const line = readers.oneOf<Line>(value.line, LINES, `${where}.line`);
    const head = readers.oneOf<End>(value.head, ENDS, `${where}.head`);
    const tail = readers.oneOf<End>(value.tail, ENDS, `${where}.tail`);
    const style = readers.styleOf(value.style, `${where}.style`);
    const headLabel = readers.str(value.headLabel, `${where}.headLabel`, false);
    const tailLabel = readers.str(value.tailLabel, `${where}.tailLabel`, false);
    if (id && from && to) {
      flows.push({ id, from, to, payload, curve: value.curve === true, ...(headLabel && { headLabel }), ...(tailLabel && { tailLabel }), ...(line && { line }), ...(head && { head }), ...(tail && { tail }), ...(style && { style }) });
    }
  });
  return flows;
}

function parseEvents(rawEvents: unknown[], nodeIds: Set<string>, flowIds: Set<string>, readers: Readers, bad: Bad, nodes: NodeDef[], flows: FlowDef[]): EventDef[] {
  const events: EventDef[] = [];
  const eventAt = new Map<string, number>();
  rawEvents.forEach((value, index) => {
    const where = `events[${index}]`;
    if (!isObj(value)) { bad(`${where}: must be a mapping`); return; }
    const id = readers.id(value.id, `${where}.id`);
    const type = String(value.type) as EventType;
    if (!EVENT_TYPES.includes(type)) { bad(`${where}.type: "${String(value.type)}" is not one of ${EVENT_TYPES.join(', ')}`); return; }
    const flow = value.flow === undefined ? undefined : readers.id(value.flow, `${where}.flow`);
    const node = value.node === undefined ? undefined : readers.id(value.node, `${where}.node`);
    validateEventTarget(type, flow, node, where, flowIds, nodeIds, bad);
    const duration = readDuration(value.duration, where, bad);
    if (id) {
      eventAt.set(id, index);
      events.push({
        id, type, flow, node, payload: readers.str(value.payload, `${where}.payload`, false),
        after: readers.idList(value.after, `${where}.after`), until: readers.idList(value.until, `${where}.until`),
        select: readers.idList(value.select, `${where}.select`), duration, fail: value.fail === true,
      });
    }
  });
  if (rawEvents.length === 0) events.push(...deriveEvents(nodes.map((node) => node.id), flows));
  validateEventReferences(events, eventAt, bad);
  return events;
}

function validateEventTarget(type: EventType, flow: string | undefined, node: string | undefined, where: string, flowIds: Set<string>, nodeIds: Set<string>, bad: Bad): void {
  if (type === 'transfer') {
    if (!flow) bad(`${where}: transfer needs "flow"`);
    else if (!flowIds.has(flow)) bad(`${where}.flow: unknown flow "${flow}"`);
  }
  if (['process', 'emit', 'complete'].includes(type) && !node) bad(`${where}: ${type} needs "node"`);
  if (node && !nodeIds.has(node)) bad(`${where}.node: unknown node "${node}"`);
}

function readDuration(value: unknown, where: string, bad: Bad): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || value < 0 || Number.isNaN(value) || value > LIMITS.duration) {
    bad(`${where}.duration: number of ms between 0 and ${LIMITS.duration}`);
    return undefined;
  }
  return value;
}

function validateEventReferences(events: EventDef[], eventAt: Map<string, number>, bad: Bad): void {
  const eventIds = new Set(events.map((event) => event.id));
  if (eventIds.size !== events.length) bad('events: duplicate ids');
  for (const event of events) {
    for (const key of ['after', 'until', 'select'] as const) {
      event[key].forEach((ref, index) => {
        if (!eventIds.has(ref)) bad(`events[${eventAt.get(event.id)}].${key}[${index}]: unknown event "${ref}"`);
      });
    }
    if (event.type === 'branch') validateBranch(event, events, eventAt, bad);
  }
}

function validateBranch(event: EventDef, events: EventDef[], eventAt: Map<string, number>, bad: Bad): void {
  if (event.select.length === 0) bad(`events[${eventAt.get(event.id)}].select: branch needs "select" (the child events to take)`);
  for (const selected of event.select) {
    const child = events.find((candidate) => candidate.id === selected);
    if (child && !child.after.includes(event.id)) {
      bad(`events[${eventAt.get(event.id)}].select: "${selected}" does not list this branch in "after"`);
    }
  }
}

/** Parse + validate a YAML (or JSON) FlowMotion definition. Input is untrusted. */
export function parseDiagram(source: string): Diagram {
  const problems: string[] = [];
  const bad = (message: string) => problems.push(message);
  const raw = parseYamlSource(source);
  if (!isObj(raw)) throw new DiagramError(['Definition must be a YAML mapping with nodes, flows and events.']);
  const readers = createReaders(bad);
  const { diagram: dgm, direction } = readDiagramSettings(raw, bad);
  const lists = readRawLists(raw, readers, bad);
  if (problems.length) throw new DiagramError(problems);
  if (lists.nodes.length === 0) bad('nodes: define at least one node');
  const { nodes, groups, flows, events } = parseEntities(raw, lists, readers, bad);

  const animation = isObj(raw.animation) ? raw.animation : {};
  const speed = animation.speed === undefined ? 1 : Number(animation.speed);
  if (!(speed >= 0.1 && speed <= 10)) bad('animation.speed: between 0.1 and 10');
  const view = parseView(raw, bad);
  if (problems.length) throw new DiagramError(problems);

  const diagram: Diagram = {
    id: readers.id(dgm.id ?? 'diagram', 'diagram.id') ?? 'diagram',
    direction: direction as Diagram['direction'],
    edgeLabels: dgm.edgeLabels === true,
    nodes, groups, flows, events, view,
    animation: { autoplay: animation.autoplay !== false, loop: animation.loop !== false, speed },
  };
  buildTimeline(diagram);
  return diagram;
}
