import {
  Modal,
  Setting,
  TFile,
  TFolder,
  normalizePath,
  setIcon,
  type App,
} from "obsidian";

export type Choice =
  | { kind: "existing"; file: TFile }
  | { kind: "new"; path: string };

const BAD = /[\\/:*?"<>|#^[\]]/;
interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: TFile[];
}

/**
 * One dialog for embedding a diagram file. With no .flow files in the vault it only asks where and how to
 * name a new one; otherwise it offers two tabs: pick an existing file from a tree, or create a new one.
 */
export function chooseDiagramFile(
  app: App,
  noteFolder: string,
): Promise<Choice | undefined> {
  return new Promise((resolve) =>
    new FileDialog(app, noteFolder, resolve).open(),
  );
}

class FileDialog extends Modal {
  private done = false;
  private tab: "existing" | "new";
  private name = "Untitled";
  private folder: string;
  private query = "";
  private body!: HTMLElement;
  private flowFiles: TFile[] = [];

  constructor(
    app: App,
    noteFolder: string,
    private resolve: (c: Choice | undefined) => void,
  ) {
    super(app);
    this.folder = noteFolder && noteFolder !== "/" ? noteFolder : "/";
    this.tab = "new";
  }

  private pathOf(name: string) {
    return normalizePath(
      this.folder === "/" ? `${name}.flow` : `${this.folder}/${name}.flow`,
    );
  }
  private finish(c: Choice) {
    this.done = true;
    this.resolve(c);
    this.close();
  }

  onOpen() {
    this.flowFiles = this.app.vault
      .getFiles()
      .filter((f) => f.extension === "flow");
    this.tab = this.flowFiles.length ? "existing" : "new";
    this.titleEl.setText("Add FlowMotion diagram file");
    if (this.flowFiles.length) {
      const bar = this.contentEl.createDiv({ cls: "fm-tabs" });
      for (const [id, label] of [
        ["existing", "Use existing"],
        ["new", "Create new"],
      ] as const) {
        const b = bar.createEl("button", { text: label, cls: "fm-tab" });
        b.toggleClass("is-active", id === this.tab);
        b.addEventListener("click", () => {
          this.tab = id;
          bar
            .querySelectorAll(".fm-tab")
            .forEach((x) => x.removeClass("is-active"));
          b.addClass("is-active");
          this.render();
        });
      }
    }
    this.body = this.contentEl.createDiv();
    this.render();
  }

  private render() {
    this.body.empty();
    if (this.tab === "existing") this.renderExisting();
    else this.renderNew();
  }

  // ---- new file -------------------------------------------------------------------------------------------
  private renderNew() {
    const err = this.body.createDiv({ cls: "mod-warning" });
    const check = () => {
      const n = this.name.trim().replace(/\.flow$/i, "");
      const msg = !n
        ? "Enter a name."
        : BAD.test(n)
          ? 'A name cannot contain \\ / : * ? " < > | # ^ [ ]'
          : this.app.vault.getAbstractFileByPath(this.pathOf(n))
            ? `${this.pathOf(n)} already exists.`
            : "";
      err.setText(msg);
      return msg ? undefined : n;
    };
    const submit = () => {
      const n = check();
      if (n) this.finish({ kind: "new", path: this.pathOf(n) });
    };
    new Setting(this.body).setName("File name").addText((t) => {
      t.setValue(this.name).onChange((v) => {
        this.name = v;
        check();
      });
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => {
        t.inputEl.focus();
        t.inputEl.select();
      }, 0);
    });
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
      .map((f) => f.path)
      .sort((a, b) => a.localeCompare(b));
    if (this.folder !== "/" && !folders.includes(this.folder))
      folders.push(this.folder);
    new Setting(this.body).setName("Save in").addDropdown((d) => {
      d.addOption("/", "/ (vault root)");
      for (const f of folders) d.addOption(f, f);
      d.setValue(this.folder).onChange((v) => {
        this.folder = v;
        check();
      });
    });
    new Setting(this.body)
      .addButton((b) => b.setButtonText("Create").setCta().onClick(submit))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
    check();
  }

  // ---- existing file --------------------------------------------------------------------------------------
  private renderExisting() {
    const input = this.body.createEl("input", {
      type: "text",
      placeholder: "Filter…",
      cls: "fm-pick-filter",
    });
    input.value = this.query;
    const tree = this.body.createDiv({ cls: "fm-pick-tree" });
    const draw = () => {
      tree.empty();
      const root: Dir = { name: "", dirs: new Map(), files: [] };
      const files = this.flowFiles
        .filter((f) => !this.query || f.path.toLowerCase().includes(this.query))
        .sort((x, y) => x.path.localeCompare(y.path));
      for (const f of files) {
        let d = root;
        for (const part of f.path.split("/").slice(0, -1)) {
          if (!d.dirs.has(part))
            d.dirs.set(part, { name: part, dirs: new Map(), files: [] });
          d = d.dirs.get(part)!;
        }
        d.files.push(f);
      }
      if (!files.length)
        tree.createDiv({
          cls: "fm-pick-empty",
          text: "No matching .flow files.",
        });
      else this.drawDir(root, tree);
    };
    input.addEventListener("input", () => {
      this.query = input.value.trim().toLowerCase();
      draw();
    });
    draw();
    window.setTimeout(() => input.focus(), 0);
  }

  private drawDir(dir: Dir, into: HTMLElement) {
    for (const d of [...dir.dirs.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const box = into.createEl("details", { cls: "fm-pick-dir" });
      box.open = true;
      const sum = box.createEl("summary");
      setIcon(sum.createSpan({ cls: "fm-pick-icon" }), "folder");
      sum.createSpan({ text: d.name });
      this.drawDir(d, box.createDiv({ cls: "fm-pick-children" }));
    }
    for (const f of dir.files) {
      const row = into.createDiv({
        cls: "fm-pick-file",
        attr: { tabindex: "0" },
      });
      setIcon(row.createSpan({ cls: "fm-pick-icon" }), "workflow");
      row.createSpan({ text: f.basename });
      const choose = () => {
        const file = this.app.vault.getAbstractFileByPath(f.path);
        if (!(file instanceof TFile) || file.extension !== "flow") {
          this.flowFiles = this.flowFiles.filter((cached) => cached !== f);
          this.render();
          return;
        }
        this.finish({ kind: "existing", file });
      };
      row.addEventListener("click", choose);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") choose();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
    if (!this.done) this.resolve(undefined);
  }
}
