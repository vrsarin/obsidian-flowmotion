// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { init, mount, purge } from '../src/monaco/entry';

class Range { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} }
class FakeModel {
  disposed = false; listeners: (() => void)[] = [];
  constructor(public text: string, public uri: any) {}
  getValue() { return this.text; }
  setValue(v: string) { this.text = v; this.listeners.forEach((l) => l()); }
  getOffsetAt(p: { lineNumber: number; column: number }) { const ls = this.text.split('\n'); let o = 0; for (let i = 0; i < p.lineNumber - 1; i++) o += ls[i]!.length + 1; return o + p.column - 1; }
  getPositionAt(o: number) { const b = this.text.slice(0, o).split('\n'); return { lineNumber: b.length, column: b[b.length - 1]!.length + 1 }; }
  getFullModelRange() { return new Range(1, 1, 99, 1); }
  onDidChangeContent(fn: () => void) { this.listeners.push(fn); return { dispose: () => { this.listeners = []; } }; }
  dispose() { this.disposed = true; }
}
const pos = (m: FakeModel, o: number) => m.getPositionAt(o);

function makeMonaco() {
  const providers: Record<string, any> = {};
  const disposed: string[] = [];
  const markers: Record<string, any[]> = {};
  const reg = (name: string) => (_l: string, p: any) => { providers[name] = p; return { dispose: () => disposed.push(name) }; };
  const editorObj = { focus: vi.fn(), layout: vi.fn(), dispose: vi.fn(), getAction: vi.fn(() => ({ run: vi.fn() })) };
  const mo: any = {
    Range, Uri: { parse: (s: string) => s }, MarkerSeverity: { Error: 8, Warning: 4 },
    languages: {
      getLanguages: () => [], register: vi.fn(), setMonarchTokensProvider: vi.fn(), setLanguageConfiguration: vi.fn(),
      CompletionItemKind: { Snippet: 1, Property: 2, EnumMember: 3, Reference: 4 }, CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      SymbolKind: { Class: 1, Method: 2, Event: 3, Object: 4 },
      registerDocumentFormattingEditProvider: reg('format'), registerDocumentRangeFormattingEditProvider: reg('rangeFormat'),
      registerCompletionItemProvider: reg('completion'), registerHoverProvider: reg('hover'), registerDefinitionProvider: reg('definition'),
      registerReferenceProvider: reg('references'), registerRenameProvider: reg('rename'), registerDocumentSymbolProvider: reg('symbols'),
      registerCodeActionProvider: reg('actions'),
    },
    editor: {
      defineTheme: vi.fn(), createModel: (v: string, _l: string, uri: any) => new FakeModel(v, uri),
      create: vi.fn(() => editorObj), setModelMarkers: (_m: any, _o: string, ms: any[]) => { markers.last = ms; },
    },
  };
  return { mo, providers, disposed, markers, editorObj };
}

const DOC = 'nodes:\n  - id: alpha\n    shap: box\nflos: []\nflows:\n  - { id: f, from: alpha, to: alpha }\nsrc: gone.flow\n';

describe('Monaco glue', () => {
  it('registers providers and answers language requests', () => {
    const { mo, providers, markers, disposed, editorObj } = makeMonaco();
    init(mo, { conf: {}, language: {} as never });
    const h = mount(document.createElement('div'), { value: DOC, dark: true, colors: { bg: '#000', fg: '#fff', muted: '#888', border: '#444', accent: '#00f', font: 'x' }, onChange: vi.fn(), fileExists: () => false });
    expect((markers.last as any[]).length).toBeGreaterThan(0);
    const model = (mo.editor.create).mock.calls[0][1].model as FakeModel;
    const P = (o: number) => pos(model, o);
    const at = (needle: string) => DOC.indexOf(needle) + 1;

    expect(providers.format.provideDocumentFormattingEdits(model)).toBeDefined();
    expect(providers.rangeFormat.provideDocumentRangeFormattingEdits(model)).toBeDefined();
    const bad = new FakeModel('{{{', 'u');
    expect(providers.format.provideDocumentFormattingEdits(bad)).toEqual([]);
    for (const o of [at('shap'), at('id: alpha'), DOC.length, 0]) {
      expect(providers.completion.provideCompletionItems(model, P(o))).toHaveProperty('suggestions');
    }
    const empty = new FakeModel('', 'u');
    expect(providers.completion.provideCompletionItems(empty, { lineNumber: 1, column: 1 }).suggestions.some((s: any) => s.label === 'flowmotion diagram')).toBe(true);
    expect(providers.hover.provideHover(model, P(at('nodes')))).toBeTruthy();
    expect(providers.hover.provideHover(model, P(DOC.length))).toBeNull();
    expect(providers.definition.provideDefinition(model, P(at('from: alpha') + 7))).toBeTruthy();
    expect(providers.definition.provideDefinition(model, P(0))).toBeNull();
    expect(providers.references.provideReferences(model, P(at('alpha')))).toBeInstanceOf(Array);
    expect(providers.references.provideReferences(model, P(0))).toEqual([]);
    expect(providers.rename.resolveRenameLocation(model, P(at('alpha')))).toHaveProperty('range');
    expect(providers.rename.resolveRenameLocation(model, P(0)).rejectReason).toBeTruthy();
    expect(providers.rename.provideRenameEdits(model, P(at('alpha')), 'bad name!').rejectReason).toBeTruthy();
    expect(providers.rename.provideRenameEdits(model, P(at('alpha')), 'beta').edits.length).toBeGreaterThan(0);
    expect(providers.rename.provideRenameEdits(model, P(0), 'beta').edits).toEqual([]);
    expect(providers.symbols.provideDocumentSymbols(model).length).toBeGreaterThan(0);
    mount(document.createElement('div'), { value: 'nodes:\n  - { id: a }\nflos: []\n', dark: false, colors: { bg: '', fg: '', muted: '', border: '', accent: '', font: '' }, onChange: vi.fn() });
    const fixModel = (mo.editor.create).mock.calls.at(-1)[1].model as FakeModel;
    const ms = markers.last as any[];
    const fixable = providers.actions.provideCodeActions(fixModel, null, { markers: ms });
    expect(fixable.actions.length).toBeGreaterThan(0);
    fixable.dispose();
    expect(providers.actions.provideCodeActions(model, null, { markers: [] }).actions).toEqual([]);

    // edits notify and re-validate on a timer
    vi.useFakeTimers();
    const onChange = vi.fn();
    const h2 = mount(document.createElement('div'), { value: 'nodes: [{id: a}]', dark: false, colors: { bg: '', fg: '', muted: '', border: '', accent: '', font: '' }, onChange });
    const m2 = (mo.editor.create).mock.calls.at(-1)[1].model as FakeModel;
    m2.setValue('nodes: [{id: b}]');
    h2.setValue('nodes: [{id: c}]');
    m2.text = 'x'; m2.listeners.forEach((l) => l());
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(h2.getValue()).toBe('x');
    h2.focus(); h2.layout(); h2.format();
    expect(editorObj.focus).toHaveBeenCalled();
    h2.dispose(); h2.dispose();
    expect(disposed).toHaveLength(0);
    h.dispose(); purge();
    expect(disposed.length).toBeGreaterThan(0);
    mount(document.createElement('div'), { value: '', dark: false, colors: { bg: '', fg: '', muted: '', border: '', accent: '', font: '' }, onChange: vi.fn() });
    purge();
  });
});
