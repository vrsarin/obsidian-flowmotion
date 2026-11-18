import {
  Modal,
  Setting,
  TFile,
  normalizePath,
  type App,
} from "obsidian";

export type Choice =
  | { kind: "existing"; file: TFile }
  | { kind: "new"; path: string };

const BAD = /[\\/:*?"<>|#^[\]]/;
/**
 * One dialog for embedding a diagram file. Existing files are resolved by the exact path entered by the user,
 * so the picker does not enumerate the vault.
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
  private name = "Untitled";
  private folder: string;
  private body!: HTMLElement;

  constructor(
    app: App,
    noteFolder: string,
    private resolve: (c: Choice | undefined) => void,
  ) {
    super(app);
    this.folder = noteFolder && noteFolder !== "/" ? noteFolder : "/";
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
    this.titleEl.setText("Add FlowMotion diagram file");
    this.body = this.contentEl.createDiv();
    this.renderNew();
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
    new Setting(this.body).setName("File name");
    const nameInput = this.body.createEl("input", {
      type: "text",
      cls: "fm-new-name",
    });
    nameInput.value = this.name;
    nameInput.addEventListener("input", () => {
      this.name = nameInput.value;
      check();
    });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 0);
    const existing = this.body.createEl("input", {
      type: "text",
      placeholder: "diagrams/architecture.flow",
      cls: "fm-existing-path",
    });
    const openExisting = () => {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(existing.value.trim()));
      if (file instanceof TFile && file.extension === "flow")
        this.finish({ kind: "existing", file });
      else err.setText("Enter the path of an existing .flow file.");
    };
    existing.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        openExisting();
    });
    this.body.createEl("button", { text: "Open existing .flow file" }).addEventListener("click", openExisting);
    new Setting(this.body)
      .addButton((b) => b.setButtonText("Create").setCta().onClick(submit))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
    check();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.done) this.resolve(undefined);
  }
}
