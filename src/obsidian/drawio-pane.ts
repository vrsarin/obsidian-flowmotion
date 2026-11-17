import type { App } from 'obsidian';
import { extractMxfile } from '../drawio/parse';
import { ADDON_SETUP_URL } from './addons';

export const DRAWIO_SUFFIX = '.drawio.flow';
export const isDrawioName = (name: string | undefined) => !!name && name.toLowerCase().endsWith(DRAWIO_SUFFIX);

export const BLANK_MXFILE = '<mxfile><diagram name="Page-1" id="page1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A new file's content: an empty draw.io SVG (draw.io reads and writes this format; so does FlowMotion). */
export const BLANK_DRAWIO = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1px" height="1px" viewBox="0 0 1 1" content="${esc(BLANK_MXFILE)}"><g/></svg>\n`;

export interface DrawioOptions { app: App; pluginDir: string; server: { url(): Promise<string> }; onSave(svg: string): void; onExit(): void }

/** draw.io running in an iframe from the plugin folder (offline). We speak its postMessage JSON protocol:
 *  init -> load, autosave/save -> export as SVG with the diagram embedded, exit -> close. */
export class DrawioPane {
  readonly root: HTMLElement;
  private frame?: HTMLIFrameElement;
  private pending = '';
  private ready = false;
  private xml = BLANK_MXFILE;
  private dead = false;
  private onMsg = (ev: MessageEvent) => this.handle(ev);

  constructor(parent: HTMLElement, private o: DrawioOptions) {
    this.root = parent.createDiv({ cls: 'fm-drawio' });
    window.addEventListener('message', this.onMsg);
  }

  /** Show a file's content (a draw.io SVG or mxfile). */
  set(text: string) {
    this.xml = extractMxfile(text) ?? BLANK_MXFILE;
    if (!this.frame) void this.mount();
    else if (this.ready && this.xml !== this.pending) this.load();
  }

  private async mount() {
    const dir = this.o.pluginDir;
    const adapter = this.o.app.vault.adapter;
    if (!(await adapter.exists(`${dir}/drawio/index.html`))) {
      this.root.createEl('p', { cls: 'fm-error', text: `The draw.io add-on is not installed. Build it from its upstream source by following ${ADDON_SETUP_URL}, then reopen this file.` });
      return;
    }
    if (this.dead) return;
    let base: string;
    try { base = await this.o.server.url(); } catch (e) { this.root.createEl('p', { cls: 'fm-error', text: `Could not start the local draw.io server: ${(e as Error).message}` }); return; }
    if (this.dead) return;
    const url = `${base}/index.html?embed=1&proto=json&spin=1&offline=1&lang=en&ui=atlas&saveAndExit=0&noExitBtn=1&libraries=1`;
    this.frame = this.root.createEl('iframe', { cls: 'fm-drawio-frame', attr: { src: url, title: 'draw.io editor' } });
  }

  private post(msg: object) { this.frame?.contentWindow?.postMessage(JSON.stringify(msg), '*'); }
  private load() { this.pending = this.xml; this.post({ action: 'load', xml: this.xml, autosave: 1 }); }

  private handle(ev: MessageEvent) {
    if (this.dead || !this.frame || ev.source !== this.frame.contentWindow || typeof ev.data !== 'string') return;
    let m: { event?: string; xml?: string; data?: string; format?: string };
    try { m = JSON.parse(ev.data) as typeof m; } catch { return; }
    switch (m.event) {
      case 'init': this.ready = true; this.load(); break;
      case 'autosave': case 'save':
        if (typeof m.xml === 'string') { this.pending = m.xml; this.post({ action: 'export', format: 'xmlsvg', xml: m.xml, spin: 'Saving' }); }
        break;
      case 'export': {
        const svg = typeof m.data === 'string' ? decodeSvg(m.data) : undefined;
        if (svg) this.o.onSave(svg);
        break;
      }
      case 'exit': this.o.onExit(); break;
    }
  }

  destroy() { this.dead = true; window.removeEventListener('message', this.onMsg); this.frame?.remove(); this.root.remove(); }
}

/** draw.io hands the SVG back as a data URI (base64 or percent-encoded). */
export function decodeSvg(uri: string): string | undefined {
  const m = /^data:image\/svg\+xml(?:;charset=[\w-]+)?(;base64)?,([\s\S]*)$/.exec(uri);
  if (!m) return undefined;
  try {
    if (m[1]) { const bin = atob(m[2]!); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); }
    return decodeURIComponent(m[2]!);
  } catch { return undefined; }
}
