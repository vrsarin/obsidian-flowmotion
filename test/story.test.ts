import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/model';
import { frameAt } from '../src/render/frame';
import { renderSvg } from '../src/render/svg';

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
});
