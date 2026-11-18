import { EditorSuggest, TFile, type App, type Editor, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo } from 'obsidian';
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { resolveVaultPath } from '../core/embed';
import { ITEM_SNIPPETS, completeAt, docsAt, itemListAt } from '../schema/complete';
import { bodyAround, findBlocks, type Block } from '../schema/blocks';
import { formatSource } from '../schema/format';
import { lintSource, srcOf, type Issue } from '../schema';

/*
 * FlowMotion language support inside Obsidian's own (CodeMirror) editor, for ```flowmotion blocks in notes:
 * error underlines + hover docs + quick fixes (extension), completion (EditorSuggest), and formatting.
 * It reuses the schema engine that also backs the Monaco editor, so nothing here loads Monaco.
 */

type Diag = Issue;

const fileExists = (app: App, notePath: string, rel: string) => {
  const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  const p = resolveVaultPath(dir, rel);
  return !!p && (app.vault.getAbstractFileByPath(p) instanceof TFile || app.vault.getAbstractFileByPath(resolveVaultPath('', rel) ?? '') instanceof TFile);
};

/** Problems of one block, as offsets into the whole document. */
function diagnose(app: App, cache: Map<string, Issue[]>, b: Block): Diag[] {
  let issues = cache.get(b.text);
  if (!issues) {
    try { issues = lintSource(b.text); } catch { issues = []; }
    if (cache.size > 64) cache.clear();
    cache.set(b.text, issues);
  }
  const out = [...issues];
  const ref = srcOf(b.text);
  const note = app.workspace.getActiveFile()?.path ?? '';
  if (ref && ref.path && !fileExists(app, note, ref.path)) out.push({ from: ref.from, to: ref.to, severity: 'error', message: `File not found: ${ref.path}` });
  return out.map((i) => ({ ...i, from: i.from + b.from, to: i.to + b.from }));
}

const mark = (sev: Issue['severity']) => Decoration.mark({ class: `fm-diag fm-diag-${sev}` });
const MARKS = { error: mark('error'), warning: mark('warning') };

/** CodeMirror extension: underline problems and show docs/fixes on hover. */
export function flowLanguageExtension(app: App): Extension {
  const cache = new Map<string, Issue[]>();
  const all = (doc: string) => findBlocks(doc).flatMap((b) => diagnose(app, cache, b));

  const underline = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) { if (u.docChanged) this.decorations = this.build(u.view); }
    build(view: EditorView): DecorationSet {
      const text = view.state.doc.toString();
      if (!/flowmotion/i.test(text)) return Decoration.none;
      const b = new RangeSetBuilder<Decoration>();
      const sorted = all(text).filter((d) => d.to > d.from && d.to <= text.length).sort((x, y) => x.from - y.from || x.to - y.to);
      for (const d of sorted) b.add(d.from, d.to, MARKS[d.severity]);
      return b.finish();
    }
  }, { decorations: (v) => v.decorations });

  const hover = hoverTooltip((view, pos) => {
    const text = view.state.doc.toString();
    const block = findBlocks(text).find((b) => pos >= b.from && pos <= b.to);
    if (!block) return null;
    const diags = diagnose(app, cache, block).filter((d) => pos >= d.from && pos <= d.to);
    const docs = docsAt(block.text, pos - block.from);
    if (!diags.length && !docs) return null;
    const start = Math.min(...diags.map((d) => d.from), docs ? docs.from + block.from : Infinity);
    const end = Math.max(...diags.map((d) => d.to), docs ? docs.to + block.from : -Infinity);
    return {
      pos: start, end, above: true,
      create() {
        const dom = createDiv();
        dom.className = 'fm-tip';
        for (const d of diags) {
          const row = dom.createDiv({ cls: `fm-tip-msg fm-tip-${d.severity}`, text: d.message });
          if (d.fix) {
            const fix = d.fix, q = /^["']/.test(text.slice(d.from, d.to)) ? text[d.from]! : '';
            row.createEl('button', { cls: 'fm-tip-fix', text: `Change to "${fix}"` }).addEventListener('mousedown', (e) => {
              e.preventDefault();
              view.dispatch({ changes: { from: d.from, to: d.to, insert: `${q}${fix}${q}` } });
            });
          }
        }
        if (docs) {
          const row = dom.createDiv({ cls: 'fm-tip-docs' });
          row.createEl('strong', { text: docs.title });
          if (docs.type) row.createSpan({ cls: 'fm-tip-type', text: ` ${docs.type}` });
          if (docs.description) row.createDiv({ text: docs.description });
          if (docs.values) row.createDiv({ cls: 'fm-tip-values', text: `One of: ${docs.values.join(' · ')}` });
        }
        return { dom };
      },
    };
  }, { hoverTime: 250 });

  return [underline, hover];
}

// ---- completion --------------------------------------------------------------------------------------------

interface Item { label: string; insert: string; detail?: string; info?: string; kind: 'snippet' | 'property' | 'enum' | 'ref' | 'file'; /** Offset into `insert` to select after insertion. */ select?: [number, number] }

/** `${name}` placeholders resolved to their names; remembers the first one so it can be selected. */
function expandSnippet(template: string): { text: string; select?: [number, number] } {
  let text = '', last = 0, select: [number, number] | undefined;
  for (const m of template.matchAll(/\$\{([^}]*)\}/g)) {
    text += template.slice(last, m.index);
    if (!select) select = [text.length, text.length + m[1]!.length];
    text += m[1]!;
    last = m.index + m[0].length;
  }
  return { text: text + template.slice(last), select };
}

const WORD = /[\w.>-]*$/;
const SRC_LINE = /^([ \t]*src:[ \t]*["']?)([^"']*)$/;

/** Popup suggestions while typing inside a ```flowmotion block. */
export class FlowSuggest extends EditorSuggest<Item> {
  constructor(app: App) { super(app); }

  private around(editor: Editor, cursor: EditorPosition) {
    return bodyAround((i) => editor.getLine(i), editor.lineCount(), cursor.line, cursor.ch);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const ctx = this.around(editor, cursor);
    if (!ctx) return null;
    const before = line.slice(0, cursor.ch);
    const src = SRC_LINE.exec(before);
    if (src) return { start: { line: cursor.line, ch: src[1]!.length }, end: cursor, query: src[2]! };
    const word = WORD.exec(before)![0];
    // Explicit position (after "key: ", "- ", "[", ",", "{") or a word being typed; never on a blank line (Enter must stay a newline).
    if (!word && !/([:-][ \t]|[[,{][ \t]?)$/.test(before)) return null;
    return { start: { line: cursor.line, ch: cursor.ch - word.length }, end: cursor, query: word };
  }

  getSuggestions(c: EditorSuggestContext): Item[] {
    const ctx = this.around(c.editor, c.end);
    if (!ctx) return [];
    const q = c.query.toLowerCase();
    const before = c.editor.getLine(c.end.line).slice(0, c.end.ch);
    const out: Item[] = [];
    if (SRC_LINE.test(before)) return out;
    const list = itemListAt(ctx.text, ctx.offset);
    for (const s of list ? ITEM_SNIPPETS[list] ?? [] : []) {
      const e = expandSnippet(s.template);
      if (s.label.includes(q)) out.push({ label: s.label, insert: e.text, kind: 'snippet', detail: 'snippet', select: e.select });
    }
    const r = completeAt(ctx.text, ctx.offset);
    for (const s of r?.suggestions ?? []) if (s.label.toLowerCase().includes(q)) out.push({ label: s.label, insert: s.insert, kind: s.type, detail: s.detail, info: s.info });
    // A word that is already complete offers nothing to insert; showing it again would keep the popup open after Enter.
    return out.filter((x) => x.insert !== c.query).slice(0, 50);
  }

  renderSuggestion(item: Item, el: HTMLElement) {
    el.addClass('fm-sug');
    el.createSpan({ cls: `fm-sug-label fm-sug-${item.kind}`, text: item.label });
    if (item.detail) el.createSpan({ cls: 'fm-sug-detail', text: item.detail });
  }

  selectSuggestion(item: Item) {
    const c = this.context;
    if (!c) return;
    c.editor.replaceRange(item.insert, c.start, c.end);
    const base = c.editor.posToOffset(c.start);
    if (item.select) c.editor.setSelection(c.editor.offsetToPos(base + item.select[0]), c.editor.offsetToPos(base + item.select[1]));
    else c.editor.setCursor(c.editor.offsetToPos(base + item.insert.length));
  }
}

// ---- formatting --------------------------------------------------------------------------------------------

/** Block under the cursor, if any. */
export function blockAtCursor(editor: Editor): Block | undefined {
  const pos = editor.posToOffset(editor.getCursor());
  return findBlocks(editor.getValue()).find((b) => pos >= b.from && pos <= b.to);
}

/** Format the diagram block under the cursor. Returns false when there is no block or nothing to change. */
export function formatBlockAt(editor: Editor): boolean {
  const b = blockAtCursor(editor);
  const out = b && formatSource(b.text);
  if (!b || out === undefined) return false;
  editor.replaceRange(out, editor.offsetToPos(b.from), editor.offsetToPos(b.to));
  return true;
}
