import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDiagram } from '../src/core/parse';
import { buildTimeline, nodeStateAt } from '../src/core/timeline';
import { DiagramError } from '../src/core/types';
import { makePath, pointAt } from '../src/core/geometry';

const ex = (n: string) => readFileSync(new URL(`../examples/${n}.yaml`, import.meta.url), 'utf8');
const item = (tl: ReturnType<typeof buildTimeline>, id: string) => tl.items.find((i) => i.id === id)!;

describe('parser', () => {
  it('parses the example workflows', () => {
    for (const n of ['retain-poc', 'retain', 'recall', 'reflect']) expect(parseDiagram(ex(n)).nodes.length).toBeGreaterThan(2);
  });
  it('rejects malformed YAML gracefully', () => {
    expect(() => parseDiagram('nodes: [')).toThrow(DiagramError);
  });
  it('reports unknown references with all problems', () => {
    try {
      parseDiagram('nodes: [{id: a, label: A}]\nflows: [{id: f, from: a, to: zz}]\nevents: [{id: e, type: transfer, flow: nope}]');
      throw new Error('should fail');
    } catch (e) {
      expect(e).toBeInstanceOf(DiagramError);
      expect((e as DiagramError).problems.join()).toMatch(/unknown node "zz"/);
      expect((e as DiagramError).problems.join()).toMatch(/unknown flow "nope"/);
    }
  });
  it('detects dependency cycles', () => {
    const y = 'nodes: [{id: a, label: A}]\nevents:\n - {id: x, type: process, node: a, after: [y]}\n - {id: y, type: process, node: a, after: [x]}';
    expect(() => parseDiagram(y)).toThrow(/cycle/);
  });
  it('enforces limits and id charset', () => {
    expect(() => parseDiagram('nodes: [{id: "a b<", label: A}]')).toThrow(/must match/);
    expect(() => parseDiagram(`nodes: [{id: a, label: "${'x'.repeat(500)}"}]`)).toThrow(/longer than/);
  });
});

describe('scheduler', () => {
  const tl = buildTimeline(parseDiagram(ex('retain-poc')));
  it('starts dependents only after predecessors finish', () => {
    expect(item(tl, 'resolve_entities').start).toBe(item(tl, 'transfer_facts').end);
    expect(item(tl, 'transfer_memories').start).toBe(item(tl, 'resolve_entities').end);
  });
  it('drives node state from events', () => {
    const t = item(tl, 'transfer_facts');
    expect(nodeStateAt(tl, 'extract', 0)).toBe('processing');
    expect(nodeStateAt(tl, 'resolve', t.start + 1)).toBe('receiving');
    expect(nodeStateAt(tl, 'resolve', t.end + 1)).toBe('processing');
    expect(nodeStateAt(tl, 'resolve', item(tl, 'resolve_entities').end + 1)).toBe('completed');
    expect(nodeStateAt(tl, 'store', 0)).toBe('idle');
  });
  it('is deterministic', () => {
    expect(buildTimeline(parseDiagram(ex('recall')))).toEqual(buildTimeline(parseDiagram(ex('recall'))));
  });
  it('runs parallel branches concurrently and joins on the slowest', () => {
    const r = buildTimeline(parseDiagram(ex('recall')));
    const starts = ['t_sem', 't_key', 't_gra', 't_tem'].map((i) => item(r, i).start);
    expect(new Set(starts).size).toBe(1);
    const slowest = Math.max(...['s_sem', 's_key', 's_gra', 's_tem'].map((i) => item(r, i).end));
    expect(item(r, 'j_fusion').start).toBe(slowest);
    expect(item(r, 'p_fusion').start).toBe(slowest);
    expect(nodeStateAt(r, 'fusion', item(r, 'p_query').end + 10)).toBe('waiting');
  });
  it('skips un-selected branch children and their dependents', () => {
    const r = buildTimeline(parseDiagram(ex('reflect')));
    expect(item(r, 't_ans_unused').skipped).toBe(true);
    expect(item(r, 't_more').skipped).toBe(false);
    expect(item(r, 't_ans').skipped).toBe(false);
    expect(item(r, 't_back').end).toBeLessThan(item(r, 'think2').start + 1);
  });
  it('marks failing processes as error', () => {
    const d = parseDiagram('nodes: [{id: a, label: A}]\nevents: [{id: e, type: process, node: a, fail: true, duration: 100}]');
    const f = buildTimeline(d);
    expect(nodeStateAt(f, 'a', 50)).toBe('processing');
    expect(nodeStateAt(f, 'a', 150)).toBe('error');
  });
});

describe('geometry', () => {
  it('moves along the real path by arc length', () => {
    const p = makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    const mid = pointAt(p, 0.5);
    expect(Math.hypot(mid.x - 100, mid.y)).toBeLessThan(8); // near the (rounded) corner
    expect(pointAt(p, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(p, 1)).toEqual({ x: 100, y: 100 });
  });
});

import { relativePath } from '../src/core/embed';
describe('relativePath', () => {
  it('computes src paths from the note folder', () => {
    expect(relativePath('', 'a.flow')).toBe('a.flow');
    expect(relativePath('Tested', 'Tested/x.flow')).toBe('x.flow');
    expect(relativePath('Tested', 'Embed/x.flow')).toBe('../Embed/x.flow');
    expect(relativePath('A/B', 'A/C/x.flow')).toBe('../C/x.flow');
    expect(relativePath('', 'Embed/x.flow')).toBe('Embed/x.flow');
  });
});
