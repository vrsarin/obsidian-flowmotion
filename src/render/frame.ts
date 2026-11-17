import { nodeStateAt } from '../core/timeline';
import { pointAt, type Pt } from '../core/geometry';
import type { NodeState } from '../core/types';
import type { Model } from './model';

/** Fade-in time for rows (ms). The previous rows stay underneath until the fade completes. */
export const FADE = 250;

export interface Frame {
  nodes: Record<string, NodeState>;
  /** process item id -> progress 0..1 (only active items) */
  bars: Record<string, number>;
  /** transfer item id -> position on connector (only in-flight packets) */
  packets: Record<string, Pt>;
  /** storyboard: show item id -> opacity */
  shows: Record<string, number>;
  /** storyboard: connector id -> highlighted */
  edges: Record<string, boolean>;
  /** storyboard: caption item id -> visible */
  captions: Record<string, boolean>;
}

/** Pure: the full visual state at simulated time t (ms). Used by the DOM player, the string renderer and tests. */
export function frameAt(m: Model, t: number): Frame {
  const nodes: Frame['nodes'] = {};
  for (const n of m.layout.nodes) nodes[n.id] = nodeStateAt(m.timeline, n.id, t);
  const f: Frame = { nodes, bars: {}, packets: {}, shows: {}, edges: {}, captions: {} };
  for (const i of m.timeline.items) {
    if (i.skipped) continue;
    if (i.type === 'show') {
      if (t >= i.start && t < i.end + FADE) f.shows[i.id] = Math.min(1, (t - i.start) / FADE);
    } else if (i.type === 'caption') {
      if (t >= i.start && t < i.end) f.captions[i.id] = true;
    } else {
      if (i.type === 'transfer' && i.flow && i.until !== undefined && t >= i.start && t < i.until) f.edges[i.flow] = true;
      if (t < i.start || t >= i.end) continue;
      const frac = (t - i.start) / (i.end - i.start);
      if (i.type === 'transfer') {
        const e = m.layout.edges.find((x) => x.id === i.flow);
        if (e) f.packets[i.id] = pointAt(e.path, i.back ? 1 - frac : frac);
      } else if (i.type === 'process' || i.type === 'emit') f.bars[i.id] = frac;
    }
  }
  return f;
}
