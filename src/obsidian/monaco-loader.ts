import { Platform } from 'obsidian';
import * as glue from '../monaco/entry';
import type { Handle, MountOptions } from '../monaco/entry';

export interface MonacoApi { mount(host: HTMLElement, opts: MountOptions): Handle; purge(): void }

/**
 * Loads Monaco on first use. Monaco is bundled into main.js, but its modules are split off with dynamic import()
 * so they are only evaluated when a code editor opens. Desktop only: on mobile the plain text editor is used.
 * Browsers cannot unload modules, so after the first open the code stays in memory until Obsidian restarts or the plugin is reloaded.
 */
export class MonacoLoader {
  private api?: MonacoApi;
  private loading?: Promise<MonacoApi>;
  private refs = 0;

  async acquire(): Promise<MonacoApi> {
    this.refs++;
    try { return await (this.loading ??= this.load()); }
    catch (e) { this.refs--; this.loading = undefined; throw e; }
  }

  release() { if (this.refs > 0 && --this.refs === 0) this.cleanup(); }

  /** True when this device can run the code editor. */
  installed(): Promise<boolean> { return Promise.resolve(Platform.isDesktopApp); }

  private async load(): Promise<MonacoApi> {
    if (!Platform.isDesktopApp) throw new Error('the code editor works on the desktop app only');
    const [monaco, yaml] = await Promise.all([import('monaco-editor/editor/editor.main'), import('monaco-editor/languages/definitions/yaml/yaml')]);
    glue.init(monaco, yaml);
    this.api = glue;
    return glue;
  }

  private cleanup() {
    try { this.api?.purge(); } catch { /* best effort */ }
    this.loading = undefined;
    this.api = undefined;
    // Widgets Monaco attaches to <body> (menus, hovers, aria live regions).
    activeDocument.body.querySelectorAll(':scope > .monaco-aria-container, :scope > .context-view, :scope > .monaco-menu-container, :scope > .shadow-root-host, :scope > .monaco-hover').forEach((n) => n.remove());
  }

  /** For plugin unload. */
  dispose() { this.refs = 0; this.cleanup(); activeDocument.head.querySelectorAll('style[data-flowmotion-monaco]').forEach((n) => n.remove()); }
}
