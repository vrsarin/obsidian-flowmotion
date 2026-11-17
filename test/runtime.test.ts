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

  it('uses Obsidian DOM helpers when available', async () => {
    const model = await buildModel('nodes: [{ id: a }]');
    const spy = vi.spyOn(window, 'createEl');
    try {
      const container = document.createElement('div');
      const mounted = mountModel(container, model, { autoplay: false });
      expect(spy).toHaveBeenCalled();
      expect(container.querySelector('.fm-wrap svg')).not.toBeNull();
      expect(container.querySelector('.fm-controls button')).not.toBeNull();
      mounted.destroy();
    } finally { spy.mockRestore(); }
  });
});
