import { deriveEvents } from '../core/auto';
import { parseKind, sniffKind } from './kinds';
import { buildTimeline } from '../core/timeline';
import { COLOR, SAFE_HREF, DiagramError, LIMITS, type Diagram, type End, type EventDef, type FlowDef, type GroupDef, type Line, type NodeDef, type Shape, type Style } from '../core/types';

/**
 * Text front end: Mermaid / PlantUML-style definitions compiled to the same `Diagram` model
 * as the YAML format. Animation is derived from the graph, so a diagram pasted from Mermaid
 * or written by an AI plays with no extra work. Optional `%% @...` comments tune it
 * (they are plain comments to Mermaid, so the file stays valid there).
 */

const HEADER = /^\s*(?:flowchart|graph|flow|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|mindmap|gantt|architecture(?:-beta)?|C4(?:Context|Container|Component|Dynamic|Deployment)|@startuml|@startmindmap|@startgantt)\b/i;

/** True when the source is text-DSL (first meaningful line is a diagram header), not YAML. */
export function isTextSource(source: string): boolean {
  for (const raw of source.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('%%') || l === '---') { if (l === '---') return false; continue; }
    return HEADER.test(l);
  }
  return false;
}

export interface TextProblem { line: number; message: string }
export class TextError extends DiagramError {
  constructor(public readonly located: TextProblem[]) { super(located.map((p) => `line ${p.line}: ${p.message}`)); }
}

const DIR: Record<string, Diagram['direction']> = { LR: 'LR', RL: 'RL', TB: 'TB', TD: 'TB', BT: 'BT' };
// Statements that carry no meaning for animation; accepted so real Mermaid/PlantUML files load.
const IGNORED = /^(?:direction\b|title\b|accTitle\b|accDescr\b|note\b|activate\b|deactivate\b|autonumber\b|loop\b|alt\b|else\b|opt\b|par\b|and\b|rect\b|critical\b|break\b|skinparam\b|hide\b|show\b|header\b|footer\b|legend\b|left to right direction|top to bottom direction)/i;
const PLANT_DECL = /^(participant|actor|component|database|queue|node|entity|boundary|control|collections|rectangle|cloud|interface|usecase|artifact|folder|frame|package|storage|agent|card)\s+("[^"]*"|[^\s]+)(?:\s+as\s+("[^"]*"|[^\s]+))?\s*$/i;
const SEQ_DECL = /^(participant|actor)\b/i;
const ARROW = /^(<)?(?:-\.+-|-+|=+|\.{2,})(>>|>|x|o)?/;
const ID = /^[A-Za-z0-9_]+/;

interface Edge { from: string; to: string; text?: string; line: number; op: string }

/** Opening bracket run -> outline, and the closing run it expects. */
const OPENERS: [string, Shape][] = [['[[', 'subroutine'], ['[(', 'cylinder'], ['([', 'stadium'], ['((', 'circle'], ['{{', 'hexagon'], ['[/', 'parallelogram'], ['[\\', 'parallelogram'], ['[', 'rect'], ['(', 'round'], ['{', 'diamond'], ['>', 'rect']];
const CLOSER: Record<string, string> = { '[': ']', '(': ')', '{': '}', '>': ']', '/': '/', '\\': '\\' };

const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
/** `fill:#f9f,stroke:#333,stroke-width:4px,color:#fff` -> Style (unknown keys and bad colours are ignored, as Mermaid renderers do). */
function parseStyle(list: string): Style {
  const out: Style = {};
  for (const part of list.split(/,(?![^()]*\))/)) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if ((k === 'fill' || k === 'stroke' || k === 'color') && COLOR.test(v)) out[k] = v;
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
    if (!cur) nodes.set(id, { id, label: (label ?? id).slice(0, LIMITS.label), ...(shape && shape !== 'rect' && { shape }), ...(stack.length && { group: stack[stack.length - 1] }) });
    else {
      if (label !== undefined) cur.label = label.slice(0, LIMITS.label);
      if (shape && shape !== 'rect') cur.shape = shape;
      if (stack.length && !cur.group) cur.group = stack[stack.length - 1];
    }
  };
  const clean = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/^["']|["']$/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();

  const lines = source.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    let s = raw.trim();
    if (!s) return;
    if (s.startsWith('%%')) { const m = /^%%\s*@(.*)$/.exec(s); if (m) directives.push({ line: ln, text: m[1]!.trim() }); return; }
    if (plant && s.startsWith("'")) return;
    s = s.replace(/;\s*$/, '');

    if (!sawHeader) {
      const h = /^(flowchart|graph|flow|sequenceDiagram|@startuml)\b\s*([A-Za-z]{2})?/i.exec(s);
      if (!h) return bad(ln, 'Start with a header such as "flowchart LR", "sequenceDiagram" or "@startuml".');
      sawHeader = true;
      const kind = h[1]!.toLowerCase();
      sequence = kind === 'sequencediagram';
      plant = kind === '@startuml';
      if (h[2]) { const d = DIR[h[2].toUpperCase()]; if (d) direction = d; else bad(ln, `Unknown direction "${h[2]}". Use LR, RL, TB (or TD), BT.`); }
      return;
    }
    if (/^@enduml\b/i.test(s)) return;
    if (!sequence) {
      const sg = /^subgraph\b\s*(.*)$/i.exec(s);
      if (sg) {
        const rest = sg[1]!.trim();
        const m = /^([A-Za-z0-9_]+)\s*(?:\[\s*"?([^\]"]*)"?\s*\])?$/.exec(rest) ?? /^"([^"]*)"$/.exec(rest) ?? /^(.+)$/.exec(rest);
        if (!m) return bad(ln, 'Write "subgraph id [Title]" or "subgraph Title".');
        const titled = m.length === 3 && rest.match(/^[A-Za-z0-9_]+\s*(\[|$)/);
        const title = clean(titled ? (m[2] ?? m[1]!) : m[1]!);
        const gid = titled ? m[1]! : title.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `group${groups.size + 1}`;
        if (groups.has(gid) || nodes.has(gid)) return bad(ln, `"${gid}" is already used by another node or subgraph.`);
        if (groups.size >= LIMITS.nodes) return bad(ln, `At most ${LIMITS.nodes} subgraphs.`);
        groups.set(gid, { id: gid, label: title, ...(stack.length && { parent: stack[stack.length - 1] }) });
        stack.push(gid);
        return;
      }
      if (/^end\s*$/i.test(s)) { if (!stack.length) return bad(ln, '"end" without a matching "subgraph".'); stack.pop(); return; }
      const cd = /^classDef\s+(\S+)\s+(.+)$/i.exec(s);
      if (cd) { for (const n of cd[1]!.split(',')) classDefs.set(n, merge(classDefs.get(n), parseStyle(cd[2]!)) ?? {}); return; }
      const cl = /^class\s+(\S+)\s+(\S+)$/i.exec(s);
      if (cl) { for (const n of cl[1]!.split(',')) nodeClass.set(n, cl[2]!); return; }
      const st = /^style\s+(\S+)\s+(.+)$/i.exec(s);
      if (st) { for (const n of st[1]!.split(',')) nodeStyle.set(n, merge(nodeStyle.get(n), parseStyle(st[2]!)) ?? {}); return; }
      const ls = /^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/i.exec(s);
      if (ls) { const style = parseStyle(ls[2]!); if (ls[1]!.toLowerCase() === 'default') linkStyles.push({ line: ln, idx: 'default', style }); else for (const i of ls[1]!.split(',')) if (i.trim()) linkStyles.push({ line: ln, idx: Number(i), style }); return; }
    }
    const ck = /^click\s+(\w+)\s+(?:href\s+)?(?:(?:call\s+\w+(?:\([^)]*\))?)\s*)?(?:"([^"]*)")?\s*(?:"([^"]*)")?\s*(?:_?(?:blank|self|parent|top))?$/i.exec(s);
    if (ck) { clicks.push({ line: ln, id: ck[1]!, url: /\bhref\b/i.test(s) ? ck[2] : undefined, tip: /\bhref\b/i.test(s) ? ck[3] : ck[2] }); return; }
    if (IGNORED.test(s)) {
      const d = /^direction\s+([A-Za-z]{2})\b/i.exec(s);
      if (d && DIR[d[1]!.toUpperCase()] && nodes.size === 0) direction = DIR[d[1]!.toUpperCase()]!;
      return;
    }

    const decl = PLANT_DECL.exec(s);
    if (decl && !ARROW_AFTER_ID.test(s)) {
      const [, kw, a, b] = decl;
      if (SEQ_DECL.test(kw!)) plantSeqDecl = true;
      const q = (x: string) => x.startsWith('"');
      if (b === undefined) return declare(idOf(a!, ln, bad), q(a!) ? clean(a!) : undefined);
      // PlantUML: `participant "Long name" as id`; Mermaid: `participant id as Label`.
      return q(a!) ? declare(idOf(b, ln, bad), clean(a!)) : declare(idOf(a!, ln, bad), clean(b));
    }
    const bracket = /^\[([^\]]+)\]\s+as\s+(\S+)\s*$/.exec(s); // PlantUML `[Label] as id`
    if (bracket) return declare(bracket[2]!, clean(bracket[1]!));

    try { statement(s, ln); } catch (e) { if (e instanceof Error) bad(ln, e.message); else throw e; }
  });

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
      let text: string;
      if (s[pos] === '"') {
        const end = s.indexOf('"', pos + 1);
        if (end < 0) throw new Error('Missing closing quote in label.');
        text = s.slice(pos + 1, end); pos = end + 1;
      } else {
        // The label ends at the mirror of the opener, so "A[Run (fast)]" keeps its parentheses.
        const want = [...op[0]].filter((c) => c !== '/' && c !== '\\').reverse().map((c) => CLOSER[c]!).join('');
        const tail = s.slice(pos);
        const re = new RegExp(`[/\\\\]?${want.replace(/[\])}]/g, '\\$&')}`);
        const m = re.exec(tail);
        if (!m) throw new Error(`Missing closing bracket for "${op[0]}".`);
        text = tail.slice(0, m.index); pos += m.index;
      }
      const closeRe = new RegExp(`^[/\\\\]?${[...op[0]].filter((c) => c !== '/' && c !== '\\').reverse().map((c) => CLOSER[c]!).join('').replace(/[\])}]/g, '\\$&')}`);
      const close = closeRe.exec(s.slice(pos));
      if (!close) throw new Error(`Missing closing bracket for "${op[0]}".`);
      pos += close[0].length;
      return { label: clean(text), shape: op[1] };
    };

    let left = group();
    let count = 0;
    for (;;) {
      ws();
      if (pos >= s.length) break;
      if (s[pos] === ':' && !s.startsWith(':::', pos)) { // trailing `: text` (sequence / PlantUML)
        const text = clean(s.slice(pos + 1));
        if (!count) throw new Error('Text after ":" needs an arrow before it.');
        for (const e of edges.slice(-lastFan)) e.text = text;
        break;
      }
      const m = ARROW.exec(s.slice(pos));
      if (!m || (m[0].length < 2 && !m[2])) throw new Error(`Expected an arrow such as "-->" or "->>" near "${s.slice(pos, pos + 12)}".`);
      pos += m[0].length;
      let text: string | undefined;
      ws();
      if (s[pos] === '|') { // -->|text|
        const end = s.indexOf('|', pos + 1);
        if (end < 0) throw new Error('Missing closing "|" in edge label.');
        text = clean(s.slice(pos + 1, end)); pos = end + 1;
      } else if (!m[2] && /^(--|==|-\.)$/.test(m[0]) && pos < s.length && s[pos] !== ':') { // -- text -->
        const rest = s.slice(pos);
        const close = /\s(-{2,}|={2,}|\.-)[>xo]?(?=\s|$)/.exec(rest);
        if (close) { text = clean(rest.slice(0, close.index)); pos += close.index + 1; const a = ARROW.exec(s.slice(pos)); if (a) pos += a[0].length; }
      }
      const right = group();
      const before = edges.length;
      for (const a of left) for (const b of right) {
        if (edges.length >= LIMITS.flows) throw new Error(`At most ${LIMITS.flows} connections.`);
        edges.push({ from: a, to: b, text, line: ln, op: m[0] });
      }
      lastFan = edges.length - before;
      count++;
      left = right;
    }
  }

  if (stack.length) bad(lines.length, `Subgraph "${stack[stack.length - 1]}" is never closed with "end".`);
  if (!sawHeader && problems.length === 0) bad(1, 'Empty definition. Start with "flowchart LR".');
  if (nodes.size === 0 && problems.length === 0) bad(1, 'Define at least one node.');
  if (nodes.size > LIMITS.nodes) bad(1, `At most ${LIMITS.nodes} nodes.`);
  if (plant && plantSeqDecl) sequence = true;

  // ---- directives ----
  const known = (id: string) => nodes.has(id);
  for (const d of directives) {
    const [cmd, a, b] = d.text.split(/\s+/);
    if (cmd === 'speed') { const v = Number(a); if (v >= 0.1 && v <= 10) opts.speed = v; else bad(d.line, '@speed must be between 0.1 and 10.'); }
    else if (cmd === 'loop') opts.loop = a !== 'off' && a !== 'false';
    else if (cmd === 'autoplay') opts.autoplay = a !== 'off' && a !== 'false';
    else if (cmd === 'duration') {
      const ms = Number(b);
      if (!a || !known(a)) bad(d.line, `@duration: unknown node "${a ?? ''}".`);
      else if (!(ms >= 0 && ms <= LIMITS.duration)) bad(d.line, `@duration: milliseconds between 0 and ${LIMITS.duration}.`);
      else duration.set(a, ms);
    } else if (cmd === 'fail') { if (a && known(a)) fail.add(a); else bad(d.line, `@fail: unknown node "${a ?? ''}".`); }
    else bad(d.line, `Unknown directive "@${cmd}". Use @speed, @loop, @autoplay, @duration <node> <ms>, @fail <node>.`);
  }
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
  for (const e of edges) {
    const m = ARROW.exec(e.op)!;
    const back = !!m[1], endCh = m[2], body = e.op.replace(/^</, '');
    const line: Line = /\./.test(body) || (sequence && body.startsWith('--') && !/=/.test(body)) ? 'dotted' : /=/.test(body) ? 'thick' : 'solid';
    const head: End = endCh === 'x' ? 'cross' : endCh === 'o' ? 'circle' : endCh ? 'arrow' : back ? 'arrow' : 'none';
    const tail: End = back && endCh ? 'arrow' : 'none';
    const [from, to] = back && !endCh ? [e.to, e.from] : [e.from, e.to];
    flows.push({
      id: flowIdFor(from, to), from, to, payload: e.text, curve: false,
      ...(line !== 'solid' && { line }), ...(head !== 'arrow' && { head }), ...(tail !== 'none' && { tail }),
    });
  }
  for (const ls of linkStyles) {
    if (ls.idx === 'default') flows.forEach((f) => { f.style = merge(f.style, ls.style); });
    else if (flows[ls.idx]) flows[ls.idx]!.style = merge(flows[ls.idx]!.style, ls.style);
    else bad(ls.line, `linkStyle ${ls.idx}: there are only ${flows.length} connections (counting from 0).`);
  }
  for (const n of nodes.values()) {
    const style = merge(classDefs.get('default'), classDefs.get(nodeClass.get(n.id) ?? ''), nodeStyle.get(n.id));
    if (style) n.style = style;
  }
  for (const c of clicks) {
    const n = nodes.get(c.id);
    if (!n) { bad(c.line, `click: unknown node "${c.id}".`); continue; }
    if (c.url !== undefined) { if (SAFE_HREF.test(c.url)) n.href = c.url; else bad(c.line, `click: link must start with http://, https:// or obsidian://.`); }
    if (c.tip) n.tooltip = c.tip.slice(0, LIMITS.label);
  }
  for (const [id] of [...nodeStyle, ...nodeClass]) if (!nodes.has(id) && !groups.has(id)) bad(1, `"${id}" is styled but never defined as a node.`);
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
  const id = t.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!id) bad(line, `"${raw}" cannot be used as a name.`);
  return id || 'x';
}
