// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { FileSystemAdapter } from 'obsidian';
import { FlowMotionSettings } from '../src/obsidian/main';
import { installAddon } from '../src/obsidian/addon-installer';
import { allSettings, notices } from './stubs/obsidian';

vi.mock('../src/obsidian/addon-installer', () => ({ installAddon: vi.fn(async () => undefined), removeAddon: vi.fn(async () => undefined) }));

// Builds the settings tab the way Obsidian does, with the plugin and app objects it needs.
function makeTab(settings: Record<string, unknown>) {
  allSettings.length = 0; notices.length = 0;
  const saves: unknown[] = [];
  const released: string[] = [];
  const plugin = {
    settings, pluginDir: '/vault/.obsidian/plugins/flowmotion', pluginRoot: '/vault/.obsidian/plugins/flowmotion',
    save: async () => { saves.push({ ...settings }); },
    releaseAddon: async (id: string) => { released.push(id); },
  };
  const app = { vault: { adapter: new FileSystemAdapter() } };
  const tab = new FlowMotionSettings(app as never, plugin as never);
  return { tab, saves, released };
}

const DEFAULTS = { autoplay: true, speed: 1, paperLight: 'light', paperDark: 'dark', drawioEnabled: false, codeEditor: false };

describe('settings page', () => {
  it('opens without throwing and lists the draw.io add-on and code editor toggles', () => {
    const { tab } = makeTab({ ...DEFAULTS });
    expect(() => tab.display()).not.toThrow();
    const text = tab.containerEl.textContent ?? '';
    expect(text).toContain('Optional add-ons');
    expect(text).toContain('draw.io editor');
    expect(text).toContain('Code editor');
  });

  it('opens again after a first display without leaving work behind', async () => {
    const { tab } = makeTab({ ...DEFAULTS });
    tab.display();
    tab.display();
    // Status checks finish asynchronously; the page must still be usable after they do.
    await new Promise((r) => setTimeout(r, 20));
    expect(tab.containerEl.textContent).toContain('Status:');
  });

  it('shows unknown status when checking add-on files fails', async () => {
    const exists = vi.spyOn(FileSystemAdapter.prototype, 'exists').mockRejectedValue(new Error('check failed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { tab } = makeTab({ ...DEFAULTS });
      tab.display();
      await vi.waitFor(() => {
        expect(tab.containerEl.textContent?.match(/Status: unknown\./g)).toHaveLength(1);
      });
      expect(log).toHaveBeenCalled();
    } finally {
      exists.mockRestore();
      log.mockRestore();
    }
  });

  it('turning an add-on on downloads it when its files are missing', async () => {
    const { tab, saves } = makeTab({ ...DEFAULTS });
    tab.display();
    const row = allSettings.find((x) => x.name === 'draw.io editor')!;
    notices.length = 0;
    await row.toggle!.handler(true);
    expect(installAddon).toHaveBeenCalledWith(expect.objectContaining({ dir: 'drawio' }), expect.any(FileSystemAdapter), '/vault/.obsidian/plugins/flowmotion');
    expect(saves.at(-1)).toMatchObject({ drawioEnabled: true });
    expect(notices.some((n) => n.includes('draw.io editor') && n.includes('is installed'))).toBe(true);
  });

  it('keeps an add-on off when its download fails', async () => {
    vi.mocked(installAddon).mockRejectedValueOnce(new Error('offline'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tab, saves } = makeTab({ ...DEFAULTS });
    tab.display();
    const row = allSettings.find((x) => x.name === 'draw.io editor')!;
    notices.length = 0;
    await row.toggle!.handler(true);
    expect(saves.at(-1)).toMatchObject({ drawioEnabled: false });
    expect(row.toggle!.value).toBe(false);
    expect(notices.some((n) => n.includes('could not download') && n.includes('offline'))).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('turning an add-on off deletes its files', async () => {
    const { tab, saves, released } = makeTab({ ...DEFAULTS, drawioEnabled: true });
    tab.display();
    const row = allSettings.find((x) => x.name === 'draw.io editor')!;
    await row.toggle!.handler(false);
    expect(released).toEqual(['drawio']);
    expect(saves.at(-1)).toMatchObject({ drawioEnabled: false });
  });

  it('declares the settings for Obsidian 1.13 and later', () => {
    const { tab } = makeTab({ ...DEFAULTS });
    const text = JSON.stringify(tab.getSettingDefinitions());
    for (const key of ['autoplay', 'paperLight', 'paperDark', 'speed']) expect(text).toContain(key);
    for (const name of ['draw.io editor', 'Code editor']) expect(text).toContain(name);
  });

  it('stores speed as a number and reads it back as text for the dropdown', async () => {
    const settings = { ...DEFAULTS };
    const { tab, saves } = makeTab(settings);
    expect(tab.getControlValue('speed')).toBe('1');
    await tab.setControlValue('speed', '2');
    expect(settings.speed).toBe(2);
    expect(saves.length).toBe(1);
  });
});
