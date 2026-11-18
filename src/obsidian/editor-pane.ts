import { TFile, type App } from "obsidian";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { classHighlighter } from "@lezer/highlight";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { resolveVaultPath } from "../core/embed";
import { DiagramError } from "../core/types";
import { buildModel } from "../model";
import { formatSource } from "../schema/format";
import { mountModel, type Mounted } from "../runtime/mount";
import type { Handle } from "../monaco/entry";
import type { MonacoLoader } from "./monaco-loader";

export interface PaneOptions {
  app: App;
  /** Omit to use the default CodeMirror editor. */ loader?: MonacoLoader;
  autoplay: boolean;
  speed: number;
  notePath?: string;
  onChange(value: string): void;
}

/** A CodeMirror editor with a live preview; the optional Monaco add-on replaces it when enabled. */
export class EditorPane {
  readonly root: HTMLElement;
  private host: HTMLElement;
  private preview: HTMLElement;
  private handle?: Handle;
  private cm?: EditorView;
  private mounted?: Mounted;
  private text = "";
  private starting?: Promise<void>;
  private timer = 0;
  private seq = 0;
  private dead = false;
  private acquired = false;

  constructor(
    parent: HTMLElement,
    private o: PaneOptions,
  ) {
    this.root = parent.createDiv({ cls: "fm-flow" });
    this.host = this.root.createDiv({ cls: "fm-flow-editor" });
    // Keep embedded editor key handling from reaching Obsidian's global key handler.
    for (const t of ["keydown", "keyup", "keypress"])
      this.host.addEventListener(t, (e) => e.stopPropagation());
    this.preview = this.root.createDiv({ cls: "fm-flow-preview" });
  }

  togglePreview() {
    this.root.toggleClass(
      "fm-no-preview",
      !this.root.hasClass("fm-no-preview"),
    );
  }
  getValue() {
    return this.handle?.getValue() ?? this.text;
  }
  focus() {
    this.handle?.focus();
    this.cm?.focus();
  }
  /** Rewrite the definition in canonical layout (also Shift+Alt+F inside the editor). */
  format() {
    if (this.handle) this.handle.format();
    else {
      const formatted = formatSource(this.getValue());
      if (formatted !== undefined) this.set(formatted);
    }
  }

  /** Replace the content (also used for the first load). */
  set(text: string) {
    this.text = text;
    if (this.handle) this.handle.setValue(text);
    else if (this.cm && this.cm.state.doc.toString() !== text)
      this.cm.dispatch({
        changes: { from: 0, to: this.cm.state.doc.length, insert: text },
      });
    else void this.start();
    void this.renderPreview();
  }

  private start(): Promise<void> {
    return (this.starting ??= (async () => {
      const loader = this.o.loader;
      if (!loader) {
        if (!this.dead) this.startCodeMirror();
        return;
      }
      if (this.dead) return;
      this.host.setText("Loading editor…");
      try {
        if (!(await loader.installed())) {
          if (!this.dead)
            this.startCodeMirror(
              "The Rich Code Editor add-on is not installed. Toggle it off and on in FlowMotion settings to download it.",
            );
          return;
        }
        const api = await loader.acquire();
        this.acquired = true;
        if (this.dead) {
          if (this.acquired) {
            loader.release();
            this.acquired = false;
          }
          return;
        }
        this.host.empty();
        const css = getComputedStyle(activeDocument.body);
        const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
        this.handle = api.mount(this.host, {
          value: this.text,
          dark: activeDocument.body.hasClass("theme-dark"),
          colors: {
            bg: v("--background-primary", "#1e1e1e"),
            fg: v("--text-normal", "#ddd"),
            muted: v("--text-faint", "#888"),
            border: v("--background-modifier-border", "#444"),
            accent: v("--interactive-accent", "#7c5cff"),
            font: v("--font-monospace", "monospace"),
          },
          onChange: (value) => {
            this.text = value;
            this.o.onChange(value);
            this.schedulePreview();
          },
          fileExists: (rel) => {
            const dir = this.o.notePath?.includes("/")
              ? this.o.notePath.slice(0, this.o.notePath.lastIndexOf("/"))
              : "";
            const p = resolveVaultPath(dir, rel);
            return (
              !!p &&
              (this.o.app.vault.getAbstractFileByPath(p) instanceof TFile ||
                this.o.app.vault.getAbstractFileByPath(
                  resolveVaultPath("", rel) ?? "",
                ) instanceof TFile)
            );
          },
        });
      } catch (e) {
        if (this.acquired) {
          loader.release();
          this.acquired = false;
        }
        if (!this.dead)
          this.startCodeMirror(
            `Could not load the Rich Code Editor: ${(e as Error).message}`,
          );
      }
    })());
  }

  /** CodeMirror is available in Obsidian and is the offline, low-fidelity default editor. */
  private startCodeMirror(message?: string) {
    this.host.empty();
    if (message) this.host.createDiv({ cls: "fm-flow-note", text: message });
    const view = new EditorView({
      state: EditorState.create({
        doc: this.text,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          yaml(),
          syntaxHighlighting(classHighlighter),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Diagram source",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.text = update.state.doc.toString();
            this.o.onChange(this.text);
            this.schedulePreview();
          }),
        ],
      }),
      parent: this.host,
    });
    this.cm = view;
  }

  private schedulePreview() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.renderPreview(), 400);
  }

  private async renderPreview() {
    const mine = ++this.seq;
    const text = this.getValue();
    let problems: string[] | undefined;
    let model;
    try {
      model = text.trim() ? await buildModel(text) : undefined;
    } catch (e) {
      problems =
        e instanceof DiagramError
          ? e.problems
          : [String((e as Error).message ?? e)];
    }
    if (mine !== this.seq || this.dead) return; // a newer edit superseded this render
    this.mounted?.destroy();
    this.mounted = undefined;
    this.preview.empty();
    if (problems) {
      const box = this.preview.createDiv({ cls: "fm-error" });
      box.createEl("strong", { text: "Fix these to see the diagram" });
      const ul = box.createEl("ul");
      for (const p of problems.slice(0, 12)) ul.createEl("li", { text: p });
    } else if (!model)
      this.preview.createDiv({
        cls: "fm-flow-empty",
        text: this.handle
          ? "Start typing a diagram, or press Ctrl+Space for suggestions."
          : "Start typing a diagram; enable the Rich Code Editor for suggestions.",
      });
    else
      this.mounted = mountModel(this.preview, model, {
        createEl,
        theme: "obsidian",
        controls: true,
        height: undefined,
        autoplay: this.o.autoplay && model.animation.autoplay,
        speed:
          model.animation.speed !== 1 ? model.animation.speed : this.o.speed,
      });
  }

  /** Free the editor, its models and the Monaco bundle (when no other pane uses it). */
  destroy() {
    this.dead = true;
    window.clearTimeout(this.timer);
    this.mounted?.destroy();
    this.mounted = undefined;
    this.handle?.dispose();
    this.handle = undefined;
    this.cm?.destroy();
    this.cm = undefined;
    if (this.acquired) {
      this.acquired = false;
      this.o.loader?.release();
    }
    this.root.remove();
  }
}
