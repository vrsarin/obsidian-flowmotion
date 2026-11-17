import type { App } from 'obsidian';

/** Where users download the optional add-on files (draw.io editor and code editor). FlowMotion never downloads code itself. */
export const ADDON_URL = 'https://github.com/vrsarin/obsidian-flowmotion/releases';

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
