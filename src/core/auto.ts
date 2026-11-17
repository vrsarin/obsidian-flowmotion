import type { EventDef, FlowDef } from './types';

/**
 * Default animation for a graph with no explicit `events`: every node runs once, every flow carries one packet.
 * A node starts after all packets arrive; a packet leaves when its source node is done.
 * Back edges (loops) stay drawn but are not scheduled, so cyclic graphs still play.
 */
export function deriveEvents(
  nodeIds: string[], flows: FlowDef[],
  opts: { duration?: Map<string, number>; fail?: Set<string> } = {},
): EventDef[] {
  const events: EventDef[] = [];
  const ev = (e: Partial<EventDef> & Pick<EventDef, 'id' | 'type'>) => { events.push({ after: [], until: [], select: [], fail: false, ...e }); };

  const out = new Map<string, number[]>();
  flows.forEach((f, i) => (out.get(f.from) ?? out.set(f.from, []).get(f.from)!).push(i));
  const indeg = new Set(flows.map((f) => f.to));
  const roots = [...nodeIds.filter((n) => !indeg.has(n)), ...nodeIds];
  const state = new Map<string, 1 | 2>(); // 1 = on the DFS stack, 2 = finished
  const forward = new Set<number>();
  const visit = (n: string) => {
    state.set(n, 1);
    for (const i of out.get(n) ?? []) {
      const to = flows[i]!.to, st = state.get(to);
      if (st === 1) continue; // back edge
      forward.add(i);
      if (!st) visit(to);
    }
    state.set(n, 2);
  };
  for (const r of roots) if (!state.has(r)) visit(r);

  const incoming = new Map<string, string[]>();
  flows.forEach((f, i) => { if (forward.has(i)) (incoming.get(f.to) ?? incoming.set(f.to, []).get(f.to)!).push(`t_${f.id}`); });
  for (const n of nodeIds) ev({ id: `p_${n}`, type: 'process', node: n, after: incoming.get(n) ?? [], duration: opts.duration?.get(n), fail: opts.fail?.has(n) ?? false });
  flows.forEach((f, i) => { if (forward.has(i)) ev({ id: `t_${f.id}`, type: 'transfer', flow: f.id, after: [`p_${f.from}`] }); });
  return events;
}
