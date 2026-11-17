import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/model';
import { extractMxfile, isDrawioSource, modelXml, parseDrawio } from '../src/drawio/parse';
import { importDrawio } from '../src/drawio/import';
import { sanitizeSvg, svgEdgeRoutes } from '../src/drawio/sanitize';
import { BLANK_DRAWIO, decodeSvg, isDrawioName } from '../src/obsidian/drawio-pane';
import { renderSvg } from '../src/render/svg';
import { animatedSvg } from '../src/export/html';

const plain = readFileSync(new URL('./fixtures/devops.drawio', import.meta.url), 'utf8');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const asSvg = (mx: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" content="${esc(mx)}"><g/></svg>`;
const model = plain.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)![0];
const compressed = `<mxfile><diagram id="a" name="P">${deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64')}</diagram></mxfile>`;

describe('draw.io import', () => {
  it('reads plain, compressed and SVG-embedded files alike', async () => {
    for (const src of [plain, compressed, asSvg(plain), asSvg(compressed)]) {
      expect(isDrawioSource(src)).toBe(true);
      const cells = await parseDrawio(src);
      expect(cells.filter((c) => c.vertex).length).toBe(6);
      expect(cells.filter((c) => c.edge).length).toBe(3);
    }
    expect(extractMxfile('flowchart LR\n a-->b')).toBeUndefined();
    expect(isDrawioSource('<svg xmlns="x"><g/></svg>')).toBe(false);
  });

  it('maps containers to nested groups, shapes, labels and edges', async () => {
    const d = await importDrawio(plain);
    expect(d.groups.map((g) => g.label)).toEqual(['AWS Cloud', 'Common Layer CodePipeline']);
    expect(d.groups[1]!.parent).toBe(d.groups[0]!.id);
    const build = d.nodes.find((n) => n.label === 'CodeBuild image builder')!;
    expect(build.shape).toBe('round');
    expect(build.style?.fill).toBe('#dae8fc');
    expect(d.nodes.find((n) => n.label === 'Amazon ECR')!.shape).toBe('cylinder');
    expect(d.flows).toHaveLength(3);
    expect(d.flows.find((f) => f.payload === 'push image')!.line).toBe('dotted');
    // Child coordinates are relative to the container: commit sits at 40+20+60.
    expect(d.fixed!.nodes[d.nodes.find((n) => n.label === 'AWS CodeCommit')!.id]!.x).toBe(120);
  });

  it('builds a playable, renderable model through buildModel', async () => {
    const m = await buildModel(asSvg(compressed));
    expect(m.layout.nodes).toHaveLength(4);
    expect(m.layout.edges.every((e) => e.path.points.length >= 2 && e.path.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
    expect(m.timeline.total).toBeGreaterThan(0);
    const svg = renderSvg(m, { idPrefix: 't', theme: 'obsidian' });
    expect(svg).not.toContain('NaN');
  });

  it('rejects damaged or empty files with a clear error', async () => {
    await expect(buildModel('<mxfile><diagram>@@@not-base64@@@</diagram></mxfile>')).rejects.toThrow(/decompress|decode/i);
    await expect(buildModel('<mxfile><diagram><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>')).rejects.toThrow(/no shapes/i);
  });

  it('stops decompression when the output exceeds the size limit', async () => {
    const bomb = deflateRawSync(Buffer.alloc(20_000_001)).toString('base64');
    await expect(modelXml(`<mxfile><diagram>${bomb}</diagram></mxfile>`)).rejects.toThrow(/too large once decompressed/i);
  });
});

describe('draw.io editor glue', () => {
  it('routes only *.drawio.flow files to draw.io', () => {
    expect(isDrawioName('arch.drawio.flow')).toBe(true);
    expect(isDrawioName('Arch.DRAWIO.FLOW')).toBe(true);
    expect(isDrawioName('pipeline.flow')).toBe(false);
    expect(isDrawioName(undefined)).toBe(false);
  });
  it('a new file is a valid draw.io SVG that draw.io and FlowMotion can both read', async () => {
    expect(isDrawioSource(BLANK_DRAWIO)).toBe(true);
    expect((await parseDrawio(BLANK_DRAWIO)).filter((c) => c.vertex)).toHaveLength(0);
  });
  it('decodes the SVG draw.io returns on export, base64 or percent-encoded, and rejects other data', () => {
    const svg = asSvg(plain);
    expect(decodeSvg(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)).toBe(svg);
    expect(decodeSvg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)).toBe(svg);
    expect(decodeSvg('data:text/html;base64,AAAA')).toBeUndefined();
    expect(decodeSvg('not a uri')).toBeUndefined();
  });
});

describe('overlay on a draw.io SVG', () => {
  const svg = readFileSync(new URL('./fixtures/devops-saved.drawio.svg', import.meta.url), 'utf8');
  it('keeps the original drawing and lines up the animation layers with it', async () => {
    const m = await buildModel(svg);
    expect(m.backdrop).toBeTruthy();
    const out = renderSvg(m, { idPrefix: 'x', at: 1500 });
    expect(out).toContain('class="fm-backdrop"');
    expect(out).toContain('AWS CodeCommit');
    expect(out).not.toMatch(/NaN|<script|\son\w+=/);
    // "users" shape drawn at svg (160,0), 60x50 -> same place as the node box once the backdrop shift is applied.
    const n = m.layout.nodes.find((q) => q.id === 'n_users')!;
    expect(n.x - m.backdrop!.ox).toBeCloseTo(160, 0);
    expect(n.y - m.backdrop!.oy).toBeCloseTo(0, 0);
    expect(out).toContain(`id="x-bd-${m.backdrop!.rootId!.slice('fmbd-'.length)}"`);
    expect(out).toContain(`#x-bd-${m.backdrop!.rootId!.slice('fmbd-'.length)}{--ge-adaptive-bg:`);
    expect(animatedSvg(m, 'dark')).toContain('animateMotion');
  });
  it('paper option picks the sheet behind the drawing', async () => {
    const m = await buildModel(svg);
    expect(renderSvg(m, { idPrefix: 'x' })).toContain('fm-paper');
    expect(renderSvg({ ...m, view: { paper: 'none' } }, { idPrefix: 'x' })).not.toContain('fm-paper');
    expect(renderSvg({ ...m, view: { paper: '#f4f1ea' } }, { idPrefix: 'x' })).toContain('#f4f1ea');
    expect(renderSvg({ ...m, view: { paper: 'dark' } }, { idPrefix: 'x' })).toContain('color-scheme:dark');
  });
  it('drops scripts and outside links from the drawing', () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" id="root"><style>body{display:none!important} #root{--ge-adaptive-bg:#fff}</style><script>alert(1)</script><rect onclick="x()" width="5" height="5" style='background-image:image-set("https://e.com/a.png" 1x);fill:url(http://e.com/a)'/><image href="http://e.com/a.png"/></svg>`;
    const r = sanitizeSvg(bad, 'p')!;
    expect(r.inner).not.toMatch(/script|onclick|e\.com/);
    expect(r.inner).not.toContain('body{');
    expect(r.inner).toContain('#p-root{--ge-adaptive-bg:#fff}');
  });
  it('namespaces backdrop ids and fragment references per rendered copy', async () => {
    const m = await buildModel(svg);
    const backdrop = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" id="root" viewBox="0 0 10 10"><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#paint)"/></svg>', 'fmbd')!;
    const modelWithDefs = { ...m, backdrop: { ...m.backdrop!, ...backdrop } };
    const a = renderSvg(modelWithDefs, { idPrefix: 'copy-a' });
    const b = renderSvg(modelWithDefs, { idPrefix: 'copy-b' });
    expect(a).toContain('id="copy-a-bd-paint"');
    expect(a).toContain('fill="url(#copy-a-bd-paint)"');
    expect(b).toContain('id="copy-b-bd-paint"');
    expect(b).toContain('fill="url(#copy-b-bd-paint)"');
  });
  it('applies each SVG group transform once when extracting connector paths', () => {
    const routes = svgEdgeRoutes('<svg><g data-cell-id="e" transform="translate(10 20)"><g transform="translate(3 4)"><path fill="none" d="M1 2 L5 6"/></g></g></svg>');
    expect(routes.get('e')?.[0]).toEqual({ x: 14, y: 26 });
    expect(routes.get('e')?.[1]).toEqual({ x: 18, y: 30 });
  });
});

describe('embed options', () => {
  it('accepts paper next to src, including for .drawio.svg', async () => {
    const { parseEmbed } = await import('../src/core/embed');
    expect(parseEmbed('src: a/b.drawio.flow\npaper: dark')?.view.paper).toBe('dark');
    expect(parseEmbed('src: a/b.drawio.svg\npaper: "#f4f1ea"')?.view.paper).toBe('#f4f1ea');
  });
});
