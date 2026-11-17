import { FileSystemAdapter, type App } from 'obsidian';
import type { Handle, MountOptions } from '../monaco/entry';

/** The add-on's exports. The build embeds its CSS and exposes the <style> element it adds as __fmStyle. */
export interface MonacoApi { mount(host: HTMLElement, opts: MountOptions): Handle; purge(): void; __fmStyle?: HTMLStyleElement }

/** Node's require, which Obsidian's desktop app exposes on window. Used only to load the add-on file from the plugin folder. */
type NodeRequire = { (id: string): unknown; cache: Record<string, unknown> };
const nodeRequire = (): NodeRequire => (window as unknown as { require: NodeRequire }).require;

/**
 * Loads the Monaco add-on on first use and releases it when the last editor closes.
 * The add-on is a CommonJS file (monaco.js) in the plugin folder. It is read with Node's module loader,
 * which is how Electron loads any module; no code is fetched from the network or evaluated from a string.
 * Desktop app only. On mobile the plain text editor is used.
 */
export class MonacoLoader {
  private api?: MonacoApi;
  private loading?: Promise<MonacoApi>;
  private path?: string;
  private refs = 0;
  constructor(private app: App, private dir: string) {}

  async acquire(): Promise<MonacoApi> {
    this.refs++;
    try { return await (this.loading ??= this.load()); }
    catch (e) { this.refs--; this.loading = undefined; throw e; }
  }

  release() { if (this.refs > 0 && --this.refs === 0) this.unload(); }

  /** True when this device can run the add-on and its files are in the plugin folder. */
  async installed(): Promise<boolean> {
    const a = this.app.vault.adapter;
    if (!(a instanceof FileSystemAdapter) || !nodeRequire()) return false;
    return a.exists(`${this.dir}/monaco.js`);
  }

  private async load(): Promise<MonacoApi> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error('the code editor works on the desktop app only');
    this.path = adapter.getFullPath(`${this.dir}/monaco.js`);
    this.api = nodeRequire()(this.path) as MonacoApi; // its footer adds the embedded CSS
    return this.api;
  }

  private unload() {
    try { this.api?.purge(); } catch { /* best effort */ }
    this.api?.__fmStyle?.remove();
    // Drop the module from Node's cache so its memory can be reclaimed; the next open loads it again.
    if (this.path) { try { delete nodeRequire().cache[this.path]; } catch { /* best effort */ } }
    this.path = undefined;
    this.api = undefined;
    this.loading = undefined;
    // Widgets Monaco attaches to <body> (menus, hovers, aria live regions).
    activeDocument.body.querySelectorAll(':scope > .monaco-aria-container, :scope > .context-view, :scope > .monaco-menu-container, :scope > .shadow-root-host, :scope > .monaco-hover').forEach((n) => n.remove());
  }

  /** For plugin unload. */
  dispose() { this.refs = 0; this.unload(); }
}
