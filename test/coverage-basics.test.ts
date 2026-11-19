import { describe, expect, it } from 'vitest';
import { plain } from '../src/core/str';
import { parseView } from '../src/core/view';
import { standaloneHtml, staticSvg, animatedSvg } from '../src/export/html';
import { parseText } from '../src/text/parse';
import { buildModel } from '../src/model';

describe('plain values and view options', () => {
  it('converts primitive and structured values to text', () => {
    expect(plain('hello')).toBe('hello');
    expect(plain(42)).toBe('42');
    expect(plain(false)).toBe('false');
    expect(plain(10n)).toBe('10');
    expect(plain({ a: 1 })).toBe('{"a":1}');
    expect(plain(undefined)).toBe('');
  });

  it('accepts valid view settings and reports invalid settings', () => {
    const errors: string[] = [];
    const view = parseView({
      controls: true, controlsPosition: 'bottom', header: false, footer: true,
      mode: 'fit', paper: '#f4f1ea', height: 500, width: '70%',
    }, (message) => errors.push(message));
    expect(view).toEqual({ controls: true, controlsPosition: 'bottom', header: false, footer: true, mode: 'fit', paper: '#f4f1ea', height: '500px', width: '70%' });
    expect(errors).toEqual([]);

    parseView({ controls: 'yes', controlsPosition: 'side', header: 1, footer: 'yes', mode: 'fill', paper: 'url(x)', height: '0em', width: 'wide' }, (message) => errors.push(message));
    expect(errors).toHaveLength(8);
  });
});

describe('Gantt layout and exports', () => {
  const gantt = `gantt
title Release plan
dateFormat YYYY-MM-DD
section Build
Implement : build, 2026-01-01, 2d
Review : review, after build, 3d
Ship : milestone, ship, 2026-01-06, 0d`;

  it('lays out dated, dependent and milestone tasks with section bands and axis ticks', () => {
    const modelPromise = buildModel(gantt);
    return modelPromise.then((model) => {
      expect(model.layout.nodes).toHaveLength(3);
      expect(model.layout.nodes[2]).toMatchObject({ id: 'ship', shape: 'diamond', w: 26 });
      expect(model.layout.groups).toHaveLength(1);
      expect(model.layout.edges.length).toBeGreaterThan(0);
      expect(model.layout.axis?.title).toBe('Release plan');
      expect(model.layout.axis?.ticks.length).toBeGreaterThan(0);
    });
  });

  it('exports standalone HTML, static SVG and animated SVG', async () => {
    const model = await buildModel('nodes: [{id: a, label: A}, {id: b, label: B}]\nflows: [{id: f, from: a, to: b}]');
    const html = standaloneHtml([model], 'window.FlowMotion={};', '.fm-slot{}', 'Demo', 'dark');
    expect(html).toContain('<title>Demo</title>');
    expect(html).toContain('background:#14181f');
    expect(html).toContain('window.FlowMotion');
    expect(html).toContain('autoplay:params.get');
    expect(staticSvg(model)).toContain('<svg');
    expect(animatedSvg(model, 'dark')).toContain('<animateMotion');
  });

  it('keeps closing tags out of the embedded model JSON', async () => {
    const model = await buildModel('nodes: [{id: a, label: "</script>"}]');
    expect(standaloneHtml([model], '', '')).toContain('\\u003c/script>');
  });

  it('recognizes the Gantt source front end', () => {
    expect(parseText(gantt).gantt?.title).toBe('Release plan');
  });
});
