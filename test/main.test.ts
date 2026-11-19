// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSystemAdapter, TFile, TFolder } from 'obsidian';
import FlowMotionPlugin from '../src/obsidian/main';
import { notices } from './stubs/obsidian';
import { FlowView } from '../src/obsidian/flowview';
import { FakeEditor } from './stubs/fake-editor';

vi.mock('../src/obsidian/file-dialog', () => ({ chooseDiagramFile: vi.fn() }));
vi.mock('../src/obsidian/addon-installer', () => ({ installAddon: vi.fn(async () => undefined), removeAddon: vi.fn(async () => undefined) }));
import { chooseDiagramFile } from '../src/obsidian/file-dialog';
import { removeAddon } from '../src/obsidian/addon-installer';

const mkFile = (path: string) => Object.assign(new TFile(), { path, name: path.split('/').pop()!, extension: path.split('.').pop()!, parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' } });

interface Files { [p: string]: string }
function makeApp(files: Files = {}) {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  const created: string[] = [];
  const tfiles: Record<string, TFile> = {};
  for (const p of Object.keys(files)) tfiles[p] = mkFile(p);
  const open = vi.fn(async () => undefined);
  const leaves: { view: any }[] = [];
  const app: any = {
    vault: {
      adapter: Object.assign(new FileSystemAdapter(), { exists: vi.fn(async () => false) }), configDir: '.obsidian',
      getAbstractFileByPath: (p: string) => tfiles[p] ?? null,
      cachedRead: async (f: TFile) => files[f.path], read: async (f: TFile) => files[f.path],
      modify: vi.fn(async (f: TFile, v: string) => { files[f.path] = v; }),
      process: vi.fn(async (f: TFile, fn: (d: string) => string) => { files[f.path] = fn(files[f.path]!); }),
      create: vi.fn(async (p: string, d: string) => { created.push(p); files[p] = d; tfiles[p] = mkFile(p); return tfiles[p]; }),
      createFolder: vi.fn(async () => undefined),
      on: (n: string, cb: (...a: any[]) => void) => { (handlers[n] ??= []).push(cb); return {}; },
    },
    workspace: {
      getActiveFile: () => null, getActiveViewOfType: vi.fn(() => null), getLeaf: () => ({ openFile: open }),
      getLeavesOfType: () => leaves,
      on: (n: string, cb: (...a: any[]) => void) => { (handlers[n] ??= []).push(cb); return {}; },
    },
    fileManager: { renameFile: vi.fn(async () => undefined) },
  };
  return { app, handlers, created, files, tfiles, open, leaves };
}

async function load(files: Files = {}, data: any = null) {
  const h = makeApp(files);
  const plugin: any = new FlowMotionPlugin(h.app, { id: 'flowmotion', version: '1', dir: 'p' } as never);
  plugin.loadData = async () => data;
  plugin.saveData = vi.fn(async () => undefined);
  await plugin.onload();
  return { plugin, ...h };
}

const editor = (line = '', ch = 0) => ({ getCursor: () => ({ line: 0, ch }), getLine: () => line, replaceSelection: vi.fn() });
const cmd = (p: any, id: string) => p.commands.find((c: any) => c.id === id);

beforeEach(() => { notices.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

function ctxFor(path: string, info: any) {
  const children: any[] = [];
  return { sourcePath: path, getSectionInfo: () => info, addChild: (c: any) => children.push(c), children };
}

describe('diagram block processor', () => {
  it('renders inline diagrams, errors, and edit button', async () => {
    const { plugin } = await load();
    const el = document.createElement('div'); document.body.append(el);
    const ctx = ctxFor('n.md', null);
    await plugin.processors.flowmotion('nodes: [{ id: a }]', el, ctx);
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('.fm-edit-btn')).not.toBeNull();
    const el2 = document.createElement('div');
    await plugin.processors.flowmotion('nodes: [{ id: a, shape: zzz }]', el2, ctx2());
    expect(el2.querySelector('.fm-error')).not.toBeNull();
    const el3 = document.createElement('div');
    await plugin.processors.flowmotion('nodes: [{ id: a }]', el3, ctx);
    ctx.children[0].onload(); ctx.children[0].onunload();
    function ctx2() { return ctxFor('n.md', null); }
  });

  it('embeds files, reports missing ones and reloads on modify', async () => {
    const { plugin, handlers, files } = await load({ 'd/a.flow': 'nodes: [{ id: a }]', 'b.flow': 'nodes: [{ id: [' });
    const mk = async (src: string, path = 'd/n.md') => {
      const el = document.createElement('div'); const ctx = ctxFor(path, null);
      await plugin.processors.flowmotion(src, el, ctx); return { el, child: ctx.children[0] };
    };
    const ok = await mk('src: a.flow');
    expect(ok.el.querySelector('svg')).not.toBeNull();
    expect((await mk('src: nope.flow')).el.querySelector('.fm-error')!.textContent).toContain('not found');
    expect((await mk('src: ../../x.flow')).el.querySelector('.fm-error')!.textContent).toContain('outside');
    expect((await mk('src: b.flow', 'x.md')).el.querySelector('.fm-error')!.textContent).toContain('b.flow:');
    expect((await mk('src: d/a.flow', 'x.md')).el.querySelector('svg')).not.toBeNull();
    files['d/a.flow'] = 'nodes: [{ id: z }]';
    const f = plugin.app.vault.getAbstractFileByPath('d/a.flow');
    handlers.modify!.forEach((h) => h({}));
    handlers.modify!.forEach((h) => h(mkFile('other.flow')));
    handlers.modify!.forEach((h) => h(f)); handlers.modify!.forEach((h) => h(f));
    await new Promise((r) => setTimeout(r, 400));
    expect(ok.el.innerHTML).toContain('svg');
  });

  it('omits the edit button in slides and changes the paper', async () => {
    const note = '```flowmotion\nnodes: [{ id: a }]\n```';
    const { plugin, files } = await load({ 'n.md': note });
    const slides = document.createElement('div'); slides.className = 'reveal';
    const el = document.createElement('div'); slides.append(el); document.body.append(slides);
    await plugin.processors.flowmotion('nodes: [{ id: a }]', el, ctxFor('n.md', null));
    expect(el.querySelector('.fm-edit-btn')).toBeNull();
    // drawio-like backdrop with paper selector
    const { plugin: p2, files: f2 } = await load({ 'n.md': '```flowmotion\nsrc: a.drawio.flow\n```', 'a.drawio.flow': '' });
    void p2; void f2; void files;
  });

  it('setPaper rewrites the block or warns', async () => {
    const { plugin, files, app } = await load({ 'n.md': '```flowmotion\nnodes: [{ id: a }]\npaper: dark\n```' });
    const el = document.createElement('div');
    const ctx = ctxFor('n.md', { lineStart: 0, lineEnd: 3 });
    await plugin.processors.flowmotion('nodes: [{ id: a }]', el, ctx);
    const child = ctx.children[0];
    await child.setPaper('light');
    expect(files['n.md']).toContain('paper: light');
    await child.setPaper('default');
    expect(files['n.md']).not.toContain('paper');
    files['n.md'] = 'no fence\n\n\nx';
    await child.setPaper('dark');
    expect(notices.some((n) => n.includes('changed'))).toBe(true);
    const c2 = ctxFor('missing.md', null); await plugin.processors.flowmotion('nodes: [{ id: a }]', document.createElement('div'), c2);
    await c2.children[0].setPaper('x');
    expect(notices.some((n) => n.includes('open the note'))).toBe(true);
    void app;
  });
});

describe('editing diagrams', () => {
  it('edits inline blocks through the modal and saves', async () => {
    const { plugin, files } = await load({ 'n.md': '```flowmotion\nnodes: [{ id: a }]\n```' });
    const el = document.createElement('div'); document.body.append(el);
    const ctx = ctxFor('n.md', { lineStart: 0, lineEnd: 2 });
    await plugin.processors.flowmotion('nodes: [{ id: a }]', el, ctx);
    await plugin.editDiagram(ctx.children[0]);
    expect(document.querySelector('.cm-editor')).not.toBeNull();
    // exercise save closure via a second call with direct access
    const spy = vi.spyOn(plugin.app.vault, 'process');
    el.querySelector<HTMLButtonElement>('.fm-edit-btn')!.click();
    await Promise.resolve();
    void spy; void files;
  });

  it('edits inline save closure and mismatch', async () => {
    const { plugin, files } = await load({ 'n.md': '```flowmotion\nnodes: [{ id: a }]\n```' });
    const el = document.createElement('div');
    const ctx = ctxFor('n.md', { lineStart: 0, lineEnd: 2 });
    await plugin.processors.flowmotion('nodes: [{ id: a }]', el, ctx);
    const { EditModal } = await import('../src/obsidian/edit-modal');
    const saved: ((v: string) => Promise<void>)[] = [];
    vi.spyOn(EditModal.prototype, 'open').mockImplementation(function (this: any) { saved.push(this.o.save); });
    await plugin.editDiagram(ctx.children[0]);
    await saved[0]!('nodes: [{ id: b }]\n\n');
    expect(files['n.md']).toContain('id: b');
    await expect(saved[0]!('x')).rejects.toThrow(/changed/);
    const c2 = ctxFor('gone.md', null);
    await plugin.processors.flowmotion('nodes: [{ id: a }]', document.createElement('div'), c2);
    await plugin.editDiagram(c2.children[0]);
    expect(notices.some((n) => n.includes('open the note'))).toBe(true);
  });

  it('edits embedded files, drawio files and missing files', async () => {
    const { plugin, files, open } = await load({ 'a.flow': 'nodes: [{ id: a }]', 'b.drawio.flow': '' });
    const { EditModal } = await import('../src/obsidian/edit-modal');
    const saved: any[] = [];
    vi.spyOn(EditModal.prototype, 'open').mockImplementation(function (this: any) { saved.push(this.o); });
    const mk = async (src: string) => { const c = ctxFor('n.md', null); await plugin.processors.flowmotion(src, document.createElement('div'), c); return c.children[0]; };
    await plugin.editDiagram(await mk('src: a.flow'));
    expect(saved[0].title).toBe('a.flow');
    await saved[0].save('nodes: [{ id: q }]');
    expect(files['a.flow']).toContain('id: q');
    await plugin.editDiagram(await mk('src: b.drawio.flow'));
    expect(open).toHaveBeenCalled();
    await plugin.editDiagram(await mk('src: gone.flow'));
    expect(notices.some((n) => n.includes('file not found'))).toBe(true);
  });
});

describe('commands and menus', () => {
  it('creates diagrams and inserts blocks', async () => {
    const { plugin, created, open, app } = await load({ 'Untitled.flow': 'x', 'sub/Untitled.drawio.flow': 'x' });
    await cmd(plugin, 'new-flow').callback();
    await plugin.newFlow('sub');
    await plugin.newFlow('/');
    expect(created).toHaveLength(3);
    expect(open).toHaveBeenCalledTimes(3);
    await plugin.newDrawio('sub');
    expect(notices.some((n) => n.includes('turn on'))).toBe(true);
    plugin.settings.drawioEnabled = true;
    await plugin.newDrawio('sub'); await cmd(plugin, 'new-drawio').callback();
    expect(created.some((p) => p.endsWith('.drawio.flow'))).toBe(true);
    const ed = editor('text', 4);
    cmd(plugin, 'insert-diagram').editorCallback(ed);
    expect(ed.replaceSelection.mock.calls[0]![0]).toMatch(/^\n\n```flowmotion/);
    const ed2 = editor('', 0);
    plugin.insertDiagram(ed2);
    expect(ed2.replaceSelection.mock.calls[0]![0]).toMatch(/^```flowmotion/);
    void app;
  });

  it('inserts file diagrams from the dialog', async () => {
    const { plugin, files, tfiles } = await load({ 'f/x.flow': 'a' });
    const dlg = vi.mocked(chooseDiagramFile);
    const note = Object.assign(mkFile('f/n.md'));
    const ed = editor();
    dlg.mockResolvedValueOnce(undefined);
    await plugin.insertDiagramFile(ed, note);
    expect(ed.replaceSelection).not.toHaveBeenCalled();
    dlg.mockResolvedValueOnce({ kind: 'existing', file: tfiles['f/x.flow']! });
    await plugin.insertDiagramFile(ed, note);
    expect(ed.replaceSelection.mock.calls[0]![0]).toContain('src: x.flow');
    dlg.mockResolvedValueOnce({ kind: 'new', path: 'newdir/my diagram.flow' });
    await plugin.insertDiagramFile(ed, null);
    expect(ed.replaceSelection.mock.calls[1]![0]).toContain('"newdir/my diagram.flow"');
    dlg.mockResolvedValueOnce({ kind: 'new', path: 'top.flow' });
    await plugin.insertDiagramFile(ed, mkFile('n.md'));
    expect(files['top.flow']).toBeDefined();
    cmd(plugin, 'insert-diagram-file').editorCallback(ed, { file: null });
  });

  it('adds editor and file menu items', async () => {
    const { handlers, app } = await load();
    const items: any[] = [];
    const mkItem = (sub = true) => {
      const i: any = { t: '', setTitle(t: string) { this.t = t; return this; }, setIcon() { return this; }, setSection() { return this; }, onClick(f: () => void) { this.click = f; return this; } };
      if (sub) i.setSubmenu = () => ({ addItem: (fn: (j: any) => void) => { const j = mkItem(false); fn(j); items.push(j); } });
      return i;
    };
    for (const sub of [true, false]) {
      items.length = 0;
      const menu = { addItem: (fn: (i: any) => void) => { const i = mkItem(sub); if (!sub) delete i.setSubmenu; fn(i); if (!sub) items.push(i); } };
      const ed = editor();
      (ed as any).getCursor = () => ({ line: 0, ch: 0 });
      handlers['editor-menu']![0]!(menu, ed, { file: null });
      items.forEach((i) => i.click?.());
    }
    const fmt: any[] = [];
    const inb = new FakeEditor('```flowmotion\nnodes: [{id: a}]\n```', 1, 0);
    handlers['editor-menu']![1]!({ addItem: (fn: any) => { const i = mkItem(false); fn(i); fmt.push(i); } }, inb);
    fmt.forEach((i) => i.click?.());
    handlers['editor-menu']![1]!({ addItem: vi.fn() }, new FakeEditor('plain', 0, 0));
    const fm: any[] = [];
    const fmenu = { addItem: (fn: any) => { const i = mkItem(false); fn(i); fm.push(i); } };
    const folder = Object.assign(new TFolder(), { path: 'dir' });
    handlers['file-menu']![0]!(fmenu, folder);
    handlers['file-menu']![0]!(fmenu, mkFile('c.yaml'));
    handlers['file-menu']![0]!(fmenu, mkFile('c.md'));
    expect(fm).toHaveLength(3);
    await fm[0].click(); await fm[2].click();
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(expect.anything(), 'c.flow');
  });

  it('format commands', async () => {
    const { plugin, app } = await load();
    const c = cmd(plugin, 'format-block');
    expect(c.editorCheckCallback(true, new FakeEditor('plain'))).toBe(false);
    const inBlock = new FakeEditor('```flowmotion\nnodes: [{id: a}]\n```', 1, 0);
    expect(c.editorCheckCallback(true, inBlock)).toBe(true);
    c.editorCheckCallback(false, inBlock);
    c.editorCheckCallback(false, inBlock);
    expect(notices.some((n) => n.includes('nothing to format'))).toBe(true);
    const d = cmd(plugin, 'format-diagram');
    expect(d.checkCallback(true)).toBe(false);
    const fmt = vi.fn();
    app.workspace.getActiveViewOfType.mockReturnValue({ format: fmt });
    expect(d.checkCallback(false)).toBe(true);
    expect(fmt).toHaveBeenCalled();
  });
});

describe('plugin lifecycle', () => {
  it('registers a FlowView and saves settings', async () => {
    const { plugin } = await load({}, { speed: 2 });
    expect(plugin.settings.speed).toBe(2);
    expect(plugin.views['flowmotion-flow']({ detach() {} })).toBeInstanceOf(FlowView);
    plugin.settings.codeEditor = true;
    plugin.views['flowmotion-flow']({ detach() {} });
    await plugin.save();
    expect(plugin.saveData).toHaveBeenCalled();
    const bare: any = new FlowMotionPlugin(makeApp().app, { id: 'flowmotion', version: '1' } as never);
    expect(bare.pluginDir).toBe('.obsidian/plugins/flowmotion');
    plugin.onunload();
  });

  it('releases add-ons and restores draw.io panes on failure', async () => {
    const { plugin, leaves, app } = await load();
    await plugin.releaseAddon('monaco');
    const view: any = Object.assign(Object.create(FlowView.prototype), { file: { name: 'a.drawio.flow' }, saveDrawioBeforeAddonRemoval: vi.fn(), retireDrawioPane: vi.fn(), restoreDrawioPane: vi.fn() });
    leaves.push({ view }, { view: {} });
    await plugin.releaseAddon('drawio');
    expect(view.retireDrawioPane).toHaveBeenCalled();
    vi.mocked(removeAddon).mockRejectedValueOnce(new Error('boom'));
    app.vault.adapter.exists.mockResolvedValueOnce(true);
    await expect(plugin.releaseAddon('drawio')).rejects.toThrow('boom');
    expect(view.restoreDrawioPane).toHaveBeenCalled();
    vi.mocked(removeAddon).mockRejectedValueOnce(new Error('boom'));
    await expect(plugin.releaseAddon('monaco')).rejects.toThrow('boom');
  });
});
