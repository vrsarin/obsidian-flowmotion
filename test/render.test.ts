import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/model';
import { frameAt } from '../src/render/frame';
import { renderSvg } from '../src/render/svg';

const ex = (n: string) => readFileSync(new URL(`../examples/${n}.yaml`, import.meta.url), 'utf8');

describe('layout + render', async () => {
  const m = await buildModel(ex('retain-poc'));
  it('lays out nodes without overlap and edges end at nodes', () => {
    const [a, b] = [m.layout.nodes[0]!, m.layout.nodes[1]!];
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    expect(m.layout.edges.every((e) => e.path.length > 10)).toBe(true);
  });
  it('keeps packets inside the viewBox for every workflow', async () => {
    for (const n of ['retain-poc', 'retain', 'recall', 'reflect']) {
      const mm = await buildModel(ex(n));
      for (let t = 0; t < mm.timeline.total; t += 100)
        for (const p of Object.values(frameAt(mm, t).packets)) {
          expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(mm.layout.width);
          expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(mm.layout.height);
        }
    }
  });
  it('moves the Facts packet between the nodes', () => {
    const t = m.timeline.items.find((i) => i.id === 'transfer_facts')!;
    const pk = frameAt(m, (t.start + t.end) / 2).packets.transfer_facts!;
    const [a, b] = [m.layout.nodes.find((n) => n.id === 'extract')!, m.layout.nodes.find((n) => n.id === 'resolve')!];
    expect(pk.x).toBeGreaterThan(a.x + a.w - 1); expect(pk.x).toBeLessThan(b.x + 1);
  });
  it('namespaces ids so multiple diagrams can coexist', () => {
    const a = renderSvg(m, { idPrefix: 'fm1' }), b = renderSvg(m, { idPrefix: 'fm2' });
    expect(a).toContain('id="fm1-arrow"'); expect(b).toContain('id="fm2-arrow"');
    expect(a).not.toContain('fm2');
  });
  it('escapes labels', async () => {
    const mm = await buildModel('nodes: [{id: a, label: "<script>alert(1)</script>"}]');
    const svg = renderSvg(mm, { idPrefix: 'x' });
    expect(svg).not.toContain('<script>'); expect(svg).toContain('&lt;script&gt;');
  });
  it('emits declarative animation for SVG export and refuses non-concrete themes', () => {
    const svg = renderSvg(m, { idPrefix: 'x', smil: true });
    expect(svg).toContain('<animateMotion'); expect(svg).toContain('keyTimes');
    expect(() => renderSvg(m, { idPrefix: 'x', smil: true, theme: 'obsidian' })).toThrow();
  });
});
