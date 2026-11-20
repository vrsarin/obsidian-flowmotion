import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintSource } from '../src/schema';
import { toMonacoSnippet } from '../src/monaco/snippet';

const at = (src: string, i: { from: number; to: number }) => src.slice(i.from, i.to);

describe('lintSource', () => {
  for (const f of readdirSync('examples')) it(`accepts examples/${f}`, () => expect(lintSource(readFileSync(`examples/${f}`, 'utf8'))).toEqual([]));

  it.each([
    ['misspelled key', 'nodes:\n  - { id: a }\nflows: []\nevents:\n  - { id: e, type: process, nod: a }\n', 'did you mean "node"', 'nod'],
    ['bad enum value', 'diagram:\n  direction: UP\nnodes:\n  - { id: a }\n', 'LR, RL, TB, BT', 'UP'],
    ['unknown reference', 'nodes:\n  - { id: a }\nflows:\n  - { id: f, from: a, to: zz }\n', 'unknown node "zz"', 'zz'],
  ])('locates a %s', (_name, src, message, value) => {
    const [i] = lintSource(src);
    expect(i!.message).toContain(message);
    expect(at(src, i!)).toBe(value);
  });
  it('locates an unknown event in after[]', () => {
    const src = 'nodes:\n  - { id: a }\nevents:\n  - { id: e, type: process, node: a, after: [ghost] }\n';
    expect(at(src, lintSource(src)[0]!)).toBe('ghost');
  });
  it('reports YAML syntax errors', () => expect(lintSource('nodes: [a\n')[0]!.message).toMatch(/^YAML/));
  it('validates storyboards', () => {
    const src = 'elements: []\nscenes:\n  - beats:\n      - sai: hi\n';
    expect(lintSource(src, 'storyboard').some((i) => i.message.includes('did you mean "say"'))).toBe(true);
  });
  it('accepts paper in inline diagram definitions', () => {
    expect(lintSource('nodes:\n  - { id: a }\npaper: dark\n')).toEqual([]);
  });
});

import { completeAt } from '../src/schema/complete';
const cursor = (src: string) => { const i = src.indexOf('|'); return completeAt(src.replace('|', ''), i); };
const labels = (r: ReturnType<typeof cursor>) => (r?.suggestions ?? []).map((s) => s.label);

describe('completeAt', () => {
  it('suggests top-level keys not yet used', () => {
    const l = labels(cursor('nodes:\n  - { id: a }\nfl|'));
    expect(l).toContain('flows'); expect(l).not.toContain('nodes');
  });
  it('suggests paper as a view option', () => {
    expect(labels(cursor('nodes:\n  - { id: a }\np|'))).toContain('paper');
  });
  it('suggests event keys inside a list item', () => {
    expect(labels(cursor('nodes:\n  - { id: a }\nevents:\n  - id: e\n    ty|'))).toEqual(expect.arrayContaining(['type', 'node', 'after']));
  });
  it('suggests enum values', () => {
    expect(labels(cursor('nodes:\n  - { id: a }\nevents:\n  - { id: e, type: pr| }'))).toContain('transfer');
  });
  it('suggests node ids for flow endpoints', () => {
    const l = labels(cursor('nodes:\n  - { id: alpha }\n  - { id: beta }\nflows:\n  - { id: f, from: | }'));
    expect(l).toEqual(['alpha', 'beta']);
  });
  it('suggests event ids inside after: []', () => {
    expect(labels(cursor('nodes:\n  - { id: a }\nevents:\n  - { id: e1, type: process, node: a }\n  - { id: e2, type: process, node: a, after: [e|] }'))).toContain('e1');
  });
  it('suggests storyboard keys (JSON style)', () => {
    expect(labels(cursor('{\n "elements": [],\n "sce|"\n}'))).toContain('scenes');
  });
  it('suggests nothing outside a key/value position', () => expect(cursor('nodes:\n  - { id: a }\n# note|')).toBeUndefined());
});

import { docsAt, itemListAt } from '../src/schema/complete';
describe('editor helpers', () => {
  it('gives a fix for a typo', () => expect(lintSource('nodes:\n  - { id: a }\nflos: []\n')[0]!.fix).toBe('flows'));
  it('documents the key under the cursor', () => {
    const src = 'nodes:\n  - { id: a }\nevents:\n  - { id: e, type: process, node: a }\n';
    const d = docsAt(src, src.indexOf('type:') + 1);
    expect(d?.title).toBe('type'); expect(d?.values).toContain('transfer');
  });
  it('knows which list a new item belongs to', () => expect(itemListAt('nodes:\n  - { id: a }\nevents:\n  - ', 38)).toBe('events'));
});

import { definitionAt, renameAt } from '../src/schema/complete';
import { parseStoryboard } from '../src/story/parse';
describe('navigation', () => {
  const src = 'nodes:\n  - { id: a }\n  - { id: b }\nflows:\n  - { id: f, from: a, to: b }\nevents:\n  - { id: t, type: transfer, flow: f }\n  - { id: p, type: process, node: b, after: [t] }\n';
  it('jumps from a reference to its definition', () => {
    const d = definitionAt(src, src.indexOf('flow: f') + 7);
    expect(src.slice(d!.from, d!.to)).toBe('f'); expect(d!.from).toBe(src.indexOf('id: f') + 4);
  });
  it('finds every use of an id for rename, without touching labels', () => {
    const r = renameAt(src, src.indexOf('to: b') + 4)!;
    expect(r.ranges).toHaveLength(3); // def, flow.to, event.node
    expect(renameAt(src, src.indexOf('after: [t]') + 8)!.ranges).toHaveLength(2);
  });
  it('warns about unused nodes', () => {
    const w = lintSource('nodes:\n  - { id: a }\n  - { id: lonely }\nflows:\n  - { id: f, from: a, to: a }\nevents:\n  - { id: t, type: transfer, flow: f }\n');
    expect(w).toHaveLength(1); expect(w[0]!.severity).toBe('warning'); expect(w[0]!.message).toContain('lonely');
  });

  it.each([
    ['card', 'nodes'], ['group', 'groups'], ['arrow', 'arrows'],
  ] as const)('renames %s references in presentation.%s and keeps the storyboard valid', (id, map) => {
    const story = `elements:
  - { id: card, type: rectangle, content: [{ type: title, text: card }] }
  - { id: group, type: group, label: { title: group }, children: [card] }
  - { id: arrow, type: arrow, start: { id: card }, end: { id: group } }
scenes:
  - presentation:
      nodes: { "card": { visible: true } }
      groups: { 'group': { visible: true } }
      arrows: { arrow: { visible: true } }
    beats:
      - { edges: [arrow], light: [card, group], show: { card: [{ text: card }] } }
      - { edges: { edge: arrow } }
`;
    const pos = story.indexOf(`id: ${id}`) + 4;
    const rename = renameAt(story, pos)!;
    const key = story.indexOf('visible: true', story.indexOf(`${map}:`));
    const keyPos = story.lastIndexOf(id, key);
    expect(renameAt(story, keyPos)).toEqual(rename);
    expect(definitionAt(story, keyPos)?.from).toBe(pos);
    const renamed = rename.ranges.sort(([a], [b]) => b - a).reduce((text, [from, to]) => text.slice(0, from) + `${id}-renamed` + text.slice(to), story);
    expect(lintSource(renamed)).toEqual([]);
    const parsed = parseStoryboard(renamed);
    expect(parsed.scenes[0]!.presentation?.[map]?.[`${id}-renamed`]).toEqual({ visible: true });
    expect(parsed.scenes[0]!.presentation?.[map]?.[id]).toBeUndefined();
    expect(parsed.elements[0]!.title).toBe('card');
    expect(parsed.scenes[0]!.beats[0]!.show[id === 'card' ? 'card-renamed' : 'card']?.[0]).toMatchObject({ kind: 'row', text: 'card' });
  });
});

import { parseEmbed, resolveVaultPath } from '../src/core/embed';
describe('embedding files', () => {
  it('parses src with display options', () => expect(parseEmbed('src: ./d.yaml\nheight: 50vh\ncontrols: true\n')).toEqual({ src: './d.yaml', view: { height: '50vh', controls: true } }));
  it('accepts and validates interactive playback for embeds and inline diagrams', () => {
    expect(parseEmbed('src: ./d.flow\ninteractive: true\n')?.view.interactive).toBe(true);
    expect(lintSource('src: ./d.flow\ninteractive: true\n')).toEqual([]);
    expect(lintSource('nodes: [{ id: a }]\ninteractive: true\n')).toEqual([]);
    expect(() => parseEmbed('src: ./d.flow\ninteractive: maybe\n')).toThrow(/interactive: use true or false/);
  });
  it('ignores inline definitions', () => expect(parseEmbed('nodes:\n  - { id: a }\n')).toBeUndefined());
  it('rejects other keys and bad extensions', () => {
    expect(() => parseEmbed('src: ./d.txt\nnodes: []\n')).toThrow(/not allowed/);
    expect(() => parseEmbed('src: ./d.txt\n')).toThrow(/\.flow/);
  });
  it('resolves relative to the note and stays in the vault', () => {
    expect(resolveVaultPath('notes/a', './d.yaml')).toBe('notes/a/d.yaml');
    expect(resolveVaultPath('notes/a', '../d.json')).toBe('notes/d.json');
    expect(resolveVaultPath('notes', '/top/d.yaml')).toBe('top/d.yaml');
    expect(resolveVaultPath('notes', '../../x.yaml')).toBeUndefined();
  });
  it('lints embedding blocks', () => {
    expect(lintSource('src: ./d.yaml\nheight: 50vh\n')).toEqual([]);
    const src = 'src: ./d.yaml\nnodes: []\n';
    const [i] = lintSource(src);
    expect(i!.message).toContain('not allowed'); expect(src.slice(i!.from, i!.to)).toContain('[]');
  });
});

import { FLOW_TEMPLATE } from '../src/core/template';
describe('.flow files', () => {
  it('new-file template is valid', () => expect(lintSource(FLOW_TEMPLATE)).toEqual([]));
  it('can be embedded', () => expect(parseEmbed('src: ./a.flow\n')?.src).toBe('./a.flow'));
});

describe('toMonacoSnippet', () => {
  it('numbers placeholders', () => expect(toMonacoSnippet('a: ${name}\nb: ${}\nc: ${x}')).toBe('a: ${1:name}\nb: $2\nc: ${3:x}'));
  it('leaves plain text alone', () => expect(toMonacoSnippet('id: x')).toBe('id: x'));
});

import { formatSource } from '../src/schema/format';
describe('formatSource', () => {
  it('normalises indentation and spacing, keeping comments', () => {
    const out = formatSource('diagram:\n    id: x\nnodes:\n -   {id: a}\n # note\n - { id: b }\n')!;
    expect(out).toBe('diagram:\n  id: x\nnodes:\n  - { id: a }\n  # note\n  - { id: b }\n');
  });
  it('is idempotent and leaves YAML writer spacing alone', () => {
    const src = 'events:\n  - { id: e, type: process, node: a, after: [ x, y ] }\n';
    expect(formatSource(src)).toBeUndefined();
  });
  it('re-indents JSON', () => expect(formatSource('{"a":[1]}')).toBe('{\n  "a": [\n    1\n  ]\n}\n'));
  it('does not touch text with syntax errors', () => expect(formatSource('nodes: [a\n')).toBeUndefined());
  it('does not format text DSL or alter bracket spacing inside scalar values', () => {
    expect(formatSource('flowchart LR\n  a-->b\n')).toBeUndefined();
    const out = formatSource('label: Keep [ spaces ] here\nother:\n    nested: value\n');
    expect(out).toContain('Keep [ spaces ] here');
  });
});

import { bodyAround, findBlocks } from '../src/schema/blocks';
describe('blocks', () => {
  const doc = 'intro\n```flowmotion\nnodes:\n  - { id: a }\n```\ntext\n~~~~flowmotion\nsrc: x.flow\n~~~~\n```js\nflowmotion\n```\n';
  it('finds flowmotion fences only', () => {
    const b = findBlocks(doc);
    expect(b.map((x) => x.text)).toEqual(['nodes:\n  - { id: a }\n', 'src: x.flow\n']);
    expect(doc.slice(b[0]!.from, b[0]!.to)).toBe(b[0]!.text);
  });
  it('handles an unclosed block', () => expect(findBlocks('```flowmotion\nnodes:').map((x) => x.text)).toEqual(['nodes:']));
  it('locates the cursor inside a body', () => {
    const lines = doc.split('\n');
    const a = bodyAround((i) => lines[i]!, lines.length, 3, 4)!;
    expect(a.text).toBe('nodes:\n  - { id: a }\n'); expect(a.offset).toBe('nodes:\n'.length + 4);
    expect(bodyAround((i) => lines[i]!, lines.length, 5, 0)).toBeUndefined(); // plain text
    expect(bodyAround((i) => lines[i]!, lines.length, 1, 0)).toBeUndefined(); // on the fence
    expect(bodyAround((i) => lines[i]!, lines.length, 10, 0)).toBeUndefined(); // other language
  });
});
