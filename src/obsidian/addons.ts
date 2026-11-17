import type { App } from 'obsidian';

/** Setup instructions for building optional add-ons from their upstream sources. */
export const ADDON_SETUP_URL = 'https://github.com/vrsarin/obsidian-flowmotion#optional-add-ons';

export interface AddonStatus { drawio: boolean; codeEditor: boolean }

/** Checks which optional add-on files are in the plugin folder. The code editor is one file: monaco.js (CSS is embedded). */
export async function addonStatus(app: App, pluginDir: string): Promise<AddonStatus> {
  const a = app.vault.adapter;
  const [drawio, codeEditor] = await Promise.all([
    a.exists(`${pluginDir}/drawio/index.html`),
    a.exists(`${pluginDir}/monaco.js`),
  ]);
  return { drawio, codeEditor };
}
