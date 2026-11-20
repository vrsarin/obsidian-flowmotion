import { parse as parseYaml } from 'yaml';
import { parseView } from '../core/view';
import { isColor, DiagramError, LINES, type Line } from '../core/types';
import { TONES, type ArrowPresentation, type Beat, type BeatEdge, type NodePresentation, type RowSpec, type Scene, type ScenePresentation, type ShapePresentation, type StoryElement, type Storyboard, type Tone } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9_.>-]{1,64}$/;
const LIM = { elements: 300, beats: 300, rows: 20, text: 500 };

/** Which kind of definition is this? (storyboards have a top-level `scenes`). */
export function detectKind(source: string): 'diagram' | 'storyboard' {
  try { const r: unknown = parseYaml(source, { maxAliasCount: 20 }); return isObj(r) && 'scenes' in r ? 'storyboard' : 'diagram'; }
  catch { return 'diagram'; }
}

type Bad = (message: string) => void;
type Category = 'nodes' | 'groups' | 'arrows';
const CATEGORIES: Category[] = ['nodes', 'groups', 'arrows'];
const PRESENTATION_KEYS: Record<Category, readonly string[]> = {
  nodes: ['visible', 'opacity', 'fill', 'stroke', 'highlight'],
  groups: ['visible', 'opacity', 'fill', 'stroke'],
  arrows: ['visible', 'opacity', 'color', 'arrowheads', 'packet', 'highlight'],
};

class StoryParser {
  private readonly problems: string[] = [];
  private readonly elements: StoryElement[] = [];
  private readonly byId = new Map<string, StoryElement>();
  private beatCount = 0;
  private readonly bad: Bad = (message) => { if (this.problems.length < 30) this.problems.push(message); };

  parse(source: string): Storyboard {
    let raw: unknown;
    try { raw = parseYaml(source, { maxAliasCount: 20, strict: true }); }
    catch (e) { throw new DiagramError([`YAML error: ${(e as Error).message.split('\n')[0]}`]); }
    if (!isObj(raw)) throw new DiagramError(['Definition must be a mapping with elements and scenes.']);
    const rawEls = this.arr(raw.elements, 'elements');
    if (rawEls.length > LIM.elements) throw new DiagramError([`elements: at most ${LIM.elements}`]);
    rawEls.forEach((e, i) => this.element(e, i));
    for (const e of this.elements) this.byId.set(e.id, e);
    this.validateElements();
    const scenes = this.arr(raw.scenes, 'scenes').map((s, i) => this.scene(s, i)).filter((s): s is Scene => s !== undefined);
    if (scenes.length === 0) this.bad('scenes: define at least one scene');
    const speed = raw.speed === undefined ? 2200 : Number(raw.speed);
    if (!(speed >= 300 && speed <= 20000)) this.bad('speed: default beat length 300-20000 ms');
    const view = parseView(raw, this.bad);
    if (this.problems.length) throw new DiagramError(this.problems);
    const title = this.txt(raw.title, 'title') ?? 'storyboard';
    return { id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'storyboard', title, speed, elements: this.elements, scenes, view };
  }

  private txt(v: unknown, where: string): string | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' && typeof v !== 'number') { this.bad(`${where}: must be text`); return undefined; }
    const s = String(v);
    if (s.length > LIM.text) { this.bad(`${where}: longer than ${LIM.text} characters`); return undefined; }
    return s;
  }

  private idOf(v: unknown, where: string) {
    const s = this.txt(v, where);
    if (s === undefined) { this.bad(`${where}: required`); return undefined; }
    if (!ID.test(s)) { this.bad(`${where}: "${s}" has unsupported characters`); return undefined; }
    return s;
  }

  private arr(v: unknown, where: string): unknown[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { this.bad(`${where}: must be a list`); return []; }
    return v;
  }

  private element(e: unknown, i: number) {
    const w = `elements[${i}]`;
    if (!isObj(e)) return this.bad(`${w}: must be a mapping`);
    const id = this.idOf(e.id, `${w}.id`);
    const type = String(e.type) as StoryElement['type'];
    if (!['rectangle', 'cylinder', 'group', 'arrow'].includes(type)) return this.bad(`${w}.type: "${String(e.type)}" unsupported`);
    if (!id) return;
    const el: StoryElement = { id, type };
    if (type === 'rectangle' || type === 'cylinder') this.card(e, el, w);
    else if (type === 'group') this.group(e, el, w);
    else this.arrow(e, el, w);
    this.elements.push(el);
  }

  private card(e: Obj, el: StoryElement, w: string) {
    for (const c of this.arr(e.content, `${w}.content`)) {
      if (!isObj(c)) continue;
      switch (c.type) {
        case 'title': el.title = this.txt(c.text, `${w}.content.title`); break;
        case 'subtitle': el.subtitle = this.txt(c.text, `${w}.content.subtitle`); break;
      }
    }
    if (el.title === undefined) this.bad(`${w}: card needs a title`);
    for (const k of ['width', 'minCardHeight'] as const) if (e[k] !== undefined) {
      if (typeof e[k] !== 'number' || !(e[k] >= 0 && e[k] <= 2000)) this.bad(`${w}.${k}: number 0-2000`);
      else el[k] = e[k];
    }
  }

  private group(e: Obj, el: StoryElement, w: string) {
    el.groupLabel = isObj(e.label) ? this.txt(e.label.title, `${w}.label.title`) : undefined;
    el.children = this.arr(e.children, `${w}.children`).map((c, j) => this.idOf(c, `${w}.children[${j}]`)).filter((x): x is string => !!x);
    const l = isObj(e.layout) ? e.layout : {};
    el.direction = l.direction === 'row' ? 'row' : 'column';
    el.gap = typeof l.gap === 'number' && l.gap >= 0 && l.gap <= 400 ? l.gap : 12;
    el.align = 'stretch';
    if (l.align === 'center' || l.align === 'start') el.align = l.align;
  }

  private arrow(e: Obj, el: StoryElement, w: string) {
    el.start = isObj(e.start) ? this.idOf(e.start.id, `${w}.start.id`) : this.idOf(undefined, `${w}.start`);
    el.end = isObj(e.end) ? this.idOf(e.end.id, `${w}.end.id`) : this.idOf(undefined, `${w}.end`);
    el.label = isObj(e.label) ? this.txt(e.label.text, `${w}.label.text`) : undefined;
    el.quiet = e.quiet === true;
    if (e.line !== undefined) {
      if (typeof e.line !== 'string' || !(LINES as readonly string[]).includes(e.line)) this.bad(`${w}.line: use solid, dotted, or thick`);
      else el.line = e.line as Line;
    }
  }

  private isShape(id: string) {
    return ['rectangle', 'cylinder', 'group'].includes(this.byId.get(id)?.type ?? '');
  }

  private validateReferences(e: StoryElement) {
    if (e.type === 'group') for (const c of e.children!) if (!this.isShape(c)) this.bad(`group "${e.id}": unknown child "${c}"`);
    if (e.type === 'arrow') for (const k of [e.start, e.end]) if (k && !this.isShape(k)) this.bad(`arrow "${e.id}": unknown element "${k}"`);
  }

  private validateElements() {
    if (this.byId.size !== this.elements.length) this.bad('elements: duplicate ids');
    this.elements.forEach((e) => this.validateReferences(e));
    const parents = new Map<string, string>();
    for (const e of this.elements) if (e.type === 'group') for (const c of e.children!) {
      if (parents.has(c)) this.bad(`element "${c}" is in two groups`);
      parents.set(c, e.id);
    }
    const roots = this.elements.filter((e) => e.type !== 'arrow' && !parents.has(e.id));
    if (roots.length !== 1) this.bad(`elements: exactly one top-level element expected, found ${roots.length}`);
    this.validateNesting(parents);
  }

  private validateNesting(parents: Map<string, string>) {
    for (const e of this.elements) {
      let c = e.id, n = 0;
      while (parents.has(c) && n++ < 100) c = parents.get(c)!;
      if (n >= 100) { this.bad('group nesting cycle'); break; }
    }
  }

  private row(r: unknown, where: string): RowSpec | undefined {
    if (!isObj(r)) { this.bad(`${where}: must be a mapping`); return undefined; }
    const tone = (TONES as string[]).includes(String(r.tone)) ? (r.tone as Tone) : 'gray';
    if (r.type === 'graph') {
      const names = this.arr(r.nodes, `${where}.nodes`).map(String).slice(0, 12);
      const links = this.arr(r.links, `${where}.links`).filter((l): l is [unknown, unknown] => Array.isArray(l) && l.length === 2).map((l): [string, string] => [String(l[0]), String(l[1])]);
      return { kind: 'graph', tone, nodes: names, links, lit: this.arr(r.lit, `${where}.lit`).map(String) };
    }
    return { kind: 'row', tone, tag: this.txt(r.tag, `${where}.tag`), text: this.txt(r.text, `${where}.text`), meta: this.txt(r.meta, `${where}.meta`), mark: this.txt(r.mark, `${where}.mark`), mono: r.mono === true };
  }

  private keys(v: Obj, allowed: readonly string[], path: string) {
    for (const key of Object.keys(v)) if (!allowed.includes(key)) this.bad(`${path}.${key}: unknown property`);
  }

  private booleanProperties(v: Obj, kind: Category, path: string, result: NodePresentation & ArrowPresentation) {
    for (const key of ['visible', 'highlight', 'packet'] as const) if (PRESENTATION_KEYS[kind].includes(key) && v[key] !== undefined) {
      if (typeof v[key] !== 'boolean') this.bad(`${path}.${key}: must be true or false`);
      else result[key] = v[key];
    }
  }

  private colorProperties(v: Obj, kind: Category, path: string, result: NodePresentation & ArrowPresentation) {
    for (const key of ['fill', 'stroke', 'color'] as const) if (PRESENTATION_KEYS[kind].includes(key) && v[key] !== undefined) {
      if (typeof v[key] !== 'string' || !isColor(v[key])) this.bad(`${path}.${key}: invalid color`);
      else result[key] = v[key];
    }
  }

  private properties(v: unknown, kind: Category, path: string): NodePresentation & ArrowPresentation {
    if (!isObj(v)) { this.bad(`${path}: must be a mapping`); return {}; }
    this.keys(v, PRESENTATION_KEYS[kind], path);
    const result: NodePresentation & ArrowPresentation = {};
    this.booleanProperties(v, kind, path, result);
    if (v.opacity !== undefined) {
      if (typeof v.opacity !== 'number' || !Number.isFinite(v.opacity) || v.opacity < 0 || v.opacity > 1) this.bad(`${path}.opacity: number 0-1`);
      else result.opacity = v.opacity;
    }
    this.colorProperties(v, kind, path, result);
    if (kind === 'arrows' && v.arrowheads !== undefined) {
      if (v.arrowheads !== 'start' && v.arrowheads !== 'end' && v.arrowheads !== 'both' && v.arrowheads !== 'none') this.bad(`${path}.arrowheads: use start, end, both, or none`);
      else result.arrowheads = v.arrowheads;
    }
    return result;
  }

  private presentation(value: unknown, where: string): ScenePresentation | undefined {
    if (value === undefined) return undefined;
    if (!isObj(value)) { this.bad(`${where}: must be a mapping`); return undefined; }
    this.keys(value, ['defaults', ...CATEGORIES], where);
    const result: ScenePresentation = {};
    if (value.defaults !== undefined) this.presentationDefaults(value.defaults, where, result);
    for (const kind of CATEGORIES) if (value[kind] !== undefined) {
      result[kind] = this.presentationEntries(value[kind], kind, where);
    }
    return result;
  }

  private presentationDefaults(value: unknown, where: string, result: ScenePresentation) {
    if (!isObj(value)) { this.bad(`${where}.defaults: must be a mapping`); return; }
    this.keys(value, CATEGORIES, `${where}.defaults`);
    result.defaults = {};
    for (const kind of CATEGORIES) if (value[kind] !== undefined) {
      result.defaults[kind] = this.properties(value[kind], kind, `${where}.defaults.${kind}`);
    }
  }

  private matchesCategory(kind: Category, element: StoryElement | undefined) {
    if (kind === 'arrows') return element?.type === 'arrow';
    if (kind === 'groups') return element?.type === 'group';
    return element?.type === 'rectangle' || element?.type === 'cylinder';
  }

  private presentationEntries(entries: unknown, kind: Category, where: string) {
    if (!isObj(entries)) { this.bad(`${where}.${kind}: must be a mapping`); return undefined; }
    const mapped: Record<string, ShapePresentation & ArrowPresentation> = {};
    for (const [id, settings] of Object.entries(entries)) {
      if (!this.matchesCategory(kind, this.byId.get(id))) {
        this.bad(`${where}.${kind}.${id}: unknown ${kind.slice(0, -1)} "${id}"`); continue;
      }
      mapped[id] = this.properties(settings, kind, `${where}.${kind}.${id}`);
    }
    return mapped;
  }

  private scene(s: unknown, si: number): Scene | undefined {
    const w = `scenes[${si}]`;
    if (!isObj(s)) { this.bad(`${w}: must be a mapping`); return undefined; }
    const beats = this.arr(s.beats, `${w}.beats`).map((b, bi) => this.beat(b, `${w}.beats[${bi}]`)).filter((b): b is Beat => b !== undefined);
    if (beats.length === 0) this.bad(`${w}: needs beats`);
    return { label: this.txt(s.label, `${w}.label`) ?? `scene ${si + 1}`, beats, presentation: this.presentation(s.presentation, `${w}.presentation`) };
  }

  private beat(b: unknown, w: string): Beat | undefined {
    if (!isObj(b)) { this.bad(`${w}: must be a mapping`); return undefined; }
    if (++this.beatCount > LIM.beats) { this.bad(`at most ${LIM.beats} beats`); return undefined; }
    const edges = this.beatEdges(b.edges, w);
    const show = this.beatRows(b.show, w);
    const light = this.arr(b.light, `${w}.light`).map(String);
    for (const l of light) if (!this.isShape(l)) this.bad(`${w}.light: unknown element "${l}"`);
    const ms = b.ms === undefined ? undefined : Number(b.ms);
    if (ms !== undefined && !(ms >= 200 && ms <= 60000)) this.bad(`${w}.ms: 200-60000`);
    return { edges, show, light, say: this.txt(b.say, `${w}.say`) ?? '', ms };
  }

  private beatEdges(value: unknown, w: string): BeatEdge[] {
    const edges: BeatEdge[] = [];
    let es: unknown[] = [];
    if (value !== undefined) es = Array.isArray(value) ? value : [value];
    es.forEach((x, j) => {
      let name = '';
      if (typeof x === 'string') name = x;
      else if (isObj(x)) name = String(x.edge);
      if (this.byId.get(name)?.type !== 'arrow') return this.bad(`${w}.edges[${j}]: unknown arrow "${name}"`);
      edges.push({ edge: name, data: isObj(x) ? this.txt(x.data, `${w}.edges[${j}].data`) : undefined, back: isObj(x) && x.back === true });
    });
    return edges;
  }

  private beatRows(value: unknown, w: string): Beat['show'] {
    const show: Beat['show'] = {};
    if (!isObj(value)) return show;
    for (const [nid, rows] of Object.entries(value)) {
      if (!this.isShape(nid) || this.byId.get(nid)!.type === 'group') { this.bad(`${w}.show: unknown card "${nid}"`); continue; }
      const list = this.arr(rows, `${w}.show.${nid}`);
      if (list.length > LIM.rows) { this.bad(`${w}.show.${nid}: at most ${LIM.rows} rows`); continue; }
      show[nid] = list.map((r, k) => this.row(r, `${w}.show.${nid}[${k}]`)).filter((r): r is RowSpec => !!r);
    }
    return show;
  }
}

export function parseStoryboard(source: string): Storyboard {
  return new StoryParser().parse(source);
}
