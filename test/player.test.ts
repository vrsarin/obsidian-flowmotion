// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildModel } from '../src/model';
import { mountModel } from '../src/runtime/mount';
import { Player } from '../src/runtime/player';
import { renderSvg } from '../src/render/svg';

const SRC = 'nodes: [{ id: a }, { id: b }]\nedges: [{ id: e, from: a, to: b }]\nevents: [{ id: p1, type: process, node: a, duration: 1000 }, { id: p2, type: process, node: b, duration: 1000 }]';

async function makePlayer(opts = {}) {
  const model = await buildModel(SRC);
  const holder = document.createElement('div');
  holder.appendChild(new DOMParser().parseFromString(renderSvg(model, { idPrefix: 'x', theme: 'light' }), 'image/svg+xml').documentElement);
  const svg = holder.querySelector('svg') as unknown as SVGSVGElement;
  return new Player(svg, model, opts);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Player', () => {
  it('plays, ticks, pauses and toggles', async () => {
    let frame: ((n: number) => void) | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frame = cb; return 7; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const onUpdate = vi.fn();
    const p = await makePlayer({ onUpdate, loop: false });
    p.play(); p.play();
    expect(p.playing).toBe(true);
    frame!(performance.now() + 50);
    expect(p.t).toBeGreaterThan(0);
    p.toggle();
    expect(p.playing).toBe(false);
    expect(cancel).toHaveBeenCalled();
    p.pause(); // no-op when already paused
    p.toggle();
    expect(p.playing).toBe(true);
    p.destroy();
    expect(p.playing).toBe(false);
    frame!(0); // tick after destroy returns early
    expect(onUpdate).toHaveBeenCalled();
  });

  it('stops at the end when not looping and wraps when looping', async () => {
    let frame: ((n: number) => void) | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frame = cb; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const p = await makePlayer({ loop: false, speed: 1000 });
    p.play();
    frame!(performance.now() + 100);
    expect(p.playing).toBe(false);
    expect(p.t).toBe(p.total);
    p.play(); // restarts from 0 when at end
    expect(p.t).toBe(0);
    const q = await makePlayer({ loop: true, speed: 1000 });
    q.play();
    frame!(performance.now() + 100);
    expect(q.playing).toBe(true);
    expect(q.t).toBeLessThan(q.total);
  });

  it('seeks, steps, resets, replays and changes speed', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const p = await makePlayer();
    p.seek(-5); expect(p.t).toBe(0);
    p.seek(1e9); expect(p.t).toBe(p.total);
    p.seek(0);
    p.stepForward(); expect(p.t).toBeGreaterThan(0);
    p.seek(p.total); p.stepForward(); expect(p.t).toBe(p.total);
    p.stepBack(); expect(p.t).toBeLessThan(p.total);
    p.seek(0); p.stepBack(); expect(p.t).toBe(0);
    p.setSpeed(2); expect(p.speed).toBe(2);
    p.seek(500); p.reset(); expect(p.t).toBe(0);
    p.replay(); expect(p.playing).toBe(true);
  });

  it('drives bars, packets and shows in the SVG', async () => {
    const model = await buildModel('nodes: [{ id: a }, { id: b }]\nflows: [{ id: e, from: a, to: b }]\nevents: [{ id: m, type: transfer, flow: e, duration: 1000 }]');
    const holder = document.createElement('div');
    holder.replaceChildren(new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><g data-node="a"/><rect data-bar="x" data-full="100"/><g data-packet="m"/><g data-show="s"/><g data-edge="e"/><g data-caption="c"/></svg>', 'image/svg+xml').documentElement);
    const p = new Player(holder.querySelector('svg') as unknown as SVGSVGElement, model);
    p.seek(500);
    expect(holder.querySelector('[data-packet]')!.getAttribute('opacity')).toBeTruthy();
    expect(holder.querySelector('[data-bar]')!.getAttribute('opacity')).toBe('0');
  });
});

describe('mountModel extras', () => {
  it('wires step buttons, speed, background picker and observers', async () => {
    const model = await buildModel(SRC);
    const container = document.createElement('div');
    const observed: any[] = [];
    let ioCb: ((e: { isIntersecting: boolean }[]) => void) | undefined;
    vi.stubGlobal('IntersectionObserver', class { constructor(cb: typeof ioCb) { ioCb = cb; } observe(e: any) { observed.push(e); } disconnect() {} });
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const onPaper = vi.fn();
    const m = mountModel(container, { ...model, backdrop: '<g/>', view: { ...model.view, paper: 'none', controlsPosition: 'bottom' } } as never, { autoplay: true, controls: true, onPaper, paperChoice: 'dark' });
    expect(raf).toHaveBeenCalled();
    for (const l of ['Step forward', 'Step back', 'Reset', 'Replay']) container.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`)!.click();
    container.querySelector('svg')!.dispatchEvent(new Event('click'));
    const speed = container.querySelector<HTMLSelectElement>('select[aria-label="Speed"]')!;
    speed.value = '2'; speed.dispatchEvent(new Event('change'));
    expect(m.player.speed).toBe(2);
    const sel = container.querySelector<HTMLSelectElement>('select[aria-label="Drawing background"]')!;
    expect(sel.value).toBe('dark');
    sel.value = 'light'; sel.dispatchEvent(new Event('change'));
    expect(onPaper).toHaveBeenCalledWith('light');
    expect(container.querySelector('.fm-bar-bottom')).not.toBeNull();
    m.player.play();
    ioCb!([{ isIntersecting: false }]);
    expect(m.player.playing).toBe(false);
    ioCb!([{ isIntersecting: true }]);
    expect(m.player.playing).toBe(true);
    expect(observed).toHaveLength(1);
    m.destroy();
  });

  it('handles full screen mode changes', async () => {
    const model = await buildModel('nodes: [{ id: a }]');
    const container = document.createElement('div');
    const m = mountModel(container, model, { autoplay: false });
    const wrap = container.querySelector<HTMLElement>('.fm-wrap')!;
    const mode = container.querySelector<HTMLSelectElement>('select[aria-label="Screen mode"]')!;
    mode.value = 'full'; mode.dispatchEvent(new Event('change')); // no requestFullscreen in happy-dom? falls back
    wrap.requestFullscreen = () => Promise.reject(new Error('no'));
    mode.value = 'full'; mode.dispatchEvent(new Event('change'));
    await Promise.resolve(); await Promise.resolve();
    expect(mode.value).toBe('fit');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => wrap });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(mode.value).toBe('full');
    const exit = vi.fn().mockResolvedValue(undefined);
    (document as unknown as { exitFullscreen: any }).exitFullscreen = exit;
    mode.value = 'normal'; mode.dispatchEvent(new Event('change'));
    expect(exit).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('fullscreenchange'));
    m.destroy();
  });

  it('adapts to Reveal slides and reduced motion', async () => {
    const model = await buildModel(SRC);
    const slides = document.createElement('div'); slides.className = 'reveal';
    const box = document.createElement('div'); box.className = 'slides';
    const section = document.createElement('section');
    box.appendChild(section); slides.appendChild(box); document.body.appendChild(slides);
    const container = document.createElement('div'); section.appendChild(container);
    vi.stubGlobal('ResizeObserver', class { constructor(public cb: () => void) {} observe() { this.cb(); } disconnect() {} });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    Object.defineProperty(section, 'scrollHeight', { configurable: true, value: 100 });
    const m = mountModel(container, model, { height: '60vh' });
    expect(container.querySelector('.fm-in-slide')).not.toBeNull();
    expect(m.player.t).toBe(m.player.total);
    expect(container.querySelector('select[aria-label="Screen mode"] option[value="normal"]')).toBeNull();
    window.dispatchEvent(new Event('resize'));
    const m2 = mountModel(container, model, { height: '300px' });
    const m3 = mountModel(container, model, {});
    m.destroy(); m2.destroy(); m3.destroy();
    slides.remove();
  });

  it('throws on invalid SVG', async () => {
    const model = await buildModel('nodes: [{ id: a }]');
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockReturnValue({ getElementsByTagName: () => [1] } as never);
    expect(() => mountModel(document.createElement('div'), model)).toThrow(/invalid SVG/);
  });
});
