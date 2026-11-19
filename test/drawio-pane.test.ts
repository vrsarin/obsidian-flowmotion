// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLANK_DRAWIO, BLANK_MXFILE, DrawioPane, decodeSvg, isDrawioName } from '../src/obsidian/drawio-pane';


function setup(exists = true, urlFn: () => Promise<string> = async () => 'about:blank#') {
  const parent = document.body.createDiv();
  const onSave = vi.fn(), onExit = vi.fn();
  const pane = new DrawioPane(parent, { app: { vault: { adapter: { exists: async () => exists } } } as never, pluginDir: 'p', server: { url: urlFn }, onSave, onExit });
  return { parent, pane, onSave, onExit };
}
const msg = (pane: DrawioPane, data: any) => {
  const win = (pane as any).frame.contentWindow;
  window.dispatchEvent(Object.assign(new Event('message'), { source: win, data: typeof data === 'string' ? data : JSON.stringify(data) }));
};
const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('helpers', () => {
  it('detects names and decodes SVG data URIs', () => {
    expect(isDrawioName('A.DRAWIO.flow')).toBe(true);
    expect(isDrawioName('a.flow')).toBe(false);
    expect(isDrawioName(undefined)).toBe(false);
    expect(BLANK_DRAWIO).toContain('content=');
    expect(decodeSvg('data:image/svg+xml;base64,' + btoa('<svg/>'))).toBe('<svg/>');
    expect(decodeSvg('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')).toBe('<svg/>');
    expect(decodeSvg('nope')).toBeUndefined();
    expect(decodeSvg('data:image/svg+xml,%E0%A4%A')).toBeUndefined();
  });
});

describe('DrawioPane', () => {
  it('shows an error without the add-on or server', async () => {
    const a = setup(false); a.pane.set(''); await flush();
    expect(a.parent.textContent).toContain('not installed');
    const b = setup(true, async () => { throw new Error('nope'); }); b.pane.set(''); await flush();
    expect(b.parent.textContent).toContain('nope');
    const c = setup(); c.pane.set(''); c.pane.destroy(); await flush();
    expect((c.pane as any).frame).toBeUndefined();
    const d = setup(true, async () => { d.pane.destroy(); return 'u'; }); d.pane.set(''); await flush();
    expect((d.pane as any).frame).toBeUndefined();
  });

  it('loads, autosaves, exports and exits', async () => {
    const { pane, onSave, onExit, parent } = setup();
    pane.set(''); await flush();
    expect(parent.querySelector('iframe')).not.toBeNull();
    const post = vi.spyOn(pane as any, 'post').mockImplementation(() => {});
    msg(pane, { event: 'init' });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ action: 'load' }));
    pane.set(BLANK_MXFILE); // same as pending: no reload
    pane.set('<mxfile><diagram id="z"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>');
    msg(pane, { event: 'autosave', xml: '<mxfile/>' });
    await flush();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ action: 'export' }));
    msg(pane, { event: 'export', data: 'data:image/svg+xml,%3Csvg%2F%3E' });
    await flush();
    expect(onSave).toHaveBeenCalledWith('<svg/>');
    msg(pane, { event: 'export', data: 'data:image/svg+xml,%3Csvg%2F%3E' }); // unsolicited
    expect(onSave).toHaveBeenCalledTimes(2);
    msg(pane, { event: 'export', data: 'bad' });
    msg(pane, { event: 'save', xml: 5 });
    msg(pane, 'not json'); msg(pane, { event: 'exit' });
    expect(onExit).toHaveBeenCalled();
    window.dispatchEvent(Object.assign(new Event('message'), { source: null, data: '{}' }));
    pane.destroy();
  });

  it('rejects an invalid SVG export and times out', async () => {
    const { pane } = setup();
    pane.set(''); await flush();
    vi.spyOn(pane as any, 'post').mockImplementation(() => {});
    msg(pane, { event: 'init' });
    msg(pane, { event: 'autosave', xml: '<a/>' });
    await flush();
    msg(pane, { event: 'export', data: 'bad' });
    await flush();
    vi.useFakeTimers();
    const p = (pane as any).export('<a/>');
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(11000);
    await expect(p).rejects.toThrow(/timed out/);
    vi.useRealTimers();
  });

  it('flushes pending state and rejects exports after close', async () => {
    const { pane, onSave } = setup();
    await pane.flush(); // no frame yet
    pane.set(''); await flush();
    vi.spyOn(pane as any, 'post').mockImplementation(() => {});
    msg(pane, { event: 'init' });
    const f = pane.flush();
    await flush();
    msg(pane, { event: 'export', data: 'data:image/svg+xml,%3Csvg%2F%3E' });
    await f;
    expect(onSave).toHaveBeenCalled();
    const pending = (pane as any).export('<a/>');
    pending.catch(() => undefined);
    pane.destroy();
    await expect(pending).rejects.toThrow(/closed/);
    await expect((pane as any).export('x')).rejects.toThrow(/closed/);
    await pane.flush();
  });
});
