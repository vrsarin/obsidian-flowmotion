import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/model';
import { staticSvg } from '../src/export/html';
import { parseText } from '../src/text/parse';

const ex = (f: string) => readFileSync(`examples/${f}`, 'utf8');
const shapes = (src: string) => Object.fromEntries(parseText(src).nodes.map((n) => [n.label, n.shape ?? 'rect']));

describe('activity diagrams', () => {
  it('builds start, actions, decisions, forks and stop', () => {
    const d = parseText(ex('activity.puml'));
    const s = d.nodes.map((n) => n.shape);
    expect(s).toContain('start'); expect(s).toContain('end'); expect(s).toContain('diamond'); expect(s).toContain('bar');
    expect(d.flows.some((f) => f.payload === 'yes')).toBe(true);
    expect(d.flows.some((f) => f.payload === 'no')).toBe(true);
    expect(d.events.length).toBeGreaterThan(0);
  });
  it('reports unmatched endif with a line number', () => {
    expect(() => parseText('@startuml\nstart\nendif\n@enduml')).toThrow(/line 3/);
  });
});

describe('state diagrams', () => {
  it('nests composite states as groups and keeps edges attached to nodes', () => {
    const d = parseText(ex('state.mmd'));
    expect(d.groups.map((g) => g.id)).toEqual(['Running']);
    expect(d.nodes.some((n) => n.id === 'Running')).toBe(false);
    for (const f of d.flows) { expect(d.nodes.some((n) => n.id === f.from)).toBe(true); expect(d.nodes.some((n) => n.id === f.to)).toBe(true); }
  });
});

describe('class and ER diagrams', () => {
  it('maps UML relations to line ends and multiplicity', () => {
    const d = parseText(ex('class.mmd'));
    expect(d.flows.find((f) => f.from === 'Dog')?.head).toBe('triangle');
    const own = d.flows.find((f) => f.payload === 'has')!;
    expect(own.head).toBe('diamond-filled');
    expect(shapes(ex('class.mmd')).Animal).toBe('class');
    expect(d.nodes.find((n) => n.id === 'Animal')!.lines).toContain('+eat() void');
    expect(d.animation.autoplay).toBe(false); expect(d.events).toEqual([]);
  });
  it('turns crow-foot tokens into cardinality labels', () => {
    const d = parseText(ex('er.mmd'));
    const f = d.flows.find((x) => x.payload === 'places')!;
    expect(f.tailLabel).toBe('1'); expect(f.headLabel).toBe('0..*');
    expect(d.nodes.find((n) => n.id === 'CUSTOMER')!.lines).toEqual(['PK name: string', 'email: string']);
  });
});

describe('mindmap', () => {
  it('builds a tree from indentation', () => {
    const d = parseText(ex('mindmap.mmd'));
    expect(d.nodes).toHaveLength(7);
    expect(d.flows).toHaveLength(6);
  });
  it('rejects two roots', () => { expect(() => parseText('mindmap\n  A\n  B')).toThrow(/root/); });
});

describe('static rendering of every kind', () => {
  it.each(['activity.puml', 'state.mmd', 'class.mmd', 'er.mmd', 'mindmap.mmd'])('%s renders', async (f) => {
    const svg = staticSvg(await buildModel(ex(f)));
    expect(svg).toContain('<svg'); expect(svg).not.toContain('NaN');
  });
});

describe('complex AWS-style diagram', () => {
  it('nests four levels, keeps every edge on a node and plays through the whole path', async () => {
    const m = await buildModel(ex('aws.mmd'));
    const d = parseText(ex('aws.mmd'));
    expect(d.groups.map((g) => g.id)).toEqual(['region', 'vpc', 'pub', 'priv', 'ecs', 'async']);
    expect(d.nodes.find((n) => n.id === 'orders')!.group).toBe('ecs');
    expect(d.groups.find((g) => g.id === 'ecs')!.parent).toBe('priv');
    expect(m.layout.groups.every((g) => g.w > 0 && g.h > 0)).toBe(true);
    // Every node lies inside the group it belongs to.
    for (const n of m.layout.nodes) {
      const g = m.layout.groups.find((x) => x.id === d.nodes.find((q) => q.id === n.id)!.group);
      if (g) { expect(n.x).toBeGreaterThanOrEqual(g.x); expect(n.x + n.w).toBeLessThanOrEqual(g.x + g.w + 0.5); expect(n.y).toBeGreaterThanOrEqual(g.y); expect(n.y + n.h).toBeLessThanOrEqual(g.y + g.h + 0.5); }
    }
    expect(m.timeline.items.some((i) => i.node === 'notify' && !i.skipped)).toBe(true);
    expect(m.timeline.total).toBeGreaterThan(5000);
  });
});
