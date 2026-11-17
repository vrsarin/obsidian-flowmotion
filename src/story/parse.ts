import { parse as parseYaml } from 'yaml';
import { parseView } from '../core/view';
import { DiagramError } from '../core/types';
import { TONES, type Beat, type BeatEdge, type RowSpec, type Scene, type StoryElement, type Storyboard, type Tone } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9_.>-]{1,64}$/;
const LIM = { elements: 300, beats: 300, rows: 20, text: 500 };

/** Which kind of definition is this? (storyboards have a top-level `scenes`). */
export function detectKind(source: string): 'diagram' | 'storyboard' {
  try { const r: unknown = parseYaml(source, { maxAliasCount: 20 }); return isObj(r) && 'scenes' in r ? 'storyboard' : 'diagram'; }
  catch { return 'diagram'; }
}

export function parseStoryboard(source: string): Storyboard {
  const problems: string[] = [];
  const bad = (m: string) => { if (problems.length < 30) problems.push(m); };
  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 20, strict: true }); }
  catch (e) { throw new DiagramError([`YAML error: ${(e as Error).message.split('\n')[0]}`]); }
  if (!isObj(raw)) throw new DiagramError(['Definition must be a mapping with elements and scenes.']);

  const txt = (v: unknown, where: string): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' && typeof v !== 'number') { bad(`${where}: must be text`); return undefined; }
    const s = String(v);
    if (s.length > LIM.text) { bad(`${where}: longer than ${LIM.text} characters`); return undefined; }
    return s;
  };
  const idOf = (v: unknown, where: string) => {
    const s = txt(v, where);
    if (s === undefined) { bad(`${where}: required`); return undefined; }
    if (!ID.test(s)) { bad(`${where}: "${s}" has unsupported characters`); return undefined; }
    return s;
  };
  const arr = (v: unknown, where: string): unknown[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { bad(`${where}: must be a list`); return []; }
    return v;
  };

  const rawEls = arr(raw.elements, 'elements');
  if (rawEls.length > LIM.elements) throw new DiagramError([`elements: at most ${LIM.elements}`]);
  const elements: StoryElement[] = [];
  rawEls.forEach((e, i) => {
    const w = `elements[${i}]`;
    if (!isObj(e)) return bad(`${w}: must be a mapping`);
    const id = idOf(e.id, `${w}.id`);
    const type = String(e.type) as StoryElement['type'];
    if (!['rectangle', 'cylinder', 'group', 'arrow'].includes(type)) return bad(`${w}.type: "${String(e.type)}" unsupported`);
    if (!id) return;
    const el: StoryElement = { id, type };
    if (type === 'rectangle' || type === 'cylinder') {
      for (const c of arr(e.content, `${w}.content`)) {
        if (!isObj(c)) continue;
        if (c.type === 'title') el.title = txt(c.text, `${w}.content.title`);
        if (c.type === 'subtitle') el.subtitle = txt(c.text, `${w}.content.subtitle`);
      }
      if (el.title === undefined) bad(`${w}: card needs a title`);
      for (const k of ['width', 'minCardHeight'] as const) if (e[k] !== undefined) {
        if (typeof e[k] !== 'number' || !((e[k]) >= 0 && (e[k]) <= 2000)) bad(`${w}.${k}: number 0-2000`); else el[k] = e[k];
      }
    } else if (type === 'group') {
      el.groupLabel = isObj(e.label) ? txt(e.label.title, `${w}.label.title`) : undefined;
      el.children = arr(e.children, `${w}.children`).map((c, j) => idOf(c, `${w}.children[${j}]`)).filter((x): x is string => !!x);
      const l = isObj(e.layout) ? e.layout : {};
      el.direction = l.direction === 'row' ? 'row' : 'column';
      el.gap = typeof l.gap === 'number' && l.gap >= 0 && l.gap <= 400 ? l.gap : 12;
      el.align = l.align === 'center' ? 'center' : l.align === 'start' ? 'start' : 'stretch';
    } else {
      el.start = isObj(e.start) ? idOf(e.start.id, `${w}.start.id`) : idOf(undefined, `${w}.start`);
      el.end = isObj(e.end) ? idOf(e.end.id, `${w}.end.id`) : idOf(undefined, `${w}.end`);
      el.label = isObj(e.label) ? txt(e.label.text, `${w}.label.text`) : undefined;
      el.quiet = e.quiet === true;
    }
    elements.push(el);
  });
  const byId = new Map(elements.map((e) => [e.id, e]));
  if (byId.size !== elements.length) bad('elements: duplicate ids');
  const isShape = (id: string) => ['rectangle', 'cylinder', 'group'].includes(byId.get(id)?.type ?? '');
  for (const e of elements) {
    if (e.type === 'group') for (const c of e.children!) if (!isShape(c)) bad(`group "${e.id}": unknown child "${c}"`);
    if (e.type === 'arrow') for (const k of [e.start, e.end]) if (k && !isShape(k)) bad(`arrow "${e.id}": unknown element "${k}"`);
  }
  const parents = new Map<string, string>();
  for (const e of elements) if (e.type === 'group') for (const c of e.children!) {
    if (parents.has(c)) bad(`element "${c}" is in two groups`);
    parents.set(c, e.id);
  }
  const roots = elements.filter((e) => e.type !== 'arrow' && !parents.has(e.id));
  if (roots.length !== 1) bad(`elements: exactly one top-level element expected, found ${roots.length}`);
  // cycles in group nesting
  for (const e of elements) { let c = e.id, n = 0; while (parents.has(c) && n++ < 100) c = parents.get(c)!; if (n >= 100) { bad('group nesting cycle'); break; } }

  const row = (r: unknown, where: string): RowSpec | undefined => {
    if (!isObj(r)) { bad(`${where}: must be a mapping`); return undefined; }
    const tone = (TONES as string[]).includes(String(r.tone)) ? (r.tone as Tone) : 'gray';
    if (r.type === 'graph') {
      const names = arr(r.nodes, `${where}.nodes`).map(String).slice(0, 12);
      const links = arr(r.links, `${where}.links`).filter((l): l is [string, string] => Array.isArray(l) && l.length === 2).map((l) => [String(l[0]), String(l[1])] as [string, string]);
      return { kind: 'graph', tone, nodes: names, links, lit: arr(r.lit, `${where}.lit`).map(String) };
    }
    return { kind: 'row', tone, tag: txt(r.tag, `${where}.tag`), text: txt(r.text, `${where}.text`), meta: txt(r.meta, `${where}.meta`), mark: txt(r.mark, `${where}.mark`), mono: r.mono === true };
  };

  const scenes: Scene[] = [];
  let beatCount = 0;
  arr(raw.scenes, 'scenes').forEach((s, si) => {
    if (!isObj(s)) return bad(`scenes[${si}]: must be a mapping`);
    const beats: Beat[] = [];
    arr(s.beats, `scenes[${si}].beats`).forEach((b, bi) => {
      const w = `scenes[${si}].beats[${bi}]`;
      if (!isObj(b)) return bad(`${w}: must be a mapping`);
      if (++beatCount > LIM.beats) { bad(`at most ${LIM.beats} beats`); return; }
      const edges: BeatEdge[] = [];
      const es = b.edges === undefined ? [] : Array.isArray(b.edges) ? b.edges : [b.edges];
      es.forEach((x, j) => {
        const name = typeof x === 'string' ? x : isObj(x) ? String(x.edge) : '';
        const a = byId.get(name);
        if (!a || a.type !== 'arrow') return bad(`${w}.edges[${j}]: unknown arrow "${name}"`);
        edges.push({ edge: name, data: isObj(x) ? txt(x.data, `${w}.edges[${j}].data`) : undefined, back: isObj(x) && x.back === true });
      });
      const show: Beat['show'] = {};
      if (isObj(b.show)) for (const [nid, rows] of Object.entries(b.show)) {
        if (!isShape(nid) || byId.get(nid)!.type === 'group') { bad(`${w}.show: unknown card "${nid}"`); continue; }
        const list = arr(rows, `${w}.show.${nid}`);
        if (list.length > LIM.rows) { bad(`${w}.show.${nid}: at most ${LIM.rows} rows`); continue; }
        show[nid] = list.map((r, k) => row(r, `${w}.show.${nid}[${k}]`)).filter((r): r is RowSpec => !!r);
      }
      const light = arr(b.light, `${w}.light`).map(String);
      for (const l of light) if (!isShape(l)) bad(`${w}.light: unknown element "${l}"`);
      const ms = b.ms === undefined ? undefined : Number(b.ms);
      if (ms !== undefined && !(ms >= 200 && ms <= 60000)) bad(`${w}.ms: 200-60000`);
      beats.push({ edges, show, light, say: txt(b.say, `${w}.say`) ?? '', ms });
    });
    if (beats.length === 0) bad(`scenes[${si}]: needs beats`);
    scenes.push({ label: txt(s.label, `scenes[${si}].label`) ?? `scene ${si + 1}`, beats });
  });
  if (scenes.length === 0) bad('scenes: define at least one scene');
  const speed = raw.speed === undefined ? 2200 : Number(raw.speed);
  if (!(speed >= 300 && speed <= 20000)) bad('speed: default beat length 300-20000 ms');
  const view = parseView(raw, bad);
  if (problems.length) throw new DiagramError(problems);
  const title = txt(raw.title, 'title') ?? 'storyboard';
  return { id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'storyboard', title, speed, elements, scenes, view };
}
