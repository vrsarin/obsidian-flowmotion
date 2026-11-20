import type { App } from 'obsidian';
import { extractMxfile } from '../drawio/parse';

export const DRAWIO_SUFFIX = '.drawio.flow';
export const isDrawioName = (name: string | undefined) => !!name && name.toLowerCase().endsWith(DRAWIO_SUFFIX);

export const BLANK_MXFILE = '<mxfile><diagram name="Page-1" id="page1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** A new file's content: an empty draw.io SVG (draw.io reads and writes this format; so does FlowMotion). */
export const BLANK_DRAWIO = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1px" height="1px" viewBox="0 0 1 1" content="${esc(BLANK_MXFILE)}"><g/></svg>\n`;

export interface DrawioOptions { app: App; pluginDir: string; server: { url(): Promise<string> }; onSave(svg: string): void; onExit(): void }

/** draw.io running in an iframe from the plugin folder (offline). We speak its postMessage JSON protocol:
 *  init -> load, autosave/save -> export as SVG with the diagram embedded, exit -> close. */
export class DrawioPane {
  readonly root: HTMLElement;
  private frame?: HTMLIFrameElement;
  private targetOrigin?: string;
  private pending = '';
  private ready = false;
  private xml = BLANK_MXFILE;
  private dead = false;
  private exportQueue: Promise<void> = Promise.resolve();
  private exportRequest?: { resolve(): void; reject(error: Error): void; timer: number };
  private readonly onMsg = (ev: MessageEvent) => this.handle(ev);

  constructor(parent: HTMLElement, private readonly o: DrawioOptions) {
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
      this.root.createEl('p', { cls: 'fm-error', text: 'The draw.io add-on is not installed. Turn it off and on again in FlowMotion settings to download it, then reopen this file.' });
      return;
    }
    if (this.dead) return;
    let base: string;
    try { base = await this.o.server.url(); } catch (e) { this.root.createEl('p', { cls: 'fm-error', text: `Could not start the local draw.io server: ${(e as Error).message}` }); return; }
    if (this.dead) return;
    const url = `${base}/index.html?embed=1&proto=json&spin=1&offline=1&lang=en&ui=atlas&saveAndExit=0&noExitBtn=1&libraries=1`;
    this.targetOrigin = new URL(base).origin;
    this.frame = this.root.createEl('iframe', { cls: 'fm-drawio-frame', attr: { src: url, title: 'draw.io editor' } });
  }

  private post(msg: object) {
    if (this.targetOrigin) this.frame?.contentWindow?.postMessage(JSON.stringify(msg), this.targetOrigin);
  }
  private load() { this.pending = this.xml; this.post({ action: 'load', xml: this.xml, autosave: 1 }); }

  private export(xml: string): Promise<void> {
    const task = this.exportQueue.then(() => new Promise<void>((resolve, reject) => {
      if (!this.frame || this.dead) { reject(new Error('draw.io editor closed before saving')); return; }
      const timer = window.setTimeout(() => {
        this.exportRequest = undefined;
        reject(new Error('timed out saving the draw.io editor'));
      }, 10000);
      this.exportRequest = { resolve, reject, timer };
      this.post({ action: 'export', format: 'xmlsvg', xml, spin: 'Saving' });
    }));
    this.exportQueue = task.catch((e) => { console.error('FlowMotion: draw.io export failed', e); });
    return task;
  }

  /** Exports the latest editor state before the add-on server or files are removed. */
  async flush(): Promise<void> {
    if (!this.frame || !this.ready || this.dead) return;
    const revision = this.revision;
    await this.export(this.pending);
    // Saving is serialized: a newer revision must be exported after this one completes.
    if (revision !== this.revision) await this.flush();
  }

  private revision = 0;

  private handle(ev: MessageEvent) {
    if (this.dead || !this.frame?.contentWindow || ev.source !== this.frame.contentWindow || typeof ev.data !== 'string') return;
    let m: { event?: string; xml?: string; data?: string; format?: string };
    try { m = JSON.parse(ev.data) as typeof m; } catch { return; }
    switch (m.event) {
      case 'init': this.ready = true; this.load(); break;
      case 'autosave': case 'save':
        if (typeof m.xml === 'string') {
          this.pending = this.xml = m.xml;
          this.revision++;
          void this.export(m.xml).catch(() => undefined);
        }
        break;
      case 'export': {
        const svg = typeof m.data === 'string' ? decodeSvg(m.data) : undefined;
        const request = this.exportRequest;
        if (request) {
          window.clearTimeout(request.timer);
          this.exportRequest = undefined;
          if (svg) {
            this.o.onSave(svg);
            request.resolve();
          } else request.reject(new Error('draw.io returned an invalid SVG while saving'));
        } else if (svg) this.o.onSave(svg);
        break;
      }
      case 'exit': this.o.onExit(); break;
    }
  }

  destroy() {
    this.dead = true;
    if (this.exportRequest) {
      window.clearTimeout(this.exportRequest.timer);
      this.exportRequest.reject(new Error('draw.io editor closed before saving'));
      this.exportRequest = undefined;
    }
    window.removeEventListener('message', this.onMsg);
    this.frame?.remove();
    this.root.remove();
  }
}

/** draw.io hands the SVG back as a data URI (base64 or percent-encoded). */
export function decodeSvg(uri: string): string | undefined {
  const m = /^data:image\/svg\+xml(?:;charset=[\w-]+)?(;base64)?,([\s\S]*)$/.exec(uri);
  if (!m) return undefined;
  try {
    if (m[1]) { const bin = atob(m[2]!); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.codePointAt(0)!)); }
    return decodeURIComponent(m[2]!);
  } catch { return undefined; }
}
