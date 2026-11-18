/* Editor glue. init() receives Monaco from MonacoLoader. */
import type * as monaco from 'monaco-editor/editor/editor.api';
import { ITEM_SNIPPETS, collectScalars, completeAt, definitionAt, docsAt, itemListAt, renameAt } from '../schema/complete';
import { lintSource, srcOf } from '../schema';
import { formatSource } from '../schema/format';
import { FLOW_TEMPLATE } from '../core/template';
import { toMonacoSnippet } from './snippet';

type Monaco = typeof monaco;
export interface YamlDefinition { conf: monaco.languages.LanguageConfiguration; language: monaco.languages.IMonarchLanguage }
let mo: Monaco;
let yaml: YamlDefinition;
/** Gives the glue the Monaco API. Call before mount(). */
export function init(api: Monaco, yamlDefinition: YamlDefinition) { mo = api; yaml = yamlDefinition; }

const OWNER = 'flowmotion';
/** Own language id: the DSL gets its own providers instead of sharing Monaco's generic `yaml`. */
const LANG = 'flowmotion';
const ID_OK = /^[A-Za-z0-9_.-]{1,64}$/;

export interface MountOptions {
  value: string;
  dark: boolean;
  /** CSS colours taken from the Obsidian theme. */
  colors: { bg: string; fg: string; muted: string; border: string; accent: string; font: string };
  onChange(value: string): void;
  /** Does the file named by `src:` exist? undefined = unknown. */
  fileExists?: (path: string) => boolean | undefined;
}
export interface Handle { getValue(): string; setValue(v: string): void; focus(): void; layout(): void; format(): void; dispose(): void }

const fixes = new WeakMap<monaco.editor.ITextModel, Map<string, string>>();
const key = (r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => `${r.startLineNumber}:${r.startColumn}:${r.endLineNumber}:${r.endColumn}`;
const rangeAt = (m: monaco.editor.ITextModel, from: number, to: number) => {
  const a = m.getPositionAt(from), b = m.getPositionAt(to);
  return new mo.Range(a.lineNumber, a.column, b.lineNumber, b.column);
};
const fileExistsFor = new WeakMap<monaco.editor.ITextModel, MountOptions['fileExists']>();

/** Language features backed by the shared schema engine; registered once while any editor is open. */
let providers: monaco.IDisposable[] = [];
const handles = new Set<Handle>();
function registerProviders() {
  const L = mo.languages;
  if (!L.getLanguages().some((l) => l.id === LANG)) {
    L.register({ id: LANG, aliases: ['FlowMotion'], extensions: ['.flow'] });
    L.setMonarchTokensProvider(LANG, yaml.language);
    L.setLanguageConfiguration(LANG, yaml.conf);
  }
  const fullRange = (m: monaco.editor.ITextModel) => m.getFullModelRange();
  providers = [
    L.registerDocumentFormattingEditProvider(LANG, {
      displayName: 'FlowMotion',
      provideDocumentFormattingEdits(model) {
        const out = formatSource(model.getValue());
        return out === undefined ? [] : [{ range: fullRange(model), text: out }];
      },
    }),
    // "Format Selection" formats the whole definition: a partial rewrite could not keep the indentation consistent.
    L.registerDocumentRangeFormattingEditProvider(LANG, {
      displayName: 'FlowMotion',
      provideDocumentRangeFormattingEdits(model) {
        const out = formatSource(model.getValue());
        return out === undefined ? [] : [{ range: fullRange(model), text: out }];
      },
    }),
    L.registerCompletionItemProvider(LANG, {
      triggerCharacters: [' ', ':', '-', '[', ',', '{', '"'],
      provideCompletionItems(model, position) {
        const text = model.getValue(), pos = model.getOffsetAt(position);
        const list = itemListAt(text, pos);
        const r = completeAt(text, pos);
        const from = r ? r.from : pos;
        const range = rangeAt(model, from, pos);
        const K = L.CompletionItemKind;
        const snippets = (list ? ITEM_SNIPPETS[list] ?? [] : []).map((x) => ({
          label: x.label, kind: K.Snippet, detail: 'snippet', sortText: '0', range,
          insertText: toMonacoSnippet(x.template), insertTextRules: L.CompletionItemInsertTextRule.InsertAsSnippet,
        }));
        if (!text.trim()) snippets.push({
          label: 'flowmotion diagram', kind: K.Snippet, detail: 'starter diagram', sortText: '0', range,
          insertText: FLOW_TEMPLATE.replace(/[$}\\]/g, '\\$&'), insertTextRules: L.CompletionItemInsertTextRule.InsertAsSnippet,
        });
        const items = (r?.suggestions ?? []).map((x, i) => ({
          label: x.label, kind: x.type === 'property' ? K.Property : x.type === 'enum' ? K.EnumMember : K.Reference,
          insertText: x.insert, detail: x.detail, documentation: x.info, range, sortText: `1${String(i).padStart(3, '0')}`,
        }));
        return { suggestions: [...snippets, ...items] };
      },
    }),
    L.registerHoverProvider(LANG, {
      provideHover(model, position) {
        const text = model.getValue();
        const d = docsAt(text, model.getOffsetAt(position));
        if (!d) return null;
        const lines = [`**${d.title}**${d.type ? `  \`${d.type}\`` : ''}`];
        if (d.description) lines.push(d.description);
        if (d.values) lines.push(`One of: ${d.values.map((v) => `\`${v}\``).join(' · ')}`);
        return { range: rangeAt(model, d.from, d.to), contents: [{ value: lines.join('\n\n') }] };
      },
    }),
    L.registerDefinitionProvider(LANG, {
      provideDefinition(model, position) {
        const def = definitionAt(model.getValue(), model.getOffsetAt(position));
        return def ? { uri: model.uri, range: rangeAt(model, def.from, def.to) } : null;
      },
    }),
    L.registerReferenceProvider(LANG, {
      provideReferences(model, position) {
        const r = renameAt(model.getValue(), model.getOffsetAt(position));
        return r ? r.ranges.map(([a, b]) => ({ uri: model.uri, range: rangeAt(model, a, b) })) : [];
      },
    }),
    L.registerRenameProvider(LANG, {
      resolveRenameLocation(model, position) {
        const pos = model.getOffsetAt(position);
        const r = renameAt(model.getValue(), pos);
        const hit = r?.ranges.find(([a, b]) => pos >= a && pos <= b);
        if (!r || !hit) return { range: rangeAt(model, 0, 0), text: '', rejectReason: 'Put the cursor on a node, flow or event id.' };
        return { range: rangeAt(model, hit[0], hit[1]), text: r.id };
      },
      provideRenameEdits(model, position, newName) {
        if (!ID_OK.test(newName)) return { edits: [], rejectReason: 'Ids use letters, digits, _ . - (max 64).' };
        const r = renameAt(model.getValue(), model.getOffsetAt(position));
        if (!r) return { edits: [] };
        return { edits: r.ranges.map(([a, b]) => ({ resource: model.uri, versionId: undefined, textEdit: { range: rangeAt(model, a, b), text: newName } })) };
      },
    }),
    L.registerDocumentSymbolProvider(LANG, {
      provideDocumentSymbols(model) {
        const S = L.SymbolKind;
        const kind = { node: S.Class, flow: S.Method, event: S.Event, element: S.Object } as const;
        return collectScalars(model.getValue()).filter((s) => s.def).map((s) => {
          const range = rangeAt(model, s.from, s.to);
          return { name: s.value, detail: s.def!, kind: kind[s.def!], tags: [], range, selectionRange: range };
        });
      },
    }),
    L.registerCodeActionProvider(LANG, {
      provideCodeActions(model, _range, context) {
        const map = fixes.get(model);
        const actions = context.markers.filter((m) => m.source === 'FlowMotion' && map?.has(key(m))).map((m) => ({
          title: `Change to "${map!.get(key(m))!.replace(/^["']|["']$/g, '')}"`, kind: 'quickfix', isPreferred: true, diagnostics: [m],
          edit: { edits: [{ resource: model.uri, versionId: undefined, textEdit: { range: new mo.Range(m.startLineNumber, m.startColumn, m.endLineNumber, m.endColumn), text: map!.get(key(m))! } }] },
        }));
        return { actions, dispose() {} };
      },
    }, { providedCodeActionKinds: ['quickfix'] }),
  ];
}

function validate(model: monaco.editor.ITextModel) {
  const text = model.getValue();
  const map = new Map<string, string>();
  const markers: monaco.editor.IMarkerData[] = [];
  const sev = mo.MarkerSeverity;
  const ref = srcOf(text);
  if (ref && fileExistsFor.get(model)?.(ref.path) === false) {
    const r = rangeAt(model, ref.from, ref.to);
    markers.push({ severity: sev.Error, message: `File not found: ${ref.path}`, source: 'FlowMotion', startLineNumber: r.startLineNumber, startColumn: r.startColumn, endLineNumber: r.endLineNumber, endColumn: r.endColumn });
  }
  for (const i of lintSource(text)) {
    const r = rangeAt(model, i.from, i.to);
    const m: monaco.editor.IMarkerData = { severity: i.severity === 'warning' ? sev.Warning : sev.Error, message: i.message, source: 'FlowMotion', startLineNumber: r.startLineNumber, startColumn: r.startColumn, endLineNumber: r.endLineNumber, endColumn: r.endColumn };
    markers.push(m);
    if (i.fix) { const q = /^["']/.test(text.slice(i.from, i.to)) ? text[i.from]! : ''; map.set(key(m), `${q}${i.fix}${q}`); }
  }
  fixes.set(model, map);
  mo.editor.setModelMarkers(model, OWNER, markers);
}

let seq = 0;
export function mount(host: HTMLElement, opts: MountOptions): Handle {
  if (handles.size === 0) registerProviders();
  const c = opts.colors;
  const theme = `fm-${opts.dark ? 'dark' : 'light'}`;
  mo.editor.defineTheme(theme, {
    base: opts.dark ? 'vs-dark' : 'vs', inherit: true, rules: [],
    colors: {
      'editor.background': c.bg, 'editor.foreground': c.fg, 'editorLineNumber.foreground': c.muted,
      'editorGutter.background': c.bg, 'editorWidget.background': c.bg, 'editorWidget.border': c.border,
      'editor.lineHighlightBackground': opts.dark ? '#ffffff0d' : '#0000000a',
      'menu.background': c.bg, 'menu.foreground': c.fg, 'menu.border': c.border,
    },
  });
  const model = mo.editor.createModel(opts.value, LANG, mo.Uri.parse(`inmemory://flowmotion/${++seq}.yaml`));
  fileExistsFor.set(model, opts.fileExists);
  const editor = mo.editor.create(host, {
    model, theme, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2, insertSpaces: true,
    fontFamily: c.font, fontSize: 13, lineNumbersMinChars: 3, glyphMargin: true, folding: true, renderLineHighlight: 'line',
    quickSuggestions: { other: true, strings: true, comments: false }, wordBasedSuggestions: 'off', suggestOnTriggerCharacters: true,
    // Keep the context menu under the editor so its shadow root inherits Monaco's theme colors.
    links: false, fixedOverflowWidgets: false, padding: { top: 8 }, smoothScrolling: true, bracketPairColorization: { enabled: true },
  });
  let timer = 0;
  let loading = false;
  const sub = model.onDidChangeContent(() => {
    if (!loading) opts.onChange(model.getValue());
    window.clearTimeout(timer);
    timer = window.setTimeout(() => validate(model), 250);
  });
  validate(model);
  const handle: Handle = {
    getValue: () => model.getValue(),
    setValue(v) {
      loading = true;
      try { model.setValue(v); }
      finally { loading = false; }
    },
    focus: () => editor.focus(),
    layout: () => editor.layout(),
    format: () => void editor.getAction('editor.action.formatDocument')?.run(),
    dispose() {
      if (!handles.delete(handle)) return;
      window.clearTimeout(timer);
      sub.dispose();
      mo.editor.setModelMarkers(model, OWNER, []);
      editor.dispose();
      model.dispose();
      if (handles.size === 0) { providers.forEach((p) => p.dispose()); providers = []; }
    },
  };
  handles.add(handle);
  return handle;
}

/** Dispose FlowMotion's editors without touching other users of the Monaco runtime. */
export function purge() {
  for (const handle of handles) handle.dispose();
}
