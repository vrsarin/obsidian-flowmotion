import type { Item, Timeline } from '../core/timeline';
import type { Storyboard } from './types';

/** Compile beats into the same Timeline structure the engine already plays. */
export function buildStoryTimeline(sb: Storyboard, tail = 1200): Timeline {
  const arrows = new Map(sb.elements.filter((e) => e.type === 'arrow').map((e) => [e.id, e]));
  const items: Item[] = [];
  const shows: Item[] = [], caps: Item[] = [];
  const marks = new Set<number>([0]);
  let t = 0, n = 0;
  for (const sc of sb.scenes) {
    sc.beats.forEach((b, k) => {
      const dur = b.ms ?? sb.speed;
      const travel = b.edges.length ? Math.min(1200, dur * 0.45) : 0;
      const cap: Item = { id: `b${n}.c`, type: 'caption', start: t, end: 0, skipped: false, label: b.say, step: `${sc.label} · ${k + 1}/${sc.beats.length}` };
      caps.push(cap); items.push(cap);
      b.edges.forEach((e, j) => {
        const a = arrows.get(e.edge)!;
        items.push({ id: `b${n}.e${j}`, type: 'transfer', start: t, end: t + travel, skipped: false, flow: e.edge,
          from: e.back ? a.end : a.start, to: e.back ? a.start : a.end, label: e.data, back: e.back || undefined, until: t + dur });
      });
      for (const l of b.light) items.push({ id: `b${n}.l.${l}`, type: 'light', node: l, start: t, end: t + dur, skipped: false });
      for (const [node, rows] of Object.entries(b.show)) {
        const s: Item = { id: `b${n}.s.${node}`, type: 'show', node, start: t + (travel || Math.min(250, dur)), end: 0, skipped: false, rows };
        shows.push(s); items.push(s); marks.add(s.start);
      }
      marks.add(t); marks.add(t + travel); t += dur; n++;
    });
  }
  const total = t + tail;
  const chain = (list: Item[], key: (i: Item) => string) => {
    const next = new Map<string, Item>();
    for (const i of [...list].reverse()) { i.end = next.get(key(i))?.start ?? total + 1; next.set(key(i), i); }
  };
  chain(shows, (i) => i.node!);
  chain(caps, () => 'cap');
  marks.add(total);
  return { items, total, boundaries: [...marks].sort((a, b) => a - b) };
}
