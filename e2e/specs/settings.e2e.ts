import { browser, expect } from '@wdio/globals';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Settings page tests. Each test starts from a fresh copy of the vault (default settings).

const ADDON_NOTICE = 'the draw.io editor add-on is not installed';

let mainWindow: string;

async function inMainWindow<T>(action: () => Promise<T>): Promise<T> {
  const currentWindow = await browser.getWindowHandle();
  if (currentWindow !== mainWindow) await browser.switchToWindow(mainWindow);
  try {
    return await action();
  } finally {
    if (currentWindow !== mainWindow) await browser.switchToWindow(currentWindow);
  }
}

async function openSettings(): Promise<void> {
  await browser.switchToWindow(mainWindow);
  await browser.executeObsidian(({ app }) => {
    app.setting.open();
    app.setting.openTabById('flowmotion');
  });
  await browser.waitUntil(async () => {
    const settingsWindow = (await browser.getWindowHandles()).find((handle) => handle !== mainWindow);
    if (settingsWindow) {
      await browser.switchToWindow(settingsWindow);
      return true;
    }
    return (await browser.$$('.vertical-tab-content .setting-item')).length > 0;
  }, { timeout: 10000, timeoutMsg: 'Settings window did not open' });
  await browser.waitUntil(async () => (await browser.$$('.vertical-tab-content .setting-item')).length > 0, {
    timeout: 10000, timeoutMsg: 'FlowMotion settings did not appear',
  });
}

/** Finds a setting row on the open FlowMotion tab by its visible name. */
async function setting(name: string) {
  const items = await browser.$$('.vertical-tab-content .setting-item');
  for (const item of items) {
    const label = item.$('.setting-item-name');
    if ((await label.isExisting()) && (await label.getText()) === name) return item;
  }
  throw new Error(`Setting not found: "${name}"`);
}

async function setToggle(name: string, on: boolean): Promise<void> {
  const item = await setting(name);
  const box = item.$('.checkbox-container');
  const isOn = (await box.getAttribute('class')).includes('is-enabled');
  if (isOn !== on) await box.click();
}

async function toggleIsOn(name: string): Promise<boolean> {
  const item = await setting(name);
  return (await item.$('.checkbox-container').getAttribute('class')).includes('is-enabled');
}

async function setDropdown(name: string, value: string): Promise<void> {
  const item = await setting(name);
  await item.$('select:not(.is-measuring)').selectByAttribute('value', value);
}

async function dropdownValue(name: string): Promise<string> {
  const item = await setting(name);
  return item.$('select:not(.is-measuring)').getValue();
}

async function dropdownOptions(name: string): Promise<string[]> {
  const item = await setting(name);
  const opts = await item.$$('select:not(.is-measuring) option');
  const values: string[] = [];
  for (const option of opts) values.push(await option.getAttribute('value'));
  return values;
}

async function pluginSettings(): Promise<Record<string, unknown>> {
  return inMainWindow(() => browser.executeObsidian(({ plugins }) => ({ ...(plugins as Record<string, { settings: Record<string, unknown> }>).flowmotion!.settings })));
}

async function vaultPath(): Promise<string> {
  return inMainWindow(() => browser.executeObsidian(({ app }) => (app.vault.adapter as unknown as { basePath: string }).basePath));
}

/** The data.json file the plugin writes through saveData(). */
function savedDataPath(base: string): string {
  return join(base, '.obsidian', 'plugins', 'flowmotion', 'data.json');
}

async function waitForSavedSetting(base: string, key: string, expected: unknown): Promise<void> {
  await browser.waitUntil(
    () => {
      try {
        return JSON.parse(readFileSync(savedDataPath(base), 'utf8'))[key] === expected;
      } catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          return false;
        }
        throw error;
      }
    },
    { timeout: 5000, timeoutMsg: `${key} was not saved as ${JSON.stringify(expected)}` },
  );
}

async function noticeTexts(): Promise<string[]> {
  const notices = await browser.$$('.notice');
  const texts: string[] = [];
  for (const notice of notices) texts.push(await notice.getText());
  return texts;
}

async function waitForNotice(fragment: string): Promise<void> {
  await browser.waitUntil(async () => (await noticeTexts()).some((t) => t.includes(fragment)), {
    timeout: 5000,
    timeoutMsg: `no notice containing "${fragment}"`,
  });
}

describe('FlowMotion settings page', () => {
  beforeEach(async () => {
    await browser.reloadObsidian({ vault: 'e2e/vaults/simple' });
    mainWindow = await browser.getWindowHandle();
    const pluginDir = join(await vaultPath(), '.obsidian', 'plugins', 'flowmotion');
    rmSync(join(pluginDir, 'drawio', 'index.html'), { force: true });
    copyFileSync('dist/plugin/monaco.js', join(pluginDir, 'monaco.js'));
  });

  describe('layout', () => {
    it('shows every setting in the main group', async () => {
      await openSettings();
      for (const name of [
        'Autoplay',
        'draw.io background in light mode',
        'draw.io background in dark mode',
        'Default speed',
        'Playback controls',
      ]) {
        await setting(name);
      }
    });

    it('shows the optional add-ons group with its heading and both toggles', async () => {
      await openSettings();
      const heading = await browser.$('.vertical-tab-content .setting-item-heading .setting-item-name');
      await expect(heading).toHaveText('Optional add-ons');
      await setting('Add-on files');
      await setting('draw.io editor');
      await setting('Code editor');
    });

    it('shows the add-on folder path and download link in the add-on files note', async () => {
      await openSettings();
      const item = await setting('Add-on files');
      const desc = await item.$('.setting-item-description').getText();
      expect(desc).toContain('https://github.com/vrsarin/obsidian-flowmotion/releases');
      expect(desc).toContain('.obsidian/plugins/flowmotion');
    });

    it('has no toggle or dropdown on the playback-controls row', async () => {
      await openSettings();
      const item = await setting('Playback controls');
      expect(await item.$('.checkbox-container').isExisting()).toBe(false);
      expect(await item.$('select').isExisting()).toBe(false);
    });
  });

  describe('autoplay', () => {
    it('is on by default', async () => {
      await openSettings();
      expect(await toggleIsOn('Autoplay')).toBe(true);
      expect((await pluginSettings()).autoplay).toBe(true);
    });

    it('turns off, saves to disk, and shows the change on reopen', async () => {
      await openSettings();
      await setToggle('Autoplay', false);
      expect((await pluginSettings()).autoplay).toBe(false);

      const base = await vaultPath();
      await waitForSavedSetting(base, 'autoplay', false);

      // Close and reopen the settings tab: the toggle should still be off.
      await browser.switchToWindow(mainWindow);
      await browser.executeObsidian(({ app }) => app.setting.close());
      await openSettings();
      expect(await toggleIsOn('Autoplay')).toBe(false);
    });

    it('turns back on', async () => {
      await openSettings();
      await setToggle('Autoplay', false);
      await setToggle('Autoplay', true);
      expect((await pluginSettings()).autoplay).toBe(true);
    });
  });

  describe('default speed', () => {
    it('defaults to 1×', async () => {
      await openSettings();
      expect(await dropdownValue('Default speed')).toBe('1');
      expect((await pluginSettings()).speed).toBe(1);
    });

    it('offers 0.5×, 1× and 2×', async () => {
      await openSettings();
      expect((await dropdownOptions('Default speed')).sort()).toEqual(['0.5', '1', '2']);
    });

    it('saves a numeric speed, not text', async () => {
      await openSettings();
      await setDropdown('Default speed', '2');
      expect((await pluginSettings()).speed).toBe(2);
      expect(typeof (await pluginSettings()).speed).toBe('number');

      const base = await vaultPath();
      await waitForSavedSetting(base, 'speed', 2);
    });

    it('saves 0.5×', async () => {
      await openSettings();
      await setDropdown('Default speed', '0.5');
      expect((await pluginSettings()).speed).toBe(0.5);
    });
  });

  describe('draw.io background', () => {
    it('light mode defaults to light and offers the paper options', async () => {
      await openSettings();
      expect(await dropdownValue('draw.io background in light mode')).toBe('light');
      const options = await dropdownOptions('draw.io background in light mode');
      expect(options.length).toBeGreaterThan(1);
      expect(options).toContain('light');
      expect(options).toContain('dark');
      expect(options).toContain('none');
    });

    it('dark mode defaults to dark', async () => {
      await openSettings();
      expect(await dropdownValue('draw.io background in dark mode')).toBe('dark');
    });

    it('light mode choice saves', async () => {
      await openSettings();
      await setDropdown('draw.io background in light mode', 'none');
      expect((await pluginSettings()).paperLight).toBe('none');
    });

    it('dark mode choice saves independently of light mode', async () => {
      await openSettings();
      await setDropdown('draw.io background in dark mode', 'none');
      expect((await pluginSettings()).paperDark).toBe('none');
      expect((await pluginSettings()).paperLight).toBe('light');
    });
  });

  describe('add-ons', () => {
    it('draw.io editor is off by default and shows not installed', async () => {
      await openSettings();
      expect(await toggleIsOn('draw.io editor')).toBe(false);
      await browser.waitUntil(async () => (await (await setting('draw.io editor')).getText()).includes('Status: not installed.'), {
        timeout: 5000,
        timeoutMsg: 'draw.io status did not say "not installed"',
      });
    });

    it('turning draw.io on without its files shows a notice and keeps it on', async () => {
      await openSettings();
      await setToggle('draw.io editor', true);
      await waitForNotice(ADDON_NOTICE);
      expect(await toggleIsOn('draw.io editor')).toBe(true);
      expect((await pluginSettings()).drawioEnabled).toBe(true);
    });

    it('turning draw.io on with its files installed shows no notice and status installed', async () => {
      const base = await vaultPath();
      const dir = join(base, '.obsidian', 'plugins', 'flowmotion', 'drawio');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>draw.io</title>');
      try {
        await browser.reloadObsidian({ vault: base, copy: false });
        mainWindow = await browser.getWindowHandle();
        await openSettings();
        await browser.waitUntil(async () => (await (await setting('draw.io editor')).getText()).includes('Status: installed.'), {
          timeout: 5000,
          timeoutMsg: 'draw.io status did not say "installed"',
        });
        await setToggle('draw.io editor', true);
        await browser.pause(500);
        expect((await noticeTexts()).some((t) => t.includes(ADDON_NOTICE))).toBe(false);
        expect((await pluginSettings()).drawioEnabled).toBe(true);
      } finally {
        rmSync(join(dir, 'index.html'), { force: true });
      }
    });

    it('code editor shows its status from the built monaco.js file', async () => {
      // The build puts monaco.js in the plugin folder, so the code editor reads as installed.
      await openSettings();
      await browser.waitUntil(async () => (await (await setting('Code editor')).getText()).includes('Status: installed.'), {
        timeout: 5000,
        timeoutMsg: 'code editor status did not say "installed"',
      });
    });

    it('turning the code editor on saves and raises no notice when installed', async () => {
      await openSettings();
      await setToggle('Code editor', true);
      await browser.pause(500);
      expect((await pluginSettings()).codeEditor).toBe(true);
      expect((await noticeTexts()).some((t) => t.includes('Code editor add-on is not installed'))).toBe(false);
    });

    it('turning the code editor off saves', async () => {
      await openSettings();
      await setToggle('Code editor', true);
      await setToggle('Code editor', false);
      expect((await pluginSettings()).codeEditor).toBe(false);
    });
  });

  describe('persistence', () => {
    it('waits for a partially written settings file to become valid', async () => {
      const base = await vaultPath();
      const path = savedDataPath(base);
      writeFileSync(path, '{"speed":');
      const timer = setTimeout(() => writeFileSync(path, '{"speed":2}'), 1000);
      try {
        await waitForSavedSetting(base, 'speed', 2);
      } finally {
        clearTimeout(timer);
      }
    });

    it('keeps every changed value after Obsidian restarts on the same vault', async () => {
      await openSettings();
      await setToggle('Autoplay', false);
      await setDropdown('Default speed', '2');
      await setDropdown('draw.io background in light mode', 'none');
      await setDropdown('draw.io background in dark mode', 'light');
      await setToggle('Code editor', true);

      const base = await vaultPath();
      await waitForSavedSetting(base, 'speed', 2);
      await waitForSavedSetting(base, 'codeEditor', true);

      // The vault is already a temporary copy, so restart it in place.
      await browser.switchToWindow(mainWindow);
      await browser.reloadObsidian({ vault: base, copy: false });
      mainWindow = await browser.getWindowHandle();

      const saved = await pluginSettings();
      expect(saved).toMatchObject({ autoplay: false, speed: 2, paperLight: 'none', paperDark: 'light', codeEditor: true });

      await openSettings();
      expect(await toggleIsOn('Autoplay')).toBe(false);
      expect(await dropdownValue('Default speed')).toBe('2');
      expect(await dropdownValue('draw.io background in light mode')).toBe('none');
      expect(await dropdownValue('draw.io background in dark mode')).toBe('light');
      expect(await toggleIsOn('Code editor')).toBe(true);
    });
  });
});
