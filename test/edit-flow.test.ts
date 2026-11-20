// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform, TFile } from 'obsidian';
import { notices } from './stubs/obsidian';
import { EditModal } from '../src/obsidian/edit-modal';
import { FlowView } from '../src/obsidian/flowview';

vi.mock('../src/obsidian/drawio-pane', async (orig) => {
  const real = await orig<typeof import('../src/obsidian/drawio-pane')>();
  class FakePane { static all: FakePane[] = []; root = document.createElement('div'); data = ''; destroyed = false; flush = vi.fn(async () => undefined); constructor(public parent: HTMLElement, public o: any) { FakePane.all.push(this); } set(d: string) { this.data = d; } destroy() { this.destroyed = true; } }
  return { ...real, DrawioPane: FakePane };
});
import { DrawioPane } from '../src/obsidian/drawio-pane';

const base = { app: { vault: { getAbstractFileByPath: () => null } } as never, autoplay: false, speed: 1 };
afterEach(() => { document.body.replaceChildren(); notices.length = 0; });

describe('EditModal', () => {
  it('opens a pane and saves, formats and closes', async () => {
    const save = vi.fn(async () => undefined);
    const m = new EditModal({ ...base, title: 'T', text: 'nodes: [{id: a}]', save });
    m.open();
    expect(m.contentEl.querySelector('.cm-editor')).not.toBeNull();
    const pane = (m as any).pane;
    const btns = (m as any).o; void btns;
    expect(pane.getValue()).toContain('nodes');
    m.close(); m.onClose();
    expect((m as any).pane).toBeUndefined();
  });

  it('wires the buttons', async () => {
    const calls: Record<string, () => any> = {};
    const { Setting } = await import('obsidian');
    const orig = Setting.prototype.addButton;
    vi.spyOn(Setting.prototype, 'addButton').mockImplementation(function (this: any, cb: any) {
      cb({ setButtonText(t: string) { this.t = t; return this; }, setCta() { return this; }, onClick(f: () => any) { calls[this.t] = f; return this; } }); return this;
    });
    void orig;
    const save = vi.fn(async () => undefined);
    const m = new EditModal({ ...base, title: 'T', text: 'nodes: [{id: a}]', save });
    m.open();
    calls.Format!();
    await calls.Save!();
    expect(save).toHaveBeenCalled();
    save.mockRejectedValueOnce(new Error('bad'));
    await calls.Save!();
    expect(notices.some((n) => n.includes('bad'))).toBe(true);
    calls.Close!();
  });
});

function makeView(name: string, opts: Partial<{ drawio: boolean }> = {}) {
  const leaf = { detach: vi.fn() };
  const v: any = new FlowView(leaf as never, { ...base, pluginDir: 'p', server: { url: async () => 'u' }, drawio: opts.drawio ?? true });
  v.file = Object.assign(new TFile(), { name, path: `d/${name}`, basename: name.split('.')[0] });
  return { v, leaf };
}

describe('FlowView', () => {
  it('handles text files', async () => {
    const { v } = makeView('a.flow');
    expect(v.getViewType()).toBe('flowmotion-flow');
    expect(v.getIcon()).toBe('workflow');
    expect(v.getDisplayText()).toBe('a');
    v.file = null; expect(v.getDisplayText()).toBe('FlowMotion');
    v.file = Object.assign(new TFile(), { name: 'a.flow', path: 'a.flow', basename: 'a' });
    v.setViewData('nodes: [{id: a}]', true);
    expect(v.getViewData()).toContain('nodes');
    v.format();
    v.clear(); expect(v.getViewData()).toBe('');
    v.saveDrawioBeforeAddonRemoval(); v.retireDrawioPane(); v.restoreDrawioPane();
    await v.onClose();
  });

  it('handles draw.io files', async () => {
    const { v, leaf } = makeView('a.drawio.flow');
    v.setViewData('<svg/>', true);
    const pane = (DrawioPane as any).all.at(-1);
    expect(pane.data).toBe('<svg/>');
    expect(v.getViewData()).toBe('<svg/>');
    v.format(); v.clear();
    pane.o.onSave('<svg>new</svg>');
    expect(v.getViewData()).toBe('<svg>new</svg>');
    pane.o.onExit(); expect(leaf.detach).toHaveBeenCalled();
    v.setViewData('<svg>2</svg>', false); // same file reuses pane
    await v.saveDrawioBeforeAddonRemoval();
    expect(pane.flush).toHaveBeenCalled();
    v.file = Object.assign(new TFile(), { name: 'b.drawio.flow', path: 'd/b.drawio.flow' });
    pane.o.onSave('stale'); // wrong file: ignored
    v.setViewData('<svg>3</svg>', true); // new file: pane replaced
    expect(pane.destroyed).toBe(true);
    v.retireDrawioPane();
    expect(v.drawio).toBeUndefined();
    v.restoreDrawioPane();
    expect((DrawioPane as any).all.length).toBeGreaterThan(1);
    v.setViewData('x', true); // switch to text
    v.file = Object.assign(new TFile(), { name: 'c.flow', path: 'c.flow' });
    v.setViewData('nodes: []', true);
    await v.onClose();
  });

  it('explains when the editor is off or on mobile', () => {
    const { v } = makeView('a.drawio.flow', { drawio: false });
    v.setViewData('<svg/>', true);
    expect(v.contentEl.textContent).toContain('editor is off');
    v.setViewData('<svg/>', true);
    Platform.isDesktopApp = false;
    try {
      v.setViewData('<svg/>', true);
      expect(v.contentEl.textContent).toContain('desktop app only');
    } finally { Platform.isDesktopApp = true; }
  });
});
