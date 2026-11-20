import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

describe('FlowMotion smoke', () => {
  beforeEach(async () => {
    await obsidianPage.resetVault('e2e/vaults/simple');
  });

  it('loads the plugin', async () => {
    const loaded = await browser.executeObsidian(({ plugins }) => plugins.flowmotion !== undefined);
    expect(loaded).toBe(true);
  });

  it('renders a flowmotion code block as SVG', async () => {
    await obsidianPage.openFile('Diagram.md');
    await browser.executeObsidianCommand('markdown:toggle-preview');

    // Obsidian can render a code block more than once, so match any diagram SVG.
    await browser.waitUntil(async () => (await browser.$$('.fm-host svg')).length > 0, {
      timeout: 15000,
      timeoutMsg: 'no flowmotion SVG rendered',
    });
    expect((await browser.$$('.fm-host svg')).length).toBeGreaterThan(0);
  });

  it('applies scene presentation when seeking and restores defaults', async () => {
    await obsidianPage.openFile('ScenePresentation.md');
    await browser.executeObsidianCommand('markdown:toggle-preview');
    await browser.waitUntil(async () => (await browser.$$('.fm-host:has([data-group="group"]) [aria-label="Timeline"]')).length > 0, {
      timeout: 15000,
      timeoutMsg: 'no storyboard timeline rendered',
    });
    const state = async (time: number) => browser.execute((t) => {
      const host = document.querySelector<HTMLElement>('.fm-host:has([data-group="group"])')!;
      const slider = host.querySelector<HTMLInputElement>('[aria-label="Timeline"]')!;
      slider.value = String(t);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const node = host.querySelector<SVGElement>('[data-node="a"]')!;
      const box = node.querySelector<SVGElement>('.fm-box')!;
      const other = host.querySelector<SVGElement>('[data-node="b"]')!;
      const group = host.querySelector<SVGElement>('[data-group="group"]')!;
      const edge = host.querySelector<SVGElement>('[data-edge-wrap="edge"]')!;
      const packet = host.querySelector<SVGElement>(`[data-packet="b${Math.floor(t / 1000)}.e0"]`)!;
      return {
        fill: getComputedStyle(box).fill,
        nodeOpacity: node.getAttribute('opacity'),
        nodeVisibility: node.getAttribute('visibility'),
        otherOpacity: other.getAttribute('opacity'),
        groupVisibility: group.getAttribute('visibility'),
        edgeVisibility: edge.getAttribute('visibility'),
        packetOpacity: packet.getAttribute('opacity'),
      };
    }, time);

    expect(await state(100)).toEqual({
      fill: 'rgb(232, 244, 255)', nodeOpacity: '1', nodeVisibility: 'visible', otherOpacity: '0.3',
      groupVisibility: 'visible', edgeVisibility: 'hidden', packetOpacity: '1',
    });
    const hidden = await state(1100);
    expect(hidden.nodeVisibility).toBe('hidden');
    expect(hidden.groupVisibility).toBe('hidden');
    expect(hidden.edgeVisibility).toBe('hidden');
    expect(hidden.packetOpacity).toBe('0');
    const reset = await state(2100);
    expect(reset.nodeOpacity).toBe('1');
    expect(reset.nodeVisibility).toBe('visible');
    expect(reset.otherOpacity).toBe('1');
    expect(reset.groupVisibility).toBe('visible');
    expect(reset.edgeVisibility).toBe('visible');
    expect(reset.packetOpacity).toBe('1');
  });

  it('advances one interactive beat and exposes SVG export', async () => {
    await obsidianPage.openFile('ScenePresentation.md');
    await browser.executeObsidianCommand('markdown:toggle-preview');
    await browser.waitUntil(async () => (await browser.$$('.fm-host:has([data-group="group"]) [aria-label="Play next beat"]')).length > 0, {
      timeout: 15000,
      timeoutMsg: 'no interactive storyboard controls rendered',
    });
    const state = () => browser.execute(() => {
      const host = document.querySelector<HTMLElement>('.fm-host:has([data-group="group"])')!;
      return {
        time: Number(host.querySelector<HTMLInputElement>('[aria-label="Timeline"]')!.value),
        nextDisabled: host.querySelector<HTMLButtonElement>('[aria-label="Play next beat"]')!.disabled,
        play: !!host.querySelector('[aria-label="Play"]'),
        export: !!host.querySelector('[aria-label="Export animated SVG"]'),
      };
    });
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.fm-host:has([data-group="group"]) [aria-label="Reset"]')!.click());
    expect(await state()).toEqual({ time: 0, nextDisabled: false, play: false, export: true });
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.fm-host:has([data-group="group"]) [aria-label="Play next beat"]')!.click());
    await browser.waitUntil(async () => (await state()).time === 1000 && !(await state()).nextDisabled, {
      timeout: 10000,
      timeoutMsg: 'interactive playback did not pause at the next beat',
    });
    await browser.pause(300);
    expect((await state()).time).toBe(1000);
  });
});
