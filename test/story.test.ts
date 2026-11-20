import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/model';
import { frameAt } from '../src/render/frame';
import { renderSvg } from '../src/render/svg';
import { parseStoryboard } from '../src/story/parse';
import { lintSource } from '../src/schema';

const src = readFileSync('examples/hindsight-retain.yaml', 'utf8');

describe('hindsight storyboard', async () => {
  const m = await buildModel(src);
  it('has 10 ordered beats with captions', () => {
    const caps = m.timeline.items.filter((i) => i.type === 'caption');
    expect(caps).toHaveLength(10);
    for (let k = 1; k < caps.length; k++) expect(caps[k]!.start).toBeGreaterThan(caps[k - 1]!.start);
  });
  it('shows exactly one caption at a time and reveals rows', () => {
    const f = frameAt(m, m.timeline.total / 2);
    expect(Object.values(f.captions).filter(Boolean)).toHaveLength(1);
    expect(Object.values(frameAt(m, m.timeline.total - 1).shows).some((v) => v > 0)).toBe(true);
  });
  it('renders static and animated SVG', () => {
    expect(renderSvg(m, { idPrefix: 'a', at: 5000 })).toContain('data-caption');
    expect(renderSvg(m, { idPrefix: 'b', smil: true })).toContain('animateMotion');
  });
});

import { buildModel as buildStoryModel } from '../src/model';
import { renderSvg as renderStorySvg } from '../src/render/svg';
describe('storyboard header and footer', () => {
  const src = JSON.stringify({ title: 't', elements: [{ id: 'a', type: 'rectangle', content: [{ type: 'title', text: 'A' }] }], scenes: [{ label: 'scene', caption: '', beats: [{ say: 'hello caption' }] }] });
  const svg = async (view: object) => { const m = await buildStoryModel(src); return renderStorySvg({ ...m, view }, { idPrefix: 'x', theme: 'dark' }); };
  it('hides the step label and caption by default and crops the space', async () => {
    const off = await svg({}), on = await svg({ header: true, footer: true });
    expect(off).not.toContain('class="fm-step"'); expect(off).not.toContain('hello caption');
    expect(on).toContain('class="fm-step"'); expect(on).toContain('hello caption');
    const h = (s: string) => Number(/viewBox="0 [\d.]+ [\d.]+ ([\d.]+)"/.exec(s)![1]);
    expect(h(off)).toBeLessThan(h(on));
  });
});

describe('short storyboard beats', () => {
  it('renders storyboard arrow line styles and rejects unsupported styles', async () => {
    const source = readFileSync('examples/scene-presentation.flow', 'utf8')
      .replace('    type: arrow\n', '    type: arrow\n    line: dotted\n');
    expect(lintSource(source)).toEqual([]);
    const model = await buildModel(source);
    expect(model.layout.edges.find((edge) => edge.id === 'request')?.line).toBe('dotted');
    expect(renderSvg(model, { idPrefix: 'line' })).toContain('class="fm-edge fm-dotted" data-edge="request"');
    expect(() => parseStoryboard(source.replace('line: dotted', 'line: dashed'))).toThrow(/line: use solid, dotted, or thick/);
  });

  it('reveals rows no later than the end of a beat without transfers', async () => {
    const source = `elements:
  - id: card
    type: rectangle
    content:
      - type: title
        text: Card
scenes:
  - beats:
      - say: short
        ms: 200
        show:
          card:
            - text: Hello
`;
    const m = await buildStoryModel(source);
    expect(m.timeline.items.find((i) => i.type === 'show')?.start).toBe(200);
  });

  describe('scene presentation', async () => {
    const source = readFileSync('examples/scene-presentation.flow', 'utf8');
    const model = await buildModel(source);

    it('accepts the example and keeps packet direction independent of arrowheads', () => {
      expect(lintSource(source)).toEqual([]);
      const packets = model.timeline.items.filter((item) => item.type === 'transfer');
      expect(packets[0]?.back).toBeUndefined();
      expect(packets[1]?.back).toBe(true);
      expect(frameAt(model, 2500).presentation?.arrows?.request?.arrowheads).toBe('both');
      expect(frameAt(model, 2500).packets[packets[1]!.id]).toBeDefined();
      expect(frameAt(model, 7500).packets[packets[3]!.id]).toBeUndefined();
    });

    it('validates references, colors, visibility, opacity, and arrowhead values', () => {
      for (const [invalid, expected] of [
        ['nodes: { missing: { visible: true } }', /unknown node/],
        ['nodes: { client: { fill: "red;display:none" } }', /invalid color/],
        ['nodes: { client: { opacity: 2 } }', /opacity: number 0-1/],
        ['arrows: { request: { arrowheads: sideways } }', /arrowheads: use/],
        ['arrows: { request: { packet: "no" } }', /packet: must be/],
      ]) {
        const base = [
          'elements:',
          '  - { id: client, type: rectangle, content: [{ type: title, text: Client }] }',
          '  - { id: request, type: arrow, start: { id: client }, end: { id: client } }',
          'scenes:',
          `  - presentation: { ${invalid} }`,
          '    beats: [{}]',
        ].join('\n');
        expect(() => parseStoryboard(base)).toThrow(expected);
      }
    });

    it('renders scene defaults, overrides, and reset in static SVG', () => {
      const focus = renderSvg(model, { idPrefix: 'scene', at: 0 });
      expect(focus).toMatch(/data-node="database"[^>]*opacity="0.3"/);
      expect(focus).toMatch(/data-node="client"[^>]*--fm-scene-fill:#e8f4ff/);
      expect(focus).toMatch(/data-edge="request"[^>]*marker-end="url\(#scene-arrow\)"[^>]*marker-start="url\(#scene-arrow\)"/);
      const empty = renderSvg(model, { idPrefix: 'scene', at: 7500 });
      expect(empty).toMatch(/data-node="client"[^>]*opacity="0"/);
      expect(empty).toMatch(/data-group="system" opacity="0"/);
      expect(empty).toMatch(/data-edge-wrap="request" opacity="0"/);
      const reset = renderSvg(model, { idPrefix: 'scene', at: 10000 });
      expect(reset).toMatch(/data-node="database"[^>]*opacity="1"/);
      expect(reset).toMatch(/data-edge="request"[^>]*marker-end="url\(#scene-arrow\)"/);
      expect(reset).not.toMatch(/data-edge="request"[^>]*marker-start=/);
    });

    it('emits scene changes in animated SVG, including marker and visibility changes', () => {
      const svg = renderSvg(model, { idPrefix: 'scene', theme: 'light', smil: true });
      expect(svg).toContain('attributeName="marker-start"');
      expect(svg).toContain('attributeName="marker-end"');
      expect(svg).toContain('attributeName="opacity"');
      expect(svg).toContain('attributeName="fill" attributeType="CSS"');
      expect(svg).toContain('url(#scene-arrow)');
      expect(svg).not.toContain('transition:fill');
    });

    it('uses an animatable transparent group fill when a later scene resets colors', async () => {
      const m = await buildModel(source.replace(
        '      nodes:\n        client:',
        "      groups:\n        system: { fill: '#fef0f0' }\n      nodes:\n        client:",
      ));
      const svg = renderSvg(m, { idPrefix: 'groups', theme: 'light', smil: true });
      expect(svg).toContain('values="#fef0f0;transparent"');
    });

    it('preserves row fades and overlap in animated SVG across scene boundaries', async () => {
      const m = await buildModel(`elements:
  - { id: a, type: rectangle, content: [{ type: title, text: A }] }
scenes:
  - label: First
    presentation: { nodes: { a: { opacity: 0.5 } } }
    beats:
      - ms: 200
        show: { a: [{ text: first }] }
  - label: Second
    beats:
      - ms: 200
        show: { a: [{ text: second }] }
  - label: Third
    beats: [{ ms: 200 }]
`);
      const rows = m.timeline.items.filter((item) => item.type === 'show');
      expect(frameAt(m, 200).shows[rows[0]!.id]).toBe(0);
      expect(frameAt(m, 300).shows[rows[0]!.id]).toBe(0.4);
      expect(frameAt(m, 400).shows[rows[0]!.id]).toBe(0.8);
      expect(frameAt(m, 649).shows[rows[0]!.id]).toBe(1);
      expect(frameAt(m, 650).shows[rows[0]!.id]).toBeUndefined();
      const svg = renderSvg(m, { idPrefix: 'fade', theme: 'light', smil: true });
      expect(svg).toContain('values="0;0;1;1;0;0" keyTimes="0;0.111111111;0.25;0.361111111;0.361111111;1"');
      expect(svg).toContain('data-show="b0.s.a" data-show-node="a" opacity="0.5"');
    });

    it('keeps animated packet timing precise across scenes', () => {
      const firstTransfer = model.timeline.items.find((item) => item.id === 'b0.e0')!;
      const transfer = model.timeline.items.find((item) => item.id === 'b1.e0')!;
      const keyTime = (time: number) => Number((time / model.timeline.total).toFixed(9));
      const svg = renderSvg(model, { idPrefix: 'motion', theme: 'light', smil: true });
      expect(svg).toMatch(new RegExp(`data-packet="b0.e0" opacity="1">.*?<animateMotion[^>]+keyPoints="0;1;1" keyTimes="0;${keyTime(firstTransfer.end)};1"`));
      expect(svg).toContain(`keyPoints="1;1;0;0" keyTimes="0;${keyTime(transfer.start)};${keyTime(transfer.end)};1"`);
      expect(renderSvg(model, { idPrefix: 'live' })).toMatch(/data-packet="b0.e0" opacity="1" transform="translate\(/);
    });

    it('supports all arrowhead positions without changing beat direction', async () => {
      for (const [mode, hasStart, hasEnd] of [
        ['start', true, false], ['end', false, true], ['both', true, true], ['none', false, false],
      ] as const) {
        const m = await buildModel(source.replace('arrowheads: both', `arrowheads: ${mode}`));
        const svg = renderSvg(m, { idPrefix: 'heads', at: 2500 });
        const edge = svg.match(/<path class="fm-edge" data-edge="request"[^>]+>/)?.[0] ?? '';
        expect(edge.includes('marker-start=')).toBe(hasStart);
        expect(edge.includes('marker-end=')).toBe(hasEnd);
        expect(m.timeline.items.find((item) => item.id === 'b1.e0')?.back).toBe(true);
      }
    });

    it('keeps packets independent from connector visibility and highlighting', async () => {
      const m = await buildModel(source.replace(
        'opacity: 1, arrowheads: both, packet: true, highlight: true',
        'visible: false, arrowheads: start, packet: true, highlight: false',
      ));
      const frame = frameAt(m, 100);
      expect(frame.packets['b0.e0']).toBeDefined();
      expect(frame.edges.request).toBeUndefined();
      const svg = renderSvg(m, { idPrefix: 'hidden', at: 100 });
      expect(svg).toContain('data-edge-wrap="request" opacity="0" visibility="hidden"');
      expect(svg).toContain('data-packet="b0.e0" opacity="1"');
    });
  });
});
