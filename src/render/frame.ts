import { nodeStateAt, type Item } from '../core/timeline';
import { pointAt, type Pt } from '../core/geometry';
import type { NodeState } from '../core/types';
import type { Model } from './model';
import { arrowPresentation, nodePresentation, presentationAt } from './presentation';
import type { ScenePresentation } from '../story/types';

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
  presentation?: ScenePresentation;
}

function addShow(frame: Frame, item: Item, time: number): void {
  if (time >= item.start && time < item.end + FADE) {
    frame.shows[item.id] = Math.min(1, (time - item.start) / FADE);
  }
}

function addCaption(frame: Frame, item: Item, time: number): void {
  if (time >= item.start && time < item.end) frame.captions[item.id] = true;
}

function addActiveTransfer(frame: Frame, item: Item, time: number): void {
  if (item.type !== 'transfer' || !item.flow || item.until === undefined || time < item.start || time >= item.until) return;
  if (arrowPresentation(frame.presentation, item.flow).highlight !== false) frame.edges[item.flow] = true;
}

function addTimedVisual(frame: Frame, model: Model, item: Item, time: number): void {
  if (time < item.start || time >= item.end) return;
  const progress = (time - item.start) / (item.end - item.start);
  if (item.type === 'transfer') {
    const edge = model.layout.edges.find((candidate) => candidate.id === item.flow);
    if (edge && arrowPresentation(frame.presentation, edge.id).packet !== false) {
      frame.packets[item.id] = pointAt(edge.path, item.back ? 1 - progress : progress);
    }
  } else if (item.type === 'process' || item.type === 'emit') {
    frame.bars[item.id] = progress;
  }
}

function addTimelineItem(frame: Frame, model: Model, item: Item, time: number): void {
  if (item.skipped) return;
  if (item.type === 'show') {
    addShow(frame, item, time);
    return;
  }
  if (item.type === 'caption') {
    addCaption(frame, item, time);
    return;
  }
  addActiveTransfer(frame, item, time);
  addTimedVisual(frame, model, item, time);
}

/** Pure: the full visual state at simulated time t (ms). Used by the DOM player, the string renderer and tests. */
export function frameAt(m: Model, t: number): Frame {
  const nodes: Frame['nodes'] = {};
  const presentation = presentationAt(m, t);
  for (const n of m.layout.nodes) nodes[n.id] = nodePresentation(presentation, n.id).highlight === false ? 'idle' : nodeStateAt(m.timeline, n.id, t);
  const f: Frame = { nodes, bars: {}, packets: {}, shows: {}, edges: {}, captions: {}, presentation };
  for (const item of m.timeline.items) addTimelineItem(f, m, item, t);
  return f;
}
