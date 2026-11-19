// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { EditorPane } from '../src/obsidian/editor-pane';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const files = new Set<string>();
const app = { vault: { getAbstractFileByPath: (p: string) => (files.has(p) ? Object.assign(new TFile(), { path: p }) : null) } } as never;
const mk = (extra: Record<string, any> = {}) => {
  const onChange = vi.fn();
  const pane = new EditorPane(document.body, { app, autoplay: false, speed: 1, onChange, ...extra });
  return { pane, onChange };
};
const handle = () => ({ getValue: vi.fn(() => 'monaco'), setValue: vi.fn(), focus: vi.fn(), layout: vi.fn(), format: vi.fn(), dispose: vi.fn() });
afterEach(() => { document.body.replaceChildren(); files.clear(); vi.restoreAllMocks(); });

describe('EditorPane (CodeMirror)', () => {
  it('edits, previews, formats and toggles', async () => {
    const { pane, onChange } = mk({ notePath: 'a/b.md' });
    pane.set('nodes: [{id: a}]');
    await wait();
    expect(pane.getValue()).toContain('nodes');
    const cm = (pane as any).cm;
    cm.dispatch({ changes: { from: 0, to: 0, insert: '# x\n' } });
    expect(onChange).toHaveBeenCalled();
    pane.format(); pane.focus(); pane.togglePreview(); pane.togglePreview();
    pane.set('');
    await wait();
    expect(pane.root.querySelector('.fm-flow-empty')).not.toBeNull();
    pane.set('nodes: [');
    await wait();
    expect(pane.root.querySelector('.fm-error')).not.toBeNull();
    // Shift+Alt+F via the keymap
    cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', shiftKey: true, altKey: true, bubbles: true }));
    pane.destroy();
    expect((pane as any).cm).toBeUndefined();
  });

  it('shows the add-on note when not installed', async () => {
    const loader = { installed: vi.fn(async () => false), acquire: vi.fn(), release: vi.fn() };
    const { pane } = mk({ loader });
    pane.set('nodes: [{id: a}]');
    await wait();
    expect(pane.root.textContent).toContain('not installed');
    pane.destroy();
  });

  it('reports a load failure and releases', async () => {
    const loader = { installed: vi.fn(async () => true), acquire: vi.fn(async () => { throw new Error('boom'); }), release: vi.fn() };
    const { pane } = mk({ loader });
    pane.set('x: 1');
    await wait();
    expect(pane.root.textContent).toContain('boom');
    pane.destroy();
  });
});

describe('EditorPane (Monaco)', () => {
  it('mounts the handle, forwards changes and releases', async () => {
    const h = handle();
    let opts: any;
    const api = { mount: vi.fn((_host: HTMLElement, o: any) => { opts = o; return h; }), purge: vi.fn() };
    const loader = { installed: vi.fn(async () => true), acquire: vi.fn(async () => api), release: vi.fn() };
    const { pane, onChange } = mk({ loader, notePath: 'dir/n.md' });
    pane.set('nodes: [{id: a}]');
    await wait();
    expect(api.mount).toHaveBeenCalled();
    opts.onChange('nodes: [{id: z}]');
    expect(onChange).toHaveBeenCalledWith('nodes: [{id: z}]');
    expect(pane.getValue()).toBe('monaco');
    pane.set('again'); expect(h.setValue).toHaveBeenCalled();
    pane.format(); expect(h.format).toHaveBeenCalled();
    pane.focus(); expect(h.focus).toHaveBeenCalled();
    expect(opts.fileExists('x.png')).toBe(false);
    files.add('dir/x.png');
    expect(opts.fileExists('x.png')).toBe(true);
    files.clear(); files.add('y.png');
    expect(opts.fileExists('y.png')).toBe(true);
    expect(opts.fileExists('../../../y.png')).toBe(false);
    await wait(450);
    pane.destroy();
    expect(h.dispose).toHaveBeenCalled();
    expect(loader.release).toHaveBeenCalled();
  });

  it('releases when destroyed during acquire', async () => {
    let go!: (a: any) => void;
    const loader = { installed: vi.fn(async () => true), acquire: vi.fn(() => new Promise((r) => { go = r; })), release: vi.fn() };
    const { pane } = mk({ loader });
    pane.set('x: 1');
    await wait();
    pane.destroy();
    go({ mount: vi.fn(), purge: vi.fn() });
    await wait();
    expect(loader.release).toHaveBeenCalledTimes(1);
  });

  it('does nothing when destroyed before start', async () => {
    const loader = { installed: vi.fn(async () => true), acquire: vi.fn(), release: vi.fn() };
    const { pane } = mk({ loader });
    pane.destroy();
    pane.set('x: 1');
    await wait();
    expect(loader.acquire).not.toHaveBeenCalled();
  });

  it('release after mount failure', async () => {
    const api = { mount: vi.fn(() => { throw new Error('mount'); }), purge: vi.fn() };
    const loader = { installed: vi.fn(async () => true), acquire: vi.fn(async () => api), release: vi.fn() };
    const { pane } = mk({ loader });
    pane.set('x: 1');
    await wait();
    expect(loader.release).toHaveBeenCalled();
    expect(pane.root.textContent).toContain('mount');
  });
});
