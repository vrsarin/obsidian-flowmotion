// Test-only stand-in for the 'obsidian' package (Vitest aliases 'obsidian' to this file).
// It is a functional stub: enough of the API for FlowMotion's settings and helpers to run in tests.
// It is not a faithful Obsidian runtime. Real behaviour is checked by manual testing in a vault.

export class Notice { constructor(public message: string, public timeout?: number) { notices.push(message); } }
export const notices: string[] = [];

export class Component { load() {} unload() {} }
export class MarkdownRenderChild extends Component { constructor(public containerEl: HTMLElement) { super(); } }

export class Plugin {
  app: unknown; manifest: { id: string; dir?: string };
  constructor(app: unknown, manifest: { id: string; dir?: string }) { this.app = app; this.manifest = manifest; }
  settingTabs: PluginSettingTab[] = [];
  addSettingTab(tab: PluginSettingTab) { this.settingTabs.push(tab); }
  addCommand(_c: unknown) {}
  registerView(_t: string, _f: unknown) {}
  registerExtensions(_e: string[], _v: string) {}
  registerEvent(_e: unknown) {}
  addRibbonIcon(_i: string, _t: string, _c: unknown) { return document.createElement('div'); }
  registerDomEvent(..._a: unknown[]) {}
  registerMarkdownCodeBlockProcessor(..._a: unknown[]) {}
  registerEditorSuggest(_s: unknown) {}
  registerEditorExtension(_e: unknown) {}
  async loadData(): Promise<unknown> { return null; }
  async saveData(_d: unknown) {}
}

export class PluginSettingTab {
  containerEl: HTMLElement = document.createElement('div');
  constructor(public app: unknown, public plugin: unknown) {}
  display() {}
  hide() {}
}

/** Every Setting created, so tests can find a row by name and use its controls. */
export const allSettings: Setting[] = [];

export class Setting {
  settingEl: HTMLElement; private nameEl: HTMLElement; descEl: HTMLElement; name = ''; toggle?: ToggleComponent;
  constructor(container: HTMLElement) {
    allSettings.push(this);
    this.settingEl = container.createEl('div');
    this.nameEl = this.settingEl.createEl('div');
    this.descEl = this.settingEl.createEl('div');
  }
  setName(n: string) { this.name = n; this.nameEl.textContent = n; return this; }
  setDesc(d: string | DocumentFragment) { this.descEl.textContent = typeof d === 'string' ? d : d.textContent; return this; }
  setHeading() { return this; }
  addToggle(cb: (t: ToggleComponent) => void) { this.toggle = new ToggleComponent(); cb(this.toggle); return this; }
  addDropdown(cb: (d: DropdownComponent) => void) { cb(new DropdownComponent()); return this; }
  addText(cb: (t: TextComponent) => void) { cb(new TextComponent()); return this; }
  addButton(cb: (b: ButtonComponent) => void) { cb(new ButtonComponent()); return this; }
}

export class ToggleComponent {
  value = false; handler: (v: boolean) => unknown = () => undefined;
  disabled = false;
  setValue(v: boolean) { this.value = v; return this; }
  setDisabled(d: boolean) { this.disabled = d; return this; }
  onChange(fn: (v: boolean) => unknown) { this.handler = fn; return this; }
}
export class DropdownComponent {
  value = ''; options: Record<string, string> = {}; handler: (v: string) => unknown = () => undefined;
  addOption(v: string, label: string) { this.options[v] = label; return this; }
  setValue(v: string) { this.value = v; return this; }
  onChange(fn: (v: string) => unknown) { this.handler = fn; return this; }
}
export class TextComponent { value = ''; setValue(v: string) { this.value = v; return this; } setPlaceholder() { return this; } onChange() { return this; } }
export class ButtonComponent { setButtonText() { return this; } setCta() { return this; } onClick() { return this; } }

export const Platform = { isDesktopApp: true, isMobile: false, isDesktop: true, isMacOS: true };

export class TFile { path = ''; name = ''; extension = ''; basename = ''; }
export class TFolder { path = ''; name = ''; children: unknown[] = []; }
export class FileSystemAdapter {
  constructor(public base = '/vault') {}
  getFullPath(p: string) { return `${this.base}/${p}`; }
  async exists(_p: string) { return false; }
}
export class TextFileView extends Component {}
export class Modal {
  containerEl = document.createElement('div'); modalEl = document.createElement('div'); contentEl = document.createElement('div');
  constructor(public app: unknown) {}
  open() {} close() {} onOpen() {} onClose() {}
}
export class Editor {}
export class EditorSuggest<T> extends Component { constructor(public app: unknown) { super(); } }
export class Menu {}
export function normalizePath(p: string) { return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export function setIcon(_el: HTMLElement, _icon: string) {}
export type App = unknown;
export type MarkdownPostProcessorContext = unknown;
export type EditorPosition = { line: number; ch: number };
export type EditorSuggestContext = unknown;
export type EditorSuggestTriggerInfo = unknown;
export type WorkspaceLeaf = unknown;
