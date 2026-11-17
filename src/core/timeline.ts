import type { RowSpec } from '../story/types';
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
    const preds = e.after.map((id) => done.get(id)!);
    // A dependency is "not taken" if it was skipped or an un-selected branch child.
    const blocked = e.after.map((id, i) => {
      const p = preds[i]!;
      if (p.skipped) return true;
      const pe = d.events.find((x) => x.id === id)!;
      return pe.type === 'branch' && !pe.select.includes(e.id);
    });
    const skipped = e.after.length > 0 && (e.type === 'join' ? blocked.every(Boolean) : blocked.some(Boolean));
    const live = preds.filter((_, i) => !blocked[i]);
    const start = skipped ? 0 : Math.max(0, ...live.map((p) => p.end));
    const dur = e.duration ?? DEFAULT_DURATION[e.type];
    let end = start + dur;
    if (e.type === 'wait' && !skipped) {
      for (const u of e.until) { const p = done.get(u)!; if (!p.skipped) end = Math.max(end, p.end); }
    }
    const flow = e.flow ? flows.get(e.flow) : undefined;
    const item: Item = {
      id: e.id, type: e.type, start: skipped ? 0 : start, end: skipped ? 0 : end, skipped,
      flow: e.flow, from: flow?.from, to: flow?.to, node: e.node,
      label: e.payload ?? flow?.payload, fail: e.fail || undefined,
    };
    done.set(e.id, item);
    items.push(item);
  }

  const live = items.filter((i) => !i.skipped);
  const total = Math.max(0, ...live.map((i) => i.end)) + tail;
  const bounds = new Set<number>([0, total]);
  for (const i of live) { bounds.add(i.start); bounds.add(i.end); }
  return { items, total, boundaries: [...bounds].sort((a, b) => a - b) };
}

const PRIORITY: NodeState[] = ['error', 'processing', 'waiting', 'receiving', 'completed', 'idle'];

/** State of a node at simulated time t (ms). Pure function of the timeline. */
export function nodeStateAt(tl: Timeline, nodeId: string, t: number): NodeState {
  const found = new Set<NodeState>(['idle']);
  for (const i of tl.items) {
    if (i.skipped) continue;
    const active = t >= i.start && t < i.end;
    const finished = t >= i.end;
    if (i.node === nodeId) {
      if ((i.type === 'process' || i.type === 'emit' || i.type === 'light') && active) found.add('processing');
      if (i.type === 'wait' && active) found.add('waiting');
      if (finished && i.fail && i.type === 'process') found.add('error');
      else if (finished && (i.type === 'process' || i.type === 'emit' || i.type === 'complete')) found.add('completed');
    }
    if (i.type === 'transfer' && i.to === nodeId && active) found.add('receiving');
  }
  return PRIORITY.find((s) => found.has(s))!;
}
