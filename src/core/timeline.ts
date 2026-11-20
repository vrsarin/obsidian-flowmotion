import type { RowSpec, ScenePresentation } from '../story/types';
import { DiagramError, type Diagram, type EventDef, type NodeState } from './types';

export interface Item {
  id: string;
  type: EventDef['type'] | 'show' | 'light' | 'caption';
  start: number;
  end: number;
  skipped: boolean;
  flow?: string;
  from?: string;
  to?: string;
  node?: string;
  label?: string;
  fail?: boolean;
  /** transfer plays from `to` back to `from` along the connector. */
  back?: boolean;
  /** transfer: connector stays highlighted until this time. */
  until?: number;
  /** show: rows displayed in `node` (replaces earlier rows). */
  rows?: RowSpec[];
  /** caption: step label such as "retain() · 3/10". */
  step?: string;
}
export interface Timeline {
  items: Item[];
  /** Storyboard scene presentation, including the final playback tail. */
  scenes?: { start: number; end: number; presentation?: ScenePresentation }[];
  /** Length of one loop cycle in ms (last event end + tail). */
  total: number;
  /** Sorted unique times at which something starts or ends (for stepping). */
  boundaries: number[];
}

const DEFAULT_DURATION: Record<EventDef['type'], number> = {
  transfer: 1500, process: 1200, wait: 0, emit: 600, complete: 0, branch: 0, fork: 0, join: 0,
};

/** Kahn topological order over after/until; throws DiagramError on cycles. */
function order(events: EventDef[]): EventDef[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const deps = (e: EventDef) => [...e.after, ...e.until];
  const indeg = new Map(events.map((e) => [e.id, deps(e).length]));
  const children = new Map<string, string[]>();
  for (const e of events) for (const d of deps(e)) (children.get(d) ?? children.set(d, []).get(d)!).push(e.id);
  const queue = events.filter((e) => indeg.get(e.id) === 0).map((e) => e.id);
  const out: EventDef[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const c of children.get(id) ?? []) {
      const n = indeg.get(c)! - 1;
      indeg.set(c, n);
      if (n === 0) queue.push(c);
    }
  }
  if (out.length !== events.length) {
    const stuck = events.filter((e) => !out.includes(e)).map((e) => e.id);
    throw new DiagramError([`events: dependency cycle involving ${stuck.join(', ')} (use separate events for each loop iteration)`]);
  }
  return out;
}

export function buildTimeline(d: Diagram, tail = 800): Timeline {
  const flows = new Map(d.flows.map((f) => [f.id, f]));
  const done = new Map<string, Item>();
  const items: Item[] = [];

  for (const e of order(d.events)) {
    const item = itemForEvent(e, d.events, done, flows);
    done.set(e.id, item);
    items.push(item);
  }

  const live = items.filter((i) => !i.skipped);
  const total = Math.max(0, ...live.map((i) => i.end)) + tail;
  const bounds = new Set<number>([0, total]);
  for (const i of live) { bounds.add(i.start); bounds.add(i.end); }
  return { items, total, boundaries: [...bounds].sort((a, b) => a - b) };
}

function itemForEvent(e: EventDef, events: EventDef[], done: Map<string, Item>, flows: Map<string, Diagram['flows'][number]>): Item {
  const blocked = e.after.map((id) => isBlockedDependency(id, e.id, events, done));
  const skipped = e.after.length > 0 && (e.type === 'join' ? blocked.every(Boolean) : blocked.some(Boolean));
  const liveEnds = e.after.filter((_, i) => !blocked[i]).map((id) => done.get(id)!.end);
  const start = skipped ? 0 : Math.max(0, ...liveEnds);
  const end = eventEnd(e, skipped, start, done);
  const flow = e.flow ? flows.get(e.flow) : undefined;
  return {
    id: e.id, type: e.type, start: skipped ? 0 : start, end: skipped ? 0 : end, skipped,
    flow: e.flow, from: flow?.from, to: flow?.to, node: e.node,
    label: e.payload ?? flow?.payload, fail: e.fail || undefined,
  };
}

function isBlockedDependency(id: string, eventId: string, events: EventDef[], done: Map<string, Item>): boolean {
  if (done.get(id)!.skipped) return true;
  const predecessor = events.find((event) => event.id === id)!;
  return predecessor.type === 'branch' && !predecessor.select.includes(eventId);
}

function eventEnd(e: EventDef, skipped: boolean, start: number, done: Map<string, Item>): number {
  let end = start + (e.duration ?? DEFAULT_DURATION[e.type]);
  if (e.type !== 'wait' || skipped) return end;
  for (const id of e.until) {
    const predecessor = done.get(id)!;
    if (!predecessor.skipped) end = Math.max(end, predecessor.end);
  }
  return end;
}

const PRIORITY: NodeState[] = ['error', 'processing', 'waiting', 'receiving', 'completed', 'idle'];

/** State of a node at simulated time t (ms). Pure function of the timeline. */
export function nodeStateAt(tl: Timeline, nodeId: string, t: number): NodeState {
  const found = new Set<NodeState>(['idle']);
  for (const i of tl.items) {
    if (i.skipped) continue;
    addNodeState(found, i, nodeId, t);
    addTransferState(found, i, nodeId, t);
  }
  return PRIORITY.find((s) => found.has(s))!;
}

function addNodeState(found: Set<NodeState>, item: Item, nodeId: string, time: number): void {
  if (item.node !== nodeId) return;
  const active = time >= item.start && time < item.end;
  const finished = time >= item.end;
  if (active && ['process', 'emit', 'light'].includes(item.type)) found.add('processing');
  if (active && item.type === 'wait') found.add('waiting');
  if (finished && item.fail && item.type === 'process') found.add('error');
  else if (finished && ['process', 'emit', 'complete'].includes(item.type)) found.add('completed');
}

function addTransferState(found: Set<NodeState>, item: Item, nodeId: string, time: number): void {
  if (item.type === 'transfer' && item.to === nodeId && time >= item.start && time < item.end) found.add('receiving');
}
