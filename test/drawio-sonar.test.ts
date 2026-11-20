import { describe, expect, it } from 'vitest';
import { importDrawio } from '../src/drawio/import';
import { parseXml, parseDrawio, unescapeXml } from '../src/drawio/parse';
import { namespaceSanitizedSvg, sanitizeSvg } from '../src/drawio/sanitize';

describe('draw.io parsing and sanitization regressions', () => {
  it('handles XML declarations, comments, CDATA and quoted attributes', () => {
    const doc = parseXml(`<?xml version="1.0"?><!DOCTYPE svg><!--x--><svg id='a&gt;b'><text><![CDATA[<hello>]]>&amp;&#x1f600;</text><path d="M1 > 0" /></svg>`);
    const svg = doc.children[0]!;
    expect(svg.attrs.id).toBe('a>b');
    expect(svg.children[0]!.children.map((n) => n.text)).toEqual(['<hello>', '&😀']);
    expect(svg.children[1]!.attrs.d).toBe('M1 > 0');
    expect(unescapeXml('&#0; &#x110000; &unknown;')).toBe('&#0; &#x110000; &unknown;');
  });

  it('imports wrappers, colliding IDs, nested offsets and duplicate edges', async () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="g" vertex="1"><mxGeometry x="10" y="20" width="100" height="100"/></mxCell>
      <object id="a-b" label="Wrapped"><mxCell vertex="1" parent="g"><mxGeometry x="2" y="3" width="10" height="10"/></mxCell></object>
      <UserObject id="a_b" label="Other"><mxCell vertex="1"><mxGeometry width="10" height="10"/></mxCell></UserObject>
      <mxCell id="e1" edge="1" source="g" target="a_b" parent="g"><mxGeometry><Array><mxPoint x="4" y="5"/></Array></mxGeometry></mxCell>
      <mxCell id="e2" edge="1" source="a-b" target="a_b"/>
    </root></mxGraphModel>`;
    expect((await parseDrawio(xml)).find((c) => c.id === 'a-b')?.value).toBe('Wrapped');
    const diagram = await importDrawio(xml);
    expect(diagram.nodes.map((n) => n.id)).toEqual(['n_a_b', 'n_a_b_2']);
    expect(diagram.flows.map((f) => f.id)).toEqual(['n_a_b__n_a_b_2', 'n_a_b__n_a_b_2_2']);
    expect(diagram.fixed!.nodes.n_a_b).toEqual({ x: 12, y: 23, w: 10, h: 10 });
    expect(diagram.fixed!.routes.n_a_b__n_a_b_2).toEqual([{ x: 14, y: 25 }]);
  });

  it('retains safe SVG references and blocks external or malformed data references', () => {
    const svg = `<svg id="root" viewBox="0 0 10 10"><style>#root{--ge-adaptive-bg:rgb(1,2,3)}</style><defs><clipPath id="clip"><rect/></clipPath></defs><rect id="r" clip-path="url('#clip')" aria-labelledby="r clip"/><image href="data:image/png;base64,AB+/="/><image href="data:image/png;base64,AB_"/><foreignObject><div><br/></div></foreignObject></svg>`;
    const clean = sanitizeSvg(svg, 'a.b')!;
    expect(clean.inner).toContain('#a.b-root{--ge-adaptive-bg:rgb(1,2,3)}');
    expect(clean.inner).toContain('clip-path="url(#a.b-clip)"');
    expect(clean.inner).toContain('aria-labelledby="a.b-r a.b-clip"');
    expect(clean.inner).toContain('href="data:image/png;base64,AB+/="');
    expect(clean.inner).not.toContain('AB_');
    expect(clean.inner).toContain('<div xmlns="http://www.w3.org/1999/xhtml"><br/></div>');
    const renamed = namespaceSanitizedSvg(clean.inner, 'a.b', 'copy');
    expect(renamed).toContain('clip-path="url(#copy-clip)"');
    expect(renamed).toContain('aria-labelledby="copy-r copy-clip"');
    expect(renamed).toContain('#copy-root{--ge-adaptive-bg:rgb(1,2,3)}');
  });
});
