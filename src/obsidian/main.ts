import {
  Editor,
  MarkdownRenderChild,
  Menu,
  Notice,
  Platform,
  Plugin,
  normalizePath,
  PluginSettingTab,
  Setting,
  type SettingDefinition,
  type SettingDefinitionItem,
  TFile,
  TFolder,
  type App,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { parseEmbed, relativePath, resolveVaultPath } from "../core/embed";
import { DiagramError } from "../core/types";
import { FLOW_TEMPLATE as STARTER } from "../core/template";
import { buildModel, type Model } from "../model";
import { EditModal } from "./edit-modal";
import {
  FlowSuggest,
  flowLanguageExtension,
  blockAtCursor,
  formatBlockAt,
} from "./language";
import { chooseDiagramFile } from "./file-dialog";
import { MonacoLoader } from "./monaco-loader";
import { StaticServer } from "./static-server";
import { ADDONS, addonStatus, type AddonId, type AddonStatus } from "./addons";
import { installAddon, removeAddon } from "./addon-installer";
import { BLANK_DRAWIO, isDrawioName } from "./drawio-pane";
import { FLOW_EXT, FLOW_TEMPLATE, FLOW_VIEW, FlowView } from "./flowview";
import { mountModel, type Mounted } from "../runtime/mount";

type Paper = "light" | "dark" | "none";
const PAPER_OPTIONS: Record<Paper, string> = {
  light: "White sheet, light colours",
  dark: "Dark sheet, dark colours",
  none: "No sheet (match Obsidian)",
};
interface Settings {
  autoplay: boolean;
  speed: number;
  paperLight: Paper;
  paperDark: Paper;
  drawioEnabled: boolean;
  codeEditor: boolean;
}
/** Both optional add-ons default to off: the core plugin stays small, and the files come from a separate download. */
const DEFAULTS: Settings = {
  autoplay: true,
  speed: 1,
  paperLight: "light",
  paperDark: "dark",
  drawioEnabled: false,
  codeEditor: false,
};

/** Owns one diagram's runtime; Obsidian calls onunload when the note view is destroyed. */
class DiagramChild extends MarkdownRenderChild {
  private mounted?: Mounted;
  /** Vault path of the embedded file, when the block uses `src:`. */
  filePath?: string;
  constructor(
    el: HTMLElement,
    readonly source: string,
    readonly sourcePath: string,
    readonly blockEl: HTMLElement,
    readonly ctx: MarkdownPostProcessorContext,
    private app: App,
    private settings: Settings,
    private cache: Map<string, Model>,
    private registry: Set<DiagramChild>,
    private onEdit: (c: DiagramChild) => void,
  ) {
    super(el);
  }

  private started = false;
  /** Idempotent. Called by the processor directly because Obsidian's Slides view never fires onload. */
  async start() {
    if (this.started) return;
    this.started = true;
    this.registry.add(this);
    await this.render();
  }

  /** Write the chosen background into the block as `paper: ...` (or remove it for "default"); the note change redraws the diagram. */
  private async setPaper(value: string) {
    const info = this.ctx.getSectionInfo(this.blockEl),
      note = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!info || !(note instanceof TFile)) {
      new Notice(
        "FlowMotion: open the note in the editor to change the background.",
      );
      return;
    }
    try {
      await this.app.vault.process(note, (data) => {
        const lines = data.split("\n");
        if (!/^\s*(`{3,}|~{3,})flowmotion/.test(lines[info.lineStart] ?? ""))
          throw new Error("The note changed since this block was drawn.");
        const body = lines
          .slice(info.lineStart + 1, info.lineEnd)
          .filter((l) => !/^paper\s*:/.test(l));
        if (value !== "default") body.push(`paper: ${value}`);
        lines.splice(
          info.lineStart + 1,
          info.lineEnd - info.lineStart - 1,
          ...body,
        );
        return lines.join("\n");
      });
    } catch (e) {
      new Notice(`FlowMotion: ${(e as Error).message}`);
    }
  }

  /** Re-read the embedded file and redraw (called when the file changes). */
  async reload() {
    this.mounted?.destroy();
    this.mounted = undefined;
    await this.render();
  }

  private async readSource(): Promise<{
    text: string;
    view?: import("../core/view").View;
    from?: string;
  }> {
    const embed = parseEmbed(this.source);
    if (!embed) return { text: this.source };
    const dir = this.sourcePath.includes("/")
      ? this.sourcePath.slice(0, this.sourcePath.lastIndexOf("/"))
      : "";
    const path = resolveVaultPath(dir, embed.src);
    if (!path)
      throw new DiagramError([`src: "${embed.src}" points outside the vault`]);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile))
      file =
        this.app.vault.getAbstractFileByPath(
          resolveVaultPath("", embed.src) ?? "",
        ) ?? null; // vault-root fallback
    if (!(file instanceof TFile))
      throw new DiagramError([`src: file not found: ${path}`]);
    this.filePath = file.path;
    return {
      text: await this.app.vault.cachedRead(file),
      view: embed.view,
      from: file.name,
    };
  }

  private async render() {
    try {
      const { text, view, from } = await this.readSource();
      let model = this.cache.get(text);
      if (!model) {
        try {
          model = await buildModel(text);
        } catch (e) {
          if (from && e instanceof DiagramError)
            throw new DiagramError(e.problems.map((p) => `${from}: ${p}`));
          throw e;
        }
        this.cache.set(text, model);
      }
      this.containerEl.empty();
      const merged = { ...model.view, ...view }; // options in the block win over the file's
      const explicit = merged.paper; // set in the file or block; otherwise the setting for the current Obsidian theme applies
      if (model.backdrop)
        merged.paper =
          explicit ??
          (activeDocument.body.classList.contains("theme-dark")
            ? this.settings.paperDark
            : this.settings.paperLight);
      const a = model.animation;
      this.mounted = mountModel(
        this.containerEl,
        { ...model, view: merged },
        {
          // block options (controlsPosition, mode, width, ...) override the file's
          createEl,
          theme: "obsidian",
          paperChoice: explicit,
          onPaper: (v) => void this.setPaper(v),
          controls: merged.controls === true,
          height: merged.height,
          autoplay: this.settings.autoplay && a.autoplay,
          speed: a.speed !== 1 ? a.speed : this.settings.speed,
        },
      );
    } catch (e) {
      this.containerEl.empty();
      const box = this.containerEl.createDiv({ cls: "fm-error" });
      box.createEl("strong", { text: "FlowMotion: invalid diagram" });
      const ul = box.createEl("ul");
      const problems =
        e instanceof DiagramError
          ? e.problems
          : [String((e as Error).message ?? e)];
      for (const p of problems.slice(0, 12)) ul.createEl("li", { text: p });
    }
    if (!this.containerEl.closest(".reveal"))
      this.containerEl
        .createEl("button", {
          cls: "fm-edit-btn",
          text: "✎ Edit",
          attr: { "aria-label": "Edit this diagram" },
        })
        .addEventListener("click", () => this.onEdit(this));
  }
  onload() {
    void this.start();
  }
  onunload() {
    this.registry.delete(this);
    this.mounted?.destroy();
    this.mounted = undefined;
  }
}

export default class FlowMotionPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private cache = new Map<string, Model>();
  private children = new Set<DiagramChild>();
  private loader!: MonacoLoader;
  private drawioServer = new StaticServer(
    this.app.vault.adapter,
    () => `${this.pluginDir}/${ADDONS.drawio.dir}`,
  );

  /** Vault-relative folder that holds this plugin's files (where the optional add-ons go). */
  get pluginDir(): string {
    return (
      this.manifest.dir ??
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`
    );
  }

  async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    this.settings = { ...DEFAULTS, ...saved };
    this.loader = new MonacoLoader();
    this.registerMarkdownCodeBlockProcessor("flowmotion", (source, el, ctx) => {
      const host = el.createDiv({ cls: "fm-host" });
      const child = new DiagramChild(
        host,
        source,
        ctx.sourcePath,
        el,
        ctx,
        this.app,
        this.settings,
        this.cache,
        this.children,
        (c) => void this.editDiagram(c),
      );
      ctx.addChild(child);
      return child.start(); // Slides (Reveal) never loads its children, so mount now
    });
    // Redraw every embed of a file when that file is edited (debounced; saves often fire in bursts).
    const timers = new Map<string, number>();
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (
          !(f instanceof TFile) ||
          ![...this.children].some((c) => c.filePath === f.path)
        )
          return;
        window.clearTimeout(timers.get(f.path));
        timers.set(
          f.path,
          window.setTimeout(() => {
            for (const c of this.children)
              if (c.filePath === f.path) void c.reload();
          }, 300),
        );
      }),
    );
    this.registerView(
      FLOW_VIEW,
      (leaf) =>
        new FlowView(leaf, {
          app: this.app,
          loader: this.settings.codeEditor ? this.loader : undefined,
          drawio: this.settings.drawioEnabled,
          autoplay: this.settings.autoplay,
          speed: this.settings.speed,
          pluginDir: this.pluginDir,
          server: this.drawioServer,
        }),
    );
    this.registerExtensions([FLOW_EXT], FLOW_VIEW);
    this.addCommand({
      id: "new-flow",
      name: "New diagram (.flow file)",
      callback: () =>
        void this.newFlow(
          this.app.workspace.getActiveFile()?.parent?.path ?? "",
        ),
    });
    this.addCommand({
      id: "new-drawio",
      name: "New draw.io diagram (.drawio.flow file)",
      callback: () =>
        void this.newDrawio(
          this.app.workspace.getActiveFile()?.parent?.path ?? "",
        ),
    });
    this.addRibbonIcon(
      "workflow",
      "New FlowMotion diagram (.flow)",
      () =>
        void this.newFlow(
          this.app.workspace.getActiveFile()?.parent?.path ?? "",
        ),
    );
    // Right-click in a note: insert a ready-to-edit diagram block at the cursor.
    this.addCommand({
      id: "insert-diagram",
      name: "Insert diagram (inline)",
      editorCallback: (editor) => this.insertDiagram(editor),
    });
    this.addCommand({
      id: "insert-diagram-file",
      name: "Insert diagram (.flow file)",
      editorCallback: (editor, view) =>
        void this.insertDiagramFile(editor, view.file),
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const opts: [string, string, () => void][] = [
          ["Inline diagram", "code", () => this.insertDiagram(editor)],
          [
            "Diagram file (.flow)…",
            "file-symlink",
            () => void this.insertDiagramFile(editor, view.file),
          ],
        ];
        menu.addItem((i) => {
          i.setTitle("Add FlowMotion diagram")
            .setIcon("workflow")
            .setSection("selection-link");
          const sub = (
            i as unknown as { setSubmenu?: () => Menu }
          ).setSubmenu?.(); // undocumented; flat items if absent
          if (sub)
            for (const [t, icon, run] of opts)
              sub.addItem((j) => j.setTitle(t).setIcon(icon).onClick(run));
          else {
            i.setTitle(
              `Add FlowMotion diagram: ${opts[0]![0].toLowerCase()}`,
            ).onClick(opts[0]![2]);
            menu.addItem((j) =>
              j
                .setTitle(
                  `Add FlowMotion diagram: ${opts[1]![0].toLowerCase()}`,
                )
                .setIcon(opts[1]![1])
                .setSection("selection-link")
                .onClick(opts[1]![2]),
            );
          }
        });
      }),
    );
    // Language support for flowmotion blocks inside notes (underlines, hover docs, quick fixes, completion, format).
    this.registerEditorExtension(flowLanguageExtension(this.app));
    this.registerEditorSuggest(new FlowSuggest(this.app));
    this.addCommand({
      id: "format-block",
      name: "Format diagram block",
      editorCheckCallback: (check, editor) => {
        const inBlock = !!blockAtCursor(editor);
        if (inBlock && !check && !formatBlockAt(editor))
          new Notice(
            "FlowMotion: nothing to format (already formatted, or the block has syntax errors).",
          );
        return inBlock;
      },
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (blockAtCursor(editor))
          menu.addItem((i) =>
            i
              .setTitle("Format FlowMotion diagram")
              .setIcon("align-left")
              .setSection("selection-link")
              .onClick(() => formatBlockAt(editor)),
          );
      }),
    );
    this.addCommand({
      id: "format-diagram",
      name: "Format diagram",
      checkCallback: (check) => {
        const v = this.app.workspace.getActiveViewOfType(FlowView);
        if (v && !check) v.format();
        return !!v;
      },
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, f) => {
        if (f instanceof TFolder) {
          menu.addItem((i) =>
            i
              .setTitle("New FlowMotion diagram")
              .setIcon("workflow")
              .setSection("action-primary")
              .onClick(() => void this.newFlow(f.path)),
          );
          menu.addItem((i) =>
            i
              .setTitle("New draw.io diagram")
              .setIcon("shapes")
              .setSection("action-primary")
              .onClick(() => void this.newDrawio(f.path)),
          );
        } else if (
          f instanceof TFile &&
          ["yaml", "yml", "json"].includes(f.extension)
        )
          menu.addItem((i) =>
            i
              .setTitle("Convert to FlowMotion diagram (.flow)")
              .setIcon("workflow")
              .onClick(async () => {
                await this.app.fileManager.renameFile(
                  f,
                  f.path.replace(/\.[^./]+$/, ".flow"),
                );
              }),
          );
      }),
    );
    this.addSettingTab(new FlowMotionSettings(this.app, this));
  }
  onunload() {
    this.cache.clear();
    this.loader.dispose();
    this.drawioServer.stop();
  }

  insertDiagram(editor: Editor) {
    this.insertBlock(editor, STARTER.trimEnd());
  }

  private insertBlock(editor: Editor, body: string) {
    const block = `\`\`\`flowmotion\n${body}\n\`\`\`\n`;
    const from = editor.getCursor("from");
    const lead = editor.getLine(from.line).slice(0, from.ch).trim()
      ? "\n\n"
      : ""; // keep the fence at the start of a line
    editor.replaceSelection(`${lead}${block}`);
  }

  /** Embed a .flow file: an existing one, or a new one the user names and places. */
  async insertDiagramFile(editor: Editor, note: TFile | null) {
    const dir =
      note?.parent?.path && note.parent.path !== "/" ? note.parent.path : "";
    const choice = await chooseDiagramFile(this.app, dir);
    if (!choice) return;
    let file: TFile;
    if (choice.kind === "existing") file = choice.file;
    else {
      const folder = choice.path.includes("/")
        ? choice.path.slice(0, choice.path.lastIndexOf("/"))
        : "";
      if (folder && !this.app.vault.getAbstractFileByPath(folder))
        await this.app.vault.createFolder(folder);
      file = await this.app.vault.create(choice.path, FLOW_TEMPLATE);
    }
    const rel = relativePath(dir, file.path);
    this.insertBlock(
      editor,
      `src: ${/^[\w./-]+$/.test(rel) ? rel : JSON.stringify(rel)}`,
    ); // quote when YAML would misread it
  }

  /** Stops using an add-on and deletes its files (the add-on was turned off). */
  async releaseAddon(id: AddonId) {
    let retiredViews: FlowView[] = [];
    if (id === "drawio") {
      const views = this.app.workspace
        .getLeavesOfType(FLOW_VIEW)
        .map((leaf) => leaf.view)
        .filter(
          (view): view is FlowView =>
            view instanceof FlowView && isDrawioName(view.file?.name),
        );
      for (const view of views) await view.saveDrawioBeforeAddonRemoval();
      for (const view of views) view.retireDrawioPane();
      retiredViews = views;
    }
    if (id === "drawio") this.drawioServer.stop();
    try {
      await removeAddon(ADDONS[id], this.app.vault.adapter, this.pluginDir);
    } catch (e) {
      if (
        id === "drawio" &&
        (await this.app.vault.adapter.exists(
          `${this.pluginDir}/${ADDONS.drawio.dir}/${ADDONS.drawio.marker}`,
        ))
      ) {
        for (const view of retiredViews) view.restoreDrawioPane();
      }
      throw e;
    }
  }

  async newDrawio(dir: string) {
    if (!this.settings.drawioEnabled) {
      new Notice(
        "FlowMotion: turn on the draw.io editor in FlowMotion settings first.",
      );
      return;
    }
    const join = (n: string) =>
      normalizePath(dir && dir !== "/" ? `${dir}/${n}` : n);
    let path = join("Untitled.drawio.flow");
    for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++)
      path = join(`Untitled ${i}.drawio.flow`);
    await this.app.workspace
      .getLeaf(true)
      .openFile(await this.app.vault.create(path, BLANK_DRAWIO));
  }

  async newFlow(dir: string) {
    await this.app.workspace.getLeaf(true).openFile(await this.createFlow(dir));
  }

  private async createFlow(dir: string) {
    const join = (n: string) =>
      normalizePath(dir && dir !== "/" ? `${dir}/${n}` : n);
    let path = join("Untitled.flow");
    for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++)
      path = join(`Untitled ${i}.flow`);
    return this.app.vault.create(path, FLOW_TEMPLATE);
  }

  /** Open Monaco on a diagram: the embedded file if the block uses `src:`, otherwise the block's own text. */
  async editDiagram(child: DiagramChild) {
    const common = {
      app: this.app,
      loader: this.settings.codeEditor ? this.loader : undefined,
      autoplay: this.settings.autoplay,
      speed: this.settings.speed,
      notePath: child.sourcePath,
    };
    let embed: ReturnType<typeof parseEmbed>;
    try {
      embed = parseEmbed(child.source);
    } catch {
      embed = undefined;
    } // an invalid embed block is fixed as text
    if (embed) {
      const file = child.filePath
        ? this.app.vault.getAbstractFileByPath(child.filePath)
        : null;
      if (!(file instanceof TFile)) {
        new Notice(`FlowMotion: file not found: ${embed.src}`);
        return;
      }
      if (isDrawioName(file.name)) {
        await this.app.workspace.getLeaf(true).openFile(file);
        return;
      } // draw.io files open in the draw.io editor
      new EditModal({
        ...common,
        title: file.name,
        text: await this.app.vault.read(file),
        save: (v) => this.app.vault.modify(file, v),
      }).open();
      return;
    }
    const info = child.ctx.getSectionInfo(child.blockEl);
    const note = this.app.vault.getAbstractFileByPath(child.sourcePath);
    if (!info || !(note instanceof TFile)) {
      new Notice("FlowMotion: open the note in the editor to edit this block.");
      return;
    }
    new EditModal({
      ...common,
      title: "Edit diagram",
      text: child.source,
      save: async (value) => {
        await this.app.vault.process(note, (data) => {
          const lines = data.split("\n");
          const body = lines.slice(info.lineStart + 1, info.lineEnd).join("\n");
          if (
            !/^\s*(`{3,}|~{3,})flowmotion/.test(lines[info.lineStart] ?? "") ||
            body.trim() !== child.source.trim()
          )
            throw new Error(
              "The note changed since this block was drawn. Close this dialog and try again.",
            );
          lines.splice(
            info.lineStart + 1,
            info.lineEnd - info.lineStart - 1,
            ...value.replace(/\n+$/, "").split("\n"),
          );
          return lines.join("\n");
        });
      },
    }).open();
  }
  async save() {
    await this.saveData(this.settings);
    this.cache.clear();
  }
}

export class FlowMotionSettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: FlowMotionPlugin,
  ) {
    super(app, plugin);
  }

  /** Obsidian 1.13 and later: the settings list. Obsidian's settings search reads this. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        items: [
          {
            name: "Autoplay",
            desc: "Start animations when a diagram is shown (diagrams can still opt out with animation.autoplay: false).",
            control: { type: "toggle", key: "autoplay" },
          },
          {
            name: "draw.io background in light mode",
            desc: "Sheet behind draw.io drawings. A diagram can override it from its own toolbar.",
            control: {
              type: "dropdown",
              key: "paperLight",
              options: PAPER_OPTIONS,
            },
          },
          {
            name: "draw.io background in dark mode",
            control: {
              type: "dropdown",
              key: "paperDark",
              options: PAPER_OPTIONS,
            },
          },
          {
            name: "Default speed",
            desc: "Used when a diagram does not set animation.speed.",
            control: {
              type: "dropdown",
              key: "speed",
              options: { "0.5": "0.5×", "1": "1×", "2": "2×" },
            },
          },
          {
            name: "Playback controls",
            desc: 'Off by default. Use the ⚙ button under a diagram to show them, or add "controls: true" to start with them visible.',
          },
        ],
      },
      {
        type: "group",
        heading: "Optional add-ons",
        items: [
          {
            name: "Add-on files",
            desc: "The code editor is bundled with FlowMotion. draw.io files are downloaded when enabled and deleted when disabled. Desktop app only.",
          },
          this.addonDefinition({
            name: "draw.io editor",
            desc: "Edit .drawio.flow files in draw.io. Desktop app only.",
            key: "drawioEnabled",
            ready: "drawio",
          }),
          this.addonDefinition({
            name: "Rich Code Editor (Monaco)",
            desc: "Uses the bundled Monaco editor with syntax help and advanced editing features in .flow files and the edit dialog. CodeMirror remains the default. Desktop app only.",
            key: "codeEditor",
            ready: "monaco",
          }),
        ],
      },
    ];
  }

  /** The current value of a setting. Speed is stored as a number but the dropdown uses text. */
  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    return key === "speed"
      ? String(s.speed)
      : (s as unknown as Record<string, unknown>)[key];
  }

  /** Saves a changed setting. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "speed") this.plugin.settings.speed = Number(value);
    else
      (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.save();
  }

  /** Obsidian before 1.13 has no declarative settings. Draw the same definitions with the older Setting API. */
  display() {
    this.containerEl.empty();
    for (const item of this.getSettingDefinitions())
      this.drawLegacy(this.containerEl, item);
  }

  private drawLegacy(c: HTMLElement, item: SettingDefinitionItem): void {
    if ("items" in item && item.items) {
      if ("heading" in item && item.heading)
        new Setting(c).setName(item.heading).setHeading();
      for (const child of item.items) this.drawLegacy(c, child);
      return;
    }
    if (!("name" in item)) return;
    const setting = new Setting(c).setName(item.name).setDesc(item.desc ?? "");
    if ("render" in item && item.render) {
      item.render(setting, undefined as never);
      return;
    }
    const control = "control" in item ? item.control : undefined;
    if (!control) return;
    if (control.type === "toggle") {
      setting.addToggle((t) =>
        t
          .setValue(Boolean(this.getControlValue(control.key)))
          .onChange((v) => this.setControlValue(control.key, v)),
      );
    } else if (control.type === "dropdown") {
      setting.addDropdown((d) => {
        for (const [v, label] of Object.entries(control.options))
          d.addOption(v, label);
        d.setValue(String(this.getControlValue(control.key))).onChange((v) =>
          this.setControlValue(control.key, v),
        );
      });
    }
  }

  /** An add-on toggle. Turning it on downloads the add-on; turning it off deletes it. */
  private addonDefinition(o: {
    name: string;
    desc: string;
    key: "drawioEnabled" | "codeEditor";
    ready: keyof AddonStatus;
  }): SettingDefinition {
    const id: AddonId = o.ready;
    return {
      name: o.name,
      desc: o.desc,
      render: (setting) => {
        const show = (text: string) => {
          setting.descEl.textContent = `${o.desc} ${text}`;
        }; // setDesc here would re-render declarative settings repeatedly
        const refresh = () =>
          addonStatus(this.app, this.plugin.pluginDir)
            .then((st) =>
              show(`Status: ${st[o.ready] ? "installed" : "not installed"}.`),
            )
            .catch((e) => {
              console.error("FlowMotion: could not check add-on files", e);
              show("Status: unknown.");
            });
        setting.addToggle((t) =>
          t.setValue(this.plugin.settings[o.key]).onChange(async (v) => {
            if (!Platform.isDesktopApp) {
              new Notice(
                `FlowMotion: the ${o.name} add-on works on the desktop app only.`,
              );
              t.setValue(false);
              return;
            }
            t.setDisabled(true);
            try {
              if (v) {
                if (
                  !(await addonStatus(this.app, this.plugin.pluginDir))[o.ready]
                ) {
                  show("Downloading…");
                  new Notice(`FlowMotion: downloading the ${o.name} add-on…`);
                  await installAddon(
                    ADDONS[id],
                    this.app.vault.adapter,
                    this.plugin.pluginDir,
                    this.plugin.manifest.version,
                  );
                }
                await this.setControlValue(o.key, true);
                new Notice(`FlowMotion: the ${o.name} add-on is installed.`);
              } else {
                await this.setControlValue(o.key, false);
                await this.plugin.releaseAddon(id);
                new Notice(`FlowMotion: the ${o.name} add-on was removed.`);
              }
            } catch (e) {
              console.error(`FlowMotion: ${o.name} add-on`, e);
              new Notice(
                `FlowMotion: could not ${v ? "download" : "remove"} the ${o.name} add-on: ${(e as Error).message}`,
              );
              await this.setControlValue(
                o.key,
                !v &&
                  (await addonStatus(this.app, this.plugin.pluginDir))[o.ready],
              );
              t.setValue(this.plugin.settings[o.key]);
            } finally {
              t.setDisabled(false);
              await refresh();
            }
          }),
        );
        void refresh();
      },
    };
  }
}
