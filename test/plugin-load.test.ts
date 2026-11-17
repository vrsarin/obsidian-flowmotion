// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FileSystemAdapter } from 'obsidian';
import FlowMotionPlugin from '../src/obsidian/main';

// Loads the whole plugin the way Obsidian does, then opens its settings tab.
function makeApp() {
  return { vault: { adapter: new FileSystemAdapter(), configDir: '.obsidian', getAbstractFileByPath: () => null, getFiles: () => [], on: () => ({}), getMarkdownFiles: () => [] }, workspace: { getActiveFile: () => null, on: () => ({}) } };
}

describe('plugin lifecycle', () => {
  it('loads and unloads without throwing', async () => {
    const plugin = new FlowMotionPlugin(makeApp() as never, { id: 'flowmotion', name: 'FlowMotion', version: '0.1.0', minAppVersion: '1.4.0', dir: '/v/.obsidian/plugins/flowmotion' } as never);
    await expect(plugin.onload()).resolves.not.toThrow();
    expect(() => plugin.onunload()).not.toThrow();
  });

  it('opens the settings tab after load and stays responsive', async () => {
    const plugin = new FlowMotionPlugin(makeApp() as never, { id: 'flowmotion', name: 'FlowMotion', version: '0.1.0', minAppVersion: '1.4.0', dir: '/v/.obsidian/plugins/flowmotion' } as never);
    await plugin.onload();
    const tab = (plugin as unknown as { settingTabs: { display(): void; containerEl: HTMLElement }[] }).settingTabs[0]!;
    expect(tab).toBeDefined();
    expect(() => tab.display()).not.toThrow();
    expect(tab.containerEl.textContent).toContain('Optional add-ons');
  });
});
