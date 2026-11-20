import { deriveEvents } from '../core/auto';
import { parseKind, sniffKind } from './kinds';
import { buildTimeline } from '../core/timeline';
import { isColor, SAFE_HREF, DiagramError, LIMITS, type Diagram, type End, type EventDef, type FlowDef, type GroupDef, type Line, type NodeDef, type Shape, type Style } from '../core/types';

/**
 * Text front end: Mermaid / PlantUML-style definitions compiled to the same `Diagram` model
 * as the YAML format. Animation is derived from the graph, so a diagram pasted from Mermaid
 * or written by an AI plays with no extra work. Optional `%% @...` comments tune it
 * (they are plain comments to Mermaid, so the file stays valid there).
 */

const HEADER = /^\s*(?:flowchart|graph|flow|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|mindmap|gantt)\b/i;
const OTHER_HEADER = /^\s*(?:architecture(?:-beta)?|C4(?:Context|Container|Component|Dynamic|Deployment)|@startuml|@startmindmap|@startgantt)\b/i;

/** True when the source is text-DSL (first meaningful line is a diagram header), not YAML. */
export function isTextSource(source: string): boolean {
  for (const raw of source.split(/\r?\n/)) {
    const l = raw.trim();
    if (l === '---') return false;
    if (!l || l.startsWith('%%')) continue;
    return HEADER.test(l) || OTHER_HEADER.test(l);
  }
  return false;
}

export interface TextProblem { line: number; message: string }
export class TextError extends DiagramError {
  constructor(public readonly located: TextProblem[]) { super(located.map((p) => `line ${p.line}: ${p.message}`)); }
}

const DIR: Record<string, Diagram['direction']> = { LR: 'LR', RL: 'RL', TB: 'TB', TD: 'TB', BT: 'BT' };
// Statements that carry no meaning for animation; accepted so real Mermaid/PlantUML files load.
const IGNORED_WORDS = /^(?:direction|title|accTitle|accDescr|note|activate|deactivate|autonumber|loop|alt|else|opt|par|and|rect)\b/i;
const IGNORED_OTHER = /^(?:critical|break|skinparam|hide|show|header|footer|legend)\b/i;
const IGNORED_DIRECTION = /^(?:left to right direction|top to bottom direction)/i;
const PLANT_KEYWORD = /(participant|actor|component|database|queue|node|entity|boundary|control|collections|rectangle|cloud|interface|usecase|artifact|folder|frame|package|storage|agent|card)/;
const PLANT_ARGUMENT = /("[^"]*"|\S+)/;
const PLANT_DECL = new RegExp(String.raw`^${PLANT_KEYWORD.source}\s+${PLANT_ARGUMENT.source}(?:\s+as\s+${PLANT_ARGUMENT.source})?\s*$`, 'i');
const SEQ_DECL = /^(participant|actor)\b/i;
const ARROW = /^(<)?(?:-\.+-|-+|=+|\.{2,})(>>|>|x|o)?/;
const ID = /^\w+/;

function stripBoundaryUnderscores(value: string): string {
  let start = 0, end = value.length;
  while (value[start] === '_') start++;
  while (end > start && value[end - 1] === '_') end--;
  return value.slice(start, end);
}

function subgraphName(rest: string): { id?: string; title: string } {
  const id = /^\w+/.exec(rest)?.[0];
  const tail = id ? rest.slice(id.length).trimStart() : '';
  if (id && !tail) return { id, title: id };
  if (id && tail.startsWith('[') && tail.endsWith(']')) {
    let inner = tail.slice(1, -1).trimStart();
    if (inner.startsWith('"')) inner = inner.slice(1);
    const quote = inner.indexOf('"');
    const title = quote < 0 ? inner : inner.slice(0, quote);
    if (!title.includes(']') && (quote < 0 || !inner.slice(quote + 1).trim())) return { id, title };
  }
  return { title: /^"([^"]*)"$/.exec(rest)?.[1] ?? rest };
}

function linkStyleParts(s: string): [string, string] | undefined {
  const prefix = /^linkStyle\s+/i.exec(s);
  if (!prefix) return undefined;
  const rest = s.slice(prefix[0].length);
  const defaultMatch = /^default\s+/i.exec(rest);
  if (defaultMatch) {
    const style = rest.slice(defaultMatch[0].length);
    if (style) return ['default', style];
  }
  let end = 0;
  while (end < rest.length && /[,\s\d]/.test(rest[end]!)) end++;
  let separator = Math.min(end, rest.length - 1);
  while (separator > 0 && !/\s/.test(rest[separator]!)) separator--;
  if (separator && separator < rest.length - 1) return [rest.slice(0, separator), rest.slice(separator + 1)];
  return prefix[0].length >= 'linkStyle'.length + 3 && rest ? [prefix[0].slice(-2, -1), rest] : undefined;
}

interface Edge { from: string; to: string; text?: string; line: number; op: string }

/** Opening bracket run -> outline, and the closing run it expects. */
const OPENERS: [string, Shape][] = [['[[', 'subroutine'], ['[(', 'cylinder'], ['([', 'stadium'], ['((', 'circle'], ['{{', 'hexagon'], ['[/', 'parallelogram'], ['[\\', 'parallelogram'], ['[', 'rect'], ['(', 'round'], ['{', 'diamond'], ['>', 'rect']];
const CLOSER: Record<string, string> = { '[': ']', '(': ')', '{': '}', '>': ']', '/': '/', '\\': '\\' };

const num = (v: string) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : undefined; };
/** `fill:#f9f,stroke:#333,stroke-width:4px,color:#fff` -> Style (unknown keys and bad colours are ignored, as Mermaid renderers do). */
function parseStyle(list: string): Style {
  const out: Style = {};
  for (const part of list.split(/,(?![^()]*\))/)) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if ((k === 'fill' || k === 'stroke' || k === 'color') && isColor(v)) out[k] = v;
    else if (k === 'stroke-width') { const n = num(v); if (n !== undefined && n >= 0 && n <= 12) out.strokeWidth = n; }
  }
  return out;
}
const merge = (...ss: (Style | undefined)[]): Style | undefined => {
  const out = Object.assign({}, ...ss.filter(Boolean)) as Style;
  return Object.keys(out).length ? out : undefined;
};


export function parseText(source: string): Diagram {
  const problems: TextProblem[] = [];
  const kind = sniffKind(source);
  if (kind) {
    const d = parseKind(kind, source, problems, []);
    if (problems.length) throw new TextError(problems);
    return d;
  }
  const bad = (line: number, message: string) => { if (problems.length < 30) problems.push({ line, message }); };

  const nodes = new Map<string, NodeDef>();
  const edges: Edge[] = [];
  const opts = { speed: 1, loop: true, autoplay: true };
  const duration = new Map<string, number>();
  const fail = new Set<string>();
  let direction: Diagram['direction'] = 'LR';
  let sequence = false, sawHeader = false, plant = false, plantSeqDecl = false;
  const directives: { line: number; text: string }[] = [];
  const clicks: { line: number; id: string; url?: string; tip?: string }[] = [];
  let lastFan = 1;

  const groups = new Map<string, GroupDef>();
  const stack: string[] = [];
  const classDefs = new Map<string, Style>();
  const nodeClass = new Map<string, string>();
  const nodeStyle = new Map<string, Style>();
  const linkStyles: { line: number; idx: number | 'default'; style: Style }[] = [];

  const declare = (id: string, label?: string, shape?: Shape) => {
    const cur = nodes.get(id);
    if (groups.has(id)) throw new Error(`"${id}" is already a subgraph name.`);
    if (!cur) nodes.set(id, { id, label: (label ?? id).slice(0, LIMITS.label), ...(shape && shape !== 'rect' && { shape }), ...(stack.length && { group: stack.at(-1) }) });
    else {
      if (label !== undefined) cur.label = label.slice(0, LIMITS.label);
      if (shape && shape !== 'rect') cur.shape = shape;
      if (stack.length && !cur.group) cur.group = stack.at(-1);
    }
  };
  const clean = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/^["']|["']$/g, '').replaceAll(String.raw`\n`, ' ').replace(/\s+/g, ' ').trim();

  const lines = source.split(/\r?\n/);
  function header(s: string, ln: number) {
    const h = /^(flowchart|graph|flow|sequenceDiagram|@startuml)\b\s*([a-z]{2})?/i.exec(s);
    if (!h) return bad(ln, 'Start with a header such as "flowchart LR", "sequenceDiagram" or "@startuml".');
    sawHeader = true;
    const kind = h[1]!.toLowerCase();
    sequence = kind === 'sequencediagram';
    plant = kind === '@startuml';
    if (h[2]) {
      const d = DIR[h[2].toUpperCase()];
      if (d) direction = d;
      else bad(ln, `Unknown direction "${h[2]}". Use LR, RL, TB (or TD), BT.`);
    }
  }

  function subgraph(rest: string, ln: number) {
    const parsed = subgraphName(rest);
    if (!rest) return bad(ln, 'Write "subgraph id [Title]" or "subgraph Title".');
    const title = clean(parsed.title);
    const gid = parsed.id ?? (stripBoundaryUnderscores(title.replace(/\W+/g, '_')) || `group${groups.size + 1}`);
    if (groups.has(gid) || nodes.has(gid)) return bad(ln, `"${gid}" is already used by another node or subgraph.`);
    if (groups.size >= LIMITS.nodes) return bad(ln, `At most ${LIMITS.nodes} subgraphs.`);
    groups.set(gid, { id: gid, label: title, ...(stack.length && { parent: stack.at(-1) }) });
    stack.push(gid);
  }

  function styleStatement(s: string, ln: number): boolean {
    const cd = /^classDef\s+(\S+)\s+(.+)$/i.exec(s);
    if (cd) {
      for (const n of cd[1]!.split(',')) classDefs.set(n, merge(classDefs.get(n), parseStyle(cd[2]!)) ?? {});
      return true;
    }
    const cl = /^class\s+(\S+)\s+(\S+)$/i.exec(s);
    if (cl) {
      for (const n of cl[1]!.split(',')) nodeClass.set(n, cl[2]!);
      return true;
    }
    const st = /^style\s+(\S+)\s+(.+)$/i.exec(s);
    if (st) {
      for (const n of st[1]!.split(',')) nodeStyle.set(n, merge(nodeStyle.get(n), parseStyle(st[2]!)) ?? {});
      return true;
    }
    return linkStyleStatement(s, ln);
  }

  function linkStyleStatement(s: string, ln: number): boolean {
    const parts = linkStyleParts(s);
    if (!parts) return false;
    const [indices, styleText] = parts;
    const style = parseStyle(styleText);
    if (indices.toLowerCase() === 'default') linkStyles.push({ line: ln, idx: 'default', style });
    else for (const i of indices.split(',')) {
      if (i.trim()) linkStyles.push({ line: ln, idx: Number(i), style });
    }
    return true;
  }

  function graphStatement(s: string, ln: number): boolean {
    const sg = /^subgraph\b\s*(.*)$/i.exec(s);
    if (sg) { subgraph(sg[1]!.trim(), ln); return true; }
    if (/^end\s*$/i.test(s)) {
      if (!stack.length) bad(ln, '"end" without a matching "subgraph".');
      else stack.pop();
      return true;
    }
    return styleStatement(s, ln);
  }

  function declaration(s: string, ln: number): boolean {
    const decl = PLANT_DECL.exec(s);
    if (decl && !ARROW_AFTER_ID.test(s)) {
      const [, kw, a, b] = decl;
      if (SEQ_DECL.test(kw!)) plantSeqDecl = true;
      const q = (x: string) => x.startsWith('"');
      if (b === undefined) declare(idOf(a!, ln, bad), q(a!) ? clean(a!) : undefined);
      // PlantUML: `participant "Long name" as id`; Mermaid: `participant id as Label`.
      else if (q(a!)) declare(idOf(b, ln, bad), clean(a!));
      else declare(idOf(a!, ln, bad), clean(b));
      return true;
    }
    const bracket = /^\[([^\]]+)\]\s+as\s+(\S+)\s*$/.exec(s);
    if (!bracket) return false;
    declare(bracket[2]!, clean(bracket[1]!));
    return true;
  }

  function ignoredStatement(s: string): boolean {
    if (!IGNORED_WORDS.test(s) && !IGNORED_OTHER.test(s) && !IGNORED_DIRECTION.test(s)) return false;
    const d = /^direction\s+([a-z]{2})\b/i.exec(s);
    if (d && DIR[d[1]!.toUpperCase()] && nodes.size === 0) direction = DIR[d[1]!.toUpperCase()]!;
    return true;
  }

  function parseStatement(s: string, ln: number) {
    try { statement(s, ln); } catch (e) { if (e instanceof Error) bad(ln, e.message); else throw e; }
  }

  function line(raw: string, idx: number) {
    const ln = idx + 1;
    let s = raw.trim();
    if (!s) return;
    if (s.startsWith('%%')) {
      const m = /^%%\s*@(.*)$/.exec(s);
      if (m) directives.push({ line: ln, text: m[1]!.trim() });
      return;
    }
    if (plant && s.startsWith("'")) return;
    s = s.replace(/;\s*$/, '');
    if (!sawHeader) return header(s, ln);
    if (/^@enduml\b/i.test(s)) return;
    if (!sequence && graphStatement(s, ln)) return;
    if (clickStatement(s, ln)) return;
    if (ignoredStatement(s)) return;
    if (declaration(s, ln)) return;
    parseStatement(s, ln);
  }

  function clickStatement(s: string, ln: number): boolean {
    const ck = /^click\s+(\w+)\s+/i.exec(s);
    if (!ck) return false;
    let rest = s.slice(ck[0].length);
    const hrefPrefix = /^href\s+/i.exec(rest);
    if (hrefPrefix) rest = rest.slice(hrefPrefix[0].length);
    const call = /^call\s+\w+(?:\([^)]*\))?/i.exec(rest);
    if (call) rest = rest.slice(call[0].length).trimStart();
    const args: string[] = [];
    for (let i = 0; i < 2 && rest.startsWith('"'); i++) {
      const end = rest.indexOf('"', 1);
      if (end < 0) return false;
      args.push(rest.slice(1, end));
      rest = rest.slice(end + 1).trimStart();
    }
    if (rest && !/^_?(?:blank|self|parent|top)$/i.test(rest)) return false;
    const href = /\bhref\b/i.test(s);
    clicks.push({ line: ln, id: ck[1]!, url: href ? args[0] : undefined, tip: href ? args[1] : args[0] });
    return true;
  }

  lines.forEach((raw, idx) => line(raw, idx));

  // ---- one statement: group (arrow group)+ [: text] ----
  function statement(s: string, ln: number) {
    let pos = 0;
    const ws = () => { while (pos < s.length && /\s/.test(s[pos]!)) pos++; };
    const group = (): string[] => {
      const ids: string[] = [];
      for (;;) {
        ws();
        const m = ID.exec(s.slice(pos));
        if (!m) throw new Error(`Expected a node name near "${s.slice(pos, pos + 12)}".`);
        const id = m[0]; pos += id.length;
        if (groups.has(id)) throw new Error(`"${id}" is a subgraph; connecting to a subgraph is not supported yet. Connect to a node inside it.`);
        const sh = shape();
        const cls = /^:::(\w+)/.exec(s.slice(pos));
        if (cls) { pos += cls[0].length; nodeClass.set(id, cls[1]!); }
        declare(id, sh?.label, sh?.shape);
        ids.push(id);
        ws();
        if (s[pos] === '&') { pos++; continue; }
        return ids;
      }
    };
    const shape = (): { label: string; shape: Shape } | undefined => {
      const rest = s.slice(pos);
      const op = OPENERS.find(([o]) => rest.startsWith(o));
      if (!op) return undefined;
      pos += op[0].length;
      const want = [...op[0]].filter((c) => c !== '/' && c !== '\\').reverse().map((c) => CLOSER[c]!).join('').replace(/[\])}]/g, String.raw`\$&`);
      const closing = String.raw`[/\\]?${want}`;
      let text: string;
      if (s[pos] === '"') {
        const end = s.indexOf('"', pos + 1);
        if (end < 0) throw new Error('Missing closing quote in label.');
        text = s.slice(pos + 1, end); pos = end + 1;
      } else {
        // The label ends at the mirror of the opener, so "A[Run (fast)]" keeps its parentheses.
        const tail = s.slice(pos);
        const re = new RegExp(closing);
        const m = re.exec(tail);
        if (!m) throw new Error(`Missing closing bracket for "${op[0]}".`);
        text = tail.slice(0, m.index); pos += m.index;
      }
      const closeRe = new RegExp(`^${closing}`);
      const close = closeRe.exec(s.slice(pos));
      if (!close) throw new Error(`Missing closing bracket for "${op[0]}".`);
      pos += close[0].length;
      return { label: clean(text), shape: op[1] };
    };

    const edgeLabel = (m: RegExpExecArray): string | undefined => {
      if (s[pos] === '|') { // -->|text|
        const end = s.indexOf('|', pos + 1);
        if (end < 0) throw new Error('Missing closing "|" in edge label.');
        const text = clean(s.slice(pos + 1, end)); pos = end + 1;
        return text;
      }
      if (!m[2] && /^(--|==|-\.)$/.test(m[0]) && pos < s.length && s[pos] !== ':') { // -- text -->
        const rest = s.slice(pos);
        const close = /\s(-{2,}|={2,}|\.-)[>xo]?(?=\s|$)/.exec(rest);
        if (close) {
          const text = clean(rest.slice(0, close.index)); pos += close.index + 1;
          const a = ARROW.exec(s.slice(pos));
          if (a) pos += a[0].length;
          return text;
        }
      }
      return undefined;
    };
    const connect = (left: string[], m: RegExpExecArray): string[] => {
      pos += m[0].length;
      ws();
      const text = edgeLabel(m);
      const right = group();
      const before = edges.length;
      for (const a of left) for (const b of right) {
        if (edges.length >= LIMITS.flows) throw new Error(`At most ${LIMITS.flows} connections.`);
        edges.push({ from: a, to: b, text, line: ln, op: m[0] });
      }
      lastFan = edges.length - before;
      return right;
    };

    let left = group();
    let count = 0;
    for (;;) {
      ws();
      if (pos >= s.length) break;
      if (s[pos] === ':' && !s.startsWith(':::', pos)) {
        const text = clean(s.slice(pos + 1));
        if (!count) throw new Error('Text after ":" needs an arrow before it.');
        for (const e of edges.slice(-lastFan)) e.text = text;
        break;
      }
      const m = ARROW.exec(s.slice(pos));
      if (!m || (m[0].length < 2 && !m[2])) throw new Error(`Expected an arrow such as "-->" or "->>" near "${s.slice(pos, pos + 12)}".`);
      left = connect(left, m);
      count++;
    }
  }

  function finishInput() {
    if (stack.length) bad(lines.length, `Subgraph "${stack.at(-1)}" is never closed with "end".`);
    if (!sawHeader && problems.length === 0) bad(1, 'Empty definition. Start with "flowchart LR".');
    if (nodes.size === 0 && problems.length === 0) bad(1, 'Define at least one node.');
    if (nodes.size > LIMITS.nodes) bad(1, `At most ${LIMITS.nodes} nodes.`);
    if (plant && plantSeqDecl) sequence = true;
  }

  // ---- directives ----
  const known = (id: string) => nodes.has(id);
  function setDuration(line: number, id: string | undefined, value: string | undefined) {
    const ms = Number(value);
    if (!id || !known(id)) bad(line, `@duration: unknown node "${id ?? ''}".`);
    else if (!(ms >= 0 && ms <= LIMITS.duration)) bad(line, `@duration: milliseconds between 0 and ${LIMITS.duration}.`);
    else duration.set(id, ms);
  }

  function setFailure(line: number, id: string | undefined) {
    if (id && known(id)) fail.add(id);
    else bad(line, `@fail: unknown node "${id ?? ''}".`);
  }

  function applyDirective(d: { line: number; text: string }) {
    const [cmd, a, b] = d.text.split(/\s+/);
    if (cmd === 'speed') { const v = Number(a); if (v >= 0.1 && v <= 10) opts.speed = v; else bad(d.line, '@speed must be between 0.1 and 10.'); }
    else if (cmd === 'loop') opts.loop = a !== 'off' && a !== 'false';
    else if (cmd === 'autoplay') opts.autoplay = a !== 'off' && a !== 'false';
    else if (cmd === 'duration') setDuration(d.line, a, b);
    else if (cmd === 'fail') setFailure(d.line, a);
    else bad(d.line, `Unknown directive "@${cmd}". Use @speed, @loop, @autoplay, @duration <node> <ms>, @fail <node>.`);
  }
  finishInput();
  directives.forEach(applyDirective);
  if (problems.length) throw new TextError(problems);

  // ---- flows ----
  const flows: FlowDef[] = [];
  const used = new Set<string>();
  const flowIdFor = (from: string, to: string) => {
    let id = `${from}_${to}`, n = 1;
    while (used.has(id)) id = `${from}_${to}_${++n}`;
    used.add(id);
    return id;
  };
  function addFlow(e: Edge) {
    const m = ARROW.exec(e.op)!;
    const back = !!m[1], endCh = m[2], body = e.op.replace(/^</, '');
    let line: Line = 'solid';
    if (/\./.test(body) || (sequence && body.startsWith('--') && !/=/.test(body))) line = 'dotted';
    else if (/=/.test(body)) line = 'thick';
    let head: End = 'none';
    if (endCh === 'x') head = 'cross';
    else if (endCh === 'o') head = 'circle';
    else if (endCh || back) head = 'arrow';
    const tail: End = back && endCh ? 'arrow' : 'none';
    const [from, to] = back && !endCh ? [e.to, e.from] : [e.from, e.to];
    flows.push({
      id: flowIdFor(from, to), from, to, payload: e.text, curve: false,
      ...(line !== 'solid' && { line }), ...(head !== 'arrow' && { head }), ...(tail !== 'none' && { tail }),
    });
  }
  edges.forEach(addFlow);
  function applyLinkStyles() {
    for (const ls of linkStyles) {
      if (ls.idx === 'default') flows.forEach((f) => { f.style = merge(f.style, ls.style); });
      else if (flows[ls.idx]) flows[ls.idx]!.style = merge(flows[ls.idx]!.style, ls.style);
      else bad(ls.line, `linkStyle ${ls.idx}: there are only ${flows.length} connections (counting from 0).`);
    }
  }

  function applyClicks() {
    for (const c of clicks) {
      const n = nodes.get(c.id);
      if (!n) { bad(c.line, `click: unknown node "${c.id}".`); continue; }
      if (c.url !== undefined) { if (SAFE_HREF.test(c.url)) n.href = c.url; else bad(c.line, `click: link must start with http://, https:// or obsidian://.`); }
      if (c.tip) n.tooltip = c.tip.slice(0, LIMITS.label);
    }
  }
  function applyNodeStyles() {
    for (const n of nodes.values()) {
      const style = merge(classDefs.get('default'), classDefs.get(nodeClass.get(n.id) ?? ''), nodeStyle.get(n.id));
      if (style) n.style = style;
    }
  }
  function checkStyledNodes() {
    for (const [id] of [...nodeStyle, ...nodeClass]) if (!nodes.has(id) && !groups.has(id)) bad(1, `"${id}" is styled but never defined as a node.`);
  }
  applyLinkStyles();
  applyNodeStyles();
  applyClicks();
  checkStyledNodes();
  if (problems.length) throw new TextError(problems);

  // ---- events: derived from the graph ----
  const events: EventDef[] = [];
  const ev = (e: Partial<EventDef> & Pick<EventDef, 'id' | 'type'>): EventDef => {
    const full: EventDef = { after: [], until: [], select: [], fail: false, ...e };
    events.push(full);
    return full;
  };
  const proc = (node: string, id: string, after: string[]) =>
    ev({ id, type: 'process', node, after, duration: duration.get(node), fail: fail.has(node) });

  function deriveAnimation() {
    if (sequence) {
      // Messages happen in the order written; each hands off to the next.
      let prev: string | undefined;
      flows.forEach((f, i) => {
        const t = ev({ id: `t${i + 1}`, type: 'transfer', flow: f.id, after: prev ? [prev] : [] });
        prev = proc(f.to, `p${i + 1}`, [t.id]).id;
      });
      for (const n of nodes.keys()) if (!flows.some((f) => f.from === n || f.to === n)) proc(n, `p_${n}`, []);
    } else {
      events.push(...deriveEvents([...nodes.keys()], flows, { duration, fail }));
    }
  }
  deriveAnimation();
  if (events.length > LIMITS.events) throw new TextError([{ line: 1, message: `At most ${LIMITS.events} animation steps.` }]);

  const diagram: Diagram = {
    id: 'diagram', direction, edgeLabels: true, nodes: [...nodes.values()], groups: [...groups.values()], flows, events,
    animation: { ...opts }, view: undefined,
  };
  buildTimeline(diagram);
  return diagram;
}

const ARROW_AFTER_ID = /^\S+\s*(?:-+>|=+>|<-|\.\.>)/;

function idOf(raw: string, line: number, bad: (l: number, m: string) => void): string {
  const t = raw.replace(/^"|"$/g, '');
  const id = stripBoundaryUnderscores(t.replace(/\W+/g, '_'));
  if (!id) bad(line, `"${raw}" cannot be used as a name.`);
  return id || 'x';
}
