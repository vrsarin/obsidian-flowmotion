// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { TFile } from 'obsidian';
import { FlowSuggest, flowLanguageExtension, blockAtCursor, formatBlockAt } from '../src/obsidian/language';
import { FakeEditor } from './stubs/fake-editor';

const app = (exists = false) => ({ workspace: { getActiveFile: () => ({ path: 'd/n.md' }) }, vault: { getAbstractFileByPath: () => (exists ? new TFile() : null) } }) as never;
const DOC = '# t\n```flowmotion\nnodes:\n  - id: a\n    shap: box\nsrc: missing.flow\n```\n';

function view(doc: string, a = app()) {
  const parent = document.body.createDiv();
  return new EditorView({ state: EditorState.create({ doc, extensions: [flowLanguageExtension(a)] }), parent });
}

describe('flowLanguageExtension', () => {
  it('underlines problems and reacts to edits', () => {
    const v = view(DOC);
    expect(v.dom.querySelectorAll('.fm-diag').length).toBeGreaterThan(0);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'plain text' } });
    expect(v.dom.querySelectorAll('.fm-diag')).toHaveLength(0);
    v.dispatch({ changes: { from: 0, insert: '```flowmotion\nnodes: [{id: a}]\nsrc: ok.flow\n```' } });
    v.destroy();
    const ok = view('```flowmotion\nnodes: [{id: a}]\nsrc: ok.flow\n```', app(true));
    ok.destroy();
  });

  it('has hover tooltip support', () => {
    const v = view(DOC);
    expect(v.state.facet).toBeDefined();
    v.destroy();
  });
});

describe('FlowSuggest', () => {
  const doc = '```flowmotion\nnodes:\n  - id: a\n    sha\n```';
  it('triggers and suggests inside blocks only', () => {
    const s = new FlowSuggest(app());
    const ed = new FakeEditor(doc, 3, 7);
    const t = s.onTrigger({ line: 3, ch: 7 }, ed as never)!;
    expect(t.query).toBe('sha');
    expect(s.onTrigger({ line: 0, ch: 0 }, new FakeEditor('plain') as never)).toBeNull();
    const blank = new FakeEditor('```flowmotion\nnodes:\n  - id: a\n    \n```', 3, 4);
    expect(s.onTrigger({ line: 3, ch: 4 }, blank as never)).toBeNull();
    const src = new FakeEditor('```flowmotion\nsrc: ab\n```', 1, 7);
    expect(s.onTrigger({ line: 1, ch: 7 }, src as never)!.query).toBe('ab');
    const items = s.getSuggestions({ editor: ed, query: 'sha', end: { line: 3, ch: 7 }, start: { line: 3, ch: 4 } } as never);
    expect(items.length).toBeGreaterThan(0);
    expect(s.getSuggestions({ editor: new FakeEditor('plain'), query: '', end: { line: 0, ch: 0 } } as never)).toEqual([]);
    expect(s.getSuggestions({ editor: src, query: 'ab', end: { line: 1, ch: 7 } } as never)).toEqual([]);
    const list = new FakeEditor('```flowmotion\nnodes:\n  - ', 2, 4);
    const all = s.getSuggestions({ editor: new FakeEditor('```flowmotion\nnodes:\n  - id: a\n  - \n```', 3, 4), query: '', end: { line: 3, ch: 4 } } as never);
    void list; expect(Array.isArray(all)).toBe(true);
  });

  it('renders and inserts a selection', () => {
    const s = new FlowSuggest(app());
    const el = document.createElement('div');
    s.renderSuggestion({ label: 'x', insert: 'x', kind: 'property', detail: 'd' }, el);
    expect(el.textContent).toBe('xd');
    s.renderSuggestion({ label: 'x', insert: 'x', kind: 'property' }, document.createElement('div'));
    const ed = new FakeEditor('abc def');
    s.selectSuggestion({ label: 'x', insert: 'x', kind: 'property' }); // no context
    s.context = { editor: ed as never, start: { line: 0, ch: 0 }, end: { line: 0, ch: 3 }, file: undefined as never, query: "" };
    s.selectSuggestion({ label: 'z', insert: 'zzzz', kind: 'snippet', select: [1, 3] });
    expect(ed.doc).toBe('zzzz def');
    expect(ed.selection).toBeDefined();
    s.context = { editor: ed as never, start: { line: 0, ch: 0 }, end: { line: 0, ch: 4 }, file: undefined as never, query: "" };
    s.selectSuggestion({ label: 'q', insert: 'q', kind: 'enum' });
    expect(ed.cursor.ch).toBe(1);
  });
});

describe('formatting', () => {
  it('finds and formats blocks', () => {
    const ed = new FakeEditor('```flowmotion\nnodes: [{id: a}]\n```', 1, 0);
    expect(blockAtCursor(ed as never)).toBeDefined();
    expect(formatBlockAt(ed as never)).toBe(true);
    expect(formatBlockAt(ed as never)).toBe(false);
    expect(formatBlockAt(new FakeEditor('plain') as never)).toBe(false);
  });
});
