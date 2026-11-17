import { TFile, type App } from 'obsidian';
import { resolveVaultPath } from '../core/embed';
import { DiagramError } from '../core/types';
import { buildModel } from '../model';
import { mountModel, type Mounted } from '../runtime/mount';
import type { Handle } from '../monaco/entry';
import type { MonacoLoader } from './monaco-loader';

export interface PaneOptions { app: App; /** Omit to use the plain text editor (code editor turned off in settings). */ loader?: MonacoLoader; autoplay: boolean; speed: number; notePath?: string; onChange(value: string): void }

/** A Monaco editor with a live diagram preview beside it. Monaco loads when the pane opens and is freed in destroy().
 *  Without the code-editor add-on, a plain textarea takes its place. */
export class EditorPane {
  readonly root: HTMLElement;
  private host: HTMLElement;
  private preview: HTMLElement;
  private handle?: Handle;
  private plain?: HTMLTextAreaElement;
  private mounted?: Mounted;
  private text = '';
  private starting?: Promise<void>;
  private timer = 0;
  private seq = 0;
  private dead = false;
  private acquired = false;

  constructor(parent: HTMLElement, private o: PaneOptions) {
    this.root = parent.createDiv({ cls: 'fm-flow' });
    this.host = this.root.createDiv({ cls: 'fm-flow-editor' });
    // Monaco handles keys on its own textarea; keep them from reaching Obsidian's global key handler
    // (it throws "isShown is not a function" and would also steal editor shortcuts).
    for (const t of ['keydown', 'keyup', 'keypress']) this.host.addEventListener(t, (e) => e.stopPropagation());
    this.preview = this.root.createDiv({ cls: 'fm-flow-preview' });
  }

  togglePreview() { this.root.toggleClass('fm-no-preview', !this.root.hasClass('fm-no-preview')); }
  getValue() { return this.handle?.getValue() ?? this.text; }
  focus() { this.handle?.focus(); }
  /** Rewrite the definition in canonical layout (also Shift+Alt+F inside the editor). */
  format() { this.handle?.format(); }

  /** Replace the content (also used for the first load). */
  set(text: string) {
    this.text = text;
    if (this.handle) this.handle.setValue(text);
    else if (this.plain) this.plain.value = text;
    else void this.start();
    void this.renderPreview();
  }

  private start(): Promise<void> {
    return (this.starting ??= (async () => {
      const loader = this.o.loader;
      if (!loader || !(await loader.installed())) {
        if (!this.dead) this.startPlain(!!loader);
        return;
      }
      if (this.dead) return;
      this.host.setText('Loading editor…');
      this.acquired = true;
      try {
        const api = await loader.acquire();
        if (this.dead) {
          if (this.acquired) { loader.release(); this.acquired = false; }
          return;
        }
        this.host.empty();
        const css = getComputedStyle(activeDocument.body);
        const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
        this.handle = api.mount(this.host, {
          value: this.text, dark: activeDocument.body.hasClass('theme-dark'),
          colors: { bg: v('--background-primary', '#1e1e1e'), fg: v('--text-normal', '#ddd'), muted: v('--text-faint', '#888'), border: v('--background-modifier-border', '#444'), accent: v('--interactive-accent', '#7c5cff'), font: v('--font-monospace', 'monospace') },
          onChange: (value) => { this.text = value; this.o.onChange(value); this.schedulePreview(); },
          fileExists: (rel) => {
            const dir = this.o.notePath?.includes('/') ? this.o.notePath.slice(0, this.o.notePath.lastIndexOf('/')) : '';
            const p = resolveVaultPath(dir, rel);
            return !!p && (this.o.app.vault.getAbstractFileByPath(p) instanceof TFile || this.o.app.vault.getAbstractFileByPath(resolveVaultPath('', rel) ?? '') instanceof TFile);
          },
        });
      } catch (e) {
        this.host.setText(`Could not load the editor: ${(e as Error).message}`);
        if (this.acquired) { loader.release(); this.acquired = false; }
      }
    })());
  }

  /** Plain text fallback: same value and preview, no syntax help. */
  private startPlain(addonMissing: boolean) {
    this.host.empty();
    if (addonMissing) this.host.createDiv({ cls: 'fm-flow-note', text: 'The code editor add-on is not installed, so a plain text box is used. See FlowMotion settings.' });
    const ta = this.host.createEl('textarea', { cls: 'fm-flow-plain', attr: { spellcheck: 'false', 'aria-label': 'Diagram source' } });
    ta.value = this.text;
    ta.addEventListener('input', () => { this.text = ta.value; this.o.onChange(ta.value); this.schedulePreview(); });
    this.plain = ta;
  }

  private schedulePreview() { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => void this.renderPreview(), 400); }

  private async renderPreview() {
    const mine = ++this.seq;
    const text = this.getValue();
    let problems: string[] | undefined;
    let model;
    try { model = text.trim() ? await buildModel(text) : undefined; }
    catch (e) { problems = e instanceof DiagramError ? e.problems : [String((e as Error).message ?? e)]; }
    if (mine !== this.seq || this.dead) return; // a newer edit superseded this render
    this.mounted?.destroy(); this.mounted = undefined;
    this.preview.empty();
    if (problems) {
      const box = this.preview.createDiv({ cls: 'fm-error' });
      box.createEl('strong', { text: 'Fix these to see the diagram' });
      const ul = box.createEl('ul');
      for (const p of problems.slice(0, 12)) ul.createEl('li', { text: p });
    } else if (!model) this.preview.createDiv({ cls: 'fm-flow-empty', text: 'Start typing a diagram, or press Ctrl+Space for suggestions.' });
    else this.mounted = mountModel(this.preview, model, { theme: 'obsidian', controls: true, height: undefined, autoplay: this.o.autoplay && model.animation.autoplay, speed: model.animation.speed !== 1 ? model.animation.speed : this.o.speed });
  }

  /** Free the editor, its models and the Monaco bundle (when no other pane uses it). */
  destroy() {
    this.dead = true;
    window.clearTimeout(this.timer);
    this.mounted?.destroy(); this.mounted = undefined;
    this.handle?.dispose(); this.handle = undefined;
    this.plain = undefined;
    if (this.acquired) { this.acquired = false; this.o.loader?.release(); }
    this.root.remove();
  }
}
