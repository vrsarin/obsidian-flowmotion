// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildModel } from '../src/model';
import { mountModel } from '../src/runtime/mount';

describe('browser runtime', () => {
  it('mounts a model using standard DOM APIs', async () => {
    const model = await buildModel('nodes: [{ id: a }]');
    const container = document.createElement('div');
    vi.stubGlobal('createEl', undefined);
    try {
      const mounted = mountModel(container, model, { theme: 'light', autoplay: false });
      expect(container.querySelector('.fm-wrap svg')).not.toBeNull();
      expect(container.querySelector('.fm-controls button')).not.toBeNull();
      mounted.destroy();
      expect(container.querySelector('.fm-wrap')).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it('updates diagram sizing and playback toggle state without overriding fullscreen styles', async () => {
    const model = await buildModel('nodes: [{ id: a }]');
    const container = document.createElement('div');
    const mounted = mountModel(container, { ...model, view: { ...model.view, width: '600px' } }, { height: '50vh', autoplay: false });
    const wrap = container.querySelector<HTMLElement>('.fm-wrap')!;
    const svg = container.querySelector<SVGSVGElement>('svg')!;
    const mode = container.querySelector<HTMLSelectElement>('select[aria-label="Screen mode"]')!;
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Show playback controls"]')!;
    expect(wrap.style.getPropertyValue('--fm-wrap-width')).toBe('600px');
    expect(svg.style.getPropertyValue('--fm-diagram-max-height')).toBe('50vh');
    mode.value = 'normal'; mode.dispatchEvent(new Event('change'));
    expect(svg.style.getPropertyValue('--fm-diagram-max-height')).toBe('none');
    expect(svg.style.getPropertyValue('--fm-diagram-width')).toBe('auto');
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLElement>('.fm-pb')!.hidden).toBe(false);
    mode.value = 'fit'; mode.dispatchEvent(new Event('change'));
    expect(svg.style.getPropertyValue('--fm-diagram-max-height')).toBe('50vh');
    mounted.destroy();
  });

  it('synchronizes playback controls while playing, paused, and seeking', async () => {
    const model = await buildModel('nodes: [{ id: a }]\nevents: [{ id: work, type: process, node: a, duration: 1000 }]');
    const container = document.createElement('div');
    const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    try {
      const mounted = mountModel(container, model, { autoplay: false });
      const play = container.querySelector<HTMLButtonElement>('button[aria-label="Play"]')!;
      const scrub = container.querySelector<HTMLInputElement>('input[aria-label="Timeline"]')!;
      const time = container.querySelector<HTMLElement>('.fm-time')!;

      play.click();
      expect(play.getAttribute('aria-label')).toBe('Pause');
      play.click();
      expect(play.getAttribute('aria-label')).toBe('Play');
      scrub.value = '250'; scrub.dispatchEvent(new Event('input'));
      expect(time.textContent).toBe('0.3s');
      mounted.destroy();
    } finally {
      request.mockRestore(); cancel.mockRestore();
    }
  });

  it('uses the supplied Obsidian element factory when available', async () => {
    const model = await buildModel('nodes: [{ id: a }]');
    const container = document.createElement('div');
    const spy = vi.spyOn(window, 'createEl');
    try {
      const mounted = mountModel(container, model, { createEl, autoplay: false });
      expect(spy).toHaveBeenCalled();
      expect(container.querySelector('.fm-wrap svg')).not.toBeNull();
      expect(container.querySelector('.fm-controls button')).not.toBeNull();
      mounted.destroy();
    } finally { spy.mockRestore(); }
  });
});
