// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FileSystemAdapter } from 'obsidian';
import { FlowMotionSettings } from '../src/obsidian/main';
import { allSettings, notices } from './stubs/obsidian';

// Builds the settings tab the way Obsidian does, with the plugin and app objects it needs.
function makeTab(settings: Record<string, unknown>) {
  allSettings.length = 0; notices.length = 0;
  const saves: unknown[] = [];
  const plugin = {
    settings, pluginDir: '/vault/.obsidian/plugins/flowmotion',
    save: async () => { saves.push({ ...settings }); },
  };
  const app = { vault: { adapter: new FileSystemAdapter() } };
  const tab = new FlowMotionSettings(app as never, plugin as never);
  return { tab, saves };
}

const DEFAULTS = { autoplay: true, speed: 1, paperLight: 'light', paperDark: 'dark', drawioEnabled: false, codeEditor: false };

describe('settings page', () => {
  it('opens without throwing and lists both add-on toggles', () => {
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

  it('turning an add-on on without its files shows the download notice', async () => {
    const { tab, saves } = makeTab({ ...DEFAULTS });
    tab.display();
    const row = allSettings.find((x) => x.name === 'Code editor')!;
    expect(row.toggle).toBeDefined();
    notices.length = 0;
    await row.toggle!.handler(true);
    expect(saves.length).toBe(1);
    expect(notices.some((n) => n.includes('Code editor') && n.includes('not installed'))).toBe(true);
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
