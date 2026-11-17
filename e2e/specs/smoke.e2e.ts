import { browser } from '@wdio/globals';
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
});
