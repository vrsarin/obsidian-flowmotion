import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/model';
import { parseText } from '../src/text/parse';
import { parseDiagram } from '../src/core/parse';
import { DiagramError } from '../src/core/types';
import { staticSvg } from '../src/export/html';
import { lintSource } from '../src/schema/validate';

const shapes = readFileSync(new URL('../examples/shapes.mmd', import.meta.url), 'utf8');

describe('text DSL: static features', () => {
  it('maps bracket syntax to shapes (labels may contain parentheses)', () => {
    const d = parseText('flowchart LR\n a[Run (fast)] --> b(Round) --> c([Pill]) --> d((Dot)) --> e{Ask} --> f{{Hex}} --> g[[Sub]] --> h[(DB)] --> i[/Slant/]');
    expect(d.nodes.map((n) => [n.label, n.shape])).toEqual([
      ['Run (fast)', undefined], ['Round', 'round'], ['Pill', 'stadium'], ['Dot', 'circle'], ['Ask', 'diamond'],
      ['Hex', 'hexagon'], ['Sub', 'subroutine'], ['DB', 'cylinder'], ['Slant', 'parallelogram'],
    ]);
  });
  it('reads line styles and arrow ends', () => {
    const d = parseText('flowchart LR\n a --> b\n a --- c\n a -.-> d\n a ==> e\n a --x f\n a --o g\n a <--> h\n i <-- a');
    const by = (to: string) => d.flows.find((f) => f.to === to)!;
    expect(by('b')).not.toHaveProperty('line');
    expect(by('c').head).toBe('none');
    expect(by('d').line).toBe('dotted');
    expect(by('e').line).toBe('thick');
    expect(by('f').head).toBe('cross');
    expect(by('g').head).toBe('circle');
    expect(by('h').tail).toBe('arrow');
    expect(d.flows.find((f) => f.from === 'a' && f.to === 'i')).toBeTruthy(); // "i <-- a" points from a... reversed
  });
  it('builds nested subgraphs and assigns nodes to them', () => {
    const d = parseText('flowchart TB\n subgraph outer [Outer]\n  subgraph inner\n   a\n  end\n  b\n end\n c');
    expect(d.groups).toEqual([{ id: 'outer', label: 'Outer' }, { id: 'inner', label: 'inner', parent: 'outer' }]);
    expect(d.nodes.map((n) => n.group)).toEqual(['inner', 'outer', undefined]);
  });
  it('reports unclosed subgraphs and edges to subgraphs', () => {
    expect(() => parseText('flowchart LR\n subgraph s\n a')).toThrow(/never closed/);
    expect(() => parseText('flowchart LR\n subgraph s\n a\n end\n b --> s')).toThrow(/connecting to a subgraph/);
  });
  it('applies classDef, class, :::, style and linkStyle with the right precedence', () => {
    const d = parseText('flowchart LR\n a --> b:::hot --> c\n classDef hot fill:#f00,stroke:#a00\n classDef default fill:#eee\n class c hot\n style b stroke:#00f\n linkStyle 0 stroke:#0a0,stroke-width:3px');
    const n = (id: string) => d.nodes.find((x) => x.id === id)!.style;
    expect(n('a')).toEqual({ fill: '#eee' });
    expect(n('b')).toEqual({ fill: '#f00', stroke: '#00f' });
    expect(n('c')).toEqual({ fill: '#f00', stroke: '#a00' });
    expect(d.flows[0]!.style).toEqual({ stroke: '#0a0', strokeWidth: 3 });
  });
  it('drops unsafe colours instead of passing them to SVG', async () => {
    const m = await buildModel('flowchart LR\n a --> b\n style a fill:red"onload="x,stroke:url(javascript:1)');
    expect(m.layout.nodes[0]!.style).toBeUndefined();
    expect(staticSvg(m)).not.toMatch(/onload|javascript/);
  });
});

describe('layout and rendering', () => {
  it('keeps grouped nodes inside their group and edges attached to nodes', async () => {
    const m = await buildModel(shapes);
    const g = (id: string) => m.layout.groups.find((x) => x.id === id)!;
    const n = (id: string) => m.layout.nodes.find((x) => x.id === id)!;
    for (const [node, group] of [['api', 'platform'], ['db', 'data'], ['cache', 'data'], ['data', 'platform']] as const) {
      const a = node === 'data' ? g('data') : n(node), b = g(group);
      expect(a.x).toBeGreaterThanOrEqual(b.x); expect(a.y).toBeGreaterThanOrEqual(b.y);
      expect(a.x + a.w).toBeLessThanOrEqual(b.x + b.w); expect(a.y + a.h).toBeLessThanOrEqual(b.y + b.h);
    }
    for (const e of m.layout.edges) {
      const to = n(e.to), last = e.path.points[e.path.points.length - 1]!;
      expect(last.x).toBeGreaterThanOrEqual(to.x - 4); expect(last.x).toBeLessThanOrEqual(to.x + to.w + 4);
      expect(last.y).toBeGreaterThanOrEqual(to.y - 4); expect(last.y).toBeLessThanOrEqual(to.y + to.h + 4);
    }
    expect(m.layout.edges.find((e) => e.id === 'gw_api')!.label?.text).toBe('ok');
  });
  it('renders shapes, line styles, markers and an idle static frame', async () => {
    const svg = staticSvg(await buildModel(shapes));
    expect(svg).toContain('<polygon'); expect(svg).toContain('<ellipse'); expect(svg).toContain('fm-dotted');
    expect(svg).toContain('-cross'); expect(svg).toContain('-circle');
    expect(svg).not.toMatch(/class="fm-node"[^>]*data-state="(completed|processing)"/);
    expect(svg).toContain('stroke-width:3.5'); // ==> thick
  });
  it('leaves existing YAML diagrams unchanged: no edge labels, default shapes', async () => {
    const y = readFileSync(new URL('../examples/retain.yaml', import.meta.url), 'utf8');
    const m = await buildModel(y);
    expect(m.layout.edges.every((e) => !e.label)).toBe(true);
    expect(m.layout.groups).toEqual([]);
  });
});

describe('YAML carries the same static features', () => {
  const y = `
diagram: { id: s, edgeLabels: true }
groups:
  - { id: g, label: Tier }
  - { id: h, parent: g }
nodes:
  - { id: a, shape: diamond, group: h, style: { fill: "#fee", color: red } }
  - { id: b }
flows:
  - { id: f, from: a, to: b, payload: yes, line: dotted, head: circle, tail: arrow, style: { stroke: "#f00", strokeWidth: 2 } }
`;
  it('parses and renders', async () => {
    const d = parseDiagram(y);
    expect(d.groups).toHaveLength(2);
    expect(d.flows[0]).toMatchObject({ line: 'dotted', head: 'circle', tail: 'arrow' });
    const m = await buildModel(y);
    expect(m.layout.groups.map((g) => g.depth)).toEqual([0, 1]);
    expect(lintSource(y)).toEqual([]);
  });
  it('validates references and values', () => {
    expect(() => parseDiagram('nodes: [{id: a, group: nope}]')).toThrow(/unknown group/);
    expect(() => parseDiagram('groups: [{id: g, parent: g}]\nnodes: [{id: a}]')).toThrow(/inside itself/);
    expect(() => parseDiagram('nodes: [{id: a, shape: blob}]')).toThrow(/not one of/);
    expect(() => parseDiagram('nodes: [{id: a, style: {fill: "red;x"}}]')).toThrow(/colour/);
    try { parseDiagram('nodes: [{id: a},{id: b}]\nflows: [{id: f, from: a, to: b, line: wavy}]'); } catch (e) { expect(e).toBeInstanceOf(DiagramError); }
    expect(lintSource('nodes: [{id: a, shape: blob}]').length).toBeGreaterThan(0);
  });
});

describe('YAML without events', () => {
  it('animates the graph automatically', () => {
    const d = parseDiagram('nodes: [{id: a}, {id: b}, {id: c}]\nflows: [{id: f, from: a, to: b}, {id: g, from: b, to: c}]');
    expect(d.events.map((e) => e.id)).toEqual(['p_a', 'p_b', 'p_c', 't_f', 't_g']);
  });
  it('does not warn about unused flows when there is no script', () => {
    expect(lintSource('nodes: [{id: a}, {id: b}]\nflows: [{id: f, from: a, to: b}]')).toEqual([]);
  });
  it('still scripts exactly what is written when events exist', () => {
    const d = parseDiagram('nodes: [{id: a}, {id: b}]\nflows: [{id: f, from: a, to: b}]\nevents: [{id: e, type: process, node: a}]');
    expect(d.events.map((e) => e.id)).toEqual(['e']);
  });
});
