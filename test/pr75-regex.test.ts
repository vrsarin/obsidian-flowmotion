import { describe, expect, it } from 'vitest';
import { parseXml, plainLabel } from '../src/drawio/parse';
import { parseText } from '../src/text/parse';

describe('untrusted parser input', () => {
  it('preserves XML whitespace, quoted delimiters and recovery from malformed tags', () => {
    const root = parseXml(`<root><bad x="unfinished <ok
      a = 'one > two' b="three &amp; four" />tail</root>`);
    const children = root.children[0]!.children;
    expect(children.map((child) => child.tag)).toEqual(['#text', 'ok', '#text']);
    expect(children[1]!.attrs).toEqual({ a: 'one > two', b: 'three & four' });
  });

  it('handles large malformed XML and labels without repeated rescanning', () => {
    const malformed = '<node a="'.repeat(30_000);
    expect(parseXml(malformed).children).toEqual([]);
    const label = '<a'.repeat(30_000);
    expect(plainLabel(label, true)).toBe(label);
  }, 5000);

  it('preserves click calls, href tooltips and quoted subgraph titles', () => {
    const diagram = parseText(`flowchart LR
subgraph outer [ "Outer title" ]
a --> b
end
click a call handler(one, two) "Call tip"
click b href "https://example.com" "Link tip" _blank`);
    expect(diagram.groups[0]).toMatchObject({ id: 'outer', label: 'Outer title' });
    expect(diagram.nodes[0]).toMatchObject({ id: 'a', tooltip: 'Call tip' });
    expect(diagram.nodes[1]).toMatchObject({ id: 'b', href: 'https://example.com', tooltip: 'Link tip' });
  });

  it('handles long malformed text directives and trailing underscores', () => {
    const spaces = ' '.repeat(60_000);
    expect(() => parseText(`flowchart LR\na --> b\nclick a "${spaces}x`)).toThrow();
    const diagram = parseText(`sequenceDiagram\nparticipant "name${'_'.repeat(60_000)}"`);
    expect(diagram.nodes[0]!.id).toBe('name');
  }, 5000);
});
