import { parseDiagram } from './core/parse';
import { buildTimeline } from './core/timeline';
import { layoutDiagram } from './layout/elk';
import { layoutStory } from './layout/flex';
import type { Model } from './render/model';
import { isTextSource, parseText } from './text/parse';
import { pathFromPoints } from './core/geometry';
import { sanitizeSvg, svgEdgeRoutes } from './drawio/sanitize';
import { importDrawio } from './drawio/import';
import { isDrawioSource } from './drawio/parse';
import { detectKind, parseStoryboard } from './story/parse';
import { buildStoryTimeline } from './story/timeline';

export type { Model };
/** Draw.io's SVG export leaves a half-pixel gutter. */
const DRAWN_SHIFT = 0;
async function buildDrawioModel(source: string): Promise<Model> {
  const d = await importDrawio(source);
  const layout = await layoutDiagram(d);
  const base = { id: d.id, animation: d.animation, timeline: buildTimeline(d), view: d.view };
  const drawn = /data-cell-id=/.test(source) ? sanitizeSvg(source, 'fmbd') : undefined;
  if (!drawn || !d.fixed?.offset || !layout.origin) return { ...base, layout };
  // SVG coordinates + offset = diagram coordinates; minus the layout origin = layout coordinates.
  const ox = d.fixed.offset.x - layout.origin.x + DRAWN_SHIFT, oy = d.fixed.offset.y - layout.origin.y + DRAWN_SHIFT;
  const routes = svgEdgeRoutes(source);
  for (const e of layout.edges) {
    const cell = d.fixed.edgeCell?.[e.id], pts = cell ? routes.get(cell) : undefined;
    if (pts && pts.length >= 2) e.path = pathFromPoints(pts.map((q) => ({ x: q.x + ox, y: q.y + oy })));
  }
  return { ...base, layout, backdrop: { inner: drawn.inner, rootId: drawn.rootId, w: drawn.w, h: drawn.h, ox, oy } };
}

/** YAML text -> renderable model (parse, validate, layout, schedule). Throws DiagramError on invalid input.
 *  Accepts both event diagrams (nodes/flows/events) and storyboards (elements/scenes). */
export async function buildModel(source: string): Promise<Model> {
  if (isDrawioSource(source)) return buildDrawioModel(source);
  if (!isTextSource(source) && detectKind(source) === 'storyboard') {
    const sb = parseStoryboard(source);
    return { id: sb.id, animation: { autoplay: true, loop: true, speed: 1 }, layout: layoutStory(sb), timeline: buildStoryTimeline(sb), view: sb.view };
  }
  const d = isTextSource(source) ? parseText(source) : parseDiagram(source);
  return { id: d.id, animation: d.animation, layout: await layoutDiagram(d), timeline: buildTimeline(d), view: d.view };
}
