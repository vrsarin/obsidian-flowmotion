import { describe, expect, it } from 'vitest';
import { isTextSource, parseText, TextError } from '../src/text/parse';

describe('text parser regression cases', () => {
  it('recognizes headers only on the first meaningful line', () => {
    expect(isTextSource('%% comment\narchitecture-beta')).toBe(true);
    expect(isTextSource('---\nflowchart LR')).toBe(false);
    expect(isTextSource('not a header\nflowchart LR')).toBe(false);
  });

  it('preserves labels on fan-out, chained, reversed and dotted edges', () => {
    const diagram = parseText('flowchart LR\n a & b -->|first| c & d --> e : last\n f <-- e\n g -.-> h');
    expect(diagram.flows.map(({ from, to, payload, line }) => [from, to, payload, line])).toEqual([
      ['a', 'c', 'first', undefined], ['a', 'd', 'first', undefined],
      ['b', 'c', 'first', undefined], ['b', 'd', 'first', undefined],
      ['c', 'e', 'last', undefined], ['d', 'e', 'last', undefined],
      ['e', 'f', undefined, undefined], ['g', 'h', undefined, 'dotted'],
    ]);
  });

  it('handles nested groups, style precedence and safe click links', () => {
    const diagram = parseText(`flowchart LR
subgraph outer [Outer]
  subgraph inner
    a["Line\\nOne"] --> b:::hot
  end
end
classDef default fill:#eee
classDef hot fill:#f00
style b stroke:#00f
linkStyle default stroke:#123
click b href "https://example.com" "Tip" _blank`);
    expect(diagram.groups).toEqual([{ id: 'outer', label: 'Outer' }, { id: 'inner', label: 'inner', parent: 'outer' }]);
    expect(diagram.nodes).toEqual([
      { id: 'a', label: 'Line One', group: 'inner', style: { fill: '#eee' } },
      { id: 'b', label: 'b', group: 'inner', style: { fill: '#f00', stroke: '#00f' }, href: 'https://example.com', tooltip: 'Tip' },
    ]);
    expect(diagram.flows[0]!.style).toEqual({ stroke: '#123' });
  });

  it('retains directive and post-processing error order', () => {
    try {
      parseText('flowchart LR\n a --> b\n %% @duration missing 20\n %% @fail nope');
      throw new Error('expected parse error');
    } catch (error) {
      expect(error).toBeInstanceOf(TextError);
      expect((error as TextError).located.map((problem) => problem.line)).toEqual([3, 4]);
    }
    try {
      parseText('flowchart LR\n a --> b\n click missing href "https://example.com"\n style absent fill:red');
      throw new Error('expected parse error');
    } catch (error) {
      expect(error).toBeInstanceOf(TextError);
      expect((error as TextError).located.map((problem) => problem.line)).toEqual([3, 1]);
    }
  });
});
