import { makePath, pointAt, textWidth } from '../core/geometry';
import { layoutRows } from '../render/rows';
import type { RowSpec, StoryElement, Storyboard } from '../story/types';
import type { LaidEdge, LaidGroup, LaidNode, Layout } from './types';

export const OX = 28, OY = 40, CAP_H = 78;
interface R { x: number; y: number; w: number; h: number }

function storyRows(sb: Storyboard): Map<string, RowSpec[][]> {
  const rowsets = new Map<string, RowSpec[][]>();
  for (const sc of sb.scenes) for (const b of sc.beats) for (const [n, rows] of Object.entries(b.show)) (rowsets.get(n) ?? rowsets.set(n, []).get(n)!).push(rows);
  return rowsets;
}

function storyEdge(e: StoryElement, rect: Map<string, R>): LaidEdge {
  const a = rect.get(e.start!)!, b = rect.get(e.end!)!;
  const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const horizontal = Math.abs(dx) > Math.abs(dy) * 0.8;
  const p1 = horizontal ? { x: dx >= 0 ? a.x + a.w : a.x, y: a.y + a.h / 2 } : { x: a.x + a.w / 2, y: dy >= 0 ? a.y + a.h : a.y };
  const p2 = horizontal ? { x: dx >= 0 ? b.x : b.x + b.w, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: dy >= 0 ? b.y : b.y + b.h };
  const path = makePath([p1, p2], { curve: true, horizontal });
  const mid = pointAt(path, 0.5);
  return { id: e.id, from: e.start!, to: e.end!, path, quiet: e.quiet, line: e.line, label: e.label ? { text: e.label, x: mid.x, y: mid.y - 8 } : undefined };
}

/** Flexbox-like layout for nested groups (row/column, gap, align) with cards sized to their largest content. */
export function layoutStory(sb: Storyboard): Layout {
  const els = new Map(sb.elements.map((e) => [e.id, e]));
  const parents = new Set(sb.elements.flatMap((e) => e.children ?? []));
  const root = sb.elements.find((e) => e.type !== 'arrow' && !parents.has(e.id))!;

  const rowsets = storyRows(sb);

  const isCard = (e: StoryElement) => e.type === 'rectangle' || e.type === 'cylinder';
  const pad = (e: StoryElement) => (e.groupLabel ? 14 : 0);
  const gHead = (e: StoryElement) => (e.groupLabel ? 26 : 0);

  const card = (e: StoryElement, w: number) => {
    const cyl = e.type === 'cylinder';
    const headerH = (cyl ? 20 : 0) + (e.subtitle ? 44 : 30);
    const needed = Math.max(0, ...(rowsets.get(e.id) ?? []).map((r) => layoutRows(r, w - 20).h));
    const contentH = Math.max(e.minCardHeight ?? 0, needed);
    return { headerH, h: headerH + contentH + (cyl ? 14 : 10) };
  };
  const wNat = (id: string): number => {
    const e = els.get(id)!;
    if (isCard(e)) return e.width ?? Math.max(124, textWidth(e.title ?? '', 15) + 40, textWidth(e.subtitle ?? '', 12) + 40);
    const ws = e.children!.map(wNat), gaps = e.gap! * Math.max(0, ws.length - 1);
    const body = e.direction === 'row' ? ws.reduce((a, b) => a + b, 0) + gaps : Math.max(0, ...ws);
    return Math.max(body + 2 * pad(e), e.groupLabel ? textWidth(e.groupLabel, 12) + 32 : 0);
  };

  const W = new Map<string, number>(), H = new Map<string, number>();
  const resolve = (id: string, w: number): number => {
    const e = els.get(id)!;
    W.set(id, w);
    if (isCard(e)) { H.set(id, card(e, w).h); return H.get(id)!; }
    const inner = w - 2 * pad(e);
    const hs = e.children!.map((c) => resolve(c, e.direction === 'column' && e.align === 'stretch' ? inner : wNat(c)));
    const body = e.direction === 'row' ? Math.max(0, ...hs) : hs.reduce((a, b) => a + b, 0) + e.gap! * Math.max(0, hs.length - 1);
    H.set(id, body + 2 * pad(e) + gHead(e));
    return H.get(id)!;
  };
  resolve(root.id, wNat(root.id));

  const rect = new Map<string, R>();
  const place = (id: string, x: number, y: number) => {
    const e = els.get(id)!, w = W.get(id)!, h = H.get(id)!;
    rect.set(id, { x, y, w, h });
    if (isCard(e)) return;
    const x0 = x + pad(e), y0 = y + pad(e) + gHead(e), iw = w - 2 * pad(e), ih = h - 2 * pad(e) - gHead(e);
    if (e.direction === 'column') {
      let cy = y0;
      for (const c of e.children!) {
        const cw = W.get(c)!, cx = e.align === 'center' ? x0 + (iw - cw) / 2 : x0;
        place(c, cx, cy); cy += H.get(c)! + e.gap!;
      }
    } else {
      const total = e.children!.reduce((a, c) => a + W.get(c)!, 0) + e.gap! * Math.max(0, e.children!.length - 1);
      let cx = x0 + (iw - total) / 2;
      for (const c of e.children!) {
        const ch = H.get(c)!;
        place(c, cx, e.align === 'center' ? y0 + (ih - ch) / 2 : y0); cx += W.get(c)! + e.gap!;
      }
    }
  };
  place(root.id, OX, OY);

  const rootR = rect.get(root.id)!;
  const nodes: LaidNode[] = [], groups: LaidGroup[] = [];
  for (const e of sb.elements) {
    const r = rect.get(e.id);
    if (!r) continue;
    if (isCard(e)) nodes.push({ id: e.id, label: e.title ?? e.id, ...r, kind: e.type === 'cylinder' ? 'cylinder' : 'rect', subtitle: e.subtitle, headerH: card(e, r.w).headerH });
    else if (e.type === 'group' && e.groupLabel) groups.push({ id: e.id, label: e.groupLabel, ...r });
  }

  const edges = sb.elements.filter((e) => e.type === 'arrow').map((e) => storyEdge(e, rect));

  const width = rootR.w + 2 * OX;
  const captionY = rootR.y + rootR.h + 26;
  return { width, height: captionY + CAP_H, nodes, groups, edges, story: { headerY: 24, captionY, captionW: width - 2 * OX, captionH: CAP_H, contentTop: OY, contentBottom: rootR.y + rootR.h } };
}
