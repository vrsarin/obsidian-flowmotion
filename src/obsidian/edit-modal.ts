import { Modal, Notice, Setting } from 'obsidian';
import { EditorPane, type PaneOptions } from './editor-pane';

/** Edit a diagram in a large dialog; the editor is freed when the dialog closes. */
export class EditModal extends Modal {
  private pane?: EditorPane;
  private dirty = false;
  constructor(private o: Omit<PaneOptions, 'onChange'> & { title: string; text: string; save(value: string): Promise<void> | void }) { super(o.app); }

  onOpen() {
    this.modalEl.addClass('mod-fm-edit');
    this.titleEl.setText(this.o.title);
    this.pane = new EditorPane(this.contentEl, { ...this.o, onChange: () => { this.dirty = true; } });
    this.pane.set(this.o.text);
    this.dirty = false;
    new Setting(this.contentEl).addButton((b) => b.setButtonText('Format').onClick(() => this.pane?.format())).addButton((b) => b.setButtonText('Save').setCta().onClick(async () => {
      try { await this.o.save(this.pane!.getValue()); this.dirty = false; this.close(); }
      catch (e) { new Notice(`FlowMotion: ${(e as Error).message}`); }
    })).addButton((b) => b.setButtonText(this.dirty ? 'Discard' : 'Close').onClick(() => this.close()));
  }
  onClose() { this.pane?.destroy(); this.pane = undefined; this.contentEl.empty(); }
}
