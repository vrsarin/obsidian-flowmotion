import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/model';
import { isTextSource, parseText, TextError } from '../src/text/parse';
import { buildTimeline } from '../src/core/timeline';
import { lintSource } from '../src/schema/validate';

describe('text DSL (Mermaid / PlantUML style)', () => {
  it('detects text vs YAML', () => {
    expect(isTextSource('%% hi\nflowchart LR\n a-->b')).toBe(true);
    expect(isTextSource('graph TD\n a-->b')).toBe(true);
    expect(isTextSource('nodes: []')).toBe(false);
  });
  it('parses Mermaid flowchart syntax: shapes, labels, chains, fan-out', () => {
    const d = parseText(`graph TD
      A[Start] -->|go| B(Work) --> C{Done?}
      C -- yes --> D((End))
      A & B --> E
      classDef x fill:#f00
      style A fill:#fff`);
    expect(d.direction).toBe('TB');
    expect(d.nodes.map((n) => n.label)).toEqual(['Start', 'Work', 'Done?', 'End', 'E']);
    expect(d.flows.find((f) => f.from === 'A' && f.to === 'B')!.payload).toBe('go');
    expect(d.flows.find((f) => f.to === 'D')!.payload).toBe('yes');
    expect(d.flows.filter((f) => f.to === 'E')).toHaveLength(2);
  });
  it('auto-generates a valid animation, joins before processing', () => {
    const tl = buildTimeline(parseText('flowchart LR\n a-->c\n b-->c'));
    const get = (id: string) => tl.items.find((i) => i.id === id)!;
    expect(get('p_c').start).toBe(Math.max(get('t_a_c').end, get('t_b_c').end));
  });
  it('tolerates loops (back edges are drawn but not scheduled)', () => {
    const d = parseText('flowchart LR\n a-->b\n b-->a');
    expect(d.flows).toHaveLength(2);
    expect(d.events.filter((e) => e.type === 'transfer')).toHaveLength(1);
  });
  it('parses sequence diagrams in order', () => {
    const d = parseText('sequenceDiagram\n participant U as User\n U->>S: login\n S-->>U: token');
    expect(d.nodes[0]).toEqual({ id: 'U', label: 'User' });
    expect(d.flows.map((f) => f.payload)).toEqual(['login', 'token']);
    const tl = buildTimeline(d);
    expect(tl.items.find((i) => i.id === 't2')!.start).toBeGreaterThanOrEqual(tl.items.find((i) => i.id === 'p1')!.end);
  });
  it('parses PlantUML', () => {
    const d = parseText('@startuml\ncomponent "Web App" as web\ndatabase db\nweb -> db : query\n@enduml');
    expect(d.nodes).toEqual([{ id: 'web', label: 'Web App' }, { id: 'db', label: 'db', shape: 'cylinder' }]);
    expect(d.flows[0]!.payload).toBe('query');
  });
  it('applies %% @ directives', () => {
    const d = parseText('flowchart LR\n a-->b\n %% @duration b 500\n %% @fail b\n %% @speed 2\n %% @loop off');
    expect(d.events.find((e) => e.id === 'p_b')).toMatchObject({ duration: 500, fail: true });
    expect(d.animation).toMatchObject({ speed: 2, loop: false });
  });
  it('reports every problem with its line number', () => {
    try { parseText('flowchart LR\n a --> \n b[oops\n %% @bogus'); throw new Error('no'); }
    catch (e) { expect(e).toBeInstanceOf(TextError); expect((e as TextError).located.map((p) => p.line)).toEqual([2, 3, 4]); }
  });
  it('lints with source positions and renders end to end', async () => {
    expect(lintSource('flowchart LR\n a-->')[0]).toMatchObject({ severity: 'error' });
    expect(lintSource('flowchart LR\n a-->b')).toEqual([]);
    const m = await buildModel(readFileSync(new URL('../examples/retain.mmd', import.meta.url), 'utf8'));
    expect(m.layout.nodes.length).toBe(7);
  });
});
