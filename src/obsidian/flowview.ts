import { Platform, TextFileView, type WorkspaceLeaf } from 'obsidian';
import { FLOW_TEMPLATE } from '../core/template';
import { DrawioPane, isDrawioName } from './drawio-pane';
import { EditorPane, type PaneOptions } from './editor-pane';

export { FLOW_TEMPLATE };
export const FLOW_VIEW = 'flowmotion-flow';
export const FLOW_EXT = 'flow';

/** Editor for `.flow` files (YAML or JSON diagram definitions): Monaco on the left, live preview on the right. */
export class FlowView extends TextFileView {
  private pane: EditorPane;
  /** `.drawio.flow` files open the draw.io editor instead of Monaco. */
  private drawio?: DrawioPane;
  private drawioFile?: string;
  private drawioData = '';
  private notice?: HTMLElement;
  constructor(leaf: WorkspaceLeaf, private opts: Omit<PaneOptions, 'onChange' | 'notePath'> & { pluginDir: string; server: { url(): Promise<string> }; drawio: boolean }) {
    super(leaf);
    this.pane = new EditorPane(this.contentEl, { ...opts, notePath: undefined, onChange: () => this.requestSave() });
    this.addAction('align-left', 'Format', () => this.pane.format());
    this.addAction('eye', 'Toggle preview', () => this.pane.togglePreview());
  }
  format() { if (!this.drawio) this.pane.format(); }
  getViewType() { return FLOW_VIEW; }
  getDisplayText() { return this.file?.basename ?? 'FlowMotion'; }
  getIcon() { return 'workflow'; }
  // draw.io files save their own data; never let the text pane overwrite them.
  getViewData() { return isDrawioName(this.file?.name) ? this.drawioData : this.pane.getValue(); }
  setViewData(data: string, _clear: boolean) {
    if (isDrawioName(this.file?.name)) {
      this.pane.root.hide();
      this.drawioData = data;
      const filePath = this.file?.path;
      if (this.drawio && this.drawioFile !== filePath) {
        this.drawio.destroy();
        this.drawio = undefined;
      }
      this.drawioFile = filePath;
      if (!this.opts.drawio || !Platform.isDesktopApp) {
        // Off in settings (or on mobile): leave the file untouched and say why.
        this.drawio?.destroy(); this.drawio = undefined;
        this.notice?.remove();
        const text = Platform.isDesktopApp ? 'The draw.io editor is off. Turn it on in FlowMotion settings to edit this file.' : 'The draw.io editor works on the desktop app only.';
        this.notice = this.contentEl.createDiv({ cls: 'fm-error', text });
        return;
      }
      this.notice?.remove(); this.notice = undefined;
      if (!this.drawio) {
        this.drawio = new DrawioPane(this.contentEl, {
          app: this.opts.app, pluginDir: this.opts.pluginDir, server: this.opts.server,
          onSave: (svg) => {
            if (this.file?.path !== filePath) return;
            this.drawioData = svg;
            this.requestSave();
          },
          onExit: () => this.leaf.detach(),
        });
      }
      this.drawio.set(data);
      return;
    }
    this.drawio?.destroy(); this.drawio = undefined; this.drawioFile = undefined;
    this.notice?.remove(); this.notice = undefined;
    this.pane.root.show();
    this.pane.set(data);
  }
  clear() { if (!this.drawio) this.pane.set(''); }
  async onClose() { this.drawio?.destroy(); this.drawio = undefined; this.drawioFile = undefined; this.pane.destroy(); }
}
