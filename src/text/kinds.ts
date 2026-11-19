import { deriveEvents } from '../core/auto';
import { buildTimeline } from '../core/timeline';
import { LIMITS, type GanttDef, type Style, type Diagram, type End, type FlowDef, type GroupDef, type Line, type NodeDef, type Shape } from '../core/types';
import type { TextProblem } from './parse';

/** Diagram kinds beyond flowchart/sequence. Each parser fills a Builder; `finish` makes the shared Diagram model. */
export type Kind = 'activity' | 'state' | 'class' | 'er' | 'mindmap' | 'gantt' | 'c4' | 'component';

const clean = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replaceAll(String.raw`\n`, ' ').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
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

type Frame =
  | { kind: 'if'; cond: string; branches: Pending[][]; entry: Pending[]; pendingText?: string }
  | { kind: 'while'; head: string; exitText?: string }
  | { kind: 'repeat'; top: string }
  | { kind: 'fork'; entry: Pending[]; branches: Pending[][]; merge?: string }
  | { kind: 'group'; id: string };

const ACTIVITY_SKIP = /^(skinparam|title|header|footer|legend|hide|show|left to right|top to bottom)\b/i;
/** A cleaned optional label, or the default when the source gave none. */
const labelOr = (v: string | undefined, dflt: string) => (v === undefined ? dflt : clean(v));

class ActivityParser {
  /** Nodes the next element hangs off (with the label of the arrow into it). */
  private front: Pending[] = [];
  private readonly stack: Frame[] = [];
  private arrowText: string | undefined;
  private i = 0;
  constructor(private readonly lines: [string, number][], private readonly b: Builder) {}

  run() {
    const { lines, b } = this;
    while (this.i < lines.length) {
      const [s, ln] = lines[this.i++]!;
      if (!s || s.startsWith("'") || ACTIVITY_SKIP.test(s)) continue;
      const t = s.replace(/;$/, '').trimEnd();
      if (!this.statement(s, t, ln)) b.bad(ln, `Unrecognised activity statement "${t.slice(0, 40)}". Use start, :action;, if/else/endif, while/endwhile, repeat, fork, stop.`);
    }
    if (this.stack.length) b.bad(lines.length ? lines.at(-1)![1] : 1, `"${this.stack.at(-1)!.kind}" is never closed.`);
  }

  private statement(s: string, t: string, ln: number): boolean {
    return this.simple(t) || this.note(t) || this.arrow(t) || this.action(s) || this.container(t)
      || this.conditional(t, ln) || this.loop(t, ln) || this.fork(t, ln) || this.closeBlock(t);
  }

  private grp(): string | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) { const s = this.stack[i]!; if (s.kind === 'group') return s.id; }
    return undefined;
  }
  private attach(id: string) {
    for (const p of this.front) this.b.link(p.from, id, { text: p.text ?? this.arrowText });
    this.arrowText = undefined;
    this.front = [{ from: id }];
  }
  private add(label: string, shape: Shape | undefined, prefix: string) {
    const id = this.b.fresh(prefix);
    this.b.node(id, label, shape, this.grp());
    this.attach(id);
    return id;
  }

  private simple(t: string): boolean {
    if (/^start\b/i.test(t)) this.add('Start', 'start', 's');
    else if (/^(stop|end)\s*$/i.test(t)) {
      if (this.front.length) { this.add('End', 'end', 'e'); this.front = []; }
    } else if (/^kill\s*$|^detach\s*$/i.test(t)) this.front = [];
    else return false;
    return true;
  }

  private note(t: string): boolean {
    if (!/^note\b/i.test(t)) return false;
    if (!/^note\s+\w+\s*:/i.test(t)) {
      while (this.i < this.lines.length && !/^end\s*note/i.test(this.lines[this.i]![0])) this.i++;
    }
    this.i++;
    return true;
  }

  private arrow(t: string): boolean {
    const m = /^->(.*)$/.exec(t);
    if (!m) return false;
    this.arrowText = clean(m[1]!) || undefined;
    return true;
  }

  /** An action, possibly several lines until ';'. */
  private action(s: string): boolean {
    if (!s.startsWith(':')) return false;
    let text = s.slice(1);
    while (!/[;|<>/\]}]\s*$/.test(text) && this.i < this.lines.length) text += ' ' + this.lines[this.i++]![0];
    text = text.replace(/[;|<>/\]}]\s*$/, '');
    this.add(clean(text), 'round', 'a');
    return true;
  }

  private container(t: string): boolean {
    const m = /^(?:partition|package|rectangle|group|card)\s+("[^"]*"|\S+)\s*\{?$/i.exec(t);
    if (!m) return /^swimlane\b|^\|[^|]*\|/.test(t);
    const label = clean(m[1]!), id = this.b.fresh('g_') + slug(label);
    this.b.group(id, label, this.grp());
    this.stack.push({ kind: 'group', id });
    return true;
  }

  private conditional(t: string, ln: number): boolean {
    return this.ifStart(t) || this.elseBranch(t, ln) || this.endif(t, ln);
  }

  private ifStart(t: string): boolean {
    const m = /^if\s*\((.*?)\)(?:\s*then(?:\s*\((.*)\))?)?$/i.exec(t);
    if (!m) return false;
    const id = this.add(clean(m[1]!), 'diamond', 'd');
    this.stack.push({ kind: 'if', cond: id, branches: [], entry: [{ from: id, text: labelOr(m[2], 'yes') }] });
    this.front = [{ from: id, text: labelOr(m[2], 'yes') }];
    return true;
  }

  private elseBranch(t: string, ln: number): boolean {
    const m = /^else\s*(?:\((.*)\))?$/i.exec(t) ?? /^elseif\s*\((.*?)\)\s*(?:then\s*(?:\((.*)\))?)?$/i.exec(t);
    if (!m) return false;
    const top = this.stack.at(-1);
    if (top?.kind !== 'if') { this.b.bad(ln, '"else" without "if".'); return true; }
    top.branches.push(this.front);
    if (/^elseif/i.test(t)) {
      // Chain: the new condition hangs off the previous decision's "no" exit.
      const id = this.b.fresh('d');
      this.b.node(id, clean(m[1]!), 'diamond', this.grp());
      this.b.link(top.cond, id, { text: 'no' });
      top.cond = id;
      this.front = [{ from: id, text: labelOr(m[2], 'yes') }];
    } else {
      this.front = [{ from: top.cond, text: labelOr(m[1], 'no') }];
      top.cond = ''; // else taken
    }
    return true;
  }

  private endif(t: string, ln: number): boolean {
    if (!/^endif\s*$/i.test(t)) return false;
    const top = this.stack.pop();
    if (top?.kind !== 'if') { this.b.bad(ln, '"endif" without "if".'); return true; }
    const out = [...top.branches.flat(), ...this.front];
    // No else branch: the last decision's "no" exit falls through.
    if (top.cond) out.push({ from: top.cond, text: 'no' });
    this.front = out;
    return true;
  }

  private loop(t: string, ln: number): boolean {
    return this.whileStart(t) || this.endWhile(t, ln) || this.repeatStart(t) || this.repeatWhile(t, ln);
  }

  private whileStart(t: string): boolean {
    const m = /^while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?$/i.exec(t);
    if (!m) return false;
    const id = this.add(clean(m[1]!), 'diamond', 'w');
    this.front = [{ from: id, text: labelOr(m[2], 'yes') }];
    this.stack.push({ kind: 'while', head: id });
    return true;
  }

  private endWhile(t: string, ln: number): boolean {
    const m = /^endwhile\s*(?:\((.*)\))?$/i.exec(t);
    if (!m) return false;
    const top = this.stack.pop();
    if (top?.kind !== 'while') { this.b.bad(ln, '"endwhile" without "while".'); return true; }
    for (const p of this.front) this.b.link(p.from, top.head, { text: p.text });
    this.front = [{ from: top.head, text: labelOr(m[1], 'no') }];
    return true;
  }

  private repeatStart(t: string): boolean {
    if (!/^repeat\s*$/i.test(t)) return false;
    const id = this.b.fresh('r');
    this.b.node(id, '', 'circle', this.grp());
    this.b.nodes.get(id)!.label = ' ';
    this.attach(id);
    this.stack.push({ kind: 'repeat', top: id });
    return true;
  }

  private repeatWhile(t: string, ln: number): boolean {
    const m = /^repeat\s*while\s*\((.*?)\)(?:\s*is\s*\((.*)\))?(?:\s*not\s*\((.*)\))?$/i.exec(t);
    if (!m) return false;
    const top = this.stack.pop();
    if (top?.kind !== 'repeat') { this.b.bad(ln, '"repeat while" without "repeat".'); return true; }
    const id = this.add(clean(m[1]!), 'diamond', 'd');
    this.b.link(id, top.top, { text: labelOr(m[2], 'yes') });
    this.front = [{ from: id, text: labelOr(m[3], 'no') }];
    return true;
  }

  private fork(t: string, ln: number): boolean {
    return this.forkStart(t) || this.forkAgain(t, ln) || this.endFork(t, ln);
  }

  private forkStart(t: string): boolean {
    if (!/^(fork|split)\s*$/i.test(t)) return false;
    const id = this.add('fork', 'bar', 'f');
    this.stack.push({ kind: 'fork', entry: [{ from: id }], branches: [], merge: undefined });
    return true;
  }

  private forkAgain(t: string, ln: number): boolean {
    if (!/^(fork again|split again)\s*$/i.test(t)) return false;
    const top = this.stack.at(-1);
    if (top?.kind !== 'fork') { this.b.bad(ln, '"fork again" without "fork".'); return true; }
    top.branches.push(this.front);
    this.front = top.entry;
    return true;
  }

  private endFork(t: string, ln: number): boolean {
    if (!/^(end fork|end split|endfork|endsplit)\s*(\{.*\})?$/i.test(t)) return false;
    const top = this.stack.pop();
    if (top?.kind !== 'fork') { this.b.bad(ln, '"end fork" without "fork".'); return true; }
    const ends = [...top.branches.flat(), ...this.front];
    const id = this.b.fresh('j');
    this.b.node(id, 'join', 'bar', this.grp());
    for (const p of ends) this.b.link(p.from, id, { text: p.text });
    this.front = [{ from: id }];
    return true;
  }

  private closeBlock(t: string): boolean {
    if (!/^\}\s*$/.test(t) && !/^end\s*partition|^end\s*package/i.test(t)) return false;
    if (this.stack.at(-1)?.kind === 'group') this.stack.pop();
    return true;
  }
}

function activity(lines: [string, number][], b: Builder) {
  new ActivityParser(lines, b).run();
}

// ---------------------------------------------------------------- state diagram

const startId = (g?: string) => `start_${g ?? 'root'}`;
const endId = (g?: string) => `end_${g ?? 'root'}`;

class StateParser {
  private readonly scope: string[] = [];
  private readonly alias = new Map<string, string>();
  /** Composite states are groups; found first so an earlier edge to one doesn't create a plain node. */
  private readonly composite = new Set<string>();
  constructor(private readonly lines: [string, number][], private readonly b: Builder) {
    for (const [s] of lines) { const m = /^state\s+(?:"[^"]*"\s+as\s+)?(\w+)\s*(?:<<\w+>>)?\s*\{\s*$/i.exec(s); if (m) this.composite.add(m[1]!); }
  }

  run() {
    const { lines, b } = this;
    for (const [s, ln] of lines) {
      if (!s || s.startsWith("'") || /^(direction|skinparam|hide|title|scale|note|end note)\b/i.test(s)) continue;
      if (!this.statement(s, ln)) b.bad(ln, `Unrecognised state statement "${s.slice(0, 40)}". Use "A --> B : event", "[*] --> A", "state X { ... }".`);
    }
    if (this.scope.length) b.bad(lines.length ? lines.at(-1)![1] : 1, `State "${this.scope.at(-1)}" is never closed with "}".`);
    retargetGroups(b);
    uniqueFlowIds(b);
  }

  private statement(s: string, ln: number): boolean {
    return this.aliased(s) || this.declared(s) || this.closeScope(s, ln)
      || s === '--' || s === '||' // concurrent regions: drawn as one group
      || this.transition(s, ln) || this.description(s);
  }

  private cur() { return this.scope.at(-1); }
  private ref(raw: string, ln: number): string {
    const t = raw.trim();
    if (t === '[*]') return '[*]';
    const id = this.alias.get(t) ?? slug(t.replace(/^"|"$/g, ''));
    if (!id) this.b.bad(ln, `"${raw}" cannot be used as a state name.`);
    return id;
  }
  private ensure(id: string, asTarget: boolean): string {
    const { b } = this;
    if (id === '[*]') {
      const g = this.cur();
      const pid = asTarget ? endId(g) : startId(g);
      b.node(pid, asTarget ? 'End' : 'Start', asTarget ? 'end' : 'start', g);
      return pid;
    }
    if (!b.nodes.has(id) && !this.composite.has(id)) b.node(id, id.replaceAll('_', ' '), 'round', this.cur());
    return id;
  }

  private aliased(s: string): boolean {
    const m = /^state\s+"([^"]*)"\s+as\s+(\w+)(?:\s*<<(\w+)>>)?\s*(\{)?$/i.exec(s);
    if (!m) return false;
    this.alias.set(m[2]!, m[2]!);
    if (m[4]) { this.b.group(m[2]!, clean(m[1]!), this.cur()); this.scope.push(m[2]!); }
    else this.b.node(m[2]!, clean(m[1]!), m[3] ? stereo(m[3]) : 'round', this.cur());
    return true;
  }

  private declared(s: string): boolean {
    const m = /^state\s+(\w+)(?:\s*<<(\w+)>>)?\s*(\{)?$/i.exec(s);
    if (!m) return false;
    if (m[3]) { this.b.group(m[1]!, m[1]!.replaceAll('_', ' '), this.cur()); this.scope.push(m[1]!); }
    else this.b.node(m[1]!, m[2] ? '' : m[1]!.replaceAll('_', ' '), m[2] ? stereo(m[2]) : 'round', this.cur());
    return true;
  }

  private closeScope(s: string, ln: number): boolean {
    if (s !== '}') return false;
    if (this.scope.length) this.scope.pop();
    else this.b.bad(ln, 'Unmatched "}".');
    return true;
  }

  private transition(s: string, ln: number): boolean {
    const m = /^(\[\*\]|[\w"]+)\s*([-.=]+>)\s*(\[\*\]|[\w"]+)(?:\s*:(.*))?$/.exec(s);
    if (!m) return false;
    const a = this.ensure(this.ref(m[1]!, ln), false), z = this.ensure(this.ref(m[3]!, ln), true);
    this.b.link(a, z, { text: clean(m[4] ?? '') || undefined, line: m[2]!.startsWith('.') ? 'dotted' : undefined });
    return true;
  }

  /** `A : text` adds a description line to state A. */
  private description(s: string): boolean {
    const m = /^(\w+)\s*:(.+)$/.exec(s);
    if (!m) return false;
    const n = this.b.nodes.get(this.ensure(m[1]!, false))!;
    n.lines = [...(n.lines ?? []), clean(m[2]!)];
    if (!n.shape || n.shape === 'round') n.shape = 'class';
    return true;
  }
}

/** A state with a `{ }` body is a group: edges to it would need a node. Retarget to its start/first child. */
function retargetGroups(b: Builder) {
  for (const g of b.groups.keys()) {
    const inner = [...b.nodes.values()].find((n) => n.group === g);
    const pick = (own: string, fallback: string) => (b.nodes.has(own) ? own : inner?.id ?? fallback);
    for (const f of b.flows) {
      if (f.to === g) f.to = pick(startId(g), f.to);
      if (f.from === g) f.from = pick(endId(g), f.from);
    }
  }
}

function uniqueFlowIds(b: Builder) {
  b.flows.forEach((f) => { f.id = `${f.from}_${f.to}`; });
  const seen = new Set<string>();
  b.flows.forEach((f) => {
    let id = f.id, k = 1;
    while (seen.has(id)) id = `${f.id}_${++k}`;
    seen.add(id);
    f.id = id;
  });
}

function state(lines: [string, number][], b: Builder) {
  new StateParser(lines, b).run();
}
function stereo(s: string): Shape {
  if (/choice/i.test(s)) return 'diamond';
  return /fork|join/i.test(s) ? 'bar' : 'round';
}

// ---------------------------------------------------------------- class diagram

const DECO: Record<string, End> = { '<|': 'triangle', '|>': 'triangle', '*': 'diamond-filled', o: 'diamond' };
const REL = /^(\w+)\s*(?:"([^"]*)")?\s*((?:<\|?|\*|o|<|\|>|>)?)(-+|\.+)((?:\|>|\*|o|>|<)?)\s*(?:"([^"]*)")?\s*(\w+)\s*(?::\s*(.*))?$/;
const CLASS_SKIP = /^(direction|skinparam|hide|show|title|note|namespace|package|set)\b/i;
const deco = (tok?: string): End | undefined => (tok ? DECO[tok] ?? 'arrow' : undefined);

class ClassParser {
  private open: NodeDef | undefined;
  constructor(private readonly lines: [string, number][], private readonly b: Builder) {}

  run() {
    for (const [s, ln] of this.lines) {
      if (!s || s.startsWith("'") || s.startsWith('%%') || CLASS_SKIP.test(s)) continue;
      if (this.open) { this.body(s); continue; }
      if (!this.statement(s)) this.b.bad(ln, `Unrecognised class statement "${s.slice(0, 40)}". Use "class A { +field }", "A <|-- B", "A *-- B", "A --> B : label".`);
    }
  }

  private statement(s: string): boolean {
    return this.declaration(s) || this.simpleClass(s) || this.memberLine(s) || this.relation(s) || this.openBrace(s);
  }

  private cls(id: string) {
    const n = this.b.node(id, id, 'class');
    n.lines ??= [];
    return n;
  }
  private member(n: NodeDef, text: string) {
    const t = text.trim();
    if (!t) return;
    const stereotype = /^<<(.+)>>$/.exec(t);
    if (stereotype) { n.label = n.label.replace(/^«.*?»\s*/, ''); n.label = `«${stereotype[1]}» ${n.label}`; return; }
    n.lines!.push(t);
  }
  private body(s: string) {
    if (s === '}') this.open = undefined;
    else this.member(this.open!, s);
  }

  private declaration(s: string): boolean {
    const m = /^(?:(abstract|interface|enum)\s+)?class\s+(\w+)(?:\s*<<(\w+)>>)?\s*(\{)?$/i.exec(s) ?? /^(interface|abstract class|abstract|enum)\s+(\w+)\s*(\{)?$/i.exec(s);
    if (!m) return false;
    const kind = (m[1] && /interface|enum|abstract/i.test(m[1]) ? m[1] : /^(\S+)/.exec(s)![1]!).replace(/\s*class/i, '').toLowerCase();
    const n = this.cls(m[2]!);
    if (['interface', 'abstract', 'enum'].includes(kind) && !n.label.startsWith('«')) n.label = `«${kind}» ${m[2]}`;
    if (/^class$/i.test(m[1] ?? '') === false && m[3] && m.length > 4 && /<</.test(s)) n.label = `«${m[3]}» ${m[2]}`;
    if (/\{\s*$/.test(s)) this.open = n;
    return true;
  }

  private simpleClass(s: string): boolean {
    const m = /^class\s+(\w+)\s*(\{)?$/i.exec(s);
    if (!m) return false;
    const n = this.cls(m[1]!);
    if (m[2]) this.open = n;
    return true;
  }

  private memberLine(s: string): boolean {
    const m = /^(\w+)\s*:(.+)$/.exec(s);
    if (!m || /[-.][-.>|*o]/.test(m[2]!.trimStart().slice(0, 2)) || REL.test(s)) return false;
    this.member(this.cls(m[1]!), m[2]!);
    return true;
  }

  private relation(s: string): boolean {
    const m = /^(\w+)\s*(?:"([^"]*)"\s*)?(<\||\*|o|<|\|>|>)?(--|\.\.)(\|>|\*|o|>|<)?\s*(?:"([^"]*)"\s*)?(\w+)\s*(?::\s*(.*))?$/.exec(s);
    if (!m) return false;
    const [, a, ca, l, body, r, cb, z, label] = m;
    this.cls(a!); this.cls(z!);
    // Arrow points at the end that carries the decoration. Left decoration => reverse so the head lands on `a`.
    const left = deco(l), right = deco(r);
    const text = label ? clean(label.replace(/^[<>]\s*/, '').replace(/[<>]$/, '').trimEnd()) : undefined;
    const line = body === '..' ? 'dotted' : undefined;
    if (left && !right) this.b.link(z!, a!, { text, line, head: left, headLabel: ca, tailLabel: cb });
    else this.b.link(a!, z!, { text, line, head: right ?? 'none', tail: left, headLabel: cb, tailLabel: ca });
    return true;
  }

  private openBrace(s: string): boolean {
    const m = /^(\w+)\s*\{\s*$/.exec(s);
    if (!m) return false;
    this.open = this.cls(m[1]!);
    return true;
  }
}

function classes(lines: [string, number][], b: Builder) {
  new ClassParser(lines, b).run();
}

// ---------------------------------------------------------------- ER diagram

const CARD: Record<string, string> = { '||': '1', '|o': '0..1', 'o|': '0..1', '}o': '0..*', 'o{': '0..*', '}|': '1..*', '|{': '1..*', 'one': '1', 'zero or one': '0..1', 'zero or more': '0..*', 'one or more': '1..*' };

class ErParser {
  private open: NodeDef | undefined;
  constructor(private readonly lines: [string, number][], private readonly b: Builder) {}

  run() {
    for (const [s, ln] of this.lines) {
      if (!s || s.startsWith('%%') || s.startsWith("'") || /^(direction|title|skinparam)\b/i.test(s)) continue;
      if (this.open) { this.attribute(s, ln); continue; }
      if (!(this.openEntity(s) || this.entity(s) || this.relation(s))) this.b.bad(ln, `Unrecognised ER statement "${s.slice(0, 40)}". Use "A ||--o{ B : has" or "ENTITY { type name PK }".`);
    }
  }

  private ent(id: string) { const n = this.b.node(id, id, 'class'); n.lines ??= []; return n; }

  private attribute(s: string, ln: number) {
    if (s === '}') { this.open = undefined; return; }
    const a = /^(\S+)\s+(\S+)\s*(PK|FK|UK)?(?:\s*,\s*(PK|FK|UK))?\s*(?:"([^"]*)")?\s*$/i.exec(s);
    if (!a) { this.b.bad(ln, `Attribute "${s}" should look like "type name PK".`); return; }
    const keys = [a[3], a[4]].filter(Boolean).map((k) => k!.toUpperCase()).join(',');
    this.open!.lines!.push(`${keys ? keys + ' ' : ''}${a[2]}: ${a[1]}`);
  }

  private openEntity(s: string): boolean {
    const m = /^(\w+)\s*\{\s*$/.exec(s);
    if (!m) return false;
    this.open = this.ent(m[1]!);
    return true;
  }

  private entity(s: string): boolean {
    const m = /^entity\s+("[^"]*"|\w+)(?:\s+as\s+(\w+))?\s*(\{)?$/i.exec(s);
    if (!m) return false;
    const id = m[2] ?? slug(m[1]!), n = this.ent(id);
    if (m[2]) n.label = clean(m[1]!);
    if (m[3]) this.open = n;
    return true;
  }

  /** Mermaid and PlantUML share one relation syntax: A ||--o{ B : label */
  private relation(s: string): boolean {
    const m = /^(\w+)\s+([|}o][|o{}])\s*(--|\.\.)\s*([|o{}][|o{}])\s+(\w+)(?:\s*:(.*))?$/.exec(s);
    if (!m) return false;
    const [, a, l, body, r, z, label] = m;
    this.ent(a!); this.ent(z!);
    this.b.link(a!, z!, { text: clean(label ?? '') || undefined, line: body === '..' ? 'dotted' : undefined, head: 'none', tailLabel: CARD[l!] ?? l, headLabel: CARD[flip(r!)] ?? r });
    return true;
  }
}

function er(lines: [string, number][], b: Builder) {
  new ErParser(lines, b).run();
}
const flip = (t: string) => ({ '|{': '|{', 'o{': 'o{', '||': '||', 'o|': 'o|', '|o': 'o|', '{o': 'o{', '{|': '|{' } as Record<string, string>)[t] ?? t;

// ---------------------------------------------------------------- mindmap

const WRAP = /^(\w+)?(?:\(\((.*)\)\)|\(\)(.*)\(\)|\{\{(.*)\}\}|\[(.*)\]|\((.*)\))$/;

/** PlantUML bullet: `**[#red]_ text` => depth 1. */
function plantBullet(line: string): { depth: number; text: string } | undefined {
  const lead = /^[*+-]+/.exec(line)?.[0];
  if (!lead) return undefined;
  let body = line.slice(lead.length);
  const colour = /^\[#\w+\]/.exec(body);
  if (colour) body = body.slice(colour[0].length);
  body = body.trimStart();
  return { depth: lead.length - 1, text: (body.startsWith('_') ? body.slice(1) : body).trimStart() };
}

/** Depth and text of one source line, or undefined for blank/comment lines. */
function mindmapLine(raw: string, plant: boolean): { depth: number; text: string } | undefined {
  const t0 = raw.replaceAll('\t', '  ');
  const trimmed = t0.trim();
  if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith("'")) return undefined;
  const bullet = plant ? plantBullet(trimmed) : undefined;
  return bullet ?? { depth: Math.floor((/^ */.exec(t0)![0]).length / 2), text: trimmed };
}

/** Mermaid shape wrappers: id((text)), id(text), id[text], id{{text}}. */
function unwrapShape(text: string, depth: number): { text: string; shape: Shape } {
  const shape: Shape = depth === 0 ? 'circle' : 'round';
  const w = WRAP.exec(text);
  if (!w) return { text, shape };
  const inner = w[2] ?? w[3] ?? w[4] ?? w[5] ?? w[6] ?? text;
  if (w[4] !== undefined) return { text: inner, shape: 'hexagon' };
  if (w[5] !== undefined) return { text: inner, shape: 'rect' };
  return { text: inner, shape: w[2] === undefined ? 'round' : shape };
}

function mindmap(lines: [string, number][], b: Builder, plant: boolean) {
  const stack: { depth: number; id: string }[] = [];
  let k = 0;
  for (const [raw, ln] of lines) {
    const parsed = mindmapLine(raw, plant);
    if (!parsed || parsed.text.startsWith('::')) continue; // ::icon lines
    const { depth } = parsed;
    const unwrapped = unwrapShape(parsed.text, depth);
    const text = clean(unwrapped.text.replace(/^\s*:\s*/, '').replace(/;\s*$/, '').trimEnd());
    if (!text) continue;
    while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
    if (!stack.length && depth > 0 && b.nodes.size) { b.bad(ln, 'Mind map has more than one root. Use one top-level item.'); continue; }
    const id = `n${++k}`;
    b.node(id, text, unwrapped.shape);
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
  const lasts = /^(?:lasts|requires)\s+(\S.*)$/i.exec(clause);
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

const MERMAID_SKIP = /^(dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday|weekend|accTitle|accDescr|click)\b/i;
const PLANT_SKIP_CALENDAR = /^(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|\d{4}-\d{2}-\d{2})\b.*\b(?:are|is)\s+(?:closed|open)/i;
const PLANT_SKIP_STYLE = /^(?:language|printscale|scale|hide|today|Project scale|footer|header|legend)\b/i;

/** Mermaid task parts: `[id,] [start,] end` after any leading status tags. */
function splitTaskParts(parts: string[]): [string | undefined, string | undefined, string | undefined] {
  if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  if (parts.length === 2) return [undefined, parts[0], parts[1]];
  if (parts.length === 1) return [undefined, undefined, parts[0]];
  return [undefined, undefined, undefined];
}

class GanttParser {
  readonly specs: TaskSpec[] = [];
  private readonly byKey = new Map<string, TaskSpec>(); // id (Mermaid) or name (PlantUML)
  private section: string | undefined;
  private title: string | undefined;
  private projectStart: number | undefined;
  constructor(private readonly b: Builder, private readonly plant: boolean) {}

  line(s: string, ln: number) {
    if (this.plant) this.plantLine(s, ln);
    else this.mermaidLine(s, ln);
  }

  private sectionId(name: string) {
    const id = 'sec_' + slug(name);
    if (!this.b.groups.has(id)) this.b.group(id, name);
    return id;
  }

  private task = (key: string, label: string): TaskSpec => {
    let t = this.byKey.get(key);
    if (!t) {
      t = { id: slug(key), label, section: this.section };
      if (this.specs.some((x) => x.id === t!.id)) t.id += this.specs.length;
      this.specs.push(t);
      this.byKey.set(key, t);
    }
    return t;
  };

  private mermaidLine(s: string, ln: number) {
    const title = /^title\s(.+)$/i.exec(s);
    if (title) { this.title = clean(title[1]!); return; }
    const section = /^section\s(.+)$/i.exec(s);
    if (section) { this.section = this.sectionId(clean(section[1]!)); return; }
    if (MERMAID_SKIP.test(s)) return;
    this.mermaidTask(s, ln);
  }

  private mermaidTask(s: string, ln: number) {
    const { b, specs } = this;
    const k = s.indexOf(':');
    if (k < 0) { b.bad(ln, `Expected "Task name : id, start, duration".`); return; }
    const label = clean(s.slice(0, k)), parts = s.slice(k + 1).split(',').map((x) => x.trim()).filter(Boolean);
    const t: TaskSpec = { id: `t${specs.length + 1}`, label, section: this.section };
    while (parts.length && /^(done|active|crit|milestone)$/i.test(parts[0]!)) {
      const tag = parts.shift()!.toLowerCase();
      if (tag === 'milestone') t.milestone = true; else t.status = tag as TaskSpec['status'];
    }
    const [id, start, end] = splitTaskParts(parts);
    if (id) t.id = slug(id);
    if (specs.some((x) => x.id === t.id)) { b.bad(ln, `Duplicate task id "${t.id}".`); return; }
    if (start && !this.applyStart(t, start, ln)) return;
    if (end && !this.applyEnd(t, end, ln)) return;
    if (t.milestone) t.dur = 0;
    specs.push(t); this.byKey.set(t.id, t);
  }

  private applyStart(t: TaskSpec, start: string, ln: number): boolean {
    const after = /^after\s+(\S.*)$/i.exec(start);
    if (after) { t.after = after[1]!.split(/\s+/).map(slug); return true; }
    const d = toDay(start);
    if (d === undefined) { this.b.bad(ln, `Start "${start}" is not a date (YYYY-MM-DD) or "after <id>".`); return false; }
    t.date = d;
    return true;
  }

  private applyEnd(t: TaskSpec, end: string, ln: number): boolean {
    const d = toDay(end);
    if (d !== undefined) { t.endDate = d; return true; }
    const u = durDays(end);
    if (u === undefined) { this.b.bad(ln, `"${end}" is not a duration like 5d, 2w or a date.`); return false; }
    t.dur = u;
    return true;
  }

  private plantLine(s: string, ln: number) {
    if (PLANT_SKIP_CALENDAR.test(s) || PLANT_SKIP_STYLE.test(s)) return;
    if (this.plantMeta(s) || this.plantTask(s, ln)) return;
    this.b.bad(ln, `Unrecognised Gantt statement "${s.slice(0, 40)}".`);
  }

  private plantMeta(s: string): boolean {
    let m = /^title\s(.+)$/i.exec(s);
    if (m) { this.title = clean(m[1]!); return true; }
    m = /^project\s+starts\s+(?:the\s+|on\s+)?(\d{4}-\d{2}-\d{2})/i.exec(s);
    if (m) { this.projectStart = toDay(m[1]!); return true; }
    m = /^--(.*?)--$/.exec(s);
    if (!m) return false;
    this.section = this.sectionId(m[1]!.trim());
    return true;
  }

  private plantTask(s: string, ln: number): boolean {
    const m = /^(then\s+)?\[([^\]]+)\]\s(.*)$/i.exec(s);
    if (!m) return false;
    const t = this.task(m[2]!, m[2]!);
    const rest = m[3]!.trimStart();
    if (m[1]) { const prev = this.specs[this.specs.indexOf(t) - 1]; if (prev) t.after = [prev.id]; }
    if (/^(?:is|are)\s/i.test(rest) || /^as\s/i.test(rest)) return true; // colour, completion, deleted, alias: cosmetic
    for (const clause of rest.split(/\sand\s/i)) plantClause(clause.trim(), t, this.task, this.b, ln);
    return true;
  }

  finish(): GanttDef | undefined {
    const { specs, b } = this;
    if (!specs.length) { b.bad(1, 'Define at least one task.'); return undefined; }
    const origin = this.projectStart ?? specs.find((t) => t.date !== undefined)?.date ?? toDay('2025-01-01')!;
    const resolver = new SpanResolver(specs, origin, b);
    for (const t of specs) resolver.resolve(t);
    const lo = Math.min(...[...resolver.span.values()].map((v) => v.start));
    const tasks: GanttDef['tasks'] = {};
    for (const t of specs) {
      const r = resolver.span.get(t.id)!;
      tasks[t.id] = { start: r.start - lo, end: r.end - lo, ...(t.milestone && { milestone: true }) };
      b.node(t.id, t.label, 'round', t.section);
      if (t.status) b.nodes.get(t.id)!.style = STATUS_STYLE[t.status]!;
      for (const a of t.after ?? []) if (resolver.idIndex.has(a)) b.link(a, t.id);
    }
    return { startDay: lo, tasks, ...(this.title && { title: this.title }) };
  }
}

interface Span { start: number; end: number }

/** Resolves each task's start/end in absolute days, following dependencies. */
class SpanResolver {
  readonly span = new Map<string, Span>();
  readonly idIndex: Map<string, number>;
  private readonly busy = new Set<string>();
  constructor(private readonly specs: TaskSpec[], private readonly origin: number, private readonly b: Builder) {
    this.idIndex = new Map(specs.map((t, i) => [t.id, i]));
  }

  private dep(t: TaskSpec, id: string): Span | undefined {
    const i = this.idIndex.get(id);
    if (i === undefined) { this.b.bad(1, `Task "${t.label}" refers to unknown task "${id}".`); return undefined; }
    return this.resolve(this.specs[i]!);
  }

  private startOf(t: TaskSpec): number {
    if (t.date !== undefined) return t.date;
    if (t.after) return Math.max(this.origin, ...t.after.map((id) => this.dep(t, id)?.end ?? this.origin));
    if (t.startOf) return this.dep(t, t.startOf)?.start ?? this.origin;
    const i = this.specs.indexOf(t);
    return i > 0 ? this.resolve(this.specs[i - 1]!).end : this.origin;
  }

  resolve(t: TaskSpec): Span {
    const hit = this.span.get(t.id);
    if (hit) return hit;
    if (this.busy.has(t.id)) { this.b.bad(1, `Task "${t.label}" depends on itself.`); return { start: this.origin, end: this.origin + 1 }; }
    this.busy.add(t.id);
    const start = this.startOf(t);
    let end = start + (t.dur ?? 1);
    if (t.endDate !== undefined) end = t.endDate + (t.endDate > start ? 1 : 0);
    this.busy.delete(t.id);
    const r = { start, end: Math.max(start, end) };
    this.span.set(t.id, r);
    return r;
  }
}

function gantt(lines: [string, number][], b: Builder, plant: boolean): GanttDef | undefined {
  const parser = new GanttParser(b, plant);
  for (const [s, ln] of lines) {
    if (!s || s.startsWith("'") || s.startsWith('%%')) continue;
    parser.line(s, ln);
  }
  return parser.finish();
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

const C4_SKIP = /^(!|title\b|LAYOUT_|SHOW_|HIDE_|Update\w+|AddElementTag|AddRelTag|skinparam|left to right)/i;
const C4_BOUNDARY = /_Boundary$|^Boundary$|^Deployment_Node$|^Node(_L|_R)?$/i;

function c4Boundary(b: Builder, scope: string[], a: string[], open: boolean) {
  b.group(slug(a[0] ?? 'g'), clean(a[1] ?? a[0] ?? ''), scope.at(-1));
  if (open) scope.push(slug(a[0] ?? 'g'));
}

function c4Rel(b: Builder, fn: string, a: string[], bidirectional: boolean, ln: number) {
  if (a.length < 2) { b.bad(ln, 'Rel needs at least (from, to).'); return; }
  const text = [a[2], a[3] && `[${a[3]}]`].filter(Boolean).join(' ');
  const [from, to] = /Back/i.test(fn) ? [slug(a[1]!), slug(a[0]!)] : [slug(a[0]!), slug(a[1]!)];
  b.link(from, to, { text: text || undefined, tail: bidirectional ? 'arrow' : undefined });
}

function c4StyleKey(kind: string, ext: boolean): string {
  if (kind === 'person') return ext ? 'personExt' : 'person';
  if (ext) return 'ext';
  return kind === 'enterprise' ? 'system' : kind;
}

function c4Element(b: Builder, scope: string[], fn: string, a: string[], ln: number) {
  const k = /^(Person|System|Container|Component|Enterprise|SystemDb|SystemQueue|ContainerDb|ContainerQueue|ComponentDb|ComponentQueue)(_Ext)?$/i.exec(fn);
  if (!k) { b.bad(ln, `Unknown C4 element "${fn}".`); return; }
  const kind = k[1]!.toLowerCase().replace(/db$|queue$/, ''), ext = !!k[2];
  const hasTech = /^(container|component)/.test(kind) || /^(containerdb|containerqueue|componentdb|componentqueue)$/i.test(k[1]!);
  const id = slug(a[0] ?? ''), label = clean(a[1] ?? id);
  const tech = hasTech ? a[2] : undefined, desc = hasTech ? a[3] : a[2];
  const n = b.node(id, label, kind === 'person' ? 'round' : 'rect', scope.at(-1));
  const extra = [tech && `[${clean(tech)}]`, desc && clean(desc)].filter((x): x is string => !!x);
  if (extra.length) n.lines = extra;
  n.style = C4_STYLE[c4StyleKey(kind, ext)] ?? C4_STYLE.system!;
}

function c4(lines: [string, number][], b: Builder) {
  const scope: string[] = [];
  for (const [s, ln] of lines) {
    if (!s || s.startsWith("'") || s.startsWith('%%') || C4_SKIP.test(s)) continue;
    if (s === '}') { scope.pop(); continue; }
    const m = /^(\w+)\s*\((.*)\)\s*(\{)?\s*$/.exec(s);
    if (!m) { b.bad(ln, `Unrecognised C4 statement "${s.slice(0, 40)}". Use Person(id, "Name", "Description"), System(...), Rel(a, b, "label").`); continue; }
    const [, fn, argText, open] = m;
    const a = splitArgs(argText!);
    const rel = /^(Bi)?Rel(_[a-z]+)?$/i.exec(fn!);
    if (C4_BOUNDARY.test(fn!)) c4Boundary(b, scope, a, !!open);
    else if (rel) c4Rel(b, fn!, a, !!rel[1], ln);
    else c4Element(b, scope, fn!, a, ln);
  }
  if (scope.length) b.bad(lines.length ? lines.at(-1)![1] : 1, 'A boundary is never closed with "}".');
}

// ---------------------------------------------------------------- component / deployment / architecture

const ICON_SHAPE: [RegExp, Shape][] = [[/database|disk/, 'cylinder'], [/cloud/, 'round'], [/internet/, 'circle']];
const SHAPE_FOR: Record<string, Shape> = {
  database: 'cylinder', storage: 'cylinder', queue: 'stadium', interface: 'circle', usecase: 'circle',
  cloud: 'round', actor: 'round', boundary: 'round', control: 'round',
};
const EP = String.raw`(\[[^\]]+\]|\(\)\s*(?:"[^"]*"|\w+)|"[^"]+"|\([^)]+\)|\w+)`;
const LINK = new RegExp(String.raw`^${EP}\s*(<)?([-.=]+)(?:\[[^\]]*\])?(?:(?:up|down|left|right|u|d|l|r)[-.]*)?(>|\|>)?\s*${EP}(?:\s*:(.*))?$`);
const CONTAINERS = /^(node|cloud|package|rectangle|folder|frame|database|storage|component|namespace|together)\b/i;
const PLANT_KEYWORDS = /^(component|node|cloud|package|rectangle|folder|frame|database|storage|artifact|queue|interface|actor|usecase|agent|card|boundary|control|entity|collections|namespace)$/i;
const COMPONENT_SKIP = /^(skinparam|title|header|footer|legend|hide|show|note|end note|scale|!)/i;

class ComponentParser {
  private readonly scope: string[] = [];
  constructor(private readonly lines: [string, number][], private readonly b: Builder, private readonly mermaid: boolean) {}

  run() {
    const { lines, b } = this;
    for (const [s, ln] of lines) {
      if (!s || s.startsWith("'") || s.startsWith('%%') || COMPONENT_SKIP.test(s)) continue;
      if (this.closeScope(s, ln)) continue;
      const handled = this.mermaid ? this.architecture(s, ln) : this.plantStatement(s, ln);
      if (!handled) b.bad(ln, this.mermaid
        ? `Unrecognised architecture statement "${s.slice(0, 40)}". Use "group", "service id(icon)[Label] in group", "a:R -- L:b".`
        : `Unrecognised component statement "${s.slice(0, 40)}". Use "component X", "node N { ... }", "[A] --> [B] : label".`);
    }
    if (this.scope.length) b.bad(lines.length ? lines.at(-1)![1] : 1, `"${this.scope.at(-1)}" is never closed with "}".`);
  }

  private cur() { return this.scope.at(-1); }

  private closeScope(s: string, ln: number): boolean {
    if (s !== '}') return false;
    if (this.scope.length) this.scope.pop();
    else this.b.bad(ln, 'Unmatched "}".');
    return true;
  }

  private endpoint(raw: string, ln: number): string {
    const { b } = this;
    const t = raw.trim();
    const shaped = this.shapedEndpoint(t);
    if (shaped) return shaped;
    const id = slug(t.replace(/^"|"$/g, ''));
    if (!b.nodes.has(id) && !b.groups.has(id)) b.node(id, id === t ? t : clean(t), undefined, this.cur());
    if (!id) b.bad(ln, `"${raw}" cannot be used as a name.`);
    return id;
  }

  /** `[name]`, `() name` and `(name)` endpoints; undefined for a plain name. */
  private shapedEndpoint(t: string): string | undefined {
    const forms: [RegExp, Shape | undefined][] = [[/^\[([^\]]+)\]$/, undefined], [/^\(\)\s*"?([^"\s][^"]*)"?$/, 'circle'], [/^\(([^)]+)\)$/, 'stadium']];
    for (const [re, shape] of forms) {
      const m = re.exec(t);
      if (m) { const id = slug(m[1]!); this.b.node(id, clean(m[1]!), shape, this.cur()); return id; }
    }
    return undefined;
  }

  // ---- Mermaid architecture
  private architecture(s: string, ln: number): boolean {
    return this.archGroup(s) || this.archService(s) || this.archLink(s, ln);
  }

  private archGroup(s: string): boolean {
    const m = /^group\s+(\w+)(?:\(([^)]*)\))?(?:\s*\[([^\]]*)\])?(?:\s*in\s+(\w+))?$/i.exec(s);
    if (!m) return false;
    this.b.group(m[1]!, m[3] ?? m[1]!, m[4]);
    return true;
  }

  private archService(s: string): boolean {
    const m = /^(service|junction)\s+(\w+)(?:\(([^)]*)\))?(?:\s*\[([^\]]*)\])?(?:\s*in\s+(\w+))?$/i.exec(s);
    if (!m) return false;
    const junction = m[1]!.toLowerCase() === 'junction';
    const icon = (m[3] ?? '').toLowerCase();
    const shape: Shape | undefined = junction ? 'start' : ICON_SHAPE.find(([re]) => re.test(icon))?.[1];
    this.b.node(m[2]!, junction ? '' : (m[4] ?? m[2]!), shape, m[5]);
    return true;
  }

  private archLink(s: string, ln: number): boolean {
    const m = /^(\w+)(?:\{group\})?:[LRTB]\s*(<)?--(>)?\s*[LRTB]:(\w+)(?:\{group\})?$/i.exec(s);
    if (!m) return false;
    for (const id of [m[1]!, m[4]!]) if (!this.b.nodes.has(id)) this.b.bad(ln, `Unknown service "${id}". Declare it with "service ${id}(icon)[Label]".`);
    this.b.link(m[1]!, m[4]!, { head: m[3] ? 'arrow' : 'none', tail: m[2] ? 'arrow' : undefined });
    return true;
  }

  // ---- PlantUML component / deployment
  private plantStatement(s: string, ln: number): boolean {
    return this.declaration(s) || this.bareComponent(s, ln) || this.aliasedComponent(s) || this.interfaceDecl(s) || this.plantLink(s, ln);
  }

  private declaration(s: string): boolean {
    const m = /^(\w+)\s+("[^"]*"|\[[^\]]+\]|[^\s{]+)((?:[\s{].*)?)$/.exec(s);
    if (!m || !PLANT_KEYWORDS.test(m[1]!)) return false;
    const tail = /^(?:as\s+("[^"]*"|[^\s{"][^\s{]*))?\s*(\{)?$/.exec(m[3]!.replace(/<<[^>]*>>/, '').trim());
    if (!tail) return false;
    const [, kw, a] = m;
    const [, bAs, open] = tail;
    const raw = a!.replace(/^\[|\]$/g, ''), label = clean(raw);
    const id = bAs ? slug(bAs) : slug(raw);
    if (open && CONTAINERS.test(kw!)) { this.b.group(id, label, this.cur()); this.scope.push(id); }
    else this.b.node(id, label, SHAPE_FOR[kw!.toLowerCase()], this.cur());
    return true;
  }

  private bareComponent(s: string, ln: number): boolean {
    if (!/^\[([^\]]+)\]\s*$/.test(s)) return false;
    this.endpoint(s, ln);
    return true;
  }

  private aliasedComponent(s: string): boolean {
    const m = /^\[([^\]]+)\]\s+as\s+(\w+)\s*$/.exec(s);
    if (!m) return false;
    this.b.node(m[2]!, clean(m[1]!), undefined, this.cur());
    return true;
  }

  private interfaceDecl(s: string): boolean {
    const m = /^\(\)\s*("[^"]*"|\w+)(?:\s+as\s+(\w+))?\s*$/.exec(s);
    if (!m) return false;
    this.b.node(m[2] ?? slug(m[1]!), clean(m[1]!), 'circle', this.cur());
    return true;
  }

  private plantLink(s: string, ln: number): boolean {
    const m = LINK.exec(s);
    if (!m) return false;
    const a = this.endpoint(m[1]!, ln), z = this.endpoint(m[5]!, ln);
    this.b.link(a, z, { text: clean(m[6] ?? '') || undefined, line: m[3]!.includes('.') ? 'dotted' : undefined, head: m[4] ? 'arrow' : 'none', tail: m[2] ? 'arrow' : undefined });
    return true;
  }
}

function component(lines: [string, number][], b: Builder, mermaid: boolean) {
  new ComponentParser(lines, b, mermaid).run();
}

// ---------------------------------------------------------------- dispatcher

const HEAD_KINDS: [RegExp, Kind][] = [
  [/^stateDiagram(?:-v2)?\b/i, 'state'],
  [/^classDiagram\b/i, 'class'],
  [/^erDiagram\b/i, 'er'],
  [/^(?:gantt|@startgantt)\b/i, 'gantt'],
  [/^C4(?:Context|Container|Component|Dynamic|Deployment)\b/i, 'c4'],
  [/^architecture(?:-beta)?\b/i, 'component'],
  [/^(?:mindmap|@startmindmap)\b/i, 'mindmap'],
];

/** Which kind a `@startuml` body is, from its statements. */
function sniffUml(rows: string[]): Kind | undefined {
  const body = rows.filter((r) => r && !r.startsWith("'") && !/^@(?:start|end)uml/i.test(r));
  const has = (re: RegExp) => body.some((r) => re.test(r));
  const looksActivity = body.some((r) => /^(start|stop|end|if\s*\(|while\s*\(|repeat\b|fork\b|partition\b|:)/i.test(r) && !/^end\s+(?:note|fork)/i.test(r));
  const looksSequence = body.some((r) => /(?:^(?:participant|actor|class|state|entity)\b|->)/.test(r) && !r.startsWith('->'));
  if (looksActivity && !looksSequence) return 'activity';
  if (has(/^(Person|System|Container|Component|Enterprise)(Db|Queue)?(_Ext)?\(|^!include\s.*C4/i)) return 'c4';
  if (has(/(?:^state\b)|(?:\[\*\])/)) return 'state';
  if (has(/^(class|interface|abstract|enum)\s+\w+/i)) return 'class';
  if (has(/^(component|node|cloud|package|rectangle|folder|frame|database|storage|artifact|queue|usecase)\s+\S+|^\[[^\]]+\]\s*(?:<?[-.]+|as\b)/i) && !has(/^participant\b/i)) return 'component';
  if (has(/^entity\b/i) && has(/[|}o][|o{}]--[|o{}][|o{}]/)) return 'er';
  if (body.some((r) => r.startsWith(':')) && !has(/^\w+\s*-+>/)) return 'activity';
  return undefined;
}

/** Which extra kind, if any, a source is. Returns undefined for flowchart/sequence. */
export function sniffKind(source: string): Kind | undefined {
  const rows = source.split(/\r?\n/).map((r) => r.trim());
  const first = rows.find((r) => r && !r.startsWith('%%') && r !== '---');
  if (!first) return undefined;
  const head = HEAD_KINDS.find(([re]) => re.test(first));
  if (head) return head[1];
  return /^@startuml\b/i.test(first) ? sniffUml(rows) : undefined;
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
