import { deriveEvents } from '../core/auto';
import { buildTimeline } from '../core/timeline';
import { LIMITS, type GanttDef, type Style, type Diagram, type End, type FlowDef, type GroupDef, type Line, type NodeDef, type Shape } from '../core/types';
import type { TextProblem } from './parse';

/** Diagram kinds beyond flowchart/sequence. Each parser fills a Builder; `finish` makes the shared Diagram model. */
export type Kind = 'activity' | 'state' | 'class' | 'er' | 'mindmap' | 'gantt' | 'c4' | 'component';

const clean = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replaceAll('\\n', ' ').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'x';

class Builder {
  nodes = new Map<string, NodeDef>();
  flows: FlowDef[] = [];
  groups = new Map<string, GroupDef>();
  private n = 0;
  constructor(public readonly problems: TextProblem[]) {}
  bad(line: number, message: string) { if (this.problems.length < 30) this.problems.push({ line, message }); }
  fresh(prefix: string) { return `${prefix}${++this.n}`; }
  node(id: string, label?: string, shape?: Shape, group?: string): NodeDef {
    let cur = this.nodes.get(id);
    if (!cur) {
      cur = { id, label: (label ?? id).slice(0, LIMITS.label), ...(shape && shape !== 'rect' && { shape }), ...(group && { group }) };
      this.nodes.set(id, cur);
    } else {
      if (label !== undefined) cur.label = label.slice(0, LIMITS.label);
      if (shape) cur.shape = shape;
    }
    return cur;
  }
  link(from: string, to: string, o: { text?: string; line?: Line; head?: End; tail?: End; headLabel?: string; tailLabel?: string } = {}) {
    let id = `${from}_${to}`, k = 1;
    while (this.flows.some((f) => f.id === id)) id = `${from}_${to}_${++k}`;
    this.flows.push({
      id, from, to, payload: o.text, curve: false,
      ...(o.line && o.line !== 'solid' && { line: o.line }), ...(o.head && o.head !== 'arrow' && { head: o.head }),
      ...(o.tail && o.tail !== 'none' && { tail: o.tail }), ...(o.headLabel && { headLabel: o.headLabel }), ...(o.tailLabel && { tailLabel: o.tailLabel }),
    });
  }
  group(id: string, label: string, parent?: string) { this.groups.set(id, { id, label, ...(parent && { parent }) }); }
  finish(direction: Diagram['direction'], animate: boolean, anim: { speed: number; loop: boolean; autoplay: boolean }, duration: Map<string, number>, fail: Set<string>): Diagram {
    if (this.nodes.size === 0) this.bad(1, 'Define at least one node.');
    if (this.nodes.size > LIMITS.nodes) this.bad(1, `At most ${LIMITS.nodes} nodes.`);
    if (this.flows.length > LIMITS.flows) this.bad(1, `At most ${LIMITS.flows} connections.`);
    const events = animate ? deriveEvents([...this.nodes.keys()], this.flows, { duration, fail }) : [];
    const d: Diagram = {
      id: 'diagram', direction, edgeLabels: true, nodes: [...this.nodes.values()], groups: [...this.groups.values()],
      flows: this.flows, events, animation: { ...anim, ...(!animate && { autoplay: false }) }, view: undefined,
    };
    if (!this.problems.length) buildTimeline(d);
    return d;
  }
}

// ---------------------------------------------------------------- activity (PlantUML new syntax)

interface Pending { from: string; text?: string }

function activity(lines: [string, number][], b: Builder) {
  // `front` = nodes the next element hangs off (with the label of the arrow into it).
  let front: Pending[] = [];
  const stack: ({ kind: 'if'; cond: string; branches: Pending[][]; entry: Pending[]; pendingText?: string }
    | { kind: 'while'; head: string; exitText?: string }
    | { kind: 'repeat'; top: string }
    | { kind: 'fork'; entry: Pending[]; branches: Pending[][]; merge?: string }
    | { kind: 'group'; id: string })[] = [];
  let arrowText: string | undefined;
  const grp = () => { for (let i = stack.length - 1; i >= 0; i--) { const s = stack[i]!; if (s.kind === 'group') return s.id; } return undefined; };
  const attach = (id: string) => {
    for (const p of front) b.link(p.from, id, { text: p.text ?? arrowText });
    arrowText = undefined;
    front = [{ from: id }];
  };
  const add = (label: string, shape: Shape | undefined, prefix: string) => {
    const id = b.fresh(prefix);
    b.node(id, label, shape, grp());
    attach(id);
    return id;
  };

  let i = 0;
  while (i < lines.length) {
    const [s, ln] = lines[i]!; i++;
    if (!s || s.startsWith("'") || /^(skinparam|title|header|footer|legend|hide|show|left to right|top to bottom)\b/i.test(s)) continue;
    const t = s.replace(/;\s*$/, '');
    let m: RegExpExecArray | null;
    if (/^start\b/i.test(t)) { add('Start', 'start', 's'); continue; }
    if (/^(stop|end)\s*$/i.test(t)) { if (front.length) { add('End', 'end', 'e'); front = []; } continue; }
    if (/^kill\s*$|^detach\s*$/i.test(t)) { front = []; continue; }
    if (/^note\b/i.test(t)) {
      if (!/^note\s+\w+\s*:/i.test(t)) {
        while (i < lines.length && !/^end\s*note/i.test(lines[i]![0])) i++;
      }
      i++;
      continue;
    }
    m = /^->\s*(.*)$/.exec(t);
    if (m) { arrowText = clean(m[1]!) || undefined; continue; }
    if (s.startsWith(':')) { // action, possibly several lines until ';'
      let text = s.slice(1);
      while (!/[;|<>/\]}]\s*$/.test(text) && i < lines.length) text += ' ' + lines[i++]![0];
      text = text.replace(/[;|<>/\]}]\s*$/, '');
      add(clean(text), 'round', 'a');
      continue;
    }
    m = /^(?:partition|package|rectangle|group|card)\s+("[^"]*"|\S+)\s*\{?\s*$/i.exec(t);
    if (m) {
      const label = clean(m[1]!), id = b.fresh('g_') + slug(label);
      b.group(id, label, grp());
      stack.push({ kind: 'group', id });
      continue;
    }
    if (/^swimlane\b|^\|[^|]*\|/.test(t)) continue;
    m = /^if\s*\((.*?)\)\s*(?:then\s*(?:\((.*)\))?)?\s*$/i.exec(t);
    if (m) {
      const id = add(clean(m[1]!), 'diamond', 'd');
      stack.push({ kind: 'if', cond: id, branches: [], entry: [{ from: id, text: m[2] !== undefined ? clean(m[2]) : 'yes' }] });
      front = [{ from: id, text: m[2] !== undefined ? clean(m[2]) : 'yes' }];
      continue;
    }
    m = /^else\s*(?:\((.*)\))?\s*$/i.exec(t) ?? /^elseif\s*\((.*?)\)\s*(?:then\s*(?:\((.*)\))?)?\s*$/i.exec(t);
    if (m) {
      const top = stack.at(-1);
      if (top?.kind !== 'if') { b.bad(ln, '"else" without "if".'); continue; }
      top.branches.push(front);
      const elseif = /^elseif/i.test(t);
      if (elseif) {
        // Chain: the new condition hangs off the previous decision's "no" exit.
        const id = b.fresh('d');
        b.node(id, clean(m[1]!), 'diamond', grp());
        b.link(top.cond, id, { text: 'no' });
        top.cond = id;
        front = [{ from: id, text: m[2] !== undefined ? clean(m[2]) : 'yes' }];
      } else {
        front = [{ from: top.cond, text: m[1] !== undefined ? clean(m[1]) : 'no' }];
        top.cond = ''; // else taken
      }
      continue;
    }
    if (/^endif\s*$/i.test(t)) {
      const top = stack.pop();
      if (top?.kind !== 'if') { b.bad(ln, '"endif" without "if".'); continue; }
      const out = [...top.branches.flat(), ...front];
      // No else branch: the last decision's "no" exit falls through.
      if (top.cond) out.push({ from: top.cond, text: 'no' });
      front = out;
      continue;
    }
    m = /^while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?\s*$/i.exec(t);
    if (m) {
      const id = add(clean(m[1]!), 'diamond', 'w');
      front = [{ from: id, text: m[2] !== undefined ? clean(m[2]) : 'yes' }];
      stack.push({ kind: 'while', head: id });
      continue;
    }
    m = /^endwhile\s*(?:\((.*)\))?\s*$/i.exec(t);
    if (m) {
      const top = stack.pop();
      if (top?.kind !== 'while') { b.bad(ln, '"endwhile" without "while".'); continue; }
      for (const p of front) b.link(p.from, top.head, { text: p.text });
      front = [{ from: top.head, text: m[1] !== undefined ? clean(m[1]) : 'no' }];
      continue;
    }
    if (/^repeat\s*$/i.test(t)) { const id = b.fresh('r'); b.node(id, '', 'circle', grp()); b.nodes.get(id)!.label = ' '; attach(id); stack.push({ kind: 'repeat', top: id }); continue; }
    m = /^repeat\s*while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?\s*(?:not\s*\((.*)\))?\s*$/i.exec(t);
    if (m) {
      const top = stack.pop();
      if (top?.kind !== 'repeat') { b.bad(ln, '"repeat while" without "repeat".'); continue; }
      const id = add(clean(m[1]!), 'diamond', 'd');
      b.link(id, top.top, { text: m[2] !== undefined ? clean(m[2]) : 'yes' });
      front = [{ from: id, text: m[3] !== undefined ? clean(m[3]) : 'no' }];
      continue;
    }
    if (/^(fork|split)\s*$/i.test(t)) {
      const id = add('fork', 'bar', 'f');
      stack.push({ kind: 'fork', entry: [{ from: id }], branches: [], merge: undefined });
      continue;
    }
    if (/^(fork again|split again)\s*$/i.test(t)) {
      const top = stack.at(-1);
      if (top?.kind !== 'fork') { b.bad(ln, '"fork again" without "fork".'); continue; }
      top.branches.push(front);
      front = top.entry;
      continue;
    }
    if (/^(end fork|end split|endfork|endsplit)\s*(\{.*\})?\s*$/i.test(t)) {
      const top = stack.pop();
      if (top?.kind !== 'fork') { b.bad(ln, '"end fork" without "fork".'); continue; }
      const ends = [...top.branches.flat(), ...front];
      const id = b.fresh('j');
      b.node(id, 'join', 'bar', grp());
      for (const p of ends) b.link(p.from, id, { text: p.text });
      front = [{ from: id }];
      continue;
    }
    if (/^\}\s*$/.test(t) || /^end\s*partition|^end\s*package/i.test(t)) {
      if (stack.at(-1)?.kind === 'group') stack.pop();
      continue;
    }
    b.bad(ln, `Unrecognised activity statement "${t.slice(0, 40)}". Use start, :action;, if/else/endif, while/endwhile, repeat, fork, stop.`);
  }
  if (stack.length) b.bad(lines.length ? lines.at(-1)![1] : 1, `"${stack.at(-1)!.kind}" is never closed.`);
}

// ---------------------------------------------------------------- state diagram

function state(lines: [string, number][], b: Builder) {
  const scope: string[] = [];
  const startId = (g?: string) => `start_${g ?? 'root'}`;
  const endId = (g?: string) => `end_${g ?? 'root'}`;
  const cur = () => scope.at(-1);
  const alias = new Map<string, string>();
  // Composite states are groups; find them first so an earlier edge to one doesn't create a plain node.
  const composite = new Set<string>();
  for (const [s] of lines) { const m = /^state\s+(?:"[^"]*"\s+as\s+)?(\w+)\s*(?:<<\w+>>)?\s*\{\s*$/i.exec(s); if (m) composite.add(m[1]!); }
  const ref = (raw: string, ln: number): string => {
    const t = raw.trim();
    if (t === '[*]') return '[*]';
    const id = alias.get(t) ?? slug(t.replace(/^"|"$/g, ''));
    if (!id) b.bad(ln, `"${raw}" cannot be used as a state name.`);
    return id;
  };
  const ensure = (id: string, asTarget: boolean) => {
    if (id === '[*]') {
      const g = cur();
      if (asTarget) { const e = endId(g); b.node(e, 'End', 'end', g); return e; }
      const s = startId(g); b.node(s, 'Start', 'start', g); return s;
    }
    if (!b.nodes.has(id) && !composite.has(id)) b.node(id, id.replaceAll('_', ' '), 'round', cur());
    return id;
  };
  for (const [s, ln] of lines) {
    if (!s || s.startsWith("'") || /^(direction|skinparam|hide|title|scale|note|end note)\b/i.test(s)) continue;
    let m: RegExpExecArray | null;
    m = /^state\s+"([^"]*)"\s+as\s+(\w+)\s*(?:<<(\w+)>>)?\s*(\{)?\s*$/i.exec(s);
    if (m) {
      alias.set(m[2]!, m[2]!);
      if (m[4]) { b.group(m[2]!, clean(m[1]!), cur()); scope.push(m[2]!); }
      else b.node(m[2]!, clean(m[1]!), m[3] ? stereo(m[3]) : 'round', cur());
      continue;
    }
    m = /^state\s+(\w+)\s*(?:<<(\w+)>>)?\s*(\{)?\s*$/i.exec(s);
    if (m) {
      if (m[3]) { b.group(m[1]!, m[1]!.replaceAll('_', ' '), cur()); scope.push(m[1]!); }
      else b.node(m[1]!, m[2] ? '' : m[1]!.replaceAll('_', ' '), m[2] ? stereo(m[2]) : 'round', cur());
      continue;
    }
    if (s === '}') {
      if (scope.length) scope.pop();
      else b.bad(ln, 'Unmatched "}".');
      continue;
    }
    if (s === '--' || s === '||') continue; // concurrent regions: drawn as one group
    m = /^(\[\*\]|[\w"]+)\s*(-+>|\.+>|=+>)\s*(\[\*\]|[\w"]+)\s*(?::\s*(.*))?$/.exec(s);
    if (m) {
      const a = ensure(ref(m[1]!, ln), false), z = ensure(ref(m[3]!, ln), true);
      b.link(a, z, { text: m[4] ? clean(m[4]) : undefined, line: m[2]!.startsWith('.') ? 'dotted' : undefined });
      continue;
    }
    m = /^(\w+)\s*:\s*(.+)$/.exec(s);
    if (m) { // description line
      const id = ensure(m[1]!, false), n = b.nodes.get(id)!;
      n.lines = [...(n.lines ?? []), clean(m[2]!)];
      if (!n.shape || n.shape === 'round') n.shape = 'class';
      continue;
    }
    b.bad(ln, `Unrecognised state statement "${s.slice(0, 40)}". Use "A --> B : event", "[*] --> A", "state X { ... }".`);
  }
  if (scope.length) b.bad(lines.length ? lines.at(-1)![1] : 1, `State "${scope.at(-1)}" is never closed with "}".`);
  // A state with a `{ }` body is a group: edges to it would need a node. Retarget to its start/first child.
  for (const g of b.groups.keys()) {
    const inner = [...b.nodes.values()].find((n) => n.group === g);
    for (const f of b.flows) {
      if (f.to === g) f.to = b.nodes.has(startId(g)) ? startId(g) : inner?.id ?? f.to;
      if (f.from === g) f.from = b.nodes.has(endId(g)) ? endId(g) : inner?.id ?? f.from;
    }
  }
  b.flows.forEach((f) => { f.id = `${f.from}_${f.to}`; });
  const seen = new Set<string>();
  b.flows.forEach((f) => {
    let id = f.id, k = 1;
    while (seen.has(id)) id = `${f.id}_${++k}`;
    seen.add(id);
    f.id = id;
  });
}
function stereo(s: string): Shape {
  if (/choice/i.test(s)) return 'diamond';
  return /fork|join/i.test(s) ? 'bar' : 'round';
}

// ---------------------------------------------------------------- class diagram

const DECO: Record<string, End> = { '<|': 'triangle', '|>': 'triangle', '*': 'diamond-filled', o: 'diamond' };
const REL = /^(\w+)\s*(?:"([^"]*)")?\s*((?:<\|?|\*|o|<|\|>|>)?)(-+|\.+)((?:\|>|\*|o|>|<)?)\s*(?:"([^"]*)")?\s*(\w+)\s*(?::\s*(.*))?$/;

function classes(lines: [string, number][], b: Builder) {
  let open: NodeDef | undefined;
  const cls = (id: string) => {
    const n = b.node(id, id, 'class');
    n.lines ??= [];
    return n;
  };
  const member = (n: NodeDef, text: string) => {
    const t = text.trim();
    if (!t) return;
    const stereotype = /^<<(.+)>>$/.exec(t);
    if (stereotype) { n.label = n.label.replace(/^«.*?»\s*/, ''); n.label = `«${stereotype[1]}» ${n.label}`; return; }
    n.lines!.push(t);
  };
  for (const [s, ln] of lines) {
    if (!s || s.startsWith("'") || s.startsWith('%%') || /^(direction|skinparam|hide|show|title|note|namespace|package|set)\b/i.test(s)) continue;
    let m: RegExpExecArray | null;
    if (open) {
      if (s === '}') open = undefined;
      else member(open, s);
      continue;
    }
    m = /^(?:(abstract|interface|enum)\s+)?class\s+(\w+)(?:\s*<<(\w+)>>)?\s*(\{)?\s*(?:\{\s*)?$/i.exec(s) ?? /^(interface|abstract class|abstract|enum)\s+(\w+)\s*(\{)?\s*$/i.exec(s);
    if (m) {
      const kind = (m[1] && /interface|enum|abstract/i.test(m[1]) ? m[1] : /^(\S+)/.exec(s)![1]!).replace(/\s*class/i, '').toLowerCase();
      const n = cls(m[2]!);
      if (['interface', 'abstract', 'enum'].includes(kind) && !n.label.startsWith('«')) n.label = `«${kind}» ${m[2]}`;
      if (/^class$/i.test(m[1] ?? '') === false && m[3] && m.length > 4 && /<</.test(s)) n.label = `«${m[3]}» ${m[2]}`;
      if (/\{\s*$/.test(s)) open = n;
      continue;
    }
    m = /^class\s+(\w+)\s*(\{)?\s*$/i.exec(s);
    if (m) {
      const n = cls(m[1]!);
      if (m[2]) open = n;
      continue;
    }
    m = /^(\w+)\s*:\s*(.+)$/.exec(s);
    if (m && !/[-.][-.>|*o]/.test(m[2]!.slice(0, 2)) && !REL.test(s)) {
      member(cls(m[1]!), m[2]!);
      continue;
    }
    const mer = /^(\w+)\s*(?:"([^"]*)")?\s*(<\||\*|o|<|\|>|>)?(--|\.\.)(\|>|\*|o|>|<)?\s*(?:"([^"]*)")?\s*(\w+)\s*(?::\s*(.*))?$/.exec(s);
    if (mer) {
      const [, a, ca, l, body, r, cb, z, label] = mer;
      cls(a!); cls(z!);
      const deco = (tok?: string): End | undefined => (tok ? DECO[tok] ?? 'arrow' : undefined);
      // Arrow points at the end that carries the decoration. Left decoration => reverse so the head lands on `a`.
      const left = deco(l), right = deco(r);
      const dotted = body === '..';
      if (left && !right) b.link(z!, a!, { text: label ? clean(label.replace(/^[<>]\s*|\s*[<>]$/g, '')) : undefined, line: dotted ? 'dotted' : undefined, head: left, headLabel: ca, tailLabel: cb });
      else b.link(a!, z!, { text: label ? clean(label.replace(/^[<>]\s*|\s*[<>]$/g, '')) : undefined, line: dotted ? 'dotted' : undefined, head: right ?? 'none', tail: left, headLabel: cb, tailLabel: ca });
      continue;
    }
    m = /^(\w+)\s*\{\s*$/.exec(s);
    if (m) { open = cls(m[1]!); continue; }
    b.bad(ln, `Unrecognised class statement "${s.slice(0, 40)}". Use "class A { +field }", "A <|-- B", "A *-- B", "A --> B : label".`);
  }
}

// ---------------------------------------------------------------- ER diagram

const CARD: Record<string, string> = { '||': '1', '|o': '0..1', 'o|': '0..1', '}o': '0..*', 'o{': '0..*', '}|': '1..*', '|{': '1..*', 'one': '1', 'zero or one': '0..1', 'zero or more': '0..*', 'one or more': '1..*' };

function er(lines: [string, number][], b: Builder) {
  let open: NodeDef | undefined;
  const ent = (id: string) => { const n = b.node(id, id, 'class'); n.lines ??= []; return n; };
  for (const [s, ln] of lines) {
    if (!s || s.startsWith('%%') || s.startsWith("'") || /^(direction|title|skinparam)\b/i.test(s)) continue;
    let m: RegExpExecArray | null;
    if (open) {
      if (s === '}') { open = undefined; continue; }
      const a = /^(\S+)\s+(\S+)\s*(PK|FK|UK)?(?:\s*,\s*(PK|FK|UK))?\s*(?:"([^"]*)")?\s*$/i.exec(s);
      if (a) {
        const keys = [a[3], a[4]].filter(Boolean).map((k) => k!.toUpperCase()).join(',');
        open.lines!.push(`${keys ? keys + ' ' : ''}${a[2]}: ${a[1]}`);
      }
      else b.bad(ln, `Attribute "${s}" should look like "type name PK".`);
      continue;
    }
    m = /^(\w+)\s*\{\s*$/.exec(s);
    if (m) { open = ent(m[1]!); continue; }
    m = /^entity\s+("[^"]*"|\w+)(?:\s+as\s+(\w+))?\s*(\{)?\s*$/i.exec(s);
    if (m) {
      const id = m[2] ?? slug(m[1]!), n = ent(id);
      if (m[2]) n.label = clean(m[1]!);
      if (m[3]) open = n;
      continue;
    }
    // Mermaid: A ||--o{ B : label     PlantUML: A ||--o{ B : label (same tokens)
    m = /^(\w+)\s+([|}o][|o{}]|\|\{|o\{|\}\||\}o)\s*(--|\.\.)\s*([|o{}][|o{}])\s+(\w+)\s*(?::\s*(.*))?$/.exec(s);
    if (m) {
      const [, a, l, body, r, z, label] = m;
      ent(a!); ent(z!);
      b.link(a!, z!, { text: label ? clean(label) : undefined, line: body === '..' ? 'dotted' : undefined, head: 'none', tailLabel: CARD[l!] ?? l, headLabel: CARD[flip(r!)] ?? r });
      continue;
    }
    b.bad(ln, `Unrecognised ER statement "${s.slice(0, 40)}". Use "A ||--o{ B : has" or "ENTITY { type name PK }".`);
  }
}
const flip = (t: string) => ({ '|{': '|{', 'o{': 'o{', '||': '||', 'o|': 'o|', '|o': 'o|', '{o': 'o{', '{|': '|{' } as Record<string, string>)[t] ?? t;

// ---------------------------------------------------------------- mindmap

function mindmap(lines: [string, number][], b: Builder, plant: boolean) {
  const stack: { depth: number; id: string }[] = [];
  let k = 0;
  for (const [raw, ln] of lines) {
    const t0 = raw.replaceAll('\t', '  ');
    if (!t0.trim() || t0.trim().startsWith('%%') || t0.trim().startsWith("'")) continue;
    let depth: number, text: string;
    const pm = plant ? /^([*+-]+)(?:\[#\w+\])?\s*_?\s*(.*)$/.exec(t0.trim()) : null;
    if (pm) { depth = pm[1]!.length - 1; text = pm[2]!; }
    else { depth = Math.floor((/^ */.exec(t0)![0]).length / 2); text = t0.trim(); }
    // Mermaid shape wrappers: id((text)), id(text), id[text], ::icon lines
    if (text.startsWith('::')) continue;
    const wrap = /^(\w+)?(?:\(\((.*)\)\)|\(\)(.*)\(\)|\{\{(.*)\}\}|\[(.*)\]|\((.*)\))$/.exec(text);
    let shape: Shape = depth === 0 ? 'circle' : 'round';
    if (wrap) { text = wrap[2] ?? wrap[3] ?? wrap[4] ?? wrap[5] ?? wrap[6] ?? text; if (wrap[4] !== undefined) shape = 'hexagon'; else if (wrap[5] !== undefined) shape = 'rect'; else if (wrap[2] === undefined) shape = 'round'; }
    text = clean(text.replace(/^\s*:\s*/, '').replace(/\s*;\s*$/, ''));
    if (!text) continue;
    while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
    if (!stack.length && depth > 0 && b.nodes.size) { b.bad(ln, 'Mind map has more than one root. Use one top-level item.'); continue; }
    const id = `n${++k}`;
    b.node(id, text, shape);
    if (stack.length) b.link(stack.at(-1)!.id, id, { head: 'none' });
    stack.push({ depth, id });
  }
}


// ---------------------------------------------------------------- gantt (Mermaid + PlantUML)

const DAY = 86400000;
const toDay = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) / DAY : undefined; };
const durDays = (t: string): number | undefined => {
  const m = /^(\d+(?:\.\d+)?)\s*(d|day|days|w|week|weeks|h|hour|hours)?$/i.exec(t.trim());
  if (!m) return undefined;
  const n = Number(m[1]), u = (m[2] ?? 'd').toLowerCase();
  if (u.startsWith('w')) return n * 7;
  return u.startsWith('h') ? n / 24 : n;
};
interface TaskSpec { id: string; label: string; section?: string; date?: number; after?: string[]; startOf?: string; dur?: number; endDate?: number; milestone?: boolean; status?: 'done' | 'active' | 'crit' }
const STATUS_STYLE: Record<string, Style> = {
  done: { fill: '#dfe3ea', stroke: '#9aa3b2' }, active: { fill: '#e6efff', stroke: '#2f6fed' }, crit: { fill: '#fdeaea', stroke: '#d13b3b' },
};

function plantClause(clause: string, t: TaskSpec, task: (key: string, label: string) => TaskSpec, b: Builder, ln: number) {
  const milestone = /^happens/i.test(clause);
  const lasts = /^(?:lasts|requires)\s+(.+)$/i.exec(clause);
  if (lasts) {
    const d = durDays(lasts[1]!);
    if (d === undefined) b.bad(ln, `"${lasts[1]}" is not a duration like "5 days".`);
    else t.dur = d;
    return;
  }
  const rel = /^(?:starts|happens)\s+(?:at\s+)?\[([^\]]+)\]'s\s+(end|start)$/i.exec(clause);
  const abs = rel ? null : /^(?:starts|happens)\s+(?:at\s+|on\s+|the\s+)?(\d{4}-\d{2}-\d{2})$/i.exec(clause);
  if (rel) {
    const o = task(rel[1]!, rel[1]!);
    if (rel[2]!.toLowerCase() === 'end') t.after = [o.id];
    else t.startOf = o.id;
  } else if (abs) {
    t.date = toDay(abs[1]!);
  } else {
    const ends = /^ends\s+(?:at\s+|on\s+|the\s+)?(\d{4}-\d{2}-\d{2})$/i.exec(clause);
    if (ends) t.endDate = toDay(ends[1]!);
    else b.bad(ln, `Unrecognised Gantt clause "${clause.slice(0, 40)}". Use "lasts 5 days", "starts at [A]'s end", "starts 2024-01-01".`);
    return;
  }
  if (milestone) { t.milestone = true; t.dur = 0; }
}

function gantt(lines: [string, number][], b: Builder, plant: boolean): GanttDef | undefined {
  const specs: TaskSpec[] = [];
  const byKey = new Map<string, TaskSpec>(); // id (Mermaid) or name (PlantUML)
  let section: string | undefined, title: string | undefined, projectStart: number | undefined;
  const sectionId = (name: string) => {
    const id = 'sec_' + slug(name);
    if (!b.groups.has(id)) b.group(id, name);
    return id;
  };
  const task = (key: string, label: string): TaskSpec => {
    let t = byKey.get(key);
    if (!t) {
      t = { id: slug(key), label, section };
      if (specs.some((x) => x.id === t!.id)) t.id += specs.length;
      specs.push(t);
      byKey.set(key, t);
    }
    return t;
  };
  for (const [s, ln] of lines) {
    if (!s || s.startsWith("'") || s.startsWith('%%')) continue;
    let m: RegExpExecArray | null;
    if (!plant) {
      m = /^title\s+(.+)$/i.exec(s);
      if (m) { title = clean(m[1]!); continue; }
      m = /^section\s+(.+)$/i.exec(s);
      if (m) { section = sectionId(clean(m[1]!)); continue; }
      if (/^(dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday|weekend|accTitle|accDescr|click)\b/i.test(s)) continue;
      const k = s.indexOf(':');
      if (k < 0) { b.bad(ln, `Expected "Task name : id, start, duration".`); continue; }
      const label = clean(s.slice(0, k)), parts = s.slice(k + 1).split(',').map((x) => x.trim()).filter(Boolean);
      const t: TaskSpec = { id: `t${specs.length + 1}`, label, section };
      while (parts.length && /^(done|active|crit|milestone)$/i.test(parts[0]!)) {
        const tag = parts.shift()!.toLowerCase();
        if (tag === 'milestone') t.milestone = true; else t.status = tag as TaskSpec['status'];
      }
      let id: string | undefined, start: string | undefined, end: string | undefined;
      if (parts.length >= 3) [id, start, end] = parts; else if (parts.length === 2) [start, end] = parts; else if (parts.length === 1) end = parts[0];
      if (id) t.id = slug(id);
      if (specs.some((x) => x.id === t.id)) { b.bad(ln, `Duplicate task id "${t.id}".`); continue; }
      if (start) {
        const a = /^after\s+(.+)$/i.exec(start);
        if (a) t.after = a[1]!.split(/\s+/).map(slug); else { const d = toDay(start); if (d === undefined) { b.bad(ln, `Start "${start}" is not a date (YYYY-MM-DD) or "after <id>".`); continue; } t.date = d; }
      }
      if (end) { const d = toDay(end); if (d !== undefined) t.endDate = d; else { const u = durDays(end); if (u === undefined) { b.bad(ln, `"${end}" is not a duration like 5d, 2w or a date.`); continue; } t.dur = u; } }
      if (t.milestone) t.dur = 0;
      specs.push(t); byKey.set(t.id, t);
      continue;
    }
    // PlantUML gantt
    if (/^(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|\d{4}-\d{2}-\d{2})\b.*\b(?:are|is)\s+(?:closed|open)/i.test(s) || /^(?:language|printscale|scale|hide|today|Project scale|footer|header|legend)\b/i.test(s)) continue;
    m = /^title\s+(.+)$/i.exec(s);
    if (m) { title = clean(m[1]!); continue; }
    m = /^project\s+starts\s+(?:the\s+|on\s+)?(\d{4}-\d{2}-\d{2})/i.exec(s);
    if (m) { projectStart = toDay(m[1]!); continue; }
    m = /^--\s*(.*?)\s*--$/.exec(s);
    if (m) { section = sectionId(m[1]!); continue; }
    m = /^(then\s+)?\[([^\]]+)\]\s+(.*)$/i.exec(s);
    if (m) {
      const t = task(m[2]!, m[2]!);
      const rest = m[3]!;
      if (m[1]) { const prev = specs[specs.indexOf(t) - 1]; if (prev) t.after = [prev.id]; }
      if (/^(?:is|are)\s/i.test(rest)) continue; // colour, completion, deleted: cosmetic
      if (/^as\s/i.test(rest)) continue;
      for (const clause of rest.split(/\s+and\s+/i)) plantClause(clause, t, task, b, ln);
      continue;
    }
    b.bad(ln, `Unrecognised Gantt statement "${s.slice(0, 40)}".`);
  }
  if (!specs.length) { b.bad(1, 'Define at least one task.'); return undefined; }

  // Resolve start/end in days (absolute), following dependencies.
  const idIndex = new Map(specs.map((t, i) => [t.id, i]));
  const span = new Map<string, { start: number; end: number }>();
  const busy = new Set<string>();
  const first = specs.find((t) => t.date !== undefined)?.date;
  const origin = projectStart ?? first ?? toDay('2025-01-01')!;
  const resolve = (t: TaskSpec): { start: number; end: number } => {
    const hit = span.get(t.id);
    if (hit) return hit;
    if (busy.has(t.id)) { b.bad(1, `Task "${t.label}" depends on itself.`); return { start: origin, end: origin + 1 }; }
    busy.add(t.id);
    const dep = (id: string) => { const i = idIndex.get(id); if (i === undefined) { b.bad(1, `Task "${t.label}" refers to unknown task "${id}".`); return undefined; } return resolve(specs[i]!); };
    let start: number;
    if (t.date !== undefined) start = t.date;
    else if (t.after) start = Math.max(origin, ...t.after.map((id) => dep(id)?.end ?? origin));
    else if (t.startOf) start = dep(t.startOf)?.start ?? origin;
    else { const i = specs.indexOf(t); start = i > 0 ? resolve(specs[i - 1]!).end : origin; }
    let end = start + (t.dur ?? 1);
    if (t.endDate !== undefined) end = t.endDate + (t.endDate > start ? 1 : 0);
    busy.delete(t.id);
    const r = { start, end: Math.max(start, end) };
    span.set(t.id, r);
    return r;
  };
  for (const t of specs) resolve(t);
  const lo = Math.min(...[...span.values()].map((v) => v.start));
  const tasks: GanttDef['tasks'] = {};
  for (const t of specs) {
    const r = span.get(t.id)!;
    tasks[t.id] = { start: r.start - lo, end: r.end - lo, ...(t.milestone && { milestone: true }) };
    b.node(t.id, t.label, 'round', t.section);
    if (t.status) b.nodes.get(t.id)!.style = STATUS_STYLE[t.status]!;
    for (const a of t.after ?? []) if (idIndex.has(a)) b.link(a, t.id);
  }
  return { startDay: lo, tasks, ...(title && { title }) };
}

// ---------------------------------------------------------------- C4 (Mermaid C4* and PlantUML C4 macros share one syntax)

const C4_STYLE: Record<string, Style> = {
  person: { fill: '#08427b', stroke: '#073b6f', color: '#ffffff' }, personExt: { fill: '#686868', stroke: '#5a5a5a', color: '#ffffff' },
  system: { fill: '#1168bd', stroke: '#0b4884', color: '#ffffff' }, ext: { fill: '#999999', stroke: '#8a8a8a', color: '#ffffff' },
  container: { fill: '#438dd5', stroke: '#3c7fc0', color: '#ffffff' }, component: { fill: '#85bbf0', stroke: '#78a8d8', color: '#000000' },
};

function splitArgs(s: string): string[] {
  const out: string[] = []; let cur = '', q = false, depth = 0;
  for (const ch of s) {
    if (ch === '"') { q = !q; continue; }
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (ch === ',' && !q && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function c4(lines: [string, number][], b: Builder) {
  const scope: string[] = [];
  for (const [s, ln] of lines) {
    if (!s || s.startsWith("'") || s.startsWith('%%') || /^(!|title\b|LAYOUT_|SHOW_|HIDE_|Update\w+|AddElementTag|AddRelTag|skinparam|left to right)/i.test(s)) continue;
    if (s === '}') { scope.pop(); continue; }
    const m = /^(\w+)\s*\((.*)\)\s*(\{)?\s*$/.exec(s);
    if (!m) { b.bad(ln, `Unrecognised C4 statement "${s.slice(0, 40)}". Use Person(id, "Name", "Description"), System(...), Rel(a, b, "label").`); continue; }
    const [, fn, argText, open] = m;
    const a = splitArgs(argText!);
    if (/_Boundary$|^Boundary$|^Deployment_Node$|^Node(_L|_R)?$/i.test(fn!)) {
      b.group(slug(a[0] ?? 'g'), clean(a[1] ?? a[0] ?? ''), scope.at(-1));
      if (open) scope.push(slug(a[0] ?? 'g'));
      continue;
    }
    const rel = /^(Bi)?Rel(_[a-z]+)?$/i.exec(fn!);
    if (rel) {
      if (a.length < 2) { b.bad(ln, 'Rel needs at least (from, to).'); continue; }
      const text = [a[2], a[3] && `[${a[3]}]`].filter(Boolean).join(' ');
      const back = /Back/i.test(fn!);
      const [from, to] = back ? [slug(a[1]!), slug(a[0]!)] : [slug(a[0]!), slug(a[1]!)];
      b.link(from, to, { text: text || undefined, tail: rel[1] ? 'arrow' : undefined });
      continue;
    }
    const k = /^(Person|System|Container|Component|Enterprise|SystemDb|SystemQueue|ContainerDb|ContainerQueue|ComponentDb|ComponentQueue)(_Ext)?$/i.exec(fn!);
    if (!k) { b.bad(ln, `Unknown C4 element "${fn}".`); continue; }
    const kind = k[1]!.toLowerCase().replace(/db$|queue$/, ''), ext = !!k[2];
    const hasTech = /^(container|component)/.test(kind) || /^(containerdb|containerqueue|componentdb|componentqueue)$/i.test(k[1]!);
    const id = slug(a[0] ?? ''), label = clean(a[1] ?? id);
    const tech = hasTech ? a[2] : undefined, desc = hasTech ? a[3] : a[2];
    const n = b.node(id, label, kind === 'person' ? 'round' : 'rect', scope.at(-1));
    const extra = [tech && `[${clean(tech)}]`, desc && clean(desc)].filter((x): x is string => !!x);
    if (extra.length) n.lines = extra;
    let base: string = kind === 'enterprise' ? 'system' : kind;
    if (kind === 'person') base = ext ? 'personExt' : 'person';
    else if (ext) base = 'ext';
    n.style = C4_STYLE[base] ?? C4_STYLE.system!;
  }
  if (scope.length) b.bad(lines.length ? lines.at(-1)![1] : 1, 'A boundary is never closed with "}".');
}

// ---------------------------------------------------------------- component / deployment / architecture

const ICON_SHAPE: [RegExp, Shape][] = [[/database|disk/, 'cylinder'], [/cloud/, 'round'], [/internet/, 'circle']];
const SHAPE_FOR: Record<string, Shape> = {
  database: 'cylinder', storage: 'cylinder', queue: 'stadium', interface: 'circle', usecase: 'circle',
  cloud: 'round', actor: 'round', boundary: 'round', control: 'round',
};
const CONTAINERS = /^(node|cloud|package|rectangle|folder|frame|database|storage|component|namespace|together)\b/i;
function component(lines: [string, number][], b: Builder, mermaid: boolean) {
  const scope: string[] = [];
  const cur = () => scope.at(-1);
  const shapeFor = (kw: string): Shape | undefined => SHAPE_FOR[kw.toLowerCase()];
  const endpoint = (raw: string, ln: number): string => {
    const t = raw.trim();
    let m: RegExpExecArray | null;
    m = /^\[([^\]]+)\]$/.exec(t);
    if (m) { const id = slug(m[1]!); b.node(id, clean(m[1]!), undefined, cur()); return id; }
    m = /^\(\)\s*"?([^"]+)"?$/.exec(t);
    if (m) { const id = slug(m[1]!); b.node(id, clean(m[1]!), 'circle', cur()); return id; }
    m = /^\(([^)]+)\)$/.exec(t);
    if (m) { const id = slug(m[1]!); b.node(id, clean(m[1]!), 'stadium', cur()); return id; }
    const id = slug(t.replace(/^"|"$/g, ''));
    if (!b.nodes.has(id) && !b.groups.has(id)) b.node(id, id === t ? t : clean(t), undefined, cur());
    if (!id) b.bad(ln, `"${raw}" cannot be used as a name.`);
    return id;
  };
  for (const [s, ln] of lines) {
    if (!s || s.startsWith("'") || s.startsWith('%%') || /^(skinparam|title|header|footer|legend|hide|show|note|end note|scale|!)/i.test(s)) continue;
    let m: RegExpExecArray | null;
    if (s === '}') {
      if (scope.length) scope.pop();
      else b.bad(ln, 'Unmatched "}".');
      continue;
    }
    if (mermaid) {
      m = /^group\s+(\w+)(?:\(([^)]*)\))?\s*(?:\[([^\]]*)\])?\s*(?:in\s+(\w+))?$/i.exec(s);
      if (m) { b.group(m[1]!, m[3] ?? m[1]!, m[4]); continue; }
      m = /^(service|junction)\s+(\w+)(?:\(([^)]*)\))?\s*(?:\[([^\]]*)\])?\s*(?:in\s+(\w+))?$/i.exec(s);
      if (m) {
        const junction = m[1]!.toLowerCase() === 'junction';
        const icon = (m[3] ?? '').toLowerCase();
        const shape: Shape | undefined = junction ? 'start' : ICON_SHAPE.find(([re]) => re.test(icon))?.[1];
        b.node(m[2]!, junction ? '' : (m[4] ?? m[2]!), shape, m[5]);
        continue;
      }
      m = /^(\w+)(?:\{group\})?:[LRTB]\s*(<)?--(>)?\s*[LRTB]:(\w+)(?:\{group\})?$/i.exec(s);
      if (m) {
        for (const id of [m[1]!, m[4]!]) if (!b.nodes.has(id)) b.bad(ln, `Unknown service "${id}". Declare it with "service ${id}(icon)[Label]".`);
        b.link(m[1]!, m[4]!, { head: m[3] ? 'arrow' : 'none', tail: m[2] ? 'arrow' : undefined });
        continue;
      }
      b.bad(ln, `Unrecognised architecture statement "${s.slice(0, 40)}". Use "group", "service id(icon)[Label] in group", "a:R -- L:b".`);
      continue;
    }
    // PlantUML component / deployment
    m = /^(\w+)\s+("[^"]*"|\[[^\]]+\]|[^\s{]+)(?:\s+as\s+("[^"]*"|\S+))?\s*(?:<<[^>]*>>)?\s*(\{)?\s*$/.exec(s);
    if (m && /^(component|node|cloud|package|rectangle|folder|frame|database|storage|artifact|queue|interface|actor|usecase|agent|card|boundary|control|entity|collections|namespace)$/i.test(m[1]!)) {
      const [, kw, a, bAs, open] = m;
      const raw = a!.replace(/^\[|\]$/g, ''), label = clean(raw);
      const id = bAs ? slug(bAs) : slug(raw);
      if (open && CONTAINERS.test(kw!)) { b.group(id, label, cur()); scope.push(id); }
      else b.node(id, label, shapeFor(kw!), cur());
      continue;
    }
    if (/^\[([^\]]+)\]\s*$/.test(s)) { endpoint(s, ln); continue; }
    m = /^\[([^\]]+)\]\s+as\s+(\w+)\s*$/.exec(s);
    if (m) { b.node(m[2]!, clean(m[1]!), undefined, cur()); continue; }
    m = /^\(\)\s*("[^"]*"|\w+)(?:\s+as\s+(\w+))?\s*$/.exec(s);
    if (m) { b.node(m[2] ?? slug(m[1]!), clean(m[1]!), 'circle', cur()); continue; }
    m = /^(\[[^\]]+\]|\(\)\s*"[^"]*"|\(\)\s*\w+|"[^"]+"|\([^)]+\)|\w+)\s*(<)?([-.=]+)(?:\[[^\]]*\])?(?:(?:up|down|left|right|u|d|l|r)[-.]*)?(>|\|>)?\s*(\[[^\]]+\]|\(\)\s*"[^"]*"|\(\)\s*\w+|"[^"]+"|\([^)]+\)|\w+)\s*(?::\s*(.*))?$/.exec(s);
    if (m) {
      const a = endpoint(m[1]!, ln), z = endpoint(m[5]!, ln);
      const dotted = m[3]!.includes('.');
      b.link(a, z, { text: m[6] ? clean(m[6]) : undefined, line: dotted ? 'dotted' : undefined, head: m[4] ? 'arrow' : 'none', tail: m[2] ? 'arrow' : undefined });
      continue;
    }
    b.bad(ln, `Unrecognised component statement "${s.slice(0, 40)}". Use "component X", "node N { ... }", "[A] --> [B] : label".`);
  }
  if (scope.length) b.bad(lines.length ? lines.at(-1)![1] : 1, `"${scope.at(-1)}" is never closed with "}".`);
}

// ---------------------------------------------------------------- dispatcher

/** Which extra kind, if any, a source is. Returns undefined for flowchart/sequence. */
export function sniffKind(source: string): Kind | undefined {
  const rows = source.split(/\r?\n/).map((r) => r.trim());
  const first = rows.find((r) => r && !r.startsWith('%%') && r !== '---');
  if (!first) return undefined;
  if (/^stateDiagram(?:-v2)?\b/i.test(first)) return 'state';
  if (/^classDiagram\b/i.test(first)) return 'class';
  if (/^erDiagram\b/i.test(first)) return 'er';
  if (/^gantt\b/i.test(first) || /^@startgantt\b/i.test(first)) return 'gantt';
  if (/^C4(?:Context|Container|Component|Dynamic|Deployment)\b/i.test(first)) return 'c4';
  if (/^architecture(?:-beta)?\b/i.test(first)) return 'component';
  if (/^mindmap\b/i.test(first) || /^@startmindmap\b/i.test(first)) return 'mindmap';
  if (/^@start(?:uml)?\b/i.test(first) && /^@startuml/i.test(first)) {
    const body = rows.filter((r) => r && !r.startsWith("'") && !/^@(?:start|end)uml/i.test(r));
    if (body.some((r) => /^(start|stop|end|if\s*\(|while\s*\(|repeat\b|fork\b|partition\b|:.*;?\s*$)/i.test(r) && !/^end\s+(?:note|fork)/i.test(r)) && !body.some((r) => /^(participant|actor|class|state|entity)\b|->/.test(r) && !r.startsWith('->'))) return 'activity';
    if (body.some((r) => /^(Person|System|Container|Component|Enterprise)(Db|Queue)?(_Ext)?\(|^!include\s.*C4/i.test(r))) return 'c4';
    if (body.some((r) => /^state\b|\[\*\]/.test(r))) return 'state';
    if (body.some((r) => /^(class|interface|abstract|enum)\s+\w+/i.test(r))) return 'class';
    if (body.some((r) => /^(component|node|cloud|package|rectangle|folder|frame|database|storage|artifact|queue|usecase)\s+\S+|^\[[^\]]+\]\s*(?:<?[-.]+|as\b)/i.test(r)) && !body.some((r) => /^participant\b/i.test(r))) return 'component';
    if (body.some((r) => /^entity\b/i.test(r)) && body.some((r) => /[|}o][|o{}]--[|o{}][|o{}]/.test(r))) return 'er';
    if (body.some((r) => /^:.*;?$/.test(r)) && !body.some((r) => /^\w+\s*-+>/.test(r))) return 'activity';
  }
  return undefined;
}

const DIRS: Record<string, Diagram['direction']> = { LR: 'LR', RL: 'RL', TB: 'TB', TD: 'TB', BT: 'BT' };

export function parseKind(kind: Kind, source: string, problems: TextProblem[], directives: { line: number; text: string }[]): Diagram {
  const b = new Builder(problems);
  let ganttDef: GanttDef | undefined;
  const all = source.split(/\r?\n/);
  let direction: Diagram['direction'] = kind === 'mindmap' || kind === 'gantt' || (kind === 'component' && /^\s*architecture/i.test(source)) ? 'LR' : 'TB';
  const plant = all.some((r) => /^\s*@start/i.test(r));
  let seenHeader = false;
  const body: [string, number][] = [];
  all.forEach((raw, idx) => {
    const ln = idx + 1, s = raw.trim();
    if (s.startsWith('%%')) {
      const m = /^%%\s*@(.*)$/.exec(s);
      if (m) directives.push({ line: ln, text: m[1]!.trim() });
      return;
    }
    if (!seenHeader) {
      if (!s) return;
      seenHeader = true;
      const d = /^(?:stateDiagram(?:-v2)?|classDiagram|erDiagram|flowchart|graph)\s+([a-z]{2})\b/i.exec(s);
      if (d) direction = DIRS[d[1]!.toUpperCase()] ?? direction;
      return;
    }
    if (/^@end/i.test(s)) return;
    const dir = /^direction\s+([a-z]{2})\b/i.exec(s);
    if (dir) {
      direction = DIRS[dir[1]!.toUpperCase()] ?? direction;
      return;
    }
    if (/^left to right direction/i.test(s)) { direction = 'LR'; return; }
    if (kind === 'mindmap') body.push([raw, ln]); else if (s) body.push([s, ln]);
  });
  if (kind === 'activity') activity(body, b);
  else if (kind === 'state') state(body, b);
  else if (kind === 'class') classes(body, b);
  else if (kind === 'er') er(body, b);
  else if (kind === 'gantt') ganttDef = gantt(body, b, plant);
  else if (kind === 'c4') c4(body, b);
  else if (kind === 'component') component(body, b, /^\s*architecture/i.test(source));
  else mindmap(body, b, plant);

  const duration = new Map<string, number>(), fail = new Set<string>();
  const anim = { speed: 1, loop: true, autoplay: true };
  for (const d of directives) {
    const [cmd, a, c] = d.text.split(/\s+/);
    if (cmd === 'speed') { const v = Number(a); if (v >= 0.1 && v <= 10) anim.speed = v; else b.bad(d.line, '@speed must be between 0.1 and 10.'); }
    else if (cmd === 'loop') anim.loop = a !== 'off' && a !== 'false';
    else if (cmd === 'autoplay') anim.autoplay = a !== 'off' && a !== 'false';
    else if (cmd === 'duration') { const ms = Number(c); if (a && b.nodes.has(a) && ms >= 0 && ms <= LIMITS.duration) duration.set(a, ms); else b.bad(d.line, `@duration: unknown node or bad milliseconds.`); }
    else if (cmd === 'fail') { if (a && b.nodes.has(a)) fail.add(a); else b.bad(d.line, `@fail: unknown node "${a ?? ''}".`); }
    else b.bad(d.line, `Unknown directive "@${cmd}".`);
  }
  // Structure diagrams (class, ER) are static by default; flow-like kinds animate.
  const animate = kind !== 'class' && kind !== 'er';
  const d = b.finish(direction, animate, anim, duration, fail);
  if (ganttDef) d.gantt = ganttDef;
  return d;
}
